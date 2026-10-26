import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineMithaq as deviceLanguage, base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, serviceTarget, sqliteAdapter, drizzleSqliteKinds, drizzleSqliteRules, drizzleSqliteIdKinds, zodTarget, zodKinds, zodRules, zodIdKinds, type Ctx } from '../../device.ts'
import { defineMithaq as serverLanguage, fetchHttp, defaultMaxBodyBytes, type Kayan } from '../../index.ts'
import { nodeSqlite } from '../../drizzle/sqlite/__fixtures__/node-sqlite.ts'
import { memoryStore } from '../../../../../templates/asas/src/memory-store.ts'
import type { RuntimeWriteTools } from './steps.ts'

type Call = (input?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>
type Built = { kayan: Record<string, { operations: Record<string, Call> }>; connect(): Promise<void> }

const setup = ({ device, afterCommit = [], beforeSteps = [], operations = defaultOperations, depth = defaultDepth, crossStore = false, limits = {} }: {
  device: boolean
  afterCommit?: readonly ((ctx: Ctx, tools: RuntimeWriteTools) => Promise<Ctx>)[]
  beforeSteps?: readonly ((ctx: Ctx, tools: RuntimeWriteTools) => Promise<Ctx>)[]
  operations?: Record<string, unknown>
  depth?: number
  crossStore?: boolean
  limits?: Partial<Record<'defaultLimit' | 'maxLimit' | 'joinLimit' | 'bulkLimit', number>>
}) => {
  const fixture = nodeSqlite()
  fixture.sqlite.exec('create table patient (id text primary key not null, name text not null, created_at integer not null, updated_at integer not null)')
  const store = device ? sqliteAdapter({ ...fixture.database, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }) : memoryStore()
  const language = (device ? deviceLanguage : serverLanguage)({ arkan: [base], targets: {
    store,
    ...(crossStore && { other: device ? sqliteAdapter({ ...fixture.database, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }) : memoryStore() }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ store: 'store', schema: 'zod', authorize: defaultAuthorize, depth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, ...limits, afterCommit: afterCommit as never, beforeSteps: beforeSteps as never }),
  } } as never)
  const patient: Kayan = { name: 'patient', ...(device && { placement: 'device' as const }), fields: { ...defaultFields, name: { kind: 'text', rules: { required: true } } }, access: { create: () => true, read: () => true, update: () => true, delete: () => true }, targets: { service: { operations: operations as never } } }
  const note: Kayan = { ...patient, name: 'note', targets: { service: { store: 'other', operations: defaultOperations } } }
  const asas = language.buildAsas({ kayan: crossStore ? [patient, note] : [patient], http: (device ? [] : [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })]) as never }) as unknown as Built
  return { asas, operations: asas.kayan.patient!.operations }
}

test('both runners drain every committed hook after a nested hook fails and keep the write durable', async () => {
  const results: unknown[] = []
  for (const device of [false, true]) {
    const seen: string[] = []
    const { asas, operations } = setup({ device, beforeSteps: [async (ctx, tools) => {
      if (ctx.data.name === 'outer') await (tools.kayans as Record<string, Record<string, Call>>).patient!.create!({ name: 'inner' })
      return ctx
    }], afterCommit: [async (ctx) => {
      assert.equal(ctx.tx, undefined)
      seen.push(String(ctx.data.name))
      if (ctx.data.name === 'inner') throw new Error('notification failed')
      return ctx
    }] })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outer' }), (error: Error & { committed?: boolean }) => error.committed === true)
    results.push({ seen, total: (await operations.count!()).totalDocs })
  }
  assert.deepEqual(results, [{ seen: ['inner', 'outer'], total: 2 }, { seen: ['inner', 'outer'], total: 2 }])
})

test('both runners resolve a bulk operation without each to its single-row update at build time', async () => {
  const results: unknown[] = []
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, operations: { ...defaultOperations, updateMany: { steps: defaultOperations.updateMany.steps } } })
    await asas.connect()
    await operations.create!({ name: 'one' })
    await operations.create!({ name: 'two' })
    const changed = await operations.updateMany!({ where: { name: { equals: 'one' } }, data: { name: 'changed' } })
    results.push({ names: changed.docs.map((row: { name: string }) => row.name), errors: changed.errors, total: (await operations.count!()).totalDocs })
  }
  assert.deepEqual(results, [{ names: ['changed'], errors: [], total: 2 }, { names: ['changed'], errors: [], total: 2 }])
})

test('both runners refuse excessive nesting with the same plain error before another row is written', async () => {
  const results: unknown[] = []
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, depth: 1, beforeSteps: [async (ctx, tools) => {
      await (tools.kayans as Record<string, Record<string, Call>>).patient!.create!({ name: 'too deep' })
      return ctx
    }] })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outer' }), (error: Error & { status?: number; key?: string }) => {
      results.push([error.status, error.key])
      return error.constructor === Error && error.status === undefined && error.key === undefined
    })
  }
  assert.deepEqual(results, [[undefined, undefined], [undefined, undefined]])
})

test('both runners refuse options on bound calls and a bulk whose single-row operation is missing', async () => {
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, beforeSteps: [async (ctx, tools) => {
      await (tools.kayans as Record<string, Record<string, Call>>).patient!.create!({ name: 'inner' }, { actor: 'forged', context: { request: 'forged' } })
      return ctx
    }] })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outer' }), (error: Error & { key?: string }) => error.constructor === Error && error.message === 'Bound kayan tools inherit the current user and context; do not pass actor or context options.')
    const { update: _update, ...withoutUpdate } = defaultOperations
    assert.throws(() => setup({ device, operations: withoutUpdate }), (error: Error & { key?: string }) => error.key === 'error.invalid.bulk_operation')
  }
})

test('both runners refuse direct store access in beforeTransaction with a plain error', async () => {
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, operations: { ...defaultOperations, create: { ...defaultOperations.create, beforeTransaction: [async (ctx: Ctx, tools: RuntimeWriteTools) => {
      await tools.store.find({ tx: ctx.tx, kayan: ctx.kayan as never, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' } } })
      return ctx
    }] } } })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outside' }), (error: Error & { key?: string }) => error.constructor === Error && /runs outside the operation/.test(error.message))
  }
})


test('both runners refuse a nested write across stores before either store changes', async () => {
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, crossStore: true, beforeSteps: [async (ctx, tools) => {
      await (tools.kayans as Record<string, Record<string, Call>>).note!.create!({ name: 'other store' })
      return ctx
    }] })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outer' }), (error: Error & { key?: string }) => error.constructor === Error && error.message === 'Kayan "note" operation "create" cannot write to another store while transaction "patient.create" is open.')
    assert.equal((await operations.count!()).totalDocs, 0)
  }
})

test('both runners validate a write id before running beforeTransaction', async () => {
  for (const device of [false, true]) {
    const seen: string[] = []
    const { asas, operations } = setup({ device, operations: { ...defaultOperations, update: { ...defaultOperations.update, beforeTransaction: [(ctx: Ctx) => { seen.push('before'); return ctx }] } } })
    await asas.connect()
    await assert.rejects(operations.update!({ id: 'invalid uuid', name: 'refused' }), (error: Error & { status?: number }) => error.status === 400)
    assert.deepEqual(seen, [])
  }
})

test('both builds accept the shipped limits and bulk ceilings above the maximum page size', () => {
  for (const device of [false, true]) {
    for (const limits of [{}, { bulkLimit: defaultMaxLimit + 1 }, { defaultLimit: defaultMaxLimit, joinLimit: defaultMaxLimit }]) {
      assert.doesNotThrow(() => setup({ device, limits }))
    }
  }
})

test('both builds refuse the same invalid page and bulk numbers', () => {
  const message = (device: boolean, limits: Parameters<typeof setup>[0]['limits']) => {
    let refused: string | undefined
    assert.throws(() => setup({ device, limits }), (error: Error) => {
      assert.match(error.message, /service\.(defaultLimit|maxLimit|joinLimit|bulkLimit)/)
      refused = error.message
      return true
    })
    return refused
  }
  for (const key of ['defaultLimit', 'maxLimit', 'joinLimit', 'bulkLimit'] as const) {
    for (const value of [0, -1, 1.5, NaN, Infinity]) {
      const limits = { [key]: value }
      assert.equal(message(true, limits), message(false, limits))
    }
  }
  for (const key of ['defaultLimit', 'joinLimit'] as const) {
    const limits = { [key]: defaultMaxLimit + 1 }
    assert.equal(message(true, limits), message(false, limits))
  }
})

// These messages and the HTTP contract were exercised against f583401 before restoring them.
for (const invariant of ['write depth', 'read depth', 'cross store', 'settled write', 'settled read', 'bound actor', 'bound options', 'outside store'] as const) {
  test(`main parity: ${invariant} stays a private programmer error on both runners`, async () => {
    const expected = {
      'write depth': 'Write depth 2 is past the cap of 1: patient.create -> patient.create.',
      'read depth': 'Read depth 2 is past the cap of 1: patient.find -> patient.find.',
      'cross store': 'Kayan "note" operation "create" cannot write to another store while transaction "patient.create" is open.',
      'settled write': 'Kayan "patient" operation "create" joined the transaction "patient.create" opened, which has already settled, so the write that started this one was not awaited. Await every write a step begins.',
      'settled read': 'Kayan "patient" read joined the transaction "patient.create" opened, which has already settled, so the read that started this one was not awaited.',
      'bound actor': 'Bound kayan tools inherit the current user and context; do not pass actor or context options.',
      'bound options': 'Bound kayan tools do not accept operation options.',
      'outside store': `Kayan "patient" operation "create" reached the store from "beforeTransaction", which runs outside the operation's transaction, so the write would not be in it. Write through tools.kayans, which opens its own, or move the step into "steps".`,
    }[invariant]
    for (const device of [false, true]) {
      let late: Promise<unknown> | undefined
      const step = async (ctx: Ctx, tools: RuntimeWriteTools): Promise<Ctx> => {
        const calls = tools.kayans as Record<string, Record<string, Call>>
        if (invariant === 'settled write' || invariant === 'settled read') {
          late = new Promise((resolve, reject) => setTimeout(() => calls.patient![invariant === 'settled read' ? 'find' : 'create']!(invariant === 'settled read' ? {} : { name: 'late' }).then(resolve, reject), 0))
          void late.catch(() => {})
        } else if (invariant === 'cross store') await calls.note!.create!({ name: 'inner' })
        else if (invariant === 'bound actor' || invariant === 'bound options') await calls.patient!.create!({ name: 'inner' }, invariant === 'bound actor' ? { actor: 'forged' } : {})
        else if (invariant === 'outside store') await tools.store.find({ kayan: ctx.kayan as never, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' } } })
        else await calls.patient![invariant === 'read depth' ? 'find' : 'create']!(invariant === 'read depth' ? {} : { name: 'inner' })
        return ctx
      }
      const { asas, operations } = setup({ device, depth: 1, crossStore: invariant === 'cross store',
        ...(invariant === 'outside store'
          ? { operations: { ...defaultOperations, create: { ...defaultOperations.create, beforeTransaction: [step] } } }
          : invariant === 'read depth' ? { operations: { ...defaultOperations, find: { ...defaultOperations.find, steps: [step, ...defaultOperations.find.steps] } } } : { beforeSteps: [step] }),
        ...((invariant === 'settled write' || invariant === 'settled read' || invariant === 'cross store') && { depth: defaultDepth }),
      })
      await asas.connect()
      const call = async () => {
        const result = await operations[invariant === 'read depth' ? 'find' : 'create']!(invariant === 'read depth' ? {} : { name: 'outer' })
        return invariant === 'settled write' || invariant === 'settled read' ? late! : result
      }
      await assert.rejects(call, (error: Error & { status?: number; key?: string }) => {
        assert.equal(error.constructor, Error)
        assert.equal(error.message, expected)
        assert.equal(error.status, undefined)
        assert.equal(error.key, undefined)
        return true
      })
      const reported: unknown[] = []
      const http = fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: (error) => reported.push(error) })([
        { kayan: 'patient', name: 'probe', effect: 'create', input: { '~standard': { vendor: 'probe', version: 1, validate: (value: unknown) => ({ value }) } }, call },
      ] as never)
      const response = await http.handle(new Request('http://localhost/api/patient/probe', { method: 'POST', body: '{}' }), async () => null)
      assert.equal(response!.status, 500)
      assert.deepEqual(await response!.json(), { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' })
      assert.equal(reported.length, 1)
      assert.equal((reported[0] as Error).constructor, Error)
      assert.equal((reported[0] as Error).message, expected)
    }
  })
}
