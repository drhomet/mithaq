import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTableConfig } from 'mithaq/drizzle/pg-core'
import { asas } from './asas.ts'

test('comment threads use one index in tenant record field and creation order', () => {
  const table = getTableConfig(asas.targets.drizzle.tables.richTextThreads as never)
  assert.deepEqual(table.indexes.map(({ config }) => config.columns.map((column) => (column as { name: string }).name)), [
    ['organization_id', 'record_kayan', 'record_id', 'field', 'created_at'],
  ])
})
