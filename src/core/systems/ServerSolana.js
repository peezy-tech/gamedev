import { System } from './System'

function isPlayer(entity) {
  return !!entity?.isPlayer && !!entity?.data?.id
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
    this._setPlayerWallet(player, null)
    this.world.network.sendTo(player.data.id, 'solanaDisconnectRequest')
  }

  deposit() {
    throw new Error('Solana deposits are not implemented yet')
  }

  withdraw() {
    throw new Error('Solana withdrawals are not implemented yet')
  }

  onSolanaConnectChallengeRequest() {
    // Implemented in the nonce-challenge slice.
  }

  onSolanaConnectResponse() {
    // Implemented in the nonce-challenge slice.
  }

  onSolanaDisconnect(socket) {
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
    this.connectChallenges.delete(playerId)
    this.pendingTransactions.delete(playerId)
  }
}
