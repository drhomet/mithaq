// Uploads: the `upload` kind, the storage target and the adapters the project owns. Every test here but the S3 one runs on the in-memory store and the local adapter in a temporary
// folder, so none needs a database; the referenced-file refusal, which needs Postgres's foreign key, is in asas.test.ts.
// The storage functions under test are the ones this project's own config names, not the shipped defaults by name, so a project that replaces one, say `uploaded`,
// runs every security test here against its replacement. A test that hands `project` a function of its own in `storage` runs that one instead.
// First, so the template's storage reads its folder from it.
import '../../../asas/src/test-storage-dir.ts'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  defaultMaxBodyBytes,
  adapterOf,
  checkReference,
  defaultAuthorize,
  defaultDepth,
  defaultLimit,
  defaultMaxLimit,
  defaultJoinLimit,
  defaultBulkLimit,
  defaultFields,
  defaultKinds,
  defaultOperations,
  defaultRules,
  base,
  defineMithaq,
  readForFile,
  sanitizeFilename,
  signReference,
  storage as storageRukn,
  storageTarget,
  uploadFields,
  userRefs,
  versionsTarget,
  withUploadReference,
  zodTarget,
  type Authorize,
  type StandardSchemaV1,
  type StorageAdapter,
  type StorageConfig,
  fetchHttp,
} from 'mithaq'
import { defaultNodes, richText, UploadNode } from 'mithaq/rich-text'
import { markAuthActor } from '../../../../packages/mithaq/src/asas/actor.ts'
import { memoryStore } from '../../../asas/src/memory-store.ts'
import { plainTarget } from '../../../asas/src/standard-schema-target.ts'
import { defaultDisposition, defaultSweep, defaultVerify } from './defaults.ts'
import { storageConfig as named } from './index.ts'
import { local } from './local.ts'
import { s3 } from './s3.ts'
import { uploadthing } from './uploadthing.ts'

const secret = 'a-test-secret-of-at-least-thirty-two-characters'
/** The project's own storage functions, and the file size it names. */
const functions = {
  fileSize: named.fileSize,
  maxBodyBytes: named.maxBodyBytes,
  key: named.key,
  verify: named.verify,
  disposition: named.disposition,
  sweep: named.sweep,
  instructions: named.instructions,
  uploaded: named.uploaded,
  removed: named.removed,
  serve: named.serve,
  onError: named.onError,
}
/**
 * The lists a kayan holding files declares beside the shipped ones: the create takes the
 * upload reference and runs the config's `uploaded` before the transaction, and
 * the delete runs its `removed` after the commit.
 */
const fileOperations = ({ uploaded, removed }: Pick<StorageConfig, 'uploaded' | 'removed'>) => ({
  ...defaultOperations,
  create: { ...defaultOperations.create, input: ({ create }: { create: StandardSchemaV1 }) => withUploadReference(create), beforeTransaction: [uploaded] },
  delete: { ...defaultOperations.delete, afterCommit: ({ afterCommit }: { afterCommit: readonly unknown[] }) => [...afterCommit, removed] },
})
const tenanted = userRefs<{ activeOrganizationId: string }>()
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
/** The first bytes of a JPEG, which is all `file-type` reads. */
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, ...new Array(52).fill(0)])
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

/** An actor the runner trusts as a member of this organization, as a Better Auth session is. */
const memberOf = (organization: string) =>
  markAuthActor({ strategy: 'better-auth', activeOrganizationId: organization, organizations: [{ id: organization }] })

/** Only the actor's own organization's rows, the template's tenancy in miniature. */
const inTenant = ({ user }: { user: unknown }) =>
  (user as { activeOrganizationId?: string } | null)?.activeOrganizationId ? { tenant: { equals: (user as { activeOrganizationId: string }).activeOrganizationId } } : false
const access = { create: ({ user }: { user: unknown }) => !!user, read: inTenant, update: inTenant, delete: inTenant }

/** The memory store, whose new `files` row holds a null `deletedAt`, as a database column with no value does: the memory store fills nothing. */
const memoryOf = () => {
  const memory = memoryStore()
  const { insert } = memory
  memory.insert = (args) => insert(args.kayan === 'files' ? { ...args, data: { deletedAt: null, ...args.data } } : args)
  return memory
}

/** The storage the language's own rukn is laid down over, where a test names none: the local adapter in a folder nothing writes to. */
const unused = (): StorageConfig => ({ secret, adapters: { local: local({ dir: join(tmpdir(), 'mithaq-storage-unused'), secret, prefix: 'app' }) }, adapter: 'local', ...functions })

const languageOf = ({ softDelete, config = unused(), authorize = defaultAuthorize }: { softDelete?: boolean; config?: StorageConfig; authorize?: Authorize } = {}) =>
  defineMithaq({
    arkan: [base, richText({ nodes: [...defaultNodes, UploadNode] }), storageRukn(config)],
    targets: {
      memory: softDelete ? memoryOf() : memoryStore(),
      zod: zodTarget,
      plain: plainTarget,
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, ...(softDelete && { softDelete: 'deletedAt' }) },
      versions: versionsTarget({ max: 100 }),
    },
  })

type Built = Awaited<ReturnType<typeof project>>

/**
 * A project holding files in a folder of its own: a `files` kayan of the
 * shipped columns, a `notes` kayan whose cover is one of them, and the local
 * adapter with the defaults the template copies.
 */
const project = async ({ storage = {}, files = {}, wrap = (one) => one, hidden, softDelete, authorize }: { storage?: Partial<StorageConfig>; files?: Record<string, unknown>; wrap?: (adapter: StorageAdapter) => StorageAdapter; hidden?: keyof typeof uploadFields; softDelete?: boolean; authorize?: Authorize } = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'mithaq-storage-'))
  const adapter = wrap(local({ dir, secret, prefix: 'app' }))
  const config: StorageConfig = { secret, adapters: { local: adapter }, adapter: 'local', ...functions, ...storage }
  const language = languageOf({ softDelete, config, authorize })
  const fileKayan = language.defineKayan({
    name: 'files',
    auth: {
      name: 'test',
      authenticate: ({ headers }: { headers: Headers }) => ({ user: headers.get('x-org') ? memberOf(headers.get('x-org')!) : null }),
    },
    access,
    targets: { storage: { mimeTypes: ['image/png', 'image/jpeg'] }, service: { operations: fileOperations(config) }, ...files },
    fields: {
      ...defaultFields,
      ...uploadFields,
      // A column no reader may read, for the file route to find missing.
      ...(hidden && { [hidden]: { ...uploadFields[hidden], access: { read: () => false } } }),
      tenant: { kind: 'text', rules: { defaultValue: tenanted.activeOrganizationId, providedBy: { create: 'application', update: 'never' } } },
      title: { kind: 'text' },
      ...(softDelete && { deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } } }),
    },
  } as never)
  const noteOf = (name: string, schema: string) => language.defineKayan({
    name,
    access,
    targets: { service: { schema, operations: defaultOperations } },
    fields: { ...defaultFields, tenant: { kind: 'text', rules: { defaultValue: tenanted.activeOrganizationId } }, cover: { kind: 'upload', relationTo: () => fileKayan }, body: { kind: 'richText', rules: { required: true } } },
  } as never)
  // The same kayan on both schema targets, the zod one and the template's own.
  const notes = noteOf('notes', 'zod')
  const plainNotes = noteOf('plainNotes', 'plain')
  const asas = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [fileKayan, notes, plainNotes], auth: { onError: console.error } } as never) as unknown as {
    handler(request: Request): Promise<Response>
    targets: { storage: { commands: { sweep(input: { asas: unknown; flags: readonly string[] }): Promise<number> } }; memory: { rows: Map<string, Record<string, unknown>[]> } }
    destroy(): Promise<void>
  }
  return { asas, dir, adapter, language, fileKayan, notes, config }
}

const send = (built: Built, method: string, path: string, { org, json, body, headers = {} }: { org?: string; json?: unknown; body?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> } = {}) =>
  built.asas.handler(new Request(new URL(path, 'http://test'), {
    method,
    headers: { ...(org && { 'x-org': org }), ...(json !== undefined && { 'content-type': 'application/json' }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  }))

/** Asks for instructions and, unless told not to, sends the bytes where they say. */
const upload = async (
  built: Built,
  org: string,
  { filename = 'cover.png', type = 'image/png', bytes = png, declared = bytes.length, put = true }: { filename?: string; type?: string; bytes?: Uint8Array<ArrayBuffer>; declared?: number; put?: boolean } = {},
) => {
  const asked = await send(built, 'POST', '/api/files/uploadInstructions', { org, json: { filename, filesize: declared, mimeType: type } })
  assert.equal(asked.status, 200, await asked.clone().text())
  const instructions = await asked.json() as { request: { url: string; headers: Record<string, string> }; file: { uploadReference: Record<string, unknown> } }
  if (put) assert.equal((await send(built, 'PUT', instructions.request.url, { headers: instructions.request.headers, body: bytes })).status, 204)
  return instructions
}

const create = (built: Built, org: string, uploadReference: unknown, extra: Record<string, unknown> = {}) =>
  send(built, 'POST', '/api/files/create', { org, json: { uploadReference, title: 'A cover', ...extra } })

const keyOf = async (response: Response) => ((await response.json()) as { data?: { key?: string } }).data?.key
const exists = (path: string) => stat(path).then(() => true, () => false)

test('186a. an upload is signed for its key, put in the folder, verified and made a row in one insert, read back through the row, and deleted with it', async () => {
  // What the steps after the create's own see: the columns, and never the reference.
  const seen: Record<string, unknown>[] = []
  const operations = fileOperations(functions)
  const built = await project({
    files: {
      storage: { mimeTypes: ['image/png', 'image/jpeg'] },
      service: { operations: { ...operations, create: { ...operations.create, afterSteps: [(ctx: { data: Record<string, unknown> }) => (seen.push(ctx.data), ctx)] } } },
    },
  })
  const { file } = await upload(built, 'org-a')
  const made = await create(built, 'org-a', file.uploadReference)
  assert.equal(made.status, 200, await made.clone().text())
  const row = await made.json() as Record<string, unknown>
  // The token goes once: a second PUT would change a verified object.
  const again = await upload(built, 'org-a', { put: false })
  assert.equal((await send(built, 'PUT', again.request.url, { headers: again.request.headers, body: png })).status, 204)
  assert.equal((await send(built, 'PUT', again.request.url, { headers: again.request.headers, body: png })).status, 409)
  assert.equal(row.id, file.uploadReference.id)
  // Under the adapter's own prefix, which is all a sweep of it lists, and in no organization's
  // folder: a column called `tenant` binds nothing, so this kayan is shared.
  assert.equal(row.key, `app/_/files/${String(row.id)}/cover.png`)
  assert.equal(seen.length, 1)
  assert.equal('uploadReference' in seen[0]!, false, 'the reference reaches neither the insert nor the audit')
  assert.equal(row.filename, 'cover.png')
  assert.equal(row.mimeType, 'image/png')
  assert.equal(row.filesize, png.length)
  assert.equal(row.width, 1)
  assert.equal(row.height, 1)
  assert.equal(row.storage, 'local')
  assert.equal(row.tenant, 'org-a')
  // Computed on read, never stored.
  assert.equal(row.url, `/api/files/file/${String(row.id)}`)
  assert.equal(row.thumbnailURL, row.url)

  const served = await send(built, 'GET', String(row.url), { org: 'org-a' })
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.match(served.headers.get('content-disposition') ?? '', /^inline; filename="cover.png"/)
  assert.equal(served.headers.get('cache-control'), 'private, no-store', 'a private file is kept by no cache')
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), png)

  const changed = await send(built, 'POST', '/api/files/update', { org: 'org-a', json: { id: row.id, key: 'org-a/other.png' } })
  assert.equal(changed.status, 400)
  const sentKey = await create(built, 'org-a', file.uploadReference, { key: 'org-a/mine.png' })
  assert.equal(sentKey.status, 400)

  const deleted = await send(built, 'POST', '/api/files/delete', { org: 'org-a', json: { id: row.id } })
  assert.equal(deleted.status, 200)
  assert.equal(await exists(join(built.dir, String(row.key))), false, 'the object goes after the commit')
  await rm(built.dir, { recursive: true, force: true })
})

test('186b. a reference with any signed field changed, an expired one, another tenant\'s and a used one are each refused, and the first row keeps its file', async (t) => {
  const built = await project()
  const { file } = await upload(built, 'org-a')
  const reference = file.uploadReference
  const tampered: Record<string, unknown> = { id: '00000000-0000-4000-8000-000000000009', key: 'app/org-a/files/elsewhere.png', kayan: 'notes', tenant: 'org-b', filename: 'other.png', type: 'image/jpeg', size: 68, storage: 'other', exp: Number(reference.exp) + 3600 }
  assert.deepEqual(Object.keys(tampered).sort(), ['exp', 'filename', 'id', 'kayan', 'key', 'size', 'storage', 'tenant', 'type'], 'every signed field')
  for (const [field, value] of Object.entries(tampered)) {
    const forged = await create(built, 'org-a', { ...reference, [field]: value })
    assert.equal(forged.status, 400, field)
    assert.equal(await keyOf(forged), 'error.invalid.upload_reference', field)
  }
  assert.equal(await keyOf(await create(built, 'org-a', { ...reference, signature: 'x'.repeat(43) })), 'error.invalid.upload_reference')
  const unreferenced = await create(built, 'org-a', undefined)
  assert.equal(unreferenced.status, 400)
  assert.equal(await keyOf(unreferenced), 'error.invalid.upload_reference')
  // A shared kayan's file is signed for no organization; a tenant-owned one's is
  // `tenant-scope.test.ts`'s, where another organization's create is refused.
  assert.equal(reference.tenant, null)
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 2 * 60 * 60 * 1000)
  const expired = await create(built, 'org-a', reference)
  t.mock.restoreAll()
  assert.equal(expired.status, 400)
  assert.equal(await keyOf(expired), 'error.invalid.upload_reference')
  const listed = await send(built, 'POST', '/api/files/find', { org: 'org-a', json: {} })
  assert.equal(((await listed.json()) as { totalDocs: number }).totalDocs, 0)
  // The object stays for its own reference, which is still good, once.
  const made = await create(built, 'org-a', reference)
  assert.equal(made.status, 200)
  const row = await made.json() as { url: string }
  // A used reference names a row already made: it is refused and nothing is
  // deleted, even when the object no longer passes verification.
  await writeFile(join(built.dir, String(reference.key)), jpeg)
  const replayed = await create(built, 'org-a', reference)
  assert.equal(replayed.status, 400)
  assert.equal(await keyOf(replayed), 'error.invalid.upload_reference')
  assert.equal(await exists(join(built.dir, String(reference.key))), true, 'the first row keeps its object')
  assert.equal((await send(built, 'GET', row.url, { org: 'org-a' })).status, 200)
  await rm(built.dir, { recursive: true, force: true })
})

test('186b2. an object the verification cannot read back is a 500 the caller may retry, and the object is kept for the sweep', async () => {
  const built = await project({ wrap: (adapter) => ({ ...adapter, readHead: async () => { throw new Error('the bucket is down') } }) })
  const { file } = await upload(built, 'org-a')
  const failed = await create(built, 'org-a', file.uploadReference)
  assert.equal(failed.status, 500)
  assert.equal(await exists(join(built.dir, String(file.uploadReference.key))), true)
  await rm(built.dir, { recursive: true, force: true })
})

test('198a. a create replayed while the first is in flight, whose verification fails to read, never deletes the object the first row names', async () => {
  // The first read of the object waits for the second to start; the second
  // waits for the first create to answer, then fails as a bucket that is down.
  let releaseBoth!: () => void
  let releaseCommit!: () => void
  const both = new Promise<void>((resolve) => (releaseBoth = resolve))
  const committed = new Promise<void>((resolve) => (releaseCommit = resolve))
  let heads = 0
  const built = await project({
    wrap: (adapter) => ({
      ...adapter,
      head: async (args) => {
        const call = ++heads
        if (call === 1) await both
        if (call === 2) {
          releaseBoth()
          await committed
          throw new Error('the bucket is down')
        }
        return adapter.head(args)
      },
    }),
  })
  const { file } = await upload(built, 'org-a')
  const answered = await Promise.all([1, 2].map(() => create(built, 'org-a', file.uploadReference).then((response) => (releaseCommit(), response))))
  assert.deepEqual(answered.map((one) => one.status).sort(), [200, 500])
  const row = await answered.find((one) => one.status === 200)!.json() as { url: string }
  assert.equal(await exists(join(built.dir, String(file.uploadReference.key))), true, 'the first row keeps its object')
  assert.equal((await send(built, 'GET', row.url, { org: 'org-a' })).status, 200)
  await rm(built.dir, { recursive: true, force: true })
})

test('186c. a file whose bytes are another type than declared, or more than declared, is refused, makes no row, and is left to the sweep', async () => {
  const built = await project()
  const lying = await upload(built, 'org-a', { filename: 'cover.png', type: 'image/png', bytes: jpeg })
  const key = String(lying.file.uploadReference.key)
  assert.equal(await exists(join(built.dir, key)), true)
  const refused = await create(built, 'org-a', lying.file.uploadReference)
  assert.equal(refused.status, 400)
  assert.equal(await keyOf(refused), 'error.invalid.upload_verify')
  // The create deletes nothing, since only the sweep knows no row names the object.
  assert.equal(await exists(join(built.dir, key)), true)
  const listed = await send(built, 'POST', '/api/files/find', { org: 'org-a', json: {} })
  assert.equal(((await listed.json()) as { totalDocs: number }).totalDocs, 0)

  // A bucket that took more than was signed: the object is larger than the
  // reference says, so it is refused too.
  const larger = await upload(built, 'org-a', { put: false })
  const largerKey = String(larger.file.uploadReference.key)
  await mkdir(join(built.dir, largerKey, '..'), { recursive: true })
  await writeFile(join(built.dir, largerKey), new Uint8Array([...png, ...new Array(4096).fill(0)]))
  const oversized = await create(built, 'org-a', larger.file.uploadReference)
  assert.equal(oversized.status, 400)
  assert.equal(await keyOf(oversized), 'error.invalid.upload_verify')
  assert.equal(await exists(join(built.dir, largerKey)), true)

  const never = await upload(built, 'org-a', { put: false })
  assert.equal(await keyOf(await create(built, 'org-a', never.file.uploadReference)), 'error.invalid.upload_verify')
  await rm(built.dir, { recursive: true, force: true })
})

test('186d. instructions refuse a type the kayan does not hold, a file over its size, and a caller who may not create', async () => {
  const built = await project({ files: { storage: { mimeTypes: ['image/*'], fileSize: 1000 } } })
  const ask = (org: string | undefined, json: unknown) => send(built, 'POST', '/api/files/uploadInstructions', { org, json })
  const pdf = await ask('org-a', { filename: 'a.pdf', filesize: 10, mimeType: 'application/pdf' })
  assert.equal(pdf.status, 400)
  assert.equal(await keyOf(pdf), 'error.invalid.upload_type')
  // A wildcard never takes SVG: it is a document that runs script.
  const svgUnder = await ask('org-a', { filename: 'a.svg', filesize: 10, mimeType: 'image/svg+xml' })
  assert.equal(svgUnder.status, 400)
  assert.equal(await keyOf(svgUnder), 'error.invalid.upload_type')
  const big = await ask('org-a', { filename: 'a.png', filesize: 1001, mimeType: 'image/png' })
  assert.equal(big.status, 400)
  assert.equal(await keyOf(big), 'error.invalid.upload_size')
  assert.equal((await ask(undefined, { filename: 'a.png', filesize: 10, mimeType: 'image/png' })).status, 403)
  assert.equal(await keyOf(await ask('org-a', { filename: '..', filesize: 10, mimeType: 'image/png' })), 'error.invalid.upload_request')
  assert.equal(await keyOf(await ask('org-a', { filename: 'a.png', filesize: 0, mimeType: 'image/png' })), 'error.invalid.upload_request')
  assert.equal(await keyOf(await ask('org-a', { filename: 'a.png', filesize: 10, mimeType: 'image/png\r\nx-evil: 1' })), 'error.invalid.upload_request')
  assert.equal(await keyOf(await ask('org-a', { filename: `${'a'.repeat(252)}.png`, filesize: 10, mimeType: 'image/png' })), 'error.invalid.upload_request')
  // A path in the name is dropped, so the key stays inside the kayan's own folder.
  const path = await ask('org-a', { filename: '../../etc/passwd.png', filesize: 10, mimeType: 'image/png' })
  const reference = ((await path.json()) as { file: { uploadReference: { key: string; filename: string } } }).file.uploadReference
  assert.equal(reference.filename, 'passwd.png')
  assert.match(reference.key, /^app\/_\/files\/[0-9a-f-]{36}\/passwd\.png$/)
  // The 10 MiB the template names for a kayan that names no size.
  const unsized = await project()
  const over = await send(unsized, 'POST', '/api/files/uploadInstructions', { org: 'org-a', json: { filename: 'a.png', filesize: 10 * 1024 * 1024 + 1, mimeType: 'image/png' } })
  assert.equal(await keyOf(over), 'error.invalid.upload_size')
  const named1000 = await project({ storage: { fileSize: 1000 } })
  const over1000 = await send(named1000, 'POST', '/api/files/uploadInstructions', { org: 'org-a', json: { filename: 'a.png', filesize: 1001, mimeType: 'image/png' } })
  assert.equal(await keyOf(over1000), 'error.invalid.upload_size')
  await rm(built.dir, { recursive: true, force: true })
  await rm(unsized.dir, { recursive: true, force: true })
  await rm(named1000.dir, { recursive: true, force: true })
})

test('186d2. instructions answer a body past the storage\'s maxBodyBytes with 413 before reading the rest or asking who sent it', async () => {
  const built = await project({ storage: { maxBodyBytes: 100 } })
  // Never closed, so a reader that waits for the end never answers.
  const body = new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode(`{"filename":"${'a'.repeat(200)}`)) })
  const answered = await built.asas.handler(new Request('http://test/api/files/uploadInstructions', { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit))
  assert.equal(answered.status, 413)
  assert.match(((await answered.json()) as { message: string }).message, /at most 100 bytes/)
  await rm(built.dir, { recursive: true, force: true })
})

test('186e. an SVG is taken only where it is listed, and is never served inline, whatever the disposition function says', async () => {
  const built = await project({
    files: { storage: { mimeTypes: ['image/svg+xml'] } },
    storage: { disposition: ({ filename }) => `inline; filename="${filename}"` },
  })
  const { file } = await upload(built, 'org-a', { filename: 'logo.svg', type: 'image/svg+xml', bytes: svg })
  const made = await create(built, 'org-a', file.uploadReference)
  assert.equal(made.status, 200, await made.clone().text())
  const row = await made.json() as { url: string; thumbnailURL: unknown }
  assert.equal(row.thumbnailURL, null)
  const served = await send(built, 'GET', row.url, { org: 'org-a' })
  assert.equal(served.status, 200)
  assert.match(served.headers.get('content-disposition') ?? '', /^attachment; /)
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(served.headers.get('content-security-policy'), "script-src 'none'")
  assert.match(functions.disposition({ filename: 'logo.svg', mimeType: 'image/svg+xml' }), /^attachment; /)
  await rm(built.dir, { recursive: true, force: true })
})

test('186f. the file of a row the reader may not read is the same 404 as one that is not there', async () => {
  const built = await project()
  const { file } = await upload(built, 'org-a')
  const row = await (await create(built, 'org-a', file.uploadReference)).json() as { id: string; url: string }
  const other = await send(built, 'GET', row.url, { org: 'org-b' })
  assert.equal(other.status, 404)
  assert.equal(await keyOf(other), 'error.not_found.file')
  const nobody = await send(built, 'GET', row.url)
  assert.equal(nobody.status, 404)
  const absent = await send(built, 'GET', '/api/files/file/00000000-0000-4000-8000-000000000000', { org: 'org-a' })
  assert.equal(absent.status, 404)
  assert.equal(await keyOf(absent), 'error.not_found.file')
  assert.equal((await send(built, 'GET', row.url, { org: 'org-a' })).status, 200)
  // An id that is no id, or no URI, is the same 404, never a 500.
  for (const id of ['%E0%A4%A', 'not-a-uuid', '1']) {
    const odd = await send(built, 'GET', `/api/files/file/${id}`, { org: 'org-a' })
    assert.equal(odd.status, 404, id)
  }
  await rm(built.dir, { recursive: true, force: true })
  // A row whose type or name the reader may not read has nothing to serve the file under.
  for (const hidden of ['mimeType', 'filename'] as const) {
    const masked = await project({ hidden })
    const { file: uploaded } = await upload(masked, 'org-a')
    const made = await (await create(masked, 'org-a', uploaded.uploadReference)).json() as { id: string }
    const answered = await send(masked, 'GET', `/api/files/file/${made.id}`, { org: 'org-a' })
    assert.equal(answered.status, 404, hidden)
    await rm(masked.dir, { recursive: true, force: true })
  }
})

test('186g. the local adapter refuses a key or an upload route that leaves its folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mithaq-storage-'))
  const adapter = local({ dir, secret, prefix: 'app' })
  await writeFile(join(dir, '..', 'mithaq-outside.txt'), 'outside').catch(() => {})
  for (const key of ['../mithaq-outside.txt', 'a/../../mithaq-outside.txt', '/etc/passwd', 'a\\..\\b', 'a//b', '', 'a/./b', 'a\0b']) {
    await assert.rejects(adapter.head({ key }), /names no file inside the storage folder/, key)
    await assert.rejects(adapter.handleDelete({ key }), /names no file inside the storage folder/, key)
    await assert.rejects(adapter.readHead({ key, bytes: 10 }), /names no file inside the storage folder/, key)
    await assert.rejects(adapter.uploadInstructions.generate({ filename: 'a', filesize: 1, mimeType: 'image/png', key }), /names no file inside the storage folder/, key)
  }
  assert.equal(await readFile(join(dir, '..', 'mithaq-outside.txt'), 'utf8'), 'outside')
  const other = local({ dir, secret: 'another-secret-of-at-least-thirty-two-chars', prefix: 'app' })
  const { request } = await other.uploadInstructions.generate({ filename: 'a.png', filesize: png.length, mimeType: 'image/png', key: 'a.png' })
  const forged = await adapter.handler!(new Request(new URL(request.url, 'http://test'), { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png }))
  assert.equal(forged?.status, 403)
  assert.equal(await exists(join(dir, 'a.png')), false)
  await rm(join(dir, '..', 'mithaq-outside.txt'), { force: true })
  await rm(dir, { recursive: true, force: true })
})

test('190a. the build refuses a second target of capability storage beside the rukn\'s, naming both', () => {
  const config = unused()
  const language = defineMithaq({
    arkan: [base, richText({ nodes: [...defaultNodes, UploadNode] }), storageRukn(config)],
    targets: {
      memory: memoryStore(),
      zod: zodTarget,
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
      files: storageTarget(config),
    },
  })
  const plain = language.defineKayan({ name: 'plain', targets: { service: { operations: defaultOperations } }, fields: { ...defaultFields } })
  assert.throws(() => language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [plain] }), /Targets "storage" and "files" both declare capability "storage", and a build has at most one storage target\. Drop one of them\./)
})

test('186h. the build refuses a storage that names no function, a kayan that cannot hold files, and public on a read that is not open', async () => {
  const operations = fileOperations(functions)
  for (const missing of ['key', 'verify', 'disposition', 'sweep', 'instructions', 'uploaded', 'removed', 'serve', 'onError'] as const) {
    await assert.rejects(project({ storage: { [missing]: undefined }, files: { service: { operations } } }), new RegExp(`storage names no "${missing}" function`), missing)
  }
  await assert.rejects(project({ storage: { fileSize: undefined } }), /storage names no "fileSize", the largest file in bytes/)
  await assert.rejects(project({ storage: { maxBodyBytes: undefined } }), /storage names no "maxBodyBytes", the largest request body/)
  for (const fileSize of [0, 1.5, '10']) {
    await assert.rejects(project({ storage: { fileSize: fileSize as never } }), new RegExp(`storage.fileSize is ${JSON.stringify(fileSize)}, and it is a whole number of bytes above 0`), String(fileSize))
  }
  await assert.rejects(project({ storage: { secret: 'short' } }), /storage.secret signs every upload reference/)
  await assert.rejects(project({ storage: { adapter: 's3' } }), /storage.adapter names "s3"/)
  // An adapter of the project's own names its prefix as `s3` does, with no slash at either end.
  for (const prefix of ['/app', 'app/']) {
    await assert.rejects(project({ wrap: (adapter) => ({ ...adapter, prefix }) }), new RegExp(`storage adapter "local" names prefix "${prefix}"`), prefix)
  }
  await assert.rejects(project({ files: { storage: { mimeTypes: [] } } }), /with mimeTypes \[\]/)
  await assert.rejects(project({ files: { versions: {} } }), /keeps versions, and a file never changes/)
  // Public hands out the adapter's address, so only a kayan everyone reads may say it.
  await assert.rejects(project({ files: { storage: { mimeTypes: ['image/png'], public: true } } }), /public: true, and its read is not open to everyone/)
  // A create that skips the verification is refused, since the row would name an unchecked object.
  await assert.rejects(
    project({ files: { storage: { mimeTypes: ['image/png'] }, service: { operations: defaultOperations } } }),
    /its operation "create" does not verify the upload before the row is made/,
  )
  await assert.rejects(
    project({ storage: { uploaded: async (ctx) => ctx }, files: { storage: { mimeTypes: ['image/png'] }, service: { operations: fileOperations(functions) } } }),
    /its operation "create" does not verify the upload before the row is made/,
  )
  const language = languageOf()
  const plain = language.defineKayan({ name: 'plain', targets: { service: { operations: defaultOperations } }, fields: { ...defaultFields } })
  const pointing = language.defineKayan({ name: 'pointing', targets: { service: { operations: defaultOperations } }, fields: { ...defaultFields, file: { kind: 'upload', relationTo: () => plain } } })
  assert.throws(() => language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [plain, pointing] }), /field "file" is an upload, and kayan "plain" it points at writes no targets.storage/)
})

test('202a. the build refuses a kayan holding files where no operation makes a row', async () => {
  const { create: _create, ...operations } = fileOperations(functions)
  await assert.rejects(
    project({ files: { service: { operations } } }),
    /Kayan "files" writes "targets\.storage", and no operation of it holds the "insert" step, so no file can be made\. Declare one that runs storage\.uploaded in beforeTransaction\./,
  )
})

test('202b. the build refuses a kayan holding files where two operations make a row', async () => {
  const operations = fileOperations(functions)
  await assert.rejects(
    project({ files: { service: { operations: { ...operations, upload: operations.create } } } }),
    /Kayan "files" writes "targets\.storage", and operations "create" and "upload" both hold the "insert" step\. A kayan that holds files makes its rows in one, the operation the upload instructions route asks the permission of\./,
  )
})

test('202c. the build refuses the operation that makes a row of a kayan holding files when it does not run the configured uploaded, whatever it is named', async () => {
  const { create, ...operations } = fileOperations(functions)
  await assert.rejects(
    project({ files: { service: { operations: { ...operations, upload: { ...create, beforeTransaction: [] } } } } }),
    /Kayan "files" writes "targets\.storage", and its operation "upload" does not verify the upload before the row is made: its beforeTransaction does not run storage\.uploaded, the step the storage rukn was handed\./,
  )
})

test('202d. a kayan holding files whose upload operation is its own runs that list, and the instructions route asks that operation\'s permission', async () => {
  const asked: unknown[] = []
  const ran: string[] = []
  const { create, ...operations } = fileOperations(functions)
  const built = await project({
    authorize: async ({ operation, kind }) => void asked.push(kind === 'insert' && operation),
    files: { service: { operations: { ...operations, upload: { ...create, afterSteps: [(ctx: object) => (ran.push('upload'), ctx)] } } } },
  })
  const { file } = await upload(built, 'org-a')
  assert.deepEqual(asked, ['upload'], 'the route asks the operation that makes the row, not one named create')
  assert.equal((await create_(built, 'files/create', file.uploadReference)).status, 404, 'the shipped create is left out')
  const made = await create_(built, 'files/upload', file.uploadReference)
  assert.equal(made.status, 200, await made.clone().text())
  assert.deepEqual(ran, ['upload'])
  assert.equal(await exists(join(built.dir, String(file.uploadReference.key))), true)
  await rm(built.dir, { recursive: true, force: true })
  function create_(one: Built, path: string, uploadReference: unknown) {
    return send(one, 'POST', `/api/${path}`, { org: 'org-a', json: { uploadReference, title: 'A cover' } })
  }
})

test('186i. a public kayan whose read is open hands out the adapter\'s own address as its url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mithaq-storage-'))
  const adapter: StorageAdapter = { ...local({ dir, secret, prefix: 'app' }), generateURL: ({ key }) => `https://cdn.example/${key}` }
  const built = await project({
    storage: { adapters: { local: adapter } },
    files: { storage: { mimeTypes: ['image/png'], public: true } },
  }).catch((error: Error) => error)
  // The fixture's read is the tenant's, so it is refused; an open read builds.
  assert.ok(built instanceof Error)
  const language = languageOf({ config: { secret, adapters: { local: adapter }, adapter: 'local', ...functions } })
  const open = language.defineKayan({
    name: 'files',
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { storage: { mimeTypes: ['image/png'], public: true }, service: { operations: fileOperations(functions) } },
    fields: { ...defaultFields, ...uploadFields },
  } as never)
  const asas = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [open] } as never) as unknown as {
    kayan: { files: { operations: { find(input: unknown, options: unknown): Promise<{ docs: Record<string, unknown>[] }> } } }
    targets: { memory: { rows: Map<string, Record<string, unknown>[]> } }
  }
  asas.targets.memory.rows.set('files', [{ id: '00000000-0000-4000-8000-000000000001', key: 't/files/x/a.png', storage: 'local', filename: 'a.png', mimeType: 'image/png', filesize: 1, width: null, height: null, createdAt: new Date(), updatedAt: new Date() }])
  const { docs } = await asas.kayan.files.operations.find({}, { actor: null })
  assert.equal(docs[0]!.url, 'https://cdn.example/t/files/x/a.png')
  await rm(dir, { recursive: true, force: true })
})

test('186j. storage sweep --check reports an object no row names and deletes nothing, and a plain sweep removes it', async () => {
  const built = await project()
  const { file } = await upload(built, 'org-a')
  assert.equal((await create(built, 'org-a', file.uploadReference)).status, 200)
  const named = join(built.dir, String(file.uploadReference.key))
  const orphan = join(built.dir, 'app/org-a/files/lost/orphan.png')
  const fresh = join(built.dir, 'app/org-a/files/new/fresh.png')
  // Another app's object in the same store, outside this adapter's prefix.
  const outside = join(built.dir, 'other-app/org-a/files/x/theirs.png')
  for (const path of [orphan, fresh, outside]) {
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, png)
  }
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  await utimes(orphan, old, old)
  await utimes(named, old, old)
  await utimes(outside, old, old)
  const printed: string[] = []
  const { log } = console
  console.log = (...line: unknown[]) => void printed.push(line.join(' '))
  try {
    assert.equal(await built.asas.targets.storage.commands.sweep({ asas: built.asas, flags: ['--check'] }), 0)
  } finally {
    console.log = log
  }
  assert.deepEqual(printed, ['Orphan in "local": app/org-a/files/lost/orphan.png'])
  assert.equal(await exists(orphan), true, '--check deletes nothing')
  console.log = () => {}
  try {
    assert.equal(await built.asas.targets.storage.commands.sweep({ asas: built.asas, flags: [] }), 0)
  } finally {
    console.log = log
  }
  assert.equal(await exists(orphan), false)
  assert.equal(await exists(named), true, 'a key a row names stays')
  assert.equal(await exists(fresh), true, 'an object younger than a day stays, since its create may still come')
  assert.equal(await exists(outside), true, 'an object outside the prefix is never swept')
  await rm(built.dir, { recursive: true, force: true })
})

test('186k. the UploadThing adapter reads, signs and deletes by key over its HTTP API, and uploads nothing', async () => {
  const calls: { url: string; method: string; headers: Headers; body?: string }[] = []
  const answers: Record<string, () => Response> = {
    'HEAD https://app-1.ufs.sh/f/abc': () => new Response(null, { status: 200, headers: { 'content-length': '67' } }),
    'HEAD https://app-1.ufs.sh/f/gone': () => new Response(null, { status: 404 }),
    'GET https://app-1.ufs.sh/f/abc': () => new Response(png, { status: 206 }),
    'POST https://api.uploadthing.com/v6/deleteFiles': () => Response.json({ success: true }),
    'POST https://api.uploadthing.com/v6/requestFileAccess': () => Response.json({ url: 'https://app-1.ufs.sh/f/abc?signature=x' }),
  }
  const fake = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body as string | undefined })
    return answers[`${method} ${url}`]!()
  }) as typeof fetch
  const adapter = uploadthing({ token: Buffer.from(JSON.stringify({ apiKey: 'sk_test', appId: 'app-1', regions: ['sea1'] })).toString('base64'), fetch: fake })
  assert.deepEqual(await adapter.head({ key: 'abc' }), { size: 67 })
  assert.equal(await adapter.head({ key: 'gone' }), null)
  assert.deepEqual(await adapter.readHead({ key: 'abc', bytes: 10 }), png.subarray(0, 10))
  assert.equal(calls.at(-1)!.headers.get('range'), 'bytes=0-9')
  await adapter.handleDelete({ key: 'abc' })
  assert.equal(calls.at(-1)!.headers.get('x-uploadthing-api-key'), 'sk_test')
  assert.deepEqual(JSON.parse(calls.at(-1)!.body!), { fileKeys: ['abc'] })
  const served = await adapter.staticHandler(new Request('http://test/'), { doc: { id: '1', key: 'abc', filename: 'a.png', mimeType: 'image/png', filesize: 67, storage: 'uploadthing' }, disposition: 'inline' })
  assert.equal(served.status, 302)
  assert.equal(served.headers.get('location'), 'https://app-1.ufs.sh/f/abc?signature=x')
  assert.deepEqual(JSON.parse(calls.at(-1)!.body!), { fileKey: 'abc', expiresIn: 300 })
  assert.equal(adapter.generateURL!({ key: 'abc' }), 'https://app-1.ufs.sh/f/abc')
  await assert.rejects(adapter.uploadInstructions.generate({ filename: 'a.png', filesize: 1, mimeType: 'image/png', key: 'k' }), /uploads none/)
  assert.equal(adapter.list, undefined, 'no list, so the sweep passes it over')
})

/**
 * The S3 adapter against a real bucket: a MinIO a person started for this
 * run, named by four variables, or skipped. Never a bucket of the project's.
 */
const s3Env = ['S3_TEST_ENDPOINT', 'S3_TEST_BUCKET', 'S3_TEST_ACCESS_KEY_ID', 'S3_TEST_SECRET_ACCESS_KEY'] as const
test('186l. the S3 adapter signs a PUT the bucket holds to its type and size, reads the object back, signs a GET with the disposition and deletes it', { skip: s3Env.some((name) => !process.env[name]) && `set ${s3Env.join(', ')} to a throwaway bucket to run this` }, async () => {
  const bucket = (prefix: string) => s3({
    endpoint: process.env.S3_TEST_ENDPOINT!,
    bucket: process.env.S3_TEST_BUCKET!,
    region: 'us-east-1',
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY!,
    prefix,
  })
  const run = crypto.randomUUID()
  const adapter = bucket(`mithaq-test/${run}/mine`)
  const theirs = bucket(`mithaq-test/${run}/theirs`)
  const key = `mithaq-test/${run}/mine/cover image.png`
  const theirKey = `mithaq-test/${run}/theirs/kept.png`
  try {
    const { request } = await adapter.uploadInstructions.generate({ filename: 'cover image.png', filesize: png.length, mimeType: 'image/png', key })
    // Another type than the one signed is refused by the bucket itself.
    const wrong = await fetch(request.url, { method: 'PUT', headers: { ...request.headers, 'Content-Type': 'text/html' }, body: png })
    assert.equal(wrong.ok, false)
    const longer = await fetch(request.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png.length + 10) })
    assert.equal(longer.ok, false)
    assert.equal(await adapter.head({ key }), null)
    const put = await fetch(request.url, { method: 'PUT', headers: request.headers, body: png })
    assert.equal(put.status, 200, await put.text())
    // Once only: a second PUT with the same signature would replace a verified object.
    const again = await fetch(request.url, { method: 'PUT', headers: request.headers, body: png })
    assert.equal(again.status, 412)
    assert.deepEqual(await adapter.head({ key }), { size: png.length })
    assert.deepEqual(await adapter.readHead({ key, bytes: 4100 }), png)
    assert.deepEqual(await defaultVerify({ adapter, key, mimeType: 'image/png', size: png.length, mimeTypes: ['image/png'], fileSize: 1000 }), { width: 1, height: 1 })
    assert.deepEqual(await defaultVerify({ adapter, key, mimeType: 'image/jpeg', size: png.length, mimeTypes: ['image/jpeg'], fileSize: 1000 }), { refused: 'The file is image/png, and image/jpeg was declared.' })
    const theirPut = await theirs.uploadInstructions.generate({ filename: 'kept.png', filesize: png.length, mimeType: 'image/png', key: theirKey })
    assert.equal((await fetch(theirPut.request.url, { method: 'PUT', headers: theirPut.request.headers, body: png })).status, 200)
    const listed: string[] = []
    for await (const one of adapter.list!()) listed.push(one.key)
    assert.deepEqual(listed, [key], 'a list reads its own prefix alone')
    // A sweep a day on deletes its own orphan and never the other app's object.
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    assert.deepEqual(await defaultSweep({ adapter, named: new Set(), check: true, now: later }), [key])
    assert.deepEqual(await theirs.head({ key: theirKey }), { size: png.length })
    const served = await adapter.staticHandler(new Request('http://test/'), {
      doc: { id: '1', key, filename: 'cover image.png', mimeType: 'image/png', filesize: png.length, storage: 's3' },
      disposition: defaultDisposition({ filename: 'cover image.png', mimeType: 'image/png' }),
    })
    assert.equal(served.status, 302)
    const read = await fetch(served.headers.get('location')!)
    assert.equal(read.status, 200)
    assert.match(read.headers.get('content-disposition') ?? '', /^inline; filename="cover image.png"/)
    assert.deepEqual(new Uint8Array(await read.arrayBuffer()), png)
    assert.deepEqual(await defaultSweep({ adapter, named: new Set(), check: false, now: later }), [key])
    assert.deepEqual(await theirs.head({ key: theirKey }), { size: png.length }, 'the other app keeps its object')
  } finally {
    await adapter.handleDelete({ key })
    await theirs.handleDelete({ key: theirKey })
  }
  assert.equal(await adapter.head({ key }), null)
})

test('186n. the S3 adapter signs a PUT for ten minutes over its type, size, host and once-only header, and a GET for five minutes carrying the disposition', async () => {
  const adapter = s3({ endpoint: 'https://s3.example', bucket: 'b', region: 'us-east-1', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', prefix: 'app' })
  const { request } = await adapter.uploadInstructions.generate({ filename: 'a.png', filesize: 67, mimeType: 'image/png', key: 'app/t/files/1/a.png' })
  const put = new URL(request.url)
  assert.equal(put.origin + put.pathname, 'https://s3.example/b/app/t/files/1/a.png')
  assert.equal(put.searchParams.get('X-Amz-Expires'), '600')
  assert.equal(put.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match')
  assert.deepEqual(request.headers, { 'Content-Type': 'image/png', 'Content-Length': '67', 'If-None-Match': '*' })
  const served = await adapter.staticHandler(new Request('http://test/'), { doc: { id: '1', key: 'app/t/files/1/a.png', filename: 'a.png', mimeType: 'image/png', filesize: 67, storage: 's3' }, disposition: 'attachment; filename="a.png"' })
  const get = new URL(served.headers.get('location')!)
  assert.equal(get.searchParams.get('X-Amz-Expires'), '300')
  assert.equal(get.searchParams.get('response-content-disposition'), 'attachment; filename="a.png"')
  assert.equal(get.searchParams.get('response-content-type'), 'image/png')
  for (const prefix of ['', '/app', 'app/', 'a/../b']) {
    assert.throws(() => s3({ endpoint: 'https://s3.example', bucket: 'b', region: 'us-east-1', accessKeyId: 'a', secretAccessKey: 's', prefix }), /prefix/, prefix)
  }
})

/** Imports the template's storage under an environment of its own, and answers how it ended. */
const boot = (env: Record<string, string>) =>
  new Promise<{ code: number | null; out: string }>((done) => {
    const child = execFile(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./index.ts', import.meta.url).href)}).then((one) => console.log('adapter', one.storageConfig.adapter))`], {
      env: { PATH: process.env.PATH!, ...env } as unknown as NodeJS.ProcessEnv,
    }, () => {})
    let out = ''
    child.stdout!.on('data', (chunk) => (out += chunk))
    child.stderr!.on('data', (chunk) => (out += chunk))
    child.on('close', (code) => done({ code, out }))
  })

test('186p. the template\'s storage names its adapter, prefix and secret in production, refuses a partial R2, and says in development that its secret is the process\'s own', async () => {
  const r2 = { R2_ACCOUNT_ID: 'acc', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }
  const named = { STORAGE_SECRET: 'x'.repeat(32), STORAGE_PREFIX: 'mithaq/asas', STORAGE_ADAPTER: 'r2', ...r2 }
  const production = (env: Record<string, string>) => boot({ NODE_ENV: 'production', ...env })
  const { STORAGE_SECRET: _secret, ...noSecret } = named
  assert.match((await production(noSecret)).out, /STORAGE_SECRET/)
  const { STORAGE_ADAPTER: _adapter, ...noAdapter } = named
  assert.match((await production(noAdapter)).out, /STORAGE_ADAPTER/)
  const { STORAGE_PREFIX: _prefix, ...noPrefix } = named
  assert.match((await production(noPrefix)).out, /STORAGE_PREFIX/)
  const { R2_BUCKET: _bucket, ...partial } = named
  const half = await production(partial)
  assert.notEqual(half.code, 0)
  assert.match(half.out, /R2_BUCKET/)
  assert.match((await production(named)).out, /^adapter r2$/m)
  assert.match((await production({ STORAGE_SECRET: 'x'.repeat(32), STORAGE_PREFIX: 'mithaq/asas', STORAGE_ADAPTER: 'local' })).out, /^adapter local$/m)
  const development = await boot({})
  assert.equal(development.code, 0)
  assert.match(development.out, /^adapter local$/m)
  assert.equal(development.out.match(/STORAGE_SECRET/g)?.length, 1, 'development warns once that its secret is the process\'s own')
})

test('186t. a rich text upload node saves pointing at a kayan of the build that holds files, and is refused pointing at one that holds none', async () => {
  const built = await project()
  const { file } = await upload(built, 'org-a')
  const row = await (await create(built, 'org-a', file.uploadReference)).json() as { id: string }
  // The memory store makes no id and fills no column, so the note names both.
  const note = (relationTo: string, value: unknown) => ({ id: crypto.randomUUID(), cover: row.id, body: body(relationTo, value) })
  const body = (relationTo: string, value: unknown) => ({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'upload', version: 3, format: '', id: 'n1', relationTo, value, fields: null }] } })
  const saved = await send(built, 'POST', '/api/notes/create', { org: 'org-a', json: note('files', row.id) })
  assert.equal(saved.status, 200, await saved.clone().text())
  assert.equal(((await saved.json()) as { body: { root: { children: { relationTo: string }[] } } }).body.root.children[0]!.relationTo, 'files')
  for (const [relationTo, value] of [['notes', row.id], ['files', 7]] as const) {
    const refused = await send(built, 'POST', '/api/notes/create', { org: 'org-a', json: note(relationTo, value) })
    assert.equal(refused.status, 400, `${relationTo} ${String(value)}`)
    assert.match(String(await keyOf(refused)), /invalid/)
  }
  await rm(built.dir, { recursive: true, force: true })
})

test('186ad. a required rich text holding only an image is content on both schema targets, and one holding an empty paragraph is still refused', async () => {
  const built = await project()
  const { file } = await upload(built, 'org-a')
  const row = await (await create(built, 'org-a', file.uploadReference)).json() as { id: string }
  const root = (...children: unknown[]) => ({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children } })
  const image = root({ type: 'upload', version: 3, format: '', id: 'n1', relationTo: 'files', value: row.id, fields: null })
  const empty = root({ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', children: [] })
  for (const kayan of ['notes', 'plainNotes']) {
    const send = (body: unknown) => send_(kayan, body)
    const taken = await send(image)
    assert.equal(taken.status, 200, `${kayan}: ${await taken.clone().text()}`)
    const refused = await send(empty)
    assert.equal(refused.status, 400, `${kayan}: an empty paragraph is no content`)
    assert.match(await refused.text(), /\.body\.required/)
  }
  function send_(kayan: string, body: unknown) {
    return send(built, 'POST', `/api/${kayan}/create`, { org: 'org-a', json: { id: crypto.randomUUID(), cover: row.id, body } })
  }
  await rm(built.dir, { recursive: true, force: true })
})

test('189a. a project that replaces uploaded has its own step run on create, and the default does not', async () => {
  const ran: string[] = []
  // A step of the project's own, built from core's building block alone: it
  // takes the reference and writes the row, and verifies nothing, which is
  // what lets this test tell it from the default. A real replacement must
  // call the config's `verify` and delete the object it refuses, as
  // `defaultUploaded` does.
  const uploaded: StorageConfig['uploaded'] = async (ctx) => {
    ran.push('mine')
    const reference = await checkReference({ kayan: ctx.kayan, value: ctx.data.uploadReference, actor: ctx.actor })
    const { uploadReference: _used, ...data } = ctx.data
    return { ...ctx, data: { ...data, id: reference.id, key: reference.key, storage: reference.storage, filename: reference.filename, mimeType: reference.type, filesize: reference.size, width: 42, height: 42 } }
  }
  const built = await project({ storage: { uploaded } })
  // A JPEG declared a PNG: the default's verification would refuse it and delete it.
  const { file } = await upload(built, 'org-a', { bytes: jpeg })
  const made = await create(built, 'org-a', file.uploadReference)
  assert.equal(made.status, 200, await made.clone().text())
  assert.deepEqual(ran, ['mine'])
  assert.equal(((await made.json()) as { width: number }).width, 42)
  assert.equal(await exists(join(built.dir, String(file.uploadReference.key))), true, 'the default never ran, so nothing deleted the object')
  await rm(built.dir, { recursive: true, force: true })
})

test('189b. a key with an empty, . or .. segment is never signed, even when a replaced instructions skips sanitizeFilename', async () => {
  // Instructions of the project's own that hand the caller's name to core as it came.
  const instructions: StorageConfig['instructions'] = async ({ kayan, input, actor }) => {
    const { filename, mimeType, filesize } = input as { filename: string; mimeType: string; filesize: number }
    const uploadReference = signReference({ kayan, actor, id: crypto.randomUUID(), filename, type: mimeType, size: filesize })
    return { type: 'http', request: { method: 'PUT', url: '/nowhere' }, file: { filename, mimeType, size: filesize, uploadReference } }
  }
  const built = await project({ storage: { instructions } })
  const ask = (filename: string) => send(built, 'POST', '/api/files/uploadInstructions', { org: 'org-a', json: { filename, filesize: 10, mimeType: 'image/png' } })
  for (const filename of ['../../../outside.png', 'a/../../b.png', './a.png', 'a//b.png', 'a/', 'a\\..\\b.png', 'a\0b.png']) {
    const asked = await ask(filename)
    assert.equal(asked.status, 400, filename)
    assert.equal(await keyOf(asked), 'error.invalid.upload_request', `${filename} is signed for no key`)
  }
  assert.equal((await ask('cover.png')).status, 200, 'a plain name is still signed')
  // An encoded dot is no dot: nothing decodes a key, so it signs as a literal
  // folder name under the row's own, and climbs out of nothing.
  const encoded = await ask('%2e%2e/x.png')
  assert.equal(encoded.status, 200)
  assert.match(((await encoded.json()) as { file: { uploadReference: { key: string } } }).file.uploadReference.key, /^app\/_\/files\/[0-9a-f-]{36}\/%2e%2e\/x\.png$/)
  assert.equal(sanitizeFilename('%2e%2e/x.png'), 'x.png')
  await rm(built.dir, { recursive: true, force: true })
})

/** Makes a file and deletes its row, and answers whether the object is still there. */
const deleteFile = async ({ storage = {}, softDelete, operations, built: seen }: { storage?: Partial<StorageConfig>; softDelete: boolean; operations: Record<string, unknown>; built?: (one: Built) => void }) => {
  const built = await project({ storage, softDelete, files: { service: { operations } } })
  seen?.(built)
  const { file } = await upload(built, 'org-a')
  const made = await create(built, 'org-a', file.uploadReference)
  assert.equal(made.status, 200, await made.clone().text())
  const row = await made.json() as { id: string; key: string }
  const deleted = await send(built, 'POST', '/api/files/delete', { org: 'org-a', json: { id: row.id } })
  assert.equal(deleted.status, 200, await deleted.clone().text())
  const kept = await exists(join(built.dir, row.key))
  await rm(built.dir, { recursive: true, force: true })
  return kept
}

/** The refusal of a soft-deleting kayan whose delete runs the configured removed in `slot`. */
const removesMarked = (slot: string) =>
  new RegExp(`Kayan "files" writes "targets\\.storage" and marks its rows deleted, and its operation "delete" runs storage\\.removed in "${slot}", which would remove the object of a row that is only marked\\. Leave storage\\.removed out of its lists\\.`)

test('189e. a key that does not hold the row id is never signed, so no two rows can name one object', async () => {
  const built = await project({ storage: { key: ({ prefix, filename }) => `${prefix}/${filename}` } })
  const asked = await send(built, 'POST', '/api/files/uploadInstructions', { org: 'org-a', json: { filename: 'cover.png', filesize: 10, mimeType: 'image/png' } })
  assert.equal(asked.status, 500)
  assert.equal(await exists(join(built.dir, 'cover.png')), false)
  await rm(built.dir, { recursive: true, force: true })
})

test('189g. an id that is only part of another segment of the key is never signed, and an id that is a whole segment is', async () => {
  const asked = async (key: StorageConfig['key']) => {
    const instructions: StorageConfig['instructions'] = async ({ kayan, input, actor }) => {
      const { filename, mimeType, filesize } = input as { filename: string; mimeType: string; filesize: number }
      const uploadReference = signReference({ kayan, actor, id: '1', filename, type: mimeType, size: filesize })
      return { type: 'http', request: { method: 'PUT', url: '/nowhere' }, file: { filename, mimeType, size: filesize, uploadReference } }
    }
    const built = await project({ storage: { key, instructions } })
    const response = await send(built, 'POST', '/api/files/uploadInstructions', { org: 'org-a', json: { filename: 'cover.png', filesize: 10, mimeType: 'image/png' } })
    await rm(built.dir, { recursive: true, force: true })
    return response.status
  }
  assert.equal(await asked(({ prefix, filename }) => `${prefix}/10/${filename}`), 500, 'id 1 is inside the segment 10')
  assert.equal(await asked(({ prefix, id, filename }) => `${prefix}/${id}x/${filename}`), 500, 'id 1 is inside the segment 1x')
  assert.equal(await asked(({ prefix, id, filename }) => `${prefix}/${id}/${filename}`), 200)
})

test('189f. a kayan holding files keeps its key unique across the whole store, and refuses indexes that make it any narrower', () => {
  const language = languageOf()
  const files = (indexes: unknown) =>
    language.defineKayan({
      name: 'files',
      targets: { storage: { mimeTypes: ['image/png'] }, service: { operations: fileOperations(functions) } },
      fields: { ...defaultFields, ...uploadFields, title: { kind: 'text' } },
      indexes,
    } as never)
  const build = (indexes: unknown) => language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [files(indexes)] } as never)
  assert.doesNotThrow(() => build(undefined))
  assert.throws(
    () => build(() => [{ fields: ['title', 'key'], unique: true }]),
    /^Error: Kayan "files" writes "targets.storage", and builds no unique index over "key" alone, while a key is the address of one object in a store every kayan and organization shares\. Keep the default unique index over "key" in indexes\.$/,
  )
})

test('189c. a soft-deleting kayan whose delete runs a replaced removed in any list is refused, one that leaves it out keeps the object of a marked row, and a hard-deleting kayan runs it after the commit', async () => {
  const ran: string[] = []
  let built: Built | undefined
  // A delete step of the project's own that deletes the object whatever the
  // kayan does with its rows, and notes whether the row was already gone.
  const removed: StorageConfig['removed'] = async (ctx) => {
    const row = ctx.dataBefore ?? ctx.data
    ran.push(built!.asas.targets.memory.rows.get('files')!.some((one) => one.id === row.id) ? 'before the commit' : 'after the commit')
    await adapterOf({ kayan: ctx.kayan, name: row.storage }).handleDelete({ key: String(row.key) })
    return ctx
  }
  const operations = fileOperations({ ...functions, removed })
  // A marked row still names its object, so a delete that would remove it is
  // refused at build, in whichever list the step sits.
  const placed = {
    afterCommit: operations.delete,
    afterSteps: { ...defaultOperations.delete, afterSteps: [removed] },
    steps: { steps: [removed, ...defaultOperations.delete.steps] },
    beforeTransaction: { ...defaultOperations.delete, beforeTransaction: [removed] },
  }
  for (const [slot, one] of Object.entries(placed)) {
    await assert.rejects(project({ storage: { removed }, softDelete: true, files: { service: { operations: { ...operations, delete: one } } } }), removesMarked(slot), slot)
  }
  const keep = (one: Built) => void (built = one)
  assert.equal(await deleteFile({ storage: { removed }, softDelete: true, operations: { ...operations, delete: defaultOperations.delete }, built: keep }), true, 'a row marked deleted keeps its object')
  assert.deepEqual(ran, [])
  assert.equal(await deleteFile({ storage: { removed }, softDelete: false, operations, built: keep }), false, 'a deleted row takes its object')
  assert.deepEqual(ran, ['after the commit'])
})

test('202e. a soft-deleting kayan keeps the object of a marked row wherever its delete puts the shipped removed: refused in a list, and a no-op when wrapped', async () => {
  const { removed } = functions
  const operations = fileOperations(functions)
  for (const [slot, one] of Object.entries({
    afterSteps: { ...defaultOperations.delete, afterSteps: [removed] },
    steps: { steps: [removed, ...defaultOperations.delete.steps] },
  })) {
    await assert.rejects(project({ softDelete: true, files: { service: { operations: { ...operations, delete: one } } } }), removesMarked(slot), slot)
  }
  // Wrapped, the step is not the configured one, so the build cannot
  // see it, and the shipped step's own guard keeps the object.
  const wrapped: StorageConfig['removed'] = async (ctx, tools) => removed(ctx, tools)
  for (const one of [
    { ...defaultOperations.delete, afterCommit: [wrapped] },
    { ...defaultOperations.delete, afterSteps: [wrapped] },
    { steps: [wrapped, ...defaultOperations.delete.steps] },
  ]) {
    assert.equal(await deleteFile({ softDelete: true, operations: { ...operations, delete: one } }), true, 'a row marked deleted keeps its object')
  }
})

test('193a. a file route that fails with no refusal answers 500 and hands what it threw to the project\'s own onError', async () => {
  const fault = new Error('The bucket is down.')
  const heard: unknown[] = []
  const built = await project({ storage: { serve: async () => { throw fault }, onError: (error) => void heard.push(error) } })
  const { file } = await upload(built, 'org-a')
  const row = await (await create(built, 'org-a', file.uploadReference)).json() as { url: string }
  const served = await send(built, 'GET', row.url, { org: 'org-a' })
  assert.equal(served.status, 500)
  assert.equal(((await served.json()) as { message: string }).message, 'Internal server error', 'nothing the fault carried reaches the caller')
  assert.deepEqual(heard, [fault], 'and the project is told, once')
  await rm(built.dir, { recursive: true, force: true })
})

test('189d. a replaced serve that sets no headers still answers nosniff, and a private file no-store, its redirect too, and a public file no private no-store', async () => {
  const serve: StorageConfig['serve'] = async ({ kayan, id, read }) => {
    await readForFile({ kayan, id, read })
    return new Response(png)
  }
  // A redirect, as an adapter with signed addresses answers, with no header but its Location.
  const redirect: StorageConfig['serve'] = async ({ kayan, id, read }) => {
    await readForFile({ kayan, id, read })
    return new Response(null, { status: 302, headers: { Location: '/x' } })
  }
  for (const [one, status] of [[serve, 200], [redirect, 302]] as const) {
    const built = await project({ storage: { serve: one } })
    const { file } = await upload(built, 'org-a')
    const row = await (await create(built, 'org-a', file.uploadReference)).json() as { url: string }
    const served = await send(built, 'GET', row.url, { org: 'org-a' })
    assert.equal(served.status, status)
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff', String(status))
    assert.equal(served.headers.get('cache-control'), 'private, no-store', String(status))
    await rm(built.dir, { recursive: true, force: true })
  }
  // A public kayan whose read is open: nosniff still, and none of a private file's no-store.
  const dir = await mkdtemp(join(tmpdir(), 'mithaq-storage-'))
  const adapter: StorageAdapter = { ...local({ dir, secret, prefix: 'app' }), generateURL: ({ key }) => `https://cdn.example/${key}` }
  const language = languageOf({ config: { secret, adapters: { local: adapter }, adapter: 'local', ...functions, serve } })
  const open = language.defineKayan({
    name: 'files',
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { storage: { mimeTypes: ['image/png'], public: true }, service: { operations: fileOperations(functions) } },
    fields: { ...defaultFields, ...uploadFields },
  } as never)
  const asas = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [open] } as never) as unknown as {
    handler(request: Request): Promise<Response>
    targets: { memory: { rows: Map<string, Record<string, unknown>[]> } }
  }
  const id = '00000000-0000-4000-8000-000000000001'
  asas.targets.memory.rows.set('files', [{ id, key: 'app/t/files/x/a.png', storage: 'local', filename: 'a.png', mimeType: 'image/png', filesize: 1, width: null, height: null, createdAt: new Date(), updatedAt: new Date() }])
  const served = await asas.handler(new Request(`http://test/api/files/file/${id}`))
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.notEqual(served.headers.get('cache-control'), 'private, no-store')
  await rm(dir, { recursive: true, force: true })
})
