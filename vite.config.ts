import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

const fromRoot = (value: string) => fileURLToPath(new URL(value, import.meta.url))

export default defineConfig({
  plugins: [
    react({
      include: [/packages\/client\/.*\.js$/],
      jsxImportSource: '@firebolt-dev/jsx',
    }),
  ],
  resolve: {
    alias: {
      '@gamedev/app-server': fromRoot('./packages/app-server'),
      '@gamedev/client': fromRoot('./packages/client'),
      '@gamedev/core': fromRoot('./packages/core'),
      '@gamedev/node-client': fromRoot('./packages/node-client'),
      '@gamedev/server': fromRoot('./packages/server'),
    },
  },
  test: {
    include: ['test/integration/**/*.test.js'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
  lint: {
    ignorePatterns: [
      'build/**',
      '.codex-status/**',
      'node_modules/**',
      'packages/core/libs/**',
      'packages/core/physx-js-webidl.js',
      'packages/core/physx-js-webidl.wasm',
    ],
    rules: {
      'no-console': 'warn',
      'no-var': 'warn',
      'no-unused-vars': 'warn',
    },
  },
  fmt: {
    ignorePatterns: [
      'build/**',
      '.codex-status/**',
      'node_modules/**',
      'packages/core/libs/**',
      'packages/core/physx-js-webidl.js',
      'packages/core/physx-js-webidl.wasm',
    ],
    semi: false,
    singleQuote: true,
    jsxSingleQuote: true,
    trailingComma: 'es5',
    arrowParens: 'avoid',
    printWidth: 120,
  },
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
  },
})
