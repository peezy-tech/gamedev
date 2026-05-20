import 'dotenv-flow/config'

import { buildPlatformClient } from './vite-browser-builds.mjs'
import { buildRuntimePacks } from './vite-node-builds.mjs'

const dev = process.argv.includes('--dev')
const clientOnly = process.argv.includes('--client-only')

/**
 * Build Client
 */

{
  await buildPlatformClient({ dev })
  if (!dev && clientOnly) {
    process.exit(0)
  }
}

/**
 * Build Server
 */

if (!clientOnly) {
  await buildRuntimePacks({ dev })
}
