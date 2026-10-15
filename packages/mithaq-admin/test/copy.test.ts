// The JSX loader and the DOM are imported first for their side effects; registry files load
// through dynamic import after both.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { act, createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { asas } from 'asas'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import './tsx.ts'
import { click, fire, mount, window } from './dom.ts'

const { createRoot } = await import('react-dom/client')
const { counted, formatDate } = await import('../registry/format.tsx')
const { localesOf } = await import('../registry/refusal.ts')
const { newTitleOf } = await import('../registry/copy.ts')
const { withAddOns } = await import('./with-add-ons.ts')
// The template's language holds rich text and files, so its screens draw with both add-ons spread in, as its apps do.
const defaultComponents = withAddOns((await import('../registry/default-components.tsx')).defaultComponents, (await import('../registry/rich-text.tsx')).richTextComponents, (await import('../registry/upload.tsx')).uploadComponents)
const { ComponentsProvider } = await import('../registry/components.tsx')
const staticMarkup = (element: ReactElement) => renderToStaticMarkup(createElement(ComponentsProvider, { components: defaultComponents }, element))
const { Form } = await import('../registry/form.tsx')
const { refusalOf, refusalWords } = await import('../registry/form-rules.tsx')
const { LeafControl } = await import('../registry/leaf-control.tsx')
const { NodeButton, pageButtonOf } = await import('../registry/node-buttons.tsx')
const { RecordFrame } = await import('../registry/record-frame.tsx')
const { rowWarning } = await import('../registry/row-title.tsx')
const { OperationButton } = await import('../registry/operation-button.tsx')
const { RichTextViewer } = await import('../registry/rich-text.tsx')
const { UploadDialog, typeName, typeNames } = await import('../registry/upload.tsx')
const { List } = await import('../registry/list.tsx')
const { RecordPage } = await import('../../../templates/mithaq/src/ui/record-page.tsx')
const { AppShell } = await import('../../../templates/mithaq/src/ui/app-shell.tsx')
const { scopes } = await import('../../../apps/asas-tanstack/src/copy.ts')

const screen = asas.targets.dashboard.client
const courses = screen.kayan.courses!
const tags = screen.kayan.tags!
const roles = screen.kayan.roles!
const settings = screen.kayan.settings!

const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
const copyOf = (locale: 'en' | 'ar') => ({ t: translator(locale), locale, locales: ['ar', 'en'] as const })

const stateOf = (locale: 'en' | 'ar', kayan = courses): ScreenState => ({
  t: translator(locale),
  locale,
  dir: locale === 'ar' ? 'rtl' : 'ltr',
  screen,
  access: {},
  user: { name: 'Admin', email: 'admin@example.com' },
  client: async () => ({}),
  kayan,
  record: null,
})
const render = (element: ReactElement, locale: 'en' | 'ar' = 'en', kayan = courses) => staticMarkup(createElement(ScreenContext, { value: stateOf(locale, kayan) }, element))
const refs = { [screen.layouts.app!]: AppShell, [screen.layouts.record!]: RecordPage }
const client = { create: async () => ({}), update: async () => ({}), delete: async () => ({}) }

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

let mounted: ReturnType<typeof createRoot> | undefined
const mountIn = async (element: ReactElement, locale: 'en' | 'ar' = 'en') => {
  const previous = mounted
  if (previous) await act(async () => previous.unmount())
  const host = mount()
  const root = createRoot(host)
  mounted = root
  await act(async () => root.render(createElement(ScreenContext, { value: stateOf(locale) }, createElement(ComponentsProvider, { components: defaultComponents }, element))))
  await act(async () => sleep(20))
  return host
}

test('217a. a time of day reads on the 24-hour clock in every locale, as the form\'s time box writes it', () => {
  const evening = new Date(2026, 9, 8, 21, 0)
  for (const locale of ['en', 'ar']) {
    const shown = formatDate({ value: evening, locale })!
    assert.ok(shown.includes('21:00'), `${locale}: ${shown}`)
    assert.equal(/PM|م/.test(shown), false, `${locale} says no half of the day: ${shown}`)
  }
})

test('217b. a counting sentence takes its locale\'s own plural form, so one row is never "1 rows" and the Arabic number is not last', () => {
  const en = copyOf('en')
  const ar = copyOf('ar')
  const key = 'admin.bulkWarning'
  const fallback = '{count}'
  assert.equal(counted({ ...en, key, count: 1, fallback }), '{plural} you ticked: 1. This applies to it.')
  assert.equal(counted({ ...en, key, count: 3, fallback }), '{plural} you ticked: 3. This applies to each of them.')
  assert.equal(counted({ ...ar, key, count: 1, fallback }), scopes.admin!.bulkWarning_one!.ar)
  assert.equal(counted({ ...ar, key, count: 2, fallback }), scopes.admin!.bulkWarning_two!.ar)
  for (const count of [3, 11, 100]) {
    const said = counted({ ...ar, key, count, fallback })
    assert.ok(said.includes(count.toLocaleString('ar')), `${count}: ${said}`)
    assert.equal(/\d\.$/.test(said), false, `the number sits before the full stop's word, not beside it: ${said}`)
  }
  assert.equal(counted({ t: () => undefined, locale: 'en', key, count: 4, fallback: 'Four is {count}' }), 'Four is 4', 'a key nothing answers is the fallback')
})

test('217c. an operation\'s banner names the fields it refused, by their labels and counted, in either locale, and a form\'s summary lists each by its label and sentence', () => {
  for (const locale of ['en', 'ar'] as const) {
    const copy = copyOf(locale)
    assert.equal(refusalWords({ shown: 'error.invalid.value', labels: ['Title'], copy }), scopes.error!['invalid.fields_one']![locale]!.replace('{fields}', 'Title'))
    assert.ok(refusalWords({ shown: 'error.invalid.value', labels: ['Title', 'Fee', 'Code'], copy }).startsWith(scopes.error!['invalid.fields_other']![locale]!.replace('{fields}', '')), locale)
    assert.equal(refusalWords({ shown: 'error.invalid.value', labels: [], copy }), scopes.error!['invalid.value']![locale], 'a refusal naming no field keeps its own sentence')
    assert.equal(refusalWords({ shown: 'error.forbidden.update', labels: ['Title'], copy }), scopes.error!['forbidden.update']![locale], 'and so does any other refusal')
  }
  const html = staticMarkup(createElement(Form, { kayan: courses, client, value: { id: 'c1', title: 'Tajweed' }, ...copyOf('en'), onDone: () => {}, error: { data: { key: 'error.invalid.value', params: { issues: [{ path: 'title', message: 'courses.title.required' }] } } } }))
  assert.ok(textOf(html).includes('Check these fields: Title: This field is required.'), 'the form lists it in its summary')
  assert.equal(textOf(html).includes('That value will not do.'), false, 'in place of the sentence that names nothing')
})

test('217d. every form takes no browser validation, so the browser\'s own bubble never stands in for the page\'s words', () => {
  const html = staticMarkup(createElement(Form, { kayan: settings, client, value: null, ...copyOf('ar'), onDone: () => {} }))
  assert.ok(/<form[^>]*noValidate/i.test(html), html.slice(0, 300))
})

test('217e. an edit page is titled by its record, a create page says it makes one, and a kayan with no words of its own for that is titled by the verb and its kind', () => {
  const edit = render(createElement(Form, { kayan: courses, screen: { refs, kayan: courses, page: courses.pages.edit as never }, client, value: { id: 'c1', title: 'Tajweed' }, ...copyOf('en'), onDone: () => {} }))
  assert.equal(/<h1[^>]*>Tajweed<\/h1>/.test(edit), true, 'the edit page names its course')
  for (const locale of ['en', 'ar'] as const) {
    const create = render(createElement(Form, { kayan: courses, screen: { refs, kayan: courses, page: courses.pages.create as never }, client, value: null, ...copyOf(locale), onDone: () => {} }), locale)
    assert.equal(create.includes(`>${scopes.courses!.new![locale]}</h1>`), true, `${locale}: the create page is titled as new`)
  }
  assert.equal(newTitleOf({ kayan: { name: 'nothing' }, copy: copyOf('en') }), 'Create nothing', 'with no `new` of its own, the verb and the kind')
  assert.equal(newTitleOf({ kayan: tags, copy: copyOf('ar') }), scopes.tags!.new!.ar)
})

test('217f. the new tag sheet draws its one box under its title alone, with no second heading saying "Tag"', () => {
  const page = tags.pages.create as unknown as { page: { main: unknown[] } }
  assert.equal(JSON.stringify(page.page.main).includes('"section"'), false, JSON.stringify(page.page.main))
})

test('217g. the danger zone names the record\'s kind, never "row", and the roles page says what a delete does to the members who hold it', () => {
  for (const locale of ['en', 'ar'] as const) {
    const said = (kayan: typeof courses) => textOf(render(createElement(RecordPage, { regions: { main: null, side: null, danger: createElement('button', null, 'x') }, page: { path: '/x', component: 'x' } } as never), locale, kayan))
    assert.ok(said(courses).includes(scopes.courses!.dangerZoneWarning![locale]!), `${locale} courses`)
    assert.ok(said(roles).includes(scopes.roles!.dangerZoneWarning![locale]!), `${locale} roles`)
    assert.equal(/\brow\b|الصف/.test(said(courses)), false, `${locale}: no "row"`)
  }
  assert.ok(scopes.roles!.dangerZoneWarning!.en!.includes('member'), 'the roles sentence speaks of the members who hold the role')
  const unnamed = { ...courses, name: 'nothing' }
  assert.ok(textOf(render(createElement(RecordPage, { regions: { main: null, side: null, danger: 'x' }, page: { path: '/x', component: 'x' } } as never), 'en', unnamed)).includes('These actions change this nothing for everyone.'), 'a kayan with no sentence of its own has its kind put in the shared one')
})

test('217h. a refused localized field marks the box its path names, or the empty box of a required one, and leaves its sibling alone', () => {
  assert.deepEqual({ ...localesOf({ data: { params: { issues: [{ path: 'title.ar', message: 'm' }, { path: 'fee', message: 'm' }] } } }) }, { title: ['ar'] })
  assert.deepEqual({ ...localesOf({ data: { key: 'error.invalid.value', params: { issues: [{ path: 'name.ar', message: 'tags.name.required' }] } } }) }, { name: ['ar'] })
  const field = { name: 'alt', kind: 'text', component: 'text', cell: 'text', rules: { required: true, localized: true } } as never
  const leaf = (props: Record<string, unknown>) =>
    staticMarkup(createElement(LeafControl, { field, kayan: courses, copy: copyOf('en'), value: { en: 'A cover', ar: '' }, values: {}, setValue: () => {}, onChange: () => {}, readOnly: false, error: 'Required', ...props } as never))
  const invalid = (html: string) => [...html.matchAll(/<input[^>]*\sid="([^"]+)"[^>]*>/g)].filter((hit) => hit[0].includes('aria-invalid="true"')).map((hit) => hit[1])
  assert.deepEqual(invalid(leaf({ invalidLocales: ['ar'] })), ['courses-alt-ar'], 'the path names the Arabic box')
  assert.deepEqual(invalid(leaf({})), ['courses-alt-ar'], 'a refusal drawn before a save marks the empty box of a required field')
  assert.deepEqual(invalid(leaf({ value: { en: 'x'.repeat(5), ar: 'y' } })).sort(), ['courses-alt', 'courses-alt-ar'], 'any other refusal with no path marks both')
  const html = leaf({})
  assert.ok(/<label[^>]*for="courses-alt-ar"/.test(html), 'and the Arabic box has a label of its own')
})

test('217i. a settings page draws its global\'s sentence, and the maintenance switch says what it does', () => {
  const html = render(createElement(Form, { kayan: settings, screen: { refs, kayan: settings, page: settings.pages.settings as never }, client, value: { id: 's1', siteTitle: 'Asas' }, ...copyOf('ar'), onDone: () => {} }), 'ar', settings)
  assert.ok(html.includes(settings.description!.ar!), 'the sentence under its title')
  const maintenance = settings.fields.find((one) => one.name === 'maintenance')!
  assert.ok(maintenance.description?.ar && html.includes(maintenance.description.ar), 'and the switch\'s help text under it')
})

test('217j. the accepted types read as names, never as raw MIME types, each named once and a vendor type short', () => {
  assert.deepEqual(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'image/*'].map(typeName), ['PNG', 'JPEG', 'WEBP', 'SVG', 'PDF', 'image/*'])
  assert.deepEqual(typeNames(['image/svg+xml', 'image/svg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.oasis.opendocument.text', 'image/x-icon']), ['SVG', 'DOCX', 'TEXT', 'ICON'])
})

test('217k. a sheet\'s and a dialog\'s close button is the registry\'s own, named in the page\'s language, and the host hands it the copy', async () => {
  for (const mode of ['sheet', 'dialog'] as const) {
    await mountIn(createElement(RecordFrame, { mode, title: 'وسم', closeLabel: 'إغلاق', onClose: () => {} }, createElement('p', null, 'x')), 'ar')
    const closes = [...window.document.querySelectorAll(`[data-slot="${mode}-close"]`)]
    assert.equal(closes.length, 1, `${mode}: one close button, the primitive's own English one not drawn`)
    assert.equal(closes[0]?.textContent?.trim(), 'إغلاق', mode)
    assert.equal(window.document.querySelector(`[data-slot="${mode}-content"]`)?.textContent?.includes('Close'), false, `${mode}: no English`)
  }
  // The host passes the translated close label, so its source is read.
  const host = readFileSync(new URL('../registry/host/screens.tsx', import.meta.url), 'utf8')
  assert.ok(/<RecordFrame[^>]*closeLabel=\{t\('admin\.close', 'Close'\)/.test(host), 'the host hands RecordFrame the translated close')
  assert.equal(scopes.admin!.close!.ar, 'إغلاق')
})

test('217l. a confirm behind a button with no boxes says what it runs on before its own body, so a bulk delete gives its count', async () => {
  const node = { label: { en: 'Delete' }, confirm: { title: { en: 'Delete the ticked courses?' }, body: { en: 'This cannot be undone.' } } }
  const host = await mountIn(createElement(NodeButton, { node: node as never, copy: copyOf('en'), busy: false, run: () => {}, description: 'Courses you ticked: 3. This applies to each of them.' }))
  await act(async () => click(host.querySelector('button')!))
  const said = window.document.querySelector('[data-slot="alert-dialog-description"]')?.textContent
  assert.equal(said, 'Courses you ticked: 3. This applies to each of them. This cannot be undone.')
})

test('217m. each block of a rich text value takes its own direction, so English inside an Arabic page ends its sentence on its own side', async () => {
  const value = {
    root: {
      type: 'root', direction: 'rtl', format: '', indent: 0, version: 1,
      children: [
        { type: 'paragraph', direction: 'rtl', format: '', indent: 0, version: 1, textFormat: 0, textStyle: '', children: [{ type: 'text', text: 'Hello.', detail: 0, format: 0, mode: 'normal', style: '', version: 1 }] },
        { type: 'paragraph', direction: null, format: '', indent: 0, version: 1, textFormat: 0, textStyle: '', children: [{ type: 'text', text: 'مرحبا.', detail: 0, format: 0, mode: 'normal', style: '', version: 1 }] },
      ],
    },
  }
  const host = await mountIn(createElement(RichTextViewer, { value, direction: 'rtl', t: translator('ar') }), 'ar')
  const blocks = [...host.querySelectorAll('[data-rich-text-view] p')]
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks.map((one) => one.getAttribute('dir')), ['auto', 'auto'])
  assert.equal(host.querySelector('[data-rich-text-view]')?.getAttribute('dir'), 'rtl', 'inside a box that holds the page\'s direction')
})

test('217n. every key this ticket added carries one string per locale', () => {
  const source = readFileSync(new URL('../../../apps/asas-tanstack/src/copy.ts', import.meta.url), 'utf8')
  for (const [scope, key] of [
    ['admin', 'close'], ['admin', 'createTitle'], ['admin', 'rowNamedWarning'], ['admin', 'upload.noFile'], ['admin', 'dangerZoneWarning'],
    ['admin', 'bulkWarning_one'], ['admin', 'bulkWarning_two'], ['admin', 'bulkWarning_few'], ['admin', 'bulkWarning_many'], ['admin', 'bulkWarning_other'],
    ['error', 'invalid.fields_one'], ['error', 'invalid.fields_two'], ['error', 'invalid.fields_other'],
    ['auth', 'invalidCredentials'], ['auth', 'emailNotVerified'], ['auth', 'banned'], ['auth', 'userExists'], ['auth', 'noMailer'],
    ['roles', 'new'], ['roles', 'name.description'], ['roles', 'dangerZoneWarning'], ['courses', 'dangerZoneWarning'],
    ['sessions', 'new'], ['enrollments', 'new'], ['tags', 'new'], ['media', 'new'],
  ] as const) {
    const entry = scopes[scope]?.[key]
    assert.ok(entry?.en && entry.ar && entry.en !== entry.ar, `${scope}.${key}`)
  }
  assert.equal(/[ًٌٍَُِّْ]/.test(['forgotPasswordInstructions', 'emailSent', 'checkYourEmail', 'tokenInvalid', 'alreadySignedIn', 'backToSignIn'].map((key) => scopes.auth![key]!.ar).join('')), false, 'the forgot and reset pages carry no vowel marks, as sign-in does')
  assert.equal(source.includes('ارسال'), false, 'and no "send" lost its hamza')
})

test('217p. the edit page\'s own buttons name the record they run on, and an operation\'s dialog takes no browser validation', async () => {
  const archive = pageButtonOf({ kayan: courses, node: { button: 'archive', label: { en: 'Archive', ar: 'أرشفة' }, fields: ['reason'] } as never, allowed: { archive: true } })
  assert.ok(archive, 'the kayan declares the archive')
  const host = await mountIn(createElement(Form, {
    kayan: courses,
    screen: { refs, kayan: courses, page: courses.pages.edit as never },
    client: { ...client, run: async () => ({}) },
    operations: { archive: true },
    value: { id: 'c1', title: 'Tajweed', archived: false },
    ...copyOf('en'),
    onDone: () => {},
  }))
  const button = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Archive')
  assert.ok(button, 'the archive button is drawn')
  await act(async () => click(button!))
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')
  assert.ok(dialog?.textContent?.includes('This archives \u2068Tajweed\u2069.'), dialog?.textContent ?? '')
  assert.equal(/\brow\b/.test(dialog?.textContent ?? ''), false, 'never "row"')
  assert.equal(dialog?.querySelector('form')?.hasAttribute('novalidate'), true, 'and its form leaves validation to the page')
  await mountIn(createElement(OperationButton, { open: true, busy: false, copy: copyOf('ar'), inputOf: (values: Record<string, unknown>) => values, kayan: courses, operation: archive!, run: async () => true }), 'ar')
  assert.equal(window.document.querySelector('[data-slot="alert-dialog-content"] form')?.hasAttribute('novalidate'), true)
})

test('217q. every kayan\'s danger zone sentence and every mapped provider code carry both locales, and differ', async () => {
  for (const scope of ['courses', 'sessions', 'enrollments', 'tags', 'media', 'roles']) {
    const entry = scopes[scope]!.dangerZoneWarning
    assert.ok(entry?.en && entry.ar && entry.en !== entry.ar, scope)
    assert.equal(/\brow\b/.test(entry!.en!), false, `${scope}: no "row"`)
  }
  const { refusalKey } = await import('../../../apps/asas-tanstack/src/copy.ts')
  for (const [code, key] of [
    ['INVALID_EMAIL_OR_PASSWORD', 'auth.invalidCredentials'],
    ['EMAIL_NOT_VERIFIED', 'auth.emailNotVerified'],
    ['BANNED_USER', 'auth.banned'],
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'auth.userExists'],
    ['INVITATION_NOT_FOUND', 'auth.invitationGone'],
    ['YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', 'auth.invitationNotYours'],
    ['INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION', 'auth.invitationInviterGone'],
    ['USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', 'dashboard.inviteAlreadyMember'],
    ['USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION', 'dashboard.inviteAlreadyInvited'],
    ['YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER', 'dashboard.removeLastOwner'],
    ['RESET_PASSWORD_DISABLED', 'auth.resetDisabled'],
    ['INVALID_TOKEN', 'auth.tokenInvalid'],
  ] as const) {
    assert.equal(refusalKey(400, code), key, code)
    for (const locale of ['en', 'ar']) assert.ok(translator(locale as 'en')(key), `${key} in ${locale}`)
  }
  assert.equal(refusalKey(429, 'INVALID_TOKEN'), 'auth.tooManyRequests', 'a rate limit wins over any code')
  assert.equal(refusalKey(400, 'toString'), undefined, 'and a code named for a key of Object.prototype answers nothing')
  // Two organizations may share a name, so a taken one has no sentence.
  assert.equal(refusalKey(400, 'ORGANIZATION_ALREADY_EXISTS'), undefined)
})

test('217r. a global with no saved row keeps its own name as its title, and a form checks an email\'s shape as the server does', () => {
  const html = render(createElement(Form, { kayan: settings, screen: { refs, kayan: settings, page: settings.pages.settings as never }, client, value: null, ...copyOf('en'), onDone: () => {} }), 'en', settings)
  assert.ok(/<h1[^>]*>Settings<\/h1>/.test(html), 'Settings, never "Create Settings"')
  const checked = (contactEmail: string) => refusalOf({ kayan: 'settings', fields: settings.fields.filter((one) => one.name === 'contactEmail'), values: { contactEmail } })
  assert.deepEqual(checked('not-an-address')?.data.params.issues, [{ path: 'contactEmail', message: 'settings.contactEmail.invalid' }], 'an address the server\'s email kind refuses is refused here, in the key it would send')
  assert.equal(checked('someone@example.com'), undefined, 'and one it takes is not')
})

test('236. a form trims a field under `trim` before it calls it empty, as the server does, so a title of spaces is refused here in either locale', () => {
  const siteTitle = settings.fields.filter((one) => one.name === 'siteTitle')
  const checked = (value: string) => refusalOf({ kayan: 'settings', fields: siteTitle, values: { siteTitle: value } })?.data.params.issues
  assert.deepEqual(checked(' \t\u3000 '), [{ path: 'siteTitle', message: 'settings.siteTitle.required' }], 'spaces alone are empty once trimmed')
  assert.equal(checked('  Madrasa  '), undefined, 'and a value with spaces around it is not')
  assert.deepEqual(checked(` ${'a'.repeat(120)} `), undefined, 'the length is judged on the trimmed value, as the server judges it')
  const title = courses.fields.filter((one) => one.name === 'title')
  assert.deepEqual(refusalOf({ kayan: 'courses', fields: title, values: { title: '   ' } })?.data.params.issues, [{ path: 'title', message: 'courses.title.required' }])
  // `uppercase` and `lowercase` rewrite the value before it is judged, on the server's pipe.
  const cased = (rules: Record<string, unknown>, value: string) =>
    refusalOf({ kayan: 'courses', fields: [{ ...title[0]!, rules, options: [{ value: 'ABC', label: { en: 'ABC', ar: 'ABC' } }] } as never], values: { title: value } })?.data.params.issues
  assert.equal(cased({ uppercase: true, trim: true }, ' abc '), undefined, 'an option written in lower case is the upper-case one the server stores')
  assert.deepEqual(cased({ lowercase: true }, 'ABC'), [{ path: 'title', message: 'courses.title.invalid' }], 'and under `lowercase` the same option is a value the server would refuse')
  const en = translator('en')('settings.siteTitle.required')
  const ar = translator('ar')('settings.siteTitle.required')
  assert.equal(typeof en === 'string' && en.length > 0 && typeof ar === 'string' && ar.length > 0 && en !== ar, true, 'and the refusal reads in English and in Arabic')
})

test('220k. the rename\'s slug sentence and the organization\'s two required refusals each read in both locales, and differently in each', () => {
  for (const key of ['backoffice.slugPattern', 'organization.name.required', 'organization.slug.required']) {
    const en = translator('en')(key)
    const ar = translator('ar')(key)
    assert.equal(typeof en === 'string' && en.length > 0, true, `${key} has an English sentence`)
    assert.equal(typeof ar === 'string' && ar.length > 0, true, `${key} has an Arabic sentence`)
    assert.notEqual(en, ar, `${key} is not the same words in both`)
  }
})

const listScreen = () => ({ refs: refs as never, kayan: courses, page: courses.pages.list as never })
const pageOf = (docs: Record<string, unknown>[]) => ({ docs, hasNextPage: false, hasPrevPage: false, limit: 10, nextPage: null, page: 1, prevPage: null, totalDocs: docs.length, totalPages: 1 })

test('232a. ticking a row on a phone draws the bulk bar fixed to the bottom, the dialog names the plural and takes focus on a coarse pointer, a yes-or-no box can be left as is or cleared, and a landed bulk says what it did', async () => {
  const calls: Record<string, unknown>[] = []
  const host = await mountIn(createElement(List, {
    kayan: courses, page: pageOf([{ id: 'c1', title: 'Tajweed' }, { id: 'c2', title: 'Nahw' }]), query: {}, ...copyOf('en'),
    onQuery: () => {}, href: (id: string) => `/courses/${id}`, newHref: '/courses/new', screen: listScreen(),
    operations: { updateMany: true }, writes: () => true,
    run: async (_operation: string, input: Record<string, unknown>) => (calls.push(input), {}),
  }))
  const bar = () => host.querySelector('[data-mithaq-bulk-bar]')!.className
  assert.equal(bar().includes('max-sm:fixed'), false, 'nothing ticked takes no room')
  await act(async () => click(host.querySelector('[role="checkbox"]')!))
  assert.equal(bar().includes('max-sm:fixed') && bar().includes('max-sm:bottom-[var(--action-bar-height,0px)]'), true, 'a tick draws the bar over the bottom of a phone, on the form\'s own bar where there is one, not in the toolbar above the table')
  const media = (globalThis as { matchMedia?: unknown }).matchMedia
  ;(globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({ matches: query === '(pointer: coarse)' })
  try {
    await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Update')!))
    await act(async () => sleep(50))
  } finally {
    ;(globalThis as { matchMedia?: unknown }).matchMedia = media
  }
  const dialog = window.document.querySelector('[data-slot="alert-dialog-content"]')!
  assert.ok(dialog.textContent?.includes('Courses you ticked: 2. This applies to each of them.'), dialog.textContent ?? '')
  assert.equal(window.document.activeElement === dialog, true, `a tap reported as a click on a phone focuses the dialog, not the fee box: ${window.document.activeElement?.id}`)
  const notified = () => window.document.querySelector('#courses-updateMany-notifications')!
  assert.equal(notified().textContent, 'Leave as is', 'the box starts at leaving every row as it is')
  await act(async () => click(notified() as unknown as Element))
  await act(async () => click([...window.document.querySelectorAll('[data-slot="select-item"]')].find((one) => one.textContent === 'No')! as unknown as Element))
  assert.equal(notified().textContent, 'No', 'and says the value it will write')
  await act(async () => fire(dialog.querySelector('form')! as unknown as Element, 'submit'))
  await act(async () => sleep(20))
  assert.deepEqual(calls, [{ where: { id: { in: ['c1', 'c2'] } }, data: { notifications: false } }], 'clearing it sends false, which an untouched box never did')
  const said = host.querySelector('[data-mithaq-done]')
  assert.equal(said?.textContent, 'Courses done: 2.', 'a landed bulk says what it did')
  assert.equal(said?.getAttribute('aria-live'), 'polite', 'in the count\'s own live region')
  const region = host.querySelector('[data-mithaq-bulk-bar]')!
  assert.deepEqual([region.getAttribute('role'), region.getAttribute('aria-label')], ['region', 'Ticked rows'], 'inside a bar named for what it holds')
  assert.equal(bar().includes('max-sm:flex-nowrap') && bar().includes('max-sm:overflow-x-auto'), true, 'one row that scrolls sideways, so the room kept for it is its height')
  await act(async () => click(host.querySelector('[role="checkbox"]')!))
  assert.equal(host.querySelector('[data-mithaq-done]'), null, 'and a new tick takes the result away at once')
})

test('232b. a row\'s menu is named for its row, an empty list speaks in its kayan\'s words, and a searched path across a relationship names the relationship too', () => {
  const html = render(createElement(List, {
    kayan: courses, page: pageOf([{ id: 'c1', title: 'Tajweed' }]), query: {}, ...copyOf('en'),
    onQuery: () => {}, href: (id: string) => `/courses/${id}`, newHref: '/courses/new', operations: { update: true },
  }))
  assert.ok(html.includes('aria-label="Actions for \u2068Tajweed\u2069"'), /aria-label="[^"]*"[^>]*data-row-menu/.exec(html)?.[0])
  const empty = (kayan: typeof courses, locale: 'en' | 'ar') => textOf(render(createElement(List, { kayan, page: pageOf([]), query: {}, ...copyOf(locale), onQuery: () => {}, href: () => '#', newHref: '' }), locale, kayan))
  assert.ok(empty(tags, 'en').includes('No tags yet.') && empty(tags, 'ar').includes('لا توجد وسوم بعد.'), 'tags say no tags')
  const sessions = screen.kayan.sessions!
  const node = { columns: [{ field: 'venue' }], search: ['course.title', 'details'] } as never
  const box = (locale: 'en' | 'ar') => /placeholder="([^"]*)"/.exec(render(createElement(List, { kayan: sessions, client: Object.values(screen.kayan), node, page: pageOf([]), query: {}, ...copyOf(locale), onQuery: () => {}, href: () => '#', newHref: '' }), locale, sessions))?.[1]
  assert.equal(box('en'), 'Course Title or Details')
  assert.equal(box('ar'), 'العنوان (الدورة) أو التفاصيل')
})

test('232c. Upload with no file chosen marks the file box and says to choose one, in the page\'s language', async () => {
  await mountIn(createElement(UploadDialog, { open: true, onOpenChange: () => {}, target: screen.kayan.media!, client: async () => ({}), ...copyOf('ar'), onDone: () => {} }), 'ar')
  const dialog = window.document.querySelector('[data-upload-dialog="media"]')!
  const input = () => dialog.querySelector('input[type="file"]')!
  assert.equal(input().getAttribute('aria-required'), 'true', 'the box says it is required before anything is pressed')
  const send = [...dialog.querySelectorAll('button')].find((one) => one.textContent === 'رفع')!
  assert.equal(send.hasAttribute('disabled'), false, 'Upload is pressable with no file, so it can answer')
  await act(async () => click(send as unknown as Element))
  assert.equal(input().getAttribute('aria-invalid'), 'true')
  assert.equal(window.document.getElementById(input().getAttribute('aria-describedby')!)?.textContent, 'اختر ملفا أولا.', 'and says so under it, which the box points at')
})

test('232d. a row\'s sentence isolates the name it puts in, so an email in Arabic keeps its order', () => {
  const ar = copyOf('ar')
  const said = rowWarning({ kayan: courses, row: { id: 'c1', title: 'audit-1@example.com' }, copy: ar })
  assert.equal(said, 'ينطبق هذا على \u2068audit-1@example.com\u2069.')
  assert.equal(rowWarning({ kayan: courses, row: { id: 'c1', title: 'Tajweed' }, operation: 'archive', copy: copyOf('en') }), 'This archives \u2068Tajweed\u2069.', 'and an operation that writes its own sentence says it in its verb')
})

test('232e. a list thumbnail is decoded off the main thread at its drawn size, and counts its width when a table sizes its column', async () => {
  const { FileThumb } = await import('../registry/upload.tsx')
  const html = staticMarkup(createElement(FileThumb, { row: { id: 'm1', filename: 'cover.png', thumbnailURL: '/api/media/file/m1' }, t: translator('en'), locale: 'en', size: 'xs' }))
  const img = /<img[^>]*>/.exec(html)?.[0] ?? ''
  assert.match(img, /decoding="async"/)
  assert.match(img, /width="32"/)
  assert.match(img, /height="32"/)
  assert.match(img, /class="[^"]*\bmax-w-none\b[^"]*"/, 'and no max-width of 100%, which counted it as no width')
  assert.match(img, /class="[^"]*\bshrink-0\b[^"]*"/)
})
