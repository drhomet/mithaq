import { jobTable } from './job-table.ts'
import { and, asc, count as sqlCount, sum as sqlSum, desc, eq, getTableColumns, getTableName, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import {
  boolean as pgBoolean,
  index,
  integer as pgInteger,
  isPgEnum,
  jsonb,
  timestamp,
  uuid as pgUuid,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  unique as uniqueConstraint,
  uniqueIndex,
  type AnyPgColumnBuilder,
  type PgBooleanBuilder,
  type PgBuildColumns,
  type PgEnum,
  type PgDateStringBuilder,
  type PgIntegerBuilder,
  type PgJsonbBuilder,
  type PgNumericBuilder,
  type PgNumericNumberBuilder,
  type PgSchema,
  type PgSerialBuilder,
  type PgTable,
  type PgTableWithColumns,
  type PgTextBuilder,
  type PgTimestampBuilder,
  type PgUUIDBuilder,
  type PgVarcharBuilder,
  type SetDimensions,
  type SetHasDefault,
  type SetNotNull,
} from 'drizzle-orm/pg-core'
import { isPlainIdentifier, snakeCase, uniqueRuleIndexes, versionsTableOf } from '../mithaq/resolve.ts'
import type { CompoundIndex, ResolvedField, ResolvedKayan, RuntimeField } from '../mithaq/types.ts'
import type { Store } from '../mithaq/language.ts'
import { implementationOf } from '../mithaq/rukn.ts'
import type { Operator, Where } from '../mithaq/where.ts'
import { conflict, invalid, missing, localizedQuery } from '../asas/runner/errors.ts'
import { Refusal } from '../mithaq/refusal.ts'
import { providerOf } from '../base/rules.ts'
import { kinds as drizzleKinds } from './kinds.ts'
import { rules as drizzleRules } from './rules.ts'

type Database = NodePgDatabase
export type Tables = Record<string, ReturnType<typeof pgTable>>
// `null` under `public`, which `pgSchema` refuses to build.
export type Schemas = Record<string, PgSchema | null>
/** Every enum a built column uses, keyed `<schema>.<name>`. */
export type Enums = Record<string, PgEnum<[string, ...string[]]>>

type Registry = readonly { name: string; fields: Record<string, RuntimeField> }[]
type Related<F, List extends Registry> = F extends { relationTo: infer Relation }
  ? Relation extends string
    ? Extract<List[number], { name: Relation }>
    : Relation extends () => { name: infer Name }
      ? Extract<List[number], { name: Name }>
      : never
  : never
type OwnBuilder<F, Kinds> = F extends { kind: infer Kind extends keyof Kinds }
  ? Kinds[Kind] extends { readonly targets: { readonly drizzle: (...args: never[]) => infer Own extends AnyPgColumnBuilder } }
    ? Own
    : never
  : never
// The order `implementationOf` reads at run time. A field that points at a row is
// typed by the id it points at first: a kind's own builder cannot name that kayan.
type BaseBuilder<F, List extends Registry, Name, Store extends PropertyKey, Kinds> = F extends { targets: Record<Store, infer Override extends AnyPgColumnBuilder> }
  ? Override
  : F extends { relationTo: unknown }
    ? ReferenceBuilder<F, List>
    : [OwnBuilder<F, Kinds>] extends [never]
      ? ShippedBuilder<F, List, Name>
      : OwnBuilder<F, Kinds>
/** A foreign key takes the type of the id it points at. */
type ReferenceBuilder<F, List extends Registry> = Related<F, List> extends { fields: { id: { kind: 'number' } } }
  ? PgIntegerBuilder
  : Related<F, List> extends { fields: { id: { kind: 'uuid' } } }
    ? PgUUIDBuilder
    : PgTextBuilder
type ShippedBuilder<F, List extends Registry, Name> = F extends { kind: 'number' }
    ? Name extends 'id'
      ? PgSerialBuilder
      : PgNumericNumberBuilder
    : F extends { kind: 'integer' } ? PgIntegerBuilder
    : F extends { kind: 'decimal' } ? PgNumericBuilder
    : F extends { kind: 'uuid' }
      ? PgUUIDBuilder
      : F extends { kind: 'checkbox' }
        ? PgBooleanBuilder
        : F extends { kind: 'textArray' }
          ? SetDimensions<PgTextBuilder, 1>
          : F extends { kind: 'datetime' }
            ? PgTimestampBuilder
            : F extends { kind: 'date' }
              ? PgDateStringBuilder
              : F extends { kind: 'json' }
              ? PgJsonbBuilder
              : F extends { rules: { maxLength: number } }
                ? PgVarcharBuilder
                : PgTextBuilder
type DefaultedBuilder<B extends AnyPgColumnBuilder, F, Name> = Name extends 'id'
  ? SetHasDefault<B>
  : F extends { rules: { defaultValue: unknown } } | { rules: { defaultNow: true } }
    ? SetHasDefault<B>
    : B
type PreparedBuilder<B extends AnyPgColumnBuilder, F, Name> = B extends AnyPgColumnBuilder
  ? F extends { rules: { required: true } }
    ? SetNotNull<DefaultedBuilder<B, F, Name>>
    : DefaultedBuilder<B, F, Name>
  : never
type NameOf<K> = K extends { name: infer Name extends string } ? Name : string
// An absent `dbName` infers as `string`, which reads as no literal name.
type TableName<K> = K extends { dbName?: infer Name extends string }
  ? string extends Name
    ? NameOf<K>
    : Name
  : NameOf<K>
// A join-table field is no column of this table, as `columnsOfField` leaves it out.
type Builders<K, List extends Registry, Store extends PropertyKey, Kinds> = K extends { fields: infer Fields extends Record<string, RuntimeField> }
  ? {
      [Name in keyof Fields as Fields[Name] extends { hasMany: true } | { kind: 'join' } ? never : Name]: PreparedBuilder<
        BaseBuilder<Fields[Name], List, Name, Store, Kinds>,
        Fields[Name],
        Name
      >
    }
  : never

// `snakeCase` as a type. A character is a capital where lowering it changes it,
// which leaves digits and underscores alone.
type SnakeRest<S extends string> = S extends `${infer Head}${infer Rest}`
  ? Lowercase<Head> extends Head
    ? `${Head}${SnakeRest<Rest>}`
    : `_${Lowercase<Head>}${SnakeRest<Rest>}`
  : ''
type SnakeCase<S extends string> = S extends `${infer Head}${infer Rest}` ? `${Lowercase<Head>}${SnakeRest<Rest>}` : S

/** The join table names one kayan's `hasMany` fields ask for, as `joinTableOf` builds them. */
type JoinNames<K> = K extends { fields: infer Fields }
  ? {
      [Name in keyof Fields]: Fields[Name] extends { hasMany: true }
        ? `${TableName<K>}_${SnakeCase<Name & string>}`
        : never
    }[keyof Fields]
  : never

// Optional on every kayan: the type `defineKayan` returns cannot say which one keeps versions.
type VersionsName<K> = `_${TableName<K>}_versions`

type StoreKayan<K, StoreName extends PropertyKey, DefaultStore extends PropertyKey> = K extends { targets: { service: { store: infer Named } } }
  ? Named extends StoreName
    ? K
    : never
  : DefaultStore extends StoreName
    ? K
    : never
type TableFor<K, List extends Registry, Store extends PropertyKey, Kinds> = K extends { targets: Record<Store, infer Override> }
  ? Override
  : PgTableWithColumns<{
      name: TableName<K>
      schema: undefined
      columns: PgBuildColumns<TableName<K>, Builders<K, List, Store, Kinds>>
      dialect: 'pg'
    }>

/** Concrete tables built for one store, keyed by registered kayan names. */
export type BuiltTables<
  List extends Registry,
  StoreName extends PropertyKey,
  DefaultStore extends PropertyKey,
  Kinds = {},
> = {
  [K in StoreKayan<List[number], StoreName, DefaultStore> as K['name']]: TableFor<K, List, StoreName, Kinds>
} & {
  // A join table is a value of this record at run time, and both the push and
  // `mithaq migrate` read every value of it.
  [K in StoreKayan<List[number], StoreName, DefaultStore> as JoinNames<K>]: ReturnType<typeof pgTable>
} & {
  // And one per kayan that keeps versions, for the same reason.
  [K in StoreKayan<List[number], StoreName, DefaultStore> as VersionsName<K>]?: ReturnType<typeof pgTable>
} & { mithaq_jobs?: ReturnType<typeof jobTable> }

/** Builds one field's column. `tables` is every table built so far, keyed by kayan name, which a foreign key reads lazily. */
export type ColumnBuilder = (field: ResolvedField, tables: Tables) => AnyPgColumnBuilder

// drizzle's builders are each their own type, so a rule reaches the modifiers through a structural type.
type Modifiable = AnyPgColumnBuilder & {
  default(value: unknown): Modifiable
  notNull(): Modifiable
  primaryKey(): Modifiable
  unique(): Modifiable
}

const modifiable = (column: AnyPgColumnBuilder): Modifiable => {
  for (const method of ['default', 'notNull', 'primaryKey', 'unique'] as const) {
    if (typeof Reflect.get(column, method) !== 'function') {
      throw new Error(`The drizzle column builder has no ${method} modifier.`)
    }
  }
  return column as Modifiable
}

// A localized field is one column per locale, `<column>_<locale>`, each the same field
// renamed, so every builder and rule runs per locale. An override is its one column.
const columnsOfField = (store: string) => (field: ResolvedField): ResolvedField[] =>
  // A `hasMany` field's set lives in its join table, and a `join` field's id is the child's column.
  field.hasMany || field.kind === 'join'
    ? []
    : !field.rules?.localized || field.targets?.[store]
    ? [field]
    : field.locales!.map((locale) => ({
        ...field,
        name: `${field.name}_${locale}`,
        column: `${field.column}_${locale}`,
      }))

// One table per `hasMany` field, `courses_tags`, the same string as its SQL name and
// its key on `tables`, so the push and `mithaq migrate` reach it unchanged.
export const joinTableOf = (kayan: ResolvedKayan, field: ResolvedField) => `${kayan.table}_${snakeCase(field.name)}`

/** The fields of one kayan the store holds as a join table rather than a column. */
export const manyFields = (kayan: ResolvedKayan | undefined) =>
  Object.values(kayan?.fields ?? {}).filter((field) => field.hasMany)

// Read off the global symbol drizzle keeps it under, so an override that is no
// table answers `public` and is refused by name rather than as a `TypeError`.
export const schemaOf = (table: unknown) =>
  (table as Record<symbol, string | undefined> | null | undefined)?.[Symbol.for('drizzle:Schema')] ?? 'public'

// A lowercase plain identifier needs no quoting anywhere and names the schema module's
// export. Postgres keeps `pg_*` and `information_schema`; mithaq's history is in `drizzle`.
const refusedSchema = (name: unknown) =>
  typeof name !== 'string' || !isPlainIdentifier(name) || name !== name.toLowerCase()
    ? 'which is not a lowercase SQL identifier: lowercase letters, digits and underscores, not starting with a digit, at most 63 bytes.'
    : name.startsWith('pg_') || name === 'information_schema'
      ? 'which Postgres keeps for itself.'
      : name === migrationsTable.schema
        ? 'where mithaq keeps its migration history.'
        : undefined

// A plain `Error`: what reaches here is a `where` an access callback returned, the
// project's own bug; the read layer refuses a caller's first.
const refuseLocalized = (kayan: string, field: string, what: 'filter' | 'sort', locales?: readonly string[]) =>
  new Error(localizedQuery({ kayan, field, what, locales }))

// Postgres answers `23503`, or from 18 on `23001` for an `ON DELETE RESTRICT` key, refused as a
// conflict naming which kayan points at the row, never which row. Read by schema too: another
// tool may share a table name.
const pointedAt = new Set(['23503', '23001'])
const referenced = ({ thrown, name, kayans, tables }: { thrown: unknown; name: string; kayans: Map<string, ResolvedKayan>; tables: Tables }) => {
  const held = thrown as { code?: unknown; table?: unknown; schema?: unknown; cause?: { code?: unknown; table?: unknown; schema?: unknown } } | null
  const error = pointedAt.has(held?.code as string) ? held : pointedAt.has(held?.cause?.code as string) ? held!.cause : undefined
  if (!error) return thrown
  // A kayan's join tables are built in its own table's schema.
  const by = [...kayans].find(([key, kayan]) =>
    schemaOf(tables[key]!) === error.schema &&
    (kayan.table === error.table || manyFields(kayan).some((field) => joinTableOf(kayan, field) === error.table)))?.[1].name
  return conflict({ message: `A "${name}" row is still pointed at by another row, so it is not deleted.`, key: 'error.conflict.referenced', params: { kayan: name, ...(by && { by }) }, cause: thrown })
}

// Read by SQLSTATE `23505` on the driver error's cause, not by its locale-dependent
// message; every other failure is rethrown as it was.
// The cause's `detail` names the collided value, so it must never be serialized.
const collision = (thrown: unknown, name: string) => {
  const held = thrown as { code?: unknown; cause?: { code?: unknown } } | null
  if (held?.code !== '23505' && held?.cause?.code !== '23505') return thrown
  return conflict({
    message: `A "${name}" row already holds one of the unique values this write carries.`,
    key: 'error.conflict.unique',
    params: { kayan: name },
    cause: thrown,
  })
}

// Every `text` member of Lexical's tree as one JSON array, so a search runs over what
// a reader sees, never a key or a node type.
const textOf = (column: SQLWrapper): SQL => sql`jsonb_path_query_array(${column}, 'strict $.**.text')::text`

const pattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`

const splitNulls = (value: unknown) => {
  const values = value as unknown[]
  return { hasNull: values.some((one) => one === null), values: values.filter((one) => one !== null) }
}

// The column is the caller's: this table's, or a join table's for a `hasMany` field.
const conditionsOf = (column: SQLWrapper, rules: Record<string, unknown>): SQL | undefined => {
  const checks = (Object.entries(rules as Record<string, unknown>) as [Operator, unknown][]).map(([operator, value]): SQL | undefined => {
    switch (operator) {
      case 'contains':
        return ilike(column, pattern(String(value)))
      case 'like':
        return and(...String(value).trim().split(/\s+/).filter(Boolean).map((word) => ilike(column, pattern(word))))
      case 'equals':
        return value === null ? isNull(column) : eq(column, value)
      case 'exists':
        return value ? isNotNull(column) : isNull(column)
      case 'greater_than':
        return gt(column, value)
      case 'greater_than_equal':
        return gte(column, value)
      case 'in': {
        const split = splitNulls(value)
        const nonNull = split.values.length ? inArray(column, split.values) : sql`false`
        return split.hasNull ? or(isNull(column), nonNull) : nonNull
      }
      case 'less_than':
        return lt(column, value)
      case 'less_than_equal':
        return lte(column, value)
      case 'not_equals':
        return value === null ? isNotNull(column) : ne(column, value)
      case 'not_in': {
        const split = splitNulls(value)
        const nonNull = split.values.length ? notInArray(column, split.values) : sql`true`
        return split.hasNull ? and(isNotNull(column), nonNull) : nonNull
      }
    }
    // Unreachable, but a value past both checks would otherwise be left out of a `where`,
    // which carries an access constraint.
    throw new Error(`Unsupported where operator "${operator satisfies never}".`)
  })
  return checks.length === 1 ? checks[0] : and(...checks)
}

// Payload's own path, `$[*].a[*].b[*]`: a list at any segment, a list inside a list included, is
// matched by any of its entries. The path and every value are bound parameters, and each key a
// quoted jsonpath string, so nothing a caller wrote is read as SQL or jsonpath.
const jsonConditionsOf = (column: SQLWrapper, path: readonly string[], rules: Record<string, unknown>): SQL | undefined => {
  const at = `$[*]${path.map((key) => `.${JSON.stringify(key)}[*]`).join('')}`
  const some = (test: SQL) => sql`exists (select 1 from jsonb_path_query(${column}, ${at}::jsonpath) as item(value) where ${test})`
  // A JSON `null` is no value, as a SQL `NULL` is: `exists` and `equals: null` read both alike.
  const present = some(sql`item.value <> 'null'::jsonb`)
  const text = sql`(item.value #>> '{}')`
  const equal = (value: unknown) => (value === null ? sql`not ${present}` : some(sql`item.value = ${JSON.stringify(value)}::jsonb`))
  // One subquery for the whole list, against a hashed set: one per value, or `= any(array)`, compares
  // every item with every value, which took seconds for a thousand values over 20,000 rows.
  const listed = (value: unknown) => {
    const { hasNull, values } = splitNulls(value)
    const hit = values.length ? some(sql`item.value in (select unnest(${sql.param(values.map((one) => JSON.stringify(one)))}::jsonb[]))`) : sql`false`
    return hasNull ? or(sql`not ${present}`, hit)! : hit
  }
  const checks = Object.entries(rules).map(([operator, value]): SQL | undefined => {
    switch (operator as Operator) {
      case 'contains':
        return some(ilike(text, pattern(String(value))))
      case 'like': {
        const words = String(value).trim().split(/\s+/).filter(Boolean)
        return words.length ? some(and(...words.map((word) => ilike(text, pattern(word))))!) : undefined
      }
      case 'equals':
        return equal(value)
      case 'not_equals':
        return value === null ? present : and(present, sql`not ${equal(value)}`)
      case 'exists':
        return value ? present : sql`not ${present}`
      case 'in':
        return listed(value)
      case 'not_in':
        return and(present, sql`not ${listed(value)}`)
    }
    // Unreachable past the kind's operators, but never left out of a `where` that carries an access constraint.
    throw new Error(`Unsupported where operator "${operator}" on a json field.`)
  })
  return checks.length === 1 ? checks[0] : and(...checks)
}

const whereOf = (
  db: Database,
  tables: Tables,
  kayanByName: Map<string, ResolvedKayan>,
  name: string,
  where: Where,
): SQL | undefined => {
  const table = tables[name]!
  const kayan = kayanByName.get(name)!
  const parts: (SQL | undefined)[] = []
  const conjunction = (where as { and?: Where[] }).and
  if (Array.isArray(conjunction)) parts.push(and(...conjunction.map((one) => whereOf(db, tables, kayanByName, name, one))))
  const disjunction = (where as { or?: Where[] }).or
  // An empty OR matches nothing; drizzle's `or()` of nothing would apply no constraint. A branch that compiles to nothing is still dropped.
  if (Array.isArray(disjunction)) parts.push(disjunction.length ? or(...disjunction.map((one) => whereOf(db, tables, kayanByName, name, one))) : sql`false`)
  for (const [field, rules] of Object.entries(where)) {
    if (field === 'and' || field === 'or') continue
    const [ownField, ...path] = field.split('.')
    const relatedField = path[0]
    const relationField = kayan.fields[ownField!]
    if (relationField?.kind === 'json') {
      parts.push(jsonConditionsOf(table[ownField!]!, path, rules as Record<string, unknown>))
      continue
    }
    // Whether a versions table's snapshot holds an id in one field, alone or in a set: the delete's
    // reference check asks it, and a caller's read of versions refuses every path before here.
    // Lowered, since a draft keeps a uuid as its writer sent it.
    if (!relationField && ownField === 'version' && relatedField && table.version) {
      const { equals, ...other } = rules as { equals?: unknown }
      if (equals === undefined || Object.keys(other).length) throw new Error(`Kayan "${name}" path "${field}" takes equals alone.`)
      parts.push(sql`lower((${table.version} -> ${relatedField})::text)::jsonb @> ${JSON.stringify(typeof equals === 'string' ? equals.toLowerCase() : equals)}::jsonb`)
      continue
    }
    // A `hasMany` field has no column here, so the join table is filtered and its
    // parent ids filter this table.
    if (relationField?.hasMany) {
      const join = tables[joinTableOf(kayan, relationField)]!
      const target = tables[relationField.target!.name]!
      const column: SQLWrapper = relatedField ? target[relatedField]! : join.target!
      const own = conditionsOf(column, rules as Record<string, unknown>)
      const parents = relatedField
        ? db.select({ id: join.parent! }).from(join).where(
            inArray(join.target! as SQLWrapper, db.select({ id: target.id! }).from(target).where(own)),
          )
        : db.select({ id: join.parent! }).from(join).where(own)
      parts.push(inArray(table.id! as SQLWrapper, parents))
      continue
    }
    // A locale named as the second segment is one column of this same table.
    const locale = relatedField && relationField?.locales?.includes(relatedField) && !relationField.targets?.[kayan.store]
      ? `${ownField}_${relatedField}`
      : undefined
    const hop = locale ? undefined : relatedField
    const relationTo = relationField?.relationTo
    const relationName = relationField?.target?.name ?? (typeof relationTo === 'function' ? relationTo().name : relationTo)
    // A localized field named alone is several columns, and nothing here may pick a locale.
    // Asked of the field the path lands on, which across a hop is the related kayan's.
    const named = hop ? (relationField?.target ? relationField.target.fields[hop] : relationField) : relationField
    if (!locale && named?.rules?.localized) {
      throw refuseLocalized(hop && relationField?.target ? relationName as string : name, named.name, 'filter', named.locales)
    }
    // Only a direct store call or a language's own `authorize` reaches here; the
    // lookup below would otherwise index `tables[undefined]`.
    if (hop && !relationField?.target) {
      throw new Error(
        `Kayan "${name}" field "${ownField}" names no relationship, so the path "${field}" reaches no second table.`,
      )
    }
    // Typed as drizzle's comparison operators take, so `eq` resolves its untyped overload.
    const column: SQLWrapper = hop ? tables[relationName as string]![hop]! : table[locale ?? field]!
    const own = conditionsOf(named?.kind === 'richText' ? textOf(column) : column, rules as Record<string, unknown>)
    if (!hop) {
      parts.push(own)
      continue
    }
    const target = tables[relationName as string]!
    const ids = db.select({ id: target.id! }).from(target).where(own)
    parts.push(inArray(table[ownField!]! as SQLWrapper, ids))
  }
  return parts.length === 1 ? parts[0] : and(...parts)
}

const idWhere = (
  db: Database,
  tables: Tables,
  kayanByName: Map<string, ResolvedKayan>,
  name: string,
  id: unknown,
  where?: Where,
) => {
  const table = tables[name]!
  const byId = eq(table.id! as SQLWrapper, id)
  return where ? and(byId, whereOf(db, tables, kayanByName, name, where)) : byId
}


export type ColumnRule<Value = never> = (args: { column: Modifiable; value: Value; field: ResolvedField }) => Modifiable

/** The drizzle store: a store, plus the drizzle instance and the tables it built, read off `asas.targets.drizzle`. */
export type Adapter = Omit<Store, 'kinds' | 'rules'> & {
  kinds: Record<string, ColumnBuilder>
  rules: Record<string, ColumnRule>
  readonly type: 'drizzle'
  /** Declared, never sniffed: what says the two members below are drizzle's. */
  readonly sql: 'drizzle'
  db: Database
  tables: Tables
  /** Every schema the built tables are in. The push hands them to drizzle-kit, which writes no `CREATE SCHEMA` otherwise. */
  schemas: Schemas
  /** Every enum a built column uses, keyed `<schema>.<name>`. drizzle-kit writes no `CREATE TYPE` for one it is not handed. */
  enums: Enums
  /** The string this adapter made its instance from, which `mithaq migrate` writes into the drizzle-kit config. */
  readonly connectionString?: string
}

// A name no migration folder can carry: drizzle matches a folder to a history row by
// `name` alone. It refuses the first migration against a database only ever pushed.
export const devPushMarker = 'mithaq_dev_push'

// A table of mithaq's own, so a default history table holding another tool's rows is
// never read as this project's.
export const migrationsTable = { schema: 'drizzle', table: '__mithaq_migrations' } as const

// drizzle-kit filters tables by name across every schema in its filter, so a push would
// drop another tool's table sharing a name with ours, rows and all. Refused by name first.
export const refuseStrangers = async ({ db, tables, by }: {
  db: { execute(query: SQL): Promise<{ rows: unknown[] }> }
  tables: Tables
  /** What would drop the stranger, which the sentence names. */
  by: 'push' | 'baseline'
}) => {
  const built = Object.values(tables)
  if (!built.length) return
  const own = new Set(built.map((table) => `${schemaOf(table)}.${getTableName(table)}`))
  const listed = (values: Iterable<string>) => sql.join([...new Set(values)].map((value) => sql`${value}`), sql`, `)
  const { rows } = await db.execute(sql`select nspname, relname from pg_catalog.pg_class
    join pg_catalog.pg_namespace on pg_namespace.oid = relnamespace
    where relkind in ('r', 'p', 'v', 'm')
      and nspname in (${listed(built.map(schemaOf))})
      and relname in (${listed(built.map((table) => getTableName(table)))})`)
  const found = (rows as { nspname: string; relname: string }[]).map((row) => `${row.nspname}.${row.relname}`).filter((pair) => !own.has(pair)).sort()
  if (!found.length) return
  const one = found.length === 1
  throw new Refusal(
    `${found.join(', ')} ${one ? 'is not a table' : 'are not tables'} of this language, and drizzle-kit filters tables by name across the schemas this language uses, so ${by === 'push' ? 'this push' : 'the first migration after this baseline'} would drop ${one ? 'it' : 'them'}. Rename the kayan's table, or move the other ${one ? 'table' : 'tables'}. Where ${one ? 'it is' : 'one is'} this language's own table from before a kayan's schemaName changed, run \`mithaq migrate\`, which asks whether that is a move; on a development database, drop its tables instead, or move the table by hand with \`ALTER TABLE … SET SCHEMA\`. Nothing was written.`,
  )
}

const enumsOf = (tables: Tables) => {
  const enums: Enums = Object.create(null)
  for (const table of Object.values(tables)) {
    for (const { enum: used } of Object.values(getTableColumns(table)) as { enum?: unknown }[]) {
      if (isPgEnum(used)) enums[`${used.schema ?? 'public'}.${used.enumName}`] = used as Enums[string]
    }
  }
  return enums
}

// Each schema and every enum already in those schemas is handed over: drizzle-kit
// otherwise plans a `DROP` for what it is not handed, or throws asking about a rename.
export const pushInput = ({ tables, schemas, held = [] }: { tables: Tables; schemas: Schemas; held?: { schema: string; name: string; labels: string[]; owned: boolean }[] }) => {
  const enums = new Map<string, unknown>(held.map(({ schema, name, labels }) => [`${schema}.${name}`, schema === 'public' ? pgEnum(name, labels as [string, ...string[]]) : schemas[schema]!.enum(name, labels as [string, ...string[]])]))
  for (const [key, used] of Object.entries(enumsOf(tables))) {
    const schema = used.schema ?? 'public'
    if (!(schema in schemas)) throw new Error(`A column uses the enum "${key}", in a schema no kayan is built in, so the push could not tell on its second run that it exists. Build the enum in the schemaName of a kayan.`)
    const other = held.find((one) => one.schema === schema && one.name === used.enumName)
    if (other && !other.owned && other.labels.join() !== used.enumValues.join()) {
      throw new Error(`The enum "${schema}"."${used.enumName}" is already in the database with the labels ${other.labels.join(', ')}, and no table of this language uses it, so it is another tool's. Giving it the labels ${used.enumValues.join(', ')} would alter it. Give the column's enum another name or, if it is this language's own, left behind by a dropped table, drop the type with DROP TYPE "${schema}"."${used.enumName}".`)
    }
    enums.set(key, used)
  }
  return {
    imports: {
      ...tables,
      ...Object.fromEntries(Object.entries(schemas).flatMap(([name, schema]) => (schema ? [[`${name}Schema`, schema]] : []))),
      ...Object.fromEntries([...enums].map(([key, one]) => [`${key}Enum`, one])),
    } as Record<string, unknown>,
    filter: {
      schemas: Object.keys(schemas),
      tables: Object.values(tables).map((table) => getTableName(table)),
      entities: undefined,
      extensions: [],
    },
  }
}

/** The history table as SQL, for the statements that read and write it. */
export const historyTable = sql`${sql.identifier(migrationsTable.schema)}.${sql.identifier(migrationsTable.table)}`

/**
 * The one lock every writer of the history takes, a production boot running drizzle's migrator
 * and a connect making the table, since both create the `drizzle` schema. Keyed as a boot has
 * always keyed it, so an instance of an older release booting beside this one still waits.
 */
export const historyLock = sql`select pg_advisory_xact_lock(hashtext(${`${migrationsTable.schema}.${migrationsTable.table}`}))`

type HistoryDb = {
  execute(query: SQL): Promise<unknown>
  transaction<T>(run: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>): Promise<T>
}

// Under an advisory lock, because two connects against a fresh database both pass `if not exists`
// and the loser fails on Postgres's unique index over schema names. The DDL is drizzle's own,
// because mithaq writes into the table before drizzle does; any other shape would make the next
// `drizzle-kit migrate` refuse every row.
export const createHistory = (db: HistoryDb) =>
  db.transaction(async (tx) => {
    await tx.execute(historyLock)
    await tx.execute(sql`create schema if not exists ${sql.identifier(migrationsTable.schema)}`)
    await tx.execute(sql`create table if not exists ${historyTable} (
      id serial primary key,
      hash text not null,
      created_at bigint,
      name text,
      applied_at timestamp with time zone default now()
    )`)
  })

// One statement, so a run killed between a delete and an insert cannot leave the table
// with neither: a data-modifying `with` runs once and to completion.
export const recordMigration = async ({ db, hash, createdAt, name }: {
  db: HistoryDb
  hash: string
  createdAt: number
  name: string
}) => {
  await createHistory(db)
  await db.execute(sql`with gone as (delete from ${historyTable} where name = ${devPushMarker})
    insert into ${historyTable} (hash, created_at, name) values (${hash}, ${createdAt}, ${name})`)
}

type DrizzleAdapterArguments<Kinds, Rules> = {
  /** A ready drizzle instance, so the pool, logger and options are the developer's. */
  db?: Database
  /** Or a connection string, and the adapter makes the instance. */
  connectionString?: string
  kinds: Kinds
  rules: Rules
  /** The kinds this store builds an id of; `drizzleIdKinds`, unless you replace the kinds map and its relationship builder. */
  idKinds: readonly string[]
  /** Push the schema on connect instead of running migrations. */
  push?: boolean
  /**
   * What a production `connect()` does with migrations this database has not applied: `run` applies them
   * in one transaction before serving, `refuse` refuses to start. Without it a production connect refuses.
   */
  prodMigrations?: ProdMigrations
}

/** Where a production connect finds the migrations folder, and what it does with pending ones. */
export type ProdMigrations = {
  /** The folder of migration folders, as drizzle's own migrator takes it: relative to the working directory, or absolute. */
  migrationsFolder: string
  pending: 'run' | 'refuse'
}

export const drizzleAdapter = <
  const Kinds extends Record<string, ColumnBuilder>,
  const Rules extends Record<string, ColumnRule>,
>({
  db: ready,
  connectionString,
  kinds,
  rules,
  idKinds,
  push: named,
  prodMigrations,
}: DrizzleAdapterArguments<Kinds, Rules>): Omit<Adapter, 'kinds' | 'rules'> & { kinds: Kinds; rules: Rules } => {
  if (prodMigrations && prodMigrations.pending !== 'run' && prodMigrations.pending !== 'refuse') {
    throw new Error(`drizzleAdapter's prodMigrations.pending is 'run' or 'refuse', not ${JSON.stringify(prodMigrations.pending)}.`)
  }
  // `prodMigrations` is read only where the push is off, so beside `push: true` it would be unread.
  if (named === true && prodMigrations) {
    throw new Error("drizzleAdapter takes `push: true` or `prodMigrations`, never both: a production connect() reads prodMigrations only with the push off. Leave `push` out, which pushes outside production alone.")
  }
  const push = named ?? process.env.NODE_ENV !== 'production'
  if (ready && connectionString) {
    throw new Error('drizzleAdapter takes a `db` or a `connectionString`, never both.')
  }
  if (!ready && !connectionString) {
    throw new Error('drizzleAdapter needs either a `db` or a `connectionString`.')
  }
  // Made here, not in `init`, so `asas.targets.drizzle.db` is reachable from the start;
  // node-postgres opens no socket until the first query.
  const opened = connectionString ? drizzle(connectionString) : undefined
  const db = ready ?? opened!
  const config = { ready, opened, db, connectionString, kinds, rules, idKinds, push, prodMigrations }
  // Each build gets a store of its own, so a refused or renamed kayan of one build is
  // never in the next. Every one shares the one client.
  const every = stateOf()
  // A push or a diff of the merged tables would build or keep a table no build has.
  const merged = () => {
    throw new Refusal('The drizzle store the language holds keeps every build\'s tables merged, an earlier build\'s among them, so it neither pushes nor migrates them: connect a build, `asas.connect()`, or run the command on `asas.targets.drizzle`.')
  }
  const adapter = { ...storeOf({ ...config, state: every }), connect: async () => merged(), commands: { migrate: async () => merged() } }
  adapter.init = function (this: unknown, kayanList, options) {
    // A target that spreads this adapter and overrides a member would hand the build a store
    // without the override: refused rather than dropped in silence.
    if (this !== undefined && this !== adapter) {
      throw new Error(
        'A target wraps the drizzle store and not its init, and each build uses the store init returns, so what the wrapper overrides would reach no build. Return the wrapped store from init too.',
      )
    }
    const state = stateOf()
    const built = storeOf({ ...config, state })
    built.init(kayanList, options)
    Object.assign(every.tables, state.tables)
    Object.assign(every.schemas, state.schemas)
    Object.assign(every.enums, state.enums)
    for (const [name, kayan] of state.kayanByName) every.kayanByName.set(name, kayan)
    return built as unknown as Store
  }
  return adapter
}

/** What one store builds and reads by: its tables, their schemas and enums, and its kayan by table key. */
const stateOf = () => ({
  // No prototype, so no kayan or join table name finds an inherited answer.
  tables: Object.create(null) as Tables,
  schemas: Object.create(null) as Schemas,
  enums: Object.create(null) as Enums,
  kayanByName: new Map<string, ResolvedKayan>(),
})

const storeOf = <
  const Kinds extends Record<string, ColumnBuilder>,
  const Rules extends Record<string, ColumnRule>,
>({ ready, opened, db, connectionString, kinds, rules, idKinds, push, prodMigrations, state }: {
  ready: Database | undefined
  opened: { $client: { end(): Promise<void> } } | undefined
  db: Database
  connectionString: string | undefined
  kinds: Kinds
  rules: Rules
  idKinds: readonly string[]
  push: boolean
  prodMigrations: ProdMigrations | undefined
  state: ReturnType<typeof stateOf>
}): Omit<Adapter, 'kinds' | 'rules'> & { kinds: Kinds; rules: Rules } => {
  const { tables, schemas, enums, kayanByName } = state
  // `pgSchema('public')` throws, so `public` is `pgTable`. A kayan's join and versions
  // tables are built in its own table's schema.
  const tableIn = (schemaName: string | undefined): typeof pgTable =>
    schemaName === undefined || schemaName === 'public' ? pgTable : ((schemas[schemaName] ??= pgSchema(schemaName)).table as unknown as typeof pgTable)
  /** The fields of one kayan that this store holds as several columns. */
  const localizedOf = (name: string) => {
    const kayan = kayanByName.get(name)
    return Object.values(kayan?.fields ?? {}).filter((field) => field.rules?.localized && !field.targets?.[kayan!.store])
  }
  // A field the write names is written whole, every locale column of it, so no write reads the row first.
  const flatten = (name: string, values: Record<string, unknown>) => {
    const fields = localizedOf(name)
    if (!fields.length) return values
    const flat = { ...values }
    for (const field of fields) {
      if (!(field.name in flat)) continue
      const given = flat[field.name] as Record<string, unknown> | null | undefined
      delete flat[field.name]
      for (const locale of field.locales!) flat[`${field.name}_${locale}`] = given?.[locale] ?? null
    }
    return flat
  }
  const declaredData = (name: string, values: Record<string, unknown>) => {
    const described = kayanByName.get(name)
    // A version's fields describe virtual snapshot paths, while core writes the physical snapshot column.
    const fields = described?.fields.parent?.target?.versions?.table === name ? getTableColumns(tables[name]!) : described?.fields ?? getTableColumns(tables[name]!)
    const field = Object.keys(values).find((key) => !Object.hasOwn(fields, key))
    if (field) throw invalid({ message: `Kayan "${name}" declares no field "${field}".`, key: 'error.invalid.value', params: { kayan: name, field } })
    return values
  }
  const increments = ({ name, values, insert = false }: { name: string; values: Record<string, unknown>; insert?: boolean }) => {
    const data = { ...declaredData(name, values) }
    for (const [field, value] of Object.entries(data)) {
      if (kayanByName.get(name)?.fields[field]?.kind === 'json' || !value || typeof value !== 'object' || !('$inc' in value)) continue
      if (kayanByName.get(name)?.fields[field]?.kind !== 'integer' || !Number.isSafeInteger(value.$inc) || Object.keys(value).length !== 1) {
        throw invalid({ message: `Kayan "${name}" field "${field}" accepts $inc only on an integer field with one safe integer.`, key: 'error.invalid.value', params: { kayan: name, field } })
      }
      data[field] = insert ? value.$inc : sql`${(tables[name] as unknown as Record<string, SQLWrapper>)[field]} + ${value.$inc}`
    }
    return data
  }
  // A field whose every locale column is null is one null, which matches the derived row shape.
  const expand = (name: string, row: Record<string, unknown>) => {
    const fields = localizedOf(name)
    if (!fields.length) return row
    const held = { ...row }
    for (const field of fields) {
      const keys = field.locales!.map((locale) => `${field.name}_${locale}`)
      if (!keys.some((key) => key in held)) continue
      const value = Object.fromEntries(field.locales!.map((locale, at) => [locale, held[keys[at]!] ?? null]))
      for (const key of keys) delete held[key]
      held[field.name] = Object.values(value).every((one) => one === null) ? null : value
    }
    return held
  }

  // A field the write does not name is left alone, so a soft delete never touches a set.
  const withoutSets = (name: string, values: Record<string, unknown>) => {
    const fields = manyFields(kayanByName.get(name))
    if (!fields.length) return { columns: values, sets: {} as Record<string, readonly unknown[]> }
    const columns = { ...values }
    const sets: Record<string, readonly unknown[]> = Object.create(null)
    for (const field of fields) {
      if (!(field.name in columns)) continue
      const given = columns[field.name]
      delete columns[field.name]
      // `null` is the empty set written out.
      sets[field.name] = Array.isArray(given) ? given : []
    }
    return { columns, sets }
  }

  // The whole array replaces the set. Deduplicated: two join rows for one pair would read
  // back as the id twice.
  const writeSets = async (tx: unknown, name: string, id: unknown, sets: Record<string, readonly unknown[]>) => {
    const kayan = kayanByName.get(name)!
    for (const [field, given] of Object.entries(sets)) {
      const join = tables[joinTableOf(kayan, kayan.fields[field]!)]!
      await (tx as Database).delete(join).where(eq(join.parent! as SQLWrapper, id))
      const values = [...new Set(given)].map((target, at) => ({ parent: id, target, order: at }))
      if (values.length) await (tx as Database).insert(join).values(values)
    }
  }

  // One query per `hasMany` field however many rows are asked about. A row with no join
  // row gets the empty array, so the key is always there.
  const readSets = async (client: Database, name: string, ids: readonly unknown[]) => {
    const kayan = kayanByName.get(name)
    const fields = manyFields(kayan)
    const held = new Map<string, Record<string, unknown[]>>(
      ids.map((id) => [String(id), Object.fromEntries(fields.map((field) => [field.name, [] as unknown[]]))]),
    )
    if (!fields.length || !ids.length) return held
    for (const field of fields) {
      const join = tables[joinTableOf(kayan!, field)]!
      const rows = await client
        .select()
        .from(join)
        .where(inArray(join.parent! as SQLWrapper, ids as unknown[]))
        .orderBy(asc(join.order!))
      for (const row of rows as { parent: unknown; target: unknown }[]) {
        held.get(String(row.parent))?.[field.name]!.push(row.target)
      }
    }
    return held
  }

  /** One row, with its sets read back off the join tables beside its columns. */
  const withSets = async (client: Database, name: string, row: Record<string, unknown>) => {
    if (!manyFields(kayanByName.get(name)).length) return row
    const held = await readSets(client, name, [row.id])
    return { ...row, ...held.get(String(row.id)) }
  }

  return {
    capability: 'store',
    type: 'drizzle',
    sql: 'drizzle',
    idKinds,
    kinds,
    rules,
    db,
    tables,
    schemas,
    enums,
    connectionString,

    commands: {
      // Imported here, so an app that never migrates loads neither `node:child_process` nor `drizzle-kit`.
      migrate: async ({ flags }) =>
        (await import('./migrate.ts')).run({ target: { db, tables, schemas, enums, connectionString, kayan: [...kayanByName.values()] }, flags }),
    },

    init(kayanList, options) {
      const indexNames: { where: string; kayan: string; name: string }[] = []
      for (const kayan of kayanList) {
        kayanByName.set(kayan.name, kayan)
        // Under the kayan's own store's name, whatever the build calls it.
        const override = kayan.targets?.[kayan.store] as Tables[string] | undefined
        if (override && kayan.schemaName !== undefined) {
          throw new Error(
            `Kayan "${kayan.name}" writes schemaName beside a whole-table targets.drizzle, which names its own schema through its own pgSchema. Remove one of the two.`,
          )
        }
        if (override && kayan.indexes.length) {
          throw new Error(
            `Kayan "${kayan.name}" asks for indexes, its own or a unique field's, beside a whole-table targets.drizzle, which builds its own table and its indexes in its third argument. Build them there, and write indexes: () => [].`,
          )
        }
        if (override) {
          tables[kayan.name] = override
          continue
        }
        const refused = kayan.schemaName === undefined ? undefined : refusedSchema(kayan.schemaName)
        if (refused) {
          throw new Error(`Kayan "${kayan.name}" asks for the schema ${JSON.stringify(kayan.schemaName)}, ${refused} Give the kayan another schemaName.`)
        }
        const built: Record<string, AnyPgColumnBuilder> = Object.create(null)
        // A table reads its own columns first, whichever place the kayan spread the timestamps in.
        // A column never moves in a table that exists: drizzle-kit diffs columns by name.
        const stamp = (field: ResolvedField) => field.name === 'createdAt' || field.name === 'updatedAt'
        const declared = Object.values(kayan.fields).flatMap(columnsOfField(kayan.store))
        const columns = [...declared.filter((field) => !stamp(field)), ...declared.filter(stamp)]
        // `pgTable` keys on the field name, so a localized `title` and a plain `titleAr` would
        // both ask for `title_ar` and one field would end with no column.
        const asked = new Set<string>()
        const keyed = new Set<string>()
        for (const field of columns) {
          if (asked.has(field.column)) {
            throw new Error(
              `Kayan "${kayan.name}" field "${field.name}" asks for column "${field.column}", which another field of the same kayan already holds. Rename one of the two, or give one a dbName of its own.`,
            )
          }
          // A `dbName` walks a plain field past the guard above while leaving its table key,
          // which would overwrite the locale's entry.
          if (keyed.has(field.name)) {
            throw new Error(
              `Kayan "${kayan.name}" field "${field.name}" asks for the table key "${field.name}", which another field of the same kayan already holds. Rename one of the two; a dbName changes the column and not this key.`,
            )
          }
          asked.add(field.column)
          keyed.add(field.name)
        }
        for (const field of columns) {
          // The field's entry under its kayan's own store is the whole column, rules skipped.
          if (field.targets?.[kayan.store]) {
            built[field.name] = field.targets[kayan.store] as AnyPgColumnBuilder
            continue
          }
          // A kayan that keeps drafts makes a row before its rules hold, so no client column
          // carries a length or a precision; the runner holds a publish to the rules instead.
          const drafted = kayan.versions?.drafts && providerOf(field, 'create') === 'client'
          // The project's own entry, then the kind's own, then the shipped table.
          const build = implementationOf<ColumnBuilder>({ table: kinds, shipped: drizzleKinds, name: field.kind, own: field.kindTargets, type: 'drizzle' })!
          let column = modifiable(build(drafted ? { ...field, rules: { ...field.rules, maxLength: undefined, precision: undefined, scale: undefined } } : field, tables))
          if (field.name === 'id') {
            column = (rules.primary as ColumnRule<undefined>)({ column, value: undefined, field })
          }
          for (const [rule, apply] of Object.entries(rules)) {
            // A draft is made before its rules hold, so no client column is `not null`; the runner
            // holds a published row to `required` instead.
            if (rule === 'required' && drafted) continue
            if (rule in (field.rules ?? {})) {
              column = (apply as ColumnRule<unknown>)({ column, value: (field.rules as Record<string, unknown>)[rule], field })
            }
          }
          built[field.name] = column
        }
        const indexed = columns.filter((field) => field.rules?.index)
        // A unique rule's own index over one column is that column's UNIQUE, the constraint a unique
        // field has always built, so a shared kayan's table is the one it was.
        const ownUnique = (index: CompoundIndex) => uniqueRuleIndexes.has(index) && index.fields.length === 1
        for (const index of kayan.indexes.filter(ownUnique)) built[index.fields[0]!] = (built[index.fields[0]!] as Modifiable).unique()
        // Named `<table>_<columns>_idx`, the same on every build whatever the kayan order; a
        // name past 63 bytes is refused, not cut short as Postgres would cut it in silence.
        // `nullsNotDistinct` is a unique constraint: drizzle's pg index builder has no NULLS NOT DISTINCT.
        const compound = kayan.indexes.flatMap((index, at) => {
          if (ownUnique(index)) return []
          const { fields, unique, nullsNotDistinct } = index
          const name = index.name ?? `${kayan.table}_${fields.map((field) => kayan.fields[field]!.column).join('_')}_${nullsNotDistinct ? 'unique' : 'idx'}`
          if (!isPlainIdentifier(name)) {
            throw new Error(
              `Kayan "${kayan.name}" indexes[${at}] is named ${JSON.stringify(name)}, which is longer than the 63 bytes Postgres keeps of a name, or holds a character other than a letter, a digit or an underscore. Give the kayan or its fields a shorter dbName.`,
            )
          }
          indexNames.push({ where: `Kayan "${kayan.name}" indexes[${at}]`, kayan: kayan.name, name })
          return [{ name, fields, unique, nullsNotDistinct }]
        })
        tables[kayan.name] = tableIn(kayan.schemaName)(kayan.table, built, (table) => [
          ...indexed.map((field) => index().on(table[field.name]!)),
          ...compound.map(({ name, fields: [first, ...rest], unique, nullsNotDistinct }) => {
            const on = [table[first!]!, ...rest.map((field) => table[field]!)] as const
            return nullsNotDistinct ? uniqueConstraint(name).on(...on).nullsNotDistinct() : (unique ? uniqueIndex : index)(name).on(...on)
          }),
        ])
      }
      // In a pass of their own, so the collision check below sees every kayan's own key.
      for (const kayan of kayanList) {
        for (const field of manyFields(kayan)) {
          const name = joinTableOf(kayan, field)
          if (tables[name]) {
            throw new Error(
              `Kayan "${kayan.name}" field "${field.name}" needs the join table "${name}", which is already the table of kayan "${name}". Rename one of the two, or give the kayan a dbName of its own.`,
            )
          }
          // Each end takes the type of the id it points at. The parent's end cascades, since the row
          // belongs to its parent; the target's is the field's own `onDelete`.
          const reference = (build: ColumnBuilder, column: string, target: ResolvedKayan, onDelete: unknown) =>
            modifiable(build({ ...field, name: column, column: `${column}_id`, target, rules: { onDelete } }, tables)).notNull()
          // Named, so the check below holds them to the schema's one namespace.
          const key = `${name}_pkey`
          const targetIndex = `${name}_target_id_index`
          // A name that is no plain identifier is refused below, so only the length is left here.
          for (const [what, named] of [['key', key], ['index', targetIndex]] as const) {
            if (isPlainIdentifier(name) && !isPlainIdentifier(named)) {
              throw new Error(
                `Kayan "${kayan.name}" field "${field.name}" builds the join table "${name}", whose ${what} "${named}" is longer than the 63 bytes Postgres keeps of a name. Rename the field, or give the kayan a shorter dbName.`,
              )
            }
            indexNames.push({ where: `Kayan "${kayan.name}" field "${field.name}" join table ${what}`, kayan: kayan.name, name: named })
          }
          tables[name] = tableIn(schemaOf(tables[kayan.name]))(
            name,
            {
              parent: reference(kinds.relationship as ColumnBuilder, 'parent', kayan, 'cascade'),
              target: reference(implementationOf<ColumnBuilder>({ table: kinds, shipped: drizzleKinds, name: field.kind, own: field.kindTargets, type: 'drizzle' })!, 'target', field.target!, field.rules?.onDelete),
              // The only order a set of ids has.
              order: pgInteger('order').notNull(),
            },
            (table) => [
              primaryKey({ name: key, columns: [table.parent!, table.order!] }),
              index().on(table.parent!),
              index(targetIndex).on(table.target!),
            ],
          )
        }
      }
      // The name must not be a table already built.
      for (const kayan of kayanList) {
        if (!kayan.versions) continue
        const name = versionsTableOf(kayan)
        if (tables[name]) {
          throw new Error(
            `Kayan "${kayan.name}" keeps versions in the table "${name}", which is already the table of kayan "${name}". Rename one of the two, or give the kayan a dbName of its own.`,
          )
        }
        // So a filter naming `parent` reaches the row it belongs to.
        kayanByName.set(name, kayan.versions.kayan)
        const moment = (column: string) => timestamp(column, { precision: 3, withTimezone: true, mode: 'date' }).notNull().defaultNow()
        // The row it belongs to cascades: deleting the row deletes its versions, and a soft delete keeps them.
        tables[name] = tableIn(schemaOf(tables[kayan.name]))(
          name,
          {
            id: pgUuid('id').defaultRandom().primaryKey(),
            parent: modifiable(
              (kinds.relationship as ColumnBuilder)(
                { ...kayan.versions.kayan.fields.parent!, rules: { onDelete: 'cascade' } },
                tables,
              ),
            ).notNull(),
            version: jsonb('version').notNull(),
            latest: pgBoolean('latest').notNull().default(false),
            autosave: pgBoolean('autosave').notNull().default(false),
            createdAt: moment('created_at'),
            updatedAt: moment('updated_at'),
          },
          (table) => [index().on(table.parent!), index().on(table.latest!)],
        )
      }
      if (options?.jobs) {
        if (tables.mithaq_jobs || kayanList.some((one) => one.table === 'mithaq_jobs')) throw new Error('The name mithaq_jobs is reserved for jobs.')
        tables.mithaq_jobs = jobTable()
        schemas.public = null
      }
      // Every name the push and the pull hand drizzle-kit as a glob passes here once, built.
      for (const [key, table] of Object.entries(tables)) {
        const name = getTableName(table)
        if (typeof name !== 'string' || isPlainIdentifier(name)) continue
        const made =
          kayanList.flatMap((kayan) => [
            ...manyFields(kayan)
              .filter((field) => joinTableOf(kayan, field) === name)
              .map((field) => [`Kayan "${kayan.name}" field "${field.name}" builds the join table`, 'Rename the field.']),
            ...(kayan.versions && versionsTableOf(kayan) === name
              ? [[`Kayan "${kayan.name}" builds the versions table`, 'Give the kayan a shorter dbName.']]
              : []),
          ])[0] ?? [`Kayan "${key}" whole-table targets.drizzle is the table`, 'Rename the table in targets.drizzle.']
        throw new Error(`${made[0]} ${JSON.stringify(name)}, which is not a plain SQL identifier: letters, digits and underscores, not starting with a digit, at most 63 bytes. ${made[1]}`)
      }
      // Postgres keeps tables and indexes under one name per schema, so a kayan index named as
      // a table or another index would pass the build and fail the migration.
      const named = new Map<string, string>()
      for (const table of Object.values(tables)) {
        const name = getTableName(table)
        if (typeof name === 'string') named.set(`${schemaOf(table)}.${name}`, `the table "${name}"`)
      }
      for (const { where, kayan, name } of indexNames) {
        const schema = schemaOf(tables[kayan])
        const taken = named.get(`${schema}.${name}`)
        if (taken) {
          throw new Error(
            `${where} is named "${name}", which is already ${taken} in the schema "${schema}", and Postgres keeps one name per schema for tables and indexes alike. Rename one of the two through a dbName.`,
          )
        }
        named.set(`${schema}.${name}`, `the name of ${where.replace('Kayan ', 'kayan ')}`)
      }
      // Read off every table built, so a whole-table override in its own `pgSchema` is held to the same rule.
      for (const [key, table] of Object.entries(tables)) {
        if (typeof getTableName(table) !== 'string') continue
        const name = schemaOf(table)
        const refused = refusedSchema(name)
        if (refused) throw new Error(`Kayan "${key}" whole-table targets.drizzle is built in the schema ${JSON.stringify(name)}, ${refused} Build it in another schema.`)
        if (!(name in schemas)) schemas[name] = name === 'public' ? null : pgSchema(name)
      }
      for (const name of Object.keys(schemas)) {
        if (name !== 'public' && `${name}Schema` in tables) {
          throw new Error(`The table key "${name}Schema" is the name the schema module exports the schema "${name}" by. Rename the kayan.`)
        }
      }
      Object.assign(enums, enumsOf(tables))
    },

    async connect({ readOnly }: { readOnly?: boolean } = {}) {
      // The `devPushMarker` row tells a pushed database from a migrated one, since `push` writes
      // no history; without it the first `mithaq migrate` would recreate every table.
      if (readOnly) return
      if (!push) {
        // Outside production nothing is checked: the dev push is that path.
        if (process.env.NODE_ENV === 'production') await (await import('./migrate.ts')).bootMigrations({ db, prodMigrations })
        return
      }
      // Without the filter a table the kayan do not describe would be dropped. drizzle-kit reads
      // an empty filter as none, so no tables means nothing to push.
      const tablesFilter = Object.values(tables).map((table) => getTableName(table))
      if (!tablesFilter.length) return
      await refuseStrangers({ db, tables, by: 'push' })
      // `drizzle-kit/api-postgres` imports every driver drizzle speaks, so webpack and Turbopack
      // are told to leave the import to the runtime, and its drizzle-orm is this mithaq's.
      ;(await import('./migrate.ts')).holdOwnKit()
      const { pushSchema } = await import(/* webpackIgnore: true */ 'drizzle-kit/api-postgres')
      // `owned`: a column of a table of the language has the type, which makes it the language's own.
      const listed = (values: string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `)
      const { rows } = await db.execute(sql`select nspname as schema, typname as name, array_agg(enumlabel::text order by enumsortorder) as labels,
          exists (select 1 from pg_catalog.pg_attribute
            join pg_catalog.pg_class on pg_class.oid = attrelid
            join pg_catalog.pg_namespace as tables on tables.oid = relnamespace
            where atttypid in (pg_type.oid, pg_type.typarray) and not attisdropped and tables.nspname in (${listed(Object.keys(schemas))}) and relname in (${listed(tablesFilter)})) as owned
        from pg_catalog.pg_enum
        join pg_catalog.pg_type on pg_type.oid = enumtypid
        join pg_catalog.pg_namespace on pg_namespace.oid = typnamespace
        where nspname in (${listed(Object.keys(schemas))})
        group by nspname, typname, pg_type.oid`)
      const { imports, filter } = pushInput({ tables, schemas, held: rows as Parameters<typeof pushInput>[0]['held'] })
      let planned: Awaited<ReturnType<typeof pushSchema>>
      try {
        planned = await pushSchema(imports, db, filter)
      } catch (error) {
        // A rename is a question drizzle-kit asks through hints the push cannot answer, and it throws.
        if (error instanceof Error && error.message.includes('was called without a HintsHandler')) {
          throw new Error(
            "The push met a rename it cannot ask about, such as a field's column renamed. Run `mithaq migrate`, which asks, or drop the dev database's tables.",
            { cause: error },
          )
        }
        throw error
      }
      const { sqlStatements, hints } = planned
      // Refused outright: there is no terminal to answer in a test or a deploy, and a silent
      // yes is how a column goes missing.
      const dataLoss = hints.filter(({ statement }) => statement)
      if (dataLoss.length) {
        throw new Error(
          `Refusing to push the schema, because it would lose data:\n\n${dataLoss.map(({ hint }) => hint).join('\n')}`,
        )
      }
      if (hints.length) console.warn(`Schema push warnings:\n${hints.map(({ hint }) => hint).join('\n')}`)
      // The drop is held back below, so recreating an enum would fail on a type that exists.
      for (const statement of sqlStatements) {
        const dropped = /^DROP TYPE (?:"(.+)"\.)?"(.+)";$/.exec(statement)
        if (dropped && sqlStatements.some((one) => one.startsWith(`CREATE TYPE ${statement.slice(10, -1)} `))) {
          throw new Error(
            `The push would recreate the enum "${dropped[1] ?? 'public'}"."${dropped[2]}", because a label of it was removed or reordered, and it never drops a type. Drop the dev table and the type with DROP TYPE "${dropped[1] ?? 'public'}"."${dropped[2]}", or keep the labels as they are. Nothing was written.`,
          )
        }
      }
      // drizzle-kit plans to drop every enum, sequence and schema it is not handed, another
      // tool's included, so no `DROP TYPE`, `DROP SEQUENCE` or `DROP SCHEMA` runs.
      const statements = sqlStatements.filter((statement) => !/^DROP (TYPE|SEQUENCE|SCHEMA) /.test(statement))
      // drizzle-kit's own `apply` runs statement by statement with no transaction; Postgres
      // DDL is transactional, so the push and its marker commit together or not at all.
      // The history lock before any table lock, the order a boot takes them in, so the two never deadlock.
      await db.transaction(async (tx) => {
        await tx.execute(historyLock)
        for (const statement of statements) await tx.execute(sql.raw(statement))
        // Deleted and written again, so the marker stays one row.
        await recordMigration({ db: tx, hash: devPushMarker, createdAt: Date.now(), name: devPushMarker })
      })
    },

    // Kept as drizzle's own callback: the runner passes `tx` down the list.
    async transaction(run) {
      return db.transaction((tx) => run(tx))
    },

    async insert({ tx, kayan: name, data: values }) {
      const { columns, sets } = withoutSets(name, declaredData(name, values))
      let result: unknown
      try {
        result = await (tx as Database).insert(tables[name]!).values(flatten(name, columns)).returning()
      } catch (thrown) {
        throw collision(thrown, name)
      }
      if (!Array.isArray(result)) throw new Error('The drizzle store expected insert to return rows.')
      const [row] = result
      const held = expand(name, row as Record<string, unknown>)
      // In the write's own transaction, so a set that cannot be written takes its row down.
      await writeSets(tx, name, held.id, sets)
      return withSets(tx as Database, name, held)
    },

    async upsert({ tx, kayan: name, on, data: values, where }) {
      if (!tx) throw new Error('An upsert requires a transaction.')
      const kayan = kayanByName.get(name)!
      const table = tables[name]!
      const inserted = withoutSets(name, increments({ name, values, insert: true }))
      const updated = withoutSets(name, increments({ name, values }))
      const set = flatten(name, Object.fromEntries(Object.entries(updated.columns).filter(([field]) => field !== 'id' && field !== kayan.tenant && !on.includes(field))))
      // Even a key-only upsert returns the existing row, without changing its identity.
      if (!Object.keys(set).length) set[on[0]!] = table[on[0]!]!
      let result: unknown
      try {
        result = await (tx as Database).insert(table).values(flatten(name, inserted.columns)).onConflictDoUpdate({ target: on.map((field) => table[field]! as never), set, setWhere: where ? whereOf(tx as Database, tables, kayanByName, name, where) : undefined }).returning()
      } catch (thrown) {
        throw collision(thrown, name)
      }
      if (!Array.isArray(result)) throw new Error('The drizzle store expected upsert to return rows.')
      const [row] = result
      if (!row) throw missing({ message: `No "${name}" row found.`, key: 'error.not_found.row', params: { kayan: name } })
      const held = expand(name, row)
      await writeSets(tx, name, held.id, inserted.sets)
      return withSets(tx as Database, name, held)
    },

    async update({ tx, kayan: name, id, data: values, where }) {
      const { columns, sets } = withoutSets(name, increments({ name, values }))
      const flat = flatten(name, columns)
      const matched = idWhere(tx as Database, tables, kayanByName, name, id, where)
      let result: unknown
      try {
        // drizzle refuses an empty `set`, so a write naming only sets locks the row instead, as an UPDATE
        // of no key column would: a stronger lock would deadlock with a write naming the row.
        result = Object.keys(flat).length
          ? await (tx as Database).update(tables[name]!).set(flat).where(matched).returning()
          : await (tx as Database).select().from(tables[name]!).where(matched).for('no key update')
      } catch (thrown) {
        throw collision(thrown, name)
      }
      if (!Array.isArray(result)) throw new Error('The drizzle store expected update to return rows.')
      const [row] = result
      // An update that matched nothing did not happen; an `undefined` row answer would hide it.
      if (!row) throw new Error(`No "${name}" row with id ${String(id)} to update.`)
      const held = expand(name, row as Record<string, unknown>)
      // After the row, so a `where` that admitted no row refuses before any set is touched.
      await writeSets(tx, name, held.id, sets)
      return withSets(tx as Database, name, held)
    },

    async remove({ tx, kayan: name, id, where }) {
      // Read before the delete: the join rows cascade with it.
      const sets = await withSets(tx as Database, name, { id })
      let result: unknown
      try {
        result = await (tx as Database)
          .delete(tables[name]!)
          .where(idWhere(tx as Database, tables, kayanByName, name, id, where))
          .returning()
      } catch (thrown) {
        throw referenced({ thrown, name, kayans: kayanByName, tables })
      }
      if (!Array.isArray(result)) throw new Error('The drizzle store expected delete to return rows.')
      const [row] = result
      if (!row) throw new Error(`No "${name}" row with id ${String(id)} to delete.`)
      return { ...sets, ...expand(name, row as Record<string, unknown>) }
    },

    async find({ kayan: name, args: { limit, lock, page, sort, where }, tx }) {
      if (lock && !tx) throw new Error('A locked find requires a transaction.')
      const client = (tx ?? db) as Database
      const table = tables[name]!
      if (!Object.hasOwn(kayanByName.get(name)?.fields ?? getTableColumns(table), sort.field)) throw invalid({ message: `Kayan "${name}" declares no field "${sort.field}".`, key: 'error.invalid.value', params: { kayan: name, field: sort.field } })
      if (kayanByName.get(name)?.fields[sort.field]?.rules?.localized) {
        throw refuseLocalized(name, sort.field, 'sort')
      }
      const condition = where ? whereOf(client, tables, kayanByName, name, where) : undefined
      const column: SQLWrapper | undefined = table[sort.field]
      const id: SQLWrapper | undefined = table.id
      const direction = sort.direction === 'desc' ? desc : asc
      // Each clause only for a column the table has: a table override may lack `id`, and a
      // clause from the absent column is a syntax error. The unique id makes page boundaries total.
      const orderBy = [
        ...(column ? [direction(column)] : []),
        ...(id && sort.field !== 'id' ? [direction(id)] : []),
      ]
      const offset = limit > 0 ? (page - 1) * limit : 0
      // `$dynamic()` keeps each branch one type, so drizzle checks `orderBy` against the table.
      const query = client.select().from(table).$dynamic().where(condition)
      const locked = tx && lock ? query.for(({ update: 'update', noKeyUpdate: 'no key update', share: 'share', keyShare: 'key share' } as const)[lock]) : query
      const ordered = locked.orderBy(...orderBy).offset(offset)
      const docs = limit > 0 ? await ordered.limit(limit) : await ordered
      const rows = await client.select({ totalDocs: sqlCount() }).from(table).where(condition)
      const held = (docs as Record<string, unknown>[]).map((row) => expand(name, row))
      const sets = await readSets(client, name, held.map((row) => row.id))
      return {
        docs: held.map((row) => ({ ...row, ...sets.get(String(row.id)) })),
        totalDocs: Number(rows[0]?.totalDocs ?? 0),
      }
    },

    async sum({ tx, kayan: name, field, where }) {
      if (!['integer', 'number', 'decimal'].includes(kayanByName.get(name)?.fields[field]?.kind ?? '')) {
        throw invalid({ message: `Kayan "${name}" field "${field}" is not numeric, so it cannot be summed.`, key: 'error.invalid.value', params: { kayan: name, field } })
      }
      const client = (tx ?? db) as Database
      const rows = await client.select({ total: sqlSum(tables[name]![field]!) }).from(tables[name]!).where(where ? whereOf(client, tables, kayanByName, name, where) : undefined)
      return rows[0]?.total ?? '0'
    },

    async count({ kayan: name, args: { where }, tx }) {
      const client = (tx ?? db) as Database
      // The relationship filters use subqueries, so there are no joins to deduplicate.
      const rows = await client.select({ totalDocs: sqlCount() }).from(tables[name]!).where(
        where ? whereOf(client, tables, kayanByName, name, where) : undefined,
      )
      return Number(rows[0]?.totalDocs ?? 0)
    },

    async destroy() {
      // Only a pool this adapter opened: a `db` the developer passed is theirs to end.
      if (ready) return
      await opened!.$client.end()
    },
  } as Omit<Adapter, 'kinds' | 'rules'> & { kinds: Kinds; rules: Rules }
}

declare module '../mithaq/rukn.ts' {
  /** A kayan's entry under its drizzle store is its whole table, unbuilt, used as written. */
  interface KayanConfigs<L, F, T> {
    drizzle: PgTable
  }
}
