# Runtime Admin Credential Access Plan

Last updated: 2026-02-19

## Goal

- Let authorized in-world admins copy `WORLD_ID` and `ADMIN_CODE` for app-server workflows.
- Avoid generic environment-variable access over the admin channel.
- Keep reveal behavior explicit, auditable, and rollout-controlled.

## Command Contract

- Admin WS command: `runtime_credentials_get`
- Response shape:
  - `worldId`
  - `hasAdminCode`
  - `canRevealAdminCode`
  - `adminCode` (nullable; only when reveal is enabled and caller is authorized)

## Feature Flag

- Runtime env flag: `ADMIN_CREDENTIAL_REVEAL_ENABLED`
- Default behavior: disabled (`false`)

## Work Units

- [x] PR-1: Contract + Guardrails Scaffolding
  - Add tracked plan and command contract.
  - Add runtime flag parsing + credential response/audit helpers.

- [x] PR-2: Runtime Server Command Handler
  - Implement `runtime_credentials_get` in admin WS command handling.
  - Gate by deploy capability and add reveal audit logging.
  - Add targeted tests.

- [x] PR-3: Admin Client API
  - Add `getRuntimeCredentials()` API in client admin system.
  - Keep returned credentials in memory only.

- [ ] PR-4: World Pane UX
  - Add admin-only credential section with copy actions.
  - Add explicit reveal/copy action for `ADMIN_CODE`.

- [ ] PR-5: Rollout + Docs
  - Add operator runbook for enabling/disabling reveal.
  - Set rollout defaults in dev/prod config.

## Dependencies

- `PR-1 -> PR-2 -> PR-3 -> PR-4 -> PR-5`
