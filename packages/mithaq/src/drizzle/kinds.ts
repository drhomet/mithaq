import { boolean, date, integer, jsonb, numeric, serial, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { ResolvedField } from '../mithaq/types.ts'
import { defaultKinds } from '../base/kinds.ts'
import type { ColumnBuilder } from './index.ts'

/** Length is a rule, not a kind: without a maximum a string column is `text`. */
const string = (field: ResolvedField) =>
  typeof field.rules?.maxLength !== 'number'
    ? text(field.column)
    : varchar(field.column, { length: field.rules.maxLength })

// A foreign key takes the type of the id it points at: Postgres refuses a
// `text` column referencing a `uuid` key. The keys are the kinds an id may be.
const idColumns = { number: integer, text, uuid }

export const idKinds = Object.keys(idColumns) as (keyof typeof idColumns)[]

const idColumn = (field: ResolvedField) =>
  idColumns[field.target!.fields.id!.kind as keyof typeof idColumns](field.column)

const relationship: ColumnBuilder = (field, tables) =>
  idColumn(field).references(
    () => tables[field.target!.name]!.id as never,
    {
      onDelete: ['cascade', 'restrict', 'set null'].includes(String(field.rules?.onDelete))
        ? (field.rules?.onDelete as 'cascade' | 'restrict' | 'set null')
        : undefined,
    },
  )

/** One column builder per kind. */
export const kinds = {
  number: (field) =>
    field.name === 'id' ? serial(field.column) : numeric(field.column, { mode: 'number' }),
  integer: (field) => integer(field.column),
  // drizzle's default string mode, so no digit passes through a JS number.
  decimal: (field) =>
    typeof field.rules?.precision === 'number'
      ? numeric(field.column, { precision: field.rules.precision, scale: field.rules.scale as number })
      : numeric(field.column),
  text: string,
  email: string,
  checkbox: (field) => boolean(field.column),
  // Length is not a rule this kind binds, so it is never `varchar(n)[]`.
  textArray: (field) => text(field.column).array(),
  // Only the primary key gets a random default: any other uuid column holds an
  // identifier something else chose.
  uuid: (field) => (field.name === 'id' ? uuid(field.column).defaultRandom() : uuid(field.column)),
  datetime: (field) => timestamp(field.column, { precision: 3, withTimezone: true, mode: 'date' }),
  // `mode: 'string'` keeps the day a day: `'date'` mode hands back a `Date` at
  // local midnight, which another zone reads as the day before.
  date: (field) => date(field.column, { mode: 'string' }),
  // Unreachable: `columnsOfField` answers a join with no column before any builder runs.
  join: (field) => {
    throw new Error(
      `Field "${field.name}" is a join, whose rows are held by kayan "${field.target?.name}", so this store builds no column for it.`,
    )
  },
  // `jsonb`, as Payload's Postgres adapter stores a json field, so either reads what the other wrote.
  json: (field) => jsonb(field.column),
  relationship,
} satisfies Record<keyof typeof defaultKinds, ColumnBuilder>
