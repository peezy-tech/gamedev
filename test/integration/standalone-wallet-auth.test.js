import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { resolveAuthRuntimeConfig } from '../../src/server/authModes.js'
import { createStandaloneWalletAuthStore, handleStandaloneWalletVerify } from '../../src/server/standaloneWalletAuth.js'
import { Ranks } from '../../src/core/extras/ranks.js'
import { ServerNetwork } from '../../src/core/systems/ServerNetwork.js'
import { readPacket } from '../../src/core/packets.js'

function buildSiweMessage({ domain, address, uri, chainId, nonce }) {
  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in with Ethereum

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`
}

test('standalone wallet auth mode does not use lobby identity verification', () => {
  const config = resolveAuthRuntimeConfig({
    PUBLIC_AUTH_URL: 'https://runtime.example/api/auth/identity',
    STANDALONE_WALLET_AUTH: 'true',
  })

  assert.equal(config.usesStandaloneWalletIdentity, true)
  assert.equal(config.usesLobbyIdentity, false)
  assert.equal(config.requiresWalletIdentity, true)
  assert.equal(config.usesLocalIdentity, true)
})

test('standalone wallet auth can explicitly allow guest connections', () => {
  const config = resolveAuthRuntimeConfig({
    PUBLIC_AUTH_URL: 'https://runtime.example/api/auth/identity',
    STANDALONE_WALLET_AUTH: 'true',
    REQUIRE_WALLET_AUTH: 'false',
  })

  assert.equal(config.usesStandaloneWalletIdentity, true)
  assert.equal(config.requiresWalletIdentity, false)
})

test('server network rejects unauthenticated connections when wallet auth is required', async () => {
  const sentPackets = []
  let closed = false
  const ws = {
    send(packet) {
      sentPackets.push(packet)
    },
    close() {
      closed = true
    },
  }
  const network = new ServerNetwork({
    settings: {
      playerLimit: 0,
    },
  })
  network.init({
    db() {
      throw new Error('db should not be called for rejected unauthenticated connections')
    },
    authConfig: resolveAuthRuntimeConfig({
      STANDALONE_WALLET_AUTH: 'true',
    }),
  })

  try {
    await network.onConnection(ws, {}, {})
  } finally {
    network.destroy()
  }

  assert.equal(closed, true)
  assert.equal(sentPackets.length, 1)
  assert.deepEqual(readPacket(sentPackets[0]), ['onKick', 'auth_required'])
})

test('standalone wallet auth verifies SIWE and issues one-shot exchange claims', async () => {
  const wallet = Wallet.createRandom()
  const env = {
    PUBLIC_AUTH_URL: 'https://runtime.example/api/auth/identity',
    STANDALONE_ADMIN_WALLETS: wallet.address,
  }
  const store = createStandaloneWalletAuthStore({ env })
  const nonce = store.createNonce(wallet.address)
  const message = buildSiweMessage({
    domain: 'runtime.example',
    address: wallet.address,
    uri: 'https://runtime.example/api/auth/identity',
    chainId: 42161,
    nonce,
  })
  const signature = await wallet.signMessage(message)

  const session = await store.verifySiwe({ message, signature })
  assert.equal(session.user.id, `wallet:ethereum:${wallet.address.toLowerCase()}`)
  assert.equal(session.user.walletAddress, wallet.address)
  assert.equal(session.user.rank, Ranks.ADMIN)

  const exchange = store.createExchangeToken(session)
  const claims = store.consumeExchangeToken(exchange.token)
  assert.equal(claims.typ, 'identity_exchange')
  assert.equal(claims.aud, 'runtime:exchange')
  assert.equal(claims.iss, 'https://runtime.example/api/auth/identity')
  assert.equal(claims.userId, session.user.id)
  assert.equal(claims.walletAddress, wallet.address)
  assert.equal(claims.rank, Ranks.ADMIN)
  assert.equal(store.consumeExchangeToken(exchange.token), null)
})

test('standalone wallet auth cookie path follows PUBLIC_AUTH_URL path prefixes', async () => {
  const wallet = Wallet.createRandom()
  const env = {
    PUBLIC_AUTH_URL: 'https://staging.peezy.tech/devnet/runtime/api/auth/identity',
    STANDALONE_ADMIN_WALLETS: wallet.address,
  }
  const store = createStandaloneWalletAuthStore({ env })
  const nonce = store.createNonce(wallet.address)
  const message = buildSiweMessage({
    domain: 'staging.peezy.tech',
    address: wallet.address,
    uri: 'https://staging.peezy.tech',
    chainId: 42161,
    nonce,
  })
  const signature = await wallet.signMessage(message)
  const headers = {}
  const reply = {
    statusCode: 200,
    header(name, value) {
      headers[name.toLowerCase()] = value
      return this
    },
    code(value) {
      this.statusCode = value
      return this
    },
    send(value) {
      this.payload = value
      return value
    },
  }

  await handleStandaloneWalletVerify(
    { body: { message, signature } },
    reply,
    store,
    { env }
  )

  assert.equal(reply.statusCode, 200)
  assert.match(headers['set-cookie'], /Path=\/devnet\/runtime\/api\/auth\/identity/)
  assert.match(headers['set-cookie'], /SameSite=None/)
  assert.match(headers['set-cookie'], /Secure/)
})

test('standalone wallet auth rejects SIWE messages for the wrong domain', async () => {
  const wallet = Wallet.createRandom()
  const env = {
    PUBLIC_AUTH_URL: 'https://runtime.example/api/auth/identity',
  }
  const store = createStandaloneWalletAuthStore({ env })
  const nonce = store.createNonce(wallet.address)
  const message = buildSiweMessage({
    domain: 'evil.example',
    address: wallet.address,
    uri: 'https://evil.example/api/auth/identity',
    chainId: 1,
    nonce,
  })
  const signature = await wallet.signMessage(message)

  await assert.rejects(
    store.verifySiwe({ message, signature }),
    /invalid_domain/
  )
})
