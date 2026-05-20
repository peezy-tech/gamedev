import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertImportedSnapshot,
  buildSiweMessage,
  cookieHeaderFromSetCookie,
  loadSmokeConfig,
} from '../../scripts/local-world-import-smoke.mjs'

test('local world import smoke loads explicit config', () => {
  const config = loadSmokeConfig({
    WORLD_URL: 'http://127.0.0.1:47000/',
    WORLD_ID: 'hl-world',
    WORLD_IMPORT_PROJECT_DIR: '../hl-world',
    WORLD_IMPORT_ADMIN_PRIVATE_KEY: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    WORLD_IMPORT_CHAIN_ID: '42161',
    WORLD_IMPORT_EXPECT_BLUEPRINTS: '$scene,tycoon',
    WORLD_IMPORT_EXPECT_ENTITIES: 'tradeScene,d12UKcWyDG',
  })

  assert.equal(config.worldUrl, 'http://127.0.0.1:47000')
  assert.equal(config.apiUrl, 'http://127.0.0.1:47000/api')
  assert.equal(config.authUrl, 'http://127.0.0.1:47000/api/auth/identity')
  assert.equal(config.worldId, 'hl-world')
  assert.equal(config.chainId, 42161)
  assert.deepEqual(config.expectedBlueprints, ['$scene', 'tycoon'])
  assert.deepEqual(config.expectedEntities, ['tradeScene', 'd12UKcWyDG'])
})

test('local world import smoke builds a SIWE message accepted by standalone auth', () => {
  const message = buildSiweMessage({
    domain: '127.0.0.1',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    uri: 'http://127.0.0.1:47000/api/auth/identity',
    chainId: 42161,
    nonce: 'abc12345',
    issuedAt: '2026-05-19T00:00:00.000Z',
  })

  assert.match(message, /^127\.0\.0\.1 wants you to sign in with your Ethereum account:/)
  assert.match(message, /0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266/)
  assert.match(message, /URI: http:\/\/127\.0\.0\.1:47000\/api\/auth\/identity/)
  assert.match(message, /Chain ID: 42161/)
  assert.match(message, /Nonce: abc12345/)
})

test('local world import smoke extracts wallet session cookies', () => {
  assert.equal(
    cookieHeaderFromSetCookie('gamedev_wallet_session=abc123; Path=/api/auth/identity; HttpOnly; SameSite=Lax'),
    'gamedev_wallet_session=abc123',
  )
  assert.equal(
    cookieHeaderFromSetCookie('other=value; Path=/, gamedev_wallet_session=session-token; Path=/api/auth/identity'),
    'gamedev_wallet_session=session-token',
  )
})

test('local world import smoke verifies imported content identity', () => {
  const result = assertImportedSnapshot({
    worldId: 'hl-world',
    blueprints: [
      { id: '$scene' },
      { id: 'tycoon' },
    ],
    entities: [
      { id: 'tradeScene' },
      { data: { id: 'd12UKcWyDG' } },
    ],
  }, {
    worldId: 'hl-world',
    expectedBlueprints: ['$scene', 'tycoon'],
    expectedEntities: ['tradeScene', 'd12UKcWyDG'],
  })

  assert.deepEqual(result, {
    blueprintCount: 2,
    entityCount: 2,
  })
})
