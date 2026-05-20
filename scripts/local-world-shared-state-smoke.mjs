#!/usr/bin/env node
import { authenticateStandaloneAdminWallet, assertImportedSnapshot } from './local-world-import-smoke.mjs'

const DEFAULT_CHAIN_ID = 42161

function clean(value, fallback = '') {
  return (value || fallback).trim()
}

function normalizeBaseUrl(value) {
  return clean(value).replace(/\/+$/, '')
}

function requiredEnv(env, name) {
  const value = clean(env[name])
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parseList(value, fallback = []) {
  const raw = clean(value)
  if (!raw) return fallback
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function joinUrl(base, suffix) {
  const normalizedBase = normalizeBaseUrl(base)
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`
  return `${normalizedBase}${normalizedSuffix}`
}

function defaultAuthUrl(worldUrl) {
  return joinUrl(worldUrl, '/api/auth/identity')
}

function defaultApiUrl(worldUrl) {
  return joinUrl(worldUrl, '/api')
}

function worldBaseFromApiUrl(apiUrl) {
  const url = new URL(apiUrl)
  url.pathname = url.pathname.replace(/\/api\/?$/, '') || '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(clean(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function vectorFromEnv(value, fallback) {
  const raw = clean(value)
  if (!raw) return fallback
  const parsed = raw.split(',').map(item => Number.parseFloat(item.trim()))
  if (parsed.length !== fallback.length || parsed.some(item => !Number.isFinite(item))) {
    throw new Error(`invalid vector: ${value}`)
  }
  return parsed
}

export function loadSharedStateSmokeConfig(env = process.env) {
  const primaryWorldUrl = normalizeBaseUrl(requiredEnv(env, 'WORLD_SHARED_STATE_PRIMARY_URL'))
  const worldId = requiredEnv(env, 'WORLD_ID')
  const gameSlug = clean(env.GAME_SLUG || env.WORLD_SLUG, worldId)
  const gameTroveUrl = normalizeBaseUrl(requiredEnv(env, 'GAME_TROVE_URL'))
  const privateKey = requiredEnv(env, 'WORLD_IMPORT_ADMIN_PRIVATE_KEY')
  const chainId = Number.parseInt(clean(env.WORLD_IMPORT_CHAIN_ID, String(DEFAULT_CHAIN_ID)), 10)
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('WORLD_IMPORT_CHAIN_ID must be a positive integer')
  }
  return {
    primaryWorldUrl,
    worldId,
    gameSlug,
    gameTroveUrl,
    privateKey,
    chainId,
    primaryAuthUrl: normalizeBaseUrl(clean(env.WORLD_SHARED_STATE_PRIMARY_AUTH_URL, defaultAuthUrl(primaryWorldUrl))),
    primaryApiUrl: normalizeBaseUrl(clean(env.WORLD_SHARED_STATE_PRIMARY_API_URL, defaultApiUrl(primaryWorldUrl))),
    matchKey: clean(env.WORLD_SHARED_STATE_SECONDARY_MATCH_KEY, 'local-agones-shared-state'),
    playerId: clean(env.WORLD_SHARED_STATE_SECONDARY_PLAYER_ID, 'local-agones-shared-state-player'),
    expectedBlueprints: parseList(env.WORLD_IMPORT_EXPECT_BLUEPRINTS, ['$scene', 'tycoon']),
    expectedEntities: parseList(env.WORLD_IMPORT_EXPECT_ENTITIES, ['tradeScene', 'd12UKcWyDG']),
    spawnPosition: vectorFromEnv(env.WORLD_SHARED_STATE_SPAWN_POSITION, [12.5, 3.25, -7.75]),
    spawnQuaternion: vectorFromEnv(env.WORLD_SHARED_STATE_SPAWN_QUATERNION, [0, 0.3826834, 0, 0.9238795]),
    timeoutMs: positiveInt(env.WORLD_SHARED_STATE_TIMEOUT_MS, 60000),
    runtimeControlUrl: normalizeBaseUrl(clean(env.RUNTIME_CONTROL_URL)),
    runtimeControlApiKey: clean(env.RUNTIME_CONTROL_API_KEY),
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
  return body
}

async function fetchJsonWithRetry(url, options, { timeoutMs, label }) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      return await requestJson(url, options)
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error(`${label} did not become available: ${lastError?.message || 'timeout'}`)
}

export async function assignSecondaryRuntime(config) {
  const body = await requestJson(
    joinUrl(config.gameTroveUrl, `/api/games/${encodeURIComponent(config.gameSlug)}/runtime-assignment`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'match',
        matchKey: config.matchKey,
        player: { id: config.playerId },
      }),
    },
  )
  const assignment = body?.assignment
  const apiUrl = assignment?.endpoints?.apiUrl
  if (!assignment?.instanceId || !apiUrl) {
    throw new Error('secondary assignment is missing instanceId or apiUrl')
  }
  return {
    instanceId: assignment.instanceId,
    runtimeInstanceId: assignment.runtimeInstanceId || null,
    worldUrl: worldBaseFromApiUrl(apiUrl),
    apiUrl,
  }
}

async function adminSnapshot(worldUrl, authToken, timeoutMs) {
  return fetchJsonWithRetry(joinUrl(worldUrl, '/admin/snapshot'), {
    headers: { authorization: `Bearer ${authToken}` },
  }, {
    timeoutMs,
    label: `admin snapshot ${worldUrl}`,
  })
}

async function setSpawn(config, authToken, spawn) {
  return requestJson(joinUrl(config.primaryWorldUrl, '/admin/spawn'), {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(spawn),
  })
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0001
}

export function assertSpawnMatches(snapshot, expected) {
  const position = snapshot?.spawn?.position
  const quaternion = snapshot?.spawn?.quaternion
  if (!Array.isArray(position) || !Array.isArray(quaternion)) {
    throw new Error('snapshot is missing spawn')
  }
  for (let i = 0; i < expected.position.length; i += 1) {
    if (!nearlyEqual(position[i], expected.position[i])) {
      throw new Error(`spawn position mismatch at ${i}: expected ${expected.position[i]}, got ${position[i]}`)
    }
  }
  for (let i = 0; i < expected.quaternion.length; i += 1) {
    if (!nearlyEqual(quaternion[i], expected.quaternion[i])) {
      throw new Error(`spawn quaternion mismatch at ${i}: expected ${expected.quaternion[i]}, got ${quaternion[i]}`)
    }
  }
}

async function stopRuntimeInstance(config, instanceId) {
  if (!config.runtimeControlUrl || !config.runtimeControlApiKey || !instanceId) return
  await fetch(`${config.runtimeControlUrl}/internal/runtime/instances/${encodeURIComponent(instanceId)}/stop`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${config.runtimeControlApiKey}`,
    },
  }).catch(() => null)
}

export async function runLocalWorldSharedStateSmoke(config = loadSharedStateSmokeConfig()) {
  const primaryAuth = await authenticateStandaloneAdminWallet({
    worldUrl: config.primaryWorldUrl,
    worldId: config.worldId,
    privateKey: config.privateKey,
    authUrl: config.primaryAuthUrl,
    apiUrl: config.primaryApiUrl,
    chainId: config.chainId,
    expectedBlueprints: config.expectedBlueprints,
    expectedEntities: config.expectedEntities,
  })
  const primarySnapshot = await adminSnapshot(config.primaryWorldUrl, primaryAuth.authToken, config.timeoutMs)
  assertImportedSnapshot(primarySnapshot, config)
  const originalSpawn = primarySnapshot.spawn
  const expectedSpawn = {
    position: config.spawnPosition,
    quaternion: config.spawnQuaternion,
  }

  let secondary = null
  try {
    await setSpawn(config, primaryAuth.authToken, expectedSpawn)
    secondary = await assignSecondaryRuntime(config)
    const secondaryAuth = await authenticateStandaloneAdminWallet({
      worldUrl: secondary.worldUrl,
      worldId: config.worldId,
      privateKey: config.privateKey,
      authUrl: defaultAuthUrl(secondary.worldUrl),
      apiUrl: defaultApiUrl(secondary.worldUrl),
      chainId: config.chainId,
      expectedBlueprints: config.expectedBlueprints,
      expectedEntities: config.expectedEntities,
    })
    const secondarySnapshot = await adminSnapshot(secondary.worldUrl, secondaryAuth.authToken, config.timeoutMs)
    const imported = assertImportedSnapshot(secondarySnapshot, config)
    assertSpawnMatches(secondarySnapshot, expectedSpawn)
    return {
      ok: true,
      worldId: config.worldId,
      primaryWorldUrl: config.primaryWorldUrl,
      secondaryWorldUrl: secondary.worldUrl,
      secondaryInstanceId: secondary.instanceId,
      secondaryRuntimeInstanceId: secondary.runtimeInstanceId,
      sharedSpawn: expectedSpawn,
      imported,
    }
  } finally {
    if (originalSpawn?.position && originalSpawn?.quaternion) {
      await setSpawn(config, primaryAuth.authToken, {
        position: originalSpawn.position,
        quaternion: originalSpawn.quaternion,
      }).catch(() => null)
    }
    await stopRuntimeInstance(config, secondary?.instanceId)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLocalWorldSharedStateSmoke()
    .then(result => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(error => {
      console.error(error?.stack || error?.message || error)
      process.exit(1)
    })
}
