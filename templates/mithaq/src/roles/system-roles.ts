// The subpath, so a page piece reading the fixed roles' labels loads no server code.
import { backofficeRoles } from '../mithaq/auth/backoffice-roles.ts'
import type { SystemRoles } from 'mithaq'
import { tenantRoles } from './tenant-roles.ts'

export { tenantRoles }

/**
 * Every role this project ships, the backoffice's and the tenants', which is what
 * the access target takes whole: it holds a slug's keys wherever the project's
 * reader answers it. The backoffice roles are the auth setup's, because the column
 * they live on is Better Auth's own `user.role` and the admin plugin's roles are
 * built from the same lists. The reader answers them in the backoffice app alone,
 * and an assignment never names one.
 */
export const systemRoles = { ...backofficeRoles, ...tenantRoles } as const satisfies SystemRoles
