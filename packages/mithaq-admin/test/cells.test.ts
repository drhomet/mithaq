import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import './tsx.ts'

const { translator } = await import('../../../apps/asas-tanstack/src/copy.ts')
const { cells } = await import('../registry/cells.tsx')
const { UploadCell } = await import('../registry/upload-cell.tsx')
const { RichTextCell } = await import('../registry/rich-text.tsx')
const all = { ...cells, upload: UploadCell, richText: RichTextCell }
const kayan = { name: 'things' } as ClientKayan
const draw = (kind: keyof typeof all, value: unknown, locale: string) => renderToStaticMarkup(createElement(() => all[kind]({
  kayan, field: { name: 'value', kind, rules: {}, component: kind, cell: kind } as ClientField,
  value, locale, t: translator(locale),
}) as ReactElement))

test('empty cells of every shipped kind show one dash with localized accessible words', () => {
  for (const locale of ['en', 'ar']) for (const kind of Object.keys(all).filter((kind) => kind !== 'count') as (keyof typeof all)[]) {
    for (const value of [null, undefined, '', []]) {
      const html = draw(kind, value, locale)
      assert.match(html, /aria-hidden="true">—<\/span>/, `${kind}: ${String(value)}`)
      assert.match(html, new RegExp(`class="sr-only">${locale === 'ar' ? 'فارغ' : 'Empty'}<`))
      assert.equal((html.match(/—/g) ?? []).length, 1)
    }
  }
  assert.equal(draw('integer', 0, 'en'), '0')
  assert.equal(draw('checkbox', false, 'en').includes('—'), false)
})

test('archive timestamps show status words in lists and keep their date on records', () => {
  for (const locale of ['en', 'ar']) for (const value of [null, new Date('2026-10-22T01:00:00Z')]) {
    const props = { kayan, field: { name: 'archivedAt', kind: 'datetime', rules: {} } as ClientField, value, locale, t: translator(locale) }
    const html = renderToStaticMarkup(createElement(() => cells.datetime(props) as ReactElement))
    assert.match(html, /data-slot="badge"/)
    assert.ok(html.includes(value ? (locale === 'ar' ? 'مؤرشف' : 'Archived') : (locale === 'ar' ? 'نشط' : 'Active')))
    assert.equal(html.includes('<time'), false)
    if (value) assert.match(renderToStaticMarkup(createElement(() => cells.datetime({ ...props, whole: true }) as ReactElement)), /<time dateTime="2026-10-22T01:00:00.000Z"/)
  }
})

test('checkbox cells show declared true and false words, else localized yes and no', () => {
  for (const locale of ['en', 'ar']) for (const value of [true, false]) for (const declared of [true, false]) {
    const word = value ? (locale === 'ar' ? 'متاح' : 'Available') : (locale === 'ar' ? 'غير متاح' : 'Unavailable')
    const props = { kayan, field: { name: 'available', kind: 'checkbox', rules: {} } as ClientField, value, locale,
      t: (key: string, fallback?: string) => declared && key === `things.available.${String(value)}` ? word : translator(locale)(key, fallback) }
    assert.equal(renderToStaticMarkup(createElement(() => cells.checkbox(props) as ReactElement)), declared ? word : value ? (locale === 'ar' ? 'نعم' : 'Yes') : (locale === 'ar' ? 'لا' : 'No'))
  }
})

test('only shown count columns ask normal find for counts', async () => {
  const { findOf } = await import('../registry/list-query.ts')
  const fields = [
    { name: 'title', kind: 'text', rules: {} },
    { name: 'variants', kind: 'join', rules: {} },
    { name: 'tags', kind: 'relationship', hasMany: true, rules: {} },
  ] as ClientField[]
  const node = { columns: [{ field: 'title' }, { field: 'variants', cell: 'count' }, { field: 'tags', cell: 'count' }] }
  const listed = { name: 'products', fields } as ClientKayan
  assert.deepEqual(findOf({ kayan: listed, query: {}, node }), { counts: ['variants', 'tags'] })
  assert.deepEqual(findOf({ kayan: listed, query: { cols: ['title', '-variants', 'tags'] }, node }), { counts: ['tags'] })
  assert.deepEqual(findOf({ kayan: { ...listed, fields: fields.slice(0, 1) }, query: {}, node }), {})
})

test('nonempty references retain loading, unavailable and deleted states', async () => {
  const { RelationshipCell, titleKey } = await import('../registry/relationship-cell.tsx')
  for (const [state, words] of [[null, 'Loading…'], [false, 'Not available'], [true, 'Deleted']] as const) {
    const html = renderToStaticMarkup(createElement(RelationshipCell, {
      kayan, field: { name: 'related', kind: 'relationship', relationTo: 'related', rules: {} } as ClientField,
      value: 'held-id', locale: 'en', t: (_key, fallback) => fallback,
      titles: new Map([[titleKey('related', 'held-id'), state]]),
    }))
    assert.ok(html.includes(words))
    assert.equal(html.includes('held-id'), false)
  }
})

test('count cells use page metadata even when the count is the list title', async () => {
  const { ListTable } = await import('../registry/list-table.tsx')
  const { ComponentsProvider } = await import('../registry/components.tsx')
  const { defaultComponents } = await import('../registry/default-components.tsx')
  const field = { name: 'variants', kind: 'join', rules: {}, component: 'join', cell: 'join' } as ClientField
  for (const count of [0, 3]) {
    const html = renderToStaticMarkup(createElement(ComponentsProvider, { components: defaultComponents }, createElement(ListTable, {
      kayan: { name: 'things', single: false, pages: {}, useAsTitle: 'variants', fields: [field], operations: [] },
      shown: [field], cellOf: new Map([['variants', 'count']]), docs: [{ id: 'one' }], counts: { variants: { one: count } },
      copy: { t: (_key, fallback) => fallback, locale: 'en' }, titles: new Map(), onSort: () => {}, href: () => '#',
      openHint: 'open', openRow: () => {}, table: { current: null }, actions: () => null, unreadable: false,
    })))
    assert.match(html, new RegExp(`data-list-title=""[^>]*>${count}</td>`))
  }
})

test('partial and older saved column choices request every effective visible count', async () => {
  const { findOf, remembered, remember } = await import('../registry/list-query.ts')
  const { columnsOf } = await import('../registry/list-columns.tsx')
  const field = (name: string, kind = 'text') => ({ name, kind, rules: {}, component: kind, cell: kind }) as ClientField
  const listed = { name: 'products', fields: [field('title'), field('fee', 'integer'), field('variants', 'join')], operations: [], pages: {}, single: false }
  const node = { columns: [{ field: 'title' }, { field: 'fee' }, { field: 'variants', cell: 'count' }] }
  const check = (cols: readonly string[]) => {
    assert.deepEqual(columnsOf({ kayan: listed, cols, opens: node.columns.map((column) => column.field) }).filter((column) => column.active).map((column) => column.name), ['title', 'variants'])
    assert.deepEqual(findOf({ kayan: listed, query: { cols }, node }), { counts: ['variants'] })
  }
  check(['title', '-fee'])
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } })
  try {
    remember('products', { cols: ['title', '-fee'] })
    check(remembered('products', 100).cols!)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('an absent archive timestamp stays empty while null and dates show their actual status', () => {
  const props={kayan,field:{name:'archivedAt',kind:'datetime',rules:{}} as ClientField,locale:'en',t:(_key:string,fallback?:string)=>fallback}
  const absent=renderToStaticMarkup(createElement(()=>cells.datetime({...props,value:undefined}) as ReactElement))
  assert.match(absent,/class="sr-only">Empty</)
  assert.equal(absent.includes('Active'),false)
  assert.match(renderToStaticMarkup(createElement(()=>cells.datetime({...props,value:null}) as ReactElement)),/>Active</)
  assert.match(renderToStaticMarkup(createElement(()=>cells.datetime({...props,value:new Date('2026-10-22T01:00:00Z')}) as ReactElement)),/>Archived</)
})


test('the host supplies all default cell words and empty link names', () => {
  const ar=translator('ar')
  for(const [key,word] of Object.entries({emptyValue:'فارغ',archived:'مؤرشف',active:'نشط',openEmpty:'فارغ، فتح',yes:'نعم',no:'لا'})) assert.equal(ar(`admin.${key}`),word)
})

test('bulk checkbox words follow the same host and field copy as list cells', async () => {
  const {BulkChoice}=await import('../registry/node-buttons.tsx')
  for(const value of [true,false]){
    const props={kayan,field:{name:'available',kind:'checkbox',rules:{}} as ClientField,value,locale:'ar',t:translator('ar')}
    const word=renderToStaticMarkup(createElement(()=>cells.checkbox(props) as ReactElement))
    const html=renderToStaticMarkup(createElement(BulkChoice,{...props,copy:{t:props.t,locale:'ar'},id:'bulk-available',readOnly:false,onChange:()=>{}}))
    assert.ok(html.includes(word))
    assert.equal(html.includes('>Yes<'),false)
  }
})


test('unavailable counts use the host not-available word while zero stays a number', () => {
  for(const [locale,word] of [['en','Not available'],['ar','غير متاح']] as const) {
    for(const value of [undefined,null]) assert.equal(draw('count',value,locale),word)
  }
  assert.equal(draw('count',0,'en'),'0')
})
