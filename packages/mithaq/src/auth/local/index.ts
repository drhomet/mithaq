import crypto, { timingSafeEqual, randomBytes, randomUUID, type ScryptOptions } from 'node:crypto'
import { and, eq, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { SignJWT, jwtVerify } from 'jose'
import { declaredFieldAccess } from '../../mithaq/rows.ts'
import { providerOf } from '../../base/rules.ts'
import { accessReport, isAdminActor, markAuthActor, resolveAssigned, type AssignedResolver, type AuthStrategy, type LocalAuthPermissions } from '../../asas/actor.ts'
import { AsasError, codes, retryConflict, denied as refused, Notice } from '../../asas/runner/errors.ts'
import { firstRegisters, running, type Open } from '../../asas/runner/runtime.ts'
import { drain } from '../../asas/runner/write.ts'
import type { Store } from '../../mithaq/language.ts'
import type { Field, ResolvedKayan } from '../../mithaq/types.ts'
import { insert, neverRead, sealOf, update, type DerivedShapes, type Operations, type WriteStep } from '../../asas/runner/steps.ts'
import type { StandardSchemaV1 } from '../../mithaq/standard-schema.ts'

// Random and made once per process, so a development token dies with the process
// and nobody who reads this file can forge one.
const developmentSecret = randomBytes(32).toString('base64url')

// Read off the module at each call, so a test can count the calls a login makes.
const scrypt = (password: string, salt: string, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key))))

type Row = Record<string, unknown>
type Selected = {
  limit(count: number): Promise<Row[]>
  where(condition: unknown): { limit(count: number): Promise<Row[]> }
}
type Db = {
  execute(query: unknown): Promise<unknown>
  select(): { from(table: unknown): Selected }
  update(table: unknown): {
    set(values: Row): { where(condition: unknown): { returning(): Promise<Row[]> } }
  }
  transaction<Result>(run: (tx: Db) => Promise<Result>): Promise<Result>
}

/** How long a token and its session live, in seconds. */
export const defaultTokenExpiration = 7200
/** Failed logins before the account locks. */
export const defaultMaxLoginAttempts = 5
/** How long the lock holds, in milliseconds. */
export const defaultLockTime = 600000

export type LocalAuthOptions = {
  /**
   * Signs with a random per-process secret when no `secret` is passed, and sends
   * cookies without `Secure`. Never in production.
   */
  development?: boolean
  secureCookies?: boolean
  /** What every token is signed with, 32 characters at least. Required unless `development` or `withoutSecret` is set. */
  secret?: string
  /**
   * The project's own words local auth answers every POST with, as a 503, when it has no
   * `secret` outside development; local auth is then off as a whole. Without it, a missing secret fails the build.
   */
  withoutSecret?: string
  /** How long a token and its session live, in seconds. */
  tokenExpiration: number
  /** Failed logins before the account locks; 0 turns the lockout off. */
  maxLoginAttempts: number
  /** How long the lock holds, in milliseconds. */
  lockTime: number
  /**
   * Where the verification and reset tokens go: the project renders and sends the whole mail.
   * Without it, tokens are printed in development only, and outside development none is minted.
   */
  email?: {
    send: (message: { to: string; kind: 'verification' | 'reset'; token: string; user: Row }) => Promise<void>
  }
  /** The context every step of first registration reads, built by the project's own code from the request. */
  context?: (request: Request) => Promise<Record<string, unknown>> | Record<string, unknown>
  /**
   * The address a request came from, as the project's server saw it; mithaq reads no header for it.
   * `login`, `forgot-password` and `reset-password` are rate limited by it; `null` leaves a request uncounted.
   */
  ip: (request: Request) => string | null | undefined | Promise<string | null | undefined>
}

/** The store local auth reads its kayan through: the drizzle adapter, which declares `sql`. */
export type LocalAuthTarget = {
  readonly sql: 'drizzle'
  db: Db
  tables: Record<string, Record<string, SQLWrapper>>
}

// A declaration with neither member is a store that lied about what it is.
export const isLocalAuthTarget = <T extends { readonly sql?: 'drizzle' }>(
  target: T,
): target is T & LocalAuthTarget => target.sql === 'drizzle' && 'db' in target && 'tables' in target
export type Writes = Record<string, { operations: { create(data: Row): Promise<Row> } }>
type Session = { id: string; createdAt: string; expiresAt: string }
type Token<Collection extends string = string> = { id: unknown; sid: string; collection: Collection }

type PublicLocalUser<User extends Row> = Omit<User, ProtectedLocalField>
export type LocalAuthActor<
  KayanName extends string = string,
  User extends Row = Row,
> = PublicLocalUser<User> & {
  kayan: KayanName
  strategy: 'local'
  collection: KayanName
  /** The keys the build's access target resolved for this actor, never a column of this kayan's row. */
  permissions?: '*' | readonly string[]
  /** The role slugs the access target resolved in the tenant the actor's row names. */
  roles?: readonly string[]
  user: PublicLocalUser<User>
}

// Compared by identity: a callback could answer `false` at build and `true` later.
const denied = neverRead

// Only the administrator sets `_verified`; a write of `false` is admitted from anyone,
// because it only ever closes an account.
const verifiedWrite = ({ user, siblingData }: { user?: unknown; siblingData?: Record<string, unknown> }) =>
  isAdminActor(user) || siblingData?._verified === false

// A field callback here would drop the value the hash step or the mint wrote
// when the runner asks it again at the store step.
const application = { create: 'application', update: 'application' } as const
const closed = { read: denied }

/**
 * The fields a kayan carrying `local()` spreads beside `defaultFields`. Every one but `email`
 * and `_verified` is closed on read and supplied by the provider alone.
 */
export const localAuthFields = {
  email: { kind: 'email', rules: { required: true, unique: true, lowercase: true, trim: true } },
  hash: { kind: 'text', access: closed, rules: { required: true, providedBy: application } },
  salt: { kind: 'text', access: closed, rules: { required: true, providedBy: application } },
  sessions: { kind: 'text', access: closed, rules: { providedBy: application } },
  loginAttempts: { kind: 'number', access: closed, rules: { defaultValue: 0, providedBy: application } },
  lockUntil: { kind: 'datetime', access: closed, rules: { providedBy: application } },
  resetPasswordToken: { kind: 'text', access: closed, rules: { providedBy: application } },
  resetPasswordAttempts: { kind: 'number', access: closed, rules: { defaultValue: 0, providedBy: application } },
  resetPasswordExpiration: { kind: 'datetime', access: closed, rules: { providedBy: application } },
  _verified: { kind: 'checkbox', access: { create: verifiedWrite, update: verifiedWrite }, rules: { defaultValue: false } },
  _verificationToken: { kind: 'text', access: closed, rules: { providedBy: application } },
} as const satisfies Record<string, Field>

type Shipped = typeof localAuthFields
/** The fields `localAuthFields` closes on read, which a response never carries. */
export type ProtectedLocalField = { [Name in keyof Shipped]: Shipped[Name] extends { access: { read: unknown } } ? Name : never }[keyof Shipped]

const requiredFields = Object.keys(localAuthFields) as (keyof Shipped)[]
// Read once at load, so a project that reassigns a key of the exported value
// cannot move what the build compares against.
const shippedAccess = requiredFields.flatMap((name) =>
  Object.entries((localAuthFields[name] as { access?: Record<string, unknown> }).access ?? {}).map(([operation, callback]) => ({ name, operation, callback })),
)
const protectedFields: readonly string[] = shippedAccess.filter(({ operation }) => operation === 'read').map(({ name }) => name)
/** The columns the provider supplies, read once at load for the reason `shippedAccess` is. */
const suppliedFields = requiredFields.filter((name) => providerOf(localAuthFields[name], 'create') === 'application')

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })

// The `{ code, message }` body every other refusal of the app has.
const refusal = (status: keyof typeof codes, message: string, headers?: Record<string, string>) =>
  json({ code: codes[status], message }, { status, ...(headers && { headers }) })

const parseCookies = (headers: Headers) => {
  const map = new Map<string, string>()
  for (const pair of (headers.get('cookie') ?? '').split(/; */)) {
    const splitAt = pair.indexOf('=')
    try {
      if (splitAt > 0) map.set(pair.slice(0, splitAt), decodeURIComponent(pair.slice(splitAt + 1)))
    } catch {
      continue
    }
  }
  return map
}

const cookie = (name: string, value: string, maxAge: number, secure: boolean) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`

// Never an empty key, which anyone could sign with. WebCrypto on Node already
// refuses one; this says so on every runtime.
const keyOf = (secret: string) => {
  if (!secret) throw new Error('[mithaq local auth] No secret to sign or verify with.')
  return new TextEncoder().encode(secret)
}
const sign = <Collection extends string>(secret: string, token: Token<Collection>, maxAge: number) =>
  new SignJWT({ collection: token.collection, id: token.id as never, sid: token.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(keyOf(secret))

const verify = async (secret: string, signed: string): Promise<Token | null> => {
  try {
    const { payload } = await jwtVerify(signed, keyOf(secret), { algorithms: ['HS256'] })
    return payload.id !== undefined && payload.id !== null && typeof payload.sid === 'string' && typeof payload.collection === 'string'
      ? { collection: payload.collection, id: payload.id, sid: payload.sid }
      : null
  } catch {
    return null
  }
}

// OWASP's minimum for scrypt. It needs 128 MiB, past Node's 32 MiB default
// `maxmem`, so the ceiling is twice that and a stored hash asking for more fails.
const cost = { N: 2 ** 17, r: 8, p: 1 }
const maxmem = 256 * 1024 * 1024
/** A hash stored before the parameters were: Node's defaults. */
const legacyCost = { N: 16384, r: 8, p: 1 }

// Only two costs are read back: `p` costs time and almost no memory, so a stored
// `scrypt$524288$2$524288$` would hold a thread for a day. Any other set never matches.
const costOf = (stored: string) => {
  const [tag, N, r, p, key] = stored.split('$')
  if (tag !== 'scrypt' || key === undefined) return { cost: legacyCost, key: stored }
  const named = [cost, legacyCost].find((known) => `${N}$${r}$${p}` === `${known.N}$${known.r}$${known.p}`)
  return named ? { cost: named, key } : { cost, key: '' }
}

const saltAndHash = async (password: string) => {
  const salt = randomBytes(16).toString('base64url')
  const key = await scrypt(password, salt, { ...cost, maxmem })
  return { salt, hash: `scrypt$${cost.N}$${cost.r}$${cost.p}$${key.toString('base64url')}` }
}

// The rehash runs whether or not the password matches, so a wrong password for an
// older hash takes as long as one for a current hash.
const checkPassword = async (password: string, salt: string, hash: string) => {
  const stored = costOf(hash)
  const current = stored.cost === cost
  const [checked, upgrade] = await Promise.all([
    scrypt(password, salt, { ...stored.cost, maxmem }),
    current ? null : saltAndHash(password),
  ])
  const key = Buffer.from(stored.key, 'base64url')
  return { matched: key.length === checked.length && timingSafeEqual(key, checked), upgrade }
}

// Scrypt runs for an unknown address too, so the time an answer takes does not
// separate a known address from an unknown one.
const absentSalt = 'mithaq-local-auth-absent-account'
const absentHash = `scrypt$${cost.N}$${cost.r}$${cost.p}$mithaq-local-auth-absent-account`

// Reset messages one address gets per token hour. The lockout columns are left alone:
// writing them from `forgot-password` would let anyone lock an owner out by asking for resets.
const maxResets = 3

// Counted before the body is read or a row looked up, so an unknown address and a
// wrong password spend the same count, and the 429 comes before scrypt runs.
const rateLimit = { max: 10, window: 60_000, entries: 10_000 }
const limitedPaths = new Set(['login', 'forgot-password', 'reset-password'])

const freshToken = () => randomBytes(20).toString('hex')

const storedSessions = (row: Row): Session[] => {
  if (typeof row.sessions !== 'string') return []
  try {
    const sessions = JSON.parse(row.sessions) as unknown
    return Array.isArray(sessions) ? sessions as Session[] : []
  } catch {
    return []
  }
}
const sessionsOf = (row: Row): Session[] =>
  storedSessions(row).filter((session) => new Date(session.expiresAt).getTime() > Date.now())

const clean = (row: Row) =>
  Object.fromEntries(Object.entries(row).filter(([name]) => !protectedFields.includes(name)))

const asDate = (value: unknown) => (value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null)

const locked = (until: unknown) => {
  const date = asDate(until)
  return !!date && Number.isFinite(date.getTime()) && date.getTime() > Date.now()
}

// `clean(row)`, so `send` never sees the hash, the salt or the other token. Awaited
// inside the transaction that wrote the token, so a `send` that throws rolls it back.
const hand = async (
  options: Pick<LocalAuthOptions, 'email' | 'development'>,
  kind: 'verification' | 'reset',
  email: string,
  token: string,
  user: Row,
) => {
  if (options.email) return options.email.send({ to: email, kind, token, user: clean(user) })
  // Development only, so no token reaches a production log.
  if (!options.development) throw new Error(`[mithaq local auth] A ${kind} token has nowhere to go: no local({ email }), and not development.`)
  console.log(`[mithaq local auth] ${kind} token for "${email}": ${token}`)
  console.warn(
    '[mithaq local auth] Email attempted without being configured.'
    + ` Pass local({ email }).send to be handed the ${kind} token instead of printing it.`,
  )
}

// Outside development with no `email`, no verification or reset token is minted at all.
const mails = (options: Pick<LocalAuthOptions, 'email' | 'development'>) => !!options.email || !!options.development

const optionsOf = (kayan: ResolvedKayan) => (kayan.auth as unknown as { options: LocalAuthOptions }).options

/** Whether local auth signs nothing: no secret, and not development (`withoutSecret`). */
const unsignedOf = (options: LocalAuthOptions) => options.secret === undefined && !options.development

// A ceiling, so no caller hands scrypt a body of any size.
const passwordLength = { min: 8, max: 1024 }
const passwordRefusal = `A password of ${passwordLength.min} to ${passwordLength.max} characters is required.`
const isPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= passwordLength.min && value.length <= passwordLength.max

// The `password` key is taken off the value and checked here; the rest goes to the
// derived shape, which stays strict.
const withPassword = (shape: StandardSchemaV1, required: boolean): StandardSchemaV1<Record<string, unknown> & { password?: string }> => ({
  '~standard': {
    version: 1,
    vendor: shape['~standard'].vendor,
    validate: async (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return shape['~standard'].validate(value) as never
      const { password, ...rest } = value as Record<string, unknown>
      const own = password === undefined ? !required : isPassword(password)
      const result = await shape['~standard'].validate(rest)
      const issues = [...(own ? [] : [{ message: passwordRefusal, path: ['password'] }]), ...(result.issues ?? [])]
      if (issues.length) return { issues }
      return { value: { ...(result as { value: object }).value, ...(password === undefined ? {} : { password }) } as never }
    },
  },
})

// The key is deleted, so no later step, `send` or audit entry is handed the plaintext.
// It runs after the parse and the runner's field access.
const hashPassword: WriteStep = async (ctx) => {
  // Without a secret no account is made, whoever asks, and the refusal comes before scrypt runs.
  // An update still runs, so a super admin can verify a waiting account.
  const options = optionsOf(ctx.kayan)
  if (!ctx.dataBefore && unsignedOf(options)) {
    throw refused({ message: String(options.withoutSecret), key: 'error.forbidden.local_auth_off' })
  }
  const { password, ...data } = ctx.data
  return { ...ctx, data: typeof password === 'string' ? { ...data, ...(await saltAndHash(password)) } : data }
}

// A step is handed the runner's wrapped store, so every open entry is asked; at
// depth 1 inside first-register the only one is that entry.
const registeringFirst = (ctx: Parameters<WriteStep>[0]) =>
  ctx.context.depth === 1 && [...(running.getStore()?.transactions?.values() ?? [])].some((open) => firstRegisters.has(open))

// A create is forced unverified unless the administrator sent it verified; an update
// that moves the address unverifies it. Minted after the parse, so no caller picks a token.
const mintVerification: WriteStep = (ctx) => {
  const before = ctx.dataBefore
  const moved = !!before && 'email' in ctx.data && ctx.data.email !== before.email
  if (before && !moved) {
    return ctx.data._verified === true && before._verified !== true ? { ...ctx, data: { ...ctx.data, _verificationToken: null } } : ctx
  }
  // First-register's own create is verified once written, so it is minted nothing.
  if (!before && (ctx.data._verified === true || registeringFirst(ctx))) return ctx
  // With no way to hand a token over, none is minted and an administrator verifies the account.
  const fresh = { ...ctx.data, _verified: false, _verificationToken: mails(optionsOf(ctx.kayan)) ? freshToken() : null }
  // A moved address takes the old one's reset link and sessions with it, or the
  // link would still reset the password and the cookies come back once verified.
  return { ...ctx, data: moved ? { ...fresh, resetPasswordToken: null, resetPasswordExpiration: null, sessions: '[]' } : fresh }
}

// Inside the operation's transaction, so a `send` that throws rolls the write back.
const sendVerification: WriteStep = async (ctx) => {
  const token = ctx.data._verificationToken
  if (typeof token === 'string' && token !== ctx.dataBefore?._verificationToken) {
    await hand(optionsOf(ctx.kayan), 'verification', String(ctx.data.email), token, ctx.data)
  }
  return ctx
}

// `buildAsas` refuses a kayan holding these steps without `local()`, rather than
// letting the handover print every token it is given.
export const holdsVerificationSteps = (kayan: ResolvedKayan) =>
  Object.values(kayan.operations).some((operation) =>
    [operation.steps, operation.beforeTransaction, operation.afterSteps, operation.afterCommit]
      .some((list) => list.some((step) => step === mintVerification || step === sendVerification)))

/**
 * The `create` and `update` a kayan carrying `local()` spreads over `defaultOperations`.
 * A kayan adding a step writes the list around them: `[...localAuthOperations.create.steps, notify]`.
 */
export const localAuthOperations = {
  create: {
    input: ({ create }: DerivedShapes) => withPassword(create, true),
    steps: [hashPassword, mintVerification, insert, sendVerification],
  },
  update: {
    input: ({ update: shape }: DerivedShapes) => withPassword(shape, false),
    steps: [hashPassword, mintVerification, update, sendVerification],
  },
} satisfies Operations

/** The local email-and-password strategy: sessions on the user row, and a signed cookie naming one. */
export const localAuthStrategy = <Name extends string = string>({
  options,
  kayan: resolved,
  target,
  writes,
  projectUser,
  permissions = { kayan: [], can: async () => ({ allowed: false, operations: {} }), canAccessAdmin: async () => false, screens: async () => [] },
  assigned,
  onError,
}: {
  options: LocalAuthOptions
  kayan: ResolvedKayan
  target: LocalAuthTarget
  writes: Writes
  /** What a response carries of a row this actor reads; required, since an identity would hand every field to every caller. */
  projectUser: (row: Row, actor: LocalAuthActor<Name>) => Promise<Row>
  permissions?: LocalAuthPermissions
  assigned?: AssignedResolver
  /** Handed an access target that failed to answer, and a reset token `forgot-password` could not hand over. */
  onError: (error: unknown) => void
}): AuthStrategy<LocalAuthActor<Name>> => {
  if (typeof projectUser !== 'function') {
    throw new Error('localAuthStrategy({ projectUser }) is required. Pass the projection buildAsas passes, the kayan\'s own field read access, so a response carries only what its reader may read.')
  }
  const refuse = (what: string) => {
    throw new Error(`kayan "${resolved.name}" carries auth: local(...) and ${what}`)
  }
  for (const field of requiredFields) {
    if (!resolved.fields[field]) {
      refuse(
        `needs field "${field}".`
        + (field === 'email' && options.email
          ? ' local({ email }).send is handed that field as the address, so a kayan without it has nowhere to send a token.'
          : '')
        + ' Spread ...localAuthFields into its fields.',
      )
    }
  }
  // A field that forgot a shipped callback, or wrote one that may answer true, would
  // hand a secret to a response or let a caller verify an address it does not own.
  for (const { name, operation, callback } of shippedAccess) {
    const access = resolved.fields[name]!.access as Record<string, unknown> | undefined
    if (declaredFieldAccess(access?.[operation]) !== callback) {
      refuse(
        `its field "${name}" is ${operation === 'read' ? 'readable' : `writable on ${operation}`}. Write ${name}: localAuthFields.${name},`
        + ' or spread ...localAuthFields into its fields, so its access is the shipped one.',
      )
    }
  }
  // Or a caller would choose its hash, its salt or its token.
  for (const name of suppliedFields) {
    for (const on of ['create', 'update'] as const) {
      if (providerOf(resolved.fields[name]!, on) !== 'application') {
        refuse(
          `its field "${name}" is supplied by a caller on ${on}. Write ${name}: localAuthFields.${name},`
          + ' or spread ...localAuthFields into its fields, so the provider alone writes it.',
        )
      }
    }
  }
  // Read by the store step each operation holds, not by its name, so a custom
  // operation that inserts or updates meets the rule too.
  const holdsShipped = (steps: readonly unknown[], seal: 'insert' | 'update') => {
    const store = steps.findIndex((step) => sealOf(step as WriteStep) === seal)
    const hashed = steps.indexOf(hashPassword)
    const mint = steps.indexOf(mintVerification)
    return hashed >= 0 && mint >= 0 && store > Math.max(hashed, mint) && steps.indexOf(sendVerification) > store
  }
  const lacks = (operation: string, list: 'create' | 'update') =>
    refuse(
      `its ${operation} lacks the shipped steps. Spread ...localAuthOperations into its operations,`
      + ` or write its ${operation} around ...localAuthOperations.${list}.steps, so the password is hashed and the token minted before the store step and handed over after it.`,
    )
  if (!holdsShipped(resolved.operations.create?.steps ?? [], 'insert')) lacks('create', 'create')
  for (const [operation, declaration] of Object.entries(resolved.operations)) {
    const seal = declaration.steps.map((step) => sealOf(step)).find((one) => one === 'insert' || one === 'update' || one === 'updateMany')
    if (!seal) continue
    const steps = seal === 'updateMany' ? resolved.operations.update?.steps ?? [] : declaration.steps
    if (!holdsShipped(steps, seal === 'insert' ? 'insert' : 'update')) lacks(operation, seal === 'insert' ? 'create' : 'update')
  }
  // No environment variable stands in for the secret. Only `development` signs
  // without one, under a secret no other process verifies.
  const { secret, withoutSecret } = options
  const unsigned = unsignedOf(options)
  if (unsigned && (typeof withoutSecret !== 'string' || !withoutSecret)) {
    throw new Error('local({ secret }) is required unless local({ development: true }) is set, or local({ withoutSecret }) names what local auth answers without one.')
  }
  if (secret !== undefined && (typeof secret !== 'string' || secret.length < 32)) {
    throw new Error('local({ secret }) signs every token and is a string of 32 characters at least.')
  }
  // Empty only when unsigned, and `keyOf` refuses an empty key.
  const signingSecret = secret ?? (options.development ? developmentSecret : '')
  if (unsigned) {
    onError(new Notice(`[mithaq local auth] kayan "${resolved.name}" has no local({ secret }), so every POST to /api/auth/local answers 503: ${withoutSecret}`))
  }
  // `typeof` admits NaN, which `Number(process.env.X)` answers for an unset variable:
  // a NaN `maxLoginAttempts` switches the lockout off.
  for (const [key, fallback] of [['tokenExpiration', 'defaultTokenExpiration'], ['maxLoginAttempts', 'defaultMaxLoginAttempts'], ['lockTime', 'defaultLockTime']] as const) {
    const value = options[key]
    if (!Number.isFinite(value) || value < 0) {
      const what = value === undefined ? 'is required' : `is ${String(value)}, which is not a finite number of 0 or more`
      throw new Error(`local({ ${key} }) ${what}. Pass ${fallback}, Payload's value, or a finite number of 0 or more of your own.`)
    }
  }
  if (typeof options.ip !== 'function') {
    throw new Error(
      'local({ ip }) is required. Pass the address your server saw for each request, which login, forgot-password and reset-password are rate limited by,'
      + ' or an ip that answers null for no rate limit.',
    )
  }
  if (options.email !== undefined && typeof options.email?.send !== 'function') {
    throw new Error('local({ email }) hands every token to its send, which must be a function.')
  }
  // Without `email`, no token is printed outside development and none is minted, so
  // the project is told once here what it switched off.
  if (!mails(options)) {
    onError(new Notice(
      `[mithaq local auth] kayan "${resolved.name}" has no local({ email }), so no verification or reset message is sent:`
      + ' a sign-up makes an account an administrator verifies, and forgot-password mints nothing. Pass local({ email }) to send them.',
    ))
  }
  const { tokenExpiration: maxAge, maxLoginAttempts, lockTime, ip } = options
  const secure = options.secureCookies ?? !options.development
  const name = 'local'
  const cookieName = `${name}-token`
  const windows = new Map<string, { count: number; ends: number }>()
  let uncounted = false
  /** Counts this request against its address, and answers the seconds to wait once it is past the limit. */
  const overLimit = async (request: Request) => {
    const address = await ip(request)
    if (address === null || address === undefined) {
      // Once, so an `ip` that always answers nothing does not switch the limit off without a word.
      if (!uncounted) {
        uncounted = true
        onError(new Notice(
          `[mithaq local auth] kayan "${resolved.name}": local({ ip }) answered no address for a request, so it was not rate limited.`
          + ' Requests it answers null or undefined for are never counted.',
        ))
      }
      return null
    }
    const now = Date.now()
    let held = windows.get(address)
    if (!held || held.ends <= now) {
      // Deleted and set again, so the map's first key is the oldest window.
      windows.delete(address)
      if (windows.size >= rateLimit.entries) {
        for (const [key, one] of windows) if (one.ends <= now) windows.delete(key)
        if (windows.size >= rateLimit.entries) windows.delete(windows.keys().next().value!)
      }
      held = { count: 0, ends: now + rateLimit.window }
      windows.set(address, held)
    }
    return ++held.count > rateLimit.max ? Math.ceil((held.ends - now) / 1000) : null
  }
  const table = target.tables[resolved.name]!
  // This provider reads through the store's client, so it writes the soft-delete
  // filter every managed read carries itself; every read of the row carries it.
  const alive = resolved.softDelete ? isNull(table[resolved.softDelete]!) : undefined
  const firstRow = (from: Db, match?: SQL) => {
    const rows = from.select().from(table)
    const where = match && alive ? and(match, alive) : match ?? alive
    return where ? rows.where(where).limit(1) : rows.limit(1)
  }
  const findBy = async (field: string, value: unknown) =>
    (await firstRow(target.db, eq(table[field]!, value)))[0] ?? null
  const anyRow = async () => (await firstRow(target.db)).length > 0
  // Read back under a write lock and changed in one transaction, so two logins, a
  // logout and a lockout never overwrite one another's columns.
  const mutate = async (id: unknown, change: (row: Row) => Row, inside?: (updated: Row) => Promise<void>) =>
    target.db.transaction(async (tx) => {
      const where = alive ? and(eq(table.id!, id), alive) : eq(table.id!, id)
      const [held] = await tx
        .update(table)
        .set({ sessions: table.sessions })
        .where(where)
        .returning()
      if (!held) return null
      const [updated] = await tx
        .update(table)
        .set(change(held))
        .where(where)
        .returning()
      if (updated && inside) await inside(updated)
      return updated ?? null
    })
  const mutateSessions = (id: unknown, change: (sessions: Session[]) => Session[]) =>
    mutate(id, (row) => ({ sessions: JSON.stringify(change(sessionsOf(row))) }))
  const actorOf = async (row: Row) => {
    const user = clean(row)
    const actor = { ...user, collection: resolved.name, strategy: name, kayan: resolved.name, user } as LocalAuthActor<Name>
    // A local account is no organization's member, so it is asked under the tenant its row's
    // bound field names, and under none where its kayan is shared. `permissions` and `roles` are
    // deleted, not set to `undefined`: present decides.
    delete (actor as { permissions?: unknown }).permissions
    delete (actor as { roles?: unknown }).roles
    const held = await resolveAssigned({ resolver: assigned, onError, tenant: resolved.tenant ? row[resolved.tenant] : undefined, member: row.id, actor })
    if (held !== undefined) {
      ;(actor as { permissions?: '*' | readonly string[] }).permissions = held.permissions
      ;(actor as { roles?: readonly string[] }).roles = held.roles
    }
    return markAuthActor(actor)
  }
  const publicUser = async (row: Row) => clean(await projectUser(row, await actorOf(row)))
  const startSession = async (row: Row) => {
    // Every cookie is issued here, so an unverified account gets none by any path.
    if (row._verified !== true) throw new Error(`The "${resolved.name}" row ${String(row.id)} is not verified, so no session starts for it.`)
    const session = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + maxAge * 1000).toISOString(),
    }
    const user = await mutateSessions(row.id, (sessions) => [...sessions, session])
    if (!user) throw new Error(`No "${resolved.name}" row with id ${String(row.id)} to update.`)
    return {
      header: cookie(
        cookieName,
        await sign(signingSecret, { collection: resolved.name, id: row.id, sid: session.id }, maxAge),
        maxAge,
        secure,
      ),
      user,
    }
  }
  const extractToken = (headers: Headers) => {
    const authorization = headers.get('authorization')
    if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length)
    if (authorization?.startsWith('JWT ')) return authorization.slice('JWT '.length)
    return parseCookies(headers).get(cookieName) ?? ''
  }
  // A read, never a write: a write transaction would lock the user row and serialise
  // that user's concurrent requests.
  const authenticate = async ({ headers }: { headers: Headers }) => {
    const token = await verify(signingSecret, extractToken(headers))
    if (!token || token.collection !== resolved.name) return { user: null }
    const row = await findBy('id', token.id)
    // An unverified row authenticates no one, whatever cookie names it.
    if (!row || row._verified !== true) return { user: null }
    if (!sessionsOf(row).some((session) => session.id === token.sid)) return { user: null }
    return { user: await actorOf(row) }
  }
  const bodyOf = async (request: Request) => {
    try {
      return await request.json() as Row
    } catch {
      return null
    }
  }
  // Two strings and nothing else of the body, so first-register never writes a key the caller chose.
  const credentials = (body: Row | null) =>
    body && typeof body.email === 'string' && isPassword(body.password)
      ? { email: body.email.toLowerCase().trim(), password: body.password }
      : null
  // An empty table holds no row to lock, so the table is locked: otherwise two concurrent
  // requests both read nothing and both make an account. The first account is verified here.
  const registerFirst = async (body: Row | null, extra?: Record<string, unknown>) => {
    const given = credentials(body)
    if (!given) return { error: refusal(400, `An email and a password of ${passwordLength.min} to ${passwordLength.max} characters are required.`) }
    // Held outside the transaction so it is drained only once that transaction commits.
    let open: Open | undefined
    const result = await target.db.transaction(async (tx) => {
      await tx.execute(sql`lock table ${table} in exclusive mode`)
      if ((await firstRow(tx)).length > 0) {
        return {
          error: refusal(403, `The "${resolved.name}" kayan already has a row, so first-register is closed. Log in with an account it holds instead.`),
        }
      }
      // Marked only here, past the empty read under the lock, so only this create skips the kayan's create access.
      open = { operation: `${resolved.name}.first-register`, tx }
      firstRegisters.add(open)
      const made = await running.run(
        {
          context: Object.freeze({ ...extra, chain: [], depth: 0, source: 'local' }),
          transactions: new Map([[target as unknown as Store, open]]),
          user: null,
        },
        () => writes[resolved.name]!.operations.create({ email: given.email, password: given.password }),
      )
      const [row] = await tx.update(table).set({ _verified: true }).where(eq(table.id!, made.id)).returning()
      return { row: row! }
    })
    if (open) await drain(open.afterCommit ?? [])
    return result
  }
  return {
    name,
    authenticate,
    async handler(request) {
      const path = new URL(request.url).pathname.replace(/^\/api\/auth\/local\/?/, '')
      const post = request.method === 'POST'
      const get = request.method === 'GET'
      // Without a secret every path that would log in, register, reset, verify, unlock or
      // log out is refused before it reads a body or a row.
      if (post && unsigned) return refusal(503, String(withoutSecret))
      if (post && limitedPaths.has(path)) {
        const wait = await overLimit(request)
        if (wait !== null) {
          return refusal(429, 'Too many requests. Try again later.', { 'retry-after': String(wait) })
        }
      }
      try {
        if (path === 'access' && get) {
          return json(await accessReport(permissions, (await authenticate({ headers: request.headers })).user))
        }
        if (path === 'init' && get) {
          return json({ initialized: await anyRow() })
        }
        if (path === 'first-register' && post) {
          const made = await registerFirst(await bodyOf(request), await options.context?.(request))
          if (made.error) return made.error
          // After the commit: it writes the same row, and the table lock would hold it off.
          const { header, user } = await startSession(made.row!)
          return json({ user: await publicUser(user) }, { status: 201, headers: { 'set-cookie': header } })
        }
        if (path === 'login' && post) {
          const body = await bodyOf(request)
          if (!body) return refusal(400, 'Request body must be valid JSON.')
          // Bounded before scrypt, and answered the same whether or not the address is held.
          if (!isPassword(body.password)) return refusal(400, passwordRefusal)
          const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : null
          const row = email ? await findBy('email', email) : null
          // The answer for a locked account names the lock, so login does say this address has an account.
          if (row && locked(row.lockUntil)) {
            return refusal(401, 'This account is locked. Try again later, or ask an administrator to unlock it.')
          }
          const { matched, upgrade } = await checkPassword(body.password, String(row?.salt ?? absentSalt), String(row?.hash ?? absentHash))
          const correct = !!row && matched
          if (!correct) {
            // A lock that has expired restarts the count at one. A limit of 0 never locks.
            if (row && maxLoginAttempts > 0) {
              await mutate(row.id, (current) => {
                const expired = current.lockUntil !== null && current.lockUntil !== undefined && !locked(current.lockUntil)
                if (expired) return { loginAttempts: 1, lockUntil: null }
                const attempts = Number(current.loginAttempts ?? 0) + 1
                return attempts >= maxLoginAttempts
                  ? { loginAttempts: attempts, lockUntil: new Date(Date.now() + lockTime) }
                  : { loginAttempts: attempts, lockUntil: null }
              })
            }
            return refusal(401, 'Invalid email or password.')
          }
          // Asked after the password, so nobody without it learns whether the account is verified.
          if (row._verified !== true) {
            const next = mails(options)
              ? 'This account is not verified. Follow the link in its verification message first.'
              : 'This account is not verified, and this app sends no verification message. Ask an administrator to verify it.'
            return refusal(403, next)
          }
          // An older hash is replaced, unless the password changed while this login ran.
          await mutate(row.id, (held) => ({ loginAttempts: 0, lockUntil: null, ...(upgrade && held.hash === row.hash ? upgrade : {}) }))
          const { header, user } = await startSession(row)
          return json({ user: await publicUser(user) }, { headers: { 'set-cookie': header } })
        }
        // Answered 200 either way, `{ user: null }` for nobody.
        if (path === 'me' && get) {
          const actor = (await authenticate({ headers: request.headers })).user
          return json({ user: actor ? await publicUser(actor.user) : null })
        }
        if (path === 'refresh-token' && post) {
          // One verify and one read: the session the cookie names must be one the row still holds.
          const token = await verify(signingSecret, extractToken(request.headers))
          if (!token || token.collection !== resolved.name) return json({ user: null }, { status: 401 })
          const row = await findBy('id', token.id)
          if (!row || row._verified !== true || !sessionsOf(row).some((session) => session.id === token.sid)) {
            return json({ user: null }, { status: 401 })
          }
          // The same session id, so a refresh never adds a session.
          const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString()
          const user = await mutateSessions(token.id, (sessions) =>
            sessions.map((session) => (session.id === token.sid ? { ...session, expiresAt } : session)))
          if (!user) return json({ user: null }, { status: 401 })
          const header = cookie(
            cookieName,
            await sign(signingSecret, { collection: resolved.name, id: token.id, sid: token.sid }, maxAge),
            maxAge,
            secure,
          )
          return json({ user: await publicUser(user) }, { headers: { 'set-cookie': header } })
        }
        if (path === 'logout' && post) {
          const token = await verify(signingSecret, extractToken(request.headers))
          // A marked row answers null here and keeps this session entry, which is unreachable
          // while it stays marked; the cookie is cleared and the answer is 200 either way.
          const row = token?.collection === resolved.name ? await findBy('id', token.id) : null
          if (row) await mutateSessions(row.id, (sessions) => sessions.filter((session) => session.id !== token!.sid))
          return json({ ok: true }, { headers: { 'set-cookie': cookie(cookieName, '', 0, secure) } })
        }
        // The same answer whether or not the address is held, so this endpoint never says who has an account.
        if (path === 'forgot-password' && post) {
          const body = await bodyOf(request)
          const email = body && typeof body.email === 'string' ? body.email.toLowerCase().trim() : null
          if (!email) return refusal(400, 'An email is required.')
          const row = await findBy('email', email)
          // With no way to hand a token over, a held address is answered exactly as an unknown one.
          if (row && mails(options)) {
            // Read, counted and written under the row's write lock, so a burst of requests
            // cannot each see the same count.
            let token: string | null = null
            try {
              await mutate(
                row.id,
                (held) => {
                  // A live token is handed over again rather than replaced, so a second request
                  // does not strand the first mail.
                  const live = asDate(held.resetPasswordExpiration)
                  const reused = typeof held.resetPasswordToken === 'string' && live && live.getTime() > Date.now()
                    ? held.resetPasswordToken
                    : null
                  // The window ends with the token it counted.
                  const attempts = (reused ? Number(held.resetPasswordAttempts ?? 0) : 0) + 1
                  // Past the limit only the count is written, and the answer is the one every call gets.
                  if (attempts > maxResets) return { resetPasswordAttempts: attempts }
                  token = reused ?? freshToken()
                  return {
                    resetPasswordToken: token,
                    resetPasswordAttempts: attempts,
                    // Only a minted token gets an hour: sliding a reused token's hour forward on every
                    // request would let one caller hold one secret open for as long as it keeps asking.
                    ...(reused ? {} : { resetPasswordExpiration: new Date(Date.now() + 3600000) }),
                  }
                },
                async (updated) => {
                  if (token) await hand(options, 'reset', email, token, updated)
                },
              )
            } catch (failure) {
              // Swallowed: a 500 here and a 200 for an unknown address would be an account-existence
              // oracle. The project's `onError` is told.
              onError(new Error(
                `[mithaq local auth] forgot-password could not hand the reset token for row "${row.id}" over, so nothing was written.`,
                { cause: failure },
              ))
            }
          }
          // Timing still tells a held address from an unknown one; closing that needs a
          // constant-time path or a queue.
          return json({
            message: mails(options)
              ? 'If that email has an account, a reset token has been issued for it.'
              : 'This app sends no reset message, so no reset token was issued. Ask an administrator to set a new password.',
          })
        }
        if (path === 'reset-password' && post) {
          const body = await bodyOf(request)
          if (!body || typeof body.token !== 'string' || !isPassword(body.password)) {
            return refusal(400, `A token and a password of ${passwordLength.min} to ${passwordLength.max} characters are required.`)
          }
          const row = await findBy('resetPasswordToken', body.token)
          const expires = asDate(row?.resetPasswordExpiration)
          if (!row || !expires || expires.getTime() <= Date.now()) {
            return refusal(400, 'That reset token is unknown or expired.')
          }
          const { hash, salt } = await saltAndHash(body.password)
          const updated = await mutate(row.id, () => ({
            hash,
            salt,
            resetPasswordToken: null,
            resetPasswordExpiration: null,
            loginAttempts: 0,
            lockUntil: null,
          }))
          if (!updated) return refusal(400, 'That reset token is unknown or expired.')
          // A reset keeps `_verified` as it was, so an unverified account still signs in nowhere.
          if (updated._verified !== true) return json({ user: null })
          const { header, user } = await startSession(updated)
          return json({ user: await publicUser(user) }, { headers: { 'set-cookie': header } })
        }
        if (path === 'unlock' && post) {
          const actor = (await authenticate({ headers: request.headers })).user
          if (!(await permissions.canAccessAdmin(actor))) {
            return refusal(403, 'Forbidden: unlock is for an administrator.')
          }
          const body = await bodyOf(request)
          const email = body && typeof body.email === 'string' ? body.email.toLowerCase().trim() : null
          if (!email) return refusal(400, 'An email is required.')
          const row = await findBy('email', email)
          if (!row) return refusal(404, 'No account with that email.')
          await mutate(row.id, () => ({ loginAttempts: 0, lockUntil: null }))
          return json({ ok: true })
        }
        if (path.startsWith('verify/') && post) {
          const token = decodeURIComponent(path.slice('verify/'.length))
          const row = token ? await findBy('_verificationToken', token) : null
          if (!row) return refusal(400, 'That verification token is unknown.')
          await mutate(row.id, () => ({ _verified: true, _verificationToken: null }))
          return json({ ok: true })
        }
      } catch (error) {
        error = retryConflict(error)
        if (error instanceof AsasError && error.key === 'error.conflict.retry') return json({ code: codes[409], message: error.message, data: { key: error.key, params: error.params } }, { status: 409 })
        // The driver detail may name another account, so other conflicts keep the existing refusal.
        if (error instanceof AsasError && error.status === 409) {
          return refusal(409, 'Email already exists.')
        }
        throw error
      }
      return refusal(404, 'Not found.')
    },
  }
}

/** The local email-and-password provider as a kayan declares it: `auth: local({ ... })`. */
export const local = (options: LocalAuthOptions) => ({ provider: 'local' as const, options })
