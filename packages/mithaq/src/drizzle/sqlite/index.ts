import { and, asc, count as sqlCount, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql, type ColumnBuilderBase, type SQL, type SQLWrapper } from 'drizzle-orm'
import { index, sqliteTable, uniqueIndex, type SQLiteAsyncDatabase as BaseSQLiteDatabase, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { uniqueRuleIndexes } from '../../mithaq/resolve.ts'
import type { CompoundIndex, ResolvedField, ResolvedKayan } from '../../mithaq/types.ts'
import type { Store } from '../../mithaq/language.ts'
import { implementationOf } from '../../mithaq/rukn.ts'
import type { Operator, Where } from '../../mithaq/where.ts'
import { conflict, invalid, missing } from '../../asas/runner/errors.ts'
import { decimalDigits, isDecimal } from '../../base/decimal.ts'
import { kinds as shippedKinds, type SqliteColumnBuilder } from './kinds.ts'
import type { SqliteColumnRule, SqliteModifiable } from './rules.ts'

/** The opened drizzle database and isolated transaction boundary supplied by the host adapter. */
export type SqliteDatabase = BaseSQLiteDatabase<'sync' | 'async', any, any>
export type SqliteContract = {
  db: SqliteDatabase
  transaction<T>(fn: (tx: SqliteDatabase) => Promise<T>): Promise<T>
}

type Database = SqliteDatabase
type Tables = Record<string, SQLiteTable & Record<string, SQLWrapper>>

/** The device store: a store, plus the drizzle instance and the tables it built, read off `asas.targets.<name>`. */
export type SqliteAdapter = Omit<Store, 'kinds' | 'rules'> & {
  kinds: Record<string, SqliteColumnBuilder>
  rules: Record<string, SqliteColumnRule>
  readonly type: 'drizzle-sqlite'
  /** Outside a transaction; a step reaches the write's own through `ctx.tx`. */
  readonly db: Database
  tables: Tables
}

// SQLite's messages are not localized, unlike Postgres's, so the constraint is read off them;
// the contract does not require driver-specific error codes.
const failed = (thrown: unknown, constraint: RegExp) => {
  for (let error = thrown as { message?: unknown; cause?: unknown } | undefined, depth = 0; error && depth < 3; error = error.cause as never, depth++) {
    if (typeof error.message === 'string' && constraint.test(error.message)) return true
  }
  return false
}
const collision = (thrown: unknown, name: string) =>
  failed(thrown, /\b(UNIQUE|PRIMARY KEY) constraint failed/)
    ? conflict({ message: `A "${name}" row already holds one of the unique values this write carries.`, key: 'error.conflict.unique', params: { kayan: name }, cause: thrown })
    : thrown
// SQLite's message names no table, so the conflict names no kayan that points at the row.
const referenced = (thrown: unknown, name: string) =>
  failed(thrown, /\bFOREIGN KEY constraint failed/)
    ? conflict({ message: `A "${name}" row is still pointed at by another row, so it is not deleted.`, key: 'error.conflict.referenced', params: { kayan: name }, cause: thrown })
    : thrown

// The same numeric value must have one spelling for SQLite equality and unique constraints.
const decimalText = (value: unknown, field: ResolvedField): unknown => {
  if (value === null || value === undefined) return value
  if (!isDecimal(value)) throw invalid({ message: `Field "${field.name}" needs decimal text.`, key: 'error.invalid.value', params: { field: field.name } })
  const { precision, scale } = field.rules ?? {}
  const size = decimalDigits(value)
  if ((typeof scale === 'number' && size.fraction > scale) || (typeof precision === 'number' && (size.whole + size.fraction > precision || size.whole > precision - (scale as number)))) {
    throw invalid({ message: `Field "${field.name}" exceeds its decimal precision or scale.`, key: 'error.invalid.value', params: { field: field.name } })
  }
  const [whole, fraction] = value.replace(/^[+-]/, '').split('.')
  const digits = whole!.replace(/^0+/, '') || '0'
  const tail = (fraction ?? '').replace(/0+$/, '')
  return `${value.startsWith('-') && (digits !== '0' || tail) ? '-' : ''}${digits}${tail ? `.${tail}` : ''}`
}

// Text keeps decimal precision, but SQLite cannot order it numerically without rounding.
const refuseDecimalOrder = (kayan: string, field: string) => invalid({
  message: `Kayan "${kayan}" field "${field}" is a decimal stored as text, so the device store cannot order it exactly.`,
  key: 'error.invalid.decimal_order', params: { kayan, field },
})

// Backslash-escaped, with the escape named: SQLite's LIKE has no escape character of its own.
const like = (column: SQLWrapper, value: string) => sql`${column} like ${`%${value.replace(/[\\%_]/g, '\\$&')}%`} escape '\\'`

// Every `text` member of Lexical's tree as one string, so a search runs over what a reader sees, never a key or a node type.
const textOf = (column: SQLWrapper): SQL => sql`(select group_concat(node.value, ' ') from json_tree(${column}) as node where node.key = 'text')`

const splitNulls = (value: unknown) => {
  const values = value as unknown[]
  return { hasNull: values.some((one) => one === null), values: values.filter((one) => one !== null) }
}

const conditionsOf = (column: SQLWrapper, rules: Record<string, unknown>): SQL | undefined => {
  const checks = (Object.entries(rules) as [Operator, unknown][]).map(([operator, value]): SQL | undefined => {
    switch (operator) {
      case 'contains':
        return like(column, String(value))
      case 'like':
        return and(...String(value).trim().split(/\s+/).filter(Boolean).map((word) => like(column, word)))
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
        const nonNull = split.values.length ? inArray(column, split.values) : sql`0`
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
        const nonNull = split.values.length ? notInArray(column, split.values) : sql`1`
        return split.hasNull ? and(isNotNull(column), nonNull) : nonNull
      }
    }
    // Unreachable, but a value past both checks would otherwise be left out of a `where`,
    // which carries an access constraint.
    throw new Error(`Unsupported where operator "${operator satisfies never}".`)
  })
  return checks.length === 1 ? checks[0] : and(...checks)
}

/** Payload's SQLite adapter shape, with the opened drizzle database supplied by the app. */
export const sqliteAdapter = <
  const Kinds extends Record<string, SqliteColumnBuilder>,
  const Rules extends Record<string, SqliteColumnRule>,
>({ db, transaction, kinds, rules, idKinds }: SqliteContract & {
  kinds: Kinds
  rules: Rules
  idKinds: readonly string[]
}): Omit<SqliteAdapter, 'kinds' | 'rules'> & { kinds: Kinds; rules: Rules } => {
  if (!db || typeof transaction !== 'function') throw new Error('sqliteAdapter needs an opened drizzle db and an isolated transaction function.')
  const store = (tables: Tables, kayanByName: Map<string, ResolvedKayan>) => {
    const declaredData = (name: string, values: Record<string, unknown>) => {
      const fields = kayanByName.get(name)?.fields ?? getTableColumns(tables[name]!)
      const field = Object.keys(values).find((key) => !Object.hasOwn(fields, key))
      if (field) throw invalid({ message: `Kayan "${name}" declares no field "${field}".`, key: 'error.invalid.value', params: { kayan: name, field } })
      return values
    }
    const increments = ({ name, values, insert = false }: { name: string; values: Record<string, unknown>; insert?: boolean }) => {
      const data = { ...declaredData(name, values) }
      for (const [field, value] of Object.entries(data)) {
        const declared = kayanByName.get(name)?.fields[field]
        if (declared?.kind === 'decimal') data[field] = decimalText(value, declared)
        if (kayanByName.get(name)?.fields[field]?.kind === 'json' || !value || typeof value !== 'object' || !('$inc' in value)) continue
        if (kayanByName.get(name)?.fields[field]?.kind !== 'integer' || !Number.isSafeInteger(value.$inc) || Object.keys(value).length !== 1) {
          throw invalid({ message: `Kayan "${name}" field "${field}" accepts $inc only on an integer field with one safe integer.`, key: 'error.invalid.value', params: { kayan: name, field } })
        }
        data[field] = insert ? value.$inc : sql`${tables[name]![field]} + ${value.$inc}`
      }
      return data
    }
    const whereOf = (client: Database, name: string, where: Where): SQL | undefined => {
      const table = tables[name]!
      const kayan = kayanByName.get(name)!
      const parts: (SQL | undefined)[] = []
      const conjunction = (where as { and?: Where[] }).and
      if (Array.isArray(conjunction)) parts.push(and(...conjunction.map((one) => whereOf(client, name, one))))
      const disjunction = (where as { or?: Where[] }).or
      // Drizzle omits undefined clauses, but an empty OR is false and an unconstrained branch is true.
      if (Array.isArray(disjunction)) parts.push(or(...disjunction.map((one) => whereOf(client, name, one) ?? sql`1`)) ?? sql`0`)
      for (const [path, rules] of Object.entries(where)) {
        if (path === 'and' || path === 'or') continue
        const [own, hop, ...rest] = path.split('.')
        const field = kayan.fields[own!]
        const named = hop && field?.target ? field.target.fields[hop] : field
        // A plain Error: what reaches here past the read layer is an access callback's own `where`.
        if (named?.kind === 'json' || field?.kind === 'json') throw new Error(`Kayan "${name}" field "${named?.name ?? own}" is json, and the device store filters no json field.`)
        if (rest.length || (hop && !field?.target)) throw new Error(`Kayan "${name}" path "${path}" reaches no column of the device store.`)
        if (named?.kind === 'decimal' && Object.keys(rules).some((operator) => ['greater_than', 'greater_than_equal', 'less_than', 'less_than_equal'].includes(operator))) throw refuseDecimalOrder(name, path)
        const target = hop ? tables[field!.target!.name]! : table
        const column = target[hop ?? own!]!
        const normalized = named?.kind === 'decimal' ? Object.fromEntries(Object.entries(rules).map(([operator, value]) => [operator,
          operator === 'equals' || operator === 'not_equals' ? decimalText(value, named)
            : operator === 'in' || operator === 'not_in' ? (value as unknown[]).map((one) => decimalText(one, named)) : value,
        ])) : rules
        const condition = conditionsOf(named?.kind === 'richText' ? textOf(column) : column, normalized as Record<string, unknown>)
        parts.push(hop ? inArray(table[own!]!, client.select({ id: target.id as never }).from(target).where(condition)) : condition)
      }
      return parts.length === 1 ? parts[0] : and(...parts)
    }
    const idWhere = ({ client, name, id, where }: { client: Database; name: string; id: unknown; where?: Where }) => {
      const byId = eq(tables[name]!.id!, id)
      return where ? and(byId, whereOf(client, name, where)) : byId
    }
    const rowsOf = (result: unknown, what: string) => {
      if (!Array.isArray(result)) throw new Error(`The device store expected ${what} to return rows.`)
      return result as Record<string, unknown>[]
    }
    return {
      transaction: (run: (tx: unknown) => Promise<never>) => transaction(run),
      async insert({ tx, kayan: name, data }: { tx: unknown; kayan: string; data: Record<string, unknown> }) {
        try {
          return rowsOf(await (tx as Database).insert(tables[name]!).values(increments({ name, values: data, insert: true })).returning(), 'insert')[0]!
        } catch (thrown) {
          throw collision(thrown, name)
        }
      },
      async upsert({ tx, kayan: name, on, data, where }: { tx: unknown; kayan: string; on: readonly string[]; data: Record<string, unknown>; where?: Where }) {
        if (!tx) throw new Error('An upsert requires a transaction.')
        const table = tables[name]!
        const set = Object.fromEntries(Object.entries(increments({ name, values: data })).filter(([field]) => field !== 'id' && !on.includes(field)))
        // Even a key-only upsert returns the existing row, without changing its identity.
        if (!Object.keys(set).length) set[on[0]!] = table[on[0]!]!
        let result: unknown
        try {
          result = await (tx as Database).insert(table).values(increments({ name, values: data, insert: true })).onConflictDoUpdate({ target: on.map((field) => table[field]! as never), set, setWhere: where ? whereOf(tx as Database, name, where) : undefined }).returning()
        } catch (thrown) {
          throw collision(thrown, name)
        }
        const [row] = rowsOf(result, 'upsert')
        if (!row) throw missing({ message: `No "${name}" row found.`, key: 'error.not_found.row', params: { kayan: name } })
        return row
      },
      async update({ tx, kayan: name, id, data, where }: { tx: unknown; kayan: string; id: unknown; data: Record<string, unknown>; where?: Where }) {
        const values = increments({ name, values: data })
        const matched = idWhere({ client: tx as Database, name, id, where })
        let result: unknown
        try {
          // drizzle refuses an empty `set`; a write naming nothing is the row as it is, and the
          // transaction already holds the whole database.
          result = Object.keys(values).length
            ? await (tx as Database).update(tables[name]!).set(values).where(matched).returning()
            : await (tx as Database).select().from(tables[name]!).where(matched)
        } catch (thrown) {
          throw collision(thrown, name)
        }
        const [row] = rowsOf(result, 'update')
        // An update that matched nothing did not happen; an `undefined` row answer would hide it.
        if (!row) throw new Error(`No "${name}" row with id ${String(id)} to update.`)
        return row
      },
      async remove({ tx, kayan: name, id, where }: { tx: unknown; kayan: string; id: unknown; where?: Where }) {
        let result: unknown
        try {
          result = await (tx as Database).delete(tables[name]!).where(idWhere({ client: tx as Database, name, id, where })).returning()
        } catch (thrown) {
          throw referenced(thrown, name)
        }
        const [row] = rowsOf(result, 'delete')
        if (!row) throw new Error(`No "${name}" row with id ${String(id)} to delete.`)
        return row
      },
      async find({ kayan: name, args: { limit, lock, page, sort, where }, tx }: Parameters<Store['find']>[0]) {
        // A transaction on the device holds the whole database, which is every lock a find asks for.
        if (lock && !tx) throw new Error('A locked find requires a transaction.')
        const client = (tx ?? db) as Database
        const table = tables[name]!
        if (!Object.hasOwn(kayanByName.get(name)?.fields ?? getTableColumns(table), sort.field)) throw invalid({ message: `Kayan "${name}" declares no field "${sort.field}".`, key: 'error.invalid.value', params: { kayan: name, field: sort.field } })
        if (kayanByName.get(name)?.fields[sort.field]?.kind === 'decimal') throw refuseDecimalOrder(name, sort.field)
        const condition = where ? whereOf(client, name, where) : undefined
        const direction = sort.direction === 'desc' ? desc : asc
        // The unique id makes page boundaries total.
        const orderBy = [...(table[sort.field] ? [direction(table[sort.field]!)] : []), ...(table.id && sort.field !== 'id' ? [direction(table.id)] : [])]
        const query = client.select().from(table).where(condition).orderBy(...orderBy).$dynamic()
        // SQLite takes no OFFSET without a LIMIT, and -1 is its every row.
        const docs = await query.limit(limit > 0 ? limit : -1).offset(limit > 0 ? (page - 1) * limit : 0)
        const [counted] = await client.select({ totalDocs: sqlCount() }).from(table).where(condition)
        return { docs: docs as Record<string, unknown>[], totalDocs: Number(counted?.totalDocs ?? 0) }
      },
      async sum({ tx, kayan: name, field, where }: Parameters<Store['sum']>[0]) {
        const kind = kayanByName.get(name)?.fields[field]?.kind
        // ponytail: a decimal is refused rather than summed through a float; sum its text in JS, digit by digit, when a device kayan needs one.
        if (kind === 'decimal') throw invalid({ message: `Kayan "${name}" field "${field}" is a decimal, and SQLite sums a decimal as a float, which would round it.`, key: 'error.invalid.value', params: { kayan: name, field } })
        if (kind !== 'integer' && kind !== 'number') throw invalid({ message: `Kayan "${name}" field "${field}" is not numeric, so it cannot be summed.`, key: 'error.invalid.value', params: { kayan: name, field } })
        const client = (tx ?? db) as Database
        // `total` answers 0 over no rows, where `sum` answers null.
        const [row] = await client.select({ total: sql<number>`total(${tables[name]![field]})` }).from(tables[name]!).where(where ? whereOf(client, name, where) : undefined)
        return String(row?.total ?? 0)
      },
      async count({ kayan: name, args: { where }, tx }: Parameters<NonNullable<Store['count']>>[0]) {
        const client = (tx ?? db) as Database
        const [row] = await client.select({ totalDocs: sqlCount() }).from(tables[name]!).where(where ? whereOf(client, name, where) : undefined)
        return Number(row?.totalDocs ?? 0)
      },
    }
  }

  // Each build gets tables of its own, so a refused or renamed kayan of one build is never in the next.
  const built = (kayanList: ResolvedKayan[]) => {
    const tables: Tables = Object.create(null)
    const kayanByName = new Map<string, ResolvedKayan>()
    for (const kayan of kayanList) {
      kayanByName.set(kayan.name, kayan)
      const where = `Kayan "${kayan.name}"`
      if (kayan.schemaName !== undefined && kayan.schemaName !== 'public') throw new Error(`${where} asks for the schema ${JSON.stringify(kayan.schemaName)}, and SQLite has no schemas. Drop schemaName from the kayan.`)
      if (kayan.versions) throw new Error(`${where} keeps versions, and the device store builds no versions table. Drop the versions target's entry from the kayan.`)
      const override = kayan.targets?.[kayan.store] as Tables[string] | undefined
      if (override) {
        tables[kayan.name] = override
        continue
      }
      const columns: Record<string, ColumnBuilderBase> = Object.create(null)
      const declared = Object.values(kayan.fields).filter((field) => field.kind !== 'join')
      // A table reads its own columns first, the timestamps last, as on Postgres.
      const stamp = (field: ResolvedField) => field.name === 'createdAt' || field.name === 'updatedAt'
      for (const field of [...declared.filter((one) => !stamp(one)), ...declared.filter(stamp)]) {
        if (field.rules?.localized) throw new Error(`${where} field "${field.name}" is localized, and the device store holds one column per field. Drop localized from the field.`)
        if (field.hasMany) throw new Error(`${where} field "${field.name}" holds a set of rows, and the device store builds no join table. Point the other kayan at this one instead.`)
        if (field.targets?.[kayan.store]) {
          columns[field.name] = field.targets[kayan.store] as ColumnBuilderBase
          continue
        }
        const build = implementationOf<SqliteColumnBuilder>({ table: kinds, shipped: shippedKinds, name: field.kind, own: field.kindTargets, type: 'drizzle-sqlite' })
        if (!build) throw new Error(`${where} field "${field.name}" is of kind "${field.kind}", which builds no SQLite column. Give the kind a 'drizzle-sqlite' implementation, or keep the field off the device.`)
        let column = build(field, tables) as SqliteModifiable
        if (field.name === 'id') column = (rules.primary as SqliteColumnRule<undefined>)({ column, value: undefined, field })
        for (const [rule, apply] of Object.entries(rules)) {
          if (rule in (field.rules ?? {})) column = (apply as SqliteColumnRule<unknown>)({ column, value: (field.rules as Record<string, unknown>)[rule], field })
        }
        columns[field.name] = column
      }
      // A unique rule's own index over one column is that column's UNIQUE, as on Postgres.
      const ownUnique = (one: CompoundIndex) => uniqueRuleIndexes.has(one) && one.fields.length === 1
      for (const one of kayan.indexes.filter(ownUnique)) columns[one.fields[0]!] = (columns[one.fields[0]!] as SqliteModifiable).unique()
      const indexed = declared.filter((field) => field.rules?.index)
      const compound = kayan.indexes.filter((one) => !ownUnique(one))
      for (const one of compound) {
        // SQLite's unique index reads two nulls as distinct, and has no clause to read them as one.
        if (one.nullsNotDistinct) throw new Error(`${where} asks for a unique index over "${one.fields.join('", "')}" with nullsNotDistinct, which SQLite cannot build. Make its fields required instead.`)
      }
      // Named as drizzle-kit names a Postgres index, since SQLite's index takes a name.
      tables[kayan.name] = sqliteTable(kayan.table, columns, (table) => [
        ...indexed.map((field) => index(`${kayan.table}_${field.column}_index`).on((table as Record<string, never>)[field.name]!)),
        ...compound.map(({ name, fields: [first, ...rest], unique }) => {
          const on = [(table as Record<string, never>)[first!]!, ...rest.map((field) => (table as Record<string, never>)[field]!)] as [never, ...never[]]
          return (unique ? uniqueIndex : index)(name ?? `${kayan.table}_${[first!, ...rest].map((field) => kayan.fields[field]!.column).join('_')}_idx`).on(...on)
        }),
      ]) as Tables[string]
    }
    return { tables, kayanByName }
  }

  const adapterOf = (tables: Tables, kayanByName: Map<string, ResolvedKayan>) => ({
    capability: 'store' as const,
    placement: 'device' as const,
    type: 'drizzle-sqlite' as const,
    idKinds,
    kinds,
    rules,
    db,
    tables,
    ...store(tables, kayanByName),
    init(kayanList: ResolvedKayan[]) {
      const one = built(kayanList)
      return adapterOf(one.tables, one.kayanByName) as unknown as Store
    },
    async connect() {
      // A restricted delete must be enforced even when the host forgot connection setup.
      await db.run(sql`pragma foreign_keys = on`)
      const rows = await db.values<[number]>(sql`pragma foreign_keys`)
      if (rows[0]?.[0] !== 1) throw new Error('The device database did not turn its foreign keys on. Connect outside a transaction.')
    },
    // The app owns the connection lifecycle.
    async destroy() {},
  })
  return adapterOf(Object.create(null), new Map()) as unknown as Omit<SqliteAdapter, 'kinds' | 'rules'> & { kinds: Kinds; rules: Rules }
}

declare module '../../mithaq/rukn.ts' {
  /** A kayan's entry under its device store is its whole table, unbuilt, used as written. */
  interface KayanConfigs<L, F, T> {
    'drizzle-sqlite': SQLiteTable
  }
}
