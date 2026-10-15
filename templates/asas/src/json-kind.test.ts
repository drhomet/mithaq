// The `json` kind: any JSON value, held as Payload's json field holds it, checked against a
// JSON Schema where the field names one, and queried by dot-notation paths.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, before, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { AsasError, base, defaultAuthorize, defaultJsonMaxBytes, defaultMaxBodyBytes, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, defineMithaq, draftFields, drizzleAdapter, drizzleKinds, drizzleRules, fetchHttp, serviceTarget, versionOperations, versionsTarget, zodTarget } from 'mithaq'
import { orpcHttp } from 'mithaq/orpc'
import { pushInput } from '../../../packages/mithaq/src/drizzle/index.ts'
import { memoryStore } from './memory-store.ts'
import { plainTarget } from './standard-schema-target.ts'
import { testDatabase } from './test-database.ts'

const allowAccess = { create: () => true, read: () => true, update: () => true, delete: () => true } as const
const language = (schema: typeof zodTarget | typeof plainTarget = zodTarget, memory = memoryStore()) =>
  defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: {
      memory,
      zod: schema,
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
    },
  })
const refused = (error: unknown) => error instanceof AsasError && error.status === 400

/** Every JSON type, alone and nested, as Payload's field takes them. */
const everyJsonType = [
  null,
  true,
  false,
  0,
  -1.5,
  1e21,
  '',
  'نص',
  [],
  {},
  [1, 'two', null, false, { three: [3] }],
  { a: { b: { c: [1, { d: 'deep' }] } }, empty: {}, list: [], 'key with space': 'x', 'quote"key': '\\' },
] as const

const settingsKayan = (defineKayan: ReturnType<typeof language>['defineKayan'], schema?: unknown) =>
  defineKayan({
    name: 'blobs',
    access: allowAccess,
    fields: { ...defaultFields, data: { kind: 'json', maxBytes: defaultJsonMaxBytes, label: { en: 'Data', ar: 'البيانات' }, ...(schema !== undefined && { jsonSchema: schema as never }) } },
    targets: { service: { operations: defaultOperations } },
  })

test('a json field holds every JSON type through both schema targets and reads it back unchanged, and refuses what is no JSON', async () => {
  for (const schema of [zodTarget, plainTarget]) {
    const { defineKayan, buildAsas } = language(schema)
    const operations = buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(defineKayan)] }).kayan.blobs.operations
    for (const data of everyJsonType) {
      const row = await operations.create({ id: crypto.randomUUID(), data: data as never })
      assert.deepEqual((await operations.findByID({ id: row.id }))?.data, data, JSON.stringify(data))
    }
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const data of [() => 1, Number.NaN, Infinity, new Date(), { at: new Date() }, [undefined], { a: undefined }, { n: Number.NaN }, new Map(), cyclic, 10n]) {
      await assert.rejects(() => operations.create({ data } as never), refused, String(data))
    }
  }
})

test('a json value nests at most 64 deep, and one deeper, however deep, is the caller\'s 400 rather than a 500', async () => {
  const nested = (depth: number): unknown => {
    let value: unknown = 'leaf'
    for (let level = 0; level < depth; level += 1) value = level % 2 ? { next: value } : [value]
    return value
  }
  for (const schema of [zodTarget, plainTarget]) {
    const { defineKayan, buildAsas } = language(schema)
    const operations = buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(defineKayan)] }).kayan.blobs.operations
    const { id } = await operations.create({ id: crypto.randomUUID(), data: nested(64) as never })
    assert.deepEqual((await operations.findByID({ id }))?.data, nested(64))
    for (const depth of [65, 100_000]) await assert.rejects(() => operations.create({ data: nested(depth) } as never), refused, String(depth))
  }
})

test('a json field names its byte cap, defaultJsonMaxBytes or its own, and a value whose JSON is longer is the caller\'s 400', async () => {
  assert.equal(defaultJsonMaxBytes, 1_000_000)
  const build = (field: Record<string, unknown>) => {
    const { defineKayan, buildAsas } = language()
    return buildAsas({ http: [fetchHttp()], kayan: [defineKayan({ name: 'blobs', access: allowAccess, fields: { ...defaultFields, data: { kind: 'json', ...field } as never }, targets: { service: { operations: defaultOperations } } })] }) as unknown as { kayan: { blobs: { operations: Record<"create", (input: Record<string, unknown>) => Promise<unknown>> } } }
  }
  assert.throws(() => build({}), /field "data" is json and names no maxBytes; name maxBytes: defaultJsonMaxBytes, or a whole number of its own\./)
  for (const maxBytes of [0, -1, 1.5, '10']) assert.throws(() => build({ maxBytes }), /names no maxBytes/, String(maxBytes))
  assert.throws(() => build({ kind: 'text', maxBytes: 10 }), /field "data" has a maxBytes, and kind "text" takes none; only a json field does\./)
  const operations = build({ maxBytes: 20 }).kayan.blobs.operations
  await operations.create({ id: crypto.randomUUID(), data: { a: '123456789012' } })
  await assert.rejects(() => operations.create({ data: { a: '1234567890123' } }), refused, 'one character past')
  const roomy = build({ maxBytes: defaultJsonMaxBytes }).kayan.blobs.operations
  await roomy.create({ id: crypto.randomUUID(), data: 'x'.repeat(defaultJsonMaxBytes - 2) })
  await assert.rejects(() => roomy.create({ data: 'x'.repeat(defaultJsonMaxBytes - 1) }), refused)
})

test('every plug refuses a request body past its maxBodyBytes as a 413 before reading the rest, the default included, and takes one under it', async () => {
  assert.equal(defaultMaxBodyBytes, 4 * 1024 * 1024)
  const send = async (http: unknown, body: string, headers: Record<string, string> = {}) => {
    const { defineKayan, buildAsas } = language()
    const built = buildAsas({ http: [http as never], kayan: [settingsKayan(defineKayan)] })
    return built.handler(new Request('http://test/api/blobs/create', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }))
  }
  const small = JSON.stringify({ id: crypto.randomUUID(), data: { a: 1 } })
  for (const plug of [() => fetchHttp({ maxBodyBytes: 200 }), () => orpcHttp({ maxBodyBytes: 200 })]) {
    assert.equal((await send(plug(), small))!.status, 200)
    const large = JSON.stringify({ data: 'x'.repeat(300) })
    const refusedBody = await send(plug(), large)
    assert.equal(refusedBody!.status, 413)
    assert.match(((await refusedBody!.json()) as { message: string }).message, /at most 200 bytes/)
    // A body that says it is short is still counted as it arrives.
    const streamed = new ReadableStream({ start: (controller) => { controller.enqueue(new TextEncoder().encode(large)); controller.close() } })
    const { defineKayan, buildAsas } = language()
    const built = buildAsas({ http: [plug() as never], kayan: [settingsKayan(defineKayan)] })
    const lied = await built.handler(new Request('http://test/api/blobs/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: streamed, duplex: 'half' } as RequestInit))
    assert.equal(lied!.status, 413)
  }
  assert.equal((await send(fetchHttp(), JSON.stringify({ data: 'x'.repeat(defaultMaxBodyBytes) })))!.status, 413)
  assert.equal((await send(orpcHttp(), JSON.stringify({ data: 'x'.repeat(defaultMaxBodyBytes) })))!.status, 413)
})

test('a path that crosses a relationship onto a json field, one row or a set, is the caller\'s 400', async () => {
  const { defineKayan, buildAsas } = language()
  const notes = defineKayan({
    name: 'notes',
    access: allowAccess,
    fields: { ...defaultFields, owner: { kind: 'relationship', relationTo: 'blobs' }, owners: { kind: 'relationship', relationTo: 'blobs', hasMany: true } },
    targets: { service: { operations: defaultOperations } },
  })
  const operations = buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(defineKayan), notes] }).kayan.notes.operations
  for (const key of ['owner.data', 'owners.data', 'owner.data.x']) {
    await assert.rejects(() => operations.find({ where: { [key]: { exists: true } } as never }), (error: unknown) => refused(error) && /json/.test((error as Error).message), key)
  }
})

test('a json field with a jsonSchema refuses a value its schema refuses through both schema targets, keeps a value it takes as written, and is refused at build where the schema cannot be held to', async () => {
  const schema = {
    uri: 'a://b/foo.json',
    fileMatch: ['a://b/foo.json'],
    schema: { type: 'object', properties: { foo: { enum: ['bar', 'foobar'] }, count: { type: 'integer', minimum: 0 } }, required: ['foo'] },
  }
  for (const schemaTarget of [zodTarget, plainTarget]) {
    const { defineKayan, buildAsas } = language(schemaTarget)
    const operations = buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(defineKayan, schema)] }).kayan.blobs.operations
    // A key the schema does not name is kept, as JSON Schema leaves it open.
    const kept = { foo: 'bar', count: 2, extra: { left: true } }
    const row = await operations.create({ id: crypto.randomUUID(), data: kept })
    assert.deepEqual((await operations.findByID({ id: row.id }))?.data, kept)
    for (const data of [{ foo: 'baz' }, { count: 1 }, { foo: 'bar', count: -1 }, { foo: 'bar', count: 1.5 }, 'bar', [kept]]) {
      await assert.rejects(() => operations.create({ data } as never), (error: unknown) => refused(error) && /blobs\.data\.invalid/.test(JSON.stringify((error as AsasError).params)), JSON.stringify(data))
    }
    // Left empty, a field that is not required asks nothing of its schema, as Payload's does.
    assert.equal((await operations.create({ id: crypto.randomUUID(), data: null })).data, null)
  }
  // Held to the whole schema: `required` without `properties`, and a keyword beside no `type`,
  // which zod's converter passes over.
  const { defineKayan, buildAsas } = language()
  const strict = buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(defineKayan, { schema: { required: ['foo'], minimum: 3, properties: { foo: { format: 'email' } } } })] }).kayan.blobs.operations
  for (const data of [{ old: 1 }, 1, { foo: 'not an email' }]) await assert.rejects(() => strict.create({ data } as never), refused, JSON.stringify(data))
  for (const data of [{ foo: 'a@b.co' }, 4, 'text']) await strict.create({ id: crypto.randomUUID(), data })
  // Payload writes a schema it fetched as draft-07, and one written so reads as draft-07, with or without the `#`.
  for (const $schema of ['http://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft-07/schema']) {
    const draft = buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(defineKayan, { schema: { $schema, items: [{ type: 'string' }] } })] }).kayan.blobs.operations
    await assert.rejects(() => draft.create({ data: [1] }), refused, $schema)
    await draft.create({ id: crypto.randomUUID(), data: ['one', 2] })
  }

  const build = (field: Record<string, unknown>, schemaTarget: typeof zodTarget | typeof plainTarget = zodTarget) => () => {
    const { defineKayan, buildAsas } = language(schemaTarget)
    buildAsas({ http: [fetchHttp()], kayan: [defineKayan({ name: 'blobs', fields: { ...defaultFields, data: { kind: 'json', maxBytes: defaultJsonMaxBytes, ...field } as never }, targets: { service: { operations: defaultOperations } } })] })
  }
  assert.throws(build({ kind: 'text', maxBytes: undefined, jsonSchema: { schema: {} } }), /field "data" has a jsonSchema, and kind "text" takes none; only a json field does\./)
  // Never fetched: a schema read off a URI at write time is a request the server makes on a caller's behalf.
  // A default the field's own schema or cap refuses would make every create that leaves the field out a refusal.
  assert.throws(build({ rules: { defaultValue: { size: -1 } }, jsonSchema: { schema: { properties: { size: { minimum: 0 } } } } }), /field "data" defaultValue is refused by its own jsonSchema or maxBytes\./)
  assert.throws(build({ maxBytes: 5, rules: { defaultValue: { size: 1 } } }), /field "data" defaultValue is refused by its own jsonSchema or maxBytes\./)
  assert.doesNotThrow(build({ rules: { defaultValue: { size: 1 } }, jsonSchema: { schema: { properties: { size: { minimum: 0 } } } } }))
  assert.throws(build({ jsonSchema: { uri: 'https://example.com/schema.json' } }), /field "data" jsonSchema names no "schema"; a schema is held in the field and never fetched from its "uri"\./)
  assert.throws(build({ jsonSchema: { schema: 'object' } }), /field "data" jsonSchema names no "schema"/)
  assert.throws(build({ jsonSchema: { schema: {}, fileMatch: 'x' } }), /field "data" jsonSchema "fileMatch" is a list of strings and "uri" a string\./)
  // A keyword the check cannot hold a value to is refused rather than passed over.
  assert.throws(build({ jsonSchema: { schema: { $ref: 'https://example.com/other.json' } } }), /field "data" jsonSchema cannot be checked: can't resolve reference https:\/\/example\.com\/other\.json/)
  assert.throws(build({ jsonSchema: { schema: { type: 'object', 'x-editor': 'tree' } } }), /field "data" jsonSchema cannot be checked: strict mode: unknown keyword: "x-editor"/)
  assert.throws(build({ jsonSchema: { schema: { type: 'string', format: 'colour' } } }), /field "data" jsonSchema cannot be checked: unknown format "colour"/)
})

test('a row stored before its field took a jsonSchema still reads, and its next save is held to the schema', async () => {
  const memory = memoryStore()
  const before = language(zodTarget, memory)
  const loose = before.buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(before.defineKayan)] }).kayan.blobs.operations
  const { id } = await loose.create({ id: crypto.randomUUID(), data: { old: true } })
  const after = language(zodTarget, memory)
  const held = after.buildAsas({ http: [fetchHttp()], kayan: [settingsKayan(after.defineKayan, { schema: { type: 'object', required: ['foo'] } })] }).kayan.blobs.operations
  assert.deepEqual((await held.findByID({ id }))?.data, { old: true })
  await assert.rejects(() => held.update({ id, data: { old: false } }), refused)
})

test('a json default is JSON, and each row gets its own copy of it', async () => {
  const { defineKayan, buildAsas } = language()
  const blobs = defineKayan({
    name: 'blobs',
    access: allowAccess,
    fields: { ...defaultFields, data: { kind: 'json', maxBytes: defaultJsonMaxBytes, rules: { defaultValue: { tags: ['a'], on: true } } } },
    targets: { service: { operations: defaultOperations } },
  })
  const operations = buildAsas({ http: [fetchHttp()], kayan: [blobs] }).kayan.blobs.operations
  const first = await operations.create({ id: crypto.randomUUID() })
  ;(first.data as { tags: string[] }).tags.push('b')
  assert.deepEqual((await operations.create({ id: crypto.randomUUID() })).data, { tags: ['a'], on: true })
  assert.throws(() => buildAsas({
    http: [fetchHttp()],
    kayan: [defineKayan({ name: 'odd', fields: { ...defaultFields, data: { kind: 'json', maxBytes: defaultJsonMaxBytes, rules: { defaultValue: { at: new Date() } as never } } }, targets: { service: { operations: defaultOperations } } })],
  }), /field "data" nested rule "defaultValue" (has an invalid value type|does not match kind "json")/)
})

describe('postgres', () => {
  const schemaName = 'json_kind'
  const { defineKayan, buildAsas } = defineMithaq({
    arkan: [base],
    targets: {
      drizzle: drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules }),
      zod: zodTarget,
      versions: versionsTarget({ max: 100 }),
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    },
  })
  const pages = defineKayan({
    name: 'pages',
    schemaName,
    access: allowAccess,
    fields: { ...defaultFields, data: { kind: 'json', maxBytes: defaultJsonMaxBytes }, ...draftFields },
    targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: { drafts: true } },
  })
  const blobs = defineKayan({
    name: 'blobs',
    schemaName,
    access: allowAccess,
    fields: { ...defaultFields, label: { kind: 'text' }, data: { kind: 'json', maxBytes: defaultJsonMaxBytes } },
    targets: { service: { operations: defaultOperations } },
  })
  const built = buildAsas({ http: [fetchHttp()], kayan: [blobs, pages] })
  const { db } = built.targets.drizzle
  const operations = built.kayan.blobs.operations
  const labels = async (where: unknown) => (await operations.find({ where: where as never, limit: 0, sort: 'label' })).docs.map((row) => row.label)

  before(async () => {
    await db.execute(`drop schema if exists ${schemaName} cascade`)
    await built.connect()
  })
  after(async () => {
    await db.execute(`drop schema if exists ${schemaName} cascade`)
    await built.destroy()
  })

  test('every JSON type is a jsonb column\'s plain value: written, read back and read raw unchanged, and one Payload wrote reads as it was', async () => {
    for (const data of everyJsonType) {
      const { id } = await operations.create({ data: data as never, label: 'type' })
      assert.deepEqual((await operations.findByID({ id }))?.data, data, JSON.stringify(data))
      // No wrapping: the column holds the value itself, which Payload's adapter reads as its own.
      const raw = await db.execute(`select data from ${schemaName}.blobs where id = '${id}'`)
      assert.deepEqual(raw.rows[0]!.data, data, `raw ${JSON.stringify(data)}`)
    }
    // A row Payload's adapter wrote, through its own insert of a jsonb value.
    const written = { blocks: [{ type: 'hero', title: 'مرحبا', ratio: 0.5 }], flags: { draft: false } }
    const id = crypto.randomUUID()
    await db.execute(`insert into ${schemaName}.blobs (id, label, data, created_at, updated_at) values ('${id}', 'payload', '${JSON.stringify(written)}'::jsonb, now(), now())`)
    assert.deepEqual((await operations.findByID({ id }))?.data, written)
    const types = await db.execute(`select data_type from information_schema.columns where table_schema = '${schemaName}' and table_name = 'blobs' and column_name = 'data'`)
    assert.equal(types.rows[0]!.data_type, 'jsonb')
  })

  test('each operator Payload takes on json reads a value at the top or along a dotted path, a list matched by any entry', async () => {
    await db.execute(`delete from ${schemaName}.blobs`)
    const rows = {
      a: { color: 'Red', size: 3, tags: ['sale', 'new'], dims: { w: 10, h: 20 }, items: [{ sku: 'x1', qty: 2 }, { sku: 'y2', qty: 0 }], 'odd "key"': 'quoted' },
      b: { color: 'blue', size: 4, tags: [], dims: { w: 10 }, items: [{ sku: 'z3' }], note: null },
      c: 'just text',
      d: null,
      e: { a: [[{ b: 1 }]], deep: [[['x']]] },
    }
    for (const [label, data] of Object.entries(rows)) await operations.create({ label, data })
    const cases: [unknown, string[]][] = [
      [{ 'data.color': { equals: 'Red' } }, ['a']],
      [{ 'data.color': { equals: 'red' } }, []],
      [{ 'data.color': { not_equals: 'Red' } }, ['b']],
      [{ 'data.size': { equals: 3 } }, ['a']],
      [{ 'data.size': { equals: '3' } }, []],
      [{ 'data.size': { in: [3, 4] } }, ['a', 'b']],
      [{ 'data.size': { not_in: [3] } }, ['b']],
      [{ 'data.dims.w': { equals: 10 } }, ['a', 'b']],
      [{ 'data.dims.h': { exists: true } }, ['a']],
      [{ 'data.dims.h': { exists: false } }, ['b', 'c', 'd', 'e']],
      [{ 'data.note': { exists: false } }, ['a', 'b', 'c', 'd', 'e']],
      [{ 'data.note': { equals: null } }, ['a', 'b', 'c', 'd', 'e']],
      [{ 'data.tags': { equals: 'sale' } }, ['a']],
      [{ 'data.tags': { exists: true } }, ['a']],
      [{ 'data.items.sku': { equals: 'z3' } }, ['b']],
      [{ 'data.items.qty': { equals: 0 } }, ['a']],
      [{ 'data.items.sku': { contains: 'Y' } }, ['a']],
      [{ 'data.color': { like: 'ue bl' } }, ['b']],
      [{ 'data.odd "key"': { equals: 'quoted' } }, ['a']],
      [{ data: { contains: 'JUST' } }, ['c']],
      [{ data: { equals: 'just text' } }, ['c']],
      [{ data: { exists: false } }, ['d']],
      [{ data: { exists: true } }, ['a', 'b', 'c', 'e']],
      // A list inside a list, read through the way Payload's `$.a[*].b[*]` reads it.
      [{ 'data.a.b': { equals: 1 } }, ['e']],
      [{ data: { in: ['just text', 'other'] } }, ['c']],
      [{ or: [{ 'data.color': { equals: 'Red' } }, { data: { equals: 'just text' } }] }, ['a', 'c']],
    ]
    for (const [where, expected] of cases) assert.deepEqual(await labels(where), expected, JSON.stringify(where))
    // A path names what a caller filters by, never SQL or jsonpath: a quote or a jsonpath operator is a key.
    assert.deepEqual(await labels({ "data.color') or true or ('": { exists: true } }), [])
    assert.deepEqual(await labels({ 'data.color" || @ == @ || "': { exists: true } }), [])
  })

  test('a json field orders no page, takes no operator past Payload\'s, and a path past it is refused as the caller\'s 400', async () => {
    for (const read of [
      () => operations.find({ sort: 'data' }),
      () => operations.find({ sort: 'data.color' }),
      () => operations.find({ where: { data: { greater_than: 1 } } as never }),
      () => operations.find({ where: { 'data..color': { equals: 1 } } as never }),
      () => operations.find({ where: { 'label.x.y': { equals: 1 } } as never }),
      () => operations.find({ where: { 'data.color': { equals: { nested: true } } } as never }),
    ]) {
      await assert.rejects(read, refused)
    }
  })

  test('in and not_in read a long list in one pass with nulls split off, and a list or a where past its cap is the caller\'s 400 on any kind', async () => {
    await db.execute(`delete from ${schemaName}.blobs`)
    for (const [label, data] of [['a', { n: 1 }], ['b', { n: 2 }], ['c', {}], ['d', { n: 'x' }]] as const) await operations.create({ label, data })
    const many = Array.from({ length: 1000 }, (_, index) => index + 2)
    assert.deepEqual(await labels({ 'data.n': { in: many } }), ['b'])
    assert.deepEqual(await labels({ 'data.n': { in: [1, null] } }), ['a', 'c'])
    assert.deepEqual(await labels({ 'data.n': { not_in: [1, 'x'] } }), ['b'])
    assert.deepEqual(await labels({ 'data.n': { not_in: [1, null] } }), ['b', 'd'])
    assert.deepEqual(await labels({ 'data.n': { not_in: [] } }), ['a', 'b', 'd'])
    assert.deepEqual(await labels({ 'data.n': { in: [] } }), [])
    const nested = (depth: number): unknown => (depth ? { or: [nested(depth - 1)] } : { label: { equals: 'a' } })
    for (const where of [
      { 'data.n': { in: [...many, 0] } },
      { label: { not_in: Array.from({ length: 1001 }, String) } },
      { or: Array.from({ length: 201 }, (_, index) => ({ label: { equals: String(index) } })) },
      nested(300),
    ]) {
      await assert.rejects(() => operations.find({ where: where as never }), (error: unknown) => refused(error) && /at most/.test((error as Error).message), JSON.stringify(where).slice(0, 80))
    }
  })

  test('a NUL or a lone surrogate, in a path, a compared value or a written json string or key, is the caller\'s 400 rather than Postgres\'s 500', async () => {
    for (const where of [
      { 'data.a\u0000': { exists: true } },
      { 'data.\ud800': { exists: true } },
      { 'data.a': { equals: 'x\u0000' } },
      { 'data.a': { in: ['ok', 'x\u0000'] } },
      { 'data.a': { contains: '\udc00' } },
      { label: { equals: 'x\u0000' } },
      { label: { like: 'x\u0000' } },
    ]) {
      await assert.rejects(() => operations.find({ where: where as never }), refused, JSON.stringify(where))
    }
    for (const data of [{ a: 'x\u0000' }, { 'k\u0000': 1 }, ['\ud800'], { '\udfff': true }]) {
      await assert.rejects(() => operations.create({ label: 'bad', data: data as never }), refused, JSON.stringify(data))
    }
    await operations.create({ label: 'paired', data: { '😀': '😀 مرحبا' } })
  })

  test('a version snapshots a json value whole, a draft holds its own, and a restore writes the snapshot back as it was', async () => {
    const page = built.kayan.pages.operations
    const first = { blocks: [{ type: 'hero', title: 'One' }], seo: { index: true } }
    const second = { blocks: [], seo: { index: false, note: null } }
    const draft = { blocks: [{ type: 'quote', lines: ['a', 'b'] }] }
    const { id } = await page.create({ data: first })
    await page.update({ id, data: second })
    await page.update({ id, data: draft }, { draft: true })
    const kept = (await db.execute(`select id, version from ${schemaName}._pages_versions where parent_id = '${id}' order by updated_at`)).rows as { id: string; version: { data: unknown; _status: string } }[]
    assert.deepEqual(kept.map((one) => [one.version.data, one.version._status]), [[first, 'published'], [second, 'published'], [draft, 'draft']])
    assert.deepEqual((await page.findByID({ id }))?.data, second, 'the plain read is the published value')
    assert.deepEqual((await page.findByID({ id }, { draft: true }))?.data, draft, 'and the draft read the draft\'s')
    assert.deepEqual((await page.restoreVersion({ id: kept[0]!.id }))?.data, first)
    assert.deepEqual((await page.findByID({ id }))?.data, first, 'the row holds the snapshot as it was written')
  })

  test('adding a json field is one clean migration: a nullable jsonb column, and nothing else', async () => {
    const { generateDrizzleJson, generateMigration } = (await import(
      pathToFileURL(createRequire(new URL('../../../packages/mithaq/package.json', import.meta.url)).resolve('drizzle-kit/api-postgres')).href
    )) as { generateDrizzleJson(imports: Record<string, unknown>): Promise<unknown>; generateMigration(prev: unknown, cur: unknown): Promise<string[]> }
    const tablesOf = (fields: Record<string, unknown>) => {
      const kayan = defineKayan({ name: 'blobs', schemaName, access: allowAccess, fields: { ...defaultFields, label: { kind: 'text' }, ...fields } as never, targets: { service: { operations: defaultOperations } } })
      const offline = buildAsas({ http: [fetchHttp()], kayan: [kayan] })
      return pushInput({ tables: offline.targets.drizzle.tables as never, schemas: offline.targets.drizzle.schemas }).imports
    }
    const statements = await generateMigration(await generateDrizzleJson(tablesOf({})), await generateDrizzleJson(tablesOf({ data: { kind: 'json', maxBytes: defaultJsonMaxBytes }, settings: { kind: 'json', maxBytes: defaultJsonMaxBytes, rules: { required: true, defaultValue: { theme: 'light' } } } })))
    assert.deepEqual(statements, [
      `ALTER TABLE "${schemaName}"."blobs" ADD COLUMN "data" jsonb;`,
      `ALTER TABLE "${schemaName}"."blobs" ADD COLUMN "settings" jsonb DEFAULT '{"theme":"light"}' NOT NULL;`,
    ])
  })
})
