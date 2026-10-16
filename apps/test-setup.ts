// Before node:test starts parallel files, discard schemas their pushes may still inspect during a run.
import { serverTargets } from '../templates/mithaq/src/mithaq.ts'
import { testDatabase } from '../templates/asas/src/test-database.ts'

testDatabase()
const { drizzle } = serverTargets
try {
  const { rows } = await drizzle.db.execute("select nspname from pg_namespace where nspname ~ '^(auth_uuid|tenant_scope|json_kind)($|_)'")
  for (const { nspname } of rows as { nspname: string }[]) await drizzle.db.execute(`drop schema "${nspname.replaceAll('"', '""')}" cascade`)
} finally {
  await drizzle.destroy()
}
