import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after } from 'node:test'
import { testDatabase } from './test-database.ts'
import { binary } from '../../../packages/mithaq/src/drizzle/migrate.ts'

const bin = new URL('../../../packages/mithaq/src/asas/cli/mithaq.ts', import.meta.url)
export const commandIn = (cwd: URL, env: NodeJS.ProcessEnv, argv: string[]) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(process.execPath, [fileURLToPath(bin), ...argv], { cwd: fileURLToPath(cwd), env })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })

export const template = new URL('test-language.ts', import.meta.url).href
export const mithaqEntry = new URL('../../../packages/mithaq/src/index.ts', import.meta.url).href

/**
 * The database the migrate steps share, created on the server DATABASE_URL names the first time a
 * step needs it and dropped when the file ends, so no other file ever sees its tables. Its name
 * carries the process and a random part, so two runs on one server never meet.
 */
export const migrateName = `mithaq_migrate_${process.pid}_${randomBytes(4).toString('hex')}`
/** Read only once `migrateDatabase` has resolved, which is when it names the steps' own database. */
export let migrateEnv: NodeJS.ProcessEnv = process.env
/** One statement on its own connection, closed after, so no idle pool keeps the file running. */
const adminQuery = async (statement: string) => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { $client } = drizzle({ connection: { connectionString: testDatabase(), max: 1 } })
  try {
    return (await $client.query<{ datname: string }>(statement)).rows
  } finally {
    await $client.end()
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
let creating: Promise<void> | undefined
export const migrateDatabase = () =>
  (creating ??= (async () => {
    // A run killed outright never reaches its `after`, so its database is dropped here once its process is gone.
    // ponytail: liveness is read from this machine's processes; a test server shared between machines needs a lease instead.
    for (const { datname } of await adminQuery(`select datname from pg_database where datname ~ '^mithaq_migrate_[0-9]+_[0-9a-f]+$'`)) {
      if (!alive(Number(datname.split('_')[2]))) await adminQuery(`drop database if exists ${datname} with (force)`).catch(() => {})
    }
    await adminQuery(`create database ${migrateName}`)
    migrateEnv = { ...process.env, DATABASE_URL: Object.assign(new URL(testDatabase()), { pathname: `/${migrateName}` }).href }
  })())

after(async () => {
  if (creating) await adminQuery(`drop database if exists ${migrateName} with (force)`)
})

/**
 * A project `mithaq migrate` can run against: the template's language gives real drizzle tables,
 * and the kayan are the test's to edit between steps.
 */
export const migrationProject = async (kayan: string) => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-migrate-'))}/`)
  await mkdir(new URL('src/', root))
  await writeFile(new URL('src/mithaq.ts', root), "export const generate = { migrations: 'src/migrations/' }\n")
  await writeFile(new URL('src/asas.ts', root), kayanSourceOf(kayan))
  // Everything the steps do to the database goes through the project's own connection. `$client` is
  // node-postgres, so no drizzle import has to resolve from a directory outside the workspace.
  await writeFile(
    new URL('sql.ts', root),
    `import { asas } from './src/asas.ts'\nawait asas.targets.drizzle.db.$client.query(process.argv[2])\nawait asas.destroy()\n`,
  )
  // The dev path a developer is on before writing a migration, which leaves the marker the steps
  // below read.
  await writeFile(
    new URL('push.ts', root),
    `import { asas } from './src/asas.ts'\nawait asas.connect()\nawait asas.destroy()\n`,
  )
  return root
}
/**
 * The kayan the template language's access target reads, written into the project because
 * `buildAsas` refuses a build that declares the target without them, and so the tables a migration
 * diffs are this project's. The three its screens list follow, flat too.
 */
export const accessSource = `    defineKayan({
      name: 'roles',
      dbName: 'roles',
      fields: {
        id: { kind: 'uuid' },
        createdAt: { kind: 'datetime' },
        updatedAt: { kind: 'datetime' },
        name: { kind: 'text' },
        permissions: { kind: 'textArray' },
        isSystem: { kind: 'checkbox' },
      },
    }),
    defineKayan({
      name: 'memberRoles',
      dbName: 'member_roles',
      fields: { id: { kind: 'uuid' }, user: { kind: 'text' }, role: { kind: 'text' }, tenant: { kind: 'text' } },
    }),
    defineKayan({ name: 'user', fields: { id: { kind: 'text' }, name: { kind: 'text' } } }),
    defineKayan({ name: 'organization', fields: { id: { kind: 'text' }, name: { kind: 'text' } } }),
    defineKayan({ name: 'member', fields: { id: { kind: 'text' } } }),
`
export const kayanSourceOf = (fields: string, tags = true) => `import { fetchHttp } from '${mithaqEntry}'
import { buildAsas, defineKayan } from '${template}'

export const asas = buildAsas({
  http: [fetchHttp()],
  kayan: [
    defineKayan({
      name: 'notes',
      fields: {
${fields}
        deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
      },
    }),
${accessSource}${tags ? "    defineKayan({ name: 'tags', fields: { id: { kind: 'text' } } }),\n" : ''}  ],
})
`
export const withSummary = "        id: { kind: 'text' },\n        summary: { kind: 'text' },"
export const migrating = (root: URL, ...argv: string[]) => commandIn(root, migrateEnv, argv)
const nodeIn = (root: URL, file: string, ...argv: string[]) =>
  new Promise<number | null>((resolve) => {
    const child = execFile(process.execPath, [fileURLToPath(new URL(file, root)), ...argv], {
      cwd: fileURLToPath(root),
      env: migrateEnv,
    })
    child.on('close', resolve)
  })
export const sqlIn = (root: URL, statement: string) => nodeIn(root, 'sql.ts', statement)
export const pushIn = (root: URL) => nodeIn(root, 'push.ts')
export const appliedIn = (root: URL) =>
  new Promise<{ code: number | null; output: string }>((resolve) => {
    execFile(
      process.execPath,
      [binary, 'migrate', '--config', fileURLToPath(new URL('src/migrations/drizzle.config.ts', root))],
      { cwd: fileURLToPath(root), env: migrateEnv },
      (error, stdout, stderr) => resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, output: `${stdout}${stderr}` }),
    )
  })
export const foldersIn = async (root: URL) =>
  (await readdir(new URL('src/migrations/', root)).catch(() => [] as string[])).filter((entry) => /^\d{14}_/.test(entry)).sort()
export const nothingAdopted = async (root: URL) => {
  assert.deepEqual((await foldersIn(root)).filter((entry) => entry.endsWith('_baseline')), [], 'no baseline folder')
  assert.equal(
    await sqlIn(
      root,
      `do $$ begin if to_regclass('drizzle.__mithaq_migrations') is not null then assert (select count(*) from drizzle.__mithaq_migrations where name like '%baseline') = 0; end if; end $$;`,
    ),
    0,
    'and no baseline row',
  )
}

/**
 * A kayan names the Postgres schema its table is built in. Each database below also holds objects
 * mithaq does not own, in `public` and in `app`; every step ends by asserting they are as they
 * were, rows and the sequence's value included, and that no schema was dropped.
 */
export const resetSchemas = 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade; drop schema if exists app cascade; drop schema if exists app2 cascade; drop schema if exists auth cascade;'
export const publicForeignObjects = `create table public.payload_kv (key text primary key, data jsonb);
insert into public.payload_kv values ('site', '{"kept": true}');
create type public.enum_payload_kv_kind as enum ('a', 'b');`
export const foreignObjects = `${publicForeignObjects}
create schema if not exists app;
create table app.audit_log (id serial primary key, entry text);
insert into app.audit_log (entry) values ('kept');
create type app.audit_kind as enum ('x', 'y');
create sequence app.audit_counter start 40;
select nextval('app.audit_counter');`
export const foreignUntouched = (schemas: readonly string[] = ['public', 'app']) => `do $$ begin
  assert (select count(*) from public.payload_kv where key = 'site' and data = '{"kept": true}') = 1;
  assert to_regtype('public.enum_payload_kv_kind') is not null;
  ${schemas.includes('app') ? `assert (select count(*) from app.audit_log where entry = 'kept') = 1;
  assert to_regtype('app.audit_kind') is not null;
  assert (select last_value from pg_sequences where schemaname = 'app' and sequencename = 'audit_counter') = 40;` : ''}
  ${schemas.map((schema) => `assert to_regnamespace('${schema}') is not null;`).join('\n  ')}
end $$;`
/**
 * Every object a DDL statement makes, alters or drops from here on, in a table
 * of its own, so a push that plans nothing is told from one that plans
 * something without reading drizzle-kit's plan.
 */
export const ddlSeen = `create table public.ddl_seen (identity text);
create function public.ddl_seen() returns event_trigger language plpgsql as $f$ begin insert into public.ddl_seen select object_identity from pg_event_trigger_ddl_commands(); end $f$;
create event trigger ddl_seen on ddl_command_end execute function public.ddl_seen();`
export const dropDdlSeen = 'drop event trigger if exists ddl_seen;'
export const inSchemas = (source: string, schemas: Record<string, string>) =>
  Object.entries(schemas).reduce((text, [kayan, schema]) => text.replace(`name: '${kayan}',`, `name: '${kayan}', schemaName: '${schema}',`), source)
export const outputIn = (root: URL, file: string, ...argv: string[]) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [fileURLToPath(new URL(file, root)), ...argv], { cwd: fileURLToPath(root), env: migrateEnv }, (error, stdout, stderr) =>
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr }))
  })
export const latestSql = async (root: URL) => readFile(new URL(`src/migrations/${(await foldersIn(root)).at(-1)}/migration.sql`, root), 'utf8')
