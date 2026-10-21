import { defaultFields, defaultGlobalFields, defaultGlobalOperations } from 'mithaq'
import { defineGlobal, organization, rows } from '@asas/mithaq'
import { backofficeClosed, tenantAccess } from '@asas/mithaq/roles/tenant-access.ts'
import { appPage, navGroups } from '@asas/mithaq/mithaq/pages.ts'

/**
 * The project's settings, one row per tenant, because this global places
 * `organization`. `asas.global.settings.operations.findOne({}, { actor })`
 * answers the active organization's row or null, and
 * `asas.global.settings.operations.update(data, { actor })` writes it, making it
 * on the first call.
 *
 * One row per tenant is two lines here, because nothing rewrites a global's
 * fields: the organization is unique, since it is the column that keeps the row
 * single, and `globalType` is not unique, since every tenant's row carries the
 * same name. `buildAsas` refuses either written the other way.
 */
export const settings = defineGlobal({
  name: 'settings',
  fields: {
    ...defaultFields,
    organization: { ...organization, rules: { ...organization.rules, unique: true } },
    // The site has no name of its own: it is the organization's, in every locale.
    maintenance: {
      kind: 'checkbox',
      label: { en: 'Maintenance', ar: 'الصيانة' },
      description: {
        en: 'While this is on, the portal tells students it is closed for maintenance. Staff keep working.',
        ar: 'ما دام هذا مفعلا، تخبر البوابة الطلاب بأنها مغلقة للصيانة. ويواصل الموظفون عملهم.',
      },
    },
    // Where a student writes to, the one address the portal shows: at its foot, and on its maintenance page.
    contactEmail: { kind: 'email', label: { en: 'Contact email', ar: 'بريد التواصل' } },
    // The column default is the one the table was made with, so the committed
    // migrations still describe it.
    globalType: { ...defaultGlobalFields.globalType, rules: { required: true, defaultValue: 'settings' } },
  },
  // Its own rows: the language's, and every backoffice role closed. The backoffice
  // lists no global, since a list across tenants reads by `find` and a global
  // declares none, so it reads none, 403 `error.forbidden.read`. A global takes
  // read and update alone, and the other two the rows compile are never reached.
  access: rows({ ...tenantAccess, ...backofficeClosed }) as Pick<ReturnType<typeof rows>, 'read' | 'update'>,
  targets: {
    service: { operations: defaultGlobalOperations },
    // A global is one row, so its page is a custom one with no id: its form
    // updates the row there is. Its fields in sections under its sentence, and the
    // yes or no setting a switch with its label beside it.
    dashboard: {
      nav: { icon: 'settings-2', group: navGroups.settings, order: -1 },
      description: {
        en: 'Where students reach the school, and whether the portal is open to them.',
        ar: 'أين يتواصل الطلاب مع المدرسة، وهل البوابة مفتوحة لهم.',
      },
      pages: {
        settings: {
          path: '/settings',
          page: appPage([{ layout: 'record', main: [{ form: [
            { section: 'contact', label: { en: 'Contact', ar: 'التواصل' }, fields: ['contactEmail'] },
            { section: 'availability', label: { en: 'Availability', ar: 'الإتاحة' }, fields: [{ field: 'maintenance', component: 'switch' }] },
          ] }] }]),
        },
      },
    },
  },
})
