// Proves what an app's screens are made of: the host copied from the registry's `mithaq-screens-host` item, and each
// screen's glob and route files written by `mithaq generate screens`.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { referencesIn, type ScreenClient } from '../packages/mithaq/src/screen/client.ts'
import { generateScreens } from '../packages/mithaq/src/screen/generate.ts'
import { asas } from '../templates/asas/src/asas.ts'
import { generate, locales } from '../templates/asas/src/mithaq.ts'

const template = new URL('../templates/asas/', import.meta.url)
const apps = new Map<string, string[]>()
for (const [screen, folder] of Object.entries(generate.screens)) apps.set(folder, [...(apps.get(folder) ?? []), screen])
const appOf = (folder: string) => new URL(folder.slice(0, folder.indexOf('src/')), template)
const generated = '// Written by `mithaq generate screens`. Do not edit.'

const filesUnder = async (folder: URL) =>
  (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(fileURLToPath(folder), join(entry.parentPath, entry.name)))
    .sort()

const hostFiles = async () => {
  const registry = JSON.parse(await readFile(new URL('../packages/mithaq-admin/registry.json', import.meta.url), 'utf8')) as {
    items: { name: string; files: { path: string; target: string }[] }[]
  }
  const host = registry.items.find((item) => item.name === 'mithaq-screens-host')
  assert.ok(host, 'the registry ships the screen host as an item')
  return host.files.map((file) => ({ source: new URL(`../packages/mithaq-admin/${file.path}`, import.meta.url), target: file.target.replace(/^~\//, '') }))
}

test('each app names no template path but the base a generated glob reads the project\'s files from: it reaches the template through the linked `asas` package otherwise', async () => {
  const offending: string[] = []
  for (const folder of apps.keys()) {
    const app = appOf(folder)
    for (const file of [...(await filesUnder(new URL('src/', app))).map((one) => `src/${one}`), 'vite.config.ts']) {
      if (!/\.(ts|tsx)$/.test(file)) continue
      // A glob's base is the project's real folder, which no package manager moves.
      const text = await readFile(new URL(file, app), 'utf8')
      const source = text.startsWith(generated) ? text.replaceAll(/\{ base: '[^']*'/g, '') : text
      // A quoted specifier or glob reaching into `templates/`; a citation in a comment is in backticks and is no import.
      if (/['"][^'"\n]*templates\/[^'"\n]*['"]/.test(source)) offending.push(`${folder} ${file}`)
    }
  }
  assert.deepEqual(offending, [])
})

for (const [folder, served] of apps) test(`rebuilds the committed app of ${served.join(' and ')} from the host item and generate screens, and what is left holds no screen code`, async (t) => {
  const app = appOf(folder)
  const host = await hostFiles()
  // The app's own tests are not drawn, and a copy would be swept by the next run's glob.
  const appFiles = (await filesUnder(new URL('src/', app))).filter((file) => !file.endsWith('.test.ts'))
  const isGenerated = async (file: string) => (await readFile(new URL(`src/${file}`, app), 'utf8')).startsWith(generated) || file.endsWith('screen.json')
  // The committed app with the host and the generated files taken out, and TanStack's route tree, which its first build writes.
  // A round trip of the committed app: it must be exactly the host item, the generated files and a skeleton with no screen code.
  const fresh = pathToFileURL(`${await mkdtemp(fileURLToPath(new URL('./.fresh-', import.meta.url)))}/`)
  t.after(() => rm(fresh, { recursive: true, force: true }))
  const skeleton: string[] = []
  for (const file of appFiles) {
    if (file === 'routeTree.gen.ts' || host.some((one) => one.target === `src/${file}`) || (await isGenerated(file))) continue
    skeleton.push(file)
    await cp(new URL(`src/${file}`, app), new URL(`src/${file}`, fresh))
  }
  for (const file of ['package.json', 'vite.config.ts', 'tsconfig.json', 'components.json']) await cp(new URL(file, app), new URL(file, fresh))
  assert.ok(skeleton.every((file) => !file.startsWith('routes/(screens)/')), 'what is left holds no route of any screen')
  for (const file of skeleton) {
    const source = await readFile(new URL(`src/${file}`, fresh), 'utf8')
    assert.doesNotMatch(source, /from '[^']*screens\.tsx'/, `${file} imports no screen code`)
  }

  // `shadcn add` of the host writes each file at its target, less a file the app deleted (the platform app has no landing page).
  for (const one of host) if (appFiles.includes(one.target.replace(/^src\//, ''))) await cp(one.source, new URL(one.target, fresh))
  const screens = Object.fromEntries(
    Object.entries(asas.targets as unknown as Record<string, { capability?: string; client?: ScreenClient }>)
      .filter(([name, target]) => target.capability === 'screen' && served.includes(name))
      .map(([name, target]) => [name, target.client!]),
  )
  const into = new URL(folder.slice(folder.indexOf('src/')), fresh)
  await generateScreens({ root: template, screens, into, locales })

  assert.deepEqual(await filesUnder(new URL('src/', fresh)), appFiles.filter((file) => file !== 'routeTree.gen.ts'), 'the same files')
  // Less the marker a copied file ends with, which names the commit the registry was built at and so moves with every commit.
  const unmarked = (text: string) => text.replace(/\n\/\/ mithaq-admin \S+ [0-9a-f]{64}\n$/, '\n')
  for (const file of appFiles.filter((one) => one !== 'routeTree.gen.ts')) {
    assert.equal(unmarked(await readFile(new URL(`src/${file}`, fresh), 'utf8')), unmarked(await readFile(new URL(`src/${file}`, app), 'utf8')), `src/${file}`)
  }
})

test('a screen naming files in three packages loads every component it names through its generated glob, the way the host loads one', async (t) => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-269-'))}/`)
  // The server Vite serves off the folder closes before the folder goes.
  let server: { ssrLoadModule: (url: string) => Promise<Record<string, unknown>>; close: () => Promise<void> } | undefined
  t.after(async () => {
    await server?.close()
    await rm(root, { recursive: true, force: true })
  })
  const app = new URL('apps/mobile/', root)
  const write = async (at: URL, text: string) => {
    await mkdir(new URL('./', at), { recursive: true })
    await writeFile(at, text)
  }
  await write(new URL('package.json', root), '{ "name": "portal-project" }\n')
  await write(new URL('src/shell.tsx', root), 'export const Home = () => null\nexport const Shell = () => null\n')
  await write(new URL('package.json', app), '{ "name": "mobile" }\n')
  await write(new URL('src/own.tsx', app), 'export const Own = () => null\n')
  await write(new URL('packages/centers/package.json', root), '{ "name": "@cr/centers" }\n')
  await write(new URL('packages/centers/src/center.tsx', root), 'export const Center = () => null\n')
  // Hoisted, as npm, yarn and a hoisted Bun link a workspace package: at the root, and nothing under the app.
  await mkdir(new URL('node_modules/@cr/', root), { recursive: true })
  await symlink(fileURLToPath(new URL('packages/centers/', root)), fileURLToPath(new URL('node_modules/@cr/centers', root)))
  // The project's own package prints bare in a reference; every other prints by its name.
  const screen = {
    path: '/portal',
    providers: [],
    pages: { home: { path: '/', component: './src/shell.tsx#Home' } },
    nav: [],
    layouts: { shell: './src/shell.tsx#Shell' },
    components: { own: 'mobile:./src/own.tsx#Own', center: '@cr/centers:./src/center.tsx#Center' },
    controls: {},
    kayan: {},
    maxLimit: 100,
  } as unknown as ScreenClient
  const into = new URL('src/routes/(screens)/', app)
  await generateScreens({ root, screens: { portal: screen }, into, locales })

  const vite = (await import(createRequire(new URL('./asas-tanstack/package.json', import.meta.url)).resolve('vite'))) as {
    createServer: (config: object) => Promise<NonNullable<typeof server>>
  }
  server = await vite.createServer({ root: fileURLToPath(app), configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } })
  const { files } = (await server.ssrLoadModule('/src/routes/(screens)/portal/files.ts')) as { files: Record<string, () => Promise<Record<string, unknown>>> }
  assert.deepEqual(Object.keys(files).sort(), ['./src/shell.tsx', '@cr/centers:./src/center.tsx', 'mobile:./src/own.tsx'], 'one key per file, as each reference prints it')
  const references = referencesIn(screen)
  assert.equal(references.length, 4, 'every reference, a named package\'s among them')
  for (const reference of references) {
    const at = reference.indexOf('#')
    assert.equal(typeof (await files[reference.slice(0, at)]?.())?.[reference.slice(at + 1)], 'function', reference)
  }
})
