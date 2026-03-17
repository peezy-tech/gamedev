import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyHostedRuntimeBootstrapPayload,
  derivePublicWsUrlFromApiUrl,
  resolveRuntimeWorldDir,
  resolveHostedRuntimeBootstrapUrl,
  usesHostedRuntimeBootstrap,
} from '../../src/server/runtimeBootstrap.js'

test('applyHostedRuntimeBootstrapPayload backfills hosted runtime world binding', () => {
  const env = {
    RUNTIME_BOOTSTRAP_URL: 'https://dev.lobby.ws/internal/runtime/bootstrap',
    JWT_SECRET: 'secret',
    WORLD_ID: 'world-1',
  }

  const applied = applyHostedRuntimeBootstrapPayload(env, {
    world: {
      id: 'world-1',
      slug: 'demo-world',
      dbSchema: 'world_world_1',
      publicMaxUploadSize: 3,
      publicWorldMaxPlayers: 0,
      shutdownIdleSeconds: 120,
    },
    runtime: {
      publicApiUrl: 'https://gs.example.com:7000/api',
      publicWsUrl: 'wss://gs.example.com:7000/ws',
    },
    auth: {
      publicAuthUrl: 'https://dev.lobby.ws/identity',
      publicPrivyAppId: 'privy-app-id',
    },
  })

  assert.deepEqual(applied, [
    'WORLD_ID',
    'WORLD',
    'DB_SCHEMA',
    'PUBLIC_MAX_UPLOAD_SIZE',
    'PUBLIC_WORLD_MAX_PLAYERS',
    'SHUTDOWN_IDLE',
    'PUBLIC_API_URL',
    'PUBLIC_WS_URL',
    'PUBLIC_AUTH_URL',
    'PUBLIC_PRIVY_APP_ID',
  ])
  assert.equal(env.WORLD, '.runtime-worlds/demo-world')
  assert.equal(env.DB_SCHEMA, 'world_world_1')
  assert.equal(env.PUBLIC_MAX_UPLOAD_SIZE, '3')
  assert.equal(env.PUBLIC_WORLD_MAX_PLAYERS, '0')
  assert.equal(env.SHUTDOWN_IDLE, '120')
  assert.equal(env.PUBLIC_API_URL, 'https://gs.example.com:7000/api')
  assert.equal(env.PUBLIC_WS_URL, 'wss://gs.example.com:7000/ws')
  assert.equal(env.PUBLIC_PRIVY_APP_ID, 'privy-app-id')
})

test('usesHostedRuntimeBootstrap requires an explicit bootstrap endpoint', () => {
  assert.equal(usesHostedRuntimeBootstrap({ PUBLIC_AUTH_URL: 'https://dev.lobby.ws/identity' }), false)
  assert.equal(
    usesHostedRuntimeBootstrap({ RUNTIME_BOOTSTRAP_URL: 'https://dev.lobby.ws/internal/runtime/bootstrap' }),
    true
  )
  assert.equal(
    resolveHostedRuntimeBootstrapUrl({
      RUNTIME_BOOTSTRAP_URL: 'https://dev.lobby.ws/internal/runtime/bootstrap/',
    }),
    'https://dev.lobby.ws/internal/runtime/bootstrap'
  )
})

test('applyHostedRuntimeBootstrapPayload respects an explicit WORLD path and derives ws url from api url', () => {
  const env = {
    WORLD: '/tmp/custom-world',
  }

  const applied = applyHostedRuntimeBootstrapPayload(env, {
    world: {
      id: 'world-2',
      slug: 'demo-two',
      dbSchema: 'world_world_2',
      publicMaxUploadSize: 12,
      publicWorldMaxPlayers: 25,
      shutdownIdleSeconds: 0,
    },
    runtime: {
      publicApiUrl: 'https://gs.example.com:9443/api',
      publicWsUrl: null,
    },
    auth: {},
  })

  assert.ok(!applied.includes('WORLD'))
  assert.equal(env.WORLD, '/tmp/custom-world')
  assert.equal(env.PUBLIC_WS_URL, 'wss://gs.example.com:9443/ws')
})

test('resolveRuntimeWorldDir falls back to a hosted runtime scratch directory', () => {
  const worldDir = resolveRuntimeWorldDir(
    {
      WORLD_ID: 'world-3',
    },
    '/srv/runtime'
  )

  assert.equal(worldDir, '/srv/runtime/.runtime-worlds/world-3')
  assert.equal(derivePublicWsUrlFromApiUrl('https://dev.lobby.ws/api'), 'wss://dev.lobby.ws/ws')
})
