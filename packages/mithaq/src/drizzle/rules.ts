import { isRef } from '../mithaq/user.ts'
import { defaultRules } from '../base/rules.ts'
import type { RuleValue } from '../base/rules.ts'
import type { ColumnRule } from './index.ts'

/** One column rule per rule the columns answer to, in the order they apply, plus `primary` for the `id` field. */
export const rules = {
  primary: ({ column }) => column.primaryKey(),
  required: ({ column, value: on }) => (on ? column.notNull() : column),
  /** Built from the kayan's indexes, where the rule is one unique index, within the tenant on a tenant-owned kayan. */
  unique: ({ column }) => column,
  /** Built on the table, in the third argument of `pgTable`, and read there. */
  index: ({ column }) => column,
  defaultValue: ({ column, value }) => (isRef(value) ? column : column.default(value)),
  // Only a timestamp column carries a database default: Postgres's `now()` in the
  // session's zone would put a day column on another day than Node's clock.
  defaultNow: ({ column, value: on, field }) => {
    if (!on || field.kind !== 'datetime') return column
    if ('defaultNow' in column && typeof column.defaultNow === 'function') return column.defaultNow()
    throw new Error('The drizzle column builder has no defaultNow modifier.')
  },
  nowOnUpdate: ({ column }) => column,
  // Who fills the value does not change the column; the shapes read it.
  providedBy: ({ column }) => column,
  /** Read by the relationship column builder, which puts it on the reference. */
  onDelete: ({ column }) => column,
  // The one rule that decides how many columns a field is; `columnsOfField` reads it.
  localized: ({ column }) => column,
  /** Read by the string column builder, which picks `varchar(n)` over `text`. */
  maxLength: ({ column }) => column,
  /** Read by the decimal column builder, which sizes `numeric(precision, scale)`. */
  precision: ({ column }) => column,
  scale: ({ column }) => column,
  // A check constraint could carry these four; the schema refuses the write first.
  minLength: ({ column }) => column,
  pattern: ({ column }) => column,
  min: ({ column }) => column,
  max: ({ column }) => column,
  // The same for a list's two bounds.
  minRows: ({ column }) => column,
  maxRows: ({ column }) => column,
  // The write hands the column the rewritten value, so no generated column is needed.
  uppercase: ({ column }) => column,
  lowercase: ({ column }) => column,
  trim: ({ column }) => column,
} satisfies { [Name in keyof typeof defaultRules]: ColumnRule<RuleValue<(typeof defaultRules)[Name]>> } & {
  primary: ColumnRule<undefined>
}
