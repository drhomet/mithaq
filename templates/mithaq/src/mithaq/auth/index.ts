import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { runWithAdapter } from '@better-auth/core/context'
import { BASE_ERROR_CODES, betterAuth as betterAuthServer, getCurrentAdapter } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthEndpoint, createAuthMiddleware, formCsrfMiddleware, getSessionFromCtx } from 'better-auth/api'
import { admin, oneTimeToken, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements as adminStatements, userAc } from 'better-auth/plugins/admin/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'
import { holdsPermission, requestOrganization, type Where } from 'mithaq'
import { sql } from 'mithaq/drizzle'
// A module of its own so a screen can list the roles without loading the provider.
import { platformRoles } from './platform-roles.ts'

export { platformRoles }

// Set only by the platform app, which wraps every request it serves in `asPlatform`. Nothing a
// client sends sets it.
const platformRequest = new AsyncLocalStorage<true>()
/** Runs `run` as a request the platform app serves. Only the platform app calls it. */
export const asPlatform = <Result>(run: () => Result): Result => platformRequest.run(true, run)
/**
 * Whether the current request is the platform app's, which picks the platform's Better Auth
 * instance and its role set.
 */
export const onPlatform = () => platformRequest.getStore() === true

/**
 * Whether this project serves the platform console, `apps/asas-platform`, as `generate.screens`
 * in `src/mithaq.ts` says too. Without it no boot asks for PLATFORM_URL, and nobody is linked or
 * sent to a platform app that does not exist.
 */
// add-on: platform
export const platformApp: boolean = true
// end add-on: platform
// without add-on: platform
// export const platformApp: boolean = false
// end without add-on: platform

// A production boot needs all three: the fallbacks below are for development only, and Better
// Auth's refusal of its default secret never fires for the platform, whose secret is derived here.
const production = process.env.NODE_ENV === 'production'
const secret = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET
if (production && ((platformApp && !process.env.PLATFORM_URL) || !process.env.BETTER_AUTH_URL || !secret)) {
  throw new Error(platformApp
    ? 'A production boot needs PLATFORM_URL and BETTER_AUTH_URL, where the two apps are served, and BETTER_AUTH_SECRET, which both sign their sessions under. Set all three.'
    : 'A production boot needs BETTER_AUTH_URL, where the app is served, and BETTER_AUTH_SECRET, which signs its sessions. Set both.')
}

// `NODE_ENV` is unset when a deploy runs plain `node` or `bun`, so the check above never runs and
// both apps would boot on a public secret. Refuse on a non-local host with no secret instead.
const isLocalHost = (url: string): boolean => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
const remoteWithNoSecret = process.env.BETTER_AUTH_SECRET
  ? undefined
  : [process.env.PLATFORM_URL, process.env.BETTER_AUTH_URL].filter((url): url is string => typeof url === 'string').find((url) => !isLocalHost(url))
if (remoteWithNoSecret) {
  throw new Error(`BETTER_AUTH_SECRET must be set: ${remoteWithNoSecret} is not localhost, and this file's own secret falls back to a public default without it.`)
}

/**
 * Where the platform app is served, and the platform instance's `baseURL`. Outside production, or
 * where no platform app is served, it falls back to the `vite dev` port, and nothing links there.
 */
export const platformURL = process.env.PLATFORM_URL ?? 'http://localhost:5174'

// The platform's first administrator is made by first-register, which asks for the `SETUP_CODE`
// the deploy set, so nobody who merely reaches a new deploy first becomes its administrator. Only
// `vite dev` on this machine skips it: a deploy run with plain `node` sets no `NODE_ENV`, and an
// unset `PLATFORM_URL` falls back to localhost. The code is the one bar, so a value short enough to
// guess is no code at all.
const setupCode = (process.env.SETUP_CODE?.length ?? 0) >= 32 ? process.env.SETUP_CODE : undefined
const setupCodeState: 'none' | 'required' | 'unset' = process.env.NODE_ENV === 'development' && isLocalHost(platformURL) ? 'none' : setupCode ? 'required' : 'unset'
// Mirrors the tenant's `rateLimit.enabled`, read off the platform's own address.
const platformLimited = production || !isLocalHost(platformURL)
// Digests, so both sides are always 32 bytes and `timingSafeEqual` neither throws on nor answers
// sooner for a code of another length.
const digest = (text: string) => createHash('sha256').update(text).digest()
const isSetupCode = (given: unknown) => typeof given === 'string' && setupCode !== undefined && timingSafeEqual(digest(given), digest(setupCode))
// Set only around the one `create-user` call first-register makes once it found no platform
// administrator under its lock, which is the only call with no caller that may write a role.
const firstRegistering = new AsyncLocalStorage<true>()
// Without TRUSTED_IP_HEADER, Better Auth keys its limit on an `x-forwarded-for` the caller writes,
// so first-register also keeps one window that every caller shares.
// ponytail: process-local, and a flood holds setup off for everyone until it stops; set
// TRUSTED_IP_HEADER for per-address limits alone.
const sharedTries: number[] = []
const overSharedLimit = () => {
  const now = Date.now()
  while (sharedTries.length && now - sharedTries[0]! >= 60_000) sharedTries.shift()
  return sharedTries.length >= 10 || (sharedTries.push(now), false)
}

/**
 * Where the tenant app is served, the tenant instance's `baseURL` and the target of an
 * impersonation hand-off. Outside production it falls back to the `vite dev` port.
 */
export const tenantURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:5173'

/**
 * The origins the platform instance trusts beside its own `baseURL`: the `vite dev` and `vite
 * preview` ports, outside production only.
 */
export const platformOrigins = production ? [] : ['http://localhost:4174', 'http://localhost:5174']

// Derived from the deployment secret and never equal to it, so a cookie one app signed fails
// verification in the other. The apps share one session table and never a session; a session
// crosses only through the one-time hand-off.
const platformSecret = createHmac('sha256', secret ?? 'mithaq-development-only').update('mithaq-platform-session').digest('base64url')

/** The platform's session cookie name, `mithaq-platform.session_token`, beside the tenant's `better-auth.session_token`. */
export const platformCookiePrefix = 'mithaq-platform'

/**
 * Better Auth's own actions, which no kayan declares; `buildAsas` adds them to the catalog.
 *
 * `member` and `user` are each a provider resource and a generated kayan, so one key opens both
 * doors. They never meet while no auth kayan carries a tenant field. They cannot be renamed: the
 * provider's routes ask under these exact names.
 */
export const providerStatements = { ...defaultStatements, ...adminStatements }


// `APIError` makes the refusal the provider's own 403 rather than the 500 an unrecognised throw
// becomes.
const gate = (key: string) => async ({ organization }: { organization?: { [key: string]: unknown; id?: unknown } } = {}) => {
  sameOrganization(organization)
  if (holdsPermission(key)) return
  throw new APIError('FORBIDDEN', { message: `You do not hold the permission "${key}".` })
}

// `holdsPermission` answers with the caller's keys in their active organization, but a provider
// route that takes an `organizationId` in its body acts on that one. Refuse any other, or keys held
// in one organization would open another. Outside `asas.handler` nothing is resolved and the
// provider's own roles decide alone.
const sameOrganization = (organization?: { [key: string]: unknown; id?: unknown }) => {
  const active = requestOrganization()
  if (active === undefined || typeof organization?.id !== 'string' || organization.id === active) return
  throw new APIError('FORBIDDEN', { message: 'Your keys are your active organization\'s, and this action is in another. Make it the active organization first.' })
}

// The provider refuses only an `owner` invite from a non-owner, so without this an inviter could
// hand out `admin` with no `member.update`.
const invitedAs = (role: string) => {
  if (role.split(',').every((name) => name === 'member') || holdsPermission('member.update')) return
  throw new APIError('FORBIDDEN', { message: 'An invitation as anything but a member needs the permission "member.update".' })
}

// The provider checks an invitation's role names trimmed but stores the value as written, and its
// owner checks match untrimmed, so `member, owner` could slip past an inviter who may not invite an
// owner. Refuse whitespace and empty names.
const exactRoles = (role: unknown) => {
  if (typeof role === 'string' && role.split(',').every((name) => name !== '' && name === name.trim())) return
  throw new APIError('BAD_REQUEST', {
    code: 'error.invalid.member_role',
    message: `A role value holds exact role names, comma-joined, with no whitespace around a name and no empty one: ${JSON.stringify(role)}.`,
  })
}

// Both conditions are asked because either alone fails open: a deploy run with plain `node` never
// sets `NODE_ENV`, and an unset `BETTER_AUTH_URL` falls back to `localhost`.
const logsLinks = process.env.NODE_ENV === 'development' && isLocalHost(tenantURL)

// Development only: the link goes to the server's log. Anywhere else nothing is sent and nothing is
// logged, so the inviter hands the link over themselves.
const sendInvitationEmail = async ({ id, email }: { id: string; email: string }) => {
  console.log(`[asas auth] Invitation link for "${email}": ${new URL(`/auth/accept-invitation?id=${encodeURIComponent(id)}`, tenantURL).href}`)
}

/**
 * The provider's organization limits, each set here so none is a silent default of the provider's:
 * left unset, anyone signed in founds organizations without end, and an organization stops taking
 * members and listing them at 100.
 *
 * - `allowUserToCreateOrganization`: sign-up founds each person's own organization.
 * - `organizationLimit`: a person who belongs to this many organizations, however they joined, founds
 *   no more, so one account cannot fill the database with organizations. An invitation still adds
 *   them to more.
 * - `membershipLimit`: the members one organization holds, and the most `list-members` answers
 *   unasked; the Members page pages past it.
 * - `invitationLimit`: the pending invitations one organization holds.
 */
export const organizationLimits = {
  allowUserToCreateOrganization: true,
  organizationLimit: 5,
  membershipLimit: 10_000,
  invitationLimit: 1_000,
}

// These options do not depend on this project's vocabulary, so `mithaq generate auth` reads the
// same schema the runtime builds.
//
// `beforeAddMember` is deliberately not gated. `addMember` has no HTTP route, and its other firing
// is inside `createOrganization`, where the creator is in no organization yet and holds no key, so
// gating it would make creating an organization impossible. `member.create` is left to the
// provider's static roles.
const organizationOptions = {
  ...organizationLimits,
  dynamicAccessControl: { enabled: true as const },
  // An organization that was ever used holds rows that cannot all be removed (an audit log,
  // settings, its last administrator), and every tenant key is `restrict`, so deletion is off over
  // HTTP.
  disableOrganizationDeletion: true,
  // The provider compares the invited address with the signed-in one on every invitation route.
  // `requireEmailVerificationOnInvitation` stays unset rather than `false`, so the provider asks
  // for a verified address only if invitation ids become guessable. The template sends no mail that
  // would verify an address, so asking for one would leave every invitation unanswerable.
  ...(logsLinks ? { sendInvitationEmail } : {}),
  organizationHooks: {
    beforeUpdateOrganization: gate('organization.update'),
    beforeRemoveMember: gate('member.delete'),
    beforeUpdateMemberRole: async ({ newRole, organization }: { newRole: string; organization: { id: string } }) => {
      await gate('member.update')({ organization })
      exactRoles(newRole)
    },
    beforeCreateInvitation: async ({ invitation, organization }: { invitation: { role: string }; organization: { id: string } }) => {
      await gate('invitation.create')({ organization })
      exactRoles(invitation.role)
      invitedAs(invitation.role)
    },
    beforeAcceptInvitation: async ({ invitation }: { invitation: { role: string } }) => exactRoles(invitation.role),
    beforeCancelInvitation: gate('invitation.cancel'),
  },
}

// `'*'` is the plugin's `adminAc`, every action but `impersonate-admins`, so no platform
// administrator mimics another.
const adminAccess = createAccessControl(adminStatements)
const adminGrant = (permissions: '*' | readonly string[]) => {
  if (permissions === '*') return adminAc
  const grant: Record<string, string[]> = {}
  for (const key of permissions) {
    const [resource, action] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)]
    const actions: readonly string[] | undefined = Object.hasOwn(adminStatements, resource) ? adminStatements[resource as keyof typeof adminStatements] : undefined
    if (actions?.includes(action)) (grant[resource] ??= []).push(action)
  }
  return adminAccess.newRole(grant as Parameters<typeof adminAccess.newRole>[0])
}

// `adminRoles`, not `adminUserIds`: an id list in code is a secret in the repository that no audit
// trail records a change to, while a column is written like any other row and can be taken back
// without a deploy.
//
// `roles` is the platform roles and `user` only. The plugin's gate reads `roles`, so spreading its
// `defaultRoles` would make `user.role = 'admin'` a platform administrator this project never
// declared. `user` is the plugin's `userAc`, which holds no action, and is here because `set-role`
// refuses a name `roles` does not hold.
//
// `adminRoles` is every platform role. None holds `impersonate-admins`, so no staff member can be
// impersonated. A platform role holds nothing inside a tenant.
const adminOptions = {
  adminRoles: Object.keys(platformRoles),
  roles: {
    ...Object.fromEntries(Object.entries(platformRoles).map(([slug, role]) => [slug, adminGrant(role.permissions)])),
    user: userAc,
  },
}

// The platform screen's actions are the admin plugin's own routes, not this project's operations,
// so the audit step never sees them. Every `/admin/` route is audited here: one JSON line per
// successful call naming the actor, the real person behind an impersonated session, the route, the
// target and the role, never a password or other body field. The template keeps no audit table, so
// operators must retain this output.
//
// The caller is read before the route runs because stopping an impersonation deletes the session
// that made the request.
const audited = (path: string) => path.startsWith('/admin/') || path === '/sign-out'
type Caller = { user: { id: string; role?: unknown }; session: Record<string, unknown> } | null
const callers = new WeakMap<object, Caller>()
/** The role a call writes, on `set-role` and `create-user` as `role` and on `update-user` and `create-user` as `data.role`. */
const roleOf = (body: { role?: unknown; data?: { role?: unknown } }) => body.role ?? body.data?.role
/** Whether a `user.role` value names a role `test` admits, read as the plugin reads it, comma-separated. */
const holdsRole = (role: unknown, test: (one: string) => boolean) => typeof role === 'string' && role.split(',').some((one) => test(one.trim()))
/** The key this project asks for each of the provider's role-writing routes. */
const roleWrites = new Map([
  ['/organization/create-role', 'ac.create'],
  ['/organization/update-role', 'ac.update'],
  ['/organization/delete-role', 'ac.delete'],
])
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]
type Members = { findMany<Row>(query: { model: string; where: { field: string; value: string }[]; limit: number; sortBy: { field: string; direction: 'asc' | 'desc' } }): Promise<Row[]> }
/**
 * The organization a session opens in when nothing names one: the person's oldest membership,
 * usually the one they founded, so every sign-in lands in the same place.
 */
const oldestMembership = async ({ adapter, user }: { adapter: Members; user: string }) => {
  const [oldest] = await adapter.findMany<{ organizationId: string }>({ model: 'member', where: [{ field: 'userId', value: user }], limit: 1, sortBy: { field: 'createdAt', direction: 'asc' } })
  return oldest?.organizationId
}
// The provider's member reads take the organization by `organizationId` or by `organizationSlug`,
// the slug winning, so both are compared with the active organization.
const sameOrganizationNamed = async (ctx: HookContext) => {
  const { organizationId, organizationSlug } = (ctx.query ?? {}) as { organizationId?: unknown; organizationSlug?: unknown }
  sameOrganization({ id: organizationId })
  if (typeof organizationSlug !== 'string') return
  const named = await ctx.context.adapter.findOne<{ id: string }>({ model: 'organization', where: [{ field: 'slug', value: organizationSlug }] })
  sameOrganization({ id: named?.id })
}
const auditBefore = async (ctx: HookContext) => {
  // The provider hands any member every member's name, address, image, role and join date, and
  // anyone's role by `userId`, and these routes have no hook to gate. Only a caller who may read
  // members does, in the active organization alone. A caller's own role, asked with no `userId`,
  // stays open: every request's actor is read through it.
  if (ctx.path === '/organization/list-members' || (ctx.path === '/organization/get-active-member-role' && (ctx.query as { userId?: unknown } | undefined)?.userId !== undefined)) {
    await sameOrganizationNamed(ctx)
    await gate('member.find')()
  }
  // The provider lets any member list invitations, invitee emails among them, and this route has no
  // hook to gate. Only a caller who may invite reads them, in the active organization alone.
  if (ctx.path === '/organization/list-invitations') {
    sameOrganization({ id: (ctx.query as { organizationId?: unknown } | undefined)?.organizationId })
    await gate('invitation.create')()
  }
  // A rename takes an `organizationId` in its body, but its hook is handed the new data, which
  // carries no id, so the organization is compared here. A body naming none updates the active
  // organization and passes.
  if (ctx.path === '/organization/update') sameOrganization({ id: (ctx.body as { organizationId?: unknown } | undefined)?.organizationId })
  // The provider's `organizationRole` writes take an `organizationId` in their body and ask the
  // provider's own `ac` keys, which it answers from governance roles alone, so a governance admin
  // of another organization could write roles there with no key. Ask this project's keys instead,
  // in the active organization alone.
  const roleWrite = roleWrites.get(ctx.path)
  if (roleWrite) {
    sameOrganization({ id: (ctx.body as { organizationId?: unknown } | undefined)?.organizationId })
    await gate(roleWrite)()
  }
  if (!audited(ctx.path)) return
  const caller: Caller = await getSessionFromCtx(ctx).catch(() => null)
  callers.set(ctx.context, caller)
  // Only a `super_admin` writes a role, on any route that takes one. The plugin already asks
  // `user.set-role` of these routes, which only `'*'` holds, but a project's own platform role
  // granted `user.update` must still write no role through `update-user`.
  //
  // `/admin/has-permission` is excepted: it carries `role` to ask what that role may do and writes
  // nothing.
  const body = (ctx.body ?? {}) as Parameters<typeof roleOf>[0] & { userId?: unknown; banReason?: unknown; data?: { banned?: unknown; banReason?: unknown } }
  const acts = ctx.path.startsWith('/admin/') && ctx.path !== '/admin/has-permission'
  const grants = holdsRole(caller?.user.role, (one) => one === 'super_admin')
  if (acts && roleOf(body) !== undefined && !grants && !firstRegistering.getStore()) throw new APIError('FORBIDDEN', { message: 'Only a platform administrator sets a role.' })
  // Every route that names the person it acts on names them as `userId` in its body. Nobody acts on
  // their own row, and only a super admin acts on a staff member's.
  //
  // A caller with no session is left to the provider's own 401, so the answer never says whether an
  // id names staff.
  if (!acts || !caller) return
  // A ban needs a reason. The provider writes `data.banned` raw unless it is `=== true`, so a
  // non-boolean such as `'true'` would store a ban with no reason and end no session.
  const writes = ctx.path === '/admin/update-user' || ctx.path === '/admin/create-user'
  if (writes && body.data && Object.hasOwn(body.data, 'banned') && typeof body.data.banned !== 'boolean') {
    throw new APIError('BAD_REQUEST', { message: 'A ban is true or false.' })
  }
  const banning = ctx.path === '/admin/ban-user' ? body : writes && body.data?.banned === true ? body.data : undefined
  if (banning && (typeof banning.banReason !== 'string' || !banning.banReason.trim())) {
    throw new APIError('BAD_REQUEST', { message: 'A ban carries a reason.' })
  }
  if (body.userId === undefined) return
  const userId = String(body.userId)
  if (userId === caller.user.id) throw new APIError('FORBIDDEN', { message: 'Nobody acts on their own row on the platform.' })
  // The admin plugin's own `role` column, which the core user type does not name.
  const target = (await ctx.context.internalAdapter.findUserById(userId)) as ({ role?: string | null } & Record<string, unknown>) | null
  if (holdsRole(target?.role, (one) => Object.hasOwn(platformRoles, one)) && !grants) {
    throw new APIError('FORBIDDEN', { message: 'Only a platform administrator acts on a staff member.' })
  }
  // A role written as it already stands is answered and written nowhere, so the audit holds no line
  // for it.
  if (ctx.path === '/admin/set-role' && target && [body.role].flat().join(',') === (target.role ?? 'user')) return ctx.json({ user: target })
}
export const platformAudit = {
  before: createAuthMiddleware(auditBefore),
  after: createAuthMiddleware(async (ctx) => {
    // `get-full-organization` also answers members and invitations, addresses among them, to any
    // member, so each is emptied unless the caller holds the key its own list route asks. The
    // organization itself stays readable to every member.
    const full = ctx.context.returned as { id?: unknown; members?: unknown; invitations?: unknown } | null | undefined
    if (ctx.path === '/organization/get-full-organization' && full && typeof full === 'object' && 'id' in full) {
      const holds = (key: string) => gate(key)({ organization: full }).then(() => true, () => false)
      const [mayInvite, mayList] = [await holds('invitation.create'), await holds('member.find')]
      if (!mayInvite || !mayList) return ctx.json({ ...full, ...(mayInvite ? {} : { invitations: [] }), ...(mayList ? {} : { members: [] }) })
    }
    // Leaving the active organization leaves the session in none, where every read is refused,
    // so it opens the person's oldest remaining membership, as a new session would.
    const leaving = ctx.context.session
    if (ctx.path === '/organization/leave' && leaving && !(ctx.context.returned instanceof Error) && leaving.session.activeOrganizationId === (ctx.body as { organizationId?: unknown } | undefined)?.organizationId) {
      const next = await oldestMembership({ adapter: ctx.context.adapter as unknown as Members, user: leaving.user.id })
      if (next) await ctx.context.internalAdapter.updateSession(leaving.session.token, { activeOrganizationId: next })
    }
    if (!audited(ctx.path) || ctx.context.returned instanceof Error) return
    const caller = callers.get(ctx.context)
    // A sign-out is audited only where it ends an impersonation, which is how the tenant app stops
    // one: the provider's own stop route would put the staff member's session back under the tenant
    // app's cookie, which the tenant app refuses.
    if (ctx.path === '/sign-out' && !caller?.session.impersonatedBy) return
    const body = (ctx.body ?? {}) as { userId?: unknown; role?: unknown; data?: { role?: unknown } }
    const query = (ctx.query ?? {}) as { id?: unknown; userId?: unknown }
    // The person acted on: named in the body or the query, or made by the call, `create-user`'s.
    const target = body.userId ?? query.userId ?? query.id ?? (ctx.context.returned as { user?: { id?: unknown } } | undefined)?.user?.id
    const role = roleOf(body)
    console.log(JSON.stringify({
      audit: 'platform',
      action: ctx.path,
      actor: caller?.user.id ?? null,
      impersonatedBy: caller?.session.impersonatedBy ?? null,
      ...(target === undefined ? {} : { target }),
      ...(role === undefined ? {} : { role }),
      at: new Date().toISOString(),
    }))
    if (ctx.path === '/admin/impersonate-user' && ctx.context.newSession) return handOff(ctx)
    // Ending an impersonation sends the staff member back to the platform, whose session is still
    // theirs, not to the tenant's sign-in. The answer keeps the provider's `success` and the
    // cookies it cleared.
    if (ctx.path === '/sign-out') return ctx.json({ success: true, url: platformApp ? platformURL : tenantURL })
  }),
}

// The platform never writes the tenant app's cookie (two origins, two cookies), so an impersonation
// answers a one-time link into the tenant app, which trades it for the session under its own
// cookie.
//
// The token is stored the way the one-time-token plugin stores its own, because that plugin's
// `verifyOneTimeToken` consumes it: once, setting the session cookie of whichever instance served
// the verify. Every cookie the impersonation set is dropped from the answer, so the platform's own
// session is untouched.
const handOff = async (ctx: HookContext) => {
  const token = randomBytes(32).toString('base64url')
  await ctx.context.internalAdapter.createVerificationValue({
    value: ctx.context.newSession!.session.token,
    identifier: `one-time-token:${token}`,
    expiresAt: new Date(Date.now() + 3 * 60 * 1000),
  })
  ctx.context.responseHeaders?.delete('set-cookie')
  return ctx.json({ url: new URL(`/auth/handoff?token=${token}`, tenantURL).href })
}

// A session is made only for staff or for the person an impersonation mimics, which the provider
// makes with `impersonatedBy` set. Anyone else gets the provider's wrong-password refusal, the one
// its sign-in throws for an unknown address and a wrong password alike. The hook runs after the
// password was checked, so nobody learns which accounts exist or hold a password.
//
// Without the endpoint context there is no adapter to read the person with, so the session is
// refused. The read is the transaction's where one is open.
type SessionBefore = typeof options.databaseHooks.session.create.before
const staffSession = (next: SessionBefore): SessionBefore => async (session, context) => {
  const mimics = !!(session as { impersonatedBy?: unknown }).impersonatedBy
  const user = mimics || !context ? null : await (await getCurrentAdapter(context.context.adapter as never)).findOne<{ role?: unknown }>({ model: 'user', where: [{ field: 'id', value: session.userId }] })
  if (!mimics && !holdsRole(user?.role, (one) => Object.hasOwn(platformRoles, one))) {
    throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD)
  }
  return next(session, context)
}

/**
 * Called once by the provider inside `createOrganization`, with the organization and the member row
 * it made for the caller. The template uses it to give a new organization an administrator.
 */
export type AssignFirstRole = (data: {
  organization: { id: string } & Record<string, unknown>
  member: { id: string } & Record<string, unknown>
  user: { id: string } & Record<string, unknown>
}) => Promise<void>

/**
 * The organization hooks that need this project's store, which only the factory below holds. A
 * `beforeRemoveMember` or `beforeAcceptInvitation` here runs after the template's own, never in its
 * place.
 */
type Joining = { organization: { id: string } & Record<string, unknown> }
export type StoreHooks = {
  afterCreateOrganization?: AssignFirstRole
  beforeRemoveMember?: (data: Joining & { member: { userId: string } & Record<string, unknown> }) => Promise<void>
  beforeAcceptInvitation?: (data: Joining & { invitation: { role: string } & Record<string, unknown>; user: { id: string } & Record<string, unknown> }) => Promise<void>
  beforeAddMember?: (data: Joining & { member: { userId: string } & Record<string, unknown> }) => Promise<void>
}

/**
 * Parses `TRUSTED_IP_HEADER`, the header names this deployment's proxy overwrites with the real
 * client address (`cf-connecting-ip` behind Cloudflare, `x-forwarded-for` behind a reverse proxy
 * configured to overwrite it, comma-separated for several). It feeds Better Auth's
 * `advanced.ipAddress.ipAddressHeaders`.
 *
 * `undefined` when unset, so Better Auth keeps its default of `x-forwarded-for` alone. A header is
 * trustworthy only when the proxy overwrites it on every request; otherwise any caller picks its
 * own rate-limit bucket.
 */
export const trustedIpHeaders = (value: string | undefined): string[] | undefined => {
  const headers = value
    ?.split(',')
    .map((header) => header.trim())
    .filter(Boolean)
  return headers?.length ? headers : undefined
}

const ipAddressHeaders = trustedIpHeaders(process.env.TRUSTED_IP_HEADER)

// Where a password reset link goes. No mail sender is configured, so the link is written to the
// server's log in development (see `logsLinks`). Anywhere else the provider refuses every address
// alike before it looks one up, so no token or address is written anywhere.
//
// The link is the tenant app's reset page, not the provider's `url`, which names
// `/api/auth/reset-password` while this project serves the provider under `/api/auth/user`.
const onLocalHost = !production && isLocalHost(tenantURL)
const sendResetPassword = async ({ user, token }: { user: { email: string }; token: string }) => {
  console.log(`[asas auth] Password reset link for "${user.email}": ${new URL(`/auth/reset-password?token=${encodeURIComponent(token)}`, tenantURL).href}`)
}

/**
 * The Better Auth options, with no `database`: the strategy supplies the tables mithaq built.
 * `mithaq generate auth` reads this module to write the auth kayan.
 *
 * The hooks that write rows of this project (`StoreHooks`) are a parameter of `authOptions`
 * instead. A hook changes no table, so the schema read here is the schema the runtime builds.
 */
export const options = {
  // A reset ends every session of the account, in both apps, since they share one session table.
  emailAndPassword: { enabled: true as const, revokeSessionsOnPasswordReset: true, ...(logsLinks ? { sendResetPassword } : {}) },
  // The provider rate limits only when `NODE_ENV` is `production`, so a deploy that sets none would
  // answer every sign-in and reset request unlimited. Off a local host it limits whatever
  // `NODE_ENV` says.
  rateLimit: { enabled: !onLocalHost },
  // Better Auth reads it for the links it writes into mail and the origin it checks a request
  // against; without it every boot prints `Base URL is not set`.
  baseURL: tenantURL,
  // The origins a browser may carry a cookie of this project to: the template's `vite dev`, `vite
  // preview` and Next ports, outside production only. Better Auth adds `baseURL` itself. A project
  // that serves a mobile client adds its scheme here.
  trustedOrigins: production ? [] : ['http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173'],
  ...(ipAddressHeaders ? { advanced: { ipAddress: { ipAddressHeaders } } } : {}),
  // How an impersonation crosses from the platform app into the tenant app (`handOff`). The plugin
  // adds no table, and no client may mint a token over HTTP.
  plugins: [admin(adminOptions), organization(organizationOptions), oneTimeToken({ disableClientRequest: true })],
  hooks: platformAudit,
  // The active organization, set where the session is made. Every row this project reads is keyed
  // on it and the provider sets it only when an organization is created, so a user who signed in
  // held none and was refused every read. The user's oldest membership becomes active on a session
  // that names none; a session that names one is left alone.
  //
  // The read goes through `getCurrentAdapter`, the transaction's adapter where the provider opened
  // one: the base adapter would take a second pool client while the transaction holds the first,
  // and a full pool would wait on itself.
  databaseHooks: {
    session: {
      create: {
        before: async (
          session: { userId: string; activeOrganizationId?: string | null },
          context: { context: { adapter: { findOne: <Row>(query: { model: string; where: { field: string; value: string }[] }) => Promise<Row | null> } } } | null,
        ) => {
          if (session.activeOrganizationId || !context) return
          const organization = await oldestMembership({ adapter: await getCurrentAdapter(context.context.adapter as never), user: session.userId })
          return organization ? { data: { ...session, activeOrganizationId: organization } } : undefined
        },
      },
    },
  },
}

/**
 * The same options with the provider's own access control built, which is what the template builds
 * its server from. It is a function because the roles are made from an `ac` that has to exist
 * first.
 *
 * The three built-in roles are the provider's defaults over the provider's own resources and grade
 * nothing of this project: what a member may do is the access target's answer, which reads the
 * project's own keys. A project narrows these where its own governance differs.
 */
export const authOptions = (hooks: StoreHooks = {}) => {
  // Only the provider's own vocabulary. Merging this project's catalog in would make the provider's
  // `owner` hold every project key before any role row was read, and a `roles` row could then widen
  // and never narrow. The provider gates its own actions; this project's keys are the access
  // target's.
  const ac = createAccessControl({ ...defaultStatements })
  // A role's type is a subset of the statements it was made from, and these are derived at runtime,
  // so what a role holds is only a string list here. The assertion is at the one line that crosses
  // that boundary.
  type Grant = Parameters<typeof ac.newRole>[0]
  const everything: Record<string, string[]> = Object.fromEntries(
    Object.entries(ac.statements).map(([resource, actions]) => [resource, [...(actions as readonly string[])]]),
  )
  const roles = {
    owner: ac.newRole(everything as Grant),
    admin: ac.newRole({
      ...everything,
      organization: (everything.organization ?? []).filter((one) => one !== 'delete'),
    } as Grant),
    member: ac.newRole({ ac: ['read'] }),
  }
  return {
    options: {
      ...options,
      plugins: [
        // The same object as in `options`, so the schema `mithaq generate auth` reads is the schema
        // the runtime builds. Leaving it out of the rebuilt list would drop five columns from the
        // runtime that the generated kayan still describe.
        admin(adminOptions),
        oneTimeToken({ disableClientRequest: true }),
        organization({
          ...organizationOptions,
          organizationHooks: {
            ...organizationOptions.organizationHooks,
            // The project's own, written where the store is in hand: `providers.user.server`.
            ...hooks,
            beforeRemoveMember: async (data: Parameters<NonNullable<StoreHooks['beforeRemoveMember']>>[0]) => {
              await organizationOptions.organizationHooks.beforeRemoveMember(data)
              await hooks.beforeRemoveMember?.(data)
            },
            beforeAcceptInvitation: async (data: Parameters<NonNullable<StoreHooks['beforeAcceptInvitation']>>[0]) => {
              await organizationOptions.organizationHooks.beforeAcceptInvitation(data)
              await hooks.beforeAcceptInvitation?.(data)
            },
          },
          ac,
          roles,
        }),
      ],
    },
    roles,
  }
}

/**
 * Every Better Auth instance this project runs, one key per kayan it authenticates. `mithaq
 * generate auth` reads `options` to write that kayan's directory, and the generated kayan reads
 * `server` back, so one record is both halves of one instance.
 *
 * A second population is a second key here: a second kayan, cookie name and `/api/auth/<kayan>/*`
 * prefix. Its tables carry their own `modelName`, because one database holds them all.
 */
export const providers = {
  user: {
    options,
    /**
     * Built from the targets the language carries and the vocabulary the build derived. Neither
     * exists where a kayan is written, so this is a factory the kayan names.
     */
    server: (targets: {
      drizzle: {
        db: Parameters<typeof drizzleAdapter>[0]
        tables: Record<string, unknown>
        insert(args: { tx: unknown; kayan: string; data: Record<string, unknown> }): Promise<unknown>
        remove(args: { tx: unknown; kayan: string; id: unknown }): Promise<unknown>
        find(args: { tx?: unknown; kayan: string; args: { limit: number; page: number; sort: { field: string; direction: 'asc' | 'desc' }; where?: Where } }): Promise<{ docs: Record<string, unknown>[] }>
        transaction<Result>(run: (tx: unknown) => Promise<Result>): Promise<Result>
        count?(args: { kayan: string; args: { where?: Where } }): Promise<number>
      }
    }) => {
      const store = targets.drizzle
      // add-on: roles
      // The drizzle store always counts; `Store` types it optional for stores that cannot.
      const heldRoles = (organization: string, user: string) => store.count!({ kayan: 'memberRoles', args: { where: { organization: { equals: organization }, user: { equals: user } } } })
      const holdsRoles = () => new APIError('CONFLICT', { code: 'error.conflict.member_holds_roles', message: 'This member still holds a role in this organization. Take each role from them first.' })
      // The roles a person holds in an organization they are not a member of, taken as they come
      // back in by an accepted invitation or an added membership: nobody gave them anew, and the
      // assignment guards never ran for whoever invited them back. Taken rather than refused,
      // because no screen reaches the roles of a non-member and a refusal would shut the person out
      // for good.
      const clearsLeftRoles = async ({ organization, user }: { organization: string; user: string }) => {
        // A current member left no organization: the provider runs this hook before it notices that
        // an old invitation or an added membership names a member already, and their roles are
        // theirs.
        if (await store.count!({ kayan: 'member', args: { where: { organizationId: { equals: organization }, userId: { equals: user } } } })) return
        if (!(await heldRoles(organization, user))) return
        await store.transaction(async (tx) => {
          const left = await store.find({ tx, kayan: 'memberRoles', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organization: { equals: organization }, user: { equals: user } } } })
          for (const row of left.docs) await store.remove({ tx, kayan: 'memberRoles', id: row.id })
        })
      }
      // end add-on: roles
      const built = authOptions({
        // add-on: roles
        // The tenant's first assignment, which nothing inside the project can make: a role holding
        // `memberRoles.create` has to be assigned before it can assign anything, and the caller of
        // `createOrganization` is in no organization until that route puts it in one. So it goes
        // straight through the store rather than through `asas.kayan.memberRoles.operations.create`,
        // which is graded against the actor making it. The row is `administrator`, which holds
        // `'*'`, so the organization has a root granter from its first moment and every later
        // assignment is the gated one.
        afterCreateOrganization: async ({ organization, user: creator }) => {
          const written = new Date()
          await store.transaction((tx) =>
            store.insert({
              tx,
              kayan: 'memberRoles',
              data: {
                createdAt: written,
                role: 'administrator',
                organization: organization.id,
                updatedAt: written,
                user: creator.id,
              },
            }),
          )
        },
        // A member who still holds a role of this project in the organization is not removed. The
        // provider deletes the member row alone and leaves this project's rows behind, which are
        // read again the moment the person is a member again. Their roles are taken first, each
        // through the assignment kayan's own delete, whose guards decide whether this caller may
        // take that role. The Members page does that before removing, so a person sees this refusal
        // only where a role was given in between or the route was called by hand.
        //
        // Counted outside any transaction, so a role assigned between the count and the delete is
        // left behind; it is dormant while the person is no member and taken as they come back in
        // (`clearsLeftRoles`).
        beforeRemoveMember: async ({ member, organization }) => {
          if (await heldRoles(organization.id, member.userId)) throw holdsRoles()
        },
        beforeAcceptInvitation: ({ user, organization }) => clearsLeftRoles({ organization: organization.id, user: user.id }),
        beforeAddMember: ({ member, organization }) => clearsLeftRoles({ organization: organization.id, user: member.userId }),
        // end add-on: roles
      }).options
      // `transaction: true` makes the provider's own transaction helper open a real transaction
      // wherever it asks for one: a sign-up writes its user, account and session in one, and an
      // accepted invitation its member and the session's organization. Without it each statement
      // runs on its own.
      const database = drizzleAdapter(store.db, { provider: 'pg', schema: store.tables, transaction: true })
      // Two instances over one database and one user table, one per app, so a person is one row and
      // one password in both. The tenant app's refuses every route of the admin plugin, and its
      // stop route, which would put a staff member's session back under the tenant app's cookie.
      // The plugin stays in it because it refuses a banned user a session and carries
      // `impersonatedBy` onto the session it reads.
      const tenantOnly = Object.values(admin(adminOptions).endpoints).map((endpoint) => endpoint.path)
      // add-on: roles
      // Leaving is refused while a role is held, as a removal is above. The provider's leave route
      // runs no hook, so it is matched by path, on both instances. A member who holds a
      // role-managing role takes it from nobody else, so leaves only once another member has taken
      // it from them. An owner who holds an `administrator` row never leaves and is never removed,
      // because that row cannot be taken (`error.forbidden.owner_role`); that is stricter than the
      // provider, which lets an owner go while another remains, and intended.
      const keepsRoles = {
        id: 'keeps-roles',
        hooks: { before: [{
          matcher: (ctx: { path?: string }) => ctx.path === '/organization/leave',
          handler: createAuthMiddleware(async (ctx) => {
            const organization = (ctx.body as { organizationId?: unknown } | undefined)?.organizationId
            const caller = await getSessionFromCtx(ctx).catch(() => null)
            if (typeof organization !== 'string' || !caller) return
            if (await heldRoles(organization, caller.user.id)) throw holdsRoles()
          }),
        }] },
      }
      // end add-on: roles
      const tenant = betterAuthServer({
        ...built,
        plugins: [
          ...built.plugins,
          // add-on: roles
          keepsRoles,
          // end add-on: roles
        ],
        disabledPaths: tenantOnly,
        database,
      })
      // add-on: courses
      // A person who holds a seat, a withdrawn one included, is not removed: the enrollment records
      // that they attended, and its `student` key restricts. The provider's `deleteUser` runs in no
      // transaction, so the key alone would fail after the person's sessions and accounts were
      // gone, leaving someone who can never sign in again. So it is refused before anything goes.
      // The store's count reads every row, marked ones included. The id is read the way the route
      // reads it, after its own `z.coerce.string()`, so an id sent as a list or a number is the
      // same person here as there.
      const seated = {
        id: 'seated',
        hooks: { before: [{
          matcher: (ctx: { path?: string }) => ctx.path === '/admin/remove-user',
          handler: createAuthMiddleware(async (ctx) => {
            const raw = (ctx.body as { userId?: unknown } | undefined)?.userId
            if (raw === undefined || raw === null || !(await getSessionFromCtx(ctx).catch(() => null))) return
            // The drizzle store always counts; `Store` types it optional for stores that cannot.
            if (await store.count!({ kayan: 'enrollments', args: { where: { student: { equals: String(raw) } } } })) {
              throw new APIError('CONFLICT', { code: 'error.conflict.referenced', message: 'This person holds a seat in a session, a withdrawn one included, so they are not removed while an enrollment records them.' })
            }
          }),
        }] },
      }
      // end add-on: courses
      // Whether anyone holds a platform role, read as `holdsRole` reads `user.role`: comma-separated,
      // each name trimmed of the whitespace `.trim()` takes. Every tenant user's `user` is passed
      // over before the split, and the scan stops at the first holder.
      type Executes = { execute(query: unknown): Promise<{ rows: unknown[] }> }
      const users = store.tables.user as { role: unknown }
      const administered = async (db: Executes) =>
        (await db.execute(sql`select 1 from ${users} where ${users.role} <> 'user' and exists (select 1 from unnest(string_to_array(${users.role}, ',')) as one where btrim(one, E' \\t\\n\\r\\f\\x0b') in ${Object.keys(platformRoles)}) limit 1`)).rows.length > 0
      // One answer however often and by whomever it is asked, naming nobody.
      const closed = () => new APIError('FORBIDDEN', { code: 'FIRST_REGISTER_CLOSED', message: 'This platform has its administrator, so first-register is closed. Sign in instead.' })
      // The platform's first `super_admin`, which nothing else can make: the provider's own
      // `create-user`, run on an instance bound to a transaction that holds an advisory lock and
      // read no administrator under it, so two concurrent calls never both make one.
      const firstRegister = {
        id: 'first-register',
        endpoints: {
          init: createAuthEndpoint('/init', { method: 'GET' }, async (ctx) =>
            ctx.json((await administered(store.db as Executes)) ? { initialized: true } : { initialized: false, code: setupCodeState })),
          // `formCsrfMiddleware`, as sign-up has: no session guards this route, so another site's
          // form must not post to it.
          firstRegister: createAuthEndpoint('/first-register', { method: 'POST', use: [formCsrfMiddleware] }, async (ctx) => {
            if (platformLimited && !ipAddressHeaders && overSharedLimit()) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many tries. Wait a minute and try again.' })
            if (await administered(store.db as Executes)) throw closed()
            const { name, email, password, code } = (ctx.body ?? {}) as Record<string, unknown>
            if (setupCodeState === 'unset') throw new APIError('FORBIDDEN', { code: 'SETUP_CODE_UNSET', message: 'Set SETUP_CODE where the platform app runs, to a random value of 32 characters or more: the first administrator is made only with it.' })
            if (setupCodeState === 'required' && !isSetupCode(code)) throw new APIError('FORBIDDEN', { code: 'SETUP_CODE_WRONG', message: 'That is not the setup code.' })
            // `create-user` checks the address but not the password's length, which sign-up does.
            const { minPasswordLength: min, maxPasswordLength: max } = ctx.context.password.config
            if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || typeof password !== 'string' || password.length < min || password.length > max) {
              throw new APIError('BAD_REQUEST', { message: `A name, an email and a password of ${min} to ${max} characters are required.` })
            }
            return ctx.json(await store.transaction(async (tx) => {
              // Read committed whatever the database's default, so the read below sees an
              // administrator another call committed while this one waited on the lock.
              await (tx as Executes).execute(sql`set transaction isolation level read committed`)
              await (tx as Executes).execute(sql`select pg_advisory_xact_lock(hashtext('mithaq.first-register'))`)
              if (await administered(tx as Executes)) throw closed()
              // ponytail: an instance per call, built over this transaction; it runs once in a
              // project's life. `built` carries the admin plugin and the audit hooks, which is all
              // `create-user` reads.
              const bound = betterAuthServer({ ...built, secret: platformSecret, database: drizzleAdapter(tx as never, { provider: 'pg', schema: store.tables }) })
              // The provider writes through the adapter its request stored, which is the platform's
              // pool here, so the user and account rows are pointed at this transaction instead:
              // both commit with the check or neither does, and no second client is taken.
              const adapter = (await bound.$context).adapter
              // The plugin types a role from `adminOptions.roles`, whose platform roles are built at
              // runtime, so it names `user` alone.
              return runWithAdapter(adapter, () => firstRegistering.run(true, () => bound.api.createUser({ body: { name, email, password, role: 'super_admin' as never } })))
            }))
          }),
        },
        // Production limits every route; this one to three tries a minute from one address, as the
        // provider limits a password reset.
        rateLimit: [{ pathMatcher: (path: string) => path === '/first-register', window: 60, max: 3 }],
      }
      // The platform app's own instance: its own cookie name, so on `localhost`, where ports do not
      // keep cookies apart, the two apps never read each other's session; its own secret, so
      // neither signs a cookie the other accepts; its own origin alone trusted, so a tenant page
      // cannot post to it with the platform's cookie; no verify of a one-time token, which would
      // turn an impersonation into a platform session; and no sign-up, since staff are people the
      // platform already has. A project with no platform console has no first-register either.
      const platform = betterAuthServer({
        ...built,
        plugins: [
          ...built.plugins,
          // add-on: courses
          seated,
          // end add-on: courses
          // add-on: roles
          keepsRoles,
          // end add-on: roles
          ...(platformApp ? [firstRegister] : []),
        ],
        baseURL: platformURL,
        trustedOrigins: platformOrigins,
        rateLimit: { ...built.rateLimit, enabled: platformLimited },
        secret: platformSecret,
        advanced: { ...built.advanced, cookiePrefix: platformCookiePrefix },
        // Nor a password reset of its own: staff reset through the tenant app's page like anyone,
        // and the reset ends their sessions here too.
        disabledPaths: ['/one-time-token/verify', '/sign-up/email', '/request-password-reset', '/reset-password'],
        databaseHooks: { session: { create: { before: staffSession(built.databaseHooks.session.create.before) } } },
        database,
      })
      // One object for the kayan, which answers from whichever instance serves the request.
      return new Proxy(tenant, { get: (_target, key) => Reflect.get(onPlatform() ? platform : tenant, key) })
    },
  },
}
