import assert from 'node:assert/strict'
import { test } from 'vite-plus/test'
import { validateScriptFiles } from '@gamedev/core/blueprintValidation.js'

test('blueprint scriptFiles rejects path traversal', () => {
  const result = validateScriptFiles({ '../evil.js': 'asset://evil.js' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid_script_files')
})
