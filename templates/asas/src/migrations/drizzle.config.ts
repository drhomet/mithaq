// Written by `mithaq migrate`. Commit it.
import { fileURLToPath } from 'node:url'
import { asas } from '../asas.ts'

export default {
  dialect: 'postgresql',
  schema: fileURLToPath(new URL('schema.ts', import.meta.url)),
  out: fileURLToPath(new URL('.', import.meta.url)),
  dbCredentials: { url: asas.targets.drizzle.connectionString },
  migrations: { schema: 'drizzle', table: '__mithaq_migrations' },
}
