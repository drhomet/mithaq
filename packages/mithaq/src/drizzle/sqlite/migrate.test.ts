import { sql } from 'drizzle-orm'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrateSqlite } from './migrate.ts'
import { nodeSqlite } from './__fixtures__/node-sqlite.ts'

const migrations = [{ name: '20261026120000_patient', hash: 'patient-v1', sql: ['create table patient (id integer primary key, name text not null)'] }]

test('pending device migrations commit once through the injected transaction and a second boot keeps its rows', async () => {
  const { database, log } = nodeSqlite()
  await migrateSqlite({ ...database, migrations })
  await database.db.run(sql`insert into patient (name) values (${'Huda'})`)
  await migrateSqlite({ ...database, migrations })
  assert.deepEqual(await database.db.values(sql.raw('select name from patient')), [['Huda']])
  assert.deepEqual(await database.db.values(sql.raw('select name, hash from __mithaq_migrations')), [[migrations[0]!.name, 'patient-v1']])
  assert.equal(log.filter((sql) => sql === migrations[0]!.sql[0]).length, 1)
  assert.equal(log.filter((sql) => sql === 'begin').length, 2)
})

test('a failed migration rolls back every pending statement and history row, then a corrected boot can retry', async () => {
  const { database } = nodeSqlite()
  await assert.rejects(migrateSqlite({ ...database, migrations: [...migrations, { name: '20261026120100_broken', hash: 'broken', sql: ['insert into missing values (1)'] }] }), (error: Error) => /no such table: missing/.test(String(error.cause)))
  assert.deepEqual(await database.db.values(sql.raw("select name from sqlite_master where name in ('patient', '__mithaq_migrations')")), [])
  await migrateSqlite({ ...database, migrations })
  assert.deepEqual(await database.db.values(sql.raw('select name from __mithaq_migrations')), [[migrations[0]!.name]])
})

test('an older app refuses a newer database before applying anything and changed history is refused too', async () => {
  const { database } = nodeSqlite()
  const newer = { name: '20261026120200_note', hash: 'note-v1', sql: ['create table note (id integer primary key)'] }
  await migrateSqlite({ ...database, migrations: [...migrations, newer] })
  await assert.rejects(migrateSqlite({ ...database, migrations }), /newer migration.*20261026120200_note/)
  await assert.rejects(migrateSqlite({ ...database, migrations: [{ ...migrations[0]!, hash: 'changed' }, newer] }), /history.*20261026120000_patient/)
  assert.deepEqual(await database.db.values(sql.raw('select name from __mithaq_migrations order by name')), [[migrations[0]!.name], [newer.name]])
})

test('a parent-table rebuild preserves cascade children and restores foreign-key enforcement', async () => {
  const { database } = nodeSqlite()
  await migrateSqlite({ ...database, migrations })
  await database.db.run(sql`pragma foreign_keys = on`)
  await database.db.run(sql`create table note (id integer primary key, patient integer references patient(id) on delete cascade)`)
  await database.db.run(sql`insert into patient values (1, 'Huda')`)
  await database.db.run(sql`insert into note values (1, 1)`)
  await migrateSqlite({ ...database, migrations: [...migrations, { name: '20261026120300_rebuild', hash: 'rebuild', sql: [
    'PRAGMA foreign_keys=OFF',
    'create table new_patient (id integer primary key, name text not null, title text)',
    'insert into new_patient (id, name) select id, name from patient',
    'drop table patient',
    'alter table new_patient rename to patient',
    'PRAGMA foreign_keys=ON',
  ] }] })
  assert.deepEqual(await database.db.values(sql`select id, patient from note`), [[1, 1]])
  assert.deepEqual(await database.db.values(sql`pragma foreign_keys`), [[1]])
})

test('a dangling reference rolls back the migration and restores the original pragma after failure', async () => {
  const { database } = nodeSqlite()
  await migrateSqlite({ ...database, migrations })
  await database.db.run(sql`pragma foreign_keys = on`)
  await database.db.run(sql`insert into patient values (1, 'Huda')`)
  const broken = { name: '20261026120400_dangling', hash: 'dangling', sql: [
    'create table note (id integer primary key, patient integer references patient(id))',
    'insert into note values (1, 999)',
  ] }
  await assert.rejects(migrateSqlite({ ...database, migrations: [...migrations, broken] }), /dangling foreign-key/)
  assert.deepEqual(await database.db.values(sql`select name from sqlite_master where name = 'note'`), [])
  assert.deepEqual(await database.db.values(sql`select name from patient`), [['Huda']])
  assert.deepEqual(await database.db.values(sql`select name from __mithaq_migrations`), [[migrations[0]!.name]])
  assert.deepEqual(await database.db.values(sql`pragma foreign_keys`), [[1]])
  await database.db.run(sql`pragma foreign_keys = off`)
  await migrateSqlite({ ...database, migrations })
  assert.deepEqual(await database.db.values(sql`pragma foreign_keys`), [[0]])
})
