// What each kind of a device kayan is as a SQLite column, and how its value crosses the proxy,
// whose values are text, numbers, booleans and null alone.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { SQLiteDialect, getTableConfig, sqliteTable, type SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { SQL } from 'drizzle-orm'
import { drizzleIdKinds, drizzleRules, drizzleSqliteIdKinds, drizzleSqliteKinds, drizzleSqliteRules } from '../../targets.ts'
import type { ResolvedField, ResolvedKayan } from '../../mithaq/types.ts'
import { defaultNodes, richText } from '../../rich-text/index.ts'

const field = (name: string, kind: string, rules: Record<string, unknown> = {}) =>
  ({ name, column: name, kind, rules }) as unknown as ResolvedField

/** The table one field's kind and rules build, as the store builds a column: the kind, then each rule it names. */
const columnOf = (one: ResolvedField, tables: Record<string, unknown> = {}) => {
  let column = (drizzleSqliteKinds as Record<string, (field: ResolvedField, tables: never) => unknown>)[one.kind]!(one, tables as never)
  if (one.name === 'id') column = drizzleSqliteRules.primary({ column: column as never, value: undefined, field: one })
  for (const [rule, apply] of Object.entries(drizzleSqliteRules)) {
    if (rule in (one.rules ?? {})) column = (apply as (args: unknown) => unknown)({ column, value: (one.rules as Record<string, unknown>)[rule], field: one })
  }
  const table = sqliteTable('t', { [one.name]: column as never })
  return getTableConfig(table).columns[0] as SQLiteColumn & { autoIncrement?: boolean; mode?: string; default?: unknown }
}

const sqlite = new DatabaseSync(':memory:')
/** What SQLite itself answers for a column's database default. */
const defaultOf = (column: { default?: unknown }) =>
  Object.values(sqlite.prepare(`select ${new SQLiteDialect().sqlToQuery(column.default as SQL).sql} as value`).get()!)[0]

test('each kind is the SQLite column the device holds it in', () => {
  const types = Object.fromEntries(['text', 'email', 'integer', 'number', 'decimal', 'checkbox', 'textArray', 'uuid', 'datetime', 'date', 'json'].map((kind) => {
    const column = columnOf(field('value', kind))
    return [kind, [column.getSQLType(), column.columnType]]
  }))
  assert.deepEqual(types, {
    text: ['text', 'SQLiteText'],
    email: ['text', 'SQLiteText'],
    integer: ['integer', 'SQLiteInteger'],
    number: ['numeric', 'SQLiteNumericNumber'],
    // Text, because SQLite's numeric affinity would turn "12.30" into the float 12.3.
    decimal: ['text', 'SQLiteText'],
    checkbox: ['integer', 'SQLiteBoolean'],
    textArray: ['text', 'SQLiteTextJson'],
    uuid: ['text', 'SQLiteText'],
    datetime: ['integer', 'SQLiteTimestamp'],
    date: ['text', 'SQLiteText'],
    json: ['text', 'SQLiteTextJson'],
  })
  assert.equal(columnOf(field('value', 'datetime')).mode, 'timestamp_ms')
  // A maximum is the schema's to hold: SQLite keeps no length on a text column.
  assert.equal(columnOf(field('value', 'text', { maxLength: 4 })).getSQLType(), 'text')
  assert.throws(() => columnOf(field('posts', 'join')), /is a join, whose rows are held by kayan/)
})

test('a value crosses the proxy as a text, a number or a boolean SQLite holds, and reads back as the same value', () => {
  const moment = new Date('2026-10-26T08:30:15.123Z')
  const datetime = columnOf(field('value', 'datetime'))
  assert.equal(datetime.mapToDriverValue(moment), moment.getTime())
  assert.deepEqual(datetime.mapFromDriverValue(moment.getTime()), moment)
  const checkbox = columnOf(field('value', 'checkbox'))
  assert.equal(checkbox.mapToDriverValue(true), 1)
  assert.equal(checkbox.mapFromDriverValue(0), false)
  const json = columnOf(field('value', 'json'))
  assert.equal(json.mapToDriverValue({ dose: [1, 2] }), '{"dose":[1,2]}')
  assert.deepEqual(json.mapFromDriverValue('{"dose":[1,2]}'), { dose: [1, 2] })
  assert.deepEqual(columnOf(field('value', 'textArray')).mapFromDriverValue('["a","b"]'), ['a', 'b'])
  // A decimal and a day are their text, written and read unchanged.
  assert.equal(columnOf(field('value', 'decimal')).mapToDriverValue('12.30'), '12.30')
  assert.equal(columnOf(field('value', 'date')).mapFromDriverValue('2026-02-28'), '2026-02-28')
})

test('an id is made by SQLite itself: a number id counts up and never reuses one, a uuid id is a random version 4 uuid', () => {
  const serial = columnOf(field('id', 'number'))
  assert.deepEqual([serial.getSQLType(), serial.primary, serial.autoIncrement], ['integer', true, true])
  const uuid = columnOf(field('id', 'uuid'))
  assert.deepEqual([uuid.getSQLType(), uuid.primary], ['text', true])
  const made = new Set(Array.from({ length: 50 }, () => defaultOf(uuid)))
  assert.equal(made.size, 50)
  for (const one of made) assert.match(String(one), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  // Only the primary key gets a default: any other uuid column holds an identifier something else chose.
  assert.equal(columnOf(field('external', 'uuid')).default, undefined)
})

test('the rules are the Postgres store\'s, a timestamp made now in milliseconds, and an id of the same three kinds', () => {
  assert.deepEqual(Object.keys(drizzleSqliteRules).sort(), Object.keys(drizzleRules).sort())
  assert.deepEqual([...drizzleSqliteIdKinds].sort(), [...drizzleIdKinds].sort())
  assert.equal(columnOf(field('value', 'text', { required: true })).notNull, true)
  assert.equal(columnOf(field('value', 'text', { required: false })).notNull, false)
  assert.equal(columnOf(field('value', 'text', { defaultValue: 'draft' })).default, 'draft')
  const before = Date.now()
  const now = defaultOf(columnOf(field('createdAt', 'datetime', { defaultNow: true })))
  assert.ok(Number.isInteger(now) && (now as number) >= before - 1000 && (now as number) <= Date.now() + 1000, `${String(now)} is now, in milliseconds`)
  // A day column carries no database default, as on Postgres.
  assert.equal(columnOf(field('day', 'date', { defaultNow: true })).default, undefined)
})

test('a reference takes the kind of the id it points at', () => {
  const target = (kind: string) => ({ name: 'patient', fields: { id: { kind } } }) as unknown as ResolvedKayan
  const tables = { patient: sqliteTable('patient', { id: (drizzleSqliteKinds.uuid(field('id', 'uuid')) as never) }) }
  const uuid = columnOf({ ...field('patient', 'relationship', { onDelete: 'restrict' }), column: 'patient_id', target: target('uuid') }, tables)
  assert.equal(uuid.getSQLType(), 'text')
  assert.equal(columnOf({ ...field('ward', 'relationship'), column: 'ward_id', target: target('number') }, { patient: tables.patient }).getSQLType(), 'integer')
  const [reference] = getTableConfig(sqliteTable('admission', { patient: drizzleSqliteKinds.relationship({ ...field('patient', 'relationship', { onDelete: 'restrict' }), column: 'patient_id', target: target('uuid') }, tables) as never })).foreignKeys
  assert.equal(reference?.onDelete, 'restrict')
})

test('a rich text value is Lexical JSON, held as JSON text by the kind\'s own SQLite column', () => {
  const build = richText({ nodes: defaultNodes }).kinds.richText.targets['drizzle-sqlite']
  const column = getTableConfig(sqliteTable('t', { body: build(field('body', 'richText')) as never })).columns[0]!
  assert.deepEqual([column.getSQLType(), column.columnType], ['text', 'SQLiteTextJson'])
  const value = { root: { type: 'root', children: [] } }
  assert.deepEqual(column.mapFromDriverValue(column.mapToDriverValue(value)), value)
})
