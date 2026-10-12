# The drizzle target

`index.ts` builds the tables, runs queries and connects. `migrate.ts` is `mithaq migrate` and the production boot. A mistake here loses rows in a user's database, so every change ships with a test in `templates/asas/src/migrate*.test.ts` or `asas.test.ts`, run against a real Postgres. `README.md` beside this file is the user guide to migrations in production; keep it true when the boot changes.

## Migrations

- `mithaq migrate` writes a migration folder through drizzle-kit, plus `drizzle.config.ts` and `schema.ts` with the header ``// Written by `mithaq migrate`. Commit it.``. It refuses to overwrite a `schema.ts` that lacks the header.
- `--name <slug>` names the folder: lowercase letters, digits and underscores, 1 to 64 characters. It is refused with `--baseline`. `--check` writes nothing and answers 1 when a migration is pending. `--baseline` adopts an existing database whose history is empty or holds only the dev-push marker.
- A statement that would lose data or drop a guard is refused until the project answers it in `mithaq.hints.json`. Keep it that way: a new drizzle-kit statement type that drops anything goes through `droppedBy` or `guardDroppedBy`.
- `refuseStrangers` refuses a push or a baseline when another schema holds a table with one of the language's names, because drizzle-kit filters by name across schemas and would drop it.

## History and its lock

- mithaq keeps its history in `drizzle.__mithaq_migrations` (`migrationsTable`), never in drizzle's default table. `moveHistory` copies an older project's rows over.
- A development `connect()` pushes the schema and records the `mithaq_dev_push` marker row. `mithaq migrate` refuses to write against a pushed database; `--baseline` replaces the marker.
- `historyLock` is a transaction-level advisory lock that every writer of the history takes: the production boot and the connect that creates the table. Its key is fixed so an instance of an older release booting beside a newer one still waits. Never change the key, and never write the history outside it.
- `drizzle-kit migrate` run by hand takes no lock.

## prodMigrations

A production `connect()` refuses to start without `prodMigrations: { migrationsFolder, pending }`. With `pending: 'run'`, `bootMigrations` applies every pending folder in one transaction under `historyLock`, so a failure applies none and two booting instances apply once. With `pending: 'refuse'` it refuses while one is pending. `push: true` beside `prodMigrations` is refused.

## Names

- A compound index is named `<table>_<columns>_idx`, or `<table>_<columns>_unique` for a `nullsNotDistinct` one, so the name is the same on every build whatever the kayan order.
- A name longer than 63 bytes, or one that is not a plain identifier, is refused, never truncated, because Postgres would cut it in silence.
- Tables and indexes share one namespace per schema, so `init` refuses an index named like a table or another index.
- Renaming anything a user's database already holds is a migration for every project. Treat a name change as a breaking change.

## Unique and indexes

`resolve.ts` in `../mithaq/` turns a kayan's `indexes` into a flat list, and `init` builds it.

- A field's `unique: true` gets a default unique index: over the field alone on a shared kayan, over `(tenant field, field)` on a tenant-owned one. A file kayan's storage `key` stays unique across the whole table.
- A default unique index over one column is built as that column's `UNIQUE`, so a shared kayan's table stays what it was.
- A `{ within, unique, index }` group expands to indexes led by the tenant field. A plain `{ fields, unique }` entry means exactly its fields.
- `nullsNotDistinct` is built as a unique constraint, because drizzle's index builder has no `NULLS NOT DISTINCT`.
- A field with `rules.index` gets its own unnamed index.
