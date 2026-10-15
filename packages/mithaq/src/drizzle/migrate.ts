import { execFile } from 'node:child_process'
import * as modules from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getTableName, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { getMigrationsToRun } from 'drizzle-orm/migrator.utils'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator'
import { Refusal } from '../mithaq/refusal.ts'
import { createHistory, devPushMarker, historyLock, historyTable, joinTableOf, manyFields, migrationsTable, recordMigration, refuseStrangers, schemaOf, type ProdMigrations, type Tables } from './index.ts'
import type { ResolvedField, ResolvedKayan } from '../mithaq/types.ts'

// `bin.cjs` is not in drizzle-kit's `exports`, so it is resolved as the root entry's
// sibling; resolved from this file, so a consumer gets its own `mithaq`'s copy.
export const binary = fileURLToPath(new URL('bin.cjs', import.meta.resolve('drizzle-kit')))

/**
 * Resolves each drizzle-orm import made under `kit` from `from` instead. drizzle-kit imports
 * drizzle-orm without declaring it, so on its own it loads whatever copy the project hoists,
 * such as a 0.45 beside the one the tables were built with, and fails on it.
 */
export const holdKitOrm = ({ kit, from }: { kit: string; from: string }) =>
  // Node's alone: a runtime without it resolves as it did.
  modules.registerHooks?.({
    resolve: (specifier, context, next) => {
      if (!/^drizzle-orm($|\/)/.test(specifier) || !context.parentURL?.startsWith(kit)) return next(specifier, context)
      // A require is resolved from the requiring file whatever parentURL says, so it is resolved here.
      return context.conditions.includes('require')
        ? { url: pathToFileURL(modules.createRequire(from).resolve(specifier)).href, shortCircuit: true }
        : next(specifier, { ...context, parentURL: from })
    },
  })

/** The drizzle-kit this mithaq installs, and the file its drizzle-orm resolves from. */
export const ownKit = { kit: new URL('.', import.meta.resolve('drizzle-kit')).href, from: import.meta.url }

let ownHeld: unknown
/** Holds this mithaq's drizzle-kit to its own drizzle-orm in this process, once. */
export const holdOwnKit = () => (ownHeld ??= holdKitOrm(ownKit) ?? true)

/**
 * A module to `--import` that holds `kit`'s drizzle-orm to `from`'s in a child process.
 * ponytail: only the drizzle-kit mithaq starts is held; `drizzle-kit migrate` run by hand beside a
 * second drizzle-orm still loads the hoisted one. Ship a `mithaq` word that applies migrations if that bites.
 */
export const kitOrm = (held: { kit: string; from: string }) =>
  `data:text/javascript,${encodeURIComponent(`import { holdKitOrm } from ${JSON.stringify(import.meta.url)}\nholdKitOrm(${JSON.stringify(held)})\n`)}`

const configName = 'drizzle.config.ts'
const schemaName = 'schema.ts'
const hintsName = 'mithaq.hints.json'

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/

// The first line of both written files, so a reader knows what regenerates them.
export const header = '// Written by `mithaq migrate`. Commit it.'

// No `defineConfig`: the loader resolves a config's imports from its own directory,
// which may not reach a workspace-root `drizzle-kit`. Paths come from `import.meta.url`,
// since drizzle-kit resolves a relative `out` against the working directory.
const configSource = (asasFrom: string) => `${header}
import { fileURLToPath } from 'node:url'
import { asas } from '${asasFrom}'

export default {
  dialect: 'postgresql',
  schema: fileURLToPath(new URL('${schemaName}', import.meta.url)),
  out: fileURLToPath(new URL('.', import.meta.url)),
  dbCredentials: { url: asas.targets.drizzle.connectionString },
  migrations: { schema: '${migrationsTable.schema}', table: '${migrationsTable.table}' },
}
`

// Every table named literally: drizzle-kit reads named exports alone, and ESM has no
// dynamic named exports.
const schemaSource = ({ tables, schemas, enums, asasFrom }: {
  tables: string[]
  schemas: string[]
  enums: [key: string, name: string][]
  asasFrom: string
}) => {
  for (const table of tables) {
    if (identifier.test(table)) continue
    throw new Refusal(
      `Kayan "${table}" cannot be a named export of ${schemaName}, and drizzle-kit reads named exports alone, so nothing would migrate its table. Rename the kayan.`,
    )
  }
  return `${header}
// Every table the language built, named one per line. drizzle-kit reads named
// exports alone: an object export contributes no table and reports no changes
// forever, and a partial export still emits foreign keys to the tables it left
// out. \`mithaq migrate\` rewrites this file when a kayan is added or removed.
import { asas } from '${asasFrom}'

export const {
${tables.map((table) => `  ${table},`).join('\n')}
} = asas.targets.drizzle.tables
${schemas.length ? `
// And every schema those tables are in but \`public\`, because drizzle-kit
// reads a schema only from an export and otherwise writes no CREATE SCHEMA
// for it, and once one is written, a DROP SCHEMA.
export const {
${schemas.map((schema) => `  ${schema}: ${schema}Schema,`).join('\n')}
} = asas.targets.drizzle.schemas
` : ''}${enums.length ? `
// And every enum their columns use, in its own schema, because drizzle-kit
// reads an enum only from an export and otherwise writes no CREATE TYPE for it.
export const {
${enums.map(([key, name]) => `  ${JSON.stringify(key)}: ${name},`).join('\n')}
} = asas.targets.drizzle.enums
` : ''}`
}

// An enum in a schema no table is in is refused: no migration would create that schema.
const enumExports = ({ enums, schemas, taken }: {
  enums: Target['enums']
  schemas: string[]
  taken: string[]
}) => {
  const names = new Set(taken)
  return Object.entries(enums).map(([key, one]): [string, string] => {
    const schema = one.schema ?? 'public'
    if (!schemas.includes(schema)) {
      throw new Refusal(`A column uses the enum "${key}", in a schema no kayan is built in, so no migration would create that schema. Build the enum in the schemaName of a kayan.`)
    }
    const name = `${schema}_${one.enumName}Enum`
    if (!identifier.test(name) || names.has(name)) {
      throw new Refusal(`The enum "${key}" cannot be exported from ${schemaName} as ${JSON.stringify(name)}, which is ${names.has(name) ? 'already a name the module exports' : 'not a JavaScript name'}, and drizzle-kit reads an enum only from a named export. Rename the enum.`)
    }
    names.add(name)
    return [key, name]
  })
}

/** One `unresolved` item, and one reply in the hints file, are the same shape. */
type Hint = { type: string; kind: string; entity: string[]; reason?: string }

type Envelope =
  | { status: 'ok'; migration_path?: string; statements?: Statement[] }
  | { status: 'no_changes' }
  | { status: 'missing_hints'; unresolved: Hint[] }
  | { status: 'error'; error: { code: string; source?: string } }

// `recreate_column` drops the column unconditionally, though drizzle's own data-loss guard does not raise it.
type Statement =
  | { type: 'drop_table'; table: { schema: string; name: string } }
  | { type: 'drop_column'; column: { schema: string; table: string; name: string } }
  | { type: 'drop_pk'; pk: { schema?: string; table: string; name: string } }
  | { type: 'drop_view'; view: { schema: string; name: string; materialized?: boolean } }
  | { type: 'recreate_column'; diff: { $right: { schema: string; table: string; name: string } } }
  | { type: string }

type Losing = { kind: 'table' | 'column' | 'primary_key' | 'view'; entity: string[] }

// Every statement type not named here is refused. `drop_check`, `drop_enum` and
// `drop_sequence` lose no row but are asked about by `guardDroppedBy`.
const safe = (type: string) =>
  /^(create|add|rename|move)_/.test(type) ||
  [
    'alter_check',
    'alter_column',
    'alter_enum',
    'alter_policy',
    'alter_rls',
    'alter_role',
    'alter_sequence',
    'alter_unique',
    'drop_fk',
    'drop_index',
    'drop_policy',
    'drop_role',
    'drop_unique',
    'recreate_enum',
    'recreate_fk',
    'recreate_index',
    'recreate_policy',
  ].includes(type)

// A statement passed through unread would be a drop nothing counted rows for.
// An identifier that is not a non-empty string would read as nothing to lose.
export const droppedBy = (statement: Statement): Losing | undefined => {
  // Destructuring a missing container would be a `TypeError` where every other unreadable statement is a sentence.
  const held = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const named = (kind: Losing['kind'], container: unknown, ...keys: string[]): Losing => {
    const entity = keys.map((key) => held(container)[key])
    if (entity.some((part) => typeof part !== 'string' || part === '')) {
      throw new Refusal(
        `drizzle-kit reported a ${statement.type} naming ${JSON.stringify(entity)}, and the data-loss probe cannot ask a database whether that holds rows. Report it with the change that produced it.`,
      )
    }
    return { kind, entity: entity as string[] }
  }
  switch (statement.type) {
    case 'drop_table':
      return named('table', (statement as { table?: unknown }).table, 'schema', 'name')
    case 'drop_column':
      return named('column', (statement as { column?: unknown }).column, 'schema', 'table', 'name')
    // mithaq never drops a schema. A renamed schema would carry another tool's tables with
    // it, so it is refused.
    case 'drop_schema':
      return undefined
    case 'rename_schema': {
      const { from, to } = statement as { from?: { name?: unknown }; to?: { name?: unknown } }
      throw new Refusal(
        `drizzle-kit renames the schema ${String(from?.name)} to ${String(to?.name)}, which would carry every object in ${String(from?.name)} with it, another tool's among them, and mithaq never renames a schema. Reply \`create\` for the schema and \`rename\` for each of the language's tables in ${hintsName}, which moves those tables alone and keeps ${String(from?.name)}.`,
      )
    }
    case 'drop_pk': {
      // drizzle's own default: `statement.pk.schema ?? "public"`.
      const pk = held((statement as { pk?: unknown }).pk)
      return named('primary_key', { ...pk, schema: pk.schema ?? 'public' }, 'schema', 'table', 'name')
    }
    case 'drop_view': {
      // A plain view stores no rows of its own.
      const view = held((statement as { view?: unknown }).view)
      return view.materialized ? named('view', view, 'schema', 'name') : undefined
    }
    case 'recreate_column':
      return named('column', held((statement as { diff?: unknown }).diff).$right, 'schema', 'table', 'name')
  }
  if (safe(statement.type)) return undefined
  throw new Refusal(
    `\`mithaq migrate\` has not measured whether a ${statement.type} statement loses data, and it will not write a migration carrying one nothing counted rows for. Report it with the change that produced it.`,
  )
}

// drizzle-kit writes a `public` table unqualified, so it runs in `current_schema()`;
// asking `"public"."t"` would read another table whenever `search_path` differs.
const tableAt = (schema: string, table: string) =>
  schema === 'public' ? sql.identifier(table) : sql`${sql.identifier(schema)}.${sql.identifier(table)}`

// `SET DATA TYPE … USING` to `numeric(p, s)` or `integer` rounds a value with no error.
const roundedBy = (statement: Statement) => {
  if (statement.type !== 'alter_column') return undefined
  const { diff, to } = statement as { diff?: { type?: { to?: unknown } }; to?: { schema?: unknown; table?: unknown; name?: unknown } }
  const target = diff?.type?.to
  const sized = typeof target === 'string' ? /^numeric\((\d+),\s*(\d+)\)$/.exec(target) : null
  const type = sized ? `numeric(${sized[1]},${sized[2]})` : target === 'integer' ? 'integer' : undefined
  if (!type || typeof to?.table !== 'string' || typeof to.name !== 'string') return undefined
  return { schema: typeof to.schema === 'string' && to.schema ? to.schema : 'public', table: to.table, column: to.name, type }
}

// drizzle renames and moves first and drops or narrows after, so the rows are asked
// about under their name before the run; under the new name they would read as empty.
const storedAs = <At extends { schema: string; table: string; column: string }>(at: At, statements: readonly Statement[]): At => {
  const renamed = statements as readonly { type: string; schema?: unknown; name?: unknown; from?: unknown; to?: unknown }[]
  const column = renamed.find((one) => {
    const to = one.to as { table?: unknown; name?: unknown } | undefined
    return one.type === 'rename_column' && to?.name === at.column && to.table === at.table
  })?.from as { name?: unknown } | undefined
  let { schema, table } = at
  for (const one of [...renamed].reverse()) {
    if (one.type === 'move_table' && one.to === schema && one.name === table && typeof one.from === 'string') schema = one.from
    if (one.type === 'rename_table' && (one.schema ?? 'public') === schema && one.to === table && typeof one.from === 'string') table = one.from
  }
  return { ...at, schema, table, column: typeof column?.name === 'string' ? column.name : at.column }
}

// A value that would round, overflow (`22003`) or read as no number (`22P02`) is counted,
// since the migration would round or stop on it.
const roundedRows = async (db: Database, { schema, table, column, type }: NonNullable<ReturnType<typeof roundedBy>>): Promise<number | 'overflow' | 'unread'> => {
  const cell = sql.identifier(column)
  try {
    const { rows } = await db.execute(
      sql`select count(*)::int as changed from ${tableAt(schema, table)} where ${cell} is not null and ${cell}::${sql.raw(type)} <> ${cell}::numeric`,
    )
    return (rows[0] as { changed: number }).changed
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    // Every folder is applied before a write counts, so a missing table or column was
    // lost outside the migrations and holds nothing to round.
    if (code === '42P01' || code === '42703' || code === '42846') return 0
    if (code === '22003') return 'overflow'
    if (code === '22P02') return 'unread'
    throw error
  }
}

// Postgres refuses NOT NULL over a row holding no value, so those rows are counted
// before anything is written.
const nulledBy = (statement: Statement) => {
  const { type, diff, to, column, isCompositePK } = statement as {
    type: string
    diff?: { notNull?: { to?: unknown }; identity?: { to?: unknown } }
    to?: { schema?: unknown; table?: unknown; name?: unknown }
    column?: { schema?: unknown; table?: unknown; name?: unknown; notNull?: unknown; default?: unknown; identity?: unknown; generated?: unknown; type?: unknown }
    isCompositePK?: unknown
  }
  const at = type === 'alter_column' && diff?.notNull?.to === true && !diff.identity?.to ? to
    : type === 'add_column' && column?.notNull === true && !column.default && !column.identity && !column.generated && !isCompositePK &&
        // drizzle-kit's own test (`bin.cjs` `return /^(?:serial|bigserial|smallserial)$/i.test(type);`).
        !/^(?:serial|bigserial|smallserial)$/i.test(String(column.type)) ? column
    : undefined
  if (typeof at?.table !== 'string' || typeof at.name !== 'string') return undefined
  return { schema: typeof at.schema === 'string' && at.schema ? at.schema : 'public', table: at.table, column: at.name, added: type === 'add_column' }
}

const nulledRows = async (db: Database, { schema, table, column, added }: NonNullable<ReturnType<typeof nulledBy>>) => {
  try {
    const { rows } = await db.execute(
      sql`select count(*)::int as nulled from ${tableAt(schema, table)}${added ? sql`` : sql` where ${sql.identifier(column)} is null`}`,
    )
    return (rows[0] as { nulled: number }).nulled
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    if (code === '42P01' || code === '42703') return 0
    throw error
  }
}

// Postgres refuses a primary key over two rows sharing it.
const keyedBy = (statement: Statement) => {
  if (statement.type !== 'add_pk') return undefined
  const { schema, table, columns } = (statement as { pk?: { schema?: unknown; table?: unknown; columns?: unknown } }).pk ?? {}
  if (typeof table !== 'string' || !Array.isArray(columns) || !columns.length || !columns.every((column) => typeof column === 'string')) return undefined
  return { schema: typeof schema === 'string' && schema ? schema : 'public', table, columns: columns as string[] }
}

const duplicatedRows = async (db: Database, { schema, table, columns }: { schema: string; table: string; columns: string[] }) => {
  try {
    const { rows } = await db.execute(
      sql`select coalesce(sum(held), 0)::int as duplicated from (select count(*) as held from ${tableAt(schema, table)} group by ${sql.join(columns.map((column) => sql.identifier(column)), sql`, `)} having count(*) > 1) as shared`,
    )
    return (rows[0] as { duplicated: number }).duplicated
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    if (code === '42P01' || code === '42703') return 0
    throw error
  }
}

/** An SQL identifier, quoted as Postgres reads one. */
const quotedName = (name: string) => `"${name.replaceAll('"', '""')}"`

/** An SQL string literal. */
const quotedText = (value: string) => `'${value.replaceAll("'", "''")}'`

/** Words in a sentence: `a`, `a and b`, `a, b and c`. */
const listed = (values: readonly string[]) => values.join(', ').replace(/, ([^,]*)$/, ' and $1')

/** A table as a migration names it: bare in `public`, as drizzle-kit writes one. */
const tableNamed = (schema: string, table: string) => (schema === 'public' ? quotedName(table) : `${quotedName(schema)}.${quotedName(table)}`)

// A Payload `<table>_rels` is copied into the kayan's join tables and dropped. Anything
// the copy cannot carry is refused, since the drop would lose it.
const payloadRels = async ({ db, kayan, tables, dropped }: {
  db: Database
  kayan: readonly ResolvedKayan[]
  tables: Tables
  dropped?: (at: { schema: string; table: string }) => boolean
}) => {
  const own = new Set(Object.values(tables).map((table) => `${schemaOf(table)}.${getTableName(table)}`))
  const found: { schema: string; rels: string; kayan: string; copies: { field: string; join: string; column: string }[]; targets: string[]; locale: boolean }[] = []
  for (const one of kayan) {
    if (one.targets?.[one.store]) continue
    const schema = one.schemaName ?? 'public'
    const rels = `${one.table}_rels`
    if (own.has(`${schema}.${rels}`) || (dropped && !dropped({ schema, table: rels }))) continue
    const { rows } = await db.execute(sql`select column_name from information_schema.columns
      where table_schema = ${schema === 'public' ? sql`current_schema()` : schema} and table_name = ${rels}`)
    const columns = (rows as { column_name: string }[]).map((row) => row.column_name)
    if (!columns.includes('path') || !columns.includes('parent_id') || !columns.includes('order')) continue
    // Payload's own foreign key from `parent_id`, which a project's own table does not carry.
    const { rows: [parentKey] } = await db.execute(sql`select count(*)::int as held from pg_catalog.pg_constraint
      join pg_catalog.pg_attribute on attrelid = conrelid and attnum = conkey[1]
      where contype = 'f' and cardinality(conkey) = 1 and attname = 'parent_id' and conname like '%\_fk'
        and conrelid = to_regclass(${tableNamed(schema, rels)}) and confrelid = to_regclass(${tableNamed(schema, one.table)})`)
    if (!(parentKey as { held: number }).held) {
      // A migration reaches this only for tables its snapshot already drops.
      if (!dropped) console.log(`${schema}.${rels} is left alone because it lacks Payload's parent key, a foreign key from parent_id to ${schema}.${one.table} whose name ends in _fk.`)
      continue
    }
    const at = `${schema}.${rels}`
    const from = tableAt(schema, rels)
    const targets = columns.filter((column) => column.endsWith('_id') && column !== 'parent_id')
    const strange = targets.filter((column) => !own.has(`${schema}.${column.slice(0, -'_id'.length)}`))
    if (strange.length) {
      throw new Refusal(
        `${at} has the ${strange.length === 1 ? 'column' : 'columns'} ${strange.join(', ')}, pointing at ${strange.length === 1 ? 'a collection' : 'collections'} no kayan of this language builds in ${schema}, so the baseline would hold a foreign key to a table it never creates. Nothing was written. Port ${strange.length === 1 ? 'that collection' : 'those collections'} as kayan first, or drop the ${strange.length === 1 ? 'column' : 'columns'} once no row uses ${strange.length === 1 ? 'it' : 'them'}.`,
      )
    }
    const copies = manyFields(one).flatMap((field) => {
      const column = `${field.target!.table}_id`
      return targets.includes(column) ? [{ field: field.name, join: joinTableOf(one, field), column }] : []
    })
    const paths = ((await db.execute(sql`select distinct path from ${from} order by path`)).rows as { path: string }[]).map((row) => row.path)
    const unknown = paths.filter((path) => !copies.some((copy) => copy.field === path))
    if (unknown.length) {
      throw new Refusal(
        `${at} holds rows under the ${unknown.length === 1 ? 'path' : 'paths'} ${listed(unknown.map((path) => JSON.stringify(path)))}, which ${unknown.length === 1 ? 'names' : 'name'} no hasMany field of kayan "${one.name}", so the first migration after a baseline would drop them. Nothing was written. Each path of a Payload \`_rels\` table is copied into the join table of the hasMany field it names, and a field nested in a group, an array or a block is none.`,
      )
    }
    if (!copies.length) continue
    const rowsOf = (count: number) => (count === 1 ? '1 row' : `${count} rows`)
    for (const { field, column } of copies) {
      const elsewhere = targets.filter((other) => other !== column)
      const { rows: [counted] } = await db.execute(sql`select
        count(*) filter (where ${elsewhere.length ? sql.join(elsewhere.map((other) => sql`${sql.identifier(other)} is not null`), sql` or `) : sql`false`})::int as elsewhere,
        ${columns.includes('locale') ? sql`count(*) filter (where "locale" is not null)::int` : sql`0`} as localized,
        count(*) filter (where ${sql.identifier(column)} is null or "order" is null)::int as empty,
        (select coalesce(sum(held), 0)::int from (select count(*) as held from ${from} where path = ${field} group by parent_id, "order" having count(*) > 1) as shared) as shared
        from ${from} where path = ${field}`)
      const { elsewhere: other, localized, empty, shared } = counted as { elsewhere: number; localized: number; empty: number; shared: number }
      const target = column.slice(0, -'_id'.length)
      const refused =
        other ? `${rowsOf(other)} under "${field}" that ${other === 1 ? 'points' : 'point'} at a collection other than ${target}, a polymorphic relationship, and a mithaq join table points at one kayan`
        : localized ? `${rowsOf(localized)} under "${field}" with a locale, a localized relationship, and a mithaq join table holds one set for every locale`
        : empty ? `${rowsOf(empty)} under "${field}" with no ${column} or no order, and a join table's columns are NOT NULL`
        : shared ? `${rowsOf(shared)} under "${field}" whose (parent_id, order) another row also holds, and a join table is keyed on the pair`
        : undefined
      if (refused) throw new Refusal(`${at} holds ${refused}. Nothing was written. Fix or delete each such row, and run the command again.`)
    }
    found.push({ schema, rels, kayan: one.name, copies, targets, locale: columns.includes('locale') })
  }
  return found
}

// `drizzle-kit migrate` applies a migration in one transaction, so a failure leaves every
// table as it was. A row the copy would not carry stops it first.
const copyOf = ({ found: { schema, rels, kayan, copies, targets, locale }, drop }: { found: Awaited<ReturnType<typeof payloadRels>>[number]; drop: string }) => {
  const at = (table: string) => tableNamed(schema, table)
  const carried = copies.map(({ field, column }) =>
    `("path" = ${quotedText(field)} AND ${[`${quotedName(column)} IS NOT NULL`, ...targets.filter((other) => other !== column).map((other) => `${quotedName(other)} IS NULL`)].join(' AND ')})`)
  const kept = `(${carried.join(' OR ') || 'FALSE'})${locale ? ' AND "locale" IS NULL' : ''}`
  return [
    `-- Payload's relationship rows, copied into each hasMany field's join table, and then ${rels} dropped
--. A row no field of ${kayan} carries stops the migration first.
DO $$ DECLARE lost integer; BEGIN
  SELECT count(*) INTO lost FROM ${at(rels)} WHERE NOT (${kept});
  IF lost > 0 THEN
    RAISE EXCEPTION '${rels} holds % rows that no hasMany field of ${kayan} carries, under another path, another collection or a locale, and dropping it would lose them. Nothing was applied.', lost;
  END IF;
END $$;`,
    ...copies.map(({ field, join, column }) =>
      `INSERT INTO ${at(join)} ("parent_id", "target_id", "order") SELECT "parent_id", ${quotedName(column)}, "order" FROM ${at(rels)} WHERE "path" = ${quotedText(field)};`),
    drop,
  ]
}

// A `DROP TYPE` fails while a table outside the language still uses the enum.
const enumUsedBy = async ({ db, schema, name, mine }: { db: Database; schema: string; name: string; mine: (pair: string) => boolean }) => {
  const type = tableNamed(schema, name)
  const { rows } = await db.execute(sql`select distinct nspname || '.' || relname as at from pg_catalog.pg_attribute
    join pg_catalog.pg_class on pg_class.oid = attrelid
    join pg_catalog.pg_namespace on pg_namespace.oid = relnamespace
    where attnum > 0 and not attisdropped and relkind in ('r', 'p')
      and atttypid in (to_regtype(${type}), (select typarray from pg_catalog.pg_type where oid = to_regtype(${type})))`)
  return (rows as { at: string }[]).map((row) => row.at).filter((at) => !mine(at)).sort()
}

// The diff is against the last snapshot, so drizzle-kit would create an enum another tool
// already made, and later alter another tool's type.
const heldEnum = async (db: Database, statement: Statement) => {
  if (statement.type !== 'create_enum') return undefined
  const { schema, name } = (statement as { enum?: { schema?: unknown; name?: unknown } }).enum ?? {}
  if (typeof schema !== 'string' || typeof name !== 'string') return undefined
  const { rows } = await db.execute(sql`select array_agg(enumlabel::text order by enumsortorder) as labels from pg_catalog.pg_enum
    join pg_catalog.pg_type on pg_type.oid = enumtypid
    join pg_catalog.pg_namespace on pg_namespace.oid = typnamespace
    where nspname = ${schema === 'public' ? sql`current_schema()` : schema} and typname = ${name}`)
  const [found] = rows as { labels: string[] | null }[]
  return found?.labels ? { schema, name, labels: found.labels } : undefined
}

// A recreated enum casts each column back; a value whose label is gone stops the whole
// migration, so those values are counted first.
const relabeledRows = async (db: Database, statement: Statement) => {
  if (statement.type !== 'recreate_enum') return []
  const { to, columns } = statement as { to?: { values?: unknown }; columns?: { schema?: unknown; table?: unknown; name?: unknown; dimensions?: unknown }[] }
  const values = Array.isArray(to?.values) ? to.values.filter((value): value is string => typeof value === 'string') : []
  const kept = sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`
  const lost: { at: string; count: number }[] = []
  for (const { schema, table, name, dimensions } of columns ?? []) {
    if (typeof table !== 'string' || typeof name !== 'string') continue
    const at = typeof schema === 'string' && schema ? schema : 'public'
    const cell = sql.identifier(name)
    // An array is cast element by element; a null element casts to null.
    const gone = dimensions
      ? sql`exists (select 1 from unnest(${cell}::text[]) as element where element is not null and not (element = any(${kept})))`
      : sql`not (${cell}::text = any(${kept}))`
    try {
      const { rows } = await db.execute(sql`select count(*)::int as lost from ${tableAt(at, table)} where ${gone}`)
      const count = (rows[0] as { lost: number }).lost
      if (count) lost.push({ at: `${at}.${table}.${name}`, count })
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code
      if (code !== '42P01' && code !== '42703') throw error
    }
  }
  return lost
}

/** A guard the database enforces and a migration would drop, in the shape its reply names it. */
type Guarded = { kind: 'check' | 'enum' | 'column' | 'sequence'; entity: string[] }

const guardReply = 'confirm_guard_loss'

// None of these loses a row, but each is a guard on the data no base kind builds, or a
// counter another tool may draw from, so each needs an explicit reply.
export const guardDroppedBy = (statement: Statement): Guarded | undefined => {
  const held = statement as { check?: Record<string, unknown>; enum?: Record<string, unknown>; sequence?: Record<string, unknown>; wasEnum?: unknown; isEnum?: unknown; diff?: { $right?: Record<string, unknown> } }
  const [kind, container, keys]: [Guarded['kind'] | undefined, Record<string, unknown> | undefined, string[]] =
    statement.type === 'drop_check' ? ['check', held.check, ['schema', 'table', 'name']]
    : statement.type === 'drop_enum' ? ['enum', held.enum, ['schema', 'name']]
    : statement.type === 'drop_sequence' ? ['sequence', held.sequence, ['schema', 'name']]
    : statement.type === 'alter_column' && held.wasEnum === true && held.isEnum !== true ? ['column', held.diff?.$right, ['schema', 'table', 'name']]
    : [undefined, undefined, []]
  if (!kind) return undefined
  const entity = keys.map((key) => container?.[key])
  if (entity.some((part) => typeof part !== 'string' || part === '')) {
    throw new Refusal(
      `drizzle-kit reported a ${statement.type} naming ${JSON.stringify(entity)}, and \`mithaq migrate\` cannot name it in a reply. Report it with the change that produced it.`,
    )
  }
  return { kind, entity: entity as string[] }
}

type Database = {
  execute(query: unknown): Promise<{ rows: unknown[] }>
  transaction<T>(run: (tx: { execute(query: unknown): Promise<{ rows: unknown[] }> }) => Promise<T>, config?: { accessMode?: 'read only' }): Promise<T>
}

// `generate` never connects, so it writes `DROP COLUMN` over data unasked; the count is
// taken here. Any failure but `42P01` or `42703` is thrown: no answer is not "empty".
const holdsData = async (db: Database, { kind, entity }: Losing, statements: readonly Statement[]) => {
  const [named, title, part] = entity as [string, string, string]
  // A materialized view is no table a rename or a move names.
  const { schema, table, column } = kind === 'view' ? { schema: named, table: title, column: part } : storedAs({ schema: named, table: title, column: part }, statements)
  const filter = kind === 'column' ? sql`where ${sql.identifier(column)} is not null` : sql``
  try {
    const { rows } = await db.execute(sql`select 1 from ${tableAt(schema, table)} ${filter} limit 1`)
    return rows.length > 0
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    if (code === '42P01' || code === '42703') return false
    throw error
  }
}

/** A Postgres regular expression true of a value JavaScript's `trim` leaves empty; `btrim` strips spaces alone. */
const blank = String.raw`^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$`

// Only predicates SQL can judge exactly as the schema does: no `pattern`, no transform.
// Length is JavaScript's UTF-16 count, `char_length` plus one per astral character.
const refusals = (field: ResolvedField, column: SQLWrapper) => {
  const rules = (field.rules ?? {}) as Record<string, unknown>
  const transform = ['trim', 'uppercase', 'lowercase'].find((rule) => rules[rule])
  const values = field.options?.map((option) => option.value) ?? []
  const length = sql`(char_length(${column}) + regexp_count(${column}, '[\\U00010000-\\U0010FFFF]'))`
  const count = sql`cardinality(${column})`
  const listed = sql.join(values.map((value) => sql`${value}`), sql`, `)
  const judged: Record<string, SQL | false> = {
    // Under `trim` a value that trims to empty is refused too.
    required: rules.required === true &&
      (field.kind !== 'text' ? sql`${column} is null`
        : rules.trim === true ? sql`(${column} is null or ${column} ~ ${blank})`
        : sql`(${column} is null or ${column} = '')`),
    minLength: typeof rules.minLength === 'number' && sql`${length} < ${rules.minLength}`,
    maxLength: typeof rules.maxLength === 'number' && sql`${length} > ${rules.maxLength}`,
    min: rules.min !== undefined && sql`${column} < ${rules.min}`,
    max: rules.max !== undefined && sql`${column} > ${rules.max}`,
    // An empty list passes the floor unless the field is required.
    minRows: typeof rules.minRows === 'number' &&
      (rules.required === true ? sql`${count} < ${rules.minRows}` : sql`${count} between 1 and ${rules.minRows - 1}`),
    maxRows: typeof rules.maxRows === 'number' && sql`${count} > ${rules.maxRows}`,
    options: values.length > 0 &&
      (field.kind === 'textArray' ? sql`not (${column} <@ array[${listed}]::text[])` : sql`${column} not in (${listed})`),
  }
  const counted: [string, SQL][] = []
  const notCounted = rules.pattern ? ['pattern'] : []
  for (const [rule, test] of Object.entries(judged)) {
    if (!test) continue
    if (transform && ['minLength', 'maxLength', 'options'].includes(rule)) notCounted.push(`${rule} (${transform})`)
    else counted.push([rule, test])
  }
  return { counted, notCounted }
}

// Counts only, so no value leaves the database, in a read-only transaction under a
// `statement_timeout`; a table that times out is listed and the run goes on.
const refusedRows = async (db: Database, kayanList: readonly ResolvedKayan[]) => {
  const given = process.env.MITHAQ_COUNT_TIMEOUT_MS ?? ''
  const timeout = /^[1-9]\d*$/.test(given) ? given : '5000'
  // `'public'` means what no key means, so both read `current_schema()`.
  const schemaIn = ({ schemaName }: ResolvedKayan) => (schemaName === 'public' ? undefined : schemaName)
  const named = [...new Set(kayanList.flatMap((kayan) => schemaIn(kayan) ?? []))]
  const { rows } = await db.execute(
    sql`select table_schema = current_schema() as current, table_schema, table_name, column_name from information_schema.columns
      where table_schema = current_schema()${named.length ? sql` or table_schema in (${sql.join(named.map((name) => sql`${name}`), sql`, `)})` : sql``}`,
  )
  const held = new Set((rows as { current: boolean; table_schema: string; table_name: string; column_name: string }[]).flatMap((row) => [
    `${row.table_schema}.${row.table_name}.${row.column_name}`,
    ...(row.current ? [`.${row.table_name}.${row.column_name}`] : []),
  ]))
  const notCounted: string[] = []
  for (const kayan of kayanList) {
    // A table the project built by hand has columns this command cannot name.
    if (kayan.targets?.[kayan.store]) continue
    const checks: { field: string; rule: string; test: SQL }[] = []
    for (const field of Object.values(kayan.fields)) {
      if (field.hasMany || field.kind === 'join' || field.targets?.[kayan.store]) continue
      const columns = field.rules?.localized ? field.locales!.map((locale) => `${field.column}_${locale}`) : [field.column]
      const stored = columns.filter((column) => held.has(`${schemaIn(kayan) ?? ''}.${kayan.table}.${column}`))
      if (!stored.length) continue
      // A row breaks a localized field's rule when any of its locales does.
      const byRule = new Map<string, SQL[]>()
      for (const column of stored) {
        const { counted, notCounted: left } = refusals(field, sql.identifier(column))
        for (const [rule, test] of counted) byRule.set(rule, [...(byRule.get(rule) ?? []), test])
        if (column === stored[0]) notCounted.push(...left.map((rule) => `${kayan.name}.${field.name} ${rule}`))
      }
      for (const [rule, tests] of byRule) checks.push({ field: field.name, rule, test: sql.join(tests, sql` or `) })
    }
    if (!checks.length) continue
    const query = sql`select ${sql.join(checks.map((check, index) => sql`count(*) filter (where ${check.test}) as ${sql.identifier(`c${index}`)}`), sql`, `)} from ${tableAt(schemaIn(kayan) ?? 'public', kayan.table)}`
    let counted: { rows: unknown[] }
    try {
      // `set_config` with `true` is `SET LOCAL`, which takes no parameter.
      counted = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('statement_timeout', ${timeout}, true)`)
        return tx.execute(query)
      }, { accessMode: 'read only' })
    } catch (error) {
      // `57014` is postgres's query_canceled, which the timeout raises.
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code
      if (code !== '57014') throw error
      notCounted.push(`${kayan.name} (timed out after ${timeout} ms)`)
      continue
    }
    const [answer] = counted.rows as Record<string, string | number>[]
    const byField = new Map<string, string[]>()
    checks.forEach((check, index) => {
      const count = Number(answer?.[`c${index}`] ?? 0)
      if (!count) return
      const parts = byField.get(check.field) ?? []
      parts.push(parts.length
        ? `${count} ${count === 1 ? 'breaks' : 'break'} ${check.rule}`
        : `${count} stored ${count === 1 ? 'row breaks' : 'rows break'} ${check.rule}`)
      byField.set(check.field, parts)
    })
    for (const [field, parts] of byField) {
      console.log(`${kayan.name}.${field}: ${parts.join(', ')}. Each is refused on its next save until it complies.`)
    }
  }
  if (notCounted.length) {
    console.log(`Not counted, since SQL cannot judge them the way the schema does: ${notCounted.join(', ')}.`)
  }
}

// Pushed tables are nobody's migration: the first migration over them would create
// every table again. `42P01` covers a missing `drizzle` schema as well as a missing table.
const pushed = async (db: Database) => {
  try {
    const { rows } = await db.execute(
      sql`select bool_or(name = ${devPushMarker}) as marker, bool_or(name is distinct from ${devPushMarker}) as others from ${historyTable}`,
    )
    // An empty table answers both `null`, which is neither.
    const [found] = rows as { marker?: boolean | null; others?: boolean | null }[]
    return { marker: found?.marker === true, others: found?.others === true }
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '42P01') return { marker: false, others: false }
    throw error
  }
}

// Folder rows provably this project's (name and hash match a folder) are copied from
// drizzle's default table on every run, or drizzle would run a stranded migration twice.
// Nothing in the default table is changed; an ambiguous hash stops the run.
const moveHistory = async ({ db, directory, check }: { db: Database; directory: URL; check: boolean }): Promise<number | string[] | undefined> => {
  const codeOf = (error: unknown) => (error as { cause?: { code?: string } }).cause?.code
  // `undefined` while mithaq's table is not there, which no query may name.
  let empty: boolean | undefined
  try {
    empty = !(await db.execute(sql`select 1 from ${historyTable} limit 1`)).rows.length
  } catch (error) {
    if (codeOf(error) !== '42P01') throw error
  }
  let own: { name: string; hash: string }[] = []
  try {
    own = readMigrationFiles({ migrationsFolder: fileURLToPath(directory) })
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }
  const movable = empty === false ? own : [{ name: devPushMarker, hash: devPushMarker }, ...own]
  if (!movable.length) return
  const pairs = sql.join(movable.map(({ name, hash }) => sql`(${name}, ${hash})`), sql`, `)
  const names = sql.join(own.map(({ name }) => sql`${name}`), sql`, `)
  const missing = empty === undefined ? sql`` : sql`and not exists (select 1 from ${historyTable} as own where own.name = old.name)`
  const mine = sql`(old.name, old.hash) in (${pairs}) ${missing}`
  let rows: unknown[]
  let other: string[]
  try {
    rows = (await db.execute(sql`select old.name from drizzle.__drizzle_migrations as old where ${mine}`)).rows
    other = own.length
      ? ((await db.execute(sql`select distinct old.name from drizzle.__drizzle_migrations as old
          where old.name in (${names}) ${missing} and not exists (
            select 1 from drizzle.__drizzle_migrations as same where same.name = old.name and (same.name, same.hash) in (${pairs}))`)).rows as { name: string }[]).map((row) => row.name)
      : []
  } catch (error) {
    if (codeOf(error) === '42P01' || codeOf(error) === '42703') return
    throw error
  }
  const history = `${migrationsTable.schema}.${migrationsTable.table}`
  if (other.length) {
    console.error(
      `drizzle.__drizzle_migrations holds ${other.join(', ')} under a folder's name and with another hash, so this run cannot prove the row is this project's and moves nothing into ${history}. The checkout's migration.sql differs from the one applied, by its line endings or its text, and drizzle matches a migration by name alone, so \`drizzle-kit migrate\` through a config naming ${history} would run it again. Compare that folder with the applied migration, then either move the row by hand or restore the folder's bytes to the ones applied, and run \`mithaq migrate\` again.`,
    )
    return check ? 1 : 2
  }
  if (!rows.length) return undefined
  const count = `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`
  if (check) {
    console.log(
      `${count} of this project's migration history ${rows.length === 1 ? 'sits' : 'sit'} in drizzle.__drizzle_migrations and not in ${history}, where mithaq keeps it. Run \`mithaq migrate\` against this database, before the next \`drizzle-kit migrate\` through a config naming ${history}.`,
    )
    return (rows as { name: string }[]).map((row) => row.name)
  }
  await createHistory(db)
  const moved = await db.execute(sql`insert into ${historyTable} (hash, created_at, name, applied_at)
    select hash, created_at, name, applied_at from drizzle.__drizzle_migrations as old
    where (old.name, old.hash) in (${pairs}) and not exists (select 1 from ${historyTable} as own where own.name = old.name)
    order by old.id returning name`)
  console.log(
    `Copied ${moved.rows.length} ${moved.rows.length === 1 ? 'row' : 'rows'} of this project's history from drizzle.__drizzle_migrations into ${history}, where mithaq keeps it now. The rows in drizzle.__drizzle_migrations are left as they were.`,
  )
}

const migrationsIn = (directory: URL): ReturnType<typeof readMigrationFiles> => {
  try {
    return readMigrationFiles({ migrationsFolder: fileURLToPath(directory) })
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
    return []
  }
}

// drizzle's own rule, which matches a folder to a row by `name` alone.
const unapplied = async ({ db, directory }: { db: Database; directory: URL }) => {
  const localMigrations = migrationsIn(directory)
  if (!localMigrations.length) return []
  let dbMigrations: Parameters<typeof getMigrationsToRun>[0]['dbMigrations'] = []
  try {
    dbMigrations = (await db.execute(sql`select id, hash, created_at, name from ${historyTable}`)).rows as typeof dbMigrations
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code !== '42P01') throw error
  }
  return getMigrationsToRun({ localMigrations, dbMigrations })
}

// One transaction for every pending folder, so a failure applies none, under an advisory
// lock so a second instance booting at once applies nothing.
export const bootMigrations = async ({ db, prodMigrations }: { db: NodePgDatabase; prodMigrations: ProdMigrations | undefined }) => {
  if (!prodMigrations) {
    throw new Refusal(
      "A production connect() needs prodMigrations on drizzleAdapter, which says what a boot does with a migration this database has not applied: { migrationsFolder, pending: 'run' } applies every pending one before serving, and { migrationsFolder, pending: 'refuse' } refuses to start while one is pending. Nothing was checked or applied.",
    )
  }
  const { migrationsFolder, pending } = prodMigrations
  // A folder without the config is not the project's, and would read as nothing pending.
  if (!existsSync(join(migrationsFolder, configName))) {
    throw new Refusal(
      `prodMigrations names ${migrationsFolder} as the migrations folder, and under ${process.cwd()} it holds no ${configName}, which every folder \`mithaq migrate\` writes holds, so this boot cannot tell which migrations this database has applied. Ship the folder with the deploy, or name where it is. Nothing was checked or applied.`,
    )
  }
  const directory = pathToFileURL(`${resolvePath(migrationsFolder)}/`)
  // A new project's folder holds the config and no migration, which would read as nothing pending.
  if (!migrationsIn(directory).length) {
    throw new Refusal(
      `prodMigrations names ${migrationsFolder}, which holds no migration yet, so a production boot would serve a database nothing built. Write the first with \`mithaq migrate --name init\` against an empty database, ship it, and start again. Nothing was checked or applied.`,
    )
  }
  const history = `${migrationsTable.schema}.${migrationsTable.table}`
  // Read from mithaq's table alone, an unmoved history says nothing was applied.
  if ((await moveHistory({ db, directory, check: true })) !== undefined) {
    throw new Refusal(
      `This database's migration history is in drizzle.__drizzle_migrations, not in ${history}, where mithaq reads it, so a production boot cannot tell which migrations it has applied. Run \`mithaq migrate\` against this database once, which moves the history, and start again. Nothing was applied.`,
    )
  }
  // A pushed database's history names no migration, so every folder would read as pending.
  if ((await pushed(db)).marker) {
    throw new Refusal(
      `This database carries mithaq's dev-push marker, the row named ${devPushMarker} in ${history}: a development connect() pushed its schema rather than migrating it, so its history says nothing about its tables, and a production boot neither checks nor applies migrations over it. Point DATABASE_URL at a database built from the migrations, or run \`mithaq migrate --baseline\` against this one to record what the push built as its baseline. Nothing was applied.`,
    )
  }
  if (pending === 'run') {
    // drizzle's migrator reads the history before its own transaction, so two boots would
    // both apply a folder; the lock holds until this transaction ends.
    await db.transaction(async (tx) => {
      await tx.execute(historyLock)
      await applyMigrations(tx as unknown as NodePgDatabase, { migrationsFolder, migrationsSchema: migrationsTable.schema, migrationsTable: migrationsTable.table })
    })
    return
  }
  const behind = await unapplied({ db, directory })
  if (!behind.length) return
  const names = behind.map((migration) => migration.name)
  throw new Refusal(
    `This database has not applied ${names.join(', ')}. prodMigrations refuses a production boot while a migration is pending, so nothing was served and nothing was written. Apply ${names.length === 1 ? 'it' : 'them'} with the installed binary, \`drizzle-kit migrate --config ${join(migrationsFolder, configName)}\`, and start again.`,
  )
}

// stdout alone is parsed: stderr carries import-time warnings, never the envelope.
const kit = (cwd: string, argv: string[]) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((done, fail) => {
    // Node's 1 MB default `maxBuffer` kills a child past it, and the envelope grows with the
    // migration. Without an `error` listener a child that cannot spawn hangs the command.
    const child = execFile(process.execPath, ['--import', kitOrm(ownKit), binary, ...argv], { cwd, maxBuffer: 64 * 1024 * 1024 })
    let stdout = ''
    let stderr = ''
    // Decoded by the stream, so a multibyte character split across chunks stays whole.
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', fail)
    // The signal too, since a child killed from outside closes with no code.
    child.on('close', (code, signal) => done({ code, signal, stdout, stderr }))
  })

const envelopeOf = async (cwd: string, argv: string[]): Promise<Envelope> => {
  const { code, signal, stdout, stderr } = await kit(cwd, argv)
  try {
    return JSON.parse(stdout.trim()) as Envelope
  } catch {
    throw new Refusal(
      `\`drizzle-kit ${argv[0]}\` ${signal ? `was killed by ${signal}` : `exited ${code}`} without printing an envelope. It said:\n${stderr.trim() || stdout.trim()}`,
    )
  }
}

type Pulled =
  | { status: 'ok'; migrationPath: string; snapshotPath: string }
  | { status: 'error'; error: { code: string; source?: string } }

/** What drizzle-kit writes between two statements, and what its migrator splits on. */
const breakpoint = '--> statement-breakpoint'

// `CREATE SCHEMA` becomes `IF NOT EXISTS` and `DROP SCHEMA` a comment, so another tool's
// schema is never harmed. An unexpected count of either leaves the file unrewritten.
const keptSchemas = ({ text, expected }: { text: string; expected: { created: number; dropped: number } }) => {
  let created = 0
  let dropped = 0
  const rewritten = text
    .replace(/^CREATE SCHEMA ("[^"]+");$/gm, (_line, name: string) => {
      created += 1
      return `CREATE SCHEMA IF NOT EXISTS ${name};`
    })
    .replace(/^DROP SCHEMA ("[^"]+");$/gm, (_line, name: string) => {
      dropped += 1
      return `-- mithaq never drops a schema: ${name} is kept.`
    })
  return created === expected.created && dropped === expected.dropped ? rewritten : undefined
}

// Pull writes its SQL commented out, which `drizzle-kit migrate` cannot apply; only the
// measured shape is uncommented. A pulled table the kayan do not name would be dropped next.
export const baselineOf = ({ envelope, read, tables }: {
  envelope: Pulled
  read: (path: string) => string
  /** The language's tables as `<schema>.<name>`. */
  tables: readonly string[]
}) => {
  if (envelope.status === 'error') throw new Refusal(said(envelope.error))
  const stamp = /(\d{14})_[^/\\]+[/\\]migration\.sql$/.exec(envelope.migrationPath ?? '')?.[1]
  const lines = stamp ? read(envelope.migrationPath).split('\n') : []
  const statements = lines.slice(3, -1).join('\n')
  if (
    lines.length < 4 || !lines[0]!.startsWith('-- ') || !lines[1]!.startsWith('-- ') || lines[2] !== '/*' ||
    lines.at(-1) !== '*/' || /\/\*|\*\//.test(statements)
  ) {
    throw new Refusal(
      'drizzle-kit pull wrote a migration.sql in a shape `--baseline` has not measured, which is two comment lines and then the statements inside one `/*` and `*/`, so it cannot be uncommented exactly. Nothing was written. Report it with the drizzle-kit version that wrote it.',
    )
  }
  // The pull brings every standalone sequence and enum in `public`, which the next migration
  // would drop; each one no pulled column uses is left out.
  const parsed = JSON.parse(read(envelope.snapshotPath)) as { ddl?: { entityType?: string; schema?: string; name?: string; table?: string; type?: string; typeSchema?: string | null; materialized?: boolean }[] }
  const ddl = parsed.ddl ?? []
  const used = new Set(ddl.filter((entry) => entry.entityType === 'columns').map((column) => `${column.typeSchema ?? 'public'}.${column.type}`))
  const left = ddl.filter((entry) =>
    entry.entityType === 'sequences' || (entry.entityType === 'enums' && !used.has(`${entry.schema}.${entry.name}`)))
  let chunks = statements.split(breakpoint)
  for (const entry of left) {
    const word = entry.entityType === 'enums' ? 'TYPE' : 'SEQUENCE'
    const heads = [`CREATE ${word} ${quotedName(entry.schema ?? '')}.${quotedName(entry.name ?? '')} `]
    if (entry.schema === 'public') heads.push(`CREATE ${word} ${quotedName(entry.name ?? '')} `)
    const matched = chunks.filter((chunk) => heads.some((head) => chunk.trimStart().startsWith(head)))
    if (matched.length !== 1) {
      throw new Refusal(
        `drizzle-kit pull returned the ${entry.entityType === 'enums' ? 'enum' : 'sequence'} ${entry.schema}.${entry.name}, which no kayan column uses, and \`--baseline\` cannot find the one statement that creates it to leave out. Nothing was written. Report it with the drizzle-kit version that pulled it.`,
      )
    }
    chunks = chunks.filter((chunk) => chunk !== matched[0])
  }
  const pulledSql = left.length ? chunks.join(breakpoint).trimStart() : statements
  const kept = keptSchemas({ text: pulledSql, expected: { created: ddl.filter((entry) => entry.entityType === 'schemas' && entry.name !== 'public').length, dropped: 0 } })
  if (kept === undefined) {
    throw new Refusal(
      'drizzle-kit pull wrote a migration.sql whose CREATE SCHEMA lines are not one for each schema its snapshot holds, so `--baseline` cannot make each one keep the schema. Nothing was written. Report it with the drizzle-kit version that wrote it.',
    )
  }
  const snapshot = left.length
    ? JSON.stringify({ ...parsed, ddl: ddl.filter((entry) => !left.includes(entry)) }, null, 2)
    : read(envelope.snapshotPath)
  const views = ddl.filter((entry) => entry.entityType === 'views')
  if (views.length) {
    throw new Refusal(
      `drizzle-kit pull returned the ${views.map((view) => `${view.materialized ? 'materialized view' : 'view'} ${view.schema}.${view.name}`).join(', ')}, named like a table of this language, and no kayan builds a view, so the first migration after a baseline would drop it. Rename the kayan's table, or move the view. Nothing was written.`,
    )
  }
  const pulled = ddl.filter((entry) => entry.entityType === 'tables')
  const outside = pulled.filter((table) => !tables.includes(`${table.schema}.${table.name}`))
  if (outside.length) {
    throw new Refusal(
      `drizzle-kit pull returned ${outside.map((table) => `${table.schema}.${table.name}`).join(', ')}, which no kayan of this language names, and the first migration after a baseline would drop it. \`--baseline\` adopts the language's own tables and never another. Nothing was written. Report it with the drizzle-kit version that pulled it.`,
    )
  }
  if (!pulled.length) {
    throw new Refusal(
      `This database holds none of the ${tables.length} tables this language builds, so there is nothing to adopt. Run \`mithaq migrate\`.`,
    )
  }
  return { folder: `${stamp}_baseline`, sql: kept, snapshot }
}

// No DDL runs and no row is read or written. `pull --init` is not used: it inserts its
// row before any check here could refuse. The folder is removed if the row fails.
const baseline = async ({ cwd, directory, configPath, db, tables, kayan }: {
  cwd: string
  directory: URL
  configPath: string
  db: Database
  tables: Tables
  kayan: readonly ResolvedKayan[]
}) => {
  // Before the pull, which would otherwise bring in another tool's table of a shared name.
  await refuseStrangers({ db, tables, by: 'baseline' })
  // Pulled with the join tables, so the migration after the baseline copies its rows.
  const adopted = await payloadRels({ db, kayan, tables })
  const built = Object.values(tables)
  const tableNames = [...built.map((table) => getTableName(table)), ...adopted.map(({ rels }) => rels)]
  // Every schema the language uses, `public` only when some table is there.
  const schemaFilter = [...new Set(built.map(schemaOf))]
  const scratch = await mkdtemp(join(tmpdir(), 'mithaq-baseline-'))
  try {
    const config = join(scratch, configName)
    await writeFile(
      config,
      `import base from ${JSON.stringify(configPath)}\nexport default { ...base, out: ${JSON.stringify(join(scratch, 'out'))}, schemaFilter: ${JSON.stringify(schemaFilter)}, tablesFilter: ${JSON.stringify(tableNames)} }\n`,
    )
    const pulled = (await envelopeOf(cwd, ['pull', '--output', 'json', '--config', config])) as unknown as Pulled
    const pairs = [...built.map((table) => `${schemaOf(table)}.${getTableName(table)}`), ...adopted.map(({ schema, rels }) => `${schema}.${rels}`)]
    const { folder, sql: statements, snapshot } = baselineOf({ envelope: pulled, read: (path) => readFileSync(path, 'utf8'), tables: pairs })
    const written = new URL(`${folder}/`, directory)
    await mkdir(written)
    try {
      await writeFile(new URL('migration.sql', written), statements)
      await writeFile(new URL('snapshot.json', written), snapshot)
      // The hash and time drizzle's migrator computes for the folder, which it matches the row against.
      const migration = readMigrationFiles({ migrationsFolder: fileURLToPath(directory) }).find((one) => one.name === folder)!
      await recordMigration({ db, hash: migration.hash, createdAt: migration.folderMillis, name: migration.name })
    } catch (error) {
      await rm(written, { recursive: true, force: true })
      throw error
    }
    console.log(`Recorded ${folder} as this database's baseline. Run \`mithaq migrate --check\` to see what the kayan change.`)
    for (const { schema, rels, copies } of adopted) {
      console.log(`${schema}.${rels} holds Payload's relationship rows for ${listed(copies.map(({ field }) => field))}, which the next \`mithaq migrate\` copies into ${listed(copies.map(({ join }) => join))} before it drops ${schema}.${rels}.`)
    }
    return 0
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

// An `ok` listing no statements is refused: an answer that did not come is not "nothing".
export const statementsOf = (envelope: Envelope): Statement[] => {
  if (envelope.status === 'no_changes') return []
  if (envelope.status === 'ok' && envelope.statements?.length) return envelope.statements
  throw new Refusal(
    `\`drizzle-kit generate --explain\` answered ${envelope.status} without listing its statements, so the data-loss guard has nothing to count rows for and this run writes nothing.`,
  )
}

// Never `issues`: a rejected hints file comes back as a 9 KB union tree on one line.
const said = (error: { code: string; source?: string }) =>
  `drizzle-kit refused: ${error.code}${error.source ? ` (source: ${error.source})` : ''}`

const unresolvedLine = (item: Hint) => `${item.kind} ${item.entity.join('.')} ${item.reason ?? item.type}`

const answered = (hint: { kind: string; entity: string[] }) =>
  JSON.stringify(['confirm_data_loss', hint.kind, hint.entity])

// Reached only for a file this command wrote, so a failure here is that file's own.
const namesOf = async (schemaFile: URL) => {
  try {
    return Object.keys((await import(schemaFile.href)) as object)
      .filter((name) => name !== 'default')
      .sort()
  } catch {
    return undefined
  }
}

const shortOf = ({
  configHeld,
  exported,
  tables,
  schemas,
  enums,
  directory,
}: {
  configHeld: string | undefined
  exported: string[] | undefined
  tables: string[]
  schemas: string[]
  enums: string[]
  directory: URL
}) => {
  if (configHeld === undefined) {
    return `${configName} under ${directory.href} is not what a run would write: it is not there. Run \`mithaq migrate\`.`
  }
  if (exported === undefined) {
    return `${schemaName} under ${directory.href} is not what a run would write: it is not there, or it does not load. Run \`mithaq migrate\`.`
  }
  const missing = [...tables, ...schemas, ...enums].filter((table) => !exported.includes(table)).sort()
  return `${schemaName} under ${directory.href} is not what a run would write: it exports ${exported.length} ${exported.length === 1 ? 'name' : 'names'} and the language built ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}${schemas.length ? ` in ${schemas.length} ${schemas.length === 1 ? 'schema' : 'schemas'} besides public` : ''}${enums.length ? ` using ${enums.length} ${enums.length === 1 ? 'enum' : 'enums'}` : ''}${missing.length ? `, missing ${missing.join(', ')}` : ''}. drizzle-kit reads named exports alone, so a run would report no changes over the tables it cannot see. Run \`mithaq migrate\`.`
}

// Handed over by the target that declares the command, not read back off `asas.targets.drizzle`.
type Target = { db: Database; tables: Record<string, unknown>; schemas: Record<string, unknown>; enums: Record<string, { schema?: string; enumName: string; enumValues: string[] }>; connectionString?: string; kayan: readonly ResolvedKayan[] }

// A check writes nothing and answers 0 for no changes, 1 for a pending migration or a
// failure, and 2 for a decision only the project can make.
export const run = async ({
  target,
  flags,
}: {
  target: Target
  flags: readonly string[]
}): Promise<number> => {
  const check = flags.includes('--check')
  const adopt = flags.includes('--baseline')
  // The slug becomes part of the migration folder's path, so only a plain name passes.
  const at = flags.indexOf('--name')
  const name = at === -1 ? undefined : flags[at + 1]
  if (at !== -1 && !/^[a-z0-9_]{1,64}$/.test(name ?? '')) {
    throw new Refusal(
      `\`--name\` takes a slug of lowercase letters, digits and underscores, 1 to 64 characters, such as \`mithaq migrate --name center_feedback\`, and was handed ${name === undefined ? 'nothing' : JSON.stringify(name)}. Nothing was written.`,
    )
  }
  if (adopt && at !== -1) {
    throw new Refusal(
      '`--baseline` names its folder `_baseline` after the timestamp, so `--name` has nothing to name. Run `mithaq migrate --baseline` alone. Nothing was written.',
    )
  }
  if (adopt && check) {
    throw new Refusal(
      '`--baseline` records a baseline and `--check` writes nothing, so the two do not run together. Run `mithaq migrate --baseline`, and then `mithaq migrate --check` to see what the kayan change.',
    )
  }
  const project = pathToFileURL(`${process.cwd()}/`)
  const { generate } = (await import(new URL('src/mithaq.ts', project).href)) as {
    generate?: { migrations?: string }
  }
  const directory = new URL(generate?.migrations ?? 'src/migrations/', project)
  // The config drizzle-kit applies through and the probe that counts rows use one string,
  // so a drop is never counted on one database and applied to another. A check needs none.
  const { connectionString } = target
  const ready = typeof connectionString !== 'string' || connectionString === ''
  if (ready && !check) {
    throw new Refusal(
      'This language built its drizzle target from a ready client, and `mithaq migrate` needs the connection string itself: drizzle-kit reads a config, and a config cannot take a live client. Build the target with `connectionString`, or run `drizzle-kit` against a config this project writes.',
    )
  }
  // A pool of its own, so the probe reads the database the config names.
  const own = ready ? undefined : drizzle(connectionString as string)
  const db = (own ?? target.db) as Database
  const tables = Object.keys(target.tables)
  const schemas = Object.keys(target.schemas)
  try {
    // Never the answer: a count that could not be taken is said on stderr.
    await refusedRows(db, target.kayan).catch((error: unknown) =>
      console.error(`The stored rows the rules would refuse could not be counted: ${(error as Error).message}`))
    return await migrate({ project, directory, db, connectionString: ready ? undefined : connectionString, tables, built: target.tables as Tables, schemas, enums: target.enums, check, adopt, kayan: target.kayan, name })
  } finally {
    // In a `finally`: a refusal is a throw, and an escaped one would leave the pool open.
    try {
      await own?.$client.end()
    } catch {
      // A pool already ended, which a refusal thrown mid-probe can leave.
    }
  }
}

const migrate = async ({
  project,
  directory,
  db,
  connectionString,
  tables,
  built,
  schemas,
  enums,
  check,
  adopt,
  kayan,
  name,
}: {
  project: URL
  directory: URL
  db: Database
  /** Absent only under a check of a language built from a ready client. */
  connectionString: string | undefined
  tables: string[]
  built: Tables
  schemas: string[]
  enums: Target['enums']
  check: boolean
  adopt: boolean
  kayan: readonly ResolvedKayan[]
  /** The slug drizzle-kit names the written folder after; absent, it picks one. */
  name: string | undefined
}): Promise<number> => {
  // Before anything is written: every answer below assumes the tables are the migrations'.
  // A check is refused only for a marker beside a migration's row; a baseline replaces a lone marker.
  const stopped = await moveHistory({ db, directory, check })
  if (typeof stopped === 'number') return stopped
  const history = `${migrationsTable.schema}.${migrationsTable.table}`
  // Rows still in drizzle's default table are read as moved, so a check does not tell a
  // pushed database to apply folders the push already built.
  const found = await pushed(db)
  const marker = found.marker || !!stopped?.includes(devPushMarker)
  const others = found.others || !!stopped?.some((name) => name !== devPushMarker)
  if (adopt && others) {
    throw new Refusal(
      `${history} already holds migration rows, so this database already has a history and a baseline would sit beside it. \`--baseline\` adopts a database whose history is empty or holds only the dev-push marker.`,
    )
  }
  if (marker && !adopt && (!check || others)) {
    console.error(
      `\`connect()\` pushed this schema rather than migrating it, so this database carries mithaq's dev-push marker and its tables belong to no migration. A migration written now would recreate every one of them. Run \`mithaq migrate --baseline\` to record what the push built as this database's baseline, which replaces the marker. Where ${history} holds migration rows beside the marker, a baseline is refused; delete the row named ${devPushMarker} there instead.`,
    )
    return 2
  }
  if (marker && !adopt) {
    const markedIn = found.marker ? history : 'drizzle.__drizzle_migrations'
    console.log(
      `This database carries mithaq's dev-push marker, the row named ${devPushMarker} in ${markedIn}, so \`connect()\` pushed its schema rather than migrating it, and this run skipped the check of the migration files against the kayan. Run \`mithaq migrate --check\` against a database built from the migrations with \`drizzle-kit migrate --config ${relativeSpecifier(project, new URL(configName, directory)).replace(/^\.\//, '')}\`, such as a fresh one in CI, to check them.`,
    )
    return 0
  }
  const configFile = new URL(configName, directory)
  const schemaFile = new URL(schemaName, directory)
  // Computed, so a project that points `generate.migrations` elsewhere still imports its one build.
  const asasFrom = relativeSpecifier(new URL('.', schemaFile), new URL('src/asas.ts', project))
  const exportedSchemas = schemas.filter((schema) => schema !== 'public')
  const schemaExports = exportedSchemas.map((schema) => `${schema}Schema`)
  const enumNames = enumExports({ enums, schemas, taken: [...tables, ...schemaExports] })
  const wanted = schemaSource({ tables, schemas: exportedSchemas, enums: enumNames, asasFrom })
  const exports = [...tables, ...schemaExports, ...enumNames.map(([, name]) => name)]
  const held = await readFile(schemaFile, 'utf8').catch(() => undefined)
  const configHeld = await readFile(configFile, 'utf8').catch(() => undefined)
  if (held !== undefined && !held.startsWith(header)) {
    throw new Refusal(
      `${schemaName} under ${directory.href} was not written by \`mithaq migrate\` and regenerating would overwrite it. Move it or delete it.`,
    )
  }

  // Compared by the exports the loader sees: a module short a name diffs only what it names,
  // and one exporting an object diffs nothing and passes forever.
  const exported = held === undefined ? undefined : await namesOf(schemaFile)
  const short = exported === undefined || exported.join(',') !== [...exports].sort().join(',')

  if (check) {
    // A check writes nothing, not even a directory.
    if (configHeld === undefined || short) {
      console.error(shortOf({ configHeld, exported, tables, schemas: schemaExports, enums: enumNames.map(([, name]) => name), directory }))
      return 1
    }
  } else {
    await mkdir(directory, { recursive: true })
    // The config is written once and is then the project's; the schema module is derived and rewritten.
    if (configHeld === undefined) await writeFile(configFile, configSource(asasFrom))
    if (short) await writeFile(schemaFile, wanted)
  }

  const config = (
    (await import(configFile.href)) as {
      default?: { schema?: unknown; out?: unknown; dbCredentials?: { url?: unknown } }
    }
  ).default
  if (typeof config?.schema !== 'string' || resolvePath(config.schema) !== fileURLToPath(schemaFile)) {
    throw new Refusal(
      `${configName} names a schema file \`mithaq migrate\` did not write. The tables are values \`buildAsas\` builds, so the config has to point \`schema\` at ${schemaName} beside it.`,
    )
  }
  // A config naming another directory is a run whose snapshot the next run never diffs against.
  if (typeof config.out !== 'string' || resolvePath(config.out) !== resolvePath(fileURLToPath(directory))) {
    throw new Refusal(
      `${configName} names an out directory \`mithaq migrate\` did not write. The migrations belong beside it, under ${directory.href}, which is where the next run reads the snapshot from.`,
    )
  }
  // A config not naming mithaq's history table would record into drizzle's default one.
  const named = (config as { migrations?: { schema?: unknown; table?: unknown } }).migrations
  if (named?.schema !== migrationsTable.schema || named.table !== migrationsTable.table) {
    throw new Refusal(
      `${configName} applies migrations through drizzle's default history table, and mithaq keeps its own in ${history}, so a database another tool migrates is never read as this project's. Delete ${configName} and run \`mithaq migrate\` again to have it written naming that table. A run copies this project's rows into it on the database it reaches; run it once against every other database this project migrates before the first \`drizzle-kit migrate\` through the new config.`,
    )
  }
  // Or the migration would be applied somewhere the data-loss probe never asked about.
  if (connectionString !== undefined && config.dbCredentials?.url !== connectionString) {
    throw new Refusal(
      `${configName} names a database other than the one this language connects to, and the data-loss guard counts rows through the language. Delete ${configName} and run \`mithaq migrate\` again to have it written from \`asas.targets.drizzle.connectionString\`.`,
    )
  }

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const inside = await readdir(new URL(`${entry.name}/`, directory))
    if (adopt && inside.includes('migration.sql')) {
      throw new Refusal(
        `${entry.name} under ${directory.href} is a migration, so this project already has a history and a baseline would sit beside it. \`--baseline\` adopts a database for a project with no migration yet.`,
      )
    }
    if (inside.includes('migration.sql') && !inside.includes('snapshot.json')) {
      throw new Refusal(
        `${entry.name} holds a migration.sql with no snapshot.json beside it, and the snapshot is what the next migration is diffed against. Restore it, or remove the folder.`,
      )
    }
  }

  // A write is refused until every folder is applied: a migration written but not applied
  // keeps its renamed rows under the old name, and the probe would read them as empty.
  const behind = adopt ? [] : (await unapplied({ db, directory })).filter((migration) => !stopped?.includes(migration.name))
  if (behind.length) {
    const names = behind.map((migration) => migration.name)
    const config = relativeSpecifier(project, configFile).replace(/^\.\//, '')
    const them = names.length === 1 ? 'it' : 'them'
    console.error(check
      ? `This database has not applied ${names.join(', ')}. This check compares the migration files with the kayan, and a database behind the files is not the schema they describe. Apply ${them} with the installed binary, \`drizzle-kit migrate --config ${config}\`, and run \`mithaq migrate --check\` again.`
      : `This database has not applied ${names.join(', ')}. The next migration is written from where ${names.length === 1 ? 'that one leaves' : 'those leave'} the schema, so a drop after a rename in ${names.length === 1 ? 'it' : 'one of them'} would be probed under the new name, which holds no rows yet, and pass unasked. Apply ${them} first, with the installed binary, \`drizzle-kit migrate --config ${config}\`, and run \`mithaq migrate\` again. No migration was written.`,
    )
    console.error(
      `If a migration's SQL already ran by hand, record it instead of applying it, with its line below. Recording a migration that did not really run makes mithaq and drizzle-kit treat its changes as present, so record only one whose SQL already ran. mithaq never runs these.`,
    )
    for (const { hash, folderMillis, name } of behind) {
      console.error(`insert into ${history} (hash, created_at, name) values (${quotedText(hash)}, ${folderMillis}, ${quotedText(name)});`)
    }
    return check ? 1 : 2
  }

  const cwd = fileURLToPath(project)
  const configPath = fileURLToPath(configFile)
  if (adopt) return baseline({ cwd, directory, configPath, db, tables: built, kayan })
  const hintsFile = new URL(hintsName, project)
  const hintsText = await readFile(hintsFile, 'utf8').catch(() => undefined)
  let hints: Hint[] = []
  if (hintsText !== undefined) {
    try {
      hints = JSON.parse(hintsText) as Hint[]
    } catch {
      throw new Refusal(`${hintsName} is not a hints file: it does not parse as JSON.`)
    }
    if (!Array.isArray(hints)) throw new Refusal(`${hintsName} is not a hints file: it is not an array of hints.`)
    // `null` is an object to `typeof`, so it would reach a property read as a crash.
    if (hints.some((hint) => typeof hint !== 'object' || hint === null || Array.isArray(hint))) {
      throw new Refusal(`${hintsName} is not a hints file: one of its entries is not an object.`)
    }
  }
  // An adopted `_rels` in the last snapshot is dropped once its rows are copied; each table
  // this migration creates is answered `create`, since a join table is never `_rels` renamed.
  const last = (await readdir(directory)).filter((name) => /^\d{14}_/.test(name)).sort().at(-1)
  const ddl = last
    ? (JSON.parse(await readFile(new URL(`${last}/snapshot.json`, directory), 'utf8')) as { ddl?: { entityType?: string; schema?: string; name?: string; table?: string }[] }).ddl ?? []
    : []
  const snapshotted = ddl.filter((entry) => entry.entityType === 'tables').map((entry) => `${entry.schema}.${entry.name}`)
  const builtPairs = Object.values(built).map((table) => [schemaOf(table), getTableName(table)] as const)
  const strangers = snapshotted.filter((pair) => !builtPairs.some(([schema, name]) => `${schema}.${name}` === pair))
  // Payload names its foreign key `_fk` where drizzle and Postgres write `_fkey`, which
  // tells its table from a project's own of that name.
  const ddlOf = (pair: string) => ddl.filter((entry) => `${entry.schema}.${entry.table}` === pair) as { entityType?: string; name?: string; columns?: unknown; tableTo?: unknown; schemaTo?: unknown }[]
  const payloadShaped = strangers.filter((pair) => {
    const [schema, name] = [pair.slice(0, pair.indexOf('.')), pair.slice(pair.indexOf('.') + 1)]
    return name.endsWith('_rels') &&
      ['path', 'parent_id', 'order'].every((column) => ddlOf(pair).some((entry) => entry.entityType === 'columns' && entry.name === column)) &&
      ddlOf(pair).some((entry) => entry.entityType === 'fks' && JSON.stringify(entry.columns) === '["parent_id"]' &&
        entry.schemaTo === schema && entry.tableTo === name.slice(0, -'_rels'.length) && entry.name?.endsWith('_fk'))
  })
  const adopted = strangers.length ? await payloadRels({ db, kayan, tables: built, dropped: ({ schema, table }) => strangers.includes(`${schema}.${table}`) }) : []
  const copied = new Set(adopted.map(({ schema, rels }) => `${schema}.${rels}`))
  const answeredAlready = (entity: readonly string[]) =>
    hints.some((hint) => hint.kind === 'table' && JSON.stringify((hint as { entity?: unknown; to?: unknown }).entity ?? (hint as { to?: unknown }).to) === JSON.stringify(entity))
  const creates = adopted.length && strangers.every((pair) => copied.has(pair))
    ? builtPairs
        .filter(([schema, name]) => !snapshotted.includes(`${schema}.${name}`) && !answeredAlready([schema, name]))
        .map(([schema, name]) => ({ type: 'create', kind: 'table', entity: [schema, name] }))
    : []
  // Without the replies drizzle's strict hints schema has no shape for. A file, because
  // a command line is capped (32 767 characters on Windows).
  const generating = async (argv: string[]) => {
    if (hintsText === undefined && !creates.length) return envelopeOf(cwd, argv)
    const scratch = await mkdtemp(join(tmpdir(), 'mithaq-hints-'))
    try {
      const file = join(scratch, hintsName)
      await writeFile(file, JSON.stringify([...hints.filter((hint) => hint.type !== guardReply), ...creates]))
      return await envelopeOf(cwd, [...argv, '--hints-file', file])
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  // `--explain` writes nothing in every status measured, and hands a write the statements
  // the guard counts rows for.
  const explained = await generating(['generate', '--explain', '--output', 'json', '--config', configPath])
  if (explained.status === 'error' || explained.status === 'missing_hints') return answerOf(explained)
  const upToDate = explained.status === 'no_changes'
  const statements = statementsOf(explained)
  if (check) {
    if (upToDate) {
      console.log('The database schema is up to date.')
      return 0
    }
    // `generate --explain` answers a pending change `ok` at exit 0, as a clean run does.
    console.error(
      `A migration is pending: ${statements.map((statement) => statement.type).join(', ')}. Run \`mithaq migrate\`.`,
    )
    return 1
  }

  const losing: Losing[] = []
  const guards: Guarded[] = []
  // An enum another tool's table still uses is never dropped.
  const dropping = new Set(statements.flatMap((statement) => {
    const table = (statement as { table?: { schema?: unknown; name?: unknown } }).table
    return statement.type === 'drop_table' ? [`${String(table?.schema)}.${String(table?.name)}`] : []
  }))
  const mine = (pair: string) => dropping.has(pair) || builtPairs.some(([schema, name]) => `${schema}.${name}` === pair)
  const keptEnums: { schema: string; name: string; users: string[] }[] = []
  for (const statement of statements) {
    const held = await heldEnum(db, statement)
    if (held) {
      const { schema, name, labels } = held
      const wanted = ((statement as { enum?: { values?: string[] } }).enum?.values ?? []).join(', ')
      const typed = `"${schema}"."${name}"`
      throw new Refusal(
        `The enum ${typed} is already in the database with the labels ${labels.join(', ')}, and no migration of this project made it, so it is another tool's. ${labels.join(', ') === wanted ? 'The migration would create it again and stop on it' : `Giving it the labels ${wanted} would alter it`}. Give the column's enum another name or, if it is this language's own, left behind by a dropped table, drop the type with DROP TYPE ${typed}. Nothing was written.`,
      )
    }
    for (const { at, count } of await relabeledRows(db, statement)) {
      throw new Refusal(
        `${at} holds ${count === 1 ? '1 value' : `${count} values`} whose label the enum no longer has, and the migration recreates the enum without it and would stop on ${count === 1 ? 'it' : 'them'} with Postgres's invalid input value for enum. Change each one to a label the enum keeps, or keep the label, and run \`mithaq migrate\` again.`,
      )
    }
    // A guard first: `droppedBy` would refuse `drop_check` and `drop_enum` as unmeasured.
    const guard = guardDroppedBy(statement)
    const [schema, name] = guard?.kind === 'enum' ? guard.entity as [string, string] : []
    const users = schema && name ? await enumUsedBy({ db, schema, name, mine }) : []
    if (users.length) keptEnums.push({ schema: schema!, name: name!, users })
    else if (guard) guards.push(guard)
    else {
      const dropped = droppedBy(statement)
      if (dropped && !(dropped.kind === 'table' && copied.has(dropped.entity.join('.'))) && (await holdsData(db, dropped, statements))) losing.push(dropped)
    }
    // No hint answers a value rounded in place, so the run is refused until none would change.
    const narrowed = roundedBy(statement)
    const rounded = narrowed && storedAs(narrowed, statements)
    const changed = rounded ? await roundedRows(db, rounded) : 0
    if (rounded && changed) {
      const { schema, table, column, type } = rounded
      const at = `${schema}.${table}.${column}`
      throw new Refusal(
        changed === 'unread'
          ? `${at} holds text that reads as no ${type === 'integer' ? 'integer' : 'number'}, and the migration would stop on it with Postgres's invalid input syntax. Fix or clear each such value, and run \`mithaq migrate\` again.`
          : changed === 'overflow'
            ? `${at} holds a value too wide for ${type}, and the migration would stop on it with Postgres's ${type === 'integer' ? 'integer out of range' : 'numeric field overflow'}. Move or shorten each such value yourself, or keep the wider precision, and run \`mithaq migrate\` again.`
            : `${at} holds ${changed === 1 ? '1 value' : `${changed} values`} that ${type} would change, and Postgres rounds a value in place to fit, with no error. Round or move each one yourself, as \`update ${schema === 'public' ? '' : `"${schema}".`}"${table}" set "${column}" = round("${column}"::numeric, <scale>)\` does, or keep the wider type, and run \`mithaq migrate\` again.`,
      )
    }
    // The migration would fail on the row when applied, and no hint fills a row.
    const notNull = nulledBy(statement)
    const nulled = notNull && storedAs(notNull, statements)
    const empty = nulled ? await nulledRows(db, nulled) : 0
    if (nulled && empty) {
      const { schema, table, column, added } = nulled
      const at = `${schema}.${table}.${column}`
      const rows = empty === 1 ? '1 row' : `${empty} rows`
      throw new Refusal(
        added
          ? `${at} would be added NOT NULL with no default over ${rows}, and Postgres would stop on them with "column contains null values". Give the field a literal \`defaultValue\`, or add it without \`required\`, fill each row, and make it required in a later run.`
          : `${at} holds ${rows} with no value, and SET NOT NULL would stop on them with Postgres's "column contains null values". Fill each one yourself, as \`update ${schema === 'public' ? '' : `"${schema}".`}"${table}" set "${column}" = <value> where "${column}" is null\` does, or leave the field without \`required\`, and run \`mithaq migrate\` again.`,
      )
    }
    // No hint renumbers a row.
    const key = keyedBy(statement)
    const stored = key && key.columns.map((column) => storedAs({ schema: key.schema, table: key.table, column }, statements))
    const shared = stored ? await duplicatedRows(db, { schema: stored[0]!.schema, table: stored[0]!.table, columns: stored.map(({ column }) => column) }) : 0
    if (stored && shared) {
      const { schema, table } = stored[0]!
      throw new Refusal(
        `${schema}.${table} holds ${shared} rows whose (${stored.map(({ column }) => column).join(', ')}) another row also holds, and ADD PRIMARY KEY would stop on them with Postgres's "could not create unique index". Delete or renumber each one yourself, and run \`mithaq migrate\` again.`,
      )
    }
  }
  const replies = new Set(
    hints.filter((hint) => hint.type === 'confirm_data_loss').map(({ kind, entity }) => answered({ kind, entity })),
  )
  const guardReplies = new Set(hints.filter((hint) => hint.type === guardReply).map((hint) => JSON.stringify([hint.kind, hint.entity])))
  const unanswered = losing.filter((hint) => !replies.has(answered(hint)))
  const unguarded = guards.filter((guard) => !guardReplies.has(JSON.stringify([guard.kind, guard.entity])))
  if (unanswered.length) {
    for (const { kind, entity } of unanswered) {
      console.error(JSON.stringify({ type: 'confirm_data_loss', kind, entity, reason: 'non_empty' }))
    }
    console.error(
      `Each line above would lose data. Write the ones this project means down in ${hintsName}, without \`reason\`, and run \`mithaq migrate\` again.`,
    )
  }
  if (unguarded.length) {
    for (const { kind, entity } of unguarded) console.error(JSON.stringify({ type: guardReply, kind, entity }))
    console.error(
      `Each line above drops a check, an enum, a column's enum type or a sequence that the database keeps and no kayan builds. Write the ones this project means down in ${hintsName} as ${guardReply} replies, and run \`mithaq migrate\` again.`,
    )
  }
  if (unanswered.length || unguarded.length) return 2
  // drizzle accepts a hint nothing asked for in silence, so an unused entry is reported.
  const wantedReplies = new Set(losing.map(answered))
  const wantedGuards = new Set(guards.map((guard) => JSON.stringify([guard.kind, guard.entity])))
  for (const hint of hints) {
    if (hint.type === guardReply && !wantedGuards.has(JSON.stringify([hint.kind, hint.entity]))) {
      console.log(`${JSON.stringify(hint)} in ${hintsName} answers no drop this run found.`)
    }
    if (hint.type !== 'confirm_data_loss') continue
    if (wantedReplies.has(answered(hint))) continue
    console.log(`${JSON.stringify(hint)} in ${hintsName} answers no drop this run found.`)
  }
  if (upToDate) {
    console.log('The database schema is up to date.')
    return 0
  }

  const written = await generating(['generate', '--output', 'json', '--config', configPath, ...(name ? ['--name', name] : [])])
  if (written.status === 'error' || written.status === 'missing_hints') return answerOf(written)
  if (written.status === 'no_changes') {
    console.log('The database schema is up to date.')
    return 0
  }
  // Only the file this run wrote: a committed migration is never touched.
  const path = written.migration_path ?? ''
  const folder = new URL('.', pathToFileURL(path))
  const count = (type: string) => statements.filter((statement) => statement.type === type).length
  const text = /[/\\]migration\.sql$/.test(path) && new URL('..', folder).href === directory.href ? await readFile(path, 'utf8') : undefined
  // Not provably this run's, so named for the project to remove rather than removed.
  if (text === undefined) {
    throw new Refusal(
      `drizzle-kit reported writing ${path ? JSON.stringify(path) : 'a migration with no path'}, which is not a migration.sql in a folder under ${directory.href}, so \`mithaq migrate\` cannot make its schema lines keep the schema and has not touched it. Delete ${path ? `${JSON.stringify(path)} and the folder it is in` : 'the folder drizzle-kit wrote'} before the next run, and report it with the drizzle-kit version that wrote it.`,
    )
  }
  const kept = keptSchemas({ text, expected: { created: count('create_schema'), dropped: count('drop_schema') } })
  if (kept === undefined) {
    await rm(folder, { recursive: true, force: true })
    throw new Refusal(
      `drizzle-kit wrote ${path} in a shape \`mithaq migrate\` has not measured: its CREATE SCHEMA and DROP SCHEMA lines are not one for each create_schema and drop_schema it explained, so they cannot each be made to keep the schema. Nothing was written. Report it with the drizzle-kit version that wrote it.`,
    )
  }
  // drizzle's own drop goes last, after the copy, once every join table exists.
  let final = kept
  for (const found of adopted) {
    const chunks = final.split(breakpoint).map((chunk) => chunk.trim())
    const drop = `DROP TABLE ${tableNamed(found.schema, found.rels)};`
    if (chunks.filter((chunk) => chunk === drop).length !== 1) {
      await rm(folder, { recursive: true, force: true })
      throw new Refusal(
        `drizzle-kit wrote ${path} without the one \`${drop}\` it explained, so \`mithaq migrate\` cannot put the copy of ${found.schema}.${found.rels} before it. Nothing was written. Report it with the drizzle-kit version that wrote it.`,
      )
    }
    final = [...chunks.filter((chunk) => chunk !== drop), ...copyOf({ found, drop })].join(`${breakpoint}\n`)
  }
  for (const { schema, name, users } of keptEnums) {
    const drop = `DROP TYPE ${tableNamed(schema, name)};`
    const chunks = final.split(breakpoint).map((chunk) => chunk.trim())
    if (chunks.filter((chunk) => chunk === drop).length !== 1) {
      await rm(folder, { recursive: true, force: true })
      throw new Refusal(
        `drizzle-kit wrote ${path} without the one \`${drop}\` it explained, so \`mithaq migrate\` cannot leave out the drop of ${schema}.${name}, which ${listed(users)} still ${users.length === 1 ? 'uses' : 'use'}. Nothing was written. Report it with the drizzle-kit version that wrote it.`,
      )
    }
    final = chunks.filter((chunk) => chunk !== drop).join(`${breakpoint}\n`)
    console.log(`The enum ${schema}.${name} is kept: ${listed(users)} still ${users.length === 1 ? 'uses' : 'use'} it, and no kayan does.`)
  }
  // A `_rels` no field carries any more may hold rows where it is applied, so its drop
  // is refused there, counted.
  for (const pair of payloadShaped.filter((one) => !copied.has(one))) {
    const [schema, rels] = [pair.slice(0, pair.indexOf('.')), pair.slice(pair.indexOf('.') + 1)]
    const drop = `DROP TABLE ${tableNamed(schema, rels)};`
    final = final.split(breakpoint).map((chunk) => chunk.trim()).flatMap((chunk) => chunk === drop
      ? [`-- ${rels} is Payload's relationship table, which no hasMany field carries now, so it is dropped only
-- while it holds no row.
DO $$ DECLARE lost integer; BEGIN
  SELECT count(*) INTO lost FROM ${tableNamed(schema, rels)};
  IF lost > 0 THEN
    RAISE EXCEPTION '${rels} holds % rows that no hasMany field carries, and dropping it would lose them. Nothing was applied.', lost;
  END IF;
END $$;`, chunk]
      : [chunk]).join(`${breakpoint}\n`)
  }
  if (final !== text) await writeFile(path, final)
  console.log(`Wrote ${written.migration_path}.`)
  return 0
}

// The two statuses both runs answer alike; `ok` and `no_changes` are the caller's.
const answerOf = (envelope: Extract<Envelope, { status: 'error' | 'missing_hints' }>): number => {
  if (envelope.status === 'error') {
    console.error(said(envelope.error))
    return 1
  }
  for (const item of envelope.unresolved) console.error(unresolvedLine(item))
  console.error(`Write the reply down in ${hintsName} and run \`mithaq migrate\` again.`)
  return 2
}

// A bare specifier is a package name. Built from URL paths, since a module specifier is posix everywhere.
const relativeSpecifier = (from: URL, to: URL) => {
  const here = from.pathname.split('/').filter(Boolean)
  const there = to.pathname.split('/').filter(Boolean)
  let shared = 0
  while (shared < here.length && shared < there.length && here[shared] === there[shared]) shared += 1
  const up = '../'.repeat(here.length - shared)
  return `${up || './'}${there.slice(shared).join('/')}`
}
