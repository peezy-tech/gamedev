function normalizeRuntimeUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function deriveHttpUrlFromWsUrl(wsUrl) {
  const normalized = normalizeRuntimeUrl(wsUrl)
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    url.search = ''
    url.hash = ''
    const segments = url.pathname.split('/').filter(Boolean)
    url.pathname = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '/'
    return normalizeRuntimeUrl(url.toString())
  } catch {
    return normalized.replace(/^ws/, 'http').replace(/\/[^/?#]*(?:[?#].*)?$/, '')
  }
}

function searchParamsFrom(value) {
  if (value instanceof URLSearchParams) return value
  return new URLSearchParams(clean(value).replace(/^\?/, ''))
}

function normalizeRuntimeAssignmentPlayerId(value) {
  const playerId = clean(value)
  return playerId && !/[\u0000-\u001f\u007f]/.test(playerId) ? playerId : ''
}

function normalizeEthereumAddress(value) {
  const address = clean(value)
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : ''
}

function normalizeSolanaAddress(value) {
  const address = clean(value)
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : ''
}

function normalizeSessionPlayerId(session) {
  const wallet = session?.user?.wallet
  if (wallet && typeof wallet === 'object') {
    const type = clean(wallet.type).toLowerCase()
    const address = type === 'solana'
      ? normalizeSolanaAddress(wallet.address)
      : normalizeEthereumAddress(wallet.address)
    if (address) return address
  }
  return normalizeEthereumAddress(session?.user?.wallet_address)
    || normalizeRuntimeAssignmentPlayerId(session?.user?.id)
}

function normalizeWalletBridgePlayerId(walletSnapshot) {
  const wallets = Array.isArray(walletSnapshot?.wallets) ? walletSnapshot.wallets : []
  for (const wallet of wallets) {
    const address = normalizeEthereumAddress(wallet?.address)
    if (address) return address
  }
  return ''
}

function normalizeWalletLikePlayerId(value) {
  return normalizeEthereumAddress(value)
    || normalizeSolanaAddress(value)
    || normalizeRuntimeAssignmentPlayerId(value)
}

export function resolveRuntimeAssignmentPlayerId({
  env = {},
  search = '',
  session = null,
  walletSnapshot = null,
  ethereumAccounts = [],
  solanaAddress = '',
} = {}) {
  const params = searchParamsFrom(search)
  return normalizeRuntimeAssignmentPlayerId(env.PUBLIC_RUNTIME_PLAYER_ID)
    || normalizeRuntimeAssignmentPlayerId(params.get('playerId'))
    || normalizeRuntimeAssignmentPlayerId(params.get('player'))
    || normalizeWalletLikePlayerId(params.get('wallet'))
    || normalizeWalletLikePlayerId(params.get('address'))
    || normalizeSessionPlayerId(session)
    || normalizeWalletBridgePlayerId(walletSnapshot)
    || normalizeEthereumAddress(Array.isArray(ethereumAccounts) ? ethereumAccounts[0] : '')
    || normalizeSolanaAddress(solanaAddress)
}

export function buildRuntimeAssignmentRequestBody({
  env = {},
  search = '',
  session = null,
  walletSnapshot = null,
  ethereumAccounts = [],
  solanaAddress = '',
} = {}) {
  const params = searchParamsFrom(search)
  const matchKey = normalizeRuntimeUrl(env.PUBLIC_RUNTIME_MATCH_KEY || params.get('matchKey') || params.get('match'))
  const preferredRegion = normalizeRuntimeUrl(env.PUBLIC_RUNTIME_REGION || params.get('region'))
  const mode = normalizeRuntimeUrl(env.PUBLIC_RUNTIME_ASSIGNMENT_MODE) || (matchKey ? 'match' : 'pool')
  const playerId = resolveRuntimeAssignmentPlayerId({
    env,
    search: params,
    session,
    walletSnapshot,
    ethereumAccounts,
    solanaAddress,
  })
  const body = { mode }
  if (matchKey) body.matchKey = matchKey
  if (preferredRegion) body.preferredRegion = preferredRegion
  if (playerId) body.player = { id: playerId }
  return body
}

function normalizeConnectionResult(connection) {
  if (connection && typeof connection === 'object') {
    return {
      wsUrl: normalizeRuntimeUrl(connection.wsUrl || connection.url),
      apiUrl: normalizeRuntimeUrl(connection.apiUrl),
      authUrl: normalizeRuntimeUrl(connection.authUrl),
    }
  }
  return {
    wsUrl: normalizeRuntimeUrl(connection),
    apiUrl: '',
    authUrl: '',
  }
}

export function resolveClientConnectionConfig({ connection, apiUrl, authUrl }) {
  const resolved = normalizeConnectionResult(connection)
  const fallbackApiUrl = normalizeRuntimeUrl(apiUrl)
  const fallbackAuthUrl = normalizeRuntimeUrl(authUrl)
  return {
    wsUrl: resolved.wsUrl,
    apiUrl: resolved.apiUrl || fallbackApiUrl || deriveHttpUrlFromWsUrl(resolved.wsUrl),
    authUrl: resolved.authUrl || fallbackAuthUrl || null,
  }
}
