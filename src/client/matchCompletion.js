export function resolveMatchReturnUrl(payload) {
  const completion = payload?.completion
  if (!completion || completion.ended !== true) return null

  const directUrl = typeof completion.return_world_url === 'string'
    ? completion.return_world_url.trim()
    : ''
  if (directUrl) return directUrl

  const lobbySlug = typeof completion.origin_lobby_slug === 'string'
    ? completion.origin_lobby_slug.trim()
    : ''
  if (!lobbySlug) return null
  return `/worlds/${lobbySlug}`
}
