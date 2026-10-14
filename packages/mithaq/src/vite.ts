import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { normalizePath, type Alias, type AliasOptions, type Plugin } from 'vite'

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
    // No `server.warmup` of the package: measured cold, it served the first page 0.7 s later and loaded the
    // client 1 s sooner, and it set the optimizer discovering dependencies no page asked for yet.
    config: () => ({ optimizeDeps: { exclude: ['mithaq-admin'] } }),
    // The dependency scan stops at the excluded package, so what only the pieces import (Lexical, TanStack Form, and
    // through the app's own primitives, Base UI) would be found by the first page that needs it, re-optimized mid-page
    // into a second React, and the page reloaded. Named up front instead, but only what the project installed from a
    // registry: an optional peer it left out (Lexical without rich text) fails the whole optimization, and a linked
    // workspace package is served as source, where an include would stop the scan finding what it imports. And only
    // what nothing excludes, since an include wins over an exclude: last, after every plugin has named its own.
    configEnvironment: { order: 'post', handler(name, { optimizeDeps, resolve }) {
      if (name !== 'client') return
      const excluded = optimizeDeps?.exclude ?? []
      const folders = createRequire(join(ejected, 'x')).resolve.paths('x') ?? []
      const alias = (resolve as { alias?: AliasOptions } | undefined)?.alias ?? []
      const aliases = Array.isArray(alias) ? (alias as readonly Alias[]) : Object.entries(alias).map(([find, replacement]) => ({ find, replacement }))
      /** The file of the app's a relative or aliased specifier names, '' where none is, or nothing for a package. */
      const local = (specifier: string, from: string) => {
        const entry = aliases.find(({ find }) => (typeof find === 'string' ? specifier === find || specifier.startsWith(`${find}/`) : find.test(specifier)))
        const path = specifier.startsWith('.') ? join(dirname(from), specifier) : entry && specifier.replace(entry.find, entry.replacement)
        return path === undefined ? undefined : (['', '.tsx', '.ts'].map((extension) => path + extension).find((file) => statSync(file, { throwIfNoEntry: false })?.isFile()) ?? '')
      }
      // The pieces, and the app's own files they reach, such as the primitives the published package leaves out.
      // What a project ejects into its language package (mail, steps, storage) runs on the server alone.
      const files = new Set(readdirSync(registry, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && !/^(mail|steps|storage)\//.test(normalizePath(file))).map((file) => join(registry, file)))
      const imports = new Set<string>()
      for (const file of files) {
        // ponytail: a regex over the source, which a ` from '...'` inside a string or a comment fools into one more
        // include; parse the files if a piece ever reads that way.
        for (const [, type, specifier] of readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s+(type\s)?(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)) {
          if (type) continue
          const found = local(specifier!, file)
          if (found) files.add(found)
          else if (found === undefined) imports.add(specifier!)
        }
      }
      const include = [...imports].filter((specifier) => {
        // `mithaq` too, which the app's own code imports, so the scan finds it: named here, its rich text would be
        // bundled where no Lexical is installed.
        if (/^(\/|node:|mithaq(\/|$))/.test(specifier)) return false
        const pkg = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
        const installed = folders.map((folder) => join(folder, pkg)).find((folder) => existsSync(join(folder, 'package.json')))
        return !excluded.includes(pkg) && !excluded.includes(specifier) && !!installed && normalizePath(realpathSync(installed)).includes('/node_modules/')
      })
      return { optimizeDeps: { include: include.sort() } }
    } },
    // By the specifier, not by resolving it: published as `@drhomet/mithaq-admin`, a piece in a store's folder cannot
    // reach `mithaq-admin/<file>` by walking up, so the plugin answers for every importer.
    resolveId(source) {
      const [, file] = /^mithaq-admin\/(.+\.tsx?)$/.exec(source) ?? []
      // A piece names a sibling by its file alone, so a climb out of the package is no import of ours.
      if (!file || file.split('/').includes('..')) return
      const own = join(ejected, file)
      // The real path, as Vite names every other module, so a symlinked folder is never a second module.
      return normalizePath(existsSync(own) ? realpathSync(own) : join(registry, file))
    },
  }
}
