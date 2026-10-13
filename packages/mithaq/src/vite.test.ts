import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from 'vite'
import { mithaqAdmin } from './vite.ts'

/** A project with `mithaq-admin` installed as a real folder, whose pieces import each other by the package's name. */
const project = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mithaq-vite-'))
  const write = async (path: string, text: string) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), text)
  }
  await write('package.json', '{ "name": "probe", "type": "module" }')
  await write('node_modules/mithaq-admin/package.json', JSON.stringify({ name: 'mithaq-admin', type: 'module', exports: { './package.json': './package.json', './*': './registry/*' } }))
  const counted = (who: string) => `globalThis.copyLoads = (globalThis.copyLoads ?? 0) + 1\nexport const who = '${who}'\n`
  await write('node_modules/mithaq-admin/registry/copy.ts', counted('package'))
  await write('node_modules/mithaq-admin/registry/widget.ts', "import { who } from 'mithaq-admin/copy.ts'\nexport const widget = `widget sees ${who}`\n")
  await write('node_modules/mithaq-admin/registry/list.ts', "import { widget } from 'mithaq-admin/widget.ts'\nexport const list = `list holds ${widget}`\n")
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
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(await load(root), { who: 'package', list: 'list holds widget sees package', loads: 1 })
})

test('an ejected file wins for the app and for every piece of the package that imports it, and loads once', async (t) => {
  const { root, write, counted } = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  await write('src/components/mithaq/copy.ts', counted('ejected'))
  assert.deepEqual(await load(root), { who: 'ejected', list: 'list holds widget sees ejected', loads: 1 })
})

test('an ejected importer draws the package leaf it did not eject', async (t) => {
  const { root, write } = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  await write('src/components/mithaq/widget.ts', "import { who } from 'mithaq-admin/copy.ts'\nexport const widget = `own widget sees ${who}`\n")
  assert.deepEqual(await load(root), { who: 'package', list: 'list holds own widget sees package', loads: 1 })
})

test('the package is kept out of pre-bundling, so a piece the app imports and the same piece a sibling imports are one module', async (t) => {
  const { root } = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  const plugin = mithaqAdmin(join(root, 'src/components/mithaq/'))
  assert.deepEqual((plugin.config as () => { optimizeDeps: unknown })().optimizeDeps, { exclude: ['mithaq-admin'] })
})
