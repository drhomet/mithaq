// The two page trees every kayan page of this project starts from, as plain
// functions rather than anything a page inherits: a shell at the root, the
// page's title in its header, the nav in its nav region where the shell has
// one, and what the page passes in its main region. The side-column shell draws
// its nav in the sidebar itself, so it has no nav region. A page that wants
// another header or no nav writes its tree out instead.

const holdsForm = (value: unknown): boolean =>
  Array.isArray(value) ? value.some(holdsForm) : !!value && typeof value === 'object' && ('form' in value || Object.values(value).some(holdsForm))

/**
 * A page in the side-column shell the dashboard and the backoffice register as
 * `app`. A page that holds a form draws the form's controls in the sticky
 * header beside its title, so where the row stands and its save stay on screen
 * on every tab.
 */
export const appPage = <const Main extends readonly unknown[], const More extends readonly unknown[] = readonly []>(main: Main, options?: { more?: More }) =>
  ({ shell: 'app',
    header: [
      // A list keeps its title and New action together in its own header.
      ...(main.some((node) => !!node && typeof node === 'object' && 'layout' in node && node.layout === 'table') ? [] : [{ title: {} }]),
    ],
    primary: holdsForm(main) ? [{ controls: {} }] : [],
    more: options?.more ?? [],
    main,
  }) as const

/** Secondary record actions, with Delete last and its irreversible confirmation kept. */
export const danger = <const Before extends readonly unknown[]>(...before: Before) =>
  [...before, { button: 'delete', label: { en: 'Delete', ar: 'حذف' } }] as const

/** A page in the top-bar shell the dashboard and the portal each register as `top`. */
export const topPage = <const Main extends readonly unknown[]>(main: Main) =>
  ({ shell: 'top', header: [{ title: {} }], nav: [{ nav: {} }], main }) as const

/**
 * A tenant kayan's list on the backoffice: every organization's rows in the
 * registry's list, read-only, the organization a column and a filter of each.
 * Each row opens its `backofficeRecord` below.
 */
export const backofficeList = <const List extends { readonly columns: readonly unknown[] }>(path: string, list: List) =>
  ({ list: { path, page: { ...appPage([{ layout: 'table', main: [{ list }] }]), header: [{ title: {} }] } } }) as const

/**
 * What every tenant kayan's record on the backoffice ends its side column with:
 * whose row it is and when it was written. No id: a record is read by its name,
 * and the address bar holds the id.
 */
const record = {
  section: 'record',
  label: { en: 'Record', ar: 'السجل' },
  fields: ['organization', 'createdAt', 'updatedAt'],
} as const

/**
 * A tenant kayan's record on the backoffice, which a row of its list opens: a
 * page that holds no form, so every leaf is drawn by its field's cell over the
 * row and nothing on it writes. The page is not called `edit`, since an edit
 * page holds exactly one form; the host opens a row on the page whose path
 * carries `:id` where a kayan has no edit page. `main` holds the sections the
 * dashboard's edit page draws the same fields in, and the side column ends with
 * the organization and the stamps. A field the report hides is not in the
 * projection, so it is not drawn.
 */
export const backofficeRecord = <const Main extends readonly unknown[], const Side extends readonly unknown[] = readonly []>({ path, main, side }: { path: string; main: Main; side?: Side }) =>
  ({ view: { path, page: appPage([{ layout: 'record', main, side: [...(side ?? []), record] }]) } }) as const

// add-on: audit-log
/**
 * The record's activity, which each dashboard edit page draws in its side
 * column, drawn only for an actor the access report lets read the log: one
 * without the key would otherwise see the panel say it could not read it. The
 * server still refuses the read whatever the page drew.
 */
export const activity = { component: 'activity', when: { '$user.collections.auditLog.operations.find': { equals: true } } } as const

/** The record's whole activity, searched, filtered and paged, in a tab of the edit page beside Versions, for the same actor. */
export const activityTab = {
  tab: 'activity',
  label: { en: 'Activity', ar: 'النشاط' },
  fields: [{ component: 'activityLog', when: activity.when }],
} as const
// end add-on: audit-log


/** Shared labels keep a group identical wherever a feature contributes an entry. */
export const navGroups = {
  work: { name: 'work', label: { en: 'Work', ar: 'العمل' }, order: 1 },
  library: { name: 'library', label: { en: 'Library', ar: 'المكتبة' }, order: 2 },
  people: { name: 'people', label: { en: 'People', ar: 'الأشخاص' }, order: 1 },
  organizations: { name: 'organizations', label: { en: 'Organizations', ar: 'المؤسسات' }, order: 2 },
  access: { name: 'access', label: { en: 'Access', ar: 'الوصول' }, order: 3 },
  audit: { name: 'audit', label: { en: 'Audit', ar: 'التدقيق' }, order: 4 },
  settings: { name: 'settings', label: { en: 'Settings', ar: 'الإعدادات' }, position: 'bottom' },
} as const
