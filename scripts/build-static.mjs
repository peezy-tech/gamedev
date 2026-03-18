/**
 * build-static.mjs — Builds a self-contained static client for GitHub Pages / CDN.
 *
 * No server required. The client boots into offline mode automatically
 * because PUBLIC_WS_URL is absent from the baked env.js.
 *
 * Usage:
 *   node scripts/build-static.mjs
 *
 * Env vars (optional):
 *   PUBLIC_WS_URL    Bake in a default server, e.g. wss://your-world.example.com/ws
 *
 * Output: build/static/  (ready to deploy or serve with: npx serve build/static)
 */
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

// Public env vars baked into the static build.
// No PUBLIC_WS_URL → client boots into offline mode by default.
// Users can still connect via ?connect=wss://... links.
const publicEnvs = {
  PUBLIC_ALLOW_WS_OVERRIDE: 'true',
  PUBLIC_MAX_UPLOAD_SIZE: '0',
  ...(process.env.PUBLIC_WS_URL && { PUBLIC_WS_URL: process.env.PUBLIC_WS_URL }),
}

await fs.emptyDir(outDir)

const ctx = await esbuild.context({
  entryPoints: ['src/client/index.js', 'src/client/particles.js'],
  entryNames: '/[name]-[hash]',
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
          // copy public assets (css, icons, fonts, wasm, etc.)
          await fs.copy(clientPublicDir, outDir)

          // copy physx wasm
          await fs.copy(
            path.join(rootDir, 'src/core/physx-js-webidl.wasm'),
            path.join(outDir, 'physx-js-webidl.wasm')
          )

          // copy world assets (avatar, emotes, animations) so asset:// resolves offline
          if (await fs.pathExists(worldAssetsDir)) {
            await fs.copy(worldAssetsDir, path.join(outDir, 'assets'))
          }

          // write static env.js (replaces the dynamic Fastify /env.js route)
          await fs.writeFile(
            path.join(outDir, 'env.js'),
            `globalThis.env = ${JSON.stringify(publicEnvs)}`
          )

          // find hashed output filenames
          const outputs = Object.keys(result.metafile.outputs)
          const rel = f => f.split('build/static')[1].replace(/^\//, '')
          const jsPath = rel(outputs.find(f => f.includes('/index-') && f.endsWith('.js')))
          const particlesPath = rel(outputs.find(f => f.includes('/particles-') && f.endsWith('.js')))

          // fill HTML template placeholders
          const buildId = Date.now()
          let html = await fs.readFile(htmlSrc, 'utf-8')
          html = html.replaceAll('{assetPrefix}', '')
          html = html.replace('{jsPath}', jsPath)
          html = html.replace('{particlesPath}', particlesPath)
          html = html.replaceAll('{buildId}', buildId)
          html = html.replaceAll('{title}', 'Hyperfy')
          html = html.replaceAll('{desc}', 'Interactive 3D world')
          html = html.replaceAll('{url}', '')
          html = html.replaceAll('{image}', '')
          await fs.writeFile(path.join(outDir, 'index.html'), html)

          // GitHub Pages SPA fallback
          await fs.copy(path.join(outDir, 'index.html'), path.join(outDir, '404.html'))

          // prevent GitHub Pages from ignoring underscore-prefixed files
          await fs.writeFile(path.join(outDir, '.nojekyll'), '')

          console.log(`\nStatic build ready → build/static/`)
          console.log(`\nTest locally:`)
          console.log(`  npx serve build/static`)
          if (publicEnvs.PUBLIC_WS_URL) {
            console.log(`\nDefault server: ${publicEnvs.PUBLIC_WS_URL}`)
          } else {
            console.log(`\nNo default server — boots offline. Share ?connect=wss://... links to connect.`)
          }
        })
      },
    },
  ],
})

await ctx.rebuild()
await ctx.dispose()
