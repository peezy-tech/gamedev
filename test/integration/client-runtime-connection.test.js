import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRuntimeAssignmentRequestBody,
  resolveClientConnectionConfig,
  resolveRuntimeAssignmentPlayerId,
} from '../../src/client/runtimeConnection.js'

test('assigned runtime API/auth endpoints override static build-time placeholders', () => {
  const connection = resolveClientConnectionConfig({
    connection: {
      wsUrl: 'wss://assigned-runtime.example/ws',
      apiUrl: 'https://assigned-runtime.example/api',
      authUrl: 'https://assigned-runtime.example/api/auth/identity',
    },
    apiUrl: 'https://placeholder-runtime.example/api',
    authUrl: 'https://placeholder-runtime.example/api/auth/identity',
  })

  assert.deepEqual(connection, {
    wsUrl: 'wss://assigned-runtime.example/ws',
    apiUrl: 'https://assigned-runtime.example/api',
    authUrl: 'https://assigned-runtime.example/api/auth/identity',
  })
})

test('static websocket connections still derive API base when no API prop is configured', () => {
  const connection = resolveClientConnectionConfig({
    connection: 'wss://fixed-runtime.example/ws?authToken=session',
    apiUrl: '',
    authUrl: '',
  })

  assert.deepEqual(connection, {
    wsUrl: 'wss://fixed-runtime.example/ws?authToken=session',
    apiUrl: 'https://fixed-runtime.example',
    authUrl: null,
  })
})

test('websocket-only connections derive API base from non-ws socket paths', () => {
  assert.deepEqual(
    resolveClientConnectionConfig({
      connection: 'wss://fixed-runtime.example/session?authToken=session',
      apiUrl: '',
      authUrl: '',
    }),
    {
      wsUrl: 'wss://fixed-runtime.example/session?authToken=session',
      apiUrl: 'https://fixed-runtime.example',
      authUrl: null,
    }
  )

  assert.deepEqual(
    resolveClientConnectionConfig({
      connection: 'wss://fixed-runtime.example/runtime/inst-123/socket',
      apiUrl: '',
      authUrl: '',
    }),
    {
      wsUrl: 'wss://fixed-runtime.example/runtime/inst-123/socket',
      apiUrl: 'https://fixed-runtime.example/runtime/inst-123',
      authUrl: null,
    }
  )
})

test('runtime assignment body includes explicit player identity and match settings', () => {
  const body = buildRuntimeAssignmentRequestBody({
    env: {
      PUBLIC_RUNTIME_ASSIGNMENT_MODE: 'match',
      PUBLIC_RUNTIME_MATCH_KEY: 'arena-1',
      PUBLIC_RUNTIME_REGION: 'use',
      PUBLIC_RUNTIME_PLAYER_ID: 'wallet-session-1',
    },
  })

  assert.deepEqual(body, {
    mode: 'match',
    matchKey: 'arena-1',
    preferredRegion: 'use',
    player: { id: 'wallet-session-1' },
  })
})

test('runtime assignment player identity resolves from session wallet before connected wallet fallback', () => {
  const playerId = resolveRuntimeAssignmentPlayerId({
    session: {
      user: {
        id: 'user-1',
        wallet: {
          type: 'ethereum',
          address: '0x00000000000000000000000000000000000000aa',
        },
      },
    },
    walletSnapshot: {
      wallets: [
        { address: '0x00000000000000000000000000000000000000bb' },
      ],
    },
    ethereumAccounts: ['0x00000000000000000000000000000000000000cc'],
  })

  assert.equal(playerId, '0x00000000000000000000000000000000000000aa')
})

test('runtime assignment canonicalizes ethereum wallet casing for stable reconnects', () => {
  assert.equal(
    resolveRuntimeAssignmentPlayerId({
      session: {
        user: {
          wallet: {
            type: 'ethereum',
            address: '0x00000000000000000000000000000000000000AA',
          },
        },
      },
    }),
    '0x00000000000000000000000000000000000000aa'
  )

  assert.deepEqual(
    buildRuntimeAssignmentRequestBody({
      ethereumAccounts: ['0x00000000000000000000000000000000000000BB'],
    }),
    {
      mode: 'pool',
      player: { id: '0x00000000000000000000000000000000000000bb' },
    }
  )

  assert.deepEqual(
    buildRuntimeAssignmentRequestBody({
      search: '?wallet=0x00000000000000000000000000000000000000CC',
    }),
    {
      mode: 'pool',
      player: { id: '0x00000000000000000000000000000000000000cc' },
    }
  )
})

test('runtime assignment body derives player identity from query or non-prompting wallet accounts', () => {
  assert.deepEqual(
    buildRuntimeAssignmentRequestBody({
      search: '?match=arena-2&playerId=query-player',
    }),
    {
      mode: 'match',
      matchKey: 'arena-2',
      player: { id: 'query-player' },
    }
  )

  assert.deepEqual(
    buildRuntimeAssignmentRequestBody({
      ethereumAccounts: ['0x00000000000000000000000000000000000000dd'],
    }),
    {
      mode: 'pool',
      player: { id: '0x00000000000000000000000000000000000000dd' },
    }
  )
})
