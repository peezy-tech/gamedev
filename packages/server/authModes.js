import { usesHostedRuntimeBootstrap } from './runtimeBootstrap.js'

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function resolveAuthRuntimeConfig(env = process.env) {
  const usesLobbyIdentity = hasValue(env.PUBLIC_AUTH_URL)
  const usesControlPlaneRank = usesLobbyIdentity && usesHostedRuntimeBootstrap(env)

  return {
    usesLobbyIdentity,
    usesLocalIdentity: !usesLobbyIdentity,
    usesControlPlaneRank,
    usesRuntimeLocalRank: !usesControlPlaneRank,
  }
}
