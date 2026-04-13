# PNPM Monorepo Migration Checklist

This file tracks the conversion of this repository from a single-package npm project into a `pnpm` workspace with separate packages for client, server, CLI, and shared internals while preserving the root `gamedev` package as the public compatibility layer.

## Target Workspace Layout

```text
packages/
  app-server/    App sync server and deploy helpers
  cli/           `gamedev` executable package
  client/        Browser runtime/client bundle sources and assets
  core/          Shared runtime logic and types
  node-client/   Headless/node client package
  server/        Fastify runtime server package
```

## Checklist

- [x] Create workspace root files and shared config
- [x] Add `pnpm-workspace.yaml`
- [x] Preserve the root `gamedev` package as the workspace compatibility layer
- [x] Add root workspace scripts for build, dev, lint, test, and publish flows

- [x] Create `@gamedev/core` package
- [x] Move shared runtime/core code into `packages/core`
- [x] Remove client-only and server-only cross-imports from the core package

- [x] Create `@gamedev/client` package
- [x] Move browser client code and public assets into `packages/client`
- [x] Update client imports to consume workspace packages

- [x] Create `@gamedev/server` package
- [x] Move runtime server code into `packages/server`
- [x] Update server imports to consume workspace packages

- [x] Create `@gamedev/node-client` package
- [x] Move headless/node client code into `packages/node-client`
- [x] Update node-client imports to consume workspace packages

- [x] Create `@gamedev/app-server` package
- [x] Move app-server code into `packages/app-server`
- [x] Update app-server imports to consume workspace packages

- [x] Create `@gamedev/cli` package
- [x] Move CLI entrypoint(s) into `packages/cli`
- [x] Update CLI imports to consume workspace packages

- [x] Preserve the root `gamedev` compatibility package
- [x] Preserve the existing package name, exports, types, and `gamedev` bin contract
- [x] Keep scaffolded world projects pointing at `gamedev`

- [x] Move build scripts to workspace-aware locations
- [x] Update build output paths and package-local dist/public contracts
- [x] Update runtime bootstrap and helper scripts for the workspace

- [x] Update integration tests for workspace paths
- [x] Update Dockerfile for `pnpm` workspace installation/build
- [x] Update GitHub Actions for `pnpm`
- [x] Update docs and README for workspace development

- [x] Generate `pnpm-lock.yaml`
- [x] Run workspace install
- [x] Run build
- [x] Run integration tests
- [x] Mark all checklist items complete

## Verification

- [x] Clean reinstall verified with `fnm` / Node `22.11.0` from `.nvmrc`
- [x] `pnpm install` no longer reports ignored native builds
- [x] `better-sqlite3` loads correctly after clean reinstall
- [x] Missing direct runtime/build dependencies were added to `package.json`
