import { onPlatform, platformApp, platformRoles, platformURL } from '@asas/auth'
import { secret } from '@asas/auth/platform-roles'
import { actorPermissions, actorRoles, authActor, userRefs, type Held, type RowTable, type Store } from 'mithaq'
import { isOwner, OWNER_ROLE } from './roles/grants.ts'

/**
 * What a row may name on the actor: `user.<key>` in any kayan's row is checked
 * against these keys. The active organization is a string because a row that
 * resolves it to anything else throws rather than filtering.
 */
export type OrganizationActor = {
  activeOrganizationId: string
  /** The person's own id, which a field defaults to when the row is the actor's own. */
  id: string
  /**
   * Better Auth's own `member.role`: governance only (settings, members,
   * invitations, the provider's `owner` override). Optional because a local-auth
   * actor is no organization's member.
   */
  memberRole?: string
  /** The real person behind an impersonated session, so the audit handler names who really made the write. */
  impersonatedBy?: string
  organizationIds?: readonly string[]
}

/**
 * The platform administrator's slug. Platform roles live on Better Auth's
 * `user.role`, never in a tenant's `memberRoles`: `assignedRoles` drops any such
 * assignment, because the access target holds a slug's keys only where this
 * reader answers it.
 */
export const PLATFORM = 'super_admin'

/**
 * The platform screen, the only place the platform roles answer. The app decides
 * this, never the request.
 */
export const PLATFORM_SCREEN = 'platform'

/**
 * The kayan whose session carries the platform column, the one `auth.admin`
 * names. A build may run several Better Auth instances, and only this one's
 * `user.role` is the layer above every tenant.
 */
const PLATFORM_KAYAN = 'user'

/**
 * Platform roles read every tenant's rows and write none; staff change a
 * tenant's data only by impersonating a member, which is audited. Every write is
 * an explicit `false`, because a slug a table leaves out still takes the `'*'`
 * row, which opens every write. The row opens the door and the keys decide who
 * walks through it.
 */
const readOnly = { create: false, read: true, update: false, delete: false } as const

/** The read-only row under every platform role, which every row table of this project spreads in. */
export const platformReads = Object.fromEntries(Object.keys(platformRoles).map((slug) => [slug, readOnly])) as {
  readonly [Slug in keyof typeof platformRoles]: typeof readOnly
}

/**
 * Every operation refused under every platform role, spread in place of
 * `platformReads` by tables the platform does not read, such as the settings
 * global and the audit log.
 */
const closed = { create: false, read: false, update: false, delete: false } as const
export const platformClosed = Object.fromEntries(Object.keys(platformRoles).map((slug) => [slug, closed])) as {
  readonly [Slug in keyof typeof platformRoles]: typeof closed
}

/**
 * The accessor every row of this project is written with. The actor is typed
 * here once because a kayan's table is written before the language is imported
 * into its file.
 */
export const user = userRefs<OrganizationActor>()

/**
 * The organization the actor's session has active, read off the trusted
 * snapshot and checked against the provider's own list, or `null`.
 */
export const currentOrganization = (user: unknown) => {
  const trusted = authActor(user)
  if (!trusted || trusted.strategy !== 'better-auth') return null
  const active = trusted.activeOrganizationId
  const organizations = trusted.organizations
  if (typeof active !== 'string' || !Array.isArray(organizations)) return null
  return organizations.some((organization) => organization.id === active) ? active : null
}

/**
 * The platform rows of the tenant-owned kayan: `platformReads` minus the
 * columns `secret` names. A row's field list closes a column whatever keys the
 * actor holds, and a column an actor may not read is no filter either.
 */
const readsNoSecret = { ...readOnly, fields: ['*', ...secret.map((key) => `!${key.slice(key.indexOf('.fields.') + '.fields.'.length)}`)] as readonly string[] }
const secretClosed = Object.fromEntries(Object.keys(platformRoles).map((slug) => [slug, readsNoSecret])) as {
  readonly [Slug in keyof typeof platformRoles]: typeof readsNoSecret
}

/**
 * The rows every tenant-owned kayan inherits. The organization is core's: a
 * read, a write and a reference reach the session's active organization alone,
 * whatever a row here answers. `'*'` is the row every actor assigned a role
 * takes beside its roles' own, so a custom role's keys decide what it reaches;
 * an actor assigned no role takes no row and is denied.
 *
 * No row here names `permissions`: what a role holds is the access target's
 * business, and a second answer here would let a role row widen.
 */
export const tenantAccess = {
  '*': { create: true, read: true, update: true, delete: true },
  /**
   * The one row keyed on a system slug, and it narrows: an instructor teaches and
   * never removes a row. Every operation is named in full, because a missing one
   * reads as `false` and a `false` in any applicable row wins.
   */
  instructor: { create: true, read: true, update: true, delete: false },
  ...secretClosed,
} as const satisfies RowTable

/**
 * The roles a kayan's rows are read through; its parameter also types `user` for
 * every row this project writes. Slugs come from the `memberRoles` kayan for the
 * active organization, off the trusted snapshot, so an object naming its own
 * roles is no one. `member.role` grants one thing only: an owner always holds
 * `administrator` in its tenant, so the role that manages roles is never lost.
 */
export const assignedRoles = (actor: OrganizationActor): readonly string[] => {
  if (!authActor(actor)) return []
  // The platform app answers the platform roles alone and the tenant app the
  // membership's roles alone, never unioned, so neither adds keys on the other's
  // screens. Which app serves the request is the app's own fact, never the request's.
  if (onPlatform()) return platformRolesOf(actor)
  if (!currentOrganization(actor)) return []
  const assigned = (actorRoles(actor) ?? []).filter((slug) => !Object.hasOwn(platformRoles, slug))
  return isOwner(authActor(actor)?.memberRole) && !assigned.includes(OWNER_ROLE) ? [...assigned, OWNER_ROLE] : assigned
}

/**
 * Whether `assignedRoles` answers this actor `super_admin`, which only the
 * platform app does. It is the administrator of `auth.admin`, the one answer
 * local auth's `_verified` writes ask, and the reader and writer of local accounts.
 */
export const superAdmin = ({ user }: { user: unknown }) => assignedRoles(user as OrganizationActor).includes(PLATFORM)

/**
 * Every operation refused to every actor, the administrator included, for the
 * tables Better Auth alone reads and writes through its adapter. Without it those
 * kayan would fall to the administrator's default access, and a super admin would
 * read every session token and password hash.
 */
export const providerOnly = { create: () => false, read: () => false, update: () => false, delete: () => false } as const

/**
 * The platform roles this actor holds on Better Auth's `user.role`, whichever app
 * asks. Several are comma-separated, and only a platform role's name counts.
 *
 * The column is read off the trusted snapshot, and only from the admin kayan's
 * session on a Better Auth strategy: a build may run several instances that all
 * write `user.role`, and local auth spreads its kayan's row onto the actor, so a
 * `role` column there would otherwise hand someone a platform role.
 */
export const platformRolesOf = (actor: unknown): string[] => {
  const trusted = authActor(actor)
  if (!trusted || trusted.strategy !== 'better-auth' || trusted.collection !== PLATFORM_KAYAN || typeof trusted.role !== 'string') return []
  return [...new Set(trusted.role.split(',').map((slug) => slug.trim()).filter((slug) => Object.hasOwn(platformRoles, slug)))]
}

/**
 * Where the tenant app's header links the platform app, for an actor whose
 * platform roles hold `screen.platform`; nothing otherwise. It is a link and
 * grants nothing: the platform app's own server decides entry. A project that
 * serves no platform app links nowhere.
 */
export const platformEntry = (actor: unknown): string | undefined => {
  if (onPlatform() || !platformApp) return undefined
  const enters = platformRolesOf(actor).some((slug) => {
    const held = platformRoles[slug as keyof typeof platformRoles].permissions
    return held === '*' || (held as readonly string[]).includes(`screen.${PLATFORM_SCREEN}`)
  })
  return enters ? new URL(`/${PLATFORM_SCREEN}`, platformURL).href : undefined
}

/**
 * The keys a provider kayan's columns are graded by, which `rows()` takes as its
 * `holds`: in the tenant app the id and the name alone, and only where the actor
 * holds their keys; in the platform app the actor's own keys. An actor holding no
 * key reads no column, since an empty set grades every column closed where
 * `undefined` would grade none.
 */
export const namesInTenant = (kayan: string) => (actor: unknown): Held => {
  const held = actorPermissions(actor)
  if (onPlatform()) return held
  return new Set(['id', 'name'].map((field) => `${kayan}.fields.${field}`).filter((key) => held === true || held?.has(key) === true))
}

/**
 * The read the person's own rows are ANDed with, so it narrows and never widens:
 * the members of the organization the actor's session has active, read off the
 * store. The organization is the trusted snapshot's, so a claim is no one's.
 */
export const membersOf = (store: Pick<Store, 'find'>) => async ({ user: actor }: { user: unknown }) => {
  // A platform role reads every person in the platform app; the rows answer who holds one.
  if (onPlatform()) return true
  const active = currentOrganization(actor)
  if (!active) return false
  const members = await store.find({ kayan: 'member', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organizationId: { equals: active } } } })
  const ids = members.docs.map((row) => row.userId).filter((id): id is string => typeof id === 'string')
  return ids.length ? { id: { in: ids } } : false
}

/**
 * Whether an actor reads past what a kayan's own read narrows for roles not
 * holding `key`: in the platform app, whose staff read every tenant's rows whole,
 * or in a tenant, holding that key. Archived courses, sessions of unreadable
 * courses, covers of unreadable courses and other people's seats narrow this way.
 */
export const readsPast = (actor: unknown, key: string) => {
  const held = actorPermissions(actor)
  return onPlatform() || held === true || held?.has(key) === true
}
