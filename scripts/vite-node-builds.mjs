import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')
const vpBin = path.join(rootDir, 'node_modules/.bin/vp')

function packArgs(target, { dev = false, onSuccess = null } = {}) {
  const args = ['pack', '--filter', target]
  if (dev) {
    args.push('--watch', '--ignore-watch', 'build/**')
  }
  if (onSuccess) {
    args.push('--on-success', onSuccess)
  }
  return args
}

function spawnPack(target, options = {}) {
  const child = spawn(vpBin, packArgs(target, options), {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  })

  return {
    child,
    done: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => {
        if (code === 0 || code === null) {
          resolve()
          return
        }
        reject(new Error(`vp pack --filter ${target} exited with code ${code}`))
      })
    }),
  }
}

export async function buildServerPack({ dev = false } = {}) {
  const pack = spawnPack('server', {
    dev,
    onSuccess: dev ? 'node scripts/run-dev-server.mjs' : null,
  })
  await pack.done
}

export async function buildNodeClientPack({ dev = false } = {}) {
  const pack = spawnPack('node-client', {
    dev,
    onSuccess: dev ? 'node build/world-node-client.js' : null,
  })
  await pack.done
}

export async function buildRuntimePacks({ dev = false } = {}) {
  if (!dev) {
    await buildServerPack()
    await buildNodeClientPack()
    return
  }

  const packs = [
    spawnPack('server', {
      dev: true,
      onSuccess: 'node scripts/run-dev-server.mjs',
    }),
    spawnPack('node-client', {
      dev: true,
      onSuccess: 'node build/world-node-client.js',
    }),
  ]

  const stop = () => {
    for (const { child } of packs) {
      child.kill('SIGTERM')
    }
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  await Promise.race(packs.map(pack => pack.done))
  stop()
  await Promise.allSettled(packs.map(pack => pack.done))
}
