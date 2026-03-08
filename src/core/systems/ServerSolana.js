import { address, getPublicKeyFromAddress, getUtf8Encoder, signatureBytes, verifySignature } from '@solana/kit'

import { uuid } from '../utils'
import { System } from './System'

const CONNECT_CHALLENGE_TTL_MS = 60_000

function isPlayer(entity) {
  return !!entity?.isPlayer && !!entity?.data?.id
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeSolanaAddress(value) {
  if (!isNonEmptyString(value)) return null
  try {
    return address(value.trim())
  } catch {
    return null
  }
}

function encodeBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function decodeBase64(value) {
  if (!isNonEmptyString(value)) return null
  try {
    return new Uint8Array(Buffer.from(value, 'base64'))
  } catch {
    return null
  }
}

function createConnectChallengePayload({ playerId, address, nonce, issuedAt, expiresAt }) {
  return JSON.stringify({
    type: 'lobby-runtime-solana-connect',
    playerId,
    address,
    nonce,
    issuedAt,
    expiresAt,
  })
}

export class ServerSolana extends System {
  constructor(world) {
    super(world)
    this.connectChallenges = new Map()
    this.pendingTransactions = new Map()
  }

  _resolvePlayer(playerOrId) {
    if (isPlayer(playerOrId)) return playerOrId
    if (typeof playerOrId === 'string') {
      return this.world.entities.getPlayer(playerOrId) || null
    }
    if (typeof playerOrId?.id === 'string') {
      return this.world.entities.getPlayer(playerOrId.id) || null
    }
    return null
  }

  _clearConnectChallenge(playerOrId) {
    const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.data?.id || playerOrId?.id
    if (!playerId) return
    this.connectChallenges.delete(playerId)
  }

  _setPlayerWallet(player, solanaWallet) {
    if (!isPlayer(player)) return
    const nextWallet = typeof solanaWallet === 'string' && solanaWallet.trim() ? solanaWallet.trim() : null
    if ((player.data.solanaWallet || null) === nextWallet) return
    player.modify({ solanaWallet: nextWallet })
    this.world.network.send('entityModified', {
      id: player.data.id,
      solanaWallet: nextWallet,
    })
  }

  connect(playerOrId) {
    const player = this._resolvePlayer(playerOrId)
    if (!player) {
      throw new Error('Player not found')
    }
    this.world.network.sendTo(player.data.id, 'solanaConnectRequest')
  }

  disconnect(playerOrId) {
    const player = this._resolvePlayer(playerOrId)
    if (!player) {
      throw new Error('Player not found')
    }
    this._clearConnectChallenge(player)
    this._setPlayerWallet(player, null)
    this.world.network.sendTo(player.data.id, 'solanaDisconnectRequest')
  }

  deposit() {
    throw new Error('Solana deposits are not implemented yet')
  }

  withdraw() {
    throw new Error('Solana withdrawals are not implemented yet')
  }

  onSolanaConnectChallengeRequest(socket, data) {
    const player = socket?.player
    const playerId = player?.data?.id
    if (!player || !playerId) return

    const playerAddress = normalizeSolanaAddress(data?.address)
    if (!playerAddress) return

    const challengeId = uuid()
    const nonce = uuid()
    const issuedAt = Date.now()
    const expiresAt = issuedAt + CONNECT_CHALLENGE_TTL_MS
    const payload = createConnectChallengePayload({
      playerId,
      address: playerAddress,
      nonce,
      issuedAt,
      expiresAt,
    })
    const challengeBytes = getUtf8Encoder().encode(payload)

    this.connectChallenges.set(playerId, {
      challengeId,
      nonce,
      address: playerAddress,
      issuedAt,
      expiresAt,
      challengeBytes,
    })

    socket.send('solanaConnectChallenge', {
      challengeId,
      nonce,
      issuedAt,
      expiresAt,
      challenge: encodeBase64(challengeBytes),
    })
  }

  async onSolanaConnectResponse(socket, data) {
    const player = socket?.player
    const playerId = player?.data?.id
    if (!player || !playerId) return

    const challenge = this.connectChallenges.get(playerId)
    if (!challenge) return
    if (challenge.challengeId !== data?.challengeId) return

    this.connectChallenges.delete(playerId)

    if (data?.error) return
    if (Date.now() > challenge.expiresAt) return

    const responseAddress = normalizeSolanaAddress(data?.address)
    if (!responseAddress || responseAddress !== challenge.address) return

    const rawSignature = decodeBase64(data?.signature)
    if (!rawSignature) return

    try {
      const publicKey = await getPublicKeyFromAddress(challenge.address)
      const valid = await verifySignature(publicKey, signatureBytes(rawSignature), challenge.challengeBytes)
      if (!valid) return
    } catch {
      return
    }

    this._setPlayerWallet(player, challenge.address)
  }

  onSolanaDisconnect(socket) {
    this._clearConnectChallenge(socket?.player)
    this._setPlayerWallet(socket.player, null)
  }

  onSolanaDepositRequest(socket, data) {
    socket.send('solanaDepositResult', {
      requestId: data?.requestId || null,
      error: 'Solana deposits are not implemented yet',
    })
  }

  onSolanaDepositSignatureResponse() {
    // Implemented in the transaction orchestration slice.
  }

  onSolanaWithdrawRequest(socket, data) {
    socket.send('solanaWithdrawResult', {
      requestId: data?.requestId || null,
      error: 'Solana withdrawals are not implemented yet',
    })
  }

  onSolanaWithdrawSignatureResponse() {
    // Implemented in the transaction orchestration slice.
  }

  onSocketDisconnect(socket) {
    const playerId = socket?.player?.data?.id
    if (!playerId) return
    this._clearConnectChallenge(playerId)
    this.pendingTransactions.delete(playerId)
  }
}
