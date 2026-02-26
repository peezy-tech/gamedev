# EVM

Access EVM wallet status from scripts.

```js
const evm = world.evm()
```

## Methods

### `getAddress()`

Returns the connected EVM wallet address, or `null` when not connected.

```js
const address = evm.getAddress()
```

### `isConnected()`

Returns `true` when an EVM wallet is connected.

```js
if (evm.isConnected()) {
  console.log(evm.getAddress())
}
```
