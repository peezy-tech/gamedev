import { spawn } from 'child_process'

import { joinUrl, normalizeWorldAdminBaseUrl } from './helpers.js'
import { debugLog, fetchWithTimeout, readTimeoutMs } from './debug.js'
import {
  readProjectAuthEntry,
  removeProjectAuthEntry,
  writeProjectAuthEntry,
} from './projectAuth.js'

const DEFAULT_CLI_AUTH_REQUEST_TIMEOUT_MS = 15_000

function getCliAuthRequestTimeoutMs() {
  return readTimeoutMs('WORLD_ADMIN_REQUEST_TIMEOUT_MS', DEFAULT_CLI_AUTH_REQUEST_TIMEOUT_MS)
}

function createError(code, message = code, extra = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, extra)
  return error
}

function normalizeCapability(value) {
  if (value === 'deploy') return 'deploy'
  if (value === 'auth') return 'auth'
  return 'builder'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function hasRequiredCapability(capabilities, requiredCapability = 'builder') {
  const required = normalizeCapability(requiredCapability)
  if (required === 'auth') return true
  if (required === 'deploy') return !!capabilities?.deploy
  return !!capabilities?.builder
}

export async function fetchCliAuthStatus({ worldUrl, authToken }) {
  const normalizedWorldUrl = normalizeWorldAdminBaseUrl(worldUrl)
  if (!normalizedWorldUrl) {
    throw createError('invalid_world_url', 'Invalid world URL')
  }
  if (typeof authToken !== 'string' || !authToken.trim()) {
    throw createError('auth_token_missing', 'Missing auth token')
  }
  const url = joinUrl(normalizedWorldUrl, '/api/auth/cli/status')
  const timeoutMs = getCliAuthRequestTimeoutMs()
  debugLog('cli-auth', 'status:start', {
    worldUrl: normalizedWorldUrl,
    url,
    timeoutMs,
  })
  let response
  try {
    response = await fetchWithTimeout(url, {
      headers: {
        authorization: `Bearer ${authToken.trim()}`,
        accept: 'application/json',
      },
    }, {
      timeoutMs,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      debugLog('cli-auth', 'status:timeout', {
        worldUrl: normalizedWorldUrl,
        url,
        timeoutMs,
      })
      throw createError('status_timeout', 'Timed out fetching CLI auth status', { timeoutMs, url })
    }
    debugLog('cli-auth', 'status:error', {
      worldUrl: normalizedWorldUrl,
      url,
      error: err?.message || String(err),
    })
    throw err
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    debugLog('cli-auth', 'status:response_error', {
      worldUrl: normalizedWorldUrl,
      url,
      status: response.status,
      error: data?.error || null,
    })
    const error = createError(data?.error || `status_failed:${response.status}`, data?.message || 'Auth status failed', {
      status: response.status,
      data,
    })
    throw error
  }
  debugLog('cli-auth', 'status:ok', {
    worldUrl: normalizedWorldUrl,
    url,
    status: response.status,
    capabilities: data?.capabilities || null,
  })
  return data
}

async function launchBrowser(url) {
  const commands =
    process.platform === 'darwin'
      ? [['open', [url]]]
      : process.platform === 'win32'
        ? [['cmd', ['/c', 'start', '', url]]]
        : [['xdg-open', [url]]]

  for (const [command, args] of commands) {
    const ok = await new Promise(resolve => {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    })
    if (ok) return true
  }
  return false
}

export function buildCliAuthUrl({
  worldUrl,
  worldId,
  sessionId,
  requiredCapability = 'builder',
} = {}) {
  const normalizedWorldUrl = normalizeWorldAdminBaseUrl(worldUrl)
  if (!normalizedWorldUrl) {
    throw createError('invalid_world_url', 'Invalid world URL')
  }
  const url = new URL(joinUrl(normalizedWorldUrl, '/auth/cli'))
  if (sessionId) url.searchParams.set('session', sessionId)
  if (worldId) url.searchParams.set('worldId', worldId)
  url.searchParams.set('required', normalizeCapability(requiredCapability))
  return url.toString()
}

async function createRemoteCliAuthSession({ worldUrl, worldId, requiredCapability = 'builder' } = {}) {
  const normalizedWorldUrl = normalizeWorldAdminBaseUrl(worldUrl)
  if (!normalizedWorldUrl) {
    throw createError('invalid_world_url', 'Invalid world URL')
  }
  const url = joinUrl(normalizedWorldUrl, '/api/auth/cli/session')
  const timeoutMs = getCliAuthRequestTimeoutMs()
  debugLog('cli-auth', 'session:create_start', {
    worldUrl: normalizedWorldUrl,
    worldId,
    url,
    requiredCapability: normalizeCapability(requiredCapability),
    timeoutMs,
  })
  let response
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        worldId,
        requiredCapability: normalizeCapability(requiredCapability),
      }),
    }, {
      timeoutMs,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      debugLog('cli-auth', 'session:create_timeout', {
        worldUrl: normalizedWorldUrl,
        url,
        timeoutMs,
      })
      throw createError('session_create_timeout', 'Timed out creating CLI auth session', { timeoutMs, url })
    }
    debugLog('cli-auth', 'session:create_error', {
      worldUrl: normalizedWorldUrl,
      url,
      error: err?.message || String(err),
    })
    throw err
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    debugLog('cli-auth', 'session:create_response_error', {
      worldUrl: normalizedWorldUrl,
      url,
      status: response.status,
      error: data?.error || null,
    })
    throw createError(
      data?.error || `session_create_failed:${response.status}`,
      data?.message || 'Failed to create CLI auth session',
      {
        status: response.status,
        data,
      },
    )
  }
  const sessionId = typeof data?.sessionId === 'string' ? data.sessionId.trim() : ''
  if (!sessionId) {
    throw createError('invalid_session_response', 'World did not return a CLI auth session id', { data })
  }
  debugLog('cli-auth', 'session:create_ok', {
    worldUrl: normalizedWorldUrl,
    url,
    sessionId,
    status: response.status,
  })
  return data
}

async function fetchRemoteCliAuthSession({ worldUrl, sessionId } = {}) {
  const normalizedWorldUrl = normalizeWorldAdminBaseUrl(worldUrl)
  if (!normalizedWorldUrl) {
    throw createError('invalid_world_url', 'Invalid world URL')
  }
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw createError('session_missing', 'Missing CLI auth session id')
  }
  const normalizedSessionId = sessionId.trim()
  const url = joinUrl(normalizedWorldUrl, `/api/auth/cli/session/${encodeURIComponent(normalizedSessionId)}`)
  const timeoutMs = getCliAuthRequestTimeoutMs()
  debugLog('cli-auth', 'session:poll_start', {
    worldUrl: normalizedWorldUrl,
    sessionId: normalizedSessionId,
    url,
    timeoutMs,
  })
  let response
  try {
    response = await fetchWithTimeout(url, {
      headers: {
        accept: 'application/json',
      },
    }, {
      timeoutMs,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      debugLog('cli-auth', 'session:poll_timeout', {
        worldUrl: normalizedWorldUrl,
        sessionId: normalizedSessionId,
        url,
        timeoutMs,
      })
      throw createError('session_status_timeout', 'Timed out reading CLI auth session', { timeoutMs, url })
    }
    debugLog('cli-auth', 'session:poll_error', {
      worldUrl: normalizedWorldUrl,
      sessionId: normalizedSessionId,
      url,
      error: err?.message || String(err),
    })
    throw err
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    debugLog('cli-auth', 'session:poll_response_error', {
      worldUrl: normalizedWorldUrl,
      sessionId: normalizedSessionId,
      url,
      status: response.status,
      error: data?.error || null,
    })
    throw createError(
      data?.error || `session_status_failed:${response.status}`,
      data?.message || 'Failed to read CLI auth session',
      {
        status: response.status,
        data,
      },
    )
  }
  debugLog('cli-auth', 'session:poll_ok', {
    worldUrl: normalizedWorldUrl,
    sessionId: normalizedSessionId,
    url,
    status: response.status,
    sessionStatus: data?.status || null,
  })
  return data
}

async function waitForRemoteCliAuthSession({
  worldUrl,
  sessionId,
  timeoutMs = 10 * 60 * 1000,
  intervalMs = 1000,
} = {}) {
  const deadline = Date.now() + timeoutMs
  debugLog('cli-auth', 'session:wait_start', {
    worldUrl,
    sessionId,
    timeoutMs,
    intervalMs,
  })
  while (Date.now() < deadline) {
    const session = await fetchRemoteCliAuthSession({ worldUrl, sessionId })
    if (session?.status === 'complete' && session?.result?.authToken) {
      debugLog('cli-auth', 'session:wait_complete', {
        worldUrl,
        sessionId,
      })
      return session.result
    }
    if (session?.status === 'expired') {
      debugLog('cli-auth', 'session:wait_expired', {
        worldUrl,
        sessionId,
      })
      throw createError('auth_timeout', 'Timed out waiting for browser authentication')
    }
    await sleep(intervalMs)
  }
  debugLog('cli-auth', 'session:wait_timeout', {
    worldUrl,
    sessionId,
    timeoutMs,
  })
  throw createError('auth_timeout', 'Timed out waiting for browser authentication')
}

async function openCliAuthUrl(authUrl, { log = console } = {}) {
  debugLog('cli-auth', 'browser:open_url', {
    authUrl,
  })
  log?.log?.(`World auth URL:\n${authUrl}`)
  const opened = await launchBrowser(authUrl)
  if (!opened) {
    debugLog('cli-auth', 'browser:open_failed', {
      authUrl,
    })
    log?.warn?.('Browser did not open automatically. Open the URL above to continue authentication.')
    return
  }
  debugLog('cli-auth', 'browser:open_ok', {
    authUrl,
  })
  log?.log?.('Opening browser for world auth...')
}

export async function runBrowserCliAuth({
  rootDir = process.cwd(),
  worldUrl,
  worldId,
  requiredCapability = 'builder',
  timeoutMs,
  log = console,
} = {}) {
  const session = await createRemoteCliAuthSession({
    worldUrl,
    worldId,
    requiredCapability,
  })
  const authUrl = buildCliAuthUrl({
    worldUrl,
    worldId,
    sessionId: session.sessionId,
    requiredCapability,
  })
  await openCliAuthUrl(authUrl, { log })
  const payload = await waitForRemoteCliAuthSession({
    worldUrl,
    sessionId: session.sessionId,
    timeoutMs,
  })
  const entry = writeProjectAuthEntry(rootDir, {
    worldUrl: payload.worldUrl || worldUrl,
    worldId: payload.worldId || worldId,
    authToken: payload.authToken,
    userId: payload?.user?.id || null,
    userName: payload?.user?.name || null,
  })
  debugLog('cli-auth', 'browser:auth_written', {
    worldUrl: entry.worldUrl || worldUrl,
    worldId: entry.worldId || worldId,
    userId: entry.userId || null,
  })
  return {
    entry,
    capabilities: payload?.capabilities || null,
  }
}

export async function ensureProjectAuth({
  rootDir = process.cwd(),
  worldUrl,
  worldId,
  requiredCapability = 'builder',
  interactive = process.stdin.isTTY,
  log = console,
} = {}) {
  const existing = readProjectAuthEntry(rootDir, { worldUrl, worldId })
  debugLog('cli-auth', 'ensure:start', {
    worldUrl,
    worldId,
    requiredCapability: normalizeCapability(requiredCapability),
    interactive,
    hasStoredAuth: !!existing?.authToken,
  })
  if (existing?.authToken) {
    try {
      const status = await fetchCliAuthStatus({
        worldUrl,
        authToken: existing.authToken,
      })
      if (hasRequiredCapability(status.capabilities, requiredCapability)) {
        debugLog('cli-auth', 'ensure:stored_auth_ok', {
          worldUrl,
          worldId,
          capabilities: status.capabilities || null,
        })
        return {
          entry: existing,
          status,
        }
      }
      if (!interactive) {
        throw createError('capability_required', 'Authenticated user lacks required world permission', {
          capabilities: status.capabilities,
        })
      }
    } catch (error) {
      const code = error?.code || ''
      debugLog('cli-auth', 'ensure:stored_auth_error', {
        worldUrl,
        worldId,
        code: code || null,
        error: error?.message || String(error),
      })
      if (code === 'invalid_token' || code === 'auth_token_missing' || code === 'auth_required' || code === 'status_failed:401') {
        removeProjectAuthEntry(rootDir, { worldUrl, worldId })
        debugLog('cli-auth', 'ensure:stored_auth_removed', {
          worldUrl,
          worldId,
          code,
        })
      } else if (!interactive) {
        throw error
      }
    }
  }

  if (!interactive) {
    throw createError(
      'auth_required',
      `Authentication required for ${worldId || worldUrl}. Run "gamedev auth" in a terminal.`,
    )
  }

  const result = await runBrowserCliAuth({
    rootDir,
    worldUrl,
    worldId,
    requiredCapability,
    log,
  })
  const status = await fetchCliAuthStatus({
    worldUrl,
    authToken: result.entry.authToken,
  })
  if (!hasRequiredCapability(status.capabilities, requiredCapability)) {
    throw createError('capability_required', 'Authenticated user lacks required world permission', {
      capabilities: status.capabilities,
    })
  }
  debugLog('cli-auth', 'ensure:browser_auth_ok', {
    worldUrl,
    worldId,
    capabilities: status.capabilities || null,
  })
  return {
    entry: result.entry,
    status,
  }
}
