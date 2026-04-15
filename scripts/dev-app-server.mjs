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
