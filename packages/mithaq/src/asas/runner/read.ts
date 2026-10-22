import { aliveWhere, assertSingleConstrained, assertWhere, assertWhereGrammar, publicResult, publishedWhere, type Authorize, type ManagedAdmin, type ReadOptions, type Row } from './write.ts'
import { combineWhere, type Scalar, type Where } from '../../mithaq/where.ts'
import { atEffect, issueRefusal, parse, type AuditHandler, type Ctx, type ReadStep, type ReadTools, type ResolvedOperation } from './steps.ts'
import type { StandardSchemaIssue, StandardSchemaV1 } from '../../mithaq/standard-schema.ts'
import { sortableFields, unsortable, type FieldAccess, type ResolvedField, type ResolvedKayan } from '../../mithaq/types.ts'
import { defaultKinds } from '../../base/kinds.ts'
import type { Store } from '../../mithaq/language.ts'
import { AsasError, denied, invalid, localizedQuery, missing } from './errors.ts'
import { running } from './runtime.ts'
import { membersAdmitted, type TenantScope } from './tenant.ts'
import { revived } from '../../versions/versions.ts'

/** What a `find` list takes where it declares no input of its own. */
export type FindInput = {
  /** How far a read populates its `join` fields: 0 populates nothing, each level through the child kayan's own managed read. */
  depth?: number
  /** Counts of readable linked rows, batched over this page, returned separately from stored fields. */
  counts?: readonly string[]
  limit?: number
  page?: number
  sort?: string
  where?: Where
}

export type RelationshipCounts = Record<string, Record<string, number>>

export type Paginated<Row> = {
  counts?: RelationshipCounts
  docs: Row[]
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
  nextPage: number | null
  page: number
  pagingCounter: number
  prevPage: number | null
  totalDocs: number
  totalPages: number
}

export type ReaderMap<Actor = unknown> = {
  operation: (args: {
    name: string
    declaration: ResolvedOperation
    input: StandardSchemaV1
    output: StandardSchemaV1
    /** What a draft or a version is read back through, where the kayan keeps drafts or versions. */
    draftOutput?: StandardSchemaV1
  }) => (data?: Record<string, unknown>, options?: ReadOptions<Actor>) => Promise<Record<string, unknown> | null | Paginated<Record<string, unknown>>>
}

const integerOption = (name: 'depth' | 'limit' | 'page', value: unknown, fallback: number, minimum: number, maximum?: number) => {
  const actual = value ?? fallback
  if (typeof actual !== 'number' || !Number.isInteger(actual) || actual < minimum) {
    throw invalid({ message: `Managed read option "${name}" must be an integer >= ${minimum}.`, key: 'error.invalid.read_option_integer', params: { option: name, minimum } })
  }
  // Refused rather than clamped: a clamp answers a page nobody asked for. The bound is
  // `cap - 1`: the read naming the depth is itself the first level the runner counts.
  if (maximum !== undefined && (actual as number) > maximum) {
    throw invalid({
      message: `Managed read option "${name}" must be an integer <= ${maximum}.`,
      key: 'error.invalid.read_option_integer',
      params: { option: name, maximum },
    })
  }
  return actual as number
}

// Kept so the callback runs once; a fetch whose id a step changed asks again.
type Granted = { where: Where | undefined }

const readAccess = async <Actor>(
  kayan: ResolvedKayan,
  actor: Actor | null,
  authorize: Authorize,
  admin?: ManagedAdmin<Actor>,
  id?: unknown,
  operation?: string,
) =>
  // A global is found by being the only row, so an id in its input names nothing.
  authorize({ admin, actor, data: id === undefined || kayan.single ? {} : { id }, effect: 'read', kayan, operation })

// A dotted key is refused: across the hop it would be three segments, and passed through
// unprefixed it would constrain the near table instead of the far one.
const prefixWhere = (kayan: string, prefix: string, where: Where): Where => {
  const conjunction = (where as { and?: Where[] }).and
  if (conjunction) return { and: conjunction.map((one) => prefixWhere(kayan, prefix, one)) }
  const disjunction = (where as { or?: Where[] }).or
  if (disjunction) return { or: disjunction.map((one) => prefixWhere(kayan, prefix, one)) }
  return Object.fromEntries(Object.entries(where).map(([field, rule]) => {
    if (field.includes('.')) {
      throw new Error(
        `Kayan "${kayan}" access constraint path "${field}" is reached across a relationship from "${prefix}", so carrying it would be three segments, and a query path is never more than two.`,
      )
    }
    return [`${prefix}.${field}`, rule]
  })) as Where
}

// Raised after the field's own read access, so a caller who may not read the field
// still gets its 403 and learns nothing from this.
const localizedRefusal = (kayan: string, field: string, what: 'filter' | 'sort', locales?: readonly string[]) =>
  invalid({
    message: localizedQuery({ kayan, field, what, locales }),
    key: `error.invalid.localized_${what}`,
    params: what === 'filter' ? { kayan, field, locales } : { kayan, field },
  })

const protectedField = async <Actor>(
  kayan: ResolvedKayan,
  field: string,
  actor: Actor | null,
  authorize: Authorize,
  admin?: ManagedAdmin<Actor>,
  what: 'filter' | 'sort' = 'filter',
): Promise<Where | undefined> => {
  const [ownField, relatedField] = field.split('.')
  const root = kayan.fields[ownField!]
  // A locale is one column of the root field: no hop, and read access is per field, so
  // the check over the root is the whole security surface.
  const locale = relatedField && root?.locales?.includes(relatedField) ? relatedField : undefined
  // A json field's path stays inside its own value, so the field's read access is the whole of it.
  const hop = locale || root?.kind === 'json' ? undefined : relatedField
  const found = hop ? root?.target?.fields[hop] : root
  if (!root || !found) throw invalid({ message: `Kayan "${kayan.name}" query names unknown field "${field}".`, key: 'error.invalid.unknown_field', params: { kayan: kayan.name, field } })
  // A `join` is no column of any table; across a hop it would reach the store as
  // `undefined`, a 500 where every other impossible path is a 400.
  if (found.kind === 'join') {
    const owner = hop ? root.target! : kayan
    throw invalid({
      message: `Kayan "${owner.name}" cannot query field "${found.name}", whose rows belong to kayan "${found.target?.name}". Read that kayan filtered by "${found.on}" instead.`,
      key: 'error.invalid.join_query',
      params: { kayan: owner.name, field: found.name },
    })
  }
  const readable = async (owner: ResolvedKayan, checked: NonNullable<typeof found>, user: unknown) => {
    if (checked.access?.read && !(await (checked.access.read as FieldAccess<unknown, Record<string, unknown>, unknown>)({ user }))) {
      throw denied({ message: `Kayan "${owner.name}" field "${checked.name}" read access denied for managed query.`, key: 'error.forbidden.field_read', params: { kayan: owner.name, field: checked.name } })
    }
  }
  await readable(kayan, root, actor)
  if (hop) await readable(root.target!, found, actor)
  if (!locale && found.rules?.localized) {
    throw localizedRefusal(hop ? root.target!.name : kayan.name, found.name, what, found.locales)
  }
  // A `hasMany` set, a join and a field a screen marked unsortable have no single value
  // to order by; the store would otherwise answer in whatever order the planner returned.
  if (what === 'sort' && !hop && unsortable(root)) {
    throw invalid({
      message: !root.hasMany && root.kind !== 'join'
        ? `Kayan "${kayan.name}" cannot sort by field "${root.name}", which a screen takes out of sorting.`
        : `Kayan "${kayan.name}" cannot sort by field "${root.name}", which holds a set of rows rather than one value.`,
      key: 'error.invalid.sort_field',
      params: { kayan: kayan.name, field: root.name },
    })
  }
  if (!hop || !root.target) return undefined
  // The hop carries the other kayan's read access and the rows its plain read shows, so it
  // answers nothing about a row no plain read of that kayan would return.
  const farAccess = await readAccess(root.target, actor, authorize, admin)
  // Under `tenant: 'mine'` each far row is read by the membership it came through, so a column
  // hidden from one of them filters and orders none of their rows.
  for (const member of membersAdmitted(running.getStore()?.tenant, farAccess) ?? []) await readable(root.target, found, member)
  const targetWhere = combineWhere(farAccess, publishedWhere(root.target))
  return targetWhere ? prefixWhere(root.target.name, ownField!, targetWhere) : undefined
}

// A field this actor may not read refuses the query, and a hop carries the other kayan's
// read access. Shared with the bulk runner, whose `where` is held to the same.
export const assertReadableWhere = async <Actor>({
  kayan,
  where,
  actor,
  authorize,
  admin,
}: {
  kayan: ResolvedKayan
  where: Where | undefined
  actor: Actor | null
  authorize: Authorize
  admin?: ManagedAdmin<Actor>
}): Promise<Where | undefined> => {
  if (!where) return undefined
  const narrowed = async (checked: Where): Promise<Where | undefined> => {
    const normalized = { ...checked } as Record<string, unknown>
    const conjunction = (checked as { and?: Where[] }).and
    if (conjunction) normalized.and = await Promise.all(conjunction.map(narrowed))
    const disjunction = (checked as { or?: Where[] }).or
    if (disjunction) normalized.or = await Promise.all(disjunction.map(narrowed))
    const extras: Where[] = []
    for (const field of Object.keys(normalized)) {
      if (field !== 'and' && field !== 'or') {
        const extra = await protectedField(kayan, field, actor, authorize, admin)
        if (extra) extras.push(extra)
      }
    }
    return extras.length ? combineWhere(normalized as Where, extras.length === 1 ? extras[0] : { and: extras }) : normalized as Where
  }
  return narrowed(await checkedWhere(kayan, where))
}

/** The caller's own `where`, refused as a 400 where its grammar is malformed or a value is not of its column's kind. */
export const checkedWhere = async (kayan: ResolvedKayan, where: unknown): Promise<Where> => {
  // A 400 here, where the `where` is the caller's; from an access callback the same grammar
  // is the project's own bug, a 500, and never tells a caller a rule it did not write is wrong.
  let checked: Where
  try {
    checked = assertWhereGrammar(kayan, where)
  } catch (thrown) {
    if (!(thrown instanceof Error)) throw thrown
    throw invalid({ message: thrown.message, key: 'error.invalid.where', params: { kayan: kayan.name, where }, cause: thrown })
  }
  return valuesChecked(kayan, checked)
}

/**
 * A `where` past `assertWhereGrammar`, with each value it compares read as its
 * column's kind and refused as a 400 where that kind refuses it.
 */
const valuesChecked = async (kayan: ResolvedKayan, checked: Where): Promise<Where> => {
  const issues = await whereIssues(kayan, checked, ['where'])
  if (issues.length) throw issueRefusal(issues, 'mithaq')
  return checked
}

// The day is checked apart by the `date` kind's own test, since a pattern takes `2026-02-30`.
const isoMoment = /^\d{4}-\d{2}-\d{2}(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?)?)?$/

// Text sent for a number or a boolean is read as one. A decimal stays text, so a JS number
// sent for one is refused rather than read through a double.
const coerced = (kind: string, value: unknown) => {
  if (typeof value !== 'string') return value
  // Lower-cased, as the parse lower-cases a uuid, so a store comparing text finds the row too.
  if (kind === 'uuid') return value.toLowerCase()
  if (kind === 'checkbox') return value.toLowerCase() === 'true' ? true : value.toLowerCase() === 'false' ? false : value
  if ((kind === 'number' || kind === 'integer') && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

// Each value is asked of the kayan's own `row` shape, so a value its column refuses is a
// 400 rather than a Postgres 500. `null`, `exists`, `contains` and `like` compare no value of the kind.
const whereIssues = async (kayan: ResolvedKayan, where: Where, at: readonly PropertyKey[]): Promise<StandardSchemaIssue[]> => {
  const issues: StandardSchemaIssue[] = []
  for (const [key, rules] of Object.entries(where)) {
    if (key === 'and' || key === 'or') {
      for (const [index, one] of (rules as Where[]).entries()) issues.push(...await whereIssues(kayan, one, [...at, key, index]))
      continue
    }
    const [name, second] = key.split('.') as [string, string | undefined]
    const field = kayan.fields[name]!
    // A value inside a json field is any scalar, which no column of a kind holds.
    if (field.kind === 'json') continue
    // A hop compares a column of the kayan the field points at, and a set of
    // many named alone compares that kayan's id; a locale is a column of this one.
    const hop = !!field.target && (second ? !field.locales?.includes(second) : !!field.hasMany)
    const owner = hop ? field.target! : kayan
    const segments = hop ? [second ?? 'id'] : second ? [name, second] : [name]
    const column = owner.fields[segments[0]!]
    if (!owner.rowShape || !column || (column.locales && segments.length === 1)) continue
    // What the column holds: a relationship holds the id of the row it points at.
    const kind = column.kind === 'relationship' ? column.target?.fields.id?.kind ?? column.kind : column.kind
    const operators = rules as Record<string, unknown>
    for (const [operator, operand] of Object.entries(operators)) {
      if (operator === 'exists' || operator === 'contains' || operator === 'like') continue
      const read = Array.isArray(operand) ? operand.map((one) => coerced(kind, one)) : coerced(kind, operand)
      operators[operator] = read
      const values = Array.isArray(read) ? read.map((one, index) => [one, [operator, index]] as const) : [[read, [operator]] as const]
      for (const [value, rest] of values) {
        if (value === null) continue
        if (typeof value === 'string' && (kind === 'email' || (kind === 'datetime' && isoMoment.test(value) && defaultKinds.date.accepts(value.slice(0, 10))))) continue
        const nested = segments.reduceRight<unknown>((inner, segment) => ({ [segment]: inner }), value)
        const { issues: refused = [] } = await owner.rowShape['~standard'].validate(nested)
        const own = refused.find(({ path = [] }) =>
          segments.every((segment, index) => {
            const held = path[index]
            return (typeof held === 'object' ? held.key : held) === segment
          }))
        if (own) issues.push({ message: own.message, path: [...at, key, ...rest] })
      }
    }
  }
  return issues
}

// `createdAt` first, then column order. A kayan with no sortable candidate is refused as
// the caller's 400: the store would order nothing and pages would shift.
const sortCandidates = (kayan: ResolvedKayan) => {
  const rest = sortableFields(kayan)
  const candidates = rest.includes('createdAt')
    ? ['createdAt', ...rest.filter((name) => name !== 'createdAt')]
    : rest
  if (!candidates.length) {
    throw invalid({
      message: `Kayan "${kayan.name}" has no field the store can sort by, so a read that names no sort has no order to read it in.`,
      key: 'error.invalid.no_sortable_field',
      params: { kayan: kayan.name },
    })
  }
  return candidates
}

// The id where it is a candidate. Its field access is never asked, so every caller of this
// is one whose order the caller cannot observe or is already the id.
const leastOrder = (candidates: readonly string[], direction: 'asc' | 'desc') => ({
  field: candidates.includes('id') ? 'id' : candidates[0]!,
  direction,
})

const sortOf = async <Actor>(
  kayan: ResolvedKayan,
  sort: unknown,
  actor: Actor | null,
  authorize: Authorize,
  admin?: ManagedAdmin<Actor>,
) => {
  if (sort === undefined) {
    const candidates = sortCandidates(kayan)
    // A denied candidate gives way to the next instead of refusing: ordering by a denied
    // `createdAt` would leak the creation order of every readable row.
    let denial: AsasError | undefined
    for (const field of candidates) {
      try {
        await protectedField(kayan, field, actor, authorize, admin, 'sort')
      } catch (thrown) {
        // Only a 403 falls through; any other throw is the project's failure.
        if (!(thrown instanceof AsasError) || thrown.status !== 403) throw thrown
        denial = thrown
        continue
      }
      return { field, direction: 'desc' as const }
    }
    // Every candidate denied keeps the page in `leastOrder`; where some field is readable but
    // none sortable, the last denial stands.
    for (const name of Object.keys(kayan.fields)) {
      if (candidates.includes(name)) continue
      const read = kayan.fields[name]!.access?.read
      if (denial && (!read || await (read as FieldAccess<Actor, Record<string, unknown>, unknown>)({ user: actor }))) throw denial
    }
    // The kept order is the id or nothing: every other candidate carries the order just refused.
    if (denial && !candidates.includes('id')) throw denial
    return leastOrder(candidates, 'desc')
  }
  if (typeof sort !== 'string' || !/^-?[A-Za-z0-9_]+$/.test(sort)) {
    throw invalid({ message: 'Managed read option "sort" must be a field name, optionally prefixed with "-".', key: 'error.invalid.sort' })
  }
  const direction: 'asc' | 'desc' = sort.startsWith('-') ? 'desc' : 'asc'
  const field = sort.replace(/^-/, '')
  // Reaches the unknown-field 400, the field-access 403 and the localized 400 from a sort.
  await protectedField(kayan, field, actor, authorize, admin, 'sort')
  return { field, direction }
}

export const readers = <Actor>({
  kayan,
  store,
  cap,
  defaultLimit,
  joinLimit,
  admin,
  authorize,
  kayans,
  of,
  audit,
  catalog = [],
  openTenant,
  tenantOf,
  pickers = {},
}: {
  kayan: ResolvedKayan
  store: Store
  cap: number
  /** The service target's page where a caller names none. */
  defaultLimit: number
  /** The service target's join page where a join field names none. */
  joinLimit: number
  admin: ManagedAdmin<Actor> | undefined
  authorize: Authorize
  kayans: (effect: 'read') => unknown
  of: ReadTools['of']
  audit?: AuditHandler<Actor>
  catalog?: readonly string[]
  /** Reads a read's `tenant` option into the scope every managed call under it keeps. */
  openTenant: (args: { actor: unknown; reach: unknown; kayan: ResolvedKayan }) => Promise<TenantScope | undefined>
  /** The organization the actor's session names, which a step reads as `ctx.tenant`. */
  tenantOf: (actor: unknown) => string | undefined
  /** Every relationship field pointing at this kayan, by `<kayan>.<field>`, which a picker's read names as `for`. */
  pickers?: Readonly<Record<string, ResolvedField>>
}): ReaderMap<Actor> => {
  // Every managed read reaches the store here, so the soft-delete filter is put on once.
  const alive = aliveWhere(kayan)
  // A draft read reads published rows and the drafts `findVersions` admits, so no actor
  // reads a draft its `findVersions` leaves out.
  const shown = publishedWhere(kayan)
  const findStore = (name: string, args: Parameters<Store['find']>[0]['args'], tx: unknown, drafts?: Granted) =>
    store.find({ kayan: name, args: { ...args, where: combineWhere(args.where, drafts ? combineWhere(alive, drafts.where && { or: [shown!, drafts.where] }) : shown) }, tx })
  /** The `join` fields of this kayan, which is what a depth populates. */
  const joins = Object.values(kayan.fields).filter((field) => field.kind === 'join')
  // Through `tools.kayans`, so the child's own access, masking and soft-delete filter hold.
  // One query per join field per row.
  const populateJoins = async (rows: Record<string, unknown>[], depth: number) => {
    if (depth < 1 || !joins.length) return rows
    // A copy: a store may hand back the objects it holds, and these were masked for this actor.
    rows = rows.map((row) => ({ ...row }))
    const reads = kayans('read') as Record<string, { find?: (input: FindInput) => Promise<{ docs: unknown[] }> }>
    for (const row of rows) {
      for (const field of joins) {
        const child = reads[field.target!.name]
        // A child whose `find` is disabled leaves the key absent, not an empty page meaning "no children".
        if (!child?.find) continue
        const found = await child.find({
          depth: depth - 1,
          // A bound, not `limit: 0`: a page of parents would otherwise pull every child of each.
          limit: field.defaultLimit ?? joinLimit,
          // Without one, the child's own order holds.
          sort: field.defaultSort,
          where: { [field.on!]: { equals: row.id as Scalar } },
        })
        row[field.name] = found.docs
      }
    }
    return rows
  }
  const currentTx = () => {
    const outer = running.getStore()
    const joined = outer?.transactions?.get(store)
    if (joined?.settled) {
      throw new Error(
        `Kayan "${kayan.name}" read joined the transaction "${joined.operation}" opened, which has already settled, so the read that started this one was not awaited.`,
      )
    }
    return joined?.tx
  }
  // A snapshot's organization is never its row's, so a version reads, and is masked, as its row's own.
  const ownedAs = (snapshot: Record<string, unknown>, row: Record<string, unknown> | undefined) =>
    kayan.tenant ? { ...snapshot, [kayan.tenant]: row?.[kayan.tenant] } : snapshot
  const ownedVersions = async (docs: Record<string, unknown>[]) => {
    if (!kayan.tenant || !docs.length) return docs
    const parents = await store.find({ kayan: kayan.name, args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { in: [...new Set(docs.map((one) => one.parent as Scalar))] } } }, tx: currentTx() })
    const rows = new Map(parents.docs.map((row) => [String(row.id), row]))
    return docs.map((one) => ({ ...one, version: ownedAs(one.version as Record<string, unknown>, rows.get(String(one.parent))) }))
  }
  // Only a row `findVersions` admits is swapped, so another reads as its published copy.
  const latestOf = async (rows: Record<string, unknown>[], granted: Granted) => {
    const ids = rows.map((row) => row.id as Scalar)
    const admitted = granted.where && ids.length
      ? (await store.find({ kayan: kayan.name, args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: combineWhere({ id: { in: ids } }, granted.where) }, tx: currentTx() })).docs.map((row) => row.id as Scalar)
      : ids
    if (!admitted.length) return rows
    const found = await store.find({ kayan: kayan.versions!.table, args: {
      limit: 0,
      page: 1,
      sort: { field: 'updatedAt', direction: 'desc' },
      where: { and: [{ parent: { in: admitted } }, { latest: { equals: true } }] },
    }, tx: currentTx() })
    const drafts = new Map(found.docs.map((one) => [String(one.parent), revived(kayan, one.version)]))
    return rows.map((row) => {
      const draft = drafts.get(String(row.id))
      return draft ? ownedAs(draft, row) : row
    })
  }
  /** One paginated page, for a read of rows and a read of versions alike. */
  const pageOf = <Doc>(docs: Doc[], totalDocs: number, limit: number, page: number): Paginated<Doc> => {
    const totalPages = limit > 0 ? Math.max(1, Math.ceil(totalDocs / limit)) : 1
    return {
      docs,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      limit,
      nextPage: page < totalPages ? page + 1 : null,
      page,
      pagingCounter: limit > 0 ? (page - 1) * limit + 1 : 1,
      prevPage: page > 1 ? page - 1 : null,
      totalDocs,
      totalPages,
    }
  }
  // Under `tenant: 'mine'` each row is masked for the membership it came through, so a filter
  // and an order are held to every admitted membership's field access, or one would narrow
  // or order another organization's rows by a column hidden from it.
  const judges = (actor: Actor | null, accessWhere: Where | undefined) =>
    (membersAdmitted(running.getStore()?.tenant, accessWhere) as (Actor | null)[] | undefined) ?? [actor]
  const judgedWhere = async (where: Where | undefined, actor: Actor | null, accessWhere: Where | undefined) => {
    let judged: Where | undefined
    for (const judge of judges(actor, accessWhere)) {
      judged = combineWhere(judged, await assertReadableWhere({ kayan, where, actor: judge, authorize, admin }))
    }
    return judged
  }
  // A picker's read for one relationship field holds to what that field's `filterOptions` offers the
  // actor, ANDed beside the read's own access, so it narrows and never widens.
  const offeredFor = async (named: unknown, actor: Actor | null): Promise<Where | undefined> => {
    if (named === undefined) return undefined
    const field = typeof named === 'string' && Object.hasOwn(pickers, named) ? pickers[named] : undefined
    if (!field) throw invalid({ message: `Managed read option "for" names ${JSON.stringify(named)}, which is no relationship field pointing at kayan "${kayan.name}".`, key: 'error.invalid.read_option', params: { option: 'for' } })
    const offered = await field.filterOptions?.({ user: actor })
    if (offered === undefined || offered === true) return undefined
    return offered === false ? { id: { in: [] } } : assertWhere(kayan, offered)
  }
  const countFields = (names: unknown): ResolvedField[] => {
    if (names === undefined) return []
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string') || new Set(names).size !== names.length) {
      throw invalid({ message: 'Managed read option "counts" must name each counted field once.', key: 'error.invalid.read_option', params: { option: 'counts' } })
    }
    return names.map((name) => {
      const field = Object.hasOwn(kayan.fields, name) ? kayan.fields[name] : undefined
      if (!field || !(field.kind === 'join' || (field.kind === 'relationship' && field.hasMany))) {
        throw invalid({ message: `Managed read count "${name}" must name a join or hasMany relationship.`, key: 'error.invalid.read_option', params: { option: 'counts' } })
      }
      return field
    })
  }
  const countsOf = async ({ fields, rows, actor, accessWhere }: { fields: ResolvedField[]; rows: Record<string, unknown>[]; actor: Actor | null; accessWhere: Where | undefined }): Promise<RelationshipCounts> => {
    const counts: RelationshipCounts = {}
    const reads = kayans('read') as Record<string, { find?: (input: FindInput) => Promise<{ docs: Record<string, unknown>[] }> }>
    const groups = new Map<string, { field: ResolvedField; rows: Record<string, unknown>[]; where: Where }[]>()
    const tenant = running.getStore()?.tenant
    const admitted = membersAdmitted(tenant, accessWhere)
    for (const field of fields) {
      const visible = []
      for (const row of rows) {
        const user = admitted && kayan.tenant
          ? ((tenant as Extract<TenantScope, { reach: 'mine' }>).members.get(String(row[kayan.tenant])) ?? null) : actor
        if (!field.access?.read || await (field.access.read as FieldAccess)({ user, data: row, doc: row, siblingData: row, id: row.id })) visible.push(row)
      }
      if (!visible.length) continue
      const where: Where = field.kind === 'join'
        ? { [field.on!]: { in: visible.map((row) => row.id as Scalar) } }
        : { id: { in: [...new Set(visible.flatMap((row) => Array.isArray(row[field.name]) ? row[field.name] as Scalar[] : []))] } }
      const group = groups.get(field.target!.name) ?? []
      group.push({ field, rows: visible, where })
      groups.set(field.target!.name, group)
    }
    for (const [target, group] of groups) {
      const find = reads[target]?.find
      if (!find) continue
      // A normal nested find retains the actor, tenant, row policy, field masks and soft deletes.
      // One read per target for the whole page, including multiple columns pointing there.
      let found: { docs: Record<string, unknown>[] }
      try { found = await find({ limit: 0, where: { or: group.map((one) => one.where) } }) }
      catch (error) {
        if (error instanceof AsasError && error.status === 403) continue
        throw error
      }
      for (const { field, rows } of group) {
        const link = field.kind === 'join' ? field.on! : 'id'
        if (found.docs.some((row) => !Object.hasOwn(row, link))) continue
        const ids = new Set(found.docs.map((row) => row.id))
        counts[field.name] = Object.fromEntries(rows.map((row) => [String(row.id), field.kind === 'join'
          ? found.docs.filter((child) => child[link] === row.id).length
          : (Array.isArray(row[field.name]) ? row[field.name] as unknown[] : []).filter((id) => ids.has(id)).length]))
      }
    }
    return counts
  }
  const fetchList = async (input: Record<string, unknown>, actor: Actor | null, granted?: Granted, drafts?: Granted) => {
    const accessWhere = granted ? granted.where : await readAccess(kayan, actor, authorize, admin)
    const callerWhere = await judgedWhere(input.where as Where | undefined, actor, accessWhere)
    const where = combineWhere(combineWhere(callerWhere, accessWhere), await offeredFor(input.for, actor))
    const limit = integerOption('limit', input.limit, defaultLimit, 0)
    const page = integerOption('page', input.page, 1, 1)
    const [first, ...rest] = judges(actor, accessWhere)
    const sort = await sortOf(kayan, input.sort, first!, authorize, admin)
    for (const judge of rest) if (sort.field !== 'id') await protectedField(kayan, sort.field, judge, authorize, admin, 'sort')
    const result = await findStore(kayan.name, { limit, page, sort, where }, currentTx(), drafts)
    const rows = drafts ? await latestOf(result.docs, drafts) : result.docs
    return pageOf(await populateJoins(rows, integerOption('depth', input.depth, 0, 0, cap - 1)), result.totalDocs, limit, page)
  }
  const fetchOne = async (input: Record<string, unknown>, actor: Actor | null, granted?: Granted, drafts?: Granted) => {
    const id = input.id
    const accessWhere = granted ? granted.where : await readAccess(kayan, actor, authorize, admin, id)
    // The tenancy filter, where the language declares one, selects the tenant's own row.
    assertSingleConstrained(kayan, accessWhere)
    const where = kayan.single ? accessWhere : combineWhere({ id: { equals: id as Scalar } }, accessWhere)
    // Only a global's order picks its row; elsewhere an id equality at limit 1 does, and
    // running the sort field's callbacks could only turn a readable row into a 403.
    const sort = kayan.single
      ? await sortOf(kayan, undefined, actor, authorize, admin)
      : leastOrder(sortCandidates(kayan), 'asc')
    const result = await findStore(kayan.name, { limit: 1, page: 1, sort, where }, currentTx(), drafts)
    const found = result.docs.slice(0, 1)
    const [row] = await populateJoins(drafts ? await latestOf(found, drafts) : found, integerOption('depth', input.depth, 0, 0, cap - 1))
    return row ?? null
  }
  const fetchCount = async (input: Record<string, unknown>, actor: Actor | null, granted: Granted) => {
    const callerWhere = await judgedWhere(input.where as Where | undefined, actor, granted.where)
    const where = combineWhere(callerWhere, granted.where)
    if (store.count) return { totalDocs: await store.count({ kayan: kayan.name, args: { where: combineWhere(where, shown) }, tx: currentTx() }) }
    // A total is the same in any order.
    const found = await findStore(kayan.name, { limit: 0, page: 1, sort: leastOrder(sortCandidates(kayan), 'asc'), where }, currentTx())
    return { totalDocs: found.totalDocs }
  }
  // A version is read only where its row is readable under the row's own access, across tenants included.
  const versionsWithin = (granted: Granted) => {
    const rows = combineWhere(granted.where, alive)
    return rows ? prefixWhere(kayan.name, 'parent', rows) : undefined
  }
  // A version's snapshot is no column a filter reaches, and a hop through `parent` would
  // ask about a row's columns past its field access.
  const versionsQuery = async (where: unknown) => {
    if (where === undefined) return undefined
    const table = kayan.versions!.kayan
    const hops = (one: unknown): boolean => !!one && typeof one === 'object' && Object.entries(one).some(([key, value]) =>
      key === 'and' || key === 'or' ? Array.isArray(value) && value.some(hops) : key.includes('.'))
    let checked: Where
    try {
      if (hops(where)) throw new Error(`Kayan "${table.name}" query names a path, and versions are filtered by their own columns alone: id, parent, latest, autosave, createdAt and updatedAt.`)
      checked = assertWhereGrammar(table, where)
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown
      throw invalid({ message: thrown.message, key: 'error.invalid.where', params: { kayan: kayan.name, where }, cause: thrown })
    }
    // Each value held to its column's kind, as a read of the rows holds it.
    return valuesChecked(table, checked)
  }
  const versionsSort = (sort: unknown) => {
    if (sort === undefined) return { field: 'updatedAt', direction: 'desc' as const }
    if (typeof sort !== 'string' || !/^-?(createdAt|updatedAt)$/.test(sort)) {
      throw invalid({ message: 'Managed read option "sort" on versions must be "createdAt" or "updatedAt", optionally prefixed with "-".', key: 'error.invalid.sort' })
    }
    return { field: sort.replace(/^-/, ''), direction: sort.startsWith('-') ? 'desc' as const : 'asc' as const }
  }
  const fetchVersions = async (input: Record<string, unknown>, granted: Granted) => {
    const limit = integerOption('limit', input.limit, defaultLimit, 0)
    const page = integerOption('page', input.page, 1, 1)
    const where = combineWhere(await versionsQuery(input.where), versionsWithin(granted))
    const result = await store.find({ kayan: kayan.versions!.table, args: { limit, page, sort: versionsSort(input.sort), where }, tx: currentTx() })
    return pageOf(await ownedVersions(result.docs), result.totalDocs, limit, page)
  }
  const fetchVersion = async (input: Record<string, unknown>, granted: Granted) => {
    const where = combineWhere({ id: { equals: input.id as Scalar } }, versionsWithin(granted))
    const [one] = await ownedVersions((await store.find({ kayan: kayan.versions!.table, args: { limit: 1, page: 1, sort: versionsSort(undefined), where }, tx: currentTx() })).docs)
    return one ?? null
  }
  const operation: ReaderMap<Actor>['operation'] = ({ name, declaration, input, output, draftOutput }) => async (
    data: Record<string, unknown> = {},
    options: ReadOptions<Actor> = {},
  ) => {
    const outer = running.getStore()
    const actor = (outer?.user as Actor | null | undefined) ?? options.actor ?? null
    const list = atEffect<ReadStep>(declaration.steps)
    const chain = [...(outer?.context.chain ?? []), `${kayan.name}.${name}`]
    const depth = (outer?.context.depth ?? 0) + 1
    // The cap stops a read step that calls this operation again, as it stops a write.
    if (depth > cap) {
      throw new Error(`Read depth ${depth} is past the cap of ${cap}: ${chain.join(' -> ')}.`)
    }
    // A nested read takes the outer context, never the caller's: a read under a write is that write's.
    const context = Object.freeze({ source: 'local', ...(outer?.context ?? options.context), depth, chain })
    const mode = declaration.mode ?? 'many'
    // Opened by the outermost read alone, so a call under it can never widen what it reaches.
    const tenant = outer ? outer.tenant : await openTenant({ actor, reach: options.tenant, kayan })
    const around = { context, ...(outer && { transactions: outer.transactions }), user: actor, ...(tenant && { tenant }) }
    // Asked inside the scope, which the tenant answer reads.
    const granted: Granted = await running.run(around, async () => ({
      where: await readAccess(kayan, actor, authorize, admin, mode === 'one' ? data.id : undefined, name),
    }))
    // A draft read answers each row's latest version, so it asks `findVersions` too.
    const drafts: Granted | undefined = !!options.draft && !!kayan.versions?.drafts && (mode === 'many' || mode === 'one')
      ? await running.run(around, async () => ({ where: await authorize({ admin, actor, data: {}, effect: 'read', kayan, operation: 'findVersions' }) }))
      : undefined
    // Each row is masked for the membership it came through under `tenant: 'mine'`; a row of none reads as no one's.
    const reached = membersAdmitted(tenant, granted.where)
    const viewer = (row: Record<string, unknown>) =>
      reached && kayan.tenant ? ((tenant as { members: ReadonlyMap<string, object> }).members.get(String(row[kayan.tenant])) ?? null) as Actor | null : actor
    let counted: ResolvedField[] | undefined
    const tools: ReadTools<unknown, Actor> = Object.freeze({
      operation: name,
      effect: 'read',
      kind: mode,
      schema: input,
      output,
      publicOutput: declaration.output,
      kayans: kayans('read'),
      of,
      audit,
      catalog,
      read: (values: unknown) => {
        const final = values as Record<string, unknown>
        if (mode === 'many' && final.counts !== undefined) counted = countFields(final.counts)
        return mode === 'one'
          ? fetchOne(final, actor, final.id === data.id ? granted : undefined, drafts)
          : mode === 'count'
            ? fetchCount(final, actor, granted)
            : mode === 'versions'
              ? fetchVersions(final, granted)
              : mode === 'version'
                ? fetchVersion(final, granted)
                : fetchList(final, actor, granted, drafts)
      },
    })
    const tx = currentTx()
    // A reach past one organization names none; a global is its active organization's row under any reach.
    const owner = kayan.tenant && (!tenant || kayan.single) ? tenantOf(actor) : undefined
    let ctx: Ctx = { kayan, data: { ...data }, actor, user: actor, tx, context, tenant: owner }
    const run = async () => {
      // A read fills no default: it writes no column.
      ctx = await parse({ schema: input, ctx, tools })
      // `strictFunctionTypes` checks the actor contravariantly, hence the one cast. A read runs
      // no service-target list: it opens no transaction, and `audit` is taken only by naming it.
      for (const step of atEffect<ReadStep>([...list, ...declaration.afterSteps])) ctx = { ...(await step(ctx, tools as ReadTools)), tenant: owner }
    }
    await running.run(around, run)
    // A total carries no column, so nothing to mask.
    if (mode === 'count') {
      const totalDocs = (ctx.data as { totalDocs?: unknown } | null)?.totalDocs
      if (typeof totalDocs !== 'number') throw new Error(`Kayan "${kayan.name}" operation "${name}" must return { totalDocs }.`)
      return { totalDocs }
    }
    // Cut to what this actor may read of the row, and held to its kinds through the draft shape.
    const versionOf = async (one: Record<string, unknown>) => ({
      id: one.id,
      parent: one.parent,
      latest: one.latest,
      autosave: one.autosave,
      createdAt: one.createdAt,
      updatedAt: one.updatedAt,
      version: await publicResult({ kayan, row: revived(kayan, one.version), actor: viewer(revived(kayan, one.version)), internalOutput: draftOutput ?? output }),
    })
    // An absent or hidden row addressed by id is a 404; a global addressed by no id answers `null` before its first save.
    if (ctx.data === null && (mode === 'version' || (mode === 'one' && !kayan.single))) {
      throw missing({
        message: `No "${kayan.name}" ${mode === 'version' ? 'version' : 'row'} with id ${String(data.id)}.`,
        key: 'error.not_found.row',
        params: { kayan: kayan.name, id: data.id, operation: name },
      })
    }
    if (mode === 'version') return versionOf(ctx.data as Record<string, unknown>)
    if (mode === 'versions') {
      const found = ctx.data as Paginated<Record<string, unknown>>
      const docs = []
      for (const one of found.docs) docs.push(await versionOf(one))
      return { ...found, docs } as Paginated<Record<string, unknown>>
    }
    // A draft may be short of `required`, so it reads through the draft shape.
    const rowOutput = drafts ? draftOutput! : output
    if (mode === 'one') {
      if (ctx.data === null) return null
      return publicResult({ kayan, row: ctx.data as Record<string, unknown>, actor: viewer(ctx.data as Record<string, unknown>), internalOutput: rowOutput, publicOutput: tools.publicOutput })
    }
    const page = ctx.data as Paginated<Record<string, unknown>>
    if (!page || typeof page !== 'object' || !Array.isArray(page.docs)) {
      throw new Error(`Kayan "${kayan.name}" operation "${name}" must return a managed list result.`)
    }
    const docs = [] as Row<Record<string, never>, never, never>[]
    for (const row of page.docs) docs.push(await publicResult({ kayan, row, actor: viewer(row), internalOutput: rowOutput, publicOutput: tools.publicOutput }) as Row<Record<string, never>, never, never>)
    // Counts follow the final rows and masks, so a hidden parent id never reappears as a metadata key.
    const fields = counted
    const counts = fields && await running.run(around, () => countsOf({ fields, rows: page.docs.filter((_, index) => Object.hasOwn(docs[index]!, 'id')), actor, accessWhere: granted.where }))
    return { ...page, docs, ...(counts && { counts }) } as Paginated<Row<Record<string, never>, never, never>>
  }
  return { operation }
}
