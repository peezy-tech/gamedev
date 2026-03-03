# EVM

Access EVM wallet utilities from scripts.

```js
const evm = world.evm()
```

## Methods

### `getAddress()`

Returns the connected EVM wallet address, or `null` when not connected.

### `isConnected()`

Returns `true` when an EVM wallet is connected.

### `getNativeBalance(address?)`

Returns native token balance for the provided address (or active wallet) as a number.

### `getTokenBalance(tokenAddress, address?, decimals = 18)`

Returns ERC-20 token balance as a number.

### `getUSDCBalance(address?)`

Returns Arbitrum USDC balance (`0xaf88...5831`) as a number.

### `transferNative(to, amount)`

Sends native token to an address.

- `to`: recipient address
- `amount`: decimal amount as number or string

Returns:

```js
{ hash, receipt }
```

### `transferToken(tokenAddress, to, amount, decimals = 18)`

Sends ERC-20 tokens to an address.

Returns:

```js
{ hash, receipt }
```

### `transferUSDC(to, amount)`

Sends Arbitrum USDC (`0xaf88...5831`) using 6 decimals.

Returns:

```js
{ hash, receipt }
```

## Example

```js
if (world.isClient) {
  const evm = world.evm()
  if (!evm.isConnected()) return

  const usdc = await evm.getUSDCBalance()
  console.log('USDC', usdc)

  await evm.transferUSDC('0x1234567890abcdef1234567890abcdef12345678', '1.5')
}
```
