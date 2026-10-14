import type { TenantTarget } from '../../mithaq/language.ts'

/**
 * The tenant target over Better Auth's organizations, laid down under `targets.tenant`.
 * A tenant-owned kayan places its field, `organizationId: tenant.field`.
 */
export const betterAuthTenant = <const RelationTo extends string>({
  relationTo,
  onDelete,
  platform,
  organizations,
}: {
  /** The kayan a row's tenant is, Better Auth's `organization`. */
  relationTo: RelationTo
  /** `restrict`: a tenant still holding a row is not deleted. */
  onDelete: 'restrict'
  /**
   * Whether this actor is platform staff in the trusted platform app, who may read every
   * tenant with `tenant: 'all'`. The answer is the project's: it decides which app is trusted.
   */
  platform?: (args: { user: unknown }) => boolean | Promise<boolean>
  /**
   * How many organizations the project holds: `'many'`, or one, shown (`'one'`) or hidden
   * (`'none'`). Every mode keeps the field and the scope; in `'one'` and `'none'` a `connect()`
   * refuses to start over more than one.
   */
  organizations: 'none' | 'one' | 'many'
}): TenantTarget<RelationTo> => {
  if (typeof relationTo !== 'string' || !relationTo) {
    throw new Error('betterAuthTenant needs relationTo, the name of the kayan a row\'s tenant is, such as "organization".')
  }
  // `cascade` deletes rows in the database, where no step runs and no file or audit follows them,
  // and `set null` leaves rows that no tenant owns and no one can read.
  if (onDelete !== 'restrict') {
    throw new Error(`betterAuthTenant takes onDelete: 'restrict' alone, and was handed ${JSON.stringify(onDelete)}.`)
  }
  if (!['none', 'one', 'many'].includes(organizations)) {
    throw new Error(`betterAuthTenant takes organizations: 'none', 'one' or 'many', and was handed ${JSON.stringify(organizations)}.`)
  }
  return {
    capability: 'tenant',
    relationTo,
    onDelete,
    organizations,
    ...(platform && { platform }),
    field: {
      kind: 'relationship',
      relationTo,
      rules: { required: true, index: true, providedBy: { create: 'application', update: 'never' }, onDelete },
      targets: { tenant: true },
    },
  }
}
