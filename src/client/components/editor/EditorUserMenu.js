import { css } from '@firebolt-dev/css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderIcon, LogOutIcon, UserIcon, XIcon } from 'lucide-react'
import { editorTheme as theme } from './editorTheme'
import { cls } from '../cls'

const WORLD_SLUG_REGEX = /^[a-z0-9-]+$/

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

export function EditorUserMenu({ open, onClose, onDisconnectWallet }) {
  const apiBaseUrl = useMemo(resolveWorldServiceApiBase, [])
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
    void refreshOwnedWorld()
  }, [open, refreshOwnedWorld])

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
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(15px);
        }
        .editor-usermenu-panel {
          position: relative;
          width: 22rem;
          max-width: calc(100% - 2rem);
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
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .editor-usermenu-copy {
          font-size: 0.85rem;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.75);
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
          margin-top: auto;
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
          &.disabled {
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
          {loadingWorld && (
            <div className='editor-usermenu-copy'>
              <LoaderIcon size='0.95rem' style={{ verticalAlign: 'text-bottom', marginRight: '0.35rem' }} />
              Loading your world...
            </div>
          )}

          {!loadingWorld && ownedWorld && (
            <>
              <button className='editor-usermenu-worldcard' onClick={openMyWorld}>
                <div className='editor-usermenu-worldname'>{ownedWorld.name || 'My World'}</div>
                <div className='editor-usermenu-worldslug'>/{ownedWorld.slug}</div>
              </button>
            </>
          )}

          {!loadingWorld && !ownedWorld && !error && (
            <>
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
            </>
          )}

          {error && <div className='editor-usermenu-error'>{error}</div>}

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
        </div>
      </div>
    </div>
  )
}
