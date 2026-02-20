import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMaxUploadSizeBytes, getMaxUploadSizeMb, getWorldMaxPlayers } from '../../src/server/worldLimits.js'

function withEnv(overrides, run) {
  const previous = {
    PUBLIC_MAX_UPLOAD_SIZE: process.env.PUBLIC_MAX_UPLOAD_SIZE,
    PUBLIC_WORLD_MAX_PLAYERS: process.env.PUBLIC_WORLD_MAX_PLAYERS,
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'PUBLIC_MAX_UPLOAD_SIZE')) {
    if (overrides.PUBLIC_MAX_UPLOAD_SIZE === undefined) {
      delete process.env.PUBLIC_MAX_UPLOAD_SIZE
    } else {
      process.env.PUBLIC_MAX_UPLOAD_SIZE = overrides.PUBLIC_MAX_UPLOAD_SIZE
    }
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'PUBLIC_WORLD_MAX_PLAYERS')) {
    if (overrides.PUBLIC_WORLD_MAX_PLAYERS === undefined) {
      delete process.env.PUBLIC_WORLD_MAX_PLAYERS
    } else {
      process.env.PUBLIC_WORLD_MAX_PLAYERS = overrides.PUBLIC_WORLD_MAX_PLAYERS
    }
  }
  try {
    run()
  } finally {
    if (previous.PUBLIC_MAX_UPLOAD_SIZE === undefined) {
      delete process.env.PUBLIC_MAX_UPLOAD_SIZE
    } else {
      process.env.PUBLIC_MAX_UPLOAD_SIZE = previous.PUBLIC_MAX_UPLOAD_SIZE
    }
    if (previous.PUBLIC_WORLD_MAX_PLAYERS === undefined) {
      delete process.env.PUBLIC_WORLD_MAX_PLAYERS
    } else {
      process.env.PUBLIC_WORLD_MAX_PLAYERS = previous.PUBLIC_WORLD_MAX_PLAYERS
    }
  }
}

test('world limits use defaults when env vars are missing', () => {
  withEnv({
    PUBLIC_MAX_UPLOAD_SIZE: undefined,
    PUBLIC_WORLD_MAX_PLAYERS: undefined,
  }, () => {
    assert.equal(getMaxUploadSizeMb(), 12)
    assert.equal(getMaxUploadSizeBytes(), 12 * 1024 * 1024)
    assert.equal(getWorldMaxPlayers(), 0)
  })
})

test('world limits parse configured values', () => {
  withEnv({
    PUBLIC_MAX_UPLOAD_SIZE: '4',
    PUBLIC_WORLD_MAX_PLAYERS: '3',
  }, () => {
    assert.equal(getMaxUploadSizeMb(), 4)
    assert.equal(getMaxUploadSizeBytes(), 4 * 1024 * 1024)
    assert.equal(getWorldMaxPlayers(), 3)
  })
})

test('world limits clamp invalid or non-positive values', () => {
  withEnv({
    PUBLIC_MAX_UPLOAD_SIZE: '0',
    PUBLIC_WORLD_MAX_PLAYERS: '-5',
  }, () => {
    assert.equal(getMaxUploadSizeMb(), 12)
    assert.equal(getWorldMaxPlayers(), 0)
  })
})
