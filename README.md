# Lobby

Open-source runtime and SDK for persistent multiplayer 3D worlds.

## Quick Start

Create a new world project with the `gamedev` CLI:

```bash
mkdir my-lobby-world
cd my-lobby-world
npx gamedev init
npm install
npm run dev
```

Then open `http://localhost:3000`.

What `npm run dev` does:

- Requires Node.js `22.11.0` (or newer in the same major line).
- Starts a local world server when `WORLD_URL` points to localhost.
- Runs app-server sync so local edits deploy to the world in seconds.
- Auto-creates `.env` with local defaults if one does not exist yet.

## Lobby Runtime and SDK

This repository powers the `gamedev` package and CLI used to scaffold, run, sync, and deploy Lobby world projects.

## What You Get

- Persistent self-hosted world runtime (multiplayer, physics, WebXR).
- Multi-file app scripting with live sync via app-server.
- World project structure with `apps/`, `assets/`, `shared/`, and `world.json`.
- App deploys, rollback snapshots, and sync conflict resolution tools.

## Core CLI Commands

```bash
gamedev init
gamedev dev
gamedev app-server
gamedev apps deploy <app>
gamedev world export
gamedev world import
npm run static:build
npm run game-protocol:build
```

Run `gamedev help` for the full command list.

## Static Client Builds

`npm run static:build` writes a portable browser client to `build/static`.
Set `PUBLIC_API_URL` to the fixed runtime API URL before building; `PUBLIC_WS_URL`
is optional and is derived from `PUBLIC_API_URL` when omitted. For game-trove
dynamic runtime releases, the static client can also resolve a runtime through
`PUBLIC_RUNTIME_ASSIGNMENT_URL` or the game-trove bootstrap URL injected by the
parent shell. Runtime assignment includes `player.id` when the client can derive
one from `PUBLIC_RUNTIME_PLAYER_ID`, URL query params, the current wallet
session, or a connected wallet snapshot, so runtime-control can make retries and
reconnects idempotent. Static builds set `PUBLIC_ASSET_BASE=.` by default so
built-in client assets resolve when the files are served from a nested release
URL such as `game-trove`.

For standalone wallet sign-in without `world-service`, run the runtime with:

```bash
STANDALONE_WALLET_AUTH=true
PUBLIC_AUTH_URL=https://runtime.example/api/auth/identity
PUBLIC_REQUIRE_WALLET_AUTH=true
CORS_ORIGINS=https://games.example
```

Standalone wallet mode rejects guest WebSocket sessions by default; set
`REQUIRE_WALLET_AUTH=false` only for local testing that should allow guests.

For protocol `asset-service` storage, run the runtime with `ASSETS=asset-service`
and keep `ASSETS_BASE_URL` pointed at the runtime `/assets` route. The runtime
serves packaged engine assets by name and proxies content-addressed uploads to
`asset-service`.

## Game Protocol Publishing

`npm run game-protocol:build` writes both the portable static client and
`build/static/runtime.json`, an `external-authoritative` descriptor for a fixed
self-hosted runtime. Publish `build/static` with `game-trove publish:directory`
and pass that descriptor as `--runtime build/static/runtime.json`.

For runtime-control-managed releases, set
`GAME_PROTOCOL_RUNTIME_KIND=authoritative-session`,
`GAME_PROTOCOL_RUNTIME_IMAGE=<image@sha256:...>`,
`GAME_PROTOCOL_RUNTIME_CAPACITY=<players>`,
`GAME_PROTOCOL_RUNTIME_REGIONS=<region-code>`,
`GAME_PROTOCOL_RUNTIME_BOOTSTRAP_MODE=push`,
`GAME_PROTOCOL_RUNTIME_WORLD_ID=<world-id>`,
`GAME_PROTOCOL_RUNTIME_WORLD_SLUG=<world-slug>`, and
`GAME_PROTOCOL_RUNTIME_DB_SCHEMA=<schema>`. Add
`GAME_PROTOCOL_RUNTIME_ENV`, `GAME_PROTOCOL_RUNTIME_SECRET_ENV`, and
`GAME_PROTOCOL_RUNTIME_KUBERNETES` JSON before running
`npm run game-protocol:runtime`. Run `npm run game-protocol:doctor` with the
same environment first; in `authoritative-session` mode it rejects mutable
images, missing regions/bootstrap/world/schema metadata, missing runtime Secret
refs, fixed public runtime URLs that should be injected by runtime-control after
Agones allocation, missing `ghcr-secret` image pulls, and non-GameServer node
selectors.

The Docker workflow publishes the gamedev runtime image and prints an immutable
`ghcr.io/load-game/gamedev@sha256:<digest>` ref in its GitHub Actions summary.
Use that digest as `GAME_PROTOCOL_RUNTIME_IMAGE` for `hl-world` releases unless
you intentionally maintain a separate world-specific runtime image.

Before publishing a world project such as `hl-world`, import its unchanged
`apps/`, `shared/`, `assets/`, and `world.json` into the running runtime:

```bash
WORLD_URL=https://runtime.example WORLD_ID=hl-world gamedev world import
```

For non-interactive local Agones validation, `scripts/local-world-import-smoke.mjs`
can authenticate a configured standalone admin wallet, run the same import path,
and verify expected blueprint/entity ids:

```bash
WORLD_URL=http://127.0.0.1:47000 \
WORLD_ID=hl-world \
WORLD_IMPORT_PROJECT_DIR=../hl-world \
WORLD_IMPORT_ADMIN_PRIVATE_KEY=<local-dev-private-key> \
node scripts/local-world-import-smoke.mjs
```

To prove two Agones-managed runtimes are sharing the same DB-backed world state,
run `scripts/local-world-shared-state-smoke.mjs` after importing into a primary
runtime. It mutates spawn state on the primary runtime, assigns a second
runtime through game-trove, and verifies the second runtime hydrates the same
`hl-world` content plus the updated spawn from the shared database.

## Documentation

- [World Projects](docs/World-projects.md)
- [App-server](docs/App-server.md)
- [Scripting API](docs/scripting/README.md)
- [HL World Game Protocol Runbook](docs/HL-world-game-protocol-runbook.md)
- [Docker Deployment](DOCKER.md)

## Developing This Repository

If you are working on the runtime/SDK itself (not just a world project):

```bash
npm install
cp .env.example .env
npm run dev
```

Useful commands:

```bash
npm run build
npm run test
npm run lint
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
