# The admin package

The controls, cells, forms, lists and shells a screen draws with ship as the
package `@drhomet/mithaq-admin`, which a project installs under the name its
imports use, `"mithaq-admin": "npm:@drhomet/mithaq-admin@<version>"`, at the
version of `mithaq`. Each piece is a TSX file the project imports as
`mithaq-admin/<file>`, and compiles against its own shadcn primitives through
`@/components/ui/*` and `@/lib/utils`, so the admin takes the app's style.

How a project adds its own components is in [Add a screen component](https://github.com/drhomet/mithaq/blob/main/templates/asas/README.md#add-a-screen-component).

## Set up an app

Each app wires the package in three places, all visible to the project:

- `vite.config.ts`: the `mithaq/vite` plugin, named with the folder pieces are ejected into.

  ```ts
  import { mithaqAdmin } from 'mithaq/vite'
  // ...
  plugins: [tailwindcss(), mithaqAdmin(fileURLToPath(new URL('./src/components/mithaq/', import.meta.url))), /* ... */]
  ```

  It keeps the package out of Vite's pre-bundling, so a piece the app imports and the same piece another piece
  imports are one module, and it serves an ejected file in place of the package's for every importer. It pre-bundles
  from the start the libraries the pieces import that the project installed, so a cold start never finds one
  mid-page and reloads it.
- `tsconfig.json` `paths`: `"mithaq-admin/*": ["./src/components/mithaq/*", "./node_modules/mithaq-admin/registry/*"]`.
  TypeScript tries the ejected folder first, so an ejected file is checked in place of the package's, then the
  package, which a piece installed in a store's own folder cannot reach by its name.
- `styles.css`: `@import 'mithaq-admin/source.css';`, because Tailwind never scans `node_modules`.

Every library a piece imports is a peer dependency of the package: `mithaq`, React, TanStack Form, the two icon
sets, `input-otp` and `react-day-picker`, and, for the rich text add-on, Lexical.

A project holds a few files of the package from creation, because they import the app's own files or hold
policy: the screen host (`mithaq-screens-host`), the storage adapters and defaults (`mithaq-storage`), the mailers (`mithaq-mail`), the
`expectedUpdatedAt` step (`mithaq-expected-updated-at`) and `ui/directional-icon.tsx`. They are the project's
to edit.

## Page headers and tabs

`mithaq-admin/page-header.tsx` exports `PageHeader` with optional `breadcrumb`
containing `href` and `label`, `title`, `primary` and `more` slots.
Pass `t` for translated actions. `MoreActions` also draws secondary buttons
on their own, retaining each button's confirmation. The template's
`appPage(main, { more })` puts form controls in the shell's `primary` region and secondary actions in `more`.
Tenant lists keep their title and New action together; backoffice lists keep
their title in the shell header.

`TabStrip` in `mithaq-admin/tab-strip.tsx` is the shared list and record strip.
It keeps the active tab visible by scrolling its own width, without moving
the document vertically. List selection stays in the list query. Record selection uses
`#tab.<first-declared-tab>=<selected-tab>`, preserving the query and mounted
form fields. Unknown or hidden selections show the first visible tab.

Read-only values use description lists. A form given an operations report
that denies its create or update draws values and no Save control. Server
authorization still decides every write.

The opt-in `mithaq-admin/theme.css` supplies the tenant canvas, dark surfaces,
native color scheme, 8px controls and 12px cards, uniform tabs and unboxed loose
fields. Palette variables and `color-scheme` live on `:root` and `:root.dark`
so portaled controls inherit them. Layout and tab rules are unlayered under
`[data-shell="app"]`. Control typography and target sizes live in the `components`
layer, so app utilities win. The unlayered control selector sets
`--app-control-radius: 0.5rem` only on tenant buttons, inputs, input groups,
textareas, combobox chips, select triggers and button triggers for popovers and dropdown menus.
Badges, toggles and tab lists keep their own radii;
explicit utilities such as `rounded-full` still choose their own shape on controls
whose radius reads the variable. Textareas receive an unlayered 8px radius.
The unlayered tenant input, textarea and select-trigger rules also override app
utilities for border, inline padding and background.
Only the tenant app imports this sheet. The backoffice keeps its own theme,
component styles, spacing and `components.json`, while sharing navigation,
headers, tab behaviour and read-only description lists. Shared record tabs add
no padding or overflow rules; lists retain their own overflow utilities and the
tenant sheet supplies tab-strip scrolling. Keep the theme provider's system
default. Simple records stop at 840px, lists and records with side columns at
1200px; use a custom layout for a dense table that needs the full width.

For a host using `@theme inline`, port the tenant host's mapping:
`--radius-4xl: var(--app-control-radius, calc(var(--radius) + 16px))`.
Do not set `--app-control-radius` on `:root` or the shell; the sheet sets it on
controls so other rounded elements retain the host's radius.

`ScreenNav` in the template's `ui/screen-nav.tsx` renders an app's own page
navigation from the permission-pruned entries, filtering hidden destinations.
`openRow(tableRef, id)` from `mithaq-admin/list.tsx` clicks the matching row's
host-routed anchor. Lists use it for row activation.
The template's `AppShell` accepts `breadcrumb: { href, label }` for app pages.
Member pages put Save and Cancel in its `primary` region, with Save naming the
member form's id, and move these actions to a fixed bar on phones.

## Eject a piece

`mithaq eject <item>`, run in the app, writes the item's own files into `src/components/mithaq/` byte for byte,
each ending with a marker line, `// mithaq-admin <version> <hash>`. From then on that file is drawn in place of
the package's by every importer, the package's own pieces among them. Edit it in place. Delete it to draw the
package's again, or run `mithaq eject --prune`, which deletes every ejected file nobody edited. Restart the dev
server after an eject or a prune.

Eject copies no other piece, because the package already serves each one, never overwrites a file, and installs
nothing: it names the shadcn primitives and npm packages the item needs that the project lacks. [The `mithaq`
command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#eject-and-eject---prune) has the details.

Reach for the components map first: a control, a cell or a node is replaced there without ejecting anything. Eject
when the piece you want to change is not in the map, such as `list-table.tsx` inside the list.

## `mithaq upgrade --check`

`mithaq upgrade --check` compares every file the project holds (what it ejected and the files it always holds)
with the installed package, one line per file, and never writes; you merge a change by hand. Where it lives:
`packages/mithaq/src/asas/cli/upgrade.ts` `upgradeCheck`.
[The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#upgrade---check) describes it.

When you eject `mithaq-upload` from a version before rich text and files became
add-ons, `upload.tsx` no longer exports `UploadPlugin`, `UploadView`, `imagePick`
or `INSERT_UPLOAD_COMMAND`: import them from `mithaq-admin/upload-node.tsx` in your
own `ui/rich-text-nodes.tsx`, and spread `richTextComponents` and
`uploadComponents` into your components map (see
[Rich text and files](#rich-text-and-files)).

### Upgrading 0.3.0 projects to 0.3.1

Install both packages at 0.3.1, then run `mithaq upgrade --check` in every host
and in the language package. The report does not merge files. Keep the host's
colors, fonts, radii and `components.json` while merging these changes:

- Merge `select.tsx`, `combobox.tsx` and `tabs.tsx` in the host's
  `src/components/ui/` from the corresponding 0.3.1 starter host. These primitives
  are excluded from the mithaq-admin tarball, so updating the dependency does
  not change them. Select values need `text-start` for RTL, an ellipsis and a
  complete title; option labels wrap in a popup bounded by the viewport. Select,
  combobox and dropdown menu items own the 44px phone minimum and its desktop
  reset. Merge `dropdown-menu.tsx` too before removing item sizing from callers.
- Merge ejected `list-table.tsx`, `members.tsx` and `roles.tsx` for phone cards. They show the
  first visible column as the title and the next three as labelled details;
  the column picker's order chooses those details. Keep the host's
  `mithaq-admin/source.css` import for the card layout. Sorting and select-all
  sit before the list frame below `sm`. Keep the real column headers visually
  hidden there. Extra cells also stay visually hidden in the table, preserving
  Chromium's column order; their controls stay outside the phone tab order. Hide
  repeated card labels from screen readers. The table keeps its original layout
  from `sm` upward.
  Add translations for `admin.sortBy`, `admin.defaultOrder`, `admin.ascending`
  and `admin.descending` to the host's copy. If a host styles `td:empty`, extend
  that rule to `[data-list-value]:empty::after` too, as the backoffice starter
  does, so empty desktop cells keep their appearance.
- Replace unedited copies of `src/auth-frame.tsx`, `src/locale-switch.tsx` and
  `src/routes/unauthorized.tsx` with the installed `screens-host` item's files.
  Merge edited copies by hand. Delete only a file you have checked is unedited
  before running `mithaq eject screens-host`; eject never overwrites a file.
- Merge an ejected, edited `src/components/mithaq/form-actions.tsx` by hand.
  Preserve the project's actions while moving the phone bar into the base
  classes and restoring the header row with min-width breakpoints.
- Port the language's shell copies in `src/ui/`: `app-shell.tsx`, `top-shell.tsx`,
  `record-page.tsx`, `kpi-card.tsx` and `activity.tsx`. These are project files,
  not registry items, so upgrade does not replace them. Keep project-specific
  navigation, regions and behavior. The backoffice link must retain its desktop
  padding and centre its phone icon, including in RTL.

Apply the equivalent changes to each other host's own primitives; the tenant
and backoffice starter designs are different.

Run the project's checks after merging. Verify short and long values in both
text directions, open option menus on a phone, and compare desktop and tablet
screens before accepting the upgrade.

## Migrate a project that holds copies

A project made before the package holds every piece as a copy under `src/components/mithaq/`. In this order:

1. Install `mithaq-admin` at the version of `mithaq`, then add the plugin, the `paths` entry and the
   `source.css` import shown in [Set up an app](#set-up-an-app).
2. Run `bunx mithaq eject --prune` in each app. Every copy you never edited goes, stale ones included, and the
   package draws the current piece in its place.
3. In what remains under `src/components/mithaq/`, and in every other file, rewrite the imports: `'./<file>'`
   inside that folder, `'./components/mithaq/<file>'` and `'@/components/mithaq/<file>'` all become
   `'mithaq-admin/<file>'`. Step 2 comes first, because a rewritten copy no longer hashes to its marker and
   would look edited.
4. Run `bunx mithaq upgrade --check`. Each edited copy reports `differs, edited`; merge each by hand once.
5. Move the components map out of `src/router.tsx` into `src/components.ts`, and import it from `router.tsx` and
   `server.ts`, so the server entry reads the map without evaluating the router. In a monorepo, add
   `apps/*/src/components.ts` to the root tsconfig's `exclude` beside `apps/*/src/server.ts`: the map imports
   the package's `.tsx`, which the app's own config checks.
6. Delete the `@mithaq` entry from each `components.json` `registries`; `shadcn add` is for primitives now.

## Add or replace a control

Every screen draws a field's control, and a list or a read-only value its
cell, from the components map the app hands `ComponentsProvider`. The app keeps the map in `src/components.ts`,
typed against the project's language, and mounts it around every route in `src/router.tsx`:

<!-- from: apps/asas-tanstack/src/components.ts -->
```ts
export const components: ComponentsOf<Language> = {
  ...defaultComponents,
  controls: {
    ...defaultComponents.controls,
    // ...
  },
  cells: {
    ...defaultComponents.cells,
    // ...
  },
}
```

<!-- from: apps/asas-tanstack/src/router.tsx -->
```tsx
Wrap: ({ children }) => <ComponentsProvider components={components}>{children}</ComponentsProvider>,
```

To draw a shipped kind or control name with your own control, spread the
defaults and replace that one name; a cell is replaced the same way under
`cells`. A kind your own rukn brings, which no control or cell the registry
ships draws, names itself as its control or its cell, and the map draws it
under that name:

```ts
const color = kind<string>(isColor)({
  label: { en: 'Color', ar: 'لون' },
  message: { en: 'This is not a color.', ar: 'هذا ليس لونا.' },
  rules: ['required'],
  targets: { drizzle: drizzleKinds.text, zod: zodKinds.text, screen: { control: 'color', cell: 'color' } },
})
```

```tsx
const components: ComponentsOf<Language> = {
  ...defaultComponents,
  controls: { ...defaultComponents.controls, color: ColorControl, text: MyTextControl },
  cells: { ...defaultComponents.cells, color: ColorCell },
}
```

`ComponentsOf<Language>` requires one control and one cell per name
`defaultComponents` holds, and one of each per kind of the language that no shipped one
draws, so leaving `color` out, naming a key that is neither, or a control that
does not take `ControlProps` or a cell that does not take `CellProps` is a type
error. A kind the language declares needs its entry
even when no kayan uses it, since the type reads the language and not the
kayan. A kind drawn by a `ui()` reference needs a map entry too, because an
operation's dialog, the upload dialog and a form drawn with no page draw it
through the map. For the same reason the type does not see a cell that a list
column or a leaf names on a kayan's page: a column naming its kind's own name
(`{ field: 'color', cell: 'color' }` where the kind draws `text`) needs
`cells.color` in the map without the type asking for it.

Each app's `src/server.ts` checks every screen it serves against the map as it
starts, through `checkComponents`, so a field whose kind has no control or no
cell stops the start with the kind and the field named, and a cell a list
column or a leaf names that the map does not carry stops it with the screen,
the page, the node and the cell named. On the page, such a cell is an error and
never the field's own cell in its place. A route that throws while drawing
is replaced by `RouteError`, the router's `defaultErrorComponent`, and the shell
around it stays.

## Rich text and files

The controls and cells of the `richText` kind, which the rich text rukn
brings, and of the `upload` kind, which the storage rukn brings, are not in
`defaultComponents`. Each ships as an add-on map of its own,
`richTextComponents` in `rich-text.tsx` and `uploadComponents` in `upload.tsx`,
and a project spreads one only where its language holds the kind. A project
without rich text never loads Lexical's editor, and one without files never
loads the upload code:

```tsx
const components: ComponentsOf<Language> = {
  ...defaultComponents,
  controls: { ...defaultComponents.controls, ...richTextComponents.controls, ...uploadComponents.controls },
  cells: { ...defaultComponents.cells, ...richTextComponents.cells, ...uploadComponents.cells },
}
```

`ComponentsOf<Language>` asks for an add-on's control and cell whenever the
language declares the kind and a screen's controls table draws it with the
add-on's name, even when no kayan on any screen uses it, since the type reads
the language and not the kayan. Leaving one out is a type error, and
`checkComponents` stops the start naming the map to spread. A replaced
`cells.richText` or `cells.upload` is drawn on record pages too, handed
`whole`, and must draw the full value when `whole` is set. The rich
text upload node (`UploadView`, `imagePick` and `UploadPlugin`) is the item
`mithaq-upload-node`, for a project that has both.

## Replace a node

A page's tree is drawn from the same map, one component per kind of node under
`nodes`. To draw tabs, a section or any other shipped node your own way, spread
`defaultComponents.nodes` and replace that kind; the component is handed `NodeProps` of
its kind, and draws the nodes it holds with `drawNodes`:

```tsx
const MySection = ({ node, draw }: NodeProps<'section'>) => <fieldset>{drawNodes({ nodes: node.fields, draw })}</fieldset>

const components: ComponentsOf<Language> = {
  ...defaultComponents,
  nodes: { ...defaultComponents.nodes, section: MySection },
}
```

The map takes one entry per kind `mithaq/admin` declares and no other: a
screen's build refuses a node of any other kind, so no page could hold one.
Draw your own thing with a `component` node instead. `checkComponents` stops
the start when a page holds a kind the map does not carry, naming the screen,
the kayan and the page, and drawing one is an error on the page.

## Moving users off Payload

A project that moves its users off Payload keeps their passwords with the
`mithaq-payload-password` item, and deletes it once they have moved. Payload
hashes with pbkdf2-sha256, and Better Auth with scrypt; the item lets Better
Auth verify both, and replaces each Payload hash with Better Auth's the first
time its user signs in.

1. Eject it into the language, where the Better Auth setup lives. In
   `packages/mithaq` (the project's root in a single package):

   ```sh
   bunx mithaq eject payload-password   # writes src/mithaq/auth/payload-password.ts
   ```

2. Wire it into `optionsFor` in `src/mithaq/auth/index.ts`, which both apps'
   instances build on:

   ```ts
   import { payloadPassword, payloadRehash } from './payload-password.ts'

   emailAndPassword: { enabled: true, password: payloadPassword() /* , ... */ },
   plugins: [payloadRehash() /* , ... */],
   ```

   - `payloadPassword()` hashes every new password with Better Auth's own
     scrypt. Its `verify` checks a `payload-pbkdf2$<salt>$<hash>` value as
     Payload 3.89 and older wrote it (25000 iterations, a 512-byte key) and a
     `payload-pbkdf2-v1$<salt>$<hash>` one as Payload 3.90 does (600000
     iterations, a 32-byte key), and hands anything else to Better Auth's.
     A malformed value refuses the password; it never throws.
   - `payloadRehash()` runs after `/sign-in/email` and `/sign-in/username`.
     When the sign-in succeeded on a Payload hash, it verifies the password
     against the hash it reads again, then writes Better Auth's hash of it only
     over that hash, so neither a cutover run meanwhile nor a password set
     meanwhile is overwritten. A failed write is logged and never fails the
     sign-in; the next sign-in tries again. The prefix is the only flag: no
     column says who has moved. A project that signs in with the phone-number
     plugin adds `/sign-in/phone-number` to its matcher, `signIns`.
   - No password length is capped on sign-in. Payload let a password of up to
     40000 characters be set, past Better Auth's `maxPasswordLength` of 128,
     which caps only a password being set.
   - A known limit while users move: sign-in timing tells the address of a user
     still on a Payload 3.90 hash from an unknown one, about 105 to 130 ms of
     pbkdf2 against about 60 ms of scrypt. It ends as each user is rehashed.

3. At cutover, give each account its user's Payload hash. Payload stores `salt`
   and `hash` in two columns of its `users` table, and
   `payloadHashToAccountPassword({ salt, hash })` makes the one string
   `account.password` holds, throwing on a pair Payload never wrote. Where users
   were mirrored into Better Auth under a shared temporary password, only the
   accounts still on it take their Payload hash, which retires the temporary
   password; a user who chose a password in Better Auth keeps it. A script run
   once, with Payload's `users` table in the same database:

   <!-- from: packages/mithaq-admin/test/payload-password.test.ts -->
   ```ts
   const cutover = async ({ db, temporary }: { db: pg.Pool; temporary: string }) => {
     const { verify } = payloadPassword()
     const { rows } = await db.query<{ id: string; password: string; salt: string; hash: string }>(`
       select account.id, account.password, users.salt, users.hash
       from account
       join "user" on "user".id = account.user_id
       join users on lower(users.email) = lower("user".email)
       where account.provider_id = 'credential' and account.password is not null and users.hash is not null`)
     let moved = 0
     for (const row of rows) {
       if (!(await verify({ hash: row.password, password: temporary }))) continue
       const { rowCount } = await db.query('update account set password = $1 where id = $2 and password = $3', [payloadHashToAccountPassword(row), row.id, row.password])
       moved += rowCount ?? 0
     }
     return moved
   }
   ```

   Read the temporary password from the environment and print the count, never
   a password or a hash. A rerun moves nobody, so the script runs in the
   rehearsal and again on the day. It stops at the first pair Payload never
   wrote; the accounts before it have moved, and a rerun after the fix skips
   them. A Payload user with no Better Auth account needs one made first, with
   its credential account's `password` set the same way.

4. Delete the file once every imported user has signed in, which is when
   `select count(*) from account where password like 'payload-pbkdf2%'` answers
   0, or once the window you give them closes. Clear what is left first:
   Better Auth's own `verify` throws on a Payload hash, so a sign-in on one
   would fail with a server error. `update account set password = null where
   password like 'payload-pbkdf2%'` leaves those users the password reset.
   Then remove `password` and `payloadRehash()` from `optionsFor`.

## Members and roles

`mithaq-admin/members.tsx` exports `Members`, `MemberPage` and `AddPerson`.
The caller passes authorized provider-backed `Member[]` and `Role[]` from
`mithaq-admin/member-types.ts`. `Members` adds search, role filtering, sortable
name and date columns, a count and pagination. Its member links use the current
screen path followed by `/members/:id`.

Pass `MembersOptions` explicitly: the app's shell, organization mode, owner role,
`grantable` and `managesRoles` policies, permission-summary component, auth request
function and refusal translator. The provider remains the membership authority;
the component creates no membership table and reads no shared users. Assignment
writes still use the `memberRoles` kayan. A refused save shows the assignments
that succeeded before the refusal.

`MemberPage` takes one authorized member, the readable roles and the same options.
It shows joined date and authorized last seen, and permission summaries only
with `roles.find`. Save and Cancel appear only with assignment write access.
Its `children` appear after roles so an app can add a section such as shop
assignments. A page loader receives its matched URL parameters in
`LoaderTools.params`. Resolve the member from the provider's authorized directory,
never from a wider user lookup. The template's member and fixed-role pages show
how to register these routes without adding navigation entries.

`mithaq-admin/role-form.tsx` exports `RoleForm`, `Permissions` and `Grants`.
`PermissionOptions` supplies the app's extra permission statements and its
`canGrant` callback. Editable permissions use grouped checkboxes and
expandable field access. Read-only permissions show
only the keys held, grouped by area. Unrecognized held keys remain visible and
survive edits.

`mithaq-admin/roles.tsx` exports `RolesTable`, taking fixed role definitions and
optional authorized member counts. Fixed roles link to `/roles/fixed/:name`;
custom roles use the list's normal record links. `memberCounts` from
`mithaq-admin/member-counts.ts` pages the provider and assignment reads, includes
implicit owner grants and counts each member once per role. Masked assignment
user or role fields make the counts unavailable. Call it only when
the actor can read both memberships and assignments. Omit unavailable counts;
the list shows a dash rather than claiming zero.

## Add a registry item

A registry item is a piece mithaq ships for every project. Its source lives in `packages/mithaq-admin/registry/`:

1. Write the file under `packages/mithaq-admin/registry/`, and list it as an item in `packages/mithaq-admin/registry.json` with its `target`, the bare names of the shadcn primitives it imports in `registryDependencies`, and the npm packages it alone needs in `dependencies`.
2. Import a sibling piece as `mithaq-admin/<file>`, never by a relative path, so a project's ejected copy of the sibling is drawn in its place.
3. Add the item's name to the list in `packages/mithaq-admin/test/render.test.ts` `the app holds the current source of every registry item it copied`.
4. A library the piece imports that no other piece does is a peer dependency in `packages/mithaq-admin/package.json`.
5. Run `bun run test`. A piece the apps import is drawn from the package at once; only a file a project always holds (the host, storage, a step) is ejected again in `templates/mithaq` or the apps: delete the old file and run `bunx mithaq eject <item>` there.

### A registry step

A step every project may want, and may want to change, ships as a registry file rather than as core code. `expectedUpdatedAt` is one: it lives in `packages/mithaq-admin/registry/steps/expected-updated-at.ts` in the mithaq repository, `mithaq eject mithaq-expected-updated-at` writes it to `src/steps/expected-updated-at.ts`, and a project edits its copy in place. Write a new one the same way, and follow [Add a registry item](#add-a-registry-item). Put the step's tests beside it so a replacement can run them.
