const DEFAULT_PUBLIC_MAX_UPLOAD_MB = 12
const DEFAULT_PUBLIC_WORLD_MAX_PLAYERS = 0
const BYTES_PER_MB = 1024 * 1024

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

export function getMaxUploadSizeMb() {
  const value = parseIntEnv(process.env.PUBLIC_MAX_UPLOAD_SIZE, DEFAULT_PUBLIC_MAX_UPLOAD_MB)
  return value > 0 ? value : DEFAULT_PUBLIC_MAX_UPLOAD_MB
}

export function getMaxUploadSizeBytes() {
  return getMaxUploadSizeMb() * BYTES_PER_MB
}

export function getWorldMaxPlayers() {
  const value = parseIntEnv(process.env.PUBLIC_WORLD_MAX_PLAYERS, DEFAULT_PUBLIC_WORLD_MAX_PLAYERS)
  return value > 0 ? value : DEFAULT_PUBLIC_WORLD_MAX_PLAYERS
}
