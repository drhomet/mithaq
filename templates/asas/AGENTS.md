# Working in a mithaq project

This project is built on mithaq. Each data type is a kayan (an entity), declared once with `defineKayan`; its table, input schema, operations, access and admin pages all follow from that one declaration. The arkan (singular rukn, a pillar) in the language, `packages/mithaq/src/mithaq.ts`, bring the kinds and rules a field can use. `buildAsas` in `packages/asas/src/asas.ts` builds the asas, the runtime that serves every kayan.

Run every `mithaq` command from `packages/asas/` unless it says otherwise. `README.md` beside this file is the full guide, with the steps and examples behind each section here. In a project made with `--layout single`, every folder below is one package: `packages/mithaq/src/` and `packages/asas/src/` are both `src/`, and `packages/features/<feature>/` is `src/features/<feature>/`.

## Where things go

The project is three steps, each named after what it holds, and each imports only the steps before it.

1. **The language**, `packages/mithaq` (`@asas/mithaq`). `src/mithaq.ts` declares it with `defineMithaq`, with its targets and screens, and exports `defineKayan`, `defineGlobal`, `buildAsas` and the tenant field `organization`. Beside it sits everything the language or more than one feature reads:
   - `src/mithaq/auth/`: the Better Auth setup, imported as `@asas/mithaq/auth`.
   - `src/mithaq/pages.ts`, with the rich-text add-on `rich-text-nodes.ts`, and with the audit-log add-on `audit-sink.ts`: the page trees every kayan page starts from, the rich-text nodes and the audit sink.
   - `src/roles/`: `tenant-roles.ts`, the roles every organization gets and the permission keys each holds, and the access rows and grants beside it. Without the roles add-on those roles are Better Auth's own `owner`, `admin` and `member`, listed in `default-member-roles.ts`, and a member holds the ones its `member.role` names.
   - `src/ui/`: the shells, layouts and pieces several screens draw.
   - `src/steps/`, `src/mail/` and, with the uploads add-on, `src/storage/`: a write step, the mailers and storage adapters ejected from `mithaq-admin`, and the `index.ts` that chooses the mailer. They are this project's files.
2. **The features**, `packages/features/<feature>` (`@asas/<feature>`), each holding one or more kayan. `index.ts` exports the feature's `kayan` list (and `global`, for a single-row kayan). The media feature's `kayan` is a function of `reads`, what opens an image to an actor without `media.create`; a feature whose rows point at images exports its read (courses' `coverReads`), and the asas hands it in. Each kayan has a folder of its own, `<kayan>/<kayan>.ts`, with any page pieces only it draws in `<kayan>/ui/`; a child kayan is a sibling folder in its feature, never nested. `auth/user/` holds the Better Auth kayan, written by `mithaq generate auth`.
3. **The asas**, `packages/asas` (`asas`). `src/asas.ts` is the build: it spreads each feature's `kayan` into `buildAsas`. Beside it are each screen's own pieces (`src/ui-dashboard/`, `src/ui-portal/`, `src/ui-platform/`), `src/messages/` (one copy file per kayan, which `mithaq generate messages` fills with missing keys; translate in place), `src/migrations/` (written by `mithaq migrate`; commit them) and `src/seed.ts`.

A feature reaches another feature's kayan by its name (`relationTo: 'user'`) or through that feature's `index.ts`, never an inner file. The language never imports a feature or the asas.

`apps/asas-tanstack/` is the tenant app, serving `/dashboard` and `/portal`; `apps/asas-platform/`, with the platform add-on, is the platform console for staff across every organization. Both import the asas alone.

The project holds the add-ons it was made with (`roles`, `audit-log`, `settings`, `rich-text`, `uploads`, `media`, `courses`, `platform`); `packages/features/` and `apps/` show which. No command adds one yet: `README.md`, "Add an add-on", says how by hand.

## Adding a kayan

Copy `packages/features/tags/`; with the courses add-on, `packages/features/courses/courses/courses.ts` shows custom operations and steps.

1. Write `<name>/<name>.ts` in the feature it belongs to, or in a new feature `packages/features/<feature>/` with a `package.json` like `tags`' and an `index.ts`. Import `defineKayan` from `@asas/mithaq`. Spread `defaultFields` (id, createdAt, updatedAt) into `fields`, and `defaultOperations` into `targets.service.operations`, leaving out any operation the kayan should not have. Give every label and message one string per locale (`en` and `ar`).
2. Place `organization` in `fields` when each row belongs to one organization. Leave it out for a kayan every organization shares.
3. Add the kayan to its feature's `kayan` list. A new feature is a dependency of `packages/asas/package.json`, and its `kayan` is spread into `buildAsas` in `src/asas.ts`.
4. Grant its keys (`<name>.find`, `<name>.create`, `<name>.fields.<field>` and so on) to the roles that use it in `packages/mithaq/src/roles/tenant-roles.ts`, or under `member` in `default-member-roles.ts` in a project without the roles add-on, where `owner` and `admin` already hold every key.
5. To draw it, add it to a screen's `kayan` list in `packages/mithaq/src/mithaq.ts`, describe its pages under `targets.dashboard` in the kayan, and run `bunx mithaq generate screens`.
6. Run `bunx mithaq generate messages` and fill any empty translation it adds.
7. Write the migration: `bunx mithaq migrate --name add_<name>`. Commit the folder it writes.
8. Run `bunx mithaq generate --check`.

## The tenant field

A kayan that places `organization` is per-organization, and mithaq core enforces it on every managed read and write; nothing in the project can turn it off. The scope is the signed-in session's verified active organization. A create fills `organization` from the session, so a caller or a step never sets it, and it never changes. Another organization's row answers like a missing one. Raw SQL through `ctx.tx` is not scoped: filter by organization there yourself. Write the field as `organization` from `@asas/mithaq`; a look-alike field that is not bound is refused.

On a per-organization kayan, `rules: { unique: true }` means unique within each organization, and `{ within: 'organization', unique: [...], index: [...] }` in `indexes` builds indexes led by the organization. A plain `{ fields, unique: true }` entry is unique across every organization.

How many organizations the project holds, and who may sign up and join, is `packages/mithaq/src/mithaq/auth/organizations.ts` (`organizations`, `showOrganization`, `signUp`, `joinRole`, `verifyEmail`, `allowedDomains`). In one organization the field and the scope are the same, so keep placing `organization` on every per-organization kayan: leaving it off makes the kayan shared by every organization the day the project holds many. README.md, "Organization modes", says what each value does and how to change it.

Reads that reach further (`tenant: 'mine' | 'all'`), what is refused, and the index rules are in [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md).

## Migrations

- In development `asas.connect()` pushes the schema; nothing needs a migration to run locally.
- A project made without every add-on that holds tables starts with no migration: write its first, `bunx mithaq migrate --name init`, against an empty database before it first deploys.
- `mithaq migrate` refuses to write against a pushed database. Point `DATABASE_URL` at a database built from the migrations: create an empty one, apply them with the `drizzle-kit` the installed mithaq depends on, then run `bunx mithaq migrate --name <slug>`. The slug is lowercase letters, digits and underscores.

  ```sh
  DRIZZLE_KIT=$(node -p "path.join(path.dirname(require('module').createRequire(fs.realpathSync('node_modules/mithaq/package.json')).resolve('drizzle-kit')), 'bin.cjs')")
  node "$DRIZZLE_KIT" migrate --config src/migrations/drizzle.config.ts
  ```
- When a change would lose data, `mithaq migrate` stops and asks for an answer in `mithaq.hints.json`. A drop deletes rows: ask the developer before you write one.
- In production `connect()` checks for pending migrations, as `prodMigrations` in `packages/mithaq/src/mithaq.ts` says: `pending: 'refuse'` refuses to start, `pending: 'run'` applies them under a lock. `drizzle-kit migrate` run by hand takes no lock, so never run it while an app is starting. See `README.md`, "Running in production", and [Migrations in production](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/drizzle/README.md).

## Rules

- The vocabulary of `defineMithaq` in `packages/mithaq/src/mithaq.ts` (its locales, kinds, rules, target names and capabilities, and root keys) changes only when the developer asks for that change. When a task needs it, tell the developer what and why first. If the project has a `mithaq.lock`, `mithaq lock` shows a popup the developer approves; never edit the lock by hand. Everything in `defineKayan`, `defineGlobal` and `buildAsas` is yours to change.
- A file whose first line reads ``// Written by `mithaq <command>` `` is regenerated by that command, never edited.
- The admin's pieces come from the `mithaq-admin` package. Replace a control, cell or node in the components map (`src/components.ts` in each app); to change another piece, `bunx mithaq eject <item>` in the app writes it into `src/components/mithaq/`, drawn in place of the package's. A file ejected from `mithaq-admin` ends with a `// mithaq-admin` marker line. It is this project's: edit it in place. After you update mithaq and mithaq-admin together, `bunx mithaq upgrade --check` names each file that differs; merge an edited one by hand.
- A function the project writes takes one object once it has three or more parameters. Steps keep `(ctx, tools)`.
- Comments say why, never what.

## Commands

The `mithaq` bin runs under Node and does not read `.env`, so export `DATABASE_URL` first. Commands that touch the database refuse to run without it.

```sh
bunx mithaq --help
bunx mithaq generate --check    # the lock, generated files, migrations and copies; writes nothing
bunx mithaq generate auth       # the Better Auth kayan
bunx mithaq generate messages   # copy files
bunx mithaq generate screens    # each screen's routes in the apps
bunx mithaq migrate --name <slug>
bunx mithaq migrate --check
bunx mithaq lock --check
bunx mithaq upgrade --check
bun run seed
```

From the project root:

```sh
bunx tsc -p .
bunx tsc -p apps/asas-tanstack
bunx tsc -p apps/asas-platform
bun run --cwd apps/asas-tanstack dev    # http://localhost:5173
bun run --cwd apps/asas-platform dev    # http://localhost:5174
```

`README.md` beside this file is the guide to this project. The language reference is [packages/mithaq/README.md](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/README.md).
