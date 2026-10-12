import assert from 'node:assert/strict'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
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
  outputIn,
  pushIn,
  resetSchemas,
  sqlIn,
  withSummary,
} from './migrate.support.ts'

test('a drop in the same run as a table or column rename asks about the rows under the old name, and an answered drop then migrates', async (t) => {
  await migrateDatabase()
  // The whole column, from the same drizzle-orm the template builds with, so
  // the id can lose its primary key and a column can be generated.
  const pgCore = import.meta.resolve('drizzle-orm/pg-core')
  const orm = import.meta.resolve('drizzle-orm')
  const source = (table: string, fields: string) =>
    `import { text } from '${pgCore}'\nimport { sql } from '${orm}'\n${kayanSourceOf(fields).replace("name: 'notes',", `name: 'notes', dbName: '${table}',`)}`
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  const folders = async () => (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry)).sort()
  const apply = async () => assert.equal((await appliedIn(root)).code, 0)
  const hinted = (hints: object[]) => writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify(hints)}\n`)
  const renamed = (kind: string, from: string[], to: string[]) => ({ type: 'rename', kind, from: ['public', ...from], to: ['public', ...to] })
  const holds = (table: string, column: string) =>
    sqlIn(root, `do $$ begin if (select count(*) from "${table}" where "${column}" is not null) <> 1 then raise exception 'lost'; end if; end $$`)
  const yell = (expression: string) => `        yell: { kind: 'text', targets: { drizzle: text('yell').generatedAlwaysAs(sql\`'${expression}'\`) } },`
  const asks = async ({ table, fields, rename, kind, entity, written: wanted }: { table: string; fields: string; rename: object; kind: string; entity: string[]; written: RegExp[] }) => {
    await writeFile(new URL('src/asas.ts', root), source(table, fields))
    await hinted([rename])
    const before = (await folders()).length
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 2, refused.stderr)
    assert.match(refused.stderr, new RegExp(`^${JSON.stringify({ type: 'confirm_data_loss', kind, entity, reason: 'non_empty' }).replace(/[[\]{}]/g, '\\$&')}$`, 'm'))
    assert.equal((await folders()).length, before, 'the refused run wrote no migration')
    await hinted([rename, { type: 'confirm_data_loss', kind, entity }])
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    assert.equal((await folders()).length, before + 1)
    const sql = await readFile(new URL(`${(await folders()).at(-1)}/migration.sql`, migrations), 'utf8')
    for (const statement of wanted) assert.match(sql, statement)
  }
  await sqlIn(root, 'drop schema public cascade; create schema public;')
  try {
    await writeFile(new URL('src/asas.ts', root), source('notes', `${withSummary}\n        shout: { kind: 'text', targets: { drizzle: text('shout').generatedAlwaysAs(sql\`'a'\`) } },`))
    assert.equal((await migrating(root, 'migrate')).code, 0)
    await apply()
    assert.equal(await sqlIn(root, `insert into "notes" ("id", "summary") values ('one', 'a value')`), 0)
    // Each subtest starts from the table the one before it migrated and applied.

    await t.test('a column renamed and recreated, with no table renamed', async () => {
      await asks({
        table: 'notes',
        fields: `${withSummary}\n${yell('b')}`,
        rename: renamed('column', ['notes', 'shout'], ['notes', 'yell']),
        kind: 'column',
        entity: ['public', 'notes', 'yell'],
        written: [/RENAME COLUMN "shout" TO "yell"/, /DROP COLUMN "yell"/],
      })
      assert.equal(await holds('notes', 'shout'), 0, 'the value is still there until the migration runs')
      await apply()
    })

    await t.test('a dropped column', async () => {
      await asks({
        table: 'memos',
        fields: `        id: { kind: 'text' },\n${yell('b')}`,
        rename: renamed('table', ['notes'], ['memos']),
        kind: 'column',
        entity: ['public', 'memos', 'summary'],
        written: [/RENAME TO "memos"/, /DROP COLUMN "summary"/],
      })
      assert.equal(await holds('notes', 'summary'), 0, 'the value is still there until the migration runs')
      await apply()
    })

    await t.test('a dropped primary key', async () => {
      await asks({
        table: 'items',
        fields: `        id: { kind: 'text', targets: { drizzle: text('id').notNull() } },\n${yell('b')}`,
        rename: renamed('table', ['memos'], ['items']),
        kind: 'primary_key',
        entity: ['public', 'items', 'notes_pkey'],
        written: [/RENAME TO "items"/, /DROP CONSTRAINT "notes_pkey"/],
      })
      assert.equal(await holds('memos', 'id'), 0, 'the row is still there until the migration runs')
      await apply()
    })

    await t.test('a recreated column', async () => {
      await asks({
        table: 'notes',
        fields: `        id: { kind: 'text', targets: { drizzle: text('id').notNull() } },\n${yell('c')}`,
        rename: renamed('table', ['items'], ['notes']),
        kind: 'column',
        entity: ['public', 'notes', 'yell'],
        written: [/RENAME TO "notes"/, /DROP COLUMN "yell"/],
      })
      assert.equal(await holds('items', 'yell'), 0, 'the value is still there until the migration runs')
      await apply()
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('`mithaq migrate` writes nothing while the database has not applied every migration in the folder, so a rename nobody applied cannot hide rows from the data-loss probe', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  const folders = async () => (await readdir(migrations).catch(() => [] as string[])).filter((entry) => /^\d{14}_/.test(entry)).sort()
  const source = (table: string, fields: string) => kayanSourceOf(fields).replace("name: 'notes',", `name: 'notes', dbName: '${table}',`)
  const hinted = (hints: object[]) => writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify(hints)}\n`)
  const applied = async () => {
    const { code, output } = await appliedIn(root)
    assert.equal(code, 0, output)
  }
  const refusedFor = async (unapplied: string[]) => {
    const before = await folders()
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 2, refused.stderr)
    for (const name of unapplied) {
      assert.match(refused.stderr, new RegExp(`^insert into drizzle\\.__mithaq_migrations \\(hash, created_at, name\\) values \\('[0-9a-f]{64}', \\d+, '${name}'\\);$`, 'm'))
    }
    assert.match(refused.stderr, /drizzle-kit migrate --config src\/migrations\/drizzle\.config\.ts/)
    assert.match(refused.stderr, /record only one whose SQL already ran\. mithaq never runs these\./)
    assert.doesNotMatch(refused.stderr, /confirm_data_loss/, 'the refusal comes before the probe')
    assert.deepEqual(await folders(), before, 'the refused run wrote no migration folder')
  }
  const asked = async (entity: string[]) => {
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 2, refused.stderr)
    assert.match(refused.stderr, new RegExp(JSON.stringify({ type: 'confirm_data_loss', kind: 'column', entity, reason: 'non_empty' }).replace(/[[\]{}]/g, '\\$&')))
  }
  await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
  try {
    await t.test('an empty folder on a fresh database writes the first migration', async () => {
      const first = await migrating(root, 'migrate')
      assert.equal(first.code, 0, first.stderr)
      assert.equal((await folders()).length, 1)
    })

    await t.test('a fresh database under a folder holding a migration is refused, naming the migration', async () => {
      await refusedFor(await folders())
      await applied()
      assert.equal(await sqlIn(root, `insert into "notes" ("id", "summary") values ('one', 'a value')`), 0)
    })

    await t.test('a table rename nobody applied refuses the drop after it, and once applied the drop asks confirm_data_loss', async () => {
      const rename = { type: 'rename', kind: 'table', from: ['public', 'notes'], to: ['public', 'memos'] }
      await writeFile(new URL('src/asas.ts', root), source('memos', withSummary))
      await hinted([rename])
      assert.equal((await migrating(root, 'migrate')).code, 0)
      const checked = await migrating(root, 'migrate', '--check')
      assert.equal(checked.code, 1, checked.stderr)
      assert.match(checked.stderr, new RegExp(`This database has not applied ${(await folders()).at(-1)}\\. This check compares`))
      await writeFile(new URL('src/asas.ts', root), source('memos', "        id: { kind: 'text' },"))
      await hinted([])
      await refusedFor([(await folders()).at(-1)!])
      await applied()
      await asked(['public', 'memos', 'summary'])
      await hinted([{ type: 'confirm_data_loss', kind: 'column', entity: ['public', 'memos', 'summary'] }])
      const before = (await folders()).length
      const written = await migrating(root, 'migrate')
      assert.equal(written.code, 0, written.stderr)
      assert.equal((await folders()).length, before + 1)
      await applied()
    })

    await t.test('a column rename nobody applied refuses the drop after it, and once applied the drop asks confirm_data_loss', async () => {
      await writeFile(new URL('src/asas.ts', root), source('memos', "        id: { kind: 'text' },\n        body: { kind: 'text' },"))
      await hinted([])
      assert.equal((await migrating(root, 'migrate')).code, 0)
      await applied()
      assert.equal(await sqlIn(root, `update "memos" set "body" = 'a value'`), 0)
      await writeFile(new URL('src/asas.ts', root), source('memos', "        id: { kind: 'text' },\n        note: { kind: 'text' },"))
      await hinted([{ type: 'rename', kind: 'column', from: ['public', 'memos', 'body'], to: ['public', 'memos', 'note'] }])
      assert.equal((await migrating(root, 'migrate')).code, 0)
      await writeFile(new URL('src/asas.ts', root), source('memos', "        id: { kind: 'text' },"))
      await hinted([])
      await refusedFor([(await folders()).at(-1)!])
      await applied()
      await asked(['public', 'memos', 'note'])
    })

    await t.test('a migration whose SQL already ran by hand is recorded with the printed line, after which the run writes, and a history row no folder names changes nothing', async () => {
      const fields = "        id: { kind: 'text' },\n        note: { kind: 'text' },"
      await writeFile(new URL('src/asas.ts', root), source('memos', `${fields}\n        extra: { kind: 'text' },`))
      await hinted([])
      assert.equal((await migrating(root, 'migrate')).code, 0)
      const latest = (await folders()).at(-1)!
      const sql = await readFile(new URL(`${latest}/migration.sql`, migrations), 'utf8')
      assert.equal(await sqlIn(root, sql.replaceAll('--> statement-breakpoint', '')), 0)
      const refused = await migrating(root, 'migrate')
      assert.equal(refused.code, 2, refused.stderr)
      const recorded = refused.stderr.split('\n').filter((line) => line.startsWith('insert into '))
      assert.equal(recorded.length, 1)
      assert.equal(await sqlIn(root, recorded[0]!), 0)
      assert.equal(await sqlIn(root, `insert into drizzle.__mithaq_migrations (hash, created_at, name) values ('stray', 0, '20000101000000_stray')`), 0)
      await writeFile(new URL('src/asas.ts', root), source('memos', `${fields}\n        extra: { kind: 'text' },\n        more: { kind: 'text' },`))
      const before = (await folders()).length
      const written = await migrating(root, 'migrate')
      assert.equal(written.code, 0, written.stderr)
      assert.equal((await folders()).length, before + 1)
      // The recorded folder is skipped and only the new one runs; a second `ADD COLUMN "extra"`
      // would fail.
      await applied()
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('`mithaq migrate` counts the rows a new NOT NULL would break, in the kayan\'s own schema and under a renamed column\'s old name, and writes nothing until none would', async (t) => {
  await migrateDatabase()
  const notes = (fields: string) => inSchemas(kayanSourceOf(`        id: { kind: 'text' },\n${fields}`), { notes: 'app' })
  const root = await migrationProject(withSummary)
  const hinted = (hints: object[]) => writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify(hints)}\n`)
  try {
    assert.equal(await sqlIn(root, resetSchemas), 0)
    await writeFile(new URL('src/asas.ts', root), notes("        summary: { kind: 'text' },"))
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    // Two of the kayan's rows hold no summary; the table of the same name in
    // `public` holds three, and is never the one counted.
    assert.equal(await sqlIn(root, `insert into app.notes (id, summary) values ('n1', null), ('n2', null), ('n3', 'kept');
      create table public.notes (id text, summary text); insert into public.notes values ('a', null), ('b', null), ('c', null);`), 0)
    await writeFile(new URL('src/asas.ts', root), notes("        summary: { kind: 'text', rules: { required: true } },"))
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 1, 'a check of a pending migration fails')
    assert.match(checked.stdout, /^notes\.summary: 2 stored rows break required\./m, 'and counts the rows the rule refuses')
    const before = (await foldersIn(root)).length
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 1, refused.stdout)
    assert.match(refused.stderr, /app\.notes\.summary holds 2 rows with no value, and SET NOT NULL would stop on them/)
    assert.match(refused.stderr, /as `update "app"\."notes" set "summary" = <value> where "summary" is null` does/, 'and the statement it suggests names the schema')
    assert.equal((await foldersIn(root)).length, before, 'the refused run wrote no migration')

    await writeFile(new URL('src/asas.ts', root), notes("        abstract: { kind: 'text', rules: { required: true } },"))
    await hinted([{ type: 'rename', kind: 'column', from: ['app', 'notes', 'summary'], to: ['app', 'notes', 'abstract'] }])
    const renamed = await migrating(root, 'migrate')
    assert.equal(renamed.code, 1, renamed.stdout)
    assert.match(renamed.stderr, /app\.notes\.summary holds 2 rows with no value/)
    assert.equal((await foldersIn(root)).length, before, 'the refused run wrote no migration')

    await rm(new URL('mithaq.hints.json', root))
    await writeFile(new URL('src/asas.ts', root), notes("        summary: { kind: 'text' },\n        body: { kind: 'text', rules: { required: true } },"))
    const added = await migrating(root, 'migrate')
    assert.equal(added.code, 1, added.stdout)
    assert.match(added.stderr, /app\.notes\.body would be added NOT NULL with no default over 3 rows/)
    assert.equal((await foldersIn(root)).length, before, 'the refused run wrote no migration')

    assert.equal(await sqlIn(root, `update app.notes set summary = 'filled' where summary is null`), 0)
    await writeFile(new URL('src/asas.ts', root), notes("        summary: { kind: 'text', rules: { required: true } },"))
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    assert.match(await latestSql(root), /ALTER TABLE "app"\."notes" ALTER COLUMN "summary" SET NOT NULL/)
    assert.equal((await appliedIn(root)).code, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a required text counts a stored empty string, and under `trim` a value of nothing but JavaScript\'s whitespace, as the rows it refuses', async (t) => {
  await migrateDatabase()
  const summary = (rules: string) => inSchemas(kayanSourceOf(`        id: { kind: 'text' },\n        summary: { kind: 'text', rules: { ${rules} } },`), { notes: 'app' })
  const root = await migrationProject(withSummary)
  const spaces = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter((one) => one.trim() === '').join('')
  try {
    assert.equal(spaces.length, 25, 'the 25 characters ECMAScript calls white space or a line terminator')
    assert.equal(await sqlIn(root, resetSchemas), 0)
    await writeFile(new URL('src/asas.ts', root), summary('required: true, trim: true'))
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    // A zero-width space is not white space to JavaScript, so its row is kept.
    assert.equal(await sqlIn(root, `insert into app.notes (id, summary) values ('n1', '  '), ('n2', '${spaces}'), ('n3', ''), ('n4', ' kept '), ('n5', '\u200b')`), 0)
    const trimmed = await migrating(root, 'migrate', '--check')
    assert.equal(trimmed.code, 0, trimmed.stderr)
    assert.match(trimmed.stdout, /^notes\.summary: 3 stored rows break required\./m)
    assert.doesNotMatch(trimmed.stdout, /required \(trim\)/, 'and the rule is counted, not listed as uncounted')
    const written = await migrating(root, 'migrate')
    assert.match(written.stdout, /^notes\.summary: 3 stored rows break required\./m, 'a write counts them too')
    await writeFile(new URL('src/asas.ts', root), summary('required: true'))
    const plain = await migrating(root, 'migrate', '--check')
    assert.equal(plain.code, 0, plain.stderr)
    assert.match(plain.stdout, /^notes\.summary: 1 stored row breaks required\./m)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a drop, a rounding and a NOT NULL over a public kayan are asked about in current_schema(), where the migration writes them, and never in a decoy under public', async (t) => {
  await migrateDatabase()
  const base = "        id: { kind: 'text' },\n        summary: { kind: 'text' },\n        amount: { kind: 'decimal', rules: { precision: 7, scale: 3 } },\n        body: { kind: 'text' },"
  const root = await migrationProject(base)
  try {
    // `current_schema()` is `x`, so drizzle's unqualified `notes` lands
    // there, and `public.notes` is an empty table of the same shape that a
    // probe asking `"public"."notes"` would read as holding nothing.
    assert.equal(await sqlIn(root, `${resetSchemas} drop schema if exists x cascade; create schema x; alter database ${migrateName} set search_path = x, public;`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('x.notes') is not null; end $$;
      insert into notes (id, summary, amount, body) values ('n1', 'kept', 1.235, null);
      create table public.notes (id text, summary text, amount numeric, body text);`), 0)
    const before = (await foldersIn(root)).length
    const run = async (fields: string) => {
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf(fields))
      return migrating(root, 'migrate')
    }
    const dropped = await run(base.replace("        summary: { kind: 'text' },\n", ''))
    assert.equal(dropped.code, 2, dropped.stdout)
    assert.match(dropped.stderr, /"type":"confirm_data_loss","kind":"column","entity":\["public","notes","summary"\]/)
    const rounded = await run(base.replace('scale: 3', 'scale: 2'))
    assert.equal(rounded.code, 1, rounded.stdout)
    assert.match(rounded.stderr, /public\.notes\.amount holds 1 value that numeric\(7,2\) would change/)
    const nulled = await run(base.replace("body: { kind: 'text' }", "body: { kind: 'text', rules: { required: true } }"))
    assert.equal(nulled.code, 1, nulled.stdout)
    assert.match(nulled.stderr, /public\.notes\.body holds 1 row with no value/)
    assert.match(nulled.stderr, /as `update "notes" set "body" = <value> where "body" is null` does/, 'and the statement it suggests runs where the migration does')
    assert.equal((await foldersIn(root)).length, before, 'no refused run wrote a migration')
  } finally {
    await sqlIn(root, `alter database ${migrateName} reset search_path; drop schema if exists x cascade;`)
    await rm(root, { recursive: true, force: true })
  }
})

test('a migration whose schema lines are not the ones the explaining run listed is removed, and the run refused', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  // The explaining run and the writing run each load the project in a
  // drizzle-kit child of their own. Only the writing one, `generate` without
  // `--explain`, builds notes in `public`, so the file it writes carries no
  // CREATE SCHEMA where the explaining run listed a create_schema.
  await writeFile(
    new URL('src/asas.ts', root),
    kayanSourceOf(withSummary).replace("name: 'notes',", "name: 'notes', schemaName: process.argv.includes('generate') && !process.argv.includes('--explain') ? undefined : 'app',"),
  )
  try {
    assert.equal(await sqlIn(root, `${resetSchemas} ${foreignObjects}`), 0)
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 1, refused.stderr)
    assert.match(refused.stderr, /CREATE SCHEMA and DROP SCHEMA lines are not one for each create_schema and drop_schema it explained.*Nothing was written\./)
    assert.deepEqual(await foldersIn(root), [], 'the folder drizzle-kit wrote is removed')
    assert.equal(await sqlIn(root, foreignUntouched()), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * Two playbook kayan in `app`, each with a non-unique pair, and the playbook's code unique per
 * organization, the customers table's shape. `indexes` stands for what each kayan writes, so one
 * source is the same project with and without them.
 */
const playbookSource = ({ playbooks = '', tasks = '' } = {}) =>
  kayanSourceOf(withSummary).replace('  ],\n})', `    defineKayan({
      name: 'playbooks',
      schemaName: 'app',
      fields: {
        id: { kind: 'text' },
        code: { kind: 'text' },
        organization: { kind: 'relationship', relationTo: 'organization' },
        isArchived: { kind: 'checkbox' },
      },${playbooks}
    }),
    defineKayan({
      name: 'playbookTasks',
      dbName: 'playbook_tasks',
      schemaName: 'app',
      fields: {
        id: { kind: 'text' },
        playbook: { kind: 'relationship', relationTo: 'playbooks' },
        sortOrder: { kind: 'integer' },
      },${tasks}
    }),
  ],\n})`)
const playbookIndexes = {
  playbooks: "\n      indexes: [{ fields: ['organization', 'isArchived'] }, { fields: ['organization', 'code'], unique: true }],",
  tasks: "\n      indexes: [{ fields: ['playbook', 'sortOrder'] }],",
}
const playbookIndexesIn = (root: URL, expected: number) =>
  sqlIn(root, `do $$ begin assert (select count(*) from pg_indexes where schemaname = 'app' and indexname like '%\\_idx' and indexdef in (
    'CREATE INDEX playbooks_organization_id_is_archived_idx ON app.playbooks USING btree (organization_id, is_archived)',
    'CREATE UNIQUE INDEX playbooks_organization_id_code_idx ON app.playbooks USING btree (organization_id, code)',
    'CREATE INDEX playbook_tasks_playbook_id_sort_order_idx ON app.playbook_tasks USING btree (playbook_id, sort_order)'
  )) = ${expected}; end $$;`)
const duplicatePair = `insert into public.organization (id, name) values ('o1', 'One');
  insert into app.playbooks (id, code, organization_id) values ('p1', 'C-1', 'o1'), ('p2', 'C-1', 'o1');`

test('a kayan\'s indexes, TB\'s two non-unique pairs in `app` and a unique one, are one migration of three CREATE INDEX lines and nothing else, a new unique index over duplicate rows fails in Postgres and applies nothing, a removed index is a DROP INDEX asked of no one, and the push builds the same three', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  try {
    assert.equal(await sqlIn(root, resetSchemas), 0)
    await writeFile(new URL('src/asas.ts', root), playbookSource())
    const first = await migrating(root, 'migrate')
    assert.equal(first.code, 0, first.stderr)
    assert.doesNotMatch(await latestSql(root), /INDEX "playbook/, 'no kayan index before the key is written')
    const schema = await readFile(new URL('src/migrations/schema.ts', root), 'utf8')
    assert.equal((await appliedIn(root)).code, 0)

    await writeFile(new URL('src/asas.ts', root), playbookSource({ playbooks: '\n      indexes: [],' }))
    const empty = await migrating(root, 'migrate', '--check')
    assert.equal(empty.code, 0, empty.stderr)
    assert.match(empty.stdout, /The database schema is up to date\./)

    await writeFile(new URL('src/asas.ts', root), playbookSource(playbookIndexes))
    const second = await migrating(root, 'migrate')
    assert.equal(second.code, 0, second.stderr)
    assert.deepEqual(
      (await latestSql(root)).split('--> statement-breakpoint\n').sort(),
      [
        'CREATE INDEX "playbook_tasks_playbook_id_sort_order_idx" ON "app"."playbook_tasks" ("playbook_id","sort_order");',
        'CREATE INDEX "playbooks_organization_id_is_archived_idx" ON "app"."playbooks" ("organization_id","is_archived");',
        'CREATE UNIQUE INDEX "playbooks_organization_id_code_idx" ON "app"."playbooks" ("organization_id","code");',
      ],
      'the three indexes, in the kayan\'s schema, and nothing else',
    )
    assert.equal(await readFile(new URL('src/migrations/schema.ts', root), 'utf8'), schema, 'the schema module is the same bytes')

    // Two rows already share the pair the unique index is over: Postgres
    // refuses to build it, and the migration's other two indexes go with it.
    assert.equal(await sqlIn(root, duplicatePair), 0)
    const collided = await appliedIn(root)
    assert.notEqual(collided.code, 0, 'the migration fails')
    assert.match(collided.output, /could not create unique index "playbooks_organization_id_code_idx"/)
    assert.equal(await playbookIndexesIn(root, 0), 0, 'and no index of it was built')
    assert.equal(await sqlIn(root, "delete from app.playbooks where id = 'p2'"), 0)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await playbookIndexesIn(root, 3), 0, 'once the duplicate is gone, all three are built')
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
    assert.match(checked.stdout, /The database schema is up to date\./)

    await writeFile(new URL('src/asas.ts', root), playbookSource())
    const dropped = await migrating(root, 'migrate')
    assert.equal(dropped.code, 0, dropped.stderr)
    assert.deepEqual(
      (await latestSql(root)).split('--> statement-breakpoint\n').sort(),
      [
        'DROP INDEX "app"."playbook_tasks_playbook_id_sort_order_idx";',
        'DROP INDEX "app"."playbooks_organization_id_code_idx";',
        'DROP INDEX "app"."playbooks_organization_id_is_archived_idx";',
      ],
    )
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await playbookIndexesIn(root, 0), 0)

    await writeFile(new URL('src/asas.ts', root), playbookSource(playbookIndexes))
    assert.equal(await sqlIn(root, `${resetSchemas} ${ddlSeen}`), 0)
    try {
      assert.equal(await pushIn(root), 0, 'the push applies on a fresh database')
      assert.equal(await playbookIndexesIn(root, 3), 0, 'with the three indexes')
      assert.equal(await sqlIn(root, 'truncate public.ddl_seen'), 0)
      assert.equal(await pushIn(root), 0)
      assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from public.ddl_seen where identity not like 'drizzle.%') = 0; end $$;`), 0, 'and a second push plans nothing')
    } finally {
      await sqlIn(root, dropDdlSeen)
    }

    await writeFile(new URL('src/asas.ts', root), playbookSource())
    assert.equal(await sqlIn(root, resetSchemas), 0)
    assert.equal(await pushIn(root), 0)
    assert.equal(await sqlIn(root, duplicatePair), 0)
    await writeFile(new URL('src/asas.ts', root), playbookSource(playbookIndexes))
    const pushed = await outputIn(root, 'push.ts')
    assert.notEqual(pushed.code, 0, 'the push fails')
    assert.match(pushed.stderr, /could not create unique index "playbooks_organization_id_code_idx"/)
    assert.equal(await playbookIndexesIn(root, 0), 0, 'and no index of it was built')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * `notes` with a `hasMany` set of `tags`, its join table in the shape an existing database holds:
 * the three columns, the cascading foreign keys under drizzle's names and the parent index, with no
 * primary key and no index on `target_id`. Applied by hand and then adopted, so the migration that
 * follows is the one an existing database meets.
 */
const taggedNotes = "        id: { kind: 'text' },\n        tags: { kind: 'relationship', relationTo: 'tags', hasMany: true },"
const unkeyedJoin = `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;
create table notes (id text primary key, deleted_at timestamp(3) with time zone);
create table tags (id text primary key);
create table notes_tags (parent_id text not null, target_id text not null, "order" integer not null);
create index notes_tags_parent_id_index on notes_tags (parent_id);
alter table notes_tags add constraint notes_tags_parent_id_notes_id_fkey foreign key (parent_id) references notes (id) on delete cascade;
alter table notes_tags add constraint notes_tags_target_id_tags_id_fkey foreign key (target_id) references tags (id) on delete cascade;
insert into notes (id) values ('n1'), ('n2'); insert into tags (id) values ('a'), ('b'), ('c');
insert into notes_tags values ('n1', 'a', 0), ('n1', 'b', 1), ('n2', 'c', 0), ('n1', 'c', 1), ('n1', 'a', 1);`

test('a hasMany join table is keyed on (parent_id, order) and indexed on target_id under names of its own, and `mithaq migrate` counts the rows that share a pair and writes nothing until none do', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(taggedNotes)
  try {
    assert.equal(await sqlIn(root, unkeyedJoin), 0)
    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 0, adopted.stderr)
    const before = await foldersIn(root)

    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 1, refused.stdout)
    assert.match(refused.stderr, /public\.notes_tags holds 3 rows whose \(parent_id, order\) another row also holds, and ADD PRIMARY KEY would stop on them/)
    assert.deepEqual(await foldersIn(root), before, 'the refused run wrote no migration')

    assert.equal(await sqlIn(root, `delete from notes_tags where target_id = 'c' and parent_id = 'n1'; delete from notes_tags where target_id = 'a' and "order" = 1;`), 0)
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    const keyed = await latestSql(root)
    assert.match(keyed, /ADD CONSTRAINT "notes_tags_pkey" PRIMARY KEY\("parent_id","order"\)/)
    assert.match(keyed, /CREATE INDEX "notes_tags_target_id_index" ON "notes_tags" \("target_id"\)/)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(
      await sqlIn(root, `do $$ begin
        assert (select count(*) from pg_constraint where conname = 'notes_tags_pkey' and contype = 'p') = 1;
        assert (select count(*) from pg_indexes where indexname = 'notes_tags_target_id_index') = 1;
        assert (select string_agg(parent_id || target_id || "order", ',' order by parent_id, "order") from notes_tags) = 'n1a0,n1b1,n2c0';
      end $$;`),
      0,
      'the key and the index are there, and every row kept',
    )
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
