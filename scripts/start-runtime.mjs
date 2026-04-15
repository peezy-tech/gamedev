import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { resolveRuntimeCommand } from './runtime-command.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const entryPath = path.join(rootDir, 'build', 'index.js')
const command = resolveRuntimeCommand(process.env)

const child = spawn(command, [entryPath], {
  cwd: rootDir,
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
