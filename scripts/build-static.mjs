import 'dotenv-flow/config'
import fs from 'fs-extra'
import path from 'path'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')
const outDir = path.join(rootDir, 'build/static')
const clientPublicDir = path.join(rootDir, 'src/client/public')
const htmlSrc = path.join(rootDir, 'src/client/public/index.html')
const worldAssetsDir = path.join(rootDir, 'src/world/assets')

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function derivePublicWsUrl(publicApiUrl) {
  if (!hasValue(publicApiUrl)) return null
  const normalized = publicApiUrl.replace(/\/+$/, '')
  if (normalized.endsWith('/api')) {
    return normalized.replace(/\/api$/, '/ws').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  }
  return normalized.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

function collectPublicEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PUBLIC_') && hasValue(value)) {
      env[key] = value
    }
  }
  if (!hasValue(env.PUBLIC_API_URL)) {
    throw new Error('PUBLIC_API_URL is required for a static gamedev client build')
  }
  if (!hasValue(env.PUBLIC_WS_URL)) {
    env.PUBLIC_WS_URL = derivePublicWsUrl(env.PUBLIC_API_URL)
  }
  if (!hasValue(env.PUBLIC_ASSET_BASE)) {
    env.PUBLIC_ASSET_BASE = '.'
  }
  if (!hasValue(env.PUBLIC_REQUIRE_WALLET_AUTH) && isTruthy(process.env.STANDALONE_WALLET_AUTH)) {
    env.PUBLIC_REQUIRE_WALLET_AUTH = 'true'
  }
  return env
}

function publicEnvCode(env) {
  return `if (!globalThis.env) globalThis.env = {}\nglobalThis.env = ${JSON.stringify(env, null, 2)}\n`
}

function toRelativeClientHtml(html) {
  return html
    .replaceAll('href="/', 'href="')
    .replaceAll('src="/', 'src="')
}

function outputRelativePath(file, marker) {
  if (!file) throw new Error(`Unable to find build output for ${marker}`)
  const rel = file.split(marker)[1]
  if (!rel) throw new Error(`Unable to resolve output path for ${file}`)
  return rel.replace(/^\/+/, '')
}

const publicEnvs = collectPublicEnv()

await fs.emptyDir(outDir)

const ctx = await esbuild.context({
  entryPoints: ['src/client/index.js', 'src/client/particles.js'],
  entryNames: '[name]-[hash]',
  outdir: outDir,
  platform: 'browser',
  format: 'esm',
  bundle: true,
  treeShaking: true,
  minify: true,
  sourcemap: true,
  metafile: true,
  jsx: 'automatic',
  jsxImportSource: '@firebolt-dev/jsx',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: {
    '.js': 'jsx',
  },
  alias: {
    react: 'react',
  },
  plugins: [
    polyfillNode({}),
    {
      name: 'static-finalize-plugin',
      setup(build) {
        build.onEnd(async result => {
          if (result.errors.length) return

          await fs.copy(clientPublicDir, outDir)
          await fs.copy(
            path.join(rootDir, 'src/core/physx-js-webidl.wasm'),
            path.join(outDir, 'physx-js-webidl.wasm')
          )
          if (await fs.pathExists(worldAssetsDir)) {
            await fs.copy(worldAssetsDir, path.join(outDir, 'assets'))
          }

          await fs.writeFile(path.join(outDir, 'env.js'), publicEnvCode(publicEnvs))

          const outputs = Object.keys(result.metafile.outputs)
          const jsPath = outputRelativePath(
            outputs.find(file => file.includes('/index-') && file.endsWith('.js')),
            'build/static'
          )
          const particlesPath = outputRelativePath(
            outputs.find(file => file.includes('/particles-') && file.endsWith('.js')),
            'build/static'
          )
          const buildId = Date.now()
          let html = await fs.readFile(htmlSrc, 'utf-8')
          html = html.replaceAll('{title}', process.env.STATIC_TITLE || 'Gamedev')
          html = html.replaceAll('{desc}', process.env.STATIC_DESCRIPTION || 'Interactive multiplayer world')
          html = html.replaceAll('{url}', process.env.STATIC_PUBLIC_URL || '')
          html = html.replaceAll('{image}', process.env.STATIC_IMAGE_URL || '')
          html = html.replaceAll('{jsPath}', jsPath)
          html = html.replaceAll('{particlesPath}', particlesPath)
          html = html.replaceAll('{buildId}', buildId)
          html = toRelativeClientHtml(html)
          await fs.writeFile(path.join(outDir, 'index.html'), html)
        })
      },
    },
  ],
})

await ctx.rebuild()
await ctx.dispose()

console.log('Static gamedev client build ready: build/static')
