import 'dotenv-flow/config'
import fs from 'fs-extra'
import path from 'path'
import { fork } from 'child_process'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { buildPlatformClient } from './vite-browser-builds.mjs'

const dev = process.argv.includes('--dev')
const clientOnly = process.argv.includes('--client-only')
const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')
const packageJson = await fs.readJson(path.join(rootDir, 'package.json'))
const externalPackages = Object.keys(packageJson.dependencies ?? {}).filter(name => !name.startsWith('@gamedev/'))

function isLocalHost(hostname) {
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '::1') return true
  if (hostname.startsWith('127.')) return true
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return false
}

function resolveLocalDevWorldDir(env = process.env) {
  if (!dev) return null
  if (String(env.RUNTIME_BOOTSTRAP || '').trim()) return null
  const worldId = String(env.WORLD_ID || '').trim()
  const worldUrl = String(env.WORLD_URL || '').trim()
  if (!worldId || !worldUrl) return null
  try {
    const parsed = new URL(worldUrl)
    if (!isLocalHost(parsed.hostname)) return null
  } catch {
    return null
  }
  return path.join(rootDir, '.lobby', worldId)
}

/**
 * Build Client
 */

{
  await buildPlatformClient({ dev })
  if (!dev && clientOnly) {
    process.exit(0)
  }
}

/**
 * Build Server
 */

let spawn

if (!clientOnly) {
  const serverCtx = await esbuild.context({
    entryPoints: ['packages/server/index.js'],
    outfile: 'build/index.js',
    platform: 'node',
    format: 'esm',
    bundle: true,
    treeShaking: true,
    minify: false,
    sourcemap: true,
    external: externalPackages,
    define: {
      'process.env.CLIENT': 'false',
      'process.env.SERVER': 'true',
    },
    plugins: [
      {
        name: 'server-finalize-plugin',
        setup(build) {
          build.onEnd(async () => {
            // copy over physx js
            const physxIdlSrc = path.join(rootDir, 'packages/core/physx-js-webidl.js')
            const physxIdlDest = path.join(rootDir, 'build/physx-js-webidl.js')
            await fs.copy(physxIdlSrc, physxIdlDest)
            // copy over physx wasm
            const physxWasmSrc = path.join(rootDir, 'packages/core/physx-js-webidl.wasm')
            const physxWasmDest = path.join(rootDir, 'build/physx-js-webidl.wasm')
            await fs.copy(physxWasmSrc, physxWasmDest)
            // copy built-in world assets to build folder to be publishable
            const builtInAssetsSrc = path.join(rootDir, 'packages/server/world/assets')
            const builtInAssetsDest = path.join(rootDir, 'build/world/assets')
            await fs.copy(builtInAssetsSrc, builtInAssetsDest)
            // start the server or stop here
            if (dev) {
              // (re)start server
              spawn?.kill('SIGTERM')
              const childEnv = { ...process.env }
              const localDevWorldDir = resolveLocalDevWorldDir(childEnv)
              if (localDevWorldDir) {
                childEnv.WORLD = localDevWorldDir
              }
              spawn = fork(path.join(rootDir, 'build/index.js'), [], {
                cwd: rootDir,
                env: childEnv,
              })
            }
          })
        },
      },
    ],
    loader: {},
  })
  if (dev) {
    await serverCtx.watch()
  } else {
    await serverCtx.rebuild()
    await serverCtx.dispose()
  }
}

/**
 * Build Node Client
 */

if (!clientOnly) {
  const nodeClientCtx = await esbuild.context({
    entryPoints: ['packages/node-client/index.js'],
    outfile: 'build/world-node-client.js',
    platform: 'node',
    format: 'esm',
    bundle: true,
    treeShaking: true,
    minify: false,
    sourcemap: true,
    external: externalPackages,
    loader: {},
  })
  if (dev) {
    await nodeClientCtx.watch()
  } else {
    await nodeClientCtx.rebuild()
    await nodeClientCtx.dispose()
  }
}
