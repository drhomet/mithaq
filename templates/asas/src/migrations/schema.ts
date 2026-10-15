// Written by `mithaq migrate`. Commit it.
// Every table the language built, named one per line. drizzle-kit reads named
// exports alone: an object export contributes no table and reports no changes
// forever, and a partial export still emits foreign keys to the tables it left
// out. `mithaq migrate` rewrites this file when a kayan is added or removed.
import { asas } from '../asas.ts'

export const {
  user,
  session,
  account,
  verification,
  organization,
  organizationRole,
  member,
  invitation,
  localUsers,
  roles,
  memberRoles,
  tags,
  media,
  courses,
  sessions,
  enrollments,
  auditLog,
  backofficeLog,
  settings,
  courses_tags,
  _courses_versions,
} = asas.targets.drizzle.tables
