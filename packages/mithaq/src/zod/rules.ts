import { z } from 'zod'
import type { ResolvedField } from '../mithaq/types.ts'
import { defaultRules } from '../base/rules.ts'
import { compareDecimals, decimalDigits } from '../base/decimal.ts'
import type { RuleValue } from '../base/rules.ts'
import type { ZodRule } from './index.ts'
import { errorOf } from './kinds.ts'

// One copy key per field per rule, with no number in it: the browser already
// holds the field's rules for any number it shows.
const keyOf = (field: ResolvedField, rule: string) =>
  field.kayan ? `${field.kayan}.${field.name}.${rule}` : undefined

// `required`, `defaultValue` and `defaultNow` come last: an optional shape is a
// `ZodOptional` with none of the narrowing methods left on it.
export const rules = {
  /** The database enforces it, and only the database can. */
  unique: ({ shape }) => shape,
  /** Nothing about reading rows faster changes what a write must look like. */
  index: ({ shape }) => shape,
  /** A rule about deleting the other row, and a write is not a delete. */
  onDelete: ({ shape }) => shape,
  // Read where the objects are assembled: a field the client does not supply is
  // absent from that shape, so the strict object refuses a caller that sends it.
  providedBy: ({ shape }) => shape,
  minLength: ({ shape, value: length, field }) => (shape as z.ZodString).min(length, { error: keyOf(field, 'minLength') }),
  maxLength: ({ shape, value: length, field }) => (shape as z.ZodString).max(length, { error: keyOf(field, 'maxLength') }),
  pattern: ({ shape, value: expression, field }) =>
    (shape as z.ZodString).regex(expression, { error: keyOf(field, 'pattern') }),
  // Counted as `numeric(precision, scale)` counts, so Postgres never rounds a value or refuses it as a 500.
  precision: ({ shape, value: precision, field }) =>
    shape.refine((held) => {
      const { whole, fraction } = decimalDigits(String(held))
      return whole + fraction <= precision && whole <= precision - Number(field.rules?.scale)
    }, { error: keyOf(field, 'precision') }),
  scale: ({ shape, value: scale, field }) =>
    shape.refine((held) => decimalDigits(String(held)).fraction <= scale, { error: keyOf(field, 'scale') }),
  // `min` on a string shape is a length, so an ISO day gets a check of its own.
  min: ({ shape, value, field }) =>
    typeof value === 'number'
      ? (shape as z.ZodNumber).min(value, { error: keyOf(field, 'min') })
      : shape.refine((held) => (field.kind === 'decimal' ? compareDecimals(String(held), value) >= 0 : String(held) >= value), {
          error: keyOf(field, 'min') ?? `Too small: expected value to be >=${value}`,
        }),
  max: ({ shape, value, field }) =>
    typeof value === 'number'
      ? (shape as z.ZodNumber).max(value, { error: keyOf(field, 'max') })
      : shape.refine((held) => (field.kind === 'decimal' ? compareDecimals(String(held), value) <= 0 : String(held) <= value), {
          error: keyOf(field, 'max') ?? `Too big: expected value to be <=${value}`,
        }),
  // An empty list passes the floor unless the field is `required`.
  minRows: ({ shape, value: rows, field }) =>
    shape.refine((held) => (held as unknown[]).length >= rows || (!field.rules?.required && !(held as unknown[]).length), {
      error: keyOf(field, 'minRows') ?? `Too small: expected array to have >=${rows} items`,
    }),
  maxRows: ({ shape, value: rows, field }) => (shape as z.ZodArray).max(rows, { error: keyOf(field, 'maxRows') }),
  // Piped in front of what the kind and earlier rules built, so `maxLength` and
  // `z.email()` judge the trimmed value; before `localized`, so each locale is trimmed.
  trim: ({ shape, value: on, field }) => (on ? z.string({ error: errorOf(field) }).trim().pipe(shape as z.ZodType<unknown, string>) : shape),
  uppercase: ({ shape, value: on, field }) => (on ? z.string({ error: errorOf(field) }).toUpperCase().pipe(shape as z.ZodType<unknown, string>) : shape),
  lowercase: ({ shape, value: on, field }) => (on ? z.string({ error: errorOf(field) }).toLowerCase().pipe(shape as z.ZodType<unknown, string>) : shape),
  // After every narrowing rule and before `required`: rules apply to each locale's
  // value, and a field nobody wrote is one null rather than an object of them.
  localized: ({ shape, value: on, field }) =>
    on ? z.strictObject(Object.fromEntries(field.locales!.map((locale) => [locale, shape]))) : shape,
  // A required text refuses the empty string too. A required `textArray` may be
  // empty; `minRows: 1` refuses that.
  required: ({ shape, value: on, field }) =>
    field.name === 'id'
      ? shape
      : !on
        ? shape.nullable().optional()
        : field.kind === 'text'
          ? shape.refine((held) => !(field.rules?.localized ? Object.values(held as object) : [held]).includes(''), { error: keyOf(field, 'required') })
          : shape,
  // Optional, not nullable: the runner fills every default on every write that makes or changes a row.
  defaultValue: ({ shape }) => shape.optional(),
  /** The moment the defaults step writes, which leaves the key optional as a literal does. */
  defaultNow: ({ shape, value: on }) => (on ? shape.optional() : shape),
  /** Filled on update by the defaults step, and never client-supplied there, so nothing to shape. */
  nowOnUpdate: ({ shape }) => shape,
} satisfies { [Name in keyof typeof defaultRules]: ZodRule<RuleValue<(typeof defaultRules)[Name]>> }
