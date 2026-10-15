import { compareDecimals, decimalDigits, isDecimal, type ClientField, type ClientKayan } from 'mithaq/admin'
import type { Copy } from 'mithaq-admin/copy.ts'
import { counted, listed } from 'mithaq-admin/format.tsx'

/**
 * Which fields a schema refusal names, and what it says about each, keyed by the first segment of
 * the issue's path (the field the form drew a control for).
 */
export const issuesOf = (error: unknown): Readonly<Record<string, string>> => {
  const issues = (error as { data?: { params?: { issues?: unknown } } } | null | undefined)?.data?.params?.issues
  // No prototype, so a field named `toString` has no issue it was never given.
  const byField: Record<string, string> = Object.create(null)
  if (!Array.isArray(issues)) return byField
  for (const issue of issues as readonly { path?: unknown; message?: unknown }[]) {
    const path = typeof issue?.path === 'string' ? issue.path.split('.')[0] : ''
    if (!path || typeof issue.message !== 'string' || byField[path] !== undefined) continue
    byField[path] = issue.message
  }
  return byField
}

/** An email address, by the pattern the server's `email` kind runs, copied so the browser loads no zod. */
const emailShape = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/

/** Whether a value is nothing a person wrote. An empty list is a value, so a required list may be saved empty; `minRows` asks for rows. */
const empty = (value: unknown) => value === undefined || value === null || value === ''

/**
 * The first rule of the projection this value breaks, as the last segment of the server's copy key,
 * in the server's order, or nothing. An empty box passes every rule but `required`; a value outside
 * `options` is `invalid`.
 */
export const brokenRule = (field: ClientField, held: unknown): string | undefined => {
  const { rules } = field
  if (rules.localized === true && held && typeof held === 'object') {
    return Object.values(held).map((one) => brokenRule({ ...field, rules: { ...rules, localized: false } }, one)).find(Boolean)
  }
  // The server trims and cases before it judges, so judge the rewritten value.
  const text = typeof held === 'string' && rules.trim === true ? held.trim() : held
  const value = typeof text !== 'string' ? text : rules.uppercase === true ? text.toUpperCase() : rules.lowercase === true ? text.toLowerCase() : text
  if (Array.isArray(value) && (value.length || rules.required === true)) {
    if (typeof rules.minRows === 'number' && value.length < rules.minRows) return 'minRows'
    if (typeof rules.maxRows === 'number' && value.length > rules.maxRows) return 'maxRows'
  }
  if (empty(value)) return rules.required === true ? 'required' : undefined
  if (field.kind === 'integer' && !(Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647)) return 'invalid'
  if (field.kind === 'decimal') {
    if (!isDecimal(value)) return 'invalid'
    const { whole, fraction } = decimalDigits(value)
    if (typeof rules.precision === 'number' && (whole + fraction > rules.precision || whole > rules.precision - Number(rules.scale))) return 'precision'
    if (typeof rules.scale === 'number' && fraction > rules.scale) return 'scale'
    if (typeof rules.min === 'string' && compareDecimals(value, rules.min) < 0) return 'min'
    if (typeof rules.max === 'string' && compareDecimals(value, rules.max) > 0) return 'max'
    return undefined
  }
  if (field.kind === 'email' && typeof value === 'string' && !emailShape.test(value)) return 'invalid'
  const size = typeof value === 'string' || Array.isArray(value) ? value.length : undefined
  if (size !== undefined && typeof rules.minLength === 'number' && size < rules.minLength) return 'minLength'
  if (size !== undefined && typeof rules.maxLength === 'number' && size > rules.maxLength) return 'maxLength'
  if (typeof value === 'string' && rules.pattern instanceof RegExp && !new RegExp(rules.pattern).test(value)) return 'pattern'
  const { min, max } = rules
  if (typeof min === 'number' ? typeof value === 'number' && value < min : typeof min === 'string' && String(value) < min) return 'min'
  if (typeof max === 'number' ? typeof value === 'number' && value > max : typeof max === 'string' && String(value) > max) return 'max'
  if (field.options && [value].flat().some((one) => !field.options!.some((option) => option.value === one))) return 'invalid'
  return undefined
}

/**
 * The refusal the server would send for these values, in its wire shape, or nothing when every rule
 * holds. The rules are checked here because the derived zod shape does not cross `structuredClone`
 * into the browser; the server stays the authority.
 */
export const refusalOf = ({
  kayan,
  fields,
  values,
}: {
  kayan: string
  fields: readonly ClientField[]
  values: Readonly<Record<string, unknown>>
}) => {
  const issues = fields.flatMap((field) => {
    const rule = brokenRule(field, values[field.name])
    return rule ? [{ path: field.name, message: `${kayan}.${field.name}.${rule}` }] : []
  })
  return issues.length ? { data: { key: 'error.invalid.value', params: { issues } } } : undefined
}

/**
 * What a toast says once a write landed: the kayan's own words for its operation (`courses.operations.archive.done`),
 * the shared ones with its kind put in, or the operation's label. `next` is where a save left a row that keeps drafts.
 */
export const doneWords = ({ kayan, copy, effect, operation, next }: { kayan: Pick<ClientKayan, 'name'>; copy: Copy; effect?: string; operation?: { name: string; label?: Readonly<Record<string, string>> }; next?: string }): string => {
  const { t, locale } = copy
  const kind = t(`${kayan.name}.singular`, kayan.name) ?? kayan.name
  const said = (key: string, fallback: string) => (t(key, fallback) ?? fallback).replace('{kind}', () => kind)
  if (operation) {
    return t(`${kayan.name}.operations.${operation.name}.done`)
      ?? t(`admin.done.${operation.name}`)?.replace('{kind}', () => kind)
      ?? said('admin.done.ran', '{operation}: done').replace('{operation}', () => operation.label?.[locale] ?? t(`${kayan.name}.operations.${operation.name}`, operation.name) ?? operation.name)
  }
  if (effect === 'delete') return said('admin.done.deleted', '{kind} deleted')
  if (next === 'published') return said('admin.done.published', '{kind} published')
  if (next) return said('admin.done.draftSaved', 'Draft saved')
  return effect === 'create' ? said('admin.done.created', '{kind} created') : said('admin.done.saved', '{kind} saved')
}

/** What a toast says when a write failed: its refusal's own sentence, or, for a request that never answered with one or a key with no words, that nothing changed. */
export const failedWords = ({ kayan, copy, thrown }: { kayan?: string; copy: Copy; thrown: unknown }): string => {
  const key = (thrown as { data?: { key?: unknown } } | null | undefined)?.data?.key
  const failed = copy.t('admin.requestFailed', 'Something went wrong, so nothing was saved. Try again.') ?? 'Something went wrong, so nothing was saved. Try again.'
  // A key the copy does not word is said in the shared sentence, never as the key.
  return typeof key === 'string' ? refusalWords({ kayan, shown: key, labels: [], fallback: failed, copy }) : failed
}

/** The sentence over a refused save: a schema refusal that names fields lists them by label; any other is its own key's sentence, or `fallback`. */
export const refusalWords = ({ shown, labels, fallback, kayan, copy: { t, locale } }: { shown: string; labels: readonly string[]; fallback?: string; kayan?: string; copy: Copy }): string =>
  shown === 'error.invalid.value' && labels.length
    ? counted({ t, locale, key: 'error.invalid.fields', count: labels.length, fallback: 'The following fields are invalid: {fields}' }).replace('{fields}', () => listed(labels, locale))
    // A kayan words a refusal of its own under its scope, `enrollments.conflict.unique`, over the shared words.
    : ((kayan && t(`${kayan}.${shown.replace(/^error\./, '')}`)) || (t(shown, fallback ?? shown) ?? shown))
