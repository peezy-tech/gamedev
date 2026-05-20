import crypto from 'crypto'
import { SiweMessage, generateNonce } from 'siwe'
import { Ranks } from '../core/extras/ranks'

const COOKIE_NAME = 'gamedev_wallet_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const NONCE_TTL_MS = 1000 * 60 * 10
const EXCHANGE_TTL_MS = 1000 * 60
const IDENTITY_EXCHANGE_TYP = 'identity_exchange'
const IDENTITY_EXCHANGE_AUDIENCE = 'runtime:exchange'

function nowIso() {
  return new Date().toISOString()
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeAddress(value) {
  const address = typeof value === 'string' ? value.trim() : ''
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? address : ''
}

function normalizeAddressKey(value) {
  return normalizeAddress(value).toLowerCase()
}

function formatWalletName(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function expectedIdentityIssuer(env = process.env) {
  const configured = typeof env.PUBLIC_AUTH_URL === 'string' ? env.PUBLIC_AUTH_URL.trim().replace(/\/+$/, '') : ''
  if (configured) return configured
  const apiUrl = typeof env.PUBLIC_API_URL === 'string' ? env.PUBLIC_API_URL.trim().replace(/\/api\/?$/, '') : ''
  return apiUrl ? `${apiUrl}/api/auth/identity` : 'runtime'
}

function expectedIdentityDomain(env = process.env) {
  const issuer = expectedIdentityIssuer(env)
  try {
    return new URL(issuer).hostname
  } catch {
    return null
  }
}

function parseCookieHeader(header) {
  const cookies = {}
  const raw = typeof header === 'string' ? header : ''
  for (const part of raw.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) cookies[key] = decodeURIComponent(value)
  }
  return cookies
}

function readSessionCookie(req) {
  return parseCookieHeader(req.headers?.cookie || '')[COOKIE_NAME] || ''
}

function authCookiePath(env = process.env) {
  const authUrl = typeof env.PUBLIC_AUTH_URL === 'string' ? env.PUBLIC_AUTH_URL.trim() : ''
  if (!authUrl) return '/api/auth/identity'
  try {
    const parsed = new URL(authUrl)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    return pathname || '/api/auth/identity'
  } catch {
    return '/api/auth/identity'
  }
}

function cookieOptions(env = process.env) {
  const authUrl = typeof env.PUBLIC_AUTH_URL === 'string' ? env.PUBLIC_AUTH_URL.trim() : ''
  const secure = env.STANDALONE_AUTH_COOKIE_SECURE === 'false'
    ? false
    : authUrl.startsWith('https:') || env.NODE_ENV === 'production'
  return {
    path: authCookiePath(env),
    sameSite: secure ? 'None' : 'Lax',
    secure,
  }
}

function serializeCookie(name, value, { maxAgeSeconds = null, expires = null, env = process.env } = {}) {
  const options = cookieOptions(env)
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    'HttpOnly',
    `SameSite=${options.sameSite}`,
  ]
  if (options.secure) parts.push('Secure')
  if (Number.isInteger(maxAgeSeconds)) parts.push(`Max-Age=${maxAgeSeconds}`)
  if (expires instanceof Date) parts.push(`Expires=${expires.toUTCString()}`)
  return parts.join('; ')
}

function clearCookie(env = process.env) {
  return serializeCookie(COOKIE_NAME, '', {
    maxAgeSeconds: 0,
    expires: new Date(0),
    env,
  })
}

function parseWalletList(value) {
  if (typeof value !== 'string') return new Set()
  return new Set(
    value
      .split(',')
      .map(item => normalizeAddressKey(item))
      .filter(Boolean)
  )
}

function walletRank(address, env = process.env) {
  const key = normalizeAddressKey(address)
  if (!key) return Ranks.VISITOR
  const admins = parseWalletList(env.STANDALONE_ADMIN_WALLETS || env.WALLET_ADMIN_ADDRESSES)
  if (admins.has(key)) return Ranks.ADMIN
  const builders = parseWalletList(env.STANDALONE_BUILDER_WALLETS || env.WALLET_BUILDER_ADDRESSES)
  if (builders.has(key)) return Ranks.BUILDER
  return Ranks.VISITOR
}

function buildUserFromWallet(address, { chainId = null, env = process.env } = {}) {
  const normalized = normalizeAddress(address)
  const name = formatWalletName(normalized)
  return {
    id: `wallet:ethereum:${normalized.toLowerCase()}`,
    name,
    avatar: null,
    walletAddress: normalized,
    wallet: {
      type: 'ethereum',
      address: normalized,
      chain_id: Number.isInteger(chainId) ? chainId : null,
    },
    rank: walletRank(normalized, env),
  }
}

function publicUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar || null,
    wallet_address: user.walletAddress,
    wallet: user.wallet,
  }
}

export function createStandaloneWalletAuthStore({ env = process.env } = {}) {
  const nonces = new Map()
  const sessions = new Map()
  const exchangeTokens = new Map()

  function cleanup() {
    const now = Date.now()
    for (const [key, nonce] of nonces) {
      if (nonce.expiresAtMs <= now) nonces.delete(key)
    }
    for (const [token, session] of sessions) {
      if (session.expiresAtMs <= now) sessions.delete(token)
    }
    for (const [token, exchange] of exchangeTokens) {
      if (exchange.expiresAtMs <= now) exchangeTokens.delete(token)
    }
  }

  function createNonce(address) {
    cleanup()
    const normalized = normalizeAddress(address)
    if (!normalized) throw new Error('invalid_address')
    const nonce = generateNonce()
    nonces.set(normalizeAddressKey(normalized), {
      nonce,
      expiresAtMs: Date.now() + NONCE_TTL_MS,
    })
    return nonce
  }

  async function verifySiwe({ message, signature }) {
    cleanup()
    let siweMessage
    try {
      siweMessage = new SiweMessage(message)
    } catch {
      throw new Error('invalid_siwe_message')
    }

    const address = normalizeAddress(siweMessage.address)
    const expectedNonce = nonces.get(normalizeAddressKey(address))
    if (!expectedNonce || expectedNonce.nonce !== siweMessage.nonce) {
      throw new Error('invalid_nonce')
    }
    const domain = expectedIdentityDomain(env)
    if (domain && siweMessage.domain !== domain) {
      throw new Error('invalid_domain')
    }

    let verified
    try {
      const verification = await siweMessage.verify({ signature })
      verified = verification?.data
    } catch {
      verified = null
    }
    if (!verified) {
      throw new Error('invalid_signature')
    }

    nonces.delete(normalizeAddressKey(address))
    const user = buildUserFromWallet(address, { chainId: siweMessage.chainId, env })
    const token = randomToken()
    const expiresAtMs = Date.now() + SESSION_TTL_MS
    sessions.set(token, {
      token,
      user,
      createdAt: nowIso(),
      expiresAtMs,
    })
    return {
      token,
      expiresAt: new Date(expiresAtMs),
      user,
    }
  }

  function getSession(token) {
    cleanup()
    return hasValue(token) ? sessions.get(token) || null : null
  }

  function destroySession(token) {
    if (hasValue(token)) sessions.delete(token)
  }

  function updateSessionUser(token, patch) {
    const session = getSession(token)
    if (!session) return null
    if (typeof patch?.name === 'string' && patch.name.trim()) {
      session.user.name = patch.name.trim().slice(0, 80)
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'avatar')) {
      session.user.avatar = typeof patch.avatar === 'string' && patch.avatar.trim() ? patch.avatar.trim() : null
    }
    return session
  }

  function createExchangeToken(session) {
    cleanup()
    if (!session?.user?.id) throw new Error('invalid_session')
    const token = randomToken()
    const issuedAt = Math.floor(Date.now() / 1000)
    const expiresAt = issuedAt + Math.floor(EXCHANGE_TTL_MS / 1000)
    const claims = {
      typ: IDENTITY_EXCHANGE_TYP,
      iss: expectedIdentityIssuer(env),
      aud: IDENTITY_EXCHANGE_AUDIENCE,
      sub: session.user.id,
      userId: session.user.id,
      walletAddress: session.user.walletAddress,
      name: session.user.name,
      avatar: session.user.avatar || null,
      rank: session.user.rank,
      iat: issuedAt,
      exp: expiresAt,
    }
    exchangeTokens.set(token, {
      claims,
      expiresAtMs: Date.now() + EXCHANGE_TTL_MS,
    })
    return {
      token,
      claims,
      expiresAt: new Date(expiresAt * 1000),
    }
  }

  function consumeExchangeToken(token) {
    cleanup()
    if (!hasValue(token)) return null
    const exchange = exchangeTokens.get(token)
    if (!exchange) return null
    exchangeTokens.delete(token)
    return exchange.claims
  }

  return {
    createNonce,
    verifySiwe,
    getSession,
    destroySession,
    updateSessionUser,
    createExchangeToken,
    consumeExchangeToken,
  }
}

export function getStandaloneWalletSession(req, store) {
  return store.getSession(readSessionCookie(req))
}

export async function handleStandaloneWalletNonce(req, reply, store) {
  const address = normalizeAddress(req?.body?.address)
  if (!address) return reply.code(400).send({ error: 'invalid_address' })
  const nonce = store.createNonce(address)
  return reply.code(200).send({ nonce })
}

export async function handleStandaloneWalletVerify(req, reply, store, { env = process.env } = {}) {
  const message = typeof req?.body?.message === 'string' ? req.body.message : ''
  const signature = typeof req?.body?.signature === 'string' ? req.body.signature : ''
  if (!message || !signature) {
    return reply.code(400).send({ error: 'invalid_payload' })
  }
  try {
    const session = await store.verifySiwe({ message, signature })
    reply.header('Set-Cookie', serializeCookie(COOKIE_NAME, session.token, {
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
      expires: session.expiresAt,
      env,
    }))
    return reply.code(200).send({ user: publicUserPayload(session.user) })
  } catch (error) {
    return reply.code(401).send({ error: error instanceof Error ? error.message : 'invalid_signature' })
  }
}

export async function handleStandaloneWalletMe(req, reply, store) {
  const session = getStandaloneWalletSession(req, store)
  if (!session) return reply.code(401).send({ error: 'not_authenticated' })
  return reply.code(200).send({ user: publicUserPayload(session.user) })
}

export async function handleStandaloneWalletExchange(req, reply, store) {
  const session = getStandaloneWalletSession(req, store)
  if (!session) return reply.code(401).send({ error: 'not_authenticated' })
  const exchange = store.createExchangeToken(session)
  return reply.code(200).send({
    token: exchange.token,
    token_type: IDENTITY_EXCHANGE_TYP,
    expires_in: Math.floor(EXCHANGE_TTL_MS / 1000),
    expires_at: exchange.expiresAt.toISOString(),
    user: { id: session.user.id },
  })
}

export async function handleStandaloneWalletProfile(req, reply, store) {
  const token = readSessionCookie(req)
  const session = store.updateSessionUser(token, req?.body || {})
  if (!session) return reply.code(401).send({ error: 'not_authenticated' })
  return reply.code(200).send({ user: publicUserPayload(session.user) })
}

export async function handleStandaloneWalletLogout(req, reply, store, { env = process.env } = {}) {
  const token = readSessionCookie(req)
  store.destroySession(token)
  reply.header('Set-Cookie', clearCookie(env))
  return reply.code(200).send({ ok: true })
}
