import { denied, invalid } from '../asas/runner/errors.ts'
import type { Ctx, Tools } from '../asas/runner/steps.ts'
import type { Store } from '../mithaq/language.ts'
import { heldPermissions, type SystemRoles } from './index.ts'

const KEYS = 'permissions'

// Kept against each build's frozen catalog, which every operation is handed as `tools.catalog`.
const operationKeysOf = new WeakMap<readonly string[], Readonly<Record<string, string>>>()

export const keepOperationKeys = (catalog: readonly string[], operationKeys: Readonly<Record<string, string>>) => {
  operationKeysOf.set(catalog, operationKeys)
}

// A role holding an operation key of a kayan but no field key of it is refused
// every read of that kayan's fields, so its list draws nothing.
export const fieldlessOperation = (keys: readonly string[], operationKeys: Readonly<Record<string, string>>) => {
  const key = keys.find((one) => Object.hasOwn(operationKeys, one) && !keys.some((other) => other.startsWith(`${operationKeys[one]}.fields.`)))
  return key === undefined ? undefined : { key, kayan: operationKeys[key]! }
}

/**
 * The validate step a role kayan puts after `validate`: a role row may hold only keys
 * the catalog names and the granter itself holds.
 */
export const grantedPermissions = (ctx: Ctx, tools: Tools): Ctx => {
  // A write that names only the name is still a grant: a rename re-targets every key
  // the row holds at a different set of members. `dataBefore` is what the store holds.
  const data = ctx.data as Record<string, unknown>
  const written = data[KEYS] ?? ctx.dataBefore?.[KEYS]
  // Checked here too, so a list a step wrote is checked as a caller's is, and a
  // stored column no shape vouched for refuses rather than being read past.
  if (written === undefined) return ctx
  if (!Array.isArray(written) || written.some((key) => typeof key !== 'string')) {
    throw invalid({
      message: `A "${ctx.kayan.name}" row's "${KEYS}" must be a list of permission keys.`,
      key: 'error.invalid.permissions',
      params: { kayan: ctx.kayan.name, field: KEYS },
    })
  }
  const keys = written as string[]
  const known = new Set(tools.catalog)
  for (const key of keys) {
    if (known.has(key)) continue
    throw invalid({
      message: `Permission "${key}" is not a key of this project's catalog. A key is "<kayan>.<operation>", "<kayan>.fields.<field>" or "screen.<screen>".`,
      key: 'error.invalid.permission',
      params: { kayan: ctx.kayan.name, permission: key },
    })
  }
  // Asked only of a write that names the column, so an older row can still be renamed and deleted.
  const fieldless = data[KEYS] !== undefined && fieldlessOperation(keys, operationKeysOf.get(tools.catalog) ?? {})
  if (fieldless) {
    throw invalid({
      message: `A "${ctx.kayan.name}" row holds operation key "${fieldless.key}" of kayan "${fieldless.kayan}" and no "${fieldless.kayan}.fields.<field>" key, so every read of it is refused for its fields. Grant the fields it reads, or drop the operation.`,
      key: 'error.invalid.permission_fields',
      params: { kayan: ctx.kayan.name, permission: fieldless.key, resource: fieldless.kayan },
    })
  }
  // Read from the trusted snapshot, never the actor object, so a `permissions`
  // property a caller wrote on itself buys nothing.
  const held = heldPermissions({ access: ctx.kayan.access, user: ctx.actor })
  if (held === true) return ctx
  // `undefined` is a granter whose holdings nothing states, not one holding everything:
  // a row written then would become a live grant the moment a store is turned on.
  const missing = held === undefined ? keys : keys.filter((key) => !held.has(key))
  if (!missing.length) return ctx
  throw denied({
    message: `Forbidden: a "${ctx.kayan.name}" row may not grant ${missing.map((key) => `"${key}"`).join(', ')}, which the granter does not hold.`,
    key: 'error.forbidden.grant',
    params: { kayan: ctx.kayan.name, permissions: missing },
  })
}

const NAME = 'name'

const ROLE = 'role'

type BoundRoles = Record<
  string,
  { find?(options: { where?: unknown }): Promise<{ docs: Record<string, unknown>[] }> } | undefined
>

// A `permissions` column that is not a list of strings, or a role kayan that was not
// read, reads as `'*'`: what may be handed over is answered with the largest it could be.
const roleKeys = async ({ roles, kayan, slug, tools }: { roles: SystemRoles; kayan: string; slug: string; tools: Tools }): Promise<'*' | readonly string[] | undefined> => {
  // An own key only: `constructor` or `__proto__` read through the prototype would be a 500 one line later.
  const system = Object.hasOwn(roles, slug) ? roles[slug] : undefined
  if (system) return system.permissions === '*' ? '*' : system.permissions
  // Through the bound registry, so the read runs under this actor, its transaction and its
  // tenant scope, which keeps a role of another tenant out. Rows of one name in a table no
  // tenant owns are unioned, which only asks the assigner for more.
  const bound = (tools as { kayans?: BoundRoles }).kayans?.[kayan]
  const found = await bound?.find?.({ where: { [NAME]: { equals: slug } } })
  // Not read is not a role holding nothing: it reads as `'*'`, so a guard that could not look refuses.
  if (!found) return '*'
  if (!found.docs.length) return undefined
  const keys: string[] = []
  for (const row of found.docs) {
    const held = row[KEYS]
    if (!Array.isArray(held) || held.some((key) => typeof key !== 'string')) return '*'
    keys.push(...(held as string[]))
  }
  return keys
}

/**
 * The validate step a `memberRoles` kayan puts before its store step: an actor may
 * assign only a role whose keys it already holds.
 */
export const assignableRole = (roles: SystemRoles, roleKayan: string) => {
  if (typeof roleKayan !== 'string') {
    throw new Error('assignableRole(roles, roleKayan) names no roleKayan. Pass the name of the kayan holding the custom roles, the access target\'s kayan.roles.')
  }
  return async (ctx: Ctx, tools: Tools): Promise<Ctx> => {
    // A write that moves the row to another member is still an assignment of the role it names.
    const data = ctx.data as Record<string, unknown>
    const slug = data[ROLE] ?? ctx.dataBefore?.[ROLE]
    if (typeof slug !== 'string' || slug === '') return ctx
    // Create and update refuse a missing slug first: even a root granter may not
    // plant a row that a later role could arm.
    const keys = await roleKeys({ roles, kayan: roleKayan, slug, tools })
    if (keys === undefined) {
      if (tools.kind === 'remove') return ctx
      throw invalid({
        message: `Role "${slug}" is not declared in the system roles or the "${roleKayan}" role table of this tenant.`,
        key: 'error.invalid.role',
        params: { kayan: ctx.kayan.name, role: slug },
      })
    }
    // Read from the trusted snapshot, never the actor object.
    const held = heldPermissions({ access: ctx.kayan.access, user: ctx.actor })
    if (held === true) return ctx
    if (keys === '*') {
      throw denied({
        message: `Forbidden: a "${ctx.kayan.name}" row may not assign role "${slug}", which holds every key of this project, and the assigner does not.`,
        key: 'error.forbidden.assign',
        params: { kayan: ctx.kayan.name, permissions: ['*'], role: slug },
      })
    }
    // Refused for the reason `grantedPermissions` refuses an `undefined` holding.
    const missing = held === undefined ? keys : keys.filter((key) => !held.has(key))
    if (!missing.length) return ctx
    throw denied({
      message: `Forbidden: a "${ctx.kayan.name}" row may not assign role "${slug}", which holds ${missing.map((key) => `"${key}"`).join(', ')}, which the assigner does not hold.`,
      key: 'error.forbidden.assign',
      params: { kayan: ctx.kayan.name, permissions: missing, role: slug },
    })
  }
}

/**
 * The step after `grantedPermissions` in a role kayan's write lists: a tenant's role
 * row may not take a system role's name.
 */
export const writableRoleName =
  (roles: SystemRoles) =>
  (ctx: Ctx): Ctx => {
    const data = ctx.data as Record<string, unknown>
    const name = data[NAME] ?? ctx.dataBefore?.[NAME]
    if (typeof name !== 'string' || !Object.hasOwn(roles, name)) return ctx
    throw invalid({
      message: `A "${ctx.kayan.name}" row may not be named "${name}", which is a role this project ships: its keys are code, and a row of the same name would grant nothing and list beside it as though it did.`,
      key: 'error.invalid.system_role_name',
      params: { kayan: ctx.kayan.name, role: name },
    })
  }
