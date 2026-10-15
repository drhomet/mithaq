# Working in a mithaq project

This is the guide to a project made by `bun create mithaq`: getting it running, where each file lives, adding to it, and running it in production.

## Getting started

This walkthrough takes you from an empty folder to a running project with your own kayan in its admin. It takes about an hour.

You need Bun 1.3, Node.js 24 or later, and PostgreSQL 15 or later. Docker is the quickest way to get Postgres.

### 1. Create the project

```sh
bun create mithaq my-app
```

This copies the template into `my-app`, pins `mithaq` to the published package, and installs with the package manager that ran it (`npm create mithaq my-app` works too). A project installs with npm, pnpm 10.6 or later, Yarn 1 or Bun 1.3; Yarn 2 and later install a copy of mithaq for each workspace of a monorepo, which the build refuses. Started by any other, it skips the install and tells you to run it yourself.

A project starts minimal: the language, the asas, the `auth` feature and the `tags` example. `--full` adds every add-on, the whole worked example this guide walks through, and `--with roles,settings` picks some, each with the add-ons it needs. Asked with neither, it offers minimal, full or pick.

| Add-on | What it brings |
| --- | --- |
| `roles` | Roles a tenant writes itself (`roles`), who holds which (`memberRoles`) and the Members page. Without it, a member holds what Better Auth's own `member.role` names: `owner` and `admin` every key, `member` what `packages/mithaq/src/roles/default-member-roles.ts` lists. |
| `audit-log` | The `auditLog` kayan, the `audit` step that writes one row per change, and the activity panel on each edit page. |
| `settings` | The `settings` global, one row per organization. |
| `rich-text` | The `richText` kind, its Lexical nodes (`packages/mithaq/src/mithaq/rich-text-nodes.ts`) and the editor. Without it, no Lexical is installed. |
| `uploads` | The `upload` kind, the storage target and its adapters (`packages/mithaq/src/storage/`). Without it, no storage setting is read. |
| `media` | The organization's images (`media`), which an upload field points at. A holder of `media.create` reads every one; anyone else only what the features pointing at images hand it, such as the courses add-on's covers of the courses they read. Needs `uploads`. |
| `courses` | The worked example: courses, sessions and enrollments, each course with a cover from the media, and the business roles that work them. Needs `media`, `roles`, `audit-log` and `rich-text`. |
| `backoffice` | The backoffice console, `apps/asas-backoffice`. A single package cannot hold it. |

It also asks how the project holds its people, or takes `--organizations`, `--show-organization`, `--sign-up` and `--organization-name` (with `--organization-name-ar`): one organization made by its owner on first run and joined by invitation (the default, and the worked example's: a school), named in code and shown by name or never (`--show-organization no`), or many, each sign-up founding its own. [Organization modes](#organization-modes) has the whole story.

`rich-text` and `uploads` bring words of the language, a kind or a target, so a project's vocabulary is the one its add-ons make; every other add-on brings kayan and pages alone. A project short of an add-on with tables ships no migration: write its first with `bunx mithaq migrate --name init` before it first deploys (see [Running in production](#running-in-production)). No command adds an add-on to a project yet; [Add an add-on](#add-an-add-on) says how to by hand.

What you get is a Bun workspace:

| Folder | What it is |
| --- | --- |
| `packages/mithaq` | The language, `@my-app/mithaq`. `src/mithaq.ts` declares its locales, its arkan (singular rukn, a pillar: a pluggable part that brings kinds, rules or fields), its targets and its screens. Beside it sit the Better Auth setup (`src/mithaq/auth/`), the roles (`src/roles/`), storage, the shared screen pieces and everything else the language or more than one feature reads. |
| `packages/features/<feature>` | One package per feature, `@my-app/<feature>`, each holding one or more kayan (an entity, one data type), each kayan in a folder of its own, such as `packages/features/tags/tags/`. |
| `packages/asas` | The asas, the runtime: `src/asas.ts` builds it from every feature's kayan. It also holds `src/migrations/`, `src/messages/`, each screen's own pages and `src/seed.ts`, and every `mithaq` command runs here. |
| `apps/asas-tanstack` | The tenant app, built on TanStack Start. It serves the dashboard at `/dashboard` and the portal at `/portal`, on `http://localhost:5173`. |
| `apps/asas-backoffice` | With the backoffice add-on, the backoffice console, for staff who work across every organization, on `http://localhost:5174`. |

At the root it also writes `bunfig.toml`, which turns on the isolated linker, a `.gitignore`, and a `tsconfig.json`.

It writes the same `.env` into `packages/asas`, `apps/asas-tanstack` and `apps/asas-backoffice`, readable only by you:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mithaq
LOCAL_AUTH_SECRET=<64 random hex characters>
BETTER_AUTH_SECRET=<64 random hex characters>
BETTER_AUTH_URL=http://localhost:5173
BACKOFFICE_URL=http://localhost:5174
DEV_ADMIN_EMAIL=admin@example.com
DEV_ADMIN_PASSWORD=dev-admin-password
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

### 3. Set up the database

```sh
cd my-app/packages/asas
bun run dev:setup --seed
```

`dev:setup` makes a fresh development database usable in one command:

- It pushes the schema: in development, `asas.connect()` creates or changes the tables to match your kayan, and refuses any change that would lose data.
- It makes the dev admin that `DEV_ADMIN_EMAIL` and `DEV_ADMIN_PASSWORD` in `.env` name, with its address proved: the owner of "Dev admin's workspace" (with one organization through first-run's own path) and, with the backoffice console, its `super_admin`. The output names the two variables, never their values.
- With `--seed`, it fills that organization with sample rows (step 5).

It refuses unless `NODE_ENV` is `development` or unset and `DATABASE_URL`, `BETTER_AUTH_URL` and, with the backoffice console, `BACKOFFICE_URL` are on this machine, since every project's `.env.example` holds the same development password and a deploy run with plain `node` sets no `NODE_ENV`. It refuses a database that already holds a user, saying how to sign in instead, and a `DEV_ADMIN_PASSWORD` of a length sign-up would refuse.

Whenever you add or change a kayan, push the schema again:

```sh
# development only
bun -e "const { asas } = await import('./src/asas.ts'); await asas.connect(); await asas.destroy()"
```

`bun` reads `.env` for you, so `DATABASE_URL` is already set.

A pushed database is for development only. Production applies the migration files in `src/migrations/` instead, and refuses a database that was pushed. [Running in production](#running-in-production) explains how.

### 4. Run both apps

```sh
cd ../..
bun run --cwd apps/asas-tanstack dev   # the tenant app, http://localhost:5173
bun run --cwd apps/asas-backoffice dev   # in a second terminal: the backoffice console, http://localhost:5174
```

Each `dev` script first runs `mithaq lock --check`. The template has no `mithaq.lock`, so this prints a notice and carries on.

### 5. Sign in and seed

Sign in to the tenant app at `http://localhost:5173`, and to the backoffice console at `http://localhost:5174`, with `DEV_ADMIN_EMAIL` and `DEV_ADMIN_PASSWORD`.

A deploy has no dev admin, and is set up by hand, as you can here on a database `dev:setup` did not set up. With one organization, open `http://localhost:5173/auth/first-run`: the account made there owns the one organization (you name it there, unless it is never shown) and, with the backoffice console, is its first `super_admin` too. Until then every sign-up is refused, and the sign-in page sends you there. `vite dev` on this machine asks no setup code; anywhere else first-run asks the `SETUP_CODE` the server was started with.

With many organizations, open `http://localhost:5173/auth/sign-up` and sign up, then open the link the server log shows to choose your password, which proves your address. Signed in and in no organization yet, you are offered your invitations and a box to create an organization: creating it makes you its owner. The backoffice console's first administrator is made on its own `/auth/create-first-user`.

Either way the owner holds every permission in the organization: through the `administrator` role the roles add-on gives an owner, or through `owner` itself without it.

`--seed` filled the organization with sample rows of what the project holds: tags, and with the add-ons courses, sessions, enrollments, roles and settings. To fill it again, or one you set up by hand:

```sh
cd packages/asas
bun run seed
```

The seed takes the first user and that user's first organization, or the ones `SEED_EMAIL` and `SEED_ORGANIZATION` name, and writes every row through the asas's own operations, as that owner. Running it twice adds nothing.

The backoffice console admits backoffice staff only: the dev admin, the owner first-run made, or, with many organizations, the administrator made on its first-administrator page.

### 6. Add your first kayan

This section adds `notes`: a title and a done flag, owned by one organization, listed and edited in the dashboard, as a feature of its own. Run each command from `packages/asas`.

#### The feature

A feature is a package beside the others: `packages/features/notes/package.json`, the same as `packages/features/tags/package.json` with `"name": "@my-app/notes"`, and `packages/features/notes/index.ts`, which lists its kayan:

```ts
import { notes } from './notes/notes.ts'

export const kayan = [notes] as const
```

#### The kayan file

Create `packages/features/notes/notes/notes.ts`:

```ts
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan, organization } from '@my-app/mithaq'
import { appPage, danger } from '@my-app/mithaq/mithaq/pages.ts'

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

Add `"@my-app/notes": "*"` to the dependencies in `packages/asas/package.json`, run `bun install`, and spread the feature's kayan into the build in `packages/asas/src/asas.ts`:

```ts
import * as notes from '@my-app/notes'

export const asas = buildAsas({
  kayan: [...auth.kayan, ...roles.kayan, ...tags.kayan, ...courses.kayan, ...auditLog.kayan, ...notes.kayan],
  // ...
})
```

Then add it to the dashboard screen's `kayan` list in `packages/mithaq/src/mithaq.ts`:

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

You see it because the `administrator` role holds every key. Any other role needs the note keys added to it in `packages/mithaq/src/roles/tenant-roles.ts`: `notes.find`, `notes.findByID`, `notes.create` and so on, plus a key per readable field, such as `notes.fields.title`. `mithaq screens` prints the key each nav entry needs.

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

`bun create mithaq my-app` copies the template at the version of `mithaq` it was published with, pins `"mithaq": "npm:@drhomet/mithaq@<version>"` and `"mithaq-admin": "npm:@drhomet/mithaq-admin@<version>"` at that one version, names the project's packages under its own scope (`@my-app/...`), writes fresh secrets into three `.env` files and runs `bun install`. The project is a workspace of three steps, each named after what it holds, and each imports only the steps before it:

1. **The language** (`packages/mithaq`): `defineMithaq`, its targets and arkan, and what the language or more than one feature reads.
2. **The features** (`packages/features/*`): one package per feature, each holding one or more kayan.
3. **The asas** (`packages/asas`): `buildAsas` over every feature's kayan, with the migrations, the copy and the seed.

```
my-app/
  README.md           this guide
  AGENTS.md           the rules for a coding agent working in the project
  CLAUDE.md           one line, @AGENTS.md, so Claude Code reads the same rules
  package.json        workspaces packages/mithaq, packages/features/*, packages/asas and apps/*; no scripts
  tsconfig.json       one strict config over every package's .ts and apps/*/src
  .gitignore          node_modules, .env, dist, .storage/
  packages/
    mithaq/           package "@my-app/mithaq": the language
    features/
      auth/           package "@my-app/auth": the Better Auth kayan and the local accounts
      roles/          package "@my-app/roles": custom roles and each member's roles
      courses/        package "@my-app/courses": courses, their sessions and enrollments
      media/          package "@my-app/media": the organization's images
      tags/ audit-log/ settings/
    asas/             package "asas": the build, the migrations, the copy, each screen's own pages
  apps/
    asas-tanstack/    the tenant app: the dashboard and portal screens, sign-in pages, /api
    asas-backoffice/    the backoffice console: the backoffice screen, for staff
```

The language never imports a feature or the asas, and a feature imports another only through its `index.ts`, or names its kayan by name (`relationTo: 'user'`). The apps import the project only through the `asas` package (`import { asas } from 'asas'`), never by a path into `packages/`; it keeps that name because the screen host imports it by it. `packages/asas`, `apps/asas-tanstack` and `apps/asas-backoffice` each hold a `.env` with the same secrets. The backoffice app derives its own session secret from `BETTER_AUTH_SECRET`, so the two apps share one session table and never a session.

`bun create mithaq my-app --layout single` makes the same tree one package instead: `packages/mithaq/src/` and `packages/asas/src/` are both `src/`, each feature is `src/features/<feature>/`, and the tenant app's `src/` joins them. Each import of the language or a feature is then a path, and every `generate` path in `src/mithaq.ts` is written from the package's root.

The template's own tests stay in the mithaq repository. A new project has none of its `*.test.ts` files or test helpers, and writes its own.

### `packages/mithaq`

```
packages/mithaq/
  package.json        exports ".", "./auth", "./auth/backoffice-roles" and "./*" for every file under src/
  components.json     where mithaq eject writes the storage and step files
  src/
    mithaq.ts         defineMithaq: locales, arkan, targets, screens, generate paths
    mithaq/
      auth/           the Better Auth options and instances, the backoffice session and roles
      pages.ts        the page trees every kayan page starts from
      audit-sink.ts   where the audit step hands each write
      rich-text-nodes.ts
    roles/            tenant-roles.ts, system-roles.ts, tenant-access.ts, grants.ts, statements.ts
    ui/               the shells, layouts and pieces several screens draw
    storage/          the storage config, its adapters and defaults
    steps/            steps ejected from mithaq-admin
```

**`src/mithaq.ts`** declares the language with one `defineMithaq` call and exports what it returns: `defineKayan`, `defineGlobal`, `buildAsas`, `rows`, `user`, `generate`, `locales`, `targets` and the tenant target. It also exports `organization`, the tenant target's field with a label, which every per-organization kayan places. The arkan (`base`, `richText`, the storage rukn and `versions`), the server targets (`drizzle`, `zod`, `rbac`, `tenant`, `service`) and the three screens (`dashboard`, `portal`, `backoffice`) are laid down here. `generate` names, from `packages/asas` where every `mithaq` command runs, where each writes and reads: the language the generated kayan import, the features folder, the auth kayan, the providers module, the messages and migrations folders and each screen's routes folder in an app. The language names the asas's folder (its migrations and each screen's own pages) and, with the courses add-on, its session labels by path, and imports neither.

**`src/mithaq/auth/`** is the Better Auth setup: `organizations.ts` the organization mode and who may sign up ([Organization modes](#organization-modes)); `index.ts` the options and instances (`providers`), the backoffice session, `asBackoffice` and `onBackoffice`, and the two apps' URLs; `backoffice-roles.ts` the backoffice roles staff hold on `user.role`, the columns staff read, and `secret`, the columns no backoffice role reads. It is imported as `@my-app/mithaq/auth`.

Better Auth's organization routes let any member read every member. The setup gates them by this project's keys, in the active organization alone: `list-members`, and `get-active-member-role` with a `userId`, need `member.find`; `list-invitations` needs `invitation.create`; `get-full-organization` answers the organization to every member, with its `members` empty (and loaded one at most) without `member.find` and its `invitations` empty without `invitation.create`; `get-invitation` answers the invitee without the inviter's address. Only the `administrator` role (and, without the roles add-on, `owner` and `admin`) holds `member.find`, and the Members page is served on it.

`organizationLimitsFor` in the same file sets the provider's limits rather than leaving its defaults: with many organizations a person founds organizations only while they belong to fewer than five, and with one nobody founds one over HTTP; an organization holds up to 10,000 members (without end with one) and 1,000 pending invitations, and the Members page reads every member a page at a time. A new session opens in the person's oldest membership (the first by id among ties), and leaving the active organization opens the next oldest.

**Access and roles.**

- `roles/tenant-roles.ts` holds the roles every organization has, written in code and never stored as rows. A key is `<kayan>.<operation>`, `<kayan>.fields.<field>` or `screen.<screen>`. Without the roles add-on they are Better Auth's own `owner`, `admin` and `member`, from `roles/default-member-roles.ts`, and the access target is `memberRoleTarget`, which answers each member what its `member.role` names in that organization.
- `roles/system-roles.ts` joins them with the backoffice roles into `systemRoles`, which the access target takes.
- `roles/tenant-access.ts` holds the row table every per-organization kayan inherits, the reader that answers an actor's roles, and the backoffice's checks; `roles/grants.ts` what the role form and the server both read.
- `membersOf` in `roles/tenant-access.ts` is whom a `user` read reaches in a tenant: every member to a holder of `member.find`, and to anyone else itself and the members holding a role its own roles name in `peopleAudience` (the instructor reads the students). A role it leaves out, a custom role included, reads itself alone, whatever `user.*` keys it holds; so does a picker or a refusal that names people through that read. A seat's student picker narrows that read to the people holding the student role, through `enrollments.student`'s `filterOptions`, and a seat for anyone else is refused; its session picker offers open sessions of open courses alone, and a seat in an archived one is refused in words of its own.
- `roles/statements.ts` holds the keys the project adds beside the kayan's own operations.

**Configurable features**, each with its add-on.

- `storage/index.ts` is the storage config. It names every function in `storage/defaults.ts`, and the adapters `local.ts`, `r2.ts`, `s3.ts` and `uploadthing.ts`. Those five files are ejected from the `mithaq-storage` item of `mithaq-admin` and end with a marker line.
- `steps/expected-updated-at.ts` is ejected from the `mithaq-expected-updated-at` item.
- `mithaq/rich-text-nodes.ts` is the one list of rich-text nodes the server and every editor read. The `richText` rukn comes from `mithaq/rich-text` and the editor from `mithaq-admin/rich-text.tsx`, and only those two load Lexical, so its packages are listed in each `package.json` that uses them; `mithaq` itself installs none.

**Shared page pieces.** `src/ui/` holds what every screen draws with: the shells (`app-shell.tsx`, `top-shell.tsx`), the layouts (`record-page.tsx`, `table-page.tsx`), the shared providers and the activity panel. A piece is named with `ui('file.tsx#Export')`, where `ui` is a `folderOf` over its folder, and the build refuses a missing file or export.

### `packages/features`

Each feature is a package that exports its `index.ts` alone, which lists the feature's kayan as `kayan` (and `global`, for a single-row kayan); the asas imports each feature as a namespace and spreads `courses.kayan`, so the list never collides with a kayan of the same name. The media feature's `kayan` is a function of the reads that open an image to someone without `media.create`, which the asas hands it from the features pointing at images, such as `courses.coverReads`, so media imports none of them. Each kayan has a folder of its own, named after it in kebab case, holding a file of the same name that exports it:

```
packages/features/courses/
  package.json        "@my-app/courses", exports "." and "./domain/*"
  index.ts            export const kayan = [courses, sessions, enrollments] as const, and coverReads
  courses/
    courses.ts        export const courses = defineKayan({ name: 'courses', ... })
    ui/               page pieces only this kayan draws with
  sessions/           a child kayan is a sibling folder, never nested
  enrollments/
  domain/             plain data the asas's pages read too, which imports nothing
```

A kayan's `name` is camelCase (`auditLog`, `memberRoles`), and a multi-word table sets `dbName` in snake case (`audit_log`, `member_roles`). `<kayan>.access.ts`, `<kayan>.steps.ts` or `<kayan>.screens.ts` sit beside the kayan file once they outgrow it.

**`auth/user/`** holds the kayan Better Auth's tables become: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `organizationRole` and `index.ts`, which groups them by plugin. `mithaq generate auth` writes them from the options in `packages/mithaq/src/mithaq/auth/index.ts`, and each starts with `Written by` and is never edited. The project's own choices for one of them go in `<kayan>.access.ts` and `<kayan>.screens.ts` beside it, which the generator imports on its next run.

### `packages/asas`

```
packages/asas/
  package.json        "asas": exports ".", "./messages/*", "./ui-dashboard/*"; script "seed"
  mithaq.hints.json   the project's answers to "is this a rename?" questions mithaq migrate asks
  mithaq.lock         the signed vocabulary, when the project keeps one
  .env.example
  src/
    asas.ts           buildAsas: every feature's kayan, globals, HTTP plugs, statements, auth
    mithaq.ts         where the mithaq command reads the language from
    messages/         one JSON file of copy per kayan, written by mithaq generate messages
    migrations/       written by mithaq migrate, committed
    ui-dashboard/ ui-portal/ ui-backoffice/   what one screen draws, such as its home page
    backoffice-http.ts seed.ts
```

**`src/asas.ts`** builds the asas: `export const asas = buildAsas({ kayan, global, http, statements, auth })`. A feature joins the project when it is a dependency here and its `kayan` is spread into `kayan`.

**`src/messages/`** holds `<kayanName>.json` for each kayan, keyed by the kayan's name (`courses.json`, `auditLog.json`), and `mithaq.json` for the copy every kayan shares, such as the default fields' labels. `mithaq generate messages` writes them from the labels and `messages` in the kayan. The apps import them as `asas/messages/<name>.json`.

**`src/migrations/`** holds one folder per migration, `<timestamp>_<slug>/` with `migration.sql` and `snapshot.json`, and two files `mithaq migrate` writes and the project commits: `schema.ts`, which names every table, and `drizzle.config.ts`, which `drizzle-kit migrate --config src/migrations/drizzle.config.ts` reads. `mithaq migrate --name <slug>` sets the slug.

**The rest.** `backoffice-http.ts` is the one hand-written route, renaming an organization, which writes a Better Auth table no managed operation may write. `seed.ts` fills a database for a first look, run with `bun run seed`.

### The two apps

Both apps are TanStack Start apps on Vite. Each app's `dev`, `build` and `preview` script runs `mithaq lock --check` in `packages/asas` first, so a red lock stops it from starting.

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
    no-organization.tsx  what /unauthorized offers someone in no organization
    routeTree.gen.ts     written by TanStack Router
```

The app owns its copy, its routes, its providers and its styling. It says nothing about any kayan: what a kayan is and what a screen draws of it come from the template and the generated files.

**`apps/asas-backoffice`** is the backoffice console for staff, at `http://localhost:5174` in development. It has the same shape and serves the `backoffice` screen alone. Its `server.ts` runs every request inside `asBackoffice`, so the backoffice roles are answered in this app and never in the tenant app. Its `copy.ts` re-exports the tenant app's.

### Naming and where files go

| What | Where and how it is named |
|---|---|
| A feature | `packages/features/<kebab-name>/`, a package `@my-app/<kebab-name>` whose `index.ts` exports its `kayan` |
| A kayan | `<feature>/<kebab-name>/<kebab-name>.ts`, exporting `const <camelName> = defineKayan({ name: '<camelName>' })`; a child kayan is a sibling folder |
| A kayan's own page pieces | `<kayan>/ui/<kebab-name>.tsx`, PascalCase exports, named as `ui('<file>.tsx#<Export>')` |
| Shared page pieces | `packages/mithaq/src/ui/`, or `packages/asas/src/ui-<screen>/` for one screen |
| A step used by one kayan | in the kayan's file, beside the operation that lists it |
| A step several features share | `packages/mithaq/src/steps/<kebab-name>.ts` |
| Copy | `packages/asas/src/messages/<camelName>.json`, written by `mithaq generate messages` |
| Migrations | `packages/asas/src/migrations/<timestamp>_<slug>/`, written by `mithaq migrate --name <slug>` |
| Screens | each app's `src/routes/(screens)/`, written by `mithaq generate screens` |
| Better Auth kayan | `packages/features/auth/user/`, written by `mithaq generate auth`; the project's choices in `<kayan>.access.ts` and `<kayan>.screens.ts` |
| Tests | beside the code they test, as `<name>.test.ts`; shared test helpers as `test-<name>.ts` |

A file a generator writes starts with a line saying which command wrote it, such as `// Written by \`mithaq generate screens\`. Do not edit.`, and changes only by rerunning that command. A file ejected from `mithaq-admin` ends with a marker line, `// mithaq-admin <version> <hash>`, and is the project's own to edit; `mithaq upgrade --check` reports which were edited or differ from the installed package.

## Organization modes

How the project holds its people is seven values in `packages/mithaq/src/mithaq/auth/organizations.ts`, which `create-mithaq` writes and you change by hand. In every mode a per-organization kayan places `organization` and core scopes it, so changing the mode moves no row.

| Value | What it says |
| --- | --- |
| `organizations` | `'one'`: one organization, made on `/auth/first-run`. `'many'`: anyone who signed up and proved their address founds their own, or joins one by invitation. The tenant target reads it too: in one, a start over more than one organization is refused. |
| `showOrganization` | With one, whether a page names the organization. `false`: first-run asks no name, the Members page is Users, the sidebar shows the app's name and no page names an organization. `'many'` takes `true`. |
| `signUp` | With one, who makes an account: `'invite'`, only someone holding an invitation, or `'open'`, anyone. `'many'` takes `'open'` alone. |
| `joinRole` | The role an open joiner is given, from `roles/tenant-roles.ts`, or `null`: they join with none, read nothing, and an administrator gives them a role on the Members page. That is how a project approves each joiner. A role that holds every key is refused. Without the roles add-on it is `null`. |
| `verifyEmail` | With an open sign-up, whether an account proves its address by a mailed link before it signs in (and, with one, joins). `'many'` takes `true`: anyone founds an organization there, so a sign-up must tell nobody which addresses have an account. |
| `allowedDomains` | With an open sign-up and `verifyEmail`, the only address domains that may sign up: `example.com` is that domain exactly, `*.example.com` every domain under it. An international domain is written as its `xn--` form. |
| `organizationName` | The organization's name in each locale the language reads and no other, `{ en, ar }`, the first the one every other falls back to; the language refuses to load otherwise, in every mode, since every organization's names are held to these locales. With one, it is the organization's name (`create-mithaq --organization-name`, `--organization-name-ar`). It lives in code: first-run asks none, the first request a process serves writes it onto the row, and nothing renames it over HTTP, the backoffice included. Change it here and deploy. |

**Names in every locale.** In every mode an organization holds its name in each locale of the project: `names`, a column `mithaq generate auth` writes onto the organization kayan from the auth setup's `additionalFields`, holds the JSON of one name per locale, and `name` is the default locale's, which every other falls back to. With many organizations, founding one asks its name in each locale, the default's required and the others optional, and so does the backoffice's rename. Each page names an organization in the reader's language, and each mail in each of its languages. `nameIn` in `organizations.ts` reads it.

A combination that means nothing or opens a door refuses to load, naming the line to change: `'many'` with `'invite'`, a join role, domains, no verification or no organization shown; domains without verification or by invitation; a join role that is no role. A production start with no mailer is refused in every mode, since no reset, proof or invitation would reach anyone ([Environment variables](#environment-variables): `RESEND_API_KEY` and `MAIL_FROM`).

**First run.** In one organization, nothing signs up until the owner is made. `/auth/first-run` takes a name, an address, a password and the setup code, and makes the owner, the organization, named by `organizationName`, and the owner's `administrator` role in one transaction. While the backoffice console has no administrator it makes the owner one, under the lock its own first-register takes, so the two never both make one. The account is verified, since the code is the proof, and its address is mailed once, after the answer, that an administrator account was made with it, so an address typed wrong is noticed by the mail that never came; the backoffice's first-register mails its administrator the same. Once an organization exists it answers every caller the same refusal. Set `SETUP_CODE` to a random value of 32 characters or more where the app runs (`openssl rand -hex 32`), and remove it once the app is set up: it opens nothing after that, but it need not linger.

**By invitation.** A sign-up carries the id of a pending invitation sent to that address; the invitation link's sign-up page sends it. The server accepts that invitation for the account it makes, so the person is in without a second press: at once where holding the id is the proof (one organization by invitation), or, where the sign-up proves its address, when the one link mailed for that sign-up is opened; that mail names the organization it joins. The address's own later sign-up or a password reset takes the invitation off every earlier link, so whoever signs up first with an address they invited never joins its owner to their organization. An id sent to another address, cancelled or expired by then joins nobody. Anything else is refused with one answer, before the provider looks the address up, so the refusal tells nobody whether an address has an account. The same rule holds wherever the tenant app makes an account, so a sign-in method added later cannot open a way past it. Only the backoffice console's `/admin/create-user`, which staff alone reach, makes an account without it.

**Invitations.** Each invitation is mailed in one fixed letter, its subject naming no organization and its body the organization's name escaped. An organization's name is one line of 1 to 100 characters however it is made or renamed: a line break, a control character or a direction override in it is taken out, and the backoffice's rename refuses one. Sending an invitation again needs `invitation.create` in the active organization, as a new one does. With many organizations, where anyone founds one, it is mailed only for an inviter whose own address is proved. Each organization mails at most `invitationLimits` of them, ten a minute and a hundred a day, whoever invites, counting each invitation sent again and each person added once the request succeeds (`packages/mithaq/src/mithaq/auth/index.ts`), beside ten a minute from one address. The Members page lists each pending invitation to whoever may invite, with Copy link in every environment, for an address the mail does not reach: the link lets whoever holds it join as the invited address, so hand it to that person alone.

**Add person.** With one organization the Members page's first action is Add person, for whoever holds `member.create`: a name, an address and a role they may hand over, sent in one request to `/organization/add-person`, served on the tenant instance with one organization alone. It makes the account with no password, the membership in the caller's own active organization (a body naming another is not read) and the role, under the same rule a role assignment keeps (a role whose every key the caller holds), and mails a link to choose the password that lasts 48 hours; with no mailer the link is answered for the administrator to hand over. Nobody ever knows another's password. An account whose address nobody proved, which may be someone else's squat, is handed to its mailbox: its password and sessions end before it is added. An account whose address is proved, or a staff member's, is never added without its word: it is sent an invitation instead, and an existing member is refused. A person added has joined once, as an open sign-up records it, so removed they never join again by one. Invite stays beside it.

**Open.** With `verifyEmail`, and always with many organizations, the sign-up asks a name and an address alone, answers with no session and mails a link to choose the account's password, and it answers a new address, one nobody proved and one proved the same. The link opens `/auth/set-password`, "Choose your password", which shows the account's address and cannot change it; a forgotten password's link opens `/auth/reset-password`, the same form. Choosing the password proves the address, ends every session, signs the person in through the ordinary sign-in with the password just chosen and, with one organization, joins them to it as `joinRole`; a password reset proves it the same way. A password a sign-up carries anyway is replaced by one nobody knows, so whoever signs up first with another's address never holds a password to it and gains nothing: the link goes to the address, and its owner's own sign-up is answered alike and, once the first link is five minutes old, mails another. A sign-in before the proof is refused and mails nothing, so nobody pushes links at an address on demand. Without `verifyEmail`, the account joins at once. An account joins once in its life, recorded as a `joined-open:<user id>` row in the `verification` table that never expires: never purge those rows, or a removed member who resets their password joins again. One address is mailed at most one link in five minutes: a second sign-up or reset within five minutes mails nothing, since the first link still works, and a reset ends every other link to the account. Mail goes out after the answer, so how long a sign-up or a reset takes says nothing about whether an address has an account. The join reads the settings when it happens, never joins someone holding an invitation still to answer (that invitation is how they join) or who accepted one, while one cancelled, declined or expired counts for nothing, and never joins a member who was removed: removing someone keeps them out.

**In no organization.** Someone signed in who belongs to no organization (a new account with many organizations, or a member removed from their last) is shown, under the sentence saying so, the invitations sent to their address once it is proved, each to accept or decline; with many organizations a box to create one, named "{name}'s workspace" until they change it, which `organizationLimit` still caps; and the address an administrator would invite. The app draws this from `src/no-organization.tsx`, which the screen host's `/unauthorized` imports.

The only owner of an organization is never deleted, by the backoffice's remove-user or by a delete of their own should one be turned on: the organization would be left with nobody who governs it. Make another member an owner first.

In one organization, nobody founds another organization or leaves the one over HTTP. Each sign-up, join, invitation accepted on the server, person added, first-run and role the setup gives writes one JSON line to the server log (`"audit":"auth"`), beside the backoffice's own; keep that output.

**Changing the mode.**

- `showOrganization`: change the value and run `bunx mithaq generate screens`, which renames the Members page. No row moves.
- `'one'` to `'many'`: set `organizations = 'many'`, `showOrganization = true`, `signUp = 'open'`, `joinRole = null`, `verifyEmail = true` and `allowedDomains = []`. Organization creation comes back on the page of someone in no organization, and the switcher appears once someone belongs to two. Review every kayan without `organization`, which every organization will share.
- `'many'` to `'one'`: a start is refused while more than one organization exists. Merging them is a migration of your own: point every per-organization row at one organization, resolve what each held once (a `within` unique value, the settings row, roles of the same name) and keep one owner.
- `'open'` to `'invite'`: every account and membership stays, and nobody joins without an invitation from then on. `'invite'` to `'open'`: accounts that exist with no membership are not joined; new ones are.

## Upgrading

What a project made before the sign-up round changes when it takes this version:

- **A sign-up that proves its address asks no password.** The page asks a name and an address; the person chooses the password on `/auth/set-password`, which the sign-up's and Add person's links now open. Copy `src/choose-password.tsx` and `src/routes/auth.set-password.tsx` from the template into `apps/asas-tanstack`, replace `auth.reset-password.tsx` and `auth.sign-up.tsx` with the template's, and run the app once so the router writes `routeTree.gen.ts`. A link mailed before still opens the reset page, which takes the same token.
- **An organization holds its name in each locale.** Run `bunx mithaq generate auth`, which adds `names` to the organization kayan, then `bunx mithaq migrate --name organization_names`. With one organization add `organizationName` to `organizations.ts`, `{ en, ar }`, holding the name the row has: the next start writes it onto the row, and first-run asks no name. Add `organization.fields.names` beside `name` to each backoffice role that reads organizations (`backoffice-roles.ts`).
- **The screen host is ejected again** in both apps (`bunx mithaq eject mithaq-screens-host`, keeping the files each app held): its language switch redraws the page in place with `showLocale`, which the app's `src/copy.ts` now exports beside `switchLocale`, and `/unauthorized` sends someone whose role opens one screen straight there. Copy `showLocale` and the new `auth` keys from the template's `copy.ts`.

What a project made with the platform console changes when it takes this version, where the console is the backoffice:

- **The target and its app are renamed.** In `packages/mithaq/src/mithaq.ts` the screen target `platform` is `backoffice`, which changes the vocabulary: run `bunx mithaq lock` in `packages/asas` and approve it. Move `apps/asas-platform` to `apps/asas-backoffice` (its `package.json` name too), `packages/asas/src/ui-platform/` to `ui-backoffice/` and `packages/mithaq/src/mithaq/auth/platform-roles.ts` to `backoffice-roles.ts`, then run `bunx mithaq generate screens` and eject the screen host again in both apps.
- **Names that said platform say backoffice.** `PLATFORM_URL` is `BACKOFFICE_URL`, the permission key `screen.platform` is `screen.backoffice`, the route `/platform` is `/backoffice`, and `asPlatform`, `onPlatform`, `platformApp`, `platformRoles` and the rest are `asBackoffice`, `onBackoffice`, `backofficeApp`, `backofficeRoles`. The console's session cookie is `mithaq-backoffice.session_token`, so staff sign in once again.

What a project made before the organization lifecycle round changes when it takes this version:

- **'none' is gone.** Write `organizations = 'one'` and `showOrganization = false` in `packages/mithaq/src/mithaq/auth/organizations.ts`; nothing else moves.
- **Many organizations prove every address.** Set `verifyEmail = true`: `'many'` with `false` refuses to load anywhere, development included. Every account made before is unproved and is refused at sign-in until its owner chooses a password from a reset link (Forgot password), which proves the address; tell your people before you deploy.
- **Every production start needs a mailer.** `RESEND_API_KEY` and `MAIL_FROM`, with many organizations and with one by invitation as with an open sign-up; a deploy without them stops starting. The check runs as the auth setup loads, so a start missing both a mailer and `DATABASE_URL` names the mailer first.
- **The host's `/unauthorized` imports `src/no-organization.tsx`** from the app. Copy the tenant app's from the template into `apps/asas-tanstack/src/`, and the backoffice's, which draws nothing, into `apps/asas-backoffice/src/`, before you eject the screen host again.
- **Organization names are one line of at most 100 characters.** A name stored before with a line break, a control character or a direction override, or longer, is refused on its next rename until it is put right: rename it on the backoffice, or once in SQL, `update organization set name = btrim(regexp_replace(name, '[[:cntrl:]\u2028\u2029\u202a-\u202e\u2066-\u2069]+', ' ', 'g')) where name ~ '[[:cntrl:]\u2028\u2029\u202a-\u202e\u2066-\u2069]'`, and shorten any past 100 by hand.
- **`src/mail/`.** `configuredMailer` in `src/mail/index.ts` is a function the auth setup calls as it loads, and `resendMailer` takes `baseURL`; `bunx mithaq upgrade --check` names `src/mail/mailers.ts` as differing.

What a project made before the data round changes:

- **A relationship restricts unless it says otherwise.** A row another row points at, through a single relationship, a set or an upload, or that a row's latest draft names, is not deleted; the refusal counts them and names the ones the caller reads. An optional relationship that relied on being set null writes `rules: { onDelete: 'set null' }`, and a set that should let its rows go writes `onDelete: 'cascade'`. Run `bunx mithaq migrate --name restrict` for the foreign keys that change.
- **A student holds one seat in a session.** The migration that adds the key stops on a database where one student holds two standing seats in one session; withdraw one of them first. This query lists each pair that holds more than one: `select session_id, student_id, count(*) from enrollments where deleted_at is null group by session_id, student_id having count(*) > 1`.

## Adding to the project

Paths are written from the root of a project made by `bun create mithaq`, as laid out in [Project structure](#project-structure). `packages/mithaq` holds the language, its Better Auth setup and roles, `packages/features/*` every kayan, `packages/asas` the build, and `apps/asas-tanstack` and `apps/asas-backoffice` are the two host apps. The worked examples in the template are `courses` (`packages/features/courses/courses/courses.ts`) and `tags` (`packages/features/tags/tags/tags.ts`). Read them for shape.

Every `mithaq` command runs from `packages/asas`. The bin runs under Node and does not read `.env`, so set `DATABASE_URL` in the shell for any command that reaches a database, and point it at a throwaway database while you work.

### First, decide who may make the change

Most changes are free. Everything you write in `defineKayan`, `defineGlobal` and `buildAsas` is yours: fields, rules a kind already accepts, copy, access, operations, steps, indexes, pages. In `defineMithaq` you may change a screen's pages and `kayan` list, shells and components, roles, steps and the `generate` paths.

The vocabulary of `defineMithaq` is frozen. It is the locales, each kind's label, message and accepted rules, each rule's message and excludes, each target's name and capability, and the list of root keys. Only the project's owner signs a change to it (see [Add a kind or a rule](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/README.md#add-a-kind-or-a-rule)). If the change you need cannot be said without touching that vocabulary, stop, tell the owner what you would change and why, and wait.

### Where a piece belongs

`buildAsas` refuses a misspelled key, a missing `ui()` file or export, a join drawn as a leaf, a list inside a form and a role key the catalog does not hold. The type checker refuses a missing locale. What follows is judgement that no check makes for you.

- **A field says what a value is, and a step says what a write does.** A kind, its rules, its label, its options and who may read it go on the field. Deriving a column or writing another kayan goes in a step, as `markArchived` and `createSessions` do in `courses.ts`.
- **A rule only a form enforces is not enforced.** Every operation is served over HTTP, so a caller can skip the form. Put the rule in the field's `rules` or in a step. A `when` on a page node only decides whether the node is drawn.
- **A page component draws and calls operations.** It holds no rule and no write of its own. It lives in the kayan's own `ui/` folder when only that kayan draws with it, in `packages/mithaq/src/ui/` when several share it, and in `packages/asas/src/ui-dashboard/`, `ui-portal/` or `ui-backoffice/` when it is one screen's own.
- **The host app wires things together and says nothing about a kayan.** It holds the copy, the generated routes and the providers. A fact about a kayan written in an app drifts away from the kayan.
- **A new action is a custom operation, not a hand-written endpoint.** An operation gets its permission key, the access check, the transaction and the audit step, and a page can draw it as a button. The template writes one route by hand, `backofficeHttp` in `packages/asas/src/backoffice-http.ts`, because it writes a Better Auth table no managed operation may write. Follow it only for a provider's own table.
- **Rows of another kayan on a record page are a related list.** Write a `list` node with `of` and `where` beside the form, as the Sessions tab of a course does. A `join` field holds the data, and a page that names it as a leaf is refused.
- **A list's states are tabs.** A list node's `tabs` names each one with its `where`, and the list opens on the first, as the courses list opens on Active, keeping archived courses out of the way. A tab narrows what the read answers and never widens it.
- **A row leaves and comes back through operations of its own.** A course is archived and unarchived, each with its reason, and unpublished back to a draft, as Payload's Unpublish does; a session is archived and unarchived the same way. Each is a line of the activity; `archived` is never set by a create, and on a course by no plain update either.
- **One row per organization is a global.** Write `defineGlobal` with the `organization` field required and unique, as `packages/features/settings/settings/settings.ts` does.
- **A column some reader may not see is never filterable, sortable or searchable.** A served `find` takes a `where` on any column the actor reads, so a filter on such a column answers yes or no about values the reader cannot see. Refuse it in a step before the store, as `queriedByQueryable` does in `packages/features/audit-log/audit-log/audit-log.ts`.

### Add a kayan

The example adds `rooms`, a per-organization list of rooms with a name and a capacity.

1. **Write the kayan file.** Create `packages/features/rooms/rooms/rooms.ts`, in a feature of its own as [Add your first kayan](#6-add-your-first-kayan) lays out, or in the folder of a feature it belongs to. Open `fields` with `...defaultFields` and `organization`, and `targets.service.operations` with `...defaultOperations`. Give every label one string per locale the language declares.

   ```ts
   import { defaultFields, defaultOperations } from 'mithaq'
   import { defineKayan, organization } from '@my-app/mithaq'
   import { appPage, danger } from '@my-app/mithaq/mithaq/pages.ts'

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

4. **Leave `access` out unless its rows differ from the tenancy rows.** A kayan that places `organization` and writes no `access` inherits the row table the access target was given (`tenantAccess` in `packages/mithaq/src/roles/tenant-access.ts`). Plain callbacks such as `access: { read: fn }` are ANDed with those rows, so they only narrow, as `courses` does for archived courses. A table built with `rows({ ... })` replaces the inherited rows, as `packages/features/roles/roles/roles.ts` does.

5. **Register it.** Add `rooms` to its feature's `kayan` list; a new feature is a dependency of `packages/asas/package.json` whose `kayan` is spread into `buildAsas` in `packages/asas/src/asas.ts`. A kayan that writes `targets.dashboard` must also be listed in that screen's `kayan` array in `packages/mithaq/src/mithaq.ts`, or the build refuses it with "does not list it in kayan". That array is not part of the vocabulary, so listing a kayan needs no signature.

6. **Give roles their keys.** A key is `<kayan>.<operation>` or `<kayan>.fields.<field>`. The `administrator` role holds `'*'`. Add to each other role in `packages/mithaq/src/roles/tenant-roles.ts` the operations and columns it should reach. If the backoffice screen lists the kayan, add its columns to the staff reads in `packages/mithaq/src/mithaq/auth/backoffice-roles.ts`, or to `secret` for a column no backoffice role may read.

7. **Generate copy and screens.**

   ```sh
   cd packages/asas
   bunx mithaq generate messages
   bunx mithaq generate screens
   ```

   `generate messages` writes `src/messages/rooms.json`. Import it into `apps/asas-tanstack/src/copy.ts` as the kayan's scope, the way that file imports `courses.json`. The backoffice app re-exports the same file. `generate screens` rewrites each screen's `screen.json`, `types.ts`, `files.ts` and route files under the app folders `generate.screens` names.

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

1. **Check the language can say it.** Open `packages/mithaq/src/mithaq.ts` beside the kayan. If the change needs a kind, rule, locale or target the language does not have, it is a vocabulary change: stop and ask the owner.
2. **Edit the declaration and nothing else**, then read it back. For a kayan Better Auth owns, the declaration is the provider options in `packages/mithaq/src/mithaq/auth/index.ts` and the project's `<kayan>.access.ts` and `<kayan>.screens.ts` files under `packages/features/auth/user/`. Never edit a file that starts with `Written by`.
3. **Run the generators that follow**, in this order:
   1. `bunx mithaq generate auth` when the provider options or an `.access.ts` or `.screens.ts` file changed;
   2. `bunx mithaq generate messages` when copy changed;
   3. `bunx mithaq generate screens` when anything a screen draws changed: a field, a page or an operation's button;
   4. `bunx mithaq migrate --name <slug>` when a column changed, then read the `migration.sql`.
4. **Update what you write by hand.** These must agree with the kayan and nothing regenerates them:
   - role keys in `tenant-roles.ts` and `backoffice-roles.ts`, since renaming a field or an operation renames its key;
   - the staff reads or `secret` in `backoffice-roles.ts`, for a new column of a kayan the backoffice lists;
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

Add the field name to the list's `columns`, and to `filters` or `search` if a person should filter or search by it. The build refuses `searchable` on a field whose kind cannot take `like` (only `text` and `email` can), on a localized field, and on a field no one may read. A column with a component of its own names it with `cell`, as `fee` does with `ui('fee-cell.tsx#FeeCell')`. Then run `bunx mithaq generate screens`. If a role should see the column, give it `<kayan>.fields.<field>`. If the backoffice lists the kayan, decide whether staff read it.

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

A kayan lists it after the store step: `create: { input: ({ create }) => create.extend({ sessions: ... }), steps: ({ steps }) => [steps.insert, createSessions] }`. The full version, which also refuses a draft, is `createSessions` in `packages/features/courses/courses/courses.ts`.

`ctx` carries the kayan, `data` (the parsed input, and after the store step the written row), `actor` and `user`, `dataBefore` (the row loaded before an update or delete), `context` (what the HTTP plug put there, such as `requestId`) and `tx`. A write step's `tools` carry `of`, `store`, `operation`, `kind` and `where`; a read step's carry `of` and `read`.

Choose how a step reaches data, in this order:

1. **`tools.of(kayan)`** for another kayan. It runs that kayan's own operation: its access for the same actor, its steps, its validation and the audit, inside the same transaction. A failure rolls the whole write back. Prefer it.
2. **`tools.store`** for a raw insert, update or remove that should skip the other kayan's operation list. It skips that kayan's access, steps, validation and audit, but it is still sealed to the active organization; see [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md#what-core-enforces).
3. **`ctx.tx`** for raw SQL. It is the project's own privileged path: nothing scopes it, checks it or audits it. Use it only for what no kayan models, and scope it yourself.

Where a step goes:

- in an operation's `steps`, before or after its one store or read step, through the `steps` function: `steps: ({ steps }) => [myStep, steps.update]`;
- in an operation's `beforeTransaction`, which runs outside the transaction before it opens, with no lock and no `dataBefore`, or in its `afterSteps` or `afterCommit`;
- in the service target's `beforeSteps`, `afterSteps` or `afterCommit` in `packages/mithaq/src/mithaq.ts`, for every write of the project. `audit` sits in `afterSteps`. A webhook or an email belongs in `afterCommit`, where the row is durable.

A step that refuses throws `invalid`, `denied`, `missing` or `conflict` from `mithaq`, each taking one object with a `message`, a copy `key` and `params`. Add the key to the copy in every locale.

### Add a screen component

A component of the project's own lives in a `ui` folder beside the kayan that draws it, or in `packages/mithaq/src/ui/` when several draw it, and is named by `ui('file.tsx#Export')`, where `ui` is a `folderOf(new URL('./ui/', import.meta.url))`. A cell takes `CellProps` from `mithaq/admin`, a button takes `ButtonProps`, and hooks such as `useLocale` and `useRecord` come from `mithaq/admin/react`. Name it where it is used: as a field's `cell` or `component`, as a page node `{ component: ... }`, or under a screen's `components` in `src/mithaq.ts` when several pages use it by name. The build checks that the file exists and exports the name; you keep the field names inside it correct.

The screens draw with the pieces of `mithaq-admin`, which each app imports as `mithaq-admin/<file>`. To change a control, a cell or a node, replace it in the components map in `src/components.ts`. To change a piece the map does not hold, run `bunx mithaq eject <item>` in the app: it writes the piece into `src/components/mithaq/`, and that file is drawn in place of the package's from then on. [The admin package](https://github.com/drhomet/mithaq/blob/main/packages/mithaq-admin/README.md) describes the pieces, ejecting one, and migrating a project made before the package.

An ejected file is the project's own. A project edits it in place and never patches it from outside. After an edit, `upgrade --check` reports it as edited. When the installed package changes the same file, diff the two and merge by hand, or delete an unedited one (`bunx mithaq eject --prune`) to draw the package's.

### Add an add-on

No command adds an add-on yet. Make two throwaway projects at your mithaq version, one with the add-on and one without, with `bun create mithaq` and the same other add-ons as yours; `git diff --no-index` between them shows exactly what the add-on brings: its feature folder, its own files, the dependency in `packages/asas/package.json`, and the lines it adds to the language, the asas and the tenant app's `copy.ts`. Copy those in, then run `bunx mithaq generate screens`, `bunx mithaq generate messages` and `bunx mithaq migrate --name add_<add-on>` from `packages/asas`. Adding `roles` also takes `default-member-roles.ts` out of `tenant-roles.ts`, and leaves each organization's Better Auth admins and members with no keys until someone assigns them a role; owners keep every key through `administrator`. Adding `rich-text` or `uploads` adds words to the project's vocabulary, so a project with a `mithaq.lock` signs it again with `mithaq lock`, which the developer approves.

### Tests

- Give tests a throwaway database, named by `DATABASE_URL`, and never the development database. Under `node --test` the template's `packages/mithaq/src/mithaq.ts` refuses to load without `DATABASE_URL`. The mithaq repository's own tests need more; see [CONTRIBUTING.md](https://github.com/drhomet/mithaq/blob/main/CONTRIBUTING.md#set-up).
- Run with Bun and its isolated linker, which `bun create mithaq` sets in `bunfig.toml`.
- Put a test beside the code it tests as `<name>.test.ts`, and run it with `node --test`.
- Write security cases first: the read of another organization's row, the write without the key, the refused input.
- See each test fail before it passes. Break the property, watch the failure, then restore it.
- A screen change needs a test that boots the app and visits each new page in every locale.

### Checks

| Command, from `packages/asas` | What it checks |
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

Each app connects once before it serves any request. Both `apps/asas-tanstack/src/server.ts` and `apps/asas-backoffice/src/server.ts` do this:

<!-- from: apps/asas-tanstack/src/server.ts -->
```ts
const { env } = process
if (env.NODE_ENV === 'production') {
  await (await import('asas')).asas.connect().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
```

In production, `connect()` does not push. It checks the migrations instead, as `prodMigrations` on `drizzleAdapter` says. Without `prodMigrations`, a production `connect()` refuses to start. The template sets it in `packages/mithaq/src/mithaq.ts`:

<!-- from: templates/mithaq/src/mithaq.ts -->
```ts
const drizzleStore = drizzleAdapter({
  connectionString,
  ...drizzleTarget,
  prodMigrations: { migrationsFolder: fileURLToPath(new URL('migrations/', asasSource)), pending: 'refuse' },
})
```

`asasSource` is the asas's `src/`, named by path from the language, so the folder is found wherever each app calls `connect()` from.

`migrationsFolder` must hold the `drizzle.config.ts` that `mithaq migrate` wrote, so ship `src/migrations/` with the deploy. `push: true` and `prodMigrations` cannot be used together.

What `pending: 'refuse'` and `'run'` each do, the lock every writer of the migration history takes, and applying migrations by hand are in [Migrations in production](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/drizzle/README.md).

### Environment variables

`bun create mithaq` writes the same `.env` into `packages/asas`, `apps/asas-tanstack` and `apps/asas-backoffice`, with fresh values for `LOCAL_AUTH_SECRET` and `BETTER_AUTH_SECRET`. Bun (`bun <file>`, `bun run`, `bun -e`) and the apps' dev servers read it. The `mithaq` command runs under Node and does not read it. A variable already set in the environment always wins over `.env`.

In production, set these in the host's environment rather than in a file.

| Variable | Read by | Production | Development |
| --- | --- | --- | --- |
| `DATABASE_URL` | `packages/mithaq/src/mithaq.ts`, `seed.ts`, the CLI | Required. Start refuses without it. | Falls back to `postgres://postgres:postgres@localhost:5432/mithaq` for the dev server. `seed`, `migrate`, `rbac assign` and `storage sweep` still refuse without it. Under `node --test` it is required. |
| `BETTER_AUTH_SECRET` | `packages/mithaq/src/mithaq/auth/index.ts` | Required. Both apps must share the same value: the backoffice app derives its own session secret from it, so a cookie one app signed never verifies in the other. `AUTH_SECRET` is read when it is unset, but a URL below that is not `localhost` still requires `BETTER_AUTH_SECRET` itself. | A public development default. Even outside production, start refuses when either URL below is not `localhost` and this is unset. |
| `BETTER_AUTH_URL` | `packages/mithaq/src/mithaq/auth/index.ts` | Required. The tenant app's public URL. | `http://localhost:5173` |
| `BACKOFFICE_URL` | `packages/mithaq/src/mithaq/auth/index.ts` | Required. The backoffice console's public URL, on an origin of its own: a subdomain beside the tenant app's, never a path of it (see [Deploying both apps on one domain](#deploying-both-apps-on-one-domain)). Start refuses when it shares `BETTER_AUTH_URL`'s origin, or its host anywhere but on this machine. | `http://localhost:5174` |
| `LOCAL_AUTH_SECRET` | `packages/features/auth/local-users/local-users.ts` | 32 characters at least. If it is unset, local accounts are off: every `POST` under `/api/auth/local` answers 503 and the public sign-up answers 403. | Same. |
| `TRUSTED_IP_HEADER` | `packages/mithaq/src/mithaq/auth/index.ts`, `local-users.ts` | The header names your proxy overwrites with the client address, comma-separated, such as `cf-connecting-ip`. Both rate limiters key on it, the limit on invitations among them. Trust it only behind exactly one proxy that overwrites it on every request. Without it every limit keys on `x-forwarded-for`, which a caller writes, so a caller who changes it on each request passes the limits. | Defaults to `x-forwarded-for`. |
| `SETUP_CODE` | `packages/mithaq/src/mithaq/auth/index.ts` | 32 characters or more, random. The backoffice console's first administrator, and with one organization the first owner on `/auth/first-run`, are made only with it. Shorter counts as unset, and then neither is made. Remove it once the app is set up. | Not asked under `vite dev` on `localhost`. |
| `RESEND_API_KEY`, `MAIL_FROM` | `packages/mithaq/src/mail/index.ts` | Both or neither; one alone refuses to start, and so does a production start with neither. With both, password resets, invitations and the links that prove an address are mailed through Resend from `MAIL_FROM`, an address at a domain the Resend account verified. Another service is a mailer of your own beside `src/mail/mailers.ts`, named in `src/mail/index.ts`. `RESEND_BASE_URL`, Resend's own variable, sends to another address that speaks its API, such as a test's catcher: https, or http on this machine alone. | Unset: every message is written to the server log, when `NODE_ENV` is `development` and the tenant URL is `localhost`, each under a line saying emails print there instead of being sent. |
| `STORAGE_SECRET` | `packages/mithaq/src/storage/index.ts` | Required. Signs every upload reference and local upload token. Every instance must share it. | A fresh random secret per process, with a warning. |
| `STORAGE_PREFIX` | `storage/index.ts` | Required. The bucket folder this project owns, such as `mithaq/asas`. Every key starts with it, and the sweep lists only inside it. | `mithaq/asas` |
| `STORAGE_ADAPTER` | `storage/index.ts` | Required. Where new uploads go: `local`, or `r2` once R2 is set. | `local` |
| `STORAGE_DIR` | `storage/index.ts` | The folder of the `local` adapter. | `.storage`, relative to the process's working directory. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `storage/index.ts` | All four or none. When all four are set, the `r2` adapter exists. If only some are set, start refuses. | Same. |
| `DEV_ADMIN_EMAIL`, `DEV_ADMIN_PASSWORD` | `dev-setup.ts` | Never read. | The account `bun run dev:setup` makes. `.env.example` holds a development value, which is why `dev:setup` refuses a database not on this machine. |
| `NODE_ENV` | the apps, the drizzle store, auth, storage | Must be `production`. See below. | Unset or `development`. With no mailer configured, mail is written to the server log only when it is `development` and the tenant URL is `localhost`. |
| `MITHAQ_COUNT_TIMEOUT_MS` | `mithaq migrate` | The per-query timeout, in milliseconds, for counting rows the rules would refuse. The default is 5000. | Same. |

### `NODE_ENV`

Start both built apps with `NODE_ENV=production`. That one setting decides several things:

- `server.ts` calls `connect()` only in production, so only then are migrations checked or applied before serving. The apps read it from `process.env` at run time, so the build cannot bake it in.
- The drizzle store pushes the schema on `connect()` whenever `NODE_ENV` is not `production`. A production database must never be reached by a process without it.
- The production checks for `DATABASE_URL`, the auth URLs and secret, and the storage settings run only in production. Without it, those settings quietly fall back to their development values.

### Storage adapters

Uploaded files go through the storage rukn, the pluggable part that brings the `upload` kind and the storage target. Its config is `packages/mithaq/src/storage/index.ts`, and the adapters beside it are project files, ejected from `mithaq-admin`, that you own and edit:

| Adapter | File | Use |
| --- | --- | --- |
| `local` | `storage/local.ts` | A folder on this machine. Uploads are a `PUT` to `/api/storage/local/<token>`, signed for one key, type and size. Good for development and CI. In production it only suits a single instance with a persistent disk. |
| `r2` | `storage/r2.ts` | Cloudflare R2, through the S3 adapter. Wired in when the four `R2_*` variables are set. |
| `s3` | `storage/s3.ts` | Any S3-compatible service: AWS S3, R2, MinIO, Backblaze B2. Not wired by default: add it to `adapters` in `storage/index.ts` with its `endpoint`, `bucket`, `region`, keys and `prefix`. |
| `uploadthing` | `storage/uploadthing.ts` | Reads, serves and deletes files already stored on UploadThing. It never uploads, so new files must go to another adapter. Add it to `adapters` with its `token` to serve old files. |

Each upload row stores the name of the adapter that holds its file. `STORAGE_ADAPTER` only picks where new uploads go, so keep every adapter that old rows still name.

`mithaq storage sweep` deletes objects that no row names and that are more than a day old. Run it with `--check` first to see the list (see [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#storage-sweep)).

### Building and starting both apps

Each app's `build` script runs `mithaq lock --check` in `packages/asas`, then `vite build`, which writes `dist/`:

```sh
bun run --cwd apps/asas-tanstack build
bun run --cwd apps/asas-backoffice build
```

The build keeps `asas` and `mithaq` external: the server bundle imports them from `node_modules` at run time. So deploy the whole workspace with its installed `node_modules` and the `packages/asas` source, including `src/migrations/`, not only `dist/`.

The project's own release check serves each build with `vite preview` under Node. Each app's `preview` script runs it after `mithaq lock --check`. The tenant app uses Vite's default port, 4173, and the backoffice 4174:

```sh
NODE_ENV=production bun run --cwd apps/asas-tanstack preview
NODE_ENV=production bun run --cwd apps/asas-backoffice preview
```

A typical deploy runs in this order:

1. `bun install`.
2. Build both apps.
3. With `pending: 'refuse'`, apply migrations with drizzle-kit, as [Applying migrations by hand](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/drizzle/README.md#applying-migrations-by-hand) shows.
4. Start both apps with `NODE_ENV=production` and the variables above.

In CI, after `bun install`, run `mithaq generate --check` in `packages/asas` against a database built from the migrations (see [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md#generate---check)).

### Deploying both apps on one domain

> **Security: the backoffice gets a subdomain of its own, never a path of the customer app.** Serve `app.example.com` and `backoffice.example.com`, never `example.com/` and `example.com/backoffice`, nor `example.com:8443`. A browser isolates scripts and storage by origin (scheme, host and port), and sends cookies by host whatever the port or scheme, so on one host a script flaw (XSS) in the customer app would reach staff sessions, which can impersonate anyone and read every organization. Start refuses when `BACKOFFICE_URL` and `BETTER_AUTH_URL` share an origin, or a host anywhere but on this machine. Keep each session cookie on its own host: never give a cookie the domain `.example.com`, as Better Auth's `crossSubDomainCookies` does. Two subdomains are still one site, so `SameSite` cookies pass between them: the `Origin` checks are the barrier, the backoffice's `/api` route checking every write against `BACKOFFICE_URL` and Better Auth checking its own, and every state-changing backoffice route must keep one.

Both apps can still run on one machine behind one certificate. Point `app.example.com` and `backoffice.example.com` at the machine, take a wildcard certificate for `*.example.com`, start both apps as above on `127.0.0.1:4173` and `127.0.0.1:4174`, and let a proxy route each request by its `Host`. Each app's `vite.config.ts` binds `vite preview` to `127.0.0.1`, the address the proxies below target, and lets it answer the name in its URL (`preview.allowedHosts`): Vite refuses any `Host` but localhost otherwise, so set both URLs where the apps start:

```sh
BETTER_AUTH_URL=https://app.example.com
BACKOFFICE_URL=https://backoffice.example.com
TRUSTED_IP_HEADER=x-real-ip
```

`TRUSTED_IP_HEADER` names the header each proxy below overwrites with the client's address on every request, so the rate limits key on that address and never on what a caller wrote.

Caddy, built with your DNS provider's plugin, which a wildcard certificate needs (Cloudflare here):

```caddyfile
*.example.com {
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}

	@app host app.example.com
	handle @app {
		reverse_proxy 127.0.0.1:4173 {
			header_up X-Real-IP {remote_host}
		}
	}

	@backoffice host backoffice.example.com
	handle @backoffice {
		reverse_proxy 127.0.0.1:4174 {
			header_up X-Real-IP {remote_host}
		}
	}

	# Any other name under the certificate reaches neither app.
	handle {
		abort
	}
}
```

nginx, with the wildcard certificate certbot's DNS challenge wrote (`certbot certonly --dns-cloudflare -d '*.example.com'`):

```nginx
# A name neither app serves is refused before any request is read.
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    ssl_reject_handshake on;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    return 444;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name app.example.com;
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    # With the local adapter an upload is a PUT through the app, up to 10 MB unless its field allows more.
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name backoffice.example.com;
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:4174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name app.example.com backoffice.example.com;
    return 301 https://$host$request_uri;
}
```

### The test database

Never point tests at a database you want to keep. A project made by `bun create mithaq` ships without the template's own tests, but its `packages/mithaq/src/mithaq.ts` keeps one guard: under `node --test`, the build refuses to load without `DATABASE_URL`, so a test you write never falls back to the dev database. The mithaq repository's own tests need a throwaway Postgres set up as [CONTRIBUTING.md](https://github.com/drhomet/mithaq/blob/main/CONTRIBUTING.md#set-up) describes.
