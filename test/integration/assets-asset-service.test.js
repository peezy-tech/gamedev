import assert from 'node:assert/strict'
import test from 'node:test'
import { hashFile } from '../../src/core/utils-server.js'

async function withEnv(env, fn) {
  const previousEnv = {}
  for (const key of Object.keys(env)) {
    previousEnv[key] = process.env[key]
    process.env[key] = env[key]
  }
  const previousFetch = globalThis.fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = previousFetch
    for (const key of Object.keys(env)) {
      if (previousEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previousEnv[key]
      }
    }
  }
}

test('asset-service backend uploads content-addressed runtime assets', async () => {
  await withEnv({
    ASSETS_BASE_URL: 'https://assets.example/assets',
    ASSET_SERVICE_URL: 'https://asset-service.internal',
    ASSET_SERVICE_API_KEY: 'asset-key',
  }, async () => {
    const calls = []
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ input: String(input), init })
      if (String(input).endsWith('/health')) {
        return Response.json({ ok: true })
      }
      const body = new Uint8Array(init.body)
      const hash = await hashFile(Buffer.from(body))
      return Response.json({
        sha256: hash,
        filename: `${hash}.js`,
        size: body.byteLength,
        contentType: init.headers['content-type'],
        assetUrl: `asset://${hash}.js`,
        url: `https://assets.example/assets/${hash}.js`,
        existed: false,
      }, { status: 201 })
    }

    const { AssetsAssetService } = await import('../../src/server/AssetsAssetService.js')
    const assets = new AssetsAssetService()
    assert.equal(assets.url, 'https://assets.example/assets')
    await assets.init()
    await assets.upload(new File(['console.log("hi")'], 'script.js', { type: 'text/javascript' }))

    assert.equal(calls[0].input, 'https://asset-service.internal/health')
    assert.match(calls[1].input, /^https:\/\/asset-service\.internal\/assets\?filename=[a-f0-9]{64}\.js$/)
    assert.equal(calls[1].init.method, 'PUT')
    assert.equal(calls[1].init.headers.authorization, 'Bearer asset-key')
    assert.equal(
      assets.resolveServiceAssetUrl('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.glb'),
      'https://asset-service.internal/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.glb'
    )
    assert.equal(assets.resolveServiceAssetUrl('avatar.vrm'), null)
    assert.equal(await assets.exists('anything.js'), false)
    assert.deepEqual(await assets.list(), new Set())
  })
})
