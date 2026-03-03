import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EVM } from '../../src/core/systems/EVMClient.js'
import { Hyperliquid } from '../../src/core/systems/HyperliquidClient.js'

test('EVM client tracks bound wallet state', () => {
  const evm = new EVM({})

  evm.bind({
    address: '0x00000000000000000000000000000000000000AA',
    isConnected: true,
    walletAdapter: null,
  })

  assert.equal(evm.getAddress(), '0x00000000000000000000000000000000000000AA')
  assert.equal(evm.isConnected(), true)
})

test('EVM client transfers native token via wallet adapter', async () => {
  const calls = []
  const evm = new EVM({})
  evm.bind({
    address: '0x00000000000000000000000000000000000000AA',
    isConnected: true,
    walletAdapter: {
      async sendTransaction(params) {
        calls.push(['sendTransaction', params])
        return '0xnativehash'
      },
      async waitForTransactionReceipt({ hash }) {
        calls.push(['waitForTransactionReceipt', hash])
        return { transactionHash: hash }
      },
    },
  })

  const result = await evm.transferNative('0x00000000000000000000000000000000000000BB', '0.25')
  assert.equal(result.hash, '0xnativehash')
  assert.equal(calls[0][0], 'sendTransaction')
  assert.equal(calls[0][1].to.toLowerCase(), '0x00000000000000000000000000000000000000bb')
  assert.equal(typeof calls[0][1].value, 'bigint')
  assert.equal(calls[1][0], 'waitForTransactionReceipt')
  assert.equal(calls[1][1], '0xnativehash')
})

test('EVM client transfers USDC via ERC20 transfer', async () => {
  const calls = []
  const evm = new EVM({})
  evm.bind({
    address: '0x00000000000000000000000000000000000000AA',
    isConnected: true,
    walletAdapter: {
      async writeContract(params) {
        calls.push(['writeContract', params])
        return '0xusdchash'
      },
      async waitForTransactionReceipt({ hash }) {
        calls.push(['waitForTransactionReceipt', hash])
        return { transactionHash: hash }
      },
    },
  })

  const result = await evm.transferUSDC('0x00000000000000000000000000000000000000CC', '1.5')
  assert.equal(result.hash, '0xusdchash')
  assert.equal(calls[0][0], 'writeContract')
  assert.equal(calls[0][1].address.toLowerCase(), '0xaf88d065e77c8cc2239327c5edb3a432268e5831')
  assert.equal(calls[0][1].functionName, 'transfer')
  assert.equal(calls[0][1].args[0].toLowerCase(), '0x00000000000000000000000000000000000000cc')
  assert.equal(calls[0][1].args[1], 1500000n)
  assert.equal(calls[1][0], 'waitForTransactionReceipt')
  assert.equal(calls[1][1], '0xusdchash')
})

test('Hyperliquid returns sorted ticker list', async () => {
  const hl = new Hyperliquid({})
  hl.infoClient = {
    async meta() {
      return {
        universe: [{ name: 'SOL' }, { name: 'BTC' }, { name: 'ETH' }],
      }
    },
  }

  const tickers = await hl.getAvailableTickers()
  assert.deepEqual(tickers, ['BTC', 'ETH', 'SOL'])
})

test('Hyperliquid deposit uses wallet adapter contract operations', async () => {
  const calls = []

  const walletAdapter = {
    async getChainId() {
      calls.push(['getChainId'])
      return 42161
    },
    async switchChain() {
      calls.push(['switchChain'])
    },
    async readContract(params) {
      calls.push(['readContract', params.functionName])
      if (params.functionName === 'balanceOf') return 15_000_000n
      if (params.functionName === 'allowance') return 0n
      throw new Error(`Unexpected read contract fn: ${params.functionName}`)
    },
    async writeContract(params) {
      calls.push(['writeContract', params.functionName])
      if (params.functionName === 'approve') return '0xapprove'
      if (params.functionName === 'transfer') return '0xtransfer'
      throw new Error(`Unexpected write contract fn: ${params.functionName}`)
    },
    async waitForTransactionReceipt({ hash }) {
      calls.push(['waitForTransactionReceipt', hash])
      return { transactionHash: `${hash}-receipt` }
    },
    async signTypedData() {
      return '0x'
    },
  }

  const hl = new Hyperliquid({})
  hl.bind({
    address: '0x00000000000000000000000000000000000000AA',
    walletAdapter,
    isConnected: true,
  })

  const result = await hl.deposit(10)

  assert.equal(result.status, 'ok')
  assert.equal(result.txHash, '0xtransfer-receipt')
  assert.equal(calls.some(call => call[0] === 'switchChain'), false)
  assert.deepEqual(
    calls.filter(call => call[0] === 'readContract').map(call => call[1]),
    ['balanceOf', 'allowance']
  )
  assert.deepEqual(
    calls.filter(call => call[0] === 'writeContract').map(call => call[1]),
    ['approve', 'transfer']
  )
})

test('Hyperliquid deposit switches to Arbitrum when needed', async () => {
  let chainId = 1
  let switchCount = 0

  const walletAdapter = {
    async getChainId() {
      return chainId
    },
    async switchChain() {
      switchCount += 1
      chainId = 42161
    },
    async readContract(params) {
      if (params.functionName === 'balanceOf') return 20_000_000n
      if (params.functionName === 'allowance') return 20_000_000n
      throw new Error(`Unexpected read contract fn: ${params.functionName}`)
    },
    async writeContract() {
      return '0xtransfer'
    },
    async waitForTransactionReceipt() {
      return { transactionHash: '0xtransfer' }
    },
    async signTypedData() {
      return '0x'
    },
  }

  const hl = new Hyperliquid({})
  hl.bind({
    address: '0x00000000000000000000000000000000000000BB',
    walletAdapter,
    isConnected: true,
  })

  await hl.deposit(10)
  assert.equal(switchCount, 1)
})
