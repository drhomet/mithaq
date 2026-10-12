// mithaq draws no line from a kayan's own file to where its `ui()` files live: a
// kayan reaches its screen pieces through `folderOf(new URL('./ui/',
// import.meta.url))` off wherever its own module sits, so a project may keep a
// kayan flat, in its own feature folder, or mix the two, and `generate screens`
// builds and writes exactly the same either way.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { run } from 'mithaq/generate-screens'

/**
 * A project with two kayan wired into one screen: `flatKayan` sits under a
 * shared `src/kayan/` folder and points at a shared `src/ui/` folder; `widget`
 * sits in its own feature folder, `src/widget/`, with its own `src/widget/ui/`
 * folder beside it. The fixture is written beside this file rather than in the
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
    `import { screenKinds, defaultAuthorize, defaultDepth, defaultLimit, defaultMaxLimit, defaultJoinLimit, defaultBulkLimit, base, defineMithaq, drizzleAdapter, drizzleTarget, folderOf, screenTarget, serviceTarget, zodTarget } from 'mithaq'
export const ui = folderOf(new URL('./ui/', import.meta.url))
const language = defineMithaq({
  locales: ['en'] as const,
  arkan: [base],
  targets: {
    // node-postgres opens no socket until the first query, so a connection
    // string nothing can reach costs this fixture nothing
    // (\`packages/mithaq/src/drizzle/index.ts\` \`const opened =\`).
    drizzle: drizzleAdapter({ connectionString: 'postgresql://user:pass@localhost:1/fixture', ...drizzleTarget }),
    zod: zodTarget,
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
    'src/widget/widget.ts',
    `import { defaultFields, folderOf } from 'mithaq'
import { defineKayan } from '../mithaq.ts'
const ui = folderOf(new URL('./ui/', import.meta.url))
export const widget = defineKayan({
  name: 'widget',
  fields: { ...defaultFields },
  targets: { dashboard: { pages: { list: { path: '/widget', component: ui('thing.tsx#Thing') } } } },
})
`,
  )
  await write('src/widget/ui/thing.tsx', 'export const Thing = () => null\n')
  await write(
    'src/asas.ts',
    `import { fetchHttp } from 'mithaq'
import { buildAsas } from './mithaq.ts'
import { flatKayan } from './kayan/flat-kayan.ts'
import { widget } from './widget/widget.ts'
export const asas = buildAsas({ http: [fetchHttp()], kayan: [flatKayan, widget] })
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
  assert.equal(screen.kayan.widget!.pages.list!.component, './src/widget/ui/thing.tsx#Thing', "the feature-folder kayan's page names its own folder")
  assert.equal(await run(root, true), 0, 'a check right after generating is clean for both layouts')
})
