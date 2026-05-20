import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertSpawnMatches,
  assignSecondaryRuntime,
  loadSharedStateSmokeConfig,
} from '../../scripts/local-world-shared-state-smoke.mjs'

test('local world shared-state smoke loads config', () => {
  const config = loadSharedStateSmokeConfig({
    WORLD_SHARED_STATE_PRIMARY_URL: 'http://127.0.0.1:47000/',
    WORLD_ID: 'hl-world',
    GAME_TROVE_URL: 'http://127.0.0.1:8790/',
    WORLD_IMPORT_ADMIN_PRIVATE_KEY: '0xabc',
    WORLD_IMPORT_CHAIN_ID: '42161',
    WORLD_SHARED_STATE_SECONDARY_MATCH_KEY: 'match-a',
    WORLD_SHARED_STATE_SECONDARY_PLAYER_ID: 'player-a',
    WORLD_SHARED_STATE_SPAWN_POSITION: '1,2,3',
    WORLD_SHARED_STATE_SPAWN_QUATERNION: '0,0,0,1',
    RUNTIME_CONTROL_URL: 'http://127.0.0.1:8792/',
    RUNTIME_CONTROL_API_KEY: 'runtime-key',
  })

  assert.equal(config.primaryWorldUrl, 'http://127.0.0.1:47000')
  assert.equal(config.primaryAuthUrl, 'http://127.0.0.1:47000/api/auth/identity')
  assert.equal(config.primaryApiUrl, 'http://127.0.0.1:47000/api')
  assert.equal(config.gameTroveUrl, 'http://127.0.0.1:8790')
  assert.equal(config.gameSlug, 'hl-world')
  assert.equal(config.matchKey, 'match-a')
  assert.equal(config.playerId, 'player-a')
  assert.deepEqual(config.spawnPosition, [1, 2, 3])
  assert.deepEqual(config.spawnQuaternion, [0, 0, 0, 1])
  assert.equal(config.runtimeControlUrl, 'http://127.0.0.1:8792')
  assert.equal(config.runtimeControlApiKey, 'runtime-key')
})

test('local world shared-state smoke validates spawn values', () => {
  assert.doesNotThrow(() => {
    assertSpawnMatches({
      spawn: {
        position: [1, 2, 3],
        quaternion: [0, 0.38268341, 0, 0.92387949],
      },
    }, {
      position: [1, 2, 3],
      quaternion: [0, 0.3826834, 0, 0.9238795],
    })
  })

  assert.throws(() => {
    assertSpawnMatches({
      spawn: {
        position: [1, 2, 4],
        quaternion: [0, 0, 0, 1],
      },
    }, {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
    })
  }, /spawn position mismatch/)
})

test('local world shared-state smoke assigns a secondary runtime through game-trove', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return Response.json({
      assignment: {
        instanceId: 'inst-secondary',
        runtimeInstanceId: 'gs-secondary',
        endpoints: {
          apiUrl: 'http://127.0.0.1:47001/api',
        },
      },
    })
  }
  try {
    const result = await assignSecondaryRuntime({
      gameTroveUrl: 'http://127.0.0.1:8790',
      gameSlug: 'hl-world',
      matchKey: 'match-a',
      playerId: 'player-a',
    })
    assert.equal(result.instanceId, 'inst-secondary')
    assert.equal(result.runtimeInstanceId, 'gs-secondary')
    assert.equal(result.worldUrl, 'http://127.0.0.1:47001')
    assert.equal(calls[0].url, 'http://127.0.0.1:8790/api/games/hl-world/runtime-assignment')
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      mode: 'match',
      matchKey: 'match-a',
      player: { id: 'player-a' },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
