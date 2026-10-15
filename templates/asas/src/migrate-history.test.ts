import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout } from 'node:timers/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import {
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
} from 'mithaq'
import { createHistory } from '../../../packages/mithaq/src/drizzle/index.ts'
import { binary, bootMigrations } from '../../../packages/mithaq/src/drizzle/migrate.ts'
import {
  appliedIn,
  foldersIn,
  kayanSourceOf,
  migrateDatabase,
  migrateEnv,
  migrating,
  migrationProject,
  mithaqEntry,
  outputIn,
  pushIn,
  resetSchemas,
  sqlIn,
  withSummary,
} from './migrate.support.ts'

test('a production `connect()` runs or refuses the migrations this database has not applied, as `prodMigrations` names, and does neither outside production, on a read-only connect or over a pushed database', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const production = { ...migrateEnv, NODE_ENV: 'production' }
  const { NODE_ENV: _environment, ...development } = migrateEnv
  // The adapter alone, with the choice this step names or none, over this project's folder. The
  // template's own choice is booted by the app tests.
  await writeFile(
    new URL('adapter.ts', root),
    `import { drizzleAdapter, drizzleTarget } from '${mithaqEntry}'
const [pending, readOnly, migrationsFolder = 'src/migrations'] = process.argv.slice(2)
const store = drizzleAdapter({
  connectionString: process.env.DATABASE_URL!,
  ...drizzleTarget,
  push: false,
  ...(pending === 'none' ? {} : { prodMigrations: { migrationsFolder, pending: pending as 'run' | 'refuse' } }),
}).init([])
try {
  await store.connect({ readOnly: readOnly === 'readOnly' })
  console.log('booted')
} finally {
  await store.destroy()
}
`,
  )
  // `ProcessEnv` types `NODE_ENV` as always present, and `development` is the
  // environment without it.
  const boot = (env: Record<string, string | undefined>, file: string, ...argv: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [file, ...argv], { cwd: fileURLToPath(root), env: env as NodeJS.ProcessEnv }, (error, stdout, stderr) =>
        resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr }))
    })
  const holds = (condition: string) => sqlIn(root, `do $$ declare n bigint; begin ${condition} end $$`)
  const absent = (relation: string) => holds(`if to_regclass('${relation}') is not null then raise exception '${relation} exists'; end if;`)
  const present = (relation: string) => holds(`if to_regclass('${relation}') is null then raise exception '${relation} is missing'; end if;`)
  const historyRows = (count: number) =>
    holds(`if to_regclass('drizzle.__mithaq_migrations') is null then n := 0; else execute 'select count(*) from drizzle.__mithaq_migrations' into n; end if; if n <> ${count} then raise exception 'history holds % rows', n; end if;`)
  const migrations = new URL('src/migrations/', root)
  try {
    await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
    assert.equal((await migrating(root, 'migrate')).code, 0)
    const [first] = (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry))
    assert.ok(first)

    await t.test('outside production, neither runs and nothing is written', async () => {
      for (const pending of ['run', 'refuse']) {
        const booted = await boot(development, 'adapter.ts', pending)
        assert.equal(booted.code, 0, booted.stderr)
        assert.match(booted.stdout, /booted/)
      }
      assert.equal(await absent('public.notes'), 0)
      assert.equal(await absent('drizzle.__mithaq_migrations'), 0)
    })

    await t.test('a read-only production connect neither checks nor applies anything', async () => {
      const booted = await boot(production, 'adapter.ts', 'run', 'readOnly')
      assert.equal(booted.code, 0, booted.stderr)
      assert.equal(await absent('public.notes'), 0)
    })

    await t.test('a production connect with no prodMigrations named refuses, naming the option', async () => {
      const refused = await boot(production, 'adapter.ts', 'none')
      assert.notEqual(refused.code, 0)
      assert.match(refused.stderr, /needs prodMigrations on drizzleAdapter/)
      assert.doesNotMatch(refused.stdout, /booted/)
    })

    await t.test('push: true beside prodMigrations is refused when the adapter is built, since Payload never pushes in production', () => {
      const prodMigrations = { migrationsFolder: 'src/migrations', pending: 'refuse' } as const
      assert.throws(
        () => drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, push: true, prodMigrations }),
        /takes `push: true` or `prodMigrations`, never both/,
      )
      assert.doesNotThrow(() => drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, push: false, prodMigrations }))
    })

    await t.test('a migrations folder holding no drizzle.config.ts is refused, since it would read as nothing pending', async () => {
      await mkdir(new URL('empty/', root))
      for (const pending of ['run', 'refuse']) {
        const refused = await boot(production, 'adapter.ts', pending, '', 'empty')
        assert.notEqual(refused.code, 0)
        assert.match(refused.stderr, /prodMigrations names empty as the migrations folder, and under .* it holds no drizzle\.config\.ts/)
        assert.doesNotMatch(refused.stdout, /booted/)
      }
      assert.equal(await absent('public.notes'), 0)
      assert.equal(await absent('drizzle.__mithaq_migrations'), 0)
    })

    await t.test('a migrations folder holding no migration yet is refused, since it would serve a database nothing built', async () => {
      await mkdir(new URL('unwritten/', root))
      await writeFile(new URL('unwritten/drizzle.config.ts', root), '')
      for (const pending of ['run', 'refuse']) {
        const refused = await boot(production, 'adapter.ts', pending, '', 'unwritten')
        assert.notEqual(refused.code, 0)
        assert.match(refused.stderr, /prodMigrations names unwritten, which holds no migration yet.*`mithaq migrate --name init`/)
        assert.doesNotMatch(refused.stdout, /booted/)
      }
      assert.equal(await absent('public.notes'), 0)
      assert.equal(await absent('drizzle.__mithaq_migrations'), 0)
    })

    await t.test('"refuse" with a folder pending throws naming it and writes nothing', async () => {
      const refused = await boot(production, 'adapter.ts', 'refuse')
      assert.notEqual(refused.code, 0)
      assert.match(refused.stderr, new RegExp(`This database has not applied ${first}\\.`))
      assert.match(refused.stderr, /drizzle-kit migrate --config src\/migrations\/drizzle\.config\.ts/)
      assert.doesNotMatch(refused.stdout, /booted/)
      assert.equal(await absent('public.notes'), 0)
      assert.equal(await absent('drizzle.__mithaq_migrations'), 0)
    })

    await t.test('"run" with a failing migration applies none of the pending ones', async () => {
      const failing = new URL('99991231235959_failing/', migrations)
      await mkdir(failing)
      await writeFile(new URL('migration.sql', failing), 'CREATE TABLE "boom" ("id" text);\n--> statement-breakpoint\nSELECT 1/0;\n')
      try {
        const failed = await boot(production, 'adapter.ts', 'run')
        assert.notEqual(failed.code, 0)
        assert.match(failed.stderr, /division by zero/)
        assert.equal(await absent('public.notes'), 0, 'the folder before the failing one is rolled back too')
        assert.equal(await absent('public.boom'), 0)
        assert.equal(await historyRows(0), 0)
      } finally {
        await rm(failing, { recursive: true })
      }
    })

    await t.test('"run" applies the pending folders and boots', async () => {
      const booted = await boot(production, 'adapter.ts', 'run')
      assert.equal(booted.code, 0, booted.stderr)
      assert.match(booted.stdout, /booted/)
      assert.equal(await present('public.notes'), 0)
      assert.equal(await historyRows(1), 0)
    })

    await t.test('two "run" boots at once apply a pending folder once', async () => {
      // Data alone, so a second apply raises nothing and only the count and
      // the history tell it happened.
      assert.equal(await sqlIn(root, `insert into "notes" ("id", "summary") values ('once', '')`), 0)
      const data = new URL('99991231235958_data/', migrations)
      await mkdir(data)
      // The sleep holds the first boot's transaction open, so the second reads
      // the history while the first has not committed: without the lock both
      // apply the folder.
      await writeFile(new URL('migration.sql', data), `UPDATE "notes" SET "summary" = "summary" || 'x' WHERE "id" = 'once';\n--> statement-breakpoint\nSELECT pg_sleep(1);\n`)
      const booted = await Promise.all([boot(production, 'adapter.ts', 'run'), boot(production, 'adapter.ts', 'run')])
      for (const one of booted) assert.equal(one.code, 0, one.stderr)
      assert.equal(await holds(`select length("summary") into strict n from "notes" where "id" = 'once'; if n <> 1 then raise exception 'applied % times', n; end if;`), 0)
      assert.equal(await historyRows(2), 0)
    })

    await t.test('"refuse" with every folder applied boots', async () => {
      const booted = await boot(production, 'adapter.ts', 'refuse')
      assert.equal(booted.code, 0, booted.stderr)
      assert.match(booted.stdout, /booted/)
    })

    await t.test('a history still in drizzle\'s default table, from before #209, is refused under either choice, naming mithaq migrate, and nothing is written', async () => {
      assert.equal(
        await sqlIn(root, 'create table drizzle.__drizzle_migrations as select * from drizzle.__mithaq_migrations; drop table drizzle.__mithaq_migrations;'),
        0,
      )
      for (const refused of [await boot(production, 'adapter.ts', 'refuse'), await boot(production, 'adapter.ts', 'run')]) {
        assert.notEqual(refused.code, 0)
        assert.match(refused.stderr, /history is in drizzle\.__drizzle_migrations, not in drizzle\.__mithaq_migrations/)
        assert.match(refused.stderr, /Run `mithaq migrate` against this database once/)
        assert.doesNotMatch(refused.stdout, /booted/)
      }
      assert.equal(await absent('drizzle.__mithaq_migrations'), 0, 'nothing moved and no history created')
    })

    await t.test('a production boot over a database a development connect() pushed refuses, whichever behaviour is named', async () => {
      await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
      assert.equal(await pushIn(root), 0)
      for (const refused of [await boot(production, 'adapter.ts', 'refuse'), await boot(production, 'adapter.ts', 'run')]) {
        assert.notEqual(refused.code, 0)
        assert.match(refused.stderr, /carries mithaq's dev-push marker/)
        assert.doesNotMatch(refused.stdout, /booted/)
      }
      assert.equal(await historyRows(1), 0, 'the marker alone, and no migration recorded beside it')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a pushed database carries the dev-push marker, and `mithaq migrate` refuses it until the row is dropped', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')

  // Twice, because the mark is one row however many pushes run, and the second push proves the row
  // is refreshed rather than added to.
  assert.equal(await pushIn(root), 0, 'the push applies')
  assert.equal(await pushIn(root), 0, 'and a second push applies over it')
  assert.equal(
    await sqlIn(
      root,
      `do $$ begin assert (select count(*) from drizzle.__mithaq_migrations where name = 'mithaq_dev_push') = 1; end $$;`,
    ),
    0,
    'two pushes wrote exactly one marker row, in the history table mithaq keeps of its own',
  )

  const refused = await migrating(root, 'migrate')
  assert.equal(refused.code, 2, refused.stderr)
  assert.match(refused.stderr, /pushed this schema rather than migrating it/)
  assert.match(refused.stderr, /mithaq migrate --baseline/, 'and the sentence names the way out')
  assert.doesNotMatch(refused.stderr, /pull --init/, 'and no longer the folder no fresh database can apply')

  // The marker alone is an ordinary development database, which a check passes while saying what it
  // did not check: the migration files are not diffed against the kayan there.
  const alone = await migrating(root, 'migrate', '--check')
  assert.equal(alone.code, 0, alone.stderr)
  assert.match(alone.stdout, /mithaq_dev_push/)
  assert.match(alone.stdout, /skipped the check of the migration files against the kayan/)
  assert.match(alone.stdout, /a database built from the migrations with `drizzle-kit migrate --config src\/migrations\/drizzle\.config\.ts`/)

  // The marker beside a migration's own row is a history half pushed and half
  // migrated, which no later migration can be diffed against.
  assert.equal(
    await sqlIn(
      root,
      `insert into drizzle.__mithaq_migrations (hash, created_at, name) values ('0000', 0, '0000_a_real_migration')`,
    ),
    0,
  )
  const mixed = await migrating(root, 'migrate', '--check')
  assert.equal(mixed.code, 2, mixed.stderr)
  assert.match(mixed.stderr, /pushed this schema rather than migrating it/)

  assert.equal(
    await sqlIn(root, `delete from drizzle.__mithaq_migrations where name in ('mithaq_dev_push', '0000_a_real_migration')`),
    0,
  )
  const proceeded = await migrating(root, 'migrate')
  assert.equal(proceeded.code, 0, proceeded.stderr)
  assert.match(proceeded.stdout, /^Wrote /)
})

/**
 * The template's committed migrations, applied a slice at a time to the
 * project's database through a config of the test's own, so a step can write
 * the rows an older database holds between two of them.
 */
const committedIn = async (root: URL) => {
  const committed = new URL('migrations/', import.meta.url)
  const out = new URL('out/', root)
  const config = new URL('drizzle.config.ts', root)
  await writeFile(config, `export default { dialect: 'postgresql', out: ${JSON.stringify(fileURLToPath(out))}, dbCredentials: { url: process.env.DATABASE_URL }, migrations: { schema: 'drizzle', table: '__mithaq_migrations' } }\n`)
  const migrated = () =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
      execFile(process.execPath, [binary, 'migrate', '--config', fileURLToPath(config)], { cwd: fileURLToPath(root), env: migrateEnv }, (error, stdout, stderr) =>
        resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, output: `${stdout}${stderr}` }))
    })
  const copied = async (folders: string[]) => {
    for (const folder of folders) {
      await mkdir(new URL(`${folder}/`, out), { recursive: true })
      for (const file of ['migration.sql', 'snapshot.json']) await writeFile(new URL(`${folder}/${file}`, out), await readFile(new URL(`${folder}/${file}`, committed)))
    }
  }
  const folders = (await readdir(committed)).filter((entry) => /^\d{14}_/.test(entry)).sort()
  return { folders, migrated, copied }
}

test('the committed migration fills each fixed role\'s label from its code on a database the old seed wrote, keeps every label already there, and makes both labels NOT NULL', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const backfill = '20261010005521_elite_giant_girl'
  const { folders, migrated, copied } = await committedIn(root)
  try {
    assert.ok(folders.includes(backfill))
    assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;'), 0)
    await copied(folders.filter((folder) => folder < backfill))
    const before = await migrated()
    assert.equal(before.code, 0, before.output)
    // What the seed wrote before it wrote labels: every fixed role with none, beside a custom role
    // with its own and a fixed role labelled by its slug.
    assert.equal(await sqlIn(root, `insert into roles (name, is_system, permissions) values ('administrator', true, '{*}'), ('registrar', true, '{}'), ('instructor', true, '{}'), ('student', true, '{}'), ('super_admin', true, '{}'), ('support', true, '{}');
      insert into roles (name, is_system, permissions, label_ar, label_en) values ('explorer', true, '{}', 'explorer', 'explorer'), ('curator', false, '{}', 'أمين', 'Curator');`), 0)
    // Up to the migration that drops these rows, which would take the fixed ones this test reads.
    await copied(folders.filter((folder) => folder >= backfill && folder < ownership))
    const after = await migrated()
    assert.equal(after.code, 0, after.output)
    const labels = await outputIn(root, 'sql.ts', `do $$ begin
      assert (select string_agg(name || '=' || label_en || '/' || label_ar, ', ' order by name) from roles) =
        'administrator=Administrator/مدير, curator=Curator/أمين, explorer=explorer/explorer, instructor=Instructor/مدرس, registrar=Registrar/مسجل, student=Student/طالب, super_admin=Platform administrator/مدير المنصة, support=Support/الدعم';
      assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name in ('label_ar', 'label_en') and is_nullable = 'NO') = 2;
    end $$;`)
    assert.equal(labels.code, 0, labels.stderr)
  } finally {
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})

const ownership = '20261012000752_organization_ownership'

test('the committed migration renames each tenant column to organization_id keeping its rows, drops the fixed roles\' rows and keeps every assignment of one', async () => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const { folders, migrated, copied } = await committedIn(root)
  try {
    assert.ok(folders.includes(ownership))
    assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;'), 0)
    await copied(folders.filter((folder) => folder < ownership))
    const before = await migrated()
    assert.equal(before.code, 0, before.output)
    // An organization's rows as the old template wrote them: a fixed role seeded with no tenant,
    // a custom role, an assignment of each, and a tag.
    assert.equal(await sqlIn(root, `insert into organization (id, name, slug, created_at) values ('org-a', 'A', 'a', now());
      insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('u-1', 'One', 'one@example.com', true, now(), now());
      insert into roles (name, is_system, permissions, label_ar, label_en, tenant_id) values ('registrar', true, '{}', 'مسجل', 'Registrar', null), ('teacher', false, '{courses.find}', 'معلم', 'Teacher', 'org-a');
      insert into member_roles (tenant_id, user_id, role) values ('org-a', 'u-1', 'registrar'), ('org-a', 'u-1', 'teacher');
      insert into tags (tenant_id, name_en, name_ar) values ('org-a', 'Tag', 'وسم');`), 0)
    await copied(folders.filter((folder) => folder >= ownership))
    const after = await migrated()
    assert.equal(after.code, 0, after.output)
    const kept = await outputIn(root, 'sql.ts', `do $$ begin
      assert (select string_agg(name || '@' || organization_id, ', ' order by name) from roles) = 'teacher@org-a';
      assert (select string_agg(role || '@' || organization_id, ', ' order by role) from member_roles) = 'registrar@org-a, teacher@org-a';
      assert (select string_agg(name_en || '@' || organization_id, ', ') from tags) = 'Tag@org-a';
      assert (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id') = 0;
      assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name = 'is_system') = 0;
      assert (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and table_name in ('courses', 'course_sessions', 'enrollments', 'tags', 'media', 'settings', 'audit_log', 'roles', 'member_roles') and is_nullable = 'NO') = 9;
    end $$;`)
    assert.equal(kept.code, 0, kept.stderr)
  } finally {
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})

test('the committed migration refuses a database holding a row with no organization, naming its table and count, and changes nothing', async () => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const { folders, migrated, copied } = await committedIn(root)
  try {
    assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;'), 0)
    await copied(folders.filter((folder) => folder < ownership))
    const before = await migrated()
    assert.equal(before.code, 0, before.output)
    assert.equal(await sqlIn(root, `insert into courses (title, created_at, updated_at) values ('Orphan one', now(), now()), ('Orphan two', now(), now());
      insert into roles (name, is_system, permissions, label_ar, label_en, tenant_id) values ('registrar', true, '{}', 'مسجل', 'Registrar', null);`), 0)
    await copied(folders.filter((folder) => folder >= ownership))
    const refused = await migrated()
    assert.notEqual(refused.code, 0, 'the migration stops')
    assert.match(refused.output, /Table courses holds 2 row\(s\) with no organization_id, which belong to no organization\. Assign each one an organization or delete it, then run the migration again\./)
    const kept = await outputIn(root, 'sql.ts', `do $$ begin
      assert (select count(*) from courses where tenant_id is null) = 2;
      assert (select count(*) from roles where is_system) = 1;
      assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('courses', 'tags', 'roles', 'member_roles') and column_name = 'tenant_id') = 4;
    end $$;`)
    assert.equal(kept.code, 0, `the whole migration rolled back, the fixed role's row and every column name included: ${kept.stderr}`)
  } finally {
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})

test('the committed migration keys courses_tags on a database holding its rows, and refuses one where two rows share a (parent_id, order) with their count, applying nothing', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const keyed = '20261010120822_needy_thunderbolt'
  const { folders, migrated, copied } = await committedIn(root)
  try {
    assert.ok(folders.includes(keyed))
    assert.equal(await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;'), 0)
    await copied(folders.filter((folder) => folder < keyed))
    const before = await migrated()
    assert.equal(before.code, 0, before.output)
    // Rows alone, without the courses and tags they name, which the key never
    // reads: the foreign keys are not checked while a replica writes.
    assert.equal(await sqlIn(root, `set session_replication_role = replica;
      insert into courses_tags (parent_id, target_id, "order") values
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 0), ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 1),
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 1), ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 0);`), 0)
    // Up to the one that makes the target's key restrict, which checks every target id these rows name.
    await copied(folders.filter((folder) => folder >= keyed && folder < '20261014221355_tags_restrict'))
    const refused = await migrated()
    assert.notEqual(refused.code, 0, 'the migration stops')
    assert.match(refused.output, /courses_tags holds 2 rows whose \(parent_id, order\) another row also holds/)
    assert.equal(await sqlIn(root, `do $$ begin
      assert (select count(*) from pg_constraint where conname = 'courses_tags_pkey') = 0;
      assert to_regclass('courses_tags_target_id_index') is null;
      assert (select count(*) from courses_tags) = 4;
    end $$;`), 0, 'and applies nothing')
    assert.equal(await sqlIn(root, `delete from courses_tags where target_id = '00000000-0000-0000-0000-00000000000c'`), 0)
    const applied = await migrated()
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, `do $$ begin
      assert (select count(*) from pg_constraint where conname = 'courses_tags_pkey' and contype = 'p') = 1;
      assert to_regclass('courses_tags_target_id_index') is not null;
      assert (select count(*) from courses_tags) = 3;
    end $$;`), 0, 'the key and the index are built over the rows kept')
  } finally {
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})

test('an existing project moves its history out of drizzle\'s default table without a migrated database ever reading as fresh', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const config = new URL('src/migrations/drizzle.config.ts', root)
  try {
    await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
    assert.equal((await migrating(root, 'migrate')).code, 0)
    // The config of a project with no `migrations` entry, so drizzle-kit applies through drizzle's
    // default table.
    const written = await readFile(config, 'utf8')
    const old = written.replace(/\n  migrations: \{[^}]*\},/, '')
    assert.notEqual(old, written, 'the written config names a history table')
    await writeFile(config, old)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, `insert into notes (id, summary) values ('kept', 'a value')`), 0)
    const [folder] = await foldersIn(root)
    // A row no folder of this project names, and one that takes a folder's
    // name over SQL that is not the folder's: another tool's, never copied.
    assert.equal(
      await sqlIn(root, `insert into drizzle.__drizzle_migrations (hash, created_at, name) values ('x', 1, '20200101000000_not_ours'), ('not-our-hash', 2, '${folder}')`),
      0,
    )

    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 1, checked.stderr)
    assert.match(checked.stdout, /1 row of this project's migration history sits in drizzle\.__drizzle_migrations and not in drizzle\.__mithaq_migrations/)
    assert.equal(
      await sqlIn(root, `do $$ begin assert to_regclass('drizzle.__mithaq_migrations') is null; end $$;`),
      0,
      'and the check copied nothing',
    )
    for (const argv of [['migrate', '--check'], ['migrate']]) {
      const refused = await migrating(root, ...argv)
      assert.equal(refused.code, 1, `${argv.join(' ')}: ${refused.stderr}`)
      assert.match(refused.stderr, /applies migrations through drizzle's default history table/)
      assert.match(refused.stderr, /Delete drizzle\.config\.ts and run `mithaq migrate` again/)
    }
    const copied = `do $$ begin
      assert (select string_agg(name, ',') from drizzle.__mithaq_migrations) = '${folder}';
      assert (select hash from drizzle.__mithaq_migrations) <> 'not-our-hash';
      assert (select count(*) from drizzle.__drizzle_migrations) = 3;
    end $$;`
    assert.equal(await sqlIn(root, copied), 0, 'its own row is copied by name and hash, the others left behind, and the default table keeps all three')

    await rm(config)
    const rewritten = await migrating(root, 'migrate')
    assert.equal(rewritten.code, 0, rewritten.stderr)
    assert.match(rewritten.stdout, /The database schema is up to date\./)
    assert.equal(await sqlIn(root, copied), 0, 'and a second run copies nothing twice')

    // The apply through the new config finds its history and runs nothing; a switch without the
    // copy would run every migration again.
    const again = await appliedIn(root)
    assert.equal(again.code, 0, again.output)
    assert.equal(await sqlIn(root, `do $$ begin assert (select summary from notes where id = 'kept') = 'a value'; end $$;`), 0)
    assert.equal(await sqlIn(root, copied), 0)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a history moved from a checkout short of a migration is completed by the next run from the full one, rather than stranding its tail', async (t) => {
  await migrateDatabase()
  const states = [withSummary, `${withSummary}\n        title: { kind: 'text' },`, `${withSummary}\n        title: { kind: 'text' },\n        body: { kind: 'text' },`]
  const root = await migrationProject(states[0]!)
  const config = new URL('src/migrations/drizzle.config.ts', root)
  const aside = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-aside-'))}/`)
  try {
    await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
    // Each applied through an older config before the next is written, so all three rows sit in
    // drizzle's default table. Each run copies the rows before it into mithaq's own.
    for (const state of states) {
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf(state))
      assert.equal((await migrating(root, 'migrate')).code, 0)
      const written = await readFile(config, 'utf8')
      await writeFile(config, written.replace(/\n  migrations: \{[^}]*\},/, ''))
      const applied = await appliedIn(root)
      assert.equal(applied.code, 0, applied.output)
      await writeFile(config, written)
    }
    const folders = await foldersIn(root)
    assert.equal(folders.length, 3)
    assert.equal(await sqlIn(root, 'drop table drizzle.__mithaq_migrations'), 0)

    // A checkout a migration behind: the third folder and the kayan it came from
    // are not there yet, and the run moves the two rows it can prove are this
    // project's.
    await rename(new URL(`src/migrations/${folders[2]}/`, root), new URL(`${folders[2]}/`, aside))
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(states[1]!))
    const behind = await migrating(root, 'migrate')
    assert.equal(behind.code, 0, behind.stderr)
    assert.match(behind.stdout, /Copied 2 rows/)

    // The full checkout: the check says the third row is still to move, and
    // the run moves it.
    await rename(new URL(`${folders[2]}/`, aside), new URL(`src/migrations/${folders[2]}/`, root))
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(states[2]!))
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
    assert.match(checked.stdout, /1 row of this project's migration history sits in drizzle\.__drizzle_migrations and not in drizzle\.__mithaq_migrations/)
    const full = await migrating(root, 'migrate')
    assert.equal(full.code, 0, full.stderr)
    assert.match(full.stdout, /Copied 1 row /)
    assert.equal(
      await sqlIn(root, `do $$ begin assert (select string_agg(name, ',' order by name) from drizzle.__mithaq_migrations) = '${folders.join(',')}'; end $$;`),
      0,
    )
    // So the apply through the new config finds all three and runs none again:
    // a third `ADD COLUMN` would fail here.
    const again = await appliedIn(root)
    assert.equal(again.code, 0, again.output)
  } finally {
    await rm(root, { recursive: true })
    await rm(aside, { recursive: true, force: true })
  }
})

test('a row applied under a folder\'s name with another hash stops the move, so a migration whose bytes changed is never run twice', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const config = new URL('src/migrations/drizzle.config.ts', root)
  try {
    await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
    assert.equal((await migrating(root, 'migrate')).code, 0)
    const [folder] = await foldersIn(root)
    const written = await readFile(config, 'utf8')
    await writeFile(config, written.replace(/\n  migrations: \{[^}]*\},/, ''))
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    await writeFile(config, written)

    // The same migration checked out with other line endings: its hash is not
    // the applied row's, and drizzle would match the row by name alone.
    const file = new URL(`src/migrations/${folder}/migration.sql`, root)
    const bytes = await readFile(file, 'utf8')
    await writeFile(file, bytes.replaceAll('\n', '\r\n'))
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 1, checked.stderr)
    assert.match(checked.stderr, new RegExp(`holds ${folder} under a folder's name and with another hash`))
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 2, refused.stderr)
    assert.match(refused.stderr, new RegExp(`holds ${folder} under a folder's name and with another hash`))
    assert.match(refused.stderr, /restore the folder's bytes/)
    assert.equal(
      await sqlIn(root, `do $$ begin assert to_regclass('drizzle.__mithaq_migrations') is null; end $$;`),
      0,
      'and nothing was moved',
    )

    await writeFile(file, bytes)
    const moved = await migrating(root, 'migrate')
    assert.equal(moved.code, 0, moved.stderr)
    assert.match(moved.stdout, /Copied 1 row /)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a check reads a dev-push marker an older mithaq left in drizzle\'s default table as the marker, so a pushed database with folders it never applied gets the notice rather than an apply that would fail', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  try {
    // A project with a migration folder, on a development database an older
    // `connect()` pushed: the tables are there, the folder's row is not, and
    // the marker sits in drizzle's default table.
    await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.equal(await pushIn(root), 0)
    assert.equal(
      await sqlIn(root, `create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint, name text, applied_at timestamp with time zone default now());
        insert into drizzle.__drizzle_migrations (hash, created_at, name) values ('mithaq_dev_push', 1, 'mithaq_dev_push');
        drop table drizzle.__mithaq_migrations;`),
      0,
    )
    const checked = await migrating(root, 'migrate', '--check')
    assert.equal(checked.code, 0, checked.stderr)
    assert.match(checked.stdout, /skipped the check of the migration files against the kayan/)
    assert.match(checked.stdout, /the row named mithaq_dev_push in drizzle\.__drizzle_migrations,/, 'the notice names the table the marker was read from')
    assert.doesNotMatch(checked.stderr, /has not applied/, 'no advice to apply a migration whose tables the push already built')
    assert.equal(
      await sqlIn(root, `do $$ begin assert to_regclass('drizzle.__mithaq_migrations') is null; end $$;`),
      0,
      'and the check moved nothing',
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a dev-push marker an older mithaq left in drizzle\'s default table is moved once, so a baseline that replaces it stays the history', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  try {
    await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
    assert.equal(await pushIn(root), 0)
    assert.equal(
      await sqlIn(root, `create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint, name text, applied_at timestamp with time zone default now());
        insert into drizzle.__drizzle_migrations (hash, created_at, name) values ('mithaq_dev_push', 1, 'mithaq_dev_push');
        drop table drizzle.__mithaq_migrations;`),
      0,
    )
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 2, refused.stderr)
    assert.match(refused.stderr, /mithaq migrate --baseline/)
    const adopted = await migrating(root, 'migrate', '--baseline')
    assert.equal(adopted.code, 0, adopted.stderr)
    const ran = await migrating(root, 'migrate')
    assert.equal(ran.code, 0, ran.stderr)
    assert.match(ran.stdout, /The database schema is up to date\./)
    assert.equal(
      await sqlIn(root, `do $$ begin
        assert (select count(*) from drizzle.__mithaq_migrations) = 1;
        assert (select count(*) from drizzle.__mithaq_migrations where name = 'mithaq_dev_push') = 0;
        assert (select count(*) from drizzle.__drizzle_migrations) = 1;
      end $$;`),
      0,
      'the baseline row alone in mithaq\'s table, and the old marker left where it was',
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('two processes making the history table on a database with no drizzle schema both succeed', async () => {
  await migrateDatabase()
  const db = drizzle({ connection: { connectionString: migrateEnv.DATABASE_URL!, max: 8 } })
  try {
    for (let round = 0; round < 20; round++) {
      await db.execute(sql`drop schema if exists drizzle cascade`)
      await Promise.all(Array.from({ length: 8 }, () => createHistory(db)))
    }
  } finally {
    await db.$client.end()
  }
})

test('a production boot running drizzle\'s migrator beside connects making the history table, on a database with no drizzle schema, all succeed', async () => {
  await migrateDatabase()
  const db = drizzle({ connection: { connectionString: migrateEnv.DATABASE_URL!, max: 8 } })
  const migrationsFolder = await mkdtemp(join(tmpdir(), 'mithaq-boot-race-'))
  try {
    await writeFile(join(migrationsFolder, 'drizzle.config.ts'), '')
    // One migration that any round may apply again, since a folder holding none is refused.
    await mkdir(join(migrationsFolder, '20260101000000_noop'))
    await writeFile(join(migrationsFolder, '20260101000000_noop/migration.sql'), 'select 1;')
    for (let round = 0; round < 20; round++) {
      await db.execute(sql`drop schema if exists drizzle cascade`)
      // Staggered, since a boot reads the history before its migrator makes the schema.
      await Promise.all(Array.from({ length: 8 }, async (_, at) => {
        await setTimeout(at * 3)
        await (at % 2 ? createHistory(db) : bootMigrations({ db, prodMigrations: { migrationsFolder, pending: 'run' } }))
      }))
    }
  } finally {
    await db.$client.end()
    await rm(migrationsFolder, { recursive: true })
  }
})
