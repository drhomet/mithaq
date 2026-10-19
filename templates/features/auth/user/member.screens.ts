// What the backoffice draws of the generated `member` kayan, which `mithaq
// generate auth` imports into `./member.ts` because this file sits beside it:
// every organization's members, each by the person's and the organization's name,
// filtered to one organization from that organization's row.
import { backofficeUi } from '@asas/mithaq'
import { appPage, navGroups } from '@asas/mithaq/mithaq/pages.ts'

/** The provider's governance role by the project's word for it, never its slug. */
const role = { field: 'role', cell: backofficeUi('role-cells.tsx#MembershipRole') } as const

export const screens = {
  backoffice: {
    nav: { group: navGroups.access },
    // A membership's record is titled by its person.
    useAsTitle: 'userId',
    pages: {
      list: {
        path: '/members',
        page: appPage([{ layout: 'table', main: [{ list: {
          columns: ['userId', 'organizationId', role, 'createdAt'],
          filters: ['organizationId', 'userId', 'role', 'createdAt'],
          // A membership is looked for by its person.
          search: ['userId.name', 'userId.email'],
          sort: '-createdAt',
        } }] }]),
      },
      // A membership's record, which a row opens and which only reads.
      view: {
        path: '/members/:id',
        page: appPage([{
          layout: 'record',
          main: [{ section: 'membership', label: { en: 'Membership', ar: 'العضوية' }, fields: ['userId', 'organizationId', role] }],
          side: [{ section: 'record', label: { en: 'Record', ar: 'السجل' }, fields: ['createdAt', 'updatedAt'] }],
        }]),
      },
    },
  },
} as const
