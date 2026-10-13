# Working in a mithaq project

This project is built on mithaq. Each data type is a kayan (an entity), declared once with `defineKayan`; its table, input schema, operations, access and admin pages all follow from that one declaration. The arkan (singular rukn, a pillar) in `src/mithaq.ts` bring the kinds and rules a field can use. `buildAsas` in `src/asas.ts` builds the asas, the runtime that serves every kayan.

Run every command below from `templates/asas/` unless it says otherwise. `README.md` beside this file is the full guide, with the steps and examples behind each section here.

## Where things go

- `src/mithaq.ts`: the language, its targets and screens. It exports `defineKayan`, `defineGlobal`, `buildAsas` and the tenant field `organization`.
- `src/asas.ts`: the build. Every kayan is listed in `kayan`, every global in `global`.
- `src/<kayan>/<kayan>.ts`: one folder per kayan, with any page pieces only it draws in `src/<kayan>/ui/`.
- `src/tenant-roles.ts`: the roles every organization gets and the permission keys each holds.
- `src/steps/` and `src/storage/`: a write step and storage adapters ejected from `mithaq-admin`. They are this project's files.
- `src/kayan/auth/`: the Better Auth kayan, written by `mithaq generate auth`.
- `src/messages/`: one copy file per kayan, which `mithaq generate messages` fills with missing keys. Translate in place.
- `src/migrations/`: migrations written by `mithaq migrate`. Commit them.
- `../auth/`: the Better Auth setup, imported as `@asas/auth`.
- `../../apps/asas-tanstack/`: the tenant app, serving `/dashboard` and `/portal`. `../../apps/asas-platform/`: the platform console for staff across every organization.

## Adding a kayan

Copy `src/tags/tags.ts`; `src/courses/courses.ts` shows custom operations and steps.

1. Write `src/<name>/<name>.ts` with `defineKayan` from `../mithaq.ts`. Spread `defaultFields` (id, createdAt, updatedAt) into `fields`, and `defaultOperations` into `targets.service.operations`, leaving out any operation the kayan should not have. Give every label and message one string per locale (`en` and `ar`).
2. Place `organization` in `fields` when each row belongs to one organization. Leave it out for a kayan every organization shares.
3. Add the kayan to `kayan` in `src/asas.ts`.
4. Grant its keys (`<name>.find`, `<name>.create`, `<name>.fields.<field>` and so on) to the roles that use it in `src/tenant-roles.ts`.
5. To draw it, add it to a screen's `kayan` list in `src/mithaq.ts`, describe its pages under `targets.dashboard` in the kayan, and run `bunx mithaq generate screens`.
6. Run `bunx mithaq generate messages` and fill any empty translation it adds.
7. Write the migration: `bunx mithaq migrate --name add_<name>`. Commit the folder it writes.
8. Run `bunx mithaq generate --check`.

## The tenant field

A kayan that places `organization` is per-organization, and mithaq core enforces it on every managed read and write; nothing in the project can turn it off. The scope is the signed-in session's verified active organization. A create fills `organization` from the session, so a caller or a step never sets it, and it never changes. Another organization's row answers like a missing one. Raw SQL through `ctx.tx` is not scoped: filter by organization there yourself. Write the field as `organization` from `src/mithaq.ts`; a look-alike field that is not bound is refused.

On a per-organization kayan, `rules: { unique: true }` means unique within each organization, and `{ within: 'organization', unique: [...], index: [...] }` in `indexes` builds indexes led by the organization. A plain `{ fields, unique: true }` entry is unique across every organization.

Reads that reach further (`tenant: 'mine' | 'all'`), what is refused, and the index rules are in [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md).

## Migrations

- In development `asas.connect()` pushes the schema; nothing needs a migration to run locally.
- `mithaq migrate` refuses to write against a pushed database. Point `DATABASE_URL` at a database built from the migrations: create an empty one, apply them with the `drizzle-kit` the installed mithaq depends on, then run `bunx mithaq migrate --name <slug>`. The slug is lowercase letters, digits and underscores.

  ```sh
  DRIZZLE_KIT=$(node -p "path.join(path.dirname(require('module').createRequire(fs.realpathSync('node_modules/mithaq/package.json')).resolve('drizzle-kit')), 'bin.cjs')")
  node "$DRIZZLE_KIT" migrate --config src/migrations/drizzle.config.ts
  ```
- When a change would lose data, `mithaq migrate` stops and asks for an answer in `mithaq.hints.json`. A drop deletes rows: ask the developer before you write one.
- In production `connect()` checks for pending migrations, as `prodMigrations` in `src/mithaq.ts` says: `pending: 'refuse'` refuses to start, `pending: 'run'` applies them under a lock. `drizzle-kit migrate` run by hand takes no lock, so never run it while an app is starting. See `README.md`, "Running in production", and [Migrations in production](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/drizzle/README.md).

## Rules

- The vocabulary of `defineMithaq` in `src/mithaq.ts` (its locales, kinds, rules, target names and capabilities, and root keys) changes only when the developer asks for that change. When a task needs it, tell the developer what and why first. If the project has a `mithaq.lock`, `mithaq lock` shows a popup the developer approves; never edit the lock by hand. Everything in `defineKayan`, `defineGlobal` and `buildAsas` is yours to change.
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
