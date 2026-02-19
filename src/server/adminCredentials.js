export const ADMIN_CREDENTIAL_COMMAND = 'runtime_credentials_get'
export const ADMIN_CREDENTIAL_REVEAL_ENV = 'ADMIN_CREDENTIAL_REVEAL_ENABLED'

export function parseBooleanEnvFlag(value, fallback = false) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function isAdminCredentialRevealEnabled(env = process.env) {
  return parseBooleanEnvFlag(env?.[ADMIN_CREDENTIAL_REVEAL_ENV], false)
}

function normalizeWorldId(worldId) {
  if (typeof worldId !== 'string') return null
  const trimmed = worldId.trim()
  return trimmed || null
}

export function buildRuntimeCredentialResponse({
  worldId,
  adminCode,
  revealEnabled,
} = {}) {
  const normalizedWorldId = normalizeWorldId(worldId)
  const hasAdminCode = typeof adminCode === 'string' && adminCode.length > 0
  return {
    worldId: normalizedWorldId,
    hasAdminCode,
    canRevealAdminCode: !!revealEnabled,
    adminCode: hasAdminCode && revealEnabled ? adminCode : null,
  }
}

export function handleRuntimeCredentialCommand({
  canDeploy,
  revealEnabled,
  worldId,
  adminCode,
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
    revealEnabled,
  })

  return {
    ok: true,
    reason: credentials.adminCode ? 'revealed' : 'reveal_disabled',
    revealed: !!credentials.adminCode,
    credentials,
  }
}
