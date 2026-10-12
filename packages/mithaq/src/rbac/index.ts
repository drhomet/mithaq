import { rowsOf, type CheckedTable, type Held, type RowTable } from '../mithaq/rows.ts'
import { writeSync } from 'node:fs'
import { userInfo } from 'node:os'
import { actorPermissions, markAuthActor } from '../asas/actor.ts'
import { Refusal } from '../mithaq/refusal.ts'
import { isService, isStore, type Command, type Language, type Store } from '../mithaq/language.ts'
import { resolvedKayans } from '../mithaq/types.ts'
import type { Where } from '../mithaq/where.ts'
import type { AuditHandler } from '../asas/runner/steps.ts'

/** One system role, written in code: the copy a screen shows it under and the keys it holds. `'*'` is every key. */
export type SystemRole = {
  label: Readonly<Record<string, string>>
  permissions: '*' | readonly string[]
}

/** Every system role of a project, slug to role. Its keys are the row keys. */
export type SystemRoles = Readonly<Record<string, SystemRole>>

/** What one actor is assigned in one tenant, and every key those roles hold. */
export type Assigned = {
  /** `'*'` is every key of the project, which is what a root granter holds. */
  permissions: '*' | readonly string[]
  roles: readonly string[]
}

/** The access target: it names the system roles, reads which an actor is assigned, and answers what they hold. */
export type AccessTarget<
  Roles extends SystemRoles = SystemRoles,
  Table extends RowTable = RowTable,
  Actor = unknown,
> = {
  readonly capability: 'access'
  /** `'rbac'` from `rbacTarget`, `'betterAuth'` from `betterAuthTarget`. */
  readonly type?: 'rbac' | 'betterAuth'
  /** The system roles, which are also the names a row table may be keyed on. */
  readonly roles: Roles
  /** The slugs this actor is assigned, read from the trusted snapshot, so an actor naming its own roles is a claim. Absent is `user.roles`. */
  readonly rolesOf?: (user: Actor) => readonly string[]
  /** The rows every tenant-owned kayan inherits. */
  readonly access: Table
  /** The kayan this target reads rows out of; none may carry a soft-delete mark, or a marked role row would keep granting. */
  readonly reads: readonly string[]
  /**
   * A member's slugs and their keys, in one tenant. `ownership` names the field bound to the
   * tenant on a kayan the target reads, and nothing for a shared one.
   */
  resolve(args: { store: Store; tenant: unknown; member: unknown; actor: object; ownership: (kayan: string) => string | undefined }): Promise<Assigned>
  readonly commands?: Record<string, Command>
}

/**
 * The keys an actor holds for a kayan: what the build's access target resolved,
 * or the kayan's own rows where no target answered. Precedence, never a union.
 */
export const heldPermissions = ({ access, user }: { access: unknown; user: unknown }): Held =>
  actorPermissions(user) ?? rowsOf(access)?.permissions(user)

/** One page of every row a filter matches, which is how each table is read. */
export const allRows = async ({ store, kayan, where }: { store: Store; kayan: string; where: Where }) =>
  store.find({ kayan, args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where } })

/** A tenant a row can be filtered by. Nothing else scopes a read, so nothing else reads. */
export const scoped = (value: unknown): value is number | string =>
  typeof value === 'string' || typeof value === 'number'

/** The actor a command hands an audit sink: the command and the operating-system user who ran it. */
export type CommandActor = { command: string; osUser: string }

export type AccessOptions<Roles extends SystemRoles, Table extends RowTable, Actor> = {
  /** The system roles, which are code and never rows. */
  roles: Roles
  /** How the actor's assigned slugs are read. Absent is `user.roles`. */
  rolesOf?: (user: Actor) => readonly string[]
  /** The row table, keyed on `'*'` and on the slugs `roles` names. */
  access?: Table & CheckedTable<Table, '*' | (keyof Roles & string)>
  /** Where the target reads and seeds: `memberRoles` is the assignment, `roles` the custom roles. */
  kayan: { memberRoles: string; roles: string }
}

// A read that throws is caught at `resolveAssigned`, so a store that is down
// makes an actor that holds nothing rather than one that is not signed in.
export const assignedSlugs = async ({ store, kayan, field, tenant, member }: { store: Store; kayan: string; field: string | undefined; tenant: unknown; member: unknown }) => {
  // An assignment read without a tenant, or of a kayan no tenant owns, would be every tenant's.
  if (!field || !scoped(tenant) || !scoped(member)) return []
  const found = await allRows({ store, kayan, where: {
    and: [{ [field]: { equals: tenant } }, { user: { equals: member } }],
  } })
  const names = found.docs.map((row) => row.role)
  return [...new Set(names.filter((one): one is string => typeof one === 'string' && one !== ''))]
}

/**
 * A role slug that is one of the project's own, whose keys are code. The rest
 * are rows, and a target reads them from wherever it holds them.
 */
export const systemKeys = (roles: SystemRoles, slugs: readonly string[]) => {
  const keys = new Set<string>()
  const custom: string[] = []
  let everything = false
  for (const slug of slugs) {
    // An own key only: a slug is a column a caller wrote.
    const role = Object.hasOwn(roles, slug) ? roles[slug] : undefined
    if (!role) {
      custom.push(slug)
      continue
    }
    if (role.permissions === '*') everything = true
    else for (const key of role.permissions) keys.add(key)
  }
  return { custom, everything, keys }
}

// Never re-export this from a package entry: it marks a copy of any actor and
// slugs as trusted, so a caller outside core could mint the snapshot every reader trusts.
export const heldSlugs = ({ roles, rolesOf, slugs, actor }: {
  roles: SystemRoles
  rolesOf: ((user: never) => readonly string[]) | undefined
  slugs: readonly string[]
  actor: object | undefined
}): readonly string[] => {
  if (!rolesOf) return slugs
  if (!actor) return []
  const answered: unknown = rolesOf(markAuthActor({ ...actor, roles: slugs }) as never)
  if (!Array.isArray(answered)) return []
  const kept = answered.filter(
    (one): one is string => typeof one === 'string' && (slugs.includes(one) || Object.hasOwn(roles, one)),
  )
  return [...new Set(kept)]
}

/** The access target whose custom roles are rows of a kayan the project ships, beside its system roles in code. */
export const rbacTarget = <const Roles extends SystemRoles, const Table extends RowTable, Actor>({
  roles,
  rolesOf,
  access,
  kayan,
}: AccessOptions<Roles, Table, Actor>): AccessTarget<Roles, Table, Actor> & { readonly type: 'rbac' } => {
  // Both targets come through here, so the one refusal covers both.
  for (const key of ['roles', 'memberRoles'] as const) {
    if (typeof kayan?.[key] !== 'string') {
      throw new Error(`The access target names no kayan.${key}. Pass kayan: { roles, memberRoles }, the names of the kayan holding the custom roles and the assignments.`)
    }
  }
  const { roles: roleKayan, memberRoles } = kayan
  return {
    capability: 'access',
    type: 'rbac',
    roles,
    ...(rolesOf ? { rolesOf } : {}),
    access: (access ?? {}) as Table,
    reads: [roleKayan, memberRoles],
    commands: {
      assign: async ({ asas, flags }) => {
        // A sweep reaches this after `generate messages --check` destroyed the shared pool.
        if (flags.includes('--check')) {
          console.log('mithaq rbac assign --check writes nothing.')
          return 0
        }
        try {
          const values: Record<string, string> = {}
          for (let index = 0; index < flags.length; index += 2) {
            const flag = flags[index]
            const value = flags[index + 1]
            if (!flag || !['--tenant', '--user', '--role'].includes(flag) || !value || value.startsWith('--') || values[flag]) {
              throw new Refusal('mithaq rbac assign requires one value each for --tenant, --user and --role.')
            }
            values[flag] = value
          }
          for (const flag of ['--tenant', '--user', '--role']) {
            if (!values[flag]) throw new Refusal(`Missing ${flag} for mithaq rbac assign.`)
          }
          const tenant = values['--tenant']!
          const user = values['--user']!
          const role = values['--role']!
          if (!Object.hasOwn(roles, role)) throw new Refusal(`Role "${role}" is not declared on the access target.`)
          if (role === 'super_admin') throw new Refusal('Role "super_admin" is the platform role and cannot be assigned in a tenant.')
          const project = asas as typeof asas & { targets: Language['targets'] }
          const declarations = resolvedKayans.get(project) ?? {}
          const assignment = declarations[memberRoles]
          if (!assignment) throw new Refusal(`mithaq rbac assign requires the "${memberRoles}" kayan in this build.`)
          const owner = assignment.tenant
          if (!owner) throw new Refusal(`mithaq rbac assign writes an assignment of one tenant, and kayan "${memberRoles}" places no field bound to the tenant target.`)
          // This kayan may use a different store from the service target's default.
          const store = project.targets[assignment.store]
          if (!isStore(store)) throw new Refusal(`Kayan "${memberRoles}" names no store for mithaq rbac assign.`)
          const membership = declarations.member
          if (!membership) throw new Refusal('mithaq rbac assign requires the provider "member" kayan in this build.')
          // The membership is read inside the assignment's transaction, so both kayan must live in that store.
          if (membership.store !== assignment.store) {
            throw new Refusal(`mithaq rbac assign reads both kayan in one transaction, but kayan "member" is in store "${membership.store}" and kayan "${memberRoles}" is in store "${assignment.store}".`)
          }
          const service = Object.values(project.targets).find(isService)
          const actor: CommandActor = { command: 'mithaq rbac assign', osUser: userInfo().username }
          await store.transaction(async (tx) => {
            const member = await store.find({ kayan: 'member', args: {
              limit: 1, page: 1, sort: { field: 'id', direction: 'asc' },
              where: { and: [{ organizationId: { equals: tenant } }, { userId: { equals: user } }] },
            }, tx })
            if (!member.docs.length) throw new Refusal(`User "${user}" is not a provider member of tenant "${tenant}".`)
            const existing = await store.find({ kayan: memberRoles, args: {
              limit: 1, page: 1, sort: { field: 'id', direction: 'asc' },
              where: { and: [{ [owner]: { equals: tenant } }, { user: { equals: user } }, { role: { equals: role } }] },
            }, tx })
            if (existing.docs.length) throw new Refusal(`Role "${role}" is already assigned to user "${user}" in tenant "${tenant}".`)
            const written = new Date()
            const row = await store.insert({ tx, kayan: memberRoles, data: { createdAt: written, role, [owner]: tenant, updatedAt: written, user } })
            // The language checked the sink takes a `CommandActor`, which is what the cast names.
            if (service?.audit) await (service.audit as AuditHandler<CommandActor>)({ context: Object.freeze({ chain: [`${memberRoles}.assign`], depth: 1, source: 'cli' }), effect: 'create', kayan: assignment, operation: 'assign', dataAfter: row, store, tx, user: actor })
          })
          writeSync(1, `${JSON.stringify({ actor, tenant, user, role })}\n`)
          return 0
        } finally {
          await asas.destroy()
        }
      },
    },
    resolve: async ({ store, tenant, member, actor, ownership }) => {
      const slugs = await assignedSlugs({ store, kayan: memberRoles, field: ownership(memberRoles), tenant, member })
      const { custom, everything, keys } = systemKeys(roles, heldSlugs({ roles, rolesOf, slugs, actor }))
      if (everything) return { permissions: '*', roles: slugs }
      const field = ownership(roleKayan)
      // A role table no tenant owns holds no tenant's custom role, so it grants nothing.
      if (custom.length && field && scoped(tenant)) {
        // Caught here, so a role table that is down loses the keys and not the assignment.
        const found = await allRows({ store, kayan: roleKayan, where: {
          and: [{ [field]: { equals: tenant } }, { name: { in: custom } }],
        } }).catch(() => undefined)
        if (!found) return { permissions: [], roles: slugs }
        const held: unknown[] = found.docs.map((row) => row.permissions)
        // A malformed column voids the whole answer: a subset of a list nothing vouched for is still such a grant.
        if (!held.every((one) => Array.isArray(one) && one.every((key) => typeof key === 'string'))) {
          return { permissions: [], roles: slugs }
        }
        for (const key of held.flat() as string[]) keys.add(key)
      }
      return { permissions: [...keys], roles: slugs }
    },
  }
}
