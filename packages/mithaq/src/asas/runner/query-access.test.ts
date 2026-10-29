import assert from 'node:assert/strict'
import { test } from 'node:test'
import { memoryStore } from '../../../../../templates/asas/src/memory-store.ts'
import { nodeSqlite } from '../../drizzle/sqlite/__fixtures__/node-sqlite.ts'
import { sqliteAdapter, drizzleSqliteKinds, drizzleSqliteRules, drizzleSqliteIdKinds } from '../../device.ts'
import { mixedWherePrivacy } from './__fixtures__/mixed-where.ts'

for (const device of [false, true]) test(`${device ? 'device' : 'server'} related queries preserve mixed and empty access constraints and caller siblings`, async () => {
  const fixture = nodeSqlite()
  fixture.sqlite.exec('create table patient (id integer primary key autoincrement, name text not null, created_at integer not null, updated_at integer not null); create table note (id integer primary key autoincrement, title text, patient_id integer references patient(id), created_at integer not null, updated_at integer not null)')
  try {
    await mixedWherePrivacy({ dropsEmptyBranch: device, store: device ? sqliteAdapter({ ...fixture.database, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }) : memoryStore() })
  } finally { fixture.sqlite.close() }
})

test('combining published and mixed access constraints retains every sibling before and after prefixing', async () => {
  const { combineWhere, matchesWhere } = await import('../../mithaq/where.ts')
  const { publishedWhere } = await import('./row-state.ts')
  const { prefixWhere } = await import('./query-access.ts')
  const { assertWhereGrammar } = await import('./query.ts')
  const fields = Object.fromEntries(['id', 'name', 'deletedAt', '_status'].map((name) => [name, { name, kind: name === 'deletedAt' ? 'datetime' : 'text' }]))
  const kayan = { name: 'patient', fields, softDelete: 'deletedAt', versions: { drafts: true } } as never
  const mixed = { and: [{ id: { exists: true } }], or: [{ id: { exists: true } }], name: { equals: 'visible' } }
  const normalized = assertWhereGrammar(kayan, mixed)
  assert.deepEqual(Object.keys(normalized), ['and', 'or', 'name'])
  assert.throws(() => assertWhereGrammar(kayan, { and: [{ id: { exists: true } }], missing: { equals: 'x' } }), /unknown field/)
  assert.throws(() => prefixWhere({ kayan: 'patient', prefix: 'patient', where: { and: [{ id: { exists: true } }], 'relation.name': { equals: 'x' } } }), /three segments/)
  const where = combineWhere(normalized, publishedWhere(kayan))!
  const prefixed = prefixWhere({ kayan: 'patient', prefix: 'patient', where })
  for (const [name, deletedAt, status, expected] of [
    ['visible', null, 'published', true], ['hidden', null, 'published', false],
    ['visible', new Date(), 'published', false], ['visible', null, 'draft', false],
  ] as const) {
    const row: Record<string, unknown> = { id: 'one', name, deletedAt, _status: status }
    assert.equal(matchesWhere({ where, valueOf: (key) => row[key] }), expected)
    assert.equal(matchesWhere({ where: prefixed, valueOf: (key) => row[key.slice('patient.'.length)] }), expected)
  }
})
