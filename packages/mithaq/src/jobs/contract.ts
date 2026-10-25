import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { JobsDriver } from './driver.ts'

export type JobsDriverFactory = () => Promise<{
  driver: JobsDriver
  peer: JobsDriver
  transaction<Result>(run: (tx: unknown) => Promise<Result>): Promise<Result>
  destroy(): Promise<void>
}>

/** A driver runs this same behavioral contract, with fresh storage for each case. */
export const jobsContract = (factory: JobsDriverFactory) => {
  test('racing schedulers record one row per task and occurrence', async () => {
    const { driver, peer, destroy } = await factory()
    try {
      const occurrence = { task: 'sweep', queue: 'maintenance', scheduledFor: new Date(), tenant: null }
      const recorded = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? driver : peer).record(occurrence)))
      assert.equal(recorded.filter(Boolean).length, 1)
      const rows = await driver.claim({ queue: 'maintenance', limit: 20, lease: 30000, token: crypto.randomUUID(), now: new Date() })
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.task, 'sweep')
    } finally { await destroy() }
  })
  test('concurrent claimers never share a job, honor the limit and skip future or foreign work', async () => {
    const { driver, peer, destroy } = await factory()
    try {
      const now = new Date()
      for (let i = 0; i < 6; i++) await driver.record({ task: `due${i}`, queue: 'maintenance', scheduledFor: now, tenant: null })
      await driver.record({ task: 'future', queue: 'maintenance', scheduledFor: new Date(now.getTime() + 60000), tenant: null })
      await driver.record({ task: 'tenant', queue: 'maintenance', scheduledFor: now, tenant: 'org-a' })
      await driver.record({ task: 'other', queue: 'other', scheduledFor: now, tenant: null })
      const [a, b] = await Promise.all([driver, peer].map((claimer) => claimer.claim({ queue: 'maintenance', limit: 3, lease: 30000, token: crypto.randomUUID(), now })))
      assert.equal(a!.length, 3)
      assert.equal(b!.length, 3)
      assert.equal(new Set([...a!, ...b!].map((job) => job.id)).size, 6)
      assert.deepEqual(await driver.claim({ queue: 'maintenance', limit: 10, lease: 30000, token: crypto.randomUUID(), now }), [])
    } finally { await destroy() }
  })

  test('enqueue commits with its caller and a rollback leaves no job', async () => {
    const { driver, transaction, destroy } = await factory()
    try {
      const job = { task: 'queued', input: { count: 2 }, queue: 'maintenance', tenant: null, runAt: new Date() }
      await assert.rejects(transaction(async (tx) => {
        await driver.enqueue({ ...job, task: 'rolledBack', tx })
        throw new Error('rollback')
      }), /rollback/)
      await transaction(async (tx) => {
        await driver.enqueue({ ...job, tx })
        assert.deepEqual(await driver.claim({ queue: 'maintenance', limit: 10, lease: 30000, token: crypto.randomUUID(), now: new Date() }), [])
      })
      const claimed = await driver.claim({ queue: 'maintenance', limit: 10, lease: 30000, token: crypto.randomUUID(), now: new Date() })
      assert.equal(claimed.length, 1)
      assert.equal(claimed[0]!.task, 'queued')
      assert.deepEqual(claimed[0]!.input, { count: 2 })
    } finally { await destroy() }
  })

  test('renewal fences stale tokens and completion survives expiry', async () => {
    const { driver, destroy } = await factory()
    try {
      const now = new Date()
      const token = crypto.randomUUID()
      await driver.record({ task: 'held', queue: 'maintenance', scheduledFor: now, tenant: null })
      const [job] = await driver.claim({ queue: 'maintenance', limit: 1, lease: 30000, token, now })
      const stale = crypto.randomUUID()
      assert.deepEqual(await driver.renew({ ids: [job!.id], token: stale, lease: 30000 }), [])
      await driver.finish({ id: job!.id, token: stale, output: { deleted: 99 } })
      assert.deepEqual(await driver.renew({ ids: [job!.id], token, lease: 30000 }), [job!.id])
      await driver.finish({ id: job!.id, token, output: { deleted: 1 } })
      assert.deepEqual(await driver.renew({ ids: [job!.id], token, lease: 30000 }), [])
      assert.equal(await driver.expire({ now: new Date(now.getTime() + 60000) }), 0)
      assert.equal(await driver.prune({ completedBefore: new Date(Date.now() + 1000), failedBefore: new Date(0) }), 1)
    } finally { await destroy() }
  })

  test('expired work fails once, cannot renew or finish, and is never claimed again', async () => {
    const { driver, destroy } = await factory()
    try {
      const now = new Date(Date.now() - 60000)
      const token = crypto.randomUUID()
      await driver.record({ task: 'interrupted', queue: 'maintenance', scheduledFor: now, tenant: null })
      const [job] = await driver.claim({ queue: 'maintenance', limit: 1, lease: 10, token, now })
      assert.deepEqual(await driver.renew({ ids: [job!.id], token, lease: 30000 }), [])
      await driver.finish({ id: job!.id, token, output: {} })
      assert.equal(await driver.expire({ now: new Date() }), 1)
      assert.equal(await driver.expire({ now: new Date() }), 0)
      await driver.finish({ id: job!.id, token, output: {} })
      assert.deepEqual(await driver.claim({ queue: 'maintenance', limit: 10, lease: 30000, token: crypto.randomUUID(), now: new Date() }), [])
      assert.equal(await driver.prune({ completedBefore: new Date(Date.now() + 1000), failedBefore: new Date(0) }), 0)
      assert.equal(await driver.prune({ completedBefore: new Date(0), failedBefore: new Date(Date.now() + 1000) }), 1)
    } finally { await destroy() }
  })
  test('pruning respects separate terminal ages and keeps pending and held work', async () => {
    const { driver, destroy } = await factory()
    try {
      const now = new Date()
      const token = crypto.randomUUID()
      for (const task of ['complete', 'failed', 'held', 'pending']) await driver.record({ task, queue: 'maintenance', scheduledFor: now, tenant: null })
      const rows = await driver.claim({ queue: 'maintenance', limit: 3, lease: 30000, token, now })
      await driver.finish({ id: rows[0]!.id, token, output: {} })
      await driver.finish({ id: rows[1]!.id, token, error: { message: 'failed' } })
      assert.equal(await driver.prune({ completedBefore: new Date(0), failedBefore: new Date(0) }), 0)
      assert.equal(await driver.prune({ completedBefore: new Date(Date.now() + 1000), failedBefore: new Date(0) }), 1)
      assert.equal(await driver.prune({ completedBefore: new Date(0), failedBefore: new Date(Date.now() + 1000) }), 1)
      assert.deepEqual(await driver.renew({ ids: [rows[2]!.id], token, lease: 30000 }), [rows[2]!.id])
      assert.equal((await driver.claim({ queue: 'maintenance', limit: 10, lease: 30000, token, now })).length, 1)
    } finally { await destroy() }
  })

  test('pruning history never schedules a completed occurrence again', async () => {
    const { driver, peer, destroy } = await factory()
    try {
      const occurrence = { task: 'annual', queue: 'maintenance', scheduledFor: new Date(), tenant: null }
      await driver.record(occurrence)
      const token = crypto.randomUUID()
      const [job] = await driver.claim({ queue: 'maintenance', limit: 1, lease: 30000, token, now: new Date() })
      await driver.finish({ id: job!.id, token, output: {} })
      assert.equal(await driver.prune({ completedBefore: new Date(Date.now() + 1000), failedBefore: new Date(0) }), 1)
      assert.equal(await peer.record(occurrence), false)
    } finally { await destroy() }
  })

}
