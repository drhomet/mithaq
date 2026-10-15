import { AsyncLocalStorage } from 'node:async_hooks'
import { actorPermissions, markAuthActor, resolveAssigned, type AssignedResolver } from '../../asas/actor.ts'
import type { Held } from '../../mithaq/rows.ts'
type BetterAuthUser = Record<string, unknown>
type BetterAuthOrganization = { id: string } & Record<string, unknown>
type BetterAuth = {
  api: {
    getSession(args: { headers: Headers; query?: { disableRefresh?: boolean } }): Promise<null | { session?: BetterAuthUser; user: BetterAuthUser }>
    getActiveMemberRole?(args: { headers: Headers }): Promise<null | { role?: unknown }>
    listOrganizations?(args: { headers: Headers }): Promise<BetterAuthOrganization[]>
  }
  handler(request: Request): Promise<Response>
}
type SessionUser<Server extends BetterAuth> = NonNullable<
  Awaited<ReturnType<Server['api']['getSession']>>
>['user']
export type BetterAuthActor<User extends BetterAuthUser = BetterAuthUser, Collection extends string = string> = User & {
  activeOrganizationId?: unknown
  collection: Collection
  /** The real person behind an impersonated session, so the audit names who really made the write. */
  impersonatedBy?: unknown
  /** The provider's own `member.role` in the active organization; several roles are comma-separated. */
  memberRole?: string
  organizations?: BetterAuthOrganization[]
  /** The ids of `organizations`, so a row can say `{ organization: { in: user.organizationIds } }`. */
  organizationIds?: string[]
  /** The keys the build's access target resolved for this actor, never a column of the provider's user row. */
  permissions?: '*' | readonly string[]
  /** The role slugs the access target resolved in the active tenant, never read from `member.role`. */
  roles?: readonly string[]
  strategy: 'better-auth'
  user: User
}

const betterAuthRequest = new AsyncLocalStorage<{ permissions: Held; organization: string | null }>()

/**
 * Whether the caller of the Better Auth request being handled holds `key`, for a project's
 * `organizationHooks.before*`. Only a request through `asas.handler` is gated; any other call answers `true`.
 */
export const holdsPermission = (key: string): boolean => {
  const held = betterAuthRequest.getStore()?.permissions
  return held === undefined || held === true || held.has(key)
}

/**
 * The organization whose keys `holdsPermission` answers with. A provider route may act on another
 * organization than the session's active one, so a hook compares the two first.
 */
export const requestOrganization = (): string | null | undefined => betterAuthRequest.getStore()?.organization

/** Better Auth as one strategy among siblings. The package never imports better-auth; the app owns it. */
export const betterAuthStrategy = <Server extends BetterAuth, Collection extends string = string>({
  server,
  collection,
  assigned,
  onError,
}: {
  server: Server
  collection: Collection
  assigned?: AssignedResolver
  /** Handed an access target that failed to answer, and a session read that failed. */
  onError: (error: unknown) => void
}) => {
  const authenticate = async ({ headers }: { headers: Headers }) => {
    const session = await server.api.getSession({ headers, query: { disableRefresh: true } })
    const user = session?.user as SessionUser<Server> | undefined
    const activeOrganizationId = session?.session?.activeOrganizationId
    const impersonatedBy = session?.session?.impersonatedBy
    const organizations = user && server.api.listOrganizations ? await server.api.listOrganizations({ headers }) : undefined
    // A refusal is nothing: letting it throw would turn "not a member of this
    // organization" into "not signed in".
    const memberRole = user && activeOrganizationId && server.api.getActiveMemberRole
      ? await server.api
          .getActiveMemberRole({ headers })
          .then((found) => (typeof found?.role === 'string' ? found.role : undefined))
          .catch(() => undefined)
      : undefined
    // Never `member.role`: that column is Better Auth's governance, not a business grant.
    if (!user) return { user: null }
    const actor = { ...user, activeOrganizationId, collection, impersonatedBy, memberRole, organizations, organizationIds: organizations?.map((one) => one.id), strategy: 'better-auth', user } as BetterAuthActor<SessionUser<Server>, Collection>
    // Deleted, not set to `undefined`: `markAuthActor` reads a present key as the
    // target's answer, and a user-row column nobody validated is not one.
    delete (actor as { permissions?: unknown }).permissions
    delete (actor as { roles?: unknown }).roles
    // Keys are resolved in the active organization only where the provider lists the person a
    // member of it: a session can still name an organization the person has left.
    const verified = typeof activeOrganizationId === 'string' && organizations?.some((one) => one.id === activeOrganizationId) ? activeOrganizationId : undefined
    const resolved = await resolveAssigned({ resolver: assigned, onError, tenant: verified, member: user.id, actor })
    if (resolved !== undefined) {
      ;(actor as { permissions?: '*' | readonly string[] }).permissions = resolved.permissions
      ;(actor as { roles?: readonly string[] }).roles = resolved.roles
    }
    return { user: markAuthActor(actor) }
  }
  // `actor.strategy` stays `better-auth`, which a project reads to know `user.role` is the provider's column.
  const prefix = new RegExp(`^/api/auth/${collection.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)`)
  return {
    name: collection,
    authenticate,
    handler: async (request: Request) => {
      const url = new URL(request.url)
      url.pathname = url.pathname.replace(prefix, '/api/auth')
      // Kept for the provider's handling of this request: three `organizationHooks.before*`
      // are handed the member being changed, never the caller. A throw must not refuse a sign-in.
      const user = await authenticate({ headers: request.headers })
        .then((found) => found.user)
        .catch((error) => {
          onError(new Error('Resolving the actor of a Better Auth request failed, so it holds no key.', { cause: error }))
          return null
        })
      const held = user ? actorPermissions(user) : assigned ? new Set<string>() : undefined
      const active = user?.activeOrganizationId
      const organization = typeof active === 'string' && user?.organizations?.some((one) => one.id === active) ? active : null
      return betterAuthRequest.run({ permissions: held, organization }, () => server.handler(new Request(url, request)))
    },
    /** The Better Auth instance, so the app can call `api.signUpEmail` and friends. */
    server,
  }
}

/**
 * The Better Auth provider as a kayan declares it. `server` is a factory, built from the
 * targets and vocabulary the build derives; two kayan carrying this are two instances.
 */
export const betterAuth = <Server extends BetterAuth, Targets = unknown>(declaration: {
  server: (targets: Targets, vocabulary: { catalog: readonly string[]; statements: Readonly<Record<string, readonly string[]>>; referenced: (id: string) => Promise<number> }) => Server
}) => ({ provider: 'better-auth' as const, server: declaration.server })
