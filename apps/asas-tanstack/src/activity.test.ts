import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { asas } from 'asas'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import '../../../packages/mithaq-admin/test/tsx.ts'
import { click, mount } from '../../../packages/mithaq-admin/test/dom.ts'
import { dirOf, translator, type Locale } from './copy.ts'

const { createRoot } = await import('react-dom/client')
const { Activity } = await import('asas/audit-log/ui/activity.tsx')
const { ComponentsProvider } = await import('mithaq-admin/components.tsx')
const { defaultComponents } = await import('mithaq-admin/default-components.tsx')

const screen = asas.targets.dashboard.client
const courses = screen.kayan.courses!
const change = (changes: Record<string, [unknown, unknown]>) =>
  JSON.stringify(Object.fromEntries(Object.entries(changes).map(([name, [from, to]]) => [name, { from, to }])))
const pages: Record<number, Record<string, unknown>[]> = {
  1: [
    { id: 'e3', createdAt: new Date(Date.now() - 60_000).toISOString(), operation: 'archive', actor: 'u2', impersonatedBy: 'u1', changes: change({ archived: [false, true], updatedAt: ['2026-09-01', '2026-09-02'] }) },
    { id: 'e2', createdAt: new Date(Date.now() - 3_600_000).toISOString(), operation: 'update', actor: 'u2', changes: change({ fee: [5, 7], currency: ['SAR', 'USD'], tenant: ['o1', 'o2'] }) },
  ],
  // A write landed between the two reads, so the second page opens on the
  // entry the first ended with.
  2: [{ id: 'e2', createdAt: new Date(Date.now() - 3_600_000).toISOString(), operation: 'update', actor: 'u2', changes: change({ fee: [5, 7] }) }, { id: 'e1', createdAt: new Date(Date.now() - 86_400_000).toISOString(), operation: 'create', actor: null, changes: change({ id: [null, 'c1'], title: [null, 'Tajweed'] }) }],
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
  const redraw = async (record: Record<string, unknown>) => {
    await act(async () => root.render(createElement(ScreenContext, { value: { ...state, record } }, createElement(ComponentsProvider, { components: defaultComponents }, createElement(Activity, { page: courses.pages.edit! })))))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  await redraw(state.record!)
  return { host, asked, redraw, unmount: () => act(async () => root.unmount()) }
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const changed = (entry: Element | undefined, field: string) => {
  const line = entry?.querySelector(`[data-change="${field}"]`)
  return line ? `${text(line.firstElementChild)}: ${text(line.querySelector('[data-from]'))} → ${text(line.querySelector('[data-to]'))}` : null
}

test('the panel reads the record\'s own entries newest first, and draws each change by its label and its cell, in English', async () => {
  const { host, asked, redraw, unmount } = await draw('en')
  const read = asked.find((one) => one.kayan === 'auditLog')!.input
  assert.deepEqual(read.where, { and: [{ kayan: { equals: 'courses' } }, { record: { equals: 'c1' } }] }, 'it asks for this record of this kayan alone')
  assert.equal(read.sort, '-createdAt', 'newest first')
  const entries = [...host.querySelectorAll('[data-entry]')]
  assert.deepEqual(entries.map((one) => one.getAttribute('data-entry')), ['archive', 'update'], 'in the order the log answered')
  assert.equal(text(entries[0]!.querySelector('[data-event]')), 'Archived by Asma $& as Someone', 'the action, and staff named first as the member it wrote as, a name read as text and never as a pattern')
  assert.equal(text(entries[1]!.querySelector('[data-event]')), 'Updated by Someone', 'and a person this tenant does not read as someone, never the id')
  assert.match(text(entries[0]), /1 minute ago/, 'when, relative')
  assert.ok(entries[0]!.querySelector('time')?.getAttribute('dateTime'), 'and exact')
  assert.equal(changed(entries[1], 'fee'), 'Fee: 5 → 7', 'a change is its label and both values')
  assert.equal(changed(entries[1], 'currency'), 'Currency: Saudi riyal → US dollar', 'each value drawn by the field\'s own cell')
  assert.equal(changed(entries[0], 'archived'), 'Archived: ✗Active → ✓Archived', 'a checkbox as its glyph and its word, a no apart from an empty value')
  assert.equal(host.querySelector('[data-change="updatedAt"]') ?? host.querySelector('[data-change="tenant"]'), null, 'and no technical column')

  await act(async () => click([...host.querySelectorAll('button')].find((one) => one.textContent === 'Show older') as unknown as Element))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  const all = [...host.querySelectorAll('[data-entry]')]
  assert.deepEqual(all.map((one) => one.getAttribute('data-entry')), ['archive', 'update', 'create'], 'the next page is drawn after the first, the entry both answered drawn once')
  assert.equal(text(all[2]!.querySelector('[data-event]')), 'Created by The system', 'an entry no person wrote names the system')
  assert.equal(changed(all[2], 'title'), 'Title: — → Tajweed', 'and the id it was given is not drawn')
  assert.equal(all[2]!.querySelector('[data-change="id"]'), null)

  const before = asked.filter((one) => one.kayan === 'auditLog').length
  await redraw({ id: 'c1', title: 'Tajweed', updatedAt: '2026-09-28T00:00:00.000Z' })
  const again = asked.filter((one) => one.kayan === 'auditLog')
  assert.equal(again.length, before + 1, 'one read more')
  assert.equal(again.at(-1)!.input.page, 1, 'of the first page')
  assert.deepEqual([...host.querySelectorAll('[data-entry]')].map((one) => one.getAttribute('data-entry')), ['archive', 'update'], 'drawn alone, with no page of the old read after it')
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
  assert.equal(text([...host.querySelectorAll('button')].at(-1)), 'عرض الأقدم')
  assert.ok(!/[A-Za-z]{3,}/.test(text(host).replace(/Asma \$&/g, '')), `no English word: ${text(host)}`)
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
