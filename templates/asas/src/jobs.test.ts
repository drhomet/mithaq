import './test-storage-dir.ts'
import { asas as template } from './asas.ts'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultJoinLimit, defaultJobLease, defaultJobRetention, drizzleJobs, defaultLimit, defaultMaxBodyBytes, defaultMaxLimit, defineMithaq, drizzleAdapter, drizzleIdKinds, drizzleKinds, drizzleRules, fetchHttp, serviceTarget, zodIdKinds, zodKinds, zodRules, zodTarget, type JobTasks } from 'mithaq'
import { testDatabase } from './test-database.ts'

const builds: { destroy(): Promise<void> }[] = []
after(async () => { for (const build of builds) await build.destroy() })
const build = (tasks?: JobTasks, lease = defaultJobLease) => {
  const language = defineMithaq({
    arkan: [base],
    targets: {
      drizzle: drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds }),
      ...(tasks && { jobs: drizzleJobs({ lease, retain: defaultJobRetention }) }),
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: serviceTarget({ store: 'drizzle', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit }),
    },
  })
  const asas = language.buildAsas({ kayan: [], http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], ...(tasks && { tasks }) })
  builds.push(asas)
  return asas
}

test('jobs add a core table only to an opted-in build and never publish operations', async () => {
  const absent = build()
  const opted = build({})
  assert.equal(Object.hasOwn(absent.targets.drizzle.tables, 'mithaq_jobs'), false)
  assert.equal(Object.hasOwn(opted.targets.drizzle.tables, 'mithaq_jobs'), true)
  assert.deepEqual(opted.kayan, {})
  assert.equal(opted.operations.length, 0)
})

test('two schedulers enqueue the latest occurrence once and never backfill missed fires', async () => {
  const config: JobTasks = { scheduled: { run: async () => ({}), cron: '* * * * *', queue: 'storage' } }
  const first = build(config)
  const second = build(config)
  await first.connect()
  await first.targets.drizzle.db.execute('truncate mithaq_jobs')
  const now = new Date('2026-10-25T12:34:56Z')
  await Promise.all([first.jobs!.schedule({ queue: 'storage', now }), second.jobs!.schedule({ queue: 'storage', now })])
  const { rows } = await first.targets.drizzle.db.execute('select task, scheduled_for, tenant from mithaq_jobs')
  assert.equal(rows.length, 1)
  assert.equal(new Date(rows[0]!.scheduled_for as string).toISOString(), '2026-10-25T12:34:00.000Z')
  assert.equal(rows[0]!.tenant, null)
  await second.jobs!.schedule({ queue: 'storage', now: new Date('2026-10-25T12:40:00Z') })
  assert.equal((await first.targets.drizzle.db.execute('select id from mithaq_jobs')).rows.length, 2)
})

test('two runners claim a scheduled job once and record counts', async () => {
  let calls = 0
  const config: JobTasks = { claim: { run: async () => { calls++; return { deleted: 2 } }, cron: '@daily', queue: 'claim' } }
  const first = build(config)
  const second = build(config)
  await first.jobs!.schedule({ queue: 'claim' })
  const results = await Promise.all([first.jobs!.run({ queue: 'claim' }), second.jobs!.run({ queue: 'claim' })])
  assert.equal(calls, 1)
  assert.equal(results.reduce((sum, result) => sum + result.completed, 0), 1)
  const { rows } = await first.targets.drizzle.db.execute("select attempts, output, completed_at from mithaq_jobs where task = 'claim'")
  assert.equal(rows[0]!.attempts, 1)
  assert.deepEqual(rows[0]!.output, { deleted: 2 })
  assert.ok(rows[0]!.completed_at)
})

test('a throwing handler fails its job without killing the runner or leaking its error to logs', async () => {
  const asas = build({ throwing: { run: async () => { throw new Error('private filename') }, cron: '@daily', queue: 'throwing' } })
  await asas.jobs!.schedule({ queue: 'throwing' })
  const logged: unknown[] = []
  const original = console.error
  console.error = (value) => { logged.push(value) }
  try { assert.deepEqual(await asas.jobs!.run({ queue: 'throwing' }), { completed: 0, failures: 1 }) }
  finally { console.error = original }
  assert.equal(JSON.stringify(logged).includes('private filename'), false)
  const { rows } = await asas.targets.drizzle.db.execute("select has_error, error from mithaq_jobs where task = 'throwing'")
  assert.equal(rows[0]!.has_error, true)
  assert.deepEqual(rows[0]!.error, { message: 'private filename' })
})

test('an expired lease with no retries fails as interrupted and is never executed again', async () => {
  let calls = 0
  const asas = build({ expired: { run: async () => { calls++; return {} }, cron: '@daily', queue: 'expired' } })
  await asas.jobs!.schedule({ queue: 'expired' })
  await asas.targets.drizzle.db.execute("update mithaq_jobs set attempts = 1, processing_token = gen_random_uuid(), processing_until = now() - interval '1 second' where task = 'expired'")
  await asas.jobs!.run({ queue: 'expired' })
  assert.equal(calls, 0)
  const { rows } = await asas.targets.drizzle.db.execute("select has_error, error from mithaq_jobs where task = 'expired'")
  assert.equal(rows[0]!.has_error, true)
  assert.deepEqual(rows[0]!.error, { message: 'Job interrupted after its lease expired.' })
})

test('the heartbeat protects a handler that runs longer than its lease', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const config: JobTasks = { heartbeat: { run: async () => { entered.resolve(); await release.promise; return { kept: 1 } }, cron: '@daily', queue: 'heartbeat' } }
  const first = build(config, 300)
  const second = build(config, 300)
  await first.jobs!.schedule({ queue: 'heartbeat' })
  const running = first.jobs!.run({ queue: 'heartbeat' })
  await entered.promise
  try {
    await new Promise((resolve) => setTimeout(resolve, 650))
    assert.deepEqual(await second.jobs!.run({ queue: 'heartbeat' }), { completed: 0, failures: 0 })
  } finally { release.resolve() }
  assert.deepEqual(await running, { completed: 1, failures: 0 })
})

test('connect starts work only when requested and destroy waits for an in-flight timer tick', async () => {
  let calls = 0
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const config: JobTasks = { timer: { run: async () => { calls++; entered.resolve(); await release.promise; return {} }, cron: '* * * * * *', queue: 'timer' } }
  const reader = build(config)
  await reader.connect({ readOnly: true })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  assert.equal(calls, 0)
  await reader.destroy()
  builds.splice(builds.indexOf(reader), 1)
  const writer = build(config)
  await writer.connect({ work: ['timer'] })
  await Promise.race([entered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Timer never ran.')), 2500).unref())])
  let destroyed = false
  const destroying = writer.destroy().then(() => { destroyed = true })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(destroyed, false)
  release.resolve()
  await destroying
  builds.splice(builds.indexOf(writer), 1)
  assert.equal(calls, 1)
})

test('a database blip is caught and the next tick can run', async () => {
  let calls = 0
  const asas = build({ blip: { run: async () => { calls++; return {} }, cron: '@daily', queue: 'blip' } })
  const { db } = asas.targets.drizzle
  await db.execute('alter table mithaq_jobs rename to mithaq_jobs_unavailable')
  try { assert.deepEqual(await asas.jobs!.run({ queue: 'blip' }), { completed: 0, failures: 1 }) }
  finally { await db.execute('alter table mithaq_jobs_unavailable rename to mithaq_jobs') }
  assert.deepEqual(await asas.jobs!.run({ queue: 'blip' }), { completed: 1, failures: 0 })
  assert.equal(calls, 1)
})


test('the template forwards jobs through its guarded store into the generated schema', () => {
  assert.ok(template.jobs)
  assert.equal(Object.hasOwn(template.targets.drizzle.tables, 'mithaq_jobs'), true)
})
