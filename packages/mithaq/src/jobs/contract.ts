import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
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
      const rows = await driver.claim({ queue: 'maintenance', tasks: ['sweep'], limit: 20, lease: 30000, token: crypto.randomUUID() })
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.task, 'sweep')
    } finally { await destroy() }
  })
  test('a recorded occurrence is immediately claimable even ahead of the driver clock', async () => {
    const { driver, destroy } = await factory()
    try {
      await driver.record({ task: 'ahead', queue: 'maintenance', scheduledFor: new Date(Date.now() + 1000), tenant: null })
      assert.deepEqual((await driver.claim({ queue: 'maintenance', tasks: ['ahead'], limit: 1, lease: 30000, token: crypto.randomUUID() })).map((job) => job.task), ['ahead'])
    } finally { await destroy() }
  })

  test('concurrent claimers never share a job, honor the limit and skip future or foreign work', async () => {
    const { driver, peer, transaction, destroy } = await factory()
    try {
      const now = new Date()
      for (let i = 0; i < 6; i++) await driver.record({ task: `due${i}`, queue: 'maintenance', scheduledFor: now, tenant: null })
      await transaction((tx) => driver.enqueue({ task: 'future', input: {}, queue: 'maintenance', runAt: new Date(now.getTime() + 60000), tenant: null, tx }))
      await driver.record({ task: 'tenant', queue: 'maintenance', scheduledFor: now, tenant: 'org-a' })
      await driver.record({ task: 'other', queue: 'other', scheduledFor: now, tenant: null })
      const [a, b] = await Promise.all([driver, peer].map((claimer) => claimer.claim({ queue: 'maintenance', tasks: ['due0', 'due1', 'due2', 'due3', 'due4', 'due5', 'future', 'tenant', 'other'], limit: 3, lease: 30000, token: crypto.randomUUID() })))
      assert.equal(a!.length, 3)
      assert.equal(b!.length, 3)
      assert.equal(new Set([...a!, ...b!].map((job) => job.id)).size, 6)
      assert.deepEqual(await driver.claim({ queue: 'maintenance', tasks: ['due0', 'due1', 'due2', 'due3', 'due4', 'due5', 'future', 'tenant', 'other'], limit: 10, lease: 30000, token: crypto.randomUUID() }), [])
    } finally { await destroy() }
  })

  test('claim leaves tasks unknown to this worker for another deployment', async () => {
    const { driver, peer, destroy } = await factory()
    try {
      for (const task of ['newDeployment', 'known']) await driver.record({ task, queue: 'maintenance', scheduledFor: new Date(), tenant: null })
      const claim = { queue: 'maintenance', tasks: ['known'], limit: 10, lease: 30000, token: crypto.randomUUID() }
      assert.deepEqual((await driver.claim(claim)).map((job) => job.task), ['known'])
      assert.deepEqual(await peer.claim({ ...claim, tasks: [] }), [])
      assert.deepEqual((await peer.claim({ ...claim, tasks: ['newDeployment'] })).map((job) => job.task), ['newDeployment'])
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
        assert.deepEqual(await driver.claim({ queue: 'maintenance', tasks: ['queued', 'rolledBack'], limit: 10, lease: 30000, token: crypto.randomUUID() }), [])
      })
      const claimed = await driver.claim({ queue: 'maintenance', tasks: ['queued', 'rolledBack'], limit: 10, lease: 30000, token: crypto.randomUUID() })
      assert.equal(claimed.length, 1)
      assert.equal(claimed[0]!.task, 'queued')
      assert.deepEqual(claimed[0]!.input, { count: 2 })
    } finally { await destroy() }
  })

  test('renewal fences stale tokens and completion is terminal', async () => {
    const { driver, transaction, destroy } = await factory()
    try {
      const now = new Date()
      const token = crypto.randomUUID()
      await transaction((tx) => driver.enqueue({ task: 'held', queue: 'maintenance', input: {}, runAt: now, tenant: null, tx }))
      const [job] = await driver.claim({ queue: 'maintenance', tasks: ['held'], limit: 1, lease: 30000, token })
      const stale = crypto.randomUUID()
      assert.deepEqual(await driver.renew({ ids: [job!.id], token: stale, lease: 30000 }), [])
      await driver.finish({ id: job!.id, token: stale, output: { deleted: 99 } })
      assert.deepEqual(await driver.renew({ ids: [job!.id], token, lease: 30000 }), [job!.id])
      await driver.finish({ id: job!.id, token, output: { deleted: 1 } })
      assert.deepEqual(await driver.renew({ ids: [job!.id], token, lease: 30000 }), [])
      assert.equal(await driver.expire(), 0)
      await setTimeout(5)
      assert.equal(await driver.prune({ completed: 0, failed: 10000 }), 1)
    } finally { await destroy() }
  })

  test('renewal keeps work held past its original deadline', async () => {
    const { driver, transaction, destroy } = await factory()
    try {
      const token = crypto.randomUUID()
      await transaction((tx) => driver.enqueue({ task: 'long', queue: 'maintenance', input: {}, runAt: new Date(), tenant: null, tx }))
      const [job] = await driver.claim({ queue: 'maintenance', tasks: ['long'], limit: 1, lease: 250, token })
      assert.deepEqual(await driver.renew({ ids: [job!.id], token, lease: 2000 }), [job!.id])
      await setTimeout(300)
      assert.equal(await driver.expire(), 0)
      await driver.finish({ id: job!.id, token, output: { completed: 1 } })
      await setTimeout(5)
      assert.equal(await driver.prune({ completed: 0, failed: 10000 }), 1)
    } finally { await destroy() }
  })

  test('expired work fails once, cannot renew or finish, and is never claimed again', async () => {
    const { driver, transaction, destroy } = await factory()
    try {
      const now = new Date(Date.now() - 60000)
      const token = crypto.randomUUID()
      await transaction((tx) => driver.enqueue({ task: 'interrupted', queue: 'maintenance', input: {}, runAt: now, tenant: null, tx }))
      const [job] = await driver.claim({ queue: 'maintenance', tasks: ['interrupted'], limit: 1, lease: 30, token })
      await setTimeout(60)
      assert.deepEqual(await driver.renew({ ids: [job!.id], token, lease: 30000 }), [])
      await driver.finish({ id: job!.id, token, output: {} })
      assert.equal(await driver.expire(), 1)
      assert.equal(await driver.expire(), 0)
      await driver.finish({ id: job!.id, token, output: {} })
      await setTimeout(5)
      assert.deepEqual(await driver.claim({ queue: 'maintenance', tasks: ['interrupted'], limit: 10, lease: 30000, token: crypto.randomUUID() }), [])
      assert.equal(await driver.prune({ completed: 0, failed: 10000 }), 0)
      assert.equal(await driver.prune({ completed: 10000, failed: 0 }), 1)
    } finally { await destroy() }
  })
  test('pruning measures retention on the driver clock and keeps fresh history', async (t) => {
    const { driver, transaction, destroy } = await factory()
    const hostNow = Date.now
    t.mock.method(Date, 'now', () => hostNow() + 60000)
    try {
      const token = crypto.randomUUID()
      for (const task of ['complete', 'failed']) await transaction((tx) => driver.enqueue({ task, queue: 'maintenance', input: {}, runAt: new Date(), tenant: null, tx }))
      const rows = await driver.claim({ queue: 'maintenance', tasks: ['complete', 'failed'], limit: 2, lease: 30000, token })
      await driver.finish({ id: rows[0]!.id, token, output: {} })
      await driver.finish({ id: rows[1]!.id, token, error: { message: 'failed' } })
      assert.equal(await driver.prune({ completed: 10000, failed: 10000 }), 0)
      await setTimeout(5)
      assert.equal(await driver.prune({ completed: 10000, failed: 0 }), 1)
      assert.equal(await driver.prune({ completed: 0, failed: 10000 }), 1)
    } finally { await destroy() }
  })

  test('pruning respects separate terminal ages and keeps pending and held work', async () => {
    const { driver, transaction, destroy } = await factory()
    try {
      const now = new Date()
      const token = crypto.randomUUID()
      for (const task of ['complete', 'failed', 'held', 'pending']) await transaction((tx) => driver.enqueue({ task, queue: 'maintenance', input: {}, runAt: now, tenant: null, tx }))
      const rows = await driver.claim({ queue: 'maintenance', tasks: ['complete', 'failed', 'held', 'pending'], limit: 3, lease: 30000, token })
      await driver.finish({ id: rows[0]!.id, token, output: {} })
      await driver.finish({ id: rows[1]!.id, token, error: { message: 'failed' } })
      await setTimeout(5)
      assert.equal(await driver.prune({ completed: 10000, failed: 10000 }), 0)
      assert.equal(await driver.prune({ completed: 0, failed: 10000 }), 1)
      assert.equal(await driver.prune({ completed: 10000, failed: 0 }), 1)
      assert.deepEqual(await driver.renew({ ids: [rows[2]!.id], token, lease: 30000 }), [rows[2]!.id])
      assert.equal((await driver.claim({ queue: 'maintenance', tasks: ['complete', 'failed', 'held', 'pending'], limit: 10, lease: 30000, token })).length, 1)
    } finally { await destroy() }
  })

  test('pruning keeps one task watermark and rejects equal or older occurrences', async () => {
    const { driver, peer, destroy } = await factory()
    try {
      const scheduledFor = new Date(Date.now() - 2000)
      const occurrence = { task: 'annual', queue: 'maintenance', scheduledFor, tenant: null }
      assert.equal(await driver.record(occurrence), true)
      const token = crypto.randomUUID()
      const [job] = await driver.claim({ queue: 'maintenance', tasks: ['annual'], limit: 1, lease: 30000, token })
      await driver.finish({ id: job!.id, token, output: {} })
      const retain = { completed: 0, failed: 0 }
      assert.equal(await driver.prune(retain), 0)
      const newer = { ...occurrence, scheduledFor: new Date(scheduledFor.getTime() + 1000) }
      const recorded = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? driver : peer).record(newer)))
      assert.equal(recorded.filter(Boolean).length, 1)
      const [next] = await driver.claim({ queue: 'maintenance', tasks: ['annual'], limit: 1, lease: 30000, token })
      await driver.finish({ id: next!.id, token, error: { message: 'failed' } })
      await setTimeout(5)
      assert.equal(await driver.prune(retain), 1)
      assert.equal(await driver.prune(retain), 0)
      assert.equal(await peer.record(occurrence), false)
      assert.equal(await peer.record({ ...occurrence, scheduledFor: new Date(scheduledFor.getTime() - 1000) }), false)
      assert.equal(await peer.record(newer), false)
      assert.equal(await peer.record({ ...newer, scheduledFor: new Date(newer.scheduledFor.getTime() + 1000) }), true)
    } finally { await destroy() }
  })

}
