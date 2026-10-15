import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { kitOrm } from '../../../packages/mithaq/src/drizzle/migrate.ts'
import {
  appliedIn,
  foldersIn,
  inSchemas,
  kayanSourceOf,
  latestSql,
  migrateDatabase,
  migrating,
  migrationProject,
  mithaqEntry,
  outputIn,
  resetSchemas,
  sqlIn,
  withSummary,
} from './migrate.support.ts'

test('drizzle-kit, which imports drizzle-orm without declaring it, loads the copy mithaq builds with, never one the project hoists', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'mithaq-kit-')))
  try {
    // drizzle-kit's place in an isolated install: a folder of its own, with only the project's drizzle-orm above it.
    await mkdir(join(root, 'node_modules/drizzle-orm'), { recursive: true })
    await writeFile(join(root, 'node_modules/drizzle-orm/package.json'), JSON.stringify({ name: 'drizzle-orm', version: '0.45.0', main: 'index.js' }))
    await writeFile(join(root, 'node_modules/drizzle-orm/index.js'), "module.exports = { version: '0.45.0' }")
    await mkdir(join(root, 'kit'))
    // As drizzle-kit's bin does: `require`, and a subpath only drizzle-orm 1 has.
    await writeFile(join(root, 'kit/bin.cjs'), "require('drizzle-orm/_relations'); console.log(require('drizzle-orm').version ?? 'mithaq')")
    const loaded = (args: string[]) => execFileSync(process.execPath, [...args, join(root, 'kit/bin.cjs')], { encoding: 'utf8' }).trim()
    assert.throws(() => loaded([]), /Cannot find module/, 'on its own it loads the hoisted copy')
    const from = new URL('../../../packages/mithaq/src/drizzle/migrate.ts', import.meta.url).href
    assert.equal(loaded(['--import', kitOrm({ kit: pathToFileURL(join(root, 'kit/')).href, from })]), 'mithaq')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate` writes its config and schema module, migrates a database from zero, and gates every later change', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  await sqlIn(root, 'drop schema public cascade; create schema public;')

  try {
    await t.test('a fresh project gets the config and the schema module beside one migration and its snapshot', async () => {
      const first = await migrating(root, 'migrate')
      assert.equal(first.code, 0, first.stderr)
      const written = await readdir(migrations)
      assert.ok(written.includes('drizzle.config.ts'), 'the config is written beside the migration folder')
      assert.ok(written.includes('schema.ts'), 'and the schema module the config points at')
      const schema = await readFile(new URL('schema.ts', migrations), 'utf8')
      // A language with every table in `public` exports no schema.
      assert.equal(schema, `// Written by \`mithaq migrate\`. Commit it.
// Every table the language built, named one per line. drizzle-kit reads named
// exports alone: an object export contributes no table and reports no changes
// forever, and a partial export still emits foreign keys to the tables it left
// out. \`mithaq migrate\` rewrites this file when a kayan is added or removed.
import { asas } from '../asas.ts'

export const {
  notes,
  roles,
  memberRoles,
  user,
  organization,
  member,
  tags,
} = asas.targets.drizzle.tables
`)
      const directories = written.filter((entry) => /^\d{14}_/.test(entry))
      assert.equal(directories.length, 1, 'one migration')
      assert.deepEqual((await readdir(new URL(`${directories[0]}/`, migrations))).sort(), [
        'migration.sql',
        'snapshot.json',
      ])
      assert.match(first.stdout, /migration\.sql/, 'the run prints the path it wrote')
      assert.doesNotMatch(await readFile(new URL(`${directories[0]}/migration.sql`, migrations), 'utf8'), /SCHEMA/, 'and a migration with no schema but public carries no schema line')
      // Applied through `drizzle-kit migrate`, which records it in the history a later run reads.
      const applied = await appliedIn(root)
      assert.equal(applied.code, 0, applied.output)
    })

    await t.test('an applied migration leaves `--check` answering 0 and a second run reporting no changes', async () => {
      const checked = await migrating(root, 'migrate', '--check')
      assert.equal(checked.code, 0, checked.stderr)
      const again = await migrating(root, 'migrate')
      assert.equal(again.code, 0, again.stderr)
      assert.equal((await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry)).length, 1)
    })

    await t.test('the written config reads its connection off the language it imports, and resolves to the same string the probe uses', async () => {
      const source = await readFile(new URL('drizzle.config.ts', migrations), 'utf8')
      assert.match(source, /url: asas\.targets\.drizzle\.connectionString/)
      assert.doesNotMatch(source, /process\.env/, 'the file reads no environment variable of its own')
      // Imported here, not in the run that wrote it: the config answers whichever connection its
      // language was built from, which is the one the data-loss probe queries; no string is baked
      // into the file.
      const { default: written } = (await import(new URL('drizzle.config.ts', migrations).href)) as {
        default: { dbCredentials: { url: string } }
      }
      const { asas: built } = (await import(new URL('src/asas.ts', root).href)) as {
        asas: { targets: { drizzle: { connectionString?: string } }; destroy(): Promise<void> }
      }
      try {
        // Asserted before the equality because the template's string is `process.env.DATABASE_URL
        // ?? …` and two `undefined` are equal: an equality alone would pass on a language that
        // resolved nothing.
        assert.equal(typeof written.dbCredentials.url, 'string')
        assert.ok(written.dbCredentials.url.length > 0, 'the config resolves a connection string rather than nothing')
        // Both sides resolve in this process, so this proves the config reads the language rather
        // than a literal. The drizzle-kit child resolves its own, holding the migrate container's
        // DATABASE_URL while this process holds the suite's; each config answers its own.
        assert.equal(written.dbCredentials.url, built.targets.drizzle.connectionString)
      } finally {
        await built.destroy()
      }
    })

    await t.test('dropping a table that holds a row is refused with its own confirm_data_loss line, exits 2 and writes no migration', async () => {
      assert.equal(await sqlIn(root, `insert into "tags" ("id") values ('one')`), 0)
      const before = (await readdir(migrations)).length
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf(withSummary, false))
      const refused = await migrating(root, 'migrate')
      assert.equal(refused.code, 2)
      assert.match(
        refused.stderr,
        /\{"type":"confirm_data_loss","kind":"table","entity":\["public","tags"\],"reason":"non_empty"\}/,
      )
      // The guard runs before the writing `generate`, so a refusal leaves the folder as it was.
      assert.equal((await readdir(migrations)).length, before, 'the refused run wrote no migration folder')
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf(withSummary))
    })

    await t.test('a hints file holding something that is not an object is refused by its sentence alone', async () => {
      await writeFile(new URL('mithaq.hints.json', root), '[null]\n')
      const refused = await migrating(root, 'migrate')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /mithaq\.hints\.json is not a hints file: one of its entries is not an object\./)
      assert.doesNotMatch(refused.stderr, /\n\s+at /, 'a refusal, so its sentence alone')
      await rm(new URL('mithaq.hints.json', root))
    })

    await t.test('a config whose out names another directory is refused, the way one naming another schema file is', async () => {
      const whole = await readFile(new URL('drizzle.config.ts', migrations), 'utf8')
      await writeFile(
        new URL('drizzle.config.ts', migrations),
        whole.replace("out: fileURLToPath(new URL('.', import.meta.url))", "out: fileURLToPath(new URL('../', import.meta.url))"),
      )
      const refused = await migrating(root, 'migrate')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /names an out directory `mithaq migrate` did not write/)
      await writeFile(new URL('drizzle.config.ts', migrations), whole)
    })

    await t.test('a field gaining an index is a pending migration `--check` names by statement type and exits 1', async () => {
      await writeFile(
        new URL('src/asas.ts', root),
        kayanSourceOf("        id: { kind: 'text' },\n        summary: { kind: 'text', rules: { index: true } },"),
      )
      const checked = await migrating(root, 'migrate', '--check')
      assert.equal(checked.code, 1)
      assert.match(checked.stderr, /create_index/)
      assert.equal(
        (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry)).length,
        1,
        'a check writes nothing',
      )
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf(withSummary))
    })

    await t.test('dropping a field that holds a value is refused with its confirm_data_loss line and exits 2', async () => {
      assert.equal(await sqlIn(root, `insert into "notes" ("id", "summary") values ('one', 'a value')`), 0)
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf("        id: { kind: 'text' },"))
      const refused = await migrating(root, 'migrate')
      assert.equal(refused.code, 2)
      assert.match(
        refused.stderr,
        /\{"type":"confirm_data_loss","kind":"column","entity":\["public","notes","summary"\],"reason":"non_empty"\}/,
      )
      assert.equal(
        (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry)).length,
        1,
        'the refusal comes before anything is written',
      )
    })

    await t.test('the same drop with the hint written down migrates, and warns on nothing', async () => {
      await writeFile(
        new URL('mithaq.hints.json', root),
        `${JSON.stringify([{ type: 'confirm_data_loss', kind: 'column', entity: ['public', 'notes', 'summary'] }])}\n`,
      )
      const written = await migrating(root, 'migrate')
      assert.equal(written.code, 0, written.stderr)
      assert.doesNotMatch(written.stdout, /answers no/, 'no hint is reported unused')
      const directories = (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry)).sort()
      assert.equal(directories.length, 2)
      const sql = await readFile(new URL(`${directories[1]}/migration.sql`, migrations), 'utf8')
      assert.match(sql, /DROP COLUMN "summary"/)
      assert.equal((await appliedIn(root)).code, 0)
    })

    await t.test('a hint no drop asked for is reported unused, because drizzle accepts it silently', async () => {
      const unused = await migrating(root, 'migrate')
      assert.equal(unused.code, 0, unused.stderr)
      assert.match(unused.stdout, /answers no drop this run found/)
      assert.match(unused.stdout, /"entity":\["public","notes","summary"\]/)
    })

    await t.test("drizzle's own missing_hints is printed one line per unresolved item and exits 2", async () => {
      await writeFile(new URL('mithaq.hints.json', root), '[]\n')
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf("        id: { kind: 'text' },\n        title: { kind: 'text' },"))
      const added = await migrating(root, 'migrate')
      assert.equal(added.code, 0, added.stderr)
      assert.equal((await appliedIn(root)).code, 0)

      // One text column dropped and another added is the ambiguity `generate`
      // does refuse, and the only one it asks about: it never connects, so it
      // never asks about data.
      await writeFile(new URL('src/asas.ts', root), kayanSourceOf("        id: { kind: 'text' },\n        heading: { kind: 'text' },"))
      const asked = await migrating(root, 'migrate')
      assert.equal(asked.code, 2)
      assert.match(asked.stderr, /^column public\.notes\.heading rename_or_create$/m)

      await writeFile(
        new URL('mithaq.hints.json', root),
        `${JSON.stringify([{ type: 'create', kind: 'column', entity: ['public', 'notes', 'heading'] }])}\n`,
      )
      const resolved = await migrating(root, 'migrate')
      assert.equal(resolved.code, 0, resolved.stderr)
      assert.equal((await appliedIn(root)).code, 0)
      await writeFile(new URL('mithaq.hints.json', root), '[]\n')
    })

    await t.test('a schema module short one table fails the check by its export count, and a run rewrites it', async () => {
      const whole = await readFile(new URL('schema.ts', migrations), 'utf8')
      // `tags` was added to the language and not to the module, which drizzle-kit diffs as `notes`
      // alone while still emitting foreign keys to the table it cannot see.
      await writeFile(new URL('schema.ts', migrations), whole.replace('  tags,\n', ''))
      const refused = await migrating(root, 'migrate', '--check')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /exports 6 names and the language built 7 tables, missing tags/)
      const rewritten = await migrating(root, 'migrate')
      assert.equal(rewritten.code, 0, rewritten.stderr)
      assert.equal(await readFile(new URL('schema.ts', migrations), 'utf8'), whole)
    })

    await t.test('a schema module the command did not write is refused rather than overwritten', async () => {
      const whole = await readFile(new URL('schema.ts', migrations), 'utf8')
      // An object export is the most dangerous result: every run would answer `no_changes` over a
      // schema drizzle-kit never saw.
      await writeFile(
        new URL('schema.ts', migrations),
        `import { asas } from '../asas.ts'\n\nexport const tables = asas.targets.drizzle.tables\n`,
      )
      const refused = await migrating(root, 'migrate')
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /schema\.ts under .* was not written by `mithaq migrate`/)
      assert.doesNotMatch(refused.stderr, /\n\s+at /, 'a refusal, so its sentence alone')
      assert.match(
        await readFile(new URL('schema.ts', migrations), 'utf8'),
        /export const tables = asas\.targets\.drizzle\.tables/,
        'and the module the project wrote is still on disk, unread by any run',
      )
      await writeFile(new URL('schema.ts', migrations), whole)
    })
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate --name` names the folder after a slug of lowercase letters, digits and underscores, refuses any other before writing, and without it names the folder as drizzle-kit does', async () => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  try {
    assert.equal(await sqlIn(root, resetSchemas), 0)
    for (const argv of [['--name', 'Center'], ['--name', '../escape'], ['--name', 'center-feedback'], ['--name', ''], ['--name', 'x'.repeat(65)], ['--name'], ['--name', '--check']]) {
      const refused = await migrating(root, 'migrate', ...argv)
      assert.equal(refused.code, 1, JSON.stringify(argv))
      assert.match(refused.stderr, /`--name` takes a slug of lowercase letters, digits and underscores/, JSON.stringify(argv))
      await assert.rejects(readdir(migrations), { code: 'ENOENT' }, `${JSON.stringify(argv)} wrote nothing`)
    }

    const baselined = await migrating(root, 'migrate', '--baseline', '--name', 'center_feedback')
    assert.equal(baselined.code, 1)
    assert.match(baselined.stderr, /`--baseline` names its folder `_baseline`/)
    await assert.rejects(readdir(migrations), { code: 'ENOENT' }, 'the pair wrote nothing')

    const named = await migrating(root, 'migrate', '--name', 'center_feedback')
    assert.equal(named.code, 0, named.stderr)
    const [first] = await foldersIn(root)
    assert.match(first!, /^\d{14}_center_feedback$/)
    assert.equal((await appliedIn(root)).code, 0)

    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(`${withSummary}\n        body: { kind: 'text' },`))
    const unnamed = await migrating(root, 'migrate')
    assert.equal(unnamed.code, 0, unnamed.stderr)
    const folders = await foldersIn(root)
    assert.equal(folders.length, 2)
    assert.doesNotMatch(folders[1]!, /center_feedback$/, 'a run with no --name keeps the name drizzle-kit picks')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('`mithaq migrate` reads an envelope larger than a pipe holds, which drizzle-kit prints just before it exits', async () => {
  await migrateDatabase()
  // Enough columns that each envelope is several times the 64 KB a pipe holds.
  const columns = Array.from({ length: 400 }, (_, at) => `        column_that_fills_the_envelope_${at}: { kind: 'text' },`).join('\n')
  const root = await migrationProject(`        id: { kind: 'text' },\n${columns}`)
  try {
    assert.equal(await sqlIn(root, resetSchemas), 0)
    const migrated = await migrating(root, 'migrate')
    assert.equal(migrated.code, 0, migrated.stderr)
    assert.match(await latestSql(root), /"column_that_fills_the_envelope_399" text/)
  } finally {
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})

test('a kayan spreading only defaultIdField migrates to a table with no timestamp column, and creates and reads its rows', async () => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const source = kayanSourceOf("        ...defaultIdField,\n        title: { kind: 'text' },")
    .replace('import { fetchHttp }', 'import { defaultIdField, defaultOperations, fetchHttp }')
    .replace(
      "name: 'notes',",
      "name: 'notes',\n      access: { create: () => true, read: () => true, update: () => true, delete: () => true },\n      targets: { service: { operations: defaultOperations } },",
    )
  await writeFile(new URL('src/asas.ts', root), source)
  await writeFile(
    new URL('use.ts', root),
    `import { asas } from './src/asas.ts'
const { operations } = asas.kayan.notes
const made = await operations.create({ title: 'First' })
console.log(JSON.stringify({ made, read: await operations.findByID({ id: made.id }), page: (await operations.find()).docs }))
await asas.destroy()
`,
  )
  try {
    assert.equal(await sqlIn(root, resetSchemas), 0)
    const migrated = await migrating(root, 'migrate')
    assert.equal(migrated.code, 0, migrated.stderr)
    const sql = await latestSql(root)
    assert.match(sql, /CREATE TABLE "notes" \(\n\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
    assert.doesNotMatch(sql.slice(sql.indexOf('CREATE TABLE "notes"'), sql.indexOf('CREATE TABLE', sql.indexOf('CREATE TABLE "notes"') + 1)), /created_at|updated_at/)
    assert.equal((await appliedIn(root)).code, 0)

    const used = await outputIn(root, 'use.ts')
    assert.equal(used.code, 0, used.stderr)
    const { made, read, page } = JSON.parse(used.stdout.trim().split('\n').at(-1)!)
    assert.match(made.id, /^[0-9a-f-]{36}$/)
    assert.equal(made.title, 'First')
    assert.ok(!('createdAt' in made) && !('updatedAt' in made), 'the row carries no timestamp')
    assert.deepEqual(read, made)
    assert.deepEqual(page, [made])
  } finally {
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})

test('a new table puts the timestamps after every field the kayan declares, wherever its fields spread them', async () => {
  await migrateDatabase()
  const root = await migrationProject("        ...defaultFields,\n        title: { kind: 'text' },")
  await writeFile(new URL('src/asas.ts', root), kayanSourceOf("        ...defaultFields,\n        title: { kind: 'text' },").replace('import { fetchHttp }', 'import { defaultFields, fetchHttp }'))
  try {
    assert.equal(await sqlIn(root, resetSchemas), 0)
    const migrated = await migrating(root, 'migrate')
    assert.equal(migrated.code, 0, migrated.stderr)
    const sql = await latestSql(root)
    const notes = sql.slice(sql.indexOf('CREATE TABLE "notes"'))
    assert.match(notes.slice(0, notes.indexOf(');')), /\n\t"id" [^\n]*,\n\t"title" text,\n\t"deleted_at" [^\n]*,\n\t"updated_at" [^\n]*,\n\t"created_at" [^\n]*\n$/)
  } finally {
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})

test('`mithaq migrate` writes a decimal as numeric(precision, scale), and refuses a narrowing that would round a stored value until none would', async (t) => {
  await migrateDatabase()
  const sized = (scale: number) => `        id: { kind: 'text' },\n        total: { kind: 'decimal', rules: { precision: 20, scale: 2 } },\n        amount: { kind: 'decimal', rules: { precision: 7, scale: ${scale} } },`
  const root = await migrationProject(sized(3))
  const migrations = new URL('src/migrations/', root)
  const folders = async () => (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry)).sort()
  await sqlIn(root, 'drop schema public cascade; create schema public;')
  try {
    const first = await migrating(root, 'migrate')
    assert.equal(first.code, 0, first.stderr)
    const sql = await readFile(new URL(`${(await folders())[0]}/migration.sql`, migrations), 'utf8')
    assert.match(sql, /"total" numeric\(20,\s*2\)/)
    assert.match(sql, /"amount" numeric\(7,\s*3\)/)
    assert.equal((await appliedIn(root)).code, 0)
    // Postgres would round 1.235 to 1.24 under `SET DATA TYPE numeric(7,2)`, and say nothing.
    assert.equal(await sqlIn(root, `insert into "notes" ("id", "amount") values ('one', '1.235')`), 0)
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(sized(2)))
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /public\.notes\.amount holds 1 value that numeric\(7,2\) would change/)
    assert.match(refused.stderr, /as `update "notes" set "amount" = round\("amount"::numeric, <scale>\)` does/, 'and the statement it suggests names a public table as the migration does, unqualified')
    assert.equal((await folders()).length, 1, 'the refused run wrote no migration')
    assert.equal(await sqlIn(root, `update "notes" set "amount" = '1.23'`), 0)
    const written = await migrating(root, 'migrate')
    assert.equal(written.code, 0, written.stderr)
    const narrowed = await readFile(new URL(`${(await folders())[1]}/migration.sql`, migrations), 'utf8')
    assert.match(narrowed, /ALTER COLUMN "amount" SET DATA TYPE numeric\(7,\s*2\)/)
    assert.equal((await appliedIn(root)).code, 0)

    // An integer is a whole number Postgres rounds to as well: a number's 2.5
    // and a decimal's 1.23, made integers, would read back 3 and 1.
    const whole = (qty: string, amount: string) =>
      `        id: { kind: 'text' },\n        total: { kind: 'decimal', rules: { precision: 20, scale: 2 } },\n        amount: { kind: ${amount} },\n        qty: { kind: ${qty} },`
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(whole("'number'", "'decimal', rules: { precision: 7, scale: 2 }")))
    const added = await migrating(root, 'migrate')
    assert.equal(added.code, 0, added.stderr)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `update "notes" set "qty" = 2.5`), 0)
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(whole("'integer'", "'decimal', rules: { precision: 7, scale: 2 }")))
    const fromNumber = await migrating(root, 'migrate')
    assert.equal(fromNumber.code, 1)
    assert.match(fromNumber.stderr, /public\.notes\.qty holds 1 value that integer would change/)
    assert.equal(await sqlIn(root, `update "notes" set "qty" = 2`), 0)
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(whole("'integer'", "'integer'")))
    const fromDecimal = await migrating(root, 'migrate')
    assert.equal(fromDecimal.code, 1)
    assert.match(fromDecimal.stderr, /public\.notes\.amount holds 1 value that integer would change/)
    assert.equal((await folders()).length, 3, 'neither refused run wrote a migration')
    assert.equal(await sqlIn(root, `update "notes" set "amount" = 1`), 0)
    const toInteger = await migrating(root, 'migrate')
    assert.equal(toInteger.code, 0, toInteger.stderr)
    const integers = await readFile(new URL(`${(await folders())[3]}/migration.sql`, migrations), 'utf8')
    assert.match(integers, /ALTER COLUMN "amount" SET DATA TYPE integer/)
    assert.match(integers, /ALTER COLUMN "qty" SET DATA TYPE integer/)
    assert.equal((await appliedIn(root)).code, 0)

    // Money held as text and made a decimal is rounded by the same cast:
    // '1.235' would read back '1.24', and '1.20' fits as it is.
    const held = (kind: string) => `        id: { kind: 'text' },\n        total: { kind: 'decimal', rules: { precision: 20, scale: 2 } },\n        amount: { kind: 'integer' },\n        qty: { kind: 'integer' },\n        price: { kind: ${kind} },`
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(held("'text'")))
    const priced = await migrating(root, 'migrate')
    assert.equal(priced.code, 0, priced.stderr)
    assert.equal((await appliedIn(root)).code, 0)
    // Text that reads as no number is refused first: a migration written
    // past it would fail on it, and once fixed, would round '1.235' unasked.
    assert.equal(await sqlIn(root, `insert into "notes" ("id", "price") values ('two', 'abc')`), 0)
    assert.equal(await sqlIn(root, `update "notes" set "price" = '1.235' where "id" = 'one'`), 0)
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(held("'decimal', rules: { precision: 7, scale: 2 }")))
    const unread = await migrating(root, 'migrate')
    assert.equal(unread.code, 1)
    assert.match(unread.stderr, /public\.notes\.price holds text that reads as no number, and the migration would stop on it with Postgres's invalid input syntax/)
    assert.equal((await folders()).length, 5, 'the refused run wrote no migration')
    assert.equal(await sqlIn(root, `delete from "notes" where "id" = 'two'`), 0)
    const fromText = await migrating(root, 'migrate')
    assert.equal(fromText.code, 1)
    assert.match(fromText.stderr, /public\.notes\.price holds 1 value that numeric\(7,2\) would change/)
    assert.match(fromText.stderr, /round\("price"::numeric, <scale>\)/)
    assert.equal((await folders()).length, 5, 'the refused run wrote no migration')
    assert.equal(await sqlIn(root, `update "notes" set "price" = '1.20'`), 0)
    const toDecimal = await migrating(root, 'migrate')
    assert.equal(toDecimal.code, 0, toDecimal.stderr)
    assert.equal((await appliedIn(root)).code, 0)

    // A rename in the same run is counted under the name the stored rows
    // still have, so it hides nothing: a column renamed and narrowed at once,
    // then a table renamed while a column of it is narrowed.
    const apply = async () => assert.equal((await appliedIn(root)).code, 0)
    const renamed = (name: string, scale: number, table = 'notes') =>
      kayanSourceOf(`${held("'decimal', rules: { precision: 7, scale: 2 }")}\n        ${name}: { kind: 'decimal', rules: { precision: 7, scale: ${scale} } },`)
        .replace("name: 'notes',", `name: 'notes', dbName: '${table}',`)
    const hinted = (hints: object[]) => writeFile(new URL('mithaq.hints.json', root), `${JSON.stringify(hints)}\n`)
    await writeFile(new URL('src/asas.ts', root), renamed('q2', 3))
    assert.equal((await migrating(root, 'migrate')).code, 0)
    await apply()
    assert.equal(await sqlIn(root, `update "notes" set "q2" = '1.235'`), 0)
    await writeFile(new URL('src/asas.ts', root), renamed('q3', 2))
    await hinted([{ type: 'rename', kind: 'column', from: ['public', 'notes', 'q2'], to: ['public', 'notes', 'q3'] }])
    const columnRenamed = await migrating(root, 'migrate')
    assert.equal(columnRenamed.code, 1, columnRenamed.stdout)
    assert.match(columnRenamed.stderr, /public\.notes\.q2 holds 1 value that numeric\(7,2\) would change/)
    assert.equal((await folders()).length, 7, 'the refused run wrote no migration')
    assert.equal(await sqlIn(root, `update "notes" set "q2" = '1.23'`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    await apply()
    await writeFile(new URL('src/asas.ts', root), renamed('q3', 1, 'memos'))
    await hinted([{ type: 'rename', kind: 'table', from: ['public', 'notes'], to: ['public', 'memos'] }])
    const tableRenamed = await migrating(root, 'migrate')
    assert.equal(tableRenamed.code, 1, tableRenamed.stdout)
    assert.match(tableRenamed.stderr, /public\.notes\.q3 holds 1 value that numeric\(7,1\) would change/)
    assert.equal((await folders()).length, 8, 'the refused run wrote no migration')
    assert.equal(await sqlIn(root, `update "notes" set "q3" = '1.2'`), 0)
    const tableWritten = await migrating(root, 'migrate')
    assert.equal(tableWritten.code, 0, tableWritten.stderr)
    await apply()
    await rm(new URL('mithaq.hints.json', root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('`mithaq migrate` writes an unsized decimal as a bare numeric, and sizing or unsizing it is a change only a narrowing refuses', async (t) => {
  await migrateDatabase()
  const fields = (amount: string) => `        id: { kind: 'text' },\n        amount: { kind: 'decimal'${amount} },`
  const root = await migrationProject(fields(''))
  const migrations = new URL('src/migrations/', root)
  const folders = async () => (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry)).sort()
  const sqlOf = async (index: number) => readFile(new URL(`${(await folders())[index]}/migration.sql`, migrations), 'utf8')
  await sqlIn(root, 'drop schema public cascade; create schema public;')
  try {
    const first = await migrating(root, 'migrate')
    assert.equal(first.code, 0, first.stderr)
    assert.match(await sqlOf(0), /"amount" numeric(,|\n)/, 'a bare numeric, with no size')
    assert.equal((await appliedIn(root)).code, 0)
    const many = '1.2345678901234567890123456789'
    assert.equal(await sqlIn(root, `insert into "notes" ("id", "amount") values ('one', '${many}')`), 0)
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(fields(', rules: { precision: 7, scale: 2 }')))
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /public\.notes\.amount holds 1 value that numeric\(7,2\) would change/)
    assert.equal((await folders()).length, 1, 'the refused run wrote no migration')
    assert.equal(await sqlIn(root, `update "notes" set "amount" = '1.23'`), 0)
    assert.equal((await migrating(root, 'migrate')).code, 0)
    assert.match(await sqlOf(1), /ALTER COLUMN "amount" SET DATA TYPE numeric\(7,\s*2\)/)
    assert.equal((await appliedIn(root)).code, 0)
    await writeFile(new URL('src/asas.ts', root), kayanSourceOf(fields('')))
    const widened = await migrating(root, 'migrate')
    assert.equal(widened.code, 0, widened.stderr)
    assert.match(await sqlOf(2), /ALTER COLUMN "amount" SET DATA TYPE numeric/)
    assert.equal((await appliedIn(root)).code, 0)
    assert.equal(await sqlIn(root, `update "notes" set "amount" = '${many}'`), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('`mithaq migrate` creates the type of every enum a column uses, in the enum\'s own schema, applies, then plans nothing, and never takes over an enum of another tool', async (t) => {
  await migrateDatabase()
  const pgCore = import.meta.resolve('drizzle-orm/pg-core')
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  const source = (schema: string, labels: string[], more: Record<string, string[]> = {}) => {
    const made = (name: string, of: string[]) => `${schema === 'public' ? 'pgEnum' : `pgSchema('${schema}').enum`}('${name}', ${JSON.stringify(of)})`
    const fields = Object.entries({ mood: labels, ...more }).map(([name, of]) => `\n        ${name}: { kind: 'text', targets: { drizzle: ${made(name, of)}('${name}') } },`).join('')
    const kayan = kayanSourceOf(`${withSummary}${fields}`)
    return `import { pgEnum, pgSchema } from '${pgCore}'\n${schema === 'public' ? kayan : inSchemas(kayan, { notes: schema })}`
  }
  const labelsOf = (schema: string, name: string, labels: string[]) =>
    sqlIn(root, `do $$ begin assert (select array_agg(enumlabel::text order by enumsortorder) from pg_enum where enumtypid = '"${schema}"."${name}"'::regtype) = array[${labels.map((label) => `'${label}'`).join(', ')}]; end $$;`)
  try {
    for (const schema of ['public', 'app']) {
      assert.equal(await sqlIn(root, resetSchemas), 0)
      await rm(migrations, { recursive: true, force: true })
      await writeFile(new URL('src/asas.ts', root), source(schema, ['happy', 'sad']))
      const first = await migrating(root, 'migrate')
      assert.equal(first.code, 0, first.stderr)
      assert.match(await readFile(new URL('schema.ts', migrations), 'utf8'), /\} = asas\.targets\.drizzle\.enums\n$/, 'the module exports the enum')
      // drizzle-kit writes a type in `public` unqualified, as it writes a table there.
      const typed = schema === 'public' ? '"mood"' : `"${schema}"."mood"`
      const created = await latestSql(root)
      const at = created.indexOf(`CREATE TYPE ${typed} AS ENUM('happy', 'sad');`)
      assert.ok(at >= 0 && at < created.indexOf('CREATE TABLE'), `the migration creates the type in ${schema} before any table: ${created}`)
      const applied = await appliedIn(root)
      assert.equal(applied.code, 0, applied.output)
      assert.equal(await labelsOf(schema, 'mood', ['happy', 'sad']), 0)
      assert.equal(await sqlIn(root, `insert into "${schema}".notes (id, summary, mood) values ('n1', 's', 'sad')`), 0, 'a row holds the enum')
      const again = await migrating(root, 'migrate')
      assert.equal(again.code, 0, again.stderr)
      assert.match(again.stdout, /The database schema is up to date\./, `a second run in ${schema} plans nothing`)
      assert.equal((await foldersIn(root)).length, 1)

      await writeFile(new URL('src/asas.ts', root), source(schema, ['happy', 'sad', 'glad']))
      const gained = await migrating(root, 'migrate')
      assert.equal(gained.code, 0, gained.stderr)
      assert.equal(await latestSql(root), `ALTER TYPE ${typed} ADD VALUE 'glad';`)
      assert.equal((await appliedIn(root)).code, 0)
      assert.equal(await labelsOf(schema, 'mood', ['happy', 'sad', 'glad']), 0)

      await writeFile(new URL('src/asas.ts', root), source(schema, ['glad', 'happy', 'sad']))
      const reordered = await migrating(root, 'migrate')
      assert.equal(reordered.code, 0, reordered.stderr)
      assert.match(await latestSql(root), new RegExp(`DROP TYPE ${typed.replaceAll('.', '\\.')};`), 'drizzle-kit recreates the enum')
      assert.equal((await appliedIn(root)).code, 0)
      assert.equal(await labelsOf(schema, 'mood', ['glad', 'happy', 'sad']), 0)
      const row = (label: string) => sqlIn(root, `do $$ begin assert (select mood::text from "${schema}".notes where id = 'n1') = '${label}'; end $$;`)
      assert.equal(await row('sad'), 0, 'and the row holds its value')

      await writeFile(new URL('src/asas.ts', root), source(schema, ['glad', 'happy']))
      const before = await foldersIn(root)
      const removed = await migrating(root, 'migrate')
      assert.equal(removed.code, 1, removed.stdout)
      assert.match(removed.stderr, new RegExp(`${schema}\\.notes\\.mood holds 1 value whose label the enum no longer has`))
      assert.deepEqual(await foldersIn(root), before, 'no migration was written')
      assert.equal(await sqlIn(root, `update "${schema}".notes set mood = 'happy'`), 0)
      const relabeled = await migrating(root, 'migrate')
      assert.equal(relabeled.code, 0, relabeled.stderr)
      assert.equal((await appliedIn(root)).code, 0)
      assert.equal(await labelsOf(schema, 'mood', ['glad', 'happy']), 0)
      assert.equal(await row('happy'), 0)

      for (const labels of [['x', 'y', 'z'], ['x', 'y']]) {
        assert.equal(await sqlIn(root, `create type "${schema}".feel as enum ('x', 'y')`), 0)
        await writeFile(new URL('src/asas.ts', root), source(schema, ['glad', 'happy'], { feel: labels }))
        const before = await foldersIn(root)
        const clash = await migrating(root, 'migrate')
        assert.equal(clash.code, 1, clash.stdout)
        assert.match(clash.stderr, new RegExp(`The enum "${schema}"\\."feel" is already in the database with the labels x, y, and no migration of this project made it`))
        assert.deepEqual(await foldersIn(root), before, 'no migration was written')
        assert.equal(await labelsOf(schema, 'feel', ['x', 'y']), 0, 'and the enum of another tool is unchanged')
        assert.equal(await sqlIn(root, `drop type "${schema}".feel`), 0)
      }
    }
  } finally {
    // `app.notes` left behind would be a second `notes` to a later step.
    await sqlIn(root, resetSchemas)
    await rm(root, { recursive: true, force: true })
  }
})
