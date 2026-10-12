// The seed, run the way a person runs it: as its own process, twice, against a
// database of its own made for this test and dropped after it, so the counts
// are the seed's alone and no other test file's rows are in them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { devDatabaseUrl } from './mithaq.ts'
import { testDatabase } from './test-database.ts'

const here = fileURLToPath(new URL('.', import.meta.url))

const run = (url: string | undefined, args: string[]) => {
  const env = { ...process.env, DATABASE_URL: url }
  if (url === undefined) delete env.DATABASE_URL
  const done = spawnSync(process.execPath, args, { cwd: here, env, encoding: 'utf8' })
  return { status: done.status, stdout: done.stdout, stderr: done.stderr }
}
const script = (url: string, code: string) => {
  const done = run(url, ['--input-type=module', '-e', `const { asas } = await import('./asas.ts')\ntry {\n${code}\n} finally { await asas.destroy() }`])
  assert.equal(done.status, 0, done.stderr)
}
const seed = (url: string) => {
  const done = run(url, ['seed.ts'])
  assert.equal(done.status, 0, done.stderr)
  return JSON.parse(done.stdout.trim().split('\n').at(-1)!) as { created: Record<string, number>; repaired: Record<string, number>; totals: Record<string, number> }
}

test('the seed refuses to run against a database nobody named', () => {
  const done = run(undefined, ['seed.ts'])
  assert.equal(done.status, 1)
  assert.match(done.stderr, /set DATABASE_URL/)
})

test('a test step that writes refuses a database nobody named, the dev database, the study container, and one not named mithaq', () => {
  assert.throws(() => testDatabase({}), /set DATABASE_URL/)
  assert.throws(() => testDatabase({ DATABASE_URL: '' }), /set DATABASE_URL/)
  assert.throws(() => testDatabase({ DATABASE_URL: devDatabaseUrl }), /DATABASE_URL names port 5432/)
  // A URL with no port names PostgreSQL's default, 5432, the fallback's.
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgres://postgres:postgres@localhost/mithaq' }), /DATABASE_URL names port 5432/)
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgres:///mithaq?host=/tmp' }), /DATABASE_URL names port 5432/)
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:55439/mithaq' }), /DATABASE_URL names port 55439/)
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgres://postgres:postgres@localhost:55439/other' }), /DATABASE_URL names port 55439/)
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgres://postgres:postgres@localhost:55523/production' }), /DATABASE_URL names the database "production"/)
  // pg takes the port from `?port=` over the URL's own.
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgres://postgres:postgres@localhost:55523/mithaq?port=55439' }), /DATABASE_URL names port 55439/)
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgres://postgres:postgres@localhost/mithaq?port=5432' }), /DATABASE_URL names port 5432/)
  // A repeated `?port=` leaves pg the last one, since it assigns each query entry in turn.
  assert.throws(() => testDatabase({ DATABASE_URL: 'postgres://postgres:postgres@localhost:55523/mithaq?port=55523&port=55439' }), /DATABASE_URL names port 55439/)
  const queried = 'postgres://postgres:postgres@localhost:5432/mithaq?port=55523'
  assert.equal(testDatabase({ DATABASE_URL: queried }), queried)
  const named = 'postgres://postgres:postgres@localhost:55523/mithaq'
  assert.equal(testDatabase({ DATABASE_URL: named }), named)
})

test('the seed fills "Admin org" through its owner on the first run and adds nothing on the second', () => {
  const base = testDatabase()
  const name = `mithaq_seed_${process.pid}`
  const fresh = Object.assign(new URL(base), { pathname: `/${name}` }).href
  const client = 'asas.targets.drizzle.db.$client'
  script(base, `await ${client}.query('create database ${name}')`)
  try {
    // The schema push `connect()` does on a fresh database, then the owner and
    // the organization the seed looks for, made the way the sign-up page makes
    // them. Two more are there as a dev database may have them: one of the same
    // owner under another name, and one under the same name that someone else
    // owns, so the seed has to pick the organization by its name and its owner
    // together.
    const password = randomBytes(12).toString('hex')
    script(fresh, `
      await asas.connect()
      const server = asas.auth.strategies.find((one) => one.name === 'user').server
      const make = async (email, organizations) => {
        const signed = await server.api.signUpEmail({ body: { name: email, email, password: '${password}' }, returnHeaders: true })
        const headers = new Headers({ cookie: signed.headers.get('set-cookie') ?? '' })
        for (const [name, slug] of organizations) await server.api.createOrganization({ body: { name, slug }, headers })
      }
      await make('someone@example.com', [['Admin org', 'someone-admin-org']])
      await make('admin@admin.com', [['Elsewhere', 'elsewhere'], ['Admin org', 'admin-org']])
    `)

    const first = seed(fresh)
    assert.deepEqual(first.created, { tags: 6, courses: 20, sessions: first.totals.sessions, enrollments: 60, roles: 3, memberRoles: 3, settings: 1 })
    const sessions = first.totals.sessions!
    assert.ok(sessions >= 40 && sessions <= 120, `two to six sessions for each of twenty courses: ${sessions}`)
    // The owner's `administrator` row, written when the organization was made, beside the three the seed gave.
    assert.deepEqual({ ...first.totals, sessions: 0 }, { tags: 6, courses: 20, sessions: 0, enrollments: 60, roles: 3, memberRoles: 4, settings: 1 })

    // Every seeded course is published, since the seed writes through the
    // owner's own operations and none of them saves a draft.
    script(fresh, `const { rows: [held] } = await ${client}.query("select count(*)::int as drafts from courses where _status is distinct from 'published'")
      if (held.drafts !== 0) throw new Error(held.drafts + ' seeded courses are not published')`)

    script(fresh, `const { rows } = await ${client}.query("select name from roles where name in ('teacher', 'accountant', 'receptionist') and permissions @> array['enrollments.find', 'enrollments.others']::text[] order by name")
      if (rows.map((row) => row.name).join() !== 'accountant,receptionist,teacher') throw new Error('every seat is read by ' + JSON.stringify(rows))`)

    const second = seed(fresh)
    assert.deepEqual(second.created, { tags: 0, courses: 0, sessions: 0, enrollments: 0, roles: 0, memberRoles: 0, settings: 0 })
    assert.deepEqual(second.totals, first.totals)
    assert.deepEqual(second.repaired, { roles: 0, tags: 0, tagColumns: 0, details: 0 }, 'and brings no role, tag or course up to date, because every one already is')

    script(fresh, `const { rows: [held] } = await ${client}.query("select (select count(*)::int from courses where details is null) as courses, (select count(*)::int from course_sessions where details is null) as sessions")
      if (held.courses !== 0 || held.sessions !== 0) throw new Error('without details: ' + JSON.stringify(held))
      await ${client}.query("update courses set details = null where title = 'Dictation and spelling'")`)
    assert.deepEqual(seed(fresh).repaired, { roles: 0, tags: 0, tagColumns: 0, details: 1 }, 'a course without details is given them')

    // Roles holding the old `screen.admin` key, written straight into the column
    // because no operation takes a key the catalog no longer lists. The next run
    // repairs them.
    const permissionsOf = (name: string) => `(await ${client}.query("select permissions from roles where name = '${name}'")).rows[0].permissions`
    script(fresh, `await ${client}.query("update roles set permissions = array_replace(permissions, 'screen.dashboard', 'screen.admin') where name in ('teacher', 'accountant', 'receptionist')")
      const held = ${permissionsOf('teacher')}
      if (!held.includes('screen.admin') || held.includes('screen.dashboard')) throw new Error('the old key was not written: ' + held)`)
    const third = seed(fresh)
    assert.deepEqual(third.created, { tags: 0, courses: 0, sessions: 0, enrollments: 0, roles: 0, memberRoles: 0, settings: 0 })
    assert.deepEqual(third.repaired, { roles: 3, tags: 0, tagColumns: 0, details: 0 }, 'the run after it brings each of the three roles up to date')
    for (const name of ['teacher', 'accountant', 'receptionist']) {
      script(fresh, `const held = ${permissionsOf(name)}
        if (!held.includes('screen.dashboard') || held.includes('screen.admin')) throw new Error('${name} holds ' + held)`)
    }
    assert.deepEqual(seed(fresh).repaired, { roles: 0, tags: 0, tagColumns: 0, details: 0 }, 'and the run after that writes nothing again')

    // An old-shape database: one `name` column holding the English, and a tag a
    // person made beside the six. The next run moves the column to the two the
    // kayan reads and writes the Arabic of its own six; the person's tag keeps its
    // English in both until someone writes it.
    script(fresh, `await ${client}.query('drop index "tags_name_ar_index"; alter table "tags" drop column "name_ar"; alter table "tags" rename column "name_en" to "name"')
      await ${client}.query("insert into tags (name, organization_id) select 'Evening', organization_id from tags limit 1")`)
    const old = seed(fresh)
    assert.deepEqual(old.created, { tags: 0, courses: 0, sessions: 0, enrollments: 0, roles: 0, memberRoles: 0, settings: 0 })
    assert.deepEqual(old.repaired, { roles: 0, tags: 6, tagColumns: 1, details: 0 }, 'a run against the old column repairs it and does not crash')
    script(fresh, `const { rows } = await ${client}.query("select name_en, name_ar from tags order by name_en")
      const held = Object.fromEntries(rows.map((row) => [row.name_en, row.name_ar]))
      if (held.Weekend !== 'عطلة نهاية الأسبوع' || held.Evening !== 'Evening') throw new Error('the tags hold ' + JSON.stringify(held))`)
    assert.deepEqual(seed(fresh).repaired, { roles: 0, tags: 0, tagColumns: 0, details: 0 }, 'and the run after it writes nothing')

    // The dashboard's series: the rows are spread over the last ninety days
    // rather than all made in the second the seed ran, and none is in the future.
    script(fresh, `
      const { rows } = await ${client}.query("select count(distinct date(created_at))::int as days, min(created_at) as first, max(created_at) as last from enrollments")
      const { days, first, last } = rows[0]
      if (days < 20) throw new Error('the enrollments fall on ' + days + ' days')
      if (Date.now() - first.getTime() > 90 * 86400000 || last.getTime() > Date.now()) throw new Error('outside the last ninety days: ' + first + ' to ' + last)
    `)
  } finally {
    script(base, `await ${client}.query('drop database if exists ${name} with (force)')`)
  }
})

test('the committed migrations carry every tag name into name_en and fill name_ar, on a tags table that already holds rows', () => {
  // `mithaq migrate` is the path a deployment takes, so the migration that
  // localizes a tag's name has to complete over real rows. Every migration before
  // it is applied to a fresh database, two tags are written in the old shape, and
  // then the last one runs.
  const base = testDatabase()
  const name = `mithaq_migrate_${process.pid}`
  const fresh = Object.assign(new URL(base), { pathname: `/${name}` }).href
  const client = 'asas.targets.drizzle.db.$client'
  const migrations = new URL('./migrations/', import.meta.url)
  const folders = readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const localizing = folders.indexOf('20260927212525_bent_prowler')
  assert.ok(localizing > 0, 'the migration that localizes the tag name is committed')
  const apply = (folder: string) => `for (const statement of ${JSON.stringify(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'))}.split('--> statement-breakpoint')) if (statement.trim()) await ${client}.query(statement)`
  script(base, `await ${client}.query('create database ${name}')`)
  try {
    script(fresh, folders.slice(0, localizing).map(apply).join('\n'))
    script(fresh, `await ${client}.query("insert into tags (name) values ('Weekend'), ('Evening classes')")`)
    script(fresh, apply(folders[localizing]!))
    script(fresh, `
      const { rows } = await ${client}.query('select name_en, name_ar from tags order by name_en')
      const held = JSON.stringify(rows)
      if (held !== JSON.stringify([{ name_en: 'Evening classes', name_ar: 'Evening classes' }, { name_en: 'Weekend', name_ar: 'Weekend' }])) throw new Error('the tags hold ' + held)
      const { rows: [column] } = await ${client}.query("select is_nullable from information_schema.columns where table_name = 'tags' and column_name = 'name_ar'")
      if (column.is_nullable !== 'NO') throw new Error('name_ar is nullable')
    `)
  } finally {
    script(base, `await ${client}.query('drop database if exists ${name} with (force)')`)
  }
})

test('the committed migrations publish every course already stored when they add its _status, widen its text columns without losing a value, and a course made after them starts as a draft', () => {
  // `_status` defaults to 'draft', and a plain read leaves every row that is not
  // published out, so the migration that adds the column has to publish the rows
  // already there. Every migration before it is applied to a fresh database, two
  // courses are written in the old shape, and then it runs.
  const base = testDatabase()
  const name = `mithaq_status_${process.pid}`
  const fresh = Object.assign(new URL(base), { pathname: `/${name}` }).href
  const client = 'asas.targets.drizzle.db.$client'
  const migrations = new URL('./migrations/', import.meta.url)
  const folders = readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const versioning = folders.indexOf('20260930102924_material_newton_destine')
  assert.ok(versioning > 0, 'the migration that adds the status is committed')
  const apply = (folder: string) => `for (const statement of ${JSON.stringify(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'))}.split('--> statement-breakpoint')) if (statement.trim()) await ${client}.query(statement)`
  script(base, `await ${client}.query('create database ${name}')`)
  try {
    script(fresh, folders.slice(0, versioning).map(apply).join('\n'))
    script(fresh, `await ${client}.query("insert into organization (id, name, slug, created_at) values ('old-org', 'Old org', 'old-org', now())")
      await ${client}.query("insert into courses (tenant_id, title, summary, access_code, archive_reason, created_at, updated_at) values ('old-org', 'Old one', 'Kept summary', 'AB12CD', 'Kept reason', now(), now()), ('old-org', 'Old two', null, null, null, now(), now())")`)
    script(fresh, apply(folders[versioning]!))
    script(fresh, `
      const { rows } = await ${client}.query('select title, summary, access_code, archive_reason, _status from courses order by title')
      const held = JSON.stringify(rows)
      if (held !== JSON.stringify([
        { title: 'Old one', summary: 'Kept summary', access_code: 'AB12CD', archive_reason: 'Kept reason', _status: 'published' },
        { title: 'Old two', summary: null, access_code: null, archive_reason: null, _status: 'published' },
      ])) throw new Error('the courses hold ' + held)
      const { rows: types } = await ${client}.query("select column_name, data_type from information_schema.columns where table_name = 'courses' and column_name in ('title', 'summary', 'access_code', 'archive_reason') order by column_name")
      if (types.some((column) => column.data_type !== 'text')) throw new Error('the columns are ' + JSON.stringify(types))
      const { rows: [made] } = await ${client}.query("insert into courses (tenant_id, title) values ('old-org', 'New') returning _status")
      if (made._status !== 'draft') throw new Error('a course made after the migration starts as ' + made._status)
    `)
  } finally {
    script(base, `await ${client}.query('drop database if exists ${name} with (force)')`)
  }
})
