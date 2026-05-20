import 'dotenv-flow/config'

import { buildViewer, waitForWatch } from './vite-browser-builds.mjs'

const dev = process.argv.includes('--dev')

await buildViewer({ dev })

if (dev) {
  await waitForWatch()
}
