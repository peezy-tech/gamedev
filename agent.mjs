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
    requestAnimationFrame:
      globalThis.window.requestAnimationFrame || (fn => setTimeout(() => fn(Date.now()), 16)),
    cancelAnimationFrame: globalThis.window.cancelAnimationFrame || (id => clearTimeout(id)),
    devicePixelRatio: globalThis.window.devicePixelRatio || 1,
  })

  if (typeof globalThis.navigator !== 'object') {
    globalThis.navigator = { maxTouchPoints: 0, platform: 'Linux x86_64' }
  }

  if (typeof globalThis.document !== 'object') globalThis.document = {}
  Object.assign(globalThis.document, {
    activeElement: globalThis.document.activeElement || null,
    body:
      globalThis.document.body || {
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

const { createNodeClientWorld } = await import('./build/world-node-client.js')

const world = createNodeClientWorld()

// Re-apply shims in case a system (e.g., loader) overwrote them during construction
ensureNodeShims()

// Provide a minimal file cache API expected by AppServerClient in Node
if (!world.loader.getFile || !world.loader.insert) {
  const fileCache = new Map()
  if (!world.loader.getFile) {
    world.loader.getFile = (url) => fileCache.get(url)
  }
  if (!world.loader.insert) {
    world.loader.insert = (type, url, file) => fileCache.set(url, file)
  }
}

const wsUrl = process.argv[2] || process.env.WS_URL || 'ws://localhost:3000/ws'
console.log(`[node-client] connecting to ${wsUrl}`)

// TODO:
// - running two of these fails the second one because they both try to use the same authToken and get kicked (one per world)

world.init({
  wsUrl,
  viewport,
  // name: 'Hypermon',
  // avatar: 'url to a vrm...',
})

let handle

world.once('ready', () => {
  handle = start()
})
world.on('kick', () => {
  handle?.()
  handle = null
})
world.on('disconnect', () => {
  handle?.()
  handle = null
  world.destroy()
})

function start() {
  let timerId
  let elapsed = 0
  let spoken

  const keys = ['keyW', 'keyA', 'keyS', 'keyD', 'space', 'shiftLeft']

  function next() {
    const key = keys[num(0, keys.length - 1)]
    num(0, 10) < 5 ? press(key) : release(key)
    timerId = setTimeout(next, 0.3 * 1000)
    elapsed += 0.3
    // Avoid chat UI in Node
    // if (elapsed > 2 && !spoken) {
    //   world.chat.send('heyo...')
    //   spoken = true
    // }
  }

  next()

  function press(prop) {
    console.log('press:', prop)
    world.controls.simulateButton(prop, true)
  }

  function release(prop) {
    console.log('release:', prop)
    world.controls.simulateButton(prop, false)
  }

  return () => {
    clearTimeout(timerId)
  }
}

function num(min, max, dp = 0) {
  const value = Math.random() * (max - min) + min
  return parseFloat(value.toFixed(dp))
}
