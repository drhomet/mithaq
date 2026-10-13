// What each screen draws of the generated `user` kayan, which `mithaq generate
// auth` imports into `./user.ts` because this file sits beside it, spreading it
// into the kayan's `targets` after the generated titles of the screens it does
// not name, so the platform's block here is that screen's whole block, its
// title included, and the dashboard keeps the generated one. The dashboard
// titles a person by name for its cells and pickers, and the platform lists
// every person with the registry's list and acts on each from its row's menu
// and its own page.
import { platformUi } from '@asas/mithaq'
import { appPage } from '@asas/mithaq/mithaq/pages.ts'

export const screens = {
  platform: {
    useAsTitle: 'name',
    pages: {
      list: {
        path: '/users',
        page: appPage([{ layout: 'table', main: [{ list: {
          columns: ['name', 'email', { field: 'role', cell: platformUi('user-actions.tsx#PlatformRole') }, 'banned', 'createdAt'],
          filters: ['name', 'email', 'role', 'banned', 'createdAt'],
          search: ['name', 'email'],
          sort: 'email',
          // Set role, ban and impersonate, after the row menu's View.
          menu: platformUi('user-actions.tsx#UserMenu'),
        } }] }]),
      },
      // A person's record, which a row opens and which only reads: every
      // column drawn by its cell, under the actions the row's menu offers, as buttons.
      view: {
        path: '/users/:id',
        page: appPage([{
          layout: 'record',
          main: [
            { component: platformUi('user-actions.tsx#UserButtons') },
            { section: 'person', label: { en: 'Person', ar: 'الشخص' }, fields: ['name', 'email', 'emailVerified', 'image'] },
            // The role by its label, where the column holds the slugs.
            { section: 'standing', label: { en: 'Standing on the platform', ar: 'الوضع في المنصة' }, fields: [{ field: 'role', cell: platformUi('user-actions.tsx#PlatformRole') }, 'banned', 'banReason', 'banExpires'] },
          ],
          // No id: a person reads the record by its name, and the address bar holds the id.
          side: [{ section: 'record', label: { en: 'Record', ar: 'السجل' }, fields: ['createdAt', 'updatedAt'] }],
        }]),
      },
    },
  },
} as const
