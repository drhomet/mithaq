// The race itself, two writers holding one read, is in asas.test.ts beside the
// template's own `tags`, which needs Postgres's row lock. Every test here runs on
// the in-memory store, so none needs a database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import {
  AsasError,
  base,
  defaultAuthorize,
  defaultDepth,
  defaultLimit,
  defaultMaxLimit,
  defaultJoinLimit,
  defaultBulkLimit,
  defaultFields,
  defaultOperations,
  defineMithaq,
  fetchHttp,
  zodTarget,
} from 'mithaq'
import { orpcHttp } from 'mithaq/orpc'
import { memoryStore } from '../memory-store.ts'
import { expectedUpdatedAt } from './expected-updated-at.ts'

const allowAccess = { create: () => true, read: () => true, update: () => true, delete: () => true } as const

/** A kayan listing the step, with the key as required or as optional as the schema it is given. */
const build = <Expected extends z.ZodType<Date | undefined>>(expected: Expected) => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: store,
      zod: zodTarget,
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
    },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp(), orpcHttp({ api: '/api/orpc' })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' }, updatedAt: defaultFields.updatedAt },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              update: {
                input: ({ update }) => update.extend({ expectedUpdatedAt: expected }),
                steps: ({ steps }) => [expectedUpdatedAt, steps.update],
              },
            },
          },
        },
      }),
    ],
  })
  const rows = () => structuredClone(store.rows.get('notes') ?? [])
  return { built, notes: built.kayan.notes.operations, rows }
}

const refused = (promise: Promise<unknown>) => promise.then(() => assert.fail('the write was not refused'), (thrown: unknown) => thrown as AsasError)

test('a matching expectedUpdatedAt updates the row and moves updatedAt', async () => {
  const { notes } = build(z.date())
  const made = await notes.create({ id: 1, body: 'first' })
  await setTimeout(2)
  const changed = await notes.update({ id: 1, body: 'second', expectedUpdatedAt: made.updatedAt })
  assert.equal(changed.body, 'second')
  assert.ok(changed.updatedAt.getTime() > made.updatedAt.getTime(), 'the moment the caller read is replaced by the write\'s own')
})

test('a stale expectedUpdatedAt answers 409 error.conflict.stale and writes nothing', async () => {
  const { notes, rows } = build(z.date())
  const made = await notes.create({ id: 1, body: 'first' })
  await setTimeout(2)
  await notes.update({ id: 1, body: 'by the other writer', expectedUpdatedAt: made.updatedAt })
  const held = rows()
  const error = await refused(notes.update({ id: 1, body: 'by the late writer', expectedUpdatedAt: made.updatedAt }))
  assert.ok(error instanceof AsasError)
  assert.equal(error.status, 409)
  assert.equal(error.key, 'error.conflict.stale')
  assert.deepEqual(error.params, { kayan: 'notes' })
  assert.deepEqual(rows(), held, 'the row is as the other writer left it')
})

test('a kayan whose input requires expectedUpdatedAt refuses an update that sends none, and writes nothing', async () => {
  const { notes, rows } = build(z.date())
  await notes.create({ id: 1, body: 'first' })
  const held = rows()
  const error = await refused(notes.update({ id: 1, body: 'blind' } as never))
  assert.ok(error instanceof AsasError)
  assert.equal(error.status, 400)
  assert.deepEqual(rows(), held)
})

test('a kayan with no updatedAt field that lists the step refuses every update and names the kayan', async () => {
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget,
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
    },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp()],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: { ...defaultOperations, update: { input: ({ update }) => update.extend({ expectedUpdatedAt: z.date().optional() }), steps: ({ steps }) => [expectedUpdatedAt, steps.update] } } } },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'first' })
  await assert.rejects(built.kayan.notes.operations.update({ id: 1, body: 'second' }), /Kayan "notes" lists expectedUpdatedAt but has no updatedAt field/)
})

test('a kayan whose input leaves expectedUpdatedAt optional updates a caller who sends none', async () => {
  const { notes } = build(z.date().optional())
  await notes.create({ id: 1, body: 'first' })
  assert.equal((await notes.update({ id: 1, body: 'second' })).body, 'second')
})

test('expectedUpdatedAt is never a column: the stored row and the answer carry no such key', async () => {
  const { notes, rows } = build(z.date())
  const made = await notes.create({ id: 1, body: 'first' })
  const changed = await notes.update({ id: 1, body: 'second', expectedUpdatedAt: made.updatedAt })
  assert.ok(!('expectedUpdatedAt' in changed))
  assert.ok(rows().every((row) => !('expectedUpdatedAt' in row)))
})

test('a row that is not there is a 404 and not a 409', async () => {
  const { notes } = build(z.date())
  const error = await refused(notes.update({ id: 9, body: 'nobody', expectedUpdatedAt: new Date() }))
  assert.ok(error instanceof AsasError)
  assert.equal(error.status, 404)
})

test('both plugs: a stale instant is a 409 carrying the key, a matching one is a 200', async () => {
  const { built, notes, rows } = build(z.date())
  const made = await notes.create({ id: 1, body: 'first' })
  await setTimeout(2)
  await notes.update({ id: 1, body: 'other', expectedUpdatedAt: made.updatedAt })
  for (const path of ['/api/notes/update', '/api/orpc/notes/update']) {
    const held = rows()
    const stale = await built.handler(new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, body: 'late', expectedUpdatedAt: made.updatedAt.toISOString() }),
    }))
    assert.equal(stale.status, 409, path)
    const body = (await stale.json()) as { code?: string; data?: unknown; json?: { code?: string; data?: unknown } }
    assert.equal((body.json ?? body).code, 'CONFLICT', path)
    assert.deepEqual((body.json ?? body).data, { key: 'error.conflict.stale', params: { kayan: 'notes' } }, path)
    assert.deepEqual(rows(), held, `${path} wrote nothing`)

    const current = held[0]!.updatedAt as Date
    const fresh = await built.handler(new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, body: path, expectedUpdatedAt: current.toISOString() }),
    }))
    assert.equal(fresh.status, 200, path)
    await fresh.body?.cancel()
    await setTimeout(2)
  }
})

test('updateMany writes each row through update: a kayan that requires the key refuses it with a 400 before any row is written', async () => {
  const { notes, rows } = build(z.date())
  await notes.create({ id: 1, body: 'first' })
  const held = rows()
  const error = await refused(notes.updateMany({ where: { id: { equals: 1 } }, data: { body: 'bulk' } }))
  assert.ok(error instanceof AsasError)
  assert.equal(error.status, 400)
  assert.deepEqual(rows(), held)
})

test('updateMany on a kayan that leaves the key optional runs unguarded and writes every row', async () => {
  const { notes } = build(z.date().optional())
  await notes.create({ id: 1, body: 'first' })
  const done = await notes.updateMany({ where: { id: { equals: 1 } }, data: { body: 'bulk' } })
  assert.equal(done.docs.length, 1)
})
