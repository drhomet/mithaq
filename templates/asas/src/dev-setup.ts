// Makes a fresh development database usable in one command: pushes the schema,
// makes the dev admin that DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD name, and
// with --seed fills its organization.
//
//   bun run dev:setup [--seed]
//
// The dev admin owns an organization and, where the project serves the backoffice
// console, is its super_admin, with a proved address, so it signs in to both
// apps at once. A development tool only: it refuses production, a database on
// another machine, and a database that already holds a user.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { organizations as mode } from '@asas/mithaq/auth/organizations'
import { databaseOf } from './local-database.ts'

function refuse(reason: string): never {
  console.error(`Refusing dev:setup: ${reason}`)
  process.exit(1)
}

const { values } = parseArgs({ options: { seed: { type: 'boolean' } } })
// Checked before the build is imported, since the import is what reads them.
if (!process.env.DATABASE_URL) refuse('set DATABASE_URL to the development database to set up.')
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') refuse(`NODE_ENV is ${process.env.NODE_ENV}, and it sets up a development database only.`)
// The account it makes signs in with a password every project's .env.example
// holds, so it is made on this machine's database alone.
const at = databaseOf(process.env.DATABASE_URL)
if (!at) refuse('DATABASE_URL is not a connection string pg reads.')
const { database, local } = at
if (!local) refuse(`DATABASE_URL names ${database}, which is not this machine.`)
const { DEV_ADMIN_EMAIL: email, DEV_ADMIN_PASSWORD: password } = process.env
if (!email || !password) refuse('set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD in .env, as .env.example does.')
// Unset is development here, and the auth setup reads it: on this machine
// first-run then asks no setup code, as it does under `vite dev`.
Object.assign(process.env, { NODE_ENV: 'development' })

const { asas } = await import('./asas.ts')
const { isLocalHost, backofficeApp, backofficeURL, tenantURL } = await import('@asas/mithaq/auth')
// A deploy run with plain `node` sets no NODE_ENV and may hold its database on this machine; its address is what
// tells it apart, as the auth setup reads it, so an app served elsewhere gets no dev admin.
for (const [variable, url] of [['BETTER_AUTH_URL', tenantURL], ...(backofficeApp ? [['BACKOFFICE_URL', backofficeURL]] : [])] as const) {
  if (!isLocalHost(url)) refuse(`${variable} names ${url}, which is not this machine.`)
}
const signIn = `Sign in at ${tenantURL}${backofficeApp ? ` or ${backofficeURL}` : ''}`
type Row = Record<string, unknown> & { id: string }
const { db, tables } = asas.targets.drizzle as unknown as { db: { $client: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } }; tables: Record<'user' | 'organization', PgTable> }
const client = db.$client
/** A table of the build's own, as SQL names it. */
const named = (table: PgTable) => {
  const { schema = 'public', name } = getTableConfig(table)
  return [schema, name].map((part) => `"${part.replaceAll('"', '""')}"`).join('.')
}
// The provider's own routes and adapter: the generated auth kayan answer no
// operation to anyone.
const server = (asas.auth.strategies.find((strategy) => strategy.name === 'user') as unknown as {
  server: {
    $context: Promise<{
      password: { hash(password: string): Promise<string>; config: { minPasswordLength: number; maxPasswordLength: number } }
      internalAdapter: {
        createUser(user: Record<string, unknown>): Promise<Row>
        linkAccount(account: { userId: string; providerId: string; accountId: string; password: string }): Promise<unknown>
      }
    }>
    api: {
      firstRun(input: { body: Record<string, string> }): Promise<{ organization: { id: string } }>
      createOrganization(input: { body: { name: string; slug: string; userId: string } }): Promise<{ id: string }>
    }
  }
}).server
const name = 'Dev admin'
const workspace = `${name}'s workspace`
try {
  // Asked before the push, so a database someone already uses is never changed by it.
  const users = named(tables.user)
  const [table] = (await client.query('select to_regclass($1) is not null as held', [users])).rows
  if (table!.held && (await client.query(`select exists (select 1 from ${users}) as held`)).rows[0]!.held) {
    refuse(`the database already holds a user. ${signIn} as DEV_ADMIN_EMAIL with DEV_ADMIN_PASSWORD from .env, or as the account you made.`)
  }
  const auth = await server.$context
  // First-run asks the same of its owner; the path with many makes the account itself, so it asks here.
  const { minPasswordLength: min, maxPasswordLength: max } = auth.password.config
  if (password.length < min || password.length > max) refuse(`DEV_ADMIN_PASSWORD holds ${min} to ${max} characters.`)
  await asas.connect()
  let organization: string
  if (mode === 'one') {
    // First-run's own path: the owner, the one organization and, with the backoffice console, its super_admin.
    organization = (await server.api.firstRun({ body: { name, email, password } })).organization.id
  } else {
    // With many, an account proves its address by a mailed link and then founds its organization; the dev admin is
    // made proved, as first-run makes its owner, and its workspace made for it, as the page of someone in none would.
    const user = await auth.internalAdapter.createUser({ name, email, emailVerified: true, ...(backofficeApp && { role: 'super_admin' }) })
    await auth.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await auth.password.hash(password) })
    organization = (await server.api.createOrganization({ body: { name: workspace, slug: 'dev-admin-workspace', userId: user.id } })).id
  }
  // Read back, since first-run names the organization from code (`organizationName`).
  const [made] = (await client.query(`select name from ${named(tables.organization)} where id = $1`, [organization])).rows
  console.log(`Made the dev admin, owner of "${String(made!.name)}"${backofficeApp ? ' and backoffice super_admin' : ''}. ${signIn} with DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD from .env.`)
} finally {
  await asas.destroy()
}

if (values.seed) {
  // The seed names whose organization it fills by address, which stays in .env, in any case: the provider stores it
  // lowercased.
  const seeded = spawnSync(process.execPath, [fileURLToPath(new URL('./seed.ts', import.meta.url))], { env: { ...process.env, SEED_EMAIL: email }, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8' })
  const address = new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  process.stdout.write(seeded.stdout.replace(address, 'DEV_ADMIN_EMAIL'))
  process.stderr.write(seeded.stderr.replace(address, 'DEV_ADMIN_EMAIL'))
  process.exitCode = seeded.status ?? 1
}
