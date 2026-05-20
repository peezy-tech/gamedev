import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function fencedBlockContaining(markdown, marker) {
  const fencePattern = /```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g
  for (const match of markdown.matchAll(fencePattern)) {
    if (match[1].includes(marker)) return match[1]
  }
  throw new Error(`no fenced block found containing ${marker}`)
}

function assertMarkdownContains(markdown, required) {
  for (const needle of required) {
    assert.match(markdown, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
}

test('hl-world runbook preflight command includes all required devnet gates and credentials', async () => {
  const markdown = await readFile(new URL('../../docs/HL-world-game-protocol-runbook.md', import.meta.url), 'utf8')
  const block = fencedBlockContaining(markdown, './scripts/runtime-control-devnet-preflight.sh')

  for (const required of [
    'REQUIRE_TERRAFORM_APPLY=1',
    'REQUIRE_ARGOCD_AUTH=1',
    'REQUIRE_KUBECTL=1',
    'REQUIRE_SMOKE=1',
    'REQUIRE_DIRECT_SMOKE=1',
    'REQUIRE_CAPACITY_SMOKE=1',
    'REQUIRE_MATCH_SMOKE=1',
    'REQUIRE_GAME_TROVE_CLEANUP=1',
    'REQUIRE_HL_WORLD_SECRETS=1',
    'GAME_TROVE_SMOKE_PROTOCOL=wss',
    'RUNTIME_CONTROL_SMOKE_PROTOCOL=wss',
    'HCLOUD_TOKEN=<hetzner-token>',
    'CLOUDFLARE_API_TOKEN=<cloudflare-token>',
    'ARGOCD_AUTH_TOKEN=<argocd-token>',
    'GAME_TROVE_API_KEY=<secret>',
    'GAME_TROVE_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest>',
    'RUNTIME_CONTROL_API_KEY=<runtime-control-internal-secret>',
    'RUNTIME_CONTROL_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest>',
  ]) {
    assert.match(block, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('hl-world runbook requires browser, shared-state, reward, and rollback validation', async () => {
  const markdown = await readFile(new URL('../../docs/HL-world-game-protocol-runbook.md', import.meta.url), 'utf8')

  assertMarkdownContains(markdown, [
    'Open `https://staging.peezy.tech/devnet/trove/g/hl-world`',
    'stable `player.id`',
    'verify shared runtime state from two',
    'browser sessions',
    'reconnect with the same wallet',
    'reward-claim validation flow',
    "direct Hyperliquid validation path",
    'through runtime-control',
    'or game-trove',
    'requires both',
    'direct runtime-control smoke',
    'public game-trove facade smoke',
    'same',
    '`player.id` pool assignment',
    'fail if retry/reconnect increments',
    'skips capacity, match, or',
    'cleanup checks',
    'GAME_TROVE_SMOKE_PROTOCOL=wss',
    'RUNTIME_CONTROL_SMOKE_PROTOCOL=wss',
    'proves the browser-facing WSS route',
    'requires Agones-backed runtime-control instance records',
    'non-local Agones cluster context',
    '`runtimeInstanceId` that matches that GameServer',
    'RUNTIME_CONTROL_SMOKE_CLEANUP=false',
    'RUNTIME_CONTROL_MATCH_SMOKE_CLEANUP=false',
    'GAME_TROVE_SMOKE_CLEANUP=false',
    'RUNTIME_CONTROL_SMOKE_VERIFY=false',
    'GAME_TROVE_SMOKE_VERIFY=false',
    'RUN_PUBLIC_CHECKS=false',
    'REQUIRE_KUBECTL=false',
    'REQUIRE_AGONES_KUBECTL=false',
    'CHECK_GAMESERVER_NODE_HOSTS=false',
    'CHECK_GAMESERVER_DNS=false',
    'public runtime kind is `external-authoritative`',
    'bun run --filter game-trove list:releases',
    'bun run --filter game-trove promote:release',
  ])
})

test('hl-world runbook smoke command keeps the full runtime-control gate enabled', async () => {
  const markdown = await readFile(new URL('../../docs/HL-world-game-protocol-runbook.md', import.meta.url), 'utf8')
  const block = fencedBlockContaining(markdown, './scripts/runtime-control-devnet-smoke.sh')

  for (const required of [
    'CONTROL_KUBECTL_BIN=kubectl-lobby-dev',
    'AGONES_KUBECTL_BIN=kubectl-lobby-dev-use',
    'REQUIRE_KUBECTL=1',
    'REQUIRE_SMOKE=1',
    'REQUIRE_DIRECT_SMOKE=1',
    'REQUIRE_CAPACITY_SMOKE=1',
    'REQUIRE_MATCH_SMOKE=1',
    'REQUIRE_GAME_TROVE_CLEANUP=1',
    'REQUIRE_HL_WORLD_SECRETS=1',
    'GAME_TROVE_SMOKE_PROTOCOL=wss',
    'RUNTIME_CONTROL_SMOKE_PROTOCOL=wss',
    'GAME_TROVE_API_KEY=<secret>',
    'GAME_TROVE_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest>',
    'RUNTIME_CONTROL_API_KEY=<runtime-control-internal-secret>',
    'RUNTIME_CONTROL_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest>',
  ]) {
    assert.match(block, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('hl-world runbook public facade rerun keeps Agones-backed verification enabled', async () => {
  const markdown = await readFile(new URL('../../docs/HL-world-game-protocol-runbook.md', import.meta.url), 'utf8')
  const block = fencedBlockContaining(markdown, 'bun run --filter game-trove smoke:runtime-assignment')

  for (const required of [
    'GAME_TROVE_URL=https://staging.peezy.tech/devnet/trove',
    'GAME_TROVE_SMOKE_CAPACITY_CHECK=true',
    'GAME_TROVE_SMOKE_PROTOCOL=wss',
    'GAME_TROVE_SMOKE_BOOTSTRAP=true',
    'GAME_TROVE_SMOKE_CLEANUP=true',
    'GAME_TROVE_SMOKE_REQUIRE_AGONES=true',
    'GAME_TROVE_SMOKE_RUNTIME_CONTROL_URL=<runtime-control-internal-url-or-port-forward>',
    'GAME_TROVE_SMOKE_RUNTIME_CONTROL_API_KEY=<runtime-control-internal-secret>',
  ]) {
    assert.match(block, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})
