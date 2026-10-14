import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer, resolveConfig, type Plugin } from 'vite'
import { mithaqAdmin } from './vite.ts'

/**
 * A project with `mithaq-admin` installed as a real folder, or as a store does it: published as `@drhomet/mithaq-admin`
 * in a folder of its own and linked under the name the imports use, where a piece cannot reach its siblings by that name.
 */
const project = async (store = false) => {
  // The app in a folder of its own, so a store beside it is not reached by walking up from the package.
  const root = join(await mkdtemp(join(tmpdir(), 'mithaq-vite-')), 'app')
  const write = async (path: string, text: string) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), text)
  }
  await write('package.json', '{ "name": "probe", "type": "module" }')
  const at = store ? '../store/node_modules/@drhomet/mithaq-admin' : 'node_modules/mithaq-admin'
  await write(`${at}/package.json`, JSON.stringify({ name: store ? '@drhomet/mithaq-admin' : 'mithaq-admin', type: 'module', exports: { './package.json': './package.json', './*': './registry/*' } }))
  if (store) await mkdir(join(root, 'node_modules'), { recursive: true }).then(() => symlink(join(root, at), join(root, 'node_modules/mithaq-admin')))
  const counted = (who: string) => `globalThis.copyLoads = (globalThis.copyLoads ?? 0) + 1\nexport const who = '${who}'\n`
  await write(`${at}/registry/copy.ts`, counted('package'))
  await write(`${at}/registry/widget.ts`, "import { who } from 'mithaq-admin/copy.ts'\nexport const widget = `widget sees ${who}`\n")
  await write(`${at}/registry/list.ts`, "import { widget } from 'mithaq-admin/widget.ts'\nexport const list = `list holds ${widget}`\n")
  // A shell of the template, outside the app's root, which imports a piece the same way.
  await write('../template/app-shell.ts', "import { who } from 'mithaq-admin/copy.ts'\nexport const shell = who\n")
  await write('src/entry.ts', "import '../../template/app-shell.ts'\nimport { who } from 'mithaq-admin/copy.ts'\nimport { list } from 'mithaq-admin/list.ts'\nexport const seen = { who, list, loads: globalThis.copyLoads }\n")
  return { root, write, counted }
}

const load = async (root: string) => {
  const server = await createServer({ root, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, plugins: [mithaqAdmin(join(root, 'src/components/mithaq/'))] })
  try {
    delete (globalThis as { copyLoads?: number }).copyLoads
    return (await server.ssrLoadModule('/src/entry.ts')).seen as { who: string; list: string; loads: number }
  } finally {
    await server.close()
  }
}

/** Every URL a browser is sent for `copy.ts`, following the imports of the app, the template's shell and the pieces. */
const clientCopies = async (root: string) => {
  const server = await createServer({ root, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, plugins: [mithaqAdmin(join(root, 'src/components/mithaq/'))] })
  try {
    const seen = new Set<string>()
    const copies = new Set<string>()
    const queue = ['/src/entry.ts']
    for (let url = queue.pop(); url; url = queue.pop()) {
      if (seen.has(url)) continue
      seen.add(url)
      for (const [, imported] of (await server.transformRequest(url))!.code.matchAll(/(?:from |import )["']([^"']+)["']/g)) {
        if (/copy\.ts(\?|$)/.test(imported!)) copies.add(imported!)
        queue.push(imported!)
      }
    }
    assert.ok(seen.size >= 5, `the app, the shell and three pieces were transformed: ${[...seen].join(', ')}`)
    return [...copies]
  } finally {
    await server.close()
  }
}

test('on the client, the app, the shell of the template and the pieces are sent one URL for a piece, and the ejected file once there is one', async (t) => {
  const { root, write, counted } = await project(true)
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  const [shipped, ...others] = await clientCopies(root)
  assert.deepEqual(others, [])
  assert.match(shipped!, /\/store\/node_modules\/@drhomet\/mithaq-admin\/registry\/copy\.ts$/)
  await write('src/components/mithaq/copy.ts', counted('ejected'))
  assert.deepEqual(await clientCopies(root), ['/src/components/mithaq/copy.ts'])
})

test('a specifier that climbs out of the package is left to Vite, and an ejected file is named by its real path', async (t) => {
  const { root, write, counted } = await project()
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  await write('src/components/mithaq/copy.ts', counted('ejected'))
  await symlink(root, join(root, '../linked'))
  const resolveId = mithaqAdmin(join(root, '../linked/src/components/mithaq/')).resolveId as (source: string) => string | undefined
  assert.equal(resolveId('mithaq-admin/../../escape.ts'), undefined)
  assert.equal(resolveId('mithaq-admin/copy.ts'), await realpath(join(root, 'src/components/mithaq/copy.ts')))
})

test('with nothing ejected, every importer draws the package file', async (t) => {
  const { root } = await project()
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  assert.deepEqual(await load(root), { who: 'package', list: 'list holds widget sees package', loads: 1 })
})

test('an ejected file wins for the app and for every piece of the package that imports it, and loads once', async (t) => {
  const { root, write, counted } = await project()
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  await write('src/components/mithaq/copy.ts', counted('ejected'))
  assert.deepEqual(await load(root), { who: 'ejected', list: 'list holds widget sees ejected', loads: 1 })
})

test('in a store layout, where the package is published as @drhomet/mithaq-admin, its pieces still reach each other and an ejected file', async (t) => {
  const { root, write, counted } = await project(true)
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  assert.deepEqual(await load(root), { who: 'package', list: 'list holds widget sees package', loads: 1 })
  await write('src/components/mithaq/copy.ts', counted('ejected'))
  assert.deepEqual(await load(root), { who: 'ejected', list: 'list holds widget sees ejected', loads: 1 })
})

test('an ejected importer draws the package leaf it did not eject', async (t) => {
  const { root, write } = await project()
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  await write('src/components/mithaq/widget.ts', "import { who } from 'mithaq-admin/copy.ts'\nexport const widget = `own widget sees ${who}`\n")
  assert.deepEqual(await load(root), { who: 'package', list: 'list holds own widget sees package', loads: 1 })
})

test('what the pieces import is pre-bundled from the start, where the project has it installed and nothing excludes it', async (t) => {
  const { root, write } = await project()
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  for (const name of ['@scope/kit', 'plain', 'shunned', 'mithaq', 'primitive', 'deeper']) await write(`node_modules/${name}/package.json`, JSON.stringify({ name }))
  // A workspace package, linked: Vite serves it as source, and an include would stop the scan at it.
  await write('../linked/package.json', JSON.stringify({ name: 'linked' }))
  await symlink(join(root, '../linked'), join(root, 'node_modules/linked'))
  await write(
    'node_modules/mithaq-admin/registry/ui/avatar.tsx',
    [
      "import { Root } from '@scope/kit/avatar'",
      "import { Other } from '@scope/kit/avatar'",
      "import {\n  type Shape,\n  draw,\n} from 'plain'",
      "import 'plain/style'",
      "export { lexical } from 'missing-optional'",
      "import type { Only } from 'types-only'",
      "import { shunned } from 'shunned'",
      "import { source } from 'linked/admin'",
      // Its rich text needs Lexical, which a project without rich text has not installed.
      "import { safeUrl } from 'mithaq/rich-text'",
      // The app's own primitives, which the published package does not hold, through the app's alias.
      "import { Button } from '@/components/ui/button'",
      "import { who } from 'mithaq-admin/copy.ts'",
      "import { join } from 'node:path'",
      "const lazy = () => import('plain/lazy')",
    ].join('\n'),
  )
  await write('src/components/ui/button.tsx', "import { Primitive } from 'primitive/button'\nimport { deeper } from '../../lib/deeper'\n")
  await write('src/lib/deeper.ts', "import { more } from 'deeper'\n")
  // The defaults ejected into the language run on the server, never in the browser.
  await write('node_modules/mithaq-admin/registry/steps/step.ts', "import { conflict } from 'plain/server'\n")
  // A plugin after this one keeps a package out, as TanStack Start keeps its own.
  const shuns: Plugin = { name: 'shuns', configEnvironment: (name) => (name === 'client' ? { optimizeDeps: { exclude: ['shunned'] } } : undefined) }
  const resolve = { alias: [{ find: /^@\//, replacement: join(root, 'src/') }] }
  const { environments } = await resolveConfig({ root, configFile: false, logLevel: 'silent', resolve, plugins: [mithaqAdmin(join(root, 'src/components/mithaq/')), shuns] }, 'serve')
  assert.deepEqual(environments.client!.optimizeDeps.include, ['@scope/kit/avatar', 'deeper', 'plain', 'plain/style', 'primitive/button'])
  assert.deepEqual(environments.ssr!.optimizeDeps.include, [])
})

test('the package is kept out of pre-bundling, so a piece the app imports and the same piece a sibling imports are one module', async (t) => {
  const { root } = await project()
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  const plugin = mithaqAdmin(join(root, 'src/components/mithaq/'))
  assert.deepEqual((plugin.config as () => { optimizeDeps: unknown })().optimizeDeps, { exclude: ['mithaq-admin'] })
})
