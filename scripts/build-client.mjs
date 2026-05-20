import 'dotenv-flow/config'

import { buildWorldClient, waitForWatch } from './vite-browser-builds.mjs'

const dev = process.argv.includes('--dev')

await buildWorldClient({ dev })

if (dev) {
  await waitForWatch()
}
