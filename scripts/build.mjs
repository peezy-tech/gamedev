import 'dotenv-flow/config'
import fs from 'fs-extra'
import path from 'path'
import { spawn as spawnChild } from 'node:child_process'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'

import { resolveRuntimeCommand } from './runtime-command.mjs'
import { workspaceAliasPlugin } from './workspace-alias-plugin.mjs'

const dev = process.argv.includes('--dev')
const clientOnly = process.argv.includes('--client-only')
const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')
const buildDir = path.join(rootDir, 'build')

function isLocalHost(hostname) {
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '::1') return true
  if (/^127\./.test(hostname)) return true
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

// await fs.emptyDir(buildDir)
await fs.emptyDir(path.join(buildDir, 'public'))

/**
 * Build Client
 */

const clientPublicDir = path.join(rootDir, 'packages/client/public')
const clientBuildDir = path.join(rootDir, 'build/public')
const clientHtmlSrc = path.join(rootDir, 'packages/client/public/index.html')
const clientHtmlDest = path.join(rootDir, 'build/public/index.html')
const adminHtmlSrc = path.join(rootDir, 'packages/client/public/admin.html')
const adminHtmlDest = path.join(rootDir, 'build/public/admin.html')

const resolveRelativeClientImportPath = value => {
  const normalized = (value || '').replace(/^\/+/, '')
  return `./${normalized}`
}

const resolveAbsoluteClientImportPath = value => {
  const normalized = (value || '').replace(/^\/+/, '')
  return `/${normalized}`
}

{
  const clientCtx = await esbuild.context({
    entryPoints: ['packages/client/index.js', 'packages/client/particles.js', 'packages/client/admin.js'],
    entryNames: '/[name]-[hash]',
    outdir: clientBuildDir,
    platform: 'browser',
    format: 'esm',
    bundle: true,
    treeShaking: true,
    minify: !dev,
    sourcemap: true,
    metafile: true,
    jsx: 'automatic',
    jsxImportSource: '@firebolt-dev/jsx',
    define: {
      'process.env.NODE_ENV': dev ? '"development"' : '"production"',
    },
    loader: {
      '.js': 'jsx',
    },
    alias: {
      react: 'react', // always use our own local react (jsx)
    },
    plugins: [
      polyfillNode({}),
      {
        name: 'client-finalize-plugin',
        setup(build) {
          build.onEnd(async result => {
            // copy over public files
            await fs.copy(clientPublicDir, clientBuildDir)
            // copy physx wasm to public
            const physxWasmSrc = path.join(rootDir, 'packages/core/physx-js-webidl.wasm')
            const physxWasmDest = path.join(rootDir, 'build/public/physx-js-webidl.wasm')
            await fs.copy(physxWasmSrc, physxWasmDest)
            // find js output files
            const metafile = result.metafile
            const outputFiles = Object.keys(metafile.outputs)
            const jsPath = outputFiles
              .find(file => file.includes('/index-') && file.endsWith('.js'))
              .split('build/public')[1]
            const particlesPath = outputFiles
              .find(file => file.includes('/particles-') && file.endsWith('.js'))
              .split('build/public')[1]
            const adminJsPath = outputFiles
              .find(file => file.includes('/admin-') && file.endsWith('.js'))
              .split('build/public')[1]
            // Universal output contract:
            // - stable aliases use relative imports for proxy-safe chunk loading
            // - HTML keeps absolute chunk paths for standalone route compatibility
            const aliasJsPath = resolveRelativeClientImportPath(jsPath)
            const aliasParticlesPath = resolveRelativeClientImportPath(particlesPath)
            const aliasAdminJsPath = resolveRelativeClientImportPath(adminJsPath)
            const htmlJsPath = resolveAbsoluteClientImportPath(jsPath)
            const htmlParticlesPath = resolveAbsoluteClientImportPath(particlesPath)
            const htmlAdminJsPath = resolveAbsoluteClientImportPath(adminJsPath)
            // write stable aliases to avoid hardcoding hashes in other services
            await fs.writeFile(path.join(clientBuildDir, 'index.js'), `import '${aliasJsPath}';\n`)
            await fs.writeFile(path.join(clientBuildDir, 'particles.js'), `import '${aliasParticlesPath}';\n`)
            await fs.writeFile(path.join(clientBuildDir, 'admin.js'), `import '${aliasAdminJsPath}';\n`)
            // inject into html and copy over
            let htmlContent = await fs.readFile(clientHtmlSrc, 'utf-8')
            htmlContent = htmlContent.replaceAll('{assetPrefix}', '/')
            htmlContent = htmlContent.replace('{jsPath}', htmlJsPath)
            htmlContent = htmlContent.replace('{particlesPath}', htmlParticlesPath)
            htmlContent = htmlContent.replaceAll('{buildId}', Date.now())
            await fs.writeFile(clientHtmlDest, htmlContent)
            if (await fs.pathExists(adminHtmlSrc)) {
              let adminHtml = await fs.readFile(adminHtmlSrc, 'utf-8')
              adminHtml = adminHtml.replaceAll('{assetPrefix}', '/')
              adminHtml = adminHtml.replace('{jsPath}', htmlAdminJsPath)
              adminHtml = adminHtml.replace('{particlesPath}', htmlParticlesPath)
              adminHtml = adminHtml.replaceAll('{buildId}', Date.now())
              await fs.writeFile(adminHtmlDest, adminHtml)
            }
          })
        },
      },
    ],
  })
  if (dev) {
    await clientCtx.watch()
  } else {
    await clientCtx.rebuild()
  }
  const buildResult = await clientCtx.rebuild()
  fs.writeFileSync(path.join(buildDir, 'meta.json'), JSON.stringify(buildResult.metafile, null, 2))
  if (!dev) {
    await clientCtx.dispose()
  }
  if (!dev && clientOnly) {
    process.exit(0)
  }
}

/**
 * Build Server
 */

let runtimeChild

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
    packages: 'external',
    define: {
      'process.env.CLIENT': 'false',
      'process.env.SERVER': 'true',
    },
    plugins: [
      workspaceAliasPlugin(rootDir),
      {
        name: 'server-finalize-plugin',
        setup(build) {
          build.onEnd(async result => {
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
              runtimeChild?.kill('SIGTERM')
              const childEnv = { ...process.env }
              const localDevWorldDir = resolveLocalDevWorldDir(childEnv)
              if (localDevWorldDir) {
                childEnv.WORLD = localDevWorldDir
              }
              const runtimeCommand = resolveRuntimeCommand(childEnv)
              runtimeChild = spawnChild(runtimeCommand, [path.join(rootDir, 'build/index.js')], {
                cwd: rootDir,
                env: childEnv,
                stdio: 'inherit',
              })
            } else {
              process.exit(0)
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
    packages: 'external',
    plugins: [workspaceAliasPlugin(rootDir)],
    loader: {},
  })
  if (dev) {
    await nodeClientCtx.watch()
  } else {
    await nodeClientCtx.rebuild()
  }
}
