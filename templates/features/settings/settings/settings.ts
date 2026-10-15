import { defaultFields, defaultGlobalFields, defaultGlobalOperations } from 'mithaq'
import { defineGlobal, organization, rows } from '@asas/mithaq'
import { backofficeClosed, tenantAccess } from '@asas/mithaq/roles/tenant-access.ts'
import { appPage } from '@asas/mithaq/mithaq/pages.ts'

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
    siteTitle: {
      kind: 'text',
      label: { en: 'Site title', ar: 'عنوان الموقع' },
      // Trimmed, so a title of spaces is refused as required.
      rules: { required: true, trim: true, maxLength: 120 },
    },
    maintenance: {
      kind: 'checkbox',
      label: { en: 'Maintenance', ar: 'الصيانة' },
      description: {
        en: 'While this is on, the site tells visitors it is closed for maintenance.',
        ar: 'ما دام هذا مفعلا، يخبر الموقع زواره بأنه مغلق للصيانة.',
      },
    },
    // Where a visitor writes to, the one address the project shows.
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
      description: {
        en: 'How the site presents itself, and whether it is open to visitors.',
        ar: 'كيف يظهر الموقع، وهل هو مفتوح للزوار.',
      },
      pages: {
        settings: {
          path: '/settings',
          page: appPage([{ layout: 'record', main: [{ form: [
            { section: 'site', label: { en: 'Site', ar: 'الموقع' }, fields: ['siteTitle', 'contactEmail'] },
            { section: 'availability', label: { en: 'Availability', ar: 'الإتاحة' }, fields: [{ field: 'maintenance', component: 'switch' }] },
          ] }] }]),
        },
      },
    },
  },
})
