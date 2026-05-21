import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { test } from 'vite-plus/test'

import { getRepoRoot, startStandbyRuntimeServer } from './helpers.js'

function collectChildResult(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
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

test('bootstrap-runtime script binds a standby runtime and waits for ready', async t => {
  if (!(await canListenOnLoopback())) {
    t.skip('loopback sockets are unavailable in this environment')
    return
  }

  const server = await startStandbyRuntimeServer()
  t.onTestFinished(async () => {
    await server.stop()
  })
  const worldId = `script-${server.runtimeInstanceId}`
  const port = new URL(server.worldUrl).port

  const child = spawn(
    process.execPath,
    ['scripts/bootstrap-runtime.mjs', '--env', 'none', '--world-id', worldId, '--world-slug', 'script-world'],
    {
      cwd: getRepoRoot(),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: port,
        JWT_SECRET: server.jwtSecret,
        RUNTIME_BOOTSTRAP: '1',
        RUNTIME_BOOTSTRAP_INSTANCE_ID: server.runtimeInstanceId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  const result = await collectChildResult(child)
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`.trim())
  assert.equal(result.signal, null)

  const statusResponse = await fetch(`${server.worldUrl}/internal/bootstrap/status`)
  const status = await statusResponse.json()
  assert.equal(statusResponse.status, 200)
  assert.equal(status.state, 'ready')
  assert.equal(status.world.id, worldId)
  assert.equal(status.runtime.instanceId, server.runtimeInstanceId)
})
