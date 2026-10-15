import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { act, createElement, type ReactElement } from 'react'
import { asas } from 'asas'
import { renderToStaticMarkup } from 'react-dom/server'
import { nodeKinds, registryCells, registryControls } from 'mithaq/admin'
import { ScreenContext, useField, useForm, useKayan, useList, useRecord, useScreen } from 'mithaq/admin/react'
import type { ButtonProps, ComponentProps, ControlProps, EmptyProps, LayoutProps, PageClient, Row, ShellProps } from 'mithaq/admin'
import type { ScreenState } from 'mithaq/admin/react'
import './tsx.ts'
import { click, fire, mount, type, window } from './dom.ts'

const { createRoot } = await import('react-dom/client')
// TanStack Query is the app's dependency, so it resolves from the app.
const app = new URL('../../../apps/asas-tanstack/src/screen-list.tsx', import.meta.url).href
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === '@tanstack/react-query' ? next(specifier, { ...context, parentURL: app }) : next(specifier, context),
})
const { QueryClient, QueryClientProvider } = (await import('@tanstack/react-query' as string)) as {
  QueryClient: new () => { clear(): void }
  QueryClientProvider: (props: { client: unknown; children?: unknown }) => ReactElement
}
// Loaded by its URL rather than a literal specifier, so the package's own
// typecheck does not take in a file written against the app's paths.
const { ScreenList, rowReadsDrafts } = (await import(new URL('../registry/host/screen-list.tsx', import.meta.url).href)) as {
  ScreenList: (props: Record<string, unknown>) => ReactElement
  rowReadsDrafts: (args: { kayan: { drafts?: unknown }; operations?: Record<string, boolean>; id?: string; findVersions: (input: unknown) => Promise<{ docs: readonly unknown[] } | null> }) => Promise<boolean>
}
const { Form } = await import('../registry/form.tsx')
const { List } = await import('../registry/list.tsx')
const { RecordFrame, initialFocusIn } = await import('../registry/record-frame.tsx')
const { listOf } = await import('../registry/node-tree.ts')
const { searchableFields } = await import('../registry/list-query.ts')
const { filterPathsOf } = await import('../registry/filter-operators.ts')
const { withAddOns } = await import('./with-add-ons.ts')
// The template's language holds rich text and files, so its screens draw with both add-ons spread in, as its apps do.
const defaultComponents = withAddOns((await import('../registry/default-components.tsx')).defaultComponents, (await import('../registry/rich-text.tsx')).richTextComponents, (await import('../registry/upload.tsx')).uploadComponents)
const { ComponentsProvider } = await import('../registry/components.tsx')
const controls: Readonly<Record<string, import('../registry/control-props.ts').Control>> = defaultComponents.controls

const screen = asas.targets.dashboard.client
const courses = screen.kayan.courses!
const t = (_key: string, fallback?: string) => fallback
const state: ScreenState = {
  t,
  locale: 'en',
  dir: 'ltr',
  screen,
  access: {},
  user: { name: 'Admin', email: 'admin@example.com' },
  client: async () => ({}),
  kayan: courses,
  record: null,
}

let mounted: ReturnType<typeof createRoot> | undefined
const render = async (element: ReactElement, over: Partial<ScreenState> = {}) => {
  if (mounted) {
    const previous = mounted
    await act(async () => previous.unmount())
  }
  const host = mount()
  mounted = createRoot(host)
  await act(async () => mounted!.render(createElement(ScreenContext, { value: { ...state, ...over } }, createElement(ComponentsProvider, { components: defaultComponents }, element))))
  return host
}

const RecordPage = ({ regions, page }: LayoutProps<readonly ['main', 'side'], ReactElement>) =>
  createElement('div', { 'data-layout': page.path, 'data-record': useRecord() ? 'row' : 'none' }, createElement('main', null, regions.main), createElement('aside', null, regions.side))
const TablePage = ({ regions }: LayoutProps<readonly ['main'], ReactElement>) => createElement('div', { 'data-layout': 'table' }, regions.main)
const summaryBox = './src/courses/ui/summary-box.tsx#SummaryBox'
const RichText = ({ field, issue, value }: ControlProps) =>
  createElement('textarea', { 'data-rich': field.name, 'data-issue': String(issue), 'data-screen': useScreen().path, value: String(value ?? ''), readOnly: true })
const Shell = ({ regions }: ShellProps<readonly ['main'], ReactElement>) => createElement('div', { 'data-shell': 'dashboard' }, regions.main)
const Activity = (_: ComponentProps) => createElement('section', { 'data-activity': String(useForm().getData().title), 'data-row': String(useRecord()?.id) })
const NoCourses = ({ page }: EmptyProps) => createElement('p', { 'data-empty': `${useKayan().name}${page.path}` })
const Board = ({ page }: ComponentProps) => createElement('div', { 'data-board': page.path })
const activity = './src/ui-dashboard/activity.tsx#Activity'
const refs = {
  [screen.layouts.app!]: Shell,
  [screen.layouts.record!]: RecordPage,
  [screen.layouts.table!]: TablePage,
  [summaryBox]: RichText,
  [activity]: Activity,
  '@asas/courses:./courses/ui/no-courses.tsx#NoCourses': NoCourses,
  './src/ui-dashboard/course-board.tsx#CourseBoard': Board,
}
type TreePage = Extract<PageClient, { page: unknown }>
const recordPage = (main: unknown[], regions: Record<string, unknown[]> = {}): PageClient => ({ path: '/courses/new', page: { shell: screen.layouts.app!, main: [{ layout: screen.layouts.record!, main: main as never, ...(regions as Record<string, never>) }] } })
const writes = { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }

const formOf = (page: PageClient | undefined, value: Record<string, unknown> | null = null) =>
  createElement(Form, {
    kayan: courses,
    screen: { refs, kayan: courses, page: page as TreePage },
    client: writes,
    value,
    t,
    locale: 'en',
    onDone: () => {},
  })

test(`a form node draws into the layout's regions, a leaf's own component is handed ControlProps, and a field the page names nowhere is not drawn`, async () => {
  // No page of the template names a project control on a leaf, so the page is written here.
  const host = await render(formOf(recordPage(
    [{ form: [{ section: 'about', label: { en: 'About the course', ar: 'عن الدورة' }, fields: [{ field: 'title', component: 'text' }, { field: 'summary', component: summaryBox }] }] }],
    { side: [{ field: 'tags', component: 'relationship' }] },
  )))
  const layout = host.querySelector('[data-layout="/courses/new"]')!
  assert.ok(layout, 'the page\'s layout draws the page')
  assert.equal(layout.getAttribute('data-record'), 'none', 'a create has no row yet')
  assert.ok(layout.querySelector('main #courses-title'), 'the form node is in the main region')
  assert.ok(layout.querySelector('aside [data-field="tags"], aside #courses-tags'), 'and the side region holds tags')
  const rich = layout.querySelector('[data-rich="summary"]')!
  assert.equal(rich.getAttribute('data-issue'), 'null', 'the leaf\'s component gets issue, null with no refusal')
  assert.equal(rich.getAttribute('data-screen'), '/dashboard', 'and reads the screen through useScreen()')
  assert.equal(host.querySelector('#courses-level'), null, 'a field the page names nowhere is not drawn')
  assert.ok(host.textContent!.includes('About the course'), 'a section draws its label')
})

test(`a component node in a form reads the form's values through useForm(), an edit's layout reads the row through useRecord(), and the shell is the root`, async () => {
  const row = { id: 'c1', title: 'Calligraphy' }
  // The template's edit page draws no panel, so one is added to the end of its form node.
  const edit = structuredClone(courses.pages.edit!) as PageClient
  const formIn = (value: unknown): unknown[] | undefined =>
    Array.isArray(value) ? value.map(formIn).find(Boolean)
    : value && typeof value === 'object' ? (Array.isArray((value as { form?: unknown }).form) ? (value as { form: unknown[] }).form : Object.values(value).map(formIn).find(Boolean))
    : undefined
  formIn(edit)!.push({ component: activity })
  const host = await render(formOf(edit, row), { record: row })
  assert.ok(host.querySelector('[data-shell="dashboard"] [data-layout="/courses/:id"]'), 'the shell at the root of the tree, the layout in its region')
  assert.equal(host.querySelector('[data-layout="/courses/:id"]')!.getAttribute('data-record'), 'row')
  const drawn = host.querySelector('[data-activity]')!
  assert.equal(drawn.getAttribute('data-activity'), 'Calligraphy', 'the values the form holds')
  assert.equal(drawn.getAttribute('data-row'), 'c1')
})

test(`an inline leaf draws its own placeholder, description and width, a read-only one as text and not a control, a resizable row splits, and a section scrolls`, async () => {
  const page = recordPage([{ form: [
    { field: 'title', component: 'text', description: { en: 'Own sentence', ar: 'جملة' }, readOnly: true, width: '50%' },
    { row: [
      { section: 'money', label: { en: 'Money', ar: 'المال' }, scroll: '12rem', fields: [{ field: 'fee', component: 'number' }] },
      { section: 'kind', label: { en: 'Kind', ar: 'النوع' }, fields: [{ field: 'summary', component: 'textarea', placeholder: { en: 'Own hint', ar: 'تلميح' } }] },
    ], resizable: true },
  ] }])
  const host = await render(formOf(page))
  assert.equal(host.querySelector('#courses-title'), null, 'a read-only leaf draws no control')
  assert.ok(host.querySelector('[data-field-value="title"]'), 'but its value, as text')
  assert.ok(host.textContent!.includes('Own sentence'))
  assert.ok(host.querySelector('[data-field-value="title"][style*="50%"]'), 'the leaf\'s width is on its box')
  assert.equal(host.querySelector('#courses-summary')!.getAttribute('placeholder'), 'Own hint')
  assert.ok(host.querySelector('[data-slot="resizable-panel-group"]'), 'the row is a resizable group')
  assert.equal(host.querySelectorAll('[data-slot="resizable-handle"]').length, 1, 'with one handle between its two panels')
  assert.ok(host.querySelector('[data-slot="scroll-area"] #courses-fee'), 'the section with a height scrolls')
  assert.equal(host.querySelector('#courses-summary')!.tagName, 'TEXTAREA', 'textarea draws a multi-line box')
})

test('the switch keeps its own width in both directions with its label beside it, and its thumb mirrors under rtl', async () => {
  // A vertical field's `[&>*]:w-full` would stretch a switch across it, so a switch sits in the
  // horizontal field a checkbox does.
  for (const over of [{ locale: 'en', dir: 'ltr' }, { locale: 'ar', dir: 'rtl' }] as const) {
    const host = await render(formOf(recordPage([{ form: [{ field: 'notifications' }] }])), over)
    const box = host.querySelector('[data-slot="switch"]')!
    const field = box.closest('[data-slot="field"]')!
    assert.equal(field.getAttribute('data-orientation'), 'horizontal', `${over.dir}: the field sets the switch and its label side by side`)
    assert.equal(/\[&>\*\]:w-full/.test(field.className), false, `${over.dir}: and stretches neither`)
    assert.equal(!!(box.compareDocumentPosition(field.querySelector('[data-slot="field-label"]')!) & 4), true, `${over.dir}: the label follows the switch`)
    // A checked thumb moves by the track's leftover width toward the end edge, so under rtl it moves the other way.
    assert.match(box.firstElementChild!.className, /rtl:data-checked:-translate-x-5/, `${over.dir}: the checked thumb mirrors under rtl`)
  }
})

test('a list node draws its columns, filters and search, and its empty component by path gets EmptyProps', async () => {
  const page = courses.pages.list!
  const host = await render(createElement(List, {
    kayan: courses,
    screen: { refs, kayan: courses, page: page as TreePage },
    page: { docs: [], totalDocs: 0, totalPages: 1, page: 1, limit: 10, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null },
    query: {},
    t,
    locale: 'en',
    onQuery: () => {},
    href: (id: string) => `/dashboard/courses/${id}`,
    newHref: '/dashboard/courses/new',
  } as never))
  const heads = [...host.querySelectorAll('th')].filter((one) => !one.querySelector('.sr-only')).map((one) => one.textContent!.trim())
  assert.deepEqual(heads, ['Title', 'Fee', 'Opens on', 'Status', 'Details', 'Cover image'], `the node's columns, in its order: ${heads.join(', ')}`)
  assert.ok(host.querySelector('[data-empty="courses/courses"]'), 'the empty component is drawn with the kayan and the page')
  assert.equal(host.querySelector('input[type="search"]')!.getAttribute('placeholder'), 'Title, Summary, or Details', 'the search runs over the node\'s fields')
  const portal = asas.targets.portal.client.kayan.courses!
  const node = listOf({ page: portal.pages.list! as TreePage })!
  assert.deepEqual(searchableFields({ kayan: portal, search: node.search }), ['title'])
  assert.deepEqual(filterPathsOf(portal, { filters: node.filters }).map((one) => one.path), ['title'])
  assert.deepEqual(node.columns.map((one) => one.field), ['title', 'fee'])
})

test('a page is read as values where it holds no form, or where the viewer may update no row it draws and no component of the project draws its form', async () => {
  const { readsAsValues } = await import('../registry/node-tree.ts')
  const edit = courses.pages.edit! as TreePage
  const row = { id: 'c1' }
  assert.equal(readsAsValues({ page: edit, value: row, operations: { update: false } }), true, 'a row the viewer may not update is read')
  assert.equal(readsAsValues({ page: edit, value: row, operations: { update: true } }), false, 'one it may update is a form')
  assert.equal(readsAsValues({ page: edit, value: null, operations: { update: false } }), false, 'and a page with no row yet stays a form')
  assert.equal(readsAsValues({ page: courses.pages.list! as TreePage, value: null, operations: {} }), true, 'a page holding no form is read as it always was')
  const roles = screen.kayan.roles!.pages.edit! as TreePage
  assert.equal(readsAsValues({ page: roles, value: row, operations: { update: false } }), false, 'while a form a component of the project draws decides for itself')
})

test('a list whose rows hold no column the viewer may read says so, rather than drawing blank rows', async () => {
  // An instructor reads no field of an enrollment, so the projection hands the list a kayan with none.
  const unread = { ...courses, fields: [] }
  const docs = [{ id: 'e1' }, { id: 'e2' }]
  const host = await render(createElement(List, {
    kayan: unread,
    screen: { refs, kayan: unread, page: courses.pages.list! as TreePage },
    page: { docs, totalDocs: 2, totalPages: 1, page: 1, limit: 10, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null },
    query: {},
    t,
    locale: 'en',
    onQuery: () => {},
    href: (id: string) => `/portal/enrollments/${id}`,
    newHref: '/portal/enrollments/new',
    operations: { deleteMany: true, updateMany: true },
    run: async () => ({}),
  } as never))
  assert.equal(host.querySelectorAll('tbody tr').length, 0, 'no row per record')
  // In place of the table, so a phone never cuts the sentence at the table's frame.
  assert.equal(host.querySelector('[data-list-message]')?.textContent, 'Your role can\'t see any column of this list. Ask an administrator of your organization for access.', 'one sentence says it, in words that say what to do')
  // A header row would be a blank band: it would hold only the row menu's column.
  assert.equal(host.querySelectorAll('thead').length, 0, 'and no header band above it')
  assert.equal([...host.querySelectorAll('button')].some((one) => one.textContent?.includes('Columns')), false, 'no Columns menu')
  assert.equal(host.querySelectorAll('[role="checkbox"]').length, 0, 'no box to tick every row')
  assert.equal(host.querySelectorAll('[data-mithaq-range]').length + host.querySelectorAll('[aria-label="Page"]').length, 0, 'and no pager')
})

test('a list node that names a component is drawn by it, which reads the rows, the count and the links through useList(), in place of the registry\'s table', async () => {
  const Cards = () => {
    const { page, href, newHref, creates } = useList()
    return createElement('ul', { 'data-cards': page.totalDocs, 'data-new': creates === false ? '' : newHref },
      page.docs.map((row) => createElement('li', { key: String(row.id) }, createElement('a', { href: href(String(row.id)) }, String(row.title)))))
  }
  const rows = { docs: [{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Nahw' }], totalDocs: 2, totalPages: 1, page: 1, limit: 10, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null }
  const found: unknown[] = []
  const node = courses.pages.list as TreePage
  const queries = new QueryClient()
  const host = await render(createElement(QueryClientProvider as never, { client: queries }, createElement(ScreenList, {
    props: { kayan: courses, t, locale: 'en', href: (id: string) => `/dashboard/courses/${id}`, newHref: '/dashboard/courses/new', screen: { refs, kayan: courses, page: node } },
    raw: {},
    onQuery: () => {},
    first: { input: { sort: undefined, limit: 10 }, rows },
    find: async (input: Record<string, unknown>) => (found.push(input), rows),
    run: async () => ({}),
    own: createElement(Cards),
  })))
  const cards = host.querySelector('[data-cards]')!
  assert.ok(cards, 'the component the node names is drawn')
  assert.equal(cards.getAttribute('data-cards'), '2', 'handed the count the host read')
  assert.deepEqual([...cards.querySelectorAll('a')].map((one) => [one.textContent, one.getAttribute('href')]), [['Tajweed', '/dashboard/courses/c1'], ['Nahw', '/dashboard/courses/c2']], 'and the rows, each with the link the host writes')
  assert.equal(cards.getAttribute('data-new'), '/dashboard/courses/new', 'and the link to a new one')
  assert.equal(host.querySelector('table'), null, 'in place of the registry\'s table')
  // The client's five-minute gc timer would keep the process alive after the file's last test.
  await act(async () => {
    mounted!.unmount()
    mounted = undefined
    queries.clear()
  })
})

test('215c. a list of a kayan that keeps drafts reads with draft for an actor holding findVersions, and plain for one without, as Payload\'s admin list reads', async () => {
  const rows = { docs: [{ id: 'c1', title: 'Never published', _status: 'draft' }], totalDocs: 1, totalPages: 1, page: 1, limit: 10, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null }
  const node = courses.pages.list as TreePage
  const asked: unknown[] = []
  for (const operations of [{ find: true, findVersions: true }, { find: true }]) {
    const queries = new QueryClient()
    await render(createElement(QueryClientProvider as never, { client: queries }, createElement(ScreenList, {
      props: { kayan: courses, operations, t, locale: 'en', href: (id: string) => `/dashboard/courses/${id}`, newHref: '/dashboard/courses/new', screen: { refs, kayan: courses, page: node } },
      raw: {},
      onQuery: () => {},
      find: async (_input: Record<string, unknown>, options?: unknown) => (asked.push(options), rows),
      run: async () => ({}),
      own: createElement('i'),
    })))
    await act(async () => new Promise((done) => setTimeout(done, 10)))
    await act(async () => {
      mounted!.unmount()
      mounted = undefined
      queries.clear()
    })
  }
  assert.equal(!!courses.drafts, true, 'courses keeps drafts')
  const host = await render(createElement(List, {
    kayan: courses,
    screen: { refs, kayan: courses, page: node },
    page: { ...rows, docs: [...rows.docs, { id: 'c2', title: 'Out', _status: 'published' }], totalDocs: 2 },
    query: {},
    t,
    locale: 'en',
    onQuery: () => {},
    href: (id: string) => `/dashboard/courses/${id}`,
    newHref: '/dashboard/courses/new',
  } as never))
  const column = [...host.querySelectorAll('th')].findIndex((one) => one.textContent?.trim() === 'Status')
  assert.deepEqual([...host.querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[column]?.textContent?.trim()), ['Draft', 'Published'], 'the Status column says draft or published')
  await act(async () => {
    mounted!.unmount()
    mounted = undefined
  })
  assert.deepEqual(asked, [{ draft: true }, undefined], 'a draft read for the actor holding findVersions, a plain one for the actor without it')
})

test('215m. a bulk that left ticked rows never published says how many above the list', async () => {
  const rows = { docs: [{ id: 'c1', title: 'Draft', _status: 'draft' }], totalDocs: 1, totalPages: 1, page: 1, limit: 10, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null }
  const Runs = () => {
    // The host hands the list its `run` beside what `ListState` types.
    const { run } = useList() as unknown as { run: (operation: string, input: Record<string, unknown>) => Promise<unknown> }
    return createElement('button', { 'data-run': '', onClick: () => void run('updateMany', {}) })
  }
  const queries = new QueryClient()
  const host = await render(createElement(QueryClientProvider as never, { client: queries }, createElement(ScreenList, {
    props: { kayan: courses, t, locale: 'en', href: (id: string) => `/dashboard/courses/${id}`, newHref: '/dashboard/courses/new', screen: { refs, kayan: courses, page: courses.pages.list as TreePage } },
    raw: {},
    onQuery: () => {},
    first: { input: { sort: undefined, limit: 10 }, rows },
    find: async () => rows,
    run: async () => ({ docs: [], errors: [{ id: 'c1', message: 'never published' }] }),
    own: createElement(Runs),
  })))
  assert.equal(host.querySelector('[data-mithaq-left]'), null, 'nothing is said before a bulk')
  await act(async () => {
    ;(host.querySelector('[data-run]') as HTMLElement).click()
    await new Promise((done) => setTimeout(done, 10))
  })
  assert.equal(host.querySelector('[data-mithaq-left]')?.textContent, '1 of the ticked rows were left as they are, because they have never been published.')
  await act(async () => {
    mounted!.unmount()
    mounted = undefined
    queries.clear()
  })
})

test('a component node by its reference is handed its page, inside the layout its page nests in the shell', async () => {
  const page = courses.pages.board! as TreePage
  const { drawNodes } = await import('../registry/nodes.tsx')
  const { nodesOf } = await import('../registry/node-tree.ts')
  const host = await render(createElement('div', null, drawNodes({
    nodes: nodesOf(page),
    draw: {
    kayan: courses,
    scope: {},
    copy: { t, locale: 'en' },
    issues: {},
    control: () => null,
    layout: ({ path: ref, regions, index }) => createElement('div', { key: index, 'data-nested': ref }, regions.main),
    component: (ref, index) => createElement(refs[ref as keyof typeof refs] as (props: ComponentProps) => ReactElement, { key: index, page }),
  },
  })))
  assert.ok(host.querySelector(`[data-nested="${screen.layouts.table}"] [data-empty="courses/courses/board"]`), 'the component sits in the layout nested in the shell\'s region')
  assert.ok(host.querySelector('[data-empty="courses/courses/board"]'), 'the board page draws the component its path names')
})

test(`a page button that names a component draws it with ButtonProps, and its run calls the operation on the row`, async () => {
  const ran: unknown[] = []
  const Archive = ({ operation, run, busy }: ButtonProps) =>
    createElement('button', { type: 'button', 'data-button': operation, 'data-row': String(useRecord()?.id), disabled: busy, onClick: () => void run({ reason: 'done' }) }, 'Archive now')
  const page = recordPage([{ form: [{ field: 'title' }] }], { side: [{ button: 'archive', label: { en: 'Archive', ar: 'أرشفة' }, component: './src/ui-portal/archive-button.tsx#ArchiveButton' }] })
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: { refs: { ...refs, './src/ui-portal/archive-button.tsx#ArchiveButton': Archive }, kayan: courses, page: page as TreePage },
    client: { ...writes, run: async (operation: string, input: Record<string, unknown>) => ran.push([operation, input]) },
    operations: { archive: true },
    value: { id: 'c1', title: 'Calligraphy' },
    t,
    locale: 'en',
    onDone: () => {},
  }), { record: { id: 'c1', title: 'Calligraphy' } })
  const button = host.querySelector('[data-button="archive"]')!
  assert.equal(button.getAttribute('data-row'), 'c1', 'the button is handed the row')
  await act(async () => click(button))
  assert.deepEqual(ran, [['archive', { reason: 'done', id: 'c1' }]], 'and its run posts the operation over that row')
})

test('a nav node draws the screen\'s nav as handed, each entry linked under the screen\'s path and named by its label or its kayan', async () => {
  const { drawNodes } = await import('../registry/nodes.tsx')
  const { NavLinks } = await import('../registry/nav-links.tsx')
  // The nav a host hands is already cut to the actor, so this list is exactly what the node draws.
  const cut = { ...screen, nav: [screen.nav[0]!, { path: '/members', page: 'members', label: { en: 'Members', ar: 'الأعضاء' } }] }
  const host = await render(createElement('div', null, drawNodes({
    nodes: [{ nav: {} }],
    draw: {
    kayan: courses,
    scope: {},
    copy: { t, locale: 'en' },
    issues: {},
    control: () => null,
    component: () => null,
    layout: () => null,
    nav: () => createElement(NavLinks),
  },
  })), { screen: cut })
  const links = [...host.querySelectorAll('[data-node="nav"] a')].map((one) => [one.getAttribute('href'), one.textContent])
  assert.deepEqual(links, [['/dashboard/courses', 'courses'], ['/dashboard/members', 'Members']])
})

test('a tabs node outside every card draws the line bar across the page, and one inside a section, an accordion or a pill strip draws the pill strip', async () => {
  const { drawNodes } = await import('../registry/nodes.tsx')
  const group = (fields: unknown[]) => ({ label: { en: 'G', ar: 'م' }, fields })
  const tabs = (inner: unknown[] = [{ field: 'title' }]) => ({ tabs: [{ tab: 'a', ...group(inner) }, { tab: 'b', ...group([{ field: 'fee' }]) }] })
  const drawn = async (tree: unknown[]) => render(createElement('div', null, drawNodes({
    nodes: tree as never[],
    draw: {
    kayan: courses,
    scope: {},
    copy: { t, locale: 'en' },
    issues: {},
    control: (leaf) => createElement('i', { key: typeof leaf === 'string' ? leaf : leaf.field }),
    component: () => null,
    layout: ({ regions, index }) => createElement('div', { key: index }, regions.main),
  },
  })))
  const lists = (host: HTMLElement) => [...host.querySelectorAll('[data-slot="tabs-list"]')].map((one) => one.getAttribute('data-variant'))

  const page = await drawn([tabs()])
  assert.deepEqual(lists(page), ['line'], 'a tabs node at page level draws the line bar')
  const root = page.querySelector('[data-node="tabs"]')!
  assert.ok(!root.className.includes('border'), 'with no box of its own around it')
  assert.match(page.querySelector('[data-slot="tabs-list"]')!.className, /\bw-full\b.*\bjustify-start\b|\bjustify-start\b.*\bw-full\b/, 'across the page, starting at the start edge')
  for (const trigger of page.querySelectorAll('[data-slot="tabs-trigger"]')) assert.match(trigger.className, /\bflex-none\b/, 'each trigger sized to its label')
  assert.ok(!page.querySelector('[data-slot="tabs-content"]')!.className.split(' ').includes('p-4'), 'and its panel takes no card padding')

  assert.deepEqual(lists(await drawn([{ layout: 'L', main: [tabs()] }])), ['line'], 'tabs in a layout region draw the line bar')
  assert.deepEqual(lists(await drawn([{ form: [tabs()] }])), ['line'], 'and so do tabs straight in a form node, which draws no card around what it holds')

  assert.deepEqual(lists(await drawn([{ section: 's', ...group([tabs()]) }])), ['default'], 'tabs inside a section keep the pill strip')
  assert.deepEqual(lists(await drawn([{ accordion: [{ item: 'i', ...group([tabs()]) }] }])), ['default'], 'and inside an accordion')
  assert.deepEqual(lists(await drawn([{ section: 's', ...group([tabs([tabs()])]) }])), ['default', 'default'], 'and inside a pill strip')
  assert.deepEqual(lists(await drawn([tabs([tabs()])])), ['line', 'line'], 'while tabs in a line bar\'s panel sit on the page, outside every card')
  const pill = (await drawn([{ section: 's', ...group([tabs()]) }])).querySelector('[data-node="tabs"]')!
  assert.match(pill.className, /\brounded-lg border\b/, 'the pill strip keeps its bordered box')
})

const dialog = () => document.querySelector('[data-slot="alert-dialog-content"]')
const answer = (words: string) => [...(dialog()?.querySelectorAll('button') ?? [])].find((one) => one.textContent?.trim() === words)!

test(`a button node with a confirm asks in the app's own dialog, in the locale, and runs only on yes, wherever it sits`, async () => {
  const ran: unknown[] = []
  // The browser's own dialog speaks the browser's language, so nothing may ask it.
  const browser = window as unknown as { confirm: (message: string) => boolean }
  const confirm = browser.confirm
  let native = 0
  browser.confirm = () => (native++, true)
  try {
    const recount = { name: 'recount', effect: 'update' }
    const kayan = { ...courses, operations: [...courses.operations, recount] }
    const page = recordPage([{ form: [{ field: 'title' }] }], { side: [{ button: 'recount', label: { en: 'Recount', ar: 'إعادة العد' }, confirm: { title: { en: 'Recount?', ar: 'إعادة العد؟' }, body: { en: 'Every seat is counted again.', ar: 'يعاد عد كل مقعد.' } } }] })
    const drawn = (locale: string) => render(createElement(Form, {
      kayan,
      screen: { refs, kayan, page: page as TreePage },
      client: { ...writes, run: async (operation: string, input: Record<string, unknown>) => (ran.push([operation, input]), {}) },
      operations: { recount: true },
      value: { id: 'c1', title: 'Calligraphy' },
      t: (key: string, fallback?: string) => (locale === 'ar' && key === 'admin.cancel' ? 'إلغاء' : fallback),
      locale,
      onDone: () => {},
    }))
    const host = await drawn('en')
    const button = () => [...host.querySelectorAll('aside button')].find((one) => one.textContent === 'Recount')!
    assert.ok(button(), 'the button is drawn in the side region, where its node sits')
    assert.equal(dialog(), null, 'and no dialog is open before the click')
    await act(async () => click(button()))
    assert.equal(dialog()?.textContent?.includes('Recount?'), true, 'the click opens the dialog under the confirm\'s title')
    assert.equal(dialog()?.textContent?.includes('Every seat is counted again.'), true, 'with its body')
    await act(async () => click(answer('Cancel')))
    assert.deepEqual(ran, [], 'and Cancel runs nothing')
    await act(async () => click(button()))
    await act(async () => click(answer('Recount')))
    assert.deepEqual(ran, [['recount', { id: 'c1' }]], 'its yes, the button\'s own words, runs the operation over the row')

    const arabic = await drawn('ar')
    await act(async () => click([...arabic.querySelectorAll('aside button')].find((one) => one.textContent === 'إعادة العد')!))
    assert.equal(dialog()?.textContent?.includes('إعادة العد؟'), true, 'in Arabic the dialog asks in Arabic')
    assert.equal(answer('إلغاء') !== undefined, true, 'and its way out is Arabic too')
    await act(async () => click(answer('إلغاء')))
    assert.equal(native, 0, 'and the browser\'s own dialog was never asked')
  } finally {
    browser.confirm = confirm
  }
})

test(`a record page draws no sentence of its kayan's, while a create page still does`, async () => {
  const about = 'Everything on offer in the catalogue, and what a seat on each costs.'
  assert.equal(courses.description?.en, about, 'the template\'s courses carry the sentence this test looks for')
  const page = recordPage([{ form: [{ field: 'title' }] }])
  assert.equal((await render(formOf(page, { id: 'c1', title: 'Calligraphy' }))).textContent!.includes(about), false, 'the edit page, which draws one row, draws none')
  assert.equal((await render(formOf(page))).textContent!.includes(about), true, 'the create page draws it under its title')
})

test('a group whose every leaf is a field the viewer may not read is not drawn, and a region whose every node is hidden is handed as nothing', async () => {
  const { drawNodes, regionsOf } = await import('../registry/nodes.tsx')
  const kayan = { ...courses, fields: courses.fields.filter((field) => field.name === 'title') }
  const group = (section: string, fields: unknown[]) => ({ section, label: { en: section, ar: section }, fields })
  const draw = {
    kayan,
    scope: { record: null, $user: { collections: { courses: { operations: { archive: false } } } } },
    copy: { t, locale: 'en' },
    issues: {},
    control: (leaf: unknown) => createElement('i', { key: typeof leaf === 'string' ? leaf : (leaf as { field: string }).field }),
    component: (_ref: string, index: number) => createElement('b', { key: index }),
    layout: (_ref: string, regions: Record<string, unknown>, index: number) => createElement('div', { key: index }, regions.main as never),
  }
  const tree = [group('about', ['title']), group('pricing', [{ row: ['fee', 'currency'] }]), group('notes', [{ component: 'C' }])] as never[]
  const host = await render(createElement('div', null, drawNodes({ nodes: tree, draw: draw as never })))
  assert.deepEqual([...host.querySelectorAll('[data-node="section"]')].map((one) => one.textContent), ['about', 'notes'], 'the section holding no readable field is left out, and one holding a component kept')
  const loose = await render(createElement('div', null, drawNodes({ nodes: [{ form: ['fee', 'currency'] }] as never[], draw: draw as never })))
  assert.equal(loose.querySelectorAll('[data-slot="card"]').length, 0, 'a run of loose leaves the viewer may not read draws no card')
  const parted = await render(createElement('div', null, drawNodes({ nodes: [{ form: ['fee', { separator: true }, 'currency'] }] as never[], draw: draw as never })))
  assert.equal(parted.querySelectorAll('[data-slot="card"]').length, 0, 'nor does one with only a separator between them')
  const regions = regionsOf({ main: tree, danger: [{ button: 'archive', label: { en: 'Archive', ar: 'أرشفة' }, when: { '$user.collections.courses.operations.archive': { equals: true } } }] } as never, draw as never)
  assert.equal(regions.danger, undefined, 'a danger zone whose one button the viewer may not run is no region at all')
  const denied = [{ button: 'archive', label: { en: 'Archive', ar: 'أرشفة' } }, { button: 'delete', label: { en: 'Delete', ar: 'حذف' } }]
  const buttons = (allowed: string[]) => regionsOf({ main: tree, danger: denied } as never, { ...draw, button: (node: { button: string }) => (allowed.includes(node.button) ? createElement('button', { key: node.button }) : null) } as never)
  assert.equal(buttons([]).danger, undefined, 'a danger zone none of whose buttons the viewer may run is no region at all')
  assert.notEqual(buttons(['delete']).danger, undefined, 'while one holding a button the viewer may run is drawn')
  assert.equal(regionsOf({ main: tree, danger: denied } as never, draw as never).danger, undefined, 'and a page that draws no button draws no danger zone')
  const grouped = [{ row: denied }, group('more', [{ button: 'delete', label: { en: 'Delete', ar: 'حذف' } }])]
  assert.equal(regionsOf({ main: tree, danger: grouped } as never, { ...draw, button: () => null } as never).danger, undefined, 'nor one whose denied buttons sit in a row or a section')
  assert.notEqual(regionsOf({ main: tree, danger: grouped } as never, { ...draw, button: (node: { button: string }) => (node.button === 'delete' ? createElement('button', { key: 'd' }) : null) } as never).danger, undefined, 'while a section holding one allowed button is drawn')
  assert.notEqual(regions.main, undefined, 'while a region with something to draw is drawn')
})

test(`a form node that names a component draws it in place of its leaves, reading and writing the form's values through useForm(), and the form still saves them`, async () => {
  const written: unknown[] = []
  const Own = (_: ComponentProps) => {
    const form = useForm()
    return createElement('button', { type: 'button', 'data-own-form': String(form.getData().title), onClick: () => form.setValue('title', 'Renamed') }, 'Rename')
  }
  const page = recordPage([{ form: [{ field: 'title' }], component: './src/ui-dashboard/own-form.tsx#OwnForm' }])
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: { refs: { ...refs, './src/ui-dashboard/own-form.tsx#OwnForm': Own }, kayan: courses, page: page as TreePage },
    client: { ...writes, update: async (input: Record<string, unknown>) => (written.push(input), {}) },
    value: { id: 'c1', title: 'Calligraphy' },
    t,
    locale: 'en',
    onDone: () => {},
  }))
  assert.equal(host.querySelector('#courses-title'), null, 'the leaf is not drawn: the component draws instead')
  const own = host.querySelector('[data-own-form]')!
  assert.equal(own.getAttribute('data-own-form'), 'Calligraphy', 'handed the values the form holds')
  await act(async () => click(own))
  await act(async () => fire(host.querySelector('form')!, 'submit'))
  assert.deepEqual(written, [{ id: 'c1', title: 'Renamed' }], 'and the form saves what it set')
})

test(`a leaf with a when is drawn only while the form's values match it, and follows each change`, async () => {
  const page = recordPage([{ form: ['delivery', { field: 'accessCode', when: { delivery: { equals: 'live' } } }] }])
  const host = await render(formOf(page, { id: 'c1', title: 'Calligraphy', delivery: 'recorded' }))
  const shown = () => host.textContent!.includes('Access code')
  const pick = (label: string) => click([...host.querySelectorAll('[role="radio"]')].find((one) => one.closest('label')?.textContent?.includes(label) ?? one.getAttribute('aria-label') === label)!)
  assert.equal(shown(), false, 'hidden while delivery is recorded')
  await act(async () => pick('Live'))
  assert.equal(shown(), true, 'drawn once delivery is live')
  await act(async () => pick('Recorded'))
  assert.equal(shown(), false, 'and hidden again')
})

test(`a section with a when on $user is drawn for the actor the access report lets through and for no other`, async () => {
  const page = recordPage([{ form: ['title', { section: 'notes', label: { en: 'Notes', ar: 'ملاحظات' }, when: { '$user.collections.courses.delete': { equals: true } }, fields: ['archiveReason'] }] }])
  const allowed = await render(formOf(page), { access: { collections: { courses: { delete: true } } } })
  assert.ok(allowed.textContent!.includes('Notes'), 'drawn for an actor who may delete')
  const denied = await render(formOf(page), { access: { collections: { courses: { delete: false } } } })
  assert.ok(!denied.textContent!.includes('Notes'), 'and not for one who may not')
})

test(`a button with a when on the record is drawn only over a row that matches it`, async () => {
  const unarchived = { or: [{ 'record.archived': { exists: false } }, { 'record.archived': { equals: false } }] }
  const page = recordPage([{ form: ['title'] }], { side: [{ button: 'archive', label: { en: 'Archive', ar: 'أرشفة' }, when: unarchived }] })
  const over = (value: Record<string, unknown>) =>
    render(createElement(Form, {
      kayan: courses,
      screen: { refs, kayan: courses, page: page as TreePage },
      client: { ...writes, run: async () => ({}) },
      operations: { archive: true },
      value,
      t,
      locale: 'en',
      onDone: () => {},
    }))
  const button = (host: Element) => [...host.querySelectorAll('aside button')].some((one) => one.textContent === 'Archive')
  assert.ok(button(await over({ id: 'c1', title: 'Calligraphy' })), 'drawn over a row never archived')
  assert.ok(button(await over({ id: 'c1', title: 'Calligraphy', archived: false })), 'and over one unarchived')
  assert.ok(!button(await over({ id: 'c1', title: 'Calligraphy', archived: true })), 'and not over an archived one')
})

test(`useField() reads and writes one field of the form a component sits in`, async () => {
  const Title = (_: ComponentProps) => {
    const title = useField<string>({ path: 'title' })
    return createElement('button', { type: 'button', 'data-field-title': title.value, disabled: title.disabled, onClick: () => title.setValue(`${title.value}!`) }, 'Shout')
  }
  const page = recordPage([{ form: [{ field: 'title' }, { component: activity }] }])
  const host = await render(createElement(Form, {
    kayan: courses,
    screen: { refs: { ...refs, [activity]: Title }, kayan: courses, page: page as TreePage },
    client: writes,
    value: { id: 'c1', title: 'Calligraphy' },
    t,
    locale: 'en',
    onDone: () => {},
  }))
  await act(async () => click(host.querySelector('[data-field-title]')!))
  assert.equal(host.querySelector('[data-field-title]')!.getAttribute('data-field-title'), 'Calligraphy!', 'the field\'s value, after its own write')
  assert.equal((host.querySelector('#courses-title') as HTMLInputElement).value, 'Calligraphy!', 'which the field\'s control draws too')
})

test('useForm() outside a form throws a message that says where it can be read, and every screen hook outside a screen does too', () => {
  const Outside = () => String(useForm().getData().title)
  assert.throws(
    () => renderToStaticMarkup(createElement(ScreenContext, { value: state }, createElement(Outside))),
    { message: 'useForm() reads the form a component sits in, and this component sits in none: only a component a form draws, such as one a form node names, can read or write its values.' },
  )
  const Screenless = () => useScreen().path
  assert.throws(() => renderToStaticMarkup(createElement(Screenless)), /^Error: useScreen\(\) reads what a screen's host provides/)
  const Kayanless = () => useKayan().name
  assert.throws(
    () => renderToStaticMarkup(createElement(ScreenContext, { value: { ...state, kayan: undefined } }, createElement(Kayanless))),
    /^Error: useKayan\(\) reads the kayan a page belongs to/,
  )
})

test('every node kind is drawn through the one map and walked through it, in the order mithaq/admin asks for them', async () => {
  const { drawNodes } = await import('../registry/nodes.tsx')
  const { leavesOf } = await import('../registry/node-tree.ts')
  assert.deepEqual(Object.keys(defaultComponents.nodes), [...nodeKinds], 'one entry per kind, and no other')
  const group = (fields: unknown[]) => ({ label: { en: 'G', ar: 'م' }, fields })
  // One node of every kind, each container holding a leaf, so a walk that
  // missed a kind's children would miss that leaf.
  const tree = [
    { layout: 'L', main: [{ field: 'title' }] },
    { form: [{ field: 'summary' }] },
    { list: { columns: [] } },
    { button: 'archive', label: { en: 'Archive', ar: 'أرشفة' } },
    { title: {} },
    { nav: {} },
    { controls: {} },
    { component: 'C' },
    { row: [{ field: 'fee' }] },
    { separator: true },
    { tabs: [{ tab: 't', ...group([{ field: 'level' }]) }] },
    { accordion: [{ item: 'i', ...group([{ field: 'tags' }]) }] },
    { section: 's', ...group([{ field: 'opensOn' }]) },
  ] as never[]
  assert.deepEqual([...leavesOf(tree)], ['title', 'summary', 'fee', 'level', 'tags', 'opensOn'], 'every container\'s leaves, in order')
  const host = await render(createElement('div', null, drawNodes({
    nodes: tree,
    draw: {
    kayan: courses,
    scope: {},
    copy: { t, locale: 'en' },
    issues: {},
    control: (leaf) => createElement('i', { key: typeof leaf === 'string' ? leaf : leaf.field, 'data-leaf': typeof leaf === 'string' ? leaf : leaf.field }),
    component: (_ref, index) => createElement('b', { key: index }),
    layout: ({ regions, index }) => createElement('div', { key: index }, regions.main),
    controls: () => createElement('b'),
  },
  })))
  for (const kind of nodeKinds.filter((one) => one !== 'field')) {
    assert.ok(host.querySelector(`[data-node="${kind}"]`), `the ${kind} node is drawn`)
  }
  assert.equal(host.querySelectorAll('[data-leaf]').length, 6, 'and every leaf inside them')
})

test('a button\'s run asks its confirm first on every path, so a project\'s own button component cannot skip the question', async () => {
  const { OwnButton } = await import('../registry/node-buttons.tsx')
  const ran: unknown[] = []
  const Own = ({ run }: ButtonProps) => createElement('button', { type: 'button', 'data-own-button': 'archive', onClick: () => void run({ reason: 'Moved' }) }, 'Mine')
  await render(createElement(OwnButton, {
    Own,
    operation: { name: 'archive', label: { en: 'Archive', ar: 'أرشفة' }, confirm: { title: { en: 'Sure?', ar: 'متأكد؟' }, body: { en: 'It runs.', ar: 'يعمل.' } } },
    busy: false,
    copy: { t, locale: 'en' },
    call: async (input: Row) => void ran.push(input),
  }))
  const own = () => document.querySelector('[data-own-button]')!
  await act(async () => click(own()))
  assert.equal(dialog()?.textContent?.includes('Sure?'), true, 'the component\'s run opens the confirm')
  await act(async () => click(answer('Cancel')))
  assert.deepEqual(ran, [], 'a no runs nothing')
  await act(async () => click(own()))
  await act(async () => click(answer('Archive')))
  assert.deepEqual(ran, [{ reason: 'Moved' }], 'a yes runs the call with the input the component passed')
})

for (const mode of ['dialog', 'sheet', 'drawer'] as const) {
  test(`a record opens over the list as a ${mode}`, async () => {
    await render(createElement(RecordFrame, { mode, title: 'Course', closeLabel: 'Close', onClose: () => {} }, createElement('p', { id: `in-${mode}` }, 'form')))
    const popup = document.querySelector(`[data-slot="${mode}-content"]`)
    assert.ok(popup, `the ${mode} is open`)
    assert.ok(popup!.querySelector(`#in-${mode}`), 'with the record inside it')
  })
}

test('216a. a sheet or a dialog opens on the first field of its own form, and on a touch on the popup itself, which keeps the phone\'s keyboard down', async () => {
  for (const mode of ['sheet', 'dialog'] as const) {
    await render(createElement(RecordFrame, { mode, title: 'Course', closeLabel: 'Close', onClose: () => {} }, createElement('button', { type: 'button' }, 'Cancel'), createElement('form', null, createElement('input', { type: 'hidden', id: `hidden-${mode}` }), createElement('input', { id: `first-${mode}` }), createElement('input', { id: `second-${mode}` }))))
    await act(async () => new Promise((done) => setTimeout(done, 50)))
    assert.equal(document.activeElement?.id, `first-${mode}`, `the ${mode} opens on its first field, past the bar's Cancel before it`)
  }
  const outer = document.createElement('div')
  outer.innerHTML = '<form><input id="outer-field"></form>'
  const inner = document.createElement('div')
  inner.innerHTML = '<form><input disabled id="off"><input id="inner-field"></form>'
  document.body.append(outer, inner)
  const choose = initialFocusIn({ current: inner as unknown as HTMLElement })
  assert.equal((choose('mouse') as HTMLElement).id, 'inner-field', 'a mouse or a key focuses the first field the popup holds, past a disabled one, never the outer popup\'s')
  assert.equal(choose('touch'), inner, 'a touch focuses the popup')
  // A record frame opens with its route, so the primitive hands no type, and
  // the device's own pointer decides.
  const media = (globalThis as { matchMedia?: unknown }).matchMedia
  for (const coarse of [true, false]) {
    ;(globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({ matches: query === '(pointer: coarse)' && coarse })
    assert.equal(choose('') === inner, coarse, coarse ? 'with no type, a coarse pointer focuses the popup' : 'and a fine one the field')
    // A phone may report a tap as a mouse click; only the keyboard keeps the field.
    assert.equal(choose('mouse') === inner, coarse, coarse ? 'a click on a coarse pointer focuses the popup' : 'and on a fine one the field')
    assert.equal(choose('keyboard') === inner, false, 'a key always focuses the field')
  }
  ;(globalThis as { matchMedia?: unknown }).matchMedia = media
  assert.equal(initialFocusIn({ current: outer.querySelector('form')!.parentElement!.appendChild(document.createElement('p')) as unknown as HTMLElement })('keyboard'), true, 'and a popup with no field leaves the choice to the primitive')
  outer.remove()
  inner.remove()
})

test('216b. only the list\'s boxes grow to a 44 pixel target, and only on a phone, so a checkbox group\'s options 28 pixels apart never take a press meant for the one above', async () => {
  const { SelectAll } = await import('../registry/list-selection.tsx')
  const head = renderToStaticMarkup(createElement(SelectAll, { ids: ['a'], selected: new Set<string>(), onSelect: () => {}, t }))
  assert.equal(head.includes('after:-inset-x-3.5') && head.includes('max-sm:after:-inset-y-3.5'), true, `the list's box is 44 wide, and 44 tall on a phone:\n${head}`)
  const group = await render(createElement(controls.checkboxGroup!, {
    field: { name: 'tags', kind: 'textArray', rules: {}, options: [{ value: 'a', label: { en: 'A', ar: 'أ' } }, { value: 'b', label: { en: 'B', ar: 'ب' } }] } as never,
    kayan: courses, id: 'tags', t, locale: 'en', value: [], values: {}, setValue: () => {}, readOnly: false, onChange: () => {},
  }))
  const classes = [...group.querySelectorAll('[role="checkbox"]')].map((one) => one.className)
  assert.equal(classes.length, 2, 'the group draws its two boxes')
  assert.equal(classes.some((one) => /-inset(-[xy])?-3\.5/.test(one)), false, `whose layer is the primitive's own:\n${classes.join('\n')}`)
})

test('the five shadcn controls report the value shape of the kind they draw', async () => {
  const drawn = async (name: string, field: Record<string, unknown>, value: unknown) => {
    const reported: unknown[] = []
    const host = await render(createElement(controls[name]!, {
      field: { rules: {}, ...field } as never, kayan: courses, id: String(field.name), t, locale: 'en',
      value, values: {}, setValue: () => {}, readOnly: false, onChange: (next: unknown) => reported.push(next),
    }))
    return { host, reported }
  }
  const options = [{ value: 'a', label: { en: 'A', ar: 'أ' } }, { value: 'b', label: { en: 'B', ar: 'ب' } }]

  const toggle = await drawn('toggle', { name: 'archived', kind: 'checkbox' }, false)
  await act(async () => click(toggle.host.querySelector('button')!))
  assert.deepEqual(toggle.reported, [true], 'toggle reports a boolean')

  const group = await drawn('buttonGroup', { name: 'level', kind: 'text', options }, 'a')
  await act(async () => click([...group.host.querySelectorAll('button')].find((one) => one.textContent === 'B')!))
  assert.deepEqual(group.reported, ['b'], 'buttonGroup reports the option value')

  const boxes = await drawn('checkboxGroup', { name: 'tags', kind: 'textArray', options }, ['a'])
  await act(async () => click(boxes.host.querySelectorAll('[role="checkbox"]')[1]!))
  assert.deepEqual(boxes.reported.at(-1), ['a', 'b'], 'checkboxGroup reports the list of ticked values')

  const calendar = await drawn('calendar', { name: 'day', kind: 'date' }, '2026-09-21')
  assert.ok(calendar.host.querySelector('[data-slot="calendar"]'), 'calendar draws a month inline')
  await act(async () => click([...calendar.host.querySelectorAll('button')].find((one) => one.textContent === '22')!))
  assert.deepEqual(calendar.reported, ['2026-09-22'], 'and reports the day as the string the column holds')
})

const cells = defaultComponents.cells
const { refusalOf } = await import('../registry/form-rules.tsx')

test('the browser holds a list to its minRows and maxRows before any request, under the key the server writes, an optional list left empty passing its floor, and a course names at most two topics', () => {
  const topics = Object.values(screen.kayan).find((one) => one.name === 'courses')!.fields.filter((one) => one.name === 'topics')
  assert.deepEqual(
    refusalOf({ kayan: 'courses', fields: topics, values: { topics: ['script', 'grammar', 'recitation'] } })?.data.params.issues,
    [{ path: 'topics', message: 'courses.topics.maxRows' }],
    'three topics are over the ceiling',
  )
  for (const held of [null, [], ['script'], ['script', 'grammar']]) {
    assert.equal(refusalOf({ kayan: 'courses', fields: topics, values: { topics: held } }), undefined, `${JSON.stringify(held)} is within it, an optional list left empty included`)
  }
  const field = (rules: Record<string, unknown>) => [{ name: 'tags', kind: 'textArray', rules, component: 'textArray', cell: 'textArray' }] as never
  assert.deepEqual(refusalOf({ kayan: 'lists', fields: field({ minRows: 2 }), values: { tags: ['a'] } })?.data.params.issues, [{ path: 'tags', message: 'lists.tags.minRows' }], 'one row under a floor of two')
  assert.equal(refusalOf({ kayan: 'lists', fields: field({ minRows: 2 }), values: { tags: [] } }), undefined, 'an optional list left empty passes its floor')
  assert.deepEqual(refusalOf({ kayan: 'lists', fields: field({ required: true, minRows: 1 }), values: { tags: [] } })?.data.params.issues, [{ path: 'tags', message: 'lists.tags.minRows' }], 'a required one is held to it, as the server holds it')
  // A required list takes no rows where it asks for none, as the server reads it: that is how a
  // role holding no permission is saved.
  assert.equal(refusalOf({ kayan: 'lists', fields: field({ required: true }), values: { tags: [] } }), undefined, 'a required list with no floor takes an empty list')
  assert.deepEqual(refusalOf({ kayan: 'lists', fields: field({ required: true }), values: { tags: null } })?.data.params.issues, [{ path: 'tags', message: 'lists.tags.required' }], 'and refuses no list at all')
})

test('the list of controls the registry ships is the registry\'s own controls, no more and no fewer', () => {
  assert.deepEqual([...registryControls].sort(), Object.keys(controls).sort())
})

test('the list of cells the registry ships is the registry\'s own cells, no more and no fewer', () => {
  assert.deepEqual([...registryCells].sort(), Object.keys(cells).sort())
})

test('mithaq screens prints every screen of the project as its tree', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const bin = new URL('../../mithaq/src/asas/cli/mithaq.ts', import.meta.url)
  const { studioText, studioTree } = await import('mithaq/admin')
  const { stdout } = await promisify(execFile)(process.execPath, [bin.pathname, 'screens'], { cwd: new URL('../../../templates/asas/', import.meta.url).pathname })
  const expected = (['dashboard', 'portal', 'backoffice'] as const).map((name) => studioText(studioTree(name, asas.targets[name].client))).join('\n\n')
  assert.equal(stdout, `${expected}\n`)
})

test('a person\'s backoffice actions draw on no viewer\'s own row and on a staff row for a super admin alone, and each asks first in a dialog naming the person, a ban with a reason and an end, a role only when it changed', async (t) => {
  const { UserButtons } = (await import(new URL('../../../templates/asas/src/ui-backoffice/user-actions.tsx', import.meta.url).href)) as { UserButtons: () => ReactElement }
  const sent: { path: string; body: Record<string, unknown> }[] = []
  let gate: Promise<void> = Promise.resolve()
  let refusal: { code: string } | undefined
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: { body: string }) => {
    sent.push({ path: String(url), body: JSON.parse(init.body) as Record<string, unknown> })
    await gate
    return refusal ? Response.json({ ...refusal, message: 'English alone.' }, { status: 403 }) : Response.json({ url: 'http://localhost/elsewhere' })
  })
  const location = window.location as unknown as Record<'reload' | 'assign', () => void>
  const reloaded = t.mock.method(location, 'reload', () => {})
  t.mock.method(location, 'assign', () => {})
  // The page behind a landed action is asked to refresh in place of a reload, which loses its scroll.
  let refreshed = 0
  const refresh = () => refreshed++
  window.addEventListener('mithaq:refresh', refresh)
  t.after(() => window.removeEventListener('mithaq:refresh', refresh))
  const administrator = { access: { permissions: '*' as const }, user: { name: 'Admin', email: 'admin@example.com' } }
  const support = { access: { permissions: ['user.impersonate'] }, user: { name: 'Support', email: 'support@example.com' } }
  // A name holding `$&` is drawn as written, never read as a replacement pattern.
  const person = { id: 'p1', name: 'Layla $&', email: 'layla@example.com', banned: false }
  const cell = (row: Record<string, unknown>, role: string, over: Partial<ScreenState>) => render(createElement(UserButtons), { ...over, record: { ...row, role } })
  const actions = (host: HTMLElement) => host.querySelector('[data-person-actions]')?.getAttribute('data-person-actions')?.split(' ').join(',') ?? ''
  const choose = async (host: HTMLElement, action: string) => {
    await act(async () => click(host.querySelector(`[data-action="${action}"]`)!))
  }
  const dialog = () => document.querySelector('[role="alertdialog"]')
  const confirm = () => document.querySelector('[data-button="confirm"]') as HTMLButtonElement | null

  assert.equal(actions(await cell(person, 'user', administrator)), 'set-role,ban,impersonate', 'a super admin acts on someone who is no staff')
  assert.equal(actions(await cell({ ...person, email: 'admin@example.com' }, 'super_admin', administrator)), '', 'and on nothing of their own row')
  assert.equal(actions(await cell(person, 'explorer', administrator)), 'set-role,ban,impersonate', 'and on a staff row')
  assert.equal(actions(await cell({ ...person, banned: true }, 'user', administrator)), 'set-role,unban', 'a banned person is offered no impersonation, which the provider refuses')
  assert.equal(actions(await cell({ ...person, banned: true }, 'user', support)), '', 'so support is offered nothing')
  assert.equal(actions(await cell(person, 'explorer', support)), '', 'support acts on no staff row')
  assert.equal(actions(await cell({ ...person, email: 'support@example.com' }, 'support', support)), '', 'nor on their own')

  let host = await cell(person, 'user', support)
  assert.equal(actions(host), 'impersonate', 'support impersonates someone who is no staff')
  await choose(host, 'impersonate')
  assert.ok(dialog()?.textContent?.includes('Layla $&'), 'the dialog names the person')
  assert.equal(sent.length, 0, 'and nothing is sent before the answer')
  refusal = { code: 'BANNED_USER' }
  await act(async () => click(confirm()!))
  assert.equal(document.querySelector('[role="alert"]')?.textContent, 'This person is banned, so they cannot be impersonated.', 'a refusal the file knows by its code is said as its own sentence')
  refusal = { code: 'SOMETHING_ELSE' }
  await act(async () => click(confirm()!))
  assert.equal(document.querySelector('[role="alert"]')?.textContent, 'The backoffice refused that action.', 'and any other refusal by the general one')
  refusal = undefined
  sent.length = 0
  await act(async () => click(confirm()!))
  assert.deepEqual(sent.map((one) => [one.path, one.body.userId]), [['/api/auth/user/admin/impersonate-user', 'p1']], 'the answer sends the impersonation')

  sent.length = 0
  host = await cell(person, 'user', administrator)
  await choose(host, 'ban')
  assert.ok(dialog()?.textContent?.includes('Layla $&'), 'the ban names the person')
  assert.equal(confirm()?.disabled, true, 'and is not confirmed with no reason')
  const reason = document.querySelector('[data-ban="reason"]')!
  assert.equal(reason.getAttribute('aria-required'), 'true', 'the reason is marked required')
  assert.equal(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent, 'A ban needs a reason.', 'and points at the sentence saying a ban needs one')
  await act(async () => type(document.querySelector('[data-ban="reason"]')!, '  '))
  assert.equal(confirm()?.disabled, true, 'nor with a blank one')
  await act(async () => type(document.querySelector('[data-ban="reason"]')!, 'Spam'))
  const ends = document.querySelector('[data-ban="ends"]') as HTMLSelectElement
  assert.deepEqual([...ends.options].map((one) => one.value), ['', '86400', '604800', '2592000'], 'never, a day, a week or thirty days')
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(ends, '604800')
    fire(ends, 'change')
  })
  await act(async () => click(confirm()!))
  assert.deepEqual(sent.map((one) => [one.path, one.body]), [['/api/auth/user/admin/ban-user', { userId: 'p1', banReason: 'Spam', banExpiresIn: 604800 }]], 'the ban carries its reason and its end')
  assert.equal(dialog()?.textContent?.includes('Layla $& is banned.'), true, 'the ban says it landed')
  assert.deepEqual([confirm(), document.querySelector('[data-ban]'), refreshed, reloaded.mock.callCount()], [null, null, 1, 0], 'with no question left, the page asked to refresh once and not reloaded')
  assert.equal(document.querySelector('[data-button="close"]')?.textContent, 'Close', 'and the dialog closes on Close')

  sent.length = 0
  host = await cell(person, 'user', administrator)
  await choose(host, 'set-role')
  assert.equal(confirm()?.disabled, true, 'the role the person holds is no change')
  const role = document.querySelector('[data-role="chosen"]') as HTMLSelectElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(role, 'explorer')
    fire(role, 'change')
  })
  assert.ok(dialog()?.textContent?.includes('Layla $&') && dialog()?.textContent?.includes('Explorer'), 'the dialog names the person and the new role')
  await act(async () => click(confirm()!))
  assert.deepEqual(sent.map((one) => [one.path, one.body]), [['/api/auth/user/admin/set-role', { userId: 'p1', role: 'explorer' }]], 'and the answer sets it')
  assert.equal(dialog()?.textContent?.includes('Layla $& now holds the backoffice role "Explorer".'), true, 'the role says it landed')

  sent.length = 0
  host = await cell(person, 'user', support)
  await choose(host, 'impersonate')
  let release!: () => void
  gate = new Promise((done) => (release = done))
  await act(async () => click(confirm()!))
  assert.equal(confirm()?.disabled, true, 'the answer is disabled while the first is awaited')
  await act(async () => click(confirm()!))
  await act(async () => release())
  assert.equal(sent.length, 1, 'a double click on the answer sends once')
  await act(async () => mounted!.unmount())
  mounted = undefined
})

test('220j. what a bulk left is counted in each locale\'s own plural forms, never "1 rows were"', async () => {
  const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const rows = { docs: [{ id: 'c1', title: 'Draft', _status: 'draft' }], totalDocs: 1, totalPages: 1, page: 1, limit: 10, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null }
  const Runs = () => {
    const { run } = useList() as unknown as { run: (operation: string, input: Record<string, unknown>) => Promise<unknown> }
    return createElement('button', { 'data-run': '', onClick: () => void run('updateMany', {}) })
  }
  const said = async (locale: 'en' | 'ar', left: number) => {
    const queries = new QueryClient()
    const host = await render(createElement(QueryClientProvider as never, { client: queries }, createElement(ScreenList, {
      props: { kayan: courses, t: translator(locale), locale, href: (id: string) => `/dashboard/courses/${id}`, newHref: '/dashboard/courses/new', screen: { refs, kayan: courses, page: courses.pages.list as TreePage } },
      raw: {},
      onQuery: () => {},
      first: { input: { sort: undefined, limit: 10 }, rows },
      find: async () => rows,
      run: async () => ({ docs: [], errors: Array.from({ length: left }, (_, index) => ({ id: `c${index}`, message: 'never published' })) }),
      own: createElement(Runs),
    })))
    await act(async () => {
      ;(host.querySelector('[data-run]') as HTMLElement).click()
      await new Promise((done) => setTimeout(done, 10))
    })
    const text = host.querySelector('[data-mithaq-left]')?.textContent
    await act(async () => {
      mounted!.unmount()
      mounted = undefined
      queries.clear()
    })
    return text
  }
  assert.equal(await said('en', 1), '1 of the ticked rows was left as it is, because it has never been published.')
  assert.equal(await said('en', 3), '3 of the ticked rows were left as they are, because they have never been published.')
  assert.equal(await said('ar', 1), 'تُرك صف واحد محدد كما هو، لأنه لم يُنشر قط.')
  assert.equal(await said('ar', 2), 'تُرك صفان محددان كما هما، لأنهما لم يُنشرا قط.')
  assert.equal(await said('ar', 3), 'تُركت 3 صفوف محددة كما هي، لأنها لم تُنشر قط.')
})

test('266b. an edit page edits a row\'s drafts only where findVersions finds a version of that row, so a row the key\'s limit leaves out gets a plain Save, and a create follows the key', async () => {
  const asked: unknown[] = []
  const answering = (docs: unknown[] | null) => async (input: unknown) => {
    asked.push(input)
    return docs && { docs }
  }
  const kayan = { drafts: { autosave: { interval: 2000 } } }
  const holds = { findVersions: true }
  assert.equal(await rowReadsDrafts({ kayan, operations: holds, id: 'a-row', findVersions: answering([{ id: 'v1' }]) }), true, 'a row the key admits is edited as its drafts')
  assert.deepEqual(asked, [{ where: { parent: { equals: 'a-row' } }, limit: 1 }], 'asking one version of that row')
  assert.equal(await rowReadsDrafts({ kayan, operations: holds, id: 'a-row', findVersions: answering([]) }), false, 'a row it leaves out is edited as it is')
  assert.equal(await rowReadsDrafts({ kayan, operations: holds, id: 'a-row', findVersions: answering(null) }), false, 'and so is one whose read was refused')
  asked.length = 0
  assert.equal(await rowReadsDrafts({ kayan, operations: holds, findVersions: answering([]) }), true, 'a create follows the key')
  assert.equal(await rowReadsDrafts({ kayan, operations: {}, id: 'a-row', findVersions: answering([{ id: 'v1' }]) }), false, 'an actor without the key edits the row')
  assert.equal(await rowReadsDrafts({ kayan: {}, operations: holds, id: 'a-row', findVersions: answering([{ id: 'v1' }]) }), false, 'and so does every actor on a kayan keeping no drafts')
  assert.deepEqual(asked, [], 'asking nothing where the key decides')
})

test('a field keeps its box when a when hides a node before it, so typing never remounts the box being typed in', async () => {
  const shownWhileTajweed = { title: { equals: 'Tajweed' } }
  const host = await render(createElement(Form, {
    kayan: courses,
    nodes: [
      { field: 'summary', when: shownWhileTajweed },
      { field: 'title' },
      { section: 'more', label: { en: 'More' }, fields: [{ field: 'level' }] },
      { field: 'fee', when: shownWhileTajweed },
      { field: 'currency' },
    ],
    client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: 'c1', title: 'Tajweed' },
    t,
    locale: 'en',
    onDone: () => {},
  }))
  const title = host.querySelector('#courses-title')!
  const later = host.querySelector('#courses-currency')
  assert.ok(host.querySelector('#courses-summary') && later, 'the summary is shown while the title matches')
  await act(async () => type(title, 'Tajwee'))
  assert.equal(host.querySelector('#courses-summary'), null, 'and hidden once it does not')
  assert.equal(host.querySelector('#courses-title') === title, true, 'the title is the same box, not a new one')
  assert.equal(host.querySelector('#courses-currency') === later, true, 'and so is a field in a later run whose own earlier node was hidden')
})
