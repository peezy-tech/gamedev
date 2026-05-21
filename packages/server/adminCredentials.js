export const ADMIN_CREDENTIAL_COMMAND = 'runtime_credentials_get'

function normalizeWorldId(worldId) {
  if (typeof worldId !== 'string') return null
  const trimmed = worldId.trim()
  return trimmed || null
}

export function buildRuntimeCredentialResponse({
  worldId,
  adminCode,
  adminCodeSupported = typeof adminCode === 'string' && adminCode.length > 0,
} = {}) {
  const normalizedWorldId = normalizeWorldId(worldId)
  const hasAdminCode = typeof adminCode === 'string' && adminCode.length > 0
  return {
    worldId: normalizedWorldId,
    hasAdminCode,
    adminCodeAuthSupported: !!adminCodeSupported,
    adminCode: null,
  }
}

export function handleRuntimeCredentialCommand({
  canDeploy,
  worldId,
  adminCode,
  adminCodeSupported = typeof adminCode === 'string' && adminCode.length > 0,
} = {}) {
  if (!canDeploy) {
    return {
      ok: false,
      error: 'admin_required',
      reason: 'deploy_capability_required',
      revealed: false,
      credentials: null,
    }
  }

  const credentials = buildRuntimeCredentialResponse({
    worldId,
    adminCode,
    adminCodeSupported,
  })
  const hasAdminCode = credentials.hasAdminCode
  const revealed = false

  return {
    ok: true,
    reason: hasAdminCode
      ? credentials.adminCodeAuthSupported
        ? 'admin_code_hidden'
        : 'admin_code_disabled'
      : 'admin_code_unset',
    revealed,
    credentials,
  }
}
