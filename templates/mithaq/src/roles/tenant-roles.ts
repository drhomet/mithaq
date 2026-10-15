import type { SystemRoles } from 'mithaq'
// without add-on: roles
// import { defaultMemberRoles } from './default-member-roles.ts'
// end without add-on: roles

// add-on: courses
/** A session's columns but its `enrollments`, which the registrar and the instructor read alike. */
const sessionColumns = [
  'sessions.fields.id',
  'sessions.fields.createdAt',
  'sessions.fields.updatedAt',
  'sessions.fields.organization',
  'sessions.fields.course',
  'sessions.fields.startsAt',
  'sessions.fields.capacity',
  'sessions.fields.venue',
  'sessions.fields.format',
  'sessions.fields.archived',
  'sessions.fields.archiveReason',
  'sessions.fields.details',
] as const

/** A course's cover, read and never changed, which the portal's roles read alike. */
const coverReads = [
  'media.find',
  'media.findByID',
  'media.fields.alt',
  'media.fields.createdAt',
  'media.fields.filename',
  'media.fields.filesize',
  'media.fields.height',
  'media.fields.id',
  'media.fields.key',
  'media.fields.mimeType',
  'media.fields.storage',
  'media.fields.organization',
  'media.fields.updatedAt',
  'media.fields.width',
] as const
// end add-on: courses

/**
 * The roles this project ships to every tenant, written in code and never a
 * row: the access target takes them whole and reads what each holds from here.
 * A page lists them from here too, which is why this file imports no server
 * code.
 *
 * A slug here is the whole vocabulary of role names: a row table may be keyed on
 * one of them or on `'*'` and on nothing else, and `buildAsas` refuses a key
 * that is not in this project's catalog exactly as it does for a row's own.
 *
 * The backoffice roles, `super_admin` among them, are not here: they are staff
 * above every tenant, held on Better Auth's `user.role`, and the access target
 * holds their keys in the backoffice app alone. Inside a tenant every actor, a
 * `super_admin` included, holds what its membership's roles hold and nothing
 * more.
 */
export const tenantRoles = {
  // add-on: roles
  // These are business roles and never governance, and the `roles` kayan holds
  // a tenant's own roles beside them; an assignment names one of either. Better
  // Auth's own `member.role`, which holds `owner`, `admin` or `member`, stays
  // what the provider uses for settings, members and invitations, and nothing
  // here reads it. Sharing one comma-joined column would inherit the provider's
  // own open comma-in-a-role-name bug.
  //
  // A new organization's creator is assigned `administrator` while the
  // organization is being created, by the hook the template wires into the
  // provider, so a fresh tenant has a root granter from its first moment. That
  // row is written straight through the store, because a managed create is
  // graded against the actor making it and the creator is in no organization
  // until that route puts it in one.
  /**
   * The tenant's root granter: every key of the project, which is what lets it
   * author a custom role at all. `'*'` holds every screen's key too, so it
   * enters the dashboard and the portal alike. It never reaches the backoffice
   * app, where the reader answers no membership role at all.
   * `grantedPermissions` returns early on a granter holding everything, so this
   * role and no other may hand out a key it will never use itself.
   */
  administrator: {
    label: { ar: 'مدير', en: 'Administrator' },
    permissions: '*',
  },
  /** Runs the catalogue in the dashboard: the courses, their sessions and the tags on them. */
  registrar: {
    label: { ar: 'مسجل', en: 'Registrar' },
    permissions: [
      'screen.dashboard',
      // add-on: courses
      'courses.create',
      'courses.find',
      'courses.count',
      'courses.findByID',
      'courses.update',
      // A course leaves the catalogue and comes back through its own operations, each with its reason.
      'courses.archive',
      'courses.unarchive',
      'courses.fields.archived',
      'courses.fields.archiveReason',
      'courses.fields.createdAt',
      'courses.fields.cover',
      'courses.fields.currency',
      'courses.fields.details',
      'courses.fields.fee',
      'courses.fields.id',
      'courses.fields.tags',
      'courses.fields.organization',
      'courses.fields.title',
      'courses.fields.updatedAt',
      // Whether a course is a draft, its versions and the restore of one: the
      // registrar edits the catalogue, so it reads a course's history and puts
      // an older copy back.
      'courses.fields._status',
      'courses.findVersions',
      'courses.findVersionByID',
      'courses.restoreVersion',
      'sessions.create',
      'sessions.find',
      'sessions.count',
      'sessions.findByID',
      'sessions.update',
      // The columns of each kayan it holds an operation of, without which every
      // read of it is refused for its fields and its pages draw nothing. Not a
      // session's `enrollments`, which reads a kayan this role does not.
      ...sessionColumns,
      // end add-on: courses
      'tags.find',
      'tags.count',
      'tags.findByID',
      'tags.fields.id',
      'tags.fields.createdAt',
      'tags.fields.updatedAt',
      'tags.fields.organization',
      'tags.fields.name',
      // add-on: media
      // The images a course's cover is picked from, which it uploads,
      // re-describes and deletes once no course points at one.
      'media.create',
      'media.find',
      'media.count',
      'media.findByID',
      'media.update',
      'media.delete',
      'media.fields.alt',
      'media.fields.createdAt',
      'media.fields.filename',
      'media.fields.filesize',
      'media.fields.height',
      'media.fields.id',
      'media.fields.key',
      'media.fields.mimeType',
      'media.fields.storage',
      'media.fields.organization',
      'media.fields.updatedAt',
      'media.fields.width',
      // end add-on: media
      // add-on: audit-log
      // The activity panel on each edit page it opens: the entries of the
      // kayan it lists, each change graded by the column's own key above.
      'auditLog.find',
      'auditLog.fields.id',
      'auditLog.fields.createdAt',
      'auditLog.fields.kayan',
      'auditLog.fields.record',
      'auditLog.fields.operation',
      'auditLog.fields.actor',
      'auditLog.fields.impersonatedBy',
      'auditLog.fields.changes',
      // end add-on: audit-log
    ],
  },
  // add-on: courses
  /**
   * Teaches: reads the catalogue and enrols. It holds no `courses.archive`. It
   * works in the portal, which draws the courses and the enrolments, and never
   * enters the dashboard.
   */
  instructor: {
    label: { ar: 'مدرس', en: 'Instructor' },
    permissions: [
      'screen.portal',
      'courses.find',
      'courses.count',
      'courses.findByID',
      'courses.fields.archived',
      'courses.fields.createdAt',
      'courses.fields.cover',
      'courses.fields.details',
      'courses.fields.id',
      'courses.fields.tags',
      'courses.fields.organization',
      'courses.fields.title',
      'courses.fields.updatedAt',
      // It reads published courses alone, and whether one is published with them.
      'courses.fields._status',
      'enrollments.create',
      'enrollments.find',
      'enrollments.count',
      'enrollments.findByID',
      // Every seat of its organization, not only its own
      'enrollments.others',
      // An enrollment's columns but the soft-delete mark, which the runner
      // writes, and a session's, which the enrollment's picker and cell read
      'enrollments.fields.id',
      'enrollments.fields.createdAt',
      'enrollments.fields.updatedAt',
      'enrollments.fields.organization',
      'enrollments.fields.session',
      'enrollments.fields.student',
      'sessions.find',
      'sessions.count',
      'sessions.findByID',
      ...sessionColumns,
      // The students of its organization by their id and name alone, which the
      // enrollment drawer's student picker lists and an enrollment's student is
      // titled by: `peopleAudience` in `tenant-access.ts` names whom it reads.
      'user.find',
      'user.count',
      'user.findByID',
      'user.fields.id',
      'user.fields.name',
      ...coverReads,
    ],
  },
  /**
   * Takes the courses: reads the catalogue in the portal, a course's cover
   * with it, and its own enrollments with the sessions they name. Not the
   * access code, which a course hands out to whoever it chooses, nor the
   * archive reason or the notifications, which are staff's.
   *
   * A role's keys reach every row of the organization, so the enrollment keys
   * alone would hand a student every other student's seat. The enrollments'
   * own access narrows them to the student's own seats, since it holds no
   * `enrollments.others`, and the sessions' to those of the courses it reads.
   * It reads no seat's `student`, which is itself on every row it reads, and
   * writes no enrollment.
   */
  student: {
    label: { ar: 'طالب', en: 'Student' },
    permissions: [
      'screen.portal',
      'courses.find',
      'courses.count',
      'courses.findByID',
      'courses.fields.id',
      'courses.fields.createdAt',
      'courses.fields.updatedAt',
      'courses.fields.organization',
      'courses.fields.title',
      'courses.fields.summary',
      'courses.fields.details',
      'courses.fields.cover',
      'courses.fields.fee',
      'courses.fields.currency',
      'courses.fields.level',
      'courses.fields.delivery',
      'courses.fields.audience',
      'courses.fields.opensOn',
      'courses.fields.archived',
      'courses.fields._status',
      'enrollments.find',
      'enrollments.count',
      'enrollments.findByID',
      'enrollments.fields.id',
      'enrollments.fields.createdAt',
      'enrollments.fields.updatedAt',
      'enrollments.fields.organization',
      'enrollments.fields.session',
      // The sessions its seats name, which the enrollment's session cell draws
      // by course and start.
      'sessions.find',
      'sessions.count',
      'sessions.findByID',
      ...sessionColumns,
      ...coverReads,
    ],
  },
  // end add-on: courses
  // end add-on: roles
  // without add-on: roles
  // ...defaultMemberRoles,
  // end without add-on: roles
} as const satisfies SystemRoles
