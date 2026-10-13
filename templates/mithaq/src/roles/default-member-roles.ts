import type { SystemRoles } from 'mithaq'

/**
 * Better Auth's own organization roles, `owner`, `admin` and `member`, as the
 * roles a project without the roles add-on ships: the access target answers a
 * member the ones its `member.role` names in that organization. An owner and an
 * admin hold every key of the project, and a member reads the tags and changes
 * nothing. A kayan added later is the owner's and the admin's alone until its
 * keys are listed under `member` here; the roles add-on brings roles a tenant
 * writes itself.
 */
export const defaultMemberRoles = {
  owner: { label: { ar: 'مالك', en: 'Owner' }, permissions: '*' },
  admin: { label: { ar: 'مشرف', en: 'Admin' }, permissions: '*' },
  member: {
    label: { ar: 'عضو', en: 'Member' },
    permissions: [
      'screen.dashboard',
      'tags.find',
      'tags.count',
      'tags.findByID',
      'tags.fields.id',
      'tags.fields.createdAt',
      'tags.fields.updatedAt',
      'tags.fields.organization',
      'tags.fields.name',
    ],
  },
} as const satisfies SystemRoles
