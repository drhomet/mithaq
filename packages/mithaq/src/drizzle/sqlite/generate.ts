import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { binary, kitOrm, ownKit } from '../migrate.ts'
import type { SqliteMigration } from './migrate.ts'

/** Build-time only: commit the returned SQL bundle beside drizzle-kit's folders; import only the bundle on the device. */
export const generateSqliteMigrations = async ({ schema, out, name }: { schema: string; out: string; name: string }): Promise<SqliteMigration[]> => {
  if (!/^[a-z0-9_]{1,64}$/.test(name)) throw new Error('A SQLite migration name is 1 to 64 lowercase letters, digits or underscores.')
  const directory = await mkdtemp(join(tmpdir(), 'mithaq-sqlite-kit-'))
  try {
    const config = join(directory, 'drizzle.config.mjs')
    await writeFile(config, `export default ${JSON.stringify({ dialect: 'sqlite', schema: resolve(schema), out: resolve(out) })}`)
    await promisify(execFile)(process.execPath, ['--import', kitOrm(ownKit), binary, 'generate', '--config', config, '--name', name], { maxBuffer: 4 * 1024 * 1024 })
    return readMigrationFiles({ migrationsFolder: resolve(out) }).map(({ name, hash, folderMillis, sql }) => ({ name, hash, folderMillis, sql }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
