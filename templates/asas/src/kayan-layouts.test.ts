// mithaq draws no line from a kayan's own file to where its `ui()` files live: a
// kayan reaches its screen pieces through `folderOf(new URL('./ui/',
// import.meta.url))` off wherever its own module sits, so a kayan may sit flat,
// in its folder inside a feature of one package, or in a feature package of its
// own, and `generate screens` builds and writes each the same way.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { run } from 'mithaq/generate-screens'

/**
 * A project with two kayan wired into one screen: `flatKayan` sits under a
 * shared `src/kayan/` folder and points at a shared `src/ui/` folder; `widget`
 * sits in its folder in the `widget` feature, `src/features/widget/widget/`, with
 * its own `ui/` folder beside it. The fixture is written beside this file rather than in the
 * system's temp directory, so resolving `mithaq` from it walks up to this
 * template's own `node_modules` and needs no install of its own.
 */
const project = async () => {
  const root = pathToFileURL(`${await mkdtemp(fileURLToPath(new URL('./kayan-layouts-', import.meta.url)))}/`)
  const write = async (path: string, text: string) => {
    await mkdir(new URL('./', new URL(path, root)), { recursive: true })
    await writeFile(new URL(path, root), text)
  }
  await write('package.json', '{ "name": "kayan-layouts-fixture", "private": true, "type": "module" }')
  await write(
    'src/mithaq.ts',
    `import { defaultMaxBodyBytes, screenKinds, defaultAuthorize, defaultDepth, defaultLimit, defaultMaxLimit, defaultJoinLimit, defaultBulkLimit, base, defineMithaq, drizzleAdapter, drizzleKinds, drizzleRules, drizzleIdKinds, folderOf, screenTarget, serviceTarget, zodKinds, zodRules, zodIdKinds, zodTarget } from 'mithaq'
export const ui = folderOf(new URL('./ui/', import.meta.url))
const language = defineMithaq({
  locales: ['en'] as const,
  arkan: [base],
  targets: {
    // node-postgres opens no socket until the first query, so a connection
    // string nothing can reach costs this fixture nothing
    // (\`packages/mithaq/src/drizzle/index.ts\` \`const opened =\`).
    drizzle: drizzleAdapter({ connectionString: 'postgresql://user:pass@localhost:1/fixture', kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    dashboard: screenTarget({
      path: '/dashboard',
      controls: screenKinds,
      providers: [],
      pages: { home: { path: '/', component: ui('panel.tsx#Panel') } },
      layouts: {},
      components: {},
      kayan: ['flatKayan', 'widget'],
    }),
  },
  generate: { screens: 'src/routes/(screens)/' },
})
export const { defineKayan, buildAsas, generate, locales } = language
`,
  )
  await write('src/ui/panel.tsx', 'export const Panel = () => null\n')
  await write(
    'src/kayan/flat-kayan.ts',
    `import { defaultFields } from 'mithaq'
import { defineKayan, ui } from '../mithaq.ts'
export const flatKayan = defineKayan({
  name: 'flatKayan',
  fields: { ...defaultFields },
  targets: { dashboard: { pages: { list: { path: '/flat', component: ui('panel.tsx#Panel') } } } },
})
`,
  )
  await write(
    'src/features/widget/widget/widget.ts',
    `import { defaultFields, folderOf } from 'mithaq'
import { defineKayan } from '../../../mithaq.ts'
const ui = folderOf(new URL('./ui/', import.meta.url))
export const widget = defineKayan({
  name: 'widget',
  fields: { ...defaultFields },
  targets: { dashboard: { pages: { list: { path: '/widget', component: ui('thing.tsx#Thing') } } } },
})
`,
  )
  await write('src/features/widget/widget/ui/thing.tsx', 'export const Thing = () => null\n')
  await write('src/features/widget/index.ts', "import { widget } from './widget/widget.ts'\nexport const kayan = [widget] as const\n")
  await write(
    'src/asas.ts',
    `import { defaultMaxBodyBytes, fetchHttp } from 'mithaq'
import { buildAsas } from './mithaq.ts'
import { flatKayan } from './kayan/flat-kayan.ts'
import * as widget from './features/widget/index.ts'
export const asas = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [flatKayan, ...widget.kayan] })
`,
  )
  return root
}

test('a flat kayan and a feature-folder kayan build and generate screens alike, and a check right after is clean for both', async (t) => {
  const root = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(await run(root, false), 0, 'the first run writes the screen with nothing stale to report')
  const screen = JSON.parse(await readFile(new URL('src/routes/(screens)/dashboard/screen.json', root), 'utf8')) as {
    kayan: Record<string, { pages: Record<string, { component: string }> }>
  }
  assert.equal(screen.kayan.flatKayan!.pages.list!.component, './src/ui/panel.tsx#Panel', "the flat kayan's page names the shared folder")
  assert.equal(screen.kayan.widget!.pages.list!.component, './src/features/widget/widget/ui/thing.tsx#Thing', "the feature-folder kayan's page names its own folder")
  assert.equal(await run(root, true), 0, 'a check right after generating is clean for both layouts')
})

/**
 * The three steps as packages: the language, a feature holding one kayan with its own `ui/`, and the asas that builds
 * them, with an app that depends on the asas alone, as pnpm and Bun's isolated install link it. Each package is
 * linked by hand where its dependents' `node_modules` would hold it.
 */
const packages = async () => {
  const root = pathToFileURL(`${await mkdtemp(fileURLToPath(new URL('./kayan-layouts-', import.meta.url)))}/`)
  const write = async (path: string, text: string) => {
    await mkdir(new URL('./', new URL(path, root)), { recursive: true })
    await writeFile(new URL(path, root), text)
  }
  const manifest = (name: string, entry?: string) => JSON.stringify({ name, private: true, type: 'module', ...(entry && { exports: { '.': entry } }) })
  const link = async (from: string, name: string, to: string) => {
    await mkdir(new URL(`${from}/node_modules/@fixture/`, root), { recursive: true })
    await symlink(fileURLToPath(new URL(to, root)), fileURLToPath(new URL(`${from}/node_modules/@fixture/${name}`, root)), 'dir')
  }
  await write('package.json', manifest('fixture-root'))
  await write('packages/mithaq/package.json', manifest('@fixture/mithaq', './src/mithaq.ts'))
  await write(
    'packages/mithaq/src/mithaq.ts',
    `import { screenKinds, defaultAuthorize, defaultDepth, defaultLimit, defaultMaxLimit, defaultJoinLimit, defaultBulkLimit, base, defineMithaq, drizzleAdapter, drizzleKinds, drizzleRules, drizzleIdKinds, folderOf, screenTarget, serviceTarget, zodKinds, zodRules, zodIdKinds, zodTarget } from 'mithaq'
// The screens' own pieces sit in the asas, which the language names by path and never imports.
const ui = folderOf(new URL('../../asas/src/ui/', import.meta.url))
const language = defineMithaq({
  locales: ['en'] as const,
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://user:pass@localhost:1/fixture', kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    dashboard: screenTarget({ path: '/dashboard', controls: screenKinds, providers: [], pages: { home: { path: '/', component: ui('panel.tsx#Panel') } }, layouts: {}, components: {}, kayan: ['widget'] }),
  },
  generate: { screens: '../../apps/web/src/routes/(screens)/' },
})
export const { defineKayan, buildAsas, generate, locales, targets } = language
`,
  )
  await write('packages/features/widget/package.json', manifest('@fixture/widget', './index.ts'))
  await write('packages/features/widget/index.ts', "import { widget } from './widget/widget.ts'\nexport const kayan = [widget] as const\n")
  await write(
    'packages/features/widget/widget/widget.ts',
    `import { defaultFields, folderOf } from 'mithaq'
import { defineKayan } from '@fixture/mithaq'
const ui = folderOf(new URL('./ui/', import.meta.url))
export const widget = defineKayan({
  name: 'widget',
  fields: { ...defaultFields },
  targets: { dashboard: { pages: { list: { path: '/widget', component: ui('thing.tsx#Thing') } } } },
})
`,
  )
  await write('packages/features/widget/widget/ui/thing.tsx', 'export const Thing = () => null\n')
  await write('packages/asas/package.json', manifest('@fixture/asas', './src/asas.ts'))
  await write('packages/asas/src/mithaq.ts', "export { defineKayan, generate, locales, targets } from '@fixture/mithaq'\n")
  await write(
    'packages/asas/src/asas.ts',
    `import { defaultMaxBodyBytes, fetchHttp } from 'mithaq'
import { buildAsas } from '@fixture/mithaq'
import * as widget from '@fixture/widget'
export const asas = buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [...widget.kayan] })
`,
  )
  await write('packages/asas/src/ui/panel.tsx', 'export const Panel = () => null\n')
  await write('apps/web/package.json', manifest('web'))
  await link('packages/features/widget', 'mithaq', 'packages/mithaq')
  await link('packages/asas', 'mithaq', 'packages/mithaq')
  await link('packages/asas', 'widget', 'packages/features/widget')
  await link('apps/web', 'asas', 'packages/asas')
  return root
}

test('a feature package\'s kayan draws its own ui/ through the asas when the app links the asas alone, and a check right after is clean', async (t) => {
  const root = await packages()
  t.after(() => rm(root, { recursive: true, force: true }))
  const asas = new URL('packages/asas/', root)
  assert.equal(await run(asas, false), 0, 'the first run writes the screen')
  const screen = JSON.parse(await readFile(new URL('apps/web/src/routes/(screens)/dashboard/screen.json', root), 'utf8')) as {
    kayan: Record<string, { pages: Record<string, { component: string }> }>
  }
  assert.equal(screen.kayan.widget!.pages.list!.component, '@fixture/widget:./widget/ui/thing.tsx#Thing', "the feature's page names its package and its own folder")
  const files = await readFile(new URL('apps/web/src/routes/(screens)/dashboard/files.ts', root), 'utf8')
  assert.match(files, /named\('@fixture\/widget', import\.meta\.glob\(\['\.\/widget\/ui\/thing\.tsx'\], \{ base: '(\.\.\/)+packages\/features\/widget\/', exhaustive: true \}\)\)/, 'read where the workspace holds it')
  assert.equal(await run(asas, true), 0, 'a check right after generating is clean')
})
