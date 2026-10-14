// `dev:setup`, run the way a person runs it: as its own process, against a
// database of its own made for this test and dropped after it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { testDatabase } from './test-database.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const admin = { DEV_ADMIN_EMAIL: 'dev-admin@example.com', DEV_ADMIN_PASSWORD: 'dev-setup-test-password' }

const run = (env: Record<string, string>, args: string[] = []) => {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...admin, ...env }
  for (const key of ['NODE_ENV', 'SEED_EMAIL']) if (!(key in env)) delete environment[key]
  const done = spawnSync(process.execPath, ['dev-setup.ts', ...args], { cwd: here, env: environment, encoding: 'utf8' })
  return { status: done.status, stdout: done.stdout, stderr: done.stderr }
}
const refused = (env: Record<string, string>) => {
  const done = run(env)
  assert.equal(done.status, 1, done.stdout)
  return done.stderr
}
const script = (url: string, code: string) => {
  const done = spawnSync(process.execPath, ['--input-type=module', '-e', `const { asas } = await import('./asas.ts')\ntry {\n${code}\n} finally { await asas.destroy() }`], { cwd: here, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  assert.equal(done.status, 0, done.stderr)
  return done.stdout
}

test('dev:setup refuses a database on another machine, any NODE_ENV but development, and missing credentials, before it connects', () => {
  // Nothing listens at these hosts, so a run that connected would fail with another message.
  const local = 'postgres://postgres:postgres@localhost:1/app'
  assert.match(refused({ DATABASE_URL: 'postgres://postgres:postgres@db.example.invalid:5432/app' }), /Refusing dev:setup: DATABASE_URL names db\.example\.invalid:5432\/app, which is not this machine\./)
  // pg connects to the last `?host=`, so that is the host the guard reads.
  assert.match(refused({ DATABASE_URL: `${local}?host=db.example.invalid` }), /names db\.example\.invalid:1\/app, which is not this machine/)
  assert.match(refused({ DATABASE_URL: local, NODE_ENV: 'production' }), /Refusing dev:setup: NODE_ENV is production, and it sets up a development database only\./)
  assert.match(refused({ DATABASE_URL: local, NODE_ENV: 'test' }), /NODE_ENV is test/)
  assert.match(refused({ DATABASE_URL: local, DEV_ADMIN_PASSWORD: '' }), /set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD/)
})

test('dev:setup pushes the schema, makes a verified super admin who owns an organization and signs in to both apps, seeds with --seed, and refuses once a user exists', () => {
  const base = testDatabase()
  const name = `mithaq_dev_setup_${process.pid}`
  const fresh = Object.assign(new URL(base), { pathname: `/${name}` }).href
  const client = 'asas.targets.drizzle.db.$client'
  script(base, `await ${client}.query('create database ${name}')`)
  try {
    const done = run({ DATABASE_URL: fresh }, ['--seed'])
    assert.equal(done.status, 0, `${done.stdout}\n${done.stderr}`)
    // The credentials stay in .env: the output names their variables alone.
    assert.ok(!`${done.stdout}${done.stderr}`.includes(admin.DEV_ADMIN_EMAIL) && !`${done.stdout}${done.stderr}`.includes(admin.DEV_ADMIN_PASSWORD), done.stdout)
    assert.match(done.stdout, /DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD/)
    assert.match(done.stdout, /Seeding the organization "Dev admin's workspace"/)
    assert.match(done.stdout, /"totals":\{"tags":6,/)

    const held = JSON.parse(script(fresh, `
      const { asPlatform } = await import('@asas/mithaq/auth')
      const server = asas.auth.strategies.find((one) => one.name === 'user').server
      const body = { email: '${admin.DEV_ADMIN_EMAIL}', password: '${admin.DEV_ADMIN_PASSWORD}' }
      const tenant = await server.api.signInEmail({ body, asResponse: true })
      const platform = await asPlatform(() => server.api.signInEmail({ body, asResponse: true }))
      const { rows: [user] } = await ${client}.query("select role, email_verified from \\"user\\"")
      const { rows: owned } = await ${client}.query("select organization.name, member.role from member join organization on organization.id = member.organization_id")
      console.log(JSON.stringify({ tenant: tenant.status, platform: platform.status, user, owned }))
    `).trim().split('\n').at(-1)!)
    assert.deepEqual(held, { tenant: 200, platform: 200, user: { role: 'super_admin', email_verified: true }, owned: [{ name: "Dev admin's workspace", role: 'owner' }] })

    const again = run({ DATABASE_URL: fresh })
    assert.equal(again.status, 1, again.stdout)
    assert.match(again.stderr, /Refusing dev:setup: the database already holds a user\. Sign in at http:\/\/localhost:5173 .*DEV_ADMIN_EMAIL/)
  } finally {
    script(base, `await ${client}.query('drop database if exists ${name} with (force)')`)
  }
})
