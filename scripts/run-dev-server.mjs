import 'dotenv-flow/config'

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, '../')

function isLocalHost(hostname) {
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '::1') return true
  if (hostname.startsWith('127.')) return true
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
}

function resolveLocalDevWorldDir(env = process.env) {
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

const localDevWorldDir = resolveLocalDevWorldDir()
if (localDevWorldDir) {
  process.env.WORLD = localDevWorldDir
}

await import(pathToFileURL(path.join(rootDir, 'build/index.js')).href)
