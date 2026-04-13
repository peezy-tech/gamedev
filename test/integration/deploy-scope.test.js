import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { test } from 'node:test'

import { DirectAppServer } from '../../packages/app-server/direct.js'
import { AdminWsClient, fetchJson, startWorldServer, createTempDir } from './helpers.js'

async function withWorldServer(fn) {
  const world = await startWorldServer()
  try {
    return await fn(world)
  } finally {
    await world.stop()
  }
}

async function canListenOnLoopback() {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

test('deploy snapshots require global scope for multi-scope id batches', async t => {
  if (!(await canListenOnLoopback())) {
    t.skip('loopback sockets are unavailable in this environment')
    return
  }

  await withWorldServer(async world => {
    const admin = new AdminWsClient({
      worldUrl: world.worldUrl,
      adminCode: world.adminCode,
    })
    await admin.connect()
    await admin.request('blueprint_add', {
      blueprint: {
        id: 'ScopeA',
        scope: 'scope-a',
        version: 0,
        name: 'ScopeA',
        props: {},
      },
    })
    await admin.request('blueprint_add', {
      blueprint: {
        id: 'ScopeB',
        scope: 'scope-b',
        version: 0,
        name: 'ScopeB',
        props: {},
      },
    })
    admin.close()

    const scopedLock = await fetchJson(`${world.worldUrl}/admin/deploy-lock`, {
      adminCode: world.adminCode,
      method: 'POST',
      body: { owner: 'scope-lock', scope: 'scope-a' },
    })
    assert.equal(scopedLock.res.status, 200)
    const scopedSnapshot = await fetchJson(`${world.worldUrl}/admin/deploy-snapshots`, {
      adminCode: world.adminCode,
      method: 'POST',
      body: {
        ids: ['ScopeA', 'ScopeB'],
        lockToken: scopedLock.data.token,
        scope: 'scope-a',
      },
    })
    assert.equal(scopedSnapshot.res.status, 400)
    assert.equal(scopedSnapshot.data?.error, 'multi_scope_not_supported')
    await fetchJson(`${world.worldUrl}/admin/deploy-lock`, {
      adminCode: world.adminCode,
      method: 'DELETE',
      body: { token: scopedLock.data.token, scope: 'scope-a' },
    })

    const globalLock = await fetchJson(`${world.worldUrl}/admin/deploy-lock`, {
      adminCode: world.adminCode,
      method: 'POST',
      body: { owner: 'global-lock' },
    })
    assert.equal(globalLock.res.status, 200)
    const globalSnapshot = await fetchJson(`${world.worldUrl}/admin/deploy-snapshots`, {
      adminCode: world.adminCode,
      method: 'POST',
      body: {
        ids: ['ScopeA', 'ScopeB'],
        lockToken: globalLock.data.token,
      },
    })
    assert.equal(globalSnapshot.res.status, 200)
    assert.equal(globalSnapshot.data?.ok, true)
    assert.equal(globalSnapshot.data?.count, 2)
    await fetchJson(`${world.worldUrl}/admin/deploy-lock`, {
      adminCode: world.adminCode,
      method: 'DELETE',
      body: { token: globalLock.data.token },
    })
  })
})

test('script blueprint operations reject missing scope metadata', async t => {
  if (!(await canListenOnLoopback())) {
    t.skip('loopback sockets are unavailable in this environment')
    return
  }

  await withWorldServer(async world => {
    const admin = new AdminWsClient({
      worldUrl: world.worldUrl,
      adminCode: world.adminCode,
    })
    await admin.connect()

    const lock = await fetchJson(`${world.worldUrl}/admin/deploy-lock`, {
      adminCode: world.adminCode,
      method: 'POST',
      body: { owner: 'scope-metadata' },
    })
    assert.equal(lock.res.status, 200)

    try {
      await assert.rejects(
        () =>
          admin.request('blueprint_add', {
            blueprint: {
              id: 'MissingScopeScript',
              version: 0,
              name: 'Missing Scope Script',
              script: 'asset://entry.js',
              props: {},
            },
            lockToken: lock.data.token,
          }),
        err => err?.code === 'scope_unknown'
      )
    } finally {
      await fetchJson(`${world.worldUrl}/admin/deploy-lock`, {
        adminCode: world.adminCode,
        method: 'DELETE',
        body: { token: lock.data.token },
      })
      admin.close()
    }
  })
})

test('direct app-server falls back to global deploy scope for mixed blueprint scopes', async () => {
  const rootDir = await createTempDir('hyperfy-deploy-scope-')
  const server = new DirectAppServer({ worldUrl: 'http://example.com', rootDir })

  const infos = [
    {
      id: 'Mixed',
      appName: 'Mixed',
      fileBase: 'Mixed',
      configPath: '/tmp/Mixed.json',
      scriptPath: '/tmp/index.js',
    },
    {
      id: 'Mixed_2',
      appName: 'Mixed',
      fileBase: 'Mixed_2',
      configPath: '/tmp/Mixed_2.json',
      scriptPath: '/tmp/index.js',
    },
  ]
  const index = new Map(infos.map(info => [info.id, info]))

  const lockScopes = []
  const snapshotCalls = []
  server._logTarget = () => {}
  server._buildDeployPlan = async (_appName, list) => ({
    scriptInfo: null,
    changes: list.map((info, idx) => ({
      info,
      desired: { id: info.id, scope: idx === 0 ? 'scope-a' : 'scope-b' },
      current: { id: info.id, scope: idx === 0 ? 'scope-a' : 'scope-b' },
      type: 'update',
      scriptChanged: true,
      otherChanged: false,
    })),
  })
  server._withDeployLock = async (fn, options = {}) => {
    lockScopes.push(options.scope)
    return fn({ token: 'token', scope: options.scope })
  }
  server._createDeploySnapshot = async (ids, options = {}) => {
    snapshotCalls.push({ ids: [...ids], scope: options.scope })
    return { ok: true }
  }
  server._uploadScriptForApp = async () => ({
    mode: 'module',
    scriptUrl: 'asset://script.js',
    scriptEntry: 'index.js',
    scriptFiles: { 'index.js': 'asset://script.js' },
    scriptFormat: 'module',
  })
  server._deployBlueprint = async () => {}

  await server._deployBlueprintsForAppInternal('Mixed', infos, index)

  assert.equal(lockScopes.length, 1)
  assert.equal(lockScopes[0], 'global')
  assert.equal(snapshotCalls.length, 1)
  assert.deepEqual(snapshotCalls[0].ids.sort(), ['Mixed', 'Mixed_2'])
  assert.equal(snapshotCalls[0].scope, 'global')
})

test('direct app-server includes explicit scope in deploy add payloads', async () => {
  const rootDir = await createTempDir('hyperfy-deploy-payload-scope-')
  const server = new DirectAppServer({ worldUrl: 'http://example.com', rootDir })

  const appDir = path.join(rootDir, 'apps', 'ScopeApp')
  fs.mkdirSync(appDir, { recursive: true })
  const configPath = path.join(appDir, 'main.json')
  fs.writeFileSync(configPath, JSON.stringify({ props: { text: 'hello' } }, null, 2), 'utf8')

  server.snapshot = {
    worldId: 'test',
    assetsUrl: 'http://example.com/assets',
    settings: {},
    spawn: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    blueprints: new Map(),
    entities: new Map(),
  }
  server._resolveLocalBlueprintToAssetUrls = async payload => payload

  const calls = []
  server.client = {
    request: async (type, payload) => {
      calls.push({ type, payload })
      return { ok: true }
    },
    getBlueprint: async id => ({ id, version: 0, scope: 'ScopeApp' }),
  }

  const info = {
    id: 'ScopeApp',
    appName: 'ScopeApp',
    fileBase: 'main',
    configPath,
    scriptPath: path.join(appDir, 'index.js'),
  }
  const scriptInfo = {
    mode: 'module',
    scriptUrl: 'asset://entry.js',
    scriptEntry: 'index.js',
    scriptFiles: { 'index.js': 'asset://entry.js' },
    scriptFormat: 'module',
    scriptRootId: 'ScopeApp',
  }

  await server._deployBlueprint(info, scriptInfo, { lockToken: 'lock-token' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].type, 'blueprint_add')
  assert.equal(calls[0].payload?.blueprint?.scope, 'ScopeApp')
})

test('direct app-server resolves script roots per scope in mixed-scope apps', async () => {
  const rootDir = await createTempDir('hyperfy-deploy-scope-script-roots-')
  const server = new DirectAppServer({ worldUrl: 'http://example.com', rootDir })

  const appDir = path.join(rootDir, 'apps', 'MixedScope')
  fs.mkdirSync(appDir, { recursive: true })
  const writeConfig = (filename, data) => {
    fs.writeFileSync(path.join(appDir, filename), JSON.stringify(data, null, 2), 'utf8')
  }
  writeConfig('main.json', { id: 'MixedScope', scope: 'scope-a', props: {} })
  writeConfig('variant.json', { id: 'MixedScope__variant', scope: 'scope-a', props: {} })
  writeConfig('round.json', { id: 'MixedScope__round', scope: 'scope-b', props: {} })

  server.snapshot = {
    worldId: 'test',
    assetsUrl: 'http://example.com/assets',
    settings: {},
    spawn: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    blueprints: new Map(),
    entities: new Map(),
  }
  server._resolveLocalBlueprintToAssetUrls = async payload => payload
  server._safeUploadScriptForApp = async () => ({
    mode: 'module',
    scriptUrl: 'asset://entry.js',
    scriptEntry: 'index.js',
    scriptFiles: { 'index.js': 'asset://entry.js' },
    scriptFormat: 'module',
  })

  const infos = [
    {
      id: 'MixedScope',
      appName: 'MixedScope',
      fileBase: 'main',
      configPath: path.join(appDir, 'main.json'),
      scriptPath: path.join(appDir, 'index.js'),
    },
    {
      id: 'MixedScope__variant',
      appName: 'MixedScope',
      fileBase: 'variant',
      configPath: path.join(appDir, 'variant.json'),
      scriptPath: path.join(appDir, 'index.js'),
    },
    {
      id: 'MixedScope__round',
      appName: 'MixedScope',
      fileBase: 'round',
      configPath: path.join(appDir, 'round.json'),
      scriptPath: path.join(appDir, 'index.js'),
    },
  ]
  const index = new Map(infos.map(info => [info.id, info]))
  const plan = await server._buildDeployPlan('MixedScope', infos, { index })
  const desiredById = new Map(plan.changes.map(item => [item.info.id, item.desired]))

  assert.equal(desiredById.get('MixedScope').scriptRef, null)
  assert.equal(desiredById.get('MixedScope__variant').scriptRef, 'MixedScope')
  assert.equal(desiredById.get('MixedScope__round').scriptRef, null)
})

test('direct app-server aligns scope before script modify when current scope differs', async () => {
  const rootDir = await createTempDir('hyperfy-deploy-scope-preflight-')
  const server = new DirectAppServer({ worldUrl: 'http://example.com', rootDir })

  const appDir = path.join(rootDir, 'apps', 'ScopeFix')
  fs.mkdirSync(appDir, { recursive: true })
  const configPath = path.join(appDir, 'main.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        id: 'ScopeFix',
        scope: 'scope-a',
        props: {},
      },
      null,
      2
    ),
    'utf8'
  )

  const remote = {
    id: 'ScopeFix',
    version: 2,
    name: 'ScopeFix',
    scope: 'scope-b',
    script: 'asset://old.js',
    scriptEntry: 'index.js',
    scriptFiles: { 'index.js': 'asset://old.js' },
    scriptFormat: 'module',
    props: {},
  }
  const calls = []
  server.snapshot = {
    worldId: 'test',
    assetsUrl: 'http://example.com/assets',
    settings: {},
    spawn: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    blueprints: new Map([[remote.id, { ...remote }]]),
    entities: new Map(),
  }
  server._resolveLocalBlueprintToAssetUrls = async payload => payload
  server.client = {
    request: async (type, payload) => {
      calls.push({ type, payload })
      if (type === 'blueprint_modify') {
        remote.version = payload.change.version
        remote.scope = payload.change.scope ?? remote.scope
        if (typeof payload.change.script === 'string') {
          remote.script = payload.change.script
          remote.scriptEntry = payload.change.scriptEntry
          remote.scriptFiles = payload.change.scriptFiles
          remote.scriptFormat = payload.change.scriptFormat
          remote.scriptRef = payload.change.scriptRef
        }
      }
      return { ok: true }
    },
    getBlueprint: async id => (id === remote.id ? { ...remote } : null),
  }

  const info = {
    id: 'ScopeFix',
    appName: 'ScopeFix',
    fileBase: 'main',
    configPath,
    scriptPath: path.join(appDir, 'index.js'),
  }
  const scriptInfo = {
    mode: 'module',
    scriptUrl: 'asset://new.js',
    scriptEntry: 'index.js',
    scriptFiles: { 'index.js': 'asset://new.js' },
    scriptFormat: 'module',
    scriptRootId: 'ScopeFix',
  }

  await server._deployBlueprint(info, scriptInfo, { lockToken: 'lock-token' })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].type, 'blueprint_modify')
  assert.deepEqual(Object.keys(calls[0].payload.change).sort(), ['id', 'scope', 'version'])
  assert.equal(calls[1].type, 'blueprint_modify')
  assert.equal(calls[1].payload.change.scope, 'scope-a')
  assert.equal(calls[1].payload.change.script, 'asset://new.js')
})
