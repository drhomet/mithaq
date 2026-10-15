import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { asas } from 'asas'
import { FormContext, ScreenContext, type ScreenState } from 'mithaq/admin/react'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { click, mount, type } from '../../../packages/mithaq-admin/test/dom.ts'
import { dirOf, translator, type Locale } from './copy.ts'

const { createRoot } = await import('react-dom/client')
const { Activity } = await import('../../../templates/mithaq/src/ui/activity.tsx')
const { ComponentsProvider } = await import('mithaq-admin/components.tsx')
const { defaultComponents } = await import('mithaq-admin/default-components.tsx')

const screen = asas.targets.dashboard.client
const courses = screen.kayan.courses!
const change = (changes: Record<string, [unknown, unknown]>) =>
  Object.fromEntries(Object.entries(changes).map(([name, [from, to]]) => [name, { from, to }]))
const created = { id: 'e1', createdAt: new Date(Date.now() - 86_400_000).toISOString(), operation: 'create', actor: null, changes: change({ id: [null, 'c1'], title: [null, 'Tajweed'], notifications: [null, false], summary: [null, null] }) }
const pages: Record<number, Record<string, unknown>[]> = {
  1: [
    { id: 'e3', createdAt: new Date(Date.now() - 60_000).toISOString(), operation: 'archive', actor: 'u2', impersonatedBy: 'u1', changes: change({ archived: [false, true], updatedAt: ['2026-09-01', '2026-09-02'] }) },
    { id: 'e2', createdAt: new Date(Date.now() - 3_600_000).toISOString(), operation: 'update', actor: 'u2', changes: change({ fee: [5, 7], currency: ['SAR', 'USD'], tenant: ['o1', 'o2'] }) },
    created,
  ],
  2: [{ id: 'e0', createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), operation: 'update', actor: 'u2', changes: change({ fee: [3, 5] }) }],
}

const draw = async (locale: Locale, viewer?: string) => {
  const asked: { kayan: string; input: Record<string, unknown> }[] = []
  const client: ScreenState['client'] = async ({ kayan, input }) => {
    asked.push({ kayan, input })
    if (kayan === 'auditLog') {
      const page = input.page as number
      return { docs: pages[page] ?? [], hasNextPage: page === 1, nextPage: page === 1 ? 2 : null }
    }
      if (kayan === 'user') return { docs: [{ id: 'u1', name: 'Asma $&' }], hasNextPage: false, nextPage: null }
    return { docs: [], hasNextPage: false, nextPage: null }
  }
  const state: ScreenState = {
    t: translator(locale),
    locale,
    dir: dirOf(locale),
    screen,
    access: {},
    user: { ...(viewer && { id: viewer }), name: 'Admin', email: 'admin@example.com' },
    client,
    kayan: courses,
    record: { id: 'c1', title: 'Tajweed' },
  }
  const host = mount()
  const root = createRoot(host)
  // The form the panel sits beside, whose `saves` counts every save that landed, a draft's among them.
  const redraw = async (record: Record<string, unknown>, saves = 0) => {
    const form = { getData: () => record, setValue: () => {}, disabled: false, saves }
    await act(async () => root.render(createElement(ScreenContext, { value: { ...state, record } }, createElement(FormContext, { value: form }, createElement(ComponentsProvider, { components: defaultComponents }, createElement(Activity, { page: courses.pages.edit! }))))))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  await redraw(state.record!)
  return { host, asked, redraw, unmount: () => act(async () => root.unmount()) }
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const changed = (entry: Element | undefined, field: string) => {
  const line = entry?.querySelector(`[data-change="${field}"]`)
  if (!line) return null
  const from = line.querySelector('[data-from]')
  return from ? `${text(line.firstElementChild)}: ${text(from)} → ${text(line.querySelector('[data-to]'))}` : `${text(line.firstElementChild)}: ${text(line.querySelector('[data-to]'))}`
}

test('the panel reads the record\'s own entries newest first, and draws each change by its label and its cell, in English', async () => {
  const { host, asked, redraw, unmount } = await draw('en')
  const read = asked.find((one) => one.kayan === 'auditLog')!.input
  assert.deepEqual(read.where, { and: [{ kayan: { equals: 'courses' } }, { record: { equals: 'c1' } }] }, 'it asks for this record of this kayan alone')
  assert.equal(read.sort, '-createdAt', 'newest first')
  const entries = [...host.querySelectorAll('[data-entry]')]
  assert.deepEqual(entries.map((one) => one.getAttribute('data-entry')), ['archive', 'update', 'create'], 'in the order the log answered')
  assert.equal(text(entries[0]!.querySelector('[data-event]')), 'Archived by Asma $& as Someone', 'the action, and staff named first as the member it wrote as, a name read as text and never as a pattern')
  assert.equal(text(entries[1]!.querySelector('[data-event]')), 'Updated by Someone', 'and a person this tenant does not read as someone, never the id')
  assert.match(text(entries[0]), /1 minute ago/, 'when, relative')
  assert.ok(entries[0]!.querySelector('time')?.getAttribute('dateTime'), 'and exact')
  assert.equal(changed(entries[1], 'fee'), 'Fee: 5 → 7', 'a change is its label and both values')
  assert.equal(changed(entries[1], 'currency'), 'Currency: Saudi riyal → US dollar', 'each value drawn by the field\'s own cell')
  assert.equal(changed(entries[0], 'archived'), 'Archived: ✗Active → ✓Archived', 'a checkbox as its glyph and its word, a no apart from an empty value')
  assert.equal(host.querySelector('[data-change="updatedAt"]') ?? host.querySelector('[data-change="tenant"]'), null, 'and no technical column')

  const all = [...host.querySelectorAll('[data-entry]')]
  assert.equal(text(all[2]!.querySelector('[data-event]')), 'Created by The system', 'an entry no person wrote names the system')
  assert.equal(changed(all[2], 'title'), 'Title: Tajweed', 'a create says what was set, with no empty value before it')
  assert.equal(all[2]!.querySelector('[data-change="id"]'), null, 'and the id it was given is not drawn')
  assert.deepEqual([changed(all[2], 'notifications'), changed(all[2], 'summary')], [null, null], 'nor a field the person never set, left empty or off')
  assert.equal(read.limit, 5, 'the side column asks for the last few alone')
  assert.equal(host.querySelector('button'), null, 'and pages none of the rest itself')
  const link = host.querySelector('a[data-all-activity]')
  assert.equal(link?.getAttribute('href'), '/dashboard/activity?kayan=courses&record=c1', 'it links the Activity page, filtered to this record, for the rest')
  assert.equal(text(link), 'All activity')

  const before = asked.filter((one) => one.kayan === 'auditLog').length
  await redraw({ id: 'c1', title: 'Tajweed', updatedAt: '2026-09-28T00:00:00.000Z' })
  const again = asked.filter((one) => one.kayan === 'auditLog')
  assert.equal(again.length, before + 1, 'one read more')
  assert.equal(again.at(-1)!.input.page, 1, 'of the first page')
  assert.deepEqual([...host.querySelectorAll('[data-entry]')].map((one) => one.getAttribute('data-entry')), ['archive', 'update', 'create'], 'drawn alone, with no page of the old read after it')
  await unmount()
})

test('in Arabic the panel draws every word in Arabic: its heading, the action, each label and each value', async () => {
  const { host, unmount } = await draw('ar')
  assert.equal(text(host.querySelector('[data-panel="activity"] [data-slot="card-title"]')), 'النشاط')
  const entries = [...host.querySelectorAll('[data-entry]')]
  assert.equal(text(entries[0]!.querySelector('[data-event]')), 'أُرشف بواسطة Asma $& بصفة شخص ما')
  assert.equal(text(entries[1]!.querySelector('[data-event]')), 'حُدِّث بواسطة شخص ما')
  assert.equal(changed(entries[1], 'currency'), 'العملة: ريال سعودي → دولار أمريكي')
  assert.equal(changed(entries[1], 'fee'), 'الرسوم: 5 → 7', 'a number as the number cell draws it in the viewer\'s locale')
  assert.equal(text(host.querySelector('a[data-all-activity]')), 'كل النشاط')
  assert.ok(!/[A-Za-z]{3,}/.test(text(host).replace(/Asma \$&|Tajweed/g, '')), `no English word: ${text(host)}`)
  await unmount()
})

test('an entry the viewer wrote names the viewer "You", and in Arabic joins it to "by" as one word', async () => {
  for (const [locale, you, updated] of [['en', 'You', 'Updated by You'], ['ar', 'أنت', 'حُدِّث بواسطتك']] as const) {
    const { host, unmount } = await draw(locale, 'u2')
    const events = [...host.querySelectorAll('[data-entry] [data-event]')].map((one) => text(one))
    assert.equal(events[1], updated, `${locale}: ${events.join(' | ')}`)
    assert.ok(events[0]!.endsWith(you), 'and a write made as the viewer, in the staff member\'s session, still names the member by the same word')
    await unmount()
  }
  const { host, unmount } = await draw('en', 'u9')
  assert.equal(text(host.querySelectorAll('[data-entry] [data-event]')[1]), 'Updated by Someone')
  await unmount()
})

test('the panel reads its entries again after every save the form lands, a draft or an autosave that moves no updatedAt among them', async () => {
  const { asked, redraw, unmount } = await draw('en')
  const reads = () => asked.filter((one) => one.kayan === 'auditLog').length
  const before = reads()
  await redraw({ id: 'c1', title: 'Tajweed' }, 1)
  assert.equal(reads(), before + 1, 'a save the form counted is read again, though the row it holds is the same')
  await redraw({ id: 'c1', title: 'Tajweed' }, 1)
  assert.equal(reads(), before + 1, 'and a render that saved nothing reads nothing')
  await unmount()
})

const { ActivityLog, whereOf, filtersOf } = await import('../../../templates/mithaq/src/ui/activity.tsx')

test('the Activity\'s filters are one `where` the log reads: a search of the values, a person, a path into the column that changed, an action and whole days in the viewer\'s time zone', () => {
  assert.equal(whereOf({}), undefined, 'no filter, no where')
  const where = whereOf({ kayan: 'courses', record: 'c1', search: ' Tajweed ', actor: 'u2', field: 'fee', action: 'published', from: '2026-10-01', to: '2026-10-02' })
  assert.deepEqual(where, { and: [
    { kayan: { equals: 'courses' } },
    { record: { equals: 'c1' } },
    { changes: { contains: 'Tajweed' } },
    { actor: { equals: 'u2' } },
    { 'changes.fee': { exists: true } },
    { operation: { equals: 'publish' } },
    { createdAt: { greater_than_equal: new Date(2026, 9, 1).toISOString() } },
    { createdAt: { less_than: new Date(2026, 9, 3).toISOString() } },
  ] })
  assert.deepEqual(whereOf({ action: 'constructor', from: 'nonsense' }), undefined, 'an action it does not know, and a day that is none, filter nothing')
  assert.deepEqual(filtersOf({ search: '?kayan=courses&record=c1&page=x&limit=20&secret=1', people: true }), { kayan: 'courses', record: 'c1', page: 1, limit: 20 }, 'a link carries the filters it names and nothing else')
  assert.deepEqual(filtersOf({ search: '?actor=u1&kayan=courses', people: true }), { actor: 'u1', kayan: 'courses', page: 1, limit: 10 }, 'a person to a reader of the people')
  assert.deepEqual(filtersOf({ search: '?actor=u1&kayan=courses', people: false }), { kayan: 'courses', page: 1, limit: 10 }, 'and no person to a reader of none, whose read would be refused for it')
})

const drawLog = async ({ locale, query, fixed, permissions }: { locale: Locale; query: Record<string, unknown>; fixed?: boolean; permissions?: '*' | string[] }) => {
  const asked: { kayan: string; input: Record<string, unknown> }[] = []
  const client: ScreenState['client'] = async ({ kayan, input }) => {
    asked.push({ kayan, input })
    if (kayan === 'auditLog') {
      return { docs: [{ ...pages[1]![1], kayan: 'courses', record: 'c1' }, { ...created, kayan: 'courses', record: 'c9' }], hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null, page: 1, limit: 10, totalDocs: 2, totalPages: 1 }
    }
    if (kayan === 'courses') return { docs: [{ id: 'c1', title: 'Tajweed' }], hasNextPage: false, nextPage: null }
    return { docs: [], hasNextPage: false, nextPage: null }
  }
  const state: ScreenState = { t: translator(locale), locale, dir: dirOf(locale), screen, access: { ...(permissions && { permissions }), collections: { user: { read: true } } } as never, user: { id: 'u0', name: 'Admin', email: 'admin@example.com' }, client }
  const host = mount()
  const root = createRoot(host)
  const queries: Record<string, unknown>[] = []
  const element = createElement(ActivityLog, { query: { page: 1, limit: 10, ...query } as never, onQuery: (next: Record<string, unknown>) => void queries.push(next), ...(fixed && { kayan: courses, record: 'c1' }) })
  await act(async () => root.render(createElement(ScreenContext, { value: state }, createElement(ComponentsProvider, { components: defaultComponents }, element))))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  return { host, asked, queries, unmount: () => act(async () => root.unmount()) }
}

test('the Activity page reads the log by its filters, names each control, and names and links the record each entry is of, a record gone among them', async () => {
  const { host, asked, queries, unmount } = await drawLog({ locale: 'en', query: { action: 'updated', kayan: 'courses' } })
  const read = asked.find((one) => one.kayan === 'auditLog')!.input
  assert.deepEqual(read.where, whereOf({ action: 'updated', kayan: 'courses' }), 'the read is the filters\' where')
  assert.equal(read.sort, '-createdAt', 'newest first')
  // Every control is named: a label for each box, and the search by its own label.
  const named = [...host.querySelectorAll('[role="group"] label[for]')].map((one) => text(one))
  assert.deepEqual(named, ['Person', 'Record type', 'Field', 'Action', 'From', 'To'])
  for (const label of host.querySelectorAll('[role="group"] label[for]')) assert.ok(host.querySelector(`[id="${label.getAttribute('for')}"]`), `${text(label)} names a control`)
  assert.equal(host.querySelector('input[type="search"]')?.getAttribute('aria-label'), 'Search')
  assert.equal(host.querySelector('[role="group"]')?.getAttribute('aria-label'), 'Filter the activity')
  const records = [...host.querySelectorAll('[data-record]')]
  assert.equal(text(records[0]), 'Course: Tajweed', 'an entry names its record by its kayan and title')
  assert.equal(records[0]!.querySelector('a')?.getAttribute('href'), '/dashboard/courses/c1', 'and links its page')
  assert.equal(text(records[1]), 'Course: Deleted', 'a record the read answers without is gone')
  assert.equal(records[1]!.querySelector('a'), null, 'and links nothing')
  assert.ok(host.querySelector('[data-mithaq-range]'), 'and the log is paged')

  assert.equal(host.querySelector('input[type="date"]'), null, 'each day is the project\'s date picker, never the browser\'s box')
  assert.equal(text(host.querySelector(`[id="${host.querySelectorAll('[role="group"] label[for]')[4]!.getAttribute('for')}"]`)), 'Pick a date', 'which the From label names')
  await act(async () => type(host.querySelector('input[type="search"]')!, 'Tajweed'))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 350)))
  assert.deepEqual(queries.at(-1), { page: 1, limit: 10, action: 'updated', kayan: 'courses', search: 'Tajweed' }, 'a filter changed reads from the first page')
  await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent === 'Clear filters') as unknown as Element))
  assert.deepEqual(queries.at(-1), { page: 1, limit: 10 }, 'and clearing them keeps the page size alone')
  await unmount()
})

test('the Activity tab reads one record\'s entries whatever its filters say, offers no kayan of its own, and speaks Arabic in Arabic', async () => {
  const { host, asked, unmount } = await drawLog({ locale: 'ar', query: { kayan: 'tags', record: 'x', field: 'fee' }, fixed: true })
  const read = asked.find((one) => one.kayan === 'auditLog')!.input
  assert.deepEqual(read.where, whereOf({ kayan: 'courses', record: 'c1', field: 'fee' }), 'the record\'s own kayan and id, never a link\'s')
  assert.deepEqual([...host.querySelectorAll('[role="group"] label[for]')].map((one) => text(one)), ['الشخص', 'الحقل', 'الإجراء', 'من', 'إلى'], 'no kayan filter, each label in Arabic')
  assert.equal(host.querySelector('[data-record]'), null, 'and no entry names its record, which is this one')
  await unmount()
})

test('the Activity says what it found in one short live line, apart from the list, and says its search is limited for a reader graded column by column', async () => {
  const { host, unmount } = await drawLog({ locale: 'en', query: {}, permissions: ['auditLog.find'] })
  const live = [...host.querySelectorAll('[aria-live]')]
  assert.equal(live.length, 1, 'one live region')
  assert.equal(text(live[0]), 'Entries found: 2', 'saying the count')
  assert.equal(live[0]!.querySelector('ol'), null, 'and never the list itself')
  assert.equal(text(host.querySelector('[data-search-limited]')), 'The search covers the records whose every field you may read.')
  await unmount()
  const whole = await drawLog({ locale: 'ar', query: {}, permissions: '*' })
  assert.equal(whole.host.querySelector('[data-search-limited]'), null, 'a reader of every column is told nothing more')
  assert.equal(text(whole.host.querySelector('[aria-live]')), 'السجلات المطابقة: 2', 'in Arabic, its digits as every count of the app draws them')
  await whole.unmount()
})
