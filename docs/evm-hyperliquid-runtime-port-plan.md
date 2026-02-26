# EVM + Hyperliquid Runtime API Port Plan

Status: Planned  
Owner: Runtime Client + Scripting API  
Last updated: 2026-02-26

## Goal
Port the old-platform `world.evm()` and `world.hyperliquid()` runtime APIs into current `runtime` with behavior parity.

## Confirmed Constraints
- Runtime APIs only (no world content/app prefab migration in this plan).
- Wallet source priority: Privy EVM wallet first, injected wallet fallback.
- Keep functionality parity with old system (agent key, trade, deposit, withdraw).
- Keep public script API signatures/shape as-is (`world.evm()`, `world.hyperliquid()`).
- Maintain existing auth/session model and existing "any app script can call these methods" behavior.

## Compatibility Contract
- Preserve old runtime script API method names and call patterns.
- Preserve old error semantics where practical for script compatibility.
- Preserve Hyperliquid endpoint flow and Arbitrum/USDC assumptions used in old implementation.

## PR Work Units (Tracked Checklist)

- [x] **PR-01: Wallet Adapter Layer (Privy-first, Injected Fallback)**
  - Scope: Add a reusable client-side wallet adapter that exposes the old capabilities the systems need without reintroducing wagmi.
  - Concrete changes:
    - Add a runtime wallet adapter module (Privy-first wallet resolution, injected fallback).
    - Implement capabilities used by old systems:
      - `address` and connected state
      - EIP-712 typed-data signing
      - chain read/switch
      - ERC-20 read/write + tx receipt waiting
    - Resolve active wallet with this precedence:
      - session `wallet_address` (if linked and available)
      - first connected Privy EVM wallet
      - injected provider wallet fallback
  - File targets:
    - new wallet adapter module under `src/client/`
    - minimal bridge extensions in [`src/client/index.js`](/home/peezy/repos/github/lobby/runtime/src/client/index.js)
  - Acceptance:
    - Adapter returns a usable EVM signer/provider in Privy mode when Privy EVM wallet exists.
    - Adapter falls back to injected wallet when Privy wallet is unavailable.
    - No regressions in existing login/session flow.
  - Dependency: None.

- [x] **PR-02: Reintroduce EVM + Hyperliquid Client Systems**
  - Scope: Port old `EVMClient` and `HyperliquidClient` into current branch with internal adaptation to PR-01 adapter.
  - Concrete changes:
    - Add [`EVMClient.js`](/home/peezy/repos/github/lobby/runtime/src/core/systems/EVMClient.js) and [`HyperliquidClient.js`](/home/peezy/repos/github/lobby/runtime/src/core/systems/HyperliquidClient.js).
    - Register systems in [`createClientWorld.js`](/home/peezy/repos/github/lobby/runtime/src/core/createClientWorld.js).
    - Keep old public method surface intact:
      - `evm.getAddress()`, `evm.isConnected()`
      - `hyperliquid.getPrice/getBalance/getPositions/getAvailableTickers`
      - `buy/sell/closePosition`
      - `hasAgentKey/setupAgentKey`
      - `deposit/withdraw`
  - Acceptance:
    - World initializes with `world.evm` and `world.hyperliquid` systems present on client.
    - Systems compile and run with no reference to removed wagmi APIs.
  - Dependency: **Depends on PR-01** (adapter contract).

- [x] **PR-03: Client Binding Integration**
  - Scope: Bind wallet adapter state into world systems during client lifecycle.
  - Concrete changes:
    - Wire binding lifecycle in [`src/client/world-client.js`](/home/peezy/repos/github/lobby/runtime/src/client/world-client.js).
    - Feed selected wallet context into `world.evm.bind(...)` and `world.hyperliquid.bind(...)`.
    - Rebind on wallet/account/session changes so runtime APIs track active wallet.
  - Acceptance:
    - Connected wallet appears via `world.evm().getAddress()`.
    - Hyperliquid methods requiring wallet fail/pass as expected based on connection state.
  - Dependency: **Depends on PR-01 and PR-02**.

- [x] **PR-04: Script API Surface Re-Exposure**
  - Scope: Restore scripting entry points so app scripts can call `world.evm()` and `world.hyperliquid()`.
  - Concrete changes:
    - Re-add world methods in [`src/core/systems/Apps.js`](/home/peezy/repos/github/lobby/runtime/src/core/systems/Apps.js) mapping to the system methods.
    - Keep signatures aligned with old-platform behavior.
  - Acceptance:
    - Script runtime exposes both methods with expected callable members.
    - Existing script APIs unaffected.
  - Dependency: **Depends on PR-02**.

- [x] **PR-05: Typings + Docs Parity**
  - Scope: Restore developer-facing scripting contract docs/types for the two runtime APIs.
  - Concrete changes:
    - Update [`index.d.ts`](/home/peezy/repos/github/lobby/runtime/index.d.ts) with `WorldAPI` additions.
    - Update [`docs/scripting/world/World.md`](/home/peezy/repos/github/lobby/runtime/docs/scripting/world/World.md) to reference new API pages.
    - Add:
      - [`docs/scripting/world/EVM.md`](/home/peezy/repos/github/lobby/runtime/docs/scripting/world/EVM.md)
      - [`docs/scripting/world/Hyperliquid.md`](/home/peezy/repos/github/lobby/runtime/docs/scripting/world/Hyperliquid.md)
  - Acceptance:
    - TS autocomplete/typecheck reflects script API.
    - Docs match implementation and old method names.
  - Dependency: **Depends on PR-04**.

- [x] **PR-06: End-to-End Parity Validation + Hardening**
  - Scope: Verify full functional parity and close integration gaps.
  - Concrete changes:
    - Validate flows in client runtime:
      - Privy-linked EVM wallet path
      - injected fallback path
      - agent key create/reuse path
      - trade/order path
      - deposit + withdraw path
    - Fix parity bugs discovered in integration.
    - Add focused tests where practical; add manual QA checklist for remaining paths.
  - Acceptance:
    - All old runtime features work in current branch under confirmed constraints.
    - No auth/session regressions in editor/runtime startup.
  - Dependency: **Depends on PR-03, PR-04, and PR-05**.

## Dependency Notes (Unavoidable)
- PR-02 depends on PR-01 because old systems previously assumed wagmi actions; adapter contract must exist first.
- PR-03 depends on PR-01/PR-02 because bind wiring needs both wallet source and systems.
- PR-05 depends on PR-04 to avoid documenting/typesurfacing APIs before final script exposure shape is settled.
- PR-06 is integration/validation and therefore depends on core implementation PRs.

## Merge Strategy
- Merge PR-01 first.
- PR-02 and PR-04 can proceed once PR-01 lands, but PR-04 should target the concrete PR-02 system API.
- Merge PR-03 after PR-02.
- Merge PR-05 after PR-04.
- Merge PR-06 last as parity verification and stabilization.
