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
