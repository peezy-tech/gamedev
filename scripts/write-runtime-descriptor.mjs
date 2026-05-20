import 'dotenv-flow/config'
import fs from 'fs-extra'
import path from 'path'

const outPath = process.env.GAME_PROTOCOL_RUNTIME_DESCRIPTOR || path.join('build', 'static', 'runtime.json')
const stateModes = new Set(['none', 'database', 'onchain', 'hybrid'])
const runtimeKinds = new Set(['external-authoritative', 'authoritative-session'])
const imageDigestPattern = /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/i
const regionPattern = /^[a-z][a-z0-9-]{0,31}$/
const dbSchemaPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function derivePublicWsUrl(publicApiUrl) {
  if (!hasValue(publicApiUrl)) return ''
  const normalized = publicApiUrl.replace(/\/+$/, '')
  if (normalized.endsWith('/api')) {
    return normalized.replace(/\/api$/, '/ws').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  }
  return normalized.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

function deriveBaseUrl(publicApiUrl) {
  if (!hasValue(publicApiUrl)) return ''
  return publicApiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '')
}

function requireUrl(value, name, pattern = /^https?:\/\//i) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!normalized || !pattern.test(normalized)) {
    throw new Error(`${name} is required`)
  }
  return normalized
}

function optionalUrl(value, pattern = /^https?:\/\//i) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!normalized) return null
  if (!pattern.test(normalized)) throw new Error(`Invalid URL: ${normalized}`)
  return normalized
}

function optionalString(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || fallback
}

function requiredString(value, name) {
  const normalized = optionalString(value)
  if (!normalized) {
    throw new Error(`${name} is required`)
  }
  return normalized
}

function requiredDbSchema(value, name) {
  const schema = requiredString(value, name)
  if (!dbSchemaPattern.test(schema)) {
    throw new Error(`${name} must be a valid database schema identifier`)
  }
  return schema
}

function positiveInteger(value, name, fallback) {
  const normalized = optionalString(value)
  if (!normalized) return fallback
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function nonNegativeInteger(value, name) {
  const normalized = optionalString(value)
  if (!normalized) return undefined
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return parsed
}

function commaList(value) {
  return optionalString(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function requiredRegionList(value, name) {
  const regions = commaList(value)
  if (!regions.length) {
    throw new Error(`${name} must include at least one region`)
  }
  for (const region of regions) {
    if (!regionPattern.test(region)) {
      throw new Error(`${name} contains an invalid region: ${region}`)
    }
  }
  return regions
}

function jsonObject(value, name) {
  const normalized = optionalString(value)
  if (!normalized) return undefined
  const parsed = JSON.parse(normalized)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return parsed
}

function jsonArray(value, name) {
  const normalized = optionalString(value)
  if (!normalized) return undefined
  const parsed = JSON.parse(normalized)
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array`)
  }
  return parsed
}

const stateMode = process.env.GAME_PROTOCOL_STATE_MODE || 'database'

if (!stateModes.has(stateMode)) {
  throw new Error(`GAME_PROTOCOL_STATE_MODE must be one of: ${Array.from(stateModes).join(', ')}`)
}

const runtimeKind = optionalString(process.env.GAME_PROTOCOL_RUNTIME_KIND, 'external-authoritative')
if (!runtimeKinds.has(runtimeKind)) {
  throw new Error(`GAME_PROTOCOL_RUNTIME_KIND must be one of: ${Array.from(runtimeKinds).join(', ')}`)
}

function externalAuthoritativeDescriptor() {
  const apiUrl = requireUrl(process.env.PUBLIC_API_URL, 'PUBLIC_API_URL')
  const wsUrl = requireUrl(process.env.PUBLIC_WS_URL || derivePublicWsUrl(apiUrl), 'PUBLIC_WS_URL', /^wss?:\/\//i)
  const baseUrl = deriveBaseUrl(apiUrl)
  const healthUrl = requireUrl(process.env.GAME_PROTOCOL_HEALTH_URL || `${baseUrl}/health`, 'GAME_PROTOCOL_HEALTH_URL')
  const authUrl = optionalUrl(process.env.PUBLIC_AUTH_URL)
  const assetsBaseUrl = optionalUrl(process.env.ASSETS_BASE_URL || `${baseUrl}/assets`)
  return {
    kind: 'external-authoritative',
    endpoints: {
      apiUrl,
      wsUrl,
      healthUrl,
      ...(authUrl ? { authUrl } : {}),
      ...(assetsBaseUrl ? { assetsBaseUrl } : {}),
    },
    state: {
      mode: stateMode,
    },
  }
}

function authoritativeSessionDescriptor() {
  const image = optionalString(process.env.GAME_PROTOCOL_RUNTIME_IMAGE)
  if (!imageDigestPattern.test(image)) {
    throw new Error('GAME_PROTOCOL_RUNTIME_IMAGE must be an immutable image digest')
  }
  const protocol = optionalString(process.env.GAME_PROTOCOL_RUNTIME_PROTOCOL, 'wss')
  if (protocol !== 'ws' && protocol !== 'wss') {
    throw new Error('GAME_PROTOCOL_RUNTIME_PROTOCOL must be ws or wss')
  }
  const env = jsonObject(process.env.GAME_PROTOCOL_RUNTIME_ENV, 'GAME_PROTOCOL_RUNTIME_ENV')
  const secretEnv = jsonArray(process.env.GAME_PROTOCOL_RUNTIME_SECRET_ENV, 'GAME_PROTOCOL_RUNTIME_SECRET_ENV')
  const kubernetes = jsonObject(process.env.GAME_PROTOCOL_RUNTIME_KUBERNETES, 'GAME_PROTOCOL_RUNTIME_KUBERNETES')
  const regions = requiredRegionList(process.env.GAME_PROTOCOL_RUNTIME_REGIONS, 'GAME_PROTOCOL_RUNTIME_REGIONS')
  const bootstrapMode = optionalString(
    process.env.GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE || process.env.GAME_PROTOCOL_RUNTIME_BOOTSTRAP
  )
  if (bootstrapMode !== 'push') {
    throw new Error('GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE must be push')
  }
  const publicMaxUploadSize = nonNegativeInteger(
    process.env.GAME_PROTOCOL_RUNTIME_PUBLIC_MAX_UPLOAD_SIZE,
    'GAME_PROTOCOL_RUNTIME_PUBLIC_MAX_UPLOAD_SIZE'
  )
  const shutdownIdleSeconds = nonNegativeInteger(
    process.env.GAME_PROTOCOL_RUNTIME_SHUTDOWN_IDLE_SECONDS,
    'GAME_PROTOCOL_RUNTIME_SHUTDOWN_IDLE_SECONDS'
  )
  const bootstrap = {
    mode: 'push',
    worldId: requiredString(process.env.GAME_PROTOCOL_RUNTIME_WORLD_ID, 'GAME_PROTOCOL_RUNTIME_WORLD_ID'),
    worldSlug: requiredString(process.env.GAME_PROTOCOL_RUNTIME_WORLD_SLUG, 'GAME_PROTOCOL_RUNTIME_WORLD_SLUG'),
    dbSchema: requiredDbSchema(process.env.GAME_PROTOCOL_RUNTIME_DB_SCHEMA, 'GAME_PROTOCOL_RUNTIME_DB_SCHEMA'),
    ...(publicMaxUploadSize === undefined ? {} : { publicMaxUploadSize }),
    ...(shutdownIdleSeconds === undefined ? {} : { shutdownIdleSeconds }),
    ...(hasValue(process.env.GAME_PROTOCOL_RUNTIME_AUTH_URL) ? { authUrl: requireUrl(process.env.GAME_PROTOCOL_RUNTIME_AUTH_URL, 'GAME_PROTOCOL_RUNTIME_AUTH_URL') } : {}),
    ...(hasValue(process.env.GAME_PROTOCOL_RUNTIME_CONTROL_INTERNAL_BASE_URL)
      ? { controlInternalBaseUrl: requireUrl(process.env.GAME_PROTOCOL_RUNTIME_CONTROL_INTERNAL_BASE_URL, 'GAME_PROTOCOL_RUNTIME_CONTROL_INTERNAL_BASE_URL') }
      : {}),
  }
  return {
    kind: 'authoritative-session',
    server: {
      image,
      port: positiveInteger(process.env.GAME_PROTOCOL_RUNTIME_PORT, 'GAME_PROTOCOL_RUNTIME_PORT', 3000),
      ...(hasValue(process.env.GAME_PROTOCOL_RUNTIME_CAPACITY)
        ? { capacity: positiveInteger(process.env.GAME_PROTOCOL_RUNTIME_CAPACITY, 'GAME_PROTOCOL_RUNTIME_CAPACITY') }
        : {}),
      protocol,
      healthPath: optionalString(process.env.GAME_PROTOCOL_RUNTIME_HEALTH_PATH, '/health'),
      wsPath: optionalString(process.env.GAME_PROTOCOL_RUNTIME_WS_PATH, '/ws'),
      regions,
      bootstrap,
      ...(env ? { env } : {}),
      ...(secretEnv ? { secretEnv } : {}),
      ...(kubernetes ? { kubernetes } : {}),
    },
    state: {
      mode: stateMode,
    },
  }
}

const descriptor = runtimeKind === 'authoritative-session'
  ? authoritativeSessionDescriptor()
  : externalAuthoritativeDescriptor()

await fs.ensureDir(path.dirname(outPath))
await fs.writeFile(outPath, JSON.stringify(descriptor, null, 2) + '\n')
console.log(`Wrote Game Protocol runtime descriptor: ${outPath}`)
