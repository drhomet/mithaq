import type { Assigned } from '../rbac/index.ts'
import type { FieldAccess, ResolvedKayan } from '../mithaq/types.ts'
import type { OperationEffect } from './runner/steps.ts'

export type AuthStrategyArgs = {
  headers: Headers
  canSetHeaders?: boolean
  isGraphQL?: boolean
  strategyName?: string
}

export type AuthStrategyResult<Actor = unknown> = {
  responseHeaders?: Headers
  user: Actor | null
}

/** An auth strategy: `authenticate` resolves a request's headers to an actor, or to `null`. */
export type AuthStrategy<Actor = unknown> = {
  name: string
  authenticate(args: AuthStrategyArgs): Promise<AuthStrategyResult<Actor>> | AuthStrategyResult<Actor>
  /** What the HTTP layer mounts at `/api/auth/<strategy name>/*`. */
  handler?(request: Request): Promise<Response>
}

/**
 * What a kayan's `auth` is: a shipped provider declaration, `local(...)` or `betterAuth(...)`,
 * which `buildAsas` builds, or a strategy the project wrote.
 */
export type KayanAuth = AuthStrategy | { provider: 'better-auth' | 'local' }

// Asks for `authenticate`, not `provider`: a project's own strategy may carry a
// `provider` key of its own meaning.
export const isAuthDeclaration = (auth: KayanAuth): auth is { provider: 'better-auth' | 'local' } =>
  !('authenticate' in auth)


type TrustedActor = {
  activeOrganizationId?: unknown
  collection: string
  // The person's own id, which a membership is read by.
  id?: unknown
  // Snapshotted, not read off the actor: a role the caller wrote would select rows.
  memberRole?: unknown
  organizations?: readonly ({ id?: unknown } & Record<string, unknown>)[]
  // The provider's backoffice column `user.role`, snapshotted for the reason `memberRole` is.
  role?: unknown
  // Snapshotted when the strategy returned the actor, so a later mutation of the actor
  // cannot widen what a callback answers. `true` is `'*'`.
  permissions?: true | ReadonlySet<string>
  // Snapshotted for the reason the keys are.
  roles?: readonly string[]
  strategy?: unknown
  // The build's admin answer, so a shipped field callback, handed only the actor, can ask it.
  admin?: boolean
}

const trustedActors = new WeakMap<object, TrustedActor>()

/** Record the build's admin answer on an actor a strategy returned; an unmarked object holds none. */
export const markAdminAnswer = (actor: unknown, admin: boolean) => {
  const trusted = authActor(actor)
  if (trusted) trusted.admin = admin
  return admin
}

/** Whether the build answered this actor as its administrator. */
export const isAdminActor = (actor: unknown) => authActor(actor)?.admin === true

export const markAuthActor = <Actor extends object>(actor: Actor): Actor => {
  const source = actor as TrustedActor & { permissions?: unknown; roles?: unknown }
  const claimed: unknown = (source as { permissions?: unknown }).permissions
  trustedActors.set(actor, {
    activeOrganizationId: source.activeOrganizationId,
    collection: source.collection,
    id: (source as { id?: unknown }).id,
    memberRole: source.memberRole,
    organizations: source.organizations?.map((organization) => ({ ...organization })),
    role: source.role,
    // Present decides, absent stands aside. Any other shape is a store that answered
    // unreadably and holds no key: reading it as absent would fail open.
    permissions:
      'permissions' in source
        ? claimed === '*'
          ? true
          : new Set(
              Array.isArray(claimed) && claimed.every((key) => typeof key === 'string') ? (claimed as string[]) : [],
            )
        : undefined,
    roles: Array.isArray(source.roles) && source.roles.every((one) => typeof one === 'string')
      ? [...(source.roles as string[])]
      : undefined,
    strategy: source.strategy,
  })
  return actor
}

/**
 * The permission keys the access target resolved for this actor, `true` for every key,
 * or nothing where no target graded. Read from the build's snapshot, never the actor object.
 */
export const actorPermissions = (actor: unknown): true | ReadonlySet<string> | undefined =>
  authActor(actor)?.permissions

/** The role slugs the access target resolved for this actor, read from the build's snapshot. */
export const actorRoles = (actor: unknown): readonly string[] | undefined => authActor(actor)?.roles

export const authActor = (actor: unknown): TrustedActor | null =>
  actor && typeof actor === 'object' ? trustedActors.get(actor) ?? null : null

// First non-null actor wins; a strategy that throws is handed to `onError` and skipped.
export const actor = async <Actor>({
  strategies,
  headers,
  onError,
}: {
  strategies: readonly AuthStrategy<Actor>[]
  headers: Headers
  onError: (error: unknown) => void
}): Promise<Actor | null> => {
  for (const strategy of strategies) {
    try {
      const found = await strategy.authenticate({
        canSetHeaders: true,
        headers,
        strategyName: strategy.name,
      })
      if (found.user) return found.user
    } catch (error) {
      onError(new Error(`Auth strategy "${strategy.name}" failed.`, { cause: error }))
    }
  }
  return null
}

/**
 * What the build's access target answers for one actor: the slugs assigned in the tenant
 * and every key they hold, or nothing where the build declares no access target.
 */
export type AssignedResolver = (args: {
  tenant: unknown
  member: unknown
  /** The actor being made, before it is marked. */
  actor: object
}) => Promise<Assigned | undefined> | Assigned | undefined

// A throw must not leave: the strategy loop would turn a store outage into
// "not signed in" instead of a 403. A failed resolver holds no key and `onError` is told.
export const resolveAssigned = async ({
  resolver,
  onError,
  ...args
}: Parameters<AssignedResolver>[0] & { resolver: AssignedResolver | undefined; onError: (error: unknown) => void }): Promise<Assigned | undefined> => {
  if (!resolver) return undefined
  try {
    return await resolver(args)
  } catch (error) {
    onError(new Error('The access target failed to resolve, so this actor holds no role and no key.', { cause: error }))
    return { permissions: [], roles: [] }
  }
}

export type LocalAuthPermissions = {
  kayan: readonly ResolvedKayan[]
  // The effect is allowed where any one of its operations is; each name's answer is published too.
  can(args: { kayan: ResolvedKayan; effect: OperationEffect; actor: unknown }): Promise<{ allowed: boolean; operations: Record<string, boolean> }>
  canAccessAdmin(actor: unknown): Promise<boolean>
  screens(actor: unknown): Promise<readonly string[]>
}

// Reports and never grants. A kayan the actor may not read is left out, and so is a
// field none of `read`, `create` and `update` holds: the report discloses what it names.
export const accessReport = async (permissions: LocalAuthPermissions, actor: unknown) => {
  // First: the build records its answer on the actor, and a field callback below reads it.
  const canAccessAdmin = await permissions.canAccessAdmin(actor)
  const collections: Record<string, unknown> = Object.create(null)
  for (const kayan of permissions.kayan) {
    const effects = ['create', 'read', 'update', 'delete'] as const
    const allowed: Record<string, boolean> = {}
    const operations: Record<string, boolean> = {}
    for (const effect of effects) {
      const answer = await permissions.can({ kayan, effect, actor })
      allowed[effect] = answer.allowed
      Object.assign(operations, answer.operations)
    }
    if (!allowed.read) continue
    const fields: Record<string, Record<string, boolean>> = {}
    for (const field of Object.values(kayan.fields)) {
      const answers: Record<string, boolean> = {}
      for (const effect of ['create', 'read', 'update'] as const) {
        const own = field.access?.[effect] as FieldAccess | undefined
        answers[effect] = allowed[effect]! && (!own || !!(await own({ user: actor })))
      }
      if (answers.create || answers.read || answers.update) fields[field.name] = answers
    }
    collections[kayan.name] = { ...allowed, fields, operations }
  }
  // The actor's own keys, so a screen can answer a provider action such as `user.ban` without trying it.
  const held = actorPermissions(actor)
  return {
    canAccessAdmin,
    collections,
    screens: await permissions.screens(actor),
    ...(held === undefined ? {} : { permissions: held === true ? '*' : [...held] }),
  }
}
