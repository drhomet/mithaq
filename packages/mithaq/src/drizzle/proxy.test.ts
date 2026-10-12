// The proxy entries must re-export the drizzle copy the store imports, so a
// project's `pgTable` is the class the store checks and not a second copy.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as orm from 'drizzle-orm'
import * as nodePostgres from 'drizzle-orm/node-postgres'
import * as pgCore from 'drizzle-orm/pg-core'
import * as proxyOrm from './proxy/index.ts'
import * as proxyNodePostgres from './proxy/node-postgres.ts'
import * as proxyPgCore from './proxy/pg-core.ts'

test('each proxy entry is the module mithaq imports, so no second copy of drizzle can sit behind it', () => {
  assert.equal(proxyOrm.sql, orm.sql)
  assert.equal(proxyPgCore.PgTable, pgCore.PgTable)
  assert.equal(proxyNodePostgres.drizzle, nodePostgres.drizzle)
})
