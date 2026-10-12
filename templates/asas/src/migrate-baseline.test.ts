import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { baselineOf, droppedBy, guardDroppedBy, statementsOf } from '../../../packages/mithaq/src/drizzle/migrate.ts'
import {
  accessSource,
  appliedIn,
  foldersIn,
  kayanSourceOf,
  latestSql,
  migrateDatabase,
  migrating,
  migrationProject,
  mithaqEntry,
  nothingAdopted,
  pushIn,
  sqlIn,
  template,
  withSummary,
} from './migrate.support.ts'

/**
 * A project with a `uuid` id, a `tenant_id` column and a relationship whose column is `author_id`,
 * over the access kayan the template language needs.
 */
const adoptSourceOf = (posts = '') => `import { fetchHttp } from '${mithaqEntry}'
import { buildAsas, defineKayan } from '${template}'

export const asas = buildAsas({
  http: [fetchHttp()],
  kayan: [
    defineKayan({
      name: 'authors',
      fields: {
        id: { kind: 'uuid' },
        name: { kind: 'text', rules: { required: true } },
        tenant: { kind: 'text', dbName: 'tenant_id', rules: { index: true } },
      },
    }),
    defineKayan({
      name: 'posts',
      fields: {
        id: { kind: 'uuid' },
        title: { kind: 'text', rules: { required: true, index: true } },
        author: { kind: 'relationship', relationTo: 'authors', dbName: 'author_id' },
        tenant: { kind: 'text', dbName: 'tenant_id' },${posts}
      },
    }),
${accessSource}  ],
})
`
/**
 * The same two tables written by hand with Postgres's own names, the way a
 * database another tool built carries them: `_idx` indexes and a `_fkey`
 * foreign key, where drizzle-kit writes `_index` and
 * `<table>_<col>_<ref>_<refcol>_fkey`. `legacy`, the standalone sequence
 * `sku_seq` and the enum `other_status` belong to no kayan: `tablesFilter`
 * keeps `legacy` out of a pull, and does not keep out the other two.
 */
const liveTables = `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;
create table authors (id uuid primary key default gen_random_uuid(), name text not null, tenant_id text);
create index authors_tenant_idx on authors (tenant_id);
create table posts (id uuid primary key default gen_random_uuid(), title text not null, author_id uuid constraint posts_author_id_fkey references authors (id) on delete set null, tenant_id text);
create index posts_title_idx on posts (title);
create table legacy (id integer primary key, note text);
create sequence sku_seq start 100;
create type other_status as enum ('a', 'b');
insert into authors (id, name, tenant_id) values ('00000000-0000-0000-0000-000000000001', 'Huda', 't1');
insert into posts (title, author_id, tenant_id) values ('First', '00000000-0000-0000-0000-000000000001', 't1');
insert into legacy values (1, 'keep');`
const liveUntouched = `do $$ begin
  assert (select count(*) from authors where name = 'Huda') = 1;
  assert (select count(*) from posts where title = 'First') = 1;
  assert (select count(*) from legacy where note = 'keep') = 1;
  assert to_regclass('public.sku_seq') is not null;
  assert to_regtype('public.other_status') is not null;
end $$;`

test('`mithaq migrate --baseline` adopts a live database: one folder and one row, no table touched, and the rename hints bring it to drizzle\'s names', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), adoptSourceOf())
  const migrations = new URL('src/migrations/', root)
  try {
    assert.equal(await sqlIn(root, liveTables), 0)

    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 0, adopted.stderr)
    const [folder, ...more] = await foldersIn(root)
    assert.match(folder!, /^\d{14}_baseline$/)
    assert.deepEqual(more, [], 'one folder')
    assert.match(adopted.stdout, new RegExp(`Recorded ${folder} as this database's baseline\\. Run \`mithaq migrate --check\``))
    assert.deepEqual((await readdir(new URL(`${folder}/`, migrations))).sort(), ['migration.sql', 'snapshot.json'])
    const baseline = await readFile(new URL(`${folder}/migration.sql`, migrations), 'utf8')
    assert.match(baseline, /^CREATE TABLE "authors"/, 'the statements, uncommented')
    assert.doesNotMatch(baseline, /\/\*|\*\/|^-- /m, 'with no comment left in it, only the breakpoints drizzle splits on')
    assert.doesNotMatch(baseline, /legacy/, 'and nothing of the table no kayan names')
    for (const file of ['migration.sql', 'snapshot.json']) {
      assert.doesNotMatch(
        await readFile(new URL(`${folder}/${file}`, migrations), 'utf8'),
        /sku_seq|other_status/,
        `nor, in ${file}, the sequence and the enum no kayan column uses`,
      )
    }
    assert.equal(await sqlIn(root, `select nextval('sku_seq')`), 0, 'another tool takes 100 from its counter')
    assert.match(baseline, /CREATE INDEX "authors_tenant_idx"/, 'under the live names')
    assert.equal(
      await sqlIn(root, `do $$ begin assert (select count(*) from drizzle.__mithaq_migrations) = 1; assert (select name from drizzle.__mithaq_migrations) = '${folder}'; end $$;`),
      0,
      'one row naming the folder',
    )
    assert.equal(await sqlIn(root, liveUntouched), 0, 'and every live row where it was')
    assert.equal(
      await sqlIn(root, `do $$ begin assert (select count(*) from pg_indexes where indexname in ('authors_tenant_idx', 'posts_title_idx')) = 2; end $$;`),
      0,
      'and every live name too',
    )

    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 2, checked.stderr)
    assert.match(checked.stderr, /^index public\.authors\.authors_tenant_id_index rename_or_create$/m)
    assert.match(checked.stderr, /^index public\.posts\.posts_title_index rename_or_create$/m)
    assert.match(checked.stderr, /^foreign key public\.posts\.posts_author_id_authors_id_fkey rename_or_create$/m)

    await writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify([
      { type: 'rename', kind: 'index', from: ['public', 'authors', 'authors_tenant_idx'], to: ['public', 'authors', 'authors_tenant_id_index'] },
      { type: 'rename', kind: 'index', from: ['public', 'posts', 'posts_title_idx'], to: ['public', 'posts', 'posts_title_index'] },
      { type: 'rename', kind: 'foreign key', from: ['public', 'posts', 'posts_author_id_fkey'], to: ['public', 'posts', 'posts_author_id_authors_id_fkey'] },
    ])}\n`)
    const renamed = await migrating(root, 'migrate')
    assert.equal(renamed.code, 0, renamed.stderr)
    const latest = (await foldersIn(root)).at(-1)!
    const renames = await readFile(new URL(`${latest}/migration.sql`, migrations), 'utf8')
    assert.match(renames, /ALTER INDEX "authors_tenant_idx" RENAME TO "authors_tenant_id_index"/)
    assert.match(renames, /RENAME CONSTRAINT "posts_author_id_fkey" TO "posts_author_id_authors_id_fkey"/)
    assert.doesNotMatch(renames, /DROP (TABLE|COLUMN|INDEX)|DROP CONSTRAINT/, 'a rename drops nothing')
    assert.doesNotMatch(renames, /sku_seq|other_status/, 'and the next migration never names what the baseline left out')

    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    const upToDate = await migrating(root, 'migrate', '--check')
    assert.equal(upToDate.code, 0, upToDate.stderr)
    assert.match(upToDate.stdout, /The database schema is up to date\./)
    assert.equal(await sqlIn(root, liveUntouched), 0, 'every live row survived the renames')
    assert.equal(
      await sqlIn(root, `do $$ begin assert nextval('sku_seq') = 101; end $$;`),
      0,
      'and the counter goes on from where the other tool left it',
    )
    assert.equal(
      await sqlIn(root, `do $$ begin assert (select count(*) from pg_indexes where indexname in ('authors_tenant_id_index', 'posts_title_index')) = 2; end $$;`),
      0,
    )

    assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema drizzle cascade;'), 0)
    const built = await appliedIn(root)
    assert.equal(built.code, 0, built.output)
    const fresh = await migrating(root, 'migrate', '--check')
    assert.equal(fresh.code, 0, fresh.stderr)
    assert.match(fresh.stdout, /The database schema is up to date\./)
    assert.equal(
      await sqlIn(root, `do $$ begin assert (select count(*) from pg_indexes where indexname in ('authors_tenant_id_index', 'posts_title_index')) = 2; assert (select count(*) from pg_constraint where conname = 'posts_author_id_authors_id_fkey') = 1; end $$;`),
      0,
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate --baseline` replaces the dev-push marker of a pushed database with its baseline row', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  try {
    await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
    assert.equal(await pushIn(root), 0)
    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 0, adopted.stderr)
    const [folder] = await foldersIn(root)
    assert.equal(
      await sqlIn(root, `do $$ begin assert (select count(*) from drizzle.__mithaq_migrations) = 1; assert (select name from drizzle.__mithaq_migrations) = '${folder}'; end $$;`),
      0,
      'the marker is gone and the baseline row is the only one',
    )
    // The push built the tables from the kayan, so the baseline already says
    // what they say.
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
    assert.match(checked.stdout, /The database schema is up to date\./)
  } finally {
    await rm(root, { recursive: true })
  }
})

test("`mithaq migrate --baseline` adopts a database holding another tool's drizzle history without touching it", async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), adoptSourceOf())
  try {
    assert.equal(await sqlIn(root, liveTables), 0)
    // The three-column table a pre-1.0 drizzle leaves, holding that project's
    // own history.
    assert.equal(
      await sqlIn(root, `create schema drizzle; create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);
        insert into drizzle.__drizzle_migrations (hash, created_at) values ('theirs-1', 1), ('theirs-2', 2);`),
      0,
    )
    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 0, adopted.stderr)
    assert.equal(
      await sqlIn(root, `do $$ begin
        assert (select string_agg(hash, ',' order by id) from drizzle.__drizzle_migrations) = 'theirs-1,theirs-2';
        assert (select count(*) from information_schema.columns where table_schema = 'drizzle' and table_name = '__drizzle_migrations') = 3;
        assert (select count(*) from drizzle.__mithaq_migrations) = 1;
      end $$;`),
      0,
      'their rows and their table are as they were, and the baseline is the one row of mithaq\'s own',
    )
    assert.equal(await sqlIn(root, liveUntouched), 0)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate` asks for a confirm_guard_loss reply before it drops a live check, an enum or a column\'s enum type', async (t) => {
  await migrateDatabase()
  const label = "{ ar: 'x', en: 'x' }"
  const root = await migrationProject(
    `        id: { kind: 'text' },\n        status: { kind: 'text', options: [{ value: 'draft', label: ${label} }, { value: 'live', label: ${label} }] },\n        kind: { kind: 'text' },`,
  )
  try {
    assert.equal(
      await sqlIn(root, `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;
        create type note_status as enum ('draft', 'live');
        create table notes (id text primary key, status note_status, kind text constraint notes_kind_check check (kind in ('a', 'b')), deleted_at timestamp(3) with time zone);
        insert into notes values ('one', 'live', 'a', null);`),
      0,
    )
    assert.equal((await migrating(root, 'migrate', '--baseline')).code, 0)
    const before = await foldersIn(root)

    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 2, refused.stderr)
    assert.match(refused.stderr, /^\{"type":"confirm_guard_loss","kind":"check","entity":\["public","notes","notes_kind_check"\]\}$/m)
    assert.match(refused.stderr, /^\{"type":"confirm_guard_loss","kind":"enum","entity":\["public","note_status"\]\}$/m)
    assert.match(refused.stderr, /^\{"type":"confirm_guard_loss","kind":"column","entity":\["public","notes","status"\]\}$/m)
    assert.match(refused.stderr, /as confirm_guard_loss replies/, 'and the sentence names the reply')
    assert.deepEqual(await foldersIn(root), before, 'no migration is written before the reply')

    await writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify([
      { type: 'confirm_guard_loss', kind: 'check', entity: ['public', 'notes', 'notes_kind_check'] },
      { type: 'confirm_guard_loss', kind: 'enum', entity: ['public', 'note_status'] },
      { type: 'confirm_guard_loss', kind: 'column', entity: ['public', 'notes', 'status'] },
    ])}\n`)
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    assert.doesNotMatch(written.stdout, /answers no/, 'every reply answered a drop')
    const sql = await readFile(new URL(`${(await foldersIn(root)).at(-1)}/migration.sql`, new URL('src/migrations/', root)), 'utf8')
    assert.match(sql, /DROP CONSTRAINT "notes_kind_check"/)
    assert.match(sql, /DROP TYPE "note_status"/)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, `do $$ begin assert (select status from notes where id = 'one') = 'live'; end $$;`), 0, 'the value outlives its type')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate --baseline` refuses, writing no folder and no row, everything section 4 of the design names', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await writeFile(new URL('src/asas.ts', root), adoptSourceOf())
  try {
    // First, because it is also the run that writes the config and the
    // module: a baseline takes a run's own code path up to the pull.
    await t.test('7. a database holding none of the language\'s tables', async () => {
      assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade; create table legacy (id integer primary key);'), 0)
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /This database holds none of the 7 tables this language builds, so there is nothing to adopt\. Run `mithaq migrate`\./)
      await nothingAdopted(root)
    })

    await t.test('1. with --check', async () => {
      assert.equal(await sqlIn(root, liveTables), 0)
      const refused = await migrating(root, 'migrate', '--baseline', '--check')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /`--baseline` records a baseline and `--check` writes nothing/)
      await nothingAdopted(root)
    })

    await t.test('3. a config naming another schema file', async () => {
      const config = new URL('src/migrations/drizzle.config.ts', root)
      const whole = await readFile(config, 'utf8')
      await writeFile(config, whole.replace("'schema.ts'", "'other.ts'"))
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /names a schema file `mithaq migrate` did not write/)
      await nothingAdopted(root)
      await writeFile(config, whole)
    })

    await t.test('4. a migrations folder already holding a migration', async () => {
      await mkdir(new URL('src/migrations/20200101000000_earlier/', root))
      await writeFile(new URL('src/migrations/20200101000000_earlier/migration.sql', root), 'SELECT 1;\n')
      await writeFile(new URL('src/migrations/20200101000000_earlier/snapshot.json', root), '{}\n')
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /20200101000000_earlier under .* is a migration, so this project already has a history/)
      await nothingAdopted(root)
      await rm(new URL('src/migrations/20200101000000_earlier/', root), { recursive: true })
    })

    await t.test('5. a database whose history holds a row that is not the marker', async () => {
      assert.equal(
        await sqlIn(root, `create schema drizzle; create table drizzle.__mithaq_migrations (id serial primary key, hash text not null, created_at bigint, name text, applied_at timestamp with time zone default now());
          insert into drizzle.__mithaq_migrations (hash, created_at, name) values ('h', 0, '20200101000000_elsewhere');`),
        0,
      )
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /drizzle\.__mithaq_migrations already holds migration rows/)
      await nothingAdopted(root)
      await sqlIn(root, 'drop schema drizzle cascade;')
    })

    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 0, adopted.stderr)
  } finally {
    await rm(root, { recursive: true })
  }
})

/**
 * `notes` with two `hasMany` fields, as a database built by another tool holds them: the two
 * tables, and one `notes_rels`, its rows for `tags` and `related` numbered from 1 under each path.
 * `pages_rels` is another collection's, and `legacy` no kayan's.
 */
const relsNotes = "        id: { kind: 'text' },\n        tags: { kind: 'relationship', relationTo: 'tags', hasMany: true },\n        related: { kind: 'relationship', relationTo: 'notes', hasMany: true },"
const payloadRels = (rows: string, extra = '', types = '') => `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;
${types}
create table notes (id text primary key, deleted_at timestamp(3) with time zone);
create table tags (id text primary key);
create table notes_rels (id serial primary key, "order" integer, parent_id text not null, path varchar not null, tags_id text, notes_id text${extra});
create index notes_rels_order_idx on notes_rels ("order");
create index notes_rels_parent_idx on notes_rels (parent_id);
create index notes_rels_path_idx on notes_rels (path);
create index notes_rels_tags_id_idx on notes_rels (tags_id);
create index notes_rels_notes_id_idx on notes_rels (notes_id);
alter table notes_rels add constraint notes_rels_parent_fk foreign key (parent_id) references notes (id) on delete cascade;
alter table notes_rels add constraint notes_rels_tags_fk foreign key (tags_id) references tags (id) on delete cascade;
alter table notes_rels add constraint notes_rels_notes_fk foreign key (notes_id) references notes (id) on delete cascade;
create table pages_rels (id serial primary key, "order" integer, parent_id text not null, path varchar not null);
insert into pages_rels ("order", parent_id, path) values (1, 'p1', 'blocks');
create table legacy (id integer primary key, note text);
insert into legacy values (1, 'keep');
insert into notes (id) values ('n1'), ('n2'), ('n3'); insert into tags (id) values ('a'), ('b'), ('c');
${rows}`
const twoFields = `insert into notes_rels ("order", parent_id, path, tags_id, notes_id) values
  (1, 'n1', 'tags', 'b', null), (2, 'n1', 'tags', 'a', null), (1, 'n2', 'tags', 'c', null),
  (1, 'n1', 'related', null, 'n3'), (2, 'n1', 'related', null, 'n2'), (1, 'n3', 'related', null, 'n1');`
const othersUntouched = `do $$ begin
  assert (select count(*) from legacy where note = 'keep') = 1;
  assert (select count(*) from pages_rels where path = 'blocks' and parent_id = 'p1') = 1;
end $$;`

test('`--baseline` adopts Payload\'s notes_rels, and the migration that follows copies each path\'s rows into its join table in order and drops it, in one transaction, leaving every other table as it was', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(relsNotes)
  try {
    assert.equal(await sqlIn(root, payloadRels(twoFields)), 0)
    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 0, adopted.stderr)
    assert.match(adopted.stdout, /public\.notes_rels holds Payload's relationship rows for tags and related, which the next `mithaq migrate` copies into notes_tags and notes_related before it drops public\.notes_rels\./)
    assert.match(await latestSql(root), /CREATE TABLE "notes_rels"/, 'the baseline holds it, so a fresh database built through the folders has one to copy from')

    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    const copy = await latestSql(root)
    const chunks = copy.split('--> statement-breakpoint\n')
    assert.deepEqual(chunks.slice(-3), [
      `INSERT INTO "notes_tags" ("parent_id", "target_id", "order") SELECT "parent_id", "tags_id", "order" FROM "notes_rels" WHERE "path" = 'tags';`,
      `INSERT INTO "notes_related" ("parent_id", "target_id", "order") SELECT "parent_id", "notes_id", "order" FROM "notes_rels" WHERE "path" = 'related';`,
      'DROP TABLE "notes_rels";',
    ], 'one copy per field, and the drop last')
    assert.equal(chunks.filter((chunk) => /DROP TABLE "notes_rels"/.test(chunk)).length, 1, 'and dropped once')
    assert.doesNotMatch(copy, /pages_rels|legacy/)

    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(
      await sqlIn(root, `do $$ begin
        assert (select string_agg(parent_id || ':' || target_id || ':' || "order", ',' order by parent_id, "order") from notes_tags) = 'n1:b:1,n1:a:2,n2:c:1';
        assert (select string_agg(parent_id || ':' || target_id || ':' || "order", ',' order by parent_id, "order") from notes_related) = 'n1:n3:1,n1:n2:2,n3:n1:1';
        assert to_regclass('public.notes_rels') is null;
      end $$;`),
      0,
      'the join tables hold exactly those rows in order, and notes_rels is gone',
    )
    assert.equal(await sqlIn(root, othersUntouched), 0, 'and the tables no kayan owns are as they were')
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)

    assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema drizzle cascade;'), 0)
    const built = await appliedIn(root)
    assert.equal(built.code, 0, built.output)
    const fresh = await migrating(root, 'migrate', '--check')
    assert.equal(fresh.code, 0, fresh.stderr)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('`--baseline` names a notes_rels it leaves alone because it lacks Payload\'s parent key', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(relsNotes)
  try {
    assert.equal(await sqlIn(root, payloadRels(`${twoFields} alter table notes_rels drop constraint notes_rels_parent_fk;`)), 0)
    const baselined = await migrating(root, 'migrate', '--baseline')
    assert.equal(baselined.code, 0, baselined.stderr)
    assert.match(baselined.stdout, /public\.notes_rels is left alone because it lacks Payload's parent key, a foreign key from parent_id to public\.notes whose name ends in _fk\./)
    assert.doesNotMatch(await latestSql(root), /CREATE TABLE "notes_rels"/, 'and the baseline does not hold it')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('`--baseline` refuses a notes_rels holding a path, a second collection or a locale a join table cannot carry, writing nothing, and the migration refuses the rows that arrive after it', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(relsNotes)
  try {
    await t.test('a path that names no hasMany field', async () => {
      assert.equal(await sqlIn(root, payloadRels(`${twoFields} insert into notes_rels ("order", parent_id, path, tags_id) values (1, 'n1', 'authors', 'a'), (1, 'n2', 'blocks.tags', 'a');`)), 0)
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1, refused.stdout)
      assert.match(refused.stderr, /public\.notes_rels holds rows under the paths "authors" and "blocks\.tags", which name no hasMany field of kayan "notes", so the first migration after a baseline would drop them\. Nothing was written\./)
      await nothingAdopted(root)
      assert.equal(await sqlIn(root, othersUntouched), 0)
    })

    await t.test('a path pointing at two collections', async () => {
      assert.equal(await sqlIn(root, payloadRels(`${twoFields} insert into notes_rels ("order", parent_id, path, tags_id, notes_id) values (3, 'n1', 'tags', 'c', 'n2');`)), 0)
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1, refused.stdout)
      assert.match(refused.stderr, /public\.notes_rels holds 1 row under "tags" that points at a collection other than tags, a polymorphic relationship, and a mithaq join table points at one kayan\. Nothing was written\./)
      await nothingAdopted(root)
    })

    await t.test('a column for a collection no kayan builds', async () => {
      assert.equal(await sqlIn(root, payloadRels(twoFields, ', media_id text')), 0)
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1, refused.stdout)
      assert.match(refused.stderr, /public\.notes_rels has the column media_id, pointing at a collection no kayan of this language builds in public, so the baseline would hold a foreign key to a table it never creates\. Nothing was written\./)
      await nothingAdopted(root)
    })

    // The `locale` column is typed with its own enum of the configured locales.
    await t.test('a localized path', async () => {
      assert.equal(await sqlIn(root, payloadRels(
        `insert into notes_rels ("order", parent_id, path, tags_id, locale) values (1, 'n1', 'tags', 'a', 'en'), (1, 'n1', 'tags', 'b', 'ar');`,
        ', locale "enum__locales"',
        `create type "enum__locales" as enum ('ar', 'en');`,
      )), 0)
      const refused = await migrating(root, 'migrate', '--baseline')
      assert.equal(refused.code, 1, refused.stdout)
      assert.match(refused.stderr, /public\.notes_rels holds 2 rows under "tags" with a locale, a localized relationship, and a mithaq join table holds one set for every locale\. Nothing was written\./)
      await nothingAdopted(root)
    })

    // Adopted clean, and then a row no field names arrives before the
    // migration is written, and another before it is applied.
    assert.equal(await sqlIn(root, payloadRels(twoFields)), 0)
    assert.equal((await migrating(root, 'migrate', '--baseline')).code, 0)
    const before = await foldersIn(root)
    assert.equal(await sqlIn(root, `insert into notes_rels ("order", parent_id, path, tags_id) values (1, 'n1', 'authors', 'a');`), 0)
    const late = await migrating(root, 'migrate')
    assert.equal(late.code, 1, late.stdout)
    assert.match(late.stderr, /under the path "authors", which names no hasMany field of kayan "notes"/)
    assert.deepEqual(await foldersIn(root), before, 'the refused run wrote no migration')
    assert.equal(await sqlIn(root, `delete from notes_rels where path = 'authors'`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal(await sqlIn(root, `insert into notes_rels ("order", parent_id, path, tags_id) values (1, 'n1', 'authors', 'a');`), 0)
    const stopped = await appliedIn(root)
    assert.notEqual(stopped.code, 0, 'the migration stops on the row')
    assert.match(stopped.output, /notes_rels holds 1 rows? that/)
    assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from notes_rels) = 7; assert to_regclass('public.notes_tags') is null; end $$;`), 0, 'and applies nothing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a Payload notes_rels no hasMany field carries any more is dropped only empty: rows it holds when the migration is applied stop it, counted, and nothing changes', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(relsNotes)
  try {
    assert.equal(await sqlIn(root, payloadRels('')), 0)
    assert.equal((await migrating(root, 'migrate', '--baseline')).code, 0)
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf("        id: { kind: 'text' },"))
    // Not adopted, so drizzle asks whether each table created is notes_rels renamed, as it asks of
    // any dropped table, and the project answers.
    const asked = await migrating(root, 'migrate')
    assert.equal(asked.code, 2, asked.stdout)
    assert.match(asked.stderr, /^table public\.roles rename_or_create$/m)
    await writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify(['member', 'member_roles', 'organization', 'roles', 'user'].map((name) => ({ type: 'create', kind: 'table', entity: ['public', name] })))}\n`)
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    const chunks = (await latestSql(root)).split('--> statement-breakpoint\n')
    const at = chunks.indexOf('DROP TABLE "notes_rels";')
    assert.ok(at > 0, 'drizzle drops it')
    assert.match(chunks[at - 1]!, /SELECT count\(\*\) INTO lost FROM "notes_rels";/, 'behind a count of its rows')

    assert.equal(await sqlIn(root, `insert into notes_rels ("order", parent_id, path, tags_id) values (1, 'n1', 'tags', 'a'), (2, 'n1', 'tags', 'b');`), 0)
    const stopped = await appliedIn(root)
    assert.notEqual(stopped.code, 0, 'the migration stops')
    assert.match(stopped.output, /notes_rels holds 2 rows that no hasMany field carries, and dropping it would lose them\. Nothing was applied\./)
    assert.equal(await sqlIn(root, `do $$ begin assert (select count(*) from notes_rels) = 2; assert to_regclass('public.roles') is null; end $$;`), 0, 'and changes nothing')

    assert.equal(await sqlIn(root, 'delete from notes_rels'), 0)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('public.notes_rels') is null; end $$;`), 0, 'empty, it is dropped')
    assert.equal(await sqlIn(root, othersUntouched), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an enum another tool\'s table still uses, Payload\'s enum__locales beside an adopted notes_rels, is left out of the migration and asked about by no one, and the enum and that table are untouched', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(relsNotes)
  try {
    // A localized relationship elsewhere in the collection gives notes_rels a locale column, null
    // on every row of the two fields, and notes_locales uses the same enum.
    assert.equal(await sqlIn(root, payloadRels(
      `${twoFields} insert into notes_locales (_locale, _parent_id) values ('ar', 'n1');`,
      ', locale "enum__locales"',
      `create type "enum__locales" as enum ('ar', 'en');
      create table notes_locales (id serial primary key, _locale "enum__locales" not null, _parent_id text not null);`,
    )), 0)
    assert.equal((await migrating(root, 'migrate', '--baseline')).code, 0)
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    assert.match(written.stdout, /The enum public\.enum__locales is kept: public\.notes_locales still uses it, and no kayan does\./)
    const copy = await latestSql(root)
    assert.doesNotMatch(copy, /DROP TYPE|notes_locales/)
    assert.match(copy, /DROP TABLE "notes_rels";$/)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(
      await sqlIn(root, `do $$ begin
        assert to_regtype('public.enum__locales') is not null;
        assert (select string_agg(_locale::text || ':' || _parent_id, ',') from notes_locales) = 'ar:n1';
        assert (select count(*) from notes_tags) = 3 and (select count(*) from notes_related) = 3;
        assert to_regclass('public.notes_rels') is null;
      end $$;`),
      0,
      'the copy ran, and the enum and notes_locales are as they were',
    )
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * A project's own table named like a `_rels`, with its three columns but none of its foreign key
 * names.
 */
const auditSource = (table: string) => kayanSourceOf(withSummary).replace('  ],\n})', `    defineKayan({ name: 'audit', fields: { id: { kind: 'text' } } }),
    defineKayan({
      name: 'auditRels',
      dbName: '${table}',
      fields: { id: { kind: 'text' }, parent: { kind: 'relationship', relationTo: 'audit' }, path: { kind: 'text' }, order: { kind: 'integer' } },
    }),
  ],\n})`)

test('a project\'s own audit_rels, renamed, gets drizzle\'s question as before, and dropped it gets no Payload guard', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  try {
    assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;'), 0)
    await writeFile(new URL('src/asas.ts', root), auditSource('audit_rels'))
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `insert into audit (id) values ('a1'); insert into audit_rels (id, parent_id, path, "order") values ('r1', 'a1', 'x', 1);`), 0)
    const before = await foldersIn(root)

    await writeFile(new URL('src/asas.ts', root), auditSource('audit_entries'))
    const asked = await migrating(root, 'migrate')
    assert.equal(asked.code, 2, asked.stdout)
    assert.match(asked.stderr, /^table public\.audit_entries rename_or_create$/m)
    assert.doesNotMatch(asked.stdout, /left alone/, 'and a plain migrate does not say a table is left alone')
    assert.deepEqual(await foldersIn(root), before, 'nothing is written before the answer')

    await writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify([
      { type: 'create', kind: 'table', entity: ['public', 'audit_entries'] },
      { type: 'confirm_data_loss', kind: 'table', entity: ['public', 'audit_rels'] },
    ])}\n`)
    const dropped = await migrating(root, 'migrate')
    assert.equal(dropped.code, 0, dropped.stderr)
    const written = await latestSql(root)
    assert.match(written, /DROP TABLE "audit_rels";/)
    assert.doesNotMatch(written, /DO \$\$|Payload/, 'the drop the project confirmed carries no guard')
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, `do $$ begin assert to_regclass('public.audit_rels') is null; end $$;`), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the data-loss guard names an entity for every statement drizzle's own guard raises a hint for", () => {
  // Every shape is the one drizzle-kit's `suggestions$3` reads off the statement, and
  // `recreate_column` is the one it does not: postgres's `recreateColumnConvertor` emits
  // `dropColumnConvertor` over `diff.$right` before it adds the column back, so the drop is
  // unconditional.
  assert.deepEqual(droppedBy({ type: 'drop_table', table: { schema: 'public', name: 'notes' } }), {
    kind: 'table',
    entity: ['public', 'notes'],
  })
  assert.deepEqual(droppedBy({ type: 'drop_column', column: { schema: 'public', table: 'notes', name: 'summary' } }), {
    kind: 'column',
    entity: ['public', 'notes', 'summary'],
  })
  // mithaq never drops a schema: the line is a comment in the migration.
  assert.equal(droppedBy({ type: 'drop_schema', name: 'archive' } as never), undefined)
  assert.throws(() => droppedBy({ type: 'rename_schema', from: { name: 'app' }, to: { name: 'app2' } } as never), /renames the schema app to app2/)
  assert.deepEqual(droppedBy({ type: 'drop_pk', pk: { schema: 'public', table: 'notes', name: 'notes_pkey' } }), {
    kind: 'primary_key',
    entity: ['public', 'notes', 'notes_pkey'],
  })
  assert.deepEqual(droppedBy({ type: 'drop_pk', pk: { table: 'notes', name: 'notes_pkey' } }), {
    kind: 'primary_key',
    entity: ['public', 'notes', 'notes_pkey'],
  }, "a primary key names no schema when it is public, which is drizzle's own default")
  assert.deepEqual(droppedBy({ type: 'drop_view', view: { schema: 'public', name: 'totals', materialized: true } }), {
    kind: 'view',
    entity: ['public', 'totals'],
  })
  assert.equal(
    droppedBy({ type: 'drop_view', view: { schema: 'public', name: 'totals', materialized: false } }),
    undefined,
    'a plain view stores no rows of its own, which is why drizzle asks about a materialized one alone',
  )
  assert.deepEqual(
    droppedBy({ type: 'recreate_column', diff: { $right: { schema: 'public', table: 'notes', name: 'summary' } } }),
    { kind: 'column', entity: ['public', 'notes', 'summary'] },
  )
  for (const type of ['create_table', 'add_column', 'rename_column', 'move_table', 'alter_column', 'drop_index', 'recreate_index']) {
    assert.equal(droppedBy({ type }), undefined, `${type} takes no row with it`)
  }
  // Both are `ALTER TABLE … DROP CONSTRAINT` shapes reachable from the shipped
  // `unique` rule, so removing `unique: true` is a migration and not a refusal.
  for (const type of ['drop_unique', 'alter_unique']) {
    assert.equal(droppedBy({ type }), undefined, `${type} drops a constraint and no rows`)
  }
  // A missing container gets the same sentence as a part that is not a name, not the TypeError
  // destructuring would raise.
  assert.throws(() => droppedBy({ type: 'drop_table' } as never), /drop_table/)
  assert.throws(() => droppedBy({ type: 'recreate_column' } as never), /recreate_column/)
})

test('the data-loss guard refuses a statement type it does not recognise rather than passing it through', () => {
  // A type neither list names is a drizzle release this build has not been measured against;
  // passing it through is how a drop reaches a migration with nothing counting its rows. Both are
  // emitted by the postgres dialect; `recreate_view` and the `alter_*_column_not_null` types are
  // cockroach's alone.
  assert.throws(() => droppedBy({ type: 'alter_pk' }), /alter_pk/)
  assert.throws(() => droppedBy({ type: 'alter_view' }), /alter_view/)
  // Dropping an enum value is the postgres type that most obviously loses data, and it is refused
  // because nothing measured it.
  assert.throws(() => droppedBy({ type: 'alter_type_drop_value' }), /alter_type_drop_value/)
  // The parts are drizzle's to send and this command's to check: an `undefined`
  // identifier reaches postgres as `undefined_table`, which the probe reads as
  // nothing to lose.
  assert.throws(
    () => droppedBy({ type: 'drop_column', column: { schema: 'public', table: '', name: 'summary' } }),
    /drop_column/,
  )
  assert.throws(
    () => droppedBy({ type: 'drop_table', table: { schema: 'public', name: undefined as unknown as string } }),
    /drop_table/,
  )
})

test('the guard asks before a migration drops a check, an enum or a column\'s enum type, and names each the way a reply names it', () => {
  assert.deepEqual(
    guardDroppedBy({ type: 'drop_check', check: { schema: 'public', table: 'posts', name: 'posts_kind_check' } } as never),
    { kind: 'check', entity: ['public', 'posts', 'posts_kind_check'] },
  )
  assert.deepEqual(guardDroppedBy({ type: 'drop_enum', enum: { schema: 'public', name: 'post_status' } } as never), {
    kind: 'enum',
    entity: ['public', 'post_status'],
  })
  // The shape drizzle-kit 1.0.0-rc.4 sends for `post_status` to `text`.
  const leaving = { schema: 'public', table: 'posts', name: 'status' }
  assert.deepEqual(guardDroppedBy({ type: 'alter_column', wasEnum: true, isEnum: false, diff: { $right: leaving } } as never), {
    kind: 'column',
    entity: ['public', 'posts', 'status'],
  })
  assert.equal(guardDroppedBy({ type: 'alter_column', wasEnum: false, isEnum: false, diff: { $right: leaving } } as never), undefined)
  assert.deepEqual(guardDroppedBy({ type: 'drop_sequence', sequence: { schema: 'public', name: 'sku_seq' } } as never), {
    kind: 'sequence',
    entity: ['public', 'sku_seq'],
  })
  assert.throws(() => droppedBy({ type: 'drop_sequence' }), /drop_sequence/)
  assert.equal(guardDroppedBy({ type: 'drop_index' }), undefined)
  assert.throws(() => guardDroppedBy({ type: 'drop_check', check: { schema: 'public', table: '', name: 'x' } } as never), /drop_check/)
  // Neither drops a row, and neither is on the data-loss guard's safe list: the run asks this guard
  // first.
  assert.throws(() => droppedBy({ type: 'drop_check' }), /drop_check/)
  assert.throws(() => droppedBy({ type: 'drop_enum' }), /drop_enum/)
})

test('a pull `--baseline` cannot uncomment exactly is refused: an error, a table outside the filter, a file in another shape', () => {
  const sql = '-- Current sql file was generated after introspecting the database\n-- If you want to run this migration please uncomment this code before executing migrations\n/*\nCREATE TABLE "authors" ("id" uuid);\n*/'
  const snapshot = (...tables: string[]) => JSON.stringify({ ddl: tables.map((name) => ({ entityType: 'tables', schema: 'public', name })) })
  const ok = { status: 'ok', migrationPath: '/pulled/20261007000000_some_words/migration.sql', snapshotPath: '/pulled/20261007000000_some_words/snapshot.json' } as const
  const files = (migration: string, snap: string) => (path: string) => (path.endsWith('migration.sql') ? migration : snap)

  assert.deepEqual(baselineOf({ envelope: ok, read: files(sql, snapshot('authors')), tables: ['public.authors', 'public.posts'] }), {
    folder: '20261007000000_baseline',
    sql: 'CREATE TABLE "authors" ("id" uuid);',
    snapshot: snapshot('authors'),
  })
  assert.throws(
    () => baselineOf({ envelope: { status: 'error', error: { code: 'unknown_error' } }, read: files(sql, snapshot()), tables: ['public.authors'] }),
    /drizzle-kit refused: unknown_error/,
  )
  assert.throws(
    () => baselineOf({ envelope: ok, read: files('-- a\n-- b\n/*\n\n*/', snapshot()), tables: ['public.authors', 'public.posts'] }),
    /none of the 2 tables this language builds/,
  )
  assert.throws(
    () => baselineOf({ envelope: ok, read: files(sql, snapshot('authors', 'legacy')), tables: ['public.authors'] }),
    /public\.legacy, which no kayan of this language names/,
  )
  for (const shape of [sql.replace('/*\n', ''), sql.replace(/\*\/$/, ''), sql.replace('-- Current', 'Current'), sql.replace('uuid);', 'uuid); /* inner */')]) {
    assert.throws(
      () => baselineOf({ envelope: ok, read: files(shape, snapshot('authors')), tables: ['public.authors'] }),
      /in a shape `--baseline` has not measured/,
    )
  }
})

test('a baseline leaves out every standalone sequence and every enum no pulled column uses, from the SQL and the snapshot alike', () => {
  // The statements and the snapshot entries drizzle-kit 1.0.0-rc.4 pulled
  // from a live `sku_seq`, an unused `other_status` and a used `post_status`.
  const statements = [
    `CREATE TYPE "other_status" AS ENUM('a', 'b');`,
    `\nCREATE TYPE "post_status" AS ENUM('draft', 'live');`,
    `\nCREATE SEQUENCE "public"."sku_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100 CACHE 1;`,
    `\nCREATE TABLE "posts" (\n\t"id" uuid PRIMARY KEY,\n\t"status" "post_status"\n);\n`,
  ]
  const wrapped = (body: string) => `-- one\n-- two\n/*\n${body}\n*/`
  const ddl = [
    { entityType: 'enums', schema: 'public', name: 'other_status', values: ['a', 'b'] },
    { entityType: 'enums', schema: 'public', name: 'post_status', values: ['draft', 'live'] },
    { entityType: 'tables', schema: 'public', name: 'posts' },
    { entityType: 'columns', schema: 'public', table: 'posts', name: 'id', type: 'uuid', typeSchema: null },
    { entityType: 'columns', schema: 'public', table: 'posts', name: 'status', type: 'post_status', typeSchema: 'public' },
    { entityType: 'sequences', schema: 'public', name: 'sku_seq' },
  ]
  const ok = { status: 'ok', migrationPath: '/pulled/20261007000000_some_words/migration.sql', snapshotPath: '/pulled/20261007000000_some_words/snapshot.json' } as const
  const files = (migration: string, entries: object[]) => (path: string) =>
    (path.endsWith('migration.sql') ? migration : JSON.stringify({ dialect: 'postgres', ddl: entries }))

  const adopted = baselineOf({ envelope: ok, read: files(wrapped(statements.join('--> statement-breakpoint')), ddl), tables: ['public.posts'] })
  assert.equal(adopted.sql, [statements[1]!.slice(1), statements[3]].join('--> statement-breakpoint'))
  assert.deepEqual(
    (JSON.parse(adopted.snapshot) as { ddl: { name: string }[] }).ddl.map((entry) => entry.name),
    ['post_status', 'posts', 'id', 'status'],
  )
  // A statement the baseline leaves out has to be found exactly once, under
  // the name it was pulled as, or nothing is written.
  assert.throws(
    () => baselineOf({ envelope: ok, read: files(wrapped([statements[0], statements[3]].join('--> statement-breakpoint').replace('"other_status"', '"other_status_x"')), ddl.slice(0, 5)), tables: ['public.posts'] }),
    /other_status/,
  )
  assert.throws(
    () => baselineOf({ envelope: ok, read: files(wrapped(statements.slice(1).join('--> statement-breakpoint')), ddl), tables: ['public.posts'] }),
    /other_status/,
  )
})

test('6. a baseline matches pulled tables as schema and name, refuses a pulled view of either kind, and keeps each pulled schema with IF NOT EXISTS', () => {
  const wrapped = (body: string) => `-- one\n-- two\n/*\n${body}\n*/`
  const ok = { status: 'ok', migrationPath: '/pulled/20261009000000_some_words/migration.sql', snapshotPath: '/pulled/20261009000000_some_words/snapshot.json' } as const
  const files = (migration: string, entries: object[]) => (path: string) =>
    (path.endsWith('migration.sql') ? migration : JSON.stringify({ dialect: 'postgres', ddl: entries }))
  const statements = ['CREATE SCHEMA "app";\n', '\nCREATE TABLE "app"."playbooks" (\n\t"id" text PRIMARY KEY\n);\n']
  const ddl = [{ entityType: 'schemas', name: 'app' }, { entityType: 'tables', schema: 'app', name: 'playbooks' }]
  const adopted = baselineOf({ envelope: ok, read: files(wrapped(statements.join('--> statement-breakpoint')), ddl), tables: ['app.playbooks'] })
  assert.equal(adopted.sql, ['CREATE SCHEMA IF NOT EXISTS "app";\n', statements[1]].join('--> statement-breakpoint'))
  assert.throws(
    () => baselineOf({ envelope: ok, read: files(wrapped(statements.join('--> statement-breakpoint')), ddl), tables: ['public.playbooks'] }),
    /app\.playbooks, which no kayan of this language names/,
  )
  for (const materialized of [false, true]) {
    assert.throws(
      () => baselineOf({ envelope: ok, read: files(wrapped(statements.join('--> statement-breakpoint')), [...ddl, { entityType: 'views', schema: 'public', name: 'playbooks', materialized }]), tables: ['app.playbooks'] }),
      new RegExp(`returned the ${materialized ? 'materialized view' : 'view'} public\\.playbooks, named like a table of this language`),
    )
  }
  assert.throws(
    () => baselineOf({ envelope: ok, read: files(wrapped(statements.join('--> statement-breakpoint')), ddl.slice(1)), tables: ['app.playbooks'] }),
    /CREATE SCHEMA lines are not one for each schema/,
  )
})

test('an `ok` envelope carrying no statements is refused rather than read as an empty migration', () => {
  assert.deepEqual(statementsOf({ status: 'no_changes' }), [])
  assert.deepEqual(statementsOf({ status: 'ok', statements: [{ type: 'create_table' }] }), [{ type: 'create_table' }])
  assert.throws(() => statementsOf({ status: 'ok' }), /without listing its statements/)
  // `statements: []` is the same answer as omitting the key: `no_changes` is
  // how drizzle says there is nothing to do, so an empty `ok` is unread.
  assert.throws(() => statementsOf({ status: 'ok', statements: [] }), /without listing its statements/)
})
