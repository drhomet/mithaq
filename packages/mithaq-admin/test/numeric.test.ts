import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import './tsx.ts'
import { mount, type as typeInto } from './dom.ts'

const { createRoot } = await import('react-dom/client')
const { controlFor, labelFor } = await import('../registry/controls.tsx')
const { cellFor } = await import('../registry/cells.tsx')
const { refusalOf } = await import('../registry/form.tsx')
const { filterPathsOf } = await import('../registry/filter-operators.ts')
const { readQuery, writeQuery, sortableOf } = await import('../registry/list-query.ts')
type ClientField = import('mithaq/admin').ClientField
type ClientKayan = import('mithaq/admin').ClientKayan

const field = (one: Partial<ClientField> & { name: string; kind: string }): ClientField => ({ rules: {}, component: one.kind, cell: one.kind, ...one })
const quantity = field({ name: 'quantity', kind: 'integer', label: { en: 'Quantity', ar: 'الكمية' }, prefix: { en: 'Count', ar: 'العدد' }, rules: { min: 2, max: 10 }, filter: true })
const amount = field({ name: 'amount', kind: 'decimal', label: { en: 'Amount', ar: 'المبلغ' }, suffix: { en: 'SAR', ar: 'ريال' }, rules: { precision: 20, scale: 2 }, filter: true })
const localizedAmount = field({ name: 'localizedAmount', kind: 'decimal', rules: { precision: 7, scale: 2, localized: true } })
const kayan = { name: 'measures', fields: [field({ name: 'id', kind: 'uuid' }), quantity, amount, localizedAmount] } as unknown as ClientKayan
const t = (_key: string, fallback?: string) => fallback

test('an integer is a number box stepping by one that reports a number, a decimal a text box with a decimal keyboard that reports its exact text, each under its label and affix in both locales', async () => {
  for (const locale of ['en', 'ar']) {
    for (const [one, held, typed, reported] of [[quantity, 2, '9', 9], [amount, '9007199254740993.12', '9007199254740993.13', '9007199254740993.13']] as const) {
      const changes: unknown[] = []
      const host = mount()
      const root = createRoot(host)
      try {
        await act(async () => root.render(createElement(controlFor(one), {
          id: one.name, kayan, field: one, value: held, values: {}, setValue: () => {}, onChange: (value: unknown) => changes.push(value), readOnly: false, t, locale,
        })))
        const input = host.querySelector('input')!
        assert.equal(input.type, one === quantity ? 'number' : 'text')
        assert.equal(input.getAttribute('step'), one === quantity ? '1' : null)
        assert.equal(input.getAttribute('inputmode'), one === quantity ? null : 'decimal')
        assert.equal(input.getAttribute('dir'), 'ltr', 'a number reads left to right in every locale')
        assert.equal(labelFor({ kayan, field: one, copy: { t, locale } }), one.label![locale])
        assert.equal(host.textContent?.includes((one.prefix ?? one.suffix)![locale]!), true)
        await act(async () => typeInto(input, typed))
        await act(async () => typeInto(input, ''))
        assert.deepEqual(changes, [reported, null])
      } finally {
        await act(async () => root.unmount())
        host.remove()
      }
    }
  }
})

test('an integer cell is drawn in the reader\'s locale, and a decimal cell is its exact text, a localized one the reader\'s own entry', () => {
  for (const locale of ['en', 'ar']) {
    const cell = (one: ClientField, value: unknown) => renderToStaticMarkup(createElement(cellFor(one), { kayan, field: one, value, locale, t }))
    assert.equal(cell(quantity, 2147483647), (2147483647).toLocaleString(locale))
    assert.equal(cell(amount, '9007199254740993.12'), '9007199254740993.12')
    assert.equal(cell(localizedAmount, { ar: '10.00', en: '9.99' }), locale === 'ar' ? '10.00' : '9.99')
  }
})

test('the form refuses an integer that is no int4 and a decimal past its precision, its scale or an exact bound, under the key the server writes', () => {
  const bounded = { ...amount, rules: { required: true, precision: 7, scale: 2, min: '2', max: '10' } }
  assert.equal(refusalOf({ kayan: kayan.name, fields: [bounded], values: { amount: '9.99' } }), undefined)
  const refused = (one: ClientField, value: unknown) => refusalOf({ kayan: kayan.name, fields: [one], values: { [one.name]: value } })?.data.params.issues[0]?.message
  // '10.01' is above '10' as a value and below it as text.
  for (const [value, rule] of [['1.99', 'min'], ['10.01', 'max'], ['2.123', 'scale'], ['100000.00', 'precision'], ['NaN', 'invalid'], [9.99, 'invalid']] as const) {
    assert.equal(refused(bounded, value), `measures.amount.${rule}`, String(value))
  }
  for (const value of [1.5, Number.NaN, Infinity, 2147483648]) {
    assert.equal(refused({ ...quantity, rules: {} }, value), 'measures.quantity.invalid', String(value))
  }
  assert.equal(refused(quantity, 11), 'measures.quantity.max')
})

test('a filter and a sort on either kind survive the URL in the kind\'s own JS type, and a link holding no value of the kind is refused', () => {
  const query: import('../registry/list-query.ts').ListQuery = { where: { or: [{ and: [{ quantity: { greater_than: 2 } }, { amount: { in: ['9.99', '9007199254740993.12'] } }] }] }, sort: '-amount' }
  const rules = { paths: filterPathsOf(kayan, {}), sortable: sortableOf(kayan), maxLimit: 100 }
  assert.deepEqual(readQuery(new URLSearchParams(writeQuery(query)), rules), query)
  assert.throws(() => readQuery(new URLSearchParams({ 'where[or][0][and][0][quantity][equals]': '1.5' }), rules), /not a 32-bit integer/)
  assert.throws(() => readQuery(new URLSearchParams({ 'where[or][0][and][0][amount][equals]': 'NaN' }), rules), /not a decimal/)
})

test('a node whose when compares a decimal is shown by the values the text holds, padded or not, over a form\'s values and over the record', async () => {
  const { scopeOf, shown } = await import('../registry/nodes.tsx')
  const node = (when: object) => ({ field: 'quantity', when }) as never
  const at = (values: Record<string, unknown>, record: Record<string, unknown> | null = null) => scopeOf({ values, record, access: null, kayan })
  // As text '999.00' is above '1000'.
  assert.equal(shown(node({ amount: { greater_than: '1000' } }), at({ amount: '999.00' })), false)
  assert.equal(shown(node({ amount: { greater_than: '1000' } }), at({ amount: '1000.01' })), true)
  assert.equal(shown(node({ 'record.amount': { less_than: '1000' } }), at({}, { amount: '999.00' })), true)
  // '7' as typed and '7.00' as stored are one value, either way round.
  assert.equal(shown(node({ amount: { equals: '7.00' } }), at({ amount: '7' })), true)
  assert.equal(shown(node({ 'record.amount': { equals: '7' } }), at({}, { amount: '7.00' })), true)
  assert.equal(shown(node({ amount: { not_in: ['7.0'] } }), at({ amount: '7.00' })), false)
})
