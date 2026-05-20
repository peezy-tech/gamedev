import 'dotenv-flow/config'

const allowPlaceholders = process.argv.includes('--allow-placeholders')
const runtimeKinds = new Set(['external-authoritative', 'authoritative-session'])
const imageDigestPattern = /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/i
const dbSchemaPattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const regionPattern = /^[a-z][a-z0-9-]{0,31}$/
const reservedManagedRuntimeEnv = new Set([
  'PORT',
  'DIRECT_WSS_PORT',
  'AGONES_SDK_HTTP_PORT',
  'RUNTIME_BOOTSTRAP_AUTH_SECRET',
  'RUNTIME_BOOTSTRAP_INSTANCE_ID',
])

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isTruthy(value) {
  const normalized = clean(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function parseUrl(value, name, { protocol, allowHttp = false } = {}) {
  const raw = clean(value).replace(/\/+$/, '')
  if (!raw) return { error: `${name} is required` }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { error: `${name} must be a valid URL` }
  }
  if (protocol && parsed.protocol !== protocol) {
    return { error: `${name} must use ${protocol}` }
  }
  if (!allowHttp && parsed.protocol === 'http:') {
    return { error: `${name} must use https:` }
  }
  return { value: raw, parsed }
}

function parseOrigin(value, name, options) {
  const result = parseUrl(value, name, options)
  if (result.error) return result
  const { parsed } = result
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash || parsed.username || parsed.password) {
    return { error: `${name} must be an origin without path, query, hash, or credentials` }
  }
  return {
    value: parsed.origin,
    parsed,
  }
}

function looksPlaceholder(value) {
  const normalized = clean(value).toLowerCase()
  return (
    !normalized ||
    normalized.includes('change-me') ||
    normalized.includes('example') ||
    normalized.includes('test-secret') ||
    normalized === 'secret' ||
    normalized === 'asset-key'
  )
}

function splitList(value) {
  return clean(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parsePositiveInteger(value, name, errors) {
  const normalized = clean(value)
  if (!normalized) return null
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${name} must be a positive integer`)
    return null
  }
  return parsed
}

function parseJsonObject(value, name, errors) {
  const normalized = clean(value)
  if (!normalized) return {}
  try {
    const parsed = JSON.parse(normalized)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`${name} must be a JSON object`)
      return {}
    }
    return parsed
  } catch {
    errors.push(`${name} must be valid JSON`)
    return {}
  }
}

function parseJsonArray(value, name, errors) {
  const normalized = clean(value)
  if (!normalized) return []
  try {
    const parsed = JSON.parse(normalized)
    if (!Array.isArray(parsed)) {
      errors.push(`${name} must be a JSON array`)
      return []
    }
    return parsed
  } catch {
    errors.push(`${name} must be valid JSON`)
    return []
  }
}

function deriveRuntimeBase(apiUrl) {
  return clean(apiUrl).replace(/\/api\/?$/, '').replace(/\/+$/, '')
}

function secretEnvNames(secretEnv) {
  const names = new Set()
  for (const entry of secretEnv) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const name = clean(entry.name)
    if (name) names.add(name)
  }
  return names
}

function validateSecretEnv(secretEnv, errors) {
  for (const entry of secretEnv) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push('GAME_PROTOCOL_RUNTIME_SECRET_ENV entries must be objects')
      continue
    }
    if (!clean(entry.name)) errors.push('GAME_PROTOCOL_RUNTIME_SECRET_ENV entry name is required')
    if (!clean(entry.secretName)) errors.push(`GAME_PROTOCOL_RUNTIME_SECRET_ENV ${clean(entry.name) || '<unnamed>'} secretName is required`)
    if (!clean(entry.secretKey)) errors.push(`GAME_PROTOCOL_RUNTIME_SECRET_ENV ${clean(entry.name) || '<unnamed>'} secretKey is required`)
  }
}

function validateAuthoritativeSessionEnv(env, errors, warnings) {
  const image = clean(env.GAME_PROTOCOL_RUNTIME_IMAGE)
  if (!imageDigestPattern.test(image)) {
    errors.push('GAME_PROTOCOL_RUNTIME_IMAGE must be an immutable image digest')
  }
  if (!allowPlaceholders && /^(.+)@sha256:([a-f0-9])\2{63}$/i.test(image)) {
    errors.push('GAME_PROTOCOL_RUNTIME_IMAGE must use a real published image digest')
  }

  parsePositiveInteger(env.GAME_PROTOCOL_RUNTIME_PORT || '3000', 'GAME_PROTOCOL_RUNTIME_PORT', errors)
  parsePositiveInteger(env.GAME_PROTOCOL_RUNTIME_CAPACITY, 'GAME_PROTOCOL_RUNTIME_CAPACITY', errors)

  const protocol = clean(env.GAME_PROTOCOL_RUNTIME_PROTOCOL || 'wss')
  if (protocol !== 'ws' && protocol !== 'wss') {
    errors.push('GAME_PROTOCOL_RUNTIME_PROTOCOL must be ws or wss')
  }

  const regions = splitList(env.GAME_PROTOCOL_RUNTIME_REGIONS)
  if (!regions.length) {
    errors.push('GAME_PROTOCOL_RUNTIME_REGIONS must include at least one region')
  }
  for (const region of regions) {
    if (!regionPattern.test(region)) {
      errors.push(`GAME_PROTOCOL_RUNTIME_REGIONS contains an invalid region: ${region}`)
    }
  }

  const bootstrapMode = clean(env.GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE || env.GAME_PROTOCOL_RUNTIME_BOOTSTRAP)
  if (bootstrapMode !== 'push') {
    errors.push('GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE=push is required for authoritative-session launches')
  }
  if (!clean(env.GAME_PROTOCOL_RUNTIME_WORLD_ID || env.WORLD_ID)) {
    errors.push('GAME_PROTOCOL_RUNTIME_WORLD_ID is required')
  }
  if (!clean(env.GAME_PROTOCOL_RUNTIME_WORLD_SLUG)) {
    errors.push('GAME_PROTOCOL_RUNTIME_WORLD_SLUG is required')
  }
  if (!clean(env.GAME_PROTOCOL_RUNTIME_DB_SCHEMA)) {
    errors.push('GAME_PROTOCOL_RUNTIME_DB_SCHEMA is required')
  } else if (!dbSchemaPattern.test(clean(env.GAME_PROTOCOL_RUNTIME_DB_SCHEMA))) {
    errors.push('GAME_PROTOCOL_RUNTIME_DB_SCHEMA must be a valid database schema identifier')
  }

  if (!isTruthy(env.PUBLIC_REQUIRE_WALLET_AUTH)) {
    errors.push('PUBLIC_REQUIRE_WALLET_AUTH=true is required')
  }
  const staticApi = parseUrl(env.PUBLIC_API_URL, 'PUBLIC_API_URL', { protocol: 'https:' })
  if (staticApi.error) errors.push(staticApi.error)

  const serverEnv = parseJsonObject(env.GAME_PROTOCOL_RUNTIME_ENV, 'GAME_PROTOCOL_RUNTIME_ENV', errors)
  for (const name of Object.keys(serverEnv)) {
    if (reservedManagedRuntimeEnv.has(name) || name.startsWith('RUNTIME_CONTROL_')) {
      errors.push(`GAME_PROTOCOL_RUNTIME_ENV.${name} is managed by runtime-control`)
    }
  }
  if (!isTruthy(serverEnv.STANDALONE_WALLET_AUTH)) {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV.STANDALONE_WALLET_AUTH=true is required')
  }
  if (clean(serverEnv.REQUIRE_WALLET_AUTH).toLowerCase() === 'false') {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV.REQUIRE_WALLET_AUTH=false is not allowed for the launch profile')
  }
  if (!isTruthy(serverEnv.PUBLIC_REQUIRE_WALLET_AUTH)) {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV.PUBLIC_REQUIRE_WALLET_AUTH=true is required')
  }
  if (clean(serverEnv.PUBLIC_API_URL) || clean(serverEnv.PUBLIC_WS_URL) || clean(serverEnv.PUBLIC_AUTH_URL) || clean(serverEnv.PUBLIC_ADMIN_URL)) {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV must not hardcode PUBLIC_API_URL, PUBLIC_WS_URL, PUBLIC_AUTH_URL, or PUBLIC_ADMIN_URL; runtime-control injects assigned endpoints during push bootstrap')
  }
  const assetsMode = clean(serverEnv.ASSETS)
  if (!assetsMode) {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV.ASSETS is required')
  } else if (assetsMode !== 's3' && assetsMode !== 'asset-service') {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV.ASSETS must be s3 or asset-service')
  }
  const assetsBase = parseUrl(serverEnv.ASSETS_BASE_URL, 'GAME_PROTOCOL_RUNTIME_ENV.ASSETS_BASE_URL', { protocol: 'https:' })
  if (assetsBase.error) errors.push(assetsBase.error)
  if (serverEnv.HYPERLIQUID_DATA_URL) {
    const dataUrl = parseUrl(serverEnv.HYPERLIQUID_DATA_URL, 'GAME_PROTOCOL_RUNTIME_ENV.HYPERLIQUID_DATA_URL', { protocol: 'https:' })
    if (dataUrl.error) errors.push(dataUrl.error)
  }
  const corsOrigins = splitList(serverEnv.CORS_ORIGINS)
  if (!corsOrigins.length) {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV.CORS_ORIGINS must include the game-trove public origin')
  }
  for (const origin of corsOrigins) {
    const parsed = parseOrigin(origin, 'GAME_PROTOCOL_RUNTIME_ENV.CORS_ORIGINS origin', { protocol: 'https:' })
    if (parsed.error) errors.push(`${parsed.error}: ${origin}`)
  }
  if (!allowPlaceholders && corsOrigins.some(looksPlaceholder)) {
    errors.push('GAME_PROTOCOL_RUNTIME_ENV.CORS_ORIGINS must use real game-trove origins')
  }

  const secretEnv = parseJsonArray(env.GAME_PROTOCOL_RUNTIME_SECRET_ENV, 'GAME_PROTOCOL_RUNTIME_SECRET_ENV', errors)
  validateSecretEnv(secretEnv, errors)
  const names = secretEnvNames(secretEnv)
  for (const required of ['DB_URI', 'JWT_SECRET', 'STANDALONE_ADMIN_WALLETS']) {
    if (!names.has(required)) {
      errors.push(`GAME_PROTOCOL_RUNTIME_SECRET_ENV must include ${required}`)
    }
  }
  if (assetsMode === 's3' && !names.has('ASSETS_S3_URI')) {
    errors.push('GAME_PROTOCOL_RUNTIME_SECRET_ENV must include ASSETS_S3_URI when GAME_PROTOCOL_RUNTIME_ENV.ASSETS=s3')
  }
  if (assetsMode === 'asset-service' && !names.has('ASSET_SERVICE_API_KEY')) {
    errors.push('GAME_PROTOCOL_RUNTIME_SECRET_ENV must include ASSET_SERVICE_API_KEY when GAME_PROTOCOL_RUNTIME_ENV.ASSETS=asset-service')
  }

  const kubernetes = parseJsonObject(env.GAME_PROTOCOL_RUNTIME_KUBERNETES, 'GAME_PROTOCOL_RUNTIME_KUBERNETES', errors)
  if (protocol === 'wss' && !clean(kubernetes.tlsSecret?.name)) {
    errors.push('GAME_PROTOCOL_RUNTIME_KUBERNETES.tlsSecret.name is required for wss runtimes')
  }
  const imagePullSecrets = Array.isArray(kubernetes.imagePullSecrets)
    ? kubernetes.imagePullSecrets.map(clean).filter(Boolean)
    : []
  if (!imagePullSecrets.length) {
    errors.push('GAME_PROTOCOL_RUNTIME_KUBERNETES.imagePullSecrets must include ghcr-secret')
  } else if (!imagePullSecrets.includes('ghcr-secret')) {
    errors.push('GAME_PROTOCOL_RUNTIME_KUBERNETES.imagePullSecrets must include ghcr-secret')
  }
  if (!kubernetes.nodeSelector || typeof kubernetes.nodeSelector !== 'object' || Array.isArray(kubernetes.nodeSelector)) {
    errors.push('GAME_PROTOCOL_RUNTIME_KUBERNETES.nodeSelector must target GameServer nodes with lobby/pool=gs')
  } else if (clean(kubernetes.nodeSelector['lobby/pool']) !== 'gs') {
    errors.push('GAME_PROTOCOL_RUNTIME_KUBERNETES.nodeSelector must target GameServer nodes with lobby/pool=gs')
  }
}

function validate() {
  const errors = []
  const warnings = []
  const env = process.env
  const runtimeKind = clean(env.GAME_PROTOCOL_RUNTIME_KIND || 'external-authoritative')

  if (!runtimeKinds.has(runtimeKind)) {
    errors.push(`GAME_PROTOCOL_RUNTIME_KIND must be one of: ${Array.from(runtimeKinds).join(', ')}`)
    return { errors, warnings }
  }

  if (runtimeKind === 'authoritative-session') {
    validateAuthoritativeSessionEnv(env, errors, warnings)
    return { errors, warnings }
  }

  if (!isTruthy(env.STANDALONE_WALLET_AUTH) && clean(env.AUTH_IDENTITY_MODE) !== 'standalone-wallet') {
    errors.push('STANDALONE_WALLET_AUTH=true or AUTH_IDENTITY_MODE=standalone-wallet is required')
  }
  if (clean(env.REQUIRE_WALLET_AUTH).toLowerCase() === 'false') {
    errors.push('REQUIRE_WALLET_AUTH=false is not allowed for the launch profile')
  }
  if (!isTruthy(env.PUBLIC_REQUIRE_WALLET_AUTH)) {
    errors.push('PUBLIC_REQUIRE_WALLET_AUTH=true is required')
  }
  if (clean(env.ASSETS) !== 'asset-service') {
    errors.push('ASSETS=asset-service is required')
  }
  if (!clean(env.WORLD_ID)) {
    errors.push('WORLD_ID is required')
  }
  if (!clean(env.PORT)) {
    warnings.push('PORT is not set; runtime will use its default')
  }

  const api = parseUrl(env.PUBLIC_API_URL, 'PUBLIC_API_URL', { protocol: 'https:' })
  if (api.error) errors.push(api.error)

  const ws = parseUrl(env.PUBLIC_WS_URL, 'PUBLIC_WS_URL', { protocol: 'wss:' })
  if (ws.error) errors.push(ws.error)

  const auth = parseUrl(env.PUBLIC_AUTH_URL, 'PUBLIC_AUTH_URL', { protocol: 'https:' })
  if (auth.error) errors.push(auth.error)

  const assetService = parseUrl(env.ASSET_SERVICE_URL, 'ASSET_SERVICE_URL', { allowHttp: true })
  if (assetService.error) errors.push(assetService.error)

  const runtimeBase = api.value ? deriveRuntimeBase(api.value) : ''
  const expectedAssetsBase = runtimeBase ? `${runtimeBase}/assets` : ''
  const assetsBase = parseUrl(env.ASSETS_BASE_URL || expectedAssetsBase, 'ASSETS_BASE_URL', { protocol: 'https:' })
  if (assetsBase.error) errors.push(assetsBase.error)
  if (assetsBase.value && expectedAssetsBase && assetsBase.value !== expectedAssetsBase) {
    errors.push(`ASSETS_BASE_URL must stay on the runtime asset bridge (${expectedAssetsBase})`)
  }

  const health = parseUrl(env.GAME_PROTOCOL_HEALTH_URL || (runtimeBase ? `${runtimeBase}/health` : ''), 'GAME_PROTOCOL_HEALTH_URL', { protocol: 'https:' })
  if (health.error) errors.push(health.error)

  const corsOrigins = splitList(env.CORS_ORIGINS || env.PUBLIC_CLIENT_ORIGINS)
  if (!corsOrigins.length) {
    errors.push('CORS_ORIGINS or PUBLIC_CLIENT_ORIGINS must include the game-trove public origin')
  }
  for (const origin of corsOrigins) {
    const parsed = parseOrigin(origin, 'CORS origin', { protocol: 'https:' })
    if (parsed.error) errors.push(`${parsed.error}: ${origin}`)
  }

  const adminWallets = splitList(env.STANDALONE_ADMIN_WALLETS || env.WALLET_ADMIN_ADDRESSES)
  if (!adminWallets.length) {
    errors.push('STANDALONE_ADMIN_WALLETS or WALLET_ADMIN_ADDRESSES must include at least one launch admin wallet')
  }
  for (const wallet of adminWallets) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      errors.push(`Invalid Ethereum admin wallet address: ${wallet}`)
    }
  }

  if (clean(env.GAME_PROTOCOL_STATE_MODE) && !new Set(['none', 'database', 'onchain', 'hybrid']).has(clean(env.GAME_PROTOCOL_STATE_MODE))) {
    errors.push('GAME_PROTOCOL_STATE_MODE must be one of: none, database, onchain, hybrid')
  }

  if (!allowPlaceholders) {
    if (looksPlaceholder(env.JWT_SECRET) || clean(env.JWT_SECRET).length < 24) {
      errors.push('JWT_SECRET must be a real high-entropy secret')
    }
    if (looksPlaceholder(env.ASSET_SERVICE_API_KEY)) {
      errors.push('ASSET_SERVICE_API_KEY must be a real secret')
    }
    if (api.value && looksPlaceholder(api.value)) {
      errors.push('PUBLIC_API_URL must be the real runtime API origin')
    }
    if (corsOrigins.some(looksPlaceholder)) {
      errors.push('CORS_ORIGINS must use real game-trove origins')
    }
  }

  return { errors, warnings }
}

const { errors, warnings } = validate()

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`)
}

if (errors.length) {
  console.error('Game Protocol launch env is invalid:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Game Protocol launch env is valid')
