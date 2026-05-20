import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import fs from 'fs-extra'

import { createTempDir, getRepoRoot } from './helpers.js'

const repoRoot = getRepoRoot()
const runtimeImage = `ghcr.io/load-game/gamedev@sha256:${'a'.repeat(64)}`

function runDescriptor(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/write-runtime-descriptor.mjs'], {
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
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`descriptor writer failed (${code})\n${stdout}\n${stderr}`.trim()))
    })
  })
}

function hlWorldRunbookDescriptorEnv(outPath, overrides = {}) {
  return {
    GAME_PROTOCOL_RUNTIME_DESCRIPTOR: outPath,
    GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
    GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
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
  }
}

test('write-runtime-descriptor writes a fixed external-authoritative runtime descriptor', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    const outPath = path.join(dir, 'runtime.json')
    await runDescriptor({
      GAME_PROTOCOL_RUNTIME_DESCRIPTOR: outPath,
      PUBLIC_API_URL: 'https://runtime.example/api',
      PUBLIC_WS_URL: 'wss://runtime.example/ws',
      PUBLIC_AUTH_URL: 'https://runtime.example/api/auth/identity',
      ASSETS_BASE_URL: 'https://runtime.example/assets',
      GAME_PROTOCOL_STATE_MODE: 'database',
    })

    const descriptor = await fs.readJson(outPath)
    assert.deepEqual(descriptor, {
      kind: 'external-authoritative',
      endpoints: {
        apiUrl: 'https://runtime.example/api',
        wsUrl: 'wss://runtime.example/ws',
        healthUrl: 'https://runtime.example/health',
        authUrl: 'https://runtime.example/api/auth/identity',
        assetsBaseUrl: 'https://runtime.example/assets',
      },
      state: {
        mode: 'database',
      },
    })
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor writes a runtime-control authoritative-session descriptor', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    const outPath = path.join(dir, 'runtime.json')
    await runDescriptor({
      GAME_PROTOCOL_RUNTIME_DESCRIPTOR: outPath,
      GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
      GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
      GAME_PROTOCOL_RUNTIME_CAPACITY: '50',
      GAME_PROTOCOL_RUNTIME_REGIONS: 'use,euc',
      GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'push',
      GAME_PROTOCOL_RUNTIME_WORLD_ID: 'hl-world',
      GAME_PROTOCOL_RUNTIME_WORLD_SLUG: 'hl-world',
      GAME_PROTOCOL_RUNTIME_DB_SCHEMA: 'hl_world',
      GAME_PROTOCOL_RUNTIME_PUBLIC_MAX_UPLOAD_SIZE: '1048576',
      GAME_PROTOCOL_RUNTIME_SHUTDOWN_IDLE_SECONDS: '60',
      GAME_PROTOCOL_RUNTIME_ENV: JSON.stringify({
        ASSETS: 's3',
        SAVE_INTERVAL: '60',
        HYPERLIQUID_DATA_URL: 'https://staging.peezy.tech/devnet/hyperliquid',
      }),
      GAME_PROTOCOL_RUNTIME_SECRET_ENV: JSON.stringify([
        { name: 'DB_URI', secretName: 'lobby-db-uri', secretKey: 'uri' },
        { name: 'JWT_SECRET', secretName: 'lobby-jwt', secretKey: 'secret' },
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
      GAME_PROTOCOL_STATE_MODE: 'hybrid',
    })

    const descriptor = await fs.readJson(outPath)
    assert.deepEqual(descriptor, {
      kind: 'authoritative-session',
      server: {
        image: runtimeImage,
        port: 3000,
        capacity: 50,
        protocol: 'wss',
        healthPath: '/health',
        wsPath: '/ws',
        regions: ['use', 'euc'],
        bootstrap: {
          mode: 'push',
          worldId: 'hl-world',
          worldSlug: 'hl-world',
          dbSchema: 'hl_world',
          publicMaxUploadSize: 1048576,
          shutdownIdleSeconds: 60,
        },
        env: {
          ASSETS: 's3',
          SAVE_INTERVAL: '60',
          HYPERLIQUID_DATA_URL: 'https://staging.peezy.tech/devnet/hyperliquid',
        },
        secretEnv: [
          { name: 'DB_URI', secretName: 'lobby-db-uri', secretKey: 'uri' },
          { name: 'JWT_SECRET', secretName: 'lobby-jwt', secretKey: 'secret' },
        ],
        kubernetes: {
          imagePullSecrets: ['ghcr-secret'],
          nodeSelector: { 'lobby/pool': 'gs' },
          resources: {
            requests: { cpu: '100m', memory: '256Mi' },
            limits: { cpu: '1', memory: '1Gi' },
          },
          tlsSecret: { name: 'gameserver-wildcard-tls' },
        },
      },
      state: {
        mode: 'hybrid',
      },
    })
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor writes the staging hl-world runbook descriptor', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    const outPath = path.join(dir, 'runtime.json')
    await runDescriptor(hlWorldRunbookDescriptorEnv(outPath))

    const descriptor = await fs.readJson(outPath)
    assert.equal(descriptor.kind, 'authoritative-session')
    assert.equal(descriptor.server.image, runtimeImage)
    assert.equal(descriptor.server.capacity, 50)
    assert.equal(descriptor.server.protocol, 'wss')
    assert.deepEqual(descriptor.server.regions, ['use'])
    assert.deepEqual(descriptor.server.bootstrap, {
      mode: 'push',
      worldId: 'hl-world',
      worldSlug: 'hl-world',
      dbSchema: 'hl_world',
    })
    assert.deepEqual(descriptor.server.env, {
      ASSETS: 's3',
      ASSETS_BASE_URL: 'https://assets.load.game',
      SAVE_INTERVAL: '60',
      STANDALONE_WALLET_AUTH: 'true',
      REQUIRE_WALLET_AUTH: 'true',
      PUBLIC_REQUIRE_WALLET_AUTH: 'true',
      CORS_ORIGINS: 'https://staging.peezy.tech',
      HYPERLIQUID_DATA_URL: 'https://staging.peezy.tech/devnet/hyperliquid',
    })
    assert.deepEqual(descriptor.server.secretEnv, [
      { name: 'DB_URI', secretName: 'lobby-db-uri', secretKey: 'uri' },
      { name: 'ASSETS_S3_URI', secretName: 'lobby-assets-s3', secretKey: 'uri' },
      { name: 'JWT_SECRET', secretName: 'lobby-jwt', secretKey: 'secret' },
      { name: 'STANDALONE_ADMIN_WALLETS', secretName: 'lobby-admin-wallets', secretKey: 'wallets' },
    ])
    assert.deepEqual(descriptor.server.kubernetes, {
      imagePullSecrets: ['ghcr-secret'],
      nodeSelector: { 'lobby/pool': 'gs' },
      resources: {
        requests: { cpu: '100m', memory: '256Mi' },
        limits: { cpu: '1', memory: '1Gi' },
      },
      tlsSecret: { name: 'gameserver-wildcard-tls' },
    })
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor rejects mutable runtime-control images', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: 'ghcr.io/load-game/gamedev:latest',
      }),
      /GAME_PROTOCOL_RUNTIME_IMAGE must be an immutable image digest/
    )
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor rejects missing runtime-control regions', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
      }),
      /GAME_PROTOCOL_RUNTIME_REGIONS must include at least one region/
    )
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor rejects invalid runtime-control regions', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
        GAME_PROTOCOL_RUNTIME_REGIONS: 'use,us east',
      }),
      /GAME_PROTOCOL_RUNTIME_REGIONS contains an invalid region: us east/
    )
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor requires push bootstrap for runtime-control descriptors', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
        GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
      }),
      /GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE must be push/
    )
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
        GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
        GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'pull',
      }),
      /GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE must be push/
    )
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor requires runtime-control bootstrap world identity', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
        GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
        GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'push',
      }),
      /GAME_PROTOCOL_RUNTIME_WORLD_ID is required/
    )
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
        GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
        GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'push',
        GAME_PROTOCOL_RUNTIME_WORLD_ID: 'hl-world',
      }),
      /GAME_PROTOCOL_RUNTIME_WORLD_SLUG is required/
    )
  } finally {
    await fs.remove(dir)
  }
})

test('write-runtime-descriptor requires a valid runtime-control database schema', async () => {
  const dir = await createTempDir('runtime-descriptor-')
  try {
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
        GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
        GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'push',
        GAME_PROTOCOL_RUNTIME_WORLD_ID: 'hl-world',
        GAME_PROTOCOL_RUNTIME_WORLD_SLUG: 'hl-world',
      }),
      /GAME_PROTOCOL_RUNTIME_DB_SCHEMA is required/
    )
    await assert.rejects(
      runDescriptor({
        GAME_PROTOCOL_RUNTIME_DESCRIPTOR: path.join(dir, 'runtime.json'),
        GAME_PROTOCOL_RUNTIME_KIND: 'authoritative-session',
        GAME_PROTOCOL_RUNTIME_IMAGE: runtimeImage,
        GAME_PROTOCOL_RUNTIME_REGIONS: 'use',
        GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE: 'push',
        GAME_PROTOCOL_RUNTIME_WORLD_ID: 'hl-world',
        GAME_PROTOCOL_RUNTIME_WORLD_SLUG: 'hl-world',
        GAME_PROTOCOL_RUNTIME_DB_SCHEMA: 'hl-world',
      }),
      /GAME_PROTOCOL_RUNTIME_DB_SCHEMA must be a valid database schema identifier/
    )
  } finally {
    await fs.remove(dir)
  }
})
