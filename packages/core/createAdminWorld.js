import { World } from './World.js'

import { Client } from './systems/Client.js'
import { ClientPointer } from './systems/ClientPointer.js'
import { ClientPrefs } from './systems/ClientPrefs.js'
import { ClientControls } from './systems/ClientControls.js'
import { AdminNetwork } from './systems/AdminNetwork.js'
import { AdminClient } from './systems/AdminClient.js'
import { ClientLoader } from './systems/ClientLoader.js'
import { ClientCSS } from './systems/ClientCSS.js'
import { ClientGraphics } from './systems/ClientGraphics.js'
import { ClientEnvironment } from './systems/ClientEnvironment.js'
import { ClientAudio } from './systems/ClientAudio.js'
import { ClientStats } from './systems/ClientStats.js'
import { AdminBuilder } from './systems/AdminBuilder.js'
import { ClientActions } from './systems/ClientActions.js'
import { ClientTarget } from './systems/ClientTarget.js'
import { ClientUI } from './systems/ClientUI.js'
import { LODs } from './systems/LODs.js'
import { Nametags } from './systems/Nametags.js'
import { Particles } from './systems/Particles.js'
import { Snaps } from './systems/Snaps.js'
import { Wind } from './systems/Wind.js'
import { AdminXR } from './systems/AdminXR.js'
import { AdminLiveKit } from './systems/AdminLiveKit.js'

import { FreeCam } from './entities/FreeCam.js'
import { AdminLocalPlayer } from './entities/AdminLocalPlayer.js'

export function createAdminWorld() {
  const world = new World()
  world.isAdminClient = true

  world.register('client', Client)
  world.register('livekit', AdminLiveKit)
  world.register('pointer', ClientPointer)
  world.register('prefs', ClientPrefs)
  world.register('controls', ClientControls)
  world.register('network', AdminNetwork)
  world.register('admin', AdminClient)
  world.register('loader', ClientLoader)
  world.register('css', ClientCSS)
  world.register('graphics', ClientGraphics)
  world.register('environment', ClientEnvironment)
  world.register('audio', ClientAudio)
  world.register('stats', ClientStats)
  world.register('builder', AdminBuilder)
  world.register('actions', ClientActions)
  world.register('target', ClientTarget)
  world.register('ui', ClientUI)
  world.register('lods', LODs)
  world.register('nametags', Nametags)
  world.register('particles', Particles)
  world.register('snaps', Snaps)
  world.register('wind', Wind)
  world.register('xr', AdminXR)

  world.adminNetwork = world.network

  const adminPlayer = new AdminLocalPlayer(world, { id: world.network.id })
  world.entities.player = adminPlayer
  world.adminPlayer = adminPlayer
  world.emit('player', adminPlayer)

  const baseInit = world.init.bind(world)
  world.init = async options => {
    await baseInit(options)
    if (!world.freeCam) {
      world.freeCam = new FreeCam(world)
    }
  }

  return world
}
