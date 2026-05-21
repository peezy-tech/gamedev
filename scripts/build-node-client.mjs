import 'dotenv-flow/config'

import { buildNodeClientPack } from './vite-node-builds.mjs'

await buildNodeClientPack({ dev: process.argv.includes('--dev') })
