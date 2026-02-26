import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RuntimeWalletAdapter } from '../../src/client/wallet-adapter.js'

function makeProvider({ accounts = [], chainId = '0x1', signature = '0xsignature' } = {}) {
  const calls = []
  const provider = {
    async request({ method, params }) {
      calls.push({ method, params })
      if (method === 'eth_chainId') return chainId
      if (method === 'eth_accounts') return accounts
      if (method === 'eth_requestAccounts') return accounts
      if (method === 'eth_signTypedData_v4') return signature
      if (method === 'wallet_switchEthereumChain') return null
      throw new Error(`Unsupported method: ${method}`)
    },
  }
  return { provider, calls }
}

function makeWalletBridge(wallets) {
  return {
    getSnapshot() {
      return { ready: true, wallets }
    },
    subscribe() {
      return () => {}
    },
  }
}

function makeAuthBridge(address) {
  return {
    async getSessionUser() {
      return {
        user: {
          wallet_address: address,
        },
      }
    },
    subscribeAccountChanges() {
      return () => {}
    },
  }
}

function makePrivyWallet(address, provider) {
  return {
    type: 'ethereum',
    address,
    async getEthereumProvider() {
      return provider
    },
    async switchChain() {
      return null
    },
  }
}

test('wallet adapter prioritizes session-linked Privy wallet', async () => {
  const providerA = makeProvider({ chainId: '0xa4b1' })
  const providerB = makeProvider({ chainId: '0x1' })

  const walletA = makePrivyWallet('0x00000000000000000000000000000000000000AA', providerA.provider)
  const walletB = makePrivyWallet('0x00000000000000000000000000000000000000BB', providerB.provider)

  const adapter = new RuntimeWalletAdapter({
    authBridge: makeAuthBridge(walletB.address),
    walletBridge: makeWalletBridge([walletA, walletB]),
    refreshIntervalMs: 0,
  })

  try {
    await adapter.refresh()
    const snapshot = adapter.getSnapshot()
    assert.equal(snapshot.connected, true)
    assert.equal(snapshot.source, 'privy')
    assert.equal(snapshot.address?.toLowerCase(), walletB.address.toLowerCase())
  } finally {
    adapter.destroy()
  }
})

test('wallet adapter falls back to first connected Privy wallet', async () => {
  const providerA = makeProvider({ chainId: '0xa4b1' })
  const providerB = makeProvider({ chainId: '0x1' })

  const walletA = makePrivyWallet('0x00000000000000000000000000000000000000AA', providerA.provider)
  const walletB = makePrivyWallet('0x00000000000000000000000000000000000000BB', providerB.provider)

  const adapter = new RuntimeWalletAdapter({
    authBridge: makeAuthBridge('0x00000000000000000000000000000000000000CC'),
    walletBridge: makeWalletBridge([walletA, walletB]),
    refreshIntervalMs: 0,
  })

  try {
    await adapter.refresh()
    const snapshot = adapter.getSnapshot()
    assert.equal(snapshot.connected, true)
    assert.equal(snapshot.source, 'privy')
    assert.equal(snapshot.address?.toLowerCase(), walletA.address.toLowerCase())
  } finally {
    adapter.destroy()
  }
})

test('wallet adapter falls back to injected wallet when Privy is unavailable', async () => {
  const originalWindow = globalThis.window
  const injected = makeProvider({
    accounts: ['0x00000000000000000000000000000000000000DD'],
    chainId: '0xa4b1',
  })

  globalThis.window = {
    ethereum: injected.provider,
  }

  const adapter = new RuntimeWalletAdapter({
    authBridge: makeAuthBridge(''),
    walletBridge: makeWalletBridge([]),
    refreshIntervalMs: 0,
  })

  try {
    await adapter.refresh()
    const snapshot = adapter.getSnapshot()
    assert.equal(snapshot.connected, true)
    assert.equal(snapshot.source, 'injected')
    assert.equal(snapshot.address?.toLowerCase(), '0x00000000000000000000000000000000000000dd')
  } finally {
    adapter.destroy()
    if (originalWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = originalWindow
    }
  }
})

test('wallet adapter signs typed data with active wallet provider', async () => {
  const signer = makeProvider({
    chainId: '0xa4b1',
    signature: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1b',
  })
  const wallet = makePrivyWallet('0x00000000000000000000000000000000000000EE', signer.provider)

  const adapter = new RuntimeWalletAdapter({
    authBridge: makeAuthBridge(wallet.address),
    walletBridge: makeWalletBridge([wallet]),
    refreshIntervalMs: 0,
  })

  try {
    const signature = await adapter.signTypedData({
      domain: { name: 'Test', version: '1', chainId: 1, verifyingContract: '0x0000000000000000000000000000000000000000' },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TestType: [{ name: 'value', type: 'string' }],
      },
      primaryType: 'TestType',
      message: { value: 'ok' },
    })

    assert.equal(signature, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1b')
    assert.equal(signer.calls.some(call => call.method === 'eth_signTypedData_v4'), true)
  } finally {
    adapter.destroy()
  }
})
