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

test('both runners refuse excessive nesting with the same keyed error before another row is written', async () => {
  const results: unknown[] = []
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, depth: 1, beforeSteps: [async (ctx, tools) => {
      await (tools.kayans as Record<string, Record<string, Call>>).patient!.create!({ name: 'too deep' })
      return ctx
    }] })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outer' }), (error: Error & { status?: number; key?: string }) => {
      results.push([error.status, error.key])
      return error.status === 400 && error.key === 'error.invalid.depth'
    })
  }
  assert.deepEqual(results, [[400, 'error.invalid.depth'], [400, 'error.invalid.depth']])
})

test('both runners refuse options on bound calls and a bulk whose single-row operation is missing', async () => {
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, beforeSteps: [async (ctx, tools) => {
      await (tools.kayans as Record<string, Record<string, Call>>).patient!.create!({ name: 'inner' }, { actor: 'forged', context: { request: 'forged' } })
      return ctx
    }] })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outer' }), (error: Error & { key?: string }) => error.key === 'error.invalid.bound_options')
    const { update: _update, ...withoutUpdate } = defaultOperations
    assert.throws(() => setup({ device, operations: withoutUpdate }), (error: Error & { key?: string }) => error.key === 'error.invalid.bulk_operation')
  }
})

test('both runners refuse direct store access in beforeTransaction with a keyed error', async () => {
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, operations: { ...defaultOperations, create: { ...defaultOperations.create, beforeTransaction: [async (ctx: Ctx, tools: RuntimeWriteTools) => {
      await tools.store.find({ tx: ctx.tx, kayan: ctx.kayan as never, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' } } })
      return ctx
    }] } } })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outside' }), (error: Error & { key?: string }) => error.key === 'error.invalid.outside_transaction')
  }
})


test('both runners refuse a nested write across stores before either store changes', async () => {
  for (const device of [false, true]) {
    const { asas, operations } = setup({ device, crossStore: true, beforeSteps: [async (ctx, tools) => {
      await (tools.kayans as Record<string, Record<string, Call>>).note!.create!({ name: 'other store' })
      return ctx
    }] })
    await asas.connect()
    await assert.rejects(operations.create!({ name: 'outer' }), (error: Error & { key?: string }) => error.key === 'error.invalid.cross_store')
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
