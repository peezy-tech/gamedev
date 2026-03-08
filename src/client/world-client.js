// import 'ses'
// import '../core/lockdown'
import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { useActiveWallet } from '@privy-io/react-auth'
import { useStandardWallets, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'

import { createClientWorld } from '../core/createClientWorld'
import { CoreUI } from './components/CoreUI'
import { assetPath } from './utils'
import { EditorLayout } from './components/editor/EditorLayout'
import { createRuntimeWalletAdapter } from './wallet-adapter'

export { System } from '../core/systems/System'

function normalizeSolanaAddress(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function sameSolanaWallet(a, b) {
  return normalizeSolanaAddress(a) === normalizeSolanaAddress(b)
}

function resolveSolanaCluster(chain) {
  if (typeof chain !== 'string') return 'mainnet'
  if (chain.includes('devnet')) return 'devnet'
  if (chain.includes('testnet')) return 'testnet'
  return 'mainnet'
}

function publishRuntimeSolanaWalletSnapshot(snapshot) {
  if (typeof globalThis === 'undefined') return
  const normalized = {
    address: snapshot?.address || null,
    connected: !!snapshot?.connected,
    available: !!snapshot?.available,
    cluster: snapshot?.cluster || 'mainnet',
    updatedAt: Date.now(),
  }
  globalThis.__runtimeResolvedSolanaWallet = normalized
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof window.CustomEvent === 'function'
  ) {
    window.dispatchEvent(new window.CustomEvent('runtime-solana-wallet-snapshot', { detail: normalized }))
  }
}

function PrivySolanaWalletBridge({ world }) {
  const { wallet: activePrivyWallet } = useActiveWallet()
  const { wallets: connectedSolanaWallets = [] } = useSolanaWallets()
  const { wallets: standardSolanaWallets = [] } = useStandardWallets()

  useEffect(() => {
    const activeWallet =
      activePrivyWallet?.type === 'solana'
        ? connectedSolanaWallets.find(wallet => sameSolanaWallet(wallet.address, activePrivyWallet.address)) ||
          connectedSolanaWallets[0] ||
          null
        : connectedSolanaWallets[0] || null

    const standardWallet = activeWallet?.standardWallet || standardSolanaWallets[0] || null
    const chain = activeWallet?.standardWallet?.chains?.[0] || standardWallet?.chains?.[0] || 'solana:mainnet'
    const cluster = resolveSolanaCluster(chain)

    const binding =
      standardWallet || activeWallet
        ? {
            address: activeWallet?.address || null,
            connected: !!activeWallet,
            cluster,
            getAddress: () => activeWallet?.address || null,
            isConnected: () => !!activeWallet,
            connect: async () => {
              const connectFeature = standardWallet?.features?.['standard:connect']
              if (!connectFeature?.connect) {
                throw new Error('No Solana wallet is available')
              }
              await connectFeature.connect()
            },
            disconnect: async () => {
              if (activeWallet) {
                await activeWallet.disconnect()
                return
              }
              const disconnectFeature = standardWallet?.features?.['standard:disconnect']
              await disconnectFeature?.disconnect?.()
            },
            signMessage: async message => {
              if (!activeWallet) {
                throw new Error('Solana wallet not connected')
              }
              const result = await activeWallet.signMessage({ message })
              return result?.signature || null
            },
            signTransaction: async transaction => {
              if (!activeWallet) {
                throw new Error('Solana wallet not connected')
              }
              const result = await activeWallet.signTransaction({
                transaction,
                chain,
              })
              return result?.signedTransaction || null
            },
          }
        : null

    world.solana?.bind?.(binding)
    publishRuntimeSolanaWalletSnapshot({
      address: activeWallet?.address || null,
      connected: !!activeWallet,
      available: !!standardWallet,
      cluster,
    })
  }, [world, activePrivyWallet, connectedSolanaWallets, standardSolanaWallets])

  useEffect(() => {
    return () => {
      world.solana?.bind?.(null)
      publishRuntimeSolanaWalletSnapshot({
        address: null,
        connected: false,
        available: false,
        cluster: 'mainnet',
      })
    }
  }, [world])

  return null
}

export function Client({ wsUrl, apiUrl, authUrl, connectionStatus, onSetup }) {
  const viewportRef = useRef()
  const cssLayerRef = useRef()
  const uiRef = useRef()
  const world = useMemo(() => createClientWorld(), [])
  const walletAdapter = useMemo(() => createRuntimeWalletAdapter(), [])
  const shouldUsePrivySolanaBridge = typeof globalThis !== 'undefined' && globalThis.__runtimeAuth?.mode === 'privy'
  const [ui, setUI] = useState(world.ui.state)
  const [resolvedWsUrl, setResolvedWsUrl] = useState(null)
  const [apiBaseUrl, setApiBaseUrl] = useState(null)
  const [authBaseUrl, setAuthBaseUrl] = useState(null)
  const [entered] = useState(true)
  useEffect(() => {
    world.on('ui', setUI)
    return () => {
      world.off('ui', setUI)
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      try {
        let finalWsUrl = wsUrl
        if (typeof finalWsUrl === 'function') {
          finalWsUrl = finalWsUrl()
          if (finalWsUrl instanceof Promise) finalWsUrl = await finalWsUrl
        }
        if (cancelled) return
        setResolvedWsUrl(finalWsUrl)
        const derivedHttpUrl = finalWsUrl.replace(/^ws/, 'http').replace(/\/ws.*$/, '')
        setApiBaseUrl(apiUrl || derivedHttpUrl)
        const cleanedAuthUrl = typeof authUrl === 'string' ? authUrl.trim() : authUrl
        setAuthBaseUrl(cleanedAuthUrl)
      } catch (err) {
        console.error('Failed to resolve connection:', err)
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [wsUrl, apiUrl, authUrl])

  useEffect(() => {
    const publishRuntimeWalletSnapshot = snapshot => {
      if (typeof globalThis === 'undefined') return
      const normalized = {
        source: snapshot?.source || null,
        address: snapshot?.address || null,
        connected: !!snapshot?.connected,
        chainId: snapshot?.chainId ?? null,
        updatedAt: Date.now(),
      }
      globalThis.__runtimeResolvedWallet = normalized
      if (
        typeof window !== 'undefined' &&
        typeof window.dispatchEvent === 'function' &&
        typeof window.CustomEvent === 'function'
      ) {
        window.dispatchEvent(new window.CustomEvent('runtime-wallet-snapshot', { detail: normalized }))
      }
    }

    const applyWalletBinding = snapshot => {
      publishRuntimeWalletSnapshot(snapshot)
      const binding = {
        walletAdapter,
        address: snapshot?.address || null,
        isConnected: !!snapshot?.connected,
      }
      world.evm?.bind?.(binding)
      world.hyperliquid?.bind?.(binding)
    }

    applyWalletBinding(walletAdapter.getSnapshot())
    const unsubscribe = walletAdapter.subscribe(snapshot => {
      applyWalletBinding(snapshot)
    })
    void walletAdapter.refresh().then(applyWalletBinding).catch(() => {})

    return () => {
      unsubscribe?.()
    }
  }, [world, walletAdapter])

  useEffect(() => {
    return () => {
      walletAdapter.destroy()
    }
  }, [walletAdapter])

  useEffect(() => {
    if (!entered) return
    if (!resolvedWsUrl) return
    const init = async () => {
      const viewport = viewportRef.current
      const cssLayer = cssLayerRef.current
      const ui = uiRef.current
      const baseEnvironment = {
        model: assetPath('/base-environment.glb'),
        bg: null, // '/day2-2k.jpg',
        hdr: assetPath('/Clear_08_4pm_LDR.hdr'),
        rotationY: 0,
        sunDirection: new THREE.Vector3(-1, -2, -2).normalize(),
        sunIntensity: 1,
        sunColor: 0xffffff,
        fogNear: null,
        fogFar: null,
        fogColor: null,
      }
      const config = { viewport, cssLayer, ui, wsUrl: resolvedWsUrl, baseEnvironment, apiUrl: apiBaseUrl, authUrl: authBaseUrl }
      onSetup?.(world, config)
      world.init(config)
    }
    init()
  }, [entered, resolvedWsUrl, apiBaseUrl, authBaseUrl])
  return (
    <div
      className='App'
      css={css`
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 100vh;
        height: 100dvh;
        .App__viewport {
          position: relative;
          overflow: hidden;
          min-width: 0;
          min-height: 0;
          width: 100%;
          height: 100%;
        }
        .App__cssLayer {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
        }
        .App__ui {
          position: absolute;
          inset: 0;
          z-index: 10;
          pointer-events: none;
          user-select: none;
          display: ${ui.visible ? 'block' : 'none'};
        }
      `}
    >
      {shouldUsePrivySolanaBridge ? <PrivySolanaWalletBridge world={world} /> : null}
      <EditorLayout world={world} ui={ui}>
        <div className='App__viewport' ref={viewportRef}>
          <div className='App__cssLayer' ref={cssLayerRef} />
        </div>
      </EditorLayout>
      <div className='App__ui' ref={uiRef}>
        <CoreUI world={world} connectionStatus={connectionStatus} />
      </div>
    </div>
  )
}
