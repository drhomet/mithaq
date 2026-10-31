import { assertTransaction, commitWrite, operationContext, outsideStore, runSlot } from './lifecycle.ts'
export { drain } from './lifecycle.ts'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { uploaderId } from '../../storage/references.ts'
import { storagePurge } from './storage-maintenance.ts'
// One list in one place, so drizzle's callback transaction is kept as it is.
import { commentMarks } from '../../rich-text/comments-server.ts'
import { stepTools } from './store.ts'
import { rowsOfField, type Rows } from '../../mithaq/rows.ts'
import { heldPermissions } from '../../rbac/index.ts'
import { authActor } from '../actor.ts'
import { AsasError, conflict, denied, invalid, missing } from './errors.ts'
import type { AdminAccess, FieldAccess, LocalesOf, ResolvedField, ResolvedKayan, RuntimeField, ServiceOf } from '../../mithaq/types.ts'
import type { BuiltTables } from '../../drizzle/index.ts'
import { defaultKinds, isStorableText, type Kind } from '../../base/kinds.ts'
import type { RichTextValue } from '@drhomet/mithaq-rich-text/value'
import { assertRichTextVersions } from './rich-text-versions.ts'
import type { Access } from '../../mithaq/types.ts'
import type { Store } from '../../mithaq/language.ts'
import type { LanguageOf } from '../../mithaq/define.ts'
import { providerOf } from '../../base/rules.ts'
import type { InferInput, InferOutput, StandardSchemaV1 } from '../../mithaq/standard-schema.ts'
import { atEffect, defaults, issueRefusal, parse, sealOf, storeSeals, validated, withoutPrototype, type BulkResult, type Context, type ContextOf, type Ctx, type DerivedSchemas, type OperationEffect, type ResolvedOperation, type StepsOf, type Tools, type RuntimeWriteTools as WriteTools, type WriteStep } from './steps.ts'
import { firstRegisters, running, snapshot, type Open, type Running } from './runtime.ts'
import type { FindInput, Paginated } from './read.ts'
import { changedColumns, latestVersion, restoreInput, revived, saveVersion } from '../../versions/versions.ts'
import { fileURLs, isUploadedBy } from '../../storage/storage.ts'
import { combineWhere, operatorList } from '../../mithaq/where.ts'
import { refuseTenantOption, writeTenant, type TenantReach } from './tenant.ts'
import type { FieldWhere, Operator, Scalar, Where } from '../../mithaq/where.ts'

/** The key of `Options` only the bulk runner sets. */
export const ontoRow = Symbol('ontoRow')

/** The caller's own context, required where the project declared one. */
type ContextOption<Extra extends Record<string, unknown>> = [Record<string, unknown>] extends [Extra]
  ? { context?: Extra }
  : { context: Extra }

/** The second argument of every write function. */
export type Options<Actor = unknown, Extra extends Record<string, unknown> = Record<string, unknown>> = {
  /** Whoever is writing. A `user.<key>` default reads off it. */
  actor?: Actor
  /** On a kayan that keeps drafts, save a version alone unless the write sends `_status: 'published'`; a read then reads each row's latest version. */
  draft?: boolean
  /** With `draft`, overwrite the latest version in place where it is itself an autosave. */
  autosave?: boolean
  // A symbol, so no served call can name it.
  [ontoRow]?: true
} & ContextOption<Extra>

export type ReadOptions<Actor = unknown, Extra extends Record<string, unknown> = Record<string, unknown>> = Options<Actor, Extra> & {
  /**
   * How far the read reaches past the active organization: `'mine'` is every organization the
   * actor is a verified member of, each under the roles it holds there; `'all'` is every tenant,
   * for backoffice staff in the backoffice app alone. A `where` on the tenant field only narrows it.
   */
  tenant?: TenantReach
}

/**
 * The keys this build's runner declared, which is what a caller of it has to
 * send and what every step of it reads.
 */
type ContextExtra<L> = ContextOf<ServiceOf<L>>
/** The options a caller of this build passes every operation. */
type CallOptions<L, Actor, Read extends boolean = false> = Read extends true ? ReadOptions<Actor, ContextExtra<L>> : Options<Actor, ContextExtra<L>>

// Required where the project declared a context, or every step would read a declared
// key typed and `undefined`.
type CallArgs<L, Actor, Input, Read extends boolean = false> = [Record<string, unknown>] extends [ContextExtra<L>]
  ? {} extends Input
    ? [input?: Input, options?: CallOptions<L, Actor, Read>]
    : [input: Input, options?: CallOptions<L, Actor, Read>]
  : [input: Input, options: CallOptions<L, Actor, Read>]
/** The admin provider as the runner sees it: the kayan's name, and its gate. */
export type ManagedAdmin<Actor = unknown> = { access?: AdminAccess<Actor>; kayan?: string }

export { assertWhere, assertWhereGrammar, assertStoreWhere, assertFieldWhere, whereLimits } from './query.ts'
import { assertWhere, assertWhereGrammar } from './query.ts'

export { aliveWhere, publishedWhere } from './row-state.ts'
import { aliveWhere, publishedWhere } from './row-state.ts'

/** A field of one kayan that points at rows of another, which a delete of one of those rows answers to. */
export type Pointer = { kayan: ResolvedKayan; field: ResolvedField }

/** Every field of `kayans` whose `onDelete` keeps a row of `target` while it names it. */
export const restrictingPointers = (kayans: readonly ResolvedKayan[], target: ResolvedKayan): Pointer[] =>
  kayans.flatMap((kayan) => Object.values(kayan.fields)
    .filter((field) => field.kind !== 'join' && field.target?.name === target.name && field.rules?.onDelete === 'restrict')
    .map((field) => ({ kayan, field })))

/** How many of the rows that still name a row the refusal names by title; its count says the rest. */
const namedUses = 5
const byId = { field: 'id', direction: 'asc' } as const

/**
 * The ids of the rows of each kayan that name `id` through `pointers`, a row whose latest version
 * names it among them, since the foreign key holds live rows alone and a pending draft would
 * otherwise keep an id nothing answers for. A pointing kayan that is tenant-owned is read within
 * `tenant` when one is given, so a count never reaches another organization's rows.
 */
export const referencingIds = async ({ id, pointers, store, tenant, tx }: {
  id: unknown
  pointers: readonly Pointer[]
  store: Pick<Store, 'find'>
  tenant?: unknown
  tx?: unknown
}) => {
  const uses = new Map<ResolvedKayan, Set<string>>()
  for (const { kayan, field } of pointers) {
    const ids = uses.get(kayan) ?? new Set<string>()
    const within = (path: string) => (kayan.tenant && tenant !== undefined ? { [path]: { equals: tenant as Scalar } } : undefined)
    const rows = await store.find({ kayan: kayan.name, args: { limit: 0, page: 1, sort: byId, where: combineWhere({ [field.name]: { equals: id as Scalar } }, within(kayan.tenant!)) }, tx })
    for (const row of rows.docs) ids.add(String(row.id))
    if (kayan.versions) {
      // ponytail: `version.<field>` is read with no index, a scan of the versions table per delete;
      // index it once a delete is measured slow.
      const versions = await store.find({ kayan: kayan.versions.table, args: { limit: 0, page: 1, sort: byId, where: combineWhere({ and: [{ latest: { equals: true } }, { [`version.${field.name}`]: { equals: id as Scalar } }] }, within(`version.${kayan.tenant}`)) }, tx })
      for (const version of versions.docs) ids.add(String(version.parent))
    }
    if (ids.size) uses.set(kayan, ids)
  }
  return uses
}

/**
 * Refuses the delete while a live row or the latest version of a row names it, in the delete's own
 * transaction. The delete holds the row `FOR UPDATE`, and a write naming it holds it `FOR KEY SHARE`
 * in `assertReferences`, a draft save included. The two conflict, so no new reference lands between
 * this count and the delete. An update holds its own row as `rowLock` says, which `FOR KEY SHARE` passes
 * unless the update names a unique column. The refusal counts the actor's own
 * organization's rows and names by title only those the actor reads; a row another organization's
 * rows name is refused with no count at all.
 */
const refuseReferenced = async <Actor>({ kayan, existing, pointers, store, tenant, tx, authorize, admin, actor }: {
  kayan: ResolvedKayan
  existing: Record<string, unknown>
  pointers: readonly Pointer[]
  store: Store
  tenant: unknown
  tx: unknown
  authorize: Authorize
  admin: ManagedAdmin<Actor> | undefined
  actor: Actor | null
}) => {
  const counted = async (within: unknown) => {
    const found = await referencingIds({ id: existing.id, pointers, store, tenant: within, tx })
    // A row that names itself goes with itself; read off the stored row, since the caller's id may differ in case.
    found.get(kayan)?.delete(String(existing.id))
    return { found, total: [...found.values()].reduce((sum, ids) => sum + ids.size, 0) }
  }
  // Every organization's rows gate the delete, since the foreign key holds no draft; only the
  // actor's own are counted and named to it.
  const all = await counted(undefined)
  if (!all.total) return
  const own = tenant === undefined ? all : await counted(tenant)
  if (own.total !== all.total) {
    throw conflict({
      message: `A "${kayan.name}" row is still named by rows this caller does not see, so it is not deleted.`,
      key: 'error.conflict.referenced',
      params: { kayan: kayan.name },
    })
  }
  const uses: { by: string; count: number; titles: unknown[]; titleKind?: string }[] = []
  for (const [one, ids] of own.found) {
    if (ids.size) uses.push({ by: one.name, count: ids.size, ...(await titlesOf({ kayan: one, ids: [...ids], store, tx, authorize, admin, actor })) })
  }
  throw conflict({
    message: `A "${kayan.name}" row is still named by ${uses.map(({ by, count }) => `${count} "${by}" row${count === 1 ? '' : 's'}`).join(' and ')}, so it is not deleted.`,
    key: 'error.conflict.referenced',
    params: { kayan: kayan.name, by: uses[0]!.by, uses },
  })
}

/**
 * The titles of the rows among `ids` this actor finds and whose title field it reads, a draft only
 * where it reads drafts. A title that points at another row is its raw id, so such rows are
 * counted alone; a moment is sent as a value, marked so the screen formats it.
 */
const titlesOf = async <Actor>({ kayan, ids, store, tx, authorize, admin, actor }: {
  kayan: ResolvedKayan
  ids: string[]
  store: Store
  tx: unknown
  authorize: Authorize
  admin: ManagedAdmin<Actor> | undefined
  actor: Actor | null
}): Promise<{ titles: unknown[]; titleKind?: string }> => {
  const title = Object.values(kayan.targets ?? {}).map((target) => (target as { useAsTitle?: unknown } | undefined)?.useAsTitle).find((one) => typeof one === 'string') as string | undefined
  const field = title && Object.hasOwn(kayan.fields, title) ? kayan.fields[title]! : undefined
  if (!field || field.target || field.kind === 'join') return { titles: [] }
  const asked = (operation: string) => authorize({ admin, actor, data: {}, effect: 'read', kayan, operation }).then((where) => ({ where }), (thrown: unknown) => {
    if (thrown instanceof AsasError && thrown.status === 403) return undefined
    throw thrown
  })
  const readable = await asked('find')
  if (!readable) return { titles: [] }
  const drafts = kayan.versions?.drafts ? await asked('findVersions') : undefined
  const shown = kayan.versions?.drafts && drafts
    ? combineWhere(aliveWhere(kayan), drafts.where && { or: [{ _status: { equals: 'published' } }, drafts.where] })
    : publishedWhere(kayan)
  const sort = field.rules?.localized ? byId : { field: field.name, direction: 'asc' as const }
  const found = await store.find({ kayan: kayan.name, args: { limit: namedUses, page: 1, sort, where: { and: [{ id: { in: ids } }, readable.where, shown].filter(Boolean) as Where[] } }, tx })
  const titles: unknown[] = []
  for (const row of found.docs) {
    const visible = await projectReadableFields({ kayan, row, actor })
    if (Object.hasOwn(visible, field.name)) titles.push(visible[field.name])
  }
  return { titles, ...(field.kind === 'date' || field.kind === 'datetime' ? { titleKind: field.kind } : {}) }
}

const fieldAccess = async <Actor>(
  operation: 'create' | 'update',
  kayan: ResolvedKayan,
  data: Record<string, unknown>,
  actor: Actor | null,
  id: unknown,
  named: string,
  doc?: Record<string, unknown>,
  kept: readonly string[] = [],
) => {
  const next = { ...data }
  const refused: string[] = []
  let table: Rows | undefined
  for (const field of Object.values(kayan.fields)) {
    if (operation === 'update' && field.name === 'id') continue
    if (!(field.name in next)) continue
    const access = field.access?.[operation]
    if (!access) continue
    // Asked again on every pass: a step may have changed the value the callback judges.
    const allowed = !!(await (access as FieldAccess<Actor, Record<string, unknown>, unknown>)({ data, doc, id, siblingData: next, user: actor }))
    if (allowed) continue
    // A row-compiled denial is named, not silently dropped. A column carried from a draft
    // is refused whatever denied it, or the stored value would publish unasked.
    const source = rowsOfField(access)
    if (!source && !kept.includes(field.name)) {
      delete next[field.name]
      continue
    }
    table ??= source
    refused.push(field.name)
  }
  if (refused.length) {
    // The roles go as a list, so a client resolves each against the catalog.
    const roles = table?.roles(actor) ?? []
    throw denied({
      message: `Forbidden: kayan "${kayan.name}" operation "${named}" for roles "${roles.join(', ')}" cannot write field${refused.length > 1 ? 's' : ''} "${refused.join('", "')}".`,
      key: 'error.forbidden.field_write',
      params: { kayan: kayan.name, operation: named, roles, fields: refused },
    })
  }
  return next
}

export { projectReadableFields } from './access.ts'
import { projectReadableFields } from './access.ts'

// A stored row the row shape refuses is the data's fault, so a plain `Error` (a masked
// 500). The message names the fields and id, never a value: a message may quote it.
const storedRow = async (kayan: ResolvedKayan, schema: StandardSchemaV1, row: Record<string, unknown>) => {
  const result = await schema['~standard'].validate(withoutPrototype(row))
  if (!result.issues) return result.value as Record<string, unknown>
  const fields = [...new Set(result.issues.map((issue) => {
    const [first] = issue.path ?? []
    return String(typeof first === 'object' ? first.key : first ?? '')
  }))]
  const id = 'id' in row && !fields.includes('id') ? ` ${JSON.stringify(row.id)}` : ''
  throw new Error(
    `Kayan "${kayan.name}" row${id} is stored with a value that is not of its kind in field${fields.length > 1 ? 's' : ''} "${fields.join('", "')}", so it cannot be read. Repair the stored row.`,
  )
}

// Masking deletes from the value, so no schema is composed and any validator can be the schema target.
export const publicResult = async <Actor>({
  kayan,
  row,
  actor,
  internalOutput,
  publicOutput,
}: {
  kayan: ResolvedKayan
  row: Record<string, unknown>
  actor: Actor | null
  internalOutput: StandardSchemaV1
  publicOutput?: StandardSchemaV1
}) => {
  const internal = await storedRow(kayan, internalOutput, row)
  // A custom output is handed the operation's own words beside the proved columns.
  const value = publicOutput ? { ...row, ...internal } : internal
  const visible = await projectReadableFields({ kayan, row: value, actor })
  // Computed on every read, never stored.
  if (!publicOutput) return fileURLs({ kayan, stored: internal as Record<string, unknown>, visible })
  const parsed = await validated(publicOutput, visible)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Kayan "${kayan.name}" custom output must return a row object.`)
  }
  const final = await projectReadableFields({ kayan, row: parsed as Record<string, unknown>, actor })
  const removed = Object.keys(parsed).filter((key) => !(key in final))
  if (removed.length) {
    throw new Error(`Kayan "${kayan.name}" custom output returned protected field "${removed[0]}" after read projection.`)
  }
  return fileURLs({ kayan, stored: internal as Record<string, unknown>, visible: final })
}

// An access callback answering `true` puts no tenancy filter on a per-tenant global, so
// it would read another tenant's row. Refused by name; a `where` admitting several is not checked.
export const assertSingleConstrained = (kayan: ResolvedKayan, where: Where | undefined) => {
  if (kayan.single && kayan.tenant && !where) {
    throw new Error(
      `Global "${kayan.name}" keeps the tenant field, and the actor's access constrains no rows, so no one row is the tenant's own. Return a Where from its read and update access that constrains the rows to the actor's tenant.`,
    )
  }
}

/**
 * The lock a write holds on a row it changes, as Postgres's own statement takes it: `FOR UPDATE` for a
 * delete, or for an update naming a column of a unique index, which holds off a write naming the row
 * `FOR KEY SHARE`, and `FOR NO KEY UPDATE` for any other update, which that write passes. A soft delete
 * is an update of its mark, and asks no rows naming its row, so it has no reference to hold off. Taken
 * whole when the row loads, before any value is compared: an UPDATE raising its lock later would wait on
 * a writer that named the row in between while that writer waits on it, a deadlock.
 *
 * ponytail: publishing a latest draft's unique column can still raise this lock; take `update` for every
 * non-draft update on a kayan with drafts and a unique index if that path needs to be covered.
 * ponytail: an update step can raise its own row's lock by writing a unique column or hard-deleting the
 * row; take `update` at load for an operation whose steps may do either if that path needs to be covered.
 */
export const rowLock = ({ kayan, kind, data }: { kayan: ResolvedKayan; kind: string; data: Record<string, unknown> }) => {
  const written = kind === 'remove' || kind === 'deleteMany' ? (kayan.softDelete ? [kayan.softDelete] : undefined) : Object.keys(data)
  return !written || kayan.indexes.some((index) => index.unique && index.fields.some((name) => written.includes(name))) ? 'update' : 'noKeyUpdate'
}

const loadExisting = async ({ kayan, store, id, where, tx, rows = aliveWhere(kayan), lock }: {
  kayan: ResolvedKayan
  store: Store
  id: unknown
  where: Where | undefined
  tx?: unknown
  rows?: Where
  lock: 'update' | 'noKeyUpdate'
}) => {
  assertSingleConstrained(kayan, where)
  const found = await store.find({ kayan: kayan.name, args: {
    limit: 1,
    page: 1,
    lock,
    // A write's own look at the row it changes, over a set an id or a constraint already reduced.
    sort: { field: 'id', direction: 'asc' },
    // A marked row is not there to change, so a second delete of it is the 404 an absent id gets.
    where: combineWhere(
      kayan.single ? where : combineWhere({ id: { equals: id as Scalar } }, where),
      rows,
    ),
  }, tx })
  return found.docs[0]
}

// Each related id must be one the target's own read access admits for this actor, and in the
// written row's organization.
const validateTenantRelationships = async <Actor>(
  kayan: ResolvedKayan,
  store: Store,
  data: Record<string, unknown>,
  actor: Actor | null,
  existing: Record<string, unknown> | undefined,
  authorize: Authorize,
  admin: ManagedAdmin<Actor> | undefined,
  tx?: unknown,
) => {
  const own = kayan.tenant
  await assertReferences({
    kayan,
    store,
    data,
    tenant: own ? (data[own] ?? existing?.[own]) : undefined,
    // Asked with no operation, so no permission key is asked for.
    access: (target) => authorize({ admin, actor, data: {}, effect: 'read', kayan: target }),
    // A field's `filterOptions` holds a save to what its picker offers, as Payload's does.
    offered: async (field) => {
      const answer = await field.filterOptions?.({ user: actor, tx })
      return answer === undefined || answer === true ? undefined : answer === false ? { id: { in: [] } } : assertWhere(field.target!, answer)
    },
    tx,
  })
}

/**
 * Refuses a relationship value naming a row the write may not point at: one of another
 * organization than the written row's, or one `access` leaves out. A step's own raw write
 * passes no `access`, so it is held to the organization alone.
 */
/** The sealed store checks the final value once, including values a step writes outside its own record. */
export const assertCommentMarks = async ({ kayan, store, data, tenant, tx, id = data.id }: {
  kayan: ResolvedKayan
  store: Pick<Store, 'find'>
  data: Record<string, unknown>
  tenant: unknown
  tx?: unknown
  id?: unknown
}) => {
  for (const field of Object.values(kayan.fields)) {
    const value = data[field.name]
    if (value == null || !field.richTextPolicy) continue
    const ids = [...commentMarks(value)]
    if (!ids.length) continue
    const target = field.commentThreads
    if (!target?.tenant || !tenant || id === undefined || id === null || id === '') throw invalid({ message: 'Comment marks require a saved record and its declared threads.', key: 'error.invalid.comment_thread' })
    const found = await store.find({ tx, kayan: target.name, args: { limit: ids.length, page: 1, lock: 'keyShare', sort: { field: 'id', direction: 'asc' }, where: { and: [
      { id: { in: ids } }, { [target.tenant]: { equals: tenant as Scalar } },
      { recordKayan: { equals: kayan.name } }, { recordId: { equals: String(id) } }, { field: { equals: field.name } },
    ] } } })
    if (found.docs.length !== ids.length) throw invalid({ message: 'A comment mark must name a thread of this tenant, record and field.', key: 'error.invalid.comment_thread' })
  }
}

export { assertReferences } from './references.ts'
import { assertReferences, keyIn } from './references.ts'

export { defaultAccess, defaultAuthorize, type Authorize } from './access.ts'
import type { Authorize } from './access.ts'
import { defaultAccess } from './access.ts'

// Shared with the bulk runner, so the depth cap, the cross-transaction refusals and the
// ambient actor rule answer alike for a bulk and the row it is made of.
export const beginWrite = <Actor = unknown>({
  kayan,
  operation,
  store,
  cap,
  options,
}: {
  kayan: ResolvedKayan
  operation: string
  store: Store
  cap: number
  options?: Options<Actor>
}) => {
  const outer = running.getStore()
  const context = operationContext({ kayan: kayan.name, operation, cap, outer: outer?.context, given: options?.context, effect: 'write' })
  const open = outer?.transactions ?? new Map()
  // A nested write joins the outer transaction on the same store, so both commit or roll
  // back together; another store opens its own. Outside slots carry no transactions.
  const joined = open.get(store)
  assertTransaction({ effect: 'write', crossStore: !!outer?.transactions && !joined, settled: joined?.settled, kayan: kayan.name, operation, outer: joined?.operation ?? outer?.context.chain.at(-1) })
  const entry: Open = joined ?? { tx: undefined, operation: `${kayan.name}.${operation}` }
  const actor = (outer?.user as Actor | null | undefined) ?? options?.actor ?? null
  return { actor, context, entry, open }
}

// No transaction is carried, so a managed write here opens its own. An `afterCommit`
// throw is never an `AsasError`: the write it would refuse has committed.
export const runOutside = async <Actor>({
  kayan,
  tools,
  slot,
  list,
  start,
  around,
}: {
  kayan: ResolvedKayan
  tools: WriteTools<unknown, Actor>
  slot: 'afterCommit' | 'beforeTransaction'
  list: readonly WriteStep[]
  start: Ctx
  around: { context: Context; user: Actor | null }
}): Promise<Ctx> => {
  const given = stepTools({ ...tools, store: outsideStore({ kayan: kayan.name, operation: tools.operation, slot }) } as WriteTools)
  return running.run(around as Running, () => runSlot({ kayan: kayan.name, operation: tools.operation, slot, list, start, tools: given }))
}

// A shape that names the key answers a probe value with an issue at it. An asynchronous
// answer names nothing, so its key is refused.
const namesKey = (schema: StandardSchemaV1, key: string) => {
  const answer = schema['~standard'].validate({ [key]: Symbol(key) })
  if (answer instanceof Promise) {
    answer.catch(() => {})
    return false
  }
  return !!answer.issues?.some(({ path: [first] = [] }) => String(typeof first === 'object' ? first.key : first) === key)
}

export const write = <Actor = unknown>({
  kayan,
  declaration,
  tools,
  store,
  cap,
  authorize,
  admin,
  tenantOf,
  pointers = [],
}: {
  kayan: ResolvedKayan
  declaration: ResolvedOperation
  tools: WriteTools<unknown, Actor>
  store: Store
  cap: number
  authorize: Authorize
  admin?: ManagedAdmin<Actor>
  /** The organization the actor's session names, which a tenant-owned row is made in. */
  tenantOf: (actor: unknown) => string | undefined
  /** The fields that keep a row of this kayan while they name it, which a delete answers to. */
  pointers?: readonly Pointer[]
}) =>
  async (data: Record<string, unknown> = {}, options?: Options<Actor>) => {
    const list = atEffect<WriteStep>(declaration.steps)
    const { actor, context, entry, open } = beginWrite<Actor>({ kayan, operation: tools.operation, store, cap, options })
    // The id reaches the store before the operation's parse, so it is held to the shape at
    // `id` first: a 400, not the store refusing a value of the wrong type as a 500.
    if (tools.kind !== 'insert' && !kayan.single) {
      const { issues = [] } = await tools.schema['~standard'].validate(withoutPrototype(data))
      const atId = issues.filter(({ path: [first] = [] }) => (typeof first === 'object' ? first.key : first) === 'id')
      if (atId.length) throw issueRefusal(atId, tools.schema['~standard'].vendor)
    }
    refuseTenantOption({ kayan, operation: tools.operation, options })
    const owner = writeTenant({ kayan, active: tenantOf(actor), effect: tools.effect, data })
    const purge = tools.kind === 'remove' ? storagePurge({ actor, kayan: kayan.name, id: data.id }) : undefined
    const versions = kayan.versions
    // An operation with its own `input` that changes a row, and each bulk row, lands on the
    // row as it is: it keeps `_status` and its columns also go into the pending draft.
    const restoring = list.some((step) => sealOf(step) === 'restoreVersion')
    const onto = !!versions?.drafts && ((!!declaration.input && tools.kind === 'update' && tools.operation !== 'update' && !restoring) || !!options?.[ontoRow])
    const drafts = !!versions?.drafts && !!options?.draft
    if (drafts && onto) {
      throw invalid({
        message: `Kayan "${kayan.name}" operation "${tools.operation}" writes its row as it is, so it saves no draft. Call it without draft.`,
        key: 'error.invalid.draft_operation',
        params: { kayan: kayan.name, operation: tools.operation },
      })
    }
    // A draft save answers the whole latest draft, so it asks the key a draft read asks.
    const askDrafts = () => authorize({ admin, actor, data: {}, effect: 'read', kayan, operation: 'findVersions' })
    const draftsAsked = drafts || (!!versions?.drafts && data._status === 'draft')
    // What `findVersions` admits for this actor, kept per row; `undefined` without the key.
    const admits: { where: Where | undefined } | undefined = draftsAsked
      ? { where: await askDrafts() }
      : versions?.drafts && tools.kind !== 'insert'
        ? await askDrafts().then((where) => ({ where }), (thrown: unknown) => {
          if (thrown instanceof AsasError && thrown.status === 403) return undefined
          throw thrown
        })
        : undefined
    // Past the rows the actor may read drafts of, a never-published row answers the 404 an
    // absent id does: a 403 would tell the actor which hidden ids exist.
    const rowsWhere = purge ? {} : !versions?.drafts || tools.kind === 'insert'
      ? aliveWhere(kayan)
      : !admits
        ? publishedWhere(kayan)
        : combineWhere(aliveWhere(kayan), draftsAsked || !admits.where ? admits.where : { or: [{ _status: { equals: 'published' } }, admits.where] })
    // The restore's own key is asked before anything is looked up.
    if (restoring) {
      await authorize({ admin, actor, data: {}, effect: 'update', kayan, kind: 'update', operation: tools.operation })
      const asked = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'id' && !Object.hasOwn(kayan.fields, key)))
      data = { ...asked, ...await restoreInput({
        kayan: kayan as ResolvedKayan & { versions: NonNullable<typeof versions> },
        store,
        data,
        actor,
        authorize,
        admin,
        alive: rowsWhere,
        seesDrafts: !!admits,
        admits: admits?.where,
      }) }
    }
    // First-register's own create runs whatever the kayan's create access says, while its table is empty.
    const accessWhere = context.depth === 1 && firstRegisters.has(entry)
      ? undefined
      : await authorize({ admin, actor, data, effect: tools.effect, kayan, kind: tools.kind, operation: tools.operation })
    // The constant that keeps a global to one row, so a caller's value for it is refused by name.
    if (kayan.single && 'globalType' in data) {
      throw denied({
        message: `Forbidden: kayan "${kayan.name}" operation "${tools.operation}" cannot write field "globalType", which is the constant that keeps a global to one row.`,
        key: 'error.forbidden.global_type',
        params: { kayan: kayan.name, operation: tools.operation },
      })
    }
    // Outside the transaction, before it opens: no row is loaded and no lock is held.
    let values = data
    if (declaration.beforeTransaction.length) {
      const before = await runOutside({
        kayan,
        tools,
        slot: 'beforeTransaction',
        list: atEffect<WriteStep>(declaration.beforeTransaction),
        start: { kayan, data: { ...data }, actor, user: actor, tx: undefined, context, tenant: owner },
        around: { context, user: actor },
      })
      values = before.data as Record<string, unknown>
    }
    /** The last `ctx` the transaction ended with, which is what `afterCommit` is handed. */
    let committed: Ctx | undefined
    const run = (tx: unknown) => {
      entry.tx = tx
      return running.run({ context, transactions: new Map(open).set(store, entry), user: actor }, async () => {
        const existing = tools.kind === 'insert' ? undefined : await loadExisting({ kayan, store, id: values.id, where: accessWhere, tx, rows: rowsWhere, lock: purge ? 'update' : rowLock({ kayan, kind: tools.kind, data: values }) })
        // An actor who may not read this row's drafts writes onto it as it is, so nothing tells
        // it a draft is pending.
        const hidesDrafts = !!versions?.drafts && !!existing && (!admits || (!draftsAsked && !!admits.where
          && !(await store.find({ kayan: kayan.name, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: combineWhere({ id: { equals: existing.id as Scalar } }, admits.where) }, tx })).docs.length))
        const asIs = onto || hidesDrafts
        // A row found without the constraint means the caller cannot address it (404); none means
        // the upsert. A per-tenant global is left out: the unconstrained look would find another tenant's row.
        if (
          kayan.single && !kayan.tenant && tools.kind === 'update' && !existing && accessWhere
          && await loadExisting({ kayan, store, id: values.id, where: undefined, tx, lock: 'noKeyUpdate' })
        ) {
          throw missing({
            message: `No "${kayan.name}" row the access constraint admits.`,
            key: 'error.not_found.global',
            params: { kayan: kayan.name },
          })
        }
        // One word decides the rest of the write: defaults, field callbacks, shape and step.
        const kind = kayan.single && tools.kind === 'update' && !existing ? 'insert' : tools.kind
        const fieldOperation = kind === 'insert' ? 'create' : kind === 'update' ? 'update' : undefined
        // The row always holds the last published copy; a create still makes the row, as a draft.
        const drafting = drafts && !!fieldOperation && data._status !== 'published'
        const autosaving = drafting && versions!.autosave && !!options?.autosave
        // A caller who named `_status` is judged by its field access like any column.
        const status = drafting ? 'draft' : data._status ?? (asIs ? existing?._status : undefined) ?? 'published'
        // A change builds on the row's latest version, so a draft keeps the drafts before it and a
        // publish publishes them. Publishing a never-published row brings every column it holds.
        const latest = versions?.drafts && existing
          ? await latestVersion({ kayan: kayan as ResolvedKayan & { versions: NonNullable<typeof versions> }, store, parent: existing.id, tx })
          : undefined
        // A snapshot's organization is never the row's: the row keeps its own.
        const newest = latest && { ...revived(kayan, latest.version), ...(kayan.tenant && { [kayan.tenant]: existing![kayan.tenant] }) }
        const base = (!restoring && newest) || existing
        const merged = versions?.drafts && existing && fieldOperation && !restoring && !asIs
          ? { ...changedColumns({ kayan, snapshot: base!, row: existing, whole: !drafting && existing._status !== 'published' }), ...values }
          : values
        // Carried from a draft rather than sent, so field access refuses rather than drops them.
        const carried = merged === values ? [] : Object.keys(merged).filter((key) => !(key in values))
        let pending = asIs && newest && !restoring && base?._status === 'draft' ? base : undefined
        // A key the operation's own shape would refuse is refused here first, in that shape's words.
        if (drafting) {
          const stray = Object.keys(data).find((key) =>
            key !== 'id' && (Object.hasOwn(kayan.fields, key) ? providerOf(kayan.fields[key]!, fieldOperation!) !== 'client' : !declaration.input || !namesKey(tools.schema, key)))
          if (stray !== undefined) throw issueRefusal([{ message: `Unrecognized key: "${stray}"`, path: [stray] }], 'mithaq')
        }
        // What the caller read: the latest version for a writer who reads drafts, so
        // `expectedUpdatedAt` holds a draft save, a publish, a delete and a restore alike.
        const dataBefore = snapshot((!asIs && newest) || existing)
        const owned = kayan.tenant
        const writeWhere = !owned || existing?.[owned] === undefined
          ? accessWhere
          : combineWhere(accessWhere, { [owned]: { equals: existing[owned] as Scalar } })
        // A global's update lands on the row that was found, never on an id the caller named.
        const targetId = kayan.single ? existing?.id : values.id
        // The id is the runner's on both branches, which is why a global's update shape has none.
        const given = kayan.single ? { ...values, id: existing?.id } : merged
        if (kayan.single && !existing) delete given.id
        // The shipped field carries no default: the value is the global's own name.
        if (kayan.single && !existing) given.globalType = kayan.name
        const inputData = fieldOperation
          ? await fieldAccess(fieldOperation, kayan, given, actor, targetId, tools.operation, existing, carried)
          : given
        // The audit sink writes through the same three, so only the kayan's own writes save versions,
        // through the store itself: a versions table is no kayan, and the seal refuses it to a step.
        const versioned = versions ? kayan as ResolvedKayan & { versions: NonNullable<typeof versions> } : undefined
        const own = (name: string) => versioned && name === kayan.name ? versioned : undefined
        // The row this write authorized, which alone takes its access, versions and soft delete, in
        // whatever case the caller sent its uuid. A step naming any other id writes that row.
        const keyOf = keyIn(kayan)
        const ownRow = (name: string, id: unknown) =>
          kind !== 'insert' && name === kayan.name && (keyOf(id) === keyOf(targetId) || (existing !== undefined && id === existing.id))
        // And a raw write of this kayan never reaches the authorized row, however its id is spelled.
        const elsewhere = <Args extends { kayan: string; where?: Where }>(args: Args): Args =>
          kind !== 'insert' && args.kayan === kayan.name && targetId !== undefined ? { ...args, where: combineWhere(args.where, { id: { not_equals: targetId as Scalar } }) } : args
        const protectedStore: WriteTools<unknown, Actor>['store'] = Object.freeze({
          find: tools.store.find,
          hold: tools.store.hold,
          sum: tools.store.sum,
          upsert: async (args) => {
            const kept = own(args.kayan)
            if (drafting && kept) throw invalid({ message: "An upsert writes stored rows, not this operation's draft snapshot. Use update for that draft.", key: 'error.invalid.value', params: { kayan: args.kayan } })
            const row = await tools.store.upsert(args)
            const current = ownRow(args.kayan, row.id)
            if (kept && !(current && pending && status === 'draft')) await saveVersion({ kayan: kept, store, writes: store, tx: args.tx, row, autosave: false })
            if (kept && current && pending) {
              pending = { ...pending, ...Object.fromEntries(Object.keys(args.data).map((field) => [field, row[field]])), id: targetId, _status: 'draft' }
              await saveVersion({ kayan: kept, store, writes: store, tx: args.tx, row: pending, autosave: false })
            }
            return row
          },
          insert: async ({ tx: heldTx, kayan: name, data: values }) => {
            if (name === kayan.name && 'storage' in kayan && isUploadedBy(kayan.fields.uploadedBy)) {
              values = { ...values, uploadedBy: uploaderId(actor) ?? null }
            }
            const row = await tools.store.insert({ tx: heldTx, kayan: name, data: values })
            const kept = own(name)
            if (kept) await saveVersion({ kayan: kept, store, writes: store, tx: heldTx, row, autosave: autosaving })
            return row
          },
          update: async (args) => {
            const { tx: heldTx, kayan: name, id, data: values } = args
            // Any other row is the step's own raw write, held by the tenant seal alone.
            if (!ownRow(name, id)) return tools.store.update(elsewhere(args))
            const kept = own(name)
            const incremented = Object.keys(values).filter((field) => kayan.fields[field]?.kind !== 'json' && values[field] && typeof values[field] === 'object' && '$inc' in (values[field] as object))
            if (drafting && kept && incremented.length) throw invalid({ message: 'An increment writes a stored integer field, not a draft snapshot.', key: 'error.invalid.value', params: { kayan: name } })
            if (drafting && kept) {
              const draft = { ...base, ...values, id: targetId }
              // Draft snapshots bypass the sealed row store, so hold new references and check annotations here.
              await assertReferences({ kayan: kept, store, data: values, tenant: tenantOf(actor), tx: heldTx })
              await assertCommentMarks({ kayan: kept, store, data: draft, tenant: tenantOf(actor), tx: heldTx, id: targetId })
              await assertRichTextVersions({ kayan: kept, store, data: draft, tx: heldTx, target: { id: { equals: targetId as Scalar } } })
              await saveVersion({ kayan: kept, store, writes: store, tx: heldTx, row: draft, autosave: autosaving })
              return draft
            }
            const row = await tools.store.update({ tx: heldTx, kayan: name, id: targetId, data: values, where: writeWhere })
            // A never-published row is its own draft, so the draft appended below is its one version.
            if (kept && !(pending && status === 'draft')) await saveVersion({ kayan: kept, store, writes: store, tx: heldTx, row, autosave: false })
            // Appended after the row's own, so the draft stays the latest.
            if (kept && pending) {
              pending = { ...pending, ...values, ...Object.fromEntries(incremented.map((field) => [field, row[field]])), id: targetId, _status: 'draft' }
              await saveVersion({ kayan: kept, store, writes: store, tx: heldTx, row: pending, autosave: false })
            }
            return row
          },
          // A soft delete keeps the `remove` seal, so the effect, the access answer and the 404 stay
          // the delete's; the mark is refused as a field any caller supplies.
          remove: async (args) => {
            const { tx: heldTx, kayan: name, id } = args
            if (!ownRow(name, id)) return tools.store.remove(elsewhere(args))
            if (purge && existing) await purge.check({ row: existing, tx: heldTx })
            if (kayan.softDelete && !purge) return tools.store.update({ tx: heldTx, kayan: name, id: targetId, data: { [kayan.softDelete]: new Date() }, where: writeWhere })
            // A marked row is kept, so only a delete that removes it answers to the rows naming it.
            // An update step can remove its own row, so exclude new references before counting them.
            // This raises its lock; the upgrade path is taking `update` at load for such an operation.
            if (pointers.length && existing && kind !== 'remove') await store.find({ kayan: name, args: { limit: 1, page: 1, lock: 'update', sort: byId, where: { id: { equals: existing.id as Scalar } } }, tx: heldTx })
            if (pointers.length && existing && !purge) await refuseReferenced({ kayan, existing, pointers, store, tenant: kayan.tenant ? existing[kayan.tenant] : tenantOf(actor), tx: heldTx, authorize, admin, actor })
            return tools.store.remove({ tx: heldTx, kayan: name, id: targetId, where: writeWhere })
          },
        })
        // Its absence is a build fault: the partial update shape would make a row without its required fields.
        if (kind !== tools.kind && !tools.insertSchema) {
          throw new Error(
            `Kayan "${kayan.name}" operation "${tools.operation}" has no insert shape, so the row it would make cannot be parsed.`,
          )
        }
        const insertSchema = tools.insertSchema as StandardSchemaV1
        // Copied, so a step writing `ctx.data` in place never changes the caller's object.
        const runTools: WriteTools<unknown, Actor> = Object.freeze({
          ...tools,
          kind,
          // Read before `defaults` fills, so validation can refuse the caller a key and still let the runner's value through.
          sent: Object.keys(data),
          schema: drafting ? tools.draftInput ?? tools.draftWrite ?? tools.draftSchema! : kind === tools.kind ? tools.schema : insertSchema,
          store: protectedStore,
          where: writeWhere,
        })
        const publicTools = stepTools(runTools as WriteTools)
        let ctx: Ctx = { kayan, data: { ...inputData }, actor, user: actor, tx, context, dataBefore, dataAfter: dataBefore, tenant: owner }
        // With no `input` the filled row is parsed, so a default reaches a required column; with one,
        // the caller's strict shape is parsed first. A remove writes no column, so neither runs.
        const fill = (one: Ctx) => (fieldOperation ? (defaults(one, publicTools) as Ctx) : one)
        // A global's first save parses the create shape, which names no key its update's own input adds
        // beside the fields; those are held to that input and handed on to the steps.
        const added = kind !== tools.kind && declaration.input
          ? Object.keys(ctx.data).filter((key) => !Object.hasOwn(kayan.fields, key) && namesKey(tools.schema, key))
          : []
        // Only the issues at those keys count: the update shape also asks for an id the first save has none of.
        const sent = Object.fromEntries(added.map((key) => [key, ctx.data[key]]))
        const answer = added.length ? await tools.schema['~standard'].validate(withoutPrototype(sent)) : undefined
        const refused = answer?.issues?.filter(({ path: [first] = [] }) => added.includes(String(typeof first === 'object' ? first.key : first)))
        if (refused?.length) throw issueRefusal(refused, tools.schema['~standard'].vendor)
        const addedValues = (answer && !answer.issues ? answer.value : sent) as Record<string, unknown>
        if (added.length) ctx = { ...ctx, data: Object.fromEntries(Object.entries(ctx.data).filter(([key]) => !added.includes(key))) }
        ctx = declaration.input
          ? fill(await parse({ schema: runTools.schema, ctx, tools: publicTools }))
          : await parse({ schema: runTools.schema, ctx: fill(ctx), tools: publicTools })
        if (added.length) ctx = { ...ctx, data: { ...ctx.data, ...Object.fromEntries(added.map((key) => [key, addedValues[key]])) } }
        // Filled after the parse, from the session alone.
        if (kind === 'insert' && kayan.tenant) ctx = { ...ctx, data: { ...ctx.data, [kayan.tenant]: owner } }
        // The guards belong to the store seal, and no slot may hold one.
        for (const step of atEffect<WriteStep>([
          ...declaration.beforeSteps,
          ...list,
          ...declaration.afterSteps,
        ])) {
          const seal = sealOf(step)
          // A restore's step is the row's own update, so it is guarded as one.
          if (seal && (storeSeals.includes(seal) || seal === 'restoreVersion')) {
            // Reads `kind`, so a global's first update still upserts; at the store seal, after the parse
            // has refused a malformed id.
            if (!existing && kind !== 'insert') {
              throw missing({
                message: `No "${kayan.name}" row with id ${String(values.id)} to ${kind === 'remove' ? 'delete' : 'update'}.`,
                key: 'error.not_found.row',
                params: { kayan: kayan.name, id: values.id, operation: kind === 'remove' ? 'delete' : 'update' },
              })
            }
            if (kind !== 'insert' && ctx.data.id !== targetId) {
              throw conflict({
                message: `Kayan "${kayan.name}" operation "${tools.operation}" cannot change the authorized target id.`,
                key: 'error.conflict.target',
                params: { kayan: kayan.name, operation: tools.operation },
              })
            }
            if (fieldOperation) {
              ctx = { ...ctx, data: await fieldAccess(fieldOperation, kayan, ctx.data, actor, targetId, tools.operation, existing, carried) }
              if (kind !== 'remove') await validateTenantRelationships(kayan, store, ctx.data, actor, existing, authorize, admin, tx)
            }
            // A publish holds the row to every `required`, which the partial update shape cannot.
            if (versions?.drafts && status === 'published' && kind === 'update') {
              const unset = Object.values(kayan.fields).filter((field) =>
                field.rules?.required && field.kind !== 'join' && (field.name in ctx.data ? ctx.data[field.name] : existing?.[field.name]) == null)
              if (unset.length) throw issueRefusal(unset.map((field) => ({ message: `${kayan.name}.${field.name}.required`, path: [field.name] })), 'mithaq')
              // A never-published row's create-only columns are asked of the create's field access and
              // parsed against the create shape.
              if (existing!._status !== 'published') {
                const left: Record<string, unknown> = { ...existing, ...ctx.data }
                const made = Object.values(kayan.fields).filter((field) => field.kind !== 'join' && providerOf(field, 'create') === 'client' && left[field.name] != null)
                const createOnly = made.filter((field) => providerOf(field, 'update') !== 'client' && !(field.name in ctx.data)).map((field) => field.name)
                await fieldAccess('create', kayan, Object.fromEntries(createOnly.map((name) => [name, left[name]])), actor, targetId, tools.operation, existing, createOnly)
                await validated(insertSchema, Object.fromEntries(made.map((field) => [field.name, left[field.name]])))
              }
            }
            // A step that wrote a `never` field is the project contradicting its own declaration,
            // so a plain `Error`, never an `AsasError` blaming the caller, who cannot reach here.
            if (fieldOperation) {
              const written = Object.values(kayan.fields).find(
                (field) => providerOf(field, fieldOperation) === 'never' && field.name in ctx.data,
              )
              if (written) {
                throw new Error(
                  `Kayan "${kayan.name}" operation "${tools.operation}" wrote field "${written.name}", which declares providedBy "never" on ${fieldOperation}, so nothing supplies it.`,
                )
              }
            }
            // Written after the field callbacks: publishing is what a write without `draft` means,
            // not a column a role must hold a key for.
            if (versions?.drafts && fieldOperation) ctx = { ...ctx, data: { ...ctx.data, _status: status } }
            // After the field callbacks, which deny the field's own update and would refuse the
            // runner's value; on insert no create callback would refuse a step's.
            if (kayan.single) ctx = { ...ctx, data: { ...ctx.data, globalType: kayan.name } }
          }
          ctx = { ...(await step(ctx, publicTools)), tenant: owner }
        }
        committed = ctx
        // A draft may be short of `required`, so it leaves through the draft shape, which holds it to its kinds alone.
        const row = ctx.data as Record<string, unknown>
        return publicResult({
          kayan,
          row,
          actor,
          internalOutput: drafting || (tools.draftSchema && row._status === 'draft') ? tools.draftSchema! : tools.output,
          publicOutput: tools.publicOutput,
        })
      })
    }
    // A throw here is `AfterCommitError`: the write has happened, and nothing the caller sent was wrong.
    const afterCommit = async () => {
      if (!committed || (!declaration.afterCommit.length && !purge)) return
      await runOutside({
        kayan,
        tools,
        slot: 'afterCommit',
        list: atEffect<WriteStep>(declaration.afterCommit),
        start: { ...committed, tx: undefined },
        around: { context, user: actor },
      })
      await purge?.afterCommit({ ...committed, tx: undefined })
    }
    const joined = open.get(store)
    // Drained by the write that opened the transaction; an outer rollback throws before the drain.
    if (joined) {
      const result = await run(joined.tx)
      if (declaration.afterCommit.length || purge) joined.afterCommit = [...(joined.afterCommit ?? []), afterCommit]
      return result
    }
    return commitWrite({
      transaction: (run) => store.transaction(run), run, lifetime: entry,
      queue: () => [...(entry.afterCommit ?? []), afterCommit], nested: !!running.getStore(),
    }) as Promise<Awaited<ReturnType<typeof publicResult>>>
  }

type Registry = readonly { name: string; fields: Record<string, RuntimeField> }[]
type LanguageValues = { kinds: Record<string, Kind>; targets?: unknown }
type Registered<List extends Registry, Name> = Extract<List[number], { name: Name }>
// A thunk the registry does not hold types by the thunk's own target.
type Related<F, List extends Registry> = F extends { relationTo: infer Relation }
  ? Relation extends string
    ? Registered<List, Relation>
    : Relation extends () => infer Target
      ? Target extends { name: infer Name }
        ? [Registered<List, Name>] extends [never] ? Target : Registered<List, Name>
        : never
      : never
  : never
// An override under any other name than the schema target's is not this language's schema.
type OverrideSchema<F, L extends LanguageValues> = ServiceOf<L> extends { schema: infer Name extends string }
  ? string extends Name
    ? never
    : F extends { targets: infer Overrides }
      ? Name extends keyof Overrides
        ? Overrides[Name] extends StandardSchemaV1
          ? Overrides[Name]
          : never
        : never
      : never
  : never
// The language's own locales, left open where it declares none.
type Localize<F, L extends LanguageValues, V> = F extends { rules: { localized: true } }
  ? Record<LocalesOf<L>, V>
  : V
// A relationship carries the id of the kayan it points at, and a `hasMany` one an array of them.
type KindCarried<F, L extends LanguageValues, List extends Registry> = F extends { kind: infer Name extends keyof L['kinds'] }
  ? L['kinds'][Name] extends { pointsAtRow: true }
    ? Related<F, List> extends { fields: { id: infer Id } }
      ? F extends { hasMany: true }
        ? Value<Id, L, List>[]
        : Value<Id, L, List>
      : never
    : L['kinds'][Name] extends Kind<infer V, string>
      ? V
      : never
  : never
type Value<F, L extends LanguageValues, List extends Registry> = [OverrideSchema<F, L>] extends [never]
  ? Localize<F, L, KindCarried<F, L, List>>
  : Exclude<InferOutput<OverrideSchema<F, L> & StandardSchemaV1>, undefined>
type InputValue<F, L extends LanguageValues, List extends Registry> = [OverrideSchema<F, L>] extends [never]
  ? Value<F, L, List>
  : InferInput<OverrideSchema<F, L> & StandardSchemaV1>

// The type twin of what a schema target leaves out of the shape, so the type never invites a refused key.
type Supplied<Fields, On extends 'create' | 'update'> = {
  [K in keyof Fields as K extends 'id'
    ? K
    : Fields[K] extends { rules: { providedBy: Record<On, infer Provider> } }
      ? [Provider] extends ['client']
        ? K
        : never
      : K]: Fields[K]
}

/** Required, and nothing fills it for you. */
type Needed<F> = F extends { rules: { required: true } }
  ? F extends { rules: { defaultValue: unknown } } | { rules: { defaultNow: true } }
    ? false
    : true
  : false

/** Optional columns accept null; required columns and ids never do. */
type Settable<F, L extends LanguageValues, List extends Registry> = F extends {
  rules: { required: true }
}
  ? InputValue<F, L, List>
  : InputValue<F, L, List> | null

type CreateInput<Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> =
  CreateKeys<Supplied<Fields, 'create'>, L, List>
type CreateKeys<Fields, L extends LanguageValues, List extends Registry> = {
  [K in keyof Fields as K extends 'id' ? never : Needed<Fields[K]> extends true ? K : never]: InputValue<Fields[K], L, List>
} & {
  [K in keyof Fields as K extends 'id' ? K : Needed<Fields[K]> extends true ? never : K]?: K extends 'id'
    ? InputValue<Fields[K], L, List>
    : Settable<Fields[K], L, List>
}

/** An update carries only what changes; each site that takes one adds the id beside it. */
type UpdateInput<Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> = {
  [K in keyof Supplied<Fields, 'update'> as K extends 'id' ? never : K]?: Settable<Supplied<Fields, 'update'>[K], L, List>
}

/**
 * The id's type, and `never` for fields that name no id. `never` is reachable
 * at the type level only: `buildAsas` refuses a kayan with no id field.
 */
type Id<Fields, L extends LanguageValues, List extends Registry> = Fields extends { id: infer F }
  ? InputValue<F, L, List>
  : never

type StoredRow<Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> = {
  [K in keyof Fields]: K extends 'id'
    ? Value<Fields[K], L, List>
    : Fields[K] extends { rules: { required: true } }
      ? Value<Fields[K], L, List>
      : Value<Fields[K], L, List> | null
}

// Read for a schema target's `derive`, which sees no registry: a relationship's value is
// `unknown` there. The same tables, so a derived shape and a built write agree.
type Opaque<F> = F extends { kind: 'join' } ? F : F extends { relationTo: unknown } ? Omit<F, 'kind'> & { kind: 'opaque' } : F
type DerivedFields<Fields extends Record<string, RuntimeField>> = { [K in keyof Fields]: Opaque<Fields[K]> }
type Deriving<Schema extends string> = {
  kinds: typeof defaultKinds & { opaque: Kind<unknown>; richText: Kind<RichTextValue> }
  targets: { service: { capability: 'service'; schema: Schema } }
}

/** Every field, with the id optional: what a target's derived create shape takes. */
export type CreateOf<Fields extends Record<string, RuntimeField>, Schema extends string> =
  CreateInput<DerivedFields<Fields>, Deriving<Schema>, []>
/** What an addressed operation takes: the id, inside its input. */
export type ByID<Fields, L extends LanguageValues, List extends Registry> = { id: Id<Fields, L, List> }
/** The same shape partial, with the id required. */
export type UpdateOf<Fields extends Record<string, RuntimeField>, Schema extends string> =
  UpdateInput<DerivedFields<Fields>, Deriving<Schema>, []> & ByID<DerivedFields<Fields>, Deriving<Schema>, []>
/** The id alone: what a target's derived id shape takes, and nothing beside it. */
export type IdOf<Fields extends Record<string, RuntimeField>, Schema extends string> =
  ByID<DerivedFields<Fields>, Deriving<Schema>, []>
/** Every column, and a nullable one wherever nothing requires the field. */
export type RowOf<Fields extends Record<string, RuntimeField>, Schema extends string> =
  StoredRow<DerivedFields<Fields>, Deriving<Schema>, []>

/** The row that comes back after field read access projection. */
export type Row<Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> =
  Omit<StoredRow<Fields, L, List>, { [K in keyof Fields]: Fields[K] extends { access: { read: unknown } } ? K : never }[keyof Fields]> &
  Partial<Pick<StoredRow<Fields, L, List>, { [K in keyof Fields]: Fields[K] extends { access: { read: unknown } } ? K : never }[keyof Fields]>>

// Read through Standard Schema's input type, the twin of what the runner parses.
type OperationInput<Operation> = Operation extends { input: (...args: never[]) => infer Schema }
  ? Schema extends StandardSchemaV1
    ? InferInput<Schema>
    : never
  : never

/** The declared input where the operation has one, and the derived shape where it does not. */
export type OperationData<Operation, Derived> = [OperationInput<Operation>] extends [never]
  ? Derived
  : OperationInput<Operation>

// The parse runs before the first step, so a step sees `.default()` filled and `.transform()` run.
type OperationOutput<Operation> = Operation extends { input: (...args: never[]) => infer Schema }
  ? Schema extends StandardSchemaV1
    ? InferOutput<Schema>
    : never
  : never

/** What a step is handed: the parsed shape where the operation declares one, the derived shape where it does not. */
export type OperationParsed<Operation, Derived> = [OperationOutput<Operation>] extends [never]
  ? Derived
  : OperationOutput<Operation>

// A steps function returns an array, not a tuple, so only the seal survives here; `resolve`
// reads the list in order at build.
type SealOfStep<Held> = Held extends { __seal: infer Name } ? Name : never
type ActingSeal<Operation> = StepsOf<Operation> extends readonly (infer Held)[]
  ? Extract<SealOfStep<Held>, 'count' | 'find' | 'findOne' | 'insert' | 'remove' | 'update' | 'updateMany' | 'deleteMany' | 'findVersions' | 'findVersionByID' | 'restoreVersion'>
  : never

/** `many`, `one`, `count`, `versions`, `version`, or nothing at all for an operation that writes. */
type ReadModeOf<Operation> = [ActingSeal<Operation>] extends [never]
  ? undefined
  : ActingSeal<Operation> extends 'find'
    ? 'many'
    : ActingSeal<Operation> extends 'findOne'
      ? 'one'
      : ActingSeal<Operation> extends 'count'
        ? 'count'
        : ActingSeal<Operation> extends 'findVersions'
          ? 'versions'
          : ActingSeal<Operation> extends 'findVersionByID'
            ? 'version'
            : undefined

type IsReadOperation<Operation> = [ReadModeOf<Operation>] extends [undefined] ? false : true
/**
 * A kayan's operations, read off its own declaration alone: nothing is merged
 * in, so the names a kayan answers are the keys it wrote.
 */
type OwnOperations<K> = K extends { targets: { service: { operations: infer O } } } ? O : Record<never, never>
type OwnOperation<K, Name extends PropertyKey> = Name extends keyof OwnOperations<K> ? OwnOperations<K>[Name] : never

// `remove` parses the derived id shape alone, `findOne` the `byID` shape with `depth`.
export type DerivedInput<Operation, Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> =
  ActingSeal<Operation> extends 'insert'
    ? CreateInput<Fields, L, List>
    : ActingSeal<Operation> extends 'updateMany'
      ? { where: Where; data: UpdateInput<Fields, L, List> }
    : ActingSeal<Operation> extends 'deleteMany'
      ? { where: Where }
      : ActingSeal<Operation> extends 'findOne'
        ? ByID<Fields, L, List> & Pick<FindInput, 'depth'>
      : ActingSeal<Operation> extends 'remove'
        ? ByID<Fields, L, List>
      : ActingSeal<Operation> extends 'findVersionByID' | 'restoreVersion'
        // A version is addressed by its own id, a uuid whatever the row's id is.
        ? { id: string }
        : ActingSeal<Operation> extends 'update'
          ? UpdateInput<Fields, L, List> & ByID<Fields, L, List>
          : ActingSeal<Operation> extends 'count'
            ? { where?: Where }
            : FindInput

/** One version as a version read answers it: its snapshot cut to the reader's field access and held to its kinds, so every column may be absent. */
export type Version<Doc> = {
  id: string
  parent: unknown
  latest: boolean
  autosave: boolean
  createdAt: Date
  updatedAt: Date
  version: Partial<Doc>
}

type PaginatedRows<Doc> = Paginated<Doc>

// What a custom `output` promises, as a schema or a function of the derived shapes.
type OutputRow<Operation> = Operation extends { output: infer Given }
  ? Given extends (...args: never[]) => infer Schema
    ? Schema extends StandardSchemaV1
      ? InferOutput<Schema>
      : never
    : Given extends StandardSchemaV1
      ? InferOutput<Given>
      : never
  : never

/** The custom output's row where the operation declares one, the kayan's row where it does not. */
type ResultRow<Operation, Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> =
  [OutputRow<Operation>] extends [never] ? Row<Fields, L, List> : OutputRow<Operation>

type BulkOutput<Operation, Doc> = [OutputRow<Operation>] extends [never] ? BulkResult<Doc> : OutputRow<Operation>

type OperationResult<Operation, Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> =
  [ActingSeal<Operation>] extends [never]
    ? Promise<ResultRow<Operation, Fields, L, List>>
    : ActingSeal<Operation> extends 'updateMany' | 'deleteMany'
      ? Promise<BulkOutput<Operation, Row<Fields, L, List>>>
      : ReadModeOf<Operation> extends 'count'
        ? Promise<{ totalDocs: number }>
      : ReadModeOf<Operation> extends 'versions'
        ? Promise<PaginatedRows<Version<Row<Fields, L, List>>>>
      // A read by id answers the row or a 404, so no `null`; a global's `findOne` may.
      : ReadModeOf<Operation> extends 'version'
        ? Promise<Version<Row<Fields, L, List>>>
      : ReadModeOf<Operation> extends 'many'
        ? Promise<PaginatedRows<ResultRow<Operation, Fields, L, List>>>
        : ReadModeOf<Operation> extends 'one'
          ? Promise<ResultRow<Operation, Fields, L, List>>
          : Promise<ResultRow<Operation, Fields, L, List>>

/** What one operation takes: its declared input, or the shape its seal implies. */
type InputOf<K, Name extends PropertyKey, Fields extends Record<string, RuntimeField>, L extends LanguageValues, List extends Registry> =
  OperationData<OwnOperation<K, Name>, DerivedInput<OwnOperation<K, Name>, Fields, L, List>>

// No options: a bound call inherits the actor and the context, and one passing either is refused.
type BoundOne<
  K,
  Fields extends Record<string, RuntimeField>,
  L extends LanguageValues,
  List extends Registry,
  Mode extends 'read' | 'write',
> = {
  [Name in keyof OwnOperations<K> as Mode extends 'write'
    ? Name
    : IsReadOperation<OwnOperation<K, Name>> extends true ? Name : never]: (
    ...input: {} extends InputOf<K, Name, Fields, L, List>
      ? [input?: InputOf<K, Name, Fields, L, List>]
      : [input: InputOf<K, Name, Fields, L, List>]
  ) => OperationResult<OwnOperation<K, Name>, Fields, L, List>
}

type StoreFields<K extends Registry[number]> = { [N in keyof K['fields'] as K['fields'][N] extends { kind: 'join' } ? never : N]: K['fields'][N] }
type StoreNames<K extends Registry[number]> = keyof StoreFields<K> & string
type StoreNumeric<K extends Registry[number]> = string extends StoreNames<K> ? string : { [N in StoreNames<K>]: K['fields'][N] extends { kind: 'integer' | 'number' | 'decimal' } ? N : never }[StoreNames<K>]
type StoreValue<K extends Registry[number], F> = ([Value<F, LanguageOf<K>, readonly [K]>] extends [never]
  ? F extends { relationTo: string } ? F extends { hasMany: true } ? (string | number)[] : string | number : never
  : Value<F, LanguageOf<K>, readonly [K]>) | (F extends { rules: { required: true } } ? never : null)
type StoreData<K extends Registry[number], Increment extends boolean = false> = string extends StoreNames<K> ? Record<string, unknown> : {
  [N in StoreNames<K>]?: (N extends 'id' ? StoreID<K> : StoreValue<K, K['fields'][N]>)
    | (Increment extends true ? K['fields'][N] extends { kind: 'integer' } ? { $inc: number } : never : never)
}
type StorePath<K extends Registry[number]> = StoreNames<K> | {
  [N in StoreNames<K>]: K['fields'][N] extends { rules: { localized: true } } ? `${N}.${LocalesOf<LanguageOf<K>>}`
    : K['fields'][N] extends { relationTo: () => infer Related extends Registry[number] } ? `${N}.${keyof Related['fields'] & string}`
    : K['fields'][N] extends { kind: 'json' } ? `${N}.${string}` : never
}[StoreNames<K>]
type StorePathValue<K extends Registry[number], Path extends string> = Path extends keyof K['fields'] ? StoreValue<K, K['fields'][Path]>
  : Path extends `${infer Name}.${infer Rest}` ? Name extends keyof K['fields']
    ? K['fields'][Name] extends { relationTo: () => infer Related extends Registry[number] } ? Rest extends keyof Related['fields'] ? StoreValue<Related, Related['fields'][Rest]> : never
    : K['fields'][Name] extends { rules: { localized: true } } ? KindCarried<K['fields'][Name], LanguageOf<K>, readonly [K]> | null
    : Scalar : never : never
type StoreCondition<Value> = { [O in Operator]?: O extends 'exists' ? boolean : O extends 'in' | 'not_in' ? readonly Value[] : O extends 'like' ? Extract<Value, string> : O extends 'contains' ? Extract<Value, string> | (Value extends readonly (infer Item)[] ? Item : never) : Value }
type StoreWhere<K extends Registry[number]> = string extends StoreNames<K> ? Where : {
  [P in StorePath<K>]?: StoreCondition<StorePathValue<K, P>>
} & { and?: readonly StoreWhere<K>[]; or?: readonly StoreWhere<K>[] }
type StoreResult<K extends Registry[number]> = StoredRow<StoreFields<K>, LanguageOf<K>, readonly [K]>
type StoreID<K extends Registry[number]> = string extends StoreNames<K> ? unknown : Exclude<Value<K['fields']['id'], LanguageOf<K>, readonly [K]>, null | undefined>
type StoreLock = NonNullable<Parameters<Store['find']>[0]['args']['lock']>

/** The declaration carries the language and fields, so a step needs no separate name registry. */
export type DeclarationStore = {
  insert<const K extends Registry[number]>(args: { tx: unknown; kayan: K; data: StoreData<NoInfer<K>> }): Promise<StoreResult<K>>
  update<const K extends Registry[number]>(args: { tx: unknown; kayan: K; id: StoreID<NoInfer<K>>; data: StoreData<NoInfer<K>, true>; where?: StoreWhere<NoInfer<K>> }): Promise<StoreResult<K>>
  upsert<const K extends Registry[number]>(args: { tx: unknown; kayan: K; on: readonly StoreNames<NoInfer<K>>[]; data: StoreData<NoInfer<K>, true>; where?: StoreWhere<NoInfer<K>> }): Promise<StoreResult<K>>
  remove<const K extends Registry[number]>(args: { tx: unknown; kayan: K; id: StoreID<NoInfer<K>>; where?: StoreWhere<NoInfer<K>> }): Promise<StoreResult<K>>
  find<const K extends Registry[number]>(args: { tx?: unknown; kayan: K; args: { limit: number; page: number; sort: { field: StoreNames<NoInfer<K>>; direction: 'asc' | 'desc' }; lock?: StoreLock; where?: StoreWhere<NoInfer<K>> } }): Promise<{ docs: StoreResult<K>[]; totalDocs: number }>
  hold<const K extends Registry[number]>(args: { tx: unknown; kayan: K; ids: readonly StoreID<NoInfer<K>>[]; mode: StoreLock }): Promise<void>
  sum<const K extends Registry[number]>(args: { tx?: unknown; kayan: K; field: StoreNumeric<NoInfer<K>>; where?: StoreWhere<NoInfer<K>> }): Promise<string>
}

// Read in a step's body, never its annotation, where two kayan importing each other would
// make the type circular.
export type BoundOf<Mode extends 'read' | 'write'> = <const K extends Registry[number] & { single?: never }>(
  kayan: K,
) => BoundOne<K, K['fields'], LanguageOf<K>, readonly [K], Mode>

export type BoundKayans<
  KayanList extends Registry,
  L extends LanguageValues,
  Mode extends 'read' | 'write' = 'write',
> = {
  [K in KayanList[number] as K['name']]: BoundOne<K, K['fields'], L, KayanList, Mode>
}

type OwnService<K> = K extends { targets: { service: infer Service } } ? Service : unknown
type DefaultStoreOf<L> = ServiceOf<L> extends { store: infer Name extends string } ? Name : never
type StoreNameOf<K, L> = OwnService<K> extends { store: infer Name extends string } ? Name : DefaultStoreOf<L>
type SchemaNameOf<K, L> = OwnService<K> extends { schema: infer Name extends string }
  ? Name
  : ServiceOf<L> extends { schema: infer Name extends string } ? Name : never
type TargetNamed<L, Name> = L extends { targets: infer Targets }
  ? Name extends keyof Targets ? Targets[Name] : never
  : never
type FieldsOfKayan<K> = K extends { fields: infer Fields extends Record<string, RuntimeField> } ? Fields : never

// Each target's own output for this kayan, never the configuration it was given.
type KayanOutputs<K, List extends Registry, L extends LanguageValues, Operations> =
  { service: { operations: Operations } }
  & { [Name in SchemaNameOf<K, L>]: { schemas: DerivedSchemas<TargetNamed<L, Name>, FieldsOfKayan<K>> } }
  & (TargetNamed<L, StoreNameOf<K, L>> extends { tables: unknown }
      ? K extends { name: infer Name extends string }
        ? { [Named in StoreNameOf<K, L>]: { table: TargetNamed<L, StoreNameOf<K, L>> extends { type: 'drizzle-sqlite' } ? SQLiteTable : BuiltTables<List, StoreNameOf<K, L>, DefaultStoreOf<L>, L['kinds']>[Name] } }
        : {}
      : {})

// Nothing of the declaration, so no access callback, thunk or target configuration
// sits under a name a runtime output could take.
type Built<K, List extends Registry, L extends LanguageValues, Operations> = {
  name: K extends { name: infer Name } ? Name : string
  fields: FieldsOfKayan<K>
  /** The same object as `targets.service.operations`, which the service capability always publishes. */
  operations: Operations
  targets: KayanOutputs<K, List, L, Operations>
}

// The global is the namespace, so the functions keep the operation names; `findOne`
// answers null until the first update makes the row.
type GlobalOperations<K extends Registry[number], List extends Registry, L extends LanguageValues, Actor> = {
  findOne(...args: CallArgs<L, Actor, { depth?: number }>): Promise<Row<K['fields'], L, List> | null>
  update(...args: CallArgs<L, Actor, FirstSave<OperationData<OwnOperation<K, 'update'>, UpdateInput<K['fields'], L, List>>, K['fields']>>): Promise<Row<K['fields'], L, List>>
}

// A first save has read no row, so a key the update's input adds beside the fields is the caller's to leave out.
type Added<Data, Fields> = Exclude<keyof Data, keyof Fields>
type FirstSave<Data, Fields> = Omit<Data, 'id' | Added<Data, Fields>> & Partial<Pick<Data, Added<Data, Fields>>>

/** What `asas.global` holds: one built global per name, of the shape a kayan has. */
export type Globals<
  GlobalList extends Registry,
  List extends Registry,
  L extends LanguageValues,
  Actor = unknown,
> = {
  [K in GlobalList[number] as K['name']]: Built<K, List, L, GlobalOperations<K, List, L, Actor>>
}

// Every operation of one kayan, bound and keyed by name, typed off its input and seal.
type KayanOperations<
  K extends Registry[number],
  List extends Registry,
  L extends LanguageValues,
  Actor,
> = {
  [Name in keyof OwnOperations<K>]: (
    ...args: CallArgs<L, Actor, InputOf<K, Name, K['fields'], L, List>, IsReadOperation<OwnOperation<K, Name>>>
  ) => OperationResult<OwnOperation<K, Name>, K['fields'], L, List>
}

/** What `asas.kayan` holds. A relationship may point at a global, so `List` holds both. */
export type Writes<
  KayanList extends Registry,
  List extends Registry,
  L extends LanguageValues,
  Actor = unknown,
> = {
  [K in KayanList[number] as K['name']]: Built<K, List, L, KayanOperations<K, List, L, Actor>>
}

// Input required: nothing arriving is not an empty object. A function-typed property,
// so `strictFunctionTypes` checks the input contravariantly.
type Sent<Method> = Method extends (...args: infer Args) => infer Answer
  ? (input: Exclude<Args[0], undefined>) => Answer
  : never

/** Every operation of one bound kayan, as procedures. */
type Procedural<Bound> = { [Name in keyof Bound]: Sent<Bound[Name]> }

/** The static view of the operation table, keyed by kayan then operation: what each published operation takes and answers. */
export type Procedures<
  KayanList extends Registry,
  GlobalList extends Registry,
  List extends Registry,
  L extends LanguageValues,
> = {
  [K in KayanList[number] as K['name']]: Procedural<BoundOne<K, K['fields'], L, List, 'write'>>
} & {
  [K in GlobalList[number] as K['name']]: {
    findOne: (input: { depth?: number }) => Promise<Row<K['fields'], L, List> | null>
    update: (input: UpdateInput<K['fields'], L, List>) => Promise<Row<K['fields'], L, List>>
  }
}
