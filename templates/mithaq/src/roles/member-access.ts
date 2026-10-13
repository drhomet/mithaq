import { memberRoleTarget } from 'mithaq'
import { systemRoles } from './system-roles.ts'
import { assignedRoles, tenantAccess } from './tenant-access.ts'

/**
 * The access target of a project without the roles add-on, under which a member holds what
 * Better Auth's own `member.role` names in the organization, owner, admin or
 * member, and no custom role or assignment table exists. The roles add-on
 * swaps it for `rbacTarget` over its `roles` and `memberRoles` kayan.
 */
export const accessTarget = (roles: typeof systemRoles = systemRoles) => memberRoleTarget({ roles, rolesOf: assignedRoles, access: tenantAccess })
