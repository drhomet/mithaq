// Before node:test starts parallel files, discard schemas their pushes may still inspect during a run.
// Known exceptions: asas.test.ts alone resets public before its builds and app for its enum-push tests.
import { drizzleAdapter, drizzleKinds, drizzleRules } from '../packages/mithaq/src/index.ts'
import { testDatabase } from '../templates/asas/src/test-database.ts'

const drizzle = drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules })
try {
  const { rows } = await drizzle.db.execute("select nspname from pg_namespace where nspname ~ '^(auth_uuid|tenant_scope|json_kind|payload_password)($|_)'")
  for (const { nspname } of rows as { nspname: string }[]) await drizzle.db.execute(`drop schema "${nspname.replaceAll('"', '""')}" cascade`)
} finally {
  await drizzle.destroy()
}
