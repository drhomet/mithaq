import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesWhere, same, navOf } from './client.ts'

test('two stored values are the same by what they hold: a moment by its time, an object whatever its key order, absent as null', () => {
  assert.equal(same(new Date(5), new Date(5)), true)
  assert.equal(same(new Date(5), new Date(6)), false)
  assert.equal(same({ en: 'a', ar: 'b' }, { ar: 'b', en: 'a' }), true, 'jsonb hands keys back in its own order')
  assert.equal(same([{ id: 1 }, 'x'], [{ id: 1 }, 'x']), true)
  assert.equal(same([1, 2], [2, 1]), false)
  assert.equal(same(undefined, null), true)
  assert.equal(same({ a: 1 }, { a: 1, b: 2 }), false)
  assert.equal(same(new Date(5), new Date(5).toISOString()), false, 'a moment is not its text')
  assert.equal(same('1', 1), false)
  assert.equal(same([], {}), false)
})

test('a filter of `equals: null` holds for a value that is absent, as for one that is null, since the two are the same stored value', () => {
  const row: Record<string, unknown> = { title: 'Tajweed' }
  assert.equal(matchesWhere({ where: { archived: { equals: null } }, valueOf: (key) => row[key] }), true)
  assert.equal(matchesWhere({ where: { title: { equals: null } }, valueOf: (key) => row[key] }), false)
})

test('a when over a decimal compares the values the text holds, padded or not, and over text compares the text', () => {
  const row: Record<string, unknown> = { amount: '999.00', fee: '7.00', code: '7.00', unpadded: '3.5' }
  const kinds: Record<string, string> = { amount: 'decimal', fee: 'decimal', unpadded: 'decimal', code: 'text' }
  const holds = (where: Parameters<typeof matchesWhere>[0]['where']) => matchesWhere({ where, valueOf: (key) => row[key], kindOf: (key) => kinds[key] })
  // As text '999.00' is above '1000'; as values it is below.
  assert.equal(holds({ amount: { greater_than: '1000' } }), false)
  assert.equal(holds({ amount: { less_than: '1000' } }), true)
  assert.equal(holds({ amount: { greater_than_equal: '999' } }), true)
  assert.equal(holds({ amount: { less_than_equal: '998.99' } }), false)
  // '7' and '7.00' are one value, and '3.5' and '3.50' too.
  assert.equal(holds({ fee: { equals: '7' } }), true)
  assert.equal(holds({ fee: { not_equals: '7' } }), false)
  assert.equal(holds({ fee: { in: ['1', '7.000'] } }), true)
  assert.equal(holds({ fee: { not_in: ['07'] } }), false)
  assert.equal(holds({ unpadded: { equals: '3.50' } }), true)
  assert.equal(holds({ unpadded: { greater_than: '3.49' } }), true)
  // A text field holding the same characters is compared as the text it is.
  assert.equal(holds({ code: { equals: '7' } }), false)
  assert.equal(holds({ code: { equals: '7.00' } }), true)
})


test('navigation prunes permissions and hidden entries before ordering visible groups', () => {
  const work = { name: 'work', label: { en: 'Work' }, order: 1 }
  const settings = { name: 'settings', label: { en: 'Settings' }, position: 'bottom' as const }
  const nav = [
    { path: '/settings', page: 'list', group: settings },
    { path: '/second', page: 'list', group: work, order: 2 },
    { path: '/denied', page: 'list', permission: 'private.find', group: work },
    { path: '/hidden', page: 'list', hidden: true },
    { path: '/first', page: 'list', group: work, order: 1 },
    { path: '/ungrouped', page: 'home' },
  ]
  assert.deepEqual(navOf({ nav }, {}).map((entry) => entry.path), ['/ungrouped', '/first', '/second', '/settings'])
  assert.equal(nav.length, 6, 'presentation never removes a route or mutates the projection')
})
