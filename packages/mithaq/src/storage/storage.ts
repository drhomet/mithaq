import { cleanupUploadedRows } from './cleanup.ts'
import { countUnattached } from './references.ts'
// The object key is decided before the upload and the row that names it is made
// in one insert after the upload is verified, so no stored file goes unnamed by a failed second write.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { isStorage, type Command, type CommandInput, type Language, type Store } from '../mithaq/language.ts'
import type { Field, ResolvedField, ResolvedKayan } from '../mithaq/types.ts'
import { providerOf } from '../base/rules.ts'
import { AsasError, retryConflict, codes, denied, invalid, missing } from '../asas/runner/errors.ts'
import { sealOf, type Ctx } from '../asas/runner/steps.ts'
import type { Authorize, ManagedAdmin } from '../asas/runner/write.ts'
import type { StandardSchemaV1 } from '../mithaq/standard-schema.ts'
import { assertMaxBodyBytes, boundedBody } from '../asas/http/fetch.ts'
import { allowedType } from './allowed-type.ts'

/** Written by the runner when the row is made, from the signed upload, and by nobody after. */
const fileColumn = { create: 'application', update: 'never' } as const

/**
 * The file columns a kayan that holds files spreads into its fields beside `defaultFields`.
 * Filled from the verified upload and never changed: a file is replaced by a new row.
 */
export const uploadFields = {
  filename: { kind: 'text', label: { en: 'File name', ar: 'اسم الملف' }, rules: { providedBy: fileColumn, required: true, index: true } },
  mimeType: { kind: 'text', label: { en: 'File type', ar: 'نوع الملف' }, rules: { providedBy: fileColumn, required: true } },
  filesize: { kind: 'number', label: { en: 'File size', ar: 'حجم الملف' }, rules: { providedBy: fileColumn, required: true } },
  width: { kind: 'number', label: { en: 'Width', ar: 'العرض' }, rules: { providedBy: fileColumn } },
  height: { kind: 'number', label: { en: 'Height', ar: 'الارتفاع' }, rules: { providedBy: fileColumn } },
  key: { kind: 'text', label: { en: 'Object key', ar: 'مفتاح الملف' }, rules: { providedBy: fileColumn, required: true, unique: true } },
  storage: { kind: 'text', label: { en: 'Storage', ar: 'التخزين' }, rules: { providedBy: fileColumn, required: true } },
} as const satisfies Record<string, Field>

/** Optional ownership without a foreign key, so deleting a user never holds their files. */
export const uploadedByField = {
  uploadedBy: { kind: 'text', label: { en: 'Uploaded by', ar: 'رفع بواسطة' }, rules: { providedBy: fileColumn, index: true } },
} as const satisfies Record<string, Field>

/** Match the shipped ownership policy without claiming a project's same-named field. */
export const isUploadedBy = (field: ResolvedField | undefined): boolean =>
  !!field && field.kind === 'text' && providerOf(field, 'create') === 'application' && providerOf(field, 'update') === 'never' && !field.relationTo

/** The storage target as the language holds it: a capability, the project's config, and the `sweep` command. */
export type StorageTarget = {
  readonly capability: 'storage'
  readonly type: 'storage'
  readonly config: StorageConfig
  readonly commands: { readonly sweep: Command }
}

/** What a kayan writes under the storage target: the types it holds, its largest file in bytes, and whether its `url` is public. */
export type KayanStorage = {
  readonly mimeTypes: readonly string[]
  readonly fileSize?: number
  readonly public?: true
  readonly orphanAfter?: number
  readonly maxUnattached?: number
}

/** The request the browser sends the file with. */
export type UploadRequest = {
  type: 'http'
  request: { method: 'PUT' | 'POST'; url: string; headers?: Record<string, string> }
}

/** What the browser sends the file with, and the signed reference the create takes back. */
export type UploadInstructions = UploadRequest & {
  file: { filename: string; mimeType: string; size: number; uploadReference: UploadReference }
}

/** A row of a storage kayan, as much of it as an adapter reads. */
export type StoredFile = { id: unknown; key: string; filename: string; mimeType: string; filesize: number; storage: string }

/** One place files are kept. */
export type StorageAdapter = {
  /** The folder of the store this adapter owns; `list` reads it alone, so a sweep of a shared bucket touches no other app's objects. */
  prefix: string
  uploadInstructions: { generate(args: { filename: string; filesize: number; mimeType: string; key: string }): Promise<UploadRequest> }
  handleDelete(args: { key: string }): Promise<void>
  /** The public address of an object, for a kayan that writes `public: true`. */
  generateURL?(args: { key: string }): string
  /** A 302 to a short-lived signed address, or the bytes themselves. */
  staticHandler(request: Request, args: { doc: StoredFile; disposition: string }): Promise<Response>
  /** The stored object's size, or null where there is none. */
  head(args: { key: string }): Promise<{ size: number } | null>
  /** The first `bytes` of the stored object. */
  readHead(args: { key: string; bytes: number }): Promise<Uint8Array>
  /** Every object this adapter holds, with when it was last written. */
  list?(): AsyncIterable<{ key: string; lastModified: Date }>
  handler?(request: Request): Promise<Response | null>
}

/** What a verification reads, and what it answers: the image's size, or why the file is refused. */
export type VerifyArgs = { adapter: StorageAdapter; key: string; mimeType: string; size: number; mimeTypes: readonly string[]; fileSize: number }
export type Verified = { width?: number | null; height?: number | null } | { refused: string }

/** What a sweep is handed, per adapter, and the keys it found no row naming. */
export type SweepArgs = { adapter: StorageAdapter; named: ReadonlySet<string>; check: boolean; now: Date }

/** A step of the storage flow, `(ctx, tools)` as every step is. */
export type StorageStep = (ctx: Ctx, tools?: unknown) => Promise<Ctx>

/** What the storage rukn takes, `storage(storageConfig)`. Every key is required. */
export type StorageConfig = {
  /** The key upload references are signed with, 32 characters at least. */
  secret: string
  /** Every adapter by the name a row's `storage` column holds. */
  adapters: Readonly<Record<string, StorageAdapter>>
  /** The adapter a new upload goes to. */
  adapter: string
  /** The largest file in bytes a kayan holds when its `targets.storage` names no `fileSize`. */
  fileSize: number
  /** The largest request body `uploadInstructions` reads, answered 413 past it: `defaultMaxBodyBytes` or the project's own. */
  maxBodyBytes: number
  /** The object key, decided before the upload. */
  key: (args: { prefix: string; tenant: string | null; kayan: string; id: string; filename: string }) => string
  verify: (args: VerifyArgs) => Promise<Verified>
  disposition: (args: { filename: string; mimeType: string }) => string
  sweep: (args: SweepArgs) => Promise<string[]>
  /** `POST /api/<kayan>/uploadInstructions`, asked once the actor holds the operation that makes the kayan's rows. */
  instructions: (args: { kayan: StorageKayan; input: unknown; actor: unknown }) => Promise<UploadInstructions>
  /** The `beforeTransaction` step of the operation that makes a row: the reference checked, the object verified, the file columns written. */
  uploaded: StorageStep
  /** The delete's `afterCommit` step, removing the deleted row's object. */
  removed: StorageStep
  /** `GET /api/<kayan>/file/<id>`: `read` is the kayan's own `findByID`, as the actor. */
  serve: (args: { request: Request; kayan: StorageKayan; id: string; read: (args: { id: string }) => Promise<Record<string, unknown> | null> }) => Promise<Response>
  /** Handed what a file route threw that is no refusal, before it answers 500 with the message replaced. */
  onError: (error: unknown) => void
}

const storageFunctions = {
  key: 'defaultKey',
  verify: 'defaultVerify',
  disposition: 'defaultDisposition',
  sweep: 'defaultSweep',
  instructions: 'defaultUploadInstructions',
  uploaded: 'defaultUploaded',
  removed: 'defaultRemoveFile',
  serve: 'defaultServeFile',
} as const

export type ResolvedStorage = {
  mimeTypes: readonly string[]
  fileSize: number
  public: boolean
  config: StorageConfig
  // Found by its `insert` step whatever the project named it.
  operation: string
  orphanAfter?: number
  maxUnattached?: number
  unattached: (actor: unknown) => Promise<number | undefined>
  exists: (id: string) => Promise<boolean>
  /** The organization this actor's files of the kayan are kept under: null for a shared kayan, nothing where a tenant-owned one has no active organization. */
  tenant: (actor: unknown) => string | null | undefined
}

/** A kayan that holds files, as `buildAsas` hands it to the storage functions. */
export type StorageKayan = ResolvedKayan & { storage: ResolvedStorage }

/** The signed reference an upload's create hands back: what the server decided, and its signature. */
export type UploadReference = {
  id: string
  key: string
  kayan: string
  tenant: string | null
  filename: string
  type: string
  size: number
  storage: string
  exp: number
  signature: string
}

/** The `fileSize` the template names in its storage config: 10 MiB. */
export const defaultFileSize = 10 * 1024 * 1024

const referenceSeconds = 60 * 60

const svg = 'image/svg+xml'

/** The type check both halves make, in a module the browser imports too. */
export { allowedType }

/** The file name with every directory part and control character dropped, or an empty string. */
export const sanitizeFilename = (filename: string) => {
  let sanitized = filename.replace(/\\/g, '/')
  sanitized = sanitized.slice(sanitized.lastIndexOf('/') + 1)
  if (sanitized === '.' || sanitized === '..') return ''
  // eslint-disable-next-line no-control-regex
  return sanitized.replace(/[\x00-\x1f\x80-\x9f]/g, '')
}

const fields = ['id', 'key', 'kayan', 'tenant', 'filename', 'type', 'size', 'storage', 'exp'] as const
const signatureOf = (secret: string, reference: Omit<UploadReference, 'signature'>) =>
  createHmac('sha256', secret).update(JSON.stringify(fields.map((name) => reference[name]))).digest('base64url')

const storageOf = (kayan: ResolvedKayan) => {
  const { storage } = kayan as Partial<StorageKayan>
  if (!storage) throw new Error(`Kayan "${kayan.name}" runs a storage step and writes no targets.storage.`)
  return storage
}

/** The adapter a row or a reference names. Read as an own key, so no name reaches an inherited property. */
export const adapterOf = ({ kayan, name }: { kayan: ResolvedKayan; name: unknown }) => {
  const { config } = storageOf(kayan)
  const adapter = typeof name === 'string' && Object.hasOwn(config.adapters, name) ? config.adapters[name] : undefined
  if (!adapter) throw new Error(`A stored file names adapter "${String(name)}", which is not one of storage.adapters.`)
  return adapter
}

/**
 * Signs the reference an upload's create must name back: the row's id, the key, the kayan,
 * the actor's tenant from its session, the file, the adapter and an expiry, under HMAC-SHA256.
 */
export const signReference = ({
  kayan,
  actor,
  id,
  filename,
  type,
  size,
}: {
  kayan: ResolvedKayan
  actor: unknown
  id: string
  filename: string
  type: string
  size: number
}): UploadReference => {
  const { config, tenant: tenantOf } = storageOf(kayan)
  const tenant = tenantOf(actor)
  if (tenant === undefined) {
    throw denied({ message: `Forbidden: "${kayan.name}" files belong to an organization, and this actor's session has no active organization it is a verified member of.`, key: 'error.forbidden.create', params: { kayan: kayan.name, operation: 'create' } })
  }
  const adapter = adapterOf({ kayan, name: config.adapter })
  const key = config.key({ prefix: adapter.prefix, tenant, kayan: kayan.name, id, filename })
  // The project's key function is wrong, which is a fault and not the caller's, so it is asked first.
  if (adapter.prefix && !key.startsWith(`${adapter.prefix}/`)) {
    throw new Error(`storage.key answered "${key}", which is not under adapter "${config.adapter}"'s prefix "${adapter.prefix}/".`)
  }
  // The row id is what keeps one object to one row: without it two uploads could share a key,
  // and the unique key would answer whether a name is taken.
  if (!key.split('/').includes(id)) throw new Error(`storage.key answered "${key}", which does not hold the row id "${id}" as a whole path segment.`)
  // A key with an empty, `.` or `..` part, a backslash or a NUL climbs out of its prefix.
  if (!key || /[\\\0]/.test(key) || key.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw invalid({ message: 'The upload names a file whose key would have an empty, "." or ".." part.', key: 'error.invalid.upload_request', params: { kayan: kayan.name } })
  }
  const unsigned = { id, key, kayan: kayan.name, tenant, filename, type, size, storage: config.adapter, exp: Math.floor(Date.now() / 1000) + referenceSeconds }
  return { ...unsigned, signature: signatureOf(config.secret, unsigned) }
}

/**
 * Checks the reference a create names back, refusing every way it can be wrong in one
 * sentence so a forged one reads as an expired one. The signature is compared in constant time.
 */
export const checkReference = async ({ kayan, value, actor }: { kayan: ResolvedKayan; value: unknown; actor: unknown }): Promise<UploadReference> => {
  const storage = storageOf(kayan)
  const refused = invalid({ message: 'The upload reference is not one this server signed for this file, this tenant and this hour.', key: 'error.invalid.upload_reference', params: { kayan: kayan.name } })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refused
  const held = value as Record<string, unknown>
  const strings = ['id', 'key', 'kayan', 'filename', 'type', 'storage', 'signature'] as const
  if (strings.some((name) => typeof held[name] !== 'string')) throw refused
  if (!Number.isSafeInteger(held.size) || !Number.isSafeInteger(held.exp) || (held.tenant !== null && typeof held.tenant !== 'string')) throw refused
  const reference = Object.fromEntries([...fields, 'signature'].map((name) => [name, held[name]])) as UploadReference
  const given = Buffer.from(reference.signature)
  const expected = Buffer.from(signatureOf(storage.config.secret, reference))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw refused
  if (reference.exp * 1000 < Date.now()) throw refused
  const tenant = storage.tenant(actor)
  if (reference.kayan !== kayan.name || tenant === undefined || reference.tenant !== tenant) throw refused
  if (!Object.hasOwn(storage.config.adapters, reference.storage)) throw refused
  // Refused before anything reads or deletes the object, which is the earlier row's.
  if (await storage.exists(reference.id)) throw invalid({ message: 'The upload reference was already used.', key: 'error.invalid.upload_reference', params: { kayan: kayan.name } })
  return reference
}

/** The create shape of a kayan holding files, with the `uploadReference` beside it. */
export const withUploadReference = (create: StandardSchemaV1): StandardSchemaV1 => ({
  '~standard': {
    version: 1,
    vendor: 'mithaq',
    validate: async (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { issues: [{ message: 'Invalid input: expected object' }] }
      const { uploadReference, ...rest } = value as Record<string, unknown>
      const result = await create['~standard'].validate(rest)
      return result.issues ? result : { value: { ...(result.value as Record<string, unknown>), ...(uploadReference !== undefined && { uploadReference }) } }
    },
  },
})

const readsOpen = (kayan: ResolvedKayan) => {
  try {
    return (kayan.access?.read as ((args: unknown) => unknown) | undefined)?.({ user: null, slug: kayan.name }) === true
  } catch {
    return false
  }
}

// The store is asked through `storeOf` because the build has it only once its stores are initialised.
export const resolveStorage = ({ language, resolved, storeOf, active }: {
  language: Language
  resolved: ResolvedKayan[]
  storeOf: StorageBuild['storeOf']
  /** The organization the actor's verified session has active, the one a tenant-owned kayan's files are kept under. */
  active: (actor: unknown) => string | undefined
}) => {
  const existsIn = (kayan: ResolvedKayan) => async (id: string) => {
    const store = storeOf(kayan)
    const { docs } = await store.find({ kayan: kayan.name, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { equals: id } } } })
    return docs.length > 0
  }
  // One storage target per build: two would split the kayan between two secrets and two sweeps.
  const storageTargets = Object.keys(language.targets).filter((key) => isStorage(language.targets[key]))
  if (storageTargets.length > 1) {
    throw new Error(`Targets "${storageTargets.join('" and "')}" both declare capability "storage", and a build has at most one storage target. Drop one of them.`)
  }
  const name = storageTargets[0]
  const holding = name ? resolved.filter((kayan) => kayan.targets?.[name] !== undefined) : []
  for (const kayan of resolved) {
    for (const field of Object.values(kayan.fields)) {
      if (field.kind === 'upload' && !holding.includes(field.target!)) {
        throw new Error(`Kayan "${kayan.name}" field "${field.name}" is an upload, and kayan "${field.target?.name}" it points at writes no targets.${name ?? 'storage'}, so it holds no files.`)
      }
    }
  }
  if (!name) return []
  const { config } = language.targets[name] as StorageTarget
  const given = (config ?? {}) as Partial<StorageConfig>
  if (typeof given.secret !== 'string' || given.secret.length < 32) throw new Error('storage.secret signs every upload reference and is a string of 32 characters at least.')
  for (const [one, shipped] of Object.entries(storageFunctions)) {
    if (typeof given[one as keyof typeof storageFunctions] !== 'function') throw new Error(`storage names no "${one}" function. Name the project's own, such as ${shipped} from src/storage/defaults.ts.`)
  }
  if (given.fileSize === undefined) {
    throw new Error('storage names no "fileSize", the largest file in bytes a kayan holds when it names none. Name the project\'s own, such as defaultFileSize from mithaq.')
  }
  if (!Number.isSafeInteger(given.fileSize) || given.fileSize < 1) {
    throw new Error(`storage.fileSize is ${JSON.stringify(given.fileSize)}, and it is a whole number of bytes above 0.`)
  }
  assertMaxBodyBytes('storage', given.maxBodyBytes)
  if (typeof given.onError !== 'function') throw new Error('storage names no "onError" function, which a file route hands what it threw before it answers 500. Name the project\'s own, such as console.error.')
  const adapters = Object.entries(given.adapters ?? {})
  if (!adapters.length) throw new Error('storage names no adapters, so no file has anywhere to go.')
  for (const [adapter, held] of adapters) {
    const missing = (['handleDelete', 'staticHandler', 'head', 'readHead'] as const).find((one) => typeof held?.[one] !== 'function')
      ?? (typeof held?.uploadInstructions?.generate === 'function' ? undefined : 'uploadInstructions.generate')
      ?? (typeof held?.prefix === 'string' && (held.prefix || !held.list) ? undefined : 'prefix')
    if (missing) throw new Error(`storage adapter "${adapter}" has no "${missing}".`)
    // A slash at either end would put keys outside what the sweep lists.
    if (held.prefix.startsWith('/') || held.prefix.endsWith('/')) {
      throw new Error(`storage adapter "${adapter}" names prefix "${held.prefix}", and a prefix is a folder of the store with no slash at either end.`)
    }
  }
  if (typeof given.adapter !== 'string' || !Object.hasOwn(given.adapters!, given.adapter)) {
    throw new Error(`storage.adapter names "${String(given.adapter)}", and new uploads go to one of storage.adapters, which are ${adapters.map(([one]) => `"${one}"`).join(', ')}.`)
  }
  for (const kayan of holding) {
    const where = `Kayan "${kayan.name}" writes "targets.${name}"`
    const kept = kayan.targets![name] as Partial<KayanStorage>
    if (kayan.single) throw new Error(`${where}, and a global holds no files: files are a kayan's rows.`)
    if (kayan.versions) throw new Error(`${where} and keeps versions, and a file never changes after it is made, so there is nothing to version. Version the kayan that points at it instead.`)
    if (!Array.isArray(kept.mimeTypes) || !kept.mimeTypes.length || kept.mimeTypes.some((one) => typeof one !== 'string' || !/^[\w.+-]+\/(?:[\w.+-]+|\*)$/.test(one))) {
      throw new Error(`${where} with mimeTypes ${JSON.stringify(kept.mimeTypes)}, and mimeTypes is a list of the types it holds, such as ["image/png"] or ["image/*"].`)
    }
    for (const key of ['orphanAfter', 'maxUnattached'] as const) {
      if (kept[key] !== undefined && (!Number.isSafeInteger(kept[key]) || kept[key]! < 1)) throw new Error(`${where}.${key} must be a positive integer.`)
    }
    if (kept.maxUnattached !== undefined) {
      const field = kayan.fields.uploadedBy
      if (!isUploadedBy(field)) throw new Error(`${where}.maxUnattached requires the shipped uploadedByField spread.`)
    }
    if (kept.orphanAfter !== undefined) {
      if (!Object.values(kayan.operations).some((one) => one.steps.some((step) => sealOf(step) === 'remove'))) throw new Error(`${where}.orphanAfter requires a managed delete operation.`)
      if (!kayan.fields.createdAt) throw new Error(`${where}.orphanAfter requires createdAt.`)
      for (const owner of resolved) for (const field of Object.values(owner.fields)) {
        if (field.kind === 'join' || (field.target?.name !== kayan.name && field.kind !== 'richText')) continue
        if (field.rules?.onDelete === 'cascade' || field.rules?.onDelete === 'set null') throw new Error(`${where}.orphanAfter is unsafe because ${owner.name}.${field.name} uses onDelete: ${field.rules.onDelete}.`)
        if (owner.store !== kayan.store) throw new Error(`${where}.orphanAfter requires ${owner.name}.${field.name} to use the same store.`)
      }
    }
    const fileSize = kept.fileSize ?? config.fileSize
    if (!Number.isSafeInteger(fileSize) || fileSize < 1) throw new Error(`${where} with fileSize ${String(kept.fileSize)}, and fileSize is a whole number of bytes above 0.`)
    if (kept.public !== undefined && kept.public !== true) throw new Error(`${where} with public ${String(kept.public)}, and public is true or left out.`)
    for (const [column, shipped] of Object.entries(uploadFields)) {
      const field = kayan.fields[column]
      if (!field || field.kind !== shipped.kind || providerOf(field, 'create') === 'client' || providerOf(field, 'update') !== 'never') {
        throw new Error(`${where}, and its field "${column}" is not the shipped one, which the runner writes on create and nobody writes after. Spread uploadFields into its fields.`)
      }
    }
    const makers = Object.entries(kayan.operations).filter(([, one]) => one.steps.some((step) => sealOf(step) === 'insert'))
    if (!makers.length) {
      throw new Error(`${where}, and no operation of it holds the "insert" step, so no file can be made. Declare one that runs storage.uploaded in beforeTransaction.`)
    }
    if (makers.length > 1) {
      throw new Error(`${where}, and operations ${makers.map(([one]) => `"${one}"`).join(' and ')} ${makers.length > 2 ? 'all' : 'both'} hold the "insert" step. A kayan that holds files makes its rows in one, the operation the upload instructions route asks the permission of.`)
    }
    const [operation, made] = makers[0]!
    if (!made.beforeTransaction.includes(config.uploaded as never)) {
      throw new Error(`${where}, and its operation "${operation}" does not verify the upload before the row is made: its beforeTransaction does not run storage.uploaded, the step the storage rukn was handed.`)
    }
    // A marked row still names its object and a restore brings it back, so removing
    // the object there loses a file a row names.
    if (kayan.softDelete) {
      for (const [one, declared] of Object.entries(kayan.operations)) {
        const slot = (['beforeTransaction', 'steps', 'afterSteps', 'afterCommit'] as const).find((list) => declared[list].includes(config.removed as never))
        if (slot) throw new Error(`${where} and marks its rows deleted, and its operation "${one}" runs storage.removed in "${slot}", which would remove the object of a row that is only marked. Leave storage.removed out of its lists.`)
      }
    }
    if (!kayan.indexes.some((index) => index.unique && index.fields.length === 1 && index.fields[0] === 'key')) {
      throw new Error(`${where}, and builds no unique index over "key" alone, while a key is the address of one object in a store every kayan and organization shares. Keep the default unique index over "key" in indexes.`)
    }
    if (kept.public && kayan.tenant) {
      throw new Error(`${where} with public: true, and its rows belong to an organization, so a public address would hand one organization's file to anyone who has it. Drop public.`)
    }
    if (kept.public && !readsOpen(kayan)) {
      throw new Error(`${where} with public: true, and its read is not open to everyone, so a public address would hand out what its access keeps back. Drop public, or open its read.`)
    }
    if (kept.public && typeof config.adapters[config.adapter]!.generateURL !== 'function') {
      throw new Error(`${where} with public: true, and storage adapter "${config.adapter}" has no generateURL, so it has no public address.`)
    }
    // A shared kayan's files belong to no organization, whichever session uploads them.
    const tenant = kayan.tenant ? active : () => null
    kayan.storage = { orphanAfter: kept.orphanAfter, maxUnattached: kept.maxUnattached, unattached: (actor) => countUnattached({ kayan, actor, tenant: tenant(actor), resolved, storeOf }), mimeTypes: kept.mimeTypes, fileSize, public: !!kept.public, config, operation, exists: existsIn(kayan), tenant }
  }
  return holding as StorageKayan[]
}

const filePath = (kayan: string, id: unknown) => `/api/${kayan}/file/${encodeURIComponent(String(id))}`

const raster = /^image\/(png|jpeg|gif|webp|avif)$/

/** A row's `url` and `thumbnailURL`, computed on read: the file route, or the adapter's public address. */
export const fileURLs = ({
  kayan,
  stored,
  visible,
}: {
  kayan: ResolvedKayan
  stored: Record<string, unknown>
  visible: Record<string, unknown>
}) => {
  const storage = (kayan as ResolvedKayan & { storage?: ResolvedStorage }).storage
  if (!storage || !('id' in visible) || typeof stored.key !== 'string') return visible
  const publicURL = storage.public ? adapterOf({ kayan, name: stored.storage }).generateURL?.({ key: stored.key }) : undefined
  const url = publicURL ?? filePath(kayan.name, stored.id)
  return { ...visible, url, thumbnailURL: typeof stored.mimeType === 'string' && raster.test(stored.mimeType) ? url : null }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const refusal = (thrown: AsasError) =>
  Response.json({ code: codes[thrown.status], data: { key: thrown.key, params: thrown.params }, message: thrown.message }, { status: thrown.status })

/**
 * The row a file route serves, read through the kayan's own `findByID` as the actor. Every
 * reason it cannot be served is the same 404, so no answer tells one from another.
 */
export const readForFile = async ({ kayan, id, read }: { kayan: ResolvedKayan; id: string; read: (args: { id: string }) => Promise<Record<string, unknown> | null> }): Promise<StoredFile> => {
  let row: Record<string, unknown> | null = null
  try {
    const named = decodeURIComponent(id)
    if (kayan.fields.id?.kind !== 'uuid' || uuid.test(named)) row = await read({ id: named })
  } catch (thrown) {
    if (!(thrown instanceof AsasError) && !(thrown instanceof URIError)) throw thrown
  }
  if (!row || [row.key, row.storage, row.mimeType, row.filename].some((one) => typeof one !== 'string')) {
    throw missing({ message: `No "${kayan.name}" file here.`, key: 'error.not_found.file', params: { kayan: kayan.name } })
  }
  return row as unknown as StoredFile
}

/**
 * Serves a file under the headers its bytes need. An SVG is never `inline` and
 * gets a policy that runs no script.
 */
export const fileHeaders = async ({
  doc,
  disposition,
  answer,
}: {
  doc: StoredFile
  disposition: string
  answer: (args: { disposition: string }) => Promise<Response>
}): Promise<Response> => {
  const safe = doc.mimeType === svg ? disposition.replace(/^\s*inline/i, 'attachment') : disposition
  const answered = await answer({ disposition: safe })
  const headers = new Headers(answered.headers)
  if (answered.status !== 302) {
    headers.set('Content-Disposition', safe)
    headers.set('Content-Type', doc.mimeType)
    if (doc.mimeType === svg) headers.set('Content-Security-Policy', "script-src 'none'")
  }
  return new Response(answered.body, { status: answered.status, headers })
}

// Asked by the build's handler before any plug.
export const storageRoutes = <Actor>({
  kayan,
  config,
  read,
  authorize,
  admin,
}: {
  kayan: readonly StorageKayan[]
  config: StorageConfig
  read: (args: { kayan: string; id: string; actor: Actor | null }) => Promise<Record<string, unknown> | null>
  authorize: Authorize
  admin?: ManagedAdmin<Actor>
}) => {
  const byName = new Map(kayan.map((one) => [one.name, one]))
  return async (request: Request, who: () => Promise<Actor | null>): Promise<Response | null> => {
    for (const adapter of Object.values(config.adapters)) {
      const answered = await adapter.handler?.(request)
      if (answered) return answered
    }
    const [api, name, verb, id, ...rest] = new URL(request.url).pathname.split('/').slice(1)
    const one = api === 'api' && name ? byName.get(name) : undefined
    if (!one) return null
    try {
      if (verb === 'uploadInstructions' && id === undefined && request.method === 'POST') {
        // Bounded before the actor is asked, so no caller holds the server to a body of any size.
        const read = await boundedBody(request, config.maxBodyBytes)
        if (read instanceof Response) return read
        let input: unknown
        try {
          input = JSON.parse(await read.text())
        } catch {
          input = undefined
        }
        const actor = await who()
        // Asked by core, so no project's instructions sign an upload for someone who may not make the row.
        await authorize({ admin, actor, data: {}, effect: 'create', kayan: one, kind: 'insert', operation: one.storage.operation })
        if (one.storage.maxUnattached !== undefined) {
          const count = await one.storage.unattached(actor)
          if (count === undefined) throw denied({ message: 'An upload cap requires an authenticated uploader.', key: 'error.forbidden.create', params: { kayan: one.name } })
          // ponytail: each instructions request scans every referencing table and version per candidate upload;
          // use indexed reference queries if measured slow. Signed instructions can pass the cap; a strict cap needs reservations.
          if (count >= one.storage.maxUnattached) throw invalid({ message: `Attach or remove an upload before uploading another. The limit is ${one.storage.maxUnattached}.`, key: 'error.invalid.upload_limit', params: { limit: one.storage.maxUnattached } })
        }
        return Response.json(await config.instructions({ kayan: one, input, actor }))
      }
      if (verb !== 'file' || !id || rest.length || request.method !== 'GET') return null
      const served = await config.serve({ request, kayan: one, id, read: async ({ id }) => read({ kayan: one.name, id, actor: await who() }) })
      // Set here rather than by `serve`, so no project can leave them off: no sniffing,
      // and no cache keeps a private file or the address a redirect hands out for it.
      const headers = new Headers(served.headers)
      headers.set('X-Content-Type-Options', 'nosniff')
      if (!one.storage.public) headers.set('Cache-Control', 'private, no-store')
      return new Response(served.body, { status: served.status, statusText: served.statusText, headers })
    } catch (thrown) {
      thrown = retryConflict(thrown)
      if (thrown instanceof AsasError) return refusal(thrown)
      config.onError(thrown)
      return Response.json({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }, { status: 500 })
    }
  }
}

export type StorageBuild = {
  config: StorageConfig
  kayan: readonly ResolvedKayan[]
  resolved: readonly ResolvedKayan[]
  storeOf: (kayan: ResolvedKayan) => Store
  collection: string | undefined
  tenants: () => Promise<string[]>
  remove: (args: { kayan: string; id: unknown; actor: unknown }) => Promise<unknown>
}
const built = new WeakMap<object, StorageBuild>()
export const recordStorage = (asas: object, swept: StorageBuild) => void built.set(asas, swept)

/** Removes only eligible rows, scoped to one organization at a time. */
export const cleanupUploads = async ({ asas, tenant, now = new Date() }: { asas: object; tenant?: string; now?: Date }) => {
  const build = built.get(asas)
  if (!build) return { rowsChecked: 0, rowsDeleted: 0, rowsKept: 0, failures: 0 }
  return cleanupUploadedRows({ build, tenant, now })
}

type SweepReport = (args: { name: string; orphans?: string[] }) => void

// A row marked deleted still names its key, so its object stays.
const sweepObjects = async ({ asas, check, report }: { asas: object; check: boolean; report?: SweepReport }) => {
  const swept = built.get(asas)
  const counts = { objectsListed: 0, objectsDeleted: 0, failures: 0 }
  if (!swept) return counts
  // A pool of its own for the CLI: generate --check may already have closed the build.
  const pools: { $client: { end(): Promise<void> } }[] = []
  try {
    const named = new Map<string, Set<string>>()
    for (const one of swept.kayan) {
      const store = swept.storeOf(one)
      const string = (store as { connectionString?: unknown }).connectionString
      const own = report && store.sql === 'drizzle' && typeof string === 'string' && string ? drizzle(string) : undefined
      if (own) pools.push(own)
      const { docs } = await store.find({ kayan: one.name, args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' } }, tx: own })
      for (const row of docs) {
        const set = named.get(String(row.storage)) ?? new Set<string>()
        set.add(String(row.key))
        named.set(String(row.storage), set)
      }
    }
    for (const [name, adapter] of Object.entries(swept.config.adapters)) {
      if (!adapter.list) { report?.({ name }); continue }
      const counted: StorageAdapter = {
        ...adapter,
        list: async function* () { for await (const object of adapter.list!()) { counts.objectsListed++; yield object } },
        handleDelete: async (args) => { await adapter.handleDelete(args); counts.objectsDeleted++ },
      }
      try {
        const orphans = await swept.config.sweep({ adapter: counted, named: named.get(name) ?? new Set(), check, now: new Date() })
        report?.({ name, orphans })
      } catch (error) {
        if (report) throw error
        counts.failures++
      }
    }
    return counts
  } finally {
    for (const pool of pools) await pool.$client.end().catch(() => {})
  }
}

/** The scheduled task's counts-only flow: remove abandoned rows, then sweep unnamed objects. */
export const sweepStorage = async ({ asas }: { asas: object }) => {
  const rows = await cleanupUploads({ asas })
  const objects = await sweepObjects({ asas, check: false })
  return { ...rows, ...objects, failures: rows.failures + objects.failures }
}

const sweep: Command = async ({ asas, flags }: CommandInput) => {
  if (!built.has(asas)) {
    console.log('This build names no storage, so there is nothing to sweep.')
    return 0
  }
  const check = flags.includes('--check')
  try {
    await sweepObjects({ asas, check, report: ({ name, orphans }) => {
      if (!orphans) { console.log(`Adapter "${name}" lists no objects, so it is not swept.`); return }
      for (const key of orphans) console.log(`${check ? 'Orphan' : 'Removed'} in "${name}": ${key}`)
      if (!orphans.length) console.log(`Adapter "${name}" holds no orphan old enough to sweep.`)
    } })
    return 0
  } finally { await asas.destroy().catch(() => {}) }
}

/** The storage target over the project's config. The storage rukn builds it. */
export const storageTarget = (config: StorageConfig): StorageTarget => ({ capability: 'storage', type: 'storage', config, commands: { sweep } })

declare module '../mithaq/rukn.ts' {
  interface KayanConfigs<L, F, T> {
    storage: KayanStorage
  }
}
