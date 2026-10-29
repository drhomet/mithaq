import { sql, type ColumnBuilderBase } from 'drizzle-orm'
import { integer, numeric, text } from 'drizzle-orm/sqlite-core'
import type { ResolvedField } from '../../mithaq/types.ts'
import type { defaultKinds } from '../../base/kinds.ts'

/** Builds one field's SQLite column. `tables` is every table built so far, keyed by kayan name, which a foreign key reads lazily. */
export type SqliteColumnBuilder = (field: ResolvedField, tables: Record<string, unknown>) => ColumnBuilderBase

// A foreign key takes the kind of the id it points at, so the two compare as one type.
const idColumns = { number: (name: string) => integer(name), text, uuid: text }

export const idKinds = Object.keys(idColumns) as (keyof typeof idColumns)[]

// A random version 4 uuid, made by SQLite from its own randomness: the phone's JS has no crypto
// to make one, and Postgres makes the server's in the database too.
const randomUuid = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`

const relationship: SqliteColumnBuilder = (field, tables) =>
  idColumns[field.target!.fields.id!.kind as keyof typeof idColumns](field.column).references(
    () => (tables[field.target!.name] as Record<string, never>).id!,
    {
      onDelete: ['cascade', 'restrict', 'set null'].includes(String(field.rules?.onDelete))
        ? (field.rules?.onDelete as 'cascade' | 'restrict' | 'set null')
        : undefined,
    },
  )

/** One SQLite column builder per kind: the Postgres store's kinds, held in the four types SQLite stores. */
export const kinds = {
  // `numeric`, as Payload's SQLite adapter stores a number field.
  number: (field) => (field.name === 'id' ? integer(field.column).primaryKey({ autoIncrement: true }) : numeric(field.column, { mode: 'number' })),
  integer: (field) => integer(field.column),
  // Text, so no digit passes through a float: SQLite's numeric affinity would read "12.30" as 12.3.
  decimal: (field) => text(field.column),
  // SQLite keeps no length on a column; the schema holds a value to its maximum.
  text: (field) => text(field.column),
  email: (field) => text(field.column),
  checkbox: (field) => integer(field.column, { mode: 'boolean' }),
  textArray: (field) => text(field.column, { mode: 'json' }),
  uuid: (field) => (field.name === 'id' ? text(field.column).default(randomUuid) : text(field.column)),
  // Milliseconds since the epoch, the precision a JS `Date` carries.
  datetime: (field) => integer(field.column, { mode: 'timestamp_ms' }),
  // The ISO day as text, so the day stays a day in every zone.
  date: (field) => text(field.column),
  // Unreachable through the store, which builds no column for a join.
  join: (field) => {
    throw new Error(
      `Field "${field.name}" is a join, whose rows are held by kayan "${field.target?.name}", so this store builds no column for it.`,
    )
  },
  // JSON text, as Payload's SQLite adapter stores a json field.
  json: (field) => text(field.column, { mode: 'json' }),
  relationship,
} satisfies Record<keyof typeof defaultKinds, SqliteColumnBuilder>
