import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Wallet } from 'ethers'

import { DirectAppServer } from '../app-server/direct.js'

const DEFAULT_CHAIN_ID = 42161

function clean(value, fallback = '') {
  return (value || fallback).trim()
}

function requiredEnv(env, name) {
  const value = clean(env[name])
  if (!value) throw new Error(`${name} is required`)
  return value
}

function normalizeBaseUrl(value) {
  return clean(value).replace(/\/+$/, '')
}

function joinUrl(base, suffix) {
  const normalizedBase = normalizeBaseUrl(base)
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`
  return `${normalizedBase}${normalizedSuffix}`
}

function parseList(value, fallback = []) {
  const raw = clean(value)
  if (!raw) return fallback
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function defaultAuthUrl(worldUrl) {
  return joinUrl(worldUrl, '/api/auth/identity')
}

function defaultApiUrl(worldUrl) {
  return joinUrl(worldUrl, '/api')
}

export function cookieHeaderFromSetCookie(value) {
  const raw = typeof value === 'string' ? value : ''
  const match = raw.match(/(?:^|,\s*)gamedev_wallet_session=([^;,]+)/)
  if (!match) return ''
  return `gamedev_wallet_session=${match[1]}`
}

export function buildSiweMessage({ domain, address, uri, chainId, nonce, issuedAt = new Date().toISOString() }) {
  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in with Ethereum

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}`
}

export function loadSmokeConfig(env = process.env) {
  const worldUrl = normalizeBaseUrl(requiredEnv(env, 'WORLD_URL'))
  const worldId = requiredEnv(env, 'WORLD_ID')
  const projectDir = path.resolve(requiredEnv(env, 'WORLD_IMPORT_PROJECT_DIR'))
  const privateKey = requiredEnv(env, 'WORLD_IMPORT_ADMIN_PRIVATE_KEY')
  const authUrl = normalizeBaseUrl(clean(env.WORLD_IMPORT_AUTH_URL, defaultAuthUrl(worldUrl)))
  const apiUrl = normalizeBaseUrl(clean(env.WORLD_IMPORT_API_URL, defaultApiUrl(worldUrl)))
  const chainId = Number.parseInt(clean(env.WORLD_IMPORT_CHAIN_ID, String(DEFAULT_CHAIN_ID)), 10)
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('WORLD_IMPORT_CHAIN_ID must be a positive integer')
  }
  return {
    worldUrl,
    worldId,
    projectDir,
    privateKey,
    authUrl,
    apiUrl,
    chainId,
    expectedBlueprints: parseList(env.WORLD_IMPORT_EXPECT_BLUEPRINTS, ['$scene', 'tycoon']),
    expectedEntities: parseList(env.WORLD_IMPORT_EXPECT_ENTITIES, ['tradeScene', 'd12UKcWyDG']),
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body ?? { error: response.statusText })}`)
  }
  return { response, body }
}

export async function authenticateStandaloneAdminWallet(config) {
  const wallet = new Wallet(config.privateKey)
  const nonceResult = await requestJson(joinUrl(config.authUrl, '/nonce'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address }),
  })
  const nonce = clean(nonceResult.body?.nonce)
  if (!nonce) throw new Error('standalone wallet nonce response is missing nonce')

  const domain = new URL(config.authUrl).hostname
  const message = buildSiweMessage({
    domain,
    address: wallet.address,
    uri: config.authUrl,
    chainId: config.chainId,
    nonce,
  })
  const signature = await wallet.signMessage(message)
  const verifyResult = await requestJson(joinUrl(config.authUrl, '/verify'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  })
  const cookie = cookieHeaderFromSetCookie(verifyResult.response.headers.get('set-cookie'))
  if (!cookie) throw new Error('standalone wallet verify response is missing session cookie')

  const exchangeResult = await requestJson(joinUrl(config.authUrl, '/exchange'), {
    method: 'POST',
    headers: { cookie },
  })
  const identityToken = clean(exchangeResult.body?.token)
  if (!identityToken) throw new Error('standalone wallet exchange response is missing token')

  const runtimeResult = await requestJson(joinUrl(config.apiUrl, '/auth/exchange'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: identityToken }),
  })
  const runtimeToken = clean(runtimeResult.body?.token)
  if (!runtimeToken) throw new Error('runtime auth exchange response is missing token')

  const statusResult = await requestJson(joinUrl(config.apiUrl, '/auth/cli/status'), {
    headers: { authorization: `Bearer ${runtimeToken}` },
  })
  if (!statusResult.body?.capabilities?.deploy) {
    throw new Error('standalone wallet auth did not return deploy capability')
  }

  return {
    authToken: runtimeToken,
    walletAddress: wallet.address,
    status: statusResult.body,
  }
}

export async function flushAdminState(config, authToken) {
  await requestJson(joinUrl(config.worldUrl, '/admin/clean'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ dryrun: true }),
  })
}

function assertProjectReadable(projectDir) {
  const worldPath = path.join(projectDir, 'world.json')
  if (!fs.existsSync(worldPath)) throw new Error(`world.json is missing in ${projectDir}`)
  const appsPath = path.join(projectDir, 'apps')
  if (!fs.existsSync(appsPath)) throw new Error(`apps directory is missing in ${projectDir}`)
}

export function assertImportedSnapshot(snapshot, config) {
  if (snapshot?.worldId !== config.worldId) {
    throw new Error(`snapshot worldId mismatch: expected ${config.worldId}, got ${snapshot?.worldId || 'missing'}`)
  }
  const blueprints = Array.isArray(snapshot.blueprints) ? snapshot.blueprints : []
  const entities = Array.isArray(snapshot.entities) ? snapshot.entities : []
  const blueprintIds = new Set(blueprints.map(blueprint => blueprint?.id).filter(Boolean))
  const entityIds = new Set(entities.map(entity => entity?.id || entity?.data?.id).filter(Boolean))

  for (const id of config.expectedBlueprints) {
    if (!blueprintIds.has(id)) throw new Error(`imported snapshot is missing blueprint ${id}`)
  }
  for (const id of config.expectedEntities) {
    if (!entityIds.has(id)) throw new Error(`imported snapshot is missing entity ${id}`)
  }
  return {
    blueprintCount: blueprints.length,
    entityCount: entities.length,
  }
}

export async function runLocalWorldImportSmoke(config = loadSmokeConfig()) {
  assertProjectReadable(config.projectDir)
  const auth = await authenticateStandaloneAdminWallet(config)
  const server = new DirectAppServer({
    worldUrl: config.worldUrl,
    worldId: config.worldId,
    authToken: auth.authToken,
    rootDir: config.projectDir,
  })
  try {
    await server.connect()
    await server.importWorldFromDisk()
    await flushAdminState(config, auth.authToken)
    const snapshot = await server.client.getSnapshot()
    const imported = assertImportedSnapshot(snapshot, config)
    return {
      ok: true,
      worldUrl: config.worldUrl,
      worldId: config.worldId,
      walletAddress: auth.walletAddress,
      capabilities: auth.status.capabilities,
      imported,
    }
  } finally {
    try {
      server.client?.ws?.close()
    } catch {}
  }
}

async function main() {
  const result = await runLocalWorldImportSmoke()
  console.log(JSON.stringify(result, null, 2))
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main()
}
