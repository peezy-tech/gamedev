import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
} from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token'

import { ClientSolana } from '../../src/core/systems/ClientSolana.js'
import { ServerSolana } from '../../src/core/systems/ServerSolana.js'

function createTaskQueue() {
  const pending = new Set()
  return {
    schedule(task) {
      if (!task || typeof task.then !== 'function') return
      pending.add(task)
      task.finally(() => pending.delete(task))
    },
    async flush() {
      while (pending.size > 0) {
        await Promise.all([...pending])
      }
    },
  }
}

async function createSolanaHarness() {
  const queue = createTaskQueue()
  const playerSigner = await generateKeyPairSigner()
  const worldSigner = await generateKeyPairSigner()
  const mintSigner = await generateKeyPairSigner()
  const mintAddress = mintSigner.address
  const [playerTokenAccount] = await findAssociatedTokenPda({
    owner: playerSigner.address,
    mint: mintAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  })
  const [worldTokenAccount] = await findAssociatedTokenPda({
    owner: worldSigner.address,
    mint: mintAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  })

  const walletState = {
    address: null,
    connected: false,
  }
  const submittedTransactions = []
  const entityModifiedPackets = []
  let tamperNextTransaction = false

  const playerEntity = {
    isPlayer: true,
    data: {
      id: 'player-1',
      solanaWallet: null,
    },
    modify(patch) {
      Object.assign(this.data, patch)
    },
  }
  const clientPlayerEntity = {
    data: {
      id: 'player-1',
      solanaWallet: null,
    },
  }

  let clientSolana
  let serverSolana

  const socket = {
    player: playerEntity,
    send(type, data) {
      if (type === 'solanaConnectRequest') {
        queue.schedule(clientSolana.onSolanaConnectRequest(data))
        return
      }
      if (type === 'solanaConnectChallenge') {
        queue.schedule(clientSolana.onSolanaConnectChallenge(data))
        return
      }
      if (type === 'solanaDisconnectRequest') {
        queue.schedule(clientSolana.onSolanaDisconnectRequest(data))
        return
      }
      if (type === 'solanaDepositSignatureRequest') {
        queue.schedule(clientSolana.onSolanaDepositSignatureRequest(data))
        return
      }
      if (type === 'solanaDepositResult') {
        clientSolana.onSolanaDepositResult(data)
        return
      }
      if (type === 'solanaWithdrawSignatureRequest') {
        queue.schedule(clientSolana.onSolanaWithdrawSignatureRequest(data))
        return
      }
      if (type === 'solanaWithdrawResult') {
        clientSolana.onSolanaWithdrawResult(data)
        return
      }
      throw new Error(`unexpected server packet: ${type}`)
    },
  }

  const clientWorld = {
    network: {
      id: 'player-1',
      send(type, data) {
        if (type === 'solanaConnectChallengeRequest') {
          queue.schedule(serverSolana.onSolanaConnectChallengeRequest(socket, data))
          return
        }
        if (type === 'solanaConnectResponse') {
          queue.schedule(serverSolana.onSolanaConnectResponse(socket, data))
          return
        }
        if (type === 'solanaDisconnect') {
          serverSolana.onSolanaDisconnect(socket)
          clientPlayerEntity.data.solanaWallet = null
          return
        }
        if (type === 'solanaDepositRequest') {
          queue.schedule(serverSolana.onSolanaDepositRequest(socket, data))
          return
        }
        if (type === 'solanaDepositSignatureResponse') {
          queue.schedule(serverSolana.onSolanaDepositSignatureResponse(socket, data))
          return
        }
        if (type === 'solanaWithdrawRequest') {
          queue.schedule(serverSolana.onSolanaWithdrawRequest(socket, data))
          return
        }
        if (type === 'solanaWithdrawSignatureResponse') {
          queue.schedule(serverSolana.onSolanaWithdrawSignatureResponse(socket, data))
          return
        }
        throw new Error(`unexpected client packet: ${type}`)
      },
    },
    entities: {
      player: clientPlayerEntity,
    },
  }

  const serverWorld = {
    entities: {
      getPlayer(id) {
        return id === playerEntity.data.id ? playerEntity : null
      },
    },
    network: {
      sockets: new Map([['player-1', socket]]),
      send(type, data) {
        if (type !== 'entityModified') {
          throw new Error(`unexpected broadcast packet: ${type}`)
        }
        entityModifiedPackets.push(data)
        if (Object.prototype.hasOwnProperty.call(data, 'solanaWallet')) {
          clientPlayerEntity.data.solanaWallet = data.solanaWallet || null
        }
      },
      sendTo(id, type, data) {
        assert.equal(id, playerEntity.data.id)
        socket.send(type, data)
      },
    },
  }

  clientSolana = new ClientSolana(clientWorld)
  serverSolana = new ServerSolana(serverWorld)

  serverSolana.transferRuntime = {
    mintAddress,
    worldAddress: worldSigner.address,
    worldSigner,
  }
  serverSolana._fetchMintAccount = async () => ({
    data: {
      decimals: 6,
    },
  })
  serverSolana._fetchMaybeTokenAccount = async tokenAddress => {
    if (tokenAddress === playerTokenAccount) {
      return {
        exists: true,
        address: tokenAddress,
        data: {
          mint: mintAddress,
          owner: playerSigner.address,
          amount: 10_000_000n,
        },
      }
    }
    if (tokenAddress === worldTokenAccount) {
      return {
        exists: true,
        address: tokenAddress,
        data: {
          mint: mintAddress,
          owner: worldSigner.address,
          amount: 10_000_000n,
        },
      }
    }
    return {
      exists: false,
      address: tokenAddress,
    }
  }
  serverSolana._getLatestBlockhash = async () => ({
    blockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 1n,
  })
  serverSolana._sendAndConfirmTransaction = async transaction => {
    submittedTransactions.push(transaction)
  }

  clientSolana.bind({
    address: null,
    connected: false,
    getAddress: () => walletState.address,
    isConnected: () => walletState.connected,
    connect: async () => {
      walletState.connected = true
      walletState.address = playerSigner.address
    },
    disconnect: async () => {
      walletState.connected = false
      walletState.address = null
    },
    signMessage: async bytes => signBytes(playerSigner.keyPair.privateKey, bytes),
    signTransaction: async bytes => {
      const decoded = getTransactionDecoder().decode(bytes)
      const transactionToSign = tamperNextTransaction
        ? {
            ...decoded,
            messageBytes: (() => {
              const nextBytes = Uint8Array.from(decoded.messageBytes)
              nextBytes[nextBytes.length - 1] ^= 1
              return nextBytes
            })(),
            signatures: { ...decoded.signatures },
          }
        : decoded
      const signed = await partiallySignTransaction([playerSigner.keyPair], transactionToSign)
      tamperNextTransaction = false
      return getTransactionEncoder().encode(signed)
    },
  })

  return {
    clientPlayerEntity,
    clientSolana,
    connectWallet() {
      walletState.connected = true
      walletState.address = playerSigner.address
      playerEntity.data.solanaWallet = playerSigner.address
      clientPlayerEntity.data.solanaWallet = playerSigner.address
    },
    disconnectWallet() {
      walletState.connected = false
      walletState.address = null
      playerEntity.data.solanaWallet = null
      clientPlayerEntity.data.solanaWallet = null
    },
    entityModifiedPackets,
    flush: queue.flush,
    playerEntity,
    playerSigner,
    serverSolana,
    setTamperNextTransaction() {
      tamperNextTransaction = true
    },
    socket,
    submittedTransactions,
    worldSigner,
  }
}

test('solana runtime completes packet-driven connect and disconnect flow', async () => {
  const harness = await createSolanaHarness()

  harness.serverSolana.connect(harness.playerEntity)
  await harness.flush()

  assert.equal(harness.playerEntity.data.solanaWallet, harness.playerSigner.address)
  assert.equal(harness.clientPlayerEntity.data.solanaWallet, harness.playerSigner.address)
  assert.equal(harness.entityModifiedPackets.at(-1)?.solanaWallet, harness.playerSigner.address)

  await harness.clientSolana.disconnect()
  await harness.flush()

  assert.equal(harness.playerEntity.data.solanaWallet, null)
  assert.equal(harness.clientPlayerEntity.data.solanaWallet, null)
  assert.equal(harness.entityModifiedPackets.at(-1)?.solanaWallet, null)
})
