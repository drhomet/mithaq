import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  screenKinds,
  defaultAuthorize,
  defaultDepth,
  defaultLimit,
  defaultMaxLimit,
  defaultJoinLimit,
  defaultBulkLimit,
  defaultFields,
  defaultKinds,
  defaultOperations,
  defaultRules,
  base,
  defineMithaq,
  defineRukn,
  folderOf,
  screenTarget,
  serviceTarget,
  zodTarget,
  fetchHttp,
} from 'mithaq'
import { referencesIn, studioText, studioTree } from 'mithaq/admin'
import { generateScreens } from 'mithaq/generate-screens'
import { z } from 'zod'
import { asas } from './asas.ts'
import { generate } from '../../mithaq/src/mithaq.ts'
import { memoryStore } from './memory-store.ts'

// Every build here names the template's own files, because `buildAsas` reads each
// file a screen names off its `ui()` URL; the in-memory store needs no database.
const ui = folderOf(new URL('../../mithaq/src/ui/', import.meta.url))
const dashboardUi = folderOf(new URL('./ui-dashboard/', import.meta.url))
const portalUi = folderOf(new URL('./ui-portal/', import.meta.url))
// `courses` keeps its page pieces beside its kayan file, not in `ui-dashboard/`.
const coursesUi = folderOf(new URL('../../features/courses/courses/ui/', import.meta.url))
const dashboardBase = {
  path: '/dashboard',
  controls: screenKinds,
  providers: [],
  pages: { dashboard: { path: '/', component: dashboardUi('dashboard.tsx#Dashboard') } },
  layouts: { dashboard: ui('app-shell.tsx#AppShell'), record: ui('record-page.tsx#RecordPage'), table: ui('table-page.tsx#TablePage') },
  components: { summaryBox: coursesUi('fee-cell.tsx#FeeCell'), noCourses: coursesUi('no-courses.tsx#NoCourses') },
}
const portalBase = {
  path: '/portal',
  controls: screenKinds,
  providers: [],
  pages: { home: { path: '/', component: portalUi('home.tsx#Home') } },
  layouts: { portal: ui('top-shell.tsx#TopShell') },
  components: {},
}
const screens = (extra: Record<string, unknown> = {}) =>
  defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget,
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
      dashboard: screenTarget({ ...dashboardBase, kayan: ['courses'] }),
      portal: screenTarget({ ...portalBase, kayan: ['courses'] }),
      ...extra,
    },
  })

const label = { ar: 'حول', en: 'About' }
const archive = { ar: 'أرشفة', en: 'Archive' }

/** One kayan whose screen blocks a test overrides, and the build that holds it. */
const build = (dashboard: unknown, portal?: unknown, extra?: Record<string, unknown>, operations?: Record<string, unknown>) => {
  const language = screens(extra)
  return language.buildAsas({
    http: [fetchHttp()],
    kayan: [
      language.defineKayan({
        name: 'courses',
        fields: {
          ...defaultFields,
          title: { kind: 'text', description: { ar: 'الاسم', en: 'The name' }, placeholder: { ar: 'مثال', en: 'Example' } },
          summary: { kind: 'text', targets: { dashboard: { component: 'otp' } } },
          currency: {
            kind: 'text',
            options: [
              { value: 'SAR', label: { ar: 'ريال', en: 'Riyal' } },
              { value: 'USD', label: { ar: 'دولار', en: 'Dollar' } },
            ],
            targets: { dashboard: { component: 'select' }, portal: { component: 'radio' } },
          },
          fee: { kind: 'number' },
        },
        targets: {
          service: { operations: { ...defaultOperations, archive: defaultOperations.update, ...operations } },
          ...(dashboard === undefined ? {} : { dashboard }),
          ...(portal === undefined ? {} : { portal }),
        },
      } as never),
    ],
  })
}

const record = (regions: Record<string, unknown>) => ({ shell: 'dashboard', main: [{ layout: 'record', ...regions }] })
const table = (main: unknown[]) => ({ shell: 'dashboard', main: [{ layout: 'table', main }] })
/** Pages that pass every refusal below, which each test breaks in one place. */
const pages = {
  list: { path: '/courses', page: table([{ list: { columns: ['title', 'fee'], filters: ['title'], search: ['title'], empty: 'noCourses' } }]) },
  create: { path: '/courses/new', page: record({ main: [{ form: [{ section: 'about', label, fields: ['title', { field: 'summary', component: 'summaryBox' }] }, { row: ['fee', 'currency'] }] }] }) },
  edit: {
    path: '/courses/:id',
    page: record({
      main: [{ form: ['title', 'summary', 'currency', { component: coursesUi('no-courses.tsx#NoCourses') }] }],
      danger: [{ button: 'archive', label: archive, reload: true, confirm: { title: archive, body: label } }],
    }),
  },
  board: { path: '/courses/board', page: { shell: 'dashboard', main: [{ layout: ui('table-page.tsx#TablePage'), main: [{ component: coursesUi('no-courses.tsx#NoCourses') }] }] } },
}
const create = (nodes: unknown[]) => ({ ...pages.create, page: record({ main: [{ form: nodes }] }) })
const portalPages = {
  list: { path: '/courses', page: { shell: 'portal', main: [{ layout: portalUi('page.tsx#Page'), main: [{ list: { columns: ['title'] } }] }] } },
  edit: { path: '/courses/:id', page: { shell: 'portal', main: [{ layout: portalUi('page.tsx#Page'), main: [{ form: ['title', 'summary', 'currency'] }] }] } },
}
type Tree = { shell: string; main: { layout: string; main: Record<string, any>[]; side?: unknown[]; danger?: Record<string, any>[] }[] }
const treeOf = (page: unknown) => (page as { page: Tree }).page

test('a build publishes each screen under asas.targets.<screen>.client, the declaration resolved', () => {
  const asas = build({ useAsTitle: 'title', pages }, { pages: portalPages })
  const dashboard = asas.targets.dashboard.client
  const portal = asas.targets.portal.client
  assert.deepEqual(structuredClone(dashboard), dashboard, 'the projection is data a browser can be handed')
  assert.equal(dashboard.path, '/dashboard')
  // A `ui()` reference prints relative to the package holding its file, so
  // `screen.json` names no absolute path and reads the same on every machine.
  assert.equal(dashboard.layouts.record, '@asas/mithaq:./src/ui/record-page.tsx#RecordPage')
  assert.deepEqual(dashboard.pages, { dashboard: { path: '/', component: './src/ui-dashboard/dashboard.tsx#Dashboard' } })
  const courses = dashboard.kayan.courses!
  const layoutOf = (name: string) => treeOf(courses.pages[name]).main[0]!
  const pageOf = (name: string) => layoutOf(name).main[0]!
  assert.equal(treeOf(courses.pages.list).shell, '@asas/mithaq:./src/ui/app-shell.tsx#AppShell', 'the shell at the root, by name')
  assert.equal(layoutOf('list').layout, '@asas/mithaq:./src/ui/table-page.tsx#TablePage', 'a layout nested in its main region')

  // Component precedence: a leaf's own, then the field's, then the screen's table.
  // Each leaf says which of the three decided it, and a list column says the same of its cell.
  const createForm = pageOf('create').form
  assert.deepEqual(createForm[0].fields[1], { field: 'summary', component: '@asas/courses:./courses/ui/fee-cell.tsx#FeeCell', decided: 'leaf' }, 'the leaf')
  assert.deepEqual(pageOf('edit').form[1], { field: 'summary', component: 'otp', decided: 'field' }, 'the field')
  assert.deepEqual(pageOf('edit').form[0], { field: 'title', component: 'text', decided: 'table' }, 'the screen')
  assert.deepEqual(pageOf('list').list.columns[0], { field: 'title', cell: 'text', decided: 'table' }, 'a column')

  assert.equal(pageOf('list').list.empty, '@asas/courses:./courses/ui/no-courses.tsx#NoCourses')
  assert.deepEqual(pageOf('board'), { component: '@asas/courses:./courses/ui/no-courses.tsx#NoCourses' })
  assert.equal(layoutOf('list').layout, layoutOf('board').layout)

  assert.equal(courses.fields.find((field) => field.name === 'currency')!.component, 'select')
  assert.deepEqual(treeOf(portal.kayan.courses!.pages.edit).main[0]!.main[0], {
    form: [
      { field: 'title', component: 'text', decided: 'table' },
      { field: 'summary', component: 'text', decided: 'table' },
      { field: 'currency', component: 'radio', decided: 'field' },
    ],
  })

  for (const screen of [dashboard, portal]) {
    const fields = Object.fromEntries(screen.kayan.courses!.fields.map((field) => [field.name, field]))
    assert.deepEqual(fields.title!.description, { ar: 'الاسم', en: 'The name' })
    assert.deepEqual(fields.title!.placeholder, { ar: 'مثال', en: 'Example' })
    assert.deepEqual(fields.currency!.options!.map((option) => option.value), ['SAR', 'USD'])
  }
  assert.deepEqual(layoutOf('edit').danger, [{ button: 'archive', label: archive, reload: true, confirm: { title: archive, body: label } }])
})

test('a kayan in targets.<screen> the screen does not list, and a listed name that is no kayan, are refused', () => {
  const language = screens()
  assert.throws(
    () => language.buildAsas({ http: [fetchHttp()], kayan: [language.defineKayan({ name: 'tags', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations }, portal: {} } } as never), language.defineKayan({ name: 'courses', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } })] as never }),
    /Kayan "tags" writes targets\.portal, and screen "portal" does not list it in kayan\./,
  )
  assert.throws(
    () => language.buildAsas({ http: [fetchHttp()], kayan: [language.defineKayan({ name: 'notes', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } })] }),
    /Screen "dashboard" kayan lists "courses", which is no kayan of this build\./,
  )
})

test('a target named screen is refused', () => {
  assert.throws(() => build(undefined, undefined, { screen: zodTarget }), /A target is named "screen", which is the word for the capability\./)
})

test('a kayan named screen is refused by name, because the catalog derives screen.<name> for every screen', () => {
  const language = screens()
  assert.throws(
    () => language.buildAsas({ http: [fetchHttp()], kayan: [
      language.defineKayan({ name: 'courses', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } }),
      language.defineKayan({ name: 'screen', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } }),
    ] }),
    /Kayan name "screen" is reserved: the catalog derives screen\.<name> for every screen/,
  )
})

test('the catalog holds screen.<name> for every screen of the build and no other screen key', () => {
  const asas = build({ useAsTitle: 'title', pages }, { pages: portalPages })
  assert.deepEqual(asas.catalog.filter((key) => key.startsWith('screen.')), ['screen.dashboard', 'screen.portal'])
  assert.deepEqual(asas.statements.screen, ['dashboard', 'portal'], 'one resource, screen, whose actions are the screen names')
})

test('a path twice on one screen, edit without :id and list with it are refused', () => {
  assert.throws(
    () => build({ pages: { ...pages, board: { ...pages.board, path: '/courses/new' } } }),
    /Screen "dashboard" kayan "courses" page "board" path "\/courses\/new" is the path of kayan "courses" page "create" already takes on this screen\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, board: { ...pages.board, path: '/courses/:slug' } } }),
    /page "board" path "\/courses\/:slug" is the path of kayan "courses" page "edit" already takes on this screen\./,
    'two paths that differ only in a parameter name match the same URL',
  )
  assert.throws(
    () => build({ pages: { ...pages, board: { ...pages.board, path: '/' } } }),
    /Screen "dashboard" kayan "courses" page "board" path "\/" is the path of page "dashboard" already takes on this screen\./,
    'a kayan page and a page of the screen\'s own share one set of paths',
  )
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...pages.edit, path: '/courses/edit' } } }),
    /Screen "dashboard" kayan "courses" page "edit" path "\/courses\/edit" carries no :id, and an edit page draws one row\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, path: '/courses/:id/all' } } }),
    /Screen "dashboard" kayan "courses" page "list" path "\/courses\/:id\/all" carries :id, and a list page draws every row\./,
  )
})

test('a reserved name with the wrong node is refused, and a panel is no node a page takes', () => {
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, page: table([{ form: ['title'] }]) } } }),
    /Screen "dashboard" kayan "courses" page "list" is a reserved page, and it holds exactly one list node and no form\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...pages.edit, page: record({ main: [{ component: 'noCourses' }] }) } } }),
    /Screen "dashboard" kayan "courses" page "edit" is a reserved page, and it holds exactly one form node and no list\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create(['title', { panel: 'noCourses' }]) } }),
    /page "create" region "main" layout region "main" form holds \["panel"\], which is no node a page takes\./,
    'a panel merged into the component node',
  )
})

test('a leaf naming no field and a button naming no operation are refused', () => {
  assert.throws(
    () => build({ pages: { ...pages, create: create(['title', 'titel']) } }),
    /Screen "dashboard" kayan "courses" page "create" region "main" layout region "main" form leaf names "titel", which is not a field of this kayan\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, page: table([{ list: { columns: ['title'], search: ['summry'] } }]) } } }),
    /page "list" region "main" layout region "main" list search names "summry", which is not a field of this kayan\./,
  )
  // A search may cross one relationship to a text or email field of the kayan it
  // points at (a person looked up on a list of memberships), and nothing else.
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, page: table([{ list: { columns: ['title'], search: ['title.name'] } }]) } } }),
    /list search names "title\.name", and a search path crosses one relationship of this kayan to a text or email field of the kayan it points at\./,
  )
  const searches = (kayan: string) => {
    const tree = asas.targets.platform.client.kayan[kayan]!.pages.list as unknown as { page: { main: { main: { list: { search?: string[] } }[] }[] } }
    return tree.page.main[0]!.main[0]!.list.search
  }
  assert.deepEqual(searches('member'), ['userId.name', 'userId.email'], 'the platform finds a membership by its person\'s name and email')
  assert.deepEqual(searches('sessions'), ['venue', 'course.title'], 'a session by its venue and its course\'s title')
  assert.deepEqual(searches('roles'), ['label'], 'and a role by its name in every locale, never its slug')
  assert.throws(() => build(undefined, { useAsTitle: 'name' }), /Screen "portal" kayan "courses" useAsTitle names "name", which is not a field of this kayan\./)
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...pages.edit, page: record({ main: [{ form: ['title'] }], danger: [{ button: 'publish', label }] }) } } }),
    /Screen "dashboard" kayan "courses" page "edit" region "main" layout region "danger" button "publish" names operation "publish", which this kayan does not declare\./,
  )
  // A button's fields are the boxes its dialog asks for, which are the operation's
  // own on this screen: one the operation never declared there would ask for nothing.
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, page: table([{ list: { columns: ['title'], row: [{ button: 'archive', label: archive, fields: ['reason'] }] } }]) } } }),
    /page "list" region "main" layout region "main" list row button "archive" fields names "reason", which operation "archive" does not ask for on screen "dashboard"\./,
  )
  assert.throws(
    () => build(undefined, { pages: { ...portalPages, edit: { ...portalPages.edit, page: { shell: 'portal', main: [{ layout: portalUi('page.tsx#Page'), main: [{ form: ['title'] }, { button: 'archive', label: archive, fields: ['reason'] }] }] } } } }),
    /Screen "portal" kayan "courses" page "edit" region "main" layout region "main" button "archive" fields names "reason", which operation "archive" does not ask for on screen "portal"\./,
    'on every screen, a page button as much as a list button',
  )
  // The other way: an operation that asks its dialog for a field on this screen is
  // drawn by a button that says which, or by a component that sends its own input.
  const asking = { archive: { ...defaultOperations.update, targets: { dashboard: { fields: { fee: { kind: 'number', label: { ar: 'الرسوم', en: 'Fee' } } } } } } }
  const rowButton = (button: Record<string, unknown>) => ({
    pages: {
      ...pages,
      list: { ...pages.list, page: table([{ list: { columns: ['title'], row: [{ button: 'archive', label: archive, ...button }] } }]) },
      edit: { ...pages.edit, page: record({ main: [{ form: ['title'] }], danger: [{ button: 'archive', label: archive, fields: ['fee'] }] }) },
    },
  })
  assert.throws(
    () => build(rowButton({}), undefined, undefined, asking),
    /list row button "archive" names no fields, and operation "archive" asks for "fee" on screen "dashboard": name the fields its dialog asks for, or a component that sends them\./,
  )
  assert.throws(
    () => build(rowButton({ fields: [] }), undefined, undefined, asking),
    /list row button "archive" names no fields, and operation "archive" asks for "fee"/,
    'an empty list of fields names none',
  )
  assert.doesNotThrow(() => build(rowButton({ fields: ['fee'] }), undefined, undefined, asking), 'a button that names them is drawn')
  assert.doesNotThrow(() => build(rowButton({ component: 'noCourses' }), undefined, undefined, asking), 'and so is one a component draws')
})

test('a reference is a registered name, a shipped built-in or a ui() reference, and nothing else', () => {
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, page: { shell: 'dashboard', main: [{ layout: 'tabel', main: [] }] } } } }),
    /Screen "dashboard" kayan "courses" page "list" region "main" layout layout names "tabel", which is no name in this screen's layouts and no layout the registry ships\./,
    'a registered name that is not in the map',
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ field: 'summary', component: 'wysiwyg' }]) } }),
    /form leaf "summary" component names "wysiwyg", which is no name in this screen's components and no control the registry ships\./,
    'a bare word the registry does not ship',
  )
  assert.throws(
    () => build({ pages: { ...pages, board: { ...pages.board, page: { shell: 'dashboard', main: [{ component: './course-board.tsx#CourseBoard' }] } } } }),
    /page "board" region "main" component names "\.\/course-board\.tsx#CourseBoard", which is neither a name nor a ui\(\) reference\./,
    'a path written as a string, which has no folder to resolve against',
  )
  assert.throws(
    () => build(undefined, undefined, { dashboard: screenTarget({ ...dashboardBase, kayan: [], layouts: { record: './record-page.tsx#RecordPage' } } as never) }),
    /Screen "dashboard" layouts names "record" as "\.\/record-page\.tsx#RecordPage", which is no ui\(\) reference\. Write ui\('file\.tsx#Export'\) from folderOf\./,
  )
})

test('a built-in on a kind it does not draw, a project kind with no controls row, and a label short of a locale are refused', () => {
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ field: 'fee', component: 'switch' }]) } }),
    /form leaf "fee" component names built-in control "switch", which draws checkbox and not number\./,
  )
  const { slug: _slug, ...short } = { ...screenKinds, slug: screenKinds.text }
  const project = defineMithaq({
    arkan: [defineRukn({ name: 'project', kinds: { ...defaultKinds, slug: defaultKinds.text }, rules: defaultRules })],
    targets: {
      memory: memoryStore(),
      zod: { ...zodTarget, kinds: { ...zodTarget.kinds, slug: zodTarget.kinds.text } },
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
      dashboard: screenTarget({ ...dashboardBase, kayan: [], controls: short }),
    },
  } as never) as ReturnType<typeof screens>
  assert.throws(
    () => project.buildAsas({ http: [fetchHttp()], kayan: [project.defineKayan({ name: 'notes', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } })] }),
    /Screen "dashboard" controls has no row for kind "slug", and every kind of the language needs one\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ section: 'about', label: { en: 'About' }, fields: ['title'] }]) } }),
    /form section "about" label is short of locale "ar"\./,
  )
})

test('the template builds three screens, and generate screens holds each projection verbatim as screen.json in the app that serves it', async () => {
  for (const screen of ['dashboard', 'portal', 'platform'] as const) {
    const client = asas.targets[screen].client
    assert.deepEqual(JSON.parse(await readFile(new URL(`${screen}/screen.json`, new URL(generate.screens[screen], new URL('../', import.meta.url))), 'utf8')), client)
  }
  const courses = (screen: 'dashboard' | 'portal') => asas.targets[screen].client.kayan.courses!
  const currency = (screen: 'dashboard' | 'portal') => courses(screen).fields.find((field) => field.name === 'currency')!
  assert.equal(currency('dashboard').component, 'select')
  const form = JSON.stringify(courses('portal').pages.edit)
  assert.ok(form.includes(JSON.stringify({ row: [{ field: 'fee', component: 'number', decided: 'table' }, { field: 'currency', component: 'radio', decided: 'field' }] })), 'the portal draws the same field as radio')
  assert.deepEqual(currency('dashboard').options, currency('portal').options)
})

test('the template screens share their controls and layouts through one const, register only the layouts their pages name, root pages at both shells, and between them use every node', () => {
  const dashboard = asas.targets.dashboard.client
  const portal = asas.targets.portal.client
  const platform = asas.targets.platform.client
  assert.equal(dashboard.layouts.table, platform.layouts.table, 'table is one file, registered once for the dashboard and the platform')
  assert.deepEqual([dashboard.layouts.record, platform.layouts.record], ['@asas/mithaq:./src/ui/record-page.tsx#RecordPage', './src/ui-platform/record-page.tsx#PlatformRecordPage'], 'record is the dashboard\'s file, and the platform draws it under a link back')
  assert.deepEqual([dashboard.layouts.app, platform.layouts.app], ['@asas/mithaq:./src/ui/app-shell.tsx#AppShell', '@asas/mithaq:./src/ui/app-shell.tsx#PlatformShell'], 'app is one file, its platform export the frame staff work in')
  // A layout a screen registers is one a page of it names: the portal roots every
  // page at its top shell, and the platform never draws the top shell.
  const named = (client: typeof dashboard) => {
    const found = new Set<string>()
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (!value || typeof value !== 'object') return
      const node = value as Record<string, unknown>
      for (const key of ['shell', 'layout'] as const) if (typeof node[key] === 'string') found.add(node[key] as string)
      Object.values(node).forEach(walk)
    }
    walk([client.kayan, client.pages])
    return [...found].sort()
  }
  for (const client of [dashboard, portal, platform]) {
    assert.deepEqual(named(client), Object.values(client.layouts).sort(), `${client.path} registers exactly the layouts its pages name`)
  }
  assert.equal(dashboard.layouts.top, '@asas/mithaq:./src/ui/top-shell.tsx#TopShell')
  assert.equal(portal.layouts.top, '@asas/mithaq:./src/ui/top-shell.tsx#PortalTopShell', 'top is one file, and the portal names its own shell in it')
  assert.deepEqual(dashboard.controls, portal.controls, 'and so is what draws each kind')
  const shells = (client: typeof dashboard) => new Set(Object.values(client.kayan).flatMap((kayan) => Object.values(kayan.pages).flatMap((page) => ('page' in page ? [page.page.shell] : []))))
  assert.deepEqual([...shells(dashboard)].sort(), [dashboard.layouts.app, dashboard.layouts.top].sort(), 'the dashboard roots its pages at both shells')
  assert.ok(shells(portal).has(portal.layouts.top!), 'and the portal at its own top shell')
  const kinds = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    const kind = ['shell', 'layout', 'field', 'form', 'list', 'button', 'title', 'nav', 'controls', 'row', 'separator', 'section', 'tabs', 'accordion'].find((one) => one in node)
    if (kind) kinds.add(kind)
    else if (Object.keys(node).length === 1 && 'component' in node) kinds.add('component')
    if ((kind === 'form' || kind === 'list') && node.component) kinds.add(`${kind} component`)
    if (kind === 'button' && node.confirm) kinds.add('button confirm')
    Object.values(node).forEach(walk)
  }
  walk([dashboard.kayan, portal.kayan])
  // Every node but the accordion and the separator, among them a list drawn by a
  // component of the project's own (the Roles list). No real page holds the other
  // two, so the test below builds one that does.
  assert.deepEqual([...kinds].sort(), ['button', 'button confirm', 'component', 'controls', 'field', 'form', 'form component', 'layout', 'list', 'list component', 'nav', 'row', 'section', 'shell', 'tabs', 'title'].sort())
  assert.deepEqual(Object.keys(dashboard.pages), ['dashboard', 'members'], 'a dashboard and one page that belongs to no kayan')
  assert.deepEqual(dashboard.nav.at(-1), { path: '/members', page: 'members', label: { en: 'Members', ar: 'الأعضاء' }, permission: 'memberRoles.find' }, 'listed in the nav behind its own key')
})

test('a screen with no page at / is refused, and so are folder, shell and dashboard, which left the screen', () => {
  assert.throws(
    () => build(undefined, undefined, { portal: screenTarget({ ...portalBase, kayan: [], pages: { home: { path: '/home', component: portalUi('home.tsx#Home') } } }) }),
    /Screen "portal" has no page at \/, and a screen draws one at its own path\./,
  )
  for (const [key, value] of [['folder', new URL('./ui-portal/', import.meta.url)], ['shell', 'portal'], ['dashboard', portalUi('home.tsx#Home')]] as const) {
    assert.throws(
      () => build(undefined, undefined, { portal: { ...screenTarget({ ...portalBase, kayan: [] }), [key]: value } }),
      new RegExp(`Screen "portal" carries "${key}", which a screen does not take\\. A screen takes capability, type, path, kayan, controls, providers, pages, layouts, components\\.`),
    )
  }
})

test('a reference to a missing file or a missing export is refused at build, wherever the reference sits', () => {
  assert.throws(
    () => build(undefined, { pages: { list: { ...portalPages.list, page: { shell: 'portal', main: [{ layout: portalUi('missing.tsx#Page'), main: [] }] } } } }),
    /Screen "portal" kayan "courses" page "list" region "main" layout layout names \.\/src\/ui-portal\/missing\.tsx#Page, and \.\/src\/ui-portal\/missing\.tsx is no file\./,
  )
  assert.throws(
    () => build(undefined, { pages: { list: { ...portalPages.list, page: { shell: 'portal', main: [{ layout: ui('top-shell.tsx#Page'), main: [] }] } } } }),
    /layout layout names \.\/src\/ui\/top-shell\.tsx#Page, and \.\/src\/ui\/top-shell\.tsx does not export "Page"\./,
  )
  assert.throws(
    () => build(undefined, undefined, { portal: screenTarget({ ...portalBase, kayan: [], pages: { home: { path: '/', component: portalUi('home.tsx#Welcome') } } }) }),
    /Screen "portal" page "home" component names \.\/src\/ui-portal\/home\.tsx#Welcome, and \.\/src\/ui-portal\/home\.tsx does not export "Welcome"\./,
  )
  assert.throws(
    () => build(undefined, undefined, { portal: screenTarget({ ...portalBase, kayan: [], components: { gone: portalUi('gone.tsx#Gone') } }) }),
    /Screen "portal" components "gone" names \.\/src\/ui-portal\/gone\.tsx#Gone, and \.\/src\/ui-portal\/gone\.tsx is no file\./,
  )
  assert.throws(() => folderOf(new URL('./ui-portal', import.meta.url)), /folderOf takes a folder URL ending in \//)
})

test('a reference to a file of another package prints that package\'s name before it, the package drawing the root page prints bare, and a package with no name is refused', async (t) => {
  const other = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-269-'))}/`)
  t.after(() => rm(other, { recursive: true }))
  await mkdir(new URL('src/', other))
  await writeFile(new URL('src/center.tsx', other), 'export const Center = () => null\n')
  await writeFile(new URL('package.json', other), '{ "name": "@cr/centers" }\n')
  const centersUi = folderOf(new URL('src/', other))
  const portal = (target: Record<string, unknown>) => build(undefined, undefined, { portal: screenTarget({ ...portalBase, kayan: [], ...target }) }).targets.portal.client

  const home = portal({ components: { center: centersUi('center.tsx#Center') } })
  assert.equal(home.pages.home!.component, './src/ui-portal/home.tsx#Home', 'the root page\'s package prints bare, as every reference printed before')
  assert.equal(home.layouts.portal, '@asas/mithaq:./src/ui/top-shell.tsx#TopShell')
  assert.equal(home.components.center, '@cr/centers:./src/center.tsx#Center', 'and another package by its name')
  assert.match(studioText(studioTree('portal', home)), /\n    @cr\/centers:\.\/src\/center\.tsx$/, '`mithaq screens` lists the named file among the screen\'s files')

  const away = portal({ pages: { home: { path: '/', component: centersUi('center.tsx#Center') } } })
  assert.equal(away.pages.home!.component, './src/center.tsx#Center', 'the root page drawn from the feature package makes that package the bare one')
  assert.equal(away.layouts.portal, '@asas/mithaq:./src/ui/top-shell.tsx#TopShell', 'and the language\'s own files print its name')
  // A bare reference names no package, so generate screens globs it off the
  // app or the project, and a root page drawn from a third package would
  // find nothing there and draw blank.
  await assert.rejects(
    generateScreens({ root: new URL('../', import.meta.url), screens: { portal: away }, into: new URL('../../../apps/asas-tanstack/src/routes/(screens)/', import.meta.url), check: true }),
    /The portal screen's root page is drawn from a package that is neither the app serving it nor the project: \.\/src\/center\.tsx is in neither\. Draw a screen's root page from the app or the project\./,
  )

  const refused = /Screen "portal" components "center" names \.\/src\/center\.tsx#Center, whose package, .*\/package\.json, names no npm package name, and a file outside the package drawing the screen's root page is printed by its package's name\. Give that package\.json one\./
  // A name goes into a glob's base, `/node_modules/<name>/`, so only an npm
  // package name crosses: never a path up, an absolute path or a space.
  for (const name of [undefined, '../../../../etc', '/abs', 'my pkg', 'a:b', 'a#b']) {
    await writeFile(new URL('package.json', other), `${JSON.stringify({ private: true, name })}\n`)
    assert.throws(() => portal({ components: { center: centersUi('center.tsx#Center') } }), refused, String(name))
  }
  assert.throws(
    () => portal({ pages: { home: { path: '/', component: 'nowhere' } }, components: { center: centersUi('center.tsx#Center') } }),
    /Screen "portal" page "home" component names "nowhere", which is no name in this screen's components/,
    'a root page naming no registered component reports that first, and not the package it cannot place',
  )
  assert.deepEqual(referencesIn(['../x:./src/a.tsx#A', '/abs:./src/a.tsx#A', 'my pkg:./src/a.tsx#A', '@cr/centers:./src/a.tsx#A']), ['@cr/centers:./src/a.tsx#A'], 'and a reference carries no other name')
})

test('a region the shell or the layout does not export is refused at build', () => {
  assert.throws(
    () => build(undefined, { pages: { list: { ...portalPages.list, page: { shell: 'portal', aside: [], main: [] } } } }),
    /Screen "portal" kayan "courses" page "list" fills region "aside", which @asas\/mithaq:\.\/src\/ui\/top-shell\.tsx#TopShell does not export in its regions: header, nav, main\./,
    'a shell',
  )
  assert.throws(
    () => build(undefined, { pages: { list: { ...portalPages.list, page: { shell: 'portal', main: [{ layout: portalUi('page.tsx#Page'), side: [{ list: { columns: ['title'] } }] }] } } } }),
    /Screen "portal" kayan "courses" page "list" region "main" layout fills region "side", which \.\/src\/ui-portal\/page\.tsx#Page does not export in its regions: main\./,
    'a layout nested in a region',
  )
})

test('a page is drawn whole by a component, which takes nothing else, and never mixed with a tree', () => {
  const whole = { path: '/courses/:id', component: coursesUi('no-courses.tsx#NoCourses') }
  const asas = build({ pages: { ...pages, edit: whole } })
  assert.deepEqual(asas.targets.dashboard.client.kayan.courses!.pages.edit, { path: '/courses/:id', component: '@asas/courses:./courses/ui/no-courses.tsx#NoCourses' })
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...pages.edit, component: coursesUi('no-courses.tsx#NoCourses') } } }),
    /Screen "dashboard" kayan "courses" page "edit" carries both page and component, and a page is either one tree or drawn whole by one component\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...whole, mode: 'dialog' } } }),
    /page "edit" carries "mode", which a page drawn whole does not take\. A page drawn whole takes path, component\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, board: { path: '/courses/board' } } }),
    /page "board" has no page with a shell at its root, and a page is one tree rooted at a shell or a component drawing it whole\./,
  )
})

test('a button sits in any region with its confirm, the title and nav nodes project, and a list or form node names the component that draws it', () => {
  const asas = build({
    pages: {
      ...pages,
      list: { ...pages.list, page: { shell: 'dashboard', main: [{ layout: 'table', main: [{ title: {} }, { nav: {} }, { list: { columns: ['title'] }, component: 'noCourses' }] }] } },
      create: create(['title', { button: 'archive', label: archive }]),
      edit: { ...pages.edit, page: record({ main: [{ form: ['title'], component: coursesUi('no-courses.tsx#NoCourses') }], side: [{ button: 'archive', label: archive, component: 'noCourses' }] }) },
    },
  })
  const courses = asas.targets.dashboard.client.kayan.courses!
  assert.deepEqual(treeOf(courses.pages.list).main[0]!.main, [
    { title: {} },
    { nav: {} },
    { list: { columns: [{ field: 'title', cell: 'text', decided: 'table' }] }, component: '@asas/courses:./courses/ui/no-courses.tsx#NoCourses' },
  ])
  assert.deepEqual(treeOf(courses.pages.create).main[0]!.main[0]!.form[1], { button: 'archive', label: archive }, 'inside a form')
  assert.deepEqual(treeOf(courses.pages.edit).main[0]!.side, [{ button: 'archive', label: archive, component: '@asas/courses:./courses/ui/no-courses.tsx#NoCourses' }], 'beside it')
  assert.equal(treeOf(courses.pages.edit).main[0]!.main[0]!.component, '@asas/courses:./courses/ui/no-courses.tsx#NoCourses')
  assert.throws(
    () => build({ pages: { ...pages, create: create(['title', { button: 'archive', label: archive, confirm: { title: archive, body: label, tone: 'danger' } }]) } }),
    /form button "archive" confirm carries "tone", which a confirm does not take\. A confirm takes title, body\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create(['title', { button: 'archive', label: archive, confirm: { title: archive, body: { en: 'Sure?' } } }]) } }),
    /form button "archive" confirm body is short of locale "ar"\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create(['title', { button: 'archive', label, position: 'header' }]) } }),
    /form button "archive" carries "position", which a button does not take\. A button takes button, label, fields, reload, component, confirm, when\./,
    'where it sits is its position',
  )
})

test('a list holds toolbar, bulk and row regions of buttons and a default sort and limit, and a bulk button on a single-row operation or a row button on a bulk one is refused', () => {
  const list = (extra: Record<string, unknown>) => ({ pages: { ...pages, list: { ...pages.list, page: table([{ list: { columns: ['title'], ...extra } }]) } } })
  const asas = build(list({
    toolbar: [{ button: 'create', label }],
    bulk: [{ button: 'deleteMany', label: archive, confirm: { title: archive, body: label } }, { button: 'updateMany', label, fields: ['fee'] }],
    row: [{ button: 'archive', label: archive, when: { fee: { exists: true } } }],
    sort: '-fee',
    limit: 25,
  }))
  assert.deepEqual(treeOf(asas.targets.dashboard.client.kayan.courses!.pages.list).main[0]!.main[0], {
    list: {
      columns: [{ field: 'title', cell: 'text', decided: 'table' }],
      toolbar: [{ button: 'create', label }],
      bulk: [{ button: 'deleteMany', label: archive, confirm: { title: archive, body: label } }, { button: 'updateMany', label, fields: ['fee'] }],
      row: [{ button: 'archive', label: archive, when: { fee: { exists: true } } }],
      sort: '-fee',
      limit: 25,
    },
  })
  assert.match(
    studioText(studioTree('dashboard', asas.targets.dashboard.client)),
    /\n\s+sort -fee\n\s+limit 25\n\s+region toolbar\n\s+button operation create\n\s+region bulk\n\s+button operation deleteMany \(confirm\)\n\s+button operation updateMany\n\s+region row\n\s+button operation archive when \{"fee":\{"exists":true\}\}\n/,
    'mithaq screens prints the defaults and each region with its buttons',
  )
  const at = 'Screen "dashboard" kayan "courses" page "list" region "main" layout region "main" list'
  const refused = (extra: Record<string, unknown>, message: string) =>
    assert.throws(() => build(list(extra)), (error: Error) => error.message === `${at} ${message}`)
  refused({ bulk: [{ button: 'archive', label }] }, 'bulk button "archive" names an operation that writes one row, and a bulk button runs an updateMany or a deleteMany over the ticked rows.')
  refused({ row: [{ button: 'deleteMany', label }] }, 'row button "deleteMany" names an operation that writes many rows, and a row button runs an update or a remove over its own row.')
  refused({ row: [{ button: 'find', label }] }, 'row button "find" names an operation that writes no row, and a row button runs an update or a remove over its own row.')
  refused({ toolbar: [{ button: 'deleteMany', label }] }, 'toolbar button "deleteMany" names an operation that writes many rows, and a toolbar button runs over no row.')
  refused({ toolbar: [{ button: 'archive', label }] }, 'toolbar button "archive" names an operation that writes one row, and a toolbar button runs over no row.')
  refused({ bulk: [{ button: 'updateMany', label, fields: ['fees'] }] }, 'bulk button "updateMany" fields names "fees", which is not a field of this kayan.')
  refused({ sort: 'fees' }, 'sort names "fees", which is not a field of this kayan.')
  refused({ limit: 0 }, 'limit is 0, and a limit is a whole number from 1 to 100.')
  refused({ limit: 101 }, 'limit is 101, and a limit is a whole number from 1 to 100.')
  // The bound is the project's own maximum, not a number of core's.
  const smaller = { service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: 20, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) }
  assert.throws(() => build(list({ limit: 25 }), undefined, smaller), (error: Error) => error.message === `${at} limit is 25, and a limit is a whole number from 1 to 20.`)
  assert.equal(build(list({ limit: 20 }), undefined, smaller).targets.dashboard.client.maxLimit, 20)
  refused({ pageSize: 10 }, 'carries "pageSize", which a list does not take. A list takes columns, filters, search, empty, menu, toolbar, bulk, row, sort, limit, of, where.')
  const menued = build(list({ menu: ui('kpi-card.tsx#KpiCard') })).targets.dashboard.client
  const menu = (treeOf(menued.kayan.courses!.pages.list).main[0]!.main[0] as { list: { menu?: string } }).list.menu
  assert.equal(menu, '@asas/mithaq:./src/ui/kpi-card.tsx#KpiCard', 'the projection carries the reference as every component\'s')
  assert.match(studioText(studioTree('dashboard', menued)), /\n\s+menu @asas\/mithaq:\.\/src\/ui\/kpi-card\.tsx#KpiCard\n/, 'and mithaq screens prints it')
  refused({ menu: 'rowActions' }, 'menu names "rowActions", which is no name in this screen\'s components and no component the registry ships.')
  assert.throws(
    () => build(list({ row: [{ button: 'archive', label, when: { fees: { exists: true } } }] })),
    /list row button "archive" when names "fees", which is no field of this kayan\./,
    'a row button\'s when is checked the way every when is',
  )
})

test('a list with of and where lists another kayan of the screen scoped to the record, and an unknown of, a where that is no relationship back and a join leaf are refused', () => {
  // `of` names a kayan the screen draws, `where` that kayan's relationship back at
  // this page's own, and every column, filter, sort and button is read off `of`.
  const related = (list: Record<string, unknown>, where: 'create' | 'edit' = 'edit', leaf?: string | Record<string, unknown>) => {
    const language = screens({ dashboard: screenTarget({ ...dashboardBase, kayan: ['courses', 'sessions'] }) })
    const tabs = { tabs: [
      { tab: 'details', label, fields: [{ form: ['title', ...(leaf ? [leaf] : [])] }] },
      { tab: 'sessions', label, fields: [{ list }] },
    ] }
    return language.buildAsas({
      http: [fetchHttp()],
      kayan: [
        language.defineKayan({
          name: 'courses',
          fields: { ...defaultFields, title: { kind: 'text' }, lessons: { kind: 'join', relationTo: 'sessions', on: 'course' } },
          targets: {
            service: { operations: defaultOperations },
            dashboard: { pages: {
              list: { path: '/courses', page: table([{ list: { columns: ['title'] } }]) },
              ...(where === 'edit' ? { edit: { path: '/courses/:id', page: record({ main: [tabs] }) } } : { create: { path: '/courses/new', page: record({ main: [tabs] }) } }),
            } },
          },
        } as never),
        language.defineKayan({
          name: 'sessions',
          fields: {
            ...defaultFields,
            course: { kind: 'relationship', relationTo: 'courses' },
            follows: { kind: 'relationship', relationTo: 'sessions' },
            // A set of courses, which no one row of them holds alone.
            tags: { kind: 'relationship', relationTo: 'courses', hasMany: true },
            venue: { kind: 'text' },
            seats: { kind: 'number' },
          },
          targets: { service: { operations: { ...defaultOperations, close: defaultOperations.update } } },
        } as never),
      ] as never,
    })
  }
  const asas = related({
    of: 'sessions',
    where: 'course',
    columns: ['venue', 'seats'],
    filters: ['venue'],
    search: ['venue'],
    sort: '-seats',
    bulk: [{ button: 'updateMany', label, fields: ['seats'] }],
    row: [{ button: 'close', label, when: { 'record.seats': { exists: true } } }],
  })
  const edit = treeOf(asas.targets.dashboard.client.kayan.courses!.pages.edit).main[0]!.main[0] as { tabs: { fields: unknown[] }[] }
  assert.deepEqual(edit.tabs[1]!.fields[0], {
    list: {
      of: 'sessions',
      where: 'course',
      columns: [{ field: 'venue', cell: 'text', decided: 'table' }, { field: 'seats', cell: 'number', decided: 'table' }],
      filters: ['venue'],
      search: ['venue'],
      bulk: [{ button: 'updateMany', label, fields: ['seats'] }],
      row: [{ button: 'close', label, when: { 'record.seats': { exists: true } } }],
      sort: '-seats',
    },
  }, 'the columns, filters, sort and buttons are the sessions kayan\'s own')
  assert.match(studioText(studioTree('dashboard', asas.targets.dashboard.client)), /\n\s+list of sessions where course\n/, 'mithaq screens names what the list lists')

  const at = 'Screen "dashboard" kayan "courses" page "edit" region "main" layout region "main" tab "sessions" list'
  const refused = (list: Record<string, unknown>, message: string, page?: 'create') =>
    assert.throws(() => related(list, page), (error: Error) => error.message === `${at.replace('"edit"', `"${page ?? 'edit'}"`)} ${message}`)
  refused({ of: 'lessons', where: 'course', columns: ['venue'] }, 'of names "lessons", which is no kayan of this screen.')
  refused({ of: 'sessions', where: 'venue', columns: ['venue'] }, 'where names "venue", which is no relationship of kayan "sessions" holding one row of kayan "courses".')
  refused({ of: 'sessions', where: 'follows', columns: ['venue'] }, 'where names "follows", which is no relationship of kayan "sessions" holding one row of kayan "courses".')
  refused({ of: 'sessions', columns: ['venue'] }, 'names of and no where, and a list of another kayan names the relationship that scopes it to this row.')
  refused({ where: 'course', columns: ['venue'] }, 'names where and no of, and where scopes a list of another kayan to this row.')
  refused({ of: 'sessions', where: 'tags', columns: ['venue'] }, 'where names "tags", which is no relationship of kayan "sessions" holding one row of kayan "courses".')
  refused({ of: 'sessions', where: 'course', columns: ['title'] }, 'column names "title", which is not a field of this kayan.')
  refused({ of: 'sessions', where: 'course', columns: ['venue'] }, 'lists kayan "sessions" by the row this page draws, and page "create" draws no row.', 'create')
  // Its rows save in forms of their own, so it never sits inside the page's form.
  assert.throws(
    () => related({ of: 'sessions', where: 'course', columns: ['venue'] }, 'edit', { list: { of: 'sessions', where: 'course', columns: ['venue'] } } as never),
    /tab "details" form list lists kayan "sessions" inside a form node, and its rows save apart from this page's form: put it beside the form node\./,
  )
  // A join is the same rows, and a page draws them as the list above rather
  // than as forms nested in its own.
  assert.throws(
    () => related({ of: 'sessions', where: 'course', columns: ['venue'] }, 'edit', 'lessons'),
    /tab "details" form leaf "lessons" names a join, and a page draws a join's rows as a list: write \{ list: \{ of: 'sessions', where: 'course', columns: \[\.\.\.\] \} \}\./,
  )
})

test('the nav lists each kayan list page in kayan order and each screen page that asks, and names the key each needs', () => {
  const pagesOf = { dashboard: { path: '/', component: dashboardUi('dashboard.tsx#Dashboard') }, members: { path: '/members', component: dashboardUi('dashboard.tsx#Dashboard'), nav: { label }, permission: 'screen.dashboard' } }
  const asas = build({ pages }, undefined, { dashboard: screenTarget({ ...dashboardBase, kayan: ['courses'], pages: pagesOf }) })
  assert.deepEqual(asas.targets.dashboard.client.nav, [
    { path: '/courses', page: 'list', kayan: 'courses', permission: 'courses.find' },
    { path: '/members', page: 'members', label, permission: 'screen.dashboard' },
  ])
  for (const permission of ['members.find', 'courses.fields.title', 'screen.nowhere', 'courses.publish']) {
    assert.throws(
      () => build({ pages }, undefined, { dashboard: screenTarget({ ...dashboardBase, kayan: ['courses'], pages: { ...pagesOf, members: { ...pagesOf.members, permission } } }) }),
      new RegExp(`Screen "dashboard" page "members" permission "${permission.replaceAll('.', '\\.')}" is neither screen\\.<screen> of this build nor <kayan>\\.<operation> of a kayan it holds, and the nav could never show the page to anyone but '\\*'\\.`),
      `${permission}: a key the nav cannot answer hides the entry from everyone`,
    )
  }
  build({ pages }, undefined, { dashboard: screenTarget({ ...dashboardBase, kayan: ['courses'], pages: { ...pagesOf, members: { ...pagesOf.members, permission: 'courses.archive' } } }) })
})

test('the portal lists sessions for their title alone, so an enrollment\'s session reads by its start there as on the dashboard, with no page and no nav entry', () => {
  const portal = asas.targets.portal.client
  assert.equal(portal.kayan.sessions?.useAsTitle, asas.targets.dashboard.client.kayan.sessions?.useAsTitle)
  assert.equal(portal.kayan.enrollments?.fields.find((field) => field.name === 'session')?.relationTo, 'sessions')
  assert.deepEqual(portal.kayan.sessions?.pages, {})
  assert.equal(portal.nav.some((entry) => entry.kayan === 'sessions'), false)
})

test('every key a leaf, a button and a page write is named, and one no screen reads is refused by name', () => {
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ field: 'title', hidden: true }]) } }),
    /form leaf "title" carries "hidden", which a leaf does not take\. A leaf takes field, component, cell, placeholder, description, readOnly, width, when\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...pages.edit, title: label } } }),
    /page "edit" carries "title", which a page does not take\. A page takes path, page, mode\./,
  )
  for (const gone of ['layout', 'content', 'buttons']) {
    assert.throws(
      () => build({ pages: { ...pages, edit: { ...pages.edit, [gone]: [] } } }),
      new RegExp(`page "edit" carries "${gone}", which a page does not take\\.`),
      `${gone} left the page for its tree`,
    )
  }
  const asas = build({ pages: { ...pages, create: create([{ field: 'title', readOnly: true, width: '50%' }]) } })
  assert.deepEqual(treeOf(asas.targets.dashboard.client.kayan.courses!.pages.create).main[0]!.main[0]!.form[0], { field: 'title', readOnly: true, width: '50%', component: 'text', decided: 'table' })
})

test('a when on a leaf, a node and a button projects as the Where it is, over the form values, the record and $user', () => {
  const online = { currency: { equals: 'SAR' } }
  const deletes = { '$user.collections.courses.delete': { equals: true } }
  const unarchived = { or: [{ 'record.fee': { exists: false } }, { 'record.fee': { less_than: 10 } }] }
  const asas = build({
    pages: {
      ...pages,
      create: create(['currency', { field: 'fee', when: online }, { section: 'about', label, when: deletes, fields: ['title'] }, { row: ['summary'], when: online }]),
      edit: { ...pages.edit, page: record({ main: [{ form: ['title'] }], danger: [{ button: 'archive', label: archive, when: unarchived }] }) },
    },
  })
  const courses = asas.targets.dashboard.client.kayan.courses!
  const form = treeOf(courses.pages.create).main[0]!.main[0]!.form
  assert.deepEqual(form[1], { field: 'fee', component: 'number', decided: 'table', when: online }, 'a leaf')
  assert.deepEqual(form[2].when, deletes, 'a section, keyed on $user')
  assert.deepEqual(form[3].when, online, 'a row')
  assert.deepEqual(treeOf(courses.pages.edit).main[0]!.danger![0], { button: 'archive', label: archive, when: unarchived }, 'a button, keyed on the record')
})

test('mithaq screens prints each node\'s when beside it', () => {
  const asas = build({
    pages: {
      ...pages,
      create: create(['currency', { field: 'fee', when: { currency: { equals: 'SAR' } } }, { section: 'about', label, when: { '$user.collections.courses.delete': { equals: true } }, fields: ['title'] }]),
      board: { ...pages.board, page: { shell: 'dashboard', main: [{ layout: 'table', when: { fee: { exists: true } }, main: [{ component: 'noCourses' }] }] } },
    },
  })
  const text = studioText(studioTree('dashboard', asas.targets.dashboard.client))
  assert.match(text, /\n\s+layout @asas\/mithaq:\.\/src\/ui\/table-page\.tsx#TablePage when \{"fee":\{"exists":true\}\}\n\s+region main\n/, 'a layout, whose when is no region')
  assert.match(text, /\n\s+fee: control number when \{"currency":\{"equals":"SAR"\}\} \(table\)\n/)
  assert.match(text, /\n\s+section about when \{"\$user\.collections\.courses\.delete":\{"equals":true\}\}\n/)
})

test('a when naming a missing field, an operator its kind does not take or a $user path the report does not carry is refused at build', () => {
  const at = /Screen "dashboard" kayan "courses" page "create" region "main" layout region "main" form leaf "fee" when/
  const refused = (when: unknown, message: RegExp) =>
    assert.throws(() => build({ pages: { ...pages, create: create([{ field: 'fee', when }]) } }), (error: Error) => at.test(error.message) && message.test(error.message))
  refused({ delivery: { equals: 'online' } }, /names "delivery", which is no field of this kayan\./)
  refused({ 'record.delivery': { equals: 'online' } }, /names "record\.delivery", which is no field of this kayan\./)
  refused({ title: { greater_than: 3 } }, /field "title" operator "greater_than" only supports numeric, date and datetime fields\./)
  refused({ fee: { contains: 'x' } }, /field "fee" operator "contains" only supports text-like fields\./)
  refused({ fee: { near: 1 } }, /field "fee" uses unsupported operator "near"\./)
  refused({ '$user.email': { equals: 'a@b.c' } }, /names "\$user\.email", and \$user is the access report/)
  refused({ '$user.collections.lessons.read': { equals: true } }, /names "\$user\.collections\.lessons\.read", and \$user is the access report/)
  refused({ '$user.collections.courses.operations.publish': { equals: true } }, /names "\$user\.collections\.courses\.operations\.publish", and \$user is the access report/)
  refused({ '$user.collections.courses.read': { greater_than: 1 } }, /operator "greater_than" only supports numeric, date and datetime fields\./)
  refused({ or: [] }, /"or" constraint must be a non-empty array\./)
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, page: table([{ list: { columns: [{ field: 'title', when: { fee: { exists: true } } }] } }]) } } }),
    /list column "title" carries a when, and a list column is drawn on every row: put the when on a node\./,
  )
})

test("a kayan's baseFilter on a screen is projected to the browser as written, and one naming no field of the kayan, an operator its kind does not take, the record or $user is refused at build", () => {
  const cheap = { or: [{ fee: { exists: false } }, { fee: { less_than: 10 } }] }
  assert.deepEqual(build({ pages, baseFilter: cheap }).targets.dashboard.client.kayan.courses!.baseFilter, cheap, 'the screen carries it')
  assert.equal(build({ pages }).targets.dashboard.client.kayan.courses!.baseFilter, undefined, 'and a kayan that writes none carries none')
  const refused = (baseFilter: unknown, message: RegExp) =>
    assert.throws(() => build({ pages, baseFilter }), (error: Error) => /Screen "dashboard" kayan "courses" baseFilter/.test(error.message) && message.test(error.message))
  refused({ delivery: { equals: 'online' } }, /names "delivery", which is no field of this kayan\./)
  refused({ title: { greater_than: 3 } }, /field "title" operator "greater_than" only supports numeric, date and datetime fields\./)
  refused({ 'record.fee': { exists: true } }, /names "record\.fee", and a filter of stored rows names this kayan's own fields alone\./)
  refused({ or: [{ '$user.collections.courses.read': { equals: true } }] }, /names "\$user\.collections\.courses\.read", and a filter of stored rows/)
  refused({}, /is no Where/)
})

test('a choice control needs options wherever it is decided, and a reserved page holds exactly one form or list', () => {
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ field: 'title', component: 'select' }]) } }),
    /form leaf "title" is drawn by "select", which needs options\./,
  )
  assert.throws(
    () => build(undefined, undefined, { portal: screenTarget({ ...portalBase, kayan: ['courses'], controls: { ...screenKinds, text: { control: 'radio', cell: 'text' } } }) }),
    /Screen "portal" kayan "courses" field "title" is drawn by "radio", which needs options\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...pages.edit, page: record({ main: [{ form: ['title'] }], side: [{ form: ['fee'] }] }) } } }),
    /page "edit" is a reserved page, and it holds exactly one form node and no list\./,
  )
})

test('a page opens create and edit as a dialog, a sheet or a drawer, and a list in none of them', () => {
  const asas = build({ pages: { ...pages, create: { ...pages.create, mode: 'sheet' }, edit: { ...pages.edit, mode: 'drawer' } } })
  const courses = asas.targets.dashboard.client.kayan.courses!
  assert.equal((courses.pages.create as { mode?: string }).mode, 'sheet')
  assert.equal((courses.pages.edit as { mode?: string }).mode, 'drawer')
  assert.throws(
    () => build({ pages: { ...pages, list: { ...pages.list, mode: 'dialog' } } }),
    /Screen "dashboard" kayan "courses" page "list" opens as "dialog", and only create and edit open over the list\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, edit: { ...pages.edit, mode: 'popover' } } }),
    /page "edit" opens as "popover", and a page opens as dialog, sheet or drawer\./,
  )
})

test('a row may be resizable and a section may scroll, and both reach the projection', () => {
  const asas = build({ pages: { ...pages, create: create([{ row: [{ section: 'about', label, scroll: '20rem', fields: ['title'] }, { section: 'money', label, fields: ['fee'] }], resizable: true }]) } })
  assert.deepEqual(treeOf(asas.targets.dashboard.client.kayan.courses!.pages.create).main[0]!.main[0]!.form[0], {
    row: [
      { section: 'about', scroll: '20rem', label, fields: [{ field: 'title', component: 'text', decided: 'table' }] },
      { section: 'money', label, fields: [{ field: 'fee', component: 'number', decided: 'table' }] },
    ],
    resizable: true,
  })
})

test('the five shadcn controls the registry adds are built-ins, each on the kinds it draws', () => {
  const drawn = (leaf: unknown) => build({ pages: { ...pages, create: create([leaf]) } })
  drawn({ field: 'summary', component: 'textarea' })
  drawn({ field: 'currency', component: 'buttonGroup' })
  assert.throws(() => drawn({ field: 'fee', component: 'calendar' }), /names built-in control "calendar", which draws date and not number\./)
  assert.throws(() => drawn({ field: 'title', component: 'toggle' }), /names built-in control "toggle", which draws checkbox and not text\./)
  assert.throws(() => drawn({ field: 'title', component: 'buttonGroup' }), /form leaf "title" is drawn by "buttonGroup", which needs options\./)
  assert.throws(() => drawn({ field: 'title', component: 'checkboxGroup' }), /names built-in control "checkboxGroup", which draws textArray and not text\./)
})

test('a text or numeric field carries a prefix and a suffix, one string per locale, which every screen draws from the field', () => {
  const language = screens()
  const built = (field: object) => language.buildAsas({
    http: [fetchHttp()],
    kayan: [language.defineKayan({ name: 'courses', fields: { ...defaultFields, fee: field }, targets: { service: { operations: defaultOperations } } } as never)],
  })
  const fee = built({ kind: 'number', prefix: { ar: 'ر.س', en: 'SAR' }, suffix: { ar: 'لكل مقعد', en: 'per seat' } }).targets.portal.client.kayan.courses!.fields.find((one) => one.name === 'fee')!
  assert.deepEqual([fee.prefix, fee.suffix], [{ ar: 'ر.س', en: 'SAR' }, { ar: 'لكل مقعد', en: 'per seat' }])
  for (const field of [{ kind: 'integer' }, { kind: 'decimal', rules: { precision: 7, scale: 2 } }]) {
    const one = built({ ...field, suffix: { ar: 'ر.س', en: 'SAR' } }).targets.portal.client.kayan.courses!.fields.find((each) => each.name === 'fee')!
    assert.deepEqual(one.suffix, { ar: 'ر.س', en: 'SAR' }, field.kind)
  }
  assert.throws(
    () => built({ kind: 'checkbox', prefix: { ar: 'ر.س', en: 'SAR' } }),
    /Kayan "courses" field "fee" has a prefix, and kind "checkbox" takes none; only a text, number, integer or decimal field does\./,
  )
  assert.throws(
    () => built({ kind: 'text', suffix: { en: 'per seat' } }),
    /Kayan "courses" field "fee" suffix is short of locale "ar"\./,
  )
})

/**
 * Every path in `value` holding a function, so a failure names the leak
 * instead of only reporting that there is one. Objects already seen are
 * skipped, so a cycle ends the walk rather than hanging it.
 */
const functionPaths = (value: unknown, path: string, seen: Set<unknown> = new Set()): string[] => {
  if (typeof value === 'function') return [path]
  if (!value || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  return Object.entries(value).flatMap(([key, one]) => functionPaths(one, `${path}.${key}`, seen))
}

test('each screen of the real project survives structuredClone and names no function', () => {
  for (const screen of ['dashboard', 'portal'] as const) {
    const client = asas.targets[screen].client
    assert.deepEqual(functionPaths(client, screen), [])
    // What a screen publishes to a browser must cross a structured-clone boundary
    // (postMessage, server-to-client payloads, RSC props).
    assert.deepEqual(structuredClone(client), client)
  }
})

test("a screen's kayan and field carry none of the server's access, targets or custom bag", () => {
  for (const screen of ['dashboard', 'portal'] as const) {
    for (const kayan of Object.values(asas.targets[screen].client.kayan)) {
      for (const key of ['access', 'targets', 'custom']) assert.equal(key in kayan, false, `kayan "${kayan.name}" carries ${key}`)
      for (const field of kayan.fields) {
        for (const key of ['access', 'targets', 'target', 'custom']) {
          assert.equal(key in field, false, `field "${kayan.name}.${field.name}" carries ${key}`)
        }
      }
    }
  }
})

test('a relationship crosses as the name it points at, and hasMany marks only the field that holds a set', () => {
  const dashboard = asas.targets.dashboard.client
  const course = dashboard.kayan.sessions!.fields.find((field) => field.name === 'course')!
  assert.equal(course.kind, 'relationship')
  assert.equal(course.relationTo, 'courses')
  const tenant = dashboard.kayan.courses!.fields.find((field) => field.name === 'organization')!
  assert.equal(tenant.relationTo, 'organization')
  const tags = dashboard.kayan.courses!.fields.find((field) => field.name === 'tags')!
  assert.equal(tags.hasMany, true, 'so a control draws a multi-select and a cell draws a list')
  // `true` is the only value the declaration has, so every other relationship
  // carries no key rather than a `false` that says what the default says.
  assert.equal('hasMany' in tenant, false)
})

test('an options field carries its choices with a label in every locale, the same on both screens', () => {
  const currency = (screen: 'dashboard' | 'portal') => asas.targets[screen].client.kayan.courses!.fields.find((field) => field.name === 'currency')!
  assert.deepEqual(currency('dashboard').options, [
    { value: 'SAR', label: { en: 'Saudi riyal', ar: 'ريال سعودي' } },
    { value: 'USD', label: { en: 'US dollar', ar: 'دولار أمريكي' } },
  ])
  assert.deepEqual(currency('dashboard').options, currency('portal').options)
  // Delivery is a choice on both, so the portal reads its option's label and never the stored value.
  const delivery = (screen: 'dashboard' | 'portal') => asas.targets[screen].client.kayan.courses!.fields.find((field) => field.name === 'delivery')!.component
  assert.equal(delivery('portal'), delivery('dashboard'))
  assert.equal(delivery('portal'), 'radio')
})

test("courses and sessions declare a real control for every field the screen's default kind would not draw", () => {
  const dashboard = asas.targets.dashboard.client
  const overridden = [...dashboard.kayan.courses!.fields, ...dashboard.kayan.sessions!.fields]
    .filter((field) => field.component !== dashboard.controls[field.kind as keyof typeof dashboard.controls]?.control)
    .map((field) => field.component)
  assert.deepEqual([...overridden].sort(), ['switch', 'radio', 'toggleGroup', 'select', 'nativeSelect', 'slider', 'otp', 'combobox'].sort())
})

test('a tab holding an accordion and a separator, and a section with a width, collapsed and a when, each reach the projection as written', () => {
  const when = { '$user.collections.courses.delete': { equals: true } }
  const asas = build({ pages: { ...pages, create: create([
    { row: [{ section: 'about', width: 2, collapsed: true, when, label, fields: ['title'] }, { section: 'money', width: 1, label, fields: ['fee'] }] },
    { tabs: [{ tab: 'more', label, fields: [{ separator: true }, { accordion: [{ item: 'kind', label, fields: ['summary'] }] }] }] },
  ]) } })
  const form = treeOf(asas.targets.dashboard.client.kayan.courses!.pages.create).main[0]!.main[0]!.form
  assert.deepEqual(form[0].row[0], { section: 'about', width: 2, collapsed: true, when, label, fields: [{ field: 'title', component: 'text', decided: 'table' }] })
  assert.deepEqual(form[1].tabs[0].fields, [
    { separator: true },
    { accordion: [{ item: 'kind', label, fields: [{ field: 'summary', component: 'otp', decided: 'field' }] }] },
  ])
})

test('the course edit page draws its tabs at page level, Details holding the record layout, and the create page draws the same sections and side with no tab, each with the form\'s controls in its header', () => {
  const dashboard = asas.targets.dashboard.client
  const page = (name: 'create' | 'edit' | 'list') => (dashboard.kayan.courses!.pages[name] as { page: Record<string, unknown[]> }).page
  const edit = page('edit')
  assert.deepEqual(edit.header, [{ title: {} }, { controls: {} }], 'the edit page\'s header holds its title and the form\'s controls')
  assert.deepEqual(page('create').header, [{ title: {} }, { controls: {} }], 'and so does the create page\'s')
  assert.deepEqual(page('list').header, [{ title: {} }], 'while a page holding no form has no controls')
  const [tabs, ...rest] = edit.main as { tabs: { tab: string; fields: Record<string, any>[] }[] }[]
  assert.deepEqual(rest, [], 'the edit page\'s main region holds its tabs and nothing else')
  assert.deepEqual(tabs!.tabs.map((tab) => tab.tab), ['details', 'sessions', 'versions'])
  const [details, sessions, versions] = tabs!.tabs
  assert.equal(details!.fields.length, 1)
  const layout = details!.fields[0]!
  assert.equal(layout.layout, dashboard.layouts.record, 'Details holds the record layout')
  assert.deepEqual(layout.main.map((node: object) => Object.keys(node)), [['form']], 'its main region the form')
  assert.deepEqual(layout.main[0].form.map((node: { section: string }) => node.section), ['about', 'pricing', 'teaching'])
  assert.ok(JSON.stringify(layout.main[0].form[2].fields).includes('"field":"notifications"'), 'Teaching holds notifications')
  assert.deepEqual(layout.side.map((node: { section?: string; component?: string }) => node.section ?? node.component), ['catalogue', '@asas/mithaq:./src/ui/activity.tsx#Activity'], 'its side Catalogue and the activity')
  assert.deepEqual(layout.side.at(-1), { component: '@asas/mithaq:./src/ui/activity.tsx#Activity', when: { '$user.collections.auditLog.operations.find': { equals: true } } })
  assert.deepEqual(layout.danger.map((node: { button: string }) => node.button), ['archive', 'delete'], 'and its danger zone')
  assert.deepEqual(sessions!.fields.map((node) => Object.keys(node)), [['list']], 'Sessions holds its list alone, at the full width')
  assert.deepEqual(versions!.fields.map((node) => node.component), [dashboard.components.versions], 'and Versions its panel alone')

  const create = (page('create').main as Record<string, any>[])[0]!
  assert.equal(create.layout, dashboard.layouts.record, 'the create page draws the record layout with no tab')
  assert.deepEqual(create.main, layout.main, 'the create page\'s main region is the edit page\'s Details form')
  assert.deepEqual(create.side, [{ ...layout.side[0], fields: layout.side[0].fields.filter((leaf: { field: string }) => leaf.field !== 'archived') }], 'its side is Details\' Catalogue, less the activity and the archived box that need a row')
  assert.equal(create.danger, undefined, 'and a create has no danger zone')
  assert.throws(() => build({ pages: { ...pages, edit: { ...pages.edit, page: { ...pages.edit.page, header: [{ controls: {}, label }] } } } }), /page "edit" region "header" controls carries "label", which a controls node does not take\. A controls node takes controls, when\./)
  const labels: string[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== 'object') return
    const node = value as { section?: unknown; label?: { en?: string } }
    if (node.section !== undefined && node.label?.en) labels.push(node.label.en)
    Object.values(node).forEach(walk)
  }
  walk([dashboard.kayan, asas.targets.portal.client.kayan])
  assert.ok(labels.length && !labels.includes('Status'), `no section is labelled Status: ${labels}`)
  // A join is drawn by no page; the rows pointing at a course and at a session are
  // a list of their own kayan in a tab of the edit page.
  const listed = (kayan: 'courses' | 'sessions') =>
    ((kayan === 'courses' ? treeOf(dashboard.kayan[kayan]!.pages.edit).main[0] : treeOf(dashboard.kayan[kayan]!.pages.edit).main[0]!.main[0]) as unknown as { tabs: { tab: string; fields: { list: { of: string; where: string } }[] }[] }).tabs[1]!
  assert.deepEqual([listed('courses').tab, listed('courses').fields[0]!.list.of, listed('courses').fields[0]!.list.where], ['sessions', 'sessions', 'course'])
  assert.deepEqual([listed('sessions').tab, listed('sessions').fields[0]!.list.of, listed('sessions').fields[0]!.list.where], ['enrollments', 'enrollments', 'session'])
  assert.ok(!JSON.stringify(dashboard).includes('"field":"scheduledSessions"') && !JSON.stringify(dashboard).includes('"field":"enrollments"'), 'and no page names a join as a leaf')
})

test("a field carries its label and the rules that are data, in the kayan's own field order", () => {
  const courses = asas.targets.dashboard.client.kayan.courses!
  const title = courses.fields.find((field) => field.name === 'title')!
  assert.deepEqual(title.label, { en: 'Title', ar: 'العنوان' })
  assert.deepEqual(title.rules, { required: true, trim: true, maxLength: 120, index: true })
  assert.deepEqual(courses.fields.map((field) => field.name), Object.keys(asas.kayan.courses.fields))
})

test('the screen projection leaves off every defaultValue and never names the actor', () => {
  for (const screen of ['dashboard', 'portal'] as const) {
    const client = asas.targets[screen].client
    for (const kayan of Object.values(client.kayan)) {
      for (const field of kayan.fields) assert.equal('defaultValue' in field.rules, false, `field "${kayan.name}.${field.name}" carries a defaultValue`)
    }
    // A `Ref` default is `{ $user: <key> }`, so a field defaulting to a key
    // of the actor must never cross either. A `when` keyed on `$user.` names a
    // path of the access report, never the actor's own key.
    assert.equal(JSON.stringify(client).includes('{"$user":'), false)
  }
  const tenant = asas.targets.dashboard.client.kayan.courses!.fields.find((field) => field.name === 'organization')!
  assert.equal('defaultValue' in tenant.rules, false)
})

test('every dashboard create and edit page, and Settings, draws the record layout under its kayan\'s sentence with its fields in sections, and no create page draws what only an existing row has', () => {
  const dashboard = asas.targets.dashboard.client
  type Any = Record<string, any>
  const nodes = (value: unknown): Any[] =>
    Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value as Any, ...Object.values(value).flatMap(nodes)] : []
  const pages = Object.values(dashboard.kayan).flatMap((kayan) =>
    // A page drawn whole by one component draws no tree: the images' New page is the upload dialog's.
    Object.entries(kayan.pages).filter(([name, page]) => ['create', 'edit', 'settings'].includes(name) && !('component' in page)).map(([name, page]) => ({ kayan, name, page: treeOf(page), over: 'mode' in page })),
  )
  assert.equal((dashboard.kayan.media!.pages.create as { component?: string }).component, '@asas/media:./media/ui/preview.tsx#NewImage')
  assert.deepEqual(pages.map(({ kayan, name }) => `${kayan.name}.${name}`).sort(), ['courses.create', 'courses.edit', 'enrollments.create', 'enrollments.edit', 'media.edit', 'roles.create', 'roles.edit', 'sessions.create', 'sessions.edit', 'settings.settings', 'tags.create', 'tags.edit'])
  for (const { kayan, name, page, over } of pages) {
    const at = `${kayan.name}.${name}`
    assert.ok(kayan.description?.en && kayan.description.ar, `${at} is headed by its kayan's sentence in both locales`)
    const all = nodes(page)
    assert.ok(all.some((node) => node.layout === dashboard.layouts.record), `${at} draws the record layout`)
    // A page opened over its list in a sheet draws its fields under the sheet's own
    // title, with no section heading repeating it.
    for (const form of over ? [] : all.filter((node) => Array.isArray(node.form) && !node.component)) {
      assert.ok(form.form.every((node: Any) => typeof node.section === 'string'), `${at} puts every field of its form in a section: ${JSON.stringify(form.form)}`)
    }
    if (name !== 'create') continue
    const fields = new Map(kayan.fields.map((field) => [field.name, field]))
    for (const leaf of all.filter((node) => typeof node.field === 'string')) {
      const provided = (fields.get(leaf.field)?.rules.providedBy as { create?: string } | undefined)?.create
      assert.ok(leaf.readOnly !== true && (provided ?? 'client') === 'client', `${at} draws ${leaf.field}, which only an existing row has`)
    }
  }
  const settings = nodes(treeOf(dashboard.kayan.settings!.pages.settings)).find((node) => node.field === 'maintenance')
  assert.equal(settings?.component, 'switch', 'a yes or no setting draws as a switch')
})

test("a kayan's description crosses in every locale, is absent when undeclared, and a bare useAsTitle projects alone", () => {
  const dashboard = asas.targets.dashboard.client
  assert.deepEqual(dashboard.kayan.courses!.description, {
    en: 'Everything on offer in the catalogue, and what a seat on each costs.',
    ar: 'كل ما هو معروض في الدليل، وما يكلفه مقعد في كل منها.',
  })
  assert.equal('description' in dashboard.kayan.memberRoles!, false)
  // A kayan that writes only `useAsTitle`, with no `pages` at all, projects
  // exactly that key and an empty `pages` record, rather than an empty object
  // a renderer would have to tell apart from a declared empty one.
  const bare = build({ useAsTitle: 'title' })
  const courses = bare.targets.dashboard.client.kayan.courses!
  assert.equal(courses.useAsTitle, 'title')
  assert.equal('description' in courses, false)
  assert.deepEqual(courses.pages, {})
})

test("a kayan that keeps drafts tells every screen so, with the interval it autosaves at, Payload's 2000 ms for autosave: true, and one that keeps none says nothing", () => {
  assert.deepEqual(asas.targets.dashboard.client.kayan.courses!.drafts, { autosave: { interval: 2000 } })
  assert.deepEqual(asas.targets.portal.client.kayan.courses!.drafts, { autosave: { interval: 2000 } })
  assert.equal('drafts' in asas.targets.dashboard.client.kayan.sessions!, false)
})

test('186q. a storage kayan tells every screen that lists it the types and the size it takes, an upload draws the upload control and cell, and a kayan holding no files says nothing', () => {
  // What the upload control checks a file against before it is sent; the server stays the authority.
  assert.deepEqual(asas.targets.dashboard.client.kayan.media!.storage, { mimeTypes: ['image/png', 'image/jpeg', 'image/webp'], fileSize: 10 * 1024 * 1024 })
  assert.deepEqual(asas.targets.portal.client.kayan.media!.storage, asas.targets.dashboard.client.kayan.media!.storage)
  assert.equal('storage' in asas.targets.dashboard.client.kayan.courses!, false)
  const cover = asas.targets.dashboard.client.kayan.courses!.fields.find((field) => field.name === 'cover')!
  assert.equal(cover.relationTo, 'media')
  assert.equal(cover.component, 'upload')
  assert.equal(cover.cell, 'upload')
})

test("a field's screen facts sit beside its data, and copy at the field's own root reaches every screen unchanged", () => {
  const title = asas.targets.dashboard.client.kayan.courses!.fields.find((field) => field.name === 'title')!
  assert.equal(title.filter, true)
  assert.equal(title.searchable, true)
  assert.deepEqual(title.description, { en: 'The name a student sees in the catalogue.', ar: 'الاسم الذي يراه الطالب في الدليل.' })
  assert.deepEqual(title.placeholder, { en: 'Introduction to Arabic calligraphy', ar: 'مقدمة في الخط العربي' })
  // `summary` opts into the search box and out of sorting, and carries no
  // `filter`: the two query keys are each field's own opt-in, with no list on
  // the kayan naming them.
  const summary = asas.targets.dashboard.client.kayan.courses!.fields.find((field) => field.name === 'summary')!
  assert.equal(summary.searchable, true)
  assert.equal(summary.sortable, false)
  assert.equal('filter' in summary, false)
  const portalTitle = asas.targets.portal.client.kayan.courses!.fields.find((field) => field.name === 'title')!
  assert.equal('filter' in portalTitle, false)
  assert.equal('searchable' in portalTitle, false)
  assert.deepEqual(portalTitle.placeholder, title.placeholder)
})

test("a kayan's own operations project their name and effect, an operation's own input fields the way a kayan's own are, and a button's copy lives on the page instead", () => {
  const dashboard = asas.targets.dashboard.client
  const courses = dashboard.kayan.courses!
  assert.deepEqual(
    courses.operations.find((operation) => operation.name === 'archive'),
    {
      name: 'archive',
      effect: 'update',
      fields: [{ name: 'reason', kind: 'text', label: { en: 'Reason', ar: 'السبب' }, rules: { required: true, maxLength: 200 }, component: 'text', cell: 'text' }],
    },
  )
  assert.deepEqual(courses.operations.filter((operation) => operation.fields).map((operation) => operation.name), ['archive'])
  assert.deepEqual(courses.operations.map((operation) => operation.name).sort(), Object.keys(asas.kayan.courses.operations).sort())
  assert.deepEqual(dashboard.kayan.settings!.operations, [{ name: 'update', effect: 'update' }, { name: 'findOne', effect: 'read' }])
  // The button's own copy lives on the node that draws it, not on the operation,
  // and where the node sits is where it is drawn.
  assert.deepEqual(((treeOf(courses.pages.edit).main[0] as unknown as { tabs: { fields: { danger: Record<string, unknown>[] }[] }[] }).tabs[0]!.fields[0]!.danger).map(({ confirm: _confirm, when: _when, ...button }) => button), [{ button: 'archive', label: { en: 'Archive', ar: 'أرشفة' }, fields: ['reason'], reload: true }, { button: 'delete', label: { en: 'Delete', ar: 'حذف' } }])
})

test("a field's label, description or placeholder written as a function is left off, and a screen's value that is not the shape its type promised is left off too", () => {
  // A screen of its own with one kayan written as plain data: it never passes
  // through `defineKayan`, so a function can sit where the type says a string does.
  // Such a value is left off rather than crossing and throwing at `structuredClone`.
  const language = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget,
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
      dashboard: screenTarget({ ...dashboardBase, kayan: ['hatches'] }),
    },
  })
  const built = language.buildAsas({
    http: [fetchHttp()],
    kayan: [
      {
        name: 'hatches',
        fields: {
          id: defaultFields.id,
          title: {
            kind: 'text',
            label: () => 'resolved by the project',
            description: () => 'so is this',
            placeholder: () => 'and this too',
            targets: { dashboard: { width: () => '50%', component: 'text' } },
          },
        },
        targets: {
          service: {
            operations: {
              touch: {
                targets: { dashboard: { fields: { note: { kind: 'text', label: () => 'resolved by the project', rules: { defaultValue: 'secret' } } } } },
                input: ({ update }: { update: { extend: (shape: Record<string, unknown>) => unknown } }) => update.extend({ note: z.string().optional() }),
                steps: ({ steps }: { steps: { update: unknown } }) => [steps.update],
              },
            },
          },
        },
      },
    ] as never,
  })
  const client = built.targets.dashboard.client
  const title = client.kayan.hatches!.fields.find((field) => field.name === 'title')!
  assert.equal('label' in title, false)
  assert.equal('description' in title, false)
  assert.equal('placeholder' in title, false)
  assert.equal('width' in title, false)
  assert.equal(title.component, 'text')
  // A `defaultValue` written as a function is left off by name, as a kayan's own
  // field is: one function builds both, so neither can publish what the other does not.
  const touch = client.kayan.hatches!.operations.find((operation) => operation.name === 'touch')!
  assert.deepEqual(touch.fields, [{ name: 'note', kind: 'text', rules: {}, component: 'text', cell: 'text' }])
  assert.deepEqual(structuredClone(client), client)
})

test('an option label, a placeholder, and a button, tab or section label short of a declared locale is refused at build by name', () => {
  const language = screens()
  const field = (extra: object) => language.buildAsas({
    http: [fetchHttp()],
    kayan: [language.defineKayan({ name: 'courses', fields: { ...defaultFields, title: { kind: 'text', ...extra } }, targets: { service: { operations: defaultOperations } } } as never)],
  })
  assert.throws(
    () => field({ options: [{ value: 'a', label: { en: 'A' } }] }),
    /Kayan "courses" field "title" option "a" needs a label in every declared locale\./,
  )
  assert.throws(() => field({ placeholder: { en: 'Example' } }), /Kayan "courses" field "title" placeholder is short of locale "ar"\./)
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ field: 'title', placeholder: { en: 'Example' } }]) } }),
    /form leaf "title" placeholder is short of locale "ar"\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create(['title', { button: 'archive', label: { en: 'Archive' } }]) } }),
    /form button "archive" label is short of locale "ar"\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ tabs: [{ tab: 'about', label: { en: 'About' }, fields: ['title'] }] }]) } }),
    /form tab "about" label is short of locale "ar"\./,
  )
  assert.throws(
    () => build({ pages: { ...pages, create: create([{ section: 'about', label: { en: 'About' }, fields: ['title'] }]) } }),
    /form section "about" label is short of locale "ar"\./,
  )
})
