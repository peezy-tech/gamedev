# Workspaces

This repo now uses Bun workspaces directly from the root [`package.json`](/home/peezy/repos/github/lobby/worktrees/runtime/package.json) instead of `pnpm-workspace.yaml`.

## Layout

```json
{
  "workspaces": {
    "packages": ["packages/*"]
  }
}
```

## Repo Notes

- `bun.lock` is the committed lockfile for the whole workspace.
- [`bunfig.toml`](/home/peezy/repos/github/lobby/worktrees/runtime/bunfig.toml) pins the linker to `hoisted` so the current package layout keeps working while workspace internals still centralize third-party dependencies at the root.
- Native packages that need install scripts are allowlisted through `trustedDependencies` in the root manifest.
- Bun catalogs are supported, but this repo does not currently need them because third-party versions are still owned by the root package.
