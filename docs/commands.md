# Commands

There are a few commands that can be used by entering them in the chat.

### `/admin <code>`

If your world has an admin code set, the only way to become an admin is to use this command with your code (see your .env file).

If your .env doesn't have an ADMIN_CODE set, then all players are treated as an admin.

### `/spawn set`

Sets the spawn point for all future players entering the world, to the current position and direction you are facing. Requires builder rank.

### `/spawn clear`

Resets the spawn point back to origin. Requires builder rank.

### `/name <name>`

Sets your player name.

### `/chat clear`

Clears all chat messages. Requires builder rank. 

## Script commands

App scripts can listen for slash commands through `world.on('command', callback)`.

The callback receives:

- `playerId`
- `cmd`
- `value`
- `args`

Example:

```javascript
export default (world, app) => {
  function onCommand({ playerId, cmd, args }) {
    if (!world.isServer) return
    if (cmd !== 'tower') return

    const market = args[2]
    if (!market) return

    app.sendTo(playerId, 'towerCommand', { market })
  }

  world.on('command', onCommand)
  app.on('destroy', () => {
    world.off('command', onCommand)
  })
}
```

Notes:

- Slash commands are global. There is no per-app registration API in scripts right now, so choose unique command names and filter inside your handler.
- For reliable gameplay logic, handle commands on the server.
- Built-in runtime commands such as `/admin`, `/name`, and `/spawn` are reserved.
