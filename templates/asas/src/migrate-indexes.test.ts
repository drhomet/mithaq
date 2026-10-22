import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultIdField, defaultJoinLimit, defaultLimit, defaultMaxBodyBytes, defaultMaxLimit, defaultOperations, defineMithaq, drizzleAdapter, drizzleIdKinds, drizzleKinds, drizzleRules, fetchHttp, serviceTarget, zodIdKinds, zodKinds, zodRules, zodTarget } from 'mithaq'
import { pushInput } from '../../../packages/mithaq/src/drizzle/index.ts'
import { testDatabase } from './test-database.ts'

const { generateDrizzleJson, generateMigration } = await import(pathToFileURL(createRequire(new URL('../../../packages/mithaq/package.json', import.meta.url)).resolve('drizzle-kit/api-postgres')).href) as {
  generateDrizzleJson(imports: Record<string, unknown>): Promise<unknown>
  generateMigration(before: unknown, after: unknown): Promise<string[]>
}

test('a field index and a compound index beginning with that field both remain in generated SQL and Postgres', async () => {
  const language = defineMithaq({ arkan: [base], targets: {
    drizzle: drizzleAdapter({ connectionString: testDatabase(), idKinds: drizzleIdKinds, kinds: drizzleKinds, rules: drizzleRules }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ store: 'drizzle', schema: 'zod', depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, authorize: defaultAuthorize }),
  } })
  const tasks = language.defineKayan({ name: 'playbookTasks', dbName: 'playbook_tasks', schemaName: 'index_compatibility', indexes: [{ fields: ['playbook', 'sortOrder'] }], targets: { service: { operations: defaultOperations } }, fields: {
    ...defaultIdField,
    playbook: { kind: 'uuid', dbName: 'playbook_id', rules: { index: true } },
    sortOrder: { kind: 'integer' },
  } })
  const built = language.buildAsas({ kayan: [tasks], http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })] })
  const store = built.targets.drizzle
  try {
    const statements = await generateMigration(await generateDrizzleJson({}), await generateDrizzleJson(pushInput({ tables: store.tables as never, schemas: store.schemas }).imports))
    assert.deepEqual(statements.filter((sql) => sql.startsWith('CREATE INDEX')), [
      'CREATE INDEX "playbook_tasks_playbook_id_index" ON "index_compatibility"."playbook_tasks" ("playbook_id");',
      'CREATE INDEX "playbook_tasks_playbook_id_sort_order_idx" ON "index_compatibility"."playbook_tasks" ("playbook_id","sort_order");',
    ])
    for (const statement of statements) await store.db.execute(statement)
    const { rows } = await store.db.execute("select indexname from pg_indexes where schemaname = 'index_compatibility' and tablename = 'playbook_tasks' and indexname not like '%_pkey' order by indexname")
    assert.deepEqual(rows.map((row) => row.indexname), ['playbook_tasks_playbook_id_index', 'playbook_tasks_playbook_id_sort_order_idx'])
  } finally {
    await store.db.execute('drop schema if exists index_compatibility cascade')
    await built.destroy()
  }
})
