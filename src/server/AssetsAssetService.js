import { hashFile } from '../core/utils-server'

export class AssetsAssetService {
  constructor() {
    this.url = process.env.ASSETS_BASE_URL
    this.dir = null
    this.kind = 'asset-service'
    this.serviceUrl = (
      process.env.ASSET_SERVICE_URL ||
      process.env.ASSETS_ASSET_SERVICE_URL ||
      process.env.GAME_ASSET_SERVICE_URL ||
      ''
    ).replace(/\/+$/, '')
    this.apiKey = (
      process.env.ASSET_SERVICE_API_KEY ||
      process.env.ASSETS_ASSET_SERVICE_API_KEY ||
      ''
    ).trim()
    if (!this.serviceUrl) {
      throw new Error('ASSET_SERVICE_URL or ASSETS_ASSET_SERVICE_URL is required when ASSETS=asset-service')
    }
    if (!this.apiKey) {
      throw new Error('ASSET_SERVICE_API_KEY or ASSETS_ASSET_SERVICE_API_KEY is required when ASSETS=asset-service')
    }
  }

  async init() {
    console.log('[assets] initializing asset-service backend')
    const response = await fetch(`${this.serviceUrl}/health`).catch(error => {
      throw new Error(`Failed to reach asset-service: ${error.message}`)
    })
    if (!response.ok) {
      throw new Error(`Failed to reach asset-service: ${response.status}`)
    }
  }

  async upload(file) {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const hash = await hashFile(buffer)
    const ext = file.name.split('.').pop().toLowerCase()
    const filename = `${hash}.${ext}`
    const response = await fetch(`${this.serviceUrl}/assets?filename=${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': file.type || 'application/octet-stream',
      },
      body: buffer,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      const message = result?.error || `asset_service_upload_failed:${response.status}`
      throw new Error(message)
    }
    if (result?.filename && result.filename !== filename) {
      throw new Error(`asset_service_filename_mismatch:${result.filename}`)
    }
  }

  async exists() {
    return false
  }

  async list() {
    return new Set()
  }

  async delete() {
    // asset-service assets are immutable and content-addressed; runtime cleanup is a no-op.
  }

  resolveServiceAssetUrl(filename) {
    const normalized = typeof filename === 'string' ? filename.trim().replace(/^\/+/, '') : ''
    if (!/^[a-f0-9]{64}\.[a-z0-9]+$/i.test(normalized)) return null
    return `${this.serviceUrl}/assets/${encodeURIComponent(normalized)}`
  }
}
