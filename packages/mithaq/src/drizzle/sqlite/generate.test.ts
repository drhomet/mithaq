import { sql } from 'drizzle-orm'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { generateSqliteMigrations } from './generate.ts'
import { migrateSqlite } from './migrate.ts'
import { nodeSqlite } from './__fixtures__/node-sqlite.ts'

const core = import.meta.resolve('drizzle-orm/sqlite-core')

test('drizzle-kit generates SQLite migrations at build time, and their bundle upgrades device rows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mithaq-device-migrations-'))
  try {
    const schema = join(directory, 'schema.ts')
    const out = join(directory, 'migrations')
    await writeFile(schema, `import { sqliteTable, integer, text } from ${JSON.stringify(core)}\nexport const patient = sqliteTable('patient', { id: integer().primaryKey({autoIncrement:true}), name: text().notNull() })`)
    const first = await generateSqliteMigrations({ schema, out, name: 'patient' })
    assert.equal(first.length, 1)
    assert.ok(Number.isSafeInteger(first[0]!.folderMillis))
    assert.match(first[0]!.sql.join('\n'), /AUTOINCREMENT/)
    const { database } = nodeSqlite()
    await migrateSqlite({ ...database, migrations: first })
    await database.db.run(sql`insert into patient (name) values (${'Huda'})`)
    // Kit names folders to the second, so the next build must have a later timestamp.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await writeFile(schema, `import { sqliteTable, integer, text } from ${JSON.stringify(core)}\nexport const patient = sqliteTable('patient', { id: integer().primaryKey({autoIncrement:true}), name: text().notNull(), ward: text() })`)
    const next = await generateSqliteMigrations({ schema, out, name: 'ward' })
    assert.equal(next.length, 2)
    assert.deepEqual(next[0], first[0])
    await migrateSqlite({ ...database, migrations: next })
    await database.db.run(sql`update patient set ward = ${'ICU'}`)
    assert.deepEqual(await database.db.values(sql.raw('select name, ward from patient')), [['Huda', 'ICU']])
    assert.deepEqual(await generateSqliteMigrations({ schema, out, name: 'unchanged' }), next)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
