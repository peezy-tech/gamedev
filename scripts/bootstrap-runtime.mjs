import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv-flow'

import {
  buildRuntimeBootstrapAuthorization,
  buildRuntimeBootstrapId,
  derivePublicAdminUrl,
  derivePublicWsUrlFromApiUrl,
} from '../packages/server/runtimeBootstrap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

function usage() {
  console.log(`Usage: node scripts/bootstrap-runtime.mjs [options]

Options:
  --env <name>          dotenv-flow env suffix to load (default: bootstrap, use "none" to skip)
  --run <mode>          start the runtime first: dev | start
  --runtime-url <url>   runtime base URL to call (default: BOOTSTRAP_RUNTIME_URL or http://HOST:PORT)
  --world-id <id>       world id to bind (default: BOOTSTRAP_WORLD_ID or WORLD_ID)
  --world-slug <slug>   world slug to bind (default: BOOTSTRAP_WORLD_SLUG or world id)
  --timeout-ms <ms>     total wait timeout (default: BOOTSTRAP_TIMEOUT_MS or 30000)
  --help                show this help
`)
}

function parseArgs(argv) {
  const options = {
    env: 'bootstrap',
    run: null,
    runtimeUrl: '',
    worldId: '',
    worldSlug: '',
    timeoutMs: 30000,
    timeoutProvided: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--env') {
      options.env = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--run') {
      options.run = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--runtime-url') {
      options.runtimeUrl = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--world-id') {
      options.worldId = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--world-slug') {
      options.worldSlug = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number.parseInt(argv[index + 1] || '', 10)
      options.timeoutProvided = true
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.run && options.run !== 'dev' && options.run !== 'start') {
    throw new Error(`Unsupported --run mode: ${options.run}`)
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('timeout must be a positive integer')
  }

  return options
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUrl(value) {
  const normalized = normalizeString(value)
  return normalized ? normalized.replace(/\/+$/, '') : ''
}

function parseOptionalInteger(value) {
  const normalized = normalizeString(value)
  if (!normalized) return null
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value: ${value}`)
  }
  return parsed
}

function loadEnvironment(envName) {
  if (!envName || envName === 'none') return
  loadEnv({
    path: rootDir,
    node_env: envName,
    silent: true,
  })
}

function applyEnvironmentDefaults(options) {
  if (options.timeoutProvided) return options
  const timeoutMs = Number.parseInt(process.env.BOOTSTRAP_TIMEOUT_MS || '', 10)
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    options.timeoutMs = timeoutMs
  }
  return options
}

function buildRuntimeBaseUrl({ runtimeUrl, host, port, worldUrl } = {}) {
  const explicitRuntimeUrl = normalizeUrl(runtimeUrl)
  if (explicitRuntimeUrl) return explicitRuntimeUrl

  const explicitWorldUrl = normalizeUrl(worldUrl)
  if (explicitWorldUrl) return explicitWorldUrl

  const resolvedHost = normalizeString(host) || '127.0.0.1'
  const resolvedPort = normalizeString(port) || '3000'
  return `http://${resolvedHost}:${resolvedPort}`
}

function addIfPresent(target, key, value) {
  if (value === null || value === undefined || value === '') return
  target[key] = value
}

function resolveBootstrapConfig(options) {
  const env = { ...process.env }
  if (!env.RUNTIME_BOOTSTRAP && normalizeString(env.RUNTIME_BOOTSTRAP_MODE).toLowerCase() === 'push') {
    env.RUNTIME_BOOTSTRAP = '1'
  }

  const runtimeInstanceId = normalizeString(env.RUNTIME_BOOTSTRAP_INSTANCE_ID || env.POD_NAME || env.HOSTNAME)
  if (!runtimeInstanceId) {
    throw new Error('RUNTIME_BOOTSTRAP_INSTANCE_ID is required')
  }

  const bootstrapSecret = normalizeString(env.RUNTIME_BOOTSTRAP_AUTH_SECRET || env.JWT_SECRET)
  if (!bootstrapSecret) {
    throw new Error('RUNTIME_BOOTSTRAP_AUTH_SECRET or JWT_SECRET is required')
  }

  const runtimeUrl = buildRuntimeBaseUrl({
    runtimeUrl: options.runtimeUrl || env.BOOTSTRAP_RUNTIME_URL,
    worldUrl: env.WORLD_URL,
    host: env.HOST,
    port: env.PORT,
  })
  const worldId = normalizeString(options.worldId || env.BOOTSTRAP_WORLD_ID || env.WORLD_ID || `local-${runtimeInstanceId}`)
  const worldSlug = normalizeString(options.worldSlug || env.BOOTSTRAP_WORLD_SLUG || worldId)
  const publicApiUrl = normalizeUrl(env.BOOTSTRAP_PUBLIC_API_URL) || `${runtimeUrl}/api`
  const publicWsUrl = normalizeUrl(env.BOOTSTRAP_PUBLIC_WS_URL) || derivePublicWsUrlFromApiUrl(publicApiUrl) || ''
  const publicAdminUrl =
    normalizeUrl(env.BOOTSTRAP_PUBLIC_ADMIN_URL)
    || derivePublicAdminUrl({
      publicApiUrl,
      publicWsUrl,
    })
    || ''

  const world = {
    id: worldId,
    slug: worldSlug,
  }
  addIfPresent(world, 'dbSchema', normalizeString(env.BOOTSTRAP_DB_SCHEMA))
  addIfPresent(world, 'publicMaxUploadSize', parseOptionalInteger(env.BOOTSTRAP_PUBLIC_MAX_UPLOAD_SIZE))
  addIfPresent(world, 'publicWorldMaxPlayers', parseOptionalInteger(env.BOOTSTRAP_PUBLIC_WORLD_MAX_PLAYERS))
  addIfPresent(world, 'shutdownIdleSeconds', parseOptionalInteger(env.BOOTSTRAP_SHUTDOWN_IDLE_SECONDS))

  const runtime = {
    instanceId: runtimeInstanceId,
    publicApiUrl,
  }
  addIfPresent(runtime, 'publicWsUrl', publicWsUrl)
  addIfPresent(runtime, 'publicAdminUrl', publicAdminUrl)

  const auth = {}
  addIfPresent(auth, 'publicAuthUrl', normalizeUrl(env.BOOTSTRAP_PUBLIC_AUTH_URL))
  addIfPresent(auth, 'publicPrivyAppId', normalizeString(env.BOOTSTRAP_PUBLIC_PRIVY_APP_ID))

  const control = {}
  addIfPresent(control, 'internalBaseUrl', normalizeUrl(env.BOOTSTRAP_CONTROL_INTERNAL_BASE_URL))

  const payload = {
    bootstrapId: buildRuntimeBootstrapId({
      worldId,
      runtimeInstanceId,
    }),
    world,
    runtime,
    auth,
    control,
  }

  const authorization = buildRuntimeBootstrapAuthorization(runtimeInstanceId, bootstrapSecret)
  if (!authorization) {
    throw new Error('Failed to build bootstrap authorization header')
  }

  return {
    childEnv: {
      ...env,
      RUNTIME_BOOTSTRAP: '1',
    },
    runtimeUrl,
    worldId,
    runtimeInstanceId,
    authorization,
    payload,
  }
}

async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    return {
      ok: response.ok,
      status: response.status,
      payload,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function waitFor(fn, { timeoutMs = 30000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const result = await fn()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  if (lastError) throw lastError
  throw new Error('Timed out waiting for runtime')
}

function describeExit(exit) {
  if (!exit) return 'unknown'
  return `${exit.code ?? 'null'}${exit.signal ? `/${exit.signal}` : ''}`
}

function startRuntime(runMode, env) {
  if (!runMode) return null

  const args = runMode === 'dev' ? ['scripts/build.mjs', '--dev'] : ['build/index.js']
  console.log(`[bootstrap] starting: node ${args.join(' ')}`)
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  })

  let exitInfo = null
  const exitPromise = new Promise(resolve => {
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal }
      resolve(exitInfo)
    })
  })

  const forwardSignal = signal => {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  process.once('SIGINT', forwardSignal)
  process.once('SIGTERM', forwardSignal)

  return {
    child,
    exitPromise,
    getExitInfo() {
      return exitInfo
    },
    async stop(signal = 'SIGTERM') {
      if (!child.killed) {
        child.kill(signal)
      }
      await exitPromise
    },
  }
}

async function waitForBootstrapEndpoint(runtimeUrl, runtimeProcess, timeoutMs) {
  return waitFor(async () => {
    const exitInfo = runtimeProcess?.getExitInfo()
    if (exitInfo) {
      throw new Error(`Runtime exited before bootstrap request (${describeExit(exitInfo)})`)
    }

    const response = await requestJson(`${runtimeUrl}/internal/bootstrap/status`, {
      timeoutMs: 2000,
    }).catch(() => null)
    if (!response) return false
    if (response.status === 404) {
      return false
    }
    if (response.ok) {
      return response.payload
    }
    if (response.payload?.state === 'failed') {
      throw new Error('Runtime entered failed state before bootstrap request')
    }
    return false
  }, { timeoutMs })
}

async function waitForReady(runtimeUrl, timeoutMs) {
  return waitFor(async () => {
    const response = await requestJson(`${runtimeUrl}/health`, {
      timeoutMs: 2000,
    }).catch(() => null)
    return response?.ok ? response.payload : false
  }, { timeoutMs })
}

function formatFailure(prefix, response) {
  const detail = response?.payload ? ` ${JSON.stringify(response.payload)}` : ''
  return `${prefix} (${response?.status ?? 'no_status'})${detail}`
}

async function waitForRuntimeExit(runtimeProcess) {
  if (!runtimeProcess) return
  const exitInfo = await runtimeProcess.exitPromise
  if (exitInfo?.code === 0 || exitInfo?.signal === 'SIGINT' || exitInfo?.signal === 'SIGTERM') {
    return
  }
  throw new Error(`Runtime exited (${describeExit(exitInfo)})`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  loadEnvironment(options.env)
  applyEnvironmentDefaults(options)
  const config = resolveBootstrapConfig(options)
  const runtimeProcess = startRuntime(options.run, config.childEnv)

  try {
    console.log(`[bootstrap] waiting for runtime at ${config.runtimeUrl}`)
    const status = await waitForBootstrapEndpoint(config.runtimeUrl, runtimeProcess, options.timeoutMs)
    if (status?.state === 'ready') {
      console.log(`[bootstrap] runtime already ready for ${status?.world?.id || 'unknown-world'}`)
      await waitForRuntimeExit(runtimeProcess)
      return
    }

    console.log(
      `[bootstrap] binding world ${config.worldId} to runtime ${config.runtimeInstanceId}`
    )
    const response = await requestJson(`${config.runtimeUrl}/internal/bootstrap`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: config.authorization,
        'content-type': 'application/json',
      },
      body: config.payload,
      timeoutMs: Math.min(options.timeoutMs, 15000),
    })

    if (!response.ok) {
      throw new Error(formatFailure('Bootstrap request failed', response))
    }

    await waitForReady(config.runtimeUrl, options.timeoutMs)
    console.log(`[bootstrap] runtime ready at ${config.runtimeUrl}`)

    await waitForRuntimeExit(runtimeProcess)
  } catch (error) {
    if (runtimeProcess) {
      await runtimeProcess.stop().catch(() => {})
    }
    throw error
  }
}

main().catch(error => {
  console.error(`[bootstrap] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
