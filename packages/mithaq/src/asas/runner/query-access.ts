import { defaultKinds } from '../../base/kinds.ts'
import { unsortable, type FieldAccess, type ResolvedKayan } from '../../mithaq/types.ts'
import { combineWhere, type Where } from '../../mithaq/where.ts'
import type { StandardSchemaIssue } from '../../mithaq/standard-schema.ts'
import type { Authorize } from './access.ts'
import type { ManagedAdmin } from './write.ts'
import { assertWhereGrammar } from './query.ts'
import { issueRefusal } from './steps.ts'
import { publishedWhere } from './row-state.ts'
import { denied, invalid, localizedQuery } from './errors.ts'

// A dotted key is refused: across the hop it would be three segments, and passed through
// unprefixed it would constrain the near table instead of the far one.
export const prefixWhere = ({ kayan, prefix, where }: { kayan: string; prefix: string; where: Where }): Where => {
  const conjunction = (where as { and?: Where[] }).and
  if (conjunction) return { and: conjunction.map((one) => prefixWhere({ kayan, prefix, where: one })) }
  const disjunction = (where as { or?: Where[] }).or
  if (disjunction) return { or: disjunction.map((one) => prefixWhere({ kayan, prefix, where: one })) }
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

export type QueryAccess<Actor> = {
  kayan: ResolvedKayan
  actor: Actor | null
  authorize: Authorize
  admin?: ManagedAdmin<Actor>
  viewers?: (where: Where | undefined) => readonly unknown[]
}

export const protectedField = async <Actor>({ kayan, field, actor, authorize, admin, what = 'filter', viewers }: QueryAccess<Actor> & {
  field: string
  what?: 'filter' | 'sort'
}): Promise<Where | undefined> => {
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
  const farAccess = await authorize({ admin, actor, data: {}, effect: 'read', kayan: root.target })
  // Under `tenant: 'mine'` each far row is read by the membership it came through, so a column
  // hidden from one of them filters and orders none of their rows.
  for (const member of viewers?.(farAccess) ?? []) await readable(root.target, found, member)
  const targetWhere = combineWhere(farAccess, publishedWhere(root.target))
  return targetWhere ? prefixWhere({ kayan: root.target.name, prefix: ownField!, where: targetWhere }) : undefined
}

// A field this actor may not read refuses the query, and a hop carries the other kayan's
// read access. Shared with the bulk runner, whose `where` is held to the same.
export const assertReadableWhere = async <Actor>({ kayan, where, actor, authorize, admin, viewers }: QueryAccess<Actor> & {
  where: Where | undefined
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
        const extra = await protectedField({ kayan, field, actor, authorize, admin, viewers })
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
export const valuesChecked = async (kayan: ResolvedKayan, checked: Where): Promise<Where> => {
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

