import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGONES_SDK_DEFAULT_HTTP_PORT,
  createAgonesSdkHttp,
  isAgonesSdkHttpEnabled,
  resolveAgonesSdkHttpBaseUrl,
} from '../../src/server/agonesSdkHttp.js'

test('resolveAgonesSdkHttpBaseUrl uses the default and configured Agones SDK ports', () => {
  assert.equal(resolveAgonesSdkHttpBaseUrl({}), `http://127.0.0.1:${AGONES_SDK_DEFAULT_HTTP_PORT}`)
  assert.equal(
    resolveAgonesSdkHttpBaseUrl({
      AGONES_SDK_HTTP_PORT: '1234',
    }),
    'http://127.0.0.1:1234'
  )
})

test('Agones HTTP adapter is enabled only for hosted runtime bootstraps', () => {
  assert.equal(isAgonesSdkHttpEnabled({}), false)
  assert.equal(
    isAgonesSdkHttpEnabled({
      RUNTIME_BOOTSTRAP_URL: 'https://dev.lobby.ws/internal/runtime/bootstrap',
    }),
    true
  )
})

test('createAgonesSdkHttp returns null when Agones is disabled or fetch is unavailable', () => {
  assert.equal(createAgonesSdkHttp({ env: {} }), null)
  assert.equal(
    createAgonesSdkHttp({
      env: {
        RUNTIME_BOOTSTRAP_URL: 'https://dev.lobby.ws/internal/runtime/bootstrap',
      },
      fetchImpl: null,
    }),
    null
  )
})

test('createAgonesSdkHttp posts lifecycle and player tracking requests to the local SDK sidecar', async () => {
  const requests = []
  const agones = createAgonesSdkHttp({
    env: {
      RUNTIME_BOOTSTRAP_URL: 'https://dev.lobby.ws/internal/runtime/bootstrap',
      AGONES_SDK_HTTP_PORT: '1234',
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return {
        ok: true,
        status: 200,
        async json() {
          return { bool: false }
        },
      }
    },
  })

  await agones.ready()
  await agones.updateList('players', { capacity: '32' })
  await agones.addListValue('players', 'player-1')
  await agones.removeListValue('players', 'player-1')
  await agones.shutdown()

  assert.deepEqual(requests, [
    {
      url: 'http://127.0.0.1:1234/ready',
      options: { method: 'POST' },
    },
    {
      url: 'http://127.0.0.1:1234/v1beta1/lists/players',
      options: {
        method: 'PATCH',
        body: JSON.stringify({ capacity: '32' }),
        headers: {
          'content-type': 'application/json',
        },
      },
    },
    {
      url: 'http://127.0.0.1:1234/v1beta1/lists/players:addValue',
      options: {
        method: 'POST',
        body: JSON.stringify({ value: 'player-1' }),
        headers: {
          'content-type': 'application/json',
        },
      },
    },
    {
      url: 'http://127.0.0.1:1234/v1beta1/lists/players:removeValue',
      options: {
        method: 'POST',
        body: JSON.stringify({ value: 'player-1' }),
        headers: {
          'content-type': 'application/json',
        },
      },
    },
    {
      url: 'http://127.0.0.1:1234/shutdown',
      options: { method: 'POST' },
    },
  ])
})
