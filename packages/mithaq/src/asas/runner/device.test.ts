import assert from 'node:assert/strict'
import { test } from 'node:test'
import { base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, defineMithaq, serviceTarget, sqliteAdapter, drizzleSqliteIdKinds, drizzleSqliteKinds, drizzleSqliteRules, zodTarget, zodKinds, zodRules, zodIdKinds, type ProjectStep, type Ctx } from '../../device.ts'
import { nodeSqlite } from '../../drizzle/sqlite/__fixtures__/node-sqlite.ts'

const setup = ({ beforeSteps = [], afterSteps = [], afterCommit = [] }: { beforeSteps?: readonly ProjectStep[]; afterSteps?: readonly ProjectStep[]; afterCommit?: readonly ProjectStep[] } = {}) => {
  const fixture = nodeSqlite()
  fixture.sqlite.exec('create table patient (id integer primary key autoincrement, name text not null, created_at integer not null, updated_at integer not null); create table note (id integer primary key autoincrement, title text not null, created_at integer not null, updated_at integer not null)')
  const language = defineMithaq({ locales: ['en', 'ar'] as const, arkan: [base], targets: {
    sqlite: sqliteAdapter({ ...fixture.database, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ beforeSteps: beforeSteps as never, afterSteps: afterSteps as never, afterCommit: afterCommit as never, store: 'sqlite', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit }),
  } })
  const access = { create: () => true, read: () => true, update: () => true, delete: () => true }
  const patient = language.defineKayan({ name: 'patient', placement: 'device', access, fields: { ...defaultFields, id: { kind: 'number' }, name: { kind: 'text', label: { en: 'Name', ar: 'Name' }, rules: { required: true } } }, targets: { service: { operations: defaultOperations } } })
  const note = language.defineKayan({ name: 'note', placement: 'device', access, fields: { ...defaultFields, id: { kind: 'number' }, title: { kind: 'text', label: { en: 'Title', ar: 'Title' }, rules: { required: true } } }, targets: { service: { operations: defaultOperations } } })
  return { ...fixture, language, patient, note, asas: language.buildAsas({ kayan: [patient, note], http: [] }) }
}

test('the portable runner executes writes and reads with their steps and typed values', async () => {
  const { asas } = setup()
  await asas.connect()
  const made = await asas.kayan.patient.operations.create({ name: 'Huda' })
  assert.ok(made.createdAt instanceof Date)
  assert.equal((await asas.kayan.patient.operations.findByID({ id: made.id }))?.name, 'Huda')
  await asas.kayan.patient.operations.update({ id: made.id, name: 'Huda Salem' })
  assert.equal((await asas.kayan.patient.operations.find({ where: { name: { contains: 'Salem' } } })).totalDocs, 1)
  await asas.kayan.patient.operations.delete({ id: made.id })
  assert.equal((await asas.kayan.patient.operations.count()).totalDocs, 0)
})

test('nested calls join their transaction and roll back together without leaking actor or context to concurrent calls', async () => {
  const seen: unknown[] = []
  let note: ReturnType<typeof setup>['note']
  const fixture = setup({ beforeSteps: [async (ctx, tools) => {
    seen.push([ctx.kayan.name, ctx.actor, (ctx.context as Record<string, unknown>).request])
    if (ctx.kayan.name === 'patient' && tools.effect !== 'read') {
      await tools.of(note).create({ title: ctx.data.name as string })
      if (ctx.data.name === 'fail') throw new Error('rollback both rows')
    }
    return ctx
  }] })
  note = fixture.note
  await fixture.asas.connect()
  await assert.rejects(fixture.asas.kayan.patient.operations.create({ name: 'fail' }, { actor: 'A', context: { request: 'one' } }), /rollback both rows/)
  assert.equal((await fixture.asas.kayan.note.operations.count()).totalDocs, 0)
  seen.length = 0
  await Promise.all([
    fixture.asas.kayan.patient.operations.create({ name: 'first' }, { actor: 'A', context: { request: 'one' } }),
    fixture.asas.kayan.patient.operations.create({ name: 'second' }, { actor: 'B', context: { request: 'two' } }),
  ])
  assert.deepEqual(seen, [['patient', 'A', 'one'], ['note', 'A', 'one'], ['patient', 'B', 'two'], ['note', 'B', 'two']])
  assert.equal(fixture.log.filter((query) => query === 'begin').length, 3, 'one transaction per outer write')
})

test('device bulk operations use their single-row operations and roll back the complete batch on failure', async () => {
  const { asas } = setup({ beforeSteps: [async (ctx, tools) => {
    if (tools.effect === 'update' && ctx.dataBefore?.name === 'two') throw new Error('second row refused')
    return ctx
  }] })
  await asas.connect()
  await asas.kayan.patient.operations.create({ name: 'one' })
  await asas.kayan.patient.operations.create({ name: 'two' })
  await assert.rejects(asas.kayan.patient.operations.updateMany({ where: { id: { exists: true } }, data: { name: 'changed' } }), /second row refused/)
  assert.deepEqual((await asas.kayan.patient.operations.find({ sort: 'id' })).docs.map((row) => row.name), ['one', 'two'])
  const deleted = await asas.kayan.patient.operations.deleteMany({ where: { name: { equals: 'one' } } })
  assert.equal(deleted.docs.length, 1)
  assert.equal((await asas.kayan.patient.operations.count()).totalDocs, 1)
})

test('the device entry loads without any Node built-ins', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const entry = new URL('../../device.ts', import.meta.url).href
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module'
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith('node:')) throw new Error('Node dependency: ' + specifier)
      return next(specifier, context)
    } })
    await import(${JSON.stringify(entry)})
  `])
})

test('a global creates its single row on its first update and keeps its identity thereafter', async () => {
  const { language, sqlite } = setup()
  sqlite.exec('create table settings (id integer primary key autoincrement, global_type text not null unique, title text not null, created_at integer not null, updated_at integer not null)')
  const { defaultGlobalFields, defaultGlobalOperations } = await import('../../device.ts')
  const settings = language.defineGlobal({ name: 'settings', placement: 'device', access: { read: () => true, update: () => true }, fields: { ...defaultFields, ...defaultGlobalFields, id: { kind: 'number' }, title: { kind: 'text', label: { en: 'Title', ar: 'Title' }, rules: { required: true } } }, targets: { service: { operations: defaultGlobalOperations } } })
  const asas = language.buildAsas({ kayan: [], global: [settings], http: [] })
  await asas.connect()
  const first = await asas.global.settings.operations.update({ title: 'First' })
  const next = await asas.global.settings.operations.update({ title: 'Next' })
  assert.equal(first.id, next.id)
  assert.equal((await asas.global.settings.operations.findOne())?.title, 'Next')
})

test('device access constraints hide rows on reads and writes and field masking survives application steps', async () => {
  const fixture = setup()
  const patient = fixture.language.defineKayan({ name: 'patient', placement: 'device', access: {
    create: () => true,
    read: ({ user }) => user === 'absent' ? { name: { equals: 'missing' } } : true,
    update: () => ({ name: { equals: 'allowed' } }),
    delete: () => true,
  }, fields: { ...defaultFields, id: { kind: 'number' }, name: { kind: 'text', rules: { required: true }, access: { read: ({ user }: { user: unknown }) => user !== 'masked' } } }, targets: { service: { operations: { ...defaultOperations, findByID: { ...defaultOperations.findByID, afterSteps: [async (ctx: Ctx) => ({ ...ctx, data: { ...ctx.data, name: 'reintroduced' } })] } } } } })
  const asas = fixture.language.buildAsas({ kayan: [patient], http: [] })
  await asas.connect()
  const made = await asas.kayan.patient.operations.create({ name: 'hidden' })
  assert.equal((await asas.kayan.patient.operations.find({}, { actor: 'absent' })).totalDocs, 0)
  await assert.rejects(asas.kayan.patient.operations.update({ id: made.id, name: 'changed' }), (error: Error & { status?: number }) => error.status === 404)
  const masked = await asas.kayan.patient.operations.findByID({ id: made.id }, { actor: 'masked' })
  assert.equal(Object.hasOwn(masked!, 'name'), false)
})

test('afterCommit sees committed rows and a failure there leaves the write durable', async () => {
  let fixture: ReturnType<typeof setup>
  fixture = setup({ afterCommit: [async (ctx) => {
    assert.equal((await fixture.asas.kayan.patient.operations.count()).totalDocs, 1)
    throw new Error('notification failed')
  }] })
  await fixture.asas.connect()
  await assert.rejects(fixture.asas.kayan.patient.operations.create({ name: 'durable' }), (error: Error & { committed?: boolean; result?: unknown }) => error.committed === true && !!error.result)
  assert.equal((await fixture.asas.kayan.patient.operations.count()).totalDocs, 1)
})

test('a device relationship can only reference a row its actor can read', async () => {
  const fixture = setup()
  fixture.sqlite.exec('alter table note add column patient_id integer references patient(id) on delete restrict')
  const patient = fixture.language.defineKayan({ name: 'patient', placement: 'device', access: { create: () => true, read: () => false }, fields: { ...defaultFields, id: { kind: 'number' }, name: { kind: 'text', rules: { required: true } } }, targets: { service: { operations: defaultOperations } } })
  const note = fixture.language.defineKayan({ name: 'note', placement: 'device', access: { create: () => true, read: () => true }, fields: { ...defaultFields, id: { kind: 'number' }, title: { kind: 'text', rules: { required: true } }, patient: { kind: 'relationship', relationTo: 'patient', rules: { onDelete: 'restrict' } } }, targets: { service: { operations: defaultOperations } } })
  const asas = fixture.language.buildAsas({ kayan: [patient, note], http: [] })
  await asas.connect()
  const made = await asas.kayan.patient.operations.create({ name: 'hidden' })
  await assert.rejects(asas.kayan.note.operations.create({ title: 'private', patient: made.id }), (error: Error & { key?: string }) => error.key === 'error.invalid.reference')
})

test('a nested tools handle cannot write after its outer transaction has settled', async () => {
  let late!: () => Promise<unknown>
  let fixture: ReturnType<typeof setup>
  fixture = setup({ beforeSteps: [async (ctx, tools) => {
    if (tools.effect !== 'read' && ctx.kayan.name === 'patient') await tools.of(fixture.note).create({ title: 'nested' })
    if (tools.effect !== 'read' && ctx.kayan.name === 'note') late = () => tools.of(fixture.note).create({ title: 'too late' })
    return ctx
  }] })
  await fixture.asas.connect()
  await fixture.asas.kayan.patient.operations.create({ name: 'outer' })
  await assert.rejects(late(), /settled/)
  assert.equal((await fixture.asas.kayan.note.operations.count()).totalDocs, 1)
})

test('a device step store find keeps its filter and hold refuses a missing row', async () => {
  let fixture: ReturnType<typeof setup>
  fixture = setup({ beforeSteps: [async (ctx, tools) => {
    if (tools.effect !== 'read' && ctx.kayan.name === 'patient' && ctx.data.name === 'probe') {
      const found = await tools.store.find({ tx: ctx.tx, kayan: fixture.patient, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { name: { equals: 'missing' } } } })
      assert.equal(found.totalDocs, 0)
      await assert.rejects(tools.store.hold({ tx: ctx.tx, kayan: fixture.patient, ids: [999], mode: 'update' }), (error: Error & { status?: number }) => error.status === 404)
    }
    return ctx
  }] })
  await fixture.asas.connect()
  await fixture.asas.kayan.patient.operations.create({ name: 'existing' })
  await fixture.asas.kayan.patient.operations.create({ name: 'probe' })
})

test('a device kayan exposes its built SQLite table beside its schemas and operations', () => {
  const { asas } = setup()
  assert.equal(asas.kayan.patient.targets.sqlite.table, asas.targets.sqlite.tables.patient)
})
