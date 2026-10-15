import type { SystemRoles } from 'mithaq'

/** One kayan read whole on the backoffice: its list, its count, one row, and each column named. */
const reads = (kayan: string, fields: readonly string[]) => [`${kayan}.find`, `${kayan}.count`, `${kayan}.findByID`, ...fields.map((field) => `${kayan}.fields.${field}`)]
const stamps = ['id', 'createdAt', 'updatedAt'] as const

/**
 * The columns of a kayan the backoffice lists that no staff role reads, each
 * one a decision written down rather than a name left out. No backoffice role
 * reads one, `super_admin`'s `'*'` included: the backoffice's row closes each
 * by name whatever keys the actor holds.
 */
export const secret: readonly `${string}.fields.${string}`[] = [
  // add-on: courses
  // The code a live course's learners join with, a tenant's secret.
  'courses.fields.accessCode',
  // end add-on: courses
]

/**
 * The kayan the backoffice lists that no staff role reads at all, a decision
 * about the whole kayan rather than about its columns: no staff role holds a
 * key of one, and only `super_admin`'s `'*'` lists it. `localUsers` is read
 * and verified by a super admin alone, which the kayan's own access says, so a
 * key here would grant support or explorer nothing, and its protected columns
 * are closed to every reader by the provider.
 */
export const superAdminOnly = ['localUsers'] as const

/** The people, the organizations and their members, which the provider owns. */
const people = [
  ...reads('user', [...stamps, 'name', 'email', 'emailVerified', 'image', 'role', 'banned', 'banReason', 'banExpires']),
  ...reads('organization', [...stamps, 'name', 'names', 'slug', 'logo', 'metadata']),
  ...reads('member', [...stamps, 'organizationId', 'userId', 'role']),
]

/** Each tenant's business, across every organization. */
const business = [
  // add-on: courses
  // Every column but the one `secret` names.
  ...reads('courses', [...stamps, 'organization', 'title', 'summary', 'details', 'cover', 'fee', 'currency', 'level', 'notifications', 'delivery', 'audience', 'archived', 'topics', 'opensOn', 'archiveReason', 'tags', 'scheduledSessions', '_status']),
  // A course's versions, each cut to the columns above, so staff read a
  // draft's history across every organization and restore none of it: no
  // staff role but `super_admin`'s `'*'` holds `courses.restoreVersion`.
  'courses.findVersions',
  'courses.findVersionByID',
  ...reads('sessions', [...stamps, 'organization', 'course', 'startsAt', 'capacity', 'venue', 'format', 'archived', 'details', 'enrollments', 'archiveReason']),
  ...reads('enrollments', [...stamps, 'organization', 'session', 'student', 'deletedAt']),
  // end add-on: courses
  ...reads('tags', [...stamps, 'organization', 'name']),
]

/** Who holds what inside each tenant: its role rows and its assignments. */
const grants: string[] = [
  // add-on: roles
  ...reads('roles', [...stamps, 'organization', 'name', 'label', 'permissions']),
  ...reads('memberRoles', [...stamps, 'organization', 'user', 'role']),
  // end add-on: roles
]

/**
 * The staff history: who impersonated whom, set whose backoffice role and banned whom. Only a role
 * that reads the whole backoffice reads it, never one that does the impersonating.
 */
const history: string[] = [
  // add-on: audit-log
  ...reads('backofficeLog', ['id', 'createdAt', 'action', 'actor', 'actorEmail', 'target', 'targetEmail', 'previousRole', 'role', 'reason']),
  // end add-on: audit-log
]

/**
 * The backoffice roles: staff above every tenant, held on Better Auth's own
 * `user.role` rather than on a tenant's assignment. The column may hold several,
 * comma-separated, which is how the admin plugin reads it.
 *
 * Each holds catalog keys the way a tenant role does, and the access target
 * holds them only in the backoffice app: in the tenant app an actor holds its
 * membership's roles in its active organization and nothing of these. The
 * admin plugin's own roles are built from the same lists below, so the routes
 * that set a role, ban and impersonate refuse what the list does not name.
 *
 * `organization.rename` is this template's own statement, added beside these in
 * `asas.ts`. Every read is a kayan's own keys: its list, its count and one row,
 * and one key per column, since a backoffice role reads a column only where it
 * holds that column's key. A project adds its own backoffice role, `billing` say,
 * as one more entry here.
 */
export const backofficeRoles = {
  /** Every key, and so the only role that grants a backoffice role, `user.set-role`, and renames an organization, `organization.rename`. */
  super_admin: {
    label: { ar: 'مدير لوحة الإدارة الخلفية', en: 'Backoffice administrator' },
    permissions: '*',
  },
  /**
   * Reads the people, the organizations and each tenant's business, and
   * impersonates a tenant's user. It bans no one, sets no role, renames no
   * organization, and reads no tenant's roles: it sees those by impersonating.
   */
  support: {
    label: { ar: 'الدعم', en: 'Support' },
    permissions: ['screen.backoffice', 'user.impersonate', ...people, ...business],
  },
  /** Reads everything on the backoffice, each tenant's roles and the staff history included, and changes nothing. */
  explorer: {
    label: { ar: 'مستكشف', en: 'Explorer' },
    permissions: ['screen.backoffice', ...people, ...business, ...grants, ...history],
  },
} as const satisfies SystemRoles
