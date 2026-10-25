import assert from 'node:assert/strict'
import { test } from 'node:test'
import { memoryJobs, memoryTransactions } from '../memory/jobs.ts'
import { buildJobs } from './jobs.ts'

test('the generic worker runs memory jobs and prunes every pass without rescheduling old work', async () => {
  const target = memoryJobs({ lease: 30000, retain: { completed: 1, failed: 1 } })
  const driver = target.driver.init(memoryTransactions())
  let calls = 0
  const worker = buildJobs({ target: { ...target, driver }, tasks: { sweep: { cron: '@daily', queue: 'maintenance', run: async () => { calls++; return { removed: 1 } } } }, asas: () => ({}) })
  try {
    assert.deepEqual(await worker.api.run({ queue: 'maintenance' }), { completed: 1, failures: 0 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual(await worker.api.run({ queue: 'maintenance' }), { completed: 0, failures: 0 })
    assert.equal(calls, 1)
    assert.equal(await driver.prune({ completed: 0, failed: 0 }), 0)
  } finally { await worker.stop() }
})
