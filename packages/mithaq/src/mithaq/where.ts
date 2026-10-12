// Imports nothing but `../base/decimal.ts`, which imports nothing, so `mithaq/admin` can carry it to a browser.
import { compareDecimals, isDecimal } from '../base/decimal.ts'

export type Scalar = string | number | boolean | Date | null
// The list is the source and the union is read off it, so the type and the set the runner admits cannot drift.
export const operatorList = [
  'contains',
  'equals',
  'exists',
  'greater_than',
  'greater_than_equal',
  'in',
  'less_than',
  'less_than_equal',
  'like',
  'not_equals',
  'not_in',
] as const
export type Operator = (typeof operatorList)[number]
export type FieldWhere = Partial<Record<Operator, Scalar | readonly Scalar[] | boolean>>
export type Where = { and: readonly Where[] } | { or: readonly Where[] } | { [field: string]: FieldWhere }

export const combineWhere = (left?: Where, right?: Where): Where | undefined =>
  left && right ? { and: [left, right] } : left ?? right

/**
 * Whether a `Where` holds, read in memory, with each operator meaning what the
 * stores mean by it. `kindOf` lets a decimal compare by value, as Postgres does.
 */
export const matchesWhere = ({ where, valueOf, kindOf }: { where: Where; valueOf: (key: string) => unknown; kindOf?: (key: string) => string | undefined }): boolean =>
  Object.entries(where).every(([key, rules]) =>
    key === 'and' ? (rules as Where[]).every((one) => matchesWhere({ where: one, valueOf, kindOf }))
    : key === 'or' ? (rules as Where[]).some((one) => matchesWhere({ where: one, valueOf, kindOf }))
    : Object.entries(rules as Record<string, unknown>).every(([operator, operand]) =>
        fieldMatch({ value: valueOf(key), operator, operand, decimal: kindOf?.(key) === 'decimal' })))

/**
 * Two stored values the same by what they hold: a moment by its time, an object
 * whatever its key order, an absent value as `null`. No `node:util`: this runs in the browser.
 */
export const same = (left: unknown, right: unknown): boolean => {
  const [a, b] = [left ?? null, right ?? null]
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
const orderValue = (value: unknown) => (value instanceof Date ? value.getTime() : value)
const less = (left: unknown, right: unknown) =>
  typeof left === 'number' && typeof right === 'number' ? left < right : String(left) < String(right)
/** Where one value sorts against another, `null` last going up. */
export const compareValues = ({ left, right, direction }: { left: unknown; right: unknown; direction: 'asc' | 'desc' }) => {
  if (left === null && right === null) return 0
  if (left === null) return direction === 'asc' ? 1 : -1
  if (right === null) return direction === 'asc' ? -1 : 1
  const a = orderValue(left)
  const b = orderValue(right)
  const order = a === b ? 0 : less(b, a) ? 1 : -1
  return direction === 'desc' ? -order : order
}
const text = (value: unknown) => String(value ?? '').toLowerCase()
const comparable = (value: unknown) => value !== null && value !== undefined
const fieldMatch = ({ value, operator, operand, decimal }: { value: unknown; operator: string; operand: unknown; decimal: boolean }): boolean => {
  const exact = (left: unknown, right: unknown) => decimal && isDecimal(left) && isDecimal(right)
  const equal = (left: unknown, right: unknown) => (exact(left, right) ? compareDecimals(left as string, right as string) === 0 : same(left, right))
  const order = (left: unknown, right: unknown) => (exact(left, right) ? compareDecimals(left as string, right as string) : compareValues({ left, right, direction: 'asc' }))
  switch (operator) {
    case 'contains':
      return comparable(value) && text(value).includes(text(operand))
    case 'like':
      return comparable(value) && text(operand).trim().split(/\s+/).filter(Boolean).every((word) => text(value).includes(word))
    case 'equals':
      return equal(value, operand)
    case 'exists':
      return Boolean(operand) ? value !== null && value !== undefined : value === null || value === undefined
    case 'greater_than':
      return comparable(value) && comparable(operand) && order(value, operand) > 0
    case 'greater_than_equal':
      return comparable(value) && comparable(operand) && order(value, operand) >= 0
    case 'in':
      return (operand as unknown[]).some((one) => equal(value, one))
    case 'less_than':
      return comparable(value) && comparable(operand) && order(value, operand) < 0
    case 'less_than_equal':
      return comparable(value) && comparable(operand) && order(value, operand) <= 0
    case 'not_equals':
      return operand === null ? comparable(value) : comparable(value) && !equal(value, operand)
    case 'not_in':
      return comparable(value) && !(operand as unknown[]).some((one) => equal(value, one))
    default:
      return false
  }
}
