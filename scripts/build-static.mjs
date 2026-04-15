/**
 * build-static.mjs — Builds a self-contained static client for GitHub Pages / CDN.
 *
 * No server required. The client boots into offline mode automatically
 * because PUBLIC_WS_URL is absent from the baked env.js.
 *
 * Usage:
 *   bun run scripts/build-static.mjs
 *
 * Env vars (optional):
 *   PUBLIC_WS_URL    Bake in a default server, e.g. wss://your-world.example.com/ws
 *
 * Output: build/static/  (ready to deploy or serve with: bunx serve build/static)
 */
import fs from 'fs-extra'
import path from 'path'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')
const outDir = path.join(rootDir, 'build/static')
const clientPublicDir = path.join(rootDir, 'packages/client/public')
const htmlSrc = path.join(rootDir, 'packages/client/public/index.html')
const worldAssetsDir = path.join(rootDir, 'packages/server/world/assets')

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
  entryPoints: ['packages/client/index.js', 'packages/client/particles.js'],
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
            path.join(rootDir, 'packages/core/physx-js-webidl.wasm'),
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
          console.log(`  bunx serve build/static`)
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
*** Add File: /home/peezy/repos/github/lobby/worktrees/runtime/scripts/dev-app-server.mjs
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const projectDir = path.join(rootDir, 'project')
const projectEnvPath = path.join(projectDir, '.env')
const rootEnvPath = path.join(rootDir, '.env')
const exampleEnvPath = path.join(rootDir, '.env.example')
const cliPath = path.join(rootDir, 'packages/cli/gamedev.mjs')

await mkdir(projectDir, { recursive: true })

if (!existsSync(projectEnvPath)) {
  if (existsSync(rootEnvPath)) {
    await copyFile(rootEnvPath, projectEnvPath)
  } else if (existsSync(exampleEnvPath)) {
    await copyFile(exampleEnvPath, projectEnvPath)
  }
}

const child = spawn(process.execPath, [cliPath, 'app-server'], {
  cwd: projectDir,
  env: process.env,
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal)
    }
  })
}

await new Promise(resolve => {
  child.once('exit', (code, signal) => {
    process.exitCode = signal ? 1 : code ?? 0
    resolve()
  })
})
*** Add File: /home/peezy/repos/github/lobby/worktrees/runtime/scripts/dev.mjs
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const children = [
  {
    name: 'runtime',
    child: spawn(process.execPath, [path.join(rootDir, 'scripts/build.mjs'), '--dev'], {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    }),
  },
  {
    name: 'app-server',
    child: spawn(process.execPath, [path.join(rootDir, 'scripts/dev-app-server.mjs')], {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    }),
  },
]

let resolveDone = null
const done = new Promise(resolve => {
  resolveDone = resolve
})
let remaining = children.length
let shuttingDown = false
let finalExitCode = 0

function shutdown(code = 0, signal = 'SIGTERM') {
  if (shuttingDown) {
    finalExitCode ||= code
    return
  }
  shuttingDown = true
  finalExitCode = code
  for (const entry of children) {
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      entry.child.kill(signal)
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(0, signal))
}

for (const entry of children) {
  entry.child.once('exit', (code, signal) => {
    remaining -= 1
    if (!shuttingDown) {
      const exitCode = signal ? 1 : code ?? 0
      console.error(`[dev] ${entry.name} exited`)
      shutdown(exitCode)
    }
    if (remaining === 0) {
      resolveDone()
    }
  })
}

await done
process.exit(finalExitCode)
