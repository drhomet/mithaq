import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultJoinLimit, defaultJobLease, defaultLimit, defaultMaxBodyBytes, defaultMaxLimit, defineMithaq, drizzleAdapter, drizzleIdKinds, drizzleKinds, drizzleRules, fetchHttp, serviceTarget, zodIdKinds, zodKinds, zodRules, zodTarget, type JobsConfig } from 'mithaq'
import { testDatabase } from './test-database.ts'

const builds: { destroy(): Promise<void> }[] = []
after(async () => { for (const build of builds) await build.destroy() })
const build = (jobs?: JobsConfig) => {
  const language = defineMithaq({
    arkan: [base],
    targets: {
      drizzle: drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds }),
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: serviceTarget({ store: 'drizzle', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit }),
    },
  })
  const asas = language.buildAsas({ kayan: [], http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], ...(jobs && { jobs }) })
  builds.push(asas)
  return asas
}

test('jobs add a core table only to an opted-in build and never publish operations', async () => {
  const absent = build()
  const opted = build({ tasks: [], autoRun: [], lease: defaultJobLease })
  assert.equal(Object.hasOwn(absent.targets.drizzle.tables, 'mithaq_jobs'), false)
  assert.equal(Object.hasOwn(opted.targets.drizzle.tables, 'mithaq_jobs'), true)
  assert.deepEqual(opted.kayan, {})
  assert.equal(opted.operations.length, 0)
})

test('two schedulers enqueue the latest occurrence once and never backfill missed fires', async () => {
  const config: JobsConfig = { tasks: [{ slug: 'scheduled', handler: async () => ({}), schedule: [{ cron: '* * * * *', queue: 'storage' }], retries: 0 }], autoRun: [], lease: defaultJobLease }
  const first = build(config)
  const second = build(config)
  await first.connect()
  await first.targets.drizzle.db.execute('truncate mithaq_jobs')
  const now = new Date('2026-10-25T12:34:56Z')
  await Promise.all([first.jobs!.handleSchedules({ queue: 'storage', now }), second.jobs!.handleSchedules({ queue: 'storage', now })])
  const { rows } = await first.targets.drizzle.db.execute('select task, scheduled_for, tenant from mithaq_jobs')
  assert.equal(rows.length, 1)
  assert.equal(new Date(rows[0]!.scheduled_for as string).toISOString(), '2026-10-25T12:34:00.000Z')
  assert.equal(rows[0]!.tenant, null)
  await second.jobs!.handleSchedules({ queue: 'storage', now: new Date('2026-10-25T12:40:00Z') })
  assert.equal((await first.targets.drizzle.db.execute('select id from mithaq_jobs')).rows.length, 2)
})

test('two runners claim a scheduled job once and record counts', async () => {
  let calls = 0
  const config: JobsConfig = { tasks: [{ slug: 'claim', handler: async () => { calls++; return { deleted: 2 } }, schedule: [{ cron: '@daily', queue: 'claim' }], retries: 0 }], autoRun: [], lease: defaultJobLease }
  const first = build(config)
  const second = build(config)
  await first.jobs!.handleSchedules({ queue: 'claim' })
  const results = await Promise.all([first.jobs!.runJobs({ queue: 'claim', limit: 1 }), second.jobs!.runJobs({ queue: 'claim', limit: 1 })])
  assert.equal(calls, 1)
  assert.equal(results.reduce((sum, result) => sum + result.completed, 0), 1)
  const { rows } = await first.targets.drizzle.db.execute("select attempts, output, completed_at from mithaq_jobs where task = 'claim'")
  assert.equal(rows[0]!.attempts, 1)
  assert.deepEqual(rows[0]!.output, { deleted: 2 })
  assert.ok(rows[0]!.completed_at)
})

test('a throwing handler fails its job without killing the runner or leaking its error to logs', async () => {
  const asas = build({ tasks: [{ slug: 'throwing', handler: async () => { throw new Error('private filename') }, schedule: [{ cron: '@daily', queue: 'throwing' }], retries: 0 }], autoRun: [], lease: defaultJobLease })
  await asas.jobs!.handleSchedules({ queue: 'throwing' })
  const logged: unknown[] = []
  const original = console.error
  console.error = (value) => { logged.push(value) }
  try { assert.deepEqual(await asas.jobs!.runJobs({ queue: 'throwing', limit: 1 }), { completed: 0, failures: 1 }) }
  finally { console.error = original }
  assert.equal(JSON.stringify(logged).includes('private filename'), false)
  const { rows } = await asas.targets.drizzle.db.execute("select has_error, error from mithaq_jobs where task = 'throwing'")
  assert.equal(rows[0]!.has_error, true)
  assert.deepEqual(rows[0]!.error, { message: 'private filename' })
})

test('an expired lease with no retries fails as interrupted and is never executed again', async () => {
  let calls = 0
  const asas = build({ tasks: [{ slug: 'expired', handler: async () => { calls++; return {} }, schedule: [{ cron: '@daily', queue: 'expired' }], retries: 0 }], autoRun: [], lease: defaultJobLease })
  await asas.jobs!.handleSchedules({ queue: 'expired' })
  await asas.targets.drizzle.db.execute("update mithaq_jobs set attempts = 1, processing_token = gen_random_uuid(), processing_until = now() - interval '1 second' where task = 'expired'")
  await asas.jobs!.runJobs({ queue: 'expired', limit: 1 })
  assert.equal(calls, 0)
  const { rows } = await asas.targets.drizzle.db.execute("select has_error, error from mithaq_jobs where task = 'expired'")
  assert.equal(rows[0]!.has_error, true)
  assert.deepEqual(rows[0]!.error, { message: 'Job interrupted after its lease expired.' })
})

test('the heartbeat protects a handler that runs longer than its lease', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const config: JobsConfig = { tasks: [{ slug: 'heartbeat', handler: async () => { entered.resolve(); await release.promise; return { kept: 1 } }, schedule: [{ cron: '@daily', queue: 'heartbeat' }], retries: 0 }], autoRun: [], lease: 300 }
  const first = build(config)
  const second = build(config)
  await first.jobs!.handleSchedules({ queue: 'heartbeat' })
  const running = first.jobs!.runJobs({ queue: 'heartbeat', limit: 1 })
  await entered.promise
  try {
    await new Promise((resolve) => setTimeout(resolve, 650))
    assert.deepEqual(await second.jobs!.runJobs({ queue: 'heartbeat', limit: 1 }), { completed: 0, failures: 0 })
  } finally { release.resolve() }
  assert.deepEqual(await running, { completed: 1, failures: 0 })
})

test('readOnly starts no timers and destroy waits for an in-flight timer tick', async () => {
  let calls = 0
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const config: JobsConfig = { tasks: [{ slug: 'timer', handler: async () => { calls++; entered.resolve(); await release.promise; return {} }, schedule: [{ cron: '* * * * * *', queue: 'timer' }], retries: 0 }], autoRun: [{ cron: '* * * * * *', queue: 'timer', limit: 1 }], lease: defaultJobLease }
  const reader = build(config)
  await reader.connect({ readOnly: true })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  assert.equal(calls, 0)
  await reader.destroy()
  builds.splice(builds.indexOf(reader), 1)
  const writer = build(config)
  await writer.connect()
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
