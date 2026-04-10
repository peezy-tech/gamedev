import { uuid } from '../../../../core/utils'
import { storage } from '../../../../core/storage'
import { isValidScriptPath } from '../../../../core/blueprintValidation'
import { buildScriptGroups, getScriptGroupMain } from '../../../../core/extras/blueprintGroups'
import { getBlueprintAppName } from '../../../../core/blueprintUtils'

const DEFAULT_CODEX_API_URL = 'http://127.0.0.1:4625/api/script-ai'
const LOCAL_CODEX_STATUS_TTL_MS = 5000

export function hasScriptFiles(blueprint) {
  return blueprint?.scriptFiles && typeof blueprint.scriptFiles === 'object' && !Array.isArray(blueprint.scriptFiles)
}

export function resolveScriptRootBlueprint(blueprint, world) {
  if (!blueprint) return null
  const scriptRef = typeof blueprint.scriptRef === 'string' ? blueprint.scriptRef.trim() : ''
  if (scriptRef) {
    const scriptRoot = world.blueprints.get(scriptRef)
    if (!scriptRoot) return null
    return scriptRoot
  }
  if (hasScriptFiles(blueprint)) return blueprint
  const appName = getBlueprintAppName(blueprint.id)
  if (appName && appName !== blueprint.id) {
    const baseBlueprint = world.blueprints.get(appName)
    if (hasScriptFiles(baseBlueprint)) return baseBlueprint
  }
  const groupMain = getScriptGroupMain(buildScriptGroups(world.blueprints.items), blueprint)
  if (groupMain && hasScriptFiles(groupMain)) return groupMain
  return null
}

function resolveScriptRootForApp(app, world) {
  if (!app) return null
  const blueprint = app.blueprint || world.blueprints.get(app.data?.blueprint)
  return resolveScriptRootBlueprint(blueprint, world)
}

function normalizeAttachments(input) {
  if (!Array.isArray(input)) return null
  const output = []
  const seen = new Set()
  for (const item of input) {
    if (!item) continue
    const type = item.type === 'doc' || item.type === 'script' ? item.type : null
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    if (!type || !path) continue
    const key = `${type}:${path}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({ type, path })
    if (output.length >= 12) break
  }
  return output.length ? output : null
}

function normalizeBaseUrl(url) {
  if (typeof url !== 'string') return ''
  return url.trim().replace(/\/+$/, '')
}

function resolveCurrentWorldUrl() {
  const href = typeof globalThis?.location?.href === 'string' ? globalThis.location.href : ''
  if (!href) return ''
  try {
    const url = new URL(href)
    let pathname = url.pathname.replace(/\/admin\/?$/, '') || '/'
    if (pathname !== '/') pathname = pathname.replace(/\/$/, '')
    return normalizeBaseUrl(pathname === '/' ? url.origin : `${url.origin}${pathname}`)
  } catch {
    return ''
  }
}

function resolveLocalCodexApiUrl() {
  const configured =
    globalThis?.env?.PUBLIC_CODEX_API_URL ||
    globalThis?.process?.env?.PUBLIC_CODEX_API_URL ||
    DEFAULT_CODEX_API_URL
  return normalizeBaseUrl(configured) || DEFAULT_CODEX_API_URL
}

function createLocalCodexUnavailableStatus(apiUrl, message) {
  return {
    ready: false,
    apiUrl,
    projectDir: null,
    worldUrl: null,
    worldId: null,
    model: null,
    message: message || 'Run "gamedev codex" in your world project to enable local Codex.',
    checkedAt: Date.now(),
  }
}

async function parseNdjsonStream(response, onMessage) {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let payload
      try {
        payload = JSON.parse(trimmed)
      } catch {
        continue
      }
      await onMessage(payload)
    }
  }
  const final = buffer.trim()
  if (final) {
    try {
      await onMessage(JSON.parse(final))
    } catch {}
  }
}

export class ScriptAIController {
  constructor(world) {
    this.world = world
    this.inFlightByBlueprint = new Map()
    this.threadsByTarget = new Map()
    this.threadSubscribersByTarget = new Map()
    this.docsIndex = []
    this.docsApiUrl = null
    this.docsLoaded = false
    this.docsLoadingPromise = null
    this.docsSubscribers = new Set()
    this.localCodexStatus = createLocalCodexUnavailableStatus(resolveLocalCodexApiUrl(), 'Checking local Codex...')
    this.localCodexStatusPromise = null
    this.localCodexStatusSubscribers = new Set()
  }

  destroy() {
    this.inFlightByBlueprint.clear()
    this.threadsByTarget.clear()
    this.threadSubscribersByTarget.clear()
    this.docsSubscribers.clear()
    this.docsLoadingPromise = null
    this.localCodexStatusSubscribers.clear()
    this.localCodexStatusPromise = null
  }

  requestEdit = ({ prompt, app, attachments, editorHandle } = {}) => {
    return this.request({ mode: 'edit', prompt, app, attachments, editorHandle })
  }

  requestFix = ({ error, app, attachments, editorHandle } = {}) => {
    return this.request({ mode: 'fix', error, app, attachments, editorHandle })
  }

  request = ({ mode = 'edit', prompt, error, app, scriptRootId, attachments, editorHandle } = {}) => {
    if (this.world.isAdminClient) {
      this.world.emit('toast', 'AI script requests are not available on admin connections.')
      return null
    }
    if (!this.world.builder?.canBuild?.()) {
      this.world.emit('toast', 'Builder access required.')
      return null
    }
    if (editorHandle?.dirtyCount > 0) {
      this.world.emit('toast', 'Save or discard editor changes before using local Codex.')
      return null
    }

    let targetApp = app || this.world.ui?.state?.app
    if (!targetApp) {
      targetApp = this.world.builder?.getEntityAtReticle?.() || null
    }
    const targetBlueprint =
      targetApp?.blueprint ||
      this.world.blueprints.get(targetApp?.data?.blueprint) ||
      (scriptRootId ? this.world.blueprints.get(scriptRootId) : null)
    let scriptRoot = null
    if (scriptRootId) {
      const blueprint = this.world.blueprints.get(scriptRootId)
      scriptRoot = resolveScriptRootBlueprint(blueprint, this.world)
    } else if (targetApp) {
      scriptRoot = resolveScriptRootForApp(targetApp, this.world)
    }
    if (!scriptRoot || !hasScriptFiles(scriptRoot)) {
      this.world.emit('toast', 'No module script root found for this app.')
      return null
    }

    const targetBlueprintId = targetBlueprint?.id || scriptRoot.id
    if (!targetBlueprintId) {
      this.world.emit('toast', 'No script target found for this app.')
      return null
    }
    if (this.inFlightByBlueprint.has(targetBlueprintId)) {
      this.world.emit('toast', 'AI request already in progress for this app.')
      return null
    }

    const entryPath = scriptRoot.scriptEntry
    if (!entryPath || !isValidScriptPath(entryPath)) {
      this.world.emit('toast', 'Invalid script entry for AI request.')
      return null
    }
    if (!Object.prototype.hasOwnProperty.call(scriptRoot.scriptFiles, entryPath)) {
      this.world.emit('toast', 'Script entry missing from module files.')
      return null
    }

    let requestError = error
    if (mode === 'fix') {
      if (!requestError && targetApp?.scriptError) {
        requestError = targetApp.scriptError
      }
      if (!requestError) {
        this.world.emit('toast', 'No script error available to fix.')
        return null
      }
    } else {
      requestError = null
      if (!prompt || !prompt.trim()) {
        this.world.emit('toast', 'AI edit prompt required.')
        return null
      }
    }

    const requestId = uuid()
    const normalizedAttachments = normalizeAttachments(attachments)
    const appName = getBlueprintAppName(scriptRoot.id) || scriptRoot.id
    const history = this.buildConversationHistory({
      targetBlueprintId,
      scriptRootId: scriptRoot.id,
    })
    const payload = {
      requestId,
      appName,
      scriptRootId: scriptRoot.id,
      targetBlueprintId,
      mode,
      prompt: prompt || null,
      error: requestError || null,
      entryPath,
      scriptFormat: scriptRoot.scriptFormat === 'legacy-body' ? 'legacy-body' : 'module',
      history,
      currentWorldUrl: resolveCurrentWorldUrl(),
      authToken: storage?.get?.('authToken') || null,
    }
    if (normalizedAttachments) {
      payload.attachments = normalizedAttachments
    }

    this.inFlightByBlueprint.set(targetBlueprintId, {
      requestId,
      scriptRootId: scriptRoot.id,
      startedAt: Date.now(),
    })

    if (mode === 'edit' && prompt) {
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId: scriptRoot.id,
        requestId,
        type: 'user',
        text: prompt.trim(),
      })
    } else if (mode === 'fix') {
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId: scriptRoot.id,
        requestId,
        type: 'user',
        text: 'Fix the current script error.',
      })
    }

    this.world.emit?.('script-ai-pending', {
      scriptRootId: scriptRoot.id,
      targetBlueprintId,
      requestId,
      pending: true,
    })
    this.world.emit?.('script-ai-request', payload)

    void this.requestLocalPreview(payload)
    return requestId
  }

  async applyLocalProposal({
    requestId,
    appName,
    scriptRootId,
    targetBlueprintId,
    summary,
    files,
  } = {}) {
    const status = await this.ensureLocalCodexStatus({ force: true })
    if (!status?.ready) {
      const message = status?.message || 'Local Codex is unavailable.'
      this.world.emit('toast', message)
      this.world.emit?.('script-ai-event', {
        requestId,
        scriptRootId,
        targetBlueprintId,
        type: 'error',
        message,
      })
      return { ok: false, error: 'local_codex_unavailable', message }
    }

    this.world.emit?.('script-ai-event', {
      requestId,
      scriptRootId,
      targetBlueprintId,
      type: 'phase',
      phase: 'applying',
    })

    try {
      const response = await fetch(`${status.apiUrl}/apply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          appName,
          scriptRootId,
          targetBlueprintId,
          summary,
          files,
          currentWorldUrl: resolveCurrentWorldUrl(),
          authToken: storage?.get?.('authToken') || null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Failed to deploy local Codex changes.')
      }

      const message = data.message || 'AI changes applied.'
      this.world.emit?.('script-ai-event', {
        requestId,
        scriptRootId,
        targetBlueprintId,
        type: 'apply_result',
        ok: true,
        fileCount: Array.isArray(files) ? files.length : 0,
        message,
      })
      this.world.emit?.('script-ai-response', {
        requestId,
        scriptRootId,
        targetBlueprintId,
        error: null,
        message,
        summary: summary || '',
        source: typeof data.source === 'string' ? data.source : '',
        fileCount: Number.isFinite(data.fileCount) ? data.fileCount : Array.isArray(files) ? files.length : 0,
        applied: true,
        forked: false,
      })
      this.world.emit('toast', message)
      return { ok: true, message }
    } catch (err) {
      const message = err?.message || 'Failed to apply local Codex changes.'
      this.world.emit?.('script-ai-event', {
        requestId,
        scriptRootId,
        targetBlueprintId,
        type: 'apply_result',
        ok: false,
        fileCount: 0,
        message,
      })
      this.world.emit?.('script-ai-response', {
        requestId,
        scriptRootId,
        targetBlueprintId,
        error: 'local_codex_apply_failed',
        message,
        summary: summary || '',
        source: '',
        fileCount: 0,
        applied: false,
        forked: false,
      })
      this.world.emit('toast', message)
      return { ok: false, error: 'local_codex_apply_failed', message }
    }
  }

  isBlueprintPending = blueprintId => {
    if (typeof blueprintId !== 'string' || !blueprintId) return false
    return this.inFlightByBlueprint.has(blueprintId)
  }

  isRootPending = scriptRootId => {
    if (typeof scriptRootId !== 'string' || !scriptRootId) return false
    for (const pending of this.inFlightByBlueprint.values()) {
      if (pending?.scriptRootId === scriptRootId) return true
    }
    return false
  }

  getTargetKey = ({ targetBlueprintId, scriptRootId } = {}) => {
    const bp = typeof targetBlueprintId === 'string' && targetBlueprintId ? targetBlueprintId : ''
    const root = typeof scriptRootId === 'string' && scriptRootId ? scriptRootId : ''
    return `${bp}::${root}`
  }

  buildConversationHistory = ({ targetBlueprintId, scriptRootId } = {}) => {
    const thread = this.getThreadForTarget({ targetBlueprintId, scriptRootId })
    const history = []
    for (const item of thread) {
      if (item?.type !== 'user' && item?.type !== 'assistant') continue
      const text = typeof item.text === 'string' ? item.text.trim() : ''
      if (!text) continue
      history.push({
        role: item.type === 'user' ? 'user' : 'assistant',
        content: text,
      })
    }
    return history.slice(-12)
  }

  getThreadForTarget = ({ targetBlueprintId, scriptRootId } = {}) => {
    const key = this.getTargetKey({ targetBlueprintId, scriptRootId })
    return this.threadsByTarget.get(key) || []
  }

  subscribeThread = ({ targetBlueprintId, scriptRootId, onChange } = {}) => {
    if (typeof onChange !== 'function') return () => {}
    const key = this.getTargetKey({ targetBlueprintId, scriptRootId })
    if (!this.threadSubscribersByTarget.has(key)) {
      this.threadSubscribersByTarget.set(key, new Set())
    }
    const subs = this.threadSubscribersByTarget.get(key)
    subs.add(onChange)
    onChange(this.threadsByTarget.get(key) || [])
    return () => {
      subs.delete(onChange)
      if (!subs.size) this.threadSubscribersByTarget.delete(key)
    }
  }

  appendThreadEntry = ({ targetBlueprintId, scriptRootId, requestId, type, text, meta, coalesce } = {}) => {
    if (!type) return
    const key = this.getTargetKey({ targetBlueprintId, scriptRootId })
    const current = this.threadsByTarget.get(key) || []
    const nextText = typeof text === 'string' ? text : ''

    if (coalesce && current.length) {
      const last = current[current.length - 1]
      if (last?.type === type && last?.requestId === (requestId || null)) {
        const merged = {
          ...last,
          text: `${last.text || ''}${nextText}`,
          meta: meta && typeof meta === 'object' ? meta : last.meta || null,
        }
        const next = current.slice(0, -1).concat(merged)
        this.threadsByTarget.set(key, next)
        this.emitThread(key)
        return
      }
    }

    const next = current.concat({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      requestId: requestId || null,
      type,
      text: nextText,
      meta: meta && typeof meta === 'object' ? meta : null,
      createdAt: Date.now(),
    })
    const bounded = next.length > 160 ? next.slice(next.length - 160) : next
    this.threadsByTarget.set(key, bounded)
    this.emitThread(key)
  }

  emitThread = key => {
    const subs = this.threadSubscribersByTarget.get(key)
    if (!subs || !subs.size) return
    const items = this.threadsByTarget.get(key) || []
    for (const callback of subs) {
      callback(items)
    }
  }

  getPendingForTarget = ({ targetBlueprintId, scriptRootId } = {}) => {
    if (targetBlueprintId) return this.isBlueprintPending(targetBlueprintId)
    if (scriptRootId) return this.isRootPending(scriptRootId)
    return false
  }

  subscribeTarget = ({ targetBlueprintId, scriptRootId, onRequest, onPending, onResponse } = {}) => {
    const matchesTarget = payload => {
      if (!payload) return false
      const payloadBlueprintId = typeof payload.targetBlueprintId === 'string' ? payload.targetBlueprintId : null
      if (targetBlueprintId && payloadBlueprintId) {
        return payloadBlueprintId === targetBlueprintId
      }
      const payloadRootId = typeof payload.scriptRootId === 'string' ? payload.scriptRootId : null
      if (scriptRootId && payloadRootId) {
        return payloadRootId === scriptRootId
      }
      return true
    }
    const handleRequest = payload => {
      if (!matchesTarget(payload)) return
      onRequest?.(payload)
    }
    const handlePending = payload => {
      if (!matchesTarget(payload)) return
      onPending?.(payload)
    }
    const handleResponse = payload => {
      if (!matchesTarget(payload)) return
      onResponse?.(payload)
    }
    this.world.on?.('script-ai-request', handleRequest)
    this.world.on?.('script-ai-pending', handlePending)
    this.world.on?.('script-ai-response', handleResponse)
    return () => {
      this.world.off?.('script-ai-request', handleRequest)
      this.world.off?.('script-ai-pending', handlePending)
      this.world.off?.('script-ai-response', handleResponse)
    }
  }

  getDocsIndex = () => this.docsIndex

  subscribeDocsIndex = callback => {
    if (typeof callback !== 'function') return () => {}
    this.docsSubscribers.add(callback)
    callback(this.docsIndex)
    this.ensureDocsIndex()
    return () => {
      this.docsSubscribers.delete(callback)
    }
  }

  getLocalCodexStatus = () => this.localCodexStatus

  subscribeLocalCodexStatus = callback => {
    if (typeof callback !== 'function') return () => {}
    this.localCodexStatusSubscribers.add(callback)
    callback(this.localCodexStatus)
    void this.ensureLocalCodexStatus()
    return () => {
      this.localCodexStatusSubscribers.delete(callback)
    }
  }

  ensureLocalCodexStatus = async ({ force = false } = {}) => {
    const apiUrl = resolveLocalCodexApiUrl()
    const now = Date.now()
    if (!force && this.localCodexStatusPromise) {
      return this.localCodexStatusPromise
    }
    if (
      !force &&
      this.localCodexStatus?.checkedAt &&
      now - this.localCodexStatus.checkedAt < LOCAL_CODEX_STATUS_TTL_MS &&
      this.localCodexStatus.apiUrl === apiUrl
    ) {
      return this.localCodexStatus
    }

    const load = async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1500)
      try {
        const response = await fetch(`${apiUrl}/status`, { signal: controller.signal })
        if (!response.ok) {
          throw new Error('local_codex_status_failed')
        }
        const data = await response.json()
        const currentWorldUrl = resolveCurrentWorldUrl()
        const projectWorldUrl = normalizeBaseUrl(data?.worldUrl || '')
        let ready = data?.ready === true
        let message =
          typeof data?.message === 'string' && data.message
            ? data.message
            : ready
              ? 'Local Codex is ready.'
              : 'Run "gamedev codex" in your world project to enable local Codex.'
        if (ready && currentWorldUrl && projectWorldUrl && normalizeBaseUrl(currentWorldUrl) !== projectWorldUrl) {
          ready = false
          message = `Local Codex targets ${projectWorldUrl}, but this world is ${currentWorldUrl}.`
        }
        this.localCodexStatus = {
          ready,
          apiUrl,
          projectDir: typeof data?.projectDir === 'string' ? data.projectDir : null,
          worldUrl: projectWorldUrl || null,
          worldId: typeof data?.worldId === 'string' ? data.worldId : null,
          model: typeof data?.model === 'string' ? data.model : null,
          message,
          checkedAt: Date.now(),
        }
      } catch (err) {
        this.localCodexStatus = createLocalCodexUnavailableStatus(
          apiUrl,
          'Run "gamedev codex" in your world project to enable local Codex.'
        )
      } finally {
        clearTimeout(timeout)
        this.localCodexStatusPromise = null
        this.emitLocalCodexStatus()
      }
      return this.localCodexStatus
    }

    this.localCodexStatusPromise = load()
    return this.localCodexStatusPromise
  }

  emitLocalCodexStatus = () => {
    for (const callback of this.localCodexStatusSubscribers) {
      callback(this.localCodexStatus)
    }
  }

  ensureDocsIndex = async () => {
    const apiUrl = this.world.network?.apiUrl || null
    if (!apiUrl) {
      this.docsApiUrl = null
      this.docsLoaded = true
      if (this.docsIndex.length) {
        this.docsIndex = []
        this.emitDocsIndex()
      }
      return this.docsIndex
    }
    if (this.docsLoadingPromise && this.docsApiUrl === apiUrl) {
      return this.docsLoadingPromise
    }
    if (this.docsLoaded && this.docsApiUrl === apiUrl) {
      return this.docsIndex
    }
    this.docsApiUrl = apiUrl
    this.docsLoaded = false
    const load = async () => {
      try {
        const response = await fetch(`${apiUrl}/ai-docs-index`)
        if (!response.ok) throw new Error('docs_index_failed')
        const data = await response.json()
        const files = Array.isArray(data?.files) ? data.files.filter(Boolean) : []
        this.docsIndex = files
      } catch {
        this.docsIndex = []
      } finally {
        this.docsLoaded = true
        this.docsLoadingPromise = null
        this.emitDocsIndex()
      }
      return this.docsIndex
    }
    this.docsLoadingPromise = load()
    return this.docsLoadingPromise
  }

  emitDocsIndex = () => {
    for (const callback of this.docsSubscribers) {
      callback(this.docsIndex)
    }
  }

  requestLocalPreview = async payload => {
    const status = await this.ensureLocalCodexStatus({ force: true })
    if (!status?.ready) {
      this.onEvent({
        requestId: payload.requestId,
        scriptRootId: payload.scriptRootId,
        targetBlueprintId: payload.targetBlueprintId,
        type: 'error',
        message: status?.message || 'Local Codex is unavailable.',
      })
      this.onProposal({
        requestId: payload.requestId,
        scriptRootId: payload.scriptRootId,
        targetBlueprintId: payload.targetBlueprintId,
        error: 'local_codex_unavailable',
        message: status?.message || 'Local Codex is unavailable.',
        applied: false,
      })
      return
    }

    try {
      const response = await fetch(`${status.apiUrl}/preview`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.message || 'Local Codex request failed.')
      }

      await parseNdjsonStream(response, item => {
        if (!item || typeof item !== 'object') return
        if (item.kind === 'event' && item.payload) {
          this.world.emit?.('script-ai-event', item.payload)
          return
        }
        if (item.kind === 'proposal' && item.payload) {
          this.world.emit?.('script-ai-proposal', item.payload)
          return
        }
        if (item.kind === 'response' && item.payload) {
          this.onProposal(item.payload)
        }
      })
    } catch (err) {
      this.onEvent({
        requestId: payload.requestId,
        scriptRootId: payload.scriptRootId,
        targetBlueprintId: payload.targetBlueprintId,
        type: 'error',
        message: err?.message || 'Local Codex request failed.',
      })
      this.onProposal({
        requestId: payload.requestId,
        scriptRootId: payload.scriptRootId,
        targetBlueprintId: payload.targetBlueprintId,
        error: 'local_codex_failed',
        message: err?.message || 'Local Codex request failed.',
        applied: false,
      })
    }
  }

  onEvent = payload => {
    if (!payload) return
    const targetBlueprintId = typeof payload.targetBlueprintId === 'string' ? payload.targetBlueprintId : null
    const scriptRootId = typeof payload.scriptRootId === 'string' ? payload.scriptRootId : null
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : null
    const type = typeof payload.type === 'string' ? payload.type : ''
    if (!type) return

    if (type === 'session_start') {
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: 'system',
        text: payload.mode === 'fix' ? 'Started local Codex fix request.' : 'Started local Codex edit request.',
      })
      return
    }

    if (type === 'phase') {
      const phase = typeof payload.phase === 'string' ? payload.phase : ''
      const labels = {
        collecting_context: 'Collecting local project context...',
        thinking: 'Thinking...',
        generating_patch: 'Preparing changes...',
        applying: 'Deploying accepted changes...',
      }
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: 'phase',
        text: labels[phase] || phase || 'Working...',
        meta: { phase },
      })
      return
    }

    if (type === 'patch_preview') {
      const files = Array.isArray(payload.files) ? payload.files.filter(Boolean) : []
      const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
      const text = summary || `Prepared changes for ${files.length} file${files.length === 1 ? '' : 's'}.`
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: 'assistant',
        text,
        meta: files.length ? { files } : null,
      })
      return
    }

    if (type === 'apply_result') {
      const message = typeof payload.message === 'string' ? payload.message : ''
      const count = Number.isFinite(payload.fileCount) ? payload.fileCount : 0
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: payload.ok ? 'success' : 'error',
        text: message || (payload.ok ? `Applied ${count} file change(s).` : 'Apply failed.'),
      })
      return
    }

    if (type === 'tool-call') {
      const toolName = typeof payload.toolName === 'string' ? payload.toolName.trim() : ''
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: 'system',
        text: toolName ? `Running ${toolName}...` : 'Running local tool...',
      })
      return
    }

    if (type === 'tool-result') {
      const detail = typeof payload.detail === 'string' ? payload.detail.trim() : ''
      if (!detail) return
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: 'system',
        text: detail,
      })
      return
    }

    if (type === 'assistant_message' || type === 'assistant_delta') {
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (!text) return
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: 'assistant',
        text,
        coalesce: type === 'assistant_delta',
      })
      return
    }

    if (type === 'error') {
      const message = typeof payload.message === 'string' ? payload.message : 'AI request failed.'
      this.appendThreadEntry({
        targetBlueprintId,
        scriptRootId,
        requestId,
        type: 'error',
        text: message,
      })
    }
  }

  onProposal = payload => {
    if (!payload) return
    const scriptRootId = typeof payload.scriptRootId === 'string' ? payload.scriptRootId : null
    const targetBlueprintId = typeof payload.targetBlueprintId === 'string' ? payload.targetBlueprintId : null
    let clearedBlueprintId = targetBlueprintId
    if (targetBlueprintId) {
      this.inFlightByBlueprint.delete(targetBlueprintId)
    } else if (payload.requestId) {
      for (const [blueprintId, pending] of this.inFlightByBlueprint.entries()) {
        if (pending?.requestId === payload.requestId) {
          this.inFlightByBlueprint.delete(blueprintId)
          clearedBlueprintId = blueprintId
          break
        }
      }
    }
    if (!clearedBlueprintId && scriptRootId) {
      for (const [blueprintId, pending] of this.inFlightByBlueprint.entries()) {
        if (pending?.scriptRootId === scriptRootId) {
          this.inFlightByBlueprint.delete(blueprintId)
          clearedBlueprintId = blueprintId
          break
        }
      }
    }

    if (scriptRootId || clearedBlueprintId) {
      this.world.emit?.('script-ai-pending', {
        scriptRootId,
        targetBlueprintId: clearedBlueprintId,
        requestId: payload.requestId || null,
        pending: false,
      })
    }

    const response = {
      requestId: payload.requestId || null,
      scriptRootId,
      targetBlueprintId: clearedBlueprintId,
      error: payload.error || null,
      message: payload.message || null,
      summary: typeof payload.summary === 'string' ? payload.summary : '',
      source: typeof payload.source === 'string' ? payload.source : '',
      fileCount:
        Number.isFinite(payload.fileCount) && payload.fileCount >= 0
          ? payload.fileCount
          : Array.isArray(payload.files)
            ? payload.files.length
            : 0,
      applied: payload.applied === true,
      forked: payload.forked === true,
      appliedScriptRootId: typeof payload.appliedScriptRootId === 'string' ? payload.appliedScriptRootId : null,
    }
    this.world.emit?.('script-ai-response', response)
    if (payload.error) {
      const message = payload.message || payload.error || 'AI request failed.'
      this.world.emit('toast', message)
      return
    }
    const successMessage = payload.message || (payload.applied === true ? 'AI changes applied.' : 'AI changes ready.')
    this.world.emit('toast', successMessage)
  }
}
