import { createPublicClient, createWalletClient, custom, getAddress } from 'viem'

const SESSION_CACHE_TTL_MS = 3000
const DEFAULT_REFRESH_INTERVAL_MS = 3000

function getRuntimeAuthBridge() {
  if (typeof globalThis === 'undefined') return null
  return globalThis.__runtimeAuth || null
}

function getRuntimeWalletBridge() {
  if (typeof globalThis === 'undefined') return null
  return globalThis.__runtimeWalletBridge || null
}

function getInjectedProvider() {
  if (typeof window === 'undefined') return null
  const provider = window.ethereum
  if (!provider || typeof provider.request !== 'function') return null
  return provider
}

function normalizeAddress(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return ''
  try {
    return getAddress(trimmed)
  } catch {
    return ''
  }
}

function sameAddress(a, b) {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

function toHexChainId(chainId) {
  if (typeof chainId === 'number' && Number.isInteger(chainId) && chainId > 0) {
    return `0x${chainId.toString(16)}`
  }
  if (typeof chainId === 'string') {
    const trimmed = chainId.trim()
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return trimmed
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isInteger(parsed) && parsed > 0) {
      return `0x${parsed.toString(16)}`
    }
  }
  throw new Error(`Invalid chain id: ${chainId}`)
}

function parseChainId(chainId) {
  if (typeof chainId === 'number' && Number.isInteger(chainId) && chainId > 0) {
    return chainId
  }
  if (typeof chainId === 'string') {
    const trimmed = chainId.trim()
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      const parsedHex = Number.parseInt(trimmed, 16)
      return Number.isInteger(parsedHex) && parsedHex > 0 ? parsedHex : null
    }
    const parsedDec = Number.parseInt(trimmed, 10)
    return Number.isInteger(parsedDec) && parsedDec > 0 ? parsedDec : null
  }
  return null
}

async function readProviderChainId(provider) {
  if (!provider || typeof provider.request !== 'function') return null
  const chainId = await provider.request({ method: 'eth_chainId' }).catch(() => null)
  return parseChainId(chainId)
}

async function getInjectedAccounts({ request = false } = {}) {
  const provider = getInjectedProvider()
  if (!provider) return []

  const method = request ? 'eth_requestAccounts' : 'eth_accounts'
  const accounts = await provider
    .request({ method })
    .then(value => (Array.isArray(value) ? value : []))
    .catch(err => {
      if (!request) return []
      if (err?.code === 4001) throw err
      return []
    })

  return accounts
    .map(account => normalizeAddress(account))
    .filter(Boolean)
}

function toSignTypedDataPayload({ domain, types, primaryType, message }) {
  const payload = { domain, types, primaryType, message }
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === 'bigint') return value.toString()
    return value
  })
}

function isEmbeddedPrivyEvmWallet(wallet) {
  if (wallet?.type !== 'ethereum') return false
  if (!normalizeAddress(wallet.address)) return false

  const connectorType =
    typeof wallet?.connectorType === 'string' ? wallet.connectorType.toLowerCase() : ''
  const walletClientType =
    typeof wallet?.walletClientType === 'string' ? wallet.walletClientType.toLowerCase() : ''

  if (connectorType === 'embedded') return true
  return walletClientType === 'privy' || walletClientType === 'privy-v2'
}

function normalizePrivyWallets(snapshot) {
  const wallets = Array.isArray(snapshot?.wallets) ? snapshot.wallets : []
  return wallets.filter(isEmbeddedPrivyEvmWallet)
}

export class RuntimeWalletAdapter {
  constructor({
    authBridge = getRuntimeAuthBridge(),
    walletBridge = getRuntimeWalletBridge(),
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  } = {}) {
    this.authBridge = authBridge
    this.walletBridge = walletBridge
    this.refreshIntervalMs = refreshIntervalMs

    this.snapshot = {
      source: null,
      address: null,
      connected: false,
      chainId: null,
    }

    this.sessionWalletAddress = ''
    this.sessionWalletFetchedAt = 0
    this.listeners = new Set()

    this.unsubscribeWalletBridge = null
    this.unsubscribeAccount = null
    this.refreshTimer = null

    this._bindLifecycle()
    void this.refresh()
  }

  _bindLifecycle() {
    if (this.walletBridge && typeof this.walletBridge.subscribe === 'function') {
      this.unsubscribeWalletBridge = this.walletBridge.subscribe(() => {
        void this.refresh()
      })
    }

    if (this.authBridge && typeof this.authBridge.subscribeAccountChanges === 'function') {
      this.unsubscribeAccount = this.authBridge.subscribeAccountChanges(() => {
        void this.refresh()
      })
    }

    if (this.refreshIntervalMs > 0) {
      this.refreshTimer = setInterval(() => {
        void this.refresh()
      }, this.refreshIntervalMs)
    }
  }

  destroy() {
    this.unsubscribeWalletBridge?.()
    this.unsubscribeAccount?.()
    this.unsubscribeWalletBridge = null
    this.unsubscribeAccount = null
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    this.listeners.clear()
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {}
    }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  _emitChange() {
    const value = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  _updateSnapshot(nextSnapshot) {
    const changed =
      this.snapshot.source !== nextSnapshot.source ||
      this.snapshot.address !== nextSnapshot.address ||
      this.snapshot.connected !== nextSnapshot.connected ||
      this.snapshot.chainId !== nextSnapshot.chainId
    if (!changed) return
    this.snapshot = nextSnapshot
    this._emitChange()
  }

  getSnapshot() {
    return { ...this.snapshot }
  }

  getAddress() {
    return this.snapshot.address
  }

  isConnected() {
    return this.snapshot.connected
  }

  async _getSessionWalletAddress({ force = false } = {}) {
    const now = Date.now()
    if (!force && now - this.sessionWalletFetchedAt < SESSION_CACHE_TTL_MS) {
      return this.sessionWalletAddress
    }

    let session = null
    if (typeof this.authBridge?.getSessionUser === 'function') {
      session = await this.authBridge.getSessionUser().catch(() => null)
    }
    this.sessionWalletAddress = normalizeAddress(session?.user?.wallet_address || '')
    this.sessionWalletFetchedAt = now
    return this.sessionWalletAddress
  }

  _getPrivyWallets() {
    const snapshot = this.walletBridge?.getSnapshot?.() || null
    return normalizePrivyWallets(snapshot)
  }

  async _createPrivyContext(wallet) {
    if (!wallet || typeof wallet.getEthereumProvider !== 'function') return null
    const address = normalizeAddress(wallet.address)
    if (!address) return null
    const provider = await wallet.getEthereumProvider().catch(() => null)
    if (!provider || typeof provider.request !== 'function') return null
    return {
      source: 'privy',
      address,
      provider,
      wallet,
    }
  }

  async _resolveInjectedContext({ expectedAddress = '', request = false } = {}) {
    const provider = getInjectedProvider()
    if (!provider) return null

    const accounts = await getInjectedAccounts({ request })
    if (!accounts.length) return null

    if (expectedAddress) {
      const matched = accounts.find(address => sameAddress(address, expectedAddress))
      if (!matched) return null
      return {
        source: 'injected',
        address: matched,
        provider,
        wallet: null,
      }
    }

    return {
      source: 'injected',
      address: accounts[0],
      provider,
      wallet: null,
    }
  }

  async _resolveWalletContext({ request = false } = {}) {
    const sessionAddress = await this._getSessionWalletAddress()
    const privyWallets = this._getPrivyWallets()

    if (sessionAddress) {
      for (const wallet of privyWallets) {
        if (!sameAddress(normalizeAddress(wallet.address), sessionAddress)) continue
        const context = await this._createPrivyContext(wallet)
        if (context) return context
      }
    }

    for (const wallet of privyWallets) {
      const context = await this._createPrivyContext(wallet)
      if (context) return context
    }

    if (sessionAddress) {
      const injectedSession = await this._resolveInjectedContext({
        expectedAddress: sessionAddress,
        request,
      })
      if (injectedSession) return injectedSession
    }

    return this._resolveInjectedContext({ request })
  }

  async _requireWalletContext({ request = true } = {}) {
    const context = await this._resolveWalletContext({ request })
    if (!context) {
      throw new Error('Wallet not connected')
    }
    return context
  }

  async refresh() {
    const context = await this._resolveWalletContext({ request: false }).catch(() => null)
    if (!context) {
      this._updateSnapshot({
        source: null,
        address: null,
        connected: false,
        chainId: null,
      })
      return this.getSnapshot()
    }

    const chainId = await readProviderChainId(context.provider)
    this._updateSnapshot({
      source: context.source,
      address: context.address,
      connected: true,
      chainId,
    })
    return this.getSnapshot()
  }

  async getChainId({ request = false } = {}) {
    const context = await this._requireWalletContext({ request })
    return readProviderChainId(context.provider)
  }

  async switchChain(input) {
    const requestedChainId = typeof input === 'object' && input !== null ? input.chainId : input
    const targetChainHex = toHexChainId(requestedChainId)
    const context = await this._requireWalletContext({ request: true })

    if (context.source === 'privy' && typeof context.wallet?.switchChain === 'function') {
      const maybeNumber = parseChainId(targetChainHex)
      await context.wallet.switchChain(maybeNumber || targetChainHex)
    } else {
      await context.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainHex }],
      })
    }

    await this.refresh()
    return { id: parseChainId(targetChainHex) }
  }

  async signTypedData({ domain, types, primaryType, message }) {
    const context = await this._requireWalletContext({ request: true })
    const payload = toSignTypedDataPayload({ domain, types, primaryType, message })

    try {
      return await context.provider.request({
        method: 'eth_signTypedData_v4',
        params: [context.address, payload],
      })
    } catch (firstError) {
      try {
        return await context.provider.request({
          method: 'eth_signTypedData',
          params: [context.address, payload],
        })
      } catch {
        throw firstError
      }
    }
  }

  async _getViemClients({ request = true } = {}) {
    const context = await this._requireWalletContext({ request })
    const transport = custom(context.provider)

    const publicClient = createPublicClient({ transport })
    const walletClient = createWalletClient({ transport, account: context.address })

    return {
      context,
      publicClient,
      walletClient,
    }
  }

  async readContract(params) {
    const { publicClient } = await this._getViemClients({ request: true })
    return publicClient.readContract(params)
  }

  async getBalance({ address, request = false } = {}) {
    const { context, publicClient } = await this._getViemClients({ request })
    const resolvedAddress = normalizeAddress(address || context.address)
    if (!resolvedAddress) {
      throw new Error('Invalid address')
    }
    return publicClient.getBalance({ address: resolvedAddress })
  }

  async sendTransaction(params) {
    const { context, walletClient } = await this._getViemClients({ request: true })
    return walletClient.sendTransaction({
      ...params,
      account: params?.account || context.address,
    })
  }

  async writeContract(params) {
    const { context, walletClient } = await this._getViemClients({ request: true })
    return walletClient.writeContract({
      ...params,
      account: params?.account || context.address,
    })
  }

  async waitForTransactionReceipt(params) {
    const { publicClient } = await this._getViemClients({ request: false })
    return publicClient.waitForTransactionReceipt(params)
  }
}

export function createRuntimeWalletAdapter(options) {
  return new RuntimeWalletAdapter(options)
}
