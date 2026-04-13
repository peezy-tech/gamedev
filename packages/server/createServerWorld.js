import { World } from '../core/World.js'

import { Server } from '../core/systems/Server.js'
import { ServerLiveKit } from '../core/systems/ServerLiveKit.js'
import { ServerLoader } from '../core/systems/ServerLoader.js'
import { ServerEnvironment } from '../core/systems/ServerEnvironment.js'
import { ServerMonitor } from '../core/systems/ServerMonitor.js'
import { ServerAIScripts } from '../core/systems/ServerAIScripts.js'
import { ServerAI } from '../core/systems/ServerAI.js'
import { EVM } from '../core/systems/EVMServer.js'
import { Hyperliquid } from '../core/systems/Hyperliquid.js'
import { ServerNetwork } from './ServerNetwork.js'

export function createServerWorld() {
  const world = new World()
  world.register('server', Server)
  world.register('livekit', ServerLiveKit)
  world.register('network', ServerNetwork)
  world.register('loader', ServerLoader)
  world.register('ai', ServerAI)
  world.register('aiScripts', ServerAIScripts)
  world.register('environment', ServerEnvironment)
  world.register('monitor', ServerMonitor)
  world.register('evm', EVM)
  world.register('hyperliquid', Hyperliquid)
  return world
}
