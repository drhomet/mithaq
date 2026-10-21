// The JSX loader is imported for its side effect; registry files load through dynamic import so it is registered first.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { renderToStaticMarkup as staticMarkup } from 'react-dom/server'
import { createElement, type ReactElement } from 'react'
import { asas } from 'asas'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import { stateOf } from 'mithaq/upgrade'
import './tsx.ts'

const { List } = await import('../registry/list.tsx')
const { Form } = await import('../registry/form.tsx')
const { copyFile } = await import('../../../apps/asas-tanstack/src/copy.ts')
const { descriptionOf, labelFor, operationLabelFor, placeholderFor, titleOf } = await import('../registry/copy.ts')
const { readOnlyField, seedOf, valuesOf } = await import('../registry/field-values.ts')
const { controlFor: controlIn } = await import('../registry/components.tsx')
const { withAddOns } = await import('./with-add-ons.ts')
// The template's language holds rich text and files, so its screens draw with both add-ons spread in, as its apps do.
const defaultComponents = withAddOns((await import('../registry/default-components.tsx')).defaultComponents, (await import('../registry/rich-text.tsx')).richTextComponents, (await import('../registry/upload.tsx')).uploadComponents)
const { ComponentsProvider } = await import('../registry/components.tsx')
// A template file imports the map as `mithaq-admin/components.tsx`, which resolves to the same module here; the second provider stands for the app's own map.
const { ComponentsProvider: AppComponents } = await import('mithaq-admin/components.tsx')
const appDefaults = withAddOns((await import('mithaq-admin/default-components.tsx')).defaultComponents, (await import('mithaq-admin/rich-text.tsx')).richTextComponents, (await import('mithaq-admin/upload.tsx')).uploadComponents)
const controls: Readonly<Record<string, import('../registry/control-props.ts').Control>> = defaultComponents.controls
const controlFor = (field: ClientField) => controlIn(defaultComponents.controls, field)
const { cellFor: cellIn } = await import('../registry/components.tsx')
const cells = defaultComponents.cells
const cellFor = (field: ClientField, column?: string) => cellIn({ cells, field, column })
const { Shell } = await import('../registry/nav.tsx')
const { iconOf, navEntries, navIcons } = await import('../registry/nav-entries.tsx')
const { endonym, localeEntries } = await import('../registry/locale-menu.ts')
type NavKayan = import('../registry/nav-entries.tsx').NavKayan
const { Filters, addCondition, committedOf, removeCondition, updateCondition, updateJoin } = await import(
  '../registry/list-filters.tsx'
)
type Conditions = import('../registry/list-filters.tsx').Conditions
const { columnCandidates, move, neighbour } = await import('../registry/list-columns.tsx')
const { filterPathsOf, operatorsByKind } = await import('../registry/filter-operators.ts')
const { findWhere, listRaw, prefixOf, readQuery, readRaw, refined, scopedTo, searchWhere, searchableFields, sortableOf, withList, writeQuery } = await import('../registry/list-query.ts')
const { columnsOf, withColumns } = await import('../registry/list-columns.tsx')
const { SelectAll, writableFields } = await import('../registry/list-selection.tsx')
type Query = import('../registry/list-types.tsx').Query
type ClientKayan = import('mithaq/admin').ClientKayan
type ClientField = import('mithaq/admin').ClientField
type PageClient = import('mithaq/admin').PageClient
type ButtonClient = import('mithaq/admin').ButtonClient
const { pageButtonOf } = await import('../registry/node-buttons.tsx')
const { RecordPage } = await import('../../../templates/mithaq/src/ui/record-page.tsx')
const { TablePage } = await import('../../../templates/mithaq/src/ui/table-page.tsx')
const { AppShell, BackofficeShell } = await import('../../../templates/mithaq/src/ui/app-shell.tsx')

test('declared navigation icons override paths in both app shells, with unchanged path and table fallbacks', () => {
  for (const Shell of [AppShell, BackofficeShell]) {
    const nav = [
      { path: '/tags', page: 'list', icon: 'receipt' },
      { path: '/courses', page: 'list' },
      { path: '/custom', page: 'list' },
    ]
    const draw = (icons?: import('../registry/components.tsx').Icons) => staticMarkup(
      createElement(ScreenContext, { value: { ...state, screen: { ...screen, nav } } },
        createElement(AppComponents, { components: { ...appDefaults, icons } },
          createElement(Shell, { regions: { primary: null, more: null, header: 'Header', main: 'Body' } }))),
    )
    const html = draw({ receipt: () => createElement('svg', { 'data-receipt': '' }) })
    assert.match(html, /href="\/dashboard\/tags"[^>]*><svg data-receipt=""/)
    assert.match(html, /href="\/dashboard\/courses"[^>]*><svg[^>]*lucide-book-open/)
    assert.match(html, /href="\/dashboard\/custom"[^>]*><svg[^>]*lucide-table/)
    assert.throws(() => draw(), /components.icons has no icon "receipt"/)
  }
})

test('an app shell with no declared icons still renders without a components provider', () => {
  const html = staticMarkup(createElement(ScreenContext, { value: { ...state, screen: { ...screen, nav: [{ path: '/tags', page: 'list' }] } } },
    createElement(AppShell, { regions: { primary: null, more: null, header: 'Header', main: 'Body' } })))
  assert.match(html, /href="\/dashboard\/tags"[^>]*><svg[^>]*lucide-tags/)
})

const screen = asas.targets.dashboard.client
const kayans = Object.values(screen.kayan)
const courses = screen.kayan.courses!
const settings = screen.kayan.settings!

const fieldOf = (field: Partial<ClientField> & { name: string; kind: string }): ClientField => ({
  rules: {},
  component: field.kind,
  cell: field.kind,
  ...field,
})

const scopes: Record<string, Record<string, Record<string, string>>> = {
  courses: {
    ...copyFile(JSON.parse(readFileSync(new URL('../../../templates/asas/src/messages/courses.json', import.meta.url), 'utf8'))),
    // Keys no generator writes live here: `mithaq generate messages --check` compares the whole of `courses.json`.
    'delete.confirm': { en: 'Delete this course', ar: 'احذف هذه الدورة' },
    'archived.true': { en: 'Archived', ar: 'مؤرشف' },
    'archived.false': { en: 'Active', ar: 'نشط' },
    'title.invalid': { en: 'A course needs a title.', ar: 'الدورة تحتاج عنوانا.' },
    'title.maxLength': { en: 'A title fits on one line.', ar: 'العنوان يتسع في سطر واحد.' },
    new: { en: 'New course', ar: 'دورة جديدة' },
  },
  admin: {
    save: { en: 'Save', ar: 'حفظ' },
    delete: { en: 'Delete', ar: 'حذف' },
  },
  // `settings` has no `messages` block, so its singular and plural are the project's; without them headings read as the lowercase name.
  settings: { singular: { en: 'Settings', ar: 'الإعدادات' }, plural: { en: 'Settings', ar: 'الإعدادات' } },
  error: { 'invalid.value': { en: 'That value will not do.', ar: 'هذه القيمة غير صالحة.' } },
}

// Resolves copy as the host app does, dotless-key guard included, so the harness tests what the app does.
const translator = (locale: string) => (key: string, fallback?: string) => {
  const dot = key.indexOf('.')
  if (dot < 0) return fallback
  const entry = scopes[key.slice(0, dot)]?.[key.slice(dot + 1)]
  return entry?.[locale] ?? fallback
}

const copy = { t: translator('en'), locale: 'en' }

const refs = { [screen.layouts.app!]: AppShell, [screen.layouts.record!]: RecordPage, [screen.layouts.table!]: TablePage }
const state: ScreenState = {
  t: copy.t,
  locale: 'en',
  dir: 'ltr',
  screen,
  access: {},
  user: { name: 'Admin', email: 'admin@example.com' },
  client: async () => ({}),
  kayan: courses,
  record: null,
}
const renderToStaticMarkup = (element: ReactElement) => staticMarkup(createElement(ScreenContext, { value: state }, createElement(ComponentsProvider, { components: defaultComponents }, createElement(AppComponents, { components: appDefaults }, element))))
const screenOf = (page: PageClient | undefined, kayan: ClientKayan = courses) => ({ refs, kayan, page: page as Extract<PageClient, { page: unknown }> })
const recordPage = (main: unknown[]): PageClient => ({ path: '/courses/new', page: { shell: screen.layouts.app!, main: [{ layout: screen.layouts.record!, main } as never] } })

const page = {
  docs: [{ id: '0f1d8c2e-0000-4000-8000-000000000001', title: 'Tajweed', fee: 300, archived: false }],
  hasNextPage: false,
  hasPrevPage: false,
  limit: 10,
  nextPage: null,
  page: 1,
  pagingCounter: 1,
  prevPage: null,
  totalDocs: 1,
  totalPages: 1,
}

const listMarkup = (locale = 'en', query: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(List, {
      kayan: courses,
      page,
      query,
      t: translator(locale),
      locale,
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: screenOf(courses.pages.list!),
    }),
  )

const formMarkup = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(Form, {
      kayan: courses,
      client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
      value: page.docs[0],
      t: copy.t,
      locale: 'en',
      onDone: () => {},
      ...extra,
    }),
  )

test('1. every shipped kind has a control and a cell, and both chains prefer the screen\'s decided component name over its kind', () => {
  for (const kind of ['text', 'email', 'number', 'integer', 'decimal', 'checkbox', 'datetime', 'date', 'textArray', 'uuid', 'json', 'relationship']) {
    assert.ok(controls[kind], `the control map carries the shipped kind "${kind}"`)
    assert.notEqual(cellFor(fieldOf({ name: 'x', kind })), undefined, `the cell chain answers for kind "${kind}"`)
  }
  assert.equal(controlFor(fieldOf({ name: 'x', kind: 'number' })), controls.number)
  assert.equal(controlFor(fieldOf({ name: 'x', kind: 'number', component: 'money' })), controls.number)
  assert.throws(() => controlFor(fieldOf({ name: 'x', kind: 'nothing-ships-this' })), /components\.controls has no control for "nothing-ships-this", the kind of field "x"/)
  const createdAt = courses.fields.find((one) => one.name === 'createdAt')!
  assert.equal(createdAt.kind, 'datetime', 'the field this reads with is a datetime')
  assert.equal(controlFor(createdAt), controls.datetime, 'with nothing decided the kind is what answers')
  assert.equal(controlFor({ ...createdAt, component: 'text' }), controls.text, 'and a decided control wins over it')
  assert.equal(cellFor(createdAt), cells.datetime, 'the cell with nothing decided is the kind\'s')
  assert.equal(cellFor({ ...createdAt, cell: 'text' }), cells.text, 'and a decided cell wins over it')
  assert.equal(cellFor({ ...createdAt, cell: 'text' }, 'number'), cells.number, 'while a column\'s own cell wins over the field\'s')
})

test('a field chooses its list cell independently of its form control', () => {
  const field = fieldOf({ name: 'featured', kind: 'checkbox', component: 'text', cell: 'checkbox' })
  assert.equal(controlFor(field), controls.text)
  assert.equal(cellFor(field), cells.checkbox)
})

test('a datetime read enters form values as a Date', () => {
  const values = seedOf([fieldOf({ name: 'startsAt', kind: 'datetime' })], { startsAt: '2026-01-02T03:04:00.000Z' })
  assert.ok(values.startsAt instanceof Date)
  assert.equal(values.startsAt.toISOString(), '2026-01-02T03:04:00.000Z')
})

test('a datetime default serialized into a screen enters create values as a Date without filling an unread update', () => {
  const field: ClientField = JSON.parse(JSON.stringify(fieldOf({ name: 'startsAt', kind: 'datetime', rules: { defaultValue: new Date('2026-01-02T03:04:00.000Z') } })))
  const made = seedOf([field])
  assert.ok(made.startsAt instanceof Date)
  assert.equal(made.startsAt.toISOString(), '2026-01-02T03:04:00.000Z')
  assert.equal(seedOf([field], { id: 'hidden' }).startsAt, undefined)
})

test('a create seeds a required list of text as the empty list it draws, and leaves an optional one out so its defaultValue still fills it on the server', () => {
  const lists = [fieldOf({ name: 'permissions', kind: 'textArray', rules: { required: true } }), fieldOf({ name: 'tags', kind: 'textArray' })]
  const made = seedOf(lists, null)
  assert.deepEqual(made.permissions, [], 'a required list starts as the empty list')
  assert.equal('tags' in made && made.tags !== undefined, false, 'an optional list starts at nothing, so the runner\'s defaults fill its defaultValue')
  assert.deepEqual(seedOf(lists, { id: 'r', permissions: ['a'] }), { permissions: ['a'], tags: undefined }, 'and an update seeds what the row holds, never a list of its own')
})

test('2. a label is the record the projection carried, in the locale asked for, and a field with no record is resolved through t', () => {
  assert.equal(labelFor({ kayan: courses, field: courses.fields.find((one) => one.name === 'title')!, copy }), 'Title')
  assert.equal(
    labelFor({ kayan: courses, field: courses.fields.find((one) => one.name === 'title')!, copy: { t: translator('ar'), locale: 'ar' } }),
    'العنوان',
  )
  // A label written as the function hatch is left off the projection; the browser rebuilds `<kayan>.<field>` and resolves it against the project's runtime.
  assert.equal(labelFor({ kayan: courses, field: fieldOf({ name: 'title', kind: 'text' }), copy }), 'Title')
  assert.equal(labelFor({ kayan: courses, field: fieldOf({ name: 'unwritten', kind: 'text' }), copy }), 'unwritten')
  assert.equal(copy.t('save', 'Save'), 'Save', 'a dotless key is the fallback')
  assert.equal(copy.t('save'), undefined, 'and nothing at all when the caller wrote no fallback')
})

test('3. the list renders the kayan\'s own columns under their labels, and every string it shows comes through t', () => {
  const html = listMarkup()
  for (const label of ['Title', 'Fee', 'Archived']) {
    assert.ok(html.includes(`>${label}<`), `the list heads a column with the label "${label}"`)
  }
  assert.ok(html.includes('Tajweed'), 'the row the page carried is in the table')
  assert.ok(html.includes('300'), 'the number cell rendered its value')
  assert.ok(html.includes('/courses/0f1d8c2e-0000-4000-8000-000000000001'), 'the row links through the href prop rather than a router')
  const arabic = listMarkup('ar')
  assert.ok(arabic.includes('>العنوان<'), 'the Arabic label is what the Arabic locale renders')
  assert.ok(!arabic.includes('>Title<'), 'and the English one is gone')
})

test('4. a form node draws its page\'s tree in the order the page wrote it, and a field the page names nowhere is not drawn', () => {
  const html = formMarkup({ value: null, screen: screenOf(courses.pages.create!) })
  const at = (needle: string) => {
    const index = html.indexOf(needle)
    assert.notEqual(index, -1, `the form renders ${needle}`)
    return index
  }
  assert.ok(at('About the course') < at('Title'), 'the section heading comes before the fields it holds')
  assert.ok(at('Title') < at('Summary'), 'the leaves render in the order the section named them')
  assert.ok(at('Summary') < at('Pricing') && at('Pricing') < at('Teaching'), 'and the sections in the order the form named them')
  for (const name of ['id', 'organization', 'createdAt', 'updatedAt']) {
    assert.equal(html.includes(`id="courses-${name}"`), false, `a field the page names nowhere is not drawn: ${name}`)
  }
  // No tab of the template declares a description, so the page is written here.
  const described = formMarkup({
    value: null,
    screen: screenOf(recordPage([{ form: [{ tabs: [
      { tab: 'pricing', label: { en: 'Pricing', ar: 'التسعير' }, description: { en: 'What a seat on this course costs.', ar: 'ما يكلفه مقعد في هذه الدورة.' }, fields: [{ field: 'fee' }] },
      { tab: 'archive', label: { en: 'Archiving', ar: 'الأرشفة' }, fields: [{ field: 'archiveReason' }] },
    ] }] }])),
  })
  assert.ok(described.indexOf('What a seat on this course costs.') > described.indexOf('Pricing'), 'a tab renders its own description under its label')
  assert.ok(described.indexOf('Pricing') < described.indexOf('Archiving'), 'and the tabs render in the order the strip named them')
})

const formPage = (form: unknown[]): PageClient => recordPage([{ form }])

test('accordion items and separators render through the page', () => {
  const html = formMarkup({ value: null, screen: screenOf(formPage([{ accordion: [
    { item: 'first', label: { en: 'First' }, fields: [{ field: 'title' }, { separator: true }] },
    { item: 'second', label: { en: 'Second' }, fields: [{ field: 'summary' }] },
  ] }])) })
  assert.match(html, /First/)
  assert.match(html, /Second/)
  assert.match(html, /data-slot="separator"/)
})

test('sections inside a row take their declared width shares', () => {
  const html = formMarkup({ value: null, screen: screenOf(formPage([{ row: [
    { section: 'wide', width: 2, label: { en: 'Wide' }, fields: [{ field: 'title' }] },
    { section: 'narrow', width: 1, label: { en: 'Narrow' }, fields: [{ field: 'summary' }] },
  ] }])) })
  assert.match(html, /style="flex-grow:2;flex-basis:0"/)
  assert.match(html, /style="flex-grow:1;flex-basis:0"/)
})

test('5. a field whose kind has no writable control renders read-only, so nothing the client does not provide is submitted', () => {
  const html = formMarkup()
  const id = /<input[^>]*name="id"[^>]*>/.exec(html)?.[0] ?? /<input[^>]*value="0f1d8c2e[^>]*>/.exec(html)?.[0] ?? ''
  assert.ok(id, 'the form renders a control for the uuid field')
  // The attribute and not the word: the primitive's class list carries `disabled:cursor-not-allowed`, so `includes('disabled')` is true of every control.
  assert.ok(id.includes(' disabled=""'), 'the uuid control is disabled, so the browser leaves it out of the form data it submits')
  assert.ok(html.includes('0f1d8c2e-0000-4000-8000-000000000001'), 'and it still shows the value it is read-only about')
})

test('6. a refusal\'s toast says the key the server sent, resolved as copy, so a project translates its own refusals', async () => {
  const { failedWords } = await import('../registry/form-rules.tsx')
  assert.equal(failedWords({ copy, thrown: { data: { key: 'error.invalid.value', params: {} } } }), 'That value will not do.', 'the key from the error\'s data.key is resolved through t')
  assert.equal(failedWords({ copy, thrown: { data: { key: 'error.nothing.translates.this' } } }), 'Something went wrong, so nothing was saved. Try again.', 'an untranslated refusal key is said in the shared words, never as the key')
  assert.equal(failedWords({ copy, thrown: new Error('boom') }), 'Something went wrong, so nothing was saved. Try again.', 'a plain error says the request failed, never undefined')
  assert.ok(!formMarkup({ error: { data: { key: 'error.conflict', params: {} } } }).includes('role="alert"'), 'and the form draws none of it')
})

test('7. a field the client is not the provider of on the operation being rendered is read-only, so no form submits it', () => {
  // A form never writes `createdAt` or `updatedAt`: a save would overwrite the row's creation time with a browser value truncated to the day.
  const html = formMarkup()
  // Matched by the id the shell's label points at rather than by a `name`, because a control's box is not always the field's own value.
  for (const name of ['createdAt', 'updatedAt']) {
    const input = new RegExp(`<(?:input|button)[^>]*id="courses-${name}"[^>]*>`).exec(html)?.[0] ?? ''
    assert.ok(input, `the form renders a control for ${name}`)
    assert.ok(input.includes(' disabled=""'), `the ${name} control is disabled, so nothing a person does can report a change for it`)
  }
  // `organization` is drawn by no control: a disabled picker would show a raw id, so the side card reads it through the list's cell.
  assert.equal(/<input[^>]*id="courses-organization"/.test(html), false, 'and the organization is no control for a person to change')
  assert.ok(/<aside[\s\S]*Organization[\s\S]*<\/aside>/.test(html), 'while its value is still read back, in the side card')
  // Nothing the client does not provide reaches an operation's input: the seed carries all three fields and the write none.
  const owned = (field: ClientField) => readOnlyField(field, 'update')
  const seeded = seedOf(courses.fields, { createdAt: new Date(), updatedAt: new Date(), organization: 'an-organization', title: 'Tajweed' })
  const submitted = valuesOf({ fields: courses.fields, values: seeded, owned })
  assert.equal(submitted.title, 'Tajweed', 'a field the client does provide is in what a write is built from')
  assert.ok(!('createdAt' in submitted), 'valuesOf leaves createdAt out of what a write is built from')
  assert.ok(!('updatedAt' in submitted), 'and leaves updatedAt out too')
  assert.ok(!('organization' in submitted), 'and the organization, which no update writes')

  const sealed = fieldOf({ name: 'seal', kind: 'text', rules: { providedBy: { create: 'client', update: 'never' } } })
  assert.equal(readOnlyField(sealed, 'create'), false, 'a field the client supplies on create is writable there')
  assert.equal(readOnlyField(sealed, 'update'), true, 'and the same field is read-only on an update')
})

test('7b. a form draws exactly the fields its page names, a field the server provides included, and hides none by a rule', () => {
  // The screen's create page names no id, organization or timestamp, so it draws none: that is the page's answer, not a rule of the form's.
  const paged = formMarkup({ value: null, screen: screenOf(courses.pages.create!) })
  for (const name of ['id', 'organization', 'createdAt', 'updatedAt']) {
    assert.ok(!paged.includes(`id="courses-${name}"`), `the screen's create page draws no control for ${name}`)
  }
  assert.ok(paged.includes('id="courses-title"'), 'while it draws the fields it names')
  const created = formMarkup({ value: null })
  for (const name of ['id', 'createdAt', 'updatedAt']) {
    assert.ok(created.includes(`id="courses-${name}"`), `a form with no page draws ${name} on a create`)
  }
  const edited = formMarkup()
  for (const name of ['id', 'createdAt', 'updatedAt']) {
    assert.ok(edited.includes(`id="courses-${name}"`), `and on an edit`)
  }
  assert.ok(/<aside[\s\S]*Organization[\s\S]*<\/aside>/.test(edited), 'and reads the organization back beside them')
})

test('a text or number control with a prefix or a suffix is drawn inside an input group, in the viewer\'s locale', () => {
  const draw = (field: ClientField, locale: string) =>
    renderToStaticMarkup(createElement(controlFor(field), {
      field, kayan: courses, id: `courses-${field.name}`, t: (_key: string, fallback?: string) => fallback, locale,
      value: null, values: {}, setValue: () => {}, readOnly: false, onChange: () => {},
    }))
  const fee = fieldOf({ name: 'fee', kind: 'number', prefix: { ar: 'ر.س', en: 'SAR' }, suffix: { ar: 'لكل مقعد', en: 'per seat' } })
  const html = draw(fee, 'ar')
  assert.match(html, /data-slot="input-group"/, 'the group')
  assert.match(html, /data-align="inline-start"[^>]*>(?:<[^>]+>)*ر\.س</, 'the prefix at the inline start, in Arabic')
  assert.match(html, /data-align="inline-end"[^>]*>(?:<[^>]+>)*لكل مقعد</, 'the suffix at the inline end')
  assert.match(html, /data-slot="input-group-control"[^>]*id="courses-fee"|id="courses-fee"[^>]*data-slot="input-group-control"/, 'around the field\'s own input')
  assert.match(draw(fieldOf({ name: 'title', kind: 'text', prefix: { ar: 'دورة', en: 'Course' } }), 'en'), /data-align="inline-start"[^>]*>(?:<[^>]+>)*Course</, 'a text field too')
  assert.doesNotMatch(draw(fieldOf({ name: 'fee', kind: 'number' }), 'en'), /input-group/, 'and a field with neither draws the plain input')
})

test('9. neither map answers for a key of Object.prototype, so a field naming one resolves to its kind', () => {
  // Like a control, a cell the map carries for no name of the field is an error naming the kind, never plain text in its place.
  // A field's `component` is a string off the projection, and a plain object would answer `constructor` and `toString` from its prototype.
  for (const component of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.equal(controlFor(fieldOf({ name: 'x', kind: 'text', component, cell: component })), controls.text, `a field naming "${component}" as its component falls through to its kind's control`)
    assert.throws(
      () => controlFor(fieldOf({ name: 'x', kind: 'nothing-ships-this', component, cell: component })),
      /no control for "nothing-ships-this"/,
      'and to the error where the map has none for its kind either',
    )
    assert.equal(cellFor(fieldOf({ name: 'x', kind: 'text', component, cell: component })), cells.text, `a field naming "${component}" as its cell falls through to its kind's cell`)
    assert.throws(
      () => cellFor(fieldOf({ name: 'x', kind: 'nothing-ships-this', component, cell: component })),
      /components\.cells has no cell for "nothing-ships-this", the kind of field "x"/,
      'and to the error where the map has none for its kind either',
    )
    assert.throws(() => cellFor(fieldOf({ name: 'x', kind: 'text' }), component), new RegExp(`no cell "${component}", which field "x" is drawn with`), 'and a column naming one is an error, since it names a cell rather than leaving it to the field')
  }
  assert.throws(() => controlFor(fieldOf({ name: 'x', kind: 'constructor' })), /no control for "constructor"/, 'a kind named for a key of Object.prototype is no kind the map carries')
  assert.throws(() => cellFor(fieldOf({ name: 'x', kind: 'constructor' })), /no cell for "constructor"/, 'for a cell either')
  assert.equal(controlIn({ ...defaultComponents.controls }, fieldOf({ name: 'x', kind: 'text', component: 'toString' })), controls.text, 'the control map answers from its own keys alone, a map a project spread too')
  assert.equal(cellIn({ cells: { ...cells }, field: fieldOf({ name: 'x', kind: 'text', cell: 'toString' }) }), cells.text, 'and so does the cell map')
})

test('9b. a field named for a key of Object.prototype has only the issue the server sent it', async () => {
  const { issuesOf } = await import('../registry/form-rules.tsx')
  assert.equal(issuesOf(null).toString, undefined, 'no refusal gives no field an issue')
  const refused = { data: { params: { issues: [{ path: 'toString', message: 'm' }, { path: 'constructor', message: 'n' }] } } }
  assert.equal(issuesOf(refused).toString, 'm', 'and a refusal naming the field is kept')
  assert.equal(issuesOf(refused).constructor, 'n')
})

test('10. delete takes two clicks, and the one that deletes is not rendered at all until the first', () => {
  const edit: PageClient = { path: '/courses/:id', page: { shell: screen.layouts.app!, main: [{ layout: screen.layouts.record!, main: [{ form: ['title'] }], danger: [{ button: 'delete', label: { en: 'Delete', ar: 'حذف' } }] } as never] } }
  const html = formMarkup({ screen: screenOf(edit), operations: { delete: true }, client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}), run: async () => ({}) } })
  // The confirm control lives in the dialog, mounted only once open, so the first click opens it and the second deletes.
  const trigger = /<button[^>]*aria-haspopup="dialog"[^>]*>([^<]*)<\/button>/.exec(html)
  assert.ok(trigger, `the form renders the dialog's trigger:\n${html.slice(-800)}`)
  assert.equal(trigger[1], 'Delete', 'whose label is the one the page wrote')
  // base-ui marks the trigger with `aria-expanded` and `data-popup-open`.
  assert.ok(/aria-haspopup="dialog"[^>]*aria-expanded="false"/.test(html), 'and it is closed')
  assert.ok(!html.includes('Delete this course'), 'the confirm is not in the markup the first click lands on')
  assert.ok(!formMarkup({ screen: screenOf(edit), operations: { delete: true }, value: null }).includes('Delete'), 'a form over a row with no id renders no delete at all')
  assert.ok(!formMarkup().includes('>Delete<'), 'and a form with no page renders none in its footer')
})

test('11. a checkbox cell says true from false in words, so the column is not a glyph a screen reader skips', () => {
  // The Status column says archived, so the checkbox column is one the URL turns on.
  const html = listMarkup('en', { cols: ['title', 'archived'] })
  // Read as the glyph and word pair: `archived` is false here, so asserting the other glyph absent would pass on a broken cell.
  const cell = /<span aria-hidden="true"[^>]*>([^<]*)<\/span><span class="sr-only">([^<]*)<\/span>/.exec(html)
  assert.ok(cell, `the checkbox cell is a hidden glyph followed by the words for it:\n${html.slice(0, 600)}`)
  assert.equal(cell[1], '✗', 'the glyph is the one this row\'s false value renders')
  assert.equal(cell[2], 'Active', 'and the word beside it is what the project wrote for false')
  const arabic = /<span aria-hidden="true"[^>]*>[^<]*<\/span><span class="sr-only">([^<]*)<\/span>/.exec(listMarkup('ar', { cols: ['title', 'archived'] }))
  assert.equal(arabic?.[1], 'نشط', 'and in the other locale it is the other word')
})

test('184a. a cell joins several values in its locale\'s own list format, never with an ASCII comma, and an empty box reads as an unticked one', async () => {
  const { RelationshipCell, titleKey } = await import('../registry/relationship-cell.tsx')
  const topics = fieldOf({ name: 'topics', kind: 'textArray' })
  const cell = (locale: string, value: unknown) => staticMarkup(createElement(() => cells.textArray!({ kayan: courses, field: topics, value, t: translator(locale), locale }) as ReactElement))
  assert.equal(cell('ar', ['نحو', 'خط', 'تجويد']), 'نحو، وخط، وتجويد', 'Arabic joins with its own comma and its own and')
  assert.equal(cell('en', ['Grammar', 'Script']), 'Grammar, Script', 'English keeps its comma')
  const tags = fieldOf({ name: 'tags', kind: 'relationship', relationTo: 'tags' })
  const ids = ['a', 'b']
  const titles = new Map(ids.map((id, at) => [titleKey('tags', id), ['مكثف', 'شهادة'][at]!]))
  const related = staticMarkup(createElement(RelationshipCell, { kayan: courses, field: tags, value: ids, t: translator('ar'), locale: 'ar', titles }))
  assert.equal(related, '<span>مكثف وشهادة</span>', 'and so does a relationship cell holding several rows')
  const box = (value: unknown) => /<span aria-hidden="true"[^>]*>([^<]*)<\/span>/.exec(staticMarkup(createElement(() => cells.checkbox!({ kayan: courses, field: fieldOf({ name: 'archived', kind: 'checkbox' }), value, t: copy.t, locale: 'en' }) as ReactElement)))?.[1]
  assert.deepEqual([box(true), box(false), box(undefined), box(null)], ['✓', '✗', '✗', '✗'], 'an empty box, as a row from before the column holds, is a no like a false one')
})

test('184c. a search runs only over what the viewer reads, across one relationship to the kayan it points at too, and the box names a far field by the relationship and its own label', () => {
  const member = { name: 'member', useAsTitle: 'id', fields: [fieldOf({ name: 'id', kind: 'text' }), fieldOf({ name: 'userId', kind: 'relationship', relationTo: 'user' }), fieldOf({ name: 'role', kind: 'text' })] }
  const user = { name: 'user', fields: [fieldOf({ name: 'name', kind: 'text', label: { en: 'Name', ar: 'الاسم' } }), fieldOf({ name: 'email', kind: 'email', label: { en: 'Email', ar: 'البريد الإلكتروني' } })] }
  const asked = ['userId.name', 'userId.email', 'role']
  assert.deepEqual(searchableFields({ kayan: member, search: asked, client: [user] }), asked, 'every path the viewer reads')
  assert.deepEqual(searchableFields({ kayan: member, search: asked, client: [{ ...user, fields: user.fields.slice(0, 1) }] }), ['userId.name', 'role'], 'a far field the projection lacks is dropped')
  assert.deepEqual(searchableFields({ kayan: member, search: asked }), ['role'], 'and a hop whose kayan the viewer may not read at all')
  assert.deepEqual(searchableFields({ kayan: { ...member, fields: member.fields.filter((one) => one.name !== 'userId') }, search: asked, client: [user] }), ['role'], 'and one whose relationship the viewer may not read')
  assert.deepEqual(searchWhere({ kayan: member, search: 'hana', fields: ['userId.name', 'userId.email'] }), { or: [{ and: [{ 'userId.name': { like: 'hana' } }] }, { and: [{ 'userId.email': { like: 'hana' } }] }] })
  const list = { ...member, single: false, operations: [], pages: {} } as unknown as ClientKayan
  const node = { columns: [{ field: 'role' }], search: asked } as never
  const html = renderToStaticMarkup(createElement(List, { kayan: list, client: [user as unknown as ClientKayan], node, page: { ...page, docs: [] }, query: {}, t: translator('ar'), locale: 'ar', onQuery: () => {}, href: () => '', newHref: '' }))
  // This harness writes no `admin.searchThrough`, so the far field follows the relationship in the fallback's order.
  assert.ok(html.includes('placeholder="userId الاسم أو userId البريد الإلكتروني أو role"'), `the box names each path, a far one by the relationship and its own label: ${/placeholder="[^"]*"/.exec(html)?.[0]}`)
})

test('12. the app holds the current source of every registry item it copied', () => {
  // The package's own file is the source; the copy a project holds can drift.
  const source = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'))
  const names: string[] = source.items.map((item: { name: string }) => item.name)
  assert.deepEqual(
    names,
    [
      'mithaq-copy',
      'mithaq-format',
      'mithaq-refusal',
      'mithaq-field-values',
      'mithaq-control-props',
      'mithaq-components',
      'mithaq-text-control',
      'mithaq-number-control',
      'mithaq-textarea-control',
      'mithaq-time-field',
      'mithaq-date-control',
      'mithaq-choice-control',
      'mithaq-checkbox-control',
      'mithaq-default-components',
      'mithaq-cells',
      'mithaq-filter-operators',
      'mithaq-list-query',
      'mithaq-list-filters',
      'mithaq-list-columns',
      'mithaq-list-pagination',
      'mithaq-list-selection',
      'mithaq-list-types',
      'mithaq-list-button',
      'mithaq-list-row-menu',
      'mithaq-list-table',
      'mithaq-list-toolbar',
      'mithaq-use-list-state',
      'mithaq-list-header',
      'mithaq-list-dialogs',
      'mithaq-list',
      'mithaq-screen-refs',
      'mithaq-node-tree',
      'mithaq-row-title',
      'mithaq-nav-links',
      'mithaq-use-confirm',
      'mithaq-node-buttons',
      'mithaq-leaf-control',
      'mithaq-record-frame',
      'mithaq-nodes',
      'mithaq-node-groups',
      'mithaq-default-nodes',
      'mithaq-form-types',
      'mithaq-toast',
      'mithaq-form-rules',
      'mithaq-form-context',
      'mithaq-field-value',
      'mithaq-delete-button',
      'mithaq-discard-dialog',
      'mithaq-operation-button',
      'mithaq-form-actions',
      'mithaq-draft-banner',
      'mithaq-use-form-seed',
      'mithaq-use-form-refusal',
      'mithaq-use-draft-view',
      'mithaq-use-form-save',
      'mithaq-use-autosave',
      'mithaq-form-button',
      'mithaq-form-chrome',
      'mithaq-form-layout',
      'mithaq-form',
      'mithaq-theme',
      'mithaq-locale-menu',
      'mithaq-nav-entries',
      'mithaq-nav-secondary',
      'mithaq-nav-user',
      'mithaq-organization-switcher',
      'mithaq-nav',
      'mithaq-field-shell',
      'mithaq-relationship-control',
      'mithaq-relationship-cell',
      'mithaq-rich-text-nodes',
      'mithaq-rich-text-value',
      'mithaq-rich-text-line',
      'mithaq-rich-text-picks',
      'mithaq-rich-text-selection',
      'mithaq-rich-text-format-buttons',
      'mithaq-rich-text-toolbar',
      'mithaq-rich-text-link-editor',
      'mithaq-rich-text-link-plugin',
      'mithaq-rich-text-slash-menu',
      'mithaq-rich-text-viewer',
      'mithaq-rich-text-editor',
      'mithaq-rich-text',
      'mithaq-upload-api',
      'mithaq-file-thumb',
      'mithaq-upload-cell',
      'mithaq-upload-dialog',
      'mithaq-upload-control',
      'mithaq-upload',
      'mithaq-upload-node',
      'mithaq-screens-host',
      'mithaq-storage',
      'mithaq-mail',
      'mithaq-expected-updated-at',
      'mithaq-payload-password',
      'mithaq-directional-icon',
      'mithaq-members',
      'mithaq-role-form',
      'mithaq-roles',
      'mithaq-tab-strip',
      'mithaq-page-header',

    ],
    'the registry declares the ninety-eight items this file knows about',
  )
  const declaredItems = source.items as { name: string; files: { path: string; target: string }[] }[]
  const appPathOf = (target: string) => target.startsWith('~/') ? target.slice(2) : `src/${target.replace('@components/', 'components/')}`
  // Every other piece is drawn from the installed package; only these import app files or hold policy, so a project holds them.
  const owned = ['mithaq-screens-host', 'mithaq-storage', 'mithaq-mail', 'mithaq-expected-updated-at', 'mithaq-directional-icon']
  const declaredFiles = declaredItems.filter((item) => owned.includes(item.name)).flatMap((item) => item.files.map((file) => ({ item: item.name, ...file })))
  assert.equal(declaredFiles.length, 20, 'the twelve host files, the five storage adapters, the mailers, the step and the icon')
  for (const declared of declaredFiles) {
    // Read as `mithaq upgrade --check` reads it: a fresh eject hashes its whole text, a copy `shadcn add` made its text less leading comments.
    const target = declared.target
    // The storage adapters, the mailers and the write step run on the server, so the project holding them is the template's root, not an app.
    const project = ['mithaq-storage', 'mithaq-mail', 'mithaq-expected-updated-at'].includes(declared.item) ? 'templates/mithaq' : 'apps/asas-tanstack'
    const copied = readFileSync(new URL(`../../../${project}/${appPathOf(target)}`, import.meta.url), 'utf8')
    const source = readFileSync(new URL(`../${declared.path}`, import.meta.url), 'utf8')
    assert.equal(stateOf(copied, source), 'up to date', `${project} has the current ${target}, marked; delete it and rerun "mithaq eject ${declared.item}" there`)
  }
})

test('12b. one form item ships, its pieces on TanStack Form, and the boot builds and serves the app once', () => {
  // Asserted over the manifest and the source together: a dependency nothing imports is installed for no reason, and an import nothing declares fails to resolve.
  const source = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8')) as {
    items: { name: string; dependencies?: string[]; files: { path: string; target: string }[] }[]
  }
  const forms = source.items.filter((one) => one.files.some((file) => file.target === '@components/mithaq/form.tsx'))
  assert.deepEqual(forms.map((one) => one.name), ['mithaq-form'], 'one item writes the form file')
  const form = forms[0]!
  const scoped = [...readFileSync(new URL(`../${form.files[0]!.path}`, import.meta.url), 'utf8').matchAll(/from '(@[a-z@/-]+)'/g)]
    .map((hit) => hit[1]!)
    .filter((one) => !one.startsWith('@/'))
  assert.deepEqual(scoped, [], 'the form file imports no scoped package: it composes the pieces that hold its values')
  assert.equal(form.dependencies, undefined, 'so it declares none')
  // The form is composed of pieces, so each piece that imports TanStack Form declares it, and no other piece does.
  const onTanStack = source.items.filter((item) => item.files.some((file) => /from '@tanstack\/react-form'/.test(readFileSync(new URL(`../${file.path}`, import.meta.url), 'utf8'))))
  assert.ok(onTanStack.some((item) => item.name === 'mithaq-use-form-seed'), 'the form holds its values in TanStack Form')
  for (const item of source.items) {
    const scoped = [...new Set(item.files.flatMap((file) => [...readFileSync(new URL(`../${file.path}`, import.meta.url), 'utf8').matchAll(/from '(@tanstack\/react-form)'/g)].map((hit) => hit[1]!)))]
    assert.deepEqual((item.dependencies ?? []).filter((one) => one.startsWith('@tanstack/react-form')), scoped, `${item.name} declares TanStack Form exactly where its source imports it`)
  }

  const script = (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts['test:tanstack']!
  assert.equal(script.split('apps/tanstack-boot.ts').length - 1, 1, 'test:tanstack runs the boot once')
  assert.doesNotMatch(script, /MITHAQ_FORM_ITEM/, 'and names no form item to swap in')
})

test('14. the shell lists the kayan the access report allows, in declaration order, under the names the project wrote for them', () => {
  // Rendered as the whole shell: the list uses shadcn's `SidebarMenuButton`, which throws outside the sidebar's provider.
  const allowed = (...names: string[]) => ({
    canAccessAdmin: true,
    collections: Object.fromEntries(
      kayans.map((one) => [one.name, { read: names.includes(one.name), create: false, update: false, delete: false, fields: {} }]),
    ),
  })
  const navMarkup = (access: ReturnType<typeof allowed>, locale = 'en') =>
    renderToStaticMarkup(
      createElement(Shell, {
        client: kayans,
        access,
        t: translator(locale),
        locale,
        href: (kayan: NavKayan) => `/${kayan.name}`,
        user: { name: 'Boot Tester', email: 'boot@example.com' },
        organizations: [{ id: 'one', name: 'First Organization' }],
        activeOrganizationId: 'one',
        onSwitchOrganization: () => {},
        onSignOut: () => {},
      }),
    )

  const html = navMarkup(allowed('courses', 'settings'))
  assert.ok(html.includes('>Courses<'), 'the allowed kayan is labelled by the plural the project declared')
  assert.equal(titleOf({ kayan: courses, copy, many: true }), 'Courses', 'which is what titleOf answers for the same kayan')
  assert.equal(titleOf({ kayan: courses, copy }), 'Course', 'and the singular beside it')
  assert.ok(html.includes('href="/courses"'), 'and the destination is the href prop, so the shell imports no router')

  assert.ok(html.includes('>Settings<'), 'a global is listed under the singular the project wrote')
  assert.equal(html.includes('>settings<'), false, 'and never under its own lowercase name')
  assert.equal(titleOf({ kayan: { name: 'nothingNamesThis' }, copy, many: true }), 'nothingNamesThis', 'a kayan with no copy is shown under its own name')

  for (const name of ['user', 'localUsers', 'roles', 'enrollments']) {
    assert.ok(!html.includes(`href="/${name}"`), `the shell renders nothing for "${name}", which the report denies`)
  }
  // `sessions` declares no copy, so its label would be its own name; `>Sessions<` must never appear.
  assert.ok(!html.includes('>sessions<'), 'and no label for one either')

  assert.ok(html.indexOf('/courses') < html.indexOf('/settings'), 'the entries are in declaration order')

  assert.ok(navMarkup(allowed('courses'), 'ar').includes('>الدورات<'), 'the Arabic plural is what the Arabic locale renders')
  const none = navMarkup(allowed())
  // `href="/"` and not `href=` alone: the shell's chrome rows (help, settings, search, documents) point at `#` whatever the report says.
  assert.ok(!none.includes('href="/'), 'a report that allows nothing lists no kayan')
  assert.ok(none.includes('href="#"'), 'while the shell rows that name no kayan are drawn all the same')

  assert.ok(html.includes('First Organization'), 'the sidebar header names the active organization')
  // `>Organization<` and not `Organization<`: `First Organization</span>` ends in the shorter string.
  assert.ok(html.includes('>Organization<'), 'with the line the project wrote under it')
  assert.ok(html.includes('Boot Tester') && html.includes('boot@example.com'), 'the footer names the viewer and their address')
  assert.ok(html.includes('data-sidebar="trigger"'), 'and the header carries the sidebar trigger')
  // A dropdown's items live in a portal mounted on open, so only what a closed menu draws is asserted.
  assert.ok(!html.includes('Sign out'), 'while the menu behind them is not drawn until it is opened')

  const sided = (side: 'left' | 'right') =>
    renderToStaticMarkup(
      createElement(Shell, {
        client: kayans,
        access: allowed('courses'),
        t: translator('en'),
        locale: 'en',
        href: (kayan: NavKayan) => `/${kayan.name}`,
        user: { name: 'Boot Tester', email: 'boot@example.com' },
        organizations: [],
        activeOrganizationId: null,
        onSwitchOrganization: () => {},
        onSignOut: () => {},
        side,
      }),
    )
  assert.ok(sided('right').includes('data-side="right"'), 'a right-to-left locale puts the sidebar on the right')
  assert.ok(sided('left').includes('data-side="left"'), 'and a left-to-right one puts it on the left')
  assert.ok(sided('right').includes('No organization'), 'an actor in no organization is told so rather than shown a blank name')
})

test('14b. every kayan of the build is listed under an icon, and one nothing declares falls to the same one', () => {
  // Walked over the build rather than the map, so a kayan the map lacks (the fallback arm) is read.
  const named = kayans.filter((one) => Object.hasOwn(navIcons, one.name))
  assert.ok(named.length >= 5, `the map names an icon for kayan this project declares: ${named.map((one) => one.name).join(', ')}`)
  // `assert.ok` and not `typeof`: a lucide icon is a `forwardRef` object, not a function.
  for (const one of kayans) assert.ok(iconOf(one.name), `${one.name} is listed under an icon`)
  assert.equal(iconOf('no-such-kayan'), iconOf('another-kayan-nothing-declares'), 'two kayan the map does not name fall to the same icon')
  assert.notEqual(iconOf('courses'), iconOf('no-such-kayan'), 'while one the map does name keeps its own')
  // `Object.hasOwn` rather than a lookup, so a kayan named for a key of `Object.prototype` reads nothing off it.
  assert.equal(iconOf('constructor'), iconOf('no-such-kayan'), 'a kayan named for a key of Object.prototype falls to the fallback')

  const entries = navEntries({
    client: kayans,
    access: { collections: { courses: { read: true }, settings: { read: true }, user: { read: false } } },
    copy: { t: translator('en'), locale: 'en' },
    href: (kayan) => `/${kayan.name}`,
  })
  assert.deepEqual(
    entries.map((one) => [one.kayan.name, one.label, one.href]),
    [
      ['courses', 'Courses', '/courses'],
      ['settings', 'Settings', '/settings'],
    ],
    'the entries are what the report allows, labelled and addressed',
  )
})

test('15. every operator the table offers for a kind is one assertWhere takes, and every one it refuses is not offered', async () => {
  // The browser table is a subset of the server's: one probe kayan per kind, every operator tried against `assertWhere`, the two answers compared.
  const { assertWhere } = await import('../../mithaq/src/asas/runner/write.ts')
  const probeKayan = (kind: string) =>
    ({ name: 'probe', fields: { value: { name: 'value', kind } } }) as unknown as Parameters<typeof assertWhere>[0]
  // One operand per shape, so a refusal is about the operator: `exists` takes a boolean, `in` and `not_in` an array.
  const operand = (kind: string, operator: string) => {
    if (operator === 'exists') return true
    const one = kind === 'number' || kind === 'integer' ? 1 : kind === 'decimal' ? '1.00' : kind === 'checkbox' ? true : kind === 'datetime' ? new Date() : kind === 'date' ? '2026-01-02' : 'x'
    return operator === 'in' || operator === 'not_in' ? [one] : one
  }
  const everyOperator = [
    'contains', 'equals', 'exists', 'greater_than', 'greater_than_equal',
    'in', 'less_than', 'less_than_equal', 'like', 'not_equals', 'not_in',
  ]
  let offered = 0
  let refused = 0
  for (const [kind, operators] of Object.entries(operatorsByKind)) {
    for (const operator of everyOperator) {
      const taken = (() => {
        try {
          assertWhere(probeKayan(kind), { value: { [operator]: operand(kind, operator) } })
          return true
        } catch {
          return false
        }
      })()
      if (operators.includes(operator as never)) {
        offered += 1
        assert.ok(taken, `the table offers "${operator}" on a "${kind}" field, so assertWhere takes it`)
      }
      if (!taken) {
        refused += 1
        assert.equal(operators.includes(operator as never), false, `assertWhere refuses "${operator}" on a "${kind}" field, so the table does not offer it`)
      }
    }
  }
  assert.equal(offered, Object.values(operatorsByKind).reduce((sum, list) => sum + list.length, 0), 'every offered operator was tried')
  assert.ok(refused > 0, 'and the refused half of the comparison ran too')
  // The containment is one way: `assertWhere` takes `in` and `not_in` on a checkbox, but two of three values is not a filter a panel should offer.
  assert.doesNotThrow(() => assertWhere(probeKayan('checkbox'), { value: { in: [true] } }))
  assert.equal(operatorsByKind.checkbox!.includes('in' as never), false)
})

test('16. a localized field is offered as its locale paths alone, and a relationship as itself plus one hop and never two', () => {
  // `enrollments` points at `sessions`, which points at `courses`: the hop reaches a relationship of its own target, a second hop a two-segment path cannot name.
  const filterable = (kayan: ClientKayan, names: readonly string[]): ClientKayan => ({
    ...kayan,
    fields: kayan.fields.map((field) => (names.includes(field.name) ? { ...field, filter: true as const } : field)),
  })
  const localized: ClientKayan = {
    name: 'notes',
    single: false,
    operations: [],
    pages: {},
    fields: [fieldOf({ name: 'title', kind: 'text', rules: { localized: true }, filter: true })],
  }
  assert.deepEqual(
    filterPathsOf(localized, { locales: ['ar', 'en'] }).map((one) => one.path),
    ['title.ar', 'title.en'],
    'a localized field is its locale paths and never the bare name',
  )
  assert.deepEqual(filterPathsOf(localized, {}).map((one) => one.path), [], 'and with no locale list it offers nothing at all')

  const sessions = filterable(screen.kayan.sessions!, ['course', 'startsAt'])
  const hopped = filterPathsOf(sessions, { client: [sessions, filterable(courses, ['title', 'fee'])] })
  assert.deepEqual(
    hopped.map((one) => one.path),
    ['course', 'course.title', 'course.fee', 'course.archived', 'startsAt'],
    'a relationship is offered as itself and as one hop into the target\'s own filterable fields',
  )
  assert.equal(hopped.find((one) => one.path === 'course')!.kind, 'relationship', 'the bare path filters by id')
  assert.equal(hopped.find((one) => one.path === 'course.fee')!.kind, 'number', 'and a hop takes the target field\'s own kind')

  const enrollments = filterable(screen.kayan.enrollments!, ['session'])
  const twice = filterPathsOf(enrollments, { client: [enrollments, sessions, courses] }).map((one) => one.path)
  assert.deepEqual(
    twice,
    ['session', 'session.startsAt'],
    'one hop reaches the target\'s own filterable fields and stops there',
  )
  assert.equal(twice.includes('session.course'), false, 'the target\'s own relationship is never a second hop')
  assert.equal(twice.some((one) => one.split('.').length > 2), false, 'so no path is more than two segments, which is all the grammar has')
})

test('17. a filter, a sort, a page, a limit and a column list survive a URL round trip in Payload\'s qs format, and a hostile URL is refused', () => {
  const filterableCourses = {
    ...courses,
    fields: courses.fields.map((field) =>
      ['title', 'fee', 'archived'].includes(field.name) ? { ...field, filter: true as const } : field,
    ),
  }
  const rules = { paths: filterPathsOf(filterableCourses, {}), sortable: sortableOf(courses), maxLimit: 100 }
  const query: import('../registry/list-query.ts').ListQuery = {
    where: { or: [{ and: [{ title: { contains: 'taj' } }, { archived: { equals: false } }] }, { and: [{ fee: { in: [100, 200] } }] }] },
    search: 'quran',
    sort: '-fee',
    page: 2,
    limit: 25,
    cols: ['title', '-fee', 'archived'],
  }
  const url = new URLSearchParams(writeQuery(query))
  assert.equal(url.get('where[or][0][and][0][title][contains]'), 'taj', 'a where is written the way qs writes one')
  assert.equal(url.get('where[or][1][and][0][fee][in][1]'), '200', 'a list by its indices')
  assert.deepEqual(readQuery(url, rules), query, 'every key comes back as it went in, each value in its kind')
  assert.equal(url.get('cols'), 'title,-fee,archived', 'a hidden column is the `-` prefix Payload writes')

  assert.deepEqual(
    readQuery(new URLSearchParams('where[title][like]=math&sort=-createdAt&page=2&limit=25'), rules),
    { where: { or: [{ and: [{ title: { like: 'math' } }] }] }, sort: '-createdAt', page: 2, limit: 25 },
  )

  // A hostile URL is refused whole rather than read as the part of it that parsed.
  const refused = (search: string, sentence: RegExp) =>
    assert.throws(() => readQuery(new URLSearchParams(search), rules), (error: Error) => error.name === 'QueryRefused' && sentence.test(error.message), search)
  refused('where[__proto__][polluted]=1', /names "__proto__", which no where may name\./)
  refused('where[title][constructor][x]=1', /names "constructor", which no where may name\./)
  refused('where[or][0][and][0][title][in][0][a][b][c]=1', /is nested deeper than a where goes\./)
  refused('where[archiveReason][contains]=secret', /names field "archiveReason", which this list does not filter by\./)
  refused('where[fee][contains]=x', /asks field "fee" for "contains", which it does not take\./)
  refused('where[fee][equals]=cheap', /asks field "fee" to equal "cheap", which is not a number\./)
  refused('where[title][in]=one', /asks field "title" for "in" with one value, and "in" takes a list\./)
  refused('where[or][3][and][0][title][equals]=x', /holds a gap in its list\./)
  refused('where[or][title][equals]=x', /holds an or that is no list\./)
  refused('where[and][title][equals]=x', /holds an and that is no list\./)
  refused(`where=${encodeURIComponent('{"title":{"equals":"x"}}')}`, /carries a where that is not written in brackets\./)
  refused('sort=scheduledSessions', /sorts by "scheduledSessions", which this list does not sort by\./)
  refused(Array.from({ length: 65 }, (_, at) => `where[or][${at}][and][0][title][equals]=x`).join('&'), /carries more than 64 where values\./)

  assert.deepEqual(readQuery(new URLSearchParams({ page: '0', limit: '7', cols: '', search: '' }), rules), {}, 'page 0, a limit the screen does not offer, an empty column list and an empty search are each dropped')
  assert.deepEqual(readQuery(new URLSearchParams({ limit: '7' }), { ...rules, limit: 7 }), { limit: 7 }, 'and the list\'s own default limit is one it offers')
})

test('18. the page resets to one on a filter, a search, a sort and a limit change, and stays put on a column change', () => {
  const asked: Query[] = []
  const filterableCourses = {
    ...courses,
    fields: courses.fields.map((field) => (field.name === 'title' ? { ...field, filter: true as const } : field)),
  }
  const markup = renderToStaticMarkup(
    createElement(List, {
      kayan: filterableCourses,
      page: { ...page, page: 3, totalPages: 5, totalDocs: 50, hasNextPage: true, hasPrevPage: true, nextPage: 4, prevPage: 2 },
      query: { page: 3 },
      t: copy.t,
      locale: 'en',
      onQuery: (next: Query) => asked.push(next),
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
    }),
  )
  assert.ok(/aria-expanded="false"[^>]*>Filters</.test(markup), 'the panel\'s button rendered, so the four controls below are the ones this screen holds')
  assert.deepEqual(asked, [], 'and a render on its own asks for nothing')

  assert.deepEqual(refined({ page: 3 }, { search: 'x' }), { page: 1, search: 'x' }, 'a search change goes back to page one')
  assert.deepEqual(refined({ page: 3 }, { limit: 25 }), { page: 1, limit: 25 }, 'so does a limit change')
  assert.deepEqual(refined({ page: 3, where: { or: [{ and: [{ title: { equals: 'a' } }] }] } }, { where: undefined }), { page: 1, where: undefined }, 'and so does a filter change')
  assert.deepEqual(refined({ page: 3 }, { sort: '-fee' }), { page: 1, sort: '-fee' }, 'and a sort, which moves every row between pages')
  // A column change keeps the page: it changes what a row shows, never which rows match.
  assert.deepEqual(
    withColumns({ page: 3, search: 'x' }, [{ name: 'title', active: true }, { name: 'fee', active: false }]),
    { page: 3, search: 'x', cols: ['title', '-fee'] },
    'the page and every other key are kept, and a hidden column is the `-` prefix',
  )
})

test('19. a field that never says it is filterable has no row, a list node\'s own filters and columns win over the fields\', and a denied field is in neither nor in the table', () => {
  assert.deepEqual(
    filterPathsOf(courses, {}).map((one) => one.path),
    ['title', 'fee', 'archived'],
    'only a field that says so is offered',
  )
  assert.deepEqual(filterPathsOf({ ...courses, fields: courses.fields.map(({ filter: _filter, ...rest }) => rest) }, {}).map((one) => one.path), [], 'a kayan with none offers none')
  assert.equal(
    renderToStaticMarkup(
      createElement(Filters, { paths: [], value: undefined, onChange: () => {}, t: copy.t, locale: 'en' }),
    ),
    '',
    'and renders no panel at all',
  )

  assert.deepEqual(filterPathsOf(courses, { filters: ['fee'] }).map((one) => one.path), ['fee'], 'the node\'s filters are the rows the panel offers')
  const opened = columnsOf({ kayan: courses, cols: undefined, reads: undefined, opens: ['title', 'fee'] })
  assert.deepEqual(opened.filter((column) => column.active).map((column) => column.name), ['title', 'fee'], 'the node\'s columns are the ones the table opens with')
  assert.ok(opened.some((column) => column.name === 'summary' && !column.active), 'while a field the node does not name is still a column the popup offers, switched off')

  // The access report only hides chrome; the read masks a denied column whatever this does.
  const reads = (_kayan: string, field: string) => field !== 'title'
  assert.equal(filterPathsOf(courses, { reads }).some((one) => one.path === 'title'), false, 'a denied field is not a filter row')
  assert.equal(columnCandidates(courses, reads).some((field) => field.name === 'title'), false, 'nor a column the popup offers')
  const denied = renderToStaticMarkup(
    createElement(List, {
      kayan: courses,
      page,
      query: {},
      t: copy.t,
      locale: 'en',
      reads,
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
    }),
  )
  assert.equal(denied.includes('Tajweed'), false, 'and the denied column\'s own value is not in the served table')
  // Read off the table's own head: with `title` denied, `fee` is the first path the panel offers, so `>Fee<` is in the document whether or not the column is drawn.
  const head = /<thead[\s\S]*?<\/thead>/.exec(denied)?.[0] ?? ''
  assert.ok(head, `the table has a head:\n${denied.slice(0, 400)}`)
  assert.ok(head.includes('>Fee<'), 'while the columns beside it are still headed')
  assert.equal(head.includes('>Title<'), false, 'and the denied one is not')
})

test('20. the search where is one like per searchable field, over useAsTitle alone without the key and over the named fields with it', () => {
  const handed: unknown[] = []
  const find = async (options: unknown) => {
    handed.push(options)
    return page
  }
  // With no field declaring the opt-in, `useAsTitle` is the fallback, kept only because `title` is text.
  const bare = {
    ...courses,
    fields: courses.fields.map(({ searchable: _searchable, ...field }) => field),
  }
  assert.deepEqual(searchableFields({ kayan: bare }), ['title'])
  // Every id of this project is a uuid, so there is no fallback and the list searches nothing rather than answering 400 on every word.
  assert.deepEqual(searchableFields({ kayan: { fields: [{ name: 'id', kind: 'uuid' }] } }), [])
  const sessions = screen.kayan.sessions!
  assert.deepEqual(searchableFields({ kayan: sessions }), [], 'a kayan naming neither searches nothing at all')
  assert.equal(searchWhere({ kayan: sessions, search: 'anything' }), undefined, 'so a term typed into its box is no filter')
  // A `useAsTitle` of a kind `like` cannot take is dropped the same way; the declared key is refused at `buildAsas`.
  assert.deepEqual(
    searchableFields({ kayan: { useAsTitle: 'rank', fields: [{ name: 'rank', kind: 'number' }] } }),
    [],
  )
  assert.deepEqual(searchableFields({ kayan: courses }), ['title', 'summary'])
  assert.deepEqual(searchableFields({ kayan: courses, search: ['title'] }), ['title'], 'the node\'s search names the fields its box runs over')
  assert.deepEqual(findWhere({ kayan: courses, query: { search: 'x' }, search: ['title'] }), { or: [{ and: [{ title: { like: 'x' } }] }] }, 'and the where it hands `find` is over those alone')

  assert.deepEqual(
    searchWhere({ kayan: courses, search: 'tajweed basics' }),
    { or: [{ and: [{ title: { like: 'tajweed basics' } }] }, { and: [{ summary: { like: 'tajweed basics' } }] }] },
    'one `like` per named field, ORed, and the term is not split here — the store splits `like` on whitespace itself',
  )
  assert.equal(searchWhere({ kayan: courses, search: '   ' }), undefined, 'a blank term is no filter')

  return (async () => {
    await find({ where: findWhere({ kayan: courses, query: { search: 'tajweed' } }), limit: 10 })
    await find({ where: findWhere({ kayan: courses, query: { search: 'tajweed', where: { or: [{ and: [{ fee: { equals: 300 } }] }] } } }), limit: 10 })
    assert.deepEqual(
      (handed[0] as { where: unknown }).where,
      { or: [{ and: [{ title: { like: 'tajweed' } }] }, { and: [{ summary: { like: 'tajweed' } }] }] },
      'a search alone is the search\'s own `where`',
    )
    assert.deepEqual(
      (handed[1] as { where: unknown }).where,
      {
        and: [
          { or: [{ and: [{ fee: { equals: 300 } }] }] },
          { or: [{ and: [{ title: { like: 'tajweed' } }] }, { and: [{ summary: { like: 'tajweed' } }] }] },
        ],
      },
      'and beside a panel filter the two are ANDed, the panel\'s first',
    )
    // The screen's `baseFilter` for the kayan is ANDed after both.
    const offered = { ...courses, baseFilter: { archived: { equals: false } } }
    assert.deepEqual(findWhere({ kayan: offered, query: {} }), { archived: { equals: false } }, 'a base filter alone is the where')
    assert.deepEqual(
      findWhere({ kayan: offered, query: { search: 'x', where: { or: [{ and: [{ fee: { equals: 300 } }] }] } }, search: ['title'] }),
      { and: [{ or: [{ and: [{ fee: { equals: 300 } }] }] }, { or: [{ and: [{ title: { like: 'x' } }] }] }, { archived: { equals: false } }] },
      'and beside a panel filter and a search the three are ANDed, the panel\'s first and the base filter last',
    )
  })()
})

test('21. the panel holds a row the URL does not, so a second row survives being added, filled, rejoined and left alone when the first is removed', () => {
  // The panel's state is not the URL's: committing a row with no value writes `{ [operator]: undefined }`, which `JSON.stringify` drops, so the row would vanish on the next parse.
  const one: Conditions = [{ and: [{ title: { equals: 'a' } }] }]
  assert.deepEqual(committedOf(one), { or: [{ and: [{ title: { equals: 'a' } }] }] }, 'a filled row is committed')

  const added = addCondition(one, { fee: { equals: undefined } })
  assert.equal(added.length, 2, 'the panel holds two groups')
  assert.deepEqual(
    committedOf(added),
    { or: [{ and: [{ title: { equals: 'a' } }] }] },
    'and commits only the filled one, so the URL is unchanged and the new row survives the round trip',
  )

  const filled = updateCondition({ conditions: added, orIndex: 1, andIndex: 0, condition: { fee: { greater_than: 100 } } })
  assert.deepEqual(committedOf(filled), {
    or: [{ and: [{ title: { equals: 'a' } }] }, { and: [{ fee: { greater_than: 100 } }] }],
  })

  const anded = updateJoin({ conditions: filled, orIndex: 1, andIndex: 0, join: 'and' })
  assert.deepEqual(committedOf(anded), {
    or: [{ and: [{ title: { equals: 'a' } }, { fee: { greater_than: 100 } }] }],
  })
  const ored = updateJoin({ conditions: anded, orIndex: 0, andIndex: 1, join: 'or' })
  assert.deepEqual(committedOf(ored), {
    or: [{ and: [{ title: { equals: 'a' } }] }, { and: [{ fee: { greater_than: 100 } }] }],
  })

  const rest = removeCondition({ conditions: ored, orIndex: 0, andIndex: 0 })
  assert.deepEqual(rest, [{ and: [{ fee: { greater_than: 100 } }] }], 'the emptied group is dropped, not kept blank')
  assert.deepEqual(committedOf(rest), { or: [{ and: [{ fee: { greater_than: 100 } }] }] })
  assert.equal(committedOf(removeCondition({ conditions: rest, orIndex: 0, andIndex: 0 })), undefined, 'and removing the last row is no filter at all')

  // Two rows, neither filled: both are dropped, so the commit is no filter and the URL is untouched.
  const blanks: Conditions = [{ and: [{ title: { equals: undefined } }] }, { and: [{ fee: { equals: undefined } }] }]
  assert.equal(committedOf(blanks), undefined, 'two rows neither of which holds a value commit no filter at all')

  // `exists` takes a boolean, so `false` is a filled row.
  assert.deepEqual(committedOf([{ and: [{ archived: { exists: false } }] }]), {
    or: [{ and: [{ archived: { exists: false } }] }],
  })
})

test('22. the create link is gone where the report denies create, the first shown column links the row when the title is hidden, and a list with nothing to search draws no box', () => {
  const markup = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(List, {
        kayan: courses,
        page,
        query: {},
        t: copy.t,
        locale: 'en',
        onQuery: () => {},
        href: (id: string) => `/courses/${id}`,
        newHref: '/courses/new',
        screen: screenOf(courses.pages.list!),
        ...extra,
      }),
    )

  // Chrome only: the create is authorized server-side whatever this draws.
  assert.ok(markup({}).includes('href="/courses/new"'), 'a host that hands no report keeps the link it always had')
  assert.ok(markup({ creates: true }).includes('href="/courses/new"'), 'and so does one whose report allows create')
  assert.equal(markup({ creates: false }).includes('href="/courses/new"'), false, 'a report that denies it draws no link')

  // `?cols=-title` hides the column `useAsTitle` names, so the first shown column carries the row link.
  const hidden = markup({ query: { cols: ['-title'] } })
  const row = /<tbody[\s\S]*?<\/tbody>/.exec(hidden)?.[0] ?? ''
  assert.ok(row, 'the table has a body')
  assert.equal(row.includes('Tajweed'), false, 'the title column is not drawn')
  assert.ok(
    /<a href="\/courses\/0f1d8c2e-0000-4000-8000-000000000001"[^>]*>[^<]*300/.test(row),
    `the first column that is shown links the row instead:\n${row}`,
  )

  const sessions = screen.kayan.sessions!
  assert.deepEqual(searchableFields({ kayan: sessions }), [], 'this kayan has nothing to search, so the assertion below is not vacuous')
  assert.equal(/<input[^>]*type="search"[^>]*>/.test(markup({ kayan: sessions, screen: undefined })), false, 'no box')
  assert.equal(/<input[^>]*type="search"[^>]*>/.test(markup({})), true, 'while a searchable list keeps its box')
})

test('23. a kind no map answers for is an error naming the kind and the field, so a project kind nobody wrote a control for is never drawn as something else', () => {
  const unmapped: ClientKayan = { ...courses, fields: [fieldOf({ name: 'weight', kind: 'nothing-ships-this' })] }
  assert.throws(
    () => renderToStaticMarkup(
      createElement(Form, {
        kayan: unmapped,
        client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
        value: { id: 'a-row', weight: '4 kg' },
        t: copy.t,
        locale: 'en',
        onDone: () => {},
      }),
    ),
    /components\.controls has no control for "nothing-ships-this", the kind of field "weight"/,
  )
})

test('24. a label, a description and a refusal all resolve through t, and each falls back to what the caller wrote when no key answers', () => {
  const refusal = (path: string, message = 'courses.title.invalid') => ({
    data: { key: 'error.invalid.value', params: { issues: [{ path, message }] } },
  })
  const alertFor = (html: string, field: string) =>
    new RegExp(`<div[^>]*role="alert"[^>]*id="courses-${field}-error"`).test(html)
  const named = formMarkup({ error: refusal('title') })
  assert.ok(alertFor(named, 'title'), `the refusal renders as this field's own alert:\n${named.slice(0, 600)}`)
  assert.ok(named.includes('A course needs a title.'), 'and it is the project\'s own words for this field, through t')
  assert.ok(!named.includes('courses.title.invalid'), 'so the key the wire carried is not what a person reads')

  const byRule = formMarkup({ error: refusal('title', 'courses.title.maxLength') })
  assert.ok(byRule.includes('A title fits on one line.'), 'a rule\'s refusal reads as that rule\'s own sentence')
  assert.ok(!byRule.includes('A course needs a title.'), 'and not as the sentence the kind\'s key answers')

  const unwritten = formMarkup({ error: refusal('summary', 'Too long by a mile.') })
  assert.ok(alertFor(unwritten, 'summary'), 'a field with no key of its own still gets its alert')
  assert.ok(unwritten.includes('Too long by a mile.'), 'carrying the message the wire sent, since it is its own fallback')

  const arabic = formMarkup({ error: refusal('summary', 'courses.summary.maxLength'), t: translator('ar'), locale: 'ar' })
  assert.ok(
    arabic.includes('القيمة طويلة جدًا.'),
    `the seeded Arabic sentence is what the box shows:\n${arabic.slice(0, 600)}`,
  )

  const plain = formMarkup()
  assert.ok(
    /<p[^>]*data-slot="field-description"[^>]*id="courses-title-description"/.test(plain),
    `the described field carries its description under the id its control points at:\n${plain.slice(0, 600)}`,
  )
  assert.ok(plain.includes('The name a student sees in the catalogue.'), 'which is the record the declaration wrote')
  assert.ok(!plain.includes('id="courses-summary-description"'), 'and a field that declared none renders no description node')
  assert.ok(!plain.includes('role="alert"'), 'nor any alert, since nothing was refused')
})

test('25. every control points at its own label, and at whichever of its description and its refusal exist', () => {
  const html = formMarkup({
    error: { data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'No.' }] } } },
  })
  // The attribute rather than the opening tag: the app's `label` writes `data-slot` and its class list before `for`.
  assert.ok(/<label[^>]*\sfor="courses-title"/.test(html), 'the label names the control it belongs to')
  const titled = /<input[^>]*id="courses-title"[^>]*>/.exec(html)?.[0] ?? ''
  assert.ok(titled, 'the described and refused field renders its control')
  assert.ok(
    titled.includes('aria-describedby="courses-title-description courses-title-error"'),
    `and points at both of its notes, in that order:\n${titled}`,
  )
  const bare = /<input[^>]*id="courses-summary"[^>]*>/.exec(html)?.[0] ?? ''
  assert.ok(bare, 'a field with no description and no refusal renders its control')
  assert.ok(!bare.includes('aria-describedby'), `and carries no aria-describedby:\n${bare}`)
  const boxed = html.indexOf('id="courses-archived"')
  const labelled = html.search(/<label[^>]*\sfor="courses-archived"/)
  assert.ok(boxed > 0 && labelled > 0, 'the checkbox renders a box and a label')
  assert.ok(boxed < labelled, 'with the label after the box, which is the one exception the shell carries')
})

test('33. the column popup moves a column past the hidden one between it and its neighbour, and reports no neighbour at a section\'s end', () => {
  // The popup draws one list twice, shown and not shown, so the neighbour of a shown column is the next shown one, not the next index.
  const columns = [
    { name: 'title', active: true },
    { name: 'summary', active: false },
    { name: 'fee', active: true },
  ]
  assert.equal(neighbour({ columns, at: 0, by: 1 }), 2, 'the neighbour of the first shown column is the next shown one, not the hidden row between them')
  assert.deepEqual(
    move({ columns, at: 0, by: 1 }).map((one) => one.name),
    ['fee', 'summary', 'title'],
    'so the move swaps the two shown columns and leaves the hidden one exactly where it was',
  )
  assert.equal(
    move({ columns, at: 0, by: 1 })[1]!.name,
    'summary',
    'a swap and not a splice: the column between them did not travel with the one that moved',
  )

  assert.equal(neighbour({ columns, at: 2, by: 1 }), -1, 'the last shown column has no neighbour below it')
  assert.deepEqual(move({ columns, at: 2, by: 1 }), columns, 'and a move with no neighbour is the same list, which is what the disabled button stands for')
})

test('40b. the host and the defaults reach no rich text or upload piece and no Lexical editor, followed through every piece they import', () => {
  // Pieces import each other by the package's name, so the graph is read off the source; a project without rich text or files never loads the editor or the upload code.
  const imports = (path: string) => [...readFileSync(new URL(`../registry/${path}`, import.meta.url), 'utf8').matchAll(/from '([^']+)'/g)].map((hit) => hit[1]!)
  const reach = (path: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(path)) return seen
    seen.add(path)
    for (const one of imports(path)) if (one.startsWith('mithaq-admin/')) reach(one.slice('mithaq-admin/'.length), seen)
    return seen
  }
  const host = readdirSync(new URL('../registry/host/', import.meta.url)).map((file) => `host/${file}`)
  for (const [name, roots] of [['the host', host], ['the defaults', ['default-components.tsx']]] as const) {
    const reached = new Set(roots.flatMap((root) => [...reach(root)]))
    // rich-text-line reads a stored value's words with no Lexical, so the defaults may re-export it.
    assert.deepEqual([...reached].filter((one) => /rich-text(?!-line\.ts$)|upload|file-thumb/.test(one)), [], `${name} reaches no rich text or upload piece`)
    assert.deepEqual([...reached].flatMap(imports).filter((one) => one.startsWith('@lexical/')), [], `${name} imports no Lexical editor package`)
  }
  assert.ok([...reach('rich-text.tsx')].flatMap(imports).some((one) => one.startsWith('@lexical/react/')), 'and the rich text add-on brings the editor')
  assert.ok(reach('upload.tsx').has('upload-dialog.tsx') && ![...reach('upload.tsx')].flatMap(imports).some((one) => one.includes('lexical')), 'and the files add-on its dialog, with no Lexical')
})

test('40. every item names the shadcn primitive it imports in registryDependencies, and names no primitive it does not import', () => {
  // A bare name in `registryDependencies` is the shadcn primitive `mithaq eject` tells a project to add when it lacks it; read off the source so a new import is compared.
  const source = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8')) as {
    items: { name: string; registryDependencies?: string[]; files: { path: string }[] }[]
  }
  const ownPrimitives = new Map(
    source.items.flatMap((item) => item.files.filter((file) => file.path.startsWith('registry/ui/')).map((file) => [file.path.slice('registry/ui/'.length).replace(/\.tsx$/, ''), item.name] as const)),
  )
  assert.deepEqual([...ownPrimitives.keys()], ['directional-icon'], 'directional-icon is the one primitive this registry ships')
  let found = 0
  for (const item of source.items) {
    const written = item.files.map((file) => readFileSync(new URL(`../${file.path}`, import.meta.url), 'utf8')).join('\n')
    // Either quote and a nested path: `@/components/ui/sidebar/rail` names `sidebar`.
    const imported = [...written.matchAll(/from ['"]@\/components\/ui\/([a-z-]+(?:\/[a-z-]+)*)['"]/g)].map(
      (match) => match[1]!.split('/')[0]!,
    )
    found += imported.length
    const declared = item.registryDependencies ?? []
    assert.deepEqual(
      [...declared].sort(),
      [...new Set(imported.filter((name) => !ownPrimitives.has(name)))].sort(),
      `${item.name} declares the shadcn items its files import, and no other`,
    )
  }
  assert.ok(found > 0, 'at least one item imports a primitive, so the regex above matched something')
})

test('42. the package holds the same shadcn primitives the app does, so what this suite renders is what the app runs', () => {
  // Compared without a leading `"use client"` (`shadcn add` adds and removes it between runs; it is inert in this Vite app) and without the build's trailing marker.
  const bare = (text: string) => text.replace(/^"use client"\n\n/, '').replace(/\/\/ mithaq-admin \S+ [0-9a-f]{64}\n$/, '')
  const ours = new URL('../registry/ui/', import.meta.url)
  const theirs = new URL('../../../apps/asas-tanstack/src/components/ui/', import.meta.url)
  const names = readdirSync(ours).sort()
  // Both listings, not the package's alone: a primitive added to the app and not to the package is the drift this step exists for.
  assert.deepEqual(names, readdirSync(theirs).sort(), 'the two directories hold the same primitives, by name')
  assert.equal(names.length, 40, `which are the forty files the app was given: ${names.join(', ')}`)
  for (const name of names) {
    const mine = readFileSync(new URL(name, ours), 'utf8')
    assert.ok(mine.length > 0, `${name} is not empty`)
    assert.equal(
      bare(mine),
      bare(readFileSync(new URL(name, theirs), 'utf8')),
      `registry/ui/${name} is the file the app holds; copy the app's src/components/ui/ over it`,
    )
  }

  // `sidebar.tsx` reads `@/hooks/use-mobile` and every primitive imports `cn` from the app's `utils` alias; the package holds its own copies of both.
  for (const [ours2, theirs2] of [
    ['../registry/hooks/', '../../../apps/asas-tanstack/src/hooks/'],
    ['../registry/lib/', '../../../apps/asas-tanstack/src/lib/'],
  ] as const) {
    const here = new URL(ours2, import.meta.url)
    const there = new URL(theirs2, import.meta.url)
    assert.deepEqual(readdirSync(here).sort(), readdirSync(there).sort(), `${ours2} and ${theirs2} hold the same files, by name`)
    for (const name of readdirSync(here)) {
      assert.equal(
        bare(readFileSync(new URL(name, here), 'utf8')),
        bare(readFileSync(new URL(name, there), 'utf8')),
        `${ours2}${name} is the file the app holds; copy the app's own over it`,
      )
    }
  }
})

test('46. the list header keeps its title and singular create link together, with the count in the footer alone', () => {
  const html = listMarkup()
  const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? ''
  assert.ok(header, 'the list draws a header')
  assert.match(header, /<h1[^>]*>Courses<\/h1>/, 'the title shares the header with the primary action')
  assert.ok(header.includes('New course'), `and carries the create link under the kayan's own words for it:\n${header}`)
  assert.ok(header.includes('href="/courses/new"'), 'which is the link the host handed it')
  assert.equal(header.includes('Total'), false, `and no count under the title:\n${header}`)
  assert.ok(html.includes('data-mithaq-range="1-1/1"'), 'while the footer prints the range and the total')
})

test('47. the search, the columns button, the filter panel\'s button and the table sit in one card, and the search names the fields it runs over', () => {
  const html = listMarkup()
  assert.equal(html.split('data-slot="card"').length - 1, 1, 'the list draws exactly one card')
  const opened = html.indexOf('data-slot="card-content"')
  assert.notEqual(opened, -1, `whose content box is where the rest of the screen is:\n${html.slice(0, 400)}`)
  for (const inside of ['type="search"', 'Customize Columns', '>Filters<', '<table', '<footer']) {
    const at = html.indexOf(inside)
    assert.notEqual(at, -1, `the list draws ${inside}`)
    assert.ok(at > opened, `and draws it inside the one card, not beside it: ${inside}`)
  }
  assert.ok(html.indexOf('<header') < opened, 'while the header is above the card')
  // The word between labels is `Intl.ListFormat`'s, so the list reads as a list in every locale.
  const box = /<input[^>]*type="search"[^>]*>/.exec(html)?.[0] ?? ''
  assert.deepEqual(searchableFields({ kayan: courses, search: ['title', 'summary', 'details'] }), ['title', 'summary', 'details'], 'this list names three searchable fields')
  assert.ok(box.includes('placeholder="Title, Summary, or Details"'), `the box names the three of them:\n${box}`)
  const arabic = /<input[^>]*type="search"[^>]*>/.exec(listMarkup('ar'))?.[0] ?? ''
  assert.ok(arabic.includes('أو'), `and joins them with the Arabic word for or:\n${arabic}`)
  assert.ok(box.includes('aria-label="Search"'), 'while the control keeps a name that does not change with the kayan')
})

test('48. one arrow is drawn, on the sorted column and nowhere else, and every sortable head still reports aria-sort', () => {
  // Every head but the last, the row menu's, which heads no field.
  const headsOf = (markup: string) => [...markup.matchAll(/<th[\s\S]*?<\/th>/g)].map((hit) => hit[0]).filter((head) => !head.includes('sr-only'))
  const plain = headsOf(listMarkup())
  assert.ok(plain.length >= 3, `the table heads its columns: ${plain.length}`)
  for (const head of plain) assert.equal(/lucide-arrow-(up|down)/.test(head), false, `an unsorted head draws no arrow:\n${head}`)
  // `details` is rich text, which cannot order a page, so its head offers no sort.
  assert.equal(courses.fields.find((field) => field.name === 'details')?.sortable, false, 'the rich text column is projected unsortable')
  const quiet = plain.filter((head) => !head.includes('aria-sort="none"'))
  assert.equal(quiet.length, 1, `one head, the rich text column's, reports no aria-sort: ${quiet.join('\n')}`)
  assert.ok(!quiet[0]!.includes('aria-sort'), 'and no direction either')
  assert.ok(quiet[0]!.includes('>Details<'), `and it is the details head, by its label:\n${quiet[0]}`)
  const sorted = headsOf(
    renderToStaticMarkup(
      createElement(List, {
        kayan: courses,
        page,
        query: { sort: 'title' },
        t: copy.t,
        locale: 'en',
        onQuery: () => {},
        href: (id: string) => `/courses/${id}`,
        newHref: '/courses/new',
      }),
    ),
  )
  const arrows = sorted.filter((head) => /lucide-arrow-(up|down)/.test(head))
  assert.equal(arrows.length, 1, `exactly one head carries an arrow: ${arrows.length}`)
  assert.ok(arrows[0]!.includes('aria-sort="ascending"'), `and it is the sorted one:\n${arrows[0]}`)
  assert.ok(arrows[0]!.includes('lucide-arrow-up'), 'ascending draws the up arrow')
  const descending = headsOf(
    renderToStaticMarkup(
      createElement(List, {
        kayan: courses,
        page,
        query: { sort: '-title' },
        t: copy.t,
        locale: 'en',
        onQuery: () => {},
        href: (id: string) => `/courses/${id}`,
        newHref: '/courses/new',
      }),
    ),
  ).filter((head) => /lucide-arrow-(up|down)/.test(head))
  assert.equal(descending.length, 1, 'and descending draws one arrow too')
  assert.ok(descending[0]!.includes('lucide-arrow-down'), 'which is the down arrow')
  assert.equal(listMarkup().includes('type="checkbox"'), false, 'and the head row offers no select-all box')
})

test('49. the pager offers first and last beside previous and next, which is that project\'s own four', () => {
  const html = listMarkup()
  const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? ''
  assert.ok(footer, 'the list draws a footer')
  for (const name of ['First', 'Previous', 'Next', 'Last']) {
    assert.ok(footer.includes(`>${name}<`), `the pager names the ${name} button:\n${footer}`)
  }
  assert.ok(footer.includes('lucide-chevrons-left'), 'and first and last carry the double chevron that project uses')
  assert.ok(footer.includes('lucide-chevrons-right'), 'in both directions')
  assert.ok(footer.includes('aria-label="Page"'), 'while our own page input is still in the row')
})

test('49b. an empty list says so outside its table, so a table wider than a phone never clips the sentence', () => {
  const html = renderToStaticMarkup(
    createElement(List, {
      kayan: courses,
      page: { ...page, docs: [], totalDocs: 0, totalPages: 0 },
      query: {},
      t: translator('en'),
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      screen: screenOf(courses.pages.list!),
    }),
  )
  const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? ''
  assert.ok(table.includes('<thead'), 'the table still names its columns')
  assert.equal(table.includes('Nothing here yet.'), false, `with no sentence inside it:\n${table}`)
  assert.ok(html.indexOf('Nothing here yet.') > html.indexOf('</table>'), 'the sentence follows the table')
})

test('50. the form is a title, a rule under it and the fields on a card, and a global is headed by its label rather than by its name', () => {
  const html = formMarkup()
  const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? ''
  assert.ok(header, 'the form draws a header')
  assert.ok(header.includes('>Course<'), `named in the singular the project wrote:\n${header}`)
  assert.ok(html.includes('border-t pt-6'), 'with that project\'s rule under it')
  assert.ok(html.indexOf('data-slot="card"') > html.indexOf('</header>'), 'and the fields on a card below the header')
  assert.ok(html.indexOf('id="courses-title"') > html.indexOf('data-slot="card-content"'), 'inside the card\'s content box')

  const global = renderToStaticMarkup(
    createElement(Form, {
      kayan: settings,
      client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
      value: null,
      t: copy.t,
      locale: 'en',
      onDone: () => {},
    }),
  )
  assert.ok(global.includes('>Settings<'), `the global is headed by its label:\n${global.slice(0, 400)}`)
  assert.equal(global.includes('>settings<'), false, 'and never by its lowercase name')
})

test('51. the read-only defaults stay in the side column on an edit and a create page keeps its side region', () => {
  const edited = formMarkup()
  const aside = /<aside[\s\S]*?<\/aside>/.exec(edited)?.[0] ?? ''
  assert.ok(aside, `an edit draws the side column:\n${edited.slice(0, 400)}`)
  for (const name of ['id', 'createdAt', 'updatedAt']) {
    assert.ok(aside.includes(`id="courses-${name}"`), `${name} is in the side card`)
    assert.equal(
      /<div data-fields=""[\s\S]*?<aside/.exec(edited)?.[0]?.includes(`id="courses-${name}"`),
      false,
      `and no longer in the column of fields: ${name}`,
    )
  }
  // The organization is a relationship, and a disabled search box over an organization the viewer cannot pick offers nothing, so the list's relationship cell draws it.
  assert.ok(aside.includes('Organization'), 'the organization is labelled in the side card, by the word staff read it by')
  assert.equal(edited.includes('id="courses-organization"'), false, 'and is no control at all')

  const created = formMarkup({ value: null, screen: screenOf(courses.pages.create!) })
  const side = /<aside[^>]*data-region="side"[\s\S]*?<\/aside>/.exec(created)?.[0] ?? ''
  assert.ok(side.includes('Tags'), `the page's side region remains on a create:\n${side}`)
  for (const name of ['id', 'createdAt', 'updatedAt', 'organization']) {
    assert.equal(created.includes(`id="courses-${name}"`), false, `${name} offers no create control`)
  }
})

test('52. a section is a collapsible card rather than a native disclosure triangle, and a tab strip is still a tab strip', () => {
  const html = formMarkup({ value: null, screen: screenOf(courses.pages.create!) })
  assert.equal(html.includes('<details'), false, 'no native disclosure element is left')
  assert.equal(html.includes('<summary'), false, 'and no native summary')
  assert.ok(html.includes('data-slot="collapsible"'), 'the section is a collapsible')
  assert.ok(html.includes('data-slot="collapsible-trigger"'), 'with a trigger of its own')
  assert.ok(html.includes('data-slot="collapsible-content"'), 'and a panel')
  const heading = html.indexOf('About the course')
  assert.notEqual(heading, -1, 'the section is headed by its declared label')
  assert.ok(html.lastIndexOf('data-slot="card-header"', heading) !== -1, 'inside a card header')
  // No create page of the template holds a tab strip, so the page is written here.
  const tabbed = formMarkup({ value: null, screen: screenOf(formPage([{ tabs: [{ tab: 'pricing', label: { en: 'Pricing', ar: 'التسعير' }, fields: [{ field: 'fee' }] }] }])) })
  assert.ok(tabbed.includes('data-slot="tabs-trigger"'), 'the tabs are still a tab strip')
  assert.ok(tabbed.includes('>Pricing<'), 'under the labels the page declared')
})

test('53. a refusal naming a field of a closed tab is counted on that tab\'s own trigger, so a save that failed out of sight says so', () => {
  // A refusal on a closed tab shows as a count on its container. `level`, not `fee`: `fee` is on the first tab, already on screen; `level` sits in a closed accordion on the second.
  const strip = formPage([{ tabs: [
    { tab: 'pricing', label: { en: 'Pricing', ar: 'التسعير' }, fields: [{ field: 'fee' }] },
    { tab: 'schedule', label: { en: 'Schedule', ar: 'الجدول' }, fields: [{ accordion: [
      { item: 'difficulty', label: { en: 'Difficulty', ar: 'الصعوبة' }, fields: [{ field: 'level' }] },
    ] }] },
  ] }])
  const created = (error?: unknown) => formMarkup({ value: null, screen: screenOf(strip), error })
  const html = created({
    data: { key: 'error.invalid.value', params: { issues: [{ path: 'level', message: 'A level is one to five.' }] } },
  })
  const triggers = [...html.matchAll(/<button[^>]*data-slot="tabs-trigger"[\s\S]*?<\/button>/g)].map((hit) => hit[0])
  assert.equal(triggers.length, 2, `the strip has all declared tabs: ${triggers.length}`)
  const pricing = triggers.find((one) => one.includes('Pricing')) ?? ''
  const schedule = triggers.find((one) => one.includes('Schedule')) ?? ''
  assert.ok(schedule.includes('data-mithaq-invalid="1"'), `the tab holding the refused field is counted:\n${schedule}`)
  assert.equal(pricing.includes('data-mithaq-invalid'), false, `and the tab that holds none is not:\n${pricing}`)
  assert.equal(created().includes('data-mithaq-invalid'), false, 'a form with no refusal draws no count')
})

test('58. the user menu offers one row per locale the host reads in, each named in its own language, with the one in use marked', () => {
  // The rows are in a portal a server render never opens, so the derivation is asserted rather than the markup.
  const entries = localeEntries(['ar', 'en'], 'ar')
  assert.deepEqual(
    entries.map((one) => one.locale),
    ['ar', 'en'],
    'one row per locale, in the order the host declared them',
  )
  assert.equal(entries[0]!.label, 'العربية', 'Arabic names itself in Arabic')
  assert.equal(entries[1]!.label, 'English', 'and English in English')
  // The endonym does not move with the viewer's locale, which is why it is not a copy key.
  assert.deepEqual(
    localeEntries(['ar', 'en'], 'en').map((one) => one.label),
    entries.map((one) => one.label),
    'and neither name changes with the locale being read in',
  )
  assert.deepEqual(
    entries.map((one) => one.active),
    [true, false],
    'the locale being read in is the one marked',
  )
  assert.deepEqual(
    localeEntries(['ar', 'en'], 'en').map((one) => one.active),
    [false, true],
    'and it moves with the locale rather than being pinned to a position',
  )
  // A string that is not a language tag falls back to itself: `Intl.DisplayNames.of` raises a RangeError on one.
  assert.equal(endonym('not a tag'), 'not a tag', 'a string that is no language tag is shown as itself')
  assert.equal(localeEntries([], 'en').length, 0, 'and a host with no locales has no rows')
})

test('59. the kayan\'s own sentence is drawn under the list heading and under the form title, and a field\'s placeholder is on the box it is a hint for', () => {
  const declared = courses.description as Record<string, string>
  assert.ok(declared?.en && declared.ar, 'this kayan declares a sentence in both locales')
  assert.notEqual(declared.en, declared.ar, 'and the two read differently, so the next assertions can fail')

  const list = listMarkup()
  assert.ok(list.includes(declared.en), 'the list draws the sentence the kayan declared')
  const header = /<header[\s\S]*?<\/header>/.exec(list)?.[0] ?? ''
  assert.ok(header.includes(declared.en), 'inside the header, beside the title rather than below the table')
  assert.ok(header.indexOf('Courses') < header.indexOf(declared.en), 'and under the heading rather than over it')
  assert.ok(listMarkup('ar').includes(declared.ar), 'and it is copy, so the Arabic list reads the Arabic sentence')
  assert.ok(!listMarkup('ar').includes(declared.en), 'and none of the English')

  const form = formMarkup()
  assert.ok(form.includes(declared.en), 'the form draws the same sentence under its own title')
  assert.ok(form.indexOf('Course') < form.indexOf(declared.en), 'under the title rather than over it')

  // A global declares none, so `descriptionOf` answers nothing rather than repeat the heading.
  assert.equal(descriptionOf(screen.kayan.memberRoles!, copy), undefined, 'a kayan that declares no sentence has none')
  assert.equal(descriptionOf(courses, copy), declared.en, 'and one that does reads it in the locale asked for')

  const title = courses.fields.find((one) => one.name === 'title')!
  const hint = title.placeholder as Record<string, string>
  assert.ok(hint?.en && hint.ar, 'the title field declares a hint in both locales')
  assert.equal(placeholderFor({ kayan: courses, field: title, copy }), hint.en)
  assert.equal(placeholderFor({ kayan: courses, field: title, copy: { t: translator('ar'), locale: 'ar' } }), hint.ar)
  const box = (html: string, name: string) => new RegExp(`<(?:input|textarea)[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? ''
  assert.ok(box(form, 'title').includes(`placeholder="${hint.en}"`), 'the title control carries the hint the field declared')
  assert.ok(!box(form, 'summary').includes('placeholder='), 'and a field that declares none carries no empty hint')
  // A checkbox is a button, not an input, so a placeholder is ignored.
  assert.equal(placeholderFor({ kayan: courses, field: fieldOf({ name: 'unwritten', kind: 'text' }), copy }), undefined)
})

test('62. the selection column and its toolbar are drawn only where the report allows a bulk by name, and the head checkbox reports mixed while part of the page is ticked', () => {
  // A bulk grants nothing the single-row write does, so the gate is `operations.deleteMany` and `operations.updateMany` by name.
  const listScreen = { refs: {}, kayan: courses, page: courses.pages.list as never }
  const withOperations = (operations: Record<string, boolean>) =>
    renderToStaticMarkup(
      createElement(List, {
        kayan: courses,
        page,
        query: {},
        t: copy.t,
        locale: 'en',
        onQuery: () => {},
        href: (id: string) => `/courses/${id}`,
        newHref: '/courses/new',
        screen: listScreen,
        operations,
        run: async () => ({}),
      }),
    )
  const none = withOperations({ update: true, delete: true, create: true })
  assert.ok(!none.includes('data-mithaq-selected'), 'a role holding the two single-row writes and neither bulk gets no toolbar')
  // The drawn label and not the key: `t` resolves every key before it reaches the markup.
  assert.ok(!none.includes('Select every row'), 'and no selection column with it')

  for (const key of ['deleteMany', 'updateMany']) {
    const one = withOperations({ [key]: true })
    assert.ok(one.includes('Select every row on this page'), `"${key}" alone is enough to draw the column of checkboxes`)
    assert.ok(one.includes('Select this row'), 'one per row of the page')
    // The count and the buttons wait for a ticked row, which a page as served never holds.
    assert.ok(!one.includes('data-mithaq-selected'), 'and no count while nothing is ticked')
  }

  // A host that says nothing about running an operation draws no button whatever the report allows, and a list node with no bulk button draws no selection.
  const unwired = (screen?: unknown) => renderToStaticMarkup(
    createElement(List, {
      kayan: courses,
      page,
      query: {},
      t: copy.t,
      locale: 'en',
      onQuery: () => {},
      href: (id: string) => `/courses/${id}`,
      newHref: '/courses/new',
      operations: { deleteMany: true, updateMany: true },
      ...(screen ? { screen: screen as never, run: async () => ({}) } : { screen: listScreen }),
    }),
  )
  assert.ok(!unwired().includes('Select every row on this page'), 'a list handed no run keeps the table it always had')
  assert.ok(
    !unwired({ ...listScreen, page: screen.kayan.tags!.pages.list }).includes('Select every row on this page'),
    'and so does one whose node names no bulk button, whatever the report allows',
  )

  const head = (selected: readonly string[]) =>
    renderToStaticMarkup(
      createElement(SelectAll, {
        ids: ['a', 'b'],
        selected: new Set(selected),
        onSelect: () => {},
        t: copy.t,
      }),
    )
  assert.ok(head([]).includes('aria-checked="false"'), 'nothing ticked is unchecked')
  assert.ok(head(['a']).includes('aria-checked="mixed"'), 'part of the page ticked is mixed, which is the state a two-value box cannot say')
  assert.ok(head(['a', 'b']).includes('aria-checked="true"'), 'and the whole page ticked is checked')
  assert.ok(
    renderToStaticMarkup(createElement(SelectAll, { ids: [], selected: new Set<string>(), onSelect: () => {}, t: copy.t })).includes(
      'aria-checked="false"',
    ),
    'a page with no rows reports unchecked rather than checked',
  )
})

test('63. the bulk update offers the fields a person could edit on a row and no others, which is the same answer the form disables a control by', () => {
  const offered = (writes?: (field: string) => boolean) =>
    writableFields(courses, writes).map((one) => one.name)
  const all = offered()
  assert.ok(all.includes('title') && all.includes('fee'), 'a field a person types into is offered')
  assert.ok(!all.includes('id'), 'the id is not, because the store makes it and the write path discards one that is sent')
  for (const name of ['createdAt', 'updatedAt', 'organization']) {
    assert.ok(!all.includes(name), `"${name}" is not, because the field named a provider that is not the client`)
  }
  assert.deepEqual(offered((field) => field === 'title'), ['title'], 'a report that allows one field offers one field')
  assert.deepEqual(offered(() => false), [], 'and one that allows none offers none')
})

test('66. a page\'s button runs a kayan\'s own operation on the edit page, under the label the page wrote, drawn only where the report allows that name', () => {
  const edit = courses.pages.edit!
  const buttonNodes = (value: unknown): ButtonClient[] =>
    Array.isArray(value) ? value.flatMap(buttonNodes)
    : value && typeof value === 'object' ? ('button' in value ? [value as ButtonClient] : 'of' in value ? [] : Object.values(value).flatMap(buttonNodes))
    : []
  const pageButtonsOf = (kayan: ClientKayan, page: PageClient, allowed: Record<string, boolean>) => buttonNodes(page).flatMap((node) => pageButtonOf({ kayan, node, allowed }) ?? [])
  const [archive, ...others] = pageButtonsOf(courses, edit, { archive: true })
  assert.equal(archive?.name, 'archive', 'the page\'s button is the operation it names')
  assert.equal(others.length, 0, 'and the only one')
  assert.equal(operationLabelFor({ kayan: courses, operation: archive!, copy }), 'Archive', 'which resolves in the locale asked for')
  assert.equal(operationLabelFor({ kayan: courses, operation: archive!, copy: { t: translator('ar'), locale: 'ar' } }), 'أرشفة', 'and in the other one')
  const everything = Object.fromEntries(courses.operations.map((one) => [one.name, true]))
  assert.deepEqual(pageButtonsOf(courses, edit, everything).map((one) => one.name), ['unpublish', 'archive', 'unarchive', 'delete'], 'no screen draws a button the page does not list')

  const drawn = (extra: Record<string, unknown>) =>
    formMarkup({ client: { create: async () => ({}), update: async () => ({}), delete: async () => ({}), run: async () => ({}) }, screen: screenOf(edit), ...extra })
  assert.ok(drawn({ operations: { archive: true } }).includes('aria-label="More actions"'), 'the report allowing an action draws More')
  assert.ok(
    !drawn({ operations: { update: true, delete: true } }).includes('>Archive<'),
    'a role holding the effect the operation belongs to and not the operation gets no button, which is the 403 this gate exists to stop',
  )
  assert.ok(!drawn({}).includes('>Archive<'), 'and a host that hands no report at all draws none, because an absent key is denied')
  assert.ok(!formMarkup({ operations: { archive: true }, screen: screenOf(edit) }).includes('>Archive<'), 'a form handed no run callback keeps the row it always had')
  const tree = edit as Extract<PageClient, { page: unknown }>
  const [tabs] = tree.page.main as unknown as { tabs: { fields: Record<string, unknown>[] }[] }[]
  const layout = tabs!.tabs[0]!.fields[0]!
  assert.ok(!drawn({ operations: { archive: true }, screen: screenOf({ ...tree, page: { ...tree.page, header: [{ title: {} }, { controls: {} }], more: [], main: [layout as never] } }) }).includes('aria-label="More actions"'), 'a page that holds no button draws none')

  // On an edit alone: a create has no row, and every operation takes the row's id.
  const created = drawn({ value: null, operations: { archive: true } })
  assert.ok(!created.includes('>Archive<'), 'a create page draws no button for an operation that names a row')
})

test('68. the shell lists a permissions row only where the host gave it one, beside the rows that point nowhere', () => {
  const shell = (permissionsHref?: string) =>
    renderToStaticMarkup(
      createElement(Shell, {
        client: kayans,
        access: { collections: { courses: { read: true } } },
        t: copy.t,
        locale: 'en',
        href: (kayan: NavKayan) => `/${kayan.name}`,
        user: { name: 'Boot Tester', email: 'boot@example.com' },
        organizations: [{ id: 'one', name: 'First Organization' }],
        activeOrganizationId: 'one',
        onSwitchOrganization: () => {},
        onSignOut: () => {},
        permissionsHref,
      }),
    )
  const listed = shell('/permissions')
  assert.ok(listed.includes('href="/permissions"'), 'the host that has the screen gets the row pointing at it')
  assert.ok(listed.includes('>Permissions<'), 'under the words the project wrote')
  assert.ok(shell('/permissions').includes('href="#"'), 'beside the shell rows that point nowhere, which are drawn either way')
  assert.ok(!shell().includes('href="/permissions"'), 'and a host that has no such screen gets no row')
  assert.ok(!shell().includes('>Permissions<'), 'nor its words')
})

test('69. the two temporal kinds reserve date space before mount and draw no native box; a moment adds its time of day on the reader\'s clock', () => {
  // The browser's own `dd/mm/yyyy, --:--` box reads in the browser's locale, not the page's.
  const drawn = (kind: string, value: unknown, locale = 'en') =>
    renderToStaticMarkup(
      createElement(controls[kind]!, {
        values: {}, setValue: () => {},
        value,
        onChange: () => {},
        field: fieldOf({ name: 'at', kind }),
        kayan: courses,
        readOnly: false,
        t: copy.t,
        id: 'at',
        locale,
      }),
    )
  const moment = drawn('datetime', new Date('2026-01-02T03:04:00Z'))
  assert.equal(/type="(?:datetime-local|date)"/.test(moment), false, 'a datetime draws no native box')
  assert.equal(moment.includes('2026-01-02'), false, 'the day button waits for the viewer before showing a date')
  assert.ok(moment.includes('data-time-field=""') && !moment.includes('type="time"'), 'and the time of day as its own boxes, never the native one, drawn on the reader\'s own clock once mounted')
  const day = drawn('date', '2026-09-21', 'ar')
  assert.equal(/type="date"/.test(day), false, 'a date draws no native box')
  assert.ok(!day.includes('2026-09-21'), 'an Arabic page also waits for the viewer before showing a day')
  assert.equal(day.includes('data-time-field'), false, 'with no time of day')
})

test('178. a text box and a text area follow their own text\'s direction, and an email or a number reads left to right', () => {
  const drawn = (kind: string, extra: Partial<ClientField> = {}) =>
    renderToStaticMarkup(createElement(controls[kind]!, { values: {}, setValue: () => {}, value: 'x', onChange: () => {}, field: fieldOf({ name: 'at', kind, ...extra }), kayan: courses, readOnly: false, t: copy.t, id: 'at', locale: 'ar' }))
  for (const kind of ['text', 'textarea', 'textArray']) assert.match(drawn(kind), /dir="auto"/, `${kind} is dir="auto"`)
  assert.match(drawn('text', { suffix: { en: 'per seat', ar: 'للمقعد' } }), /<input[^>]*dir="auto"/, 'and so is a text box inside its addons')
  for (const kind of ['email', 'number']) assert.match(drawn(kind), /dir="ltr"/, `${kind} is dir="ltr"`)
})

test('178a. a json field is a monospace text area that reads left to right in an Arabic page too, named and described by its shell, and its cell is one short line of the JSON', async () => {
  const field = fieldOf({ name: 'meta', kind: 'json', rules: { required: true } })
  const value = { colour: 'أحمر', sizes: [1, 2], nested: { deep: true } }
  const html = renderToStaticMarkup(createElement(controls.json!, { values: {}, setValue: () => {}, value, onChange: () => {}, field, kayan: courses, readOnly: false, t: copy.t, id: 'meta', describedBy: 'meta-description', error: 'Not JSON', locale: 'ar' }))
  const box = /<textarea[^>]*>/.exec(html)?.[0] ?? ''
  for (const attribute of ['id="meta"', 'name="meta"', 'dir="ltr"', 'aria-describedby="meta-description"', 'aria-invalid="true"', 'aria-required="true"', 'spellCheck="false"']) {
    assert.ok(box.toLowerCase().includes(attribute.toLowerCase()), `${attribute} on ${box}`)
  }
  assert.match(box, /font-mono/)
  assert.ok(html.includes(JSON.stringify(value, null, 2).replaceAll('"', '&quot;')), `the value written out whole, two spaces deep: ${html}`)
  const cell = (held: unknown) => staticMarkup(createElement(() => cells.json!({ kayan: courses, field, value: held, t: translator('ar'), locale: 'ar' }) as ReactElement))
  const line = cell({ long: 'x'.repeat(200) })
  assert.match(line, /<code[^>]*dir="ltr"/, `a cell reads left to right too: ${line}`)
  assert.ok(line.includes('…'), `and is cut to a line: ${line}`)
  assert.equal(cell(null), '', 'and nothing at all is no cell')
  assert.match(cell('text'), /&quot;text&quot;/, 'a string reads as JSON, quoted, so it is told from a number')
  assert.equal(cell({ a: 1 }).includes('…'), false, 'a short value is drawn whole')
  const emoji = cell({ e: '😀'.repeat(100) }).replaceAll('&quot;', '"')
  assert.ok(emoji.isWellFormed() && emoji.includes(`{"e":"${'😀'.repeat(54)}…`), `a cut never splits a character in two: ${emoji}`)
  const { brokenRule } = await import('../registry/form-rules.tsx')
  assert.equal(brokenRule(field, value), undefined)
  assert.equal(brokenRule(field, Symbol('unparsable')), 'invalid', 'what the box reports for text that is no JSON is refused before a save')
  assert.equal(brokenRule(field, null), 'required')
})

test('178b. a yes or no field drawn as a switch carries its label beside it and says whether it is on', () => {
  const html = formMarkup({ value: { id: 'x', notifications: true }, screen: screenOf(recordPage([{ form: [{ field: 'notifications' }] }])) })
  const field = /<div[^>]*role="group"[^>]*data-control="switch"[^>]*>[\s\S]*?<\/label>/.exec(html)?.[0] ?? ''
  assert.match(field, /data-orientation="horizontal"/, `the label sits beside the switch: ${field}`)
  assert.ok(field.indexOf('role="switch"') < field.indexOf('<label'), 'after it, as a checkbox\'s does')
  assert.match(field, /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/, 'and the switch says it is on')
})

test('178c. a record page with no side column gives its main column the whole width, and a form with no sentence draws no empty header or rule', () => {
  const page = (regions: Record<string, unknown>) => renderToStaticMarkup(createElement(RecordPage, { regions, page: { path: '/x' } } as never))
  assert.equal(page({ main: 'm' }).includes('grid-cols'), false, 'one column where nothing sits beside it')
  assert.equal(page({ main: 'm', side: 's' }).includes('lg:grid-cols-'), true, 'two where something does')
  const bare = formMarkup({ kayan: { ...settings, description: undefined }, value: null, screen: screenOf(recordPage([{ form: [{ field: 'contactEmail' }] }]), settings) })
  assert.equal(bare.includes('<header class="max-w-3xl"'), false, 'no header holding nothing')
  assert.equal(bare.includes('border-t pt-6'), false, 'and no rule under it')
  // A page of one row is about that row and draws no sentence, so the sentence is read off a create page of a kayan of many rows.
  const many = { ...settings, single: false }
  const headed = formMarkup({ kayan: many, value: null, screen: screenOf(recordPage([{ form: [{ field: 'contactEmail' }] }]), many) })
  assert.ok(headed.includes('<header class="max-w-3xl"') && headed.includes('border-t pt-6'), 'while a kayan with a sentence draws it on a create, and the rule under it')
  const global = formMarkup({ kayan: settings, value: { id: 's1' }, screen: screenOf(recordPage([{ form: [{ field: 'contactEmail' }] }]), settings) })
  assert.equal(global.includes('<header class="max-w-3xl"'), true, 'and a global\'s one row draws its sentence')
})

test('145b. two lists on one page keep their own URL keys: a list of another kayan writes under its of and where, and reads only its own', () => {
  // The page's own list keeps the bare keys, and each list of another kayan prefixes its own.
  const sessions = prefixOf({ of: 'sessions', where: 'course' })
  const notes = prefixOf({ of: 'notes', where: 'course' })
  assert.equal(sessions, 'sessions.course.')
  assert.equal(prefixOf({}), '')
  const url = readRaw(new URLSearchParams('page=3&where[title.en][like]=x&sessions.course.page=2&sessions.course.where[venue][equals]=campus&notes.course.search=late&theme=dark'))
  assert.deepEqual(url, {
    page: '3',
    'where[title.en][like]': 'x',
    'sessions.course.page': '2',
    'sessions.course.where[venue][equals]': 'campus',
    'notes.course.search': 'late',
  }, 'a route keeps every list\'s keys and nothing else')
  assert.deepEqual(listRaw(url, sessions), { page: '2', 'where[venue][equals]': 'campus' }, 'a list reads its own keys, its prefix taken off')
  assert.deepEqual(listRaw(url, ''), { page: '3', 'where[title.en][like]': 'x' }, 'and the page\'s own list reads none of theirs')
  assert.deepEqual(
    withList({ raw: url, prefix: notes, written: writeQuery({ search: 'early', page: 2 }) }),
    { page: '3', 'where[title.en][like]': 'x', 'sessions.course.page': '2', 'sessions.course.where[venue][equals]': 'campus', 'notes.course.search': 'early', 'notes.course.page': '2' },
    'a write of one list replaces its keys and keeps every other list\'s',
  )
  assert.deepEqual(scopedTo({ limit: 10 }, { course: { equals: 'c1' } }), { limit: 10, where: { course: { equals: 'c1' } } })
  assert.deepEqual(
    scopedTo({ where: { venue: { equals: 'campus' } }, limit: 10 }, { course: { equals: 'c1' } }),
    { where: { and: [{ course: { equals: 'c1' } }, { venue: { equals: 'campus' } }] }, limit: 10 },
    'the scope is ANDed with what the URL asked, never replaced by it',
  )
})

test('132. a tab whose every node its when hides draws no tab, so an actor never sees a tab it would find empty, and a tab holding one shown node still draws', () => {
  // The Versions tab is drawn only for an actor holding `courses.findVersions`.
  const tabs = (shown: boolean) =>
    formMarkup({
      value: null,
      screen: screenOf(recordPage([{ form: [{ tabs: [
        { tab: 'pricing', label: { en: 'Pricing', ar: 'التسعير' }, fields: [{ field: 'fee' }] },
        { tab: 'hidden', label: { en: 'Hidden tab', ar: 'تبويب مخفي' }, fields: [{ field: 'archiveReason', when: { 'record.id': { exists: !shown } } }] },
      ] }] }])),
    })
  assert.ok(!tabs(false).includes('Hidden tab'), 'a tab whose only node is hidden is not in the strip')
  assert.ok(tabs(false).includes('Pricing'), 'and its sibling is')
  assert.ok(tabs(true).includes('Hidden tab'), 'a tab whose node is shown is drawn')
})

test('170. a create\'s audit entry holds only the fields it set, so the Activity panel draws a line for each and none for a field empty before and after', async () => {
  const { changesOf } = await import('../../../templates/mithaq/src/mithaq/audit-sink.ts')
  const { ActivityEntries } = await import('../../../templates/mithaq/src/ui/activity.tsx')
  const row = { id: 'c1', organization: 't1', title: 'Tajweed', fee: 300, summary: null, accessCode: undefined, tags: [], archiveReason: '' }
  const entry = { id: 'e1', createdAt: new Date(0), operation: 'create', actor: null, changes: changesOf({}, row) }
  const html = renderToStaticMarkup(createElement(ActivityEntries, { entries: [entry], kayan: courses, t: copy.t, locale: 'en' }))
  assert.deepEqual([...html.matchAll(/data-change="([^"]+)"/g)].map((hit) => hit[1]), ['title', 'fee'], 'a line for each field the create set, the technical columns left out')
  assert.doesNotMatch(html, /data-from="">—<\/span><span[^>]*>→<\/span><span data-to="">—</, 'and no line reads a dash to a dash')
})

test('170a. an entry lists its changes in the order the kayan declares its fields, whatever order the log keeps its keys in', async () => {
  const { ActivityEntries } = await import('../../../templates/mithaq/src/ui/activity.tsx')
  const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const declared = courses.fields.map((field) => field.name).filter((name) => ['title', 'fee', 'currency'].includes(name))
  assert.equal(declared.length, 3)
  const changes = Object.fromEntries([...declared].reverse().map((name) => [name, { from: name === 'fee' ? 1 : 'a', to: name === 'fee' ? 2 : 'b' }]))
  const entry = { id: 'e1', createdAt: new Date(0), operation: 'update', actor: null, changes }
  const html = renderToStaticMarkup(createElement(ActivityEntries, { entries: [entry], kayan: courses, t: translator('en'), locale: 'en' }))
  assert.deepEqual([...html.matchAll(/data-change="([^"]+)"/g)].map((match) => match[1]), declared)
})

test('170b. a changed value too long to keep whole is kept as the start of its JSON with a note, so a large json value never swells the log, and the panel says so in both locales', async () => {
  const { changesOf, keptLength } = await import('../../../templates/mithaq/src/mithaq/audit-sink.ts')
  const { ActivityEntries } = await import('../../../templates/mithaq/src/ui/activity.tsx')
  const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const large = { rows: Array.from({ length: 2000 }, (_, index) => ({ index, label: `row ${index}` })) }
  const changes = changesOf({ id: 'c1', title: 'Old', meta: large }, { id: 'c1', title: 'New', meta: { rows: [] } })
  assert.deepEqual(changes.title, { from: 'Old', to: 'New' }, 'a short change is kept whole, with no note')
  assert.equal(changes.meta!.truncated, true)
  assert.equal(changes.meta!.from, `${JSON.stringify(large).slice(0, keptLength)}…`, 'the long side is the start of its JSON')
  assert.equal(changes.meta!.to, '{"rows":[]}', 'and the short side of the same change is its JSON whole, so the panel reads both sides one way')
  assert.ok(JSON.stringify(changes).length < keptLength * 2, 'so the entry stays small however large the value')
  // Counted as the cut is made, by code point: 1502 of them, though 3002 UTF-16 units.
  const wide = '😀'.repeat(1500)
  assert.deepEqual(changesOf({ note: 'a' }, { note: wide }).note, { from: 'a', to: wide }, 'a side under the cut in code points is kept whole')
  const meta = fieldOf({ name: 'meta', kind: 'json' })
  const kayan = { ...courses, fields: [...courses.fields, meta] }
  const entry = { id: 'e1', createdAt: new Date(0), operation: 'update', actor: null, changes }
  for (const [locale, note] of [['en', 'Too long to keep whole'], ['ar', 'أطول من أن يُحفظ كاملا']] as const) {
    const html = renderToStaticMarkup(createElement(ActivityEntries, { entries: [entry], kayan, t: translator(locale), locale }))
    const line = /<li[^>]*data-change="meta"[\s\S]*?<\/li>/.exec(html)?.[0] ?? ''
    assert.ok(line.includes(note), `${locale} says the value was cut: ${line.slice(0, 300)}`)
    assert.ok(line.includes('{&quot;rows&quot;:[{&quot;index&quot;:0'), `and draws its start as text: ${line.slice(0, 300)}`)
    assert.match(line, /<span data-to="true"><code[^>]*>\{&quot;rows&quot;:\[\]\}<\/code>/, `and the short side as its JSON: ${line.slice(-300)}`)
  }
})

test('214. the Activity panel names every operation in the viewer\'s locale and a person it may not read in neutral words, never by the raw id', async () => {
  const { ActivityEntries } = await import('../../../templates/mithaq/src/ui/activity.tsx')
  const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const entry = { id: 'e1', createdAt: new Date(0), operation: 'restoreVersion', actor: 'u-hidden', changes: { title: { from: 'Old', to: 'New' } } }
  for (const [locale, said] of [['en', 'Restored a version by Someone'], ['ar', 'استُعيد إصدار بواسطة شخص ما']] as const) {
    // The reader holds no key of the provider's people, so the title read answers nothing for the actor.
    const html = renderToStaticMarkup(createElement(ActivityEntries, { entries: [entry], kayan: courses, titles: new Map([['user:u-hidden', false as const]]), t: translator(locale), locale }))
    assert.ok(html.includes(said), `the entry reads "${said}" in ${locale}: ${html.slice(0, 300)}`)
    assert.ok(!html.includes('u-hidden'), 'and never names the raw id')
  }
  // Every operation a tenant kayan writes through, which the audit sink records, has its own words, so none is drawn as its name.
  const messages = copyFile(JSON.parse(readFileSync(new URL('../../../templates/asas/src/messages/auditLog.json', import.meta.url), 'utf8'))) as Record<string, Record<string, string>>
  const audited = asas.operations.filter((one) => one.effect !== 'read' && screen.kayan[one.kayan]?.fields.some((field) => field.name === 'organization'))
  assert.ok(audited.some((one) => one.name === 'restoreVersion'), 'restoreVersion is among them')
  for (const one of audited) assert.ok(messages[`action.${one.name}`]?.en && messages[`action.${one.name}`]?.ar, `${one.kayan}.${one.name} has auditLog.action copy in both locales`)
})

test('276a. a command actor reads in the viewer\'s locale for a reader of the people, and as someone for a reader of none', async () => {
  const { ActivityEntries } = await import('../../../templates/mithaq/src/ui/activity.tsx')
  const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const entry = { id: 'e1', createdAt: new Date(0), operation: 'update', actor: 'mithaq rbac assign (osuser)', changes: { title: { from: 'Old', to: 'New' } } }
  const titles = new Map([['user:mithaq rbac assign (osuser)', false as const]])
  for (const [locale, said] of [['en', 'Updated by the command'], ['ar', 'حُدِّث بواسطة الأمر']] as const) {
    const html = renderToStaticMarkup(createElement(ActivityEntries, { entries: [entry], kayan: courses, titles, people: true, t: translator(locale), locale }))
    assert.ok(html.includes(said) && html.includes('mithaq rbac assign') && html.includes('osuser'), `${locale} names the command and the person: ${html.slice(0, 400)}`)
    assert.ok(!html.includes('Someone') && !html.includes('شخص ما'), `${locale} is not someone`)
    const hidden = renderToStaticMarkup(createElement(ActivityEntries, { entries: [entry], kayan: courses, titles, t: translator(locale), locale }))
    assert.ok(!hidden.includes('osuser'), `${locale} keeps the command from a reader of no people`)
  }
  const messages = JSON.parse(readFileSync(new URL('../../../templates/asas/src/messages/auditLog.json', import.meta.url), 'utf8')) as Record<string, Record<string, string>>
  assert.ok(messages.command?.en && messages.command?.ar, 'the copy has both locales')
})

test('214d. the backoffice answers the refusal copy in both locales, through the tenant copy it re-exports', async () => {
  const { translator } = await import('../../../apps/asas-backoffice/src/copy.ts')
  for (const key of ['admin.cannotSee', 'admin.noColumns', 'admin.deleted', 'admin.notAvailable', 'error.conflict.usedBy', 'error.conflict.usedByUnnamed', 'error.conflict.usedMore', 'error.conflict.usedHint']) {
    const en = translator('en')(key, 'fallback')
    const ar = translator('ar')(key, 'fallback')
    assert.ok(en !== 'fallback' && ar !== 'fallback' && ar !== en, `${key}: ${en} | ${ar}`)
  }
})

test('219a. the row link of a list whose first column is an email holds the address as text, so no link sits inside a link, and an email anywhere else is still a mail link', () => {
  const backoffice = asas.targets.backoffice.client
  const accounts = backoffice.kayan.localUsers!
  const drawn = ({ kayan, docs, href }: { kayan: ClientKayan; docs: Record<string, unknown>[]; href: (id: string) => string }) =>
    renderToStaticMarkup(
      createElement(List, {
        kayan,
        page: { ...page, docs },
        query: {},
        t: translator('en'),
        locale: 'en',
        onQuery: () => {},
        href,
        newHref: '/new',
        screen: { refs, kayan, page: kayan.pages.list as Extract<PageClient, { page: unknown }> },
      }),
    )
  const markup = drawn({ kayan: accounts, docs: [{ id: 'a1', email: 'learner@example.com' }], href: (id) => `/local-users/${id}` })
  const link = /<a [^>]*data-row-link[^>]*>(.*?)<\/a>/.exec(markup)?.[1]
  assert.equal(link, 'learner@example.com', 'the row link holds the plain address')
  assert.equal(markup.includes('mailto:'), false, 'and no mail link is drawn in the list')

  // Titled by its date, the same list opens with that column, so the email is a later one.
  const dated = { ...accounts, useAsTitle: 'createdAt' }
  const later = drawn({ kayan: dated, docs: [{ id: 'a1', email: 'learner@example.com', createdAt: '2026-10-08T00:00:00.000Z' }], href: (id) => `/local-users/${id}` })
  assert.ok(later.includes('href="mailto:learner@example.com"'), 'an email in a later column stays a mail link')
  // A list whose rows open nowhere draws no row link, so the first column keeps its own cell.
  const closed = drawn({ kayan: accounts, docs: [{ id: 'a1', email: 'learner@example.com' }], href: () => '#' })
  assert.ok(!closed.includes('data-row-link') && closed.includes('href="mailto:learner@example.com"'), 'and so does the email of a list with no row page')
})

test('219b. record breadcrumbs keep each host placement and use the viewer\'s language', async () => {
  const { BackofficeRecordPage } = await import('../../../templates/asas/src/ui-backoffice/record-page.tsx')
  for (const screen of [asas.targets.dashboard.client, asas.targets.backoffice.client]) {
    const kayan = screen.kayan.tags!
    for (const locale of ['en', 'ar']) {
      const word = locale === 'ar' ? 'الوسوم' : 'Tags'
      const main = screen.path === '/backoffice' ? createElement(BackofficeRecordPage, { regions: { main: 'Body', side: null, danger: null }, page: { path: '/tags/:id' } } as never) : 'Body'
      const props = { regions: { primary: null, more: null, header: createElement('h1', {}, 'A tag'), main }, page: { path: '/tags/:id' } }
      const html = staticMarkup(createElement(ScreenContext, { value: { ...state, screen, kayan, locale, t: (_key: string, fallback?: string) => _key === 'tags.plural' ? word : fallback } }, createElement(AppComponents, { components: appDefaults }, createElement(screen.path === '/backoffice' ? BackofficeShell : AppShell, props))))
      assert.match(html, new RegExp(`href="${screen.path}/tags"[^>]*data-back`))
      assert.equal(html.indexOf('data-back=""') < html.indexOf('A tag'), screen.path !== '/backoffice', 'the tenant breadcrumb stays in the header and the backoffice keeps its body breadcrumb')
    }
  }
})

test('219c. every backoffice page names the two timestamps with one pair of labels per locale', async () => {
  const { translator: projectCopy } = await import('../../../apps/asas-tanstack/src/copy.ts')
  const backoffice = asas.targets.backoffice.client
  const named = (name: string, locale: 'en' | 'ar') =>
    new Set(
      Object.values(backoffice.kayan).flatMap((kayan) => {
        const field = kayan.fields.find((one) => one.name === name)
        return field ? [labelFor({ kayan, field, copy: { t: projectCopy(locale), locale } })] : []
      }),
    )
  assert.deepEqual([...named('createdAt', 'en')], ['Created at'], 'created, in English')
  assert.deepEqual([...named('updatedAt', 'en')], ['Updated at'], 'updated, in English')
  assert.equal(named('createdAt', 'ar').size, 1, 'created, in Arabic')
  assert.equal(named('updatedAt', 'ar').size, 1, 'updated, in Arabic')
})

test('220f. the archive dialog\'s reason, and every required control, is marked required for a screen reader, and one that is not stays unmarked', () => {
  const reason = courses.operations.find((one) => one.name === 'archive')!.fields!.find((one) => one.name === 'reason')!
  assert.equal(reason.rules.required, true, 'the reason is required by its declaration')
  const props = { kayan: courses, client: [], t: copy.t, id: 'reason', value: '', values: {}, setValue: () => {}, onChange: () => {}, readOnly: false }
  const tags = screen.kayan.tags!
  const options = [{ value: 'a', label: { en: 'A' } }]
  const required = { ...reason, options }
  const linked = { ...reason, kind: 'relationship', relationTo: 'tags' }
  for (const control of ['text', 'textarea', 'textArray', 'select', 'combobox', 'radio', 'switch', 'checkbox', 'date', 'relationship', 'upload'] as const) {
    const Control = controls[control]!
    const field = control === 'relationship' || control === 'upload' ? linked : required
    const markup = (rules: Record<string, unknown>) => renderToStaticMarkup(createElement(Control, { ...props, client: [tags], field: { ...field, rules } as ClientField }))
    assert.ok(markup(reason.rules).includes('aria-required="true"'), `the ${control} control says so`)
    assert.equal(markup({}).includes('aria-required'), false, `and a ${control} control that is not required says nothing`)
  }
})

/**
 * The accessible name a screen reader says for `node`, as far as these pieces draw one: `aria-labelledby`, `aria-label`,
 * the label of a box that can carry one, or the words of a button.
 */
const nameOf = (node: Element): string => {
  const words = (one: Element | null) => one?.textContent?.trim() ?? ''
  const labelledBy = node.getAttribute('aria-labelledby')
  if (labelledBy) return labelledBy.split(/\s+/).map((id) => words(node.ownerDocument.getElementById(id))).join(' ').trim()
  const label = node.getAttribute('aria-label')?.trim()
  if (label) return label
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(node.tagName)) {
    const id = node.getAttribute('id')
    const own = (id && node.ownerDocument.querySelector(`label[for="${id}"]`)) || node.closest('label')
    if (own && words(own)) return words(own)
  }
  return node.tagName === 'BUTTON' || node.getAttribute('role') === 'button' ? words(node) : ''
}

test('56. every control a form draws has a name a screen reader says: a radio group, its options and a switch as much as a box', async () => {
  const { window } = await import('./dom.ts')
  const named = courses.fields.filter((one) => !['id', 'createdAt', 'updatedAt', 'organization', 'deletedAt'].includes(one.name) && one.kind !== 'join').map((one) => ({ field: one.name }))
  const html = formMarkup({ value: { id: 'x', delivery: 'live', notifications: true }, screen: screenOf(recordPage([{ form: named }])) })
  const page = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const controls = [...page.querySelectorAll('input, textarea, select, button, [role=switch], [role=radiogroup], [role=radio], [role=checkbox], [role=combobox], [role=slider], [role=spinbutton]')]
    .filter((one) => one.getAttribute('type') !== 'hidden' && !one.closest('[aria-hidden=true]')) as unknown as Element[]
  assert.ok(page.querySelector('[role=radiogroup]') && page.querySelector('[role=switch]'), 'the form draws the delivery radio group and the notifications switch')
  const nameless = controls.filter((one) => !nameOf(one)).map((one) => one.outerHTML.slice(0, 160))
  assert.deepEqual(nameless, [], 'and no control is left without a name')
})


test('audit F09: create fields start from their declared literal defaults without changing missing update fields', async () => {
  const { clientFieldOf } = await import('../../../packages/mithaq/src/screen/index.ts')
  const projected = clientFieldOf('active', { kind: 'checkbox', rules: { defaultValue: true } })
  const field = fieldOf({ ...projected, component: 'checkbox', cell: 'checkbox' })
  assert.equal(seedOf([field], null).active, true)
  assert.equal(seedOf([field], { id: 'hidden' }).active, undefined)
  assert.equal(seedOf([field], { active: false }).active, false)
  assert.equal(clientFieldOf('actor', { kind: 'text', rules: { defaultValue: { $user: 'id' } } }).rules.defaultValue, undefined)
  assert.equal(clientFieldOf('secret', { kind: 'text', rules: { defaultValue: 'hidden', providedBy: { create: 'application' } } }).rules.defaultValue, undefined)
})


test('audit F07: a child without a create operation never offers New even with a broad access report', async () => {
  const { createsIn } = await import('../registry/field-values.ts')
  const readonly = { ...courses, operations: courses.operations.filter((operation) => operation.name !== 'create') }
  const report = { create: true, operations: { create: true }, fields: { title: { create: true } } }
  assert.equal(createsIn({ kayan: readonly, report: { ...report, operations: { import: true } } }), false)
  assert.equal(createsIn({ kayan: courses, report }), true)
  assert.equal(createsIn({ kayan: courses, report: { ...report, operations: { create: false, import: true } } }), false)
  assert.equal(createsIn({ kayan: courses, report: { ...report, operations: undefined } }), false)
  assert.equal(createsIn({ kayan: courses, report: { ...report, create: false } }), true)
})


test('audit F05: refusals resolve in the kayan scope with their translated parameters', async () => {
  const { failedWords } = await import('../registry/form-rules.tsx')
  const words: Record<string, string> = { 'sale.invalid.cap': 'Line {line} exceeds {limit}%', 'error.invalid.shared': 'Try {amount}' }
  const copy = { t: (key: string, fallback?: string) => words[key] ?? fallback, locale: 'en' }
  assert.equal(failedWords({ kayan: 'sale', copy, thrown: { data: { key: 'error.invalid.cap', params: { line: 2, limit: 10 } } } }), 'Line 2 exceeds 10%')
  assert.equal(failedWords({ kayan: 'profile', copy, thrown: { data: { key: 'error.invalid.shared', params: { amount: '$5' } } } }), 'Try $5')
})


test('the shared shell labels permitted groups and keeps settings at the bottom', () => {
  const before = state.screen
  state.screen = { ...screen, nav: [
    { path: '/hidden', page: 'list', kayan: 'courses', hidden: true },
    { path: '/courses', page: 'list', kayan: 'courses', group: { name: 'work', label: { en: 'Work' } } },
    { path: '/settings', page: 'edit', kayan: 'settings', group: { name: 'settings', label: { en: 'Settings' }, position: 'bottom' } },
  ] }
  try {
    const html = renderToStaticMarkup(createElement(AppShell, { regions: { primary: null, more: null, header: 'Header', main: 'Body' } }))
    assert.doesNotMatch(html, /href="\/dashboard\/hidden"/)
    assert.match(html, /data-nav-group="work"/)
    assert.match(html, /data-nav-group="settings"/)
    assert.match(html, /data-nav-position="bottom"/)
    assert.match(html, />Work</)
    assert.match(html, />Settings</)
    assert.ok(html.indexOf('data-nav-group="work"') < html.indexOf('data-nav-group="settings"'))
  } finally { state.screen = before }
})


test('a record denied update reads labeled values without a Save control', () => {
  const html = formMarkup({ operations: { update: false } })
  assert.match(html, /<dl[^>]*data-field-value="title"/)
  assert.match(html, /<dt[^>]*>Title<\/dt>/)
  assert.match(html, /<dd[^>]*>Tajweed<\/dd>/)
  assert.doesNotMatch(html, />Save<|>Publish</)
  assert.doesNotMatch(html, /<input[^>]*name="title"/)
})


test('shared page layouts leave width to each host stylesheet', () => {
  const props = { regions: { main: 'Body', side: undefined, danger: undefined }, page: { path: '/courses/:id' } }
  assert.doesNotMatch(renderToStaticMarkup(createElement(RecordPage, props as never)), /max-w-/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(TablePage, props as never)), /max-w-/)
})

test('the shared page header names the breadcrumb, title, primary action and More', async () => {
  const { PageHeader } = await import('../registry/page-header.tsx')
  const html = renderToStaticMarkup(createElement(PageHeader, {
    breadcrumb: { href: '/dashboard/tags', label: 'Tags' },
    title: createElement('h1', {}, 'Tajweed'),
    primary: createElement('button', {}, 'Save'),
    more: createElement('button', {}, 'Archive'),
    t: copy.t,
  }))
  assert.match(html, /href="\/dashboard\/tags"/)
  assert.match(html, /<h1>Tajweed<\/h1>/)
  assert.match(html, />Save</)
  assert.match(html, /aria-label="More actions"/)
})

test('a record header offers no list breadcrumb when the host pruned that destination', () => {
  const before = state.screen
  state.screen = { ...screen, nav: [] }
  try {
    const html = renderToStaticMarkup(createElement(AppShell, { regions: { primary: null, more: null, header: 'Record', main: 'Body' }, page: { path: '/courses/:id' } }))
    assert.doesNotMatch(html, /data-back=/)
  } finally { state.screen = before }
})


test('tenant styling is opt-in and the backoffice keeps its own design', () => {
  const root = new URL('../../../', import.meta.url)
  const tenant = readFileSync(new URL('apps/asas-tanstack/src/styles.css', root), 'utf8')
  const backoffice = readFileSync(new URL('apps/asas-backoffice/src/styles.css', root), 'utf8')
  assert.match(tenant, /@import 'mithaq-admin\/theme.css'/)
  assert.doesNotMatch(backoffice, /mithaq-admin\/theme.css/)
  const html = renderToStaticMarkup(createElement(AppShell, { regions: { primary: null, more: null, header: 'Title', main: 'Body' } }))
  assert.match(html, /--sidebar-width:var\(--app-sidebar-width, calc\(var\(--spacing\) \* 72\)\)/)
  assert.match(html, /lg:px-6/, 'the host keeps its original gutter breakpoint without tenant styling')
})


test('record controls share the header action row with More and keep only the breadcrumb back link', () => {
  const html = formMarkup({ kayan: { ...courses, drafts: { autosave: { interval: 2000 } } }, screen: screenOf(courses.pages.edit!), operations: { update: true, archive: true }, onCancel: () => {}, client: { update: async () => ({}), run: async () => ({}) } })
  assert.match(html, /data-back=""/)
  assert.doesNotMatch(html, />Back to list</)
  assert.match(html, /data-header-actions=""/)
  const actionRow = html.slice(html.indexOf('data-header-actions=""'))
  assert.ok(actionRow.indexOf('data-action-bar=""') < actionRow.indexOf('aria-label="More actions"'))
})


test('hidden destinations leave the shared and template navigation menus', async () => {
  const { NavLinks } = await import('../registry/nav-links.tsx')
  const { ScreenNav } = await import('../../../templates/mithaq/src/ui/screen-nav.tsx')
  const before = state.screen
  state.screen = { ...screen, nav: [
    { path: '/hidden', page: 'list', kayan: 'courses', hidden: true },
    { path: '/tags', page: 'list', kayan: 'tags' },
  ] }
  try {
    for (const Menu of [NavLinks, ScreenNav]) {
      const html = renderToStaticMarkup(createElement(Menu))
      assert.doesNotMatch(html, /href="\/dashboard\/hidden"/)
      assert.match(html, /href="\/dashboard\/tags"/)
    }
  } finally { state.screen = before }
})


test('shared record tabs leave padding and overflow to their host', async () => {
  const { TabStrip } = await import('../registry/tab-strip.tsx')
  const { Tabs, TabsTrigger } = await import('../registry/ui/tabs.tsx')
  const html = renderToStaticMarkup(createElement(Tabs, { defaultValue: 'main' },
    createElement(TabStrip, { value: 'main' }, createElement(TabsTrigger, { value: 'main' }, 'Main'))))
  assert.match(html, /data-tab-strip=""/)
  const strip = html.match(/<div[^>]*data-tab-strip=""[^>]*>/)![0]
  assert.doesNotMatch(strip, /data-\[variant=line\]:pb-2|overflow-x-auto|overflow-y-hidden/)
})


test('phone record actions have a fixed base layout and widen into the header', async () => {
  const { FormActions } = await import('../registry/form-actions.tsx')
  const html = renderToStaticMarkup(createElement(FormActions, {
    header: true, t: copy.t, locale: 'en', busy: false, dirty: true,
    updating: false, viewing: false, drafts: false, formId: 'phone-form',
    onAsk: () => {}, onSaveDraft: () => {},
  }))
  const bar = /data-action-bar="" class="([^"]+)"/.exec(html)?.[1]?.split(' ')
  assert.ok(bar?.includes('fixed'), 'the phone action bar is the base layout')
  assert.ok(bar?.includes('sm:contents'), 'the wider header owns its actions')
})


test('backoffice buttons start with a phone target and keep the host desktop size', async () => {
  const { Button } = await import('../../../apps/asas-backoffice/src/components/ui/button.tsx')
  const html = renderToStaticMarkup(createElement(Button, {}, 'Sign in'))
  const classes = /class="([^"]+)"/.exec(html)![1]!.split(' ')
  assert.ok(classes.includes('min-h-11'))
  assert.ok(classes.includes('h-10'))
  assert.ok(classes.includes('sm:min-h-0'))
  assert.ok(classes.includes('rounded-none'), 'the backoffice keeps its own design')
})


test('phone radio options give their wrapping label a full touch target', async () => {
  const { RadioControl } = await import('../registry/choice-control.tsx')
  const html = renderToStaticMarkup(createElement(RadioControl, {
    id: 'delivery', field: fieldOf({ name: 'delivery', kind: 'text', options: [{ value: 'live', label: { en: 'Live' } }] }),
    kayan: courses, value: 'live', values: {}, setValue: () => {}, onChange: () => {}, readOnly: false, t: copy.t, locale: 'en',
  }))
  const label = /<label[^>]+class="([^"]+)"/.exec(html)![1]!.split(' ')
  assert.ok(label.includes('min-h-11'))
  assert.ok(label.includes('sm:min-h-0'))
})

test('the staff backoffice link centres its phone icon and restores each desktop padding', async () => {
  const { BackofficeLink } = await import('../../../templates/mithaq/src/ui/app-shell.tsx')
  const before = state.user
  state.user = { ...before, screens: [{ name: 'backoffice', path: 'http://127.0.0.1:55822/backoffice' }] }
  try {
    const html = renderToStaticMarkup(createElement(BackofficeLink))
    const classes = /class="([^"]+)"/.exec(html)![1]!.split(' ')
    for (const token of ['px-0', 'has-data-[icon=inline-end]:pr-0', 'sm:px-2.5', 'sm:has-data-[icon=inline-end]:pr-2', 'xl:pl-3', 'xl:pr-2']) assert.ok(classes.includes(token), token)
    assert.ok(!classes.includes('xl:px-3'))
  } finally { state.user = before }
})
