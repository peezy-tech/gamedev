import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ADMIN_CREDENTIAL_COMMAND,
  buildRuntimeCredentialResponse,
  handleRuntimeCredentialCommand,
  isAdminCredentialRevealEnabled,
} from '../../src/server/adminCredentials.js'

test('command contract uses runtime_credentials_get name', () => {
  assert.equal(ADMIN_CREDENTIAL_COMMAND, 'runtime_credentials_get')
})

test('runtime credential command denies callers without deploy capability', () => {
  const result = handleRuntimeCredentialCommand({
    canDeploy: false,
    revealEnabled: true,
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

test('runtime credential command returns world id but hides admin code when reveal is disabled', () => {
  const result = handleRuntimeCredentialCommand({
    canDeploy: true,
    revealEnabled: false,
    worldId: 'world-123',
    adminCode: 'secret-code',
  })

  assert.equal(result.ok, true)
  assert.equal(result.revealed, false)
  assert.equal(result.reason, 'reveal_disabled')
  assert.deepEqual(result.credentials, {
    worldId: 'world-123',
    hasAdminCode: true,
    canRevealAdminCode: false,
    adminCode: null,
  })
})

test('runtime credential command returns admin code when reveal is enabled', () => {
  const result = handleRuntimeCredentialCommand({
    canDeploy: true,
    revealEnabled: true,
    worldId: 'world-123',
    adminCode: 'secret-code',
  })

  assert.equal(result.ok, true)
  assert.equal(result.revealed, true)
  assert.equal(result.reason, 'revealed')
  assert.deepEqual(result.credentials, {
    worldId: 'world-123',
    hasAdminCode: true,
    canRevealAdminCode: true,
    adminCode: 'secret-code',
  })
})

test('buildRuntimeCredentialResponse handles empty world id and missing admin code', () => {
  assert.deepEqual(
    buildRuntimeCredentialResponse({
      worldId: '  ',
      adminCode: '',
      revealEnabled: true,
    }),
    {
      worldId: null,
      hasAdminCode: false,
      canRevealAdminCode: true,
      adminCode: null,
    }
  )
})

test('isAdminCredentialRevealEnabled parses truthy and falsy env values', () => {
  assert.equal(isAdminCredentialRevealEnabled({ ADMIN_CREDENTIAL_REVEAL_ENABLED: 'true' }), true)
  assert.equal(isAdminCredentialRevealEnabled({ ADMIN_CREDENTIAL_REVEAL_ENABLED: '1' }), true)
  assert.equal(isAdminCredentialRevealEnabled({ ADMIN_CREDENTIAL_REVEAL_ENABLED: 'false' }), false)
  assert.equal(isAdminCredentialRevealEnabled({ ADMIN_CREDENTIAL_REVEAL_ENABLED: '0' }), false)
  assert.equal(isAdminCredentialRevealEnabled({ ADMIN_CREDENTIAL_REVEAL_ENABLED: 'off' }), false)
  assert.equal(isAdminCredentialRevealEnabled({ ADMIN_CREDENTIAL_REVEAL_ENABLED: '' }), false)
})
