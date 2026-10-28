import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { migrateDatabase, queryDatabase } from './migrate.support.ts'

test('the next migration test reclaims a dead run and preserves a live run', async () => {
  await migrateDatabase()
  const ended = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' })
  assert.equal(ended.status, 0)
  const nonce = randomBytes(4).toString('hex')
  const base = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  const deadMigration = `${base}_migrate_${ended.pid}_${nonce}`
  const liveMigration = `${base}_migrate_${process.pid}_${nonce}`
  const names = [deadMigration, liveMigration]
  try {
    for (const name of names) await queryDatabase({ statement: `create database "${name}"` })
    await migrateDatabase()
    const { rows } = await queryDatabase({ statement: `select datname from pg_database where datname in (${names.map((name) => `'${name}'`).join(', ')}) order by datname` })
    assert.deepEqual(rows, [{ datname: liveMigration }])
  } finally {
    for (const name of names) await queryDatabase({ statement: `drop database if exists "${name}" with (force)` })
  }
})
