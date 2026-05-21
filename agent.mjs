function noop() {}

function createNoopContext() {
  return new Proxy(
    { canvas: { width: 1, height: 1 } },
    {
      get(target, prop) {
        if (prop in target) return target[prop]
        target[prop] = noop
        return target[prop]
      },
      set(target, prop, value) {
        target[prop] = value
        return true
      },
    }
  )
}

const NOOP_CONTEXT = createNoopContext()

function createMockElement(type = 'div') {
  return {
    nodeName: String(type).toUpperCase(),
    style: {},
    children: [],
    className: '',
    width: 1,
    height: 1,
    appendChild(child) {
      this.children.push(child)
      return child
    },
    removeChild(child) {
      this.children = this.children.filter(item => item !== child)
    },
    setAttribute() {},
    getAttribute() {
      return null
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    getContext: () => NOOP_CONTEXT,
  }
}

function ensureNodeShims() {
  if (typeof globalThis.window !== 'object') globalThis.window = {}
  Object.assign(globalThis.window, {
    addEventListener: globalThis.window.addEventListener || noop,
    removeEventListener: globalThis.window.removeEventListener || noop,
    matchMedia:
      globalThis.window.matchMedia ||
      (() => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false
        },
      })),
    location: globalThis.window.location || { search: '' },
    requestAnimationFrame: globalThis.window.requestAnimationFrame || (fn => setTimeout(() => fn(Date.now()), 16)),
    cancelAnimationFrame: globalThis.window.cancelAnimationFrame || (id => clearTimeout(id)),
    devicePixelRatio: globalThis.window.devicePixelRatio || 1,
  })

  if (typeof globalThis.navigator !== 'object') {
    globalThis.navigator = { maxTouchPoints: 0, platform: 'Linux x86_64' }
  }

  if (typeof globalThis.document !== 'object') globalThis.document = {}
  Object.assign(globalThis.document, {
    activeElement: globalThis.document.activeElement || null,
    body: globalThis.document.body || {
      style: {},
      appendChild() {},
      removeChild() {},
      addEventListener() {},
      removeEventListener() {},
    },
    documentElement: globalThis.document.documentElement || createMockElement('html'),
    addEventListener: globalThis.document.addEventListener || noop,
    removeEventListener: globalThis.document.removeEventListener || noop,
    createElementNS: globalThis.document.createElementNS || ((_ns, type) => createMockElement(type)),
    createElement: globalThis.document.createElement || (type => createMockElement(type)),
    getElementsByClassName: globalThis.document.getElementsByClassName || (() => []),
    getElementsByTagName: globalThis.document.getElementsByTagName || (() => []),
    pointerLockElement: globalThis.document.pointerLockElement || null,
    exitPointerLock:
      globalThis.document.exitPointerLock ||
      function () {
        this.pointerLockElement = null
      },
  })

  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map()
    globalThis.localStorage = {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, val) => store.set(key, String(val)),
      removeItem: key => store.delete(key),
      clear: () => store.clear(),
    }
  }

  if (typeof globalThis.atob === 'undefined') {
    globalThis.atob = b64 => Buffer.from(b64, 'base64').toString('binary')
  }

  if (typeof globalThis.self === 'undefined') {
    globalThis.self = globalThis
  }
}

// Minimal DOM/browser shims for Node before importing the client bundle
ensureNodeShims()

const viewport = {
  offsetWidth: 1920,
  offsetHeight: 1080,
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
  requestPointerLock: async () => {},
}

function parseArgs(argv) {
  const opts = {
    wsUrl: '',
    name: '',
    avatar: '',
    relaySelfMessages: process.env.RELAY_SELF_MESSAGES === '1',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--ws' || arg === '--url' || arg === '--world-url') {
      opts.wsUrl = argv[i + 1] || ''
      i += 1
      continue
    }

    if (arg === '--name') {
      opts.name = argv[i + 1] || ''
      i += 1
      continue
    }

    if (arg === '--avatar') {
      opts.avatar = argv[i + 1] || ''
      i += 1
      continue
    }

    if (arg === '--relay-self') {
      opts.relaySelfMessages = true
      continue
    }

    if (arg && !arg.startsWith('--') && !opts.wsUrl) {
      opts.wsUrl = arg
      continue
    }
  }

  return opts
}

function normalizeWsUrl(raw) {
  const fallback = 'ws://localhost:3000/ws'
  if (!raw || !raw.trim()) return fallback

  const trimmed = raw.trim().replace(/\/+$/, '')

  if (/^wss?:\/\//.test(trimmed)) {
    if (trimmed.endsWith('/ws')) return trimmed
    return `${trimmed}/ws`
  }

  if (/^https?:\/\//.test(trimmed)) {
    const mapped = trimmed.replace(/^https?:/, m => (m === 'https:' ? 'wss:' : 'ws:'))
    if (mapped.endsWith('/ws')) return mapped
    return `${mapped}/ws`
  }

  return `${trimmed}/ws`
}

const cli = parseArgs(process.argv.slice(2))

const wsUrl = normalizeWsUrl(
  cli.wsUrl || process.env.WS_URL || process.env.WORLD_WS_URL || process.env.WORLD_URL || process.env.WORLD_SOCKET
)

// In-memory storage avoids cross-process authToken collisions.
const runtimeStorage = {
  _data: new Map(),
  get(key, defaultValue = null) {
    const value = this._data.get(key)
    if (value === undefined) return defaultValue
    return value
  },
  set(key, value) {
    if (value === undefined || value === null) {
      this._data.delete(key)
    } else {
      this._data.set(key, value)
    }
  },
  remove(key) {
    this._data.delete(key)
  },
}
if (process.env.AUTH_TOKEN) {
  runtimeStorage.set('authToken', process.env.AUTH_TOKEN)
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function emitEvent(event, payload) {
  emit({ type: 'event', event, payload })
}

function emitResponse(id, payload) {
  if (!id) return
  emit({ type: 'response', id, ok: true, payload })
}

function emitError(id, code, detail) {
  const error = { code: code || 'error', detail }
  if (!id) {
    emit({ type: 'error', error })
    return
  }
  emit({ type: 'response', id, ok: false, error })
}

function safeSliceText(text, max = 1200) {
  if (!text) return ''
  const str = String(text)
  if (str.length <= max) return str
  return `${str.slice(0, max)}…`
}

function extractPlayerInfo(player) {
  return {
    id: player.data?.id,
    owner: player.data?.owner,
    name: player.data?.name,
    userId: player.data?.userId,
    avatar: player.data?.avatar,
    sessionAvatar: player.data?.sessionAvatar,
    rank: player.data?.rank,
    health: player.data?.health,
  }
}

function collectPlayers(worldRef) {
  const out = []
  if (!worldRef?.entities?.players) return out
  for (const player of worldRef.entities.players.values()) {
    out.push(extractPlayerInfo(player))
  }
  return out
}

let shuttingDown = false

function handleShutdown(worldRef, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  try {
    worldRef?.destroy()
  } finally {
    emitEvent('shutdown', { exitCode })
    process.exit(exitCode)
  }
}

const pendingLineBuffer = { value: '' }

function normalizeInbound(input) {
  if (!input || typeof input !== 'string') {
    return null
  }

  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') {
      return { _invalid: true }
    }
    return parsed
  } catch {
    return { _invalid: true }
  }
}

async function processRequest(worldRef, request) {
  if (!request || request._invalid) {
    emitError(request?.id, 'invalid_json')
    return
  }

  const id = request.id
  const action = request.action || request.method || request.type
  const params = request.params || {}

  if (!id) {
    emitError(null, 'missing_request_id')
    return
  }

  try {
    if (action === 'ping') {
      emitResponse(id, { pong: true, timestamp: Date.now() })
      return
    }

    if (action === 'send' || action === 'chat.send') {
      const text = safeSliceText((params.text || params.body || '').trim(), 1500)
      if (!text) {
        emitError(id, 'invalid_payload', 'text is required')
        return
      }
      const msg = worldRef.chat?.send?.(text)
      if (!msg) {
        emitError(id, 'send_failed', 'unable to send chat message')
        return
      }
      emitResponse(id, { ok: true, id: msg.id })
      return
    }

    if (action === 'state' || action === 'status' || action === 'world.status') {
      emitResponse(id, {
        connected: worldRef.network?.wsUrl,
        networkId: worldRef.network?.id,
        hasAdmin: !!worldRef.admin,
        playerCount: worldRef.entities?.players?.size ?? 0,
      })
      return
    }

    if (action === 'players' || action === 'players.list') {
      emitResponse(id, { players: collectPlayers(worldRef) })
      return
    }

    if (action === 'raw' || action === 'raw.send') {
      const event = params.event || 'raw'
      const payload = params.payload
      emitEvent(event, payload)
      emitResponse(id, { ok: true })
      return
    }

    if (action === 'shutdown' || action === 'exit' || action === 'quit') {
      emitResponse(id, { ok: true })
      handleShutdown(worldRef)
      return
    }

    emitError(id, 'unknown_action', `unsupported action: ${String(action)}`)
  } catch (error) {
    emitError(id, 'handler_error', error?.message || String(error))
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  pendingLineBuffer.value += chunk

  const lines = pendingLineBuffer.value.split('\n')
  pendingLineBuffer.value = lines.pop() || ''

  for (const line of lines) {
    const request = normalizeInbound(line)
    processRequest(world, request)
  }
})

process.stdin.on('end', () => {
  if (pendingLineBuffer.value.trim()) {
    const request = normalizeInbound(pendingLineBuffer.value)
    processRequest(world, request)
  }
})

process.on('SIGINT', () => {
  emitEvent('signal', { name: 'SIGINT' })
  handleShutdown(world, 0)
})

process.on('SIGTERM', () => {
  emitEvent('signal', { name: 'SIGTERM' })
  handleShutdown(world, 0)
})

const { createNodeClientWorld } = await import('./build/world-node-client.js')

const world = createNodeClientWorld()

// Re-apply shims in case a system (e.g. loader) overwrote them during construction
ensureNodeShims()

// Headless mode: disable in-world player chat bubbles (they require renderer capabilities).
if (world.entities?.getPlayer) {
  const getPlayer = world.entities.getPlayer.bind(world.entities)
  const patched = new WeakSet()
  world.entities.getPlayer = (...args) => {
    const player = getPlayer(...args)
    if (player && typeof player.chat === 'function' && !patched.has(player)) {
      patched.add(player)
      player.chat = () => {}
    }
    return player
  }
}

// Provide a minimal file cache API expected by AppServerClient in Node
if (!world.loader.getFile || !world.loader.insert) {
  const fileCache = new Map()
  if (!world.loader.getFile) {
    world.loader.getFile = url => fileCache.get(url)
  }
  if (!world.loader.insert) {
    world.loader.insert = (type, url, file) => fileCache.set(url, file)
  }
}

world.on('connectionStatus', status => {
  emitEvent('connectionStatus', status)
})

world.once('ready', () => {
  emitEvent('ready', {
    networkId: world.network?.id,
    worldId: world.settings?.worldId,
    tickRate: world.networkRate,
  })
  emitEvent('players', { players: collectPlayers(world) })
})

world.events.on('chat', msg => {
  if (!msg || typeof msg !== 'object') return
  if (!cli.relaySelfMessages && msg.fromId && msg.fromId === world.network?.id) return

  emitEvent('chat', {
    id: msg.id,
    from: msg.from,
    fromId: msg.fromId,
    body: msg.body,
    createdAt: msg.createdAt,
    self: msg.fromId && msg.fromId === world.network?.id,
  })
})

world.events.on('enter', ({ playerId }) => {
  const player = world.entities?.get?.(playerId)
  emitEvent('player.enter', extractPlayerInfo(player || { data: { id: playerId } }))
})

world.events.on('leave', ({ playerId }) => {
  emitEvent('player.leave', { playerId })
})

world.on('kick', code => {
  emitEvent('kick', { code })
})

world.on('disconnect', code => {
  emitEvent('disconnect', { code })
})

world.init({
  wsUrl,
  viewport,
  name: cli.name || process.env.PLAYER_NAME || process.env.OPENCLAW_AGENT_NAME,
  avatar: cli.avatar || process.env.PLAYER_AVATAR,
  storage: runtimeStorage,
})

console.error(`[node-client] world bridge started ${wsUrl}`)
console.error(`[node-client] relaySelfMessages=${cli.relaySelfMessages}`)
emitEvent('started', { wsUrl })
