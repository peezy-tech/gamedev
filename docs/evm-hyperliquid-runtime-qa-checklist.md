# EVM + Hyperliquid Runtime QA Checklist

Use this checklist for manual parity verification in the client runtime.

## Preconditions

- [x] `PUBLIC_AUTH_URL` is configured (for session wallet linkage checks).
- [x] `PUBLIC_PRIVY_APP_ID` is configured (for Privy wallet path checks).
- [x] Injected wallet extension is installed (for fallback path checks).
- [ ] Test wallet has Arbitrum USDC for deposit checks.

## Wallet Resolution

- [ ] Session `wallet_address` + matching Privy EVM wallet selects the session-linked wallet.
- [ ] Without matching session wallet, first connected Privy EVM wallet is selected.
- [ ] Without Privy wallet, injected wallet account is selected.
- [ ] `world.evm().getAddress()` reflects active wallet.
- [ ] `world.evm().isConnected()` reflects active wallet connection state.

## Hyperliquid Agent Key

- [ ] `world.hyperliquid().hasAgentKey()` is false before setup on a fresh wallet.
- [ ] `world.hyperliquid().setupAgentKey()` requests signature and succeeds.
- [ ] Reload keeps agent key available (`hasAgentKey()` becomes true).

## Trading Path

- [ ] `getAvailableTickers()` returns non-empty tickers.
- [ ] `getPrice('BTC')` returns a numeric value.
- [ ] `buy(...)` succeeds with configured slippage.
- [ ] `getPositions()` returns opened position.
- [ ] `closePosition(...)` closes opened position.

## Deposit / Withdraw

- [ ] `deposit(amount >= 5)` switches to Arbitrum when needed.
- [ ] `deposit(...)` handles allowance + transfer flow and returns `txHash`.
- [ ] `withdraw(amount)` requests typed-data signature and succeeds.
- [ ] `withdraw(amount, destination)` sends to explicit destination.

## Regression Checks

- [ ] Privy login/session bootstrap still succeeds.
- [ ] Injected SIWE login/session bootstrap still succeeds.
- [ ] Runtime client enters world without startup regressions.
