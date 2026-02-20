# Runtime Admin Credential Reveal Runbook

Last updated: 2026-02-19

## Purpose

- Control whether runtime admins can reveal/copy `ADMIN_CODE` from the editor World pane.
- `WORLD_ID` remains visible to authorized runtime admins.

## Runtime Flag

- `ADMIN_CREDENTIAL_REVEAL_ENABLED`
  - `false`: `ADMIN_CODE` stays hidden (`canRevealAdminCode=false`)
  - `true`: runtime may return `ADMIN_CODE` to authorized deploy-capable admins

## Local Runtime (direct)

- Set in runtime env (`.env`):

```bash
ADMIN_CREDENTIAL_REVEAL_ENABLED=true
```

- Restart runtime after changes.

## Managed Worlds (world-service provisioned pods)

- Set world-service env:
  - `RUNTIME_ADMIN_CREDENTIAL_REVEAL_ENABLED`
- world-service passes this into each provisioned runtime pod as:
  - `ADMIN_CREDENTIAL_REVEAL_ENABLED`

### Recommended rollout defaults

- Dev: `RUNTIME_ADMIN_CREDENTIAL_REVEAL_ENABLED=true`
- Prod: `RUNTIME_ADMIN_CREDENTIAL_REVEAL_ENABLED=false`

## Verification

1. Open world editor as an authorized admin.
2. Open `World` pane and locate `Runtime Credentials`.
3. Confirm:
   - `WORLD_ID` copy works.
   - `ADMIN_CODE` reveal/copy behavior matches the configured flag.

## Rollback

1. Set `ADMIN_CREDENTIAL_REVEAL_ENABLED=false` (direct runtime), or
2. Set `RUNTIME_ADMIN_CREDENTIAL_REVEAL_ENABLED=false` (world-service managed),
3. Restart/redeploy affected runtime pods.
