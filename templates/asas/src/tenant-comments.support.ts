import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { base, betterAuth, betterAuthTenant, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultJsonMaxBytes, defaultLimit, defaultMaxBodyBytes, defaultMaxLimit, defaultOperations, defineMithaq, drizzleAdapter, drizzleIdKinds, drizzleKinds, drizzleRules, fetchHttp, serviceTarget, zodIdKinds, zodKinds, zodRules, zodTarget, type AuditHandler, type Store } from '../../../packages/mithaq/src/index.ts'
import type { RichTextValue } from '../../../packages/mithaq/src/rich-text/index.ts'
import { defaultNodes, defaultRichTextFeatures, richText } from '../../../packages/mithaq/src/rich-text/index.ts'
import { draftFields, versionOperations, versionsTarget } from '../../../packages/mithaq/src/index.ts'
import { memoryStore } from './memory-store.ts'
import { testDatabase } from './test-database.ts'

for (const postgres of [false, true]) test(`comments use the record and field gates, tenant scope and audit transaction on ${postgres ? 'Postgres' : 'memory'}`, { skip: postgres && !process.env.DATABASE_URL }, async () => {
  const schemaName = `rich_text_comments_${randomUUID().replaceAll('-', '')}`
  const store = postgres ? drizzleAdapter({ connectionString: testDatabase(), idKinds: drizzleIdKinds, kinds: drizzleKinds, rules: drizzleRules }) : memoryStore()
  let markReads = 0
  const find = store.find.bind(store)
  store.find = (args: Parameters<Store['find']>[0]) => {
    if (args.kayan === 'threads' && args.args.lock === 'keyShare') markReads++
    return find(args)
  }
  let auditFailure = false
  const audit: AuditHandler = async ({ store, tx, operation, dataAfter, context }) => {
    if (auditFailure) throw new Error('Test audit failure')
    assert.equal(context.requestId, 'dummy-request')
    await store!.insert({ tx, kayan: 'events', data: { id: randomUUID(), operation, snapshot: dataAfter } })
  }
  const language = defineMithaq({ arkan: [base, richText({ nodes: defaultNodes, features: [...defaultRichTextFeatures, 'comments'], comments: { threads: 'threads', context: () => ({ requestId: 'dummy-request' }) } })], targets: {
    store,
    versions: versionsTarget({ max: 100 }),
    zod: zodTarget({ idKinds: zodIdKinds, kinds: zodKinds, rules: zodRules }),
    tenant: betterAuthTenant({ relationTo: 'organizations', onDelete: 'restrict', newRows: 'active', organizations: 'many' }),
    service: serviceTarget({ context: {} as Record<string, unknown>, store: 'store', schema: 'zod', depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, authorize: defaultAuthorize, audit }),
  } })
  const gates = { create: () => true, read: () => true, update: () => true, delete: () => true }
  const common = { schemaName, access: gates, targets: { service: { operations: defaultOperations } } }
  const organizations = language.defineKayan({ ...common, name: 'organizations', fields: { id: { kind: 'text' } } })
  const users = new Map(['writer', 'other', 'reader', 'hidden', 'fieldHidden', 'fieldReader', 'foreign'].map((id) => [id, { id, org: id === 'foreign' ? 'org-b' : 'org-a' }]))
  const server = () => ({ $context: Promise.resolve({ isTrustedOrigin: (origin: string) => ['http://fixture.test', 'https://public.example.test', 'https://trusted.example.test'].includes(origin) }), api: {
    getSession: async ({ headers }: { headers: Headers }) => { const user = users.get(headers.get('x-person') ?? ''); return user ? { user: { id: user.id }, session: { activeOrganizationId: user.org } } : null },
    listOrganizations: async ({ headers }: { headers: Headers }) => { const user = users.get(headers.get('x-person') ?? ''); return user ? [{ id: user.org }] : [] },
  }, handler: async () => new Response(null) })
  const user = language.defineKayan({ ...common, name: 'user', auth: betterAuth({ server: server as never }), fields: { id: { kind: 'text' } } })
  const body = { kind: 'richText' as const, access: { read: ({ user }: { user: unknown }) => (user as { id: string }).id !== 'fieldHidden', update: ({ user }: { user: unknown }) => (user as { id: string }).id !== 'fieldReader' } }
  const records = language.defineKayan({ ...common, name: 'records', access: { ...gates, read: ({ user }) => (user as { id: string }).id !== 'hidden', update: ({ user }) => (user as { id: string }).id !== 'reader' }, fields: { ...defaultFields, organization: language.targets.tenant.field, body, second: body } })
  const threads = language.defineKayan({ ...common, name: 'threads', targets: { service: { operations: {} } }, fields: { ...defaultFields, organization: language.targets.tenant.field, recordKayan: { kind: 'text' }, recordId: { kind: 'text' }, field: { kind: 'text' }, quote: { kind: 'text' }, resolved: { kind: 'checkbox' }, comments: { kind: 'json', maxBytes: defaultJsonMaxBytes } } })
  const numbered = language.defineKayan({ ...common, name: 'numbered', fields: { ...defaultFields, id: { kind: 'number' }, organization: language.targets.tenant.field, body } })
  const versioned = language.defineKayan({ ...common, name: 'versioned', targets: { versions: { drafts: true }, service: { operations: { ...defaultOperations, ...versionOperations } } }, fields: { ...defaultFields, ...draftFields, organization: language.targets.tenant.field, body } })
  const events = language.defineKayan({ ...common, name: 'events', fields: { id: { kind: 'uuid' }, operation: { kind: 'text' }, snapshot: { kind: 'json', maxBytes: defaultJsonMaxBytes } } })
  const built = language.buildAsas({ kayan: [organizations, user, records, numbered, versioned, threads, events], http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })], auth: { maxBodyBytes: defaultMaxBodyBytes, onError: () => {} } })
  const actual = built.targets.store as unknown as Store
  try {
    await built.connect()
    await actual.transaction(async (tx) => { for (const id of ['org-a', 'org-b']) await actual.insert({ tx, kayan: 'organizations', data: { id } }) })
    const who = async (person: string) => (await built.auth.actor(new Headers({ 'x-person': person })))!
    const writer = await who('writer')
    const value: RichTextValue = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'مرحبا' }] }] } }
    const record = await built.kayan.records.operations.create({ body: value, second: value }, { actor: writer })
    const request = (person: string, input?: object, target = record.id, field = 'body') => built.handler(new Request(`http://fixture.test/api/rich-text/comments/records/${target}/${field}`, { method: input ? 'POST' : 'GET', headers: { 'x-person': person, Origin: 'http://fixture.test', 'Content-Type': 'application/json' }, ...(input && { body: JSON.stringify(input) }) }))
    for (const origin of ['https://public.example.test', 'https://trusted.example.test', 'http://public.example.test', 'https://untrusted.example.test']) {
      const proxied = await built.handler(new Request(`http://public.example.test/api/rich-text/comments/records/${record.id}/body`, { method: 'POST', headers: { 'x-person': 'writer', origin, 'x-forwarded-proto': 'https', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unknown' }) }))
      assert.equal(proxied.status, origin === 'https://public.example.test' || origin === 'https://trusted.example.test' ? 400 : 403, `${origin} through the TLS proxy`)
    }
    for (const action of ['reply', 'edit', 'delete', 'resolve', 'reopen']) {
      for (const thread of [undefined, '', 'not-a-uuid']) assert.equal((await request('writer', { action, thread, text: 'Comment' })).status, 400, `${action} requires a UUID thread`)
    }
    const created = await request('writer', { action: 'create', quote: 'مرحبا', text: 'A comment' })
    assert.equal(created.status, 200, await created.clone().text())
    const thread = await created.json() as { id: string; comments: { id: string }[] }
    assert.equal((await request('hidden')).status, 403)
    assert.equal((await request('fieldHidden')).status, 404)
    assert.equal((await request('foreign')).status, 404)
    assert.equal((await request('reader')).status, 200)
    assert.equal((await request('reader', { action: 'reply', thread: thread.id, text: 'Refused' })).status, 403)
    assert.equal((await request('fieldReader', { action: 'reply', thread: thread.id, text: 'Refused' })).status, 403)
    assert.equal((await request('foreign', { action: 'reply', thread: thread.id, text: 'Refused' })).status, 404)
    assert.equal((await request('other', { action: 'edit', thread: thread.id, comment: thread.comments[0]!.id, text: 'Refused' })).status, 403)
    assert.equal((await request('other', { action: 'delete', thread: thread.id, comment: thread.comments[0]!.id })).status, 403)
    for (const input of [
      { action: 'reply', thread: thread.id, text: 'A reply' },
      { action: 'resolve', thread: thread.id }, { action: 'reopen', thread: thread.id },
      { action: 'edit', thread: thread.id, comment: thread.comments[0]!.id, text: 'Edited' },
    ]) assert.equal((await request('writer', input)).status, 200)
    assert.equal((await request('writer', { action: 'reopen', thread: thread.id })).status, 200, 'an already open thread stays unchanged')
    const marked = structuredClone(value)
    marked.root.children[0]!.children = [{ type: 'mark', ids: [thread.id], children: [{ type: 'text', text: 'مرحبا' }] }] as never
    markReads = 0
    await built.kayan.records.operations.update({ id: record.id, body: marked }, { actor: writer })
    if (!postgres) assert.equal(markReads, 1, 'one thread ownership lookup per write')
    assert.equal((await (await request('writer')).json()).docs[0].orphaned, false)
    for (const text of ['\0', '\ud800']) assert.equal((await request('writer', { action: 'reply', thread: thread.id, text })).status, 400)
    const draftRecord = await built.kayan.versioned.operations.create({ body: value }, { actor: writer })
    const draftComment = await built.handler(new Request(`http://fixture.test/api/rich-text/comments/versioned/${draftRecord.id}/body`, { method: 'POST', headers: { 'x-person': 'writer', Origin: 'http://fixture.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', quote: 'مرحبا', text: 'Draft comment' }) }))
    assert.equal(draftComment.status, 200)
    const draftThread = await draftComment.json() as { id: string }
    const draftMarked = structuredClone(marked)
    draftMarked.root.children[0]!.children![0]!.ids = [draftThread.id]
    markReads = 0
    await built.kayan.versioned.operations.update({ id: draftRecord.id, body: draftMarked }, { actor: writer, draft: true })
    if (!postgres) assert.equal(markReads, 1, 'one thread lookup for a draft snapshot')
    await assert.rejects(built.kayan.versioned.operations.update({ id: draftRecord.id, body: marked }, { actor: writer, draft: true }), /thread/, 'draft snapshots must reject foreign thread references too')
    const otherRecord = await built.kayan.records.operations.create({ body: value, second: value }, { actor: writer })
    await assert.rejects(built.kayan.records.operations.update({ id: otherRecord.id, body: marked }, { actor: writer }), /thread/)
    await assert.rejects(built.kayan.records.operations.update({ id: record.id, second: marked }, { actor: writer }), /thread/)
    assert.equal((await request('writer', { action: 'reply', thread: thread.id, text: 'Wrong record' }, otherRecord.id)).status, 404)
    assert.equal((await request('writer', { action: 'reply', thread: thread.id, text: 'Wrong field' }, record.id, 'second')).status, 404)
    const foreignActor = await who('foreign')
    const foreignRecord = await built.kayan.records.operations.create({ body: value, second: value }, { actor: foreignActor })
    await assert.rejects(built.kayan.records.operations.update({ id: foreignRecord.id, body: marked }, { actor: foreignActor }), /thread/)
    await built.kayan.records.operations.update({ id: record.id, body: value }, { actor: writer })
    assert.equal((await (await request('writer')).json()).docs[0].orphaned, true)
    assert.equal((await request('writer', { action: 'delete', thread: thread.id, comment: thread.comments[0]!.id })).status, 200)
    const found = await actual.find({ kayan: 'events', args: { limit: 100, page: 1, sort: { field: 'id', direction: 'asc' } } })
    assert.equal(found.totalDocs, 7)
    await built.kayan.numbered.operations.create({ id: 0, body: value }, { actor: writer })
    const numeric = await built.handler(new Request('http://fixture.test/api/rich-text/comments/numbered/0/body', { method: 'POST', headers: { 'x-person': 'writer', Origin: 'http://fixture.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', text: 'Numeric record', quote: 'Selected' }) }))
    assert.equal(numeric.status, 200, await numeric.clone().text())
    const numericThread = await numeric.json() as { id: string }
    const numericMark = { root: { type: 'root' as const, children: [{ type: 'paragraph', children: [{ type: 'mark', ids: [numericThread.id], children: [{ type: 'text', text: 'Selected' }] }] }] } }
    await built.kayan.numbered.operations.update({ id: 0, body: numericMark }, { actor: writer })
    if (postgres) {
      auditFailure = true
      assert.equal((await request('writer', { action: 'reply', thread: thread.id, text: 'Rolled back' })).status, 500)
      const page = await (await request('writer')).json()
      assert.equal(page.docs[0].comments.length, 1)
    }
    const noOrigin = await built.handler(new Request(`http://fixture.test/api/rich-text/comments/records/${record.id}/body`, { method: 'POST', headers: { 'x-person': 'writer' }, body: JSON.stringify({ action: 'resolve', thread: thread.id }) }))
    assert.equal(noOrigin.status, 403)
  } finally {
    if (postgres) await (built.targets.store as unknown as { db: { execute: (query: string) => Promise<unknown> } }).db.execute(`drop schema "${schemaName}" cascade`)
    await built.destroy()
  }
})
