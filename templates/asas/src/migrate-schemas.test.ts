import assert from 'node:assert/strict'
import { readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { run as runAuth } from 'mithaq/generate-auth'
import {
  accessSource,
  appliedIn,
  ddlSeen,
  dropDdlSeen,
  foldersIn,
  foreignObjects,
  foreignUntouched,
  inSchemas,
  kayanSourceOf,
  latestSql,
  migrateDatabase,
  migrateName,
  migrating,
  migrationProject,
  mithaqEntry,
  nothingAdopted,
  outputIn,
  publicForeignObjects,
  pushIn,
  resetSchemas,
  sqlIn,
  template,
  withSummary,
} from './migrate.support.ts'

const foreignNames = /payload_kv|enum_payload_kv_kind|audit_log|audit_kind|audit_counter/
const playbooks = `    defineKayan({
      name: 'playbooks',
      fields: {
        id: { kind: 'text' },
        title: { kind: 'text' },
        owner: { kind: 'relationship', relationTo: 'organization', dbName: 'tenant_id', rules: { onDelete: 'restrict' } },
      },
    }),
`
const twoSchemas = inSchemas(kayanSourceOf(withSummary).replace('  ],\n})', `${playbooks}  ],\n})`), {
  notes: 'app',
  playbooks: 'app',
  user: 'auth',
  organization: 'auth',
})

test('2. a language in `app`, `auth` and `public` migrates a fresh database, opening with CREATE SCHEMA IF NOT EXISTS for each, and a push creates both schemas and then plans nothing', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), twoSchemas)
  const migrations = new URL('src/migrations/', root)
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${publicForeignObjects}`), 0)
    const first = await migrating(root, 'migrate')
    assert.equal(first.code, 0, first.stderr)
    const schema = await readFile(new URL('schema.ts', migrations), 'utf8')
    assert.match(schema, /export const \{\n  app: appSchema,\n  auth: authSchema,\n\} = asas\.targets\.drizzle\.schemas\n$/, 'the module exports each schema the tables use, and not public')
    const sql = await latestSql(root)
    assert.match(sql, /^CREATE SCHEMA IF NOT EXISTS "app";\n--> statement-breakpoint\nCREATE SCHEMA IF NOT EXISTS "auth";\n/, 'the migration opens by creating both schemas, adopting either if it is there')
    assert.doesNotMatch(sql, /CREATE SCHEMA "/, 'and no bare CREATE SCHEMA is left')
    assert.match(sql, /CREATE TABLE "app"\."playbooks"/)
    assert.match(sql, /REFERENCES "auth"\."organization"\("id"\) ON DELETE RESTRICT/, 'the cross-schema key names both sides qualified')
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
    assert.match(checked.stdout, /The database schema is up to date\./)
    assert.equal(await sqlIn(root, `${foreignUntouched(['public'])} do $$ begin assert to_regnamespace('app') is not null; assert to_regnamespace('auth') is not null; end $$;`), 0)

    assert.equal(await sqlIn(root, `${resetSchemas} ${publicForeignObjects} ${ddlSeen}`), 0)
    try {
      assert.equal(await pushIn(root), 0, 'the push applies on a fresh database')
      assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('app.playbooks') is not null; assert to_regclass('auth.organization') is not null; assert to_regclass('public.roles') is not null; end $$;`), 0)
      assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from public.ddl_seen where identity = 'app.playbooks') > 0; end $$;`), 0, 'the trigger saw the first push build the table')
      assert.equal(await sqlIn(root, 'truncate public.ddl_seen'), 0)
      assert.equal(await pushIn(root), 0, 'and a second push applies')
      assert.equal(
        await sqlIn(root, `do $$ begin assert (select count(*) from public.ddl_seen where identity not like 'drizzle.%') = 0; end $$;`),
        0,
        'having planned nothing',
      )
      assert.equal(await sqlIn(root, `${foreignUntouched(['public'])} do $$ begin assert to_regnamespace('app') is not null; assert to_regnamespace('auth') is not null; end $$;`), 0)
    } finally {
      await sqlIn(root, dropDdlSeen)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const everyMigrationFile = async (root: URL) =>
  Promise.all((await foldersIn(root)).flatMap((folder) => ['migration.sql', 'snapshot.json'].map((file) => readFile(new URL(`src/migrations/${folder}/${file}`, root), 'utf8'))))
const noFolders = async (root: URL) => {
  for (const folder of await foldersIn(root)) await rm(new URL(`src/migrations/${folder}/`, root), { recursive: true })
}

test('1. a language in `app` beside `app.audit_log` leaves every table, enum, sequence and row of another tool as it was, through the push, `mithaq migrate`, `drizzle-kit migrate`, `--check` and `--baseline`', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), inSchemas(kayanSourceOf(withSummary), { notes: 'app' }))
  try {
    await t.test('the push', async () => {
      assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
      assert.equal(await pushIn(root), 0)
      assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('app.notes') is not null; end $$;`), 0, 'the language built its table in app')
      assert.equal(await sqlIn(root, foreignUntouched()), 0)
    })

    await t.test('`mithaq migrate`, `drizzle-kit migrate` and `--check`', async () => {
      assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
      const written = await migrating(root, 'migrate')
      assert.equal(written.code, 0, written.stderr)
      assert.match(await latestSql(root), /^CREATE SCHEMA IF NOT EXISTS "app";\n/)
      const applied = await appliedIn(root)
      assert.equal(applied.code, 0, `the migration applies over the app another tool made first: ${applied.output}`)
      const checked = await migrating(root, 'migrate', '--check')
      assert.equal(checked.code, 0, checked.stderr)
      for (const file of await everyMigrationFile(root)) assert.doesNotMatch(file, foreignNames, 'no foreign object reaches a migration or a snapshot')
      assert.equal(await sqlIn(root, foreignUntouched()), 0)
    })

    await t.test('`--baseline`', async () => {
      await noFolders(root)
      assert.equal(await sqlIn(root, 'drop schema drizzle cascade;'), 0)
      const adopted = await migrating(root, 'migrate', '--baseline')
      assert.equal(adopted.code, 0, adopted.stderr)
      assert.match(await latestSql(root), /^CREATE SCHEMA IF NOT EXISTS "app";\n/, 'the pulled CREATE SCHEMA keeps a schema that is there')
      for (const file of await everyMigrationFile(root)) assert.doesNotMatch(file, foreignNames, 'the baseline leaves out the enums and the sequence of another tool')
      const checked = await migrating(root, 'migrate', '--check')
      assert.equal(checked.code, 0, checked.stderr)
      assert.equal(await sqlIn(root, foreignUntouched()), 0)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('4. `--baseline` adopts the language\'s tables live in `app` and `auth`: one folder, one row, no DDL, the IF NOT EXISTS lines, and a fresh database built through it matches', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), twoSchemas)
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
    assert.equal(await pushIn(root), 0, 'the language\'s tables are live, beside app.audit_log')
    assert.equal(await sqlIn(root, ddlSeen), 0)
    let adopted: Awaited<ReturnType<typeof migrating>>
    try {
      adopted = await migrating(root, 'migrate', '--baseline')
      assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from public.ddl_seen where identity not like 'drizzle.%') = 0; end $$;`), 0, 'the baseline ran no DDL against any table')
    } finally {
      await sqlIn(root, `${dropDdlSeen} drop table public.ddl_seen; drop function public.ddl_seen();`)
    }
    assert.equal(adopted.code, 0, adopted.stderr)
    const [folder, ...more] = await foldersIn(root)
    assert.deepEqual(more, [], 'one folder')
    assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from drizzle.__mithaq_migrations) = 1; assert (select name from drizzle.__mithaq_migrations) = '${folder}'; end $$;`), 0, 'one row')
    const sql = await latestSql(root)
    assert.match(sql, /^CREATE SCHEMA IF NOT EXISTS "app";\n--> statement-breakpoint\nCREATE SCHEMA IF NOT EXISTS "auth";\n/)
    assert.match(sql, /CREATE TABLE "app"\."playbooks"/)
    for (const file of await everyMigrationFile(root)) assert.doesNotMatch(file, foreignNames)
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)

    assert.equal(await sqlIn(root, resetSchemas), 0)
    const built = await appliedIn(root)
    assert.equal(built.code, 0, built.output)
    const fresh = await migrating(root, 'migrate', '--check')
    assert.equal(fresh.code, 0, fresh.stderr)
    assert.match(fresh.stdout, /The database schema is up to date\./)
    assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('app.playbooks') is not null; assert to_regclass('auth.user') is not null; end $$;`), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('3. a foreign key from `app.playbooks` to `auth.organization` refuses the delete naming the playbook kayan, and a table of the same name in another schema is not named', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), twoSchemas)
  await writeFile(
    new URL('remove.ts', root),
    `import { asas } from './src/asas.ts'
const store = asas.targets.drizzle
try {
  await store.transaction((tx) => store.remove({ tx, kayan: 'organization', id: process.argv[2] }))
  console.log('removed')
} catch (error) {
  console.log(JSON.stringify({ key: error.key, params: error.params }))
}
await asas.destroy()
`,
  )
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `insert into auth.organization (id, name) values ('o1', 'One'), ('o2', 'Two'); insert into app.playbooks (id, title, tenant_id) values ('p1', 'Open', 'o1');`), 0)
    const byPlaybook = await outputIn(root, 'remove.ts', 'o1')
    assert.deepEqual(JSON.parse(byPlaybook.stdout.trim().split('\n').at(-1)!), { key: 'error.conflict.referenced', params: { kayan: 'organization', by: 'playbooks' } }, byPlaybook.stderr)

    assert.equal(await sqlIn(root, `create table public.playbooks (id text primary key, owner text references auth.organization (id)); insert into public.playbooks values ('theirs', 'o2');`), 0)
    const byStranger = await outputIn(root, 'remove.ts', 'o2')
    assert.deepEqual(JSON.parse(byStranger.stdout.trim().split('\n').at(-1)!), { key: 'error.conflict.referenced', params: { kayan: 'organization' } }, 'a table of the language\'s name in another schema is not the language\'s')
    assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from auth.organization) = 2; end $$;`), 0, 'and neither row is deleted')
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the stored rows a rule refuses are counted in the kayan\'s own schema, and never in a table of the same name in another', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), inSchemas(kayanSourceOf("        id: { kind: 'text' },\n        summary: { kind: 'text', rules: { minLength: 5 } },"), { notes: 'app' }))
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `insert into app.notes (id, summary) values ('n1', 'ab');
      create table public.notes (id text, summary text); insert into public.notes values ('a', 'a'), ('b', 'b');`), 0)
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
    assert.match(checked.stdout, /^notes\.summary: 1 stored row breaks minLength\. Each is refused on its next save until it complies\.$/m)
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a kayan whose schemaName is \'public\' is counted in the stored-rows check exactly as one with no key', async (t) => {
  await migrateDatabase()
  const fields = "        id: { kind: 'text' },\n        summary: { kind: 'text', rules: { minLength: 5 } },"
  const root = await migrationProject(fields)
  try {
    // A search_path that does not start at `public`, so `current_schema()` is
    // `x` and a table built with no schema lands there: `'public'` has to mean
    // that, as no key does, and not the schema named public.
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects} drop schema if exists x cascade; create schema x; alter database ${migrateName} set search_path = x, public;`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('x.notes') is not null; end $$; insert into notes (id, summary) values ('n1', 'ab'), ('n2', 'cd');`), 0)
    const counted: string[] = []
    for (const source of [kayanSourceOf(fields), inSchemas(kayanSourceOf(fields), { notes: 'public' })]) {
      await writeFile(new URL('src/asas.ts', root), source)
      const checked = await migrating(root, 'migrate', '--check')
      assert.equal(checked.code, 0, checked.stderr)
      counted.push(checked.stdout)
    }
    assert.match(counted[0]!, /^notes\.summary: 2 stored rows break minLength\./m)
    assert.equal(counted[1], counted[0], "'public' says what no key says")
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
  } finally {
    await sqlIn(root, `alter database ${migrateName} reset search_path; drop schema if exists x cascade;`)
    await rm(root, { recursive: true, force: true })
  }
})

test('6. the push and the baseline refuse another tool\'s table or view that shares a name with one of the language\'s in another of its schemas, writing nothing', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), twoSchemas)
  const nothingBuilt = `do $$ begin assert to_regnamespace('auth') is null; assert to_regclass('app.playbooks') is null; assert to_regclass('drizzle.__mithaq_migrations') is null; end $$;`
  const refusedBoth = async (strangers: RegExp) => {
    const pushed = await outputIn(root, 'push.ts')
    assert.notEqual(pushed.code, 0, 'the push is refused')
    assert.match(pushed.stderr, strangers)
    assert.match(pushed.stderr, /drizzle-kit filters tables by name across the schemas this language uses, so this push would drop/)
    assert.equal(await sqlIn(root, nothingBuilt), 0, 'and the push wrote nothing')
    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 1, adopted.stderr)
    assert.match(adopted.stderr, strangers)
    assert.match(adopted.stderr, /so the first migration after this baseline would drop/)
    await nothingAdopted(root)
    assert.equal(await sqlIn(root, nothingBuilt), 0, 'and the baseline wrote nothing')
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
  }
  try {
    await t.test('a table: public."user" beside the language\'s auth.user', async () => {
      assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects} create table public."user" (id text); insert into public."user" values ('theirs');`), 0)
      await refusedBoth(/public\.user is not a table of this language/)
      assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from public."user" where id = 'theirs') = 1; end $$;`), 0, 'their row is where it was')
    })

    await t.test('a plain view and a materialized view, each named like a table of the language in another of its schemas', async () => {
      assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects} create view app."user" as select 1 as id; create materialized view public.organization as select 1 as id;`), 0)
      await refusedBoth(/app\.user, public\.organization are not tables of this language/)
      assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('app.user') is not null; assert to_regclass('public.organization') is not null; end $$;`), 0, 'both views are where they were')
    })

    await t.test('a partitioned table: public."user" partitioned, beside the language\'s auth.user', async () => {
      assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects} create table public."user" (id text) partition by list (id); create table public.user_theirs partition of public."user" for values in ('theirs'); insert into public."user" values ('theirs');`), 0)
      await refusedBoth(/public\.user is not a table of this language/)
      assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from public."user" where id = 'theirs') = 1; end $$;`), 0, 'their row is where it was')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('6. a table moved between schemas waits for a rename reply and becomes SET SCHEMA, the probe asks about the rows where they are before the move, and a schema the language stops using is kept', async (t) => {
  await migrateDatabase()
  const pgCore = import.meta.resolve('drizzle-orm/pg-core')
  const orm = import.meta.resolve('drizzle-orm')
  const source = ({ table, schema, fields }: { table: string; schema: string; fields: string }) =>
    `import { text } from '${pgCore}'\nimport { sql } from '${orm}'\n${kayanSourceOf(fields).replace("name: 'notes',", `name: 'notes', dbName: '${table}', schemaName: '${schema}',`)}`
  const root = await migrationProject(withSummary)
  const folders = async () => foldersIn(root)
  const hinted = (hints: object[]) => writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify(hints)}\n`)
  const moved = (from: string[], to: string[]) => ({ type: 'rename', kind: 'table', from, to })
  const holds = (table: string, column: string) =>
    sqlIn(root, `do $$ begin if (select count(*) from ${table} where "${column}" is not null) <> 1 then raise exception 'lost'; end if; end $$`)
  const shout = (expression: string) => `        shout: { kind: 'text', targets: { drizzle: text('shout').generatedAlwaysAs(sql\`'${expression}'\`) } },`
  const plainId = "        id: { kind: 'text' },"
  const bareId = "        id: { kind: 'text', targets: { drizzle: text('id').notNull() } },"
  const asks = async ({ to, fields, hint, kind, entity, held, written: wanted }: { to: { table: string; schema: string }; fields: string; hint: object; kind: string; entity: string[]; held: [string, string]; written: RegExp[] }) => {
    await writeFile(new URL('src/asas.ts', root), source({ ...to, fields }))
    await hinted([])
    const unanswered = await migrating(root, 'migrate')
    assert.equal(unanswered.code, 2, unanswered.stderr)
    assert.match(unanswered.stderr, new RegExp(`^table ${to.schema}\\.${to.table} rename_or_create$`, 'm'), 'a move is never silent')
    await hinted([hint])
    const before = (await folders()).length
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 2, refused.stderr)
    assert.match(refused.stderr, new RegExp(`^${JSON.stringify({ type: 'confirm_data_loss', kind, entity, reason: 'non_empty' }).replace(/[[\]{}]/g, '\\$&')}$`, 'm'))
    assert.equal((await folders()).length, before, 'the refused run wrote no migration')
    assert.equal(await holds(...held), 0, 'the rows are still where they were')
    await hinted([hint, { type: 'confirm_data_loss', kind, entity }])
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    const sql = await latestSql(root)
    for (const statement of wanted) assert.match(sql, statement)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
    return sql
  }
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
    await writeFile(new URL('src/asas.ts', root), source({ table: 'notes', schema: 'public', fields: `${withSummary}\n        extra: { kind: 'text' },\n${shout('a')}` }))
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `insert into public.notes (id, summary, extra) values ('one', 'a value', 'more')`), 0)

    await t.test('a column dropped after a move from public into app', async () => {
      await asks({
        to: { table: 'notes', schema: 'app' },
        fields: `${plainId}\n        extra: { kind: 'text' },\n${shout('a')}`,
        hint: moved(['public', 'notes'], ['app', 'notes']),
        kind: 'column',
        entity: ['app', 'notes', 'summary'],
        held: ['public.notes', 'summary'],
        written: [/ALTER TABLE "notes" SET SCHEMA "app";/, /DROP COLUMN "summary"/],
      })
      assert.equal(await sqlIn(root, `do $$ begin assert (select extra from app.notes where id = 'one') = 'more'; end $$;`), 0, 'the move carried the row')
    })

    await t.test('a primary key dropped after a move from app back into public', async () => {
      await asks({
        to: { table: 'notes', schema: 'public' },
        fields: `${bareId}\n        extra: { kind: 'text' },\n${shout('a')}`,
        hint: moved(['app', 'notes'], ['public', 'notes']),
        kind: 'primary_key',
        entity: ['public', 'notes', 'notes_pkey'],
        held: ['app.notes', 'id'],
        written: [/ALTER TABLE "app"\."notes" SET SCHEMA "public";/, /DROP CONSTRAINT "notes_pkey"/],
      })
    })

    await t.test('a column recreated after a move from public into app', async () => {
      await asks({
        to: { table: 'notes', schema: 'app' },
        fields: `${bareId}\n        extra: { kind: 'text' },\n${shout('b')}`,
        hint: moved(['public', 'notes'], ['app', 'notes']),
        kind: 'column',
        entity: ['app', 'notes', 'shout'],
        held: ['public.notes', 'shout'],
        written: [/SET SCHEMA "app";/, /DROP COLUMN "shout"/],
      })
    })

    await t.test('a rename and a move of one table in one run, with a column dropped, and app left with no kayan', async () => {
      const sql = await asks({
        to: { table: 'memos', schema: 'public' },
        fields: `${bareId}\n${shout('b')}`,
        hint: moved(['app', 'notes'], ['public', 'memos']),
        kind: 'column',
        entity: ['public', 'memos', 'extra'],
        held: ['app.notes', 'extra'],
        written: [/RENAME TO "memos"/, /SET SCHEMA "public";/, /DROP COLUMN "extra"/],
      })
      assert.match(sql, /^-- mithaq never drops a schema: "app" is kept\.$/m)
      assert.doesNotMatch(sql, /DROP SCHEMA/)
      assert.equal(await sqlIn(root, `do $$ begin assert to_regnamespace('app') is not null; assert (select count(*) from public.memos) = 1; end $$;`), 0)
      const checked = await migrating(root, 'migrate', '--check')
      assert.equal(checked.code, 0, checked.stderr)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('6. a schema renamed in the kayan is refused, since ALTER SCHEMA would carry another tool\'s tables with it', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), inSchemas(kayanSourceOf(withSummary), { notes: 'app' }))
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    await writeFile(new URL('src/asas.ts', root), inSchemas(kayanSourceOf(withSummary), { notes: 'app2' }))
    await writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify([{ type: 'rename', kind: 'schema', from: ['app'], to: ['app2'] }])}\n`)
    const before = await foldersIn(root)
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 1, refused.stderr)
    assert.match(refused.stderr, /renames the schema app to app2, which would carry every object in app with it, another tool's among them/)
    assert.deepEqual(await foldersIn(root), before, 'no migration is written')
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('6. a push refuses a kayan\'s table that changed schema, and a name it cannot ask about, with a sentence', async (t) => {
  await migrateDatabase()
  const indexed = "        id: { kind: 'text' },\n        summary: { kind: 'text', rules: { index: true } },"
  const root = await migrationProject(indexed)
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
    assert.equal(await pushIn(root), 0)
    assert.equal(await sqlIn(root, `insert into public.notes (id, summary) values ('one', 'kept')`), 0)
    const unmoved = `do $$ begin assert (select summary from public.notes where id = 'one') = 'kept'; assert to_regclass('app.notes') is null; end $$;`
    await writeFile(new URL('src/asas.ts', root), inSchemas(kayanSourceOf(indexed), { notes: 'app' }))
    const moved = await outputIn(root, 'push.ts')
    assert.notEqual(moved.code, 0)
    assert.match(moved.stderr, /public\.notes is not a table of this language.*run `mithaq migrate`, which asks whether that is a move; on a development database, drop its tables instead, or move the table by hand with `ALTER TABLE … SET SCHEMA`\./)
    assert.equal(await sqlIn(root, unmoved), 0, 'and nothing moved')
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(indexed.replace("kind: 'text', rules", "kind: 'text', dbName: 'gist', rules")))
    const renamed = await outputIn(root, 'push.ts')
    assert.notEqual(renamed.code, 0)
    assert.match(renamed.stderr, /The push met a rename it cannot ask about, such as a field's column renamed\. Run `mithaq migrate`, which asks, or drop the dev database's tables\./)
    assert.equal(await sqlIn(root, unmoved), 0, 'and nothing was renamed')
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('7. TB\'s shape: a providers entry with schemaName \'auth\' generates every auth kayan in auth, migrates beside the playbook in app and another tool\'s objects, and a change of it is drift', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  // The generated kayan import `mithaq` and the provider package by name, so
  // the project reaches the template's own dependencies.
  await symlink(fileURLToPath(new URL('../node_modules/', import.meta.url)), fileURLToPath(new URL('node_modules', root)))
  await writeFile(
    new URL('src/mithaq.ts', root),
    `export { defineKayan } from '${template}'\nexport const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../auth.ts', migrations: 'src/migrations/' }\n`,
  )
  // The template's instance, plus a second instance of shoppers on tables of their own, which names
  // no schema unless the step gives it one. Neither instance is built here, only generated, so its
  // server is never called.
  const providersOf = (schemaName: string, customers = '') =>
    writeFile(
      new URL('src/auth.ts', root),
      `import { providers as template } from '@asas/auth'
export const providers = {
  user: { ...template.user, schemaName: ${schemaName} },
  customers: {
    options: {
      user: { modelName: 'customers' },
      session: { modelName: 'customerSession' },
      account: { modelName: 'customerAccount' },
      verification: { modelName: 'customerVerification' },
    },
    server: () => ({}),${customers && `
    schemaName: ${customers},`}
  },
}
`,
    )
  await providersOf("'auth'")
  await writeFile(
    new URL('src/asas.ts', root),
    `import { fetchHttp } from '${mithaqEntry}'
import { buildAsas, defineKayan } from '${template}'
import { betterAuth } from './kayan/auth/user/index.ts'

export const asas = buildAsas({
  http: [fetchHttp()],
  kayan: [
    ...betterAuth.core,
    ...betterAuth.organization,
${accessSource.split('\n').slice(0, accessSource.split('\n').findIndex((line) => line.includes("name: 'user'"))).join('\n')}
    defineKayan({
      name: 'playbook',
      dbName: 'playbooks',
      schemaName: 'app',
      fields: {
        id: { kind: 'text' },
        title: { kind: 'text' },
        owner: { kind: 'relationship', relationTo: 'organization', dbName: 'tenant_id', rules: { onDelete: 'restrict' } },
        deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
      },
    }),
  ],
})
`,
  )
  const generated = new URL('src/kayan/auth/user/', root)
  try {
    assert.equal(await runAuth(root, false), 0)
    const files = (await readdir(generated)).filter((file) => file !== 'index.ts').sort()
    assert.deepEqual(files, ['account.ts', 'invitation.ts', 'member.ts', 'organization.ts', 'organizationRole.ts', 'session.ts', 'user.ts', 'verification.ts'])
    for (const file of files) {
      assert.match(await readFile(new URL(file, generated), 'utf8'), /\n  schemaName: 'auth',\n/, `${file} is built in auth`)
    }
    assert.match(await readFile(new URL('user.ts', generated), 'utf8'), /\n  name: 'user',\n  schemaName: 'auth',\n  auth: betterAuth\(\{ server: providers\.user\.server \}\),\n/)
    const shoppers = new URL('src/kayan/auth/customers/', root)
    for (const file of ['account.ts', 'session.ts', 'user.ts', 'verification.ts']) {
      assert.doesNotMatch(await readFile(new URL(file, shoppers), 'utf8'), /schemaName/, `customers/${file} names no schema`)
    }
    assert.match(await readFile(new URL('user.ts', shoppers), 'utf8'), /\n  name: 'customers',\n  auth: betterAuth/)
    assert.equal(await runAuth(root, true), 0, 'and a check over what it wrote is green')

    const reset = await outputIn(root, 'sql.ts', `${resetSchemas} ${foreignObjects}`)
    assert.equal(reset.code, 0, reset.stderr)
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    const sql = await latestSql(root)
    assert.match(sql, /^CREATE SCHEMA IF NOT EXISTS "app";\n--> statement-breakpoint\nCREATE SCHEMA IF NOT EXISTS "auth";\n/)
    for (const table of ['user', 'session', 'account', 'verification', 'organization', 'member', 'invitation']) {
      assert.match(sql, new RegExp(`CREATE TABLE "auth"\\."${table}"`), `${table} is created in auth`)
    }
    assert.match(sql, /CREATE TABLE "app"\."playbooks"/)
    assert.match(sql, /REFERENCES "auth"\."organization"\("id"\)/)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
    assert.match(checked.stdout, /The database schema is up to date\./)
    assert.equal(await sqlIn(root, `${foreignUntouched()} do $$ begin assert to_regnamespace('auth') is not null; end $$;`), 0)

    // A change of the entry's schema is drift the check reports. Run through the bin, since this
    // process has the first providers module cached.
    await providersOf("'iam'")
    const drifted = await migrating(root, 'generate', 'auth', '--check')
    assert.equal(drifted.code, 1, drifted.stderr)
    assert.match(drifted.stderr, /Stale auth kayan: .*user\/user\.ts/, 'the generated kayan are stale once the entry names another schema')
    // A value that is no string, a BigInt in the second entry here, is refused before any entry's
    // files are written, the first entry's too.
    await rm(new URL('src/kayan/auth/', root), { recursive: true })
    await providersOf("'auth'", '3n')
    const refused = await migrating(root, 'generate', 'auth')
    assert.equal(refused.code, 1, refused.stderr)
    assert.match(refused.stderr, /gives the "customers" instance the schemaName 3, and a schemaName is the name of a Postgres schema/)
    assert.equal(await readdir(new URL('src/kayan/auth/', root)).then(() => 'written', () => 'nothing'), 'nothing', 'and no instance\'s files were written')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
