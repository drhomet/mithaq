import type { ResolvedField, ResolvedKayan } from '../../mithaq/types.ts'
import { whereLimits } from './write.ts'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
const lower = (value: unknown): unknown => typeof value === 'string' ? value.toLowerCase() : value
const uuid = (field: ResolvedField | undefined) => field?.kind === 'uuid' || field?.target?.fields.id?.kind === 'uuid'
const valueOf = (field: ResolvedField, value: unknown): unknown =>
  field.locales && object(value) ? Object.fromEntries(Object.entries(value).map(([locale, one]) => [locale, lower(one)]))
    : field.hasMany && Array.isArray(value) ? value.map(lower) : lower(value)

/** Postgres returns lowercase uuid text, so access, validation and steps must see that same spelling. */
export const normalizeInput = ({ kayan, input, bulk = false, version = false }: {
  kayan: ResolvedKayan
  input: unknown
  bulk?: boolean
  version?: boolean
}): unknown => {
  if (!object(input)) return input
  const fields = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([key, value]) =>
    [key, uuid(kayan.fields[key]) ? valueOf(kayan.fields[key]!, value) : key === 'id' && version ? lower(value) : value]))
  const nodes = { left: whereLimits.nodes }
  const where = (value: unknown): unknown => {
    if (!object(value) || --nodes.left < 0) return value
    return Object.fromEntries(Object.entries(value).map(([key, rules]) => {
      if ((key === 'and' || key === 'or') && Array.isArray(rules)) return [key, rules.map(where)]
      const [name, path] = key.split('.')
      const field = kayan.fields[name!]
      const queried = path && !field?.locales?.includes(path) ? field?.target?.fields[path] : field
      return [key, uuid(queried) && object(rules) ? Object.fromEntries(Object.entries(rules).map(([operator, operand]) =>
        [operator, ['equals', 'in', 'not_equals', 'not_in'].includes(operator) ? Array.isArray(operand) ? operand.map(lower) : lower(operand) : operand])) : rules]
    }))
  }
  return Object.assign(Object.create(null), {
    ...(bulk ? input : fields(input)),
    ...(bulk && object(input.data) && { data: fields(input.data) }),
    ...(Object.hasOwn(input, 'where') && { where: where(input.where) }),
  })
}
