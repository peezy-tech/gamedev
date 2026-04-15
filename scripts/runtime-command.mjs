import { spawnSync } from 'node:child_process'

let cachedNodeCommand = null

function usesPostgres(env = process.env) {
  const dbUri = String(env.DB_URI || '').trim()
  return dbUri.startsWith('postgres://') || dbUri.startsWith('postgresql://')
}

export function requiresNodeRuntime(env = process.env) {
  return Boolean(process.versions?.bun) && !usesPostgres(env)
}

export function resolveRuntimeCommand(env = process.env) {
  if (!requiresNodeRuntime(env)) {
    return process.execPath
  }
  if (cachedNodeCommand) {
    return cachedNodeCommand
  }

  const probe = spawnSync('node', ['--version'], { stdio: 'ignore' })
  if (probe.status === 0) {
    cachedNodeCommand = 'node'
    return cachedNodeCommand
  }

  throw new Error(
    'Local SQLite runtime requires Node.js 22+ because better-sqlite3 does not run under Bun yet. Install Node.js or set DB_URI to PostgreSQL.'
  )
}
