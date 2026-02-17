import { css } from '@firebolt-dev/css'
import { HammerIcon } from 'lucide-react'
import { cls } from '../cls'
import { editorTheme as theme } from './editorTheme'

export function EditorToolbar({ world, open, onToggle, buildMode, auth, onConnectWallet, onDisconnectWallet }) {
  return (
    <div
      className='editor-toolbar'
      css={css`
        position: absolute;
        top: calc(1rem + env(safe-area-inset-top));
        left: calc(1rem + env(safe-area-inset-left));
        display: flex;
        gap: 0.5rem;
        z-index: 10;
        pointer-events: auto;
      `}
    >
      <LogoBtn onClick={() => world.emit('open-menu')} />
      {buildMode && (
        <div
          className='editor-toolbar-toggle'
          css={css`
            width: 2.75rem;
            height: 2.75rem;
            display: flex;
            align-items: center;
            justify-content: center;
            background: ${open ? theme.panelBg : 'transparent'};
            border: 1px solid ${open ? 'rgba(255, 255, 255, 0.2)' : theme.border};
            border-radius: ${theme.radius};
            cursor: pointer;
            color: ${open ? 'white' : 'rgba(255, 255, 255, 0.6)'};
            &:hover {
              color: white;
              background: ${theme.bgHover};
            }
          `}
          onClick={onToggle}
        >
          <HammerIcon size='1.125rem' />
        </div>
      )}
      <WalletBtn auth={auth} onClick={onConnectWallet} />
      <WalletDisconnectBtn auth={auth} onClick={onDisconnectWallet} />
    </div>
  )
}

function LogoBtn({ onClick }) {
  return (
    <div
      className='editor-logo'
      css={css`
        width: 2.75rem;
        height: 2.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid ${theme.border};
        border-radius: ${theme.radius};
        cursor: pointer;
        &:hover {
          background: ${theme.bgHover};
        }
        img {
          width: 1.75rem;
          height: 1.75rem;
          object-fit: contain;
        }
      `}
      onClick={onClick}
    >
      <img src='/logo.png' />
    </div>
  )
}

function formatWalletAddress(address) {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function WalletBtn({ auth, onClick }) {
  if (!auth?.enabled) return null
  const providerUnavailable = !auth.providerAvailable
  const providerLoading = auth.mode === 'privy' && providerUnavailable
  const disabled = auth.pending || auth.connected || providerUnavailable
  const actionLabel = auth.mode === 'privy' ? 'Sign In' : 'Connect Wallet'
  const unavailableLabel = auth.mode === 'privy' ? 'Auth Unavailable' : 'No Wallet'
  const label = auth.pending
    ? 'Connecting...'
    : auth.connected
      ? (auth.address ? formatWalletAddress(auth.address) : 'Signed In')
      : providerLoading
        ? 'Loading Auth...'
        : providerUnavailable
          ? unavailableLabel
          : actionLabel
  return (
    <div
      className={cls('editor-wallet', { disabled })}
      css={css`
        min-width: 7.5rem;
        height: 2.75rem;
        padding: 0 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid ${theme.border};
        border-radius: ${theme.radius};
        color: rgba(255, 255, 255, 0.9);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        user-select: none;
        &:hover {
          background: ${theme.bgHover};
        }
        &.disabled {
          cursor: default;
          color: rgba(255, 255, 255, 0.55);
          background: transparent;
        }
      `}
      onClick={() => {
        if (disabled) return
        onClick?.()
      }}
    >
      {label}
    </div>
  )
}

function WalletDisconnectBtn({ auth, onClick }) {
  if (!auth?.enabled || !auth.connected) return null
  const disabled = auth.pending
  return (
    <div
      className={cls('editor-wallet-disconnect', { disabled })}
      css={css`
        height: 2.75rem;
        padding: 0 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid rgba(255, 125, 125, 0.45);
        border-radius: ${theme.radius};
        color: rgba(255, 185, 185, 0.95);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        user-select: none;
        &:hover {
          background: rgba(255, 90, 90, 0.12);
        }
        &.disabled {
          cursor: default;
          color: rgba(255, 185, 185, 0.55);
          background: transparent;
        }
      `}
      onClick={() => {
        if (disabled) return
        onClick?.()
      }}
    >
      Disconnect
    </div>
  )
}
