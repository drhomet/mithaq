// `mithaq generate auth` reads Better Auth's `advanced.database.generateId`, so
// an instance that asks for `uuid` gets `uuid` ids and uuid foreign keys, all
// the way to a sign-up on a database of its own.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, rm } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { betterAuth } from 'better-auth'
import { drizzleAdapter as betterAuthDrizzle } from 'better-auth/adapters/drizzle'
import {
  defaultMaxBodyBytes,
  base,
  defaultAuthorize,
  defaultBulkLimit,
  defaultDepth,
  defaultJoinLimit,
  defaultLimit,
  defaultMaxLimit,
  defineMithaq,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  fetchHttp,
  serviceTarget,
  zodKinds,
  zodRules,
  zodTarget,
} from 'mithaq'
import { generateAuth } from 'mithaq/generate-auth'
import { pushInput } from '../../../packages/mithaq/src/drizzle/index.ts'
import { testDatabase } from './test-database.ts'

/**
 * drizzle-kit is core's dependency and not the template's, so it is resolved from
 * core's `package.json` the way the migrate command resolves its binary.
 */
const { generateDrizzleJson, generateMigration } = (await import(
  pathToFileURL(createRequire(new URL('../../../packages/mithaq/package.json', import.meta.url)).resolve('drizzle-kit/api-postgres')).href
)) as {
  generateDrizzleJson(imports: Record<string, unknown>): Promise<unknown>
  generateMigration(prev: unknown, cur: unknown): Promise<string[]>
}

/**
 * The generated files import the language three levels up, so the folder sits
 * under `src/`, as `features/auth/user/` does.
 */
const root = new URL(`./auth-uuid-${randomUUID()}/`, import.meta.url)
const uuidDirectory = new URL('auth/user/', root)
const textDirectory = new URL('plain/user/', root)
const uuidOptions = { emailAndPassword: { enabled: true }, advanced: { database: { generateId: 'uuid' } } } as never
const plainOptions = { emailAndPassword: { enabled: true } } as never
const schemaName = `auth_uuid_${randomUUID().replaceAll('-', '')}`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const language = defineMithaq({
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules }),
    zod: { ...zodTarget, kinds: zodKinds, rules: zodRules },
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
let built: ReturnType<typeof language.buildAsas>
let tables: Record<string, unknown>

before(async () => {
  await generateAuth({ language: '../../../mithaq.ts', options: uuidOptions, directory: uuidDirectory, schemaName })
  await generateAuth({ language: '../../../mithaq.ts', options: plainOptions, directory: textDirectory })
  const { betterAuth: kayan } = (await import(new URL('index.ts', uuidDirectory).href)) as { betterAuth: { core: never[] } }
  built = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: kayan.core, auth: { maxBodyBytes: defaultMaxBodyBytes, onError: console.error } })
  tables = built.targets.drizzle.tables
  await built.connect()
})

after(async () => {
  try {
    // Parallel pushes may still read its catalogue entries, so the schema stays until the database is discarded.
    await built?.destroy()
  } finally {
    // A `before` that failed halfway still leaves no `src/auth-uuid-*` behind.
    await rm(root, { recursive: true, force: true })
  }
})

test('generateAuth writes a uuid id when generateId is "uuid", and the text id it always wrote when it is not', async () => {
  for (const file of ['user', 'session', 'account', 'verification']) {
    const uuid = await readFile(new URL(`${file}.ts`, uuidDirectory), 'utf8')
    const text = await readFile(new URL(`${file}.ts`, textDirectory), 'utf8')
    assert.match(uuid, /\n {4}id: \{ kind: 'uuid' \},\n/, `${file} has a uuid id`)
    assert.match(text, /\n {4}id: \{ kind: 'text' \},\n/, `${file} keeps its text id`)
    assert.equal(uuid.replace("id: { kind: 'uuid' }", "id: { kind: 'text' }").replace(`\n  schemaName: '${schemaName}',`, ''), text, `${file} differs by the id alone`)
  }
  for (const generateId of [false, 'serial', () => 'id']) {
    const directory = new URL(`other/${typeof generateId}/`, root)
    await generateAuth({ language: '../../../mithaq.ts', options: { advanced: { database: { generateId } } } as never, directory })
    assert.match(await readFile(new URL('user.ts', directory), 'utf8'), /\n {4}id: \{ kind: 'text' \},\n/, `${String(generateId)} keeps text`)
  }
})

test('the foreign keys of a uuid instance are uuid columns and the migration builds uuid columns', async () => {
  const sqlTypes = (table: string) => tables[table] as Record<string, { getSQLType(): string }>
  assert.equal(sqlTypes('user').id!.getSQLType(), 'uuid')
  assert.equal(sqlTypes('session').id!.getSQLType(), 'uuid')
  assert.equal(sqlTypes('session').userId!.getSQLType(), 'uuid')
  assert.equal(sqlTypes('account').userId!.getSQLType(), 'uuid')
  // Better Auth types a column uuid only where it references an id.
  assert.equal(sqlTypes('session').token!.getSQLType(), 'text')

  const { imports } = pushInput({ tables: tables as never, schemas: built.targets.drizzle.schemas })
  const migration = (await generateMigration(await generateDrizzleJson({}), await generateDrizzleJson(imports))).join('\n')
  assert.match(migration, new RegExp(`CREATE TABLE "${schemaName}"."session" \\(\\s*"id" uuid PRIMARY KEY DEFAULT gen_random_uuid\\(\\)`))
  assert.match(migration, /"user_id" uuid NOT NULL/)
  assert.doesNotMatch(migration, /"(id|user_id)" text/)
})

test('a sign-up on a uuid instance stores uuid ids, and the session it opens reads back', async () => {
  const { db } = built.targets.drizzle
  const server = betterAuth({
    secret: 'a-test-secret-of-at-least-32-characters!!',
    baseURL: 'http://localhost:3000',
    emailAndPassword: { enabled: true },
    advanced: { database: { generateId: 'uuid' } },
    database: betterAuthDrizzle(db, { provider: 'pg', schema: tables, transaction: true }),
  })
  const signUp = await server.api.signUpEmail({ body: { name: 'Uuid', email: 'uuid-238@example.com', password: 'a-long-enough-password' }, returnHeaders: true })
  assert.match(signUp.response.user.id, uuidPattern)
  const types = await db.execute(
    `select table_name, column_name, data_type from information_schema.columns where table_schema = '${schemaName}' and column_name in ('id', 'user_id') order by 1, 2`,
  )
  assert.deepEqual(
    types.rows.map((row) => `${row.table_name}.${row.column_name}:${row.data_type}`),
    ['account.id:uuid', 'account.user_id:uuid', 'session.id:uuid', 'session.user_id:uuid', 'user.id:uuid', 'verification.id:uuid'],
  )
  const session = await server.api.getSession({ headers: new Headers({ cookie: signUp.headers.get('set-cookie') ?? '' }) })
  assert.equal(session?.user.id, signUp.response.user.id)
  assert.match(session!.session.id, uuidPattern)
  assert.equal(session!.session.userId, signUp.response.user.id)
})
