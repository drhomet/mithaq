# Working in a mithaq project

This is the guide to a project made by `bun create mithaq`: getting it running, where each file lives, adding to it, and running it in production.

## Getting started

This walkthrough takes you from an empty folder to a running project with your own kayan in its admin. It takes about an hour.

You need Bun 1.3, Node.js 24 or later, and PostgreSQL 15 or later. Docker is the quickest way to get Postgres.

### 1. Create the project

```sh
bun create mithaq my-app
```

This copies the template into `my-app`, pins `mithaq` to the published package, and runs `bun install`. If it was not started by Bun, it skips the install and tells you to run `bun install` yourself. Install with Bun only: the admin screens find their files through Bun's isolated installer, and npm, pnpm and yarn lay `node_modules` out differently.

What you get is a Bun workspace:

| Folder | What it is |
| --- | --- |
| `templates/asas` | Your backend. `src/mithaq.ts` declares the language: its locales, its arkan (singular rukn, a pillar: a pluggable part that brings kinds, rules or fields), its targets and its screens. Each kayan (an entity, one data type) has its own folder, such as `src/courses/` or `src/tags/`. `src/asas.ts` builds the asas, the runtime, from those kayan. It also holds `src/migrations/`, `src/messages/`, `src/storage/` and `src/seed.ts`. |
| `templates/auth` | The `@asas/auth` package: the Better Auth setup, with organizations, admin and platform roles. |
| `apps/asas-tanstack` | The tenant app, built on TanStack Start. It serves the dashboard at `/dashboard` and the portal at `/portal`, on `http://localhost:5173`. |
| `apps/asas-platform` | The platform console, for staff who work across every organization, on `http://localhost:5174`. |

At the root it also writes `bunfig.toml`, which turns on the isolated linker, a `.gitignore`, and a `tsconfig.json`.

It writes the same `.env` into `templates/asas`, `apps/asas-tanstack` and `apps/asas-platform`, readable only by you:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mithaq
LOCAL_AUTH_SECRET=<64 random hex characters>
BETTER_AUTH_SECRET=<64 random hex characters>
BETTER_AUTH_URL=http://localhost:5173
PLATFORM_URL=http://localhost:5174
# STORAGE_SECRET=
# STORAGE_PREFIX=mithaq/asas
# STORAGE_ADAPTER=local
```

The two apps sign their sessions under one `BETTER_AUTH_SECRET`, so keep the value the same in every copy. The storage settings can stay commented out in development. [Environment variables](#environment-variables) lists every variable.

### 2. Start Postgres

Start a Postgres that matches the `DATABASE_URL` above:

```sh
docker run -d --name mithaq-dev -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mithaq -p 5432:5432 postgres:17
```

To use a Postgres you already run, create a database for the project and change `DATABASE_URL` in all three `.env` files.

### 3. Create the schema

In development, `asas.connect()` pushes the schema: it creates or changes the tables to match your kayan, and refuses any change that would lose data. Run it once:

```sh
cd my-app/templates/asas
# push the schema once, development only
bun -e "const { asas } = await import('./src/asas.ts'); await asas.connect(); await asas.destroy()"
```

`bun` reads `.env` for you, so `DATABASE_URL` is already set. Run the same line again whenever you add or change a kayan.

A pushed database is for development only. Production applies the migration files in `src/migrations/` instead, and refuses a database that was pushed. [Running in production](#running-in-production) explains how.

### 4. Run both apps

```sh
cd ../..
bun run --cwd apps/asas-tanstack dev   # the tenant app, http://localhost:5173
bun run --cwd apps/asas-platform dev   # in a second terminal: the platform console, http://localhost:5174
```

Each `dev` script first runs `mithaq lock --check`. The template has no `mithaq.lock`, so this prints a notice and carries on.

### 5. Sign up and seed

Open `http://localhost:5173/auth/sign-up` and sign up as `admin@admin.com` with the organization "Admin org". Signing up creates the organization, makes you its owner, and gives you the `administrator` role, which holds every permission in that organization.

Then fill the organization with sample courses, sessions, tags and roles:

```sh
cd templates/asas
bun run seed
```

The seed looks for exactly one organization named "Admin org" owned by `admin@admin.com`, and writes every row through the asas's own operations, as that owner. Running it twice adds nothing.

The platform console admits platform staff only, and only a `super_admin` can grant a platform role. Make yourself the first one directly in the database:

```sh
docker exec mithaq-dev psql -U postgres mithaq -c "update \"user\" set role = 'super_admin' where email = 'admin@admin.com'"
```

Then sign in at `http://localhost:5174`.

### 6. Add your first kayan

This section adds `notes`: a title and a done flag, owned by one organization, listed and edited in the dashboard. Every path below is under `templates/asas`.

#### The kayan file

Create `src/notes/notes.ts`:

```ts
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan, organization } from '../mithaq.ts'
import { appPage, danger } from '../pages.ts'

export const notes = defineKayan({
  name: 'notes',
  messages: {
    singular: { en: 'Note', ar: 'ملاحظة' },
    plural: { en: 'Notes', ar: 'الملاحظات' },
  },
  targets: {
    // What the dashboard screen draws of this kayan.
    dashboard: {
      useAsTitle: 'title',
      pages: {
        list: { path: '/notes', page: appPage([{ layout: 'table', main: [{ list: { columns: ['title', 'createdAt'], search: ['title'] } }] }]) },
        create: { path: '/notes/new', page: appPage([{ layout: 'record', main: [{ form: ['title', 'done'] }] }]) },
        edit: { path: '/notes/:id', page: appPage([{ layout: 'record', main: [{ form: ['title', 'done'] }], danger: danger() }]) },
      },
    },
    // The operations this kayan answers: create, update, delete, find, findByID, count, updateMany, deleteMany.
    service: { operations: defaultOperations },
  },
  fields: {
    // id, createdAt and updatedAt.
    ...defaultFields,
    // Makes each note belong to the active organization.
    organization,
    title: {
      kind: 'text',
      label: { en: 'Title', ar: 'العنوان' },
      rules: { required: true, trim: true, maxLength: 120 },
    },
    done: {
      kind: 'checkbox',
      label: { en: 'Done', ar: 'منجزة' },
    },
  },
})
```

A few things to notice:

- Every label carries one string per locale the language declares, here `en` and `ar`. Leaving one out is a type error.
- Nothing is implicit. The fields come from `defaultFields` and the operations from `defaultOperations`, which you spread yourself and can change. Leave `count` out of the operations, for example, and the kayan has no count.
- The `organization` field makes `notes` tenant-owned. On every operation, core limits reads, updates and deletes to the signed-in user's active organization, and fills the field from that organization on create. A caller cannot set or change it. A kayan without the field is shared by every organization. [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md) has the details.

#### Register it

Add it to the build in `src/asas.ts`:

```ts
import { notes } from './notes/notes.ts'

export const asas = buildAsas({
  kayan: [
    // ...the template's kayan
    auditLog,
    notes,
  ],
  // ...
})
```

Then add it to the dashboard screen's `kayan` list in `src/mithaq.ts`:

```ts
export const dashboardScreen = screenTarget({
  // ...
  kayan: ['courses', 'sessions', 'enrollments', 'tags', 'media', 'roles', 'memberRoles', 'settings', 'user', 'organization', 'auditLog', 'notes'],
  // ...
})
```

A screen's `kayan` list is free to change. It is not part of the frozen vocabulary that `mithaq.lock` records (see [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#lock-and-lock---check)).

#### Update the database

Push the new table into the dev database:

```sh
bun -e "const { asas } = await import('./src/asas.ts'); await asas.connect(); await asas.destroy()"
```

#### Generate the screens and the copy

```sh
bunx mithaq generate screens
bunx mithaq generate messages
```

`generate screens` rewrites the dashboard's `screen.json` and `types.ts` in `apps/asas-tanstack`. `generate messages` writes `src/messages/notes.json`, the copy file for this kayan, which you can edit. To use it in the tenant app's translations, import it into `scopes` in `apps/asas-tanstack/src/copy.ts`, the way `tags` is.

#### See it in the admin

Restart the tenant app's dev server and open `http://localhost:5173/dashboard/notes`. "Notes" is in the nav. You can create, list, edit and delete notes, and each one belongs to "Admin org".

You see it because the `administrator` role holds every key. Any other role needs the note keys added to it in `src/tenant-roles.ts`: `notes.find`, `notes.findByID`, `notes.create` and so on, plus a key per readable field, such as `notes.fields.title`. `mithaq screens` prints the key each nav entry needs.

#### Write the migration

The push only changes your dev database. Production needs a migration file, and `mithaq migrate` refuses to write one over a pushed database, because a push leaves no history. So write it against a second database built from the migrations:

```sh
docker exec mithaq-dev createdb -U postgres mithaq_migrations
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/mithaq_migrations
DRIZZLE_KIT=$(node -p "path.join(path.dirname(require('module').createRequire(fs.realpathSync('node_modules/mithaq/package.json')).resolve('drizzle-kit')), 'bin.cjs')")
node "$DRIZZLE_KIT" migrate --config src/migrations/drizzle.config.ts   # apply the existing migrations
bunx mithaq migrate --name add_notes                                    # write src/migrations/<timestamp>_add_notes/
node "$DRIZZLE_KIT" migrate --config src/migrations/drizzle.config.ts   # apply it
bunx mithaq migrate --check                                             # "The database schema is up to date."
```

The `mithaq` command runs under Node and does not read `.env`, so `DATABASE_URL` must be exported in the shell. Commit the new folder along with the code.

#### Check everything

```sh
bunx mithaq generate --check
```

This runs the lock check, every generator in check mode, and the migration check, and stops at the first failure. Run it in CI. [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md) describes every command.

### Next

- [Project structure](#project-structure): where each file lives.
- [Adding to the project](#adding-to-the-project): a kayan, a feature on a kayan, a step and a screen component.
- [Running in production](#running-in-production): migrations, environment variables, storage and deploying.
- [The language reference](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/README.md): the language, kinds, rules, targets and arkan, and your own kinds and targets.
- [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md): organizations, scoping and indexes.

## Project structure

`bun create mithaq my-app` copies the template at the version of `mithaq` it was published with, pins `"mithaq": "npm:@drhomet/mithaq@<version>"` and `"mithaq-admin": "npm:@drhomet/mithaq-admin@<version>"` at that one version, writes fresh secrets into three `.env` files and runs `bun install`. The project is a Bun workspace.

```
my-app/
  package.json        workspaces templates/* and apps/*; no scripts
  bunfig.toml         [install] linker = "isolated", which the screens need
  tsconfig.json       one strict config over templates/*/src and apps/*/src
  .gitignore          node_modules, .env, dist, .storage/
  templates/
    asas/             package "asas": the language, the build and every kayan
    auth/             package "@asas/auth": the Better Auth instances and the platform roles
  apps/
    asas-tanstack/    the tenant app: the dashboard and portal screens, sign-in pages, /api
    asas-platform/    the platform console: the platform screen, for staff
```

The apps import the template only through the `asas` package (`import { asas } from 'asas'`), never by a path into `templates/`. `templates/asas`, `apps/asas-tanstack` and `apps/asas-platform` each hold a `.env` with the same secrets. The platform app derives its own session secret from `BETTER_AUTH_SECRET`, so the two apps share one session table and never a session.

The template's own tests stay in the mithaq repository. A new project has none of its `*.test.ts` files or test helpers, and writes its own.

### `templates/asas`

```
templates/asas/
  package.json        exports ".", "./messages/*", "./ui-dashboard/*", "./audit-log/*"; script "seed"
  components.json     where mithaq eject writes the storage and step files
  mithaq.hints.json   the project's answers to "is this a rename?" questions mithaq migrate asks
  mithaq.lock         the signed vocabulary, when the project keeps one
  README.md           this guide
  AGENTS.md           the rules for a coding agent working in the project
  CLAUDE.md           one line, @AGENTS.md, so Claude Code reads the same rules
  .env.example
  src/
    mithaq.ts         defineMithaq: locales, arkan, targets, screens, generate paths
    asas.ts           buildAsas: the kayan list, globals, HTTP plugs, statements, auth
    <kayan>/          one folder per kayan
    kayan/auth/user/  the Better Auth kayan, written by mithaq generate auth
    messages/         one JSON file of copy per kayan, written by mithaq generate messages
    migrations/       written by mithaq migrate, committed
    ui/ ui-dashboard/ ui-portal/ ui-platform/   page pieces several kayan or screens share
    storage/          the storage config, its adapters and defaults
    steps/            steps ejected from mithaq-admin
    roles.ts tenant-roles.ts tenant-access.ts statements.ts
    pages.ts platform-http.ts rich-text-nodes.ts seed.ts
```

**`src/mithaq.ts`** declares the language with one `defineMithaq` call and exports what it returns: `defineKayan`, `defineGlobal`, `buildAsas`, `rows`, `user`, `generate`, `locales`, `targets` and the tenant target. It also exports `organization`, the tenant target's field with a label, which every per-organization kayan places. The arkan (`base`, `richText`, the storage rukn and `versions`), the server targets (`drizzle`, `zod`, `rbac`, `tenant`, `service`) and the three screens (`dashboard`, `portal`, `platform`) are laid down here. `generate` names where `mithaq generate` writes: the auth kayan, the providers module, the messages folder and each screen's routes folder in an app.

**`src/asas.ts`** builds the asas: `export const asas = buildAsas({ kayan, global, http, statements, auth })`. A kayan joins the project when it is added to `kayan` here.

**One folder per kayan.** The folder is the kayan's name in kebab case, and it holds a file of the same name that exports the kayan:

```
src/courses/
  courses.ts          export const courses = defineKayan({ name: 'courses', ... })
  ui/                 page pieces only this kayan draws with
    archive-button.tsx
    fee-cell.tsx
    status-cell.tsx
```

The template's kayan are `courses`, `sessions`, `enrollments`, `tags`, `media`, `roles`, `member-roles`, `local-users`, `audit-log` and the global `settings`. A kayan's `name` is camelCase (`auditLog`, `memberRoles`), and a multi-word table sets `dbName` in snake case (`audit_log`, `member_roles`). A kayan whose files are more than one keeps them side by side: `audit-log/` holds the kayan and `sink.ts`, the audit sink the service target names, and `roles/` holds `grants.ts`, which the role form and the server both read.

**`src/kayan/auth/user/`** holds the kayan Better Auth's tables become: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `organizationRole` and `index.ts`, which groups them by plugin. `mithaq generate auth` writes them from the options in `templates/auth/src/index.ts`, and each starts with `Written by` and is never edited. The project's own choices for one of them go in `<kayan>.access.ts` and `<kayan>.screens.ts` beside it, which the generator imports on its next run.

**`src/messages/`** holds `<kayanName>.json` for each kayan, keyed by the kayan's name (`courses.json`, `auditLog.json`), and `mithaq.json` for the copy every kayan shares, such as the default fields' labels. `mithaq generate messages` writes them from the labels and `messages` in the kayan. The apps import them as `asas/messages/<name>.json`.

**`src/migrations/`** holds one folder per migration, `<timestamp>_<slug>/` with `migration.sql` and `snapshot.json`, and two files `mithaq migrate` writes and the project commits: `schema.ts`, which names every table, and `drizzle.config.ts`, which `drizzle-kit migrate --config src/migrations/drizzle.config.ts` reads. `mithaq migrate --name <slug>` sets the slug.

**Shared page pieces.** `src/ui/` holds what every screen draws with: the shells (`app-shell.tsx`, `top-shell.tsx`), the layouts (`record-page.tsx`, `table-page.tsx`) and the shared providers. `src/ui-dashboard/`, `src/ui-portal/` and `src/ui-platform/` hold what one screen draws, such as its home page. A piece is named with `ui('file.tsx#Export')`, where `ui` is a `folderOf` over one of these folders, and the build refuses a missing file or export.

**Access and roles.**

- `tenant-roles.ts` holds the roles every organization has, written in code and never stored as rows. A key is `<kayan>.<operation>`, `<kayan>.fields.<field>` or `screen.<screen>`.
- `roles.ts` joins them with the platform roles from `@asas/auth` into `systemRoles`, which the access target takes.
- `tenant-access.ts` holds the row table every per-organization kayan inherits, the reader that answers an actor's roles, and the platform's checks.
- `statements.ts` holds the keys the project adds beside the kayan's own operations.

**Configurable features.**

- `storage/index.ts` is the storage config. It names every function in `storage/defaults.ts`, and the adapters `local.ts`, `r2.ts`, `s3.ts` and `uploadthing.ts`. Those five files are ejected from the `mithaq-storage` item of `mithaq-admin` and end with a marker line.
- `steps/expected-updated-at.ts` is ejected from the `mithaq-expected-updated-at` item.
- `rich-text-nodes.ts` is the one list of rich-text nodes the server and every editor read.

**The rest.** `pages.ts` holds the page trees every kayan page starts from (`appPage`, `topPage`, `danger`, `platformList`, `platformRecord`). `platform-http.ts` is the one hand-written route, renaming an organization, which writes a Better Auth table no managed operation may write. `seed.ts` fills a database for a first look, run with `bun run seed`.

### `templates/auth`

```
templates/auth/src/
  index.ts            the Better Auth options and instances (providers), the platform session,
                      asPlatform and onPlatform, and the two apps' URLs
  platform-roles.ts   the platform roles staff hold on user.role, the columns staff read,
                      and secret, the columns no platform role reads
```

### The two apps

Both apps are TanStack Start apps on Vite. Each app's `dev`, `build` and `preview` script runs `mithaq lock --check` in `templates/asas` first, so a red lock stops it from starting.

**`apps/asas-tanstack`** is the tenant app, at `http://localhost:5173` in development. It serves the `dashboard` and `portal` screens, the sign-in, sign-up, password and invitation pages, and every API request through one route, `src/routes/api/$.ts`, which hands the request to `asas.handler`.

```
apps/asas-tanstack/
  components.json     shadcn config: where shadcn add and mithaq eject write
  vite.config.ts      with the mithaq/vite plugin
  src/
    copy.ts           every copy scope the app's translator answers: each kayan's
                      messages JSON plus the app's own keys
    routes/
      __root.tsx  index.tsx  unauthorized.tsx  auth.*.tsx
      api/$.ts
      (screens)/      written by mithaq generate screens
        dashboard.tsx  dashboard.$.tsx  dashboard.index.tsx
        dashboard/     screen.json  types.ts  files.ts
        portal.tsx  portal.$.tsx  portal.index.tsx
        portal/        screen.json  types.ts  files.ts
    screens.tsx  screen-form.tsx  screen-list.tsx  screen-names.ts  api.ts  slide.ts
    links.ts  locale-switch.tsx  auth-frame.tsx  request-headers.ts
                      the screen host, ejected from the mithaq-screens-host item
    components.ts        the components map every screen draws its controls, cells and nodes from
    components/mithaq/   the pieces the project ejected from mithaq-admin, none at first
    components/ui/       the shadcn primitives the pieces draw with
    lib/  hooks/         shadcn's utils and hooks
    router.tsx  start.ts  server.ts  styles.css  theme.ts  redirect.ts  quiet-abort.ts
    routeTree.gen.ts     written by TanStack Router
```

The app owns its copy, its routes, its providers and its styling. It says nothing about any kayan: what a kayan is and what a screen draws of it come from the template and the generated files.

**`apps/asas-platform`** is the platform console for staff, at `http://localhost:5174` in development. It has the same shape and serves the `platform` screen alone. Its `server.ts` runs every request inside `asPlatform`, so the platform roles are answered in this app and never in the tenant app. Its `copy.ts` re-exports the tenant app's.

### Naming and where files go

| What | Where and how it is named |
|---|---|
| A kayan | `templates/asas/src/<kebab-name>/<kebab-name>.ts`, exporting `const <camelName> = defineKayan({ name: '<camelName>' })` |
| A kayan's own page pieces | `<kayan>/ui/<kebab-name>.tsx`, PascalCase exports, named as `ui('<file>.tsx#<Export>')` |
| Shared page pieces | `src/ui/`, or `src/ui-<screen>/` for one screen |
| A step used by one kayan | in the kayan's file, beside the operation that lists it |
| A step several kayan share | `src/steps/<kebab-name>.ts` |
| Copy | `src/messages/<camelName>.json`, written by `mithaq generate messages` |
| Migrations | `src/migrations/<timestamp>_<slug>/`, written by `mithaq migrate --name <slug>` |
| Screens | each app's `src/routes/(screens)/`, written by `mithaq generate screens` |
| Better Auth kayan | `src/kayan/auth/user/`, written by `mithaq generate auth`; the project's choices in `<kayan>.access.ts` and `<kayan>.screens.ts` |
| Tests | beside the code they test, as `<name>.test.ts`; shared test helpers as `test-<name>.ts` |

A file a generator writes starts with a line saying which command wrote it, such as `// Written by \`mithaq generate screens\`. Do not edit.`, and changes only by rerunning that command. A file ejected from `mithaq-admin` ends with a marker line, `// mithaq-admin <version> <hash>`, and is the project's own to edit; `mithaq upgrade --check` reports which were edited or differ from the installed package.

## Adding to the project

Paths are written from the root of a project made by `bun create mithaq`, as laid out in [Project structure](#project-structure). `templates/asas` holds the language, the build and every kayan, `templates/auth` holds the Better Auth instances and the platform roles, and `apps/asas-tanstack` and `apps/asas-platform` are the two host apps. The worked examples in the template are `courses` (`templates/asas/src/courses/courses.ts`) and `tags` (`templates/asas/src/tags/tags.ts`). Read them for shape.

Every `mithaq` command runs from `templates/asas`. The bin runs under Node and does not read `.env`, so set `DATABASE_URL` in the shell for any command that reaches a database, and point it at a throwaway database while you work.

### First, decide who may make the change

Most changes are free. Everything you write in `defineKayan`, `defineGlobal` and `buildAsas` is yours: fields, rules a kind already accepts, copy, access, operations, steps, indexes, pages. In `defineMithaq` you may change a screen's pages and `kayan` list, shells and components, roles, steps and the `generate` paths.

The vocabulary of `defineMithaq` is frozen. It is the locales, each kind's label, message and accepted rules, each rule's message and excludes, each target's name and capability, and the list of root keys. Only the project's owner signs a change to it (see [Add a kind or a rule](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/README.md#add-a-kind-or-a-rule)). If the change you need cannot be said without touching that vocabulary, stop, tell the owner what you would change and why, and wait.

### Where a piece belongs

`buildAsas` refuses a misspelled key, a missing `ui()` file or export, a join drawn as a leaf, a list inside a form and a role key the catalog does not hold. The type checker refuses a missing locale. What follows is judgement that no check makes for you.

- **A field says what a value is, and a step says what a write does.** A kind, its rules, its label, its options and who may read it go on the field. Deriving a column or writing another kayan goes in a step, as `markArchived` and `createSessions` do in `courses.ts`.
- **A rule only a form enforces is not enforced.** Every operation is served over HTTP, so a caller can skip the form. Put the rule in the field's `rules` or in a step. A `when` on a page node only decides whether the node is drawn.
- **A page component draws and calls operations.** It holds no rule and no write of its own. It lives in the kayan's own `ui/` folder when only that kayan draws with it, and in `src/ui/`, `src/ui-dashboard/`, `src/ui-portal/` or `src/ui-platform/` when several share it.
- **The host app wires things together and says nothing about a kayan.** It holds the copy, the generated routes and the providers. A fact about a kayan written in an app drifts away from the kayan.
- **A new action is a custom operation, not a hand-written endpoint.** An operation gets its permission key, the access check, the transaction and the audit step, and a page can draw it as a button. The template writes one route by hand, `platformHttp` in `src/platform-http.ts`, because it writes a Better Auth table no managed operation may write. Follow it only for a provider's own table.
- **Rows of another kayan on a record page are a related list.** Write a `list` node with `of` and `where` beside the form, as the Sessions tab of a course does. A `join` field holds the data, and a page that names it as a leaf is refused.
- **One row per organization is a global.** Write `defineGlobal` with the `organization` field required and unique, as `src/settings/settings.ts` does.
- **A column some reader may not see is never filterable, sortable or searchable.** A served `find` takes a `where` on any column the actor reads, so a filter on such a column answers yes or no about values the reader cannot see. Refuse it in a step before the store, as `queriedByQueryable` does in `src/audit-log/audit-log.ts`.

### Add a kayan

The example adds `rooms`, a per-organization list of rooms with a name and a capacity.

1. **Write the kayan file.** Create `templates/asas/src/rooms/rooms.ts`. Open `fields` with `...defaultFields` and `organization`, and `targets.service.operations` with `...defaultOperations`. Give every label one string per locale the language declares.

   ```ts
   import { defaultFields, defaultOperations } from 'mithaq'
   import { defineKayan, organization } from '../mithaq.ts'
   import { appPage, danger } from '../pages.ts'

   export const rooms = defineKayan({
     name: 'rooms',
     messages: {
       singular: { en: 'Room', ar: 'قاعة' },
       plural: { en: 'Rooms', ar: 'القاعات' },
     },
     fields: {
       ...defaultFields,
       organization,
       name: {
         kind: 'text',
         label: { en: 'Name', ar: 'الاسم' },
         // Unique within the organization, because the kayan places `organization`.
         rules: { required: true, trim: true, maxLength: 80, unique: true },
         targets: { dashboard: { searchable: true } },
       },
       capacity: {
         kind: 'integer',
         label: { en: 'Capacity', ar: 'السعة' },
         rules: { min: 1 },
       },
     },
     // Added beside the defaults: a plain index on (organization, capacity).
     indexes: [{ within: 'organization', index: ['capacity'] }],
     targets: {
       service: { operations: { ...defaultOperations } },
       dashboard: {
         useAsTitle: 'name',
         pages: {
           list: { path: '/rooms', page: appPage([{ layout: 'table', main: [{ list: { columns: ['name', 'capacity', 'createdAt'], search: ['name'] } }] }]) },
           create: { path: '/rooms/new', page: appPage([{ layout: 'record', main: [{ form: ['name', 'capacity'] }] }]) },
           edit: { path: '/rooms/:id', page: appPage([{ layout: 'record', main: [{ form: ['name', 'capacity'] }], danger: danger() }]) },
         },
       },
     },
   })
   ```

   `defaultFields` is `defaultIdField` (the `id`) and `defaultTimestampFields` (`createdAt` and `updatedAt`). Keep the timestamps unless you have a reason: the `expectedUpdatedAt` step refuses a kayan without `updatedAt`. Leave out any default operation the kayan should not answer, such as `count`.

2. **Decide whose rows these are.** A kayan that places `organization` belongs to one organization, and core scopes every managed operation on it to the session's active organization. A kayan without it is shared by every organization. [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md) has the full rules.

3. **Decide the indexes.** On a per-organization kayan, `unique: true` means unique within the organization, and a `{ within: 'organization', ... }` group builds indexes led by the organization field. A plain `{ fields, unique }` entry is unique across every organization. [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md#unique-values-and-indexes) has the full rules.

4. **Leave `access` out unless its rows differ from the tenancy rows.** A kayan that places `organization` and writes no `access` inherits the row table the access target was given (`tenantAccess` in `src/tenant-access.ts`). Plain callbacks such as `access: { read: fn }` are ANDed with those rows, so they only narrow, as `courses` does for archived courses. A table built with `rows({ ... })` replaces the inherited rows, as `src/roles/roles.ts` does.

5. **Register it.** Add `rooms` to `kayan: [...]` in `templates/asas/src/asas.ts`. A kayan that writes `targets.dashboard` must also be listed in that screen's `kayan` array in `templates/asas/src/mithaq.ts`, or the build refuses it with "does not list it in kayan". That array is not part of the vocabulary, so listing a kayan needs no signature.

6. **Give roles their keys.** A key is `<kayan>.<operation>` or `<kayan>.fields.<field>`. The `administrator` role holds `'*'`. Add to each other role in `templates/asas/src/tenant-roles.ts` the operations and columns it should reach. If the platform screen lists the kayan, add its columns to the staff reads in `templates/auth/src/platform-roles.ts`, or to `secret` for a column no platform role may read.

7. **Generate copy and screens.**

   ```sh
   cd templates/asas
   bunx mithaq generate messages
   bunx mithaq generate screens
   ```

   `generate messages` writes `src/messages/rooms.json`. Import it into `apps/asas-tanstack/src/copy.ts` as the kayan's scope, the way that file imports `courses.json`. The platform app re-exports the same file. `generate screens` rewrites each screen's `screen.json`, `types.ts`, `files.ts` and route files under the app folders `generate.screens` names.

8. **Write the migration and read it.**

   ```sh
   DATABASE_URL=postgres://... bunx mithaq migrate --name add_rooms
   ```

   `--name` takes a slug of lowercase letters, digits and underscores, 1 to 64 characters, and names the folder `src/migrations/<timestamp>_add_rooms/`. Read its `migration.sql` before anything applies it. `mithaq migrate` runs against a database built from the migrations and refuses one that `connect()` pushed; [Write the migration](#write-the-migration) shows how to build one. See [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#migrate) for the other flags and [Running in production](#running-in-production) for applying migrations.

9. **Seed it** in `src/seed.ts` if the project seeds its neighbours.

10. **Test it.** See [Tests](#tests). Watch each test fail before it passes.

The kayan is done when the project's tests, its typecheck and `bunx mithaq generate --check` pass against a throwaway database.

### Add a feature to an existing kayan

Change the kayan first, then everything that follows from it.

1. **Check the language can say it.** Open `templates/asas/src/mithaq.ts` beside the kayan. If the change needs a kind, rule, locale or target the language does not have, it is a vocabulary change: stop and ask the owner.
2. **Edit the declaration and nothing else**, then read it back. For a kayan Better Auth owns, the declaration is the provider options in `templates/auth/src/index.ts` and the project's `<kayan>.access.ts` and `<kayan>.screens.ts` files under `templates/asas/src/kayan/auth/user/`. Never edit a file that starts with `Written by`.
3. **Run the generators that follow**, in this order:
   1. `bunx mithaq generate auth` when the provider options or an `.access.ts` or `.screens.ts` file changed;
   2. `bunx mithaq generate messages` when copy changed;
   3. `bunx mithaq generate screens` when anything a screen draws changed: a field, a page or an operation's button;
   4. `bunx mithaq migrate --name <slug>` when a column changed, then read the `migration.sql`.
4. **Update what you write by hand.** These must agree with the kayan and nothing regenerates them:
   - role keys in `tenant-roles.ts` and `platform-roles.ts`, since renaming a field or an operation renames its key;
   - the staff reads or `secret` in `platform-roles.ts`, for a new column of a kayan the platform lists;
   - an operation's `input` schema and a step's field names, which repeat the kayan's field names;
   - field names inside a page component;
   - copy keys that a step or an `input` schema raises, in every locale.
5. **Verify** with the project's tests, its typecheck and `bunx mithaq generate --check`.

#### A field

Add the field to `fields`. A text field with a fixed list takes `options`, and each screen says how it draws it under `targets.<screen>`, as `currency` does in `courses.ts`. Add it to the pages that should draw it.

A new `required` column on a table that already has rows is refused by `mithaq migrate`, because Postgres would stop on the rows with no value. Give the field a literal `defaultValue`, or add it without `required`, fill each row, and make it required in a later migration. No check covers the data a migration meets: the checks run on an empty database, and a narrowing type change loses precision without a warning. Prove a hand-edited migration on rows in the old shape.

#### An operation

A custom operation is one more entry beside `...defaultOperations`. Name its `input`, list its steps around one store step, and say what each screen's button asks for.

```ts
import { defaultFields, defaultOperations, type Ctx } from 'mithaq'
import { z } from 'zod'

/** What `close` parses. Each message is a copy key, so the refusal reads in the viewer's locale. */
const closeInput = z.object({
  id: z.guid(),
  reason: z.string({ error: 'rooms.operations.close.reason.required' }).max(200, { error: 'rooms.operations.close.reason.maxLength' }),
})

/** Turns the operation's input into the kayan's own columns; `reason` reaches no column. */
const markClosed = (ctx: Ctx<z.infer<typeof closeInput>>): Ctx => ({
  ...ctx,
  data: { ...ctx.data, closed: true, closedReason: ctx.data.reason },
})

// In defineKayan({ ... }):
messages: {
  singular: { en: 'Room', ar: 'قاعة' },
  plural: { en: 'Rooms', ar: 'القاعات' },
  // The keys `closeInput` raises, which no field declares, so `generate messages` keeps them.
  operations: {
    close: {
      reason: {
        required: { en: 'Give a reason.', ar: 'اذكر السبب.' },
        maxLength: { en: 'Keep the reason under 200 characters.', ar: 'اجعل السبب أقل من 200 حرف.' },
      },
    },
  },
},
// In fields:
closed: { kind: 'checkbox', label: { en: 'Closed', ar: 'مغلقة' } },
closedReason: { kind: 'text', label: { en: 'Reason closed', ar: 'سبب الإغلاق' }, rules: { maxLength: 200 } },
// In targets.service.operations:
close: {
  // The box the dashboard's button asks for, drawn with the control every text field uses.
  targets: { dashboard: { fields: { reason: { kind: 'text', label: { en: 'Reason', ar: 'السبب' }, rules: { required: true, maxLength: 200 } } } } },
  input: () => closeInput,
  steps: ({ steps }) => [markClosed, steps.update],
},
// On the edit page:
danger: danger({ button: 'close', label: { en: 'Close', ar: 'إغلاق' }, fields: ['reason'], reload: true }),
```

The operation's name is its permission key, `rooms.close`, so give it to the roles that may run it. A shipped operation is changed the same way: `update: { input: ({ update }) => update.extend({ ... }), steps: ({ steps }) => [myStep, steps.update] }`. A read operation can type extra output with `output`, as `findWithSessions` does in `courses.ts`. Nest the copy keys a schema raises under the kayan's `messages`, because `buildAsas` refuses a key written flat with dots.

#### A column on a screen

Add the field name to the list's `columns`, and to `filters` or `search` if a person should filter or search by it. The build refuses `searchable` on a field whose kind cannot take `like` (only `text` and `email` can), on a localized field, and on a field no one may read. A column with a component of its own names it with `cell`, as `fee` does with `ui('fee-cell.tsx#FeeCell')`. Then run `bunx mithaq generate screens`. If a role should see the column, give it `<kayan>.fields.<field>`. If the platform lists the kayan, decide whether staff read it.

### Add a step

A step is a function `(ctx, tools)` that returns the context, changed or not. It never takes an object of its own: steps keep this shape so that every list composes the same way.

```ts
import type { Ctx, WriteTools } from 'mithaq'
import { sessions } from '../sessions/sessions.ts'

/** After the insert: one managed create per session, each through the sessions kayan's own operation. */
export const createSessions = async (ctx: Ctx<{ id?: string; sessions?: readonly { startsAt: Date }[] }>, tools: WriteTools): Promise<Ctx> => {
  const { id, sessions: made } = ctx.data
  if (!id || !made?.length) return ctx
  for (const session of made) await tools.of(sessions).create({ ...session, course: id })
  return ctx
}
```

A kayan lists it after the store step: `create: { input: ({ create }) => create.extend({ sessions: ... }), steps: ({ steps }) => [steps.insert, createSessions] }`. The full version, which also refuses a draft, is `createSessions` in `src/courses/courses.ts`.

`ctx` carries the kayan, `data` (the parsed input, and after the store step the written row), `actor` and `user`, `dataBefore` (the row loaded before an update or delete), `context` (what the HTTP plug put there, such as `requestId`) and `tx`. A write step's `tools` carry `of`, `store`, `operation`, `kind` and `where`; a read step's carry `of` and `read`.

Choose how a step reaches data, in this order:

1. **`tools.of(kayan)`** for another kayan. It runs that kayan's own operation: its access for the same actor, its steps, its validation and the audit, inside the same transaction. A failure rolls the whole write back. Prefer it.
2. **`tools.store`** for a raw insert, update or remove that should skip the other kayan's operation list. It skips that kayan's access, steps, validation and audit, but it is still sealed to the active organization; see [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md#what-core-enforces).
3. **`ctx.tx`** for raw SQL. It is the project's own privileged path: nothing scopes it, checks it or audits it. Use it only for what no kayan models, and scope it yourself.

Where a step goes:

- in an operation's `steps`, before or after its one store or read step, through the `steps` function: `steps: ({ steps }) => [myStep, steps.update]`;
- in an operation's `beforeTransaction`, which runs outside the transaction before it opens, with no lock and no `dataBefore`, or in its `afterSteps` or `afterCommit`;
- in the service target's `beforeSteps`, `afterSteps` or `afterCommit` in `src/mithaq.ts`, for every write of the project. `audit` sits in `afterSteps`. A webhook or an email belongs in `afterCommit`, where the row is durable.

A step that refuses throws `invalid`, `denied`, `missing` or `conflict` from `mithaq`, each taking one object with a `message`, a copy `key` and `params`. Add the key to the copy in every locale.

### Add a screen component

A component of the project's own lives in a `ui` folder of `templates/asas/src` and is named by `ui('file.tsx#Export')`, where `ui` is a `folderOf(new URL('./ui/', import.meta.url))`. A cell takes `CellProps` from `mithaq/admin`, a button takes `ButtonProps`, and hooks such as `useLocale` and `useRecord` come from `mithaq/admin/react`. Name it where it is used: as a field's `cell` or `component`, as a page node `{ component: ... }`, or under a screen's `components` in `src/mithaq.ts` when several pages use it by name. The build checks that the file exists and exports the name; you keep the field names inside it correct.

The screens draw with the pieces of `mithaq-admin`, which each app imports as `mithaq-admin/<file>`. To change a control, a cell or a node, replace it in the components map in `src/components.ts`. To change a piece the map does not hold, run `bunx mithaq eject <item>` in the app: it writes the piece into `src/components/mithaq/`, and that file is drawn in place of the package's from then on. [The admin package](https://github.com/drhomet/mithaq/blob/main/packages/mithaq-admin/README.md) describes the pieces, ejecting one, and migrating a project made before the package.

An ejected file is the project's own. A project edits it in place and never patches it from outside. After an edit, `upgrade --check` reports it as edited. When the installed package changes the same file, diff the two and merge by hand, or delete an unedited one (`bunx mithaq eject --prune`) to draw the package's.

### Tests

- Give tests a throwaway database, named by `DATABASE_URL`, and never the development database. Under `node --test` the template's `src/mithaq.ts` refuses to load without `DATABASE_URL`. The mithaq repository's own tests need more; see [CONTRIBUTING.md](https://github.com/drhomet/mithaq/blob/main/CONTRIBUTING.md#set-up).
- Run with Bun and its isolated linker, which `bun create mithaq` sets in `bunfig.toml`.
- Put a test beside the code it tests as `<name>.test.ts`, and run it with `node --test`.
- Write security cases first: the read of another organization's row, the write without the key, the refused input.
- See each test fail before it passes. Break the property, watch the failure, then restore it.
- A screen change needs a test that boots the app and visits each new page in every locale.

### Checks

| Command, from `templates/asas` | What it checks |
|---|---|
| `bunx mithaq generate --check` | Every check below and every generator in check mode, stopping at the first failure. [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#generate---check) lists the steps. |
| `bunx mithaq lock --check` | The vocabulary still matches `mithaq.lock` and its seal verifies. Passes with a notice when there is no lock. |
| `bunx mithaq migrate --check` | No kayan change waits for a migration. Writes nothing. |
| `bunx mithaq upgrade --check` | Every file the project holds from `mithaq-admin` against the installed package. Never writes. |

## Running in production

This part covers what changes between `vite dev` and a deployed app: how the database schema gets there, the settings each app reads, where uploaded files go, and how to build and start both apps. Paths are relative to a project made by `bun create mithaq` (see [Getting started](#getting-started)).

### Development pushes, production migrates

The drizzle store has two ways to bring the database in line with your kayan:

- **Push.** `asas.connect()` compares the kayan with the database and applies the difference directly. It refuses any change that would lose data. It is on by default whenever `NODE_ENV` is not `production`, and it writes a marker row named `mithaq_dev_push` into `drizzle.__mithaq_migrations`.
- **Migrations.** `mithaq migrate` writes SQL migration files into `src/migrations/`, which you commit (see [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#migrate)). Production applies those files and nothing else.

A pushed database has no migration history, so it is never a production database. A production start refuses a database that carries the push marker. To keep one, adopt it with `mithaq migrate --baseline` (only possible while the project has no migrations yet), or point `DATABASE_URL` at a database built from the migrations.

### `connect()` at start

Each app connects once before it serves any request. Both `apps/asas-tanstack/src/server.ts` and `apps/asas-platform/src/server.ts` do this:

```ts
const { env } = process
if (env.NODE_ENV === 'production') {
  await (await import('asas')).asas.connect().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
```

In production, `connect()` does not push. It checks the migrations instead, as `prodMigrations` on `drizzleAdapter` says. Without `prodMigrations`, a production `connect()` refuses to start. The template sets it in `templates/asas/src/mithaq.ts`:

```ts
const drizzleStore = drizzleAdapter({
  connectionString,
  ...drizzleTarget,
  prodMigrations: { migrationsFolder: fileURLToPath(new URL('migrations/', import.meta.url)), pending: 'refuse' },
})
```

`migrationsFolder` must hold the `drizzle.config.ts` that `mithaq migrate` wrote, so ship `src/migrations/` with the deploy. `push: true` and `prodMigrations` cannot be used together.

What `pending: 'refuse'` and `'run'` each do, the lock every writer of the migration history takes, and applying migrations by hand are in [Migrations in production](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/drizzle/README.md).

### Environment variables

`bun create mithaq` writes the same `.env` into `templates/asas`, `apps/asas-tanstack` and `apps/asas-platform`, with fresh values for `LOCAL_AUTH_SECRET` and `BETTER_AUTH_SECRET`. Bun (`bun <file>`, `bun run`, `bun -e`) and the apps' dev servers read it. The `mithaq` command runs under Node and does not read it. A variable already set in the environment always wins over `.env`.

In production, set these in the host's environment rather than in a file.

| Variable | Read by | Production | Development |
| --- | --- | --- | --- |
| `DATABASE_URL` | `templates/asas/src/mithaq.ts`, `seed.ts`, the CLI | Required. Start refuses without it. | Falls back to `postgres://postgres:postgres@localhost:5432/mithaq` for the dev server. `seed`, `migrate`, `rbac assign` and `storage sweep` still refuse without it. Under `node --test` it is required. |
| `BETTER_AUTH_SECRET` | `templates/auth/src/index.ts` | Required. Both apps must share the same value: the platform app derives its own session secret from it, so a cookie one app signed never verifies in the other. `AUTH_SECRET` is read when it is unset, but a URL below that is not `localhost` still requires `BETTER_AUTH_SECRET` itself. | A public development default. Even outside production, start refuses when either URL below is not `localhost` and this is unset. |
| `BETTER_AUTH_URL` | `templates/auth/src/index.ts` | Required. The tenant app's public URL. | `http://localhost:5173` |
| `PLATFORM_URL` | `templates/auth/src/index.ts` | Required. The platform console's public URL. | `http://localhost:5174` |
| `LOCAL_AUTH_SECRET` | `templates/asas/src/local-users/local-users.ts` | 32 characters at least. If it is unset, local accounts are off: every `POST` under `/api/auth/local` answers 503 and the public sign-up answers 403. | Same. |
| `TRUSTED_IP_HEADER` | `templates/auth/src/index.ts`, `local-users.ts` | The header names your proxy overwrites with the client address, comma-separated, such as `cf-connecting-ip`. Both rate limiters key on it. Trust it only behind exactly one proxy that overwrites it on every request. | Defaults to `x-forwarded-for`. |
| `STORAGE_SECRET` | `templates/asas/src/storage/index.ts` | Required. Signs every upload reference and local upload token. Every instance must share it. | A fresh random secret per process, with a warning. |
| `STORAGE_PREFIX` | `storage/index.ts` | Required. The bucket folder this project owns, such as `mithaq/asas`. Every key starts with it, and the sweep lists only inside it. | `mithaq/asas` |
| `STORAGE_ADAPTER` | `storage/index.ts` | Required. Where new uploads go: `local`, or `r2` once R2 is set. | `local` |
| `STORAGE_DIR` | `storage/index.ts` | The folder of the `local` adapter. | `.storage`, relative to the process's working directory. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `storage/index.ts` | All four or none. When all four are set, the `r2` adapter exists. If only some are set, start refuses. | Same. |
| `NODE_ENV` | the apps, the drizzle store, auth, storage | Must be `production`. See below. | Unset or `development`. Password-reset and invitation links are written to the server log only when it is `development` and the tenant URL is `localhost`. |
| `MITHAQ_COUNT_TIMEOUT_MS` | `mithaq migrate` | The per-query timeout, in milliseconds, for counting rows the rules would refuse. The default is 5000. | Same. |

### `NODE_ENV`

Start both built apps with `NODE_ENV=production`. That one setting decides several things:

- `server.ts` calls `connect()` only in production, so only then are migrations checked or applied before serving. The apps read it from `process.env` at run time, so the build cannot bake it in.
- The drizzle store pushes the schema on `connect()` whenever `NODE_ENV` is not `production`. A production database must never be reached by a process without it.
- The production checks for `DATABASE_URL`, the auth URLs and secret, and the storage settings run only in production. Without it, those settings quietly fall back to their development values.

### Storage adapters

Uploaded files go through the storage rukn, the pluggable part that brings the `upload` kind and the storage target. Its config is `templates/asas/src/storage/index.ts`, and the adapters beside it are project files, ejected from `mithaq-admin`, that you own and edit:

| Adapter | File | Use |
| --- | --- | --- |
| `local` | `storage/local.ts` | A folder on this machine. Uploads are a `PUT` to `/api/storage/local/<token>`, signed for one key, type and size. Good for development and CI. In production it only suits a single instance with a persistent disk. |
| `r2` | `storage/r2.ts` | Cloudflare R2, through the S3 adapter. Wired in when the four `R2_*` variables are set. |
| `s3` | `storage/s3.ts` | Any S3-compatible service: AWS S3, R2, MinIO, Backblaze B2. Not wired by default: add it to `adapters` in `storage/index.ts` with its `endpoint`, `bucket`, `region`, keys and `prefix`. |
| `uploadthing` | `storage/uploadthing.ts` | Reads, serves and deletes files already stored on UploadThing. It never uploads, so new files must go to another adapter. Add it to `adapters` with its `token` to serve old files. |

Each upload row stores the name of the adapter that holds its file. `STORAGE_ADAPTER` only picks where new uploads go, so keep every adapter that old rows still name.

`mithaq storage sweep` deletes objects that no row names and that are more than a day old. Run it with `--check` first to see the list (see [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#storage-sweep)).

### Building and starting both apps

Each app's `build` script runs `mithaq lock --check` in `templates/asas`, then `vite build`, which writes `dist/`:

```sh
bun run --cwd apps/asas-tanstack build
bun run --cwd apps/asas-platform build
```

The build keeps `asas` and `mithaq` external: the server bundle imports them from `node_modules` at run time. So deploy the whole workspace with its installed `node_modules` and the `templates/asas` source, including `src/migrations/`, not only `dist/`.

The project's own release check serves each build with `vite preview` under Node. Each app's `preview` script runs it after `mithaq lock --check`. The tenant app uses Vite's default port, 4173, and the platform 4174:

```sh
NODE_ENV=production bun run --cwd apps/asas-tanstack preview
NODE_ENV=production bun run --cwd apps/asas-platform preview
```

A typical deploy runs in this order:

1. `bun install`.
2. Build both apps.
3. With `pending: 'refuse'`, apply migrations with drizzle-kit, as [Applying migrations by hand](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/drizzle/README.md#applying-migrations-by-hand) shows.
4. Start both apps with `NODE_ENV=production` and the variables above.

In CI, after `bun install`, run `mithaq generate --check` in `templates/asas` against a database built from the migrations (see [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#generate---check)).

### The test database

Never point tests at a database you want to keep. A project made by `bun create mithaq` ships without the template's own tests, but its `src/mithaq.ts` keeps one guard: under `node --test`, the build refuses to load without `DATABASE_URL`, so a test you write never falls back to the dev database. The mithaq repository's own tests need a throwaway Postgres set up as [CONTRIBUTING.md](https://github.com/drhomet/mithaq/blob/main/CONTRIBUTING.md#set-up) describes.
