import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveMatchReturnUrl } from '../../src/client/matchCompletion.js'

test('resolveMatchReturnUrl returns explicit return_world_url when present', () => {
  const url = resolveMatchReturnUrl({
    completion: {
      ended: true,
      return_world_url: '/worlds/home-lobby',
      origin_lobby_slug: 'fallback-lobby',
    },
  })
  assert.equal(url, '/worlds/home-lobby')
})

test('resolveMatchReturnUrl falls back to origin lobby slug', () => {
  const url = resolveMatchReturnUrl({
    completion: {
      ended: true,
      origin_lobby_slug: 'spawn-hub',
    },
  })
  assert.equal(url, '/worlds/spawn-hub')
})

test('resolveMatchReturnUrl returns null for non-completed payloads', () => {
  assert.equal(resolveMatchReturnUrl({ completion: { ended: false, origin_lobby_slug: 'x' } }), null)
  assert.equal(resolveMatchReturnUrl(null), null)
})
