function normalizeEnvString(value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

export function isTruthyEnvFlag(value) {
  const normalized = normalizeEnvString(value)
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function isRuntimeBootstrapDebugEnabled(env = process.env) {
  return isTruthyEnvFlag(env?.RUNTIME_BOOTSTRAP_DEBUG)
}

export function readTimeoutMs(envName, fallbackMs, { min = 100 } = {}) {
  const raw = process.env?.[envName]
  if (typeof raw !== 'string' || !raw.trim()) return fallbackMs
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed)) return fallbackMs
  return Math.max(min, parsed)
}

export function debugLog(scope, message, extra) {
  if (!isRuntimeBootstrapDebugEnabled()) return
  const prefix = `[runtime-bootstrap-debug:${scope}]`
  if (extra === undefined) {
    console.log(prefix, message)
    return
  }
  console.log(prefix, message, extra)
}

export function summarizeToken(value, { head = 6, tail = 4 } = {}) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length <= head + tail + 3) return trimmed
  return `${trimmed.slice(0, head)}...${trimmed.slice(-tail)}`
}

export async function fetchWithTimeout(input, init = {}, { timeoutMs, fetchImpl = fetch } = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
