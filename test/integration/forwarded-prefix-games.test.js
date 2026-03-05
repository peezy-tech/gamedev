import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveAdminUrlFromRequest, extractRuntimePrefixFromPath } from '../../src/server/forwardedPrefix.js'

test('extractRuntimePrefixFromPath supports /games studio and matches prefixes', () => {
  assert.equal(
    extractRuntimePrefixFromPath('/games/duel/studio/admin/snapshot'),
    '/games/duel/studio'
  )
  assert.equal(
    extractRuntimePrefixFromPath('/games/duel/matches/match_1/admin/changes?cursor=1'),
    '/games/duel/matches/match_1'
  )
})

test('deriveAdminUrlFromRequest resolves /games studio prefix from forwarded uri', () => {
  const url = deriveAdminUrlFromRequest({
    headers: {
      host: 'dev.lobby.ws',
      'x-forwarded-proto': 'https',
      'x-forwarded-uri': '/games/race/studio/admin/snapshot',
    },
  })
  assert.equal(url, 'https://dev.lobby.ws/games/race/studio')
})

test('deriveAdminUrlFromRequest resolves /games match prefix from request url fallback', () => {
  const url = deriveAdminUrlFromRequest({
    headers: {
      host: 'dev.lobby.ws',
      'x-forwarded-proto': 'https',
    },
    url: '/games/race/matches/match_99/admin/changes',
  })
  assert.equal(url, 'https://dev.lobby.ws/games/race/matches/match_99')
})
