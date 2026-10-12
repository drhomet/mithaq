// What a page asks before it offers a role or a key, measured the way the
// server measures the write it would make. It imports nothing at runtime, so a
// page's chunk takes no server module with it, and the server's own guards
// import the same functions.
import type { AccessReport } from 'mithaq/admin'
import type { tenantRoles } from '../roles.ts'

/**
 * Whether the viewer may hand over these keys, as a role or one at a time,
 * measured the way the server's guards measure it: a root granter anything,
 * anyone else only keys it holds, and `'*'` only a root granter. Keys the
 * viewer may not read are not grantable. The server refuses a wrong answer here
 * either way.
 */
export const grantable = (access: AccessReport, keys: readonly string[] | undefined): boolean => {
  const held = access.permissions
  if (held === '*') return true
  return held !== undefined && keys !== undefined && keys.every((key) => key !== '*' && held.includes(key))
}

/** The keys that let their holder change who holds which role, or what a role holds. */
const managing = ['*', 'roles.create', 'roles.update', 'roles.delete', 'memberRoles.create', 'memberRoles.update', 'memberRoles.delete']

/**
 * Whether a role holding these keys is what lets its holder manage roles. The
 * Members page's sheet disables a member's own such role, and the assignment
 * kayan refuses its removal, so the box and the refusal are one rule.
 */
export const managesRoles = (keys: '*' | readonly string[]): boolean => keys === '*' || keys.some((key) => managing.includes(key))

/**
 * Better Auth's creator role, the organization's owner: `creatorRole`, which
 * this project leaves at the provider's default. The provider keeps it already:
 * nobody but an owner removes or demotes one, and the last one never leaves.
 */
export const OWNER = 'owner'

/** The role of this project's that an owner always holds in its tenant. */
export const OWNER_ROLE = 'administrator' satisfies keyof typeof tenantRoles

/**
 * Whether a Better Auth `member.role` names the owner. Several roles are one
 * column, comma-joined, and the name is matched exactly, untrimmed, the way the
 * provider's own owner checks match it: a spaced or cased name the provider does
 * not treat as an owner is no owner here either.
 */
export const isOwner = (memberRole: unknown): boolean => typeof memberRole === 'string' && memberRole.split(',').includes(OWNER)
