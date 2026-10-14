// Makes a fresh development database usable in one command: pushes the schema,
// makes the dev admin that DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD name, and
// with --seed fills its organization.
//
//   bun run dev:setup [--seed]
//
// The dev admin owns an organization and, where the project serves the platform
// console, is its super_admin, with a proved address, so it signs in to both
// apps at once. A development tool only: it refuses production, a database on
// another machine, and a database that already holds a user.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
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
const { database, local } = databaseOf(process.env.DATABASE_URL)
if (!local) refuse(`DATABASE_URL names ${database}, which is not this machine.`)
const { DEV_ADMIN_EMAIL: email, DEV_ADMIN_PASSWORD: password } = process.env
if (!email || !password) refuse('set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD in .env, as .env.example does.')
// Unset is development here, and the auth setup reads it: on this machine
// first-run then asks no setup code, as it does under `vite dev`.
Object.assign(process.env, { NODE_ENV: 'development' })

const { asas } = await import('./asas.ts')
const { platformApp, platformURL, tenantURL } = await import('@asas/mithaq/auth')
const signIn = `Sign in at ${tenantURL}${platformApp ? ` or ${platformURL}` : ''}`
type Row = Record<string, unknown> & { id: string }
const client = (asas.targets.drizzle as unknown as { db: { $client: { query(text: string): Promise<{ rows: { held: boolean }[] }> } } }).db.$client
// The provider's own routes and adapter: the generated auth kayan answer no
// operation to anyone.
const server = (asas.auth.strategies.find((strategy) => strategy.name === 'user') as unknown as {
  server: {
    $context: Promise<{
      password: { hash(password: string): Promise<string> }
      internalAdapter: {
        createUser(user: Record<string, unknown>): Promise<Row>
        linkAccount(account: { userId: string; providerId: string; accountId: string; password: string }): Promise<unknown>
      }
    }>
    api: {
      firstRun(input: { body: Record<string, string> }): Promise<unknown>
      createOrganization(input: { body: { name: string; slug: string; userId: string } }): Promise<unknown>
    }
  }
}).server
const name = 'Dev admin'
const workspace = `${name}'s workspace`
try {
  // Asked before the push, so a database someone already uses is never changed by it.
  const [table] = (await client.query(`select to_regclass('public."user"') is not null as held`)).rows
  if (table!.held && (await client.query('select exists (select 1 from "user") as held')).rows[0]!.held) {
    refuse(`the database already holds a user. ${signIn} as DEV_ADMIN_EMAIL with DEV_ADMIN_PASSWORD from .env, or as the account you made.`)
  }
  await asas.connect()
  const auth = await server.$context
  if (mode === 'one') {
    // First-run's own path: the owner, the one organization and, with the platform console, its super_admin.
    await server.api.firstRun({ body: { name, email, password, organization: workspace } })
  } else {
    // With many, an account proves its address by a mailed link and then founds its organization; the dev admin is
    // made proved, as first-run makes its owner, and its workspace made for it, as the page of someone in none would.
    const user = await auth.internalAdapter.createUser({ name, email, emailVerified: true, ...(platformApp && { role: 'super_admin' }) })
    await auth.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await auth.password.hash(password) })
    await server.api.createOrganization({ body: { name: workspace, slug: 'dev-admin-workspace', userId: user.id } })
  }
  console.log(`Made the dev admin, owner of "${workspace}"${platformApp ? ' and platform super_admin' : ''}. ${signIn} with DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD from .env.`)
} finally {
  await asas.destroy()
}

if (values.seed) {
  // The seed reports whose organization it fills by address, which stays in .env.
  const seeded = spawnSync(process.execPath, [fileURLToPath(new URL('./seed.ts', import.meta.url))], { env: { ...process.env, SEED_EMAIL: email }, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' })
  process.stdout.write(seeded.stdout.replaceAll(email, 'DEV_ADMIN_EMAIL'))
  process.exitCode = seeded.status ?? 1
}
