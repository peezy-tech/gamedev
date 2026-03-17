import assert from 'node:assert/strict'
import net from 'node:net'
import { test } from 'node:test'

import { buildRuntimeBootstrapAuthorization } from '../../src/server/runtimeBootstrap.js'
import { startStandbyRuntimeServer, waitFor } from './helpers.js'

function toWsUrl(httpUrl) {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`
  return httpUrl
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

test('runtime boots into standby with pre-init bootstrap status', async t => {
  if (!(await canListenOnLoopback())) {
    t.skip('loopback sockets are unavailable in this environment')
    return
  }

  const server = await startStandbyRuntimeServer()
  t.after(async () => {
    await server.stop()
  })

  const healthzRes = await fetch(`${server.worldUrl}/healthz`)
  const healthz = await healthzRes.json()
  assert.equal(healthzRes.status, 200)
  assert.equal(healthz.ok, true)
  assert.equal(healthz.state, 'standby')

  const healthRes = await fetch(`${server.worldUrl}/health`)
  const health = await healthRes.json()
  assert.equal(healthRes.status, 503)
  assert.equal(health.ok, false)
  assert.equal(health.state, 'standby')

  const statusRes = await fetch(`${server.worldUrl}/internal/bootstrap/status`)
  const status = await statusRes.json()
  assert.equal(statusRes.status, 200)
  assert.equal(status.state, 'standby')
  assert.equal(status.runtime.instanceId, server.runtimeInstanceId)
  assert.equal(status.world.id, null)
})

test('runtime accepts bootstrap push and transitions to ready', async t => {
  if (!(await canListenOnLoopback())) {
    t.skip('loopback sockets are unavailable in this environment')
    return
  }

  const server = await startStandbyRuntimeServer()
  t.after(async () => {
    await server.stop()
  })

  const worldId = `world-${server.runtimeInstanceId}`
  const authorization = buildRuntimeBootstrapAuthorization(server.runtimeInstanceId, server.jwtSecret)

  const response = await fetch(`${server.worldUrl}/internal/bootstrap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization,
    },
    body: JSON.stringify({
      bootstrapId: `${worldId}:${server.runtimeInstanceId}`,
      world: {
        id: worldId,
        slug: 'standby-world',
        publicMaxUploadSize: 12,
        shutdownIdleSeconds: 0,
      },
      runtime: {
        instanceId: server.runtimeInstanceId,
        publicApiUrl: `${server.worldUrl}/api`,
      },
      auth: {},
      control: {
        internalBaseUrl: 'http://world-service.internal/api',
      },
    }),
  })
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.status.state, 'ready')
  assert.equal(payload.status.world.id, worldId)
  assert.equal(payload.status.runtime.publicWsUrl, `${toWsUrl(server.worldUrl)}/ws`)

  await waitFor(async () => {
    const res = await fetch(`${server.worldUrl}/health`)
    return res.ok
  })

  const runtimeStatusRes = await fetch(`${server.worldUrl}/status`)
  const runtimeStatus = await runtimeStatusRes.json()
  assert.equal(runtimeStatusRes.status, 200)
  assert.equal(runtimeStatus.ok, true)
  assert.equal(runtimeStatus.state, 'ready')
  assert.equal(runtimeStatus.worldId, worldId)

  const bootstrapStatusRes = await fetch(`${server.worldUrl}/internal/bootstrap/status`)
  const bootstrapStatus = await bootstrapStatusRes.json()
  assert.equal(bootstrapStatusRes.status, 200)
  assert.equal(bootstrapStatus.state, 'ready')
  assert.equal(bootstrapStatus.world.id, worldId)
  assert.equal(bootstrapStatus.control.internalBaseUrl, 'http://world-service.internal/api')
})
