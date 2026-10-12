// A production start refuses a database a push built or one missing a migration, so the boot tests use
// this one, built by `drizzle-kit migrate`.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { binary } from '../packages/mithaq/src/drizzle/migrate.ts'
import { asas } from '../templates/asas/src/asas.ts'
import { testDatabase } from '../templates/asas/src/test-database.ts'

const template = fileURLToPath(new URL('../templates/asas/', import.meta.url))

// Drops the schema and migration history, so it only ever runs on the throwaway database a person named for this run (`testDatabase`).
export const migratedDatabase = async () => {
  testDatabase()
  await asas.targets.drizzle.db.execute('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;')
  const applied = spawnSync(process.execPath, [binary, 'migrate', '--config', 'src/migrations/drizzle.config.ts'], { cwd: template, encoding: 'utf8' })
  if (applied.status !== 0) throw new Error(`drizzle-kit migrate exits ${applied.status}\n${applied.stdout}\n${applied.stderr}`)
}
