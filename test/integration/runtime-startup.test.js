import assert from 'node:assert/strict'
import { test } from './compat-test.js'

import { completeRuntimeStartup } from '@gamedev/server/runtimeStartup.js'

function createLogger() {
  const messages = {
    info: [],
    error: [],
  }

  return {
    logger: {
      info(message) {
        messages.info.push(message)
      },
      error(message) {
        messages.error.push(message)
      },
    },
    messages,
  }
}

test('completeRuntimeStartup requests Agones Ready before idle reconciliation', async () => {
  const events = []
  const { logger, messages } = createLogger()

  await completeRuntimeStartup({
    agones: {
      ready: async () => {
        events.push('ready')
      },
    },
    agonesIdleControllerEnabled: true,
    agonesIdleController: {
      reconcileIdleShutdown: reason => {
        events.push(`idle:${reason}`)
      },
    },
    idleTimeoutMs: 15000,
    logger,
  })

  assert.deepEqual(events, ['ready', 'idle:startup'])
  assert.deepEqual(messages.error, [])
  assert.deepEqual(messages.info, ['[agones] requested Agones Ready', '[agones-idle] enabled with timeout=15s'])
})

test('completeRuntimeStartup fails fast when Agones Ready cannot be delivered', async () => {
  const events = []
  const { logger, messages } = createLogger()

  await assert.rejects(
    completeRuntimeStartup({
      agones: {
        ready: async () => {
          events.push('ready')
          throw new Error('fetch failed')
        },
      },
      agonesIdleControllerEnabled: true,
      agonesIdleController: {
        reconcileIdleShutdown: reason => {
          events.push(`idle:${reason}`)
        },
      },
      logger,
    }),
    /fetch failed/
  )

  assert.deepEqual(events, ['ready'])
  assert.deepEqual(messages.info, [])
  assert.deepEqual(messages.error, ['[agones] failed to request Agones Ready (fetch failed)'])
})

test('completeRuntimeStartup skips Agones Ready when requestAgonesReady is false', async () => {
  const events = []
  const { logger, messages } = createLogger()

  await completeRuntimeStartup({
    agones: {
      ready: async () => {
        events.push('ready')
      },
    },
    agonesIdleControllerEnabled: true,
    agonesIdleController: {
      reconcileIdleShutdown: reason => {
        events.push(`idle:${reason}`)
      },
    },
    idleTimeoutMs: 15000,
    requestAgonesReady: false,
    logger,
  })

  assert.deepEqual(events, ['idle:startup'])
  assert.deepEqual(messages.error, [])
  assert.deepEqual(messages.info, ['[agones-idle] enabled with timeout=15s'])
})
