import { sql } from 'drizzle-orm'
import { Refusal } from '../../mithaq/refusal.ts'
import type { SqliteContract } from './index.ts'

/** SQL and its build-time hash, bundled with the app so the device reads no files and needs no crypto. */
export type SqliteMigration = { name: string; hash: string; sql: readonly string[] }

/** Applies the pending history as one unit through the injected isolated transaction. */
export const migrateSqlite = async ({ db, transaction, migrations }: SqliteContract & { migrations: readonly SqliteMigration[] }) => {
  for (const [at, migration] of migrations.entries()) {
    if (!migration.name || !migration.hash || (at > 0 && migrations[at - 1]!.name >= migration.name)) {
      throw new Refusal('Device migrations need nonempty names and hashes in strictly increasing name order. Keep the complete generated history in the app.')
    }
  }
  // SQLite ignores foreign_keys changes inside a transaction; table rebuilds would cascade deletes.
  const [setting] = await db.values<[number]>(sql`pragma foreign_keys`)
  if (!setting) throw new Refusal('The device database did not report its foreign_keys setting.')
  const [foreignKeys] = setting
  try {
    await db.run(sql`pragma foreign_keys = off`)
    await transaction(async (tx) => {
      await tx.run(sql`create table if not exists __mithaq_migrations (name text primary key not null, hash text not null)`)
      const rows = await tx.values<[string, string]>(sql`select name, hash from __mithaq_migrations order by name`)
      for (const [at, [name, hash]] of rows.entries()) {
        if (typeof name === 'string' && (!migrations.length || name > migrations.at(-1)!.name)) {
          throw new Refusal(`The device database has newer migration ${name} than this app knows. Open it with the newer app.`)
        }
        if (migrations[at]?.name !== name || migrations[at]?.hash !== hash) {
          throw new Refusal(`The device migration history differs at ${String(name)}. Restore the complete, unchanged migration history before opening this database.`)
        }
      }
      for (const migration of migrations.slice(rows.length)) {
        for (const statement of migration.sql) if (statement.trim()) await tx.run(sql.raw(statement))
        await tx.run(sql`insert into __mithaq_migrations (name, hash) values (${migration.name}, ${migration.hash})`)
      }
      if ((await tx.values(sql`pragma foreign_key_check`)).length) {
        throw new Refusal('Device migrations leave dangling foreign-key references. Repair the migration before opening this database.')
      }
    })
  } finally {
    await db.run(sql.raw(`pragma foreign_keys = ${foreignKeys ? 'on' : 'off'}`))
  }
}
