import path from 'node:path'

const WORKSPACE_PATHS = {
  '@gamedev/app-server': 'packages/app-server',
  '@gamedev/cli': 'packages/cli',
  '@gamedev/client': 'packages/client',
  '@gamedev/core': 'packages/core',
  '@gamedev/node-client': 'packages/node-client',
  '@gamedev/server': 'packages/server',
}

export function workspaceAliasPlugin(rootDir) {
  return {
    name: 'workspace-alias-plugin',
    setup(build) {
      build.onResolve({ filter: /^@gamedev\/(?:app-server|cli|client|core|node-client|server)(?:\/.*)?$/ }, args => {
        for (const [specifier, relativeDir] of Object.entries(WORKSPACE_PATHS)) {
          if (args.path !== specifier && !args.path.startsWith(`${specifier}/`)) {
            continue
          }
          const suffix = args.path === specifier ? 'index.js' : args.path.slice(specifier.length + 1)
          return {
            path: path.join(rootDir, relativeDir, suffix),
          }
        }
        return null
      })
    },
  }
}
