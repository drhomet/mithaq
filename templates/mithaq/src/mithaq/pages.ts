// The two page trees every kayan page of this project starts from, as plain
// functions rather than anything a page inherits: a shell at the root, the
// page's title in its header, the nav in its nav region where the shell has
// one, and what the page passes in its main region. The side-column shell draws
// its nav in the sidebar itself, so it has no nav region. A page that wants
// another header or no nav writes its tree out instead.

const holdsForm = (value: unknown): boolean =>
  Array.isArray(value) ? value.some(holdsForm) : !!value && typeof value === 'object' && ('form' in value || Object.values(value).some(holdsForm))

/**
 * A page in the side-column shell the dashboard and the platform register as
 * `app`. A page that holds a form draws the form's controls in the sticky
 * header beside its title, so where the row stands and its save stay on screen
 * on every tab.
 */
export const appPage = <const Main extends readonly unknown[]>(main: Main) =>
  ({ shell: 'app', header: holdsForm(main) ? [{ title: {} }, { controls: {} }] : [{ title: {} }], main }) as const

/**
 * What an edit page's danger zone holds: the buttons a page passes, which
 * change the row for everyone and can be taken back, first, and the delete
 * last, which cannot. Every edit page of the dashboard ends its record layout
 * with it, so the destructive buttons of every kayan sit in one place drawn one
 * way, and the form's own footer holds Cancel and Save alone. The delete's
 * confirm is a two-step dialog that says in both locales that it cannot be
 * undone.
 */
export const danger = <const Before extends readonly unknown[]>(...before: Before) =>
  [...before, { button: 'delete', label: { en: 'Delete', ar: 'حذف' } }] as const

/** A page in the top-bar shell the dashboard and the portal each register as `top`. */
export const topPage = <const Main extends readonly unknown[]>(main: Main) =>
  ({ shell: 'top', header: [{ title: {} }], nav: [{ nav: {} }], main }) as const

/**
 * A tenant kayan's list on the platform: every organization's rows in the
 * registry's list, read-only, the organization a column and a filter of each.
 * Each row opens its `platformRecord` below.
 */
export const platformList = <const List extends { readonly columns: readonly unknown[] }>(path: string, list: List) =>
  ({ list: { path, page: appPage([{ layout: 'table', main: [{ list }] }]) } }) as const

/**
 * What every tenant kayan's record on the platform ends its side column with:
 * whose row it is and when it was written. No id: a record is read by its name,
 * and the address bar holds the id.
 */
const record = {
  section: 'record',
  label: { en: 'Record', ar: 'السجل' },
  fields: ['organization', 'createdAt', 'updatedAt'],
} as const

/**
 * A tenant kayan's record on the platform, which a row of its list opens: a
 * page that holds no form, so every leaf is drawn by its field's cell over the
 * row and nothing on it writes. The page is not called `edit`, since an edit
 * page holds exactly one form; the host opens a row on the page whose path
 * carries `:id` where a kayan has no edit page. `main` holds the sections the
 * dashboard's edit page draws the same fields in, and the side column ends with
 * the organization and the stamps. A field the report hides is not in the
 * projection, so it is not drawn.
 */
export const platformRecord = <const Main extends readonly unknown[], const Side extends readonly unknown[] = readonly []>({ path, main, side }: { path: string; main: Main; side?: Side }) =>
  ({ view: { path, page: appPage([{ layout: 'record', main, side: [...(side ?? []), record] }]) } }) as const

// add-on: audit-log
/**
 * The record's activity, which each dashboard edit page draws in its side
 * column, drawn only for an actor the access report lets read the log: one
 * without the key would otherwise see the panel say it could not read it. The
 * server still refuses the read whatever the page drew.
 */
export const activity = { component: 'activity', when: { '$user.collections.auditLog.operations.find': { equals: true } } } as const
// end add-on: audit-log
