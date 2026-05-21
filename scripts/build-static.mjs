/**
 * build-static.mjs - Builds a self-contained static client for GitHub Pages / CDN.
 *
 * No server required. The client boots into offline mode automatically
 * because PUBLIC_WS_URL is absent from the baked env.js.
 *
 * Usage:
 *   node scripts/build-static.mjs
 *
 * Env vars (optional):
 *   PUBLIC_WS_URL    Bake in a default server, e.g. wss://your-world.example.com/ws
 *
 * Output: build/static/  (ready to deploy or serve with: npx serve build/static)
 */
import 'dotenv-flow/config'

import { buildStaticClient } from './vite-browser-builds.mjs'

await buildStaticClient()
