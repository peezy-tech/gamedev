import { css } from '@firebolt-dev/css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobeIcon, LoaderIcon, SearchIcon, XIcon } from 'lucide-react'
import { editorTheme as theme } from './editor/editorTheme'

function resolveWorldServiceApiBase() {
  const configuredAuthUrl = typeof globalThis?.env?.PUBLIC_AUTH_URL === 'string' ? globalThis.env.PUBLIC_AUTH_URL.trim() : ''
  if (configuredAuthUrl) {
    return configuredAuthUrl.replace(/\/+$/, '').replace(/\/identity$/, '')
  }
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api`
}

async function fetchPlayerCount(apiBase, slug) {
  try {
    const statusRes = await fetch(`${apiBase}/worlds/${slug}/status`, { headers: { accept: 'application/json' } })
    if (!statusRes.ok) return null
    const statusData = await statusRes.json()
    const connUrl = statusData?.connection?.url
    if (!connUrl) return null
    const runtimeBase = connUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
    const runtimeRes = await fetch(`${runtimeBase}/status`, { headers: { accept: 'application/json' } })
    if (!runtimeRes.ok) return null
    const runtimeData = await runtimeRes.json()
    return typeof runtimeData?.playerCount === 'number' ? runtimeData.playerCount : null
  } catch {
    return null
  }
}

export function ExploreMenu({ open, onClose }) {
  const [worlds, setWorlds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [playerCounts, setPlayerCounts] = useState({})
  const searchRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError('')
    setWorlds([])
    setPlayerCounts({})
    setLoading(true)
    setTimeout(() => searchRef.current?.focus(), 50)
    const apiBase = resolveWorldServiceApiBase()
    if (!apiBase) {
      setLoading(false)
      setError('World service unavailable.')
      return
    }
    fetch(`${apiBase}/worlds`, { credentials: 'include', headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data?.worlds) ? data.worlds : []
        setWorlds(list)
        setLoading(false)
        const BATCH = 8
        const run = async () => {
          for (let i = 0; i < list.length; i += BATCH) {
            await Promise.allSettled(
              list.slice(i, i + BATCH).map(async w => {
                const count = await fetchPlayerCount(apiBase, w.slug)
                if (count === null) return
                setPlayerCounts(prev => ({ ...prev, [w.slug]: count }))
              })
            )
          }
        }
        void run()
      })
      .catch(() => {
        setError('Failed to load worlds.')
        setLoading(false)
      })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = e => {
      if (e.code === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? worlds.filter(w => (w.name || '').toLowerCase().includes(q) || (w.slug || '').toLowerCase().includes(q)) : [...worlds]
    return list.sort((a, b) => (playerCounts[b.slug] ?? -1) - (playerCounts[a.slug] ?? -1))
  }, [worlds, query, playerCounts])

  if (!open) return null

  return (
    <div
      className='explore-menu'
      css={css`
        position: absolute;
        inset: 0;
        z-index: 100;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        .explore-backdrop {
          position: absolute;
          inset: 0;
          z-index: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(15px);
        }
        .explore-panel {
          position: relative;
          z-index: 1;
          width: 52rem;
          max-width: calc(100% - 2rem);
          max-height: calc(100% - 2rem);
          display: flex;
          flex-direction: column;
          background: ${theme.bgPanel};
          border: 1px solid ${theme.border};
          border-radius: ${theme.radius};
          overflow: hidden;
        }
        .explore-head {
          height: 3.5rem;
          padding: 0 0.75rem 0 1rem;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          border-bottom: 1px solid ${theme.borderLight};
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.6);
        }
        .explore-head-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
        }
        .explore-search {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          background: ${theme.bgInput};
          padding: 0 0.6rem;
          height: 2rem;
          color: rgba(255, 255, 255, 0.4);
          &:focus-within {
            border-color: ${theme.borderHover};
            color: rgba(255, 255, 255, 0.6);
          }
        }
        .explore-search-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-size: 0.82rem;
          color: rgba(255, 255, 255, 0.9);
          font-family: inherit;
          &::placeholder {
            color: rgba(255, 255, 255, 0.25);
          }
        }
        .explore-close {
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
        .explore-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 1rem;
        }
        .explore-status {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.4);
          padding: 2rem 0;
          text-align: center;
        }
        .explore-error {
          font-size: 0.85rem;
          color: #ff8e8e;
          padding: 2rem 0;
          text-align: center;
        }
        .explore-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
          @media (max-width: 480px) {
            grid-template-columns: 1fr;
          }
        }
        .explore-card {
          position: relative;
          border: 1px solid ${theme.border};
          border-radius: ${theme.radiusSmall};
          overflow: hidden;
          cursor: pointer;
          background: ${theme.bgInput};
          aspect-ratio: 16 / 9;
          display: flex;
          flex-direction: column;
          &:hover {
            border-color: ${theme.borderHover};
          }
          &:hover .explore-card-img {
            transform: scale(1.03);
          }
          &:hover .explore-card-overlay {
            background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.18) 55%, transparent 100%);
          }
        }
        .explore-card-img-wrap {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }
        .explore-card-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.25s ease;
        }
        .explore-card-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.1) 50%, transparent 100%);
          transition: background 0.2s ease;
        }
        .explore-card-info {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 0.65rem 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .explore-card-name {
          font-size: 0.9rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.95);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .explore-card-slug {
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.45);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .explore-card-footer {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .explore-card-meta {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          min-width: 0;
        }
        .explore-card-players {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.72rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .explore-card-players-dot {
          width: 0.4rem;
          height: 0.4rem;
          border-radius: 50%;
          background: #6dea8a;
          flex-shrink: 0;
        }
      `}
    >
      <div className='explore-backdrop' onClick={onClose} />
      <div className='explore-panel'>
        <div className='explore-head'>
          <GlobeIcon size='1rem' />
          <div className='explore-head-title'>Explore</div>
          <div className='explore-search'>
            <SearchIcon size='0.8rem' />
            <input
              ref={searchRef}
              className='explore-search-input'
              placeholder='Search worlds...'
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && <XIcon size='0.8rem' style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setQuery('')} />}
          </div>
          <div className='explore-close' onClick={onClose}>
            <XIcon size='1rem' />
          </div>
        </div>
        <div className='explore-body'>
          {loading && <div className='explore-status'><LoaderIcon size='1rem' style={{ verticalAlign: 'text-bottom', marginRight: '0.4rem' }} />Loading worlds...</div>}
          {!loading && error && <div className='explore-error'>{error}</div>}
          {!loading && !error && worlds.length === 0 && <div className='explore-status'>No worlds found.</div>}
          {!loading && !error && worlds.length > 0 && filtered.length === 0 && <div className='explore-status'>No results for "{query}".</div>}
          {!loading && !error && filtered.length > 0 && (
            <div className='explore-grid'>
              {filtered.map(world => (
                <div
                  key={world.id || world.slug}
                  className='explore-card'
                  onClick={() => { window.location.href = `/worlds/${world.slug}` }}
                >
                  <div className='explore-card-img-wrap'>
                    <img
                      className='explore-card-img'
                      src={world.image || '/placeholder-room.png'}
                      alt={world.name || world.slug}
                      onError={e => { e.currentTarget.src = '/placeholder-room.png' }}
                    />
                  </div>
                  <div className='explore-card-overlay' />
                  <div className='explore-card-info'>
                    <div className='explore-card-footer'>
                      <div className='explore-card-meta'>
                        <div className='explore-card-name'>{world.name || world.slug}</div>
                      </div>
                      {playerCounts[world.slug] != null && (
                        <div className='explore-card-players'>
                          <div className='explore-card-players-dot' />
                          {playerCounts[world.slug]}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
