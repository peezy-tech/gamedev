export function allowWorldIdConfigMismatch(env = process.env) {
  return String(env?.ALLOW_WORLD_ID_CONFIG_MISMATCH || '').trim().toLowerCase() === 'true'
}

export function validateWorldIdConfig({ envWorldId, dbWorldId, env = process.env } = {}) {
  const normalizedEnvWorldId = typeof envWorldId === 'string' ? envWorldId.trim() : ''
  const normalizedDbWorldId = typeof dbWorldId === 'string' ? dbWorldId.trim() : ''
  const mismatch = !!(normalizedEnvWorldId && normalizedDbWorldId && normalizedEnvWorldId !== normalizedDbWorldId)
  if (!mismatch) {
    return { mismatch: false, allowed: false }
  }
  const allowed = allowWorldIdConfigMismatch(env)
  if (!allowed) {
    throw new Error(`[envs] WORLD_ID mismatch: env=${normalizedEnvWorldId} db=${normalizedDbWorldId}`)
  }
  return { mismatch: true, allowed: true }
}
