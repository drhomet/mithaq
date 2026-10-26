import { defaultKinds, isStorableText } from '../../base/kinds.ts'
import type { ResolvedKayan } from '../../mithaq/types.ts'
import { operatorList, type FieldWhere, type Operator, type Scalar, type Where } from '../../mithaq/where.ts'

const isScalar = (value: unknown): value is Scalar =>
  value === null ||
  ['string', 'boolean'].includes(typeof value) ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (value instanceof Date && Number.isFinite(value.getTime()))

const known: ReadonlySet<string> = new Set<Operator>(operatorList)
/** A list of operators as a sentence says it: `"a", "b" and "c"`. */
const and = new Intl.ListFormat('en-GB', { type: 'conjunction' })

const checkOperatorValue = (said: string, field: string, operator: string, value: unknown) => {
  if ([value].flat().some((one) => typeof one === 'string' && !isStorableText(one))) {
    throw new Error(`${said} field "${field}" operator "${operator}" compares text holding a NUL or half a surrogate pair, which no column holds.`)
  }
  if (operator === 'exists') {
    if (typeof value !== 'boolean') throw new Error(`${said} field "${field}" operator "exists" needs a boolean.`)
    return
  }
  if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(value) || !value.every(isScalar)) {
      throw new Error(`${said} field "${field}" operator "${operator}" needs scalar array.`)
    }
    return
  }
  if ((operator === 'contains' || operator === 'like') && typeof value !== 'string') {
    throw new Error(`${said} field "${field}" operator "${operator}" needs a string.`)
  }
  if (['greater_than', 'greater_than_equal', 'less_than', 'less_than_equal'].includes(operator) && value === null) {
    throw new Error(`${said} field "${field}" operator "${operator}" cannot compare null.`)
  }
  if (!isScalar(value)) {
    throw new Error(`${said} field "${field}" operator "${operator}" needs a scalar.`)
  }
}

// A second segment is a locale or a related field, never both: `resolve` refuses
// `localized` beside `relationTo` on the field itself, whatever the kind is named.
// A json field's path may run past two segments: its keys are no columns, and Payload names them so.
const queryField = ({ kayan, key, said }: { kayan: ResolvedKayan; key: string; said: string }) => {
  const parts = key.split('.')
  const unsupported = `${said} path "${key}" is unsupported. A path is one field, and may then name one related field of what a relationship points at or one locale of a localized field, so it is never more than two segments, or a key at each segment after a json field.`
  const field = parts[0]!
  const resolved = kayan.fields[field]
  if ((parts.length > 2 && resolved?.kind !== 'json') || parts.some((part) => !part || !isStorableText(part))) throw new Error(unsupported)
  const path = parts[1]
  if (!resolved || !Object.hasOwn(kayan.fields, field)) throw new Error(`${said} names unknown field "${key}".`)
  if (resolved.kind === 'json') return { field, key, kind: resolved.kind, operators: resolved.operators }
  if (!path || resolved.locales?.includes(path)) return { field, key, kind: resolved.kind, operators: resolved.operators }
  if (!resolved.target) throw new Error(unsupported)
  const target = resolved.target.fields[path]
  if (!target || !Object.hasOwn(resolved.target.fields, path)) throw new Error(`${said} path "${key}" names unknown related field.`)
  // A path into json across a hop would be a third segment, and a json value compared whole has no store answer.
  if (target.kind === 'json') throw new Error(`${said} path "${key}" reaches json field "${path}" across a relationship, and a json field is filtered on its own kayan alone.`)
  return { field, key, kind: target.kind, operators: target.operators }
}

/** Raw store filters keep their adapter's value and empty-filter semantics; only declared paths are checked here. */
export const assertStoreWhere = (kayan: ResolvedKayan, where: Where): Where => {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'and' || key === 'or') {
      if (Array.isArray(value)) for (const one of value) assertStoreWhere(kayan, one)
    } else queryField({ kayan, key, said: `Kayan "${kayan.name}" store filter` })
  }
  return where
}

// An access constraint and a screen's `when` share this one grammar.
export const assertFieldWhere = ({ said, key, kind, operators, value, valued = true }: { said: string; key: string; kind: string; operators?: readonly Operator[]; value: unknown; valued?: boolean }): FieldWhere => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${said} field "${key}" must use operators.`)
  }
  const fieldWhere: Record<string, unknown> = Object.create(null)
  for (const [operator, operand] of Object.entries(value)) {
    if (!known.has(operator)) {
      throw new Error(`${said} field "${key}" uses unsupported operator "${operator}".`)
    }
    // A kind that names its operators is held to them and nothing else
    // as rich text is to the three that search the words of its text.
    if (operators && !operators.includes(operator as Operator)) {
      throw new Error(
        `${said} field "${key}" operator "${operator}" is not supported on a field of kind "${kind}"; only ${and.format(operators.map((one) => `"${one}"`))} ${operators.length === 1 ? 'is' : 'are'}.`,
      )
    }
    // Every operator here compares one value, so none means anything against a list
    // column; drizzle's array mapper would throw a 500 first. `exists` asks about the column.
    if (kind === 'textArray' && operator !== 'exists') {
      throw new Error(`${said} field "${key}" operator "${operator}" is not supported on a list field; only "exists" is.`)
    }
    if (!operators && (operator === 'contains' || operator === 'like') && !['email', 'text'].includes(kind)) {
      throw new Error(`${said} field "${key}" operator "${operator}" only supports text-like fields.`)
    }
    if (
      !operators &&
      ['greater_than', 'greater_than_equal', 'less_than', 'less_than_equal'].includes(operator) &&
      !['date', 'datetime', 'number', 'integer', 'decimal'].includes(kind)
    ) {
      throw new Error(`${said} field "${key}" operator "${operator}" only supports numeric, date and datetime fields.`)
    }
    checkOperatorValue(said, key, operator, operand)
    if (!valued && Array.isArray(operand) && operand.length > whereLimits.values) {
      throw new Error(`${said} field "${key}" operator "${operator}" lists at most ${whereLimits.values} values.`)
    }
    // Each word of a `like` is a pattern the store matches, so its words are held to the same count.
    if (!valued && operator === 'like' && typeof operand === 'string' && operand.trim().split(/\s+/).length > whereLimits.values) {
      throw new Error(`${said} field "${key}" operator "like" holds at most ${whereLimits.values} words.`)
    }
    // A value an integer or decimal column cannot hold would reach Postgres as a 500.
    // A caller's own query skips this: its row shape refuses values with a path each.
    if (valued && (kind === 'integer' || kind === 'decimal') && operator !== 'exists') {
      for (const one of Array.isArray(operand) ? operand : [operand]) {
        const read = kind === 'integer' && typeof one === 'string' && /^[+-]?\d+$/.test(one) ? Number(one) : one
        if (read !== null && !defaultKinds[kind].accepts(read)) throw new Error(`${said} field "${key}" operator "${operator}" needs a value of kind "${kind}".`)
      }
    }
    fieldWhere[operator] = operand
  }
  if (!Object.keys(fieldWhere).length) throw new Error(`${said} field "${key}" has no operators.`)
  return fieldWhere as FieldWhere
}

export const assertWhere = (kayan: ResolvedKayan, where: unknown): Where =>
  normalizedWhere({ kayan, where, valued: true, said: `Kayan "${kayan.name}" access constraint` })

// Grammar alone: a caller's values are the row shape's to refuse.
export const assertWhereGrammar = (kayan: ResolvedKayan, where: unknown): Where =>
  normalizedWhere({ kayan, where, valued: false, said: `Kayan "${kayan.name}" query` })

/**
 * How large a caller's `where` may be: the values one `in` or `not_in` lists, and the fields, `and`s and
 * `or`s it holds in all, however nested. Each is a condition the store runs, so past these a read is
 * refused before it reaches the store rather than holding it for minutes.
 */
export const whereLimits = { values: 1000, nodes: 200 } as const

const normalizedWhere = ({ kayan, where, valued, said, nodes = { left: whereLimits.nodes } }: { kayan: ResolvedKayan; where: unknown; valued: boolean; said: string; nodes?: { left: number } }): Where => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    throw new Error(`${said} is not an object of fields.`)
  }
  const entries = Object.entries(where)
  if (!entries.length) throw new Error(`${said} is empty.`)
  // No prototype, so `__proto__` is a key like any other.
  const normalized: Record<string, unknown> = Object.create(null)
  for (const [key, value] of entries) {
    // An access constraint is the project's own to size; a caller's is held to the limits.
    if (!valued && --nodes.left < 0) throw new Error(`${said} holds at most ${whereLimits.nodes} fields, "and"s and "or"s.`)
    if (key === 'and' || key === 'or') {
      if (!Array.isArray(value) || !value.length) {
        throw new Error(`${said} "${key}" must be a non-empty array.`)
      }
      normalized[key] = value.map((one) => normalizedWhere({ kayan, where: one, valued, said, nodes }))
      continue
    }
    const queried = queryField({ kayan, key, said })
    const fieldWhere = assertFieldWhere({ said, key, kind: queried.kind, operators: queried.operators, value, valued })
    normalized[queried.key] = { ...(normalized[queried.key] as object | undefined), ...fieldWhere }
  }
  return normalized as Where
}

