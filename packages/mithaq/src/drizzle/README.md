# Migrations in production

In production, `connect()` on the asas, the runtime `buildAsas` builds, does not push the schema. It checks the migrations instead, as `prodMigrations` on `drizzleAdapter` says. This page covers what its two settings do, the lock every writer of the migration history takes, and applying migrations by hand. Setting `prodMigrations` in a project is in [`connect()` at start](../../../../templates/asas/README.md#connect-at-start).

## `pending: 'refuse'` or `'run'`

| | `'refuse'` (the template's choice) | `'run'` |
| --- | --- | --- |
| A migration is pending | The app refuses to start, names the pending folders, and exits 1. Nothing is served and nothing is written. | The app applies every pending migration in one transaction, then serves. If one fails, none is applied. |
| Who applies migrations | Your deploy, as a separate step before the apps start. | The first app instance that starts. |
| Use it when | You want schema changes to be a deliberate, visible step, reviewed or run by a person or a pipeline. | You deploy one artifact and want it to bring its own schema, and you accept that starting the app changes the database. |

With either choice, a production start also refuses:

- a database with the dev-push marker;
- a database whose history is still in drizzle's default table, `drizzle.__drizzle_migrations`. Run `mithaq migrate` against it once to move the history, then start again.

## The advisory lock

Every writer of the migration history takes one Postgres advisory lock on `drizzle.__mithaq_migrations` (`pg_advisory_xact_lock`). This covers a production start with `pending: 'run'`, a development push, and the step that creates the history table. If several instances start at once with `'run'`, one applies the migrations and the others wait, then find nothing left to apply.

## Applying migrations by hand

With `pending: 'refuse'`, you apply migrations with drizzle-kit, using the version the installed mithaq depends on, and the config `mithaq migrate` wrote:

```sh
cd templates/asas
set -a; . ./.env; set +a     # or export DATABASE_URL from your secret store
DRIZZLE_KIT=$(node -p "path.join(path.dirname(require('module').createRequire(fs.realpathSync('node_modules/mithaq/package.json')).resolve('drizzle-kit')), 'bin.cjs')")
node "$DRIZZLE_KIT" migrate --config src/migrations/drizzle.config.ts
```

The config reads `DATABASE_URL` through the project's own `asas`, so the migration reaches the same database the app uses.

> **Warning:** `drizzle-kit migrate` takes no lock. Do not run it while an app is starting, and never while an instance configured with `pending: 'run'` may start, or both can apply the same migration. Run it, wait for it to finish, then start the apps.

If a migration's SQL was already run by hand, record it instead of applying it again. `mithaq migrate` prints the exact `insert` line for each unapplied folder. Record only a migration whose SQL really ran.
