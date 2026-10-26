// The device store: a kayan's rows in the phone's SQLite, reached through an injected drizzle database the native
// module answers. Run over Node's own SQLite behind the same contract, so this is the phone's path.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as wait } from 'node:timers/promises'
import { AsasError, base, defaultAuthorize, defaultDepth, defaultFields, defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, defineMithaq, serviceTarget, type ProjectStep, type Where, zodIdKinds, zodKinds, zodRules, zodTarget } from '../../index.ts'
import { drizzleSqliteIdKinds, drizzleSqliteKinds, sqliteAdapter, drizzleSqliteRules } from '../../targets.ts'
import { nodeSqlite } from './__fixtures__/node-sqlite.ts'

const label = (en: string) => ({ en, ar: en })
const allowAccess = { create: () => true, read: () => true, update: () => true, delete: () => true } as const

// The tables these kayan build, written out: the migrations that make them are the device migrator's.
const uuid = `(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`
const schema = [
  `create table patient (id text primary key not null default ${uuid}, mrn text not null unique, name text not null, born text, weight text, admitted integer not null default 0, flags text, updated_at integer not null, created_at integer not null)`,
  `create index patient_created_at_index on patient (created_at)`,
  `create table admission (id text primary key not null default ${uuid}, patient_id text not null references patient(id) on delete restrict, ward text not null, beds integer, updated_at integer not null, created_at integer not null)`,
]

const deviceLanguage = (database: ReturnType<typeof nodeSqlite>['database'], beforeSteps: readonly ProjectStep[] = []) => defineMithaq({
  locales: ['en', 'ar'] as const,
  arkan: [base],
  targets: {
    sqlite: sqliteAdapter({ ...database, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ beforeSteps: beforeSteps as never, store: 'sqlite', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultMaxLimit }),
  },
})

const device = async (beforeSteps: readonly ProjectStep[] = []) => {
  const proxy = nodeSqlite()
  for (const statement of schema) proxy.sqlite.exec(statement)
  const { defineKayan, buildAsas } = deviceLanguage(proxy.database, beforeSteps)
  const patient = defineKayan({
    name: 'patient',
    access: allowAccess,
    fields: {
      ...defaultFields,
      mrn: { kind: 'text', label: label('MRN'), rules: { required: true, unique: true } },
      name: { kind: 'text', label: label('Name'), rules: { required: true } },
      born: { kind: 'date', label: label('Born') },
      weight: { kind: 'decimal', label: label('Weight') },
      admitted: { kind: 'checkbox', label: label('Admitted'), rules: { required: true, defaultValue: false } },
      flags: { kind: 'json', maxBytes: 1000, label: label('Flags') },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const admission = defineKayan({
    name: 'admission',
    access: allowAccess,
    fields: {
      ...defaultFields,
      patient: { kind: 'relationship', relationTo: 'patient', label: label('Patient'), rules: { required: true } },
      ward: { kind: 'text', label: label('Ward'), rules: { required: true } },
      beds: { kind: 'integer', label: label('Beds') },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const asas = buildAsas({ kayan: [patient, admission], http: [] })
  await asas.connect()
  return { asas, ...proxy }
}

test('a device kayan is created, read, updated and deleted through an injected drizzle database, each value reading back as its kind', async () => {
  const { asas } = await device()
  const made = await asas.kayan.patient.operations.create({ mrn: 'A-1', name: 'Huda', born: '1990-02-28', weight: '71.50', flags: { allergies: ['penicillin'] } })
  assert.match(made.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'the id is the table default SQLite made')
  assert.ok(made.createdAt instanceof Date && made.updatedAt instanceof Date)
  const read = await asas.kayan.patient.operations.findByID({ id: made.id })
  assert.deepEqual(
    { born: read?.born, weight: read?.weight, admitted: read?.admitted, flags: read?.flags, createdAt: read?.createdAt?.getTime() },
    { born: '1990-02-28', weight: '71.50', admitted: false, flags: { allergies: ['penicillin'] }, createdAt: made.createdAt.getTime() },
  )
  const changed = await asas.kayan.patient.operations.update({ id: made.id, admitted: true, weight: '70.25' })
  assert.deepEqual([changed.admitted, changed.weight], [true, '70.25'])
  await asas.kayan.patient.operations.delete({ id: made.id })
  assert.equal(await asas.kayan.patient.operations.findByID({ id: made.id }).catch((error: AsasError) => error.status), 404)
})

test('a find filters, sorts, pages and counts in SQLite, a hop reads the related table, and a contains search escapes its wildcards', async () => {
  const { asas } = await device()
  const people = ['Huda Salem', 'huda Omar', 'Omar 100%', 'Sara_X']
  const made = []
  for (const [at, name] of people.entries()) {
    made.push(await asas.kayan.patient.operations.create({ mrn: `M-${at}`, name, admitted: at % 2 === 0 }))
    // Each row a millisecond of its own, so a moment orders them.
    await wait(2)
  }
  await asas.kayan.admission.operations.create({ patient: made[1]!.id, ward: 'ICU', beds: 2 })
  await asas.kayan.admission.operations.create({ patient: made[2]!.id, ward: 'Ward 3', beds: 5 })
  const names = async (where: Where, sort = 'name') => (await asas.kayan.patient.operations.find({ where, sort, limit: 10 })).docs.map((one) => one.name)
  assert.deepEqual(await names({ name: { contains: 'HUDA' } }), ['Huda Salem', 'huda Omar'], 'case-insensitive, as Postgres ilike')
  assert.deepEqual(await names({ name: { contains: '%' } }), ['Omar 100%'], 'a % is a character, not a wildcard')
  assert.deepEqual(await names({ name: { contains: '_' } }), ['Sara_X'])
  assert.deepEqual(await names({ name: { like: 'omar huda' } }), ['huda Omar'], 'every word, in any order')
  assert.deepEqual(await names({ admitted: { equals: true } }, '-name'), ['Omar 100%', 'Huda Salem'])
  assert.deepEqual(await names({ or: [{ mrn: { in: ['M-0', 'M-3'] } }, { born: { exists: true } }] }), ['Huda Salem', 'Sara_X'])
  assert.deepEqual(await names({ createdAt: { greater_than_equal: made[2]!.createdAt } }), ['Omar 100%', 'Sara_X'], 'a Date compares as its milliseconds')
  const admitted = await asas.kayan.admission.operations.find({ where: { 'patient.name': { contains: 'omar' }, beds: { greater_than: 1 } }, sort: 'beds', limit: 10 })
  assert.deepEqual(admitted.docs.map((one) => one.ward), ['ICU', 'Ward 3'])
  const page = await asas.kayan.patient.operations.find({ sort: 'mrn', limit: 3, page: 2 })
  assert.deepEqual([page.docs.map((one) => one.mrn), page.totalDocs, page.totalPages], [['M-3'], 4, 2])
  assert.equal((await asas.kayan.patient.operations.count({ where: { admitted: { equals: false } } })).totalDocs, 2)
})

test('a unique value is refused as a conflict, and a patient an admission still names is not deleted', async () => {
  const { asas } = await device()
  const { id } = await asas.kayan.patient.operations.create({ mrn: 'U-1', name: 'One' })
  await assert.rejects(() => asas.kayan.patient.operations.create({ mrn: 'U-1', name: 'Two' }), (error: AsasError) => error.status === 409 && error.key === 'error.conflict.unique')
  await asas.kayan.admission.operations.create({ patient: id, ward: 'ICU' })
  await assert.rejects(() => asas.kayan.patient.operations.delete({ id }), (error: AsasError) => error.status === 409)
  assert.equal((await asas.kayan.patient.operations.findByID({ id }))?.mrn, 'U-1')
})

test('the database enforces its foreign keys, which SQLite leaves off on every new connection', async () => {
  const { asas, sqlite } = await device()
  assert.deepEqual({ ...sqlite.prepare('pragma foreign_keys').get() }, { foreign_keys: 1 })
  const store = asas.targets.sqlite
  await assert.rejects(() => store.transaction((tx) => store.insert({ tx, kayan: 'admission', data: { patient: 'nobody', ward: 'ICU' } })), (error: Error) => /FOREIGN KEY constraint failed/.test(String((error.cause as Error | undefined)?.message)))
})

test('a write runs in the scoped executor of one transaction: a read sent while it is open waits until it commits, and a throw rolls it back', async () => {
  let release!: () => void
  let reached!: () => void
  const paused = new Promise<void>((resolve) => (reached = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  const { asas, log } = await device([async (ctx) => (reached(), await gate, ctx)])
  const writing = asas.kayan.patient.operations.create({ mrn: 'T-1', name: 'Held' })
  await paused
  const reading = asas.kayan.patient.operations.find({ limit: 10 })
  await wait(20)
  release()
  await writing
  assert.equal((await reading).totalDocs, 1, 'the read waited for the commit and sees the row')
  const begin = log.indexOf('begin')
  const commit = log.indexOf('commit')
  assert.ok(begin >= 0 && commit > begin)
  assert.deepEqual(log.slice(begin + 1, commit).filter((statement) => !/patient/.test(statement)), [], 'no statement of another call ran inside the transaction')
  assert.ok(log.slice(commit).some((statement) => /^select .* from "patient"/.test(statement)), 'the read ran after the commit')

  const store = asas.targets.sqlite
  await assert.rejects(() => store.transaction(async (tx) => {
    await store.insert({ tx, kayan: 'patient', data: { mrn: 'T-2', name: 'Gone', updatedAt: new Date(), createdAt: new Date() } })
    throw new Error('the step failed')
  }), /the step failed/)
  assert.equal((await asas.kayan.patient.operations.find({ where: { mrn: { equals: 'T-2' } } })).totalDocs, 0)
})

test('the store upserts on a unique field, adds to an integer in the database, sums exactly, and refuses a lock outside a transaction', async () => {
  const { asas } = await device()
  const store = asas.targets.sqlite
  const { id } = await asas.kayan.patient.operations.create({ mrn: 'S-1', name: 'Beds' })
  const first = await store.transaction((tx) => store.upsert({ tx, kayan: 'patient', on: ['mrn'], data: { mrn: 'S-1', name: 'Renamed', updatedAt: new Date(), createdAt: new Date() } }))
  assert.deepEqual([first.id, first.name], [id, 'Renamed'], 'the existing row, its identity kept')
  const { id: admission } = await asas.kayan.admission.operations.create({ patient: id, ward: 'ICU', beds: 2 })
  const added = await store.transaction((tx) => store.update({ tx, kayan: 'admission', id: admission, data: { beds: { $inc: 3 } } }))
  assert.equal(added.beds, 5)
  await asas.kayan.admission.operations.create({ patient: id, ward: 'ER', beds: 4 })
  assert.equal(await store.sum({ kayan: 'admission', field: 'beds' }), '9')
  assert.equal(await store.sum({ kayan: 'admission', field: 'beds', where: { ward: { equals: 'none' } } }), '0')
  await assert.rejects(() => store.sum({ kayan: 'patient', field: 'weight' }), /SQLite sums a decimal as a float/)
  await assert.rejects(() => store.find({ kayan: 'patient', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock: 'update' } }), /A locked find requires a transaction/)
})

test('a build names no http plug, and the device store refuses what it does not hold: a localized field, a set, a schema, a json filter', async () => {
  const { database } = nodeSqlite()
  const { defineKayan, buildAsas } = deviceLanguage(database)
  const plain = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    defineKayan({ name: 'note', access: allowAccess, fields: { ...defaultFields, ...fields } as never, targets: { service: { operations: defaultOperations } }, ...extra })
  assert.throws(() => buildAsas({ kayan: [plain({ title: { kind: 'text', label: label('Title'), rules: { localized: true } } })], http: [] }), /field "title" is localized, and the device store holds one column per field/)
  const ward = defineKayan({ name: 'ward', access: allowAccess, fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } } })
  assert.throws(() => buildAsas({ kayan: [ward, plain({ wards: { kind: 'relationship', relationTo: 'ward', hasMany: true, label: label('Wards') } })], http: [] }), /field "wards" holds a set of rows, and the device store builds no join table/)
  assert.throws(() => buildAsas({ kayan: [plain({}, { schemaName: 'clinical' })], http: [] }), /asks for the schema "clinical", and SQLite has no schemas/)
  const asas = buildAsas({ kayan: [plain({ data: { kind: 'json', maxBytes: 100, label: label('Data') } })], http: [] })
  await asas.connect()
  await assert.rejects(() => asas.targets.sqlite.find({ kayan: 'note', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { data: { equals: 1 } } } }), /field "data" is json, and the device store filters no json field/)
})

test('core refuses a tenant field and Better Auth on the device store before target initialization', () => {
  const { database } = nodeSqlite()
  const language = deviceLanguage(database)
  const note = (extra: object) => ({ name: 'note', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } }, ...extra })
  assert.throws(() => language.buildAsas({ kayan: [note({ fields: { ...defaultFields, organization: { kind: 'relationship', relationTo: 'missing', targets: { tenant: true } } } })] as never, http: [] }), /note.*tenant field.*device/)
  assert.throws(() => language.buildAsas({ kayan: [note({ auth: { provider: 'better-auth', server: () => { throw new Error('must not run') } } })] as never, http: [] }), /note.*Better Auth.*device/)
})

test('the server builder refuses a device-only kayan even when a SQLite store is registered', () => {
  const { database } = nodeSqlite()
  const { defineKayan, buildAsas } = deviceLanguage(database)
  const patient = defineKayan({ name: 'patient', placement: 'device', fields: { ...defaultFields }, targets: { service: { operations: defaultOperations } }, access: allowAccess })
  assert.throws(() => buildAsas({ kayan: [patient], http: [] }), /patient.*device-only.*server/)
})
