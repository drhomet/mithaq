# The `mithaq` command

`mithaq` is the command-line tool that ships with the package. It reads the project it is run from, so run every command from the folder that holds `src/mithaq.ts` and `src/asas.ts`. In a project made by `bun create mithaq`, that folder is `packages/asas`, whose `src/mithaq.ts` re-exports the language from `packages/mithaq`; in a single package it is the package's root.

```sh
cd packages/asas
bunx mithaq --help
```

`mithaq --help` (or `-h`) prints the usage line and exits 0. A command it does not understand prints the same line and exits 1.

Three things hold for every command:

- **It runs under Node and does not read `.env`.** Commands that open a database (`migrate`, `rbac assign`, `storage sweep`, `jobs run`, and the data scan of `generate messages --check`) refuse to run unless `DATABASE_URL` is set in the shell. Load the project's `.env` first:

  ```sh
  set -a; . ./.env; set +a
  ```

- **It reads the project's own sources as Vite and Bun do.** A relative import with no extension (`import './notes'`) that names no file Node finds is read as `./notes.ts`, then `./notes/index.ts`. Nothing under `node_modules` is read that way.

- **Exit codes.** 0 means success or nothing to do. 1 means a check failed, the command refused, or something threw. Some commands also use 2, described below. A refusal prints one sentence that says what to do. Any other error prints Node's stack trace, which usually means `src/asas.ts` failed to import.

Every command except `lock` and `generate --check` first checks `mithaq.lock`. If the lock exists and the language no longer matches it, or nobody has signed it yet, the command prints a warning to stderr and then carries on. Only `lock --check` and `generate --check` fail on it.

## `generate auth`

Writes one kayan file for each table Better Auth uses, plus an `index.ts` barrel that groups them by plugin. A kayan is an entity: one data type with its fields, access and operations. Run it after you change the Better Auth plugins in `packages/mithaq/src/mithaq/auth/index.ts`.

It reads three keys from `generate` in `src/mithaq.ts`, each written from the folder the command runs in:

- `auth`: the folder to write into. The template sets `'../features/auth/'`, the auth feature beside the asas.
- `language`: the module each generated kayan imports `defineKayan` from, written as given: a package name, or a path relative to a generated file. The template sets `'@asas/mithaq'`, and a single package `'../../../mithaq.ts'`.
- `providers`: the module that exports `providers`, the Better Auth instances. The template sets `'@asas/mithaq/auth'`.

It refuses when `language` or `providers` is missing or cannot be found from a generated file.

It writes a subfolder for each provider, such as `../features/auth/user/`. It never overwrites or deletes a file that lacks its header comment.

| Flag | Meaning |
| --- | --- |
| `--check` | Write nothing. Exit 1 if a file is stale or would be removed. |

Exit codes: 0 when files were written or are up to date, 1 when `--check` finds a difference or the command refuses.

```sh
bunx mithaq generate auth
```

## `generate messages`

Writes the project's copy to one JSON file per scope: each kayan, plus `mithaq.json` for shared copy. Each file holds every label and message with one string per locale. The folder is `generate.messages` in `src/mithaq.ts` (`src/messages/` in the template). A run adds missing keys and rewrites flat files into nested form, keeping every translation, including entries with no source. It reports those entries for you to remove.

A locale leaf holds a message's translations. When a key has both its own message and children, `$value` holds the parent's message, so `name` and `name.required` can both resolve:

```json
{
  "name": {
    "$value": { "ar": "الاسم", "en": "Name" },
    "required": { "ar": "الاسم مطلوب.", "en": "A name is required." }
  },
  "page": {
    "description": { "ar": "إدارة القاعات.", "en": "Manage rooms." }
  }
}
```

Names starting with `$` are reserved for the file format. A declaration cannot use them for fields, kinds, rules, operations or message parts; `$value` above belongs to the generated JSON, not to a kayan's `messages` declaration. This release still reads flat files, but a check fails until a run has nested them.

The app's `copy.ts` flattens each imported JSON file before adding it to its scope. Copy the template's helper, with the project's locales, so the resolver still sees keys such as `name.required`:

<!-- from: apps/asas-tanstack/src/copy.ts -->
```ts
import { flattenMessageFile } from 'mithaq/admin'

export const locales = ['ar', 'en'] as const

export const copyFile = (file: Record<string, unknown>): Record<string, Record<string, string>> =>
  Object.fromEntries(Object.entries(flattenMessageFile({ file, locales })).map(([key, value]) =>
    [key, typeof value === 'string' ? Object.fromEntries(locales.map((locale) => [locale, value])) : value ?? {}]))
```

For example, import `rooms` from `asas/messages/rooms.json` and put `rooms: copyFile(rooms)` in the scope map, or spread `...copyFile(rooms)` inside that scope beside the app's own copy. The backoffice app re-exports the tenant app's `copy.ts`.

| Flag | Meaning |
| --- | --- |
| `--check` | Write nothing. Fails on any gap: a missing locale, a key with no source, a key two scopes both claim, a file a run would change, and stored rows missing a locale. |
| `--no-data-scan` | With `--check`, skip the database scan. Use it only for a project that has no database to scan. |

The data scan connects read-only and reads every row of each localized kayan. If it cannot run, for example because `DATABASE_URL` is unset, the check fails. Labels written as functions are reported as `Unverifiable` and never fail the check.

Exit codes: 0 when files were written or are up to date, 1 when the check finds a gap or the scan could not run.

```sh
bunx mithaq generate messages --check --no-data-scan
```

## `generate screens`

Writes the files each screen target needs into the host app: `screen.json`, `types.ts`, `files.ts` and the route files. A screen is one admin area, such as the dashboard. The folders come from `generate.screens` in `src/mithaq.ts`, either one folder for every screen or one per screen. Each folder must be inside a TanStack Router `routes` folder. The template writes the dashboard and the portal into `apps/asas-tanstack/src/routes/(screens)/`, and the backoffice into `apps/asas-backoffice/src/routes/(screens)/`.

Run it after you change a kayan's pages, a screen's `kayan` list, or a screen's pages and components. It never overwrites a file it did not write, and it deletes generated files that no screen needs any more.

| Flag | Meaning |
| --- | --- |
| `--check` | Write nothing. Exit 1 if any file is not what a run would write. |

Exit codes: 0 when files were written or are up to date, 1 when `--check` finds a difference or the command refuses.

```sh
bunx mithaq generate screens
```

## `generate --check`

The full check, for CI. It runs these steps in order and stops at the first one that fails, exiting with that step's code:

1. `lock --check`
2. `generate auth --check`
3. every target's `migrate` command with `--check` (`drizzle migrate` in the template)
4. `generate messages --check`
5. `generate screens --check`
6. every other target command with `--check` (`rbac assign`, `storage sweep`)
7. `upgrade --check`, as a report only: it never fails the sweep

When a step fails, the last line names it, for example ``` `mithaq generate auth --check` answered 1, so the sweep stopped there. ```

| Flag | Meaning |
| --- | --- |
| `--check` | Required. |
| `--no-data-scan` | Passed on to `generate messages`. |

The migrate step and the message scan need a database, so set `DATABASE_URL` first.

```sh
set -a; . ./.env; set +a
bunx mithaq generate --check
```

## `lock` and `lock --check`

`mithaq.lock`, at the project root, records the vocabulary of `defineMithaq`: the locales, each kind's label, message and accepted rules, each rule's message and excludes, each target's name and capability, and the root keys. Everything you write in `defineKayan`, `defineGlobal` and `buildAsas` stays outside the lock. So do a screen's pages and its `kayan` list.

The lock is optional. A project without one passes `lock --check` with a notice.

`mithaq lock` signs the current vocabulary. It shows what changed, then opens a popup on this machine's screen with a two-digit code to type back. The code never appears in the command's output, so nothing scripted can approve it. Only the project's owner approves a vocabulary change. On macOS the popup uses `osascript`, on Windows PowerShell, and on Linux `zenity` or `kdialog`. Without any of them, it asks on the terminal. The machine's signing key is stored in `~/.mithaq/keys/` (`%APPDATA%\mithaq\keys` on Windows), outside the repository.

`mithaq lock --check` passes when there is no lock, or when the lock is signed and matches the current vocabulary. It fails when the vocabulary differs, the lock is pending or unreadable, or the signature does not verify. Both apps run it before `dev`, `build` and `preview`.

| Flag | Meaning |
| --- | --- |
| `--check` | Verify only. Any other word or flag is a usage error. |

Exit codes: `lock` exits 0 when it signs or when there is nothing to sign, and 1 when nobody approves. `lock --check` exits 0 or 1 as described above.

```sh
bunx mithaq lock --check
```

## `migrate`

Writes a drizzle migration for the difference between your kayan and the last migration. It is an alias for the store target's own command, `mithaq drizzle migrate`. It is refused if no target declares `migrate`, or if more than one does.

It writes into `generate.migrations` in `src/mithaq.ts`, which defaults to `src/migrations/`:

- `drizzle.config.ts`, once. After that the file is yours.
- `schema.ts`, rewritten on every run.
- one folder per migration, `<timestamp>_<name>/`, holding `migration.sql` and `snapshot.json`. Commit them all.

Before it writes, it checks the database that `DATABASE_URL` names:

- Every existing migration must be applied there. If one is not, it prints the folders, says how to apply them, and exits 2. It also prints the `insert` line to record a migration whose SQL you already ran by hand.
- It must not be a database that `connect()` pushed in development. A push leaves a marker row named `mithaq_dev_push` in `drizzle.__mithaq_migrations`, and a migration written over a pushed database would recreate every table. Write migrations against a database built from the migrations, or adopt the pushed one with `--baseline`.
- A statement that would lose data (dropping a table or column that holds rows, for example) prints one JSON line per change and exits 2. To accept a change, copy its line without `reason` into `mithaq.hints.json` at the project root and run again. A drop of a check, an enum or a sequence that the database holds and no kayan builds is answered the same way, with the `confirm_guard_loss` line it prints. Renames that drizzle-kit cannot decide alone are answered in the same file, as the template's own `mithaq.hints.json` shows.

It also counts stored rows that the current rules would refuse and reports them. Set `MITHAQ_COUNT_TIMEOUT_MS` to change the per-query timeout, which defaults to 5000.

| Flag | Meaning |
| --- | --- |
| `--check` | Write nothing. Exit 0 if no migration is pending, and 1 if one is pending or an existing migration is not applied to the database. On a pushed database it skips the comparison, says so, and exits 0, unless the history also holds migration rows, which exits 2. |
| `--name <slug>` | Name the migration folder. The slug uses lowercase letters, digits and underscores, 1 to 64 characters. Refused together with `--baseline`. |
| `--baseline` | Adopt an existing database. It reads the tables your kayan describe and records them as the first migration, `<timestamp>_baseline`. It is refused when the project already has a migration, when the database's history holds any row except the push marker, and together with `--check` or `--name`. |

Exit codes: 0 when a migration was written or the schema is up to date, 1 when a check finds a pending migration or the command fails, and 2 when the project must decide first (an unapplied migration, a pushed database, or a data-loss or rename question).

`mithaq migrate` only writes migrations. It never applies them. To apply them, see [Applying migrations by hand](../../drizzle/README.md#applying-migrations-by-hand).

```sh
set -a; . ./.env; set +a
bunx mithaq migrate --name add_notes
```

## `jobs run`

Schedules the latest due occurrence and runs due jobs once, then exits. It requires `DATABASE_URL` explicitly and an applied jobs migration. It uses the same generic worker as the asas timers: unique occurrences, exclusive claims, renewed leases and history retention. Task or database failures answer a nonzero exit code; stored error messages are never logged.

```sh
bunx mithaq jobs run maintenance
```

`mithaq jobs run [queue ...]` selects queues by positional name. With none, it runs all queues the build’s tasks use. Unknown queues are refused before running any work. The command connects with `readOnly: true` to start no timers, performs a pass, destroys the build and exits. A build with no jobs target is refused. See [Jobs](../../../README.md#jobs) for the capability, drivers and phase one limits.

## `screens`

Prints each screen target as a tree: its path, providers, pages, the nav with the permission key each entry needs, and every kayan page with its layout. It writes nothing. Use it to see what a screen will draw without starting the app.

It takes no flags and exits 0.

```sh
bunx mithaq screens
```

## `eject` and `eject --prune`

The admin's pieces are imported from the installed `mithaq-admin` package as `mithaq-admin/<file>`, so a project holds none of them until it ejects one. `mithaq eject <item>` writes the item's own files where the project keeps them, each byte for byte with a last line `// mithaq-admin <version> <hash>`. From then on the project's file is drawn in place of the package's, for every importer, through the `mithaq/vite` plugin and the `mithaq-admin/*` entry of the app's tsconfig `paths`. Edit it in place; delete it to draw the package's again.

`<item>` is an item's name with or without `mithaq-`, or its file: `mithaq-list-table`, `list-table` and `list-table.tsx` are the same item. An unknown name prints every item and exits 1.

- It never overwrites: a file already there is left as it is and reported as already ejected.
- It copies no other item. Every sibling is already served by the package.
- It installs nothing. It names each shadcn primitive the item imports that the project lacks (`run: shadcn add <name>`) and each npm package it cannot resolve, and writes neither `package.json` nor the lockfile.
- A target that resolves outside the project, or a file outside the package, writes nothing and exits 1.

`mithaq eject --prune` deletes every marked file in the folders pieces are ejected into whose text still hashes to its marker, meaning nobody edited it, and prints each one. It never touches an edited or unmarked file, or a file at the project's root such as the screen host. It returns a project to the package's pieces wherever it never changed one.

Restart the dev server after an eject or a prune.

Both read `components.json` in the current folder for where files go, so run them in the app: `apps/asas-tanstack` or `apps/asas-backoffice`.

```sh
cd apps/asas-tanstack && bunx mithaq eject list-table
```

## `upgrade --check`

A project holds the files it ejected and the ones that are always its own: the screen host, the storage adapters and defaults, the `expectedUpdatedAt` step and the directional icon. Each ends with a marker line that records the version (or, for a copy made before the package, the commit) it came from and a hash of its content. `upgrade --check` compares every such file in the current folder with the installed `mithaq-admin`, and prints one line per file:

- up to date, with or without your own edits;
- differs: the package has a different version. Diff the two before you replace it, and merge by hand if you edited it;
- carries no marker, so its origin is unknown;
- outside: the path resolves outside the project or the package, so it was not read;
- removed: the package no longer has the item, so delete the file.
- unsafe form: a known starter auth form has no explicit POST method. This also catches copies from before 0.3.3 that have no marker; merge the auth forms and shared `AuthForm` from the installed version.

It reads `components.json` in the current folder, so run it in each folder that has one: `packages/mithaq`, `apps/asas-tanstack` and `apps/asas-backoffice`. It never writes. `--check` is required.

Exit codes: 0 when nothing differs or there is nothing to check, and 1 when any file differs or an unsafe form remains.

```sh
cd apps/asas-tanstack && bunx mithaq upgrade --check
```

## `<target> <command>`

Any target can declare commands under `commands`. The command runs as `mithaq <target> <command> [flags]` and receives `{ asas, flags }`, where `asas` is the built project. It returns the exit code. `generate --check` runs every target command with `--check`, so a command must write nothing when it sees that flag.

The template's targets declare three commands.

### `drizzle migrate`

The same command as `mithaq migrate`, above.

### `rbac assign`

Gives a member a role inside one organization. The role must be one written in code, such as the tenant roles in `packages/mithaq/src/roles/tenant-roles.ts`. It writes a `memberRoles` row in a transaction and an audit entry, then prints one JSON line naming the operating-system user who ran it.

| Flag | Meaning |
| --- | --- |
| `--tenant <id>` | The organization's id. Required. |
| `--user <id>` | The user's id. The user must already be a member of that organization. Required. |
| `--role <slug>` | A role declared in code on the access target. A custom role stored as a row is refused, and so is `super_admin`. Required. |
| `--check` | Write nothing and exit 0. Used by `generate --check`. |

It is refused if the user already holds the role. Without `--check` it needs `DATABASE_URL`.

Exit codes: 0 when the role is assigned, 1 when the command refuses.

```sh
bunx mithaq rbac assign --tenant 6f0c... --user 9a1b... --role registrar
```

### `storage sweep`

Deletes stored objects that no row names any more. It lists every object in each adapter that can list, and deletes those that no upload row points to and that are more than a day old. A soft-deleted row still names its file, so that file stays. The policy is `defaultSweep` in `src/storage/defaults.ts`, which the project owns.

| Flag | Meaning |
| --- | --- |
| `--check` | List the orphans and delete nothing. |

The template also names `defaultStorageSweepTask` in `tasks`: it removes eligible abandoned upload rows first, then reuses this object policy. Its background log contains only task names and counts. This CLI keeps its object-only behavior and key output. Run `storage sweep --check` first when changing the policy. See [Storage](../../../README.md#kayan-and-globals) and [Jobs](../../../README.md#jobs).

It needs `DATABASE_URL`, and exits 0 unless it refuses or fails.

```sh
bunx mithaq storage sweep --check
```

## password-link

Run `node node_modules/mithaq/src/asas/cli/mithaq.ts password-link <email>` from the project's asas package with `DATABASE_URL` explicitly set. The starter's server-only provider endpoint issues a replacement one-time link valid for 24 hours and prints it once. Unknown emails are refused. This is the recovery path for a first super admin or a locked-out administrator, including shared accounts. Keep the output private; do not redirect it to application logs. Use Node for this command: Node reads no environment file. Do not use `bunx --bun`, which auto-loads `.env` and cannot establish that `DATABASE_URL` was explicitly supplied. Projects with a custom provider must supply `operatorPasswordLink` in that provider's server API. See [Password links](../../auth/better-auth/README.md) for delivery and organization authority.
