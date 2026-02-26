# Hyperliquid

Trade perpetual futures on Hyperliquid from client scripts.

```js
const hl = world.hyperliquid()
```

## Methods

### `getPrice(ticker)`

Returns the current mid price.

### `getBalance()`

Returns account value in USD.

### `getPositions()`

Returns open positions:

```js
[
  {
    ticker: 'BTC',
    size: 0.001,
    entryPrice: 104000,
    unrealizedPnl: 5.25,
    liquidationPrice: 95000,
  },
]
```

### `getAvailableTickers()`

Returns a sorted ticker list available for trading.

### `buy(ticker, amount, slippage = 1)`

Places an IOC buy order.

### `sell(ticker, amount, slippage = 1)`

Places an IOC sell order.

### `closePosition(ticker, slippage = 1)`

Closes the full open position for a ticker.

### `hasAgentKey()`

Returns whether an agent key is already stored for the connected wallet.

### `setupAgentKey(name = 'HyperfyAgent')`

Creates and approves an agent key for trading.

### `deposit(amount)`

Deposits Arbitrum USDC to Hyperliquid.

Notes:
- Minimum is 5 USDC.
- Uses Arbitrum USDC (`0xaf88...5831`).
- May require approval + transfer signatures.

### `withdraw(amount, destination?)`

Withdraws USDC from Hyperliquid to Arbitrum.

Notes:
- Uses main wallet signature (not agent key).
- Defaults to connected wallet address when `destination` is omitted.

## Example

```js
if (world.isClient) {
  const hl = world.hyperliquid()

  if (!hl.hasAgentKey()) {
    await hl.setupAgentKey()
  }

  const price = await hl.getPrice('BTC')
  console.log('BTC', price)

  await hl.buy('BTC', 0.001)
  await hl.closePosition('BTC')
}
```
