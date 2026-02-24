import { css } from '@firebolt-dev/css'
import { GlobeIcon, HammerIcon, LoaderIcon, UserIcon } from 'lucide-react'
import { editorTheme as theme } from './editorTheme'

export function EditorToolbar({ world, open, onToggle, buildMode, auth, onUserClick, onExploreClick }) {
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
      <ExploreBtn onClick={onExploreClick} />
      <UserBtn auth={auth} onClick={onUserClick} />
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

function ExploreBtn({ onClick }) {
  return (
    <div
      className='editor-explore'
      css={css`
        width: 2.75rem;
        height: 2.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid ${theme.border};
        border-radius: ${theme.radius};
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        user-select: none;
        &:hover {
          background: ${theme.bgHover};
        }
      `}
      onClick={() => onClick?.()}
    >
      <GlobeIcon size='1.1rem' />
    </div>
  )
}

function UserBtn({ auth, onClick }) {
  const pending = !!auth?.pending
  return (
    <div
      className='editor-user'
      css={css`
        width: 2.75rem;
        height: 2.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid ${theme.border};
        border-radius: ${theme.radius};
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        user-select: none;
        position: relative;
        &:hover {
          background: ${theme.bgHover};
        }
      `}
      onClick={() => onClick?.()}
    >
      {pending ? <LoaderIcon size='1.1rem' /> : <UserIcon size='1.1rem' />}
    </div>
  )
}
