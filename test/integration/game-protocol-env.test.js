import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

import { getRepoRoot } from './helpers.js'

const repoRoot = getRepoRoot()
const digest = `ghcr.io/load-game/gamedev@sha256:${'a'.repeat(64)}`

function runDoctor(env, args = ['--allow-placeholders']) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/validate-game-protocol-env.mjs', ...args], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'test',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', code => {
      const result = { code, stdout, stderr }
      if (code === 0) {
        resolve(result)
        return
      }
      reject(Object.assign(new Error(`doctor failed (${code})\n${stdout}\n${stderr}`.trim()), result))
    })
  })
}

function authoritativeSessionEnv(overrides = {}) {
  return {
    GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
    PUBLIC_API_URL: 'https://placeholder-runtime.example/api',
    PUBLIC_REQUIRE_WALLET_AUTH: 'true',
    GAME_PROTOCOL_RUNTIME_IMAGE: digest,
    GAME_PROTOCOL_RUNTIME_CAPACITY: '50',
    GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
    GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'push',
    GAME_PROTOCOL_RUNTIME_WORLD_ID: 'hl-world',
    GAME_PROTOCOL_RUNTIME_WORLD_SLUG: 'hl-world',
    GAME_PROTOCOL_RUNTIME_DB_SCHEMA: 'hl_world',
    GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify({
      ASSETS: 's3',
      ASSETS_BASE_URL: 'https://assets.load.game',
      SAVE_INTERVAL: '60',
      STANDALONE_WALLET_AUTH: 'true',
      REQUIRE_WALLET_AUTH: 'true',
      PUBLIC_REQUIRE_WALLET_AUTH: 'true',
      CORS_ORIGINS: 'https://games.example',
      HYPERLIQUID_DATA_URL: 'https://staging.peezy.tech/devnet/hyperliquid',
    }),
    GAME_PROTOCOL_RUNTIME_SECRET_ENV: JSON.stringify([
      { name: 'DB_URI', secretName: 'lobby-db-uri', secretKey: 'uri' },
      { name: 'ASSETS_S3_URI', secretName: 'lobby-assets-s3', secretKey: 'uri' },
      { name: 'JWT_SECRET', secretName: 'lobby-jwt', secretKey: 'secret' },
      { name: 'STANDALONE_ADMIN_WALLETS', secretName: 'lobby-admin-wallets', secretKey: 'wallets' },
    ]),
    GAME_PROTOCOL_RUNTIME_KUBERNETES: JSON.stringify({
      imagePullSecrets: ['ghcr-secret'],
      nodeSelector: { 'lobby/pool': 'gs' },
      resources: {
        requests: { cpu: '100m', memory: '256Mi' },
        limits: { cpu: '1', memory: '1Gi' },
      },
      tlsSecret: { name: 'gameserver-wildcard-tls' },
    }),
    ...overrides,
  }
}

function hlWorldRunbookEnv(overrides = {}) {
  return authoritativeSessionEnv({
    PUBLIC_API_URL: 'https://placeholder-runtime.example/api',
    PUBLIC_REQUIRE_WALLET_AUTH: 'true',
    GAME_PROTOCOL_RUNTIME_IMAGE: digest,
    GAME_PROTOCOL_RUNTIME_CAPACITY: '50',
    GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
    GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'push',
    GAME_PROTOCOL_RUNTIME_WORLD_ID: 'hl-world',
    GAME_PROTOCOL_RUNTIME_WORLD_SLUG: 'hl-world',
    GAME_PROTOCOL_RUNTIME_DB_SCHEMA: 'hl_world',
    GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify({
      ASSETS: 's3',
      ASSETS_BASE_URL: 'https://assets.load.game',
      SAVE_INTERVAL: '60',
      STANDALONE_WALLET_AUTH: 'true',
      REQUIRE_WALLET_AUTH: 'true',
      PUBLIC_REQUIRE_WALLET_AUTH: 'true',
      CORS_ORIGINS: 'https://staging.peezy.tech',
      HYPERLIQUID_DATA_URL: 'https://staging.peezy.tech/devnet/hyperliquid',
    }),
    GAME_PROTOCOL_RUNTIME_SECRET_ENV: JSON.stringify([
      { name: 'DB_URI', secretName: 'lobby-db-uri', secretKey: 'uri' },
      { name: 'ASSETS_S3_URI', secretName: 'lobby-assets-s3', secretKey: 'uri' },
      { name: 'JWT_SECRET', secretName: 'lobby-jwt', secretKey: 'secret' },
      { name: 'STANDALONE_ADMIN_WALLETS', secretName: 'lobby-admin-wallets', secretKey: 'wallets' },
    ]),
    GAME_PROTOCOL_RUNTIME_KUBERNETES: JSON.stringify({
      imagePullSecrets: ['ghcr-secret'],
      nodeSelector: { 'lobby/pool': 'gs' },
      resources: {
        requests: { cpu: '100m', memory: '256Mi' },
        limits: { cpu: '1', memory: '1Gi' },
      },
      tlsSecret: { name: 'gameserver-wildcard-tls' },
    }),
    ...overrides,
  })
}

test('game-protocol doctor accepts the runtime-control authoritative-session launch shape', async () => {
  const result = await runDoctor(authoritativeSessionEnv())

  assert.match(result.stdout, /Game Protocol launch env is valid/)
})

test('game-protocol doctor accepts the staging hl-world runbook launch profile', async () => {
  const result = await runDoctor(hlWorldRunbookEnv())

  assert.match(result.stdout, /Game Protocol launch env is valid/)
})

test('game-protocol doctor rejects mutable runtime-control images', async () => {
  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_IMAGE: 'ghcr.io/load-game/gamedev:latest',
    })),
    /GAME_PROTOCOL_RUNTIME_IMAGE must be an immutable image digest/
  )
})

test('game-protocol doctor rejects fixed public runtime URLs in managed runtime env', async () => {
  const serverEnv = JSON.parse(authoritativeSessionEnv().GAME_PROTOCOL_RUNTIME_ENV)
  serverEnv.PUBLIC_API_URL = 'https://fixed-runtime.example/api'

  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify(serverEnv),
    })),
    /must not hardcode PUBLIC_API_URL, PUBLIC_WS_URL, PUBLIC_AUTH_URL, or PUBLIC_ADMIN_URL/
  )
})

test('game-protocol doctor rejects fixed public admin URLs in managed runtime env', async () => {
  const serverEnv = JSON.parse(authoritativeSessionEnv().GAME_PROTOCOL_RUNTIME_ENV)
  serverEnv.PUBLIC_ADMIN_URL = 'https://fixed-runtime.example/admin'

  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify(serverEnv),
    })),
    /must not hardcode PUBLIC_API_URL, PUBLIC_WS_URL, PUBLIC_AUTH_URL, or PUBLIC_ADMIN_URL/
  )
})

test('game-protocol doctor rejects path-like CORS origins for managed runtimes', async () => {
  const serverEnv = JSON.parse(authoritativeSessionEnv().GAME_PROTOCOL_RUNTIME_ENV)
  serverEnv.CORS_ORIGINS = 'https://staging.peezy.tech/devnet/trove'

  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify(serverEnv),
    })),
    /GAME_PROTOCOL_RUNTIME_ENV\.CORS_ORIGINS origin must be an origin without path, query, hash, or credentials/
  )
})

test('game-protocol doctor rejects invalid managed runtime database schemas', async () => {
  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_DB_SCHEMA: 'hl-world',
    })),
    /GAME_PROTOCOL_RUNTIME_DB_SCHEMA must be a valid database schema identifier/
  )
})

test('game-protocol doctor rejects missing managed runtime database schemas', async () => {
  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_DB_SCHEMA: '',
    })),
    /GAME_PROTOCOL_RUNTIME_DB_SCHEMA is required/
  )
})

test('game-protocol doctor rejects invalid managed runtime regions', async () => {
  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_REGIONS: 'use,us east',
    })),
    /GAME_PROTOCOL_RUNTIME_REGIONS contains an invalid region: us east/
  )
})

test('game-protocol doctor rejects missing managed runtime regions', async () => {
  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_REGIONS: '',
    })),
    /GAME_PROTOCOL_RUNTIME_REGIONS must include at least one region/
  )
})

test('game-protocol doctor rejects runtime-control-managed runtime env names', async () => {
  const serverEnv = JSON.parse(authoritativeSessionEnv().GAME_PROTOCOL_RUNTIME_ENV)
  serverEnv.DIRECT_WSS_PORT = '7000'

  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify(serverEnv),
    })),
    /GAME_PROTOCOL_RUNTIME_ENV\.DIRECT_WSS_PORT is managed by runtime-control/
  )
})

test('game-protocol doctor rejects non-https Hyperliquid data service URLs', async () => {
  const serverEnv = JSON.parse(hlWorldRunbookEnv().GAME_PROTOCOL_RUNTIME_ENV)
  serverEnv.HYPERLIQUID_DATA_URL = 'http://staging.peezy.tech/devnet/hyperliquid'

  await assert.rejects(
    runDoctor(hlWorldRunbookEnv({
      GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify(serverEnv),
    })),
    /GAME_PROTOCOL_RUNTIME_ENV\.HYPERLIQUID_DATA_URL must use https:/
  )
})

test('game-protocol doctor rejects path-like CORS origins for fixed runtimes', async () => {
  await assert.rejects(
    runDoctor({
      STANDALONE_WALLET_AUTH: 'true',
      REQUIRE_WALLET_AUTH: 'true',
      PUBLIC_REQUIRE_WALLET_AUTH: 'true',
      ASSETS: 'asset-service',
      WORLD_ID: 'hl-world',
      PUBLIC_API_URL: 'https://runtime.example/api',
      PUBLIC_WS_URL: 'wss://runtime.example/ws',
      PUBLIC_AUTH_URL: 'https://runtime.example/api/auth/identity',
      ASSET_SERVICE_URL: 'http://asset-service:8787',
      CORS_ORIGINS: 'https://games.example/g/hl-world',
      STANDALONE_ADMIN_WALLETS: '0x1111111111111111111111111111111111111111',
      ASSET_SERVICE_API_KEY: 'asset-secret',
      JWT_SECRET: 'jwt-secret-for-launch-tests',
    }),
    /CORS origin must be an origin without path, query, hash, or credentials/
  )
})

test('game-protocol doctor requires the runtime image pull secret', async () => {
  const kubernetes = JSON.parse(authoritativeSessionEnv().GAME_PROTOCOL_RUNTIME_KUBERNETES)
  kubernetes.imagePullSecrets = ['other-secret']

  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_KUBERNETES: JSON.stringify(kubernetes),
    })),
    /GAME_PROTOCOL_RUNTIME_KUBERNETES\.imagePullSecrets must include ghcr-secret/
  )
})

test('game-protocol doctor requires the GameServer node pool selector', async () => {
  const kubernetes = JSON.parse(authoritativeSessionEnv().GAME_PROTOCOL_RUNTIME_KUBERNETES)
  kubernetes.nodeSelector = { 'lobby/pool': 'core' }

  await assert.rejects(
    runDoctor(authoritativeSessionEnv({
      GAME_PROTOCOL_RUNTIME_KUBERNETES: JSON.stringify(kubernetes),
    })),
    /GAME_PROTOCOL_RUNTIME_KUBERNETES\.nodeSelector must target GameServer nodes with lobby\/pool=gs/
  )
})
