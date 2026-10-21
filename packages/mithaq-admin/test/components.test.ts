// The JSX loader is imported for its side effect; registry files load through dynamic import so it is registered first.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactElement } from 'react'
import { asas } from 'asas'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import { defaultMaxBodyBytes, fetchHttp } from 'mithaq'
import './tsx.ts'

const { Form } = await import('../registry/form.tsx')
const { List } = await import('../registry/list.tsx')
const { ComponentsProvider, RouteError, cellFor, checkComponents } = await import('../registry/components.tsx')
const { defaultComponents: shipped } = await import('../registry/default-components.tsx')
const { richTextComponents } = await import('../registry/rich-text.tsx')
const { uploadComponents } = await import('../registry/upload.tsx')
const { withAddOns } = await import('./with-add-ons.ts')
// The template's language holds rich text and files, so its screens draw with both add-ons spread in, as its apps do.
const defaultComponents = withAddOns(shipped, richTextComponents, uploadComponents)
const { drawNodes } = await import('../registry/nodes.tsx')
type Components = import('../registry/components.tsx').Components
type NodeProps<Kind extends import('mithaq/admin').NodeKind> = import('../registry/node-tree.ts').NodeProps<Kind>
type ControlsOf<L> = import('../registry/components.tsx').ControlsOf<L>
type CellsOf<L> = import('../registry/components.tsx').CellsOf<L>
type CellProps = import('../registry/control-props.ts').CellProps
type ControlProps = import('../registry/control-props.ts').ControlProps

const screen = asas.targets.dashboard.client
// One build of the color language for every test here: a build's pool ends once.
const { language, swatches } = await import('./color-language.ts')
const built = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [swatches] })
after(() => built.destroy())
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
const form = () =>
  createElement(Form, {
    kayan: courses,
    client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: '0f1d8c2e-0000-4000-8000-000000000001', title: 'Tajweed' },
    t,
    locale: 'en',
    onDone: () => {},
  })
const drawn = (element: ReactElement) => renderToStaticMarkup(createElement(ScreenContext, { value: state }, element))
const formWith = (components: Components) => drawn(createElement(ComponentsProvider, { components }, form()))

test('boot refuses unregistered navigation icons, including hidden and prototype names', () => {
  const client = { path: '/dashboard', kayan: {}, nav: [
    { path: '/sales', page: 'list', icon: 'receipt', hidden: true },
    { path: '/about', page: 'about', icon: 'constructor' },
  ] }
  assert.throws(() => checkComponents({ client, components: defaultComponents }), /components.icons has no icon "receipt".*\/sales/)
  assert.throws(() => checkComponents({ client, components: { ...defaultComponents, icons: { receipt: () => null } } }), /components.icons has no icon "constructor"/)
  assert.doesNotThrow(() => checkComponents({ client, components: { ...defaultComponents, icons: { receipt: () => null, constructor: () => null } } }))
  assert.doesNotThrow(() => checkComponents({ client: { ...client, nav: [{ path: '/sales', page: 'list' }] }, components: defaultComponents }))
})

test('a kind\'s control is replaced through the components map, and the replacement draws in place of the default', () => {
  assert.match(formWith(defaultComponents), /<input[^>]*id="courses-title"/, 'the default map draws the text box')
  const Mine = ({ id, value }: ControlProps) => createElement('output', { id, 'data-mine': '' }, String(value))
  const html = formWith({ ...defaultComponents, controls: { ...defaultComponents.controls, text: Mine } })
  assert.match(html, /<output id="courses-title" data-mine="">Tajweed<\/output>/, 'the project\'s control draws the title')
  assert.doesNotMatch(html, /<input[^>]*id="courses-title"/, 'and the default does not')
})

test('a kind the map leaves out is an error that names it, and a form drawn under no map says what to mount', () => {
  const { text: _text, ...rest } = defaultComponents.controls
  assert.throws(() => formWith({ ...defaultComponents, controls: rest as Components['controls'] }), /components\.controls has no control for "text"/)
  assert.throws(() => drawn(form()), /ComponentsProvider/)
})

test('a kind the project\'s rukn brings is drawn by the control its map names for it, and a map without one is an error naming the kind and the field', async () => {
  const kayan = built.targets.dashboard.client.kayan.swatches!
  const swatch = (components: Components) =>
    drawn(createElement(ComponentsProvider, { components }, createElement(Form, { kayan, client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }, value: { id: 's1', color: '#c0ffee' }, t, locale: 'en', onDone: () => {} })))
  const ColorControl = ({ id, value }: ControlProps) => createElement('input', { id, type: 'color', value: String(value), readOnly: true })
  const controls = { ...defaultComponents.controls, color: ColorControl } satisfies ControlsOf<typeof language>
  assert.match(swatch({ ...defaultComponents, controls }), /<input id="swatches-color" type="color"[^>]*value="#c0ffee"/, 'the project\'s color control draws the field')
  assert.throws(() => swatch(defaultComponents), /components\.controls has no control for "color", the kind of field "color"/)
  // The app checks every screen it serves against its map at startup, so the gap fails there and not on the page that draws it.
  const client = built.targets.dashboard.client
  assert.throws(() => checkComponents({ client, components: defaultComponents }), /components\.controls has no control for kind "color", which swatches\.color is drawn with/)
  // The kind names its own cell too, so the map the start accepts carries both.
  const cells = { ...defaultComponents.cells, color: ({ value }: CellProps) => String(value) }
  assert.doesNotThrow(() => checkComponents({ client, components: { ...defaultComponents, controls, cells } }))
  assert.doesNotThrow(() => checkComponents({ client: screen, components: defaultComponents }), 'the template\'s own screen needs nothing past the defaults and the add-ons it spreads')
})

test('a language with rich text or files whose map leaves out their add-on stops the start and the page, naming the map to spread', () => {
  assert.throws(
    () => checkComponents({ client: screen, components: shipped }),
    (error: Error) =>
      /components\.controls has no control for kind "richText", which courses\.details is drawn with\. The kind is not installed: spread richTextComponents into the map\./.test(error.message)
      && /components\.cells has no cell for kind "richText", which courses\.details is drawn with\. The kind is not installed: spread richTextComponents into the map\./.test(error.message)
      && /components\.controls has no control for kind "upload", which courses\.cover is drawn with\. The kind is not installed: spread uploadComponents into the map\./.test(error.message),
  )
  assert.throws(() => checkComponents({ client: screen, components: withAddOns(shipped, uploadComponents) }), /spread richTextComponents/)
  assert.throws(() => formWith(shipped), /components\.controls has no control for "richText", the kind of field "details"\. The kind is not installed: spread richTextComponents into the map\./)
  assert.throws(() => formWith(withAddOns(shipped, richTextComponents)), /components\.controls has no control for "upload", the kind of field "cover"\. The kind is not installed: spread uploadComponents into the map\./)
})

test('a route that throws draws the error\'s own words in an alert', () => {
  const html = renderToStaticMarkup(createElement(RouteError, { error: new Error('components.controls has no control for kind "color", which swatches.color is drawn with.') }))
  assert.match(html, /<div role="alert" data-route-error=""[^>]*>components\.controls has no control for kind &quot;color&quot;, which swatches\.color is drawn with\.<\/div>/)
})

test('an integer is drawn by whatever the map draws a number with, so replacing number replaces both', () => {
  const seats = { ...courses, fields: [{ name: 'seats', kind: 'integer', component: 'integer', cell: 'integer', rules: {} }] } as typeof courses
  const Counter = ({ id, value }: ControlProps) => createElement('output', { id, 'data-counter': '' }, String(value))
  const html = drawn(createElement(ComponentsProvider, { components: { ...defaultComponents, controls: { ...defaultComponents.controls, number: Counter } } }, createElement(Form, {
    kayan: seats,
    client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    value: { id: 'c1', seats: 12 },
    t,
    locale: 'en',
    onDone: () => {},
  })))
  assert.match(html, /<output id="courses-seats" data-counter="">12<\/output>/)
})

const page = (docs: Record<string, unknown>[]) => ({ docs, hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, pagingCounter: 1, prevPage: null, totalDocs: docs.length, totalPages: 1 })
const listOf = (kayan: typeof courses, docs: Record<string, unknown>[]) =>
  createElement(List, { kayan, page: page(docs), query: {}, t, locale: 'en', onQuery: () => {}, href: (id: string) => `/${kayan.name}/${id}`, newHref: `/${kayan.name}/new` })

test('a kind\'s cell is replaced through the components map, and the replacement draws in place of the default', () => {
  const docs = [{ id: 'c1', title: 'Tajweed', fee: 300 }]
  assert.match(drawn(createElement(ComponentsProvider, { components: defaultComponents }, listOf(courses, docs))), />300</, 'the default map draws the fee as a number')
  const Mine = ({ value }: CellProps) => createElement('mark', { 'data-mine': '' }, String(value))
  const html = drawn(createElement(ComponentsProvider, { components: { ...defaultComponents, cells: { ...defaultComponents.cells, number: Mine } } }, listOf(courses, docs)))
  assert.match(html, /<mark data-mine="">300<\/mark>/, 'the project\'s cell draws the fee')
})

test('a kind whose own cell the map leaves out stops the start and the page, naming the kind and the field', async () => {
  const kayan = built.targets.dashboard.client.kayan.swatches!
  const client = built.targets.dashboard.client
  const controls = { ...defaultComponents.controls, color: ({ id, value }: ControlProps) => createElement('input', { id, type: 'color', value: String(value), readOnly: true }) }
  const ColorCell = ({ value }: CellProps) => createElement('span', { 'data-swatch': String(value) })
  const cells = { ...defaultComponents.cells, color: ColorCell } satisfies CellsOf<typeof language>
  assert.throws(() => checkComponents({ client, components: { ...defaultComponents, controls } }), /components\.cells has no cell for kind "color", which swatches\.color is drawn with/)
  assert.throws(() => drawn(createElement(ComponentsProvider, { components: { ...defaultComponents, controls } }, listOf(kayan, [{ id: 's1', color: '#c0ffee' }]))), /components\.cells has no cell for "color", the kind of field "color"/)
  assert.match(drawn(createElement(ComponentsProvider, { components: { ...defaultComponents, controls, cells } }, listOf(kayan, [{ id: 's1', color: '#c0ffee' }]))), /<span data-swatch="#c0ffee">/, 'the project\'s color cell draws the field')
})

test('a cell a list column or a leaf names, which the map does not carry, stops the start and the page, naming the screen, the node and the cell', () => {
  const title = { name: 'title', kind: 'text', component: 'text', cell: 'text', rules: {} }
  // A column naming its kind's own cell, which a kind no shipped cell draws may, and a leaf naming one on a record page.
  const client = (cell: string) => ({
    path: '/dashboard',
    kayan: {
      notes: {
        name: 'notes',
        fields: [title],
        operations: [],
        pages: {
          list: { path: '/notes', page: { main: [{ list: { columns: [{ field: 'title', cell }] } }] } },
          edit: { path: '/notes/:id', page: { main: [{ field: 'title', cell, readOnly: true }] } },
        },
      },
    },
  }) as unknown as Parameters<typeof checkComponents>[0]['client']
  assert.throws(
    () => checkComponents({ client: client('swatch'), components: defaultComponents }),
    (error: Error) =>
      /components\.cells has no cell "swatch", which screen \/dashboard notes page "list" list column "title" names/.test(error.message)
      && /components\.cells has no cell "swatch", which screen \/dashboard notes page "edit" leaf "title" names/.test(error.message),
  )
  const cells = { ...defaultComponents.cells, swatch: ({ value }: CellProps) => String(value) }
  assert.doesNotThrow(() => checkComponents({ client: client('swatch'), components: { ...defaultComponents, cells } }))
  assert.doesNotThrow(() => checkComponents({ client: client('./src/ui/swatch.tsx#Swatch'), components: defaultComponents }), 'a ui() reference is drawn by the screen, not the map')
  // Named, so never drawn as the field's own cell in its place.
  assert.throws(() => cellFor({ cells: defaultComponents.cells, field: title, column: 'swatch' }), /components\.cells has no cell "swatch", which field "title" is drawn with/)
  assert.equal(cellFor({ cells: defaultComponents.cells, field: title }), defaultComponents.cells.text, 'and the field\'s own cell stands where nothing is named')
})

const sectioned = (components: Components) => drawn(createElement(ComponentsProvider, { components }, createElement(Form, {
  kayan: courses,
  nodes: [{ section: 'details', label: { en: 'Details' }, fields: [{ field: 'title' }] }],
  client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
  value: { id: 'c1', title: 'Tajweed' },
  t,
  locale: 'en',
  onDone: () => {},
})))

test('a node kind is drawn through the components map, and a replacement draws in place of the shipped one', () => {
  assert.match(sectioned(defaultComponents), /data-node="section"/, 'the shipped section draws the group')
  const Mine = ({ node, draw }: NodeProps<'section'>) => createElement('aside', { 'data-mine': node.section }, drawNodes({ nodes: node.fields, draw }))
  const html = sectioned({ ...defaultComponents, nodes: { ...defaultComponents.nodes, section: Mine } })
  assert.match(html, /<aside data-mine="details">[\s\S]*id="courses-title"[\s\S]*<\/aside>/, 'the project\'s section draws the group, with the fields it holds inside it')
  assert.doesNotMatch(html, /data-node="section"/, 'and the shipped one does not')
})

test('a node kind the map leaves out stops the start and the page, naming the kind and the page that draws it', () => {
  const { section: _section, ...rest } = defaultComponents.nodes
  const sectionless = { ...defaultComponents, nodes: rest as Components['nodes'] }
  assert.throws(() => sectioned(sectionless), /components\.nodes has no node "section"\. Spread defaultComponents\.nodes into the map and add one under that name\./)
  const { title: _title, ...untitled } = defaultComponents.nodes
  assert.throws(
    () => checkComponents({ client: screen, components: { ...defaultComponents, nodes: untitled as Components['nodes'] } }),
    /components\.nodes has no node "title", which screen \/dashboard courses page "create" draws\./,
  )
  assert.doesNotThrow(() => checkComponents({ client: screen, components: { ...defaultComponents, nodes: { ...defaultComponents.nodes, section: () => null } } }), 'a replaced node is a node the map carries')
})

test('the start reads every kind of node a page holds, nested in a group or on a page that opens over its list, and a map with no nodes at all says so', () => {
  const group = (fields: unknown[]) => ({ label: { en: 'G' }, fields })
  const client = {
    path: '/dashboard',
    kayan: {
      notes: {
        name: 'notes',
        fields: [],
        operations: [],
        pages: {
          edit: { path: '/notes/:id', page: { main: [{ tabs: [{ tab: 't', ...group([{ section: 's', ...group([{ field: 'title' }]) }]) }] }] } },
          create: { path: '/notes/new', mode: 'dialog', page: { main: [{ separator: true }] } },
        },
      },
    },
  } as unknown as Parameters<typeof checkComponents>[0]['client']
  const { section: _section, separator: _separator, ...rest } = defaultComponents.nodes
  assert.throws(
    () => checkComponents({ client, components: { ...defaultComponents, nodes: rest as Components['nodes'] } }),
    (error: Error) =>
      /components\.nodes has no node "section", which screen \/dashboard notes page "edit" draws\./.test(error.message)
      && /components\.nodes has no node "separator", which screen \/dashboard notes page "create" draws\./.test(error.message),
  )
  const { nodes: _nodes, ...nodeless } = defaultComponents
  assert.throws(() => checkComponents({ client, components: nodeless as Components }), /components\.nodes has no node "tabs"/)
  assert.throws(() => sectioned(nodeless as Components), /components\.nodes has no node "form"\. Spread defaultComponents\.nodes into the map/)
})


test('audit F08: declared options use a select in field and operation projections', async () => {
  const { language, notes } = await import('./plain-language.ts')
  const choice = { kind: 'text' as const, label: { en: 'Stage', ar: 'المرحلة' }, options: [{ value: 'ready', label: { en: 'Ready', ar: 'جاهز' } }] }
  const declared = language.defineKayan({
    name: notes.name,
    fields: { ...notes.fields, stage: choice },
    targets: { ...notes.targets, service: { operations: {
      ...notes.targets.service.operations,
      create: { ...notes.targets.service.operations.create, targets: { dashboard: { fields: { stage: choice } } } },
    } } },
  })
  const built = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [declared] })
  try {
    const kayan = built.targets.dashboard.client.kayan.notes!
    assert.equal(kayan.fields.find((field) => field.name === 'stage')?.component, 'select')
    assert.equal(kayan.operations.find((operation) => operation.name === 'create')?.fields?.[0]?.component, 'select')
  } finally { await built.destroy() }
})
