import { test as bunTest } from 'bun:test'

const SKIP_ERROR = Symbol('skip-error')

function parseTestArgs(optionsOrFn, maybeFn) {
  if (typeof optionsOrFn === 'function') {
    return {
      options: undefined,
      fn: optionsOrFn,
    }
  }
  return {
    options: optionsOrFn,
    fn: maybeFn,
  }
}

function annotateError(error, name) {
  if (!(error instanceof Error)) return error
  if (error.message.startsWith(`${name}: `)) return error
  error.message = `${name}: ${error.message}`
  return error
}

async function runCleanup(cleanups) {
  const errors = []
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) {
    throw errors[0]
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'multiple test cleanups failed')
  }
}

async function runTestBody(fn) {
  const cleanups = []
  const context = {
    after(callback) {
      if (typeof callback === 'function') {
        cleanups.push(callback)
      }
    },
    skip(message = 'skipped') {
      const error = new Error(message)
      error[SKIP_ERROR] = true
      throw error
    },
    async test(name, optionsOrFn, maybeFn) {
      const { fn: subtestFn } = parseTestArgs(optionsOrFn, maybeFn)
      try {
        return await runTestBody(subtestFn)
      } catch (error) {
        throw annotateError(error, name)
      }
    },
  }

  try {
    if (typeof fn !== 'function') {
      throw new TypeError('test callback must be a function')
    }
    if (fn.length > 0) {
      return await fn(context)
    }
    return await fn()
  } catch (error) {
    if (error?.[SKIP_ERROR]) return
    throw error
  } finally {
    await runCleanup(cleanups)
  }
}

export function test(name, optionsOrFn, maybeFn) {
  const { options, fn } = parseTestArgs(optionsOrFn, maybeFn)
  if (options === undefined) {
    return bunTest(name, () => runTestBody(fn))
  }
  return bunTest(name, options, () => runTestBody(fn))
}
