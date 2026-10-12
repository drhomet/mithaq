// A project reaches drizzle through `mithaq/drizzle`, `mithaq/drizzle/pg-core` and
// `mithaq/drizzle/node-postgres`, never through a path into `node_modules`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  base,
  defaultAuthorize,
  defaultBulkLimit,
  defaultDepth,
  defaultFields,
  defaultJoinLimit,
  defaultLimit,
  defaultMaxLimit,
  defaultOperations,
  defineMithaq,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  fetchHttp,
  serviceTarget,
  zodTarget,
} from 'mithaq'
import { is, sql } from 'mithaq/drizzle'
import { drizzle } from 'mithaq/drizzle/node-postgres'
import { getTableConfig, pgEnum, PgTable, pgTable, text, unique, uuid } from 'mithaq/drizzle/pg-core'

const build = (table?: PgTable) => {
  const language = defineMithaq({
    targets: {
      drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
      zod: zodTarget,
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    },
    arkan: [base],
  })
  return language.buildAsas({
    http: [fetchHttp()],
    kayan: [
      language.defineKayan({
        name: 'notes',
        fields: { id: defaultFields.id, title: { kind: 'text' } },
        targets: { ...(table && { drizzle: table }), service: { operations: defaultOperations } },
      }),
    ],
  })
}

test('a table mithaq built is a PgTable of the re-exported module, so is() and instanceof agree', async () => {
  const built = build()
  const made = built.targets.drizzle.tables.notes
  assert.equal(is(made, PgTable), true)
  assert.equal(made instanceof PgTable, true)
  assert.equal(getTableConfig(made).name, 'notes')
  assert.equal(typeof sql`select 1`.getSQL, 'function')
  assert.equal(typeof drizzle, 'function')
  assert.equal(pgEnum('mood', ['happy']).enumName, 'mood')
  await built.destroy()
})

test('a whole table built with the re-exported pgTable is the table the store keeps', async () => {
  const own = pgTable('own_notes', { id: uuid('id').primaryKey(), title: text('title'), slug: text('slug') }, (table) => [unique('own_notes_title_slug').on(table.title, table.slug)])
  const built = build(own)
  assert.equal(built.targets.drizzle.tables.notes, own)
  assert.equal(getTableConfig(own).uniqueConstraints.length, 1)
  await built.destroy()
})
