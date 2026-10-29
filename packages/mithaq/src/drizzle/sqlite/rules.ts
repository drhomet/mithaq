import { sql, type ColumnBuilderBase } from 'drizzle-orm'
import { isRef } from '../../mithaq/user.ts'
import type { defaultRules, RuleValue } from '../../base/rules.ts'
import type { ResolvedField } from '../../mithaq/types.ts'

// drizzle's builders are each their own type, so a rule reaches the modifiers through a structural type.
export type SqliteModifiable = ColumnBuilderBase & {
  default(value: unknown): SqliteModifiable
  notNull(): SqliteModifiable
  primaryKey(): SqliteModifiable
  unique(): SqliteModifiable
}

export type SqliteColumnRule<Value = never> = (args: { column: SqliteModifiable; value: Value; field: ResolvedField }) => SqliteModifiable

/** One SQLite column rule per rule the columns answer to, the Postgres store's own, plus `primary` for the `id` field. */
export const rules = {
  primary: ({ column }) => column.primaryKey(),
  required: ({ column, value: on }) => (on ? column.notNull() : column),
  /** Built from the kayan's indexes, as on Postgres. A device kayan places no tenant field, so each is over its own fields. */
  unique: ({ column }) => column,
  /** Built on the table, in the third argument of `sqliteTable`, and read there. */
  index: ({ column }) => column,
  defaultValue: ({ column, value }) => (isRef(value) ? column : column.default(value)),
  // Only a timestamp column carries a database default, as on Postgres: the moment in
  // milliseconds, which `unixepoch('subsec')` answers from SQLite 3.42 on.
  defaultNow: ({ column, value: on, field }) =>
    on && field.kind === 'datetime' ? column.default(sql`(cast(unixepoch('subsec') * 1000 as integer))`) : column,
  nowOnUpdate: ({ column }) => column,
  providedBy: ({ column }) => column,
  /** Read by the relationship column builder, which puts it on the reference. */
  onDelete: ({ column }) => column,
  localized: ({ column }) => column,
  // A schema holds these; a SQLite column carries none of them.
  maxLength: ({ column }) => column,
  precision: ({ column }) => column,
  scale: ({ column }) => column,
  minLength: ({ column }) => column,
  pattern: ({ column }) => column,
  min: ({ column }) => column,
  max: ({ column }) => column,
  minRows: ({ column }) => column,
  maxRows: ({ column }) => column,
  uppercase: ({ column }) => column,
  lowercase: ({ column }) => column,
  trim: ({ column }) => column,
} satisfies { [Name in keyof typeof defaultRules]: SqliteColumnRule<RuleValue<(typeof defaultRules)[Name]>> } & {
  primary: SqliteColumnRule<undefined>
}
