import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { jobsContract } from '../jobs/contract.ts'
import { drizzleJobs } from './jobs.ts'
import { drizzleAdapter } from './index.ts'
import { drizzleIdKinds, drizzleKinds, drizzleRules } from '../targets.ts'
import { testDatabase } from '../../../../templates/asas/src/test-database.ts'

jobsContract(async () => {
  const adapter = drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds })
  const store = adapter.init([], { jobs: true }) as typeof adapter
  await store.connect()
  await store.db.execute('truncate mithaq_jobs')
  return { driver: drizzleJobs({ lease: 30000, retain: { completed: 1000, failed: 1000 } }).driver.init(store), peer: drizzleJobs({ lease: 30000, retain: { completed: 1000, failed: 1000 } }).driver.init(store), transaction: store.transaction, destroy: store.destroy }
})
// The contract cannot pause inside a record; this trigger reproduces PostgreSQL's stale statement snapshot.
test('a paused scheduler never resurrects an occurrence completed and pruned by its peer', async () => {
  const adapter = drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds })
  const store = adapter.init([], { jobs: true }) as typeof adapter
  const pool = new Pool({ connectionString: testDatabase(), max: 3 })
  const schema = `jobs_race_${crypto.randomUUID().replaceAll('-', '')}`
  const clients = await Promise.all(Array.from({ length: 3 }, () => pool.connect()))
  const [control, first, peer] = clients
  let recording: Promise<boolean> | undefined
  let working: Promise<boolean> | undefined
  try {
    await store.connect()
    await control!.query(`create schema "${schema}"; create table "${schema}".mithaq_jobs (like public.mithaq_jobs including all)`)
    await control!.query(`create function "${schema}".pause_insert() returns trigger language plpgsql as $$
      begin
        if current_setting('jobs.pause', true) = 'yes' then perform pg_advisory_xact_lock(732761894); end if;
        return new;
      end $$;
      create trigger pause_insert before insert on "${schema}".mithaq_jobs for each row execute function "${schema}".pause_insert()`)
    for (const client of [first!, peer!]) await client.query(`set search_path to "${schema}"`)
    await first!.query("set jobs.pause = 'yes'")
    const bind = (client: NonNullable<typeof first>) => {
      const db = drizzle({ client })
      const store = { type: 'drizzle', sql: 'drizzle' as const, db, tables: { mithaq_jobs: {} }, transaction: db.transaction.bind(db) }
      return drizzleJobs({ lease: 30000, retain: { completed: 0, failed: 0 } }).driver.init(store)
    }
    const scheduler = bind(first!)
    const worker = bind(peer!)
    const occurrence = { task: 'paused', queue: 'maintenance', tenant: null, scheduledFor: new Date(Date.now() - 2000) }
    const firstPid = (await first!.query('select pg_backend_pid() as pid')).rows[0].pid
    const peerPid = (await peer!.query('select pg_backend_pid() as pid')).rows[0].pid
    const waiting = async (pid: number) => (await control!.query('select wait_event from pg_stat_activity where pid = $1', [pid])).rows[0]?.wait_event === 'advisory'
    await control!.query('begin')
    await control!.query('select pg_advisory_xact_lock(732761894)')
    recording = scheduler.record(occurrence)
    for (let i = 0; i < 200 && !await waiting(firstPid); i++) await setTimeout(10)
    assert.equal(await waiting(firstPid), true, 'the first scheduler reached its paused insert')
    let finished = false
    working = (async () => {
      const recorded = await worker.record(occurrence)
      assert.equal(await worker.record({ ...occurrence, scheduledFor: new Date(occurrence.scheduledFor.getTime() + 1000) }), true)
      const token = crypto.randomUUID()
      const jobs = await worker.claim({ queue: 'maintenance', tasks: ['paused'], limit: 10, lease: 30000, token })
      assert.equal(jobs.length, 2)
      for (const job of jobs) await worker.finish({ id: job.id, token, output: { done: 1 } })
      await setTimeout(5)
      assert.equal(await worker.prune({ completed: 0, failed: 0 }), 1)
      return recorded
    })().finally(() => { finished = true })
    // A serialized peer waits for the first scheduler; an unfenced peer completes before it resumes.
    for (let i = 0; i < 200 && !finished && !await waiting(peerPid); i++) await setTimeout(10)
    assert.ok(finished || await waiting(peerPid), 'the peer completed or is waiting for the scheduler')
    await control!.query('commit')
    const recorded = await Promise.all([recording, working])
    assert.equal(recorded.filter(Boolean).length, 1, 'a pruned occurrence must never be recorded twice')
    assert.deepEqual(await worker.claim({ queue: 'maintenance', tasks: ['paused'], limit: 10, lease: 30000, token: crypto.randomUUID() }), [])
  } finally {
    await control!.query('rollback')
    await Promise.allSettled([recording, working])
    await control!.query(`drop schema if exists "${schema}" cascade`)
    for (const client of clients) client.release()
    await pool.end()
    await store.destroy()
  }
})

test('a scheduler on a database whose default isolation is repeatable read still sees the occurrence a peer committed while it waited for the task', async () => {
  const adapter = drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds })
  const store = adapter.init([], { jobs: true }) as typeof adapter
  const pool = new Pool({ connectionString: testDatabase(), max: 2 })
  const schema = `jobs_isolation_${crypto.randomUUID().replaceAll('-', '')}`
  const [control, first] = await Promise.all([pool.connect(), pool.connect()])
  let recording: Promise<boolean> | undefined
  try {
    await store.connect()
    await control.query(`create schema "${schema}"; create table "${schema}".mithaq_jobs (like public.mithaq_jobs including all)`)
    for (const client of [control, first]) await client.query(`set search_path to "${schema}"`)
    // As a database or role configured with this default would hand every transaction.
    await first.query("set default_transaction_isolation = 'repeatable read'")
    const db = drizzle({ client: first })
    const scheduler = drizzleJobs({ lease: 30000, retain: { completed: 0, failed: 0 } }).driver.init({ type: 'drizzle', sql: 'drizzle', db, tables: { mithaq_jobs: {} }, transaction: db.transaction.bind(db) } as never)
    const scheduledFor = new Date(Date.now() - 2000)
    const pid = (await first.query('select pg_backend_pid() as pid')).rows[0].pid
    const waiting = async () => (await control.query('select wait_event from pg_stat_activity where pid = $1', [pid])).rows[0]?.wait_event === 'advisory'
    // The peer holds the task while it records the next occurrence, the watermark a completed and pruned one leaves.
    await control.query('begin')
    await control.query("select pg_advisory_xact_lock(hashtext('mithaq_jobs:isolated'))")
    recording = scheduler.record({ task: 'isolated', queue: 'maintenance', tenant: null, scheduledFor })
    for (let i = 0; i < 200 && !await waiting(); i++) await setTimeout(10)
    assert.equal(await waiting(), true, 'the scheduler waits for the task')
    await control.query("insert into mithaq_jobs (task, input, queue, scheduled_for) values ('isolated', '{}'::jsonb, 'maintenance', $1)", [new Date(scheduledFor.getTime() + 1000)])
    await control.query('commit')
    assert.equal(await recording, false, 'an occurrence older than one already recorded is never recorded')
    assert.deepEqual((await control.query("select scheduled_for from mithaq_jobs where task = 'isolated'")).rows.length, 1)
  } finally {
    await control.query('rollback')
    await Promise.allSettled([recording])
    await control.query(`drop schema if exists "${schema}" cascade`)
    control.release()
    first.release()
    await pool.end()
    await store.destroy()
  }
})
