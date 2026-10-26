# SQLite on a device

Use a device asas when a Lynx app keeps its records on the phone, including patient data that must stay there. The app supplies an opened drizzle SQLite database. mithaq declares columns, runs operations and applies bundled migrations; the host owns the connection and its encryption and lifetime.

Import the phone runtime from `mithaq/device`. The ordinary `mithaq` entry is the server runtime and imports Node services. A project declares its own `defineMithaq` with the SQLite target and records that language in its own `mithaq.lock`. The starter language and its frozen vocabulary stay unchanged. See the [language reference](../../../README.md) and the [Postgres migration guide](../README.md).

## The injected contract

<!-- from: packages/mithaq/src/drizzle/sqlite/index.ts -->
```ts
export type SqliteDatabase = BaseSQLiteDatabase<'sync' | 'async', any, any>
export type SqliteContract = {
  db: SqliteDatabase
  transaction<T>(fn: (tx: SqliteDatabase) => Promise<T>): Promise<T>
}
```

The pinned drizzle RC names its SQLite base class `SQLiteAsyncDatabase`; mithaq imports that type as `BaseSQLiteDatabase`. It supports both synchronous and asynchronous SQLite drivers. No driver is part of mithaq's contract.

`db` must be an opened drizzle SQLite database. `transaction` must run and await `fn` against a transaction-scoped drizzle database, commit its result, and roll back if it throws. Other queries must wait until that transaction settles, so they cannot observe or become part of its uncommitted work. Merely putting `BEGIN` and `COMMIT` around an async callback on a shared connection does not satisfy this isolation requirement. The callback's return value becomes the transaction's result; failures propagate to the caller.

The store turns on and checks SQLite foreign-key enforcement when `asas.connect()` runs outside a transaction. The adapter must preserve that setting across the scoped handles it supplies. `asas.destroy()` releases no host connection; the app closes it after its asas is no longer used.

## Declare the device language

This example uses the same defaults a server project names explicitly. In an app, import these exports from `mithaq/device` and accept the adapter's `SqliteContract`:

<!-- from: packages/mithaq/src/drizzle/sqlite/__fixtures__/device-language.ts -->
```ts
export const deviceLanguage = ({ db, transaction }: SqliteContract) => defineMithaq({
  locales: ['en', 'ar'],
  arkan: [base],
  targets: {
    sqlite: sqliteAdapter({ db, transaction, kinds: drizzleSqliteKinds, rules: drizzleSqliteRules, idKinds: drizzleSqliteIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({
      store: 'sqlite', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth,
      defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultMaxLimit,
    }),
  },
})
```

<!-- from: packages/mithaq/src/drizzle/sqlite/__fixtures__/device-language.ts -->
```ts
export const deviceAsas = (contract: SqliteContract) => {
  const { defineKayan, buildAsas } = deviceLanguage(contract)
  const patient = defineKayan({
    name: 'patient',
    placement: 'device',
    fields: { ...defaultFields, name: { kind: 'text', rules: { required: true } } },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { service: { operations: defaultOperations } },
  })
  return buildAsas({ kayan: [patient], http: [] })
}
```

Apply migrations, then `await asas.connect()` before operations such as `asas.kayan.patient.operations.create({ name: 'Huda' })`. Supply an actor with operation options when access needs one. The device runner carries actor, context and transaction through bound `tools.of(kayan)` and `tools.kayans` calls; nested writes join the outer transaction. Await every nested call. A nested write with `beforeTransaction` is refused with `error.invalid.before_transaction`: that slot runs outside the transaction on the server, and an outside query on the device would wait behind its own open transaction. Move that hook into `steps` or call the write before opening the transaction. Independent calls have independent context, without AsyncLocalStorage. Both runners share their context and transaction guards, outside slots, commit order and hook draining. Bulk operations resolve their single-row operation during the build. A device build requires `bulkLimit` to fit `maxLimit`; the example uses `defaultMaxLimit` for both. `afterCommit` runs after durability; its failure leaves the write standing and raises `AfterCommitError` with its result.

## Migrations

Generate SQL during the project's build using drizzle-kit with `dialect: 'sqlite'`. `generateSqliteMigrations` from `mithaq/generate-sqlite-migrations` runs that dialect against a project's exported drizzle schema and returns a `SqliteMigration[]`. Its options are `{ schema, out, name }`: paths to the schema and committed migration directory, and a lowercase migration name. Export the tables from the device language's `asas.targets.sqlite.tables` in the schema file. The generator is a Node build tool; never import it on the phone.

Commit the generated SQL folders and the returned bundle, which contains each migration's name, build-time hash and statements. Bundle that data with the app. For an existing drizzle-kit directory, `readMigrationFiles` from `drizzle-orm/migrator` can produce the same bundle at build time. Keep the complete history unchanged and ordered; do not ship only the newest migration.

On the phone, call `await migrateSqlite({ ...contract, migrations })` with that bundle before connecting the asas. The runtime reads no files and computes no hashes. It applies every pending statement and the corresponding `__mithaq_migrations` rows in one injected transaction. A failed statement rolls back the whole pending set, including history. Repeating the call applies nothing twice. A database with a newer migration than the app knows, or with changed or incomplete history, is refused before pending SQL runs. Upgrading never deletes the user's existing rows unless the bundled migration explicitly does so; review SQL for data loss before shipping it.

## Placement and supported values

`placement: 'device'` on a kayan or global declares that it may only be built into a device store. Passing that declaration to a server/Postgres `buildAsas` throws a clear error before a target initializes. Both builders check placement in core. The device store also refuses a kayan that places the tenant field or needs Better Auth. Server tenant enforcement is unchanged.

UUIDs, dates and decimals are text. JSON, text arrays and Lexical rich text are JSON text. Datetimes are integer milliseconds and read as `Date`; checkboxes are integer booleans. A number id is an integer primary key with autoincrement. Unique and index rules apply to the kayan's own fields, without organization scope. A decimal stays text so SQLite cannot round it through a float; decimal sums are refused.

Unsupported on the device: HTTP targets, Better Auth and other auth providers, the tenant field, BLOBs, storage, screen and access targets, versions, localized columns, many-valued relationships, Postgres schemas, JSON filters and `nullsNotDistinct` indexes. Relationship columns and filters over one related field are supported. The host supplies actors rather than an HTTP authentication service. Do not import the server entry, a build-time generator, or Node built-ins into the phone bundle.

## Wiring on a phone

The app opens its vault through its native database layer. A separate small adapter package turns that opened database into a drizzle SQLite database and provides the isolated `transaction` function. The app passes the resulting contract to its device language, applies its bundled migrations, connects the asas, then uses the kayan operations. That adapter package owns driver setup and transaction routing; mithaq neither imports it nor depends on it. Encryption, vault keys and native execution stay in the native layer.
