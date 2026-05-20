# HL World Game Protocol Runbook

This runbook launches `hl-world` as a standalone multiplayer game without an
operational dependency on `world-service`. The launch profile is Ethereum/SIWE
wallet-only.

## Topology

- `game-trove`: public Game Protocol game shell and release API.
- `asset-service`: immutable public bytes for static client releases and runtime
  content-addressed assets.
- `gamedev` runtime: fixed authoritative multiplayer runtime for one `WORLD_ID`,
  or Agones-managed runtime instances bootstrapped by `runtime-control`.
- `hl-world`: unchanged content repository imported into the runtime.

The fixed-runtime launch keeps no runtime orchestration dependency. The
runtime-control / Agones path uses dynamic assignment, then push-bootstraps each
allocated runtime with its dynamic public API/WSS URLs before clients connect.
Agones-managed gamedev runtimes use one public dynamic TCP port: `PORT=3000`
inside the container by default, with the GameServer host port assigned by
Agones. When `gameserver-wildcard-tls` is mounted, gamedev serves HTTPS API,
health, bootstrap, and WSS on that same listener; the older `PORT=3000` plus
`DIRECT_WSS_PORT=7000` split from world-service is not used by runtime-control.

## Runtime Env

Use HTTPS/WSS public URLs for browser traffic. Keep `ASSETS_BASE_URL` on the
runtime `/assets` bridge even when uploads are stored in `asset-service`.
`CORS_ORIGINS` must contain browser origins only, such as
`https://staging.peezy.tech`; do not include `/devnet/trove` or other paths.
For runtime-control / Agones launches, do not put `PUBLIC_API_URL`,
`PUBLIC_WS_URL`, `PUBLIC_AUTH_URL`, or `PUBLIC_ADMIN_URL` in
`GAME_PROTOCOL_RUNTIME_ENV`; runtime-control derives and injects those assigned
URLs during push bootstrap.
`GAME_PROTOCOL_RUNTIME_REGIONS` must be one or more runtime-control region codes
matching `[a-z][a-z0-9-]{0,31}`, such as `use`, `use1`, `euc`, or `us-east`;
avoid spaces and display names.
`GAME_PROTOCOL_RUNTIME_DB_SCHEMA` is required for the managed `hl-world` launch
so all Agones instances bind to the intended shared runtime state schema instead
of falling through to an implicit default.

```bash
WORLD_ID=hl-world
PORT=3000
JWT_SECRET=<high-entropy-secret>

STANDALONE_WALLET_AUTH=true
REQUIRE_WALLET_AUTH=true
PUBLIC_REQUIRE_WALLET_AUTH=true
PUBLIC_AUTH_URL=https://hl-runtime.example/api/auth/identity
STANDALONE_ADMIN_WALLETS=0x...

PUBLIC_API_URL=https://hl-runtime.example/api
PUBLIC_WS_URL=wss://hl-runtime.example/ws
GAME_PROTOCOL_HEALTH_URL=https://hl-runtime.example/health
CORS_ORIGINS=https://games.example

ASSETS=asset-service
ASSETS_BASE_URL=https://hl-runtime.example/assets
ASSET_SERVICE_URL=http://asset-service:8787
ASSET_SERVICE_API_KEY=<asset-service-write-secret>
```

Validate before deploying:

```bash
npm run game-protocol:doctor
```

## Deploy Order

1. Deploy `asset-service` with durable storage and a private write key.
2. Deploy `game-trove` with a durable store file and access to `asset-service`.
3. Deploy the fixed `gamedev` runtime with the env above.
4. Verify:

```bash
curl -fsS https://hl-runtime.example/health
curl -fsS https://games.example/health
```

## Import HL World

Authenticate once as a wallet listed in `STANDALONE_ADMIN_WALLETS`, then import
from the unchanged `hl-world` repository:

```bash
cd ../hl-world
WORLD_URL=https://hl-runtime.example WORLD_ID=hl-world gamedev auth
WORLD_URL=https://hl-runtime.example WORLD_ID=hl-world gamedev world import
```

## Publish Client

Build the portable client and external runtime descriptor from `gamedev`:

```bash
cd ../gamedev
PUBLIC_API_URL=https://hl-runtime.example/api \
PUBLIC_WS_URL=wss://hl-runtime.example/ws \
PUBLIC_AUTH_URL=https://hl-runtime.example/api/auth/identity \
ASSETS_BASE_URL=https://hl-runtime.example/assets \
STANDALONE_WALLET_AUTH=true \
PUBLIC_REQUIRE_WALLET_AUTH=true \
npm run game-protocol:build
```

For the runtime-control / Agones path, build the same static client, then write
an `authoritative-session` descriptor instead of the fixed
`external-authoritative` descriptor:

```bash
PUBLIC_API_URL=https://placeholder-runtime.example/api \
PUBLIC_REQUIRE_WALLET_AUTH=true \
STANDALONE_WALLET_AUTH=true \
npm run static:build

GAME_PROTOCOL_RUNTIME_KIND=authoritative-session \
GAME_PROTOCOL_RUNTIME_IMAGE=ghcr.io/load-game/gamedev@sha256:<digest> \
GAME_PROTOCOL_RUNTIME_CAPACITY=50 \
GAME_PROTOCOL_RUNTIME_REGIONS=use \
GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE=push \
GAME_PROTOCOL_RUNTIME_WORLD_ID=hl-world \
GAME_PROTOCOL_RUNTIME_WORLD_SLUG=hl-world \
GAME_PROTOCOL_RUNTIME_DB_SCHEMA=hl_world \
GAME_PROTOCOL_RUNTIME_ENV='{"ASSETS":"s3","ASSETS_BASE_URL":"https://assets.load.game","SAVE_INTERVAL":"60","STANDALONE_WALLET_AUTH":"true","REQUIRE_WALLET_AUTH":"true","PUBLIC_REQUIRE_WALLET_AUTH":"true","CORS_ORIGINS":"https://staging.peezy.tech","HYPERLIQUID_DATA_URL":"https://staging.peezy.tech/devnet/hyperliquid"}' \
GAME_PROTOCOL_RUNTIME_SECRET_ENV='[{"name":"DB_URI","secretName":"lobby-db-uri","secretKey":"uri"},{"name":"ASSETS_S3_URI","secretName":"lobby-assets-s3","secretKey":"uri"},{"name":"JWT_SECRET","secretName":"lobby-jwt","secretKey":"secret"},{"name":"STANDALONE_ADMIN_WALLETS","secretName":"lobby-admin-wallets","secretKey":"wallets"}]' \
GAME_PROTOCOL_RUNTIME_KUBERNETES='{"imagePullSecrets":["ghcr-secret"],"nodeSelector":{"lobby/pool":"gs"},"resources":{"requests":{"cpu":"100m","memory":"256Mi"},"limits":{"cpu":"1","memory":"1Gi"}},"tlsSecret":{"name":"gameserver-wildcard-tls"}}' \
sh -c 'npm run game-protocol:doctor && npm run game-protocol:runtime'
```

`game-protocol:doctor` understands `authoritative-session` releases. It checks
the immutable image digest, push-bootstrap requirement, runtime-only env,
required Secret refs, and TLS/GameServer pod shape before a release is
published. For the staging Agones launch profile, that pod shape must include
`imagePullSecrets:["ghcr-secret"]`, `nodeSelector:{"lobby/pool":"gs"}`, and a
WSS `tlsSecret` such as `gameserver-wildcard-tls`.
The runtime descriptor writer also refuses managed descriptors that omit
runtime regions, push bootstrap, world identity, or the DB schema.
`game-trove` also rejects DB-backed or hybrid `authoritative-session` uploads
that omit push-bootstrap world identity or the DB schema, so manually crafted
manifests cannot bypass the launch checks.

Before promoting a push-bootstrap release, runtime-control must have
`RUNTIME_CONTROL_BOOTSTRAP_AUTH_SECRET` and
`RUNTIME_CONTROL_BOOTSTRAP_AUTH_SECRET_REF_NAME` configured so it can sign
`/internal/bootstrap` and inject `RUNTIME_BOOTSTRAP_AUTH_SECRET` into each
GameServer pod. The runtime Secret refs above assume infra has generated
`lobby-db-uri`, `lobby-assets-s3`, `lobby-jwt`, and `lobby-admin-wallets`; the
last one is produced when `STANDALONE_ADMIN_WALLETS` or
`WALLET_ADMIN_ADDRESSES` is set for `scripts/sops-from-env.sh`.

Before using the `gamedev` runtime image for `hl-world`, prove the
facade/control path with the minimal smoke runtime. Run preflight first so
missing kube wrappers, immutable smoke image refs, Argo auth, Terraform access,
and required smoke flags fail before the live smoke starts:

```bash
cd ../infra
REQUIRE_TERRAFORM_APPLY=1 \
REQUIRE_ARGOCD_AUTH=1 \
REQUIRE_KUBECTL=1 \
REQUIRE_SMOKE=1 \
REQUIRE_DIRECT_SMOKE=1 \
REQUIRE_CAPACITY_SMOKE=1 \
REQUIRE_MATCH_SMOKE=1 \
REQUIRE_GAME_TROVE_CLEANUP=1 \
REQUIRE_HL_WORLD_SECRETS=1 \
GAME_TROVE_SMOKE_PROTOCOL=wss \
RUNTIME_CONTROL_SMOKE_PROTOCOL=wss \
HCLOUD_TOKEN=<hetzner-token> \
CLOUDFLARE_API_TOKEN=<cloudflare-token> \
ARGOCD_AUTH_TOKEN=<argocd-token> \
GAME_TROVE_API_KEY=<secret> \
GAME_TROVE_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest> \
RUNTIME_CONTROL_API_KEY=<runtime-control-internal-secret> \
RUNTIME_CONTROL_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest> \
./scripts/runtime-control-devnet-preflight.sh
```

Then run the full devnet smoke:

```bash
cd ../infra
CONTROL_KUBECTL_BIN=kubectl-lobby-dev \
AGONES_KUBECTL_BIN=kubectl-lobby-dev-use \
REQUIRE_KUBECTL=1 \
REQUIRE_SMOKE=1 \
REQUIRE_DIRECT_SMOKE=1 \
REQUIRE_CAPACITY_SMOKE=1 \
REQUIRE_MATCH_SMOKE=1 \
REQUIRE_GAME_TROVE_CLEANUP=1 \
REQUIRE_HL_WORLD_SECRETS=1 \
GAME_TROVE_SMOKE_PROTOCOL=wss \
RUNTIME_CONTROL_SMOKE_PROTOCOL=wss \
GAME_TROVE_API_KEY=<secret> \
GAME_TROVE_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest> \
RUNTIME_CONTROL_API_KEY=<runtime-control-internal-secret> \
RUNTIME_CONTROL_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest> \
./scripts/runtime-control-devnet-smoke.sh
```

`REQUIRE_CAPACITY_SMOKE=1` makes both the direct runtime-control smoke and the
game-trove facade smoke run in pool mode with capacity `1`. The smoke holds a
live WebSocket occupancy slot and fails unless the next assignment overflows to
a different runtime-control instance. The smoke scripts also repeat the same
`player.id` pool assignment and fail if retry/reconnect increments
`playerCount` or moves to a different runtime-control instance. Keep this
enabled before the first `hl-world` Agones release so stale capacity or
wrong-instance joins are caught with the minimal `runtime-smoke` image first.

`REQUIRE_MATCH_SMOKE=1` runs an additional direct and facade match-mode smoke
with capacity checks disabled. The smoke scripts repeat the same `matchKey`
assignment and fail unless runtime-control returns the same runtime instance.

`REQUIRE_HL_WORLD_SECRETS=1` forces push-bootstrap smoke so runtime-control must
sign `/internal/bootstrap` and inject the runtime bootstrap Secret before
assignment is returned. `REQUIRE_GAME_TROVE_CLEANUP=1` forces facade cleanup
through runtime-control after verification so stale GameServers are caught
before the first `hl-world` promotion. The full `hl-world` gate requires both
the direct runtime-control smoke and the public game-trove facade smoke; a
single successful assignment path, or a smoke that skips capacity, match, or
cleanup checks, is not enough to promote the Agones release.
Keep `GAME_TROVE_SMOKE_PROTOCOL=wss` and
`RUNTIME_CONTROL_SMOKE_PROTOCOL=wss` enabled in the full gate so the smoke
proves the browser-facing WSS route instead of only the internal plain
WebSocket path.

The devnet wrapper also requires Agones-backed runtime-control instance records
for the direct smoke, and requires them for the facade smoke whenever
runtime-control credentials are provided. The internal instance record must have
a non-local Agones cluster context, a GameServer name, and an assignment
`runtimeInstanceId` that matches that GameServer. Treat a smoke that only proves
the public facade can return some runtime URL as insufficient for `hl-world`;
do not set `RUNTIME_CONTROL_SMOKE_CLEANUP=false`,
`RUNTIME_CONTROL_MATCH_SMOKE_CLEANUP=false`, `GAME_TROVE_SMOKE_CLEANUP=false`,
`RUNTIME_CONTROL_SMOKE_VERIFY=false`, `GAME_TROVE_SMOKE_VERIFY=false`,
`RUN_PUBLIC_CHECKS=false`, `REQUIRE_KUBECTL=false`,
`REQUIRE_AGONES_KUBECTL=false`, `CHECK_GAMESERVER_NODE_HOSTS=false`, or
`CHECK_GAMESERVER_DNS=false` for the full gate.

If you only need to rerun the public facade assignment after cluster health has
already been checked:

```bash
cd ../protocol-mono
GAME_TROVE_URL=https://staging.peezy.tech/devnet/trove \
GAME_TROVE_API_KEY=<secret> \
GAME_TROVE_SMOKE_IMAGE=ghcr.io/load-game/runtime-smoke@sha256:<digest> \
GAME_TROVE_SMOKE_MODE=pool \
GAME_TROVE_SMOKE_CAPACITY=1 \
GAME_TROVE_SMOKE_CAPACITY_CHECK=true \
GAME_TROVE_SMOKE_PROTOCOL=wss \
GAME_TROVE_SMOKE_BOOTSTRAP=true \
GAME_TROVE_SMOKE_CLEANUP=true \
GAME_TROVE_SMOKE_REQUIRE_AGONES=true \
GAME_TROVE_SMOKE_VERIFY=true \
GAME_TROVE_SMOKE_RUNTIME_CONTROL_URL=<runtime-control-internal-url-or-port-forward> \
GAME_TROVE_SMOKE_RUNTIME_CONTROL_API_KEY=<runtime-control-internal-secret> \
bun run --filter game-trove smoke:runtime-assignment
```

Publish and promote through `game-trove`:

```bash
cd ../protocol-mono
GAME_TROVE_URL=https://staging.peezy.tech/devnet/trove \
GAME_TROVE_API_KEY=<game-trove-write-secret> \
bun run --filter game-trove publish:directory -- \
  --dir ../gamedev/build/static \
  --slug hl-world \
  --name "HL World" \
  --version "$(date -u +%Y.%m.%d-%H%M)" \
  --runtime ../gamedev/build/static/runtime.json \
  --public \
  --promote
```

Open `https://staging.peezy.tech/devnet/trove/g/hl-world`, connect an Ethereum
wallet, and confirm the websocket receives the imported `$scene` and `tycoon`
blueprints. The browser assignment request should include a stable `player.id`
derived from the wallet/session so runtime-control can return the same instance
on reconnects without consuming another slot; use `PUBLIC_RUNTIME_PLAYER_ID`
only for explicit test/embedded overrides.

Before treating the migration as healthy, verify shared runtime state from two
browser sessions against the promoted release. Make a small world-state change
or claim-progress update in the first session, reconnect with the same wallet,
and confirm the second session sees the same state through the Agones-assigned
runtime. Then run a reward-claim validation flow and confirm order/fill checks
still go through the gamedev server's direct Hyperliquid validation path, not
through runtime-control or game-trove. A successful client connection alone is
not enough to validate the shared-state migration.

## Rollback

`game-trove` releases are immutable. To roll back, promote the previous known-good
release for `hl-world`. Do not re-upload bytes for a rollback unless the prior
release is unavailable.

Use the release id from the last fixed-runtime publish output, deployment notes,
or `game-trove` store backup. The fixed release should use an
`external-authoritative` runtime descriptor that points at the known-good
standalone runtime:

```bash
cd ../protocol-mono
GAME_TROVE_URL=https://staging.peezy.tech/devnet/trove \
GAME_TROVE_API_KEY=<game-trove-write-secret> \
bun run --filter game-trove list:releases -- \
  --slug hl-world
```

Then promote the prior known-good fixed release:

```bash
cd ../protocol-mono
GAME_TROVE_URL=https://staging.peezy.tech/devnet/trove \
GAME_TROVE_API_KEY=<game-trove-write-secret> \
bun run --filter game-trove promote:release -- \
  --slug hl-world \
  --release <previous-external-authoritative-release-id>
```

After promotion, open
`https://staging.peezy.tech/devnet/trove/g/hl-world/bootstrap` and confirm the
public runtime kind is `external-authoritative` before continuing browser smoke.

## Operational Checks

- `/health` on the runtime and `game-trove` must be monitored.
- Runtime database and `asset-service` storage must be backed up.
- Rotate `JWT_SECRET`, `GAME_TROVE_API_KEY`, and `ASSET_SERVICE_API_KEY` through
  deployment secrets, not committed files.
- Keep `CORS_ORIGINS` limited to the actual `game-trove` public origin.
- Keep `REQUIRE_WALLET_AUTH=true` for launch. Guest CLI/bootstrap auth is not
  part of the wallet-only launch profile.
