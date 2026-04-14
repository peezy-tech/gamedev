import * as THREE from './three'

const DEFAULT_CONTEXT_ATTRIBUTES = {
  alpha: false,
  depth: true,
  stencil: false,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'default',
  failIfMajorPerformanceCaveat: false,
}

const RENDERER_ATTEMPT_OVERRIDES = [
  { label: 'preferred', overrides: {} },
  { label: 'default-power', overrides: { powerPreference: 'default' } },
  { label: 'no-antialias', overrides: { powerPreference: 'default', antialias: false } },
  {
    label: 'no-antialias-unpremultiplied',
    overrides: { powerPreference: 'default', antialias: false, premultipliedAlpha: false },
  },
]

export function createWebGLRenderer(parameters = {}) {
  if (parameters.context) {
    return new THREE.WebGLRenderer(parameters)
  }

  const attempts = buildRendererAttempts(parameters)
  const diagnostics = []
  let lastError = null

  for (const attempt of attempts) {
    const probe = createContextProbe(attempt.contextAttributes)
    diagnostics.push({
      label: attempt.label,
      contextAttributes: attempt.contextAttributes,
      creationError: probe.creationError,
      ok: !!probe.context,
    })
    if (!probe.context) continue
    try {
      return new THREE.WebGLRenderer({
        ...attempt.rendererParameters,
        canvas: probe.canvas,
        context: probe.context,
      })
    } catch (error) {
      lastError = error
      diagnostics[diagnostics.length - 1].rendererError = error?.message || String(error)
      loseContext(probe.context)
    }
  }

  const support = probeWebGLSupport()
  const error = new Error(lastError?.message || 'Unable to create a WebGL2 renderer.')
  error.name = 'WebGLUnavailableError'
  error.code = 'webgl_unavailable'
  error.userMessage = buildWebGLUnavailableMessage(support)
  error.diagnostics = {
    attempts: diagnostics,
    support,
    userAgent: globalThis?.navigator?.userAgent || null,
  }
  console.error('[graphics] Failed to create WebGL2 renderer.', error.diagnostics)
  throw error
}

function buildRendererAttempts(parameters) {
  const attempts = []
  const seen = new Set()
  for (const attempt of RENDERER_ATTEMPT_OVERRIDES) {
    const rendererParameters = { ...parameters, ...attempt.overrides }
    const contextAttributes = pickContextAttributes(rendererParameters)
    const key = JSON.stringify(contextAttributes)
    if (seen.has(key)) continue
    seen.add(key)
    attempts.push({
      label: attempt.label,
      rendererParameters,
      contextAttributes,
    })
  }
  return attempts
}

function pickContextAttributes(parameters) {
  const contextAttributes = { ...DEFAULT_CONTEXT_ATTRIBUTES }
  for (const key of Object.keys(DEFAULT_CONTEXT_ATTRIBUTES)) {
    if (parameters[key] !== undefined) {
      contextAttributes[key] = parameters[key]
    }
  }
  return contextAttributes
}

function createContextProbe(contextAttributes, contextName = 'webgl2') {
  const canvas = document.createElement('canvas')
  let creationError = null
  const onContextCreationError = event => {
    creationError = event?.statusMessage || event?.message || 'Unknown WebGL context creation error.'
  }
  canvas.addEventListener('webglcontextcreationerror', onContextCreationError)
  let context = null
  try {
    context = canvas.getContext(contextName, contextAttributes)
  } catch (error) {
    creationError = error?.message || String(error)
  }
  canvas.removeEventListener('webglcontextcreationerror', onContextCreationError)
  return {
    canvas,
    context,
    creationError,
  }
}

function probeWebGLSupport() {
  const webgl2 = createContextProbe(undefined, 'webgl2')
  const webgl1 = createContextProbe(undefined, 'webgl')
  const support = {
    webgl2: !!webgl2.context,
    webgl2CreationError: webgl2.creationError,
    webgl1: !!webgl1.context,
    webgl1CreationError: webgl1.creationError,
  }
  loseContext(webgl2.context)
  loseContext(webgl1.context)
  return support
}

function buildWebGLUnavailableMessage(support) {
  if (support.webgl2) {
    return 'This browser could not start the 3D renderer with a compatible WebGL 2 configuration. Reload the page or try a standard browser window.'
  }
  if (support.webgl1) {
    return 'This browser context only exposes WebGL 1, but this world requires WebGL 2. Enable hardware acceleration or try Safari or a standard Chrome window.'
  }
  return 'This browser context could not start WebGL 2. Enable hardware acceleration or try Safari or a standard Chrome window.'
}

function loseContext(context) {
  context?.getExtension('WEBGL_lose_context')?.loseContext?.()
}

