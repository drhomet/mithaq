import type { RowTable } from '../../mithaq/rows.ts'
import { allRows, assignedSlugs, heldSlugs, rbacTarget, scoped, systemKeys, type AccessOptions, type AccessTarget, type SystemRoles } from '../../rbac/index.ts'

// An action list that is not a list of strings contributes nothing: a string
// would flatten character by character.
const flatten = (statements: Readonly<Record<string, readonly string[]>>, into: Set<string>) => {
  for (const [resource, actions] of Object.entries(statements)) {
    if (!Array.isArray(actions)) continue
    for (const action of actions) if (typeof action === 'string') into.add(`${resource}.${action}`)
  }
}

// Better Auth stores `permission` as a JSON string, not the record its zod object describes.
const readPermission = (value: unknown): Record<string, readonly string[]> | undefined => {
  if (typeof value !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  for (const actions of Object.values(parsed)) {
    if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string')) return undefined
  }
  return parsed as Record<string, readonly string[]>
}

export type BetterAuthAccessOptions<Roles extends SystemRoles, Table extends RowTable, Actor> =
  AccessOptions<Roles, Table, Actor> & {
    /** The provider's own compile-time roles, each an `ac.newRole(...)` result. */
    statements?: Readonly<Record<string, { statements: Readonly<Record<string, readonly string[]>> }>>
  }

/**
 * The access target over Better Auth's own `member.role` and nothing else: a member holds the system
 * roles its membership row names in that organization, comma-separated, and there is no custom role
 * and no assignment table. It suits a project whose roles are the provider's owner, admin and member.
 * The row is read from the store for the organization asked about, never off the session, so a
 * membership elsewhere grants nothing here.
 *
 * A `member.role` slug is one a tenant's admin can mint, since the provider's dynamic access control
 * is on, so `roles` holds only slugs a tenant may hold, or `rolesOf` drops the rest: a backoffice role
 * named in it would otherwise grant its keys inside the tenant.
 */
export const memberRoleTarget = <const Roles extends SystemRoles, const Table extends RowTable, Actor>({
  roles,
  rolesOf,
  access,
}: Omit<AccessOptions<Roles, Table, Actor>, 'kayan'>): AccessTarget<Roles, Table, Actor> & { readonly type: 'memberRole' } => ({
  capability: 'access',
  type: 'memberRole',
  roles,
  ...(rolesOf ? { rolesOf } : {}),
  access: (access ?? {}) as Table,
  // Better Auth's own model and columns.
  reads: ['member'],
  resolve: async ({ store, tenant, member, actor }) => {
    // A read without a tenant would be every tenant's; the actor still goes through `rolesOf`, which
    // answers backoffice staff, who have no active organization, their backoffice roles.
    const found = scoped(tenant) && scoped(member)
      ? await allRows({ store, kayan: 'member', where: { and: [{ organizationId: { equals: tenant } }, { userId: { equals: member } }] } })
      : { docs: [] }
    // Split the way the provider's own owner checks split it: exact, untrimmed, so ` owner` is no owner.
    const slugs = [...new Set(found.docs.flatMap((row) => (typeof row.role === 'string' ? row.role.split(',').filter(Boolean) : [])))]
    const held = heldSlugs({ roles, rolesOf, slugs, actor })
    const { everything, keys } = systemKeys(roles, held)
    return { permissions: everything ? '*' : [...keys], roles: held }
  },
})

/**
 * The access target over Better Auth's store: a custom role is an `organizationRole` row.
 * Read directly, not through `hasPermission`, whose cache never invalidates a narrowed role.
 */
export const betterAuthTarget = <const Roles extends SystemRoles, const Table extends RowTable, Actor>({
  roles,
  rolesOf,
  access,
  kayan,
  statements = {},
}: BetterAuthAccessOptions<Roles, Table, Actor>): AccessTarget<Roles, Table, Actor> & { readonly type: 'betterAuth' } => {
  const base = rbacTarget<Roles, Table, Actor>({ access, kayan, roles, rolesOf })
  const { memberRoles, roles: roleKayan } = kayan
  return {
    ...base,
    type: 'betterAuth',
    reads: [roleKayan, memberRoles],
    resolve: async ({ store, tenant, member, actor, ownership }) => {
      const slugs = await assignedSlugs({ store, kayan: memberRoles, field: ownership(memberRoles), tenant, member })
      const held = heldSlugs({ roles, rolesOf, slugs, actor })
      const { custom, everything, keys } = systemKeys(roles, held)
      if (everything) return { permissions: '*', roles: slugs }
      for (const slug of held) {
        const role = statements[slug]
        if (role?.statements) flatten(role.statements, keys)
      }
      if (custom.length && scoped(tenant)) {
        // Caught, so a role table that is down loses the keys and not the assignment.
        const found = await allRows({ store, kayan: roleKayan, where: {
          and: [{ organizationId: { equals: tenant } }, { role: { in: custom } }],
        } }).catch(() => undefined)
        if (!found) return { permissions: [], roles: slugs }
        const stored = found.docs.map((row) => readPermission(row.permission))
        // A malformed column voids the whole answer.
        if (stored.some((one) => one === undefined)) return { permissions: [], roles: slugs }
        for (const one of stored) flatten(one!, keys)
      }
      return { permissions: [...keys], roles: slugs }
    },
  }
}
