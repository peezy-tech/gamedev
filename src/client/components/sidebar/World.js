import { css } from '@firebolt-dev/css'
import { useEffect, useState } from 'react'
import { FieldFile, FieldNumber, FieldSwitch, FieldText, FieldToggle } from '../Fields'
import { useRank } from '../useRank'
import { Ranks } from '../../../core/extras/ranks'
import { theme } from '../theme'
import { Pane } from './Pane'

const voiceChatOptions = [
  { label: 'Disabled', value: 'disabled' },
  { label: 'Spatial', value: 'spatial' },
  { label: 'Global', value: 'global' },
]

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function getWorldPlayerLimitCap() {
  const fromProcess = parsePositiveInt(globalThis?.process?.env?.PUBLIC_WORLD_MAX_PLAYERS)
  if (fromProcess > 0) return fromProcess
  return parsePositiveInt(globalThis?.env?.PUBLIC_WORLD_MAX_PLAYERS)
}

function formatCredentialError(code) {
  if (code === 'admin_required') return 'Deploy access is required to view runtime credentials.'
  if (code === 'admin_url_missing') return 'Admin endpoint is unavailable for this world.'
  if (code === 'admin_code_missing') return 'Enter an admin code before requesting runtime credentials.'
  if (code === 'timeout') return 'Timed out requesting runtime credentials.'
  return 'Failed to load runtime credentials.'
}

async function copyToClipboard(value) {
  if (!value || !navigator?.clipboard?.writeText) return false
  await navigator.clipboard.writeText(value)
  return true
}

export function World({ world, hidden }) {
  const player = world.entities.player
  const { isAdmin } = useRank(world, player)
  const worldPlayerLimitCap = getWorldPlayerLimitCap()
  const hasPlayerLimitCap = worldPlayerLimitCap > 0
  const [title, setTitle] = useState(world.settings.title)
  const [desc, setDesc] = useState(world.settings.desc)
  const [image, setImage] = useState(world.settings.image)
  const [avatar, setAvatar] = useState(world.settings.avatar)
  const [customAvatars, setCustomAvatars] = useState(world.settings.customAvatars)
  const [voice, setVoice] = useState(world.settings.voice)
  const [playerLimit, setPlayerLimit] = useState(world.settings.playerLimit)
  const [ao, setAO] = useState(world.settings.ao)
  const [rank, setRank] = useState(world.settings.rank)
  const [runtimeCredentials, setRuntimeCredentials] = useState(null)
  const [credentialsLoading, setCredentialsLoading] = useState(false)
  const [credentialsError, setCredentialsError] = useState(null)
  const [adminCodeVisible, setAdminCodeVisible] = useState(false)
  const [copiedField, setCopiedField] = useState(null)

  useEffect(() => {
    const onChange = changes => {
      if (changes.title) setTitle(changes.title.value)
      if (changes.desc) setDesc(changes.desc.value)
      if (changes.image) setImage(changes.image.value)
      if (changes.avatar) setAvatar(changes.avatar.value)
      if (changes.customAvatars) setCustomAvatars(changes.customAvatars.value)
      if (changes.voice) setVoice(changes.voice.value)
      if (changes.playerLimit) setPlayerLimit(changes.playerLimit.value)
      if (changes.ao) setAO(changes.ao.value)
      if (changes.rank) setRank(changes.rank.value)
    }
    world.settings.on('change', onChange)
    return () => {
      world.settings.off('change', onChange)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin || !world.admin?.getRuntimeCredentials) {
      setRuntimeCredentials(null)
      setCredentialsLoading(false)
      setCredentialsError(null)
      setAdminCodeVisible(false)
      return
    }
    let active = true
    setCredentialsLoading(true)
    setCredentialsError(null)
    world.admin
      .getRuntimeCredentials()
      .then(credentials => {
        if (!active) return
        setRuntimeCredentials(credentials)
      })
      .catch(err => {
        if (!active) return
        setRuntimeCredentials(null)
        setCredentialsError(err?.code || 'request_failed')
      })
      .finally(() => {
        if (!active) return
        setCredentialsLoading(false)
      })
    return () => {
      active = false
    }
  }, [isAdmin, world])

  useEffect(() => {
    if (!adminCodeVisible) return
    if (!runtimeCredentials?.adminCode) {
      setAdminCodeVisible(false)
    }
  }, [adminCodeVisible, runtimeCredentials?.adminCode])

  useEffect(() => {
    if (!copiedField) return
    const timer = setTimeout(() => setCopiedField(null), 1250)
    return () => clearTimeout(timer)
  }, [copiedField])

  const loadRuntimeCredentials = async ({ forceRefresh = false, reveal = false } = {}) => {
    if (!world.admin?.getRuntimeCredentials) return
    setCredentialsLoading(true)
    setCredentialsError(null)
    try {
      const credentials = await world.admin.getRuntimeCredentials({ forceRefresh })
      setRuntimeCredentials(credentials)
      if (reveal && credentials?.adminCode) {
        setAdminCodeVisible(true)
      }
      return credentials
    } catch (err) {
      setRuntimeCredentials(null)
      setAdminCodeVisible(false)
      setCredentialsError(err?.code || 'request_failed')
      return null
    } finally {
      setCredentialsLoading(false)
    }
  }

  const copyCredential = async (value, field) => {
    try {
      const copied = await copyToClipboard(value)
      if (!copied) {
        setCredentialsError('clipboard_unavailable')
        return
      }
      setCopiedField(field)
    } catch {
      setCredentialsError('clipboard_unavailable')
    }
  }

  const revealAdminCode = async () => {
    if (runtimeCredentials?.adminCode) {
      setAdminCodeVisible(true)
      return
    }
    const credentials = await loadRuntimeCredentials({ forceRefresh: true, reveal: true })
    if (!credentials?.adminCode) {
      setAdminCodeVisible(false)
    }
  }

  const hasAdminCode = !!runtimeCredentials?.hasAdminCode
  const canRevealAdminCode = !!runtimeCredentials?.canRevealAdminCode
  const adminCodeValue = runtimeCredentials?.adminCode || null
  const adminCodeDisplay = adminCodeVisible && adminCodeValue ? adminCodeValue : hasAdminCode ? '••••••••' : 'Not set'
  const worldIdValue = runtimeCredentials?.worldId || 'Unavailable'

  return (
    <Pane hidden={hidden}>
      <div
        className='world'
        css={css`
          background: ${theme.bgSection};
          border: 1px solid ${theme.borderLight};
          border-radius: ${theme.radius};
          display: flex;
          flex-direction: column;
          min-height: 12rem;
          .world-head {
            height: 3.125rem;
            padding: 0 1rem;
            border-bottom: 1px solid ${theme.borderLight};
            display: flex;
            align-items: center;
          }
          .world-title {
            font-weight: 500;
            font-size: 1rem;
            line-height: 1;
          }
          .world-content {
            flex: 1;
            padding: 0.5rem 0;
            overflow-y: auto;
          }
          .world-credentials {
            margin: 0.75rem 1rem 0.5rem;
            padding: 0.625rem 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid ${theme.borderLight};
            background: rgba(255, 255, 255, 0.02);
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
          }
          .world-credentials-title {
            font-size: 0.8125rem;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.72);
          }
          .world-credentials-note {
            font-size: 0.78125rem;
            color: rgba(255, 255, 255, 0.5);
          }
          .world-credentials-note.error {
            color: rgba(255, 122, 122, 0.95);
          }
          .world-credentials-row {
            min-height: 2rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .world-credentials-label {
            width: 4.75rem;
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.46);
          }
          .world-credentials-value {
            flex: 1;
            min-width: 0;
            font-size: 0.8125rem;
            text-align: right;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: rgba(255, 255, 255, 0.9);
          }
          .world-credentials-actions {
            display: flex;
            gap: 0.3125rem;
          }
          .world-credentials-btn {
            border: 1px solid ${theme.borderLight};
            border-radius: 0.375rem;
            background: rgba(255, 255, 255, 0.03);
            color: rgba(255, 255, 255, 0.9);
            height: 1.625rem;
            padding: 0 0.55rem;
            font-size: 0.75rem;
            line-height: 1;
            &:hover {
              background: rgba(255, 255, 255, 0.075);
            }
            &.disabled {
              opacity: 0.4;
              pointer-events: none;
            }
          }
        `}
      >
        <div className='world-head'>
          <div className='world-title'>World</div>
        </div>
        <div className='world-content noscrollbar'>
          <FieldText
            label='Title'
            hint='Change the title of this world. Shown in the browser tab and when sharing links'
            placeholder='World'
            value={title}
            onChange={value => world.settings.set('title', value, true)}
          />
          <FieldText
            label='Description'
            hint='Change the description of this world. Shown in previews when sharing links to this world'
            value={desc}
            onChange={value => world.settings.set('desc', value, true)}
          />
          <FieldFile
            label='Image'
            hint='Change the image of the world. This is shown when loading into or sharing links to this world.'
            kind='image'
            value={image}
            onChange={value => world.settings.set('image', value, true)}
            world={world}
          />
          <FieldFile
            label='Default Avatar'
            hint='Change the default avatar everyone spawns into the world with'
            kind='avatar'
            value={avatar}
            onChange={value => world.settings.set('avatar', value, true)}
            world={world}
          />
          {isAdmin && world.settings.hasAdminCode && (
            <FieldToggle
              label='Custom Avatars'
              hint='Allow visitors to drag and drop custom VRM avatars.'
              trueLabel='On'
              falseLabel='Off'
              value={customAvatars}
              onChange={value => world.settings.set('customAvatars', value, true)}
            />
          )}
          <FieldSwitch
            label='Voice Chat'
            hint='Set the base voice chat mode. Apps are able to modify this using custom rules.'
            options={voiceChatOptions}
            value={voice}
            onChange={voice => world.settings.set('voice', voice, true)}
          />
          <FieldNumber
            label='Player Limit'
            hint={
              hasPlayerLimitCap
                ? `Set a maximum number of players that can be in the world at one time (1 to ${worldPlayerLimitCap} for this world).`
                : 'Set a maximum number of players that can be in the world at one time. Zero means unlimited.'
            }
            min={hasPlayerLimitCap ? 1 : 0}
            max={hasPlayerLimitCap ? worldPlayerLimitCap : Infinity}
            value={playerLimit}
            onChange={value => world.settings.set('playerLimit', value, true)}
          />
          <FieldToggle
            label='Ambient Occlusion'
            hint={`Improves visuals by approximating darkened corners etc. When enabled, users also have an option to disable this on their device for performance.`}
            trueLabel='On'
            falseLabel='Off'
            value={ao}
            onChange={value => world.settings.set('ao', value, true)}
          />
          {isAdmin && world.settings.hasAdminCode && (
            <FieldToggle
              label='Free Build'
              hint='Allow everyone to build (and destroy) things in the world.'
              trueLabel='On'
              falseLabel='Off'
              value={rank >= Ranks.BUILDER}
              onChange={value => world.settings.set('rank', value ? Ranks.BUILDER : Ranks.VISITOR, true)}
            />
          )}
          {isAdmin && (
            <div className='world-credentials'>
              <div className='world-credentials-title'>Runtime Credentials</div>
              <div className='world-credentials-note'>
                `WORLD_ID` and `ADMIN_CODE` for app-server and CLI remote sync.
              </div>
              {credentialsError && <div className='world-credentials-note error'>{formatCredentialError(credentialsError)}</div>}
              {!runtimeCredentials && credentialsLoading && (
                <div className='world-credentials-note'>Loading runtime credentials...</div>
              )}
              {runtimeCredentials && (
                <>
                  <div className='world-credentials-row'>
                    <div className='world-credentials-label'>WORLD_ID</div>
                    <div className='world-credentials-value'>{worldIdValue}</div>
                    <div className='world-credentials-actions'>
                      <button
                        className='world-credentials-btn'
                        type='button'
                        onClick={() => copyCredential(runtimeCredentials?.worldId, 'worldId')}
                      >
                        {copiedField === 'worldId' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className='world-credentials-row'>
                    <div className='world-credentials-label'>ADMIN_CODE</div>
                    <div className='world-credentials-value'>{adminCodeDisplay}</div>
                    <div className='world-credentials-actions'>
                      {hasAdminCode && (
                        <button className='world-credentials-btn' type='button' onClick={revealAdminCode}>
                          {adminCodeVisible ? 'Shown' : 'Reveal'}
                        </button>
                      )}
                      <button
                        className={`world-credentials-btn ${adminCodeValue ? '' : 'disabled'}`}
                        type='button'
                        onClick={() => copyCredential(adminCodeValue, 'adminCode')}
                      >
                        {copiedField === 'adminCode' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  {hasAdminCode && !canRevealAdminCode && !adminCodeValue && (
                    <div className='world-credentials-note'>
                      Admin code reveal is disabled by operator (`ADMIN_CREDENTIAL_REVEAL_ENABLED=false`).
                    </div>
                  )}
                </>
              )}
              <div className='world-credentials-actions'>
                <button
                  className={`world-credentials-btn ${credentialsLoading ? 'disabled' : ''}`}
                  type='button'
                  onClick={() => loadRuntimeCredentials({ forceRefresh: true })}
                >
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Pane>
  )
}
