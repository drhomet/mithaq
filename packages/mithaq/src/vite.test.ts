import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from 'vite'
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
  await write('src/entry.ts', "import { who } from 'mithaq-admin/copy.ts'\nimport { list } from 'mithaq-admin/list.ts'\nexport const seen = { who, list, loads: globalThis.copyLoads }\n")
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

test('the package is kept out of pre-bundling, so a piece the app imports and the same piece a sibling imports are one module', async (t) => {
  const { root } = await project()
  t.after(() => rm(join(root, '..'), { recursive: true, force: true }))
  const plugin = mithaqAdmin(join(root, 'src/components/mithaq/'))
  assert.deepEqual((plugin.config as () => { optimizeDeps: unknown })().optimizeDeps, { exclude: ['mithaq-admin'] })
})
