import { css } from '@firebolt-dev/css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderIcon, LogOutIcon, UserIcon, XIcon } from 'lucide-react'
import { useLinkAccount, useLogin, usePrivy } from '@privy-io/react-auth'
import { editorTheme as theme } from './editorTheme'
import { cls } from '../cls'

const WORLD_SLUG_REGEX = /^[a-z0-9-]+$/

const PRIVY_TAB_OPTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'world', label: 'World' },
]

const PRIVY_METHOD_LABELS = {
  email: 'Email',
  phone: 'Phone',
  wallet: 'Wallet',
  google: 'Google',
  google_oauth: 'Google',
  twitter: 'Twitter / X',
  twitter_oauth: 'Twitter / X',
  discord: 'Discord',
  discord_oauth: 'Discord',
  github: 'Github',
  github_oauth: 'Github',
  custom: 'Custom',
}

function resolveWorldServiceApiBase() {
  const configuredAuthUrl = typeof globalThis?.env?.PUBLIC_AUTH_URL === 'string' ? globalThis.env.PUBLIC_AUTH_URL.trim() : ''
  if (configuredAuthUrl) {
    return configuredAuthUrl.replace(/\/+$/, '').replace(/\/identity$/, '')
  }
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api`
}

function getErrorMessage(body, fallback) {
  const message = typeof body?.message === 'string' ? body.message : ''
  if (message) return message
  const error = typeof body?.error === 'string' ? body.error : ''
  if (error) return error
  return fallback
}

function slugify(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

async function requestJson(url, options = {}) {
  const hasBody = typeof options.body === 'string'
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(hasBody ? { 'content-type': 'application/json' } : null),
      ...(options.headers || null),
    },
    ...options,
  })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

function toPrivyErrorMessage(error, fallback) {
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }
  return fallback
}

function hasLinkedAccountType(user, linkedType) {
  if (!user || typeof user !== 'object') return false
  const linkedAccounts = Array.isArray(user.linkedAccounts) ? user.linkedAccounts : []
  return linkedAccounts.some(account => account?.type === linkedType)
}

function humanizePrivyMethod(method, fallback = 'Account') {
  if (typeof method !== 'string') return fallback
  const normalized = method.trim().toLowerCase()
  if (!normalized) return fallback
  return PRIVY_METHOD_LABELS[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function getDisplayName(user) {
  return (
    user?.google?.name ||
    user?.twitter?.name ||
    user?.discord?.username ||
    user?.github?.name ||
    user?.github?.username ||
    user?.email?.address ||
    'Privy user'
  )
}

function getPrimaryEmail(user) {
  return (
    user?.email?.address ||
    user?.google?.email ||
    user?.discord?.email ||
    user?.github?.email ||
    'No email linked yet'
  )
}

function truncateAddress(address) {
  if (typeof address !== 'string' || !address) return ''
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getWalletChainLabel(chainType) {
  if (chainType === 'ethereum') return 'EVM'
  if (chainType === 'solana') return 'Solana'
  if (typeof chainType === 'string' && chainType) return chainType
  return 'Wallet'
}

function PrivyUserTabs({ activeTab, onTabChange, canManageWorld, renderWorldContent, onSignOut, signingOut }) {
  const { ready, authenticated, user, logout } = usePrivy()
  const [pendingAction, setPendingAction] = useState('')
  const [feedback, setFeedback] = useState(null)

  const setFeedbackError = useCallback(message => {
    setFeedback({ type: 'error', message })
  }, [])

  const setFeedbackSuccess = useCallback(message => {
    setFeedback({ type: 'success', message })
  }, [])

  const clearFeedback = useCallback(() => {
    setFeedback(null)
  }, [])

  const { login } = useLogin({
    onError: error => {
      setPendingAction('')
      setFeedbackError(toPrivyErrorMessage(error, 'Unable to open Privy login.'))
    },
  })

  const { linkGoogle, linkTwitter, linkDiscord, linkWallet } = useLinkAccount({
    onSuccess: ({ linkMethod }) => {
      setPendingAction('')
      setFeedbackSuccess(`Linked ${humanizePrivyMethod(linkMethod)}.`)
    },
    onError: (error, details) => {
      setPendingAction('')
      const methodLabel = humanizePrivyMethod(details?.linkMethod, 'account')
      const reason = toPrivyErrorMessage(error, 'Unknown error')
      setFeedbackError(`Unable to link ${methodLabel}: ${reason}`)
    },
  })

  useEffect(() => {
    if (authenticated) {
      setPendingAction('')
    }
  }, [authenticated])

  const linkedWallets = useMemo(() => {
    if (!user || !Array.isArray(user.linkedAccounts)) return []
    return user.linkedAccounts.filter(account => account?.type === 'wallet' && typeof account?.address === 'string' && account.address)
  }, [user])

  const socialProviders = useMemo(() => {
    return [
      {
        key: 'google',
        label: 'Google',
        description: 'Connect your Google account for seamless sign in.',
        linkedType: 'google_oauth',
        subject: user?.google?.subject,
        handle: user?.google?.email || user?.google?.name,
        link: linkGoogle,
      },
      {
        key: 'discord',
        label: 'Discord',
        description: 'Link Discord to unlock community features.',
        linkedType: 'discord_oauth',
        subject: user?.discord?.subject,
        handle: user?.discord?.username || user?.discord?.email,
        link: linkDiscord,
      },
      {
        key: 'twitter',
        label: 'Twitter / X',
        description: 'Use your X account for social verification.',
        linkedType: 'twitter_oauth',
        subject: user?.twitter?.subject,
        handle: user?.twitter?.username,
        link: linkTwitter,
      },
    ]
  }, [user, linkGoogle, linkTwitter, linkDiscord])

  const runLogin = useCallback(() => {
    clearFeedback()
    try {
      login()
    } catch (error) {
      setFeedbackError(toPrivyErrorMessage(error, 'Unable to open Privy login.'))
    }
  }, [login, clearFeedback, setFeedbackError])

  const runSignOut = useCallback(async () => {
    if (signingOut || pendingAction === 'signout') return
    clearFeedback()
    setPendingAction('signout')
    try {
      if (typeof onSignOut === 'function') {
        await onSignOut()
      } else {
        await logout()
      }
    } catch (error) {
      setFeedbackError(toPrivyErrorMessage(error, 'Unable to sign out.'))
    } finally {
      setPendingAction('')
    }
  }, [clearFeedback, logout, onSignOut, pendingAction, setFeedbackError, signingOut])

  const runLinkAction = useCallback(
    (key, action) => {
      clearFeedback()
      setPendingAction(`link-${key}`)
      try {
        action()
      } catch (error) {
        setPendingAction('')
        setFeedbackError(toPrivyErrorMessage(error, 'Unable to link account.'))
      }
    },
    [clearFeedback, setFeedbackError],
  )

  const runLinkWallet = useCallback(
    chain => {
      const options =
        chain === 'solana'
          ? { walletChainType: 'solana-only', description: 'Link a Solana wallet (Phantom, Backpack, etc).' }
          : { walletChainType: 'ethereum-only', description: 'Link an Ethereum wallet to this user.' }
      runLinkAction(`wallet-${chain}`, () => linkWallet(options))
    },
    [linkWallet, runLinkAction],
  )

  const renderAuthRequired = (copy = 'Sign in with Privy to continue.') => {
    return (
      <div className='editor-usermenu-section'>
        <div className='editor-usermenu-copy'>{copy}</div>
        <button className='editor-usermenu-btn' onClick={runLogin}>
          Sign In with Privy
        </button>
      </div>
    )
  }

  const renderProfileTab = () => {
    if (!ready) {
      return <div className='editor-usermenu-copy'>Loading auth...</div>
    }

    if (!authenticated || !user) {
      return renderAuthRequired('Log in to manage your profile and linked accounts.')
    }

    const displayName = getDisplayName(user)
    const primaryEmail = getPrimaryEmail(user)

    return (
      <div className='editor-usermenu-section'>
        <div className='editor-usermenu-card'>
          <div className='editor-usermenu-profile-name'>{displayName}</div>
          <div className='editor-usermenu-copy'>{primaryEmail}</div>
        </div>

        <div className='editor-usermenu-card'>
          <div className='editor-usermenu-providertitle'>Social Accounts</div>
          <div className='editor-usermenu-copy'>Link social profiles for additional sign-in methods.</div>
          <div className='editor-usermenu-section'>
            {socialProviders.map(provider => {
              const isLinked = !!provider.subject || hasLinkedAccountType(user, provider.linkedType)
              const isBusy = pendingAction === `link-${provider.key}`
              return (
                <div key={provider.key} className='editor-usermenu-providerrow'>
                  <div className='editor-usermenu-providermeta'>
                    <div className='editor-usermenu-providertitle'>{provider.label}</div>
                    <div className='editor-usermenu-copy'>
                      {isLinked
                        ? provider.handle
                          ? `Linked as ${provider.handle}`
                          : 'Linked'
                        : provider.description}
                    </div>
                  </div>
                  <button
                    className='editor-usermenu-linkbtn'
                    disabled={isLinked || isBusy}
                    onClick={() => {
                      if (isLinked || isBusy) return
                      runLinkAction(provider.key, provider.link)
                    }}
                  >
                    {isLinked ? 'Linked' : isBusy ? 'Linking...' : 'Link'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className='editor-usermenu-actions'>
          <button
            className={cls('editor-usermenu-btn danger', {
              disabled: signingOut || pendingAction === 'signout',
            })}
            onClick={() => {
              if (signingOut || pendingAction === 'signout') return
              void runSignOut()
            }}
          >
            {(signingOut || pendingAction === 'signout') && <LoaderIcon size='0.95rem' />}
            {!signingOut && pendingAction !== 'signout' && <LogOutIcon size='0.95rem' />}
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  const renderWalletsTab = () => {
    if (!ready) {
      return <div className='editor-usermenu-copy'>Loading auth...</div>
    }

    if (!authenticated || !user) {
      return renderAuthRequired('Sign in first, then link wallets from this tab.')
    }

    const linkingEvm = pendingAction === 'link-wallet-evm'
    const linkingSolana = pendingAction === 'link-wallet-solana'

    return (
      <div className='editor-usermenu-section'>
        <div className='editor-usermenu-providerrow'>
          <div className='editor-usermenu-providermeta'>
            <div className='editor-usermenu-providertitle'>External wallets</div>
            <div className='editor-usermenu-copy'>Link EVM or Solana wallets to this account.</div>
          </div>
          <div className='editor-usermenu-inlineactions'>
            <button
              className='editor-usermenu-linkbtn'
              disabled={linkingEvm}
              onClick={() => {
                if (linkingEvm) return
                runLinkWallet('evm')
              }}
            >
              {linkingEvm ? 'Linking...' : 'Link EVM'}
            </button>
            <button
              className='editor-usermenu-linkbtn'
              disabled={linkingSolana}
              onClick={() => {
                if (linkingSolana) return
                runLinkWallet('solana')
              }}
            >
              {linkingSolana ? 'Linking...' : 'Link Solana'}
            </button>
          </div>
        </div>

        {linkedWallets.length === 0 ? (
          <div className='editor-usermenu-copy'>No linked wallets yet.</div>
        ) : (
          <div className='editor-usermenu-walletlist'>
            {linkedWallets.map(wallet => {
              const key = `${wallet.chainType || 'wallet'}:${wallet.address}`
              return (
                <div key={key} className='editor-usermenu-walletrow'>
                  <div className='editor-usermenu-walletaddr'>{truncateAddress(wallet.address)}</div>
                  <div className='editor-usermenu-walletchain'>{getWalletChainLabel(wallet.chainType)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const renderTabContent = () => {
    if (activeTab === 'profile') return renderProfileTab()
    if (activeTab === 'wallets') return renderWalletsTab()
    return renderWorldContent?.()
  }

  return (
    <>
      <div className='editor-usermenu-tabs'>
        {PRIVY_TAB_OPTIONS.map(tab => (
          <button
            key={tab.id}
            className={cls('editor-usermenu-tab', { active: activeTab === tab.id })}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {renderTabContent()}

      {feedback && (
        <div className={cls('editor-usermenu-feedback', { success: feedback.type === 'success', error: feedback.type === 'error' })}>
          {feedback.message}
        </div>
      )}
    </>
  )
}

export function EditorUserMenu({ open, auth, onClose, onDisconnectWallet }) {
  const apiBaseUrl = useMemo(resolveWorldServiceApiBase, [])
  const isPrivyMode = auth?.mode === 'privy'
  const canManageWorld = !!auth?.connected
  const [activeTab, setActiveTab] = useState(isPrivyMode ? 'profile' : 'world')
  const [loadingWorld, setLoadingWorld] = useState(false)
  const [ownedWorld, setOwnedWorld] = useState(null)
  const [error, setError] = useState('')
  const [worldName, setWorldName] = useState('My World')
  const [worldSlug, setWorldSlug] = useState('my-world')
  const [worldDescription, setWorldDescription] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [createError, setCreateError] = useState('')
  const [creatingWorld, setCreatingWorld] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (!open) return
    setActiveTab(isPrivyMode ? 'profile' : 'world')
  }, [open, isPrivyMode])

  const refreshOwnedWorld = useCallback(async () => {
    if (!apiBaseUrl) {
      setOwnedWorld(null)
      setError('World service API is unavailable.')
      return
    }

    setLoadingWorld(true)
    setError('')
    const result = await requestJson(`${apiBaseUrl}/my/worlds`, { method: 'GET' })
    setLoadingWorld(false)
    if (!result.ok) {
      if (result.status === 401) {
        setOwnedWorld(null)
        setError('Session expired. Please sign in again.')
        return
      }
      setOwnedWorld(null)
      setError(getErrorMessage(result.body, 'Unable to load your world.'))
      return
    }

    const owned = Array.isArray(result.body?.owned) ? result.body.owned : []
    const world = owned[0] || null
    setOwnedWorld(world)
    if (world) {
      const nextName = typeof world.name === 'string' ? world.name : 'My World'
      const nextSlug = typeof world.slug === 'string' ? world.slug : slugify(nextName)
      const nextDescription = typeof world.description === 'string' ? world.description : ''
      setWorldName(nextName)
      setWorldSlug(nextSlug)
      setWorldDescription(nextDescription)
      setSlugEdited(true)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    if (!open) return
    setCreateError('')
    if (!canManageWorld) {
      setLoadingWorld(false)
      setOwnedWorld(null)
      setError('')
      return
    }
    void refreshOwnedWorld()
  }, [open, canManageWorld, refreshOwnedWorld])

  useEffect(() => {
    if (slugEdited) return
    setWorldSlug(slugify(worldName))
  }, [worldName, slugEdited])

  useEffect(() => {
    if (!open) return
    const onKeyDown = event => {
      if (event.code === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const openMyWorld = () => {
    const slug = typeof ownedWorld?.slug === 'string' ? ownedWorld.slug.trim() : ''
    if (!slug) return
    window.location.href = `/worlds/${slug}`
  }

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await onDisconnectWallet?.()
    } catch {
      // disconnect flow handles fallback/reload
    } finally {
      setSigningOut(false)
    }
  }

  const createWorld = async () => {
    if (creatingWorld || loadingWorld) return
    if (!apiBaseUrl) {
      setCreateError('World service API is unavailable.')
      return
    }

    const normalizedName = worldName.trim()
    const normalizedSlug = slugify(worldSlug)
    const normalizedDescription = worldDescription.trim()

    if (!normalizedName) {
      setCreateError('World name is required.')
      return
    }
    if (normalizedSlug.length < 3) {
      setCreateError('Slug must be at least 3 characters.')
      return
    }
    if (!WORLD_SLUG_REGEX.test(normalizedSlug)) {
      setCreateError('Slug can only use lowercase letters, numbers, and hyphens.')
      return
    }

    setCreateError('')
    setCreatingWorld(true)
    const result = await requestJson(`${apiBaseUrl}/worlds`, {
      method: 'POST',
      body: JSON.stringify({
        slug: normalizedSlug,
        name: normalizedName,
        ...(normalizedDescription ? { description: normalizedDescription } : null),
      }),
    })
    setCreatingWorld(false)

    if (!result.ok) {
      const code = typeof result.body?.error === 'string' ? result.body.error : ''
      if (result.status === 401) {
        setCreateError('Session expired. Please sign in again.')
        return
      }
      if (result.status === 409 && code === 'world_limit_reached') {
        setCreateError('A personal world already exists for this account.')
        await refreshOwnedWorld()
        return
      }
      if (result.status === 409 && code.toLowerCase().includes('slug')) {
        setCreateError('That slug is already in use.')
        return
      }
      setCreateError(getErrorMessage(result.body, 'Unable to create world.'))
      return
    }

    const created = result.body?.world || null
    if (created) {
      setOwnedWorld(created)
      setSlugEdited(true)
      setCreateError('')
      return
    }

    await refreshOwnedWorld()
  }

  const renderWorldContent = () => {
    if (!canManageWorld) {
      return (
        <div className='editor-usermenu-section'>
          <div className='editor-usermenu-copy'>Sign in and complete session setup to manage your personal world.</div>
        </div>
      )
    }

    if (loadingWorld) {
      return (
        <div className='editor-usermenu-section'>
          <div className='editor-usermenu-copy'>
            <LoaderIcon size='0.95rem' style={{ verticalAlign: 'text-bottom', marginRight: '0.35rem' }} />
            Loading your world...
          </div>
        </div>
      )
    }

    if (ownedWorld) {
      return (
        <div className='editor-usermenu-section'>
          <button className='editor-usermenu-worldcard' onClick={openMyWorld}>
            <div className='editor-usermenu-worldname'>{ownedWorld.name || 'My World'}</div>
            <div className='editor-usermenu-worldslug'>/{ownedWorld.slug}</div>
          </button>
        </div>
      )
    }

    if (error) {
      return (
        <div className='editor-usermenu-section'>
          <div className='editor-usermenu-error'>{error}</div>
        </div>
      )
    }

    return (
      <div className='editor-usermenu-section'>
        <div className='editor-usermenu-copy'>No personal world found. Create one now.</div>
        <label className='editor-usermenu-field'>
          <div className='editor-usermenu-label'>World Name</div>
          <input
            className='editor-usermenu-input'
            value={worldName}
            maxLength={100}
            onChange={event => setWorldName(event.target.value)}
          />
        </label>
        <label className='editor-usermenu-field'>
          <div className='editor-usermenu-label'>Slug</div>
          <input
            className='editor-usermenu-input'
            value={worldSlug}
            maxLength={32}
            onChange={event => {
              setSlugEdited(true)
              setWorldSlug(slugify(event.target.value))
            }}
          />
        </label>
        <label className='editor-usermenu-field'>
          <div className='editor-usermenu-label'>Description (Optional)</div>
          <textarea
            className='editor-usermenu-textarea'
            value={worldDescription}
            maxLength={1000}
            onChange={event => setWorldDescription(event.target.value)}
          />
        </label>
        {createError && <div className='editor-usermenu-error'>{createError}</div>}
        <div className='editor-usermenu-actions'>
          <button
            className={cls('editor-usermenu-btn', { disabled: creatingWorld || loadingWorld })}
            onClick={() => {
              if (creatingWorld || loadingWorld) return
              void createWorld()
            }}
          >
            {creatingWorld && <LoaderIcon size='0.95rem' />}
            {creatingWorld ? 'Creating...' : 'Create My World'}
          </button>
        </div>
      </div>
    )
  }

  if (!open) return null

  return (
    <div
      className='editor-usermenu'
      css={css`
        position: absolute;
        inset: 0;
        z-index: 100;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        .editor-usermenu-backdrop {
          position: absolute;
          inset: 0;
          z-index: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(15px);
        }
        .editor-usermenu-panel {
          position: relative;
          z-index: 1;
          width: 28rem;
          max-width: calc(100% - 2rem);
          max-height: calc(100% - 2rem);
          min-height: 14rem;
          display: flex;
          flex-direction: column;
          background: ${theme.bgPanel};
          border: 1px solid ${theme.border};
          border-radius: ${theme.radius};
          overflow: hidden;
        }
        .editor-usermenu-head {
          height: 3.5rem;
          padding: 0 0.75rem 0 1rem;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          border-bottom: 1px solid ${theme.borderLight};
          flex-shrink: 0;
        }
        .editor-usermenu-head-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
        }
        .editor-usermenu-head-spacer {
          flex: 1;
        }
        .editor-usermenu-close {
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: ${theme.radiusSmall};
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          &:hover {
            color: white;
            background: ${theme.bgHover};
          }
        }
        .editor-usermenu-content {
          flex: 1;
          min-height: 0;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          overflow-y: auto;
        }
        .editor-usermenu-copy {
          font-size: 0.85rem;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.75);
        }
        .editor-usermenu-tabs {
          display: flex;
          gap: 0.45rem;
          flex-wrap: wrap;
        }
        .editor-usermenu-tab {
          height: 2rem;
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          padding: 0 0.65rem;
          background: transparent;
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          &:hover {
            background: ${theme.bgHover};
            color: rgba(255, 255, 255, 0.95);
          }
          &.active {
            background: ${theme.bgHover};
            color: rgba(255, 255, 255, 0.95);
            border-color: ${theme.borderHover};
          }
        }
        .editor-usermenu-section {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .editor-usermenu-card {
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          background: ${theme.bgInput};
          padding: 0.8rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .editor-usermenu-profile-name {
          font-size: 0.92rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
        }
        .editor-usermenu-providerrow {
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          background: ${theme.bgInput};
          padding: 0.65rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
        }
        .editor-usermenu-providermeta {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .editor-usermenu-providertitle {
          font-size: 0.82rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
        }
        .editor-usermenu-inlineactions {
          display: flex;
          align-items: center;
          gap: 0.45rem;
        }
        .editor-usermenu-linkbtn {
          height: 2.25rem;
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          padding: 0 0.6rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.78rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          background: transparent;
          cursor: pointer;
          white-space: nowrap;
          &:hover {
            background: ${theme.bgHover};
          }
          &.linked,
          &:disabled {
            cursor: default;
            color: rgba(255, 255, 255, 0.55);
            border-color: ${theme.borderLight};
            background: rgba(255, 255, 255, 0.04);
          }
        }
        .editor-usermenu-walletlist {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .editor-usermenu-walletrow {
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          background: ${theme.bgInput};
          padding: 0.55rem 0.65rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
        }
        .editor-usermenu-walletaddr {
          font-size: 0.8rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          color: rgba(255, 255, 255, 0.9);
        }
        .editor-usermenu-walletchain {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.6);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .editor-usermenu-worldcard {
          width: 100%;
          appearance: none;
          text-align: left;
          border: 1px solid ${theme.border};
          background: ${theme.bgInput};
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          cursor: pointer;
          border-radius: ${theme.radiusSmall};
          &:hover {
            background: ${theme.bgHover};
            border-color: ${theme.borderHover};
          }
          &:focus-visible {
            outline: 1px solid ${theme.borderHover};
            outline-offset: 2px;
          }
        }
        .editor-usermenu-worldname {
          font-size: 0.9rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
        }
        .editor-usermenu-worldslug {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.55);
        }
        .editor-usermenu-error {
          font-size: 0.82rem;
          color: #ff8e8e;
        }
        .editor-usermenu-feedback {
          font-size: 0.82rem;
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          padding: 0.55rem 0.65rem;
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.75);
        }
        .editor-usermenu-feedback.success {
          border-color: rgba(102, 240, 150, 0.35);
          color: rgba(164, 255, 194, 0.95);
          background: rgba(49, 122, 74, 0.2);
        }
        .editor-usermenu-feedback.error {
          border-color: rgba(255, 110, 110, 0.35);
          color: rgba(255, 180, 180, 0.95);
          background: rgba(122, 49, 49, 0.2);
        }
        .editor-usermenu-field {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .editor-usermenu-label {
          font-size: 0.72rem;
          color: rgba(255, 255, 255, 0.55);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .editor-usermenu-input,
        .editor-usermenu-textarea {
          width: 100%;
          border: 1px solid ${theme.border};
          background: ${theme.bgInput};
          color: rgba(255, 255, 255, 0.95);
          font-size: 0.85rem;
          border-radius: ${theme.radiusSmall};
          padding: 0.6rem 0.65rem;
          &:focus {
            border-color: ${theme.borderHover};
            outline: none;
          }
        }
        .editor-usermenu-textarea {
          min-height: 4.5rem;
          resize: vertical;
        }
        .editor-usermenu-actions {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .editor-usermenu-btn {
          flex: 1;
          height: 2.5rem;
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          padding: 0 0.9rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.45rem;
          font-size: 0.82rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          background: transparent;
          cursor: pointer;
          user-select: none;
          &:hover {
            background: ${theme.bgHover};
          }
          &.danger {
            border-color: rgba(255, 125, 125, 0.45);
            color: rgba(255, 185, 185, 0.95);
          }
          &.disabled,
          &:disabled {
            cursor: default;
            color: rgba(255, 255, 255, 0.55);
            background: transparent;
          }
        }
      `}
    >
      <div className='editor-usermenu-backdrop' onClick={onClose} />
      <div className='editor-usermenu-panel'>
        <div className='editor-usermenu-head'>
          <UserIcon size='1rem' />
          <div className='editor-usermenu-head-title'>User</div>
          <div className='editor-usermenu-head-spacer' />
          <div className='editor-usermenu-close' onClick={onClose}>
            <XIcon size='1rem' />
          </div>
        </div>
        <div className='editor-usermenu-content'>
          {isPrivyMode ? (
            <PrivyUserTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              canManageWorld={canManageWorld}
              renderWorldContent={renderWorldContent}
              onSignOut={signOut}
              signingOut={signingOut}
            />
          ) : (
            <>
              {renderWorldContent()}
              {canManageWorld && (
                <div className='editor-usermenu-actions'>
                  <button
                    className={cls('editor-usermenu-btn danger', { disabled: signingOut })}
                    onClick={() => {
                      if (signingOut) return
                      void signOut()
                    }}
                  >
                    {signingOut && <LoaderIcon size='0.95rem' />}
                    {!signingOut && <LogOutIcon size='0.95rem' />}
                    Sign Out
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
