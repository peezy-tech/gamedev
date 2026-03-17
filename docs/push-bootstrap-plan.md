# Runtime Push Bootstrap Plan

Status: Proposed
Last updated: 2026-03-17

## Goal

Refactor `runtime/` so a managed runtime can boot in `standby`, accept a one-shot
bootstrap push from `world-service`, and only initialize world state after that bind succeeds.

## Checklist

### 1. Freeze The Runtime-Side Contract

- [x] Update `runtime/src/server/runtimeBootstrap.js` to represent the pushed binding shape explicitly, including `world`, `runtime`, `auth`, `control`, and any remaining per-world admin/runtime fields. Size: 0.5 day.
- [x] Add runtime-side support for an explicit `control.internalBaseUrl` and mark all internal callback URL derivation from `PUBLIC_AUTH_URL` as legacy-to-remove. Files: `runtime/src/server/index.js`, `runtime/src/core/utils-server.js`. Size: 0.5 day.
- [x] Implement the chosen bootstrap auth verification scheme in runtime startup/control code so bootstrap requests can be authenticated before `worldId` is bound. Files: `runtime/src/server/index.js`, `runtime/src/server/runtimeBootstrap.js`. Size: 0.5 day.
- [x] Document the runtime split between static pod env and pushed world-binding config in `runtime/.env.example`. Size: 0.25 day.

Definition of done:

- runtime has a fixed pushed payload shape
- runtime knows how bootstrap auth is verified before bind
- internal control URL usage is separated from `PUBLIC_AUTH_URL`

Notes captured in this step:

- Runtime now expects the binding shape `bootstrapId + { world, runtime, auth, control }`.
- `control.internalBaseUrl` maps to `CONTROL_INTERNAL_BASE_URL`; `PUBLIC_AUTH_URL` remains client-facing auth data only.
- Legacy control-plane fallback still derives from `PUBLIC_AUTH_URL` and logs a startup warning until every managed runtime receives `control.internalBaseUrl`.
- Bootstrap auth is `Bearer HMAC_SHA256(secret, "runtime-bootstrap:<runtimeInstanceId>")`, where `secret` is `RUNTIME_BOOTSTRAP_AUTH_SECRET` or `JWT_SECRET`, and `runtimeInstanceId` comes from `RUNTIME_BOOTSTRAP_INSTANCE_ID`.

### 2. Add Standby Startup Mode

- [x] Refactor `runtime/src/server/index.js` so the process can start without `WORLD_ID`, `DB_SCHEMA`, public runtime URLs, upload limits, or idle timeout and remain in `standby`. Size: 1 day.
- [x] Add pre-init control endpoints:
  - `POST /internal/bootstrap`
  - `GET /internal/bootstrap/status`
  - `GET /healthz`
  Files: `runtime/src/server/index.js` and supporting helpers. Size: 1 day.
- [x] Defer DB, assets, storage, and world initialization until after a successful bootstrap request applies the bound config. Files: `runtime/src/server/index.js`, `runtime/src/server/db.js`, `runtime/src/server/Storage.js`, `runtime/src/server/assets*.js`. Size: 1 day.
- [x] Keep standby runtimes from arming idle shutdown until they are bound to a world. Files: `runtime/src/server/index.js`, `runtime/src/server/agonesIdleShutdown.js`. Size: 0.25 day.
- [x] Add state transitions for `standby`, `bootstrapping`, `ready`, and `failed`, and expose them via bootstrap status. Files: `runtime/src/server/index.js`. Size: 0.5 day.

Definition of done:

- a managed runtime can boot with only infra/static env
- no world initialization happens before bootstrap
- control-plane status is observable before gameplay becomes available

### 3. Make Bootstrap One-Shot And Traffic-Safe

- [x] Make bootstrap idempotent for the same `bootstrapId` and reject rebinding attempts with a different binding after success. Files: `runtime/src/server/index.js`, `runtime/src/server/runtimeBootstrap.js`. Size: 0.5 day.
- [x] Gate gameplay/admin entrypoints until bootstrap status is `ready`, returning retryable not-ready responses during `standby` and `bootstrapping`. Files: `runtime/src/server/index.js`, `runtime/src/server/admin.js`. Size: 0.5 day.
- [x] Ensure world-specific runtime values that currently live in env can be applied before init from the pushed binding, including auth/control/public URL fields and limits. Files: `runtime/src/server/index.js`, `runtime/src/server/runtimeBootstrap.js`. Size: 0.5 day.
- [x] Make post-bind runtime callbacks use the pushed control URL and derive per-world runtime auth only after `worldId` is bound. Files: `runtime/src/server/index.js`, `runtime/src/core/utils-server.js`. Size: 0.5 day.

Definition of done:

- the runtime can only be bound once
- clients cannot hit partially configured gameplay/admin surfaces
- runtime callbacks no longer depend on `PUBLIC_AUTH_URL` hacks

### 4. Cut Over From Pull Mode

- [ ] Add a runtime rollout switch for `pull|push` bootstrap modes so managed runtimes can migrate incrementally. Files: `runtime/src/server/index.js`, `runtime/.env.example`. Size: 0.5 day.
- [ ] Keep pull and push modes behaviorally aligned long enough to add parity tests for the required managed-world config set. Files: `runtime/test/integration/*.test.js`. Size: 0.5 day.
- [ ] Remove the old startup pull-bootstrap path after push mode is stable in canary. Files: `runtime/src/server/index.js`, `runtime/src/server/runtimeBootstrap.js`. Size: 0.5 day.

Definition of done:

- runtime can be rolled over safely per environment
- push mode no longer depends on the old startup pull path

### 5. Runtime Tests And Operability

- [ ] Add targeted integration tests for:
  - booting into `standby`
  - successful bootstrap
  - duplicate bootstrap with same binding
  - rejected rebind with different binding
  - runtime restart followed by re-bootstrap
  Files: `runtime/test/integration/*.test.js`. Size: 1 day.
- [ ] Add structured runtime logs for `standby`, `bootstrap_start`, `bootstrap_success`, `bootstrap_failed`, and `rebind_rejected`. Files: `runtime/src/server/index.js`. Size: 0.5 day.
- [ ] Add runtime-side canary/rollback notes to `runtime/docs/` once the flag exists. Files: `runtime/docs/push-bootstrap-plan.md`. Size: 0.25 day.
- [ ] After V1 is stable, define the runtime-side reset/scrub requirements needed for any future warm standby pool. Files: `runtime/docs/push-bootstrap-plan.md`, `runtime/src/server/*`. Size: 1 day research.

Definition of done:

- runtime behavior is covered by targeted tests
- runtime-side rollout and failure signals are operationally obvious

## Suggested Execution Order

1. Freeze the runtime-side contract
2. Add standby startup mode
3. Make bootstrap one-shot and traffic-safe
4. Cut over from pull mode behind a flag
5. Add tests and operability
