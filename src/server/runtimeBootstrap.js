import path from 'path'

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function hasValue(value) {
  return normalizeString(value).length > 0
}

export function usesHostedRuntimeBootstrap(env = process.env) {
  return hasValue(env.RUNTIME_BOOTSTRAP_URL)
}

export function resolveHostedRuntimeBootstrapUrl(env = process.env) {
  const url = normalizePublicUrl(env.RUNTIME_BOOTSTRAP_URL)
  return url || null
}

export function derivePublicWsUrlFromApiUrl(apiUrl) {
  const value = normalizeString(apiUrl)
  if (!value) return null
  return value
    .replace(/\/api\/?$/, '/ws')
    .replace(/^http:/, 'ws:')
    .replace(/^https:/, 'wss:')
}

function normalizePublicUrl(value) {
  return normalizeString(value).replace(/\/+$/, '')
}

function parseNonNegativeInteger(value) {
  const normalized = typeof value === 'string' ? value.trim() : value
  if (typeof normalized === 'number' && Number.isFinite(normalized) && normalized >= 0) {
    return Math.floor(normalized)
  }
  if (typeof normalized !== 'string' || !normalized) return null
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function sanitizeWorldPathSegment(value, fallback = 'world') {
  const normalized = normalizeString(value).replace(/[^A-Za-z0-9._-]+/g, '_')
  return normalized || fallback
}

function buildHostedWorldRelativePath({ worldSlug, worldId }) {
  return path.join('.runtime-worlds', sanitizeWorldPathSegment(worldSlug || worldId, 'world'))
}

export function applyHostedRuntimeBootstrapPayload(env = process.env, payload = null) {
  const appliedKeys = []
  const worldId = normalizeString(payload?.world?.id)
  const worldSlug = normalizeString(payload?.world?.slug)
  const dbSchema = normalizeString(payload?.world?.dbSchema)
  const runtimeApiUrl = normalizePublicUrl(payload?.runtime?.publicApiUrl)
  const runtimeWsUrlRaw = normalizePublicUrl(payload?.runtime?.publicWsUrl)
  const authUrl = normalizePublicUrl(payload?.auth?.publicAuthUrl)
  const privyAppId = normalizeString(payload?.auth?.publicPrivyAppId)

  const publicMaxUploadSize = parseNonNegativeInteger(payload?.world?.publicMaxUploadSize)
  const publicWorldMaxPlayers = parseNonNegativeInteger(payload?.world?.publicWorldMaxPlayers)
  const shutdownIdleSeconds = parseNonNegativeInteger(payload?.world?.shutdownIdleSeconds)

  if (worldId) {
    env.WORLD_ID = worldId
    appliedKeys.push('WORLD_ID')
  }

  if (!hasValue(env.WORLD) && (worldSlug || worldId)) {
    env.WORLD = buildHostedWorldRelativePath({ worldSlug, worldId })
    appliedKeys.push('WORLD')
  }

  if (dbSchema) {
    env.DB_SCHEMA = dbSchema
    appliedKeys.push('DB_SCHEMA')
  }

  if (publicMaxUploadSize !== null) {
    env.PUBLIC_MAX_UPLOAD_SIZE = String(publicMaxUploadSize)
    appliedKeys.push('PUBLIC_MAX_UPLOAD_SIZE')
  }

  if (publicWorldMaxPlayers !== null) {
    env.PUBLIC_WORLD_MAX_PLAYERS = String(publicWorldMaxPlayers)
    appliedKeys.push('PUBLIC_WORLD_MAX_PLAYERS')
  }

  if (shutdownIdleSeconds !== null) {
    env.SHUTDOWN_IDLE = String(shutdownIdleSeconds)
    appliedKeys.push('SHUTDOWN_IDLE')
  }

  if (runtimeApiUrl) {
    env.PUBLIC_API_URL = runtimeApiUrl
    appliedKeys.push('PUBLIC_API_URL')
  }

  const runtimeWsUrl = runtimeWsUrlRaw || (runtimeApiUrl ? derivePublicWsUrlFromApiUrl(runtimeApiUrl) || '' : '')
  if (runtimeWsUrl && runtimeWsUrl.startsWith('ws')) {
    env.PUBLIC_WS_URL = runtimeWsUrl
    appliedKeys.push('PUBLIC_WS_URL')
  }

  if (authUrl) {
    env.PUBLIC_AUTH_URL = authUrl
    appliedKeys.push('PUBLIC_AUTH_URL')
  }

  if (privyAppId) {
    env.PUBLIC_PRIVY_APP_ID = privyAppId
    appliedKeys.push('PUBLIC_PRIVY_APP_ID')
  }

  return appliedKeys
}

export function resolveRuntimeWorldDir(env = process.env, cwd = process.cwd()) {
  const worldPath = hasValue(env.WORLD)
    ? normalizeString(env.WORLD)
    : buildHostedWorldRelativePath({
        worldSlug: normalizeString(env.WORLD),
        worldId: normalizeString(env.WORLD_ID),
      })
  return path.resolve(cwd, worldPath)
}
