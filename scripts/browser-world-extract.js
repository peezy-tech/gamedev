/*
  Lobby/Hyperfy world extractor (browser-side)

  Usage:
  1) Open a world page as a client.
  2) Open DevTools Console.
  3) Paste this whole file and run it.

  What it exports:
  - Client JS bundles loaded by the page.
  - Sourcemaps (if available).
  - Targeted source files for controls/physics/player from sourcemaps (if available).
  - Blueprint JSON files.
  - Blueprint script files (scriptFiles, scriptRef, and legacy script fallback).
  - A world snapshot JSON and world.json scaffold.

  Output:
  - Writes into a chosen folder (if File System Access API is available),
    otherwise downloads a single ZIP.
*/

;(async () => {
  const OPTIONS = {
    includeAllSourceMapSources: false,
    includeBlueprintScripts: true,
    includeClientBundles: true,
    includeSourceMaps: true,
    // In standalone mode, keep this false to avoid duplicate_user kicks.
    // In some setups you may need true to get a snapshot over /ws.
    reuseStoredAuthTokenForWs: false,
    // Optional manual WS URL override, e.g. "wss://example.com/ws"
    wsUrl: null,
  }

  const PACKET_NAMES = [
    'snapshot',
    'command',
    'chatAdded',
    'chatCleared',
    'blueprintAdded',
    'blueprintModified',
    'entityAdded',
    'entityModified',
    'entityEvent',
    'entityRemoved',
    'playerTeleport',
    'playerPush',
    'playerSessionAvatar',
    'playerAvatar',
    'liveKitLevel',
    'mute',
    'settingsModified',
    'spawnModified',
    'modifyRank',
    'kick',
    'ping',
    'pong',
    'blueprintRemoved',
    'adminAuth',
    'adminAuthOk',
    'adminAuthError',
    'adminCommand',
    'adminResult',
    'playerJoined',
    'playerUpdated',
    'playerLeft',
    'scriptAiRequest',
    'scriptAiProposal',
    'scriptAiEvent',
    'aiCreateRequest',
    'serverLog',
    'serverLogHistory',
    'subscribeLogs',
    'unsubscribeLogs',
  ]

  const INTERESTING_SOURCE_PATTERNS = [
    /ClientControls\.js$/i,
    /Physics\.js$/i,
    /PlayerLocal\.js$/i,
    /PlayerRemote\.js$/i,
    /core\/systems\/ClientControls/i,
    /core\/systems\/Physics/i,
    /core\/entities\/PlayerLocal/i,
  ]

  const encoder = new TextEncoder()
  const outputFiles = new Map()
  const scriptTextCache = new Map()
  const stats = {
    blueprintCount: 0,
    blueprintScriptFiles: 0,
    bundleCount: 0,
    sourceMapCount: 0,
    interestingSources: 0,
    warnings: [],
  }

  const rootName = `lobby-export-${new Date().toISOString().replace(/[:.]/g, '-')}`

  function log(...args) {
    console.log('[lobby-export]', ...args)
  }

  function warn(...args) {
    stats.warnings.push(args.map(String).join(' '))
    console.warn('[lobby-export]', ...args)
  }

  function normalizeSlashes(value) {
    return String(value || '').replace(/\\/g, '/')
  }

  function sanitizePathSegment(segment) {
    return String(segment || '')
      .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '') || '_'
  }

  function sanitizePath(inputPath) {
    const normalized = normalizeSlashes(inputPath).replace(/^\/+/, '')
    const parts = normalized
      .split('/')
      .filter(Boolean)
      .filter(part => part !== '.' && part !== '..')
      .map(sanitizePathSegment)
    return parts.join('/')
  }

  function addTextFile(filePath, text) {
    const clean = sanitizePath(filePath)
    outputFiles.set(clean, encoder.encode(String(text)))
  }

  function addBytesFile(filePath, bytes) {
    const clean = sanitizePath(filePath)
    const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    outputFiles.set(clean, value)
  }

  function readStorageValue(key) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  function parseBlueprintId(id) {
    if (id === '$scene') return { appName: '$scene', fileBase: '$scene' }
    if (typeof id !== 'string' || !id.trim()) return { appName: 'unknown', fileBase: 'unknown' }
    const idx = id.indexOf('__')
    if (idx === -1) return { appName: id, fileBase: id }
    return {
      appName: id.slice(0, idx),
      fileBase: id.slice(idx + 2),
    }
  }

  function normalizeScriptRelPath(pathValue) {
    return normalizeSlashes(pathValue || '').replace(/^\/+/, '')
  }

  function hasScriptFiles(blueprint) {
    return isPlainObject(blueprint?.scriptFiles)
  }

  function getScriptRootBlueprint(blueprint, blueprintMap) {
    if (!blueprint || !blueprint.id) return null
    const scriptRef = typeof blueprint.scriptRef === 'string' ? blueprint.scriptRef.trim() : ''
    if (scriptRef) {
      const root = blueprintMap.get(scriptRef)
      if (root && hasScriptFiles(root)) return root
    }
    if (hasScriptFiles(blueprint)) return blueprint
    const parsed = parseBlueprintId(blueprint.id)
    if (parsed.appName && parsed.appName !== blueprint.id) {
      const base = blueprintMap.get(parsed.appName)
      if (base && hasScriptFiles(base)) return base
    }
    return null
  }

  function resolveAbsoluteUrl(url, base) {
    if (!url || typeof url !== 'string') return null
    if (url.startsWith('asset://')) {
      if (!base) return null
      const filename = url.slice('asset://'.length)
      return `${String(base).replace(/\/+$/, '')}/${filename.replace(/^\/+/, '')}`
    }
    try {
      return new URL(url, window.location.href).toString()
    } catch {
      return null
    }
  }

  function hashShort(value) {
    let hash = 5381
    const str = String(value || '')
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash * 33) ^ str.charCodeAt(i)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  function urlToBundleFilePath(rawUrl, extFallback = '.js') {
    let url
    try {
      url = new URL(rawUrl, window.location.href)
    } catch {
      return `client/bundles/unknown/${hashShort(rawUrl)}${extFallback}`
    }
    let pathname = decodeURIComponent(url.pathname || '/')
    if (pathname.endsWith('/')) pathname += 'index'
    if (!/\.[a-z0-9]+$/i.test(pathname)) pathname += extFallback
    const querySuffix = url.search ? `__q${hashShort(url.search)}` : ''
    const extMatch = pathname.match(/(\.[a-z0-9]+)$/i)
    if (extMatch) {
      pathname = pathname.slice(0, -extMatch[1].length) + querySuffix + extMatch[1]
    } else if (querySuffix) {
      pathname += querySuffix
    }
    return sanitizePath(`client/bundles/${url.host}/${pathname.replace(/^\/+/, '')}`)
  }

  function parseSourceMappingUrl(jsText) {
    if (typeof jsText !== 'string') return null
    const regex = /\/\/[#@]\s*sourceMappingURL=([^\s]+)/g
    let match = null
    let last = null
    while ((match = regex.exec(jsText))) {
      last = match[1]
    }
    return last
  }

  function simplifySourcePath(sourcePath, index) {
    let pathValue = normalizeScriptRelPath(sourcePath || `source-${index}.js`)
    pathValue = pathValue.replace(/^webpack:\/\//i, '')
    pathValue = pathValue.replace(/^file:\/\//i, '')
    pathValue = pathValue.replace(/^[A-Za-z]:\//, '')
    pathValue = pathValue.replace(/^\/+/, '')
    if (!pathValue) pathValue = `source-${index}.js`
    return sanitizePath(pathValue)
  }

  function sourceIsInteresting(sourcePath, sourceContent) {
    for (const pattern of INTERESTING_SOURCE_PATTERNS) {
      if (pattern.test(sourcePath)) return true
    }
    if (typeof sourceContent === 'string') {
      if (sourceContent.includes('class ClientControls')) return true
      if (sourceContent.includes('class Physics')) return true
      if (sourceContent.includes('class PlayerLocal')) return true
    }
    return false
  }

  function extractSnippets(text, keywords, context = 8, maxSnippets = 20) {
    if (typeof text !== 'string') return ''
    const lines = text.split(/\r?\n/)
    const out = []
    const used = new Set()
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!keywords.some(k => line.includes(k))) continue
      const start = Math.max(0, i - context)
      const end = Math.min(lines.length, i + context + 1)
      const key = `${start}:${end}`
      if (used.has(key)) continue
      used.add(key)
      out.push(`--- lines ${start + 1}-${end} ---\n${lines.slice(start, end).join('\n')}`)
      if (out.length >= maxSnippets) break
    }
    return out.join('\n\n')
  }

  async function importFromCdn(candidates, pick) {
    let lastError = null
    for (const url of candidates) {
      try {
        const mod = await import(url)
        const value = pick(mod)
        if (value) return value
      } catch (err) {
        lastError = err
      }
    }
    throw lastError || new Error('cdn_import_failed')
  }

  async function loadMsgPackDecode() {
    return importFromCdn(
      [
        'https://esm.sh/@msgpack/msgpack@3.0.0',
        'https://cdn.jsdelivr.net/npm/@msgpack/msgpack@3.0.0/dist.es5+esm/index.mjs',
      ],
      mod => mod.decode
    )
  }

  async function loadJSZip() {
    return importFromCdn(
      ['https://esm.sh/jszip@3.10.1', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm'],
      mod => mod.default || mod.JSZip
    )
  }

  function inferApiUrl() {
    if (globalThis.env?.PUBLIC_API_URL) return globalThis.env.PUBLIC_API_URL
    return `${window.location.origin}/api`
  }

  function inferStandaloneWsUrl(apiUrl) {
    if (globalThis.env?.PUBLIC_WS_URL) return globalThis.env.PUBLIC_WS_URL
    if (apiUrl) {
      return apiUrl
        .replace(/\/api\/?$/, '/ws')
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:')
    }
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  }

  function inferAuthMode() {
    const explicit = String(globalThis.env?.PUBLIC_AUTH_MODE || '')
      .trim()
      .toLowerCase()
    if (explicit === 'platform' || explicit === 'standalone') return explicit
    if (globalThis.env?.PUBLIC_WORLD_SLUG) return 'platform'
    const match = window.location.pathname.match(/^\/worlds\/([^/]+)/)
    if (match?.[1]) return 'platform'
    return 'standalone'
  }

  function inferWorldSlug() {
    if (globalThis.env?.PUBLIC_WORLD_SLUG) return globalThis.env.PUBLIC_WORLD_SLUG
    const match = window.location.pathname.match(/^\/worlds\/([^/]+)/)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  }

  function buildWsUrl(baseUrl, token) {
    const parsed = new URL(baseUrl, window.location.href)
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '/ws'
    }
    if (token) {
      parsed.searchParams.set('authToken', token)
    }
    return parsed.toString()
  }

  async function pollPlatformJoinConnection(apiUrl, worldSlug, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const response = await fetch(`${String(apiUrl).replace(/\/+$/, '')}/worlds/${worldSlug}/join`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error(`platform_join_failed:${response.status}`)
      }
      const data = await response.json()
      const status = String(data?.status || '')
      if (status === 'ready' && data.connection) {
        return data.connection
      }
      if (status !== 'provisioning' && status !== 'starting') {
        throw new Error(`platform_join_unexpected_status:${status || 'unknown'}`)
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    throw new Error('platform_join_timeout')
  }

  function normalizeSnapshot(snapshotLike) {
    const blueprints = Array.isArray(snapshotLike?.blueprints) ? snapshotLike.blueprints : []
    const entities = Array.isArray(snapshotLike?.entities) ? snapshotLike.entities : []
    return {
      source: snapshotLike?.source || 'unknown',
      worldId: snapshotLike?.worldId || null,
      assetsUrl: snapshotLike?.assetsUrl || null,
      settings: isPlainObject(snapshotLike?.settings) ? snapshotLike.settings : {},
      spawn: isPlainObject(snapshotLike?.spawn)
        ? snapshotLike.spawn
        : { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      blueprints,
      entities,
    }
  }

  function looksLikeWorld(candidate) {
    if (!candidate || typeof candidate !== 'object') return false
    const hasBlueprints =
      (candidate.blueprints?.items instanceof Map) || typeof candidate.blueprints?.serialize === 'function'
    const hasEntities =
      (candidate.entities?.items instanceof Map) || typeof candidate.entities?.serialize === 'function'
    const hasCore = candidate.network && typeof candidate.resolveURL === 'function'
    return !!(hasBlueprints && hasEntities && hasCore)
  }

  function extractWorldFromFiber(rootFiber) {
    const queue = [rootFiber]
    const visited = new Set()
    while (queue.length) {
      const fiber = queue.shift()
      if (!fiber || visited.has(fiber)) continue
      visited.add(fiber)

      if (looksLikeWorld(fiber.stateNode)) return fiber.stateNode

      let hook = fiber.memoizedState
      let guard = 0
      while (hook && guard < 80) {
        guard += 1
        const value = hook.memoizedState
        if (looksLikeWorld(value)) return value
        if (Array.isArray(value)) {
          for (const item of value) {
            if (looksLikeWorld(item)) return item
          }
        }
        hook = hook.next
      }

      if (fiber.child) queue.push(fiber.child)
      if (fiber.sibling) queue.push(fiber.sibling)
    }
    return null
  }

  function findWorldFromReact() {
    const roots = [document.getElementById('root'), document.body, document.documentElement].filter(Boolean)
    for (const rootEl of roots) {
      for (const key of Object.keys(rootEl)) {
        if (!key.startsWith('__reactContainer$') && !key.startsWith('__reactFiber$')) continue
        const rootFiber = rootEl[key]
        const world = extractWorldFromFiber(rootFiber)
        if (world) return world
      }
    }
    return null
  }

  async function snapshotFromWorldInstance(world) {
    const blueprints =
      typeof world.blueprints?.serialize === 'function'
        ? world.blueprints.serialize()
        : world.blueprints?.items instanceof Map
          ? Array.from(world.blueprints.items.values())
          : []
    const entities =
      typeof world.entities?.serialize === 'function'
        ? world.entities.serialize()
        : world.entities?.items instanceof Map
          ? Array.from(world.entities.items.values()).map(item => item?.data || item)
          : []
    const settings = typeof world.settings?.serialize === 'function' ? world.settings.serialize() : {}
    return normalizeSnapshot({
      source: 'world-instance',
      assetsUrl: world.assetsUrl || null,
      settings,
      blueprints,
      entities,
      spawn: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      worldId: null,
    })
  }

  async function tryAdminSnapshot() {
    const adminCode = readStorageValue('adminCode')
    const headers = {}
    if (typeof adminCode === 'string' && adminCode.trim()) {
      headers['X-Admin-Code'] = adminCode.trim()
    }
    const candidates = []
    if (globalThis.env?.PUBLIC_ADMIN_URL) {
      const base = String(globalThis.env.PUBLIC_ADMIN_URL).replace(/\/+$/, '')
      candidates.push(`${base}/admin/snapshot`)
    }
    candidates.push(`${window.location.origin}/admin/snapshot`)

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers,
        })
        if (!response.ok) continue
        const data = await response.json()
        return normalizeSnapshot({ ...data, source: 'admin-snapshot' })
      } catch {
        // continue
      }
    }
    return null
  }

  async function snapshotFromWs() {
    const decode = await loadMsgPackDecode()
    const apiUrl = inferApiUrl()
    const authMode = inferAuthMode()
    let wsUrl = OPTIONS.wsUrl

    if (!wsUrl) {
      if (authMode === 'platform') {
        const worldSlug = inferWorldSlug()
        if (!worldSlug) throw new Error('platform_world_slug_missing')
        const connection = await pollPlatformJoinConnection(apiUrl, worldSlug)
        const base = connection.wsUrl || connection.url || `wss://${connection.host}:${connection.port}`
        wsUrl = buildWsUrl(base, connection.token)
      } else {
        const baseWs = inferStandaloneWsUrl(apiUrl)
        const token = OPTIONS.reuseStoredAuthTokenForWs ? readStorageValue('authToken') : null
        wsUrl = buildWsUrl(baseWs, typeof token === 'string' ? token : null)
      }
    }

    log('Connecting snapshot WS:', wsUrl)

    const snapshot = await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('ws_snapshot_timeout'))
      }, 20000)

      ws.addEventListener('message', async event => {
        try {
          let data = event.data
          if (data instanceof Blob) data = await data.arrayBuffer()
          const packet = data instanceof Uint8Array ? data : new Uint8Array(data)
          const decoded = decode(packet)
          if (!Array.isArray(decoded) || decoded.length < 2) return
          const id = decoded[0]
          const payload = decoded[1]
          const name = PACKET_NAMES[id]
          if (name === 'kick') {
            clearTimeout(timeout)
            ws.close()
            reject(new Error(`ws_kicked:${String(payload)}`))
            return
          }
          if (name === 'snapshot') {
            clearTimeout(timeout)
            ws.close()
            resolve(normalizeSnapshot({ ...payload, source: 'ws-snapshot' }))
          }
        } catch (err) {
          clearTimeout(timeout)
          ws.close()
          reject(err)
        }
      })

      ws.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('ws_snapshot_error'))
      })
      ws.addEventListener('close', () => {
        // no-op: success/error handled in message/error/timeout paths
      })
    })

    return snapshot
  }

  async function resolveSnapshot() {
    if (looksLikeWorld(globalThis.world)) {
      log('Using global world instance')
      return snapshotFromWorldInstance(globalThis.world)
    }
    const reactWorld = findWorldFromReact()
    if (reactWorld) {
      log('Using React world instance')
      return snapshotFromWorldInstance(reactWorld)
    }

    const adminSnapshot = await tryAdminSnapshot()
    if (adminSnapshot) {
      log('Using /admin/snapshot')
      return adminSnapshot
    }

    log('Falling back to runtime /ws snapshot')
    return snapshotFromWs()
  }

  async function fetchTextWithCache(url, init) {
    if (!url) return null
    if (scriptTextCache.has(url)) return scriptTextCache.get(url)
    const response = await fetch(url, init)
    if (!response.ok) {
      throw new Error(`fetch_failed:${response.status}:${url}`)
    }
    const text = await response.text()
    scriptTextCache.set(url, text)
    return text
  }

  async function exportBlueprintsAndScripts(snapshot) {
    const blueprints = Array.isArray(snapshot.blueprints) ? snapshot.blueprints : []
    stats.blueprintCount = blueprints.length
    addTextFile(
      'world/snapshot.json',
      JSON.stringify(
        {
          source: snapshot.source,
          worldId: snapshot.worldId,
          assetsUrl: snapshot.assetsUrl,
          settings: snapshot.settings,
          spawn: snapshot.spawn,
          blueprints: snapshot.blueprints,
          entities: snapshot.entities,
        },
        null,
        2
      ) + '\n'
    )

    const worldManifest = {
      formatVersion: 2,
      settings: snapshot.settings || {},
      spawn: snapshot.spawn || { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      entities: (Array.isArray(snapshot.entities) ? snapshot.entities : [])
        .filter(entity => entity?.type === 'app')
        .map(entity => ({
          id: entity.id,
          blueprint: entity.blueprint,
          position: Array.isArray(entity.position) ? entity.position.slice(0, 3) : [0, 0, 0],
          quaternion: Array.isArray(entity.quaternion) ? entity.quaternion.slice(0, 4) : [0, 0, 0, 1],
          scale: Array.isArray(entity.scale) ? entity.scale.slice(0, 3) : [1, 1, 1],
          pinned: Boolean(entity.pinned),
          props: isPlainObject(entity.props) ? entity.props : {},
          state: isPlainObject(entity.state) ? entity.state : {},
        })),
    }
    addTextFile('world/world.json', JSON.stringify(worldManifest, null, 2) + '\n')

    const blueprintMap = new Map()
    for (const blueprint of blueprints) {
      if (blueprint?.id) blueprintMap.set(blueprint.id, blueprint)
    }

    const syncedScriptRoots = new Set()
    for (const blueprint of blueprints) {
      if (!blueprint?.id) continue
      const { appName, fileBase } = parseBlueprintId(blueprint.id)
      const blueprintPath = `world/apps/${appName}/${fileBase}.json`
      addTextFile(blueprintPath, JSON.stringify(blueprint, null, 2) + '\n')
      if (!OPTIONS.includeBlueprintScripts) continue

      const scriptRoot = getScriptRootBlueprint(blueprint, blueprintMap)
      if (scriptRoot && scriptRoot.id) {
        if (syncedScriptRoots.has(scriptRoot.id)) continue
        syncedScriptRoots.add(scriptRoot.id)

        const rootAppName = parseBlueprintId(scriptRoot.id).appName
        const scriptFiles = isPlainObject(scriptRoot.scriptFiles) ? scriptRoot.scriptFiles : {}
        for (const [relPathRaw, assetRef] of Object.entries(scriptFiles)) {
          const relPath = normalizeScriptRelPath(relPathRaw)
          if (!relPath || typeof assetRef !== 'string') continue
          const url = resolveAbsoluteUrl(assetRef, snapshot.assetsUrl)
          if (!url) {
            warn(`Skipping script without resolvable URL: ${scriptRoot.id} ${relPath}`)
            continue
          }
          try {
            const text = await fetchTextWithCache(url, { credentials: 'include' })
            const sharedPrefixA = '@shared/'
            const sharedPrefixB = 'shared/'
            let outPath
            if (relPath.startsWith(sharedPrefixA)) {
              outPath = `world/shared/${relPath.slice(sharedPrefixA.length)}`
            } else if (relPath.startsWith(sharedPrefixB)) {
              outPath = `world/shared/${relPath.slice(sharedPrefixB.length)}`
            } else {
              outPath = `world/apps/${rootAppName}/${relPath}`
            }
            addTextFile(outPath, text)
            stats.blueprintScriptFiles += 1
          } catch (err) {
            warn(`Failed to fetch script file ${scriptRoot.id}:${relPath}`, err.message || err)
          }
        }
        continue
      }

      // Legacy single-file fallback
      if (typeof blueprint.script === 'string' && blueprint.script) {
        const url = resolveAbsoluteUrl(blueprint.script, snapshot.assetsUrl)
        if (!url) continue
        try {
          const text = await fetchTextWithCache(url, { credentials: 'include' })
          const entryName =
            typeof blueprint.scriptEntry === 'string' && blueprint.scriptEntry.trim() ? blueprint.scriptEntry : 'index.js'
          addTextFile(`world/apps/${appName}/${entryName}`, text)
          stats.blueprintScriptFiles += 1
        } catch (err) {
          warn(`Failed to fetch legacy script ${blueprint.id}`, err.message || err)
        }
      }
    }
  }

  function collectBundleUrls() {
    const urls = new Set()

    for (const script of document.querySelectorAll('script[src]')) {
      try {
        urls.add(new URL(script.src, window.location.href).toString())
      } catch {
        // ignore bad URLs
      }
    }

    const resourceEntries = performance.getEntriesByType('resource')
    for (const entry of resourceEntries) {
      if (!entry?.name) continue
      const isScriptLike = entry.initiatorType === 'script' || /\.m?js(\?|$)/i.test(entry.name)
      if (!isScriptLike) continue
      try {
        urls.add(new URL(entry.name, window.location.href).toString())
      } catch {
        // ignore
      }
    }

    // Common direct bundle paths in this runtime.
    urls.add(new URL('/index.js', window.location.origin).toString())
    urls.add(new URL('/particles.js', window.location.origin).toString())
    urls.add(new URL('/env.js', window.location.origin).toString())

    return Array.from(urls)
  }

  async function exportClientBundles() {
    if (!OPTIONS.includeClientBundles) return
    const bundleUrls = collectBundleUrls()
    const sourceIndex = []

    for (const bundleUrl of bundleUrls) {
      try {
        const response = await fetch(bundleUrl, { credentials: 'include' })
        if (!response.ok) continue
        const text = await response.text()
        const bundlePath = urlToBundleFilePath(bundleUrl, '.js')
        addTextFile(bundlePath, text)
        stats.bundleCount += 1

        const snippets = extractSnippets(text, ['ClientControls', 'PlayerLocal', 'Physics', 'Px'])
        if (snippets) {
          addTextFile(`${bundlePath}.snippets.txt`, snippets + '\n')
        }

        if (!OPTIONS.includeSourceMaps) continue
        const sourceMapRef = parseSourceMappingUrl(text)
        if (!sourceMapRef) continue

        let sourceMapUrl
        try {
          sourceMapUrl = new URL(sourceMapRef, bundleUrl).toString()
        } catch {
          continue
        }
        const mapResponse = await fetch(sourceMapUrl, { credentials: 'include' })
        if (!mapResponse.ok) continue
        const mapText = await mapResponse.text()
        const mapPath = urlToBundleFilePath(sourceMapUrl, '.map')
        addTextFile(mapPath, mapText)
        stats.sourceMapCount += 1

        let sourceMap
        try {
          sourceMap = JSON.parse(mapText)
        } catch {
          continue
        }

        const sources = Array.isArray(sourceMap.sources) ? sourceMap.sources : []
        const sourcesContent = Array.isArray(sourceMap.sourcesContent) ? sourceMap.sourcesContent : []
        const sourceRoot = typeof sourceMap.sourceRoot === 'string' ? sourceMap.sourceRoot : ''
        const bundleKey = sanitizePath(bundlePath).replace(/\.[^.]+$/, '')
        for (let i = 0; i < sources.length; i += 1) {
          const source = sources[i]
          const content = sourcesContent[i]
          if (typeof content !== 'string') continue

          const sourceWithRoot = sourceRoot ? `${normalizeScriptRelPath(sourceRoot)}/${normalizeScriptRelPath(source)}` : source
          const simplePath = simplifySourcePath(sourceWithRoot, i)
          const interesting = sourceIsInteresting(simplePath, content)
          if (!interesting && !OPTIONS.includeAllSourceMapSources) continue

          const outPath = OPTIONS.includeAllSourceMapSources
            ? `client/sources/${bundleKey}/${simplePath}`
            : `client/interesting-sources/${simplePath}`
          addTextFile(outPath, content)
          sourceIndex.push(outPath)
          if (interesting) stats.interestingSources += 1
        }
      } catch (err) {
        warn(`Failed to fetch bundle ${bundleUrl}`, err.message || err)
      }
    }

    if (sourceIndex.length) {
      addTextFile('client/source-index.txt', sourceIndex.sort().join('\n') + '\n')
    }
  }

  async function writeToPickedDirectory() {
    if (!window.showDirectoryPicker) return false
    const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    const exportHandle = await rootHandle.getDirectoryHandle(rootName, { create: true })

    async function writeFilePath(pathValue, bytes) {
      const parts = sanitizePath(pathValue).split('/').filter(Boolean)
      if (!parts.length) return
      const fileName = parts.pop()
      let dir = exportHandle
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true })
      }
      const fileHandle = await dir.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(bytes)
      await writable.close()
    }

    for (const [filePath, bytes] of outputFiles.entries()) {
      await writeFilePath(filePath, bytes)
    }
    log(`Wrote ${outputFiles.size} files to directory "${rootName}"`)
    return true
  }

  async function downloadAsZip() {
    const JSZip = await loadJSZip()
    const zip = new JSZip()
    for (const [filePath, bytes] of outputFiles.entries()) {
      zip.file(sanitizePath(filePath), bytes)
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${rootName}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 3000)
    log(`Downloaded ${outputFiles.size} files as ${rootName}.zip`)
  }

  log('Starting extraction...')
  let snapshot
  try {
    snapshot = await resolveSnapshot()
  } catch (err) {
    console.error('[lobby-export] Failed to resolve snapshot:', err)
    return
  }

  if (!snapshot.assetsUrl) {
    warn('Snapshot did not include assetsUrl; blueprint script downloads may be partial.')
  }

  await exportBlueprintsAndScripts(snapshot)
  await exportClientBundles()

  addTextFile(
    'export-report.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rootName,
        snapshotSource: snapshot.source,
        worldId: snapshot.worldId,
        assetsUrl: snapshot.assetsUrl,
        stats,
      },
      null,
      2
    ) + '\n'
  )

  try {
    const wroteDir = await writeToPickedDirectory()
    if (!wroteDir) {
      await downloadAsZip()
    }
  } catch (err) {
    warn('Directory export failed, falling back to ZIP:', err.message || err)
    await downloadAsZip()
  }

  log('Done')
  log('Summary:', {
    files: outputFiles.size,
    blueprints: stats.blueprintCount,
    blueprintScriptFiles: stats.blueprintScriptFiles,
    bundles: stats.bundleCount,
    sourceMaps: stats.sourceMapCount,
    interestingSources: stats.interestingSources,
    warnings: stats.warnings.length,
  })
})()
