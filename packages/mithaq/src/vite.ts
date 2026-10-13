import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Serves the admin's pieces from the installed `mithaq-admin`, and a file the project ejected into `ejected`
 * in place of the package's file of the same name, for every importer: the app, the package's own pieces and
 * other ejected files. Deleting the ejected file returns the project to the package's.
 */
export const mithaqAdmin = (ejected: string): Plugin => {
  // Resolved from the project, so a store layout finds the copy the project installed.
  const registry = join(dirname(createRequire(join(ejected, 'x')).resolve('mithaq-admin/package.json')), 'registry/')
  return {
    name: 'mithaq-admin',
    enforce: 'pre',
    // Pre-bundled, a piece the app imports and the same piece a sibling imports are two modules in dev.
    // ponytail: the dependency scan stops at an excluded package, so on a cold start (no `.vite` cache) what
    // only the pieces import (Lexical, TanStack Form, the app's primitives they draw) is optimized on the first
    // request, and the page reloads once. Scanning the registry as `optimizeDeps.entries` removes the reload,
    // but fails the whole scan where an optional peer is not installed; filter the entries by what resolves
    // if the reload starts to matter.
    // No `server.warmup` of the package: measured cold, it served the first page 0.7 s later and loaded the
    // client 1 s sooner, and it set the optimizer discovering dependencies no page asked for yet.
    config: () => ({ optimizeDeps: { exclude: ['mithaq-admin'] } }),
    async resolveId(source, importer, options) {
      const file = (await this.resolve(source, importer, { ...options, skipSelf: true }))?.id.split('?')[0]
      if (!file?.startsWith(registry)) return
      const own = join(ejected, relative(registry, file))
      return existsSync(own) ? own : file
    },
  }
}
