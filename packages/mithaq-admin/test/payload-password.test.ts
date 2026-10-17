// The Payload password checker, tested here and not beside a held copy: no template project
// moves off Payload, so nothing holds it.
import assert from 'node:assert/strict'
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { betterAuth } from 'better-auth'
import type { APIError } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { getMigrations } from 'better-auth/db/migration'
import { username } from 'better-auth/plugins'
import pg from 'pg'
import { testDatabase } from '../../../templates/asas/src/test-database.ts'
import { payloadHashToAccountPassword, payloadPassword, payloadRehash } from '../registry/auth/payload-password.ts'

// Payload's own test helpers (`authenticate.spec.ts` at v3.90.2), so the hashes are the ones it writes.
const payloadUpTo389 = (password: string) => {
  const salt = randomBytes(32).toString('hex')
  return { salt, hash: pbkdf2Sync(password, salt, 25000, 512, 'sha256').toString('hex') }
}
const payloadFrom390 = (password: string) => {
  const salt = randomBytes(32).toString('hex')
  return { salt, hash: `pbkdf2-sha256-v1:${pbkdf2Sync(password, salt, 600000, 32, 'sha256').toString('hex')}` }
}

// Derived by OpenSSL, not Node, with the salt as the text it is:
// openssl kdf -keylen 32 -kdfopt digest:SHA256 -kdfopt pass:correct-horse -kdfopt salt:<salt> -kdfopt iter:600000 PBKDF2
const knownSalt = '9f3c2a1b0e8d7c6b5a49382716051f2e3d4c5b6a79881726354a3b2c1d0e0f1a'
const knownKey = '5689d8efc3d2d254ac28c61a8f23a7b63327c96a68f75828bd0452236b7795d4'

const { hash, verify } = payloadPassword()

test('a Payload 3.89 hash and a Payload 3.90 hash each verify their password and refuse another', async () => {
  for (const made of [payloadUpTo389('correct-horse'), payloadFrom390('correct-horse')]) {
    const stored = payloadHashToAccountPassword(made)
    assert.equal(await verify({ hash: stored, password: 'correct-horse' }), true, stored.slice(0, 20))
    assert.equal(await verify({ hash: stored, password: 'correct-horsE' }), false, stored.slice(0, 20))
  }
  const known = `payload-pbkdf2-v1$${knownSalt}$${knownKey}`
  assert.equal(await verify({ hash: known, password: 'correct-horse' }), true, 'a key another implementation derived')
  assert.equal(await verify({ hash: known, password: 'correct-horse ' }), false)
})

test('the salt is the hex text Payload stores, never its decoded bytes, and the password is not normalized', async () => {
  const salt = randomBytes(32).toString('hex')
  const decoded = pbkdf2Sync('pässword', Buffer.from(salt, 'hex'), 600000, 32, 'sha256').toString('hex')
  assert.equal(await verify({ hash: `payload-pbkdf2-v1$${salt}$${decoded}`, password: 'pässword' }), false)
  // "ﬁ" is one character NFKC turns into "fi", so a normalized password would derive another key.
  const ligature = pbkdf2Sync('ﬁne', salt, 600000, 32, 'sha256').toString('hex')
  assert.equal(await verify({ hash: `payload-pbkdf2-v1$${salt}$${ligature}`, password: 'ﬁne' }), true)
  assert.equal(await verify({ hash: `payload-pbkdf2-v1$${salt}$${ligature}`, password: 'fine' }), false)
})

test('anything else is Better Auth\'s own scrypt hash, which hash writes', async () => {
  const written = await hash('correct-horse')
  assert.match(written, /^[0-9a-f]{32}:[0-9a-f]{128}$/)
  assert.equal(await verify({ hash: written, password: 'correct-horse' }), true)
  assert.equal(await verify({ hash: written, password: 'wrong' }), false)
  assert.equal(await verify({ hash: await hashPassword('correct-horse'), password: 'correct-horse' }), true)
})

test('a malformed stored value refuses every password and never throws', async () => {
  const key = pbkdf2Sync('pw', knownSalt, 600000, 32, 'sha256').toString('hex')
  for (const stored of [
    '',
    'payload-pbkdf2',
    'payload-pbkdf2$',
    `payload-pbkdf2-v1$${knownSalt}`,
    `payload-pbkdf2-v1$${knownSalt}$${key}$extra`,
    `payload-pbkdf2-v1$$${key}`,
    `payload-pbkdf2-v1$${knownSalt}$${key.slice(1)}`,
    `payload-pbkdf2-v1$${knownSalt}$${key}zz`,
    // A key of another scheme's length, which the compare would throw on without the length check.
    `payload-pbkdf2-v1$${knownSalt}$${key.slice(2)}`,
    `payload-pbkdf2$${knownSalt}$${key}`,
    `payload-pbkdf2-v2$${knownSalt}$${key}`,
    'no-colon-here',
    ':',
  ]) {
    assert.equal(await verify({ hash: stored, password: 'pw' }), false, JSON.stringify(stored))
  }
})

test('the import helper names each Payload scheme by its prefix and refuses what Payload never wrote', () => {
  const old = payloadUpTo389('pw')
  assert.equal(payloadHashToAccountPassword(old), `payload-pbkdf2$${old.salt}$${old.hash}`)
  const current = payloadFrom390('pw')
  assert.equal(payloadHashToAccountPassword(current), `payload-pbkdf2-v1$${current.salt}$${current.hash.slice('pbkdf2-sha256-v1:'.length)}`)
  for (const columns of [
    { salt: '', hash: old.hash },
    { salt: old.salt, hash: '' },
    { salt: `${old.salt}$`, hash: old.hash },
    { salt: old.salt, hash: old.hash.slice(2) },
    { salt: old.salt, hash: `pbkdf2-sha256-v1:${old.hash}` },
    { salt: old.salt, hash: current.hash.slice('pbkdf2-sha256-v1:'.length) },
    { salt: null, hash: old.hash },
  ]) {
    assert.throws(() => payloadHashToAccountPassword(columns as never), /not a password Payload wrote/, JSON.stringify(columns).slice(0, 80))
  }
})

// Every sign-in below runs through a real Better Auth on Postgres, in a schema of this file's own.
const schema = `payload_password_${randomUUID().replaceAll('-', '')}`
const pool = new pg.Pool({ connectionString: testDatabase(), options: `-c search_path=${schema}` })
const errors: unknown[][] = []
const authOf = (password = payloadPassword()) =>
  betterAuth({
    database: pool,
    secret: 'payload-password-test-secret-of-32-characters',
    baseURL: 'http://localhost:3000',
    emailAndPassword: { enabled: true, password },
    // The column names `mithaq generate auth` writes, which the cutover below reads.
    account: { fields: { userId: 'user_id', providerId: 'provider_id' } },
    plugins: [payloadRehash(), username()],
    logger: { log: (level, ...args) => void (level === 'error' && errors.push(args)) },
  })
const auth = authOf()

before(async () => {
  await pool.query(`create schema ${schema}`)
  await (await getMigrations(auth.options)).runMigrations()
})
after(async () => {
  await pool.end()
})

/** A user whose credential account holds the Payload hash of `password`, as the cutover leaves it. */
const imported = async ({ email, password, made = payloadFrom390 }: { email: string; password: string; made?: typeof payloadFrom390 }) => {
  const { user } = await auth.api.signUpEmail({ body: { name: email, email, password: randomBytes(16).toString('hex'), username: email.split('@')[0]! } })
  await pool.query('update account set password = $1 where user_id = $2', [payloadHashToAccountPassword(made(password)), user.id])
  return user.id
}
const storedOf = async (userId: string) => (await pool.query<{ password: string }>('select password from account where user_id = $1', [userId])).rows[0]!.password

test('a Payload user signs in with their password, which is then Better Auth\'s hash, and signs in again', async () => {
  for (const [email, made] of [['old@example.com', payloadUpTo389], ['new@example.com', payloadFrom390]] as const) {
    const id = await imported({ email, password: 'correct-horse', made })
    const signed = await auth.api.signInEmail({ body: { email, password: 'correct-horse' } })
    assert.equal(signed.user.id, id)
    assert.match(await storedOf(id), /^[0-9a-f]{32}:[0-9a-f]{128}$/, `${email} is rehashed`)
    assert.equal((await auth.api.signInEmail({ body: { email, password: 'correct-horse' } })).user.id, id, 'and the new hash signs them in')
  }
})

test('a wrong password neither signs in nor rehashes', async () => {
  const id = await imported({ email: 'wrong@example.com', password: 'correct-horse' })
  const held = await storedOf(id)
  await assert.rejects(auth.api.signInEmail({ body: { email: 'wrong@example.com', password: 'correct-horsE' } }), (error: APIError) => error.status === 'UNAUTHORIZED')
  assert.equal(await storedOf(id), held)
})

test('the username sign-in rehashes too', async () => {
  const id = await imported({ email: 'named@example.com', password: 'correct-horse' })
  assert.equal((await auth.api.signInUsername({ body: { username: 'named', password: 'correct-horse' } }))!.user.id, id)
  assert.match(await storedOf(id), /^[0-9a-f]{32}:/)
})

test('a rehash the database refuses is logged and the sign-in still succeeds', async () => {
  const id = await imported({ email: 'refused@example.com', password: 'correct-horse' })
  const held = await storedOf(id)
  await pool.query(`create function ${schema}.refuse() returns trigger language plpgsql as $$ begin raise exception 'no writes'; end $$;
    create trigger refuse before update on ${schema}.account for each row execute function ${schema}.refuse()`)
  errors.length = 0
  try {
    assert.equal((await auth.api.signInEmail({ body: { email: 'refused@example.com', password: 'correct-horse' } })).user.id, id)
  } finally {
    await pool.query(`drop trigger refuse on ${schema}.account`)
  }
  assert.equal(await storedOf(id), held, 'the Payload hash stays, for the next sign-in to replace')
  assert.equal(errors.length, 1)
})

test('a password set while a rehash ran is never overwritten by it', async () => {
  const id = await imported({ email: 'race@example.com', password: 'correct-horse' })
  const newer = await hashPassword('changed-elsewhere')
  // The other writer lands between the rehash's read and its write, as a reset in another tab would.
  const racing = authOf({ ...payloadPassword(), hash: async (password: string) => {
    await pool.query('update account set password = $1 where user_id = $2', [newer, id])
    return hashPassword(password)
  } })
  assert.equal((await racing.api.signInEmail({ body: { email: 'race@example.com', password: 'correct-horse' } })).user.id, id)
  assert.equal(await storedOf(id), newer)
})

test('a rehash replaces only the hash the sign-in verified, never one a cutover wrote after it', async () => {
  const id = await imported({ email: 'swapped@example.com', password: 'correct-horse' })
  const rewritten = payloadHashToAccountPassword(payloadFrom390('another-password'))
  // The cutover lands between the route's verify and the hook's read.
  const swapping = authOf({ ...payloadPassword(), verify: async (args) => {
    const verified = await payloadPassword().verify(args)
    await pool.query('update account set password = $1 where user_id = $2', [rewritten, id])
    return verified
  } })
  assert.equal((await swapping.api.signInEmail({ body: { email: 'swapped@example.com', password: 'correct-horse' } })).user.id, id)
  assert.equal(await storedOf(id), rewritten)
})

test('a Payload password longer than Better Auth\'s maxPasswordLength signs in, since Payload let it be set', async () => {
  // Payload caps a password at its `defaultMaxTextLength`, 40000 characters; Better Auth's sign-up at 128.
  const long = 'x'.repeat(40000)
  const id = await imported({ email: 'long@example.com', password: long })
  assert.equal((await auth.api.signInEmail({ body: { email: 'long@example.com', password: long } })).user.id, id)
  assert.equal((await auth.api.signInUsername({ body: { username: 'long', password: long } }))!.user.id, id)
  assert.match(await storedOf(id), /^[0-9a-f]{32}:/)
})

/**
 * The cutover the README shows: each credential account still on the shared temporary password takes its
 * user's Payload hash, so the temporary password stops signing anyone in. An account whose user set a
 * password of their own keeps it. Run again, it moves nobody, because the temporary password no longer
 * verifies against what it wrote.
 */
const cutover = async ({ db, temporary }: { db: pg.Pool; temporary: string }) => {
  const { verify } = payloadPassword()
  const { rows } = await db.query<{ id: string; password: string; salt: string; hash: string }>(`
    select account.id, account.password, users.salt, users.hash
    from account
    join "user" on "user".id = account.user_id
    join users on lower(users.email) = lower("user".email)
    where account.provider_id = 'credential' and account.password is not null and users.hash is not null`)
  let moved = 0
  for (const row of rows) {
    if (!(await verify({ hash: row.password, password: temporary }))) continue
    const { rowCount } = await db.query('update account set password = $1 where id = $2 and password = $3', [payloadHashToAccountPassword(row), row.id, row.password])
    moved += rowCount ?? 0
  }
  return moved
}

test('the cutover gives the Payload hash to each account still on the temporary password, and to no other', async () => {
  // Payload's own `users` table, holding the columns the cutover reads.
  await pool.query('create table users (email text, salt text, hash text)')
  const temporary = 'shared-temporary-password'
  const { user: waiting } = await auth.api.signUpEmail({ body: { name: 'waiting', email: 'waiting@example.com', password: temporary, username: 'waiting' } })
  const { user: changed } = await auth.api.signUpEmail({ body: { name: 'changed', email: 'changed@example.com', password: 'chosen-in-better-auth', username: 'changed' } })
  await auth.api.signUpEmail({ body: { name: 'unpaired', email: 'unpaired@example.com', password: temporary, username: 'unpaired' } })
  for (const [email, password] of [['Waiting@Example.com', 'payload-secret'], ['changed@example.com', 'older-payload-secret']] as const) {
    const { salt, hash } = payloadUpTo389(password)
    await pool.query('insert into users values ($1, $2, $3)', [email, salt, hash])
  }
  const kept = await storedOf(changed.id)

  assert.equal(await cutover({ db: pool, temporary }), 1)
  assert.match(await storedOf(waiting.id), /^payload-pbkdf2\$/)
  assert.equal(await storedOf(changed.id), kept, 'a password the user chose stands')
  await assert.rejects(auth.api.signInEmail({ body: { email: 'waiting@example.com', password: temporary } }), (error: APIError) => error.status === 'UNAUTHORIZED')
  assert.equal((await auth.api.signInEmail({ body: { email: 'waiting@example.com', password: 'payload-secret' } })).user.id, waiting.id)
  assert.equal(await cutover({ db: pool, temporary }), 0, 'and a second run moves nobody')
})
