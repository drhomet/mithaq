import { sql } from 'drizzle-orm'
import { Refusal } from '../../mithaq/refusal.ts'
import type { SqliteContract } from './index.ts'

/** SQL and its build-time hash, bundled with the app so the device reads no files and needs no crypto. */
export type SqliteMigration = { name: string; hash: string; folderMillis?: number; sql: readonly string[] }

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
      const history = sql`create table if not exists __mithaq_migrations (id integer primary key autoincrement, hash text not null, created_at integer, name text not null unique, applied_at integer)`
      await tx.run(history)
      const columns = await tx.values<[number, string]>(sql`pragma table_info(__mithaq_migrations)`)
      if (!columns.some(([, name]) => name === 'id')) {
        // Earlier device histories held no timestamps, so preserve them as unknown rather than inventing dates.
        await tx.run(sql`alter table __mithaq_migrations rename to __mithaq_migrations_legacy`)
        await tx.run(history)
        await tx.run(sql`insert into __mithaq_migrations (name, hash) select name, hash from __mithaq_migrations_legacy order by name`)
        await tx.run(sql`drop table __mithaq_migrations_legacy`)
      }
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
        await tx.run(sql`insert into __mithaq_migrations (name, hash, created_at, applied_at) values (${migration.name}, ${migration.hash}, ${migration.folderMillis ?? null}, ${Date.now()})`)
      }
      if ((await tx.values(sql`pragma foreign_key_check`)).length) {
        throw new Refusal('Device migrations leave dangling foreign-key references. Repair the migration before opening this database.')
      }
    })
  } finally {
    await db.run(sql.raw(`pragma foreign_keys = ${foreignKeys ? 'on' : 'off'}`))
  }
}
