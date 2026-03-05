import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowWorldIdConfigMismatch, validateWorldIdConfig } from '../../src/server/worldIdMismatch.js'

test('allowWorldIdConfigMismatch is strict by default', () => {
  assert.equal(allowWorldIdConfigMismatch({}), false)
  assert.equal(allowWorldIdConfigMismatch({ ALLOW_WORLD_ID_CONFIG_MISMATCH: 'false' }), false)
  assert.equal(allowWorldIdConfigMismatch({ ALLOW_WORLD_ID_CONFIG_MISMATCH: 'TRUE' }), true)
})

test('validateWorldIdConfig throws on mismatch when flag is disabled', () => {
  assert.throws(
    () => validateWorldIdConfig({
      envWorldId: 'match-world',
      dbWorldId: 'studio-world',
      env: { ALLOW_WORLD_ID_CONFIG_MISMATCH: 'false' },
    }),
    /WORLD_ID mismatch/
  )
})

test('validateWorldIdConfig allows mismatch when flag is enabled', () => {
  const result = validateWorldIdConfig({
    envWorldId: 'match-world',
    dbWorldId: 'studio-world',
    env: { ALLOW_WORLD_ID_CONFIG_MISMATCH: 'true' },
  })
  assert.deepEqual(result, {
    mismatch: true,
    allowed: true,
  })
})
