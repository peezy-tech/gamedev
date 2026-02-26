import { System } from './System'

export class EVM extends System {
  constructor(world) {
    super(world)
    this.walletAdapter = null
    this.address = null
    this.connected = false
  }

  bind({ walletAdapter, address, isConnected } = {}) {
    this.walletAdapter = walletAdapter || null

    if (typeof address === 'string' && address) {
      this.address = address
    } else {
      this.address = this.walletAdapter?.getAddress?.() || null
    }

    if (typeof isConnected === 'boolean') {
      this.connected = isConnected
    } else {
      this.connected = !!this.walletAdapter?.isConnected?.()
    }
  }

  getAddress() {
    return this.address || this.walletAdapter?.getAddress?.() || null
  }

  isConnected() {
    if (this.connected) return true
    return !!this.walletAdapter?.isConnected?.()
  }
}
