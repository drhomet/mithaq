import { isRef, refuseLiteral, type Ref } from './user.ts'
import { combineWhere, type Operator, type Scalar, type Where } from './where.ts'
import type { Access, FieldAccess } from './types.ts'

export type RowOperation = 'create' | 'delete' | 'read' | 'update'

/** What a row compares a field with: a literal, or a reference to the actor's value at one key, resolved before the store sees it. */
export type RowFieldWhere = Partial<Record<Operator, Scalar | Scalar[] | boolean | Ref>>

/** A `Where` whose paths are the kayan's field names plus one relationship hop. */
export type RowWhere<Paths extends string = string> =
  | { and: readonly RowWhere<Paths>[] }
  | { or: readonly RowWhere<Paths>[] }
  | { [Path in Paths]?: RowFieldWhere }

// An empty filter constrains nothing, so a row may never carry one.
type NonEmpty<Answer> = Answer extends boolean | readonly unknown[]
  ? Answer
  : keyof Answer extends never
    ? never
    : Answer

/** A row table checked before it compiles: the role keys, and no empty `Where`. `'*'` is the row every assigned actor gets beside its own. */
export type CheckedTable<Table, Role extends string = string> = {
  [Key in keyof Table]: Key extends '*' | Role
    ? { [Answer in keyof Table[Key]]: NonEmpty<Table[Key][Answer]> }
    : never
}

/** `'*'`, a field name, or `!name`. A row that names no list means `['*']`. */
export type FieldList<Names extends string = string> = '*' | Names | `!${Names}`

/** What one role may do. Every key is optional, and a missing one denies. */
export type AccessRow<Paths extends string = string, Names extends string = string> = {
  /** Only `true` allows: the runner denies any create answer that is not `true`. */
  create?: boolean
  delete?: boolean | RowWhere<Paths>
  fields?: readonly FieldList<Names>[]
  /**
   * The catalog keys this role holds, `${kayan}.${operation}` or `${kayan}.fields.${field}`, or `'*'`.
   * Read only where the build declares no access target; a key outside the catalog fails the build.
   */
  permissions?: '*' | readonly string[]
  read?: boolean | RowWhere<Paths>
  update?: boolean | RowWhere<Paths>
}

export type RowTable<Names extends string = string> = Record<string, AccessRow<string, Names>>

export type RowsOptions<Actor = unknown> = {
  /** What the build's access target resolved this actor holds; where it answers, it decides. */
  holds?: (user: Actor) => Held
  /** Where an actor's roles are read from. Defaults to `user.roles`. */
  roles?: (user: Actor) => readonly string[]
}

/** What an actor holds: `true` for every key, a set of keys, or nothing where no store grades and the row answers decide alone. */
export type Held = true | ReadonlySet<string> | undefined

/** What `rows()` returns: the floor's access object, and the rows it came from. */
export type Rows<Table extends RowTable = RowTable> = {
  create: Access
  delete: Access
  read: Access
  update: Access
  /** The three callbacks the field named `name` gets from these rows; without `kayan` a grading table denies the field. */
  fields(name: string, kayan?: string): { create: FieldAccess; read: FieldAccess; update: FieldAccess }
  /** The keys this kayan's own rows hold for the actor. */
  permissions(user: unknown): Held
  /** Which of these rows applied to an actor, so an error can name them. */
  roles(user: unknown): string[]
  /** The rows as written, so a tool can read them without running a callback. */
  rows: Table
}

// A marker, not a security boundary. A symbol, so no field name collides with it
// and an object spread still carries it.
const ROWS = Symbol('mithaq.rows')
const rowFieldAccess = new WeakMap<object, Rows>()

/** The rows behind an access object, or nothing for hand-written callbacks. */
export const rowsOf = (access: unknown): Rows | undefined =>
  access && typeof access === 'object' ? (access as Record<symbol, Rows | undefined>)[ROWS] : undefined

/** The rows behind a field callback, or nothing for a hand-written one. */
export const rowsOfField = (access: unknown): Rows | undefined =>
  typeof access === 'function' ? rowFieldAccess.get(access) : undefined

const narrowedFrom = new WeakMap<object, unknown>()

// The narrowed callback never admits more than the declared one, so a check that
// a field kept a shipped callback reads the declared one here.
export const declaredFieldAccess = (access: unknown): unknown => {
  while (typeof access === 'function' && narrowedFrom.has(access)) access = narrowedFrom.get(access)
  return access
}

// A row naming nothing admits every field, and a list of only exclusions means every
// other field. Shared with `buildAsas`, so a build and a request never read one list two ways.
export const admissions = (fields: readonly string[] | undefined): readonly string[] => {
  const list = fields ?? ['*']
  return list.some((entry) => !entry.startsWith('!')) ? list : ['*', ...list]
}

const deepFreeze = (value: unknown, seen = new WeakSet<object>()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  Object.freeze(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
}

const resolveValue = (value: unknown, user: unknown): unknown => {
  if (Array.isArray(value)) return value.map((one) => resolveValue(one, user))
  refuseLiteral(value, 'An access row filter')
  if (!isRef(value)) return value
  // An absent or `null` key throws: `{ organization: { equals: null } }` would read every
  // row with no tenant. An own key only, since a JSON table could name `__proto__`.
  const actor = user as Record<string, unknown> | null | undefined
  const found = actor && Object.hasOwn(actor, value.$user) ? actor[value.$user] : undefined
  if (found === null || found === undefined) {
    throw new Error(`Access row filter "user.${value.$user}" found nothing on the actor, so there is no constraint to apply.`)
  }
  return found
}

const resolveWhere = (where: Where, user: unknown): Where =>
  Object.fromEntries(
    Object.entries(where).map(([key, value]) => [
      key,
      key === 'and' || key === 'or'
        ? (value as Where[]).map((one) => resolveWhere(one, user))
        : Object.fromEntries(
            Object.entries(value as RowFieldWhere).map(([operator, operand]) => [
              operator,
              resolveValue(operand, user),
            ]),
          ),
    ]),
  ) as Where

/** Both answers applied, so a callback beside rows may narrow and never widen. */
const and = (left: Access, right: Access): Access => async (args) => {
  const first = await left(args)
  if (!first) return false
  const second = await right(args)
  if (!second) return false
  if (first === true) return second
  if (second === true) return first
  return combineWhere(first, second)!
}

const andField = (left: FieldAccess, right: FieldAccess): FieldAccess => async (args) =>
  !!(await left(args)) && !!(await right(args))

const operations: readonly RowOperation[] = ['create', 'delete', 'read', 'update']

/**
 * Compiles a row per role onto the floor's callbacks: no applicable row denies, a `false` in any denies,
 * a `true` with no `false` allows, and several filters admit a row any one of them admits.
 */
export const rows = <const Table extends RowTable>(
  table: Table & CheckedTable<Table>,
  options?: RowsOptions,
): Rows<Table> => {
  // Frozen, nested objects too: a tool handed the table cannot rewrite what the
  // callbacks answer, and a row's `Where` is read live each time.
  deepFreeze(table)
  const written = table as RowTable
  const roles = (user: unknown): string[] => {
    if (!user) return []
    const found = options?.roles ? options.roles(user) : (user as { roles?: unknown }).roles
    return Array.isArray(found) ? found.filter((role): role is string => typeof role === 'string') : []
  }
  // An actor with no role takes no row, `'*'` included, so a `Where` naming a key an
  // anonymous caller does not carry is never resolved.
  const applicable = (user: unknown) => {
    const assigned = roles(user)
    if (!assigned.length) return []
    const every = written['*']
    // An own key only: `constructor` read through the prototype would hand back `Object` as a row.
    const own = assigned
      .map((role) => (Object.hasOwn(written, role) ? written[role] : undefined))
      .filter((row): row is AccessRow => !!row)
    return every ? [every, ...own] : own
  }
  const answer = (operation: RowOperation): Access => ({ user }) => {
    const hits = applicable(user).map((row) => row[operation] ?? false)
    if (!hits.length || hits.some((hit) => hit === false)) return false
    if (hits.some((hit) => hit === true)) return true
    const filters = (hits as Where[]).map((one) => resolveWhere(one, user))
    return filters.length === 1 ? filters[0]! : { or: filters }
  }
  const admits = (name: string, user: unknown) => {
    const lists = applicable(user).map((row) => admissions(row.fields))
    return (
      lists.length > 0 &&
      lists.every((list) => list.includes('*') || list.includes(name)) &&
      !lists.some((list) => list.includes(`!${name}`))
    )
  }
  // A table grades only when some row names `permissions`; otherwise row answers decide.
  const grades = Object.values(written).some((row) => row.permissions !== undefined)
  const held = (user: unknown): Held => {
    if (!grades) return undefined
    const hits = applicable(user)
    if (hits.some((row) => row.permissions === '*')) return true
    // Several roles union. A row that names no list contributes nothing rather than everything.
    return new Set(hits.flatMap((row) => (row.permissions === '*' ? [] : (row.permissions ?? []))))
  }
  const heldOf = (user: unknown): Held => (options?.holds as ((user: unknown) => Held) | undefined)?.(user) ?? held(user)
  const holdsField = (kayan: string | undefined, name: string, user: unknown) => {
    const keys = heldOf(user)
    if (keys === undefined || keys === true) return true
    // The key it would need is one nothing can name.
    return kayan !== undefined && keys.has(`${kayan}.fields.${name}`)
  }
  const compiled: Rows = {
    create: answer('create'),
    delete: answer('delete'),
    read: answer('read'),
    update: answer('update'),
    fields: (name, kayan) => {
      const admit: FieldAccess = ({ user }) => admits(name, user) && holdsField(kayan, name, user)
      rowFieldAccess.set(admit, compiled)
      return { create: admit, read: admit, update: admit }
    },
    permissions: held,
    roles,
    rows: table,
  }
  return Object.assign(compiled, { [ROWS]: compiled }) as unknown as Rows<Table>
}

/** The access object a kayan gets from its rows, with the callbacks it declared beside them ANDed on. */
export const applyRows = (compiled: Rows, declared?: Record<string, unknown>) => {
  const merged: Record<string, unknown> = { ...declared, [ROWS]: compiled, rows: compiled.rows }
  delete merged.tenant
  for (const operation of operations) {
    const own = declared?.[operation] as Access | undefined
    merged[operation] = own && own !== compiled[operation] ? and(compiled[operation], own) : compiled[operation]
  }
  return merged
}

// Marked as coming from rows, so a write the field's own callback denies throws the
// naming error rather than dropping silently.
export const rowFields = ({ compiled, name, declared, kayan }: { compiled: Rows; name: string; declared?: Record<string, unknown>; kayan?: string }) => {
  const admit = compiled.fields(name, kayan)
  return Object.fromEntries(
    Object.entries(admit).map(([operation, callback]) => {
      const own = declared?.[operation] as FieldAccess | undefined
      if (!own) return [operation, callback]
      const narrowed = andField(callback, own)
      rowFieldAccess.set(narrowed, compiled)
      narrowedFrom.set(narrowed, own)
      return [operation, narrowed]
    }),
  )
}
