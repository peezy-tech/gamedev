function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isFalsey(value) {
  if (typeof value === 'boolean') return !value
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off'
}

export function resolveAuthRuntimeConfig(env = process.env) {
  const usesStandaloneWalletIdentity =
    isTruthy(env.STANDALONE_WALLET_AUTH) || env.AUTH_IDENTITY_MODE === 'standalone-wallet'
  const usesLobbyIdentity = hasValue(env.PUBLIC_AUTH_URL) && !usesStandaloneWalletIdentity
  const requiresWalletIdentity = usesStandaloneWalletIdentity && !isFalsey(env.REQUIRE_WALLET_AUTH)

  return {
    usesLobbyIdentity,
    usesStandaloneWalletIdentity,
    requiresWalletIdentity,
    usesLocalIdentity: !usesLobbyIdentity,
  }
}
