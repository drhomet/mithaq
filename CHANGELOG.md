# Changelog

## 0.3.5

- Whole-record delete actions and confirmations use solid red with readable text in light and dark themes. Record buttons can declare `destructive: true`; inline row and chip removes retain their colours.
- Required option fields start on their default or an empty placeholder and offer no Clear. Optional selects and comboboxes keep Clear.
- Relationships offer `+` for actors allowed to create the related kayan, with `allowCreate: false` as a field opt-out. A screen's `quickCreate: { fields: [...] }` declares its short form, typed and checked against create fields; otherwise the full create form opens. Successful creates are selected; refusals stay inside the drawer and conditionally hidden fields stay out of requests. The starter's tags declare a quick form. Regenerate screens and merge held admin pieces as described in the [admin guide](packages/mithaq-admin/README.md#relationship-quick-create-and-required-choices). No migration is needed.

- Preserve every 0.3.4 text-format bit in the default policy. Clean pasted formatting against the field policy before emitting JSON, including table dimensions, links, indentation and code metadata. Unset styles inherit CSS, inline nodes cannot override direction, and link popovers follow ancestor scrolling. Rich-text projects must install the full Lexical peer set; the 0.3.4 upgrade steps now name it explicitly.

- Rich-text projects select installed features, and fields may narrow them. Type checking and generation refuse uninstalled names; server validation enforces each field's nodes, formats and fixed style choices.
- Refreshed grouped toolbar, tooltips, link popover, wide-screen selection tools and form-sized headings. Added optional tables, code blocks with lazy highlighting, safe markdown shortcuts, display-only counters, token styling and per-block direction overrides. Existing Lexical JSON and mithaq UploadNode images remain readable.
- `create-mithaq --rich-text=tables,code,styling,markdown,counter` writes the selected tools into project config. Default rich-text projects keep their current tools and the new look. Regenerate screens on upgrade; merge any held rich-text copies and install the new optional Lexical peers. No database migration is needed. MIT notices for shadcn-editor and Lexical now ship with the packages.

## 0.3.4

- Kayan and own-page navigation can declare `nav.icon`, a serializable name from `screenTarget.icons`, implemented in the app's `components.icons` map. Screen builds refuse undeclared names before generation, and the language's typed components map requires every declared icon. Named imports keep unused icons out of the bundle. `checkComponents` refuses unregistered names at boot, including hidden entries.
- The starter declares its existing icons and draws them in the sidebar, phone sheet, home summary cards and backoffice. Entries without a declaration keep the previous path icon, then `Table2`. Existing projects can adopt the starter's `ui/nav-icons.ts`, register their icons in each host's components map and merge the resolver in `ui/app-shell.tsx`. No migration is needed.

## 0.3.3

- Fixed native auth submissions before hydration or with JavaScript disabled. Passwords, confirmation, setup codes and personal values now submit in POST bodies rather than URL queries. Other shipped native forms also explicitly use POST.
- Existing projects must merge their held auth forms and shared `AuthForm`; installing dependencies does not rewrite starter or ejected files. `mithaq upgrade --check` flags old unmarked starter auth forms as `unsafe form` and reports changed held pieces. Follow the [0.3.3 upgrade guide](packages/mithaq-admin/README.md#upgrading-032-projects-to-033).
- ChoosePassword requires the project's `setPasswordState` Better Auth plugin. Projects with their own provider must add and register the starter's server-only plugin before merging the password-link pages; otherwise both pages fail to load. See the 0.3.3 upgrade guide above.
- Operators should assess prior exposure privately, rotate passwords or setup codes that may have entered URLs, revoke affected sessions and reset links, and restrict or remove retained credential-bearing history and logs according to their retention requirements. Do not paste those URLs or logs into issues, support messages or other shared channels.

## 0.3.2

- Lists default to `phone: 'cards'`. Declare `phone: 'table'` for a visible-header table that scrolls inside its frame below 640px, with 44px targets. It cannot declare `card`, and there is no runtime layout switch. The sessions examples use it in both hosts.
- A list may name `card`, up to three of its non-title columns in phone detail order. Hidden or unreadable columns stay absent. Without it, cards keep the first three visible details. Tables from 640px upward are unchanged.
- The published mithaq package now includes `CHANGELOG.md` beside its guides.
- Projects with ejected lists merge `list.tsx`, `list-table.tsx` and `list-table.css` to use `card`; see the [upgrade guide](packages/mithaq-admin/README.md#upgrading-031-projects-to-032). The courses example declares card fields in both the tenant and backoffice lists.

## 0.3.1

### Upgrade notes

- Lists use stacked cards below `sm`, with declared detail labels, sorting, selection and row menus. Desktop and tablet tables keep their existing layout.

- Admin screens now start with phone layouts, and long select and combobox values stay readable. Existing 0.3.0 projects need manual merges; follow the [mithaq-admin upgrade guide](packages/mithaq-admin/README.md#upgrading-030-projects-to-031).

## 0.3.0

### Upgrade notes

- The roles add-on's tenant directory now uses shared `mithaq-admin/members.tsx` components. It searches names and email, filters roles, sorts names and dates, counts matches and pages provider-backed rows. All custom-role pages are read for directory filters and role assignment. Existing apps can replace their copied presentation with `Members` and supply authorized rows and explicit `MembersOptions`.
- Members open `/members/:id` under the screen path. Identity includes joined date and authorized last seen. Role assignment and permission summaries are on this page; summaries require `roles.find`, and Save and Cancel require assignment write access. Held-role summaries open by default; other summaries can be expanded before assigning a role. `MemberPage` accepts children for app sections such as Shops. Adopt the template's member route and loader; update links that previously opened `?member=<id>` and remove the old role drawer.
- Assignment guards remain enforced by the existing server operations. After a partial save failure, the page shows the actual applied assignments and the refusal. Successful saves remain on the member page. Row opening and Cancel use host-routed links; the duplicate Edit roles row action is removed.
- Fixed and custom roles show assigned-member counts after authorized provider and assignment reads. Owners count toward their implicit administrator role. Unreadable assignment user or role fields and failed counts show a dash, with a message on failure. Counts reload only when directory read permissions change. Fixed roles open `/roles/fixed/:name` read-only; custom roles open their existing editor.
- Permission editing uses grouped checkboxes with expandable field access. Read-only summaries group the held permissions by area. An existing custom wildcard grant can be removed in the editor. Import `RoleForm`, `Permissions` and `RolesTable` from mithaq-admin and keep the app's grant policy and extra statements in its wrappers. Add Arabic and English copy for `dashboard.rolesCountsFailed`.
- `LoaderTools.params` now supplies matched screen-page URL parameters. Parameterized page loaders need the updated `src/screens.tsx` host. Ejected member and role components need the corresponding registry changes; no database migration is needed.
- Screen navigation accepts `nav.hidden`, `nav.order` and `nav.group` on kayan screen targets, and an optional localized `nav.label`, plus the same keys on own pages. Groups carry a name, localized label, optional order and optional `position: 'bottom'`. Permission pruning precedes grouping; hidden entries stay in `useNav()` and `screen.nav` for home cards, activity filters and page titles; every navigation menu filters them out. Their routes and authorization stay in place. Update shells to use the ordered navigation. The template's `ScreenNav` filters hidden destinations; `openRow` from `mithaq-admin/list.tsx` forwards row activation to host-routed anchors.
- Tenant and backoffice examples group their navigation, with tenant Settings at the bottom. Port the template's `ui/app-shell.tsx` grouping and `mithaq/pages.ts` declarations when adopting this layout.
- The tenant example imports `mithaq-admin/theme.css` for a neutral canvas, raised dark content and cards, readable dark separators and native `color-scheme`. The system theme remains the default. Palette variables and `color-scheme` live on `:root` and `:root.dark` so portaled controls inherit them. Layout and tab rules are unlayered under `[data-shell="app"]`; control typography and target sizes stay in the `components` layer so app utilities override those rules. The unlayered tenant input, textarea and select-trigger rules override app utility classes for border, inline padding and background. Import it in tenant hosts only; keep app-specific accent colours and light tokens. The backoffice retains its own preset, tokens, component styles, spacing and `components.json`; empty record values retain their original line height.
- The tenant stylesheet sets `--app-control-radius: 0.5rem` only on tenant button, input, input-group, textarea, combobox-chips and select-trigger elements, including button triggers for popovers and dropdown menus. Port `--radius-4xl: var(--app-control-radius, calc(var(--radius) + 16px))` into the host's `@theme inline` block; do not set the control variable on `:root` or the shell. Tenant textareas also receive an unlayered 8px border radius because their `rounded-xl` utility does not read the control variable. These controls use 8px corners while badges, toggles, tab lists and explicit radius utilities keep their shapes. Cards use 12px corners and controls have 44px phone targets. It removes the visual boxes around loose fields and form actions. Template pages no longer emit `data-region="danger"`; merge ejected `nodes.tsx`, `form.tsx` and field renderers, and review custom styles that depend on their old wrappers.
- In the tenant stylesheet, lists stop at 1200px and simple records at 840px. Records with a side column use 1200px. Desktop gutters are 24px, phone gutters 16px with no outer inset frame. Set `--app-sidebar-width` to change the tenant sidebar width. Port the shell markers and import the tenant stylesheet; dense tables may use a custom full-width layout.
- Shared record tab strips leave padding and overflow to each host. List tabs keep their overflow utilities; the tenant stylesheet supplies scrolling and underline space without changing backoffice record tab heights.
- `PageHeader` and `MoreActions` in `mithaq-admin/page-header.tsx` share breadcrumb, title, primary action and secondary actions. Template records put secondary actions in More above their tabs on desktop; on phones More joins the fixed form bar after hydration. Lists put title and New together. Adopt `appPage(main, { more })` and the shell's `primary` and `more` regions. After mount, form controls and More share one action row; autosaving forms omit Back to list when the header draws a breadcrumb. Tenant lists keep the title in their list header; backoffice lists keep their shared header title. App pages can pass `breadcrumb: { href, label }` to `AppShell`; member pages put Save and Cancel in `primary`, with Save naming the member form id and both actions in the phone bar. The backoffice keeps its breadcrumb in the record body and its user actions at the start of the record main region.
- `FieldValue` renders a description list. Forms denied their create or update operation render values without Save, and do not autosave. Merge ejected `field-value.tsx` and `form.tsx`; the empty-value dash is rendered by `FieldValue`. The template role form also reads names and permissions without editor controls when update is denied; merge its `roles/ui/role-form.tsx`.
- Record tabs and list status tabs use `TabStrip`, with a uniform line style in the tenant stylesheet. The backoffice keeps its default tab height and selected appearance; the tenant underline rule does not apply there. Record selection lives in `#tab.<first-declared-tab>=<selected-tab>`; inactive values stay mounted, hidden or unknown selections fall back to the first visible tab, and focus or selection scrolls within the strip. Merge ejected `node-groups.tsx` and `list.tsx`; list tab query URLs remain valid.
- Add translations for `admin.more` and `admin.moreActions` when porting the header into an existing project.
- Run `mithaq upgrade --check` and merge the held `src/screens.tsx` change and any ejected pieces above.
- Run `mithaq generate screens` after changing navigation and adding member or fixed-role routes, then review both hosts at desktop and phone widths.


## 0.2.2

### Upgrade notes

- Run `mithaq upgrade --check` and merge the changes into the held `src/screens.tsx` and any ejected `list.tsx`, `operation-button.tsx`, `form.tsx`, `node-groups.tsx` and `list-table.tsx`. Record-action dialogs and parent refreshes after child writes live in the screen host; an older copy still compiles but misses these fixes.
- Regenerate screens. Text fields with declared options now use selects, text arrays with options use checkbox groups, and literal create defaults are projected into screens.
- Create forms display and send declared defaults. Publishing a new record leaves its status to the server. Datetime defaults serialized into screens are restored as `Date` values.
- New, the relationship picker's "+" and uploads require an operation named `create`. Another operation with a create effect does not enable them.
- Create-effect operation dialogs start from declared defaults, with `false` for checkboxes and `[]` for required text arrays. Their fields scroll within the viewport while the footer stays reachable, with room for input focus rings. Standalone dialogs drop the generic row-selection sentence.
- Optional selects offer Clear to return to an empty `null` value after a choice. Bulk-update selects, including required fields, offer Leave as is. Clearing a bulk field leaves each ticked row unchanged.
- Phone layouts use `min-w-0` to keep nested tables within the page and scrolling tab strips with space for the active underline.
- `ControlProps` gains optional `id`, `describedBy` and `form` props. Custom controls should put them on their input as `id`, `aria-describedby` and `form`.
- Time controls show Latin digits in every locale.
- Date pickers wait until mount to show the local day and hydrate consistently across locale formats.
- Refusal copy may use `{param}` placeholders for the server's message parameters.
- Apps may delete the unused `admin.toolbarWarning` and `admin.operationWarning` copy keys.

## 0.2.1

Documentation only; no code changed. The guides that ship in the package now cover every 0.2.0 change: the [0.1.1 to 0.2.0 upgrade guide](templates/asas/README.md#011-to-020), the whole store contract, the store adapter's named defaults, the nested message format with `$value`, and the query limits. This changelog starts.

## 0.2.0

Changes since 0.1.1. Existing projects should follow the [0.1.1 to 0.2.0 upgrade guide](templates/asas/README.md#011-to-020) before deploying.

### Breaking

- Message JSON files are nested, with locale leaves and `$value` for a parent's own message. Names starting with `$` are reserved. Load files through `flattenMessageFile`, as the app's `copyFile` does, before regenerating; flat files still read for this release. Page about text moves to `<kayan>.page.description`, and every locale needs `error.conflict.target` copy.
- A global's `update` call is typed from its declared input. Its first save still uses the create shape and can reject required update-only keys; the upgrade guide links the open first-save issue.
- Core lower-cases UUID ids and relationship values before access and steps, and normalizes UUID filters too. An HTTP read's `limit`, when supplied, must be an integer in `1..maxLimit`; `0` is refused, so callers read page by page.
- The Postgres store takes `drizzleKinds`, `drizzleRules` and `drizzleIdKinds` directly in `drizzleAdapter`; `zodTarget` is called with its corresponding maps. `betterAuthTenant` requires `newRows: 'active'` and `organizations: 'one' | 'many'`, and throws if either is missing or invalid. Step store calls take kayan declarations. Custom stores implement `upsert`, `sum` and all four row-lock modes.
- The admin is the `mithaq-admin` package. Apps use its components map for controls, cells and nodes, spread rich-text and upload maps explicitly, and use `mithaq/vite` for ejected pieces. Rich text is imported from `mithaq/rich-text` and Lexical is an optional peer. The starter separates the language, features and asas, with configurable generator paths.
- The staff console is renamed to backoffice, including its target, app, routes, permission keys, environment variable and session cookie. It requires a separate origin and, off this machine, a separate host. Remote auth URLs require `BETTER_AUTH_SECRET` even outside production.
- Organization mode `'none'` becomes `'one'` with `showOrganization: false`. Many organizations require verified addresses, and production requires a mailer in every mode. In `src/mail/`, `configuredMailer` is a function and `resendMailer` takes `baseURL`. Verified sign-up asks for name and address; a mailed link lets the person choose a password. First-run takes the one organization's names from `organizationName` in code. Organization rows gain names in every locale, with role keys and a migration to match; names are one line of at most 100 characters. Apps supply `no-organization.tsx`, `showLocale` and the updated auth copy and pages.
- Relationships restrict deletion by default, including sets, uploads and references in the latest draft. A student has one standing seat per session. Courses gain `selfEnroll`; settings use the organization's name in place of their old title column. Existing data needs the migrations and checks in the upgrade guide.
- Every HTTP plug, auth and storage names `maxBodyBytes`; every HTTP plug names `onError`. JSON `maxBytes` counts UTF-8 bytes, and `like` accepts at most 1000 words. The `json` kind adds vocabulary for a signed lock to approve. Audit `changes` becomes JSON and replaces the separate list of changed fields, with a guarded data migration and path queries.
- Each `in` or `not_in` in a caller's query holds at most 1,000 values; a `where` holds at most 200 field, `and` and `or` nodes in total, however nested. Split larger queries into separate requests within these bounds; combine alternatives by union and conjunctions or `not_in` chunks by intersection.

### Added

- `create-mithaq` offers minimal, full or selected add-ons, monorepo or single-package layouts, and installs with npm, pnpm, Yarn 1 or Bun. `dev:setup` prepares a fresh local database and its dev administrator, with optional sample rows.
- Organization first-run, invitation and open sign-up modes, invitation limits and server-side acceptance, Add person, password links, and a page for people in no organization. Member visibility follows permissions and audience rules.
- The Members page lists members and invitations with row actions and role editing. Records have searchable activity, the dashboard has an organization-wide Activity page, and the backoffice keeps staff history.
- The student portal supports self-enrollment within session capacity, with course and session details and maintenance settings. Records expose draft, published, changed and archived states, with archive, unarchive and unpublish actions.
- The `json` kind stores JSON in `jsonb`, validates optional JSON Schema, queries dotted paths under field access and tenant scope, and draws a JSON editor. Audit entries bound large change values.
- Steps can hold rows, apply integer `$inc`, upsert by a unique key and read exact sums. Deadlocks and serialization failures, SQLSTATE `40P01` and `40001`, answer `error.conflict.retry` with 409 so callers can retry; core does not retry automatically.
- Generated auth kayan can import project operations from a sibling operations file. The CLI resolves extensionless relative project imports. User guides and project workflow skills ship with the package, and the docs check verifies links and copied snippets.
- `mithaq-admin` includes a temporary Payload password checker for projects moving accounts to Better Auth. Release checks cover PostgreSQL 17 and 18.

### Fixed

- Reference checks and writes use compatible row locks, including set-only updates and soft deletes, reducing deadlocks while keeping referenced rows protected. Enrollment checks hold sessions and courses against concurrent archive and capacity changes. PostgreSQL 18 restrict violations answer the same referenced conflict as foreign-key violations.
- Step writes stay within the active organization and the named kayan row, including raw updates and deletes, UUIDs sent in another case, insert organization defaults, upsert conflicts and draft writes. A step cannot switch the authorized target id. JSON values containing `$inc` remain ordinary JSON.
- A second copy of mithaq is refused by name. Auth generation preserves Better Auth's lookup indexes. Migrations use mithaq's own drizzle-orm and read drizzle-kit's complete output, including output larger than a pipe buffer.
- Request bodies are bounded before auth or plug fallthrough can consume them whole; oversized bodies answer 413 and interrupted reads answer 499. JSON checks reject invalid Unicode and excessive nesting, and query limits bound lists and conditions.
- Sign-in redirects stay within screens the person can open. Field relationship filters apply to pickers and writes. Rich-text editing, date-time saves, save feedback and role permission displays follow the current components.
- Message generation keeps translations when nesting files, separates page and field descriptions, and removes only a left-out add-on's shared copy in a new project. UUID normalization leaves ordinary JSON values unchanged and preserves omitted input fields.
