// What each screen draws of the generated `organization` kayan, which `mithaq
// generate auth` imports into `./organization.ts` because this file sits beside
// it, spreading it into the kayan's `targets` after the generated titles of the
// screens it does not name, so the platform's block here is that screen's whole
// block, its title included, and the dashboard keeps the generated one. The
// platform lists every organization with the registry's list and renames it or
// opens its members from the slug column.
import { platformUi } from '../../../mithaq.ts'
import { appPage } from '../../../pages.ts'

export const screens = {
  platform: {
    useAsTitle: 'name',
    pages: {
      list: {
        path: '/organizations',
        page: appPage([{ layout: 'table', main: [{ list: {
          columns: ['name', { field: 'slug', cell: platformUi('organization-actions.tsx#OrganizationActions') }, 'createdAt'],
          filters: ['name', 'slug', 'createdAt'],
          search: ['name', 'slug'],
          sort: 'name',
        } }] }]),
      },
      // An organization's record, which a row opens and which only reads; its
      // rename and its members stay on the list's slug column.
      view: {
        path: '/organizations/:id',
        page: appPage([{
          layout: 'record',
          main: [{ section: 'organization', label: { en: 'Organization', ar: 'المؤسسة' }, fields: ['name', 'slug', 'logo', 'metadata'] }],
          // No id: the record is read by its name.
          side: [{ section: 'record', label: { en: 'Record', ar: 'السجل' }, fields: ['createdAt', 'updatedAt'] }],
        }]),
      },
    },
  },
} as const
