import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ADMIN_CREDENTIAL_COMMAND,
  buildRuntimeCredentialResponse,
  handleRuntimeCredentialCommand,
} from '../../src/server/adminCredentials.js'

test('command contract uses runtime_credentials_get name', () => {
  assert.equal(ADMIN_CREDENTIAL_COMMAND, 'runtime_credentials_get')
})

test('runtime credential command denies callers without deploy capability', () => {
  const result = handleRuntimeCredentialCommand({
    canDeploy: false,
    worldId: 'world-123',
    adminCode: 'secret-code',
  })

  assert.deepEqual(result, {
    ok: false,
    error: 'admin_required',
    reason: 'deploy_capability_required',
    revealed: false,
    credentials: null,
  })
})

test('runtime credential command returns admin code for deploy-capable callers', () => {
  const result = handleRuntimeCredentialCommand({
    canDeploy: true,
    worldId: 'world-123',
    adminCode: 'secret-code',
  })

  assert.equal(result.ok, true)
  assert.equal(result.revealed, true)
  assert.equal(result.reason, 'revealed')
  assert.deepEqual(result.credentials, {
    worldId: 'world-123',
    hasAdminCode: true,
    adminCode: 'secret-code',
  })
})

test('runtime credential command returns world id when admin code is not configured', () => {
  const result = handleRuntimeCredentialCommand({
    canDeploy: true,
    worldId: 'world-123',
    adminCode: '',
  })

  assert.equal(result.ok, true)
  assert.equal(result.revealed, false)
  assert.equal(result.reason, 'admin_code_unset')
  assert.deepEqual(result.credentials, {
    worldId: 'world-123',
    hasAdminCode: false,
    adminCode: null,
  })
})

test('buildRuntimeCredentialResponse handles empty world id and missing admin code', () => {
  assert.deepEqual(
    buildRuntimeCredentialResponse({
      worldId: '  ',
      adminCode: '',
    }),
    {
      worldId: null,
      hasAdminCode: false,
      adminCode: null,
    }
  )
})
