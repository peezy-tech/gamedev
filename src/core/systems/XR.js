import { System } from './System'
import * as THREE from '../extras/three'

/**
 * XR System
 *
 * - Runs on the client.
 * - Keeps track of XR sessions
 *
 */
export class XR extends System {
  constructor(world) {
    super(world)
    this.session = null
    this.sessionMode = null
    this.camera = null
    this.hasXR = false
    this.supportsVR = false
    this.supportsAR = false
  }

  async init() {
    this.hasXR = !!navigator.xr
    if (!this.hasXR) return
    this.supportsVR = await this.checkSupport('immersive-vr')
    this.supportsAR = await this.checkSupport('immersive-ar')
  }

  get isSupported() {
    return this.supportsVR || this.supportsAR
  }

  get preferredMode() {
    if (this.shouldPreferAR()) return 'immersive-ar'
    if (this.supportsVR) return 'immersive-vr'
    if (this.supportsAR) return 'immersive-ar'
    return null
  }

  async checkSupport(mode) {
    try {
      return !!(await navigator.xr?.isSessionSupported(mode))
    } catch (err) {
      console.error(err)
      console.error(`xr isSessionSupported(${mode}) failed`)
      return false
    }
  }

  shouldPreferAR() {
    if (!this.supportsAR) return false
    const userAgent = globalThis.navigator?.userAgent || ''
    const isAndroid = /Android/i.test(userAgent)
    const isHeadset = /OculusBrowser|Quest|PicoBrowser/i.test(userAgent)
    const isCoarsePointer = globalThis.matchMedia?.('(pointer: coarse)')?.matches ?? false
    return isAndroid && isCoarsePointer && !isHeadset
  }

  resolveMode(mode) {
    if (!mode || mode === 'auto') return this.preferredMode
    if (mode === 'immersive-vr' && this.supportsVR) return mode
    if (mode === 'immersive-ar' && this.supportsAR) return mode
    return null
  }

  getSessionOptions(mode) {
    if (mode === 'immersive-ar') {
      const options = {
        requiredFeatures: ['local'],
        optionalFeatures: ['dom-overlay'],
      }
      if (typeof document !== 'undefined') {
        options.domOverlay = { root: document.body }
      }
      return options
    }
    return {
      requiredFeatures: ['local-floor'],
    }
  }

  async start(mode) {
    return this.enter(mode)
  }

  async enter(mode = 'auto') {
    if (this.session) return this.session
    const sessionMode = this.resolveMode(mode)
    if (!sessionMode) return null
    const referenceSpaceType = sessionMode === 'immersive-ar' ? 'local' : 'local-floor'
    this.world.graphics.renderer.xr.setReferenceSpaceType(referenceSpaceType)
    this.world.graphics.renderer.xr.setFoveation(1)
    const session = await navigator.xr?.requestSession(sessionMode, this.getSessionOptions(sessionMode))
    if (!session) return null
    try {
      session.updateTargetFrameRate(72)
    } catch (err) {
      console.error(err)
      console.error('xr session.updateTargetFrameRate(72) failed')
    }
    this.world.graphics.renderer.xr.setSession(session)
    session.addEventListener('end', this.onSessionEnd)
    this.camera = this.world.graphics.renderer.xr.getCamera()
    this.session = session
    this.sessionMode = sessionMode
    this.world.emit('xrSession', session)
    return session
  }

  onSessionEnd = () => {
    this.session = null
    this.sessionMode = null
    this.world.emit('xrSession', null)
  }
}
