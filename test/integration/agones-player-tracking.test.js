import assert from 'node:assert/strict'
import EventEmitter from 'node:events'
import { setImmediate as setImmediatePromise } from 'node:timers/promises'
import { test } from 'node:test'

import {
  createAgonesPlayerTracker,
  resolveEffectivePlayerCapacity,
} from '../../src/server/agonesPlayerTracking.js'

function createLogger() {
  const messages = {
    info: [],
    warn: [],
  }

  return {
    logger: {
      info(message) {
        messages.info.push(message)
      },
      warn(message) {
        messages.warn.push(message)
      },
    },
    messages,
  }
}

function createWorld(playerLimit = null) {
  const settings = new EventEmitter()
  settings.playerLimit = playerLimit
  const network = new EventEmitter()
  return {
    settings,
    network,
  }
}

test('resolveEffectivePlayerCapacity prefers world playerLimit and falls back to PUBLIC_WORLD_MAX_PLAYERS', () => {
  assert.equal(resolveEffectivePlayerCapacity({ playerLimit: 24, env: { PUBLIC_WORLD_MAX_PLAYERS: '32' } }), 24)
  assert.equal(resolveEffectivePlayerCapacity({ playerLimit: 0, env: { PUBLIC_WORLD_MAX_PLAYERS: '32' } }), 32)
  assert.equal(resolveEffectivePlayerCapacity({ playerLimit: null, env: { PUBLIC_WORLD_MAX_PLAYERS: '0' } }), null)
  assert.equal(resolveEffectivePlayerCapacity({ playerLimit: '18', env: {} }), 18)
})

test('createAgonesPlayerTracker wires playerJoined and playerLeft events into Agones player tracking', async () => {
  const world = createWorld(20)
  const events = []
  const { logger, messages } = createLogger()
  const tracker = createAgonesPlayerTracker({
    world,
    env: {},
    logger,
    agones: {
      async updateList(name, body) {
        events.push(['capacity', name, body.capacity])
      },
      async addListValue(name, playerId) {
        events.push(['connect', name, playerId])
        return true
      },
      async removeListValue(name, playerId) {
        events.push(['disconnect', name, playerId])
        return false
      },
    },
  })

  assert.equal(tracker.start(), true)

  world.network.emit('playerJoined', { id: 'player-1' })
  world.network.emit('playerLeft', { id: 'player-1' })
  await setImmediatePromise()

  assert.deepEqual(events, [
    ['connect', 'players', 'player-1'],
    ['disconnect', 'players', 'player-1'],
  ])
  assert.deepEqual(messages.warn, [])
  assert.deepEqual(messages.info, [])
})

test('createAgonesPlayerTracker does not publish the stale startup capacity before playerLimit is loaded', async () => {
  const world = createWorld(null)
  const capacities = []
  const { logger, messages } = createLogger()
  const tracker = createAgonesPlayerTracker({
    world,
    env: {
      PUBLIC_WORLD_MAX_PLAYERS: '40',
    },
    logger,
    agones: {
      async updateList(name, body) {
        capacities.push([name, Number(body.capacity)])
      },
      async addListValue() {
        return true
      },
      async removeListValue() {
        return true
      },
    },
  })

  tracker.start()

  world.settings.playerLimit = 18
  world.settings.emit('change', {
    playerLimit: { prev: null, value: 18 },
  })
  await setImmediatePromise()

  assert.deepEqual(capacities, [['players', 18]])
  assert.deepEqual(messages.warn, [])
  assert.deepEqual(messages.info, [
    '[agones] updated player capacity to 18 (player_limit_changed)',
  ])
})

test('createAgonesPlayerTracker publishes the current capacity after bootstrap', async () => {
  const world = createWorld(null)
  const capacities = []
  const { logger, messages } = createLogger()
  const tracker = createAgonesPlayerTracker({
    world,
    env: {
      PUBLIC_WORLD_MAX_PLAYERS: '40',
    },
    logger,
    agones: {
      async updateList(name, body) {
        capacities.push([name, Number(body.capacity)])
      },
      async addListValue() {
        return true
      },
      async removeListValue() {
        return true
      },
    },
  })

  tracker.start()
  await tracker.publishCapacity('bootstrap_ready')

  world.settings.playerLimit = 18
  world.settings.emit('change', {
    playerLimit: { prev: null, value: 18 },
  })
  await setImmediatePromise()

  world.settings.playerLimit = 18
  world.settings.emit('change', {
    playerLimit: { prev: 18, value: 18 },
  })
  await setImmediatePromise()

  assert.deepEqual(capacities, [
    ['players', 40],
    ['players', 18],
  ])
  assert.deepEqual(messages.warn, [])
  assert.deepEqual(messages.info, [
    '[agones] updated player capacity to 40 (bootstrap_ready)',
    '[agones] updated player capacity to 18 (player_limit_changed)',
  ])
})
