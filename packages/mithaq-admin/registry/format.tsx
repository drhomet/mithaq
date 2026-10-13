import type { Translate } from 'mithaq-admin/copy.ts'

/**
 * Several values as one phrase in the viewer's own language, by `Intl.ListFormat`. The type is `unit`, so English joins with commas alone and Arabic with its own conjunction.
 */
export const listed = (values: readonly string[], locale: string) => new Intl.ListFormat(locale, { type: 'unit' }).format(values)

/**
 * What a cell draws for a value nobody set: a dash hidden from screen readers, since a cell read as nothing says the same.
 */
export const noValue = <span aria-hidden="true">—</span>

/**
 * A sentence that counts, in the plural form the locale takes for that count: `key` plus `_one`, `_two`, `_few`, `_many` or `_other` as `Intl.PluralRules` names it, falling back to `_other`. `{count}` is the number in the locale's digits.
 */
export const counted = ({ t, locale, key, count, fallback }: { t: Translate; locale: string; key: string; count: number; fallback: string }): string =>
  (t(`${key}_${new Intl.PluralRules(locale || undefined).select(count)}`) ?? t(`${key}_other`, fallback) ?? fallback).replace('{count}', () => count.toLocaleString(locale || undefined))

/**
 * A moment, or a calendar day where `day` is set, in the one format every cell draws it in for this locale; `undefined` for anything that is not a date. A day is drawn in UTC, so a `yyyy-mm-dd` string never reads as the day before west of Greenwich. The time of day is on the 24-hour clock.
 */
export const formatDate = ({ value, locale, day = false }: { value: unknown; locale: string; day?: boolean }): string | undefined => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined
  if (!date || Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(locale || undefined, day ? { dateStyle: 'long', timeZone: 'UTC' } : { dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23' }).format(date)
}

/**
 * A value as an input's text; a missing value is empty. A `Date` is its ISO string, because the fetch plug does not read `String(date)` back as a date. An invalid `Date`, which has no ISO string, is drawn as `String` does.
 */
export const asText = (value: unknown) =>
  value === null || value === undefined ? '' : value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : String(value)

/**
 * A moment as the `yyyy-mm-ddThh:mm` of the reader's own wall clock. It is shifted by the reader's offset before it is sliced, because `toISOString` alone would draw a London evening as the next morning in Riyadh.
 */
export const asMoment = (value: unknown) => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : undefined
  if (!date || Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
