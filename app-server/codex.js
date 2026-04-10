import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

import { streamText } from 'ai'

import { isValidScriptPath } from '../src/core/blueprintValidation.js'
import { normalizeWorldAdminBaseUrl, normalizeProjectRelativePath } from './helpers.js'
import { writeProjectAuthEntry } from './projectAuth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

const DEFAULT_HOST = process.env.CODEX_HOST || '127.0.0.1'
const DEFAULT_PORT = Number.parseInt(process.env.CODEX_PORT || process.env.PORT || '4625', 10) || 4625
const DEFAULT_MODEL = process.env.CODEX_MODEL || 'gpt-5.3-codex'
const DEFAULT_BASE_PATH = '/api/script-ai'
const PREVIEW_WORKSPACE_PREFIX = 'gamedev-codex-preview-'

let codexProviderModulePromise = null

function createError(code, message = code, extra = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, extra)
  return error
}

function normalizeString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeMode(value) {
  return value === 'fix' ? 'fix' : 'edit'
}

function normalizeWorldUrl(value) {
  const normalized = normalizeString(value)
  if (!normalized) return null
  return normalizeWorldAdminBaseUrl(normalized)
}

function normalizePort(value, fallback = DEFAULT_PORT) {
  const port = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(port) && port > 0 ? port : fallback
}

function parseDotEnv(content) {
  const env = {}
  if (!content) return env
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed
    const idx = normalized.indexOf('=')
    if (idx === -1) continue
    const key = normalized.slice(0, idx).trim()
    let value = normalized.slice(idx + 1).trim()
    if (!key) continue
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return null
  return parseDotEnv(fs.readFileSync(filePath, 'utf8'))
}

function resolveProjectEnv(rootDir) {
  const fileEnv = readDotEnv(path.join(rootDir, '.env')) || {}
  return {
    ...fileEnv,
    WORLD_URL: normalizeWorldUrl(process.env.WORLD_URL) || normalizeWorldUrl(fileEnv.WORLD_URL),
    WORLD_ID: normalizeString(process.env.WORLD_ID) || normalizeString(fileEnv.WORLD_ID),
  }
}

function resolveProjectStatus(rootDir, model) {
  const env = resolveProjectEnv(rootDir)
  const worldUrl = normalizeWorldUrl(env.WORLD_URL)
  const worldId = normalizeString(env.WORLD_ID)
  const configReady = !!worldUrl && !!worldId
  return {
    ok: true,
    service: 'gamedev-codex',
    projectDir: rootDir,
    packageRoot,
    worldUrl,
    worldId,
    model,
    ready: configReady,
    message: configReady
      ? 'Local Codex is ready.'
      : 'Configure WORLD_URL and WORLD_ID in this project before using local Codex.',
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 2 * 1024 * 1024) {
        reject(createError('payload_too_large', 'Request body is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(createError('invalid_json', 'Request body must be valid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(body)
}

function sendOptions(res) {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  })
  res.end()
}

function beginNdjson(res) {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
}

function writeNdjson(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`)
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function copyFileSync(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath))
  fs.copyFileSync(sourcePath, targetPath)
}

function copyDirectorySync(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return
  ensureDir(targetDir)
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyDirectorySync(sourcePath, targetPath)
      continue
    }
    if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath)
    }
  }
}

function removePath(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true })
  } catch {}
}

function walkScriptFiles(dirPath, baseDir = dirPath, output = new Map()) {
  if (!fs.existsSync(dirPath)) return output
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      walkScriptFiles(fullPath, baseDir, output)
      continue
    }
    if (!entry.isFile()) continue
    const relPath = path.relative(baseDir, fullPath).split(path.sep).join('/')
    if (!isValidScriptPath(relPath)) continue
    output.set(relPath, fs.readFileSync(fullPath, 'utf8'))
  }
  return output
}

function diffFileMaps(before, after) {
  const changed = []
  for (const [filePath, content] of after.entries()) {
    if (before.get(filePath) === content) continue
    changed.push({ path: filePath, content })
  }
  changed.sort((a, b) => a.path.localeCompare(b.path))
  return changed
}

function parseHistory(input) {
  if (!Array.isArray(input)) return []
  const history = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null
    const content = normalizeString(item.content)
    if (!role || !content) continue
    history.push({ role, content })
  }
  return history.slice(-12)
}

function parseAttachments(input) {
  if (!Array.isArray(input)) return []
  const output = []
  const seen = new Set()
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const type = item.type === 'doc' || item.type === 'script' ? item.type : null
    const filePath = normalizeString(item.path)
    if (!type || !filePath) continue
    const key = `${type}:${filePath}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({ type, path: filePath })
  }
  return output
}

function validatePreviewRequest(input = {}) {
  const appName = normalizeString(input.appName)
  const entryPath = normalizeProjectRelativePath(input.entryPath || '')
  const requestId = normalizeString(input.requestId) || `${Date.now()}`
  const mode = normalizeMode(input.mode)
  const prompt = normalizeString(input.prompt)
  const scriptRootId = normalizeString(input.scriptRootId)
  const targetBlueprintId = normalizeString(input.targetBlueprintId)
  const currentWorldUrl = normalizeWorldUrl(input.currentWorldUrl)
  const authToken = normalizeString(input.authToken)
  const scriptFormat = input.scriptFormat === 'legacy-body' ? 'legacy-body' : 'module'
  const history = parseHistory(input.history)
  const attachments = parseAttachments(input.attachments)
  const error = input.error ?? null

  if (!appName) {
    throw createError('app_name_missing', 'Missing target app name.')
  }
  if (!entryPath || !isValidScriptPath(entryPath)) {
    throw createError('entry_path_invalid', 'Missing or invalid script entry path.')
  }
  if (mode === 'edit' && !prompt) {
    throw createError('prompt_missing', 'Missing AI edit prompt.')
  }
  if (mode === 'fix' && !error) {
    throw createError('error_missing', 'Missing script error payload.')
  }

  return {
    requestId,
    appName,
    entryPath,
    mode,
    prompt,
    error,
    scriptRootId,
    targetBlueprintId,
    currentWorldUrl,
    authToken,
    scriptFormat,
    history,
    attachments,
  }
}

function validateApplyRequest(input = {}) {
  const appName = normalizeString(input.appName)
  const requestId = normalizeString(input.requestId) || `${Date.now()}`
  const scriptRootId = normalizeString(input.scriptRootId)
  const targetBlueprintId = normalizeString(input.targetBlueprintId)
  const currentWorldUrl = normalizeWorldUrl(input.currentWorldUrl)
  const authToken = normalizeString(input.authToken)
  const summary = normalizeString(input.summary) || ''
  const files = Array.isArray(input.files) ? input.files : []

  if (!appName) {
    throw createError('app_name_missing', 'Missing target app name.')
  }

  const normalizedFiles = []
  for (const entry of files) {
    if (!entry || typeof entry !== 'object') continue
    const filePath = normalizeProjectRelativePath(entry.path || entry.file || '')
    const content = typeof entry.content === 'string' ? entry.content : null
    if (!filePath || !isValidScriptPath(filePath) || typeof content !== 'string') continue
    normalizedFiles.push({ path: filePath, content })
  }

  if (!normalizedFiles.length) {
    throw createError('files_missing', 'No script changes were supplied.')
  }

  return {
    requestId,
    appName,
    scriptRootId,
    targetBlueprintId,
    currentWorldUrl,
    authToken,
    summary,
    files: normalizedFiles,
  }
}

function ensureTargetWorldMatches(projectStatus, currentWorldUrl) {
  const projectWorldUrl = normalizeWorldUrl(projectStatus?.worldUrl)
  if (!projectWorldUrl || !currentWorldUrl) return
  if (projectWorldUrl !== currentWorldUrl) {
    throw createError(
      'world_mismatch',
      `This local project targets ${projectWorldUrl}, but the current world is ${currentWorldUrl}. Restart local Codex from the matching project or target.`,
      {
        projectWorldUrl,
        currentWorldUrl,
      }
    )
  }
}

function resolveDocsRoot(rootDir) {
  const candidates = [
    path.join(rootDir, 'docs'),
    path.join(rootDir, 'build', 'docs'),
    path.join(rootDir, 'public', 'docs'),
    path.join(packageRoot, 'docs'),
  ]
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      if (fs.statSync(candidate).isDirectory()) return candidate
    } catch {}
  }
  return null
}

function resolveAttachedDocSource(rootDir, docPath) {
  if (docPath.includes('..')) return null
  const normalized = docPath.replace(/\\/g, '/')
  if (!normalized.startsWith('docs/')) return null
  const relPath = normalized.slice('docs/'.length)
  if (!relPath) return null
  const docsRoot = resolveDocsRoot(rootDir)
  if (!docsRoot) return null
  const fullPath = path.resolve(docsRoot, relPath)
  const base = docsRoot.endsWith(path.sep) ? docsRoot : `${docsRoot}${path.sep}`
  if (!fullPath.startsWith(base)) return null
  return fullPath
}

function buildPreviewWorkspace(rootDir, appName, attachments = []) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), PREVIEW_WORKSPACE_PREFIX))
  const appSourceDir = path.join(rootDir, 'apps', appName)
  const appTargetDir = path.join(tempRoot, 'apps', appName)

  if (!fs.existsSync(appSourceDir) || !fs.statSync(appSourceDir).isDirectory()) {
    removePath(tempRoot)
    throw createError('app_missing', `Local app "${appName}" was not found under apps/${appName}.`)
  }

  copyDirectorySync(appSourceDir, appTargetDir)

  const sharedSourceDir = path.join(rootDir, 'shared')
  if (fs.existsSync(sharedSourceDir) && fs.statSync(sharedSourceDir).isDirectory()) {
    copyDirectorySync(sharedSourceDir, path.join(tempRoot, 'shared'))
  }

  const worldSourcePath = path.join(rootDir, 'world.json')
  if (fs.existsSync(worldSourcePath) && fs.statSync(worldSourcePath).isFile()) {
    copyFileSync(worldSourcePath, path.join(tempRoot, 'world.json'))
  }

  for (const attachment of attachments) {
    if (attachment.type !== 'doc') continue
    const sourcePath = resolveAttachedDocSource(rootDir, attachment.path)
    if (!sourcePath || !fs.existsSync(sourcePath)) continue
    copyFileSync(sourcePath, path.join(tempRoot, attachment.path))
  }

  return {
    rootDir: tempRoot,
    appDir: appTargetDir,
  }
}

function buildPreviewDeveloperInstructions({
  appName,
  entryPath,
  scriptFormat,
  attachments = [],
} = {}) {
  const lines = [
    'You are preparing a script-edit proposal for a gamedev world project.',
    `Only modify files under apps/${appName}/ in this temporary preview workspace.`,
    'Do not modify shared/, world.json, docs/, package files, or environment files.',
    'Do not deploy, import, authenticate, or run gamedev sync commands from the model.',
    'The integration will apply accepted changes to the real project and run gamedev apps deploy.',
    'Keep edits minimal and focused on the current request.',
    scriptFormat === 'legacy-body'
      ? `The entry file apps/${appName}/${entryPath} uses legacy-body format. Do not add exports.`
      : `The entry file apps/${appName}/${entryPath} is an ES module and should keep its default export.`,
  ]

  if (attachments.length) {
    lines.push('Attached references available in this preview workspace:')
    for (const attachment of attachments) {
      if (attachment.type === 'doc') {
        lines.push(`- ${attachment.path}`)
      } else if (attachment.type === 'script') {
        lines.push(`- apps/${appName}/${attachment.path}`)
      }
    }
  }

  return lines.join('\n')
}

function buildPreviewMessages({
  history = [],
  mode = 'edit',
  prompt,
  error,
  appName,
  entryPath,
  attachments = [],
} = {}) {
  const messages = history.map(item => ({
    role: item.role,
    content: item.content,
  }))

  const content = []
  if (mode === 'fix') {
    content.push('Fix the current runtime/script issue for this app.')
  } else {
    content.push(prompt)
  }
  content.push(`Target app: ${appName}`)
  content.push(`Entry path: apps/${appName}/${entryPath}`)
  if (mode === 'fix') {
    content.push(`Runtime error:\n${JSON.stringify(error, null, 2)}`)
  }
  if (attachments.length) {
    content.push(
      `Relevant attachments:\n${attachments
        .map(attachment =>
          attachment.type === 'doc' ? `- ${attachment.path}` : `- apps/${appName}/${attachment.path}`
        )
        .join('\n')}`
    )
  }
  content.push('Edit files in the preview workspace and then summarize the proposed change briefly.')

  messages.push({
    role: 'user',
    content: content.join('\n\n'),
  })
  return messages
}

function summarizeText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return fallback
  const line = text.split(/\r?\n/).find(Boolean) || text
  return line.length > 180 ? `${line.slice(0, 177)}...` : line
}

function summarizeToolValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return summarizeText(value, '')
  try {
    return summarizeText(JSON.stringify(value), '')
  } catch {
    return summarizeText(String(value), '')
  }
}

async function loadCodexProviderModule() {
  if (codexProviderModulePromise) return codexProviderModulePromise

  const candidates = [
    'ai-sdk-provider-codex-cli',
    pathToFileURL(path.resolve(packageRoot, '..', 'ai-sdk-provider-codex-cli', 'dist', 'index.js')).href,
  ]

  codexProviderModulePromise = (async () => {
    let lastError = null
    for (const candidate of candidates) {
      try {
        return await import(candidate)
      } catch (err) {
        lastError = err
      }
    }
    throw createError(
      'codex_provider_missing',
      'Failed to load ai-sdk-provider-codex-cli. Install it alongside gamedev or run from the SDK repository.',
      { cause: lastError }
    )
  })()

  return codexProviderModulePromise
}

function writeProjectFiles(rootDir, appName, files) {
  const appDir = path.join(rootDir, 'apps', appName)
  if (!fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
    throw createError('app_missing', `Local app "${appName}" was not found under apps/${appName}.`)
  }
  for (const file of files) {
    const relPath = normalizeProjectRelativePath(file.path)
    if (!relPath || !isValidScriptPath(relPath)) {
      throw createError('file_path_invalid', `Invalid script path: ${file.path}`)
    }
    const targetPath = path.join(appDir, relPath)
    ensureDir(path.dirname(targetPath))
    fs.writeFileSync(targetPath, file.content, 'utf8')
  }
}

function runGamedevCli(rootDir, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(packageRoot, 'bin', 'gamedev.mjs'), ...args], {
      cwd: rootDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', code => {
      resolve({
        code: Number.isFinite(code) ? code : 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
  })
}

async function maybeBootstrapProjectAuth(rootDir, projectStatus, authToken) {
  if (!authToken || !projectStatus?.worldUrl || !projectStatus?.worldId) return
  writeProjectAuthEntry(rootDir, {
    worldUrl: projectStatus.worldUrl,
    worldId: projectStatus.worldId,
    authToken,
  })
}

async function handlePreviewRequest({
  res,
  input,
  rootDir,
  projectStatus,
  provider,
  modelId,
  codexPath,
} = {}) {
  const workspace = buildPreviewWorkspace(rootDir, input.appName, input.attachments)
  const sourceLabel = `codex:${modelId}`

  beginNdjson(res)
  writeNdjson(res, {
    kind: 'event',
    payload: {
      requestId: input.requestId,
      scriptRootId: input.scriptRootId,
      targetBlueprintId: input.targetBlueprintId,
      type: 'session_start',
      mode: input.mode,
    },
  })
  writeNdjson(res, {
    kind: 'event',
    payload: {
      requestId: input.requestId,
      scriptRootId: input.scriptRootId,
      targetBlueprintId: input.targetBlueprintId,
      type: 'phase',
      phase: 'collecting_context',
    },
  })

  try {
    const beforeFiles = walkScriptFiles(workspace.appDir)
    const model = provider(modelId, {
      codexPath: codexPath || undefined,
      cwd: workspace.rootDir,
      threadMode: 'stateless',
      approvalPolicy: 'never',
      autoApprove: true,
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [workspace.rootDir],
        networkAccess: false,
      },
      developerInstructions: buildPreviewDeveloperInstructions(input),
    })

    writeNdjson(res, {
      kind: 'event',
      payload: {
        requestId: input.requestId,
        scriptRootId: input.scriptRootId,
        targetBlueprintId: input.targetBlueprintId,
        type: 'phase',
        phase: 'thinking',
      },
    })

    const result = await streamText({
      model,
      messages: buildPreviewMessages(input),
    })

    let assistantText = ''

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        const text = typeof part.text === 'string' ? part.text : typeof part.textDelta === 'string' ? part.textDelta : ''
        if (!text) continue
        assistantText += text
        writeNdjson(res, {
          kind: 'event',
          payload: {
            requestId: input.requestId,
            scriptRootId: input.scriptRootId,
            targetBlueprintId: input.targetBlueprintId,
            type: 'assistant_delta',
            text,
          },
        })
        continue
      }

      if (part.type === 'tool-call') {
        writeNdjson(res, {
          kind: 'event',
          payload: {
            requestId: input.requestId,
            scriptRootId: input.scriptRootId,
            targetBlueprintId: input.targetBlueprintId,
            type: 'tool-call',
            toolName: part.toolName || '',
            toolCallId: part.toolCallId || '',
          },
        })
        continue
      }

      if (part.type === 'tool-result') {
        const value =
          Object.prototype.hasOwnProperty.call(part, 'result')
            ? part.result
            : Object.prototype.hasOwnProperty.call(part, 'output')
              ? part.output
              : null
        writeNdjson(res, {
          kind: 'event',
          payload: {
            requestId: input.requestId,
            scriptRootId: input.scriptRootId,
            targetBlueprintId: input.targetBlueprintId,
            type: 'tool-result',
            toolCallId: part.toolCallId || '',
            detail: summarizeToolValue(value),
          },
        })
      }
    }

    writeNdjson(res, {
      kind: 'event',
      payload: {
        requestId: input.requestId,
        scriptRootId: input.scriptRootId,
        targetBlueprintId: input.targetBlueprintId,
        type: 'phase',
        phase: 'generating_patch',
      },
    })

    const afterFiles = walkScriptFiles(workspace.appDir)
    const changedFiles = diffFileMaps(beforeFiles, afterFiles)
    const summary = summarizeText(
      assistantText,
      changedFiles.length
        ? `Prepared ${changedFiles.length} file change${changedFiles.length === 1 ? '' : 's'}.`
        : 'Codex returned no script changes.'
    )

    if (!changedFiles.length) {
      writeNdjson(res, {
        kind: 'response',
        payload: {
          requestId: input.requestId,
          scriptRootId: input.scriptRootId,
          targetBlueprintId: input.targetBlueprintId,
          applied: false,
          fileCount: 0,
          source: sourceLabel,
          message: summary,
        },
      })
      res.end()
      return
    }

    writeNdjson(res, {
      kind: 'event',
      payload: {
        requestId: input.requestId,
        scriptRootId: input.scriptRootId,
        targetBlueprintId: input.targetBlueprintId,
        type: 'patch_preview',
        summary,
        files: changedFiles.map(file => file.path),
      },
    })

    writeNdjson(res, {
      kind: 'proposal',
      payload: {
        id: input.requestId,
        requestId: input.requestId,
        scriptRootId: input.scriptRootId,
        targetBlueprintId: input.targetBlueprintId,
        summary,
        source: sourceLabel,
        files: changedFiles,
        fileCount: changedFiles.length,
        applied: false,
        message: 'AI changes ready to review.',
      },
    })
    res.end()
  } catch (err) {
    const message = err?.message || 'Local Codex request failed.'
    writeNdjson(res, {
      kind: 'event',
      payload: {
        requestId: input.requestId,
        scriptRootId: input.scriptRootId,
        targetBlueprintId: input.targetBlueprintId,
        type: 'error',
        message,
      },
    })
    writeNdjson(res, {
      kind: 'response',
      payload: {
        requestId: input.requestId,
        scriptRootId: input.scriptRootId,
        targetBlueprintId: input.targetBlueprintId,
        error: err?.code || 'local_codex_failed',
        message,
        applied: false,
        fileCount: 0,
        source: sourceLabel,
      },
    })
    res.end()
  } finally {
    removePath(workspace.rootDir)
  }
}

async function handleApplyRequest({
  input,
  rootDir,
  projectStatus,
} = {}) {
  writeProjectFiles(rootDir, input.appName, input.files)
  const deploy = await runGamedevCli(rootDir, ['apps', 'deploy', input.appName, '--yes'])
  if (deploy.code !== 0) {
    throw createError(
      'deploy_failed',
      summarizeText(deploy.stderr || deploy.stdout, `Failed to deploy ${input.appName}.`),
      deploy
    )
  }

  return {
    ok: true,
    requestId: input.requestId,
    scriptRootId: input.scriptRootId,
    targetBlueprintId: input.targetBlueprintId,
    source: `codex:${projectStatus.model}`,
    fileCount: input.files.length,
    applied: true,
    message: `Applied ${input.files.length} file change${input.files.length === 1 ? '' : 's'} and deployed ${input.appName}.`,
  }
}

export async function startCodexScriptAiServer({
  rootDir = process.cwd(),
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  model = DEFAULT_MODEL,
  codexPath = null,
  basePath = DEFAULT_BASE_PATH,
  log = console,
} = {}) {
  const normalizedRootDir = path.resolve(rootDir)
  const { createCodexAppServer } = await loadCodexProviderModule()
  const provider = createCodexAppServer({
    defaultSettings: {
      minCodexVersion: '0.105.0',
      idleTimeoutMs: 5 * 60 * 1000,
      personality: 'pragmatic',
    },
  })

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        sendOptions(res)
        return
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
      const statusPath = `${basePath}/status`
      const previewPath = `${basePath}/preview`
      const applyPath = `${basePath}/apply`
      const healthPath = '/health'

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === healthPath)) {
        sendJson(res, 200, resolveProjectStatus(normalizedRootDir, model))
        return
      }

      if (req.method === 'GET' && url.pathname === statusPath) {
        sendJson(res, 200, resolveProjectStatus(normalizedRootDir, model))
        return
      }

      if (req.method === 'POST' && url.pathname === previewPath) {
        const input = validatePreviewRequest(await readJsonBody(req))
        const projectStatus = resolveProjectStatus(normalizedRootDir, model)
        ensureTargetWorldMatches(projectStatus, input.currentWorldUrl)
        await maybeBootstrapProjectAuth(normalizedRootDir, projectStatus, input.authToken)
        await handlePreviewRequest({
          res,
          input,
          rootDir: normalizedRootDir,
          projectStatus,
          provider,
          modelId: model,
          codexPath,
        })
        return
      }

      if (req.method === 'POST' && url.pathname === applyPath) {
        const input = validateApplyRequest(await readJsonBody(req))
        const projectStatus = resolveProjectStatus(normalizedRootDir, model)
        ensureTargetWorldMatches(projectStatus, input.currentWorldUrl)
        await maybeBootstrapProjectAuth(normalizedRootDir, projectStatus, input.authToken)
        const payload = await handleApplyRequest({
          input,
          rootDir: normalizedRootDir,
          projectStatus,
        })
        sendJson(res, 200, payload)
        return
      }

      sendJson(res, 404, {
        ok: false,
        error: 'not_found',
        message: 'Route not found.',
      })
    } catch (err) {
      const statusCode = err?.code === 'not_found' ? 404 : 400
      sendJson(res, statusCode, {
        ok: false,
        error: err?.code || 'request_failed',
        message: err?.message || 'Request failed.',
      })
    }
  })

  const shutdown = async () => {
    try {
      server.close()
    } catch {}
    await provider.close().catch(() => {})
  }

  server.on('close', () => {
    void provider.close().catch(() => {})
  })

  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(normalizePort(port), host, () => resolve())
  })

  log.log?.(
    `Local Codex ready at http://${host}:${normalizePort(port)}${basePath}/status\n` +
      `Project: ${normalizedRootDir}\n` +
      `Model: ${model}`
  )

  return server
}
