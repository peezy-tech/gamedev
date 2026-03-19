const AGONES_SDK_DEFAULT_HTTP_PORT = 9358

function normalizeHttpPort(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : AGONES_SDK_DEFAULT_HTTP_PORT
}

export const ADMIN_SHUTDOWN_COMMAND = 'agones_shutdown'

export function resolveAgonesShutdownUrl(env = process.env) {
  const port = normalizeHttpPort(env?.AGONES_SDK_HTTP_PORT)
  return `http://127.0.0.1:${port}/shutdown`
}

export async function handleAdminShutdownCommand({
  canDeploy,
  beforeShutdown = null,
  shutdownUrl = resolveAgonesShutdownUrl(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!canDeploy) {
    return {
      ok: false,
      error: 'admin_required',
      reason: 'deploy_capability_required',
    }
  }

  if (!shutdownUrl || typeof fetchImpl !== 'function') {
    return {
      ok: false,
      error: 'shutdown_unavailable',
      reason: 'missing_shutdown_transport',
    }
  }

  if (typeof beforeShutdown === 'function') {
    try {
      await beforeShutdown()
    } catch {
      return {
        ok: false,
        error: 'shutdown_save_failed',
        reason: 'before_shutdown_failed',
      }
    }
  }

  try {
    const response = await fetchImpl(shutdownUrl, { method: 'POST' })
    if (!response?.ok) {
      return {
        ok: false,
        error: 'shutdown_request_failed',
        reason: `agones_sdk_status_${response?.status ?? 'unknown'}`,
      }
    }
  } catch {
    return {
      ok: false,
      error: 'shutdown_request_failed',
      reason: 'request_failed',
    }
  }

  return {
    ok: true,
    requested: true,
  }
}
