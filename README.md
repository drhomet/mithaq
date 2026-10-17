# mithaq

[![npm](https://img.shields.io/npm/v/@drhomet/mithaq)](https://www.npmjs.com/package/@drhomet/mithaq)

mithaq is a TypeScript language for declaring a backend and its admin once, and building the database, API, validation, access rules and admin screens from that one declaration.

The package is `@drhomet/mithaq`. It is pre-1.0, so the API may still change between releases.

The name is Arabic for a covenant. The other words in the API are Arabic too, and each is defined where it first appears below.

## Why it exists

- **One declaration drives everything.** A kayan's fields, kinds and rules become the Postgres table (through drizzle), the input schema (through zod), the HTTP operations and the admin forms and lists. Nothing is declared twice, so nothing drifts.
- **The vocabulary is frozen.** The kinds, rules and targets mithaq ships change only by the maintainer's explicit decision. A project can also seal its own language in a signed `mithaq.lock`. `mithaq lock --check`, which the apps run before `dev`, `build` and `preview`, then fails when the vocabulary no longer matches the lock. Signing a change takes a code shown in a popup, never in the command's output, so a script or an agent running `mithaq lock` cannot approve it.
- **Tenant isolation is enforced in core.** A kayan that places the tenant field belongs to one organization. Core adds the tenant scope to every operation and combines it with the project's own access with AND, so no access rule can widen it. Writes land in the active organization, and `unique` rules and index groups are built per organization.
- **Defaults are explicit.** The project names every default it uses (`defaultOperations`, `defaultFields`, `defaultAuthorize`, the limits) in its own code. Core does not fall back to a default of its own: a configuration that leaves a required one out is a type error or a refusal from `buildAsas`.
- **The admin is your code when you want it.** The screens are shadcn components the project imports from `mithaq-admin` and draws with its own primitives; `mithaq eject` puts any one of them into the project to edit like any other file.

## Quick start

```sh
bun create mithaq my-app --full
```

This creates a Bun workspace of the template's three steps, the language (`packages/mithaq`), a package per feature (`packages/features/*`) and the asas that builds them (`packages/asas`), and two apps: the tenant app (`apps/asas-tanstack`), which serves the dashboard and the portal, and the backoffice console (`apps/asas-backoffice`), for staff who work across every organization. It writes a `.env` with fresh secrets and runs `bun install`. `--full` takes every add-on, the whole worked example; without it the project is minimal, auth and a `tags` example, and `--with roles,courses` picks add-ons.

Then, with PostgreSQL 15 or later serving the database that `DATABASE_URL` names in `packages/asas/.env`:

```sh
cd my-app
cd packages/asas
# push the schema, make the dev admin and fill its organization, development only
bun run dev:setup --seed
cd ../..
bun run --cwd apps/asas-tanstack dev   # the tenant app, http://localhost:5173
bun run --cwd apps/asas-backoffice dev   # in a second terminal: the backoffice console, http://localhost:5174
```

Sign in to both apps with `DEV_ADMIN_EMAIL` and `DEV_ADMIN_PASSWORD` from `packages/asas/.env`: the dev admin owns "Dev admin's workspace", which `--seed` filled, and is the backoffice's `super_admin`.

In production, `connect()` does not push the schema; it checks the migration files instead. [Running in production](https://github.com/drhomet/mithaq/blob/main/templates/asas/README.md#running-in-production) explains how to apply them.

## A small example

A language comes from `defineMithaq`. Its arkan (singular rukn, "pillar") are the pluggable parts that bring kinds and rules; `base` brings the shipped ones. Its targets are what each declaration is built into.

```ts
// src/mithaq.ts
import {
  base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultJoinLimit, defaultLimit, defaultMaxLimit,
  defineMithaq, drizzleAdapter, drizzleKinds, drizzleRules, drizzleIdKinds, serviceTarget, zodKinds, zodRules, zodIdKinds, zodTarget,
} from 'mithaq'

export const { defineKayan, buildAsas } = defineMithaq({
  locales: ['en', 'ar'] as const,
  arkan: [base],
  targets: {
    drizzle: drizzleAdapter({ connectionString: process.env.DATABASE_URL!, kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({
      authorize: defaultAuthorize,
      depth: defaultDepth,
      defaultLimit,
      maxLimit: defaultMaxLimit,
      joinLimit: defaultJoinLimit,
      bulkLimit: defaultBulkLimit,
      store: 'drizzle',
      schema: 'zod',
    }),
  },
})
```

A kayan ("entity") is one data type: its fields, their kinds and rules, its access and its operations. Every label carries one string per locale the language declares, and a missing one is a type error.

```ts
// src/tags.ts
import { defaultFields, defaultOperations } from 'mithaq'
import { defineKayan } from './mithaq.ts'

export const tags = defineKayan({
  name: 'tags',
  access: { read: () => true },
  targets: { service: { operations: defaultOperations } },
  fields: {
    ...defaultFields,
    name: {
      kind: 'text',
      label: { en: 'Name', ar: 'الاسم' },
      rules: { required: true, unique: true, trim: true, maxLength: 60 },
    },
  },
})
```

`buildAsas` builds the asas ("foundation"), the runtime:

```ts
// src/asas.ts
import { defaultMaxBodyBytes, fetchHttp } from 'mithaq'
import { buildAsas } from './mithaq.ts'
import { tags } from './tags.ts'

export const asas = buildAsas({ kayan: [tags], http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })] })
```

`asas.handler(request)` answers a `Request` with a `Response`; mount it under `/api` in any server. With `fetchHttp`, `POST /api/tags/create` with a JSON body creates a tag, and `POST /api/tags/find` lists them. In development, `asas.connect()` pushes the schema to Postgres. A kayan that declares no access answers only the admin the build names, so this one opens reads to everyone.

To make a kayan belong to one organization, add the tenant target to the language and place its field:

```ts
// in defineMithaq's targets:
tenant: betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', newRows: 'active', organizations: 'many' }),

// in a kayan's fields, with `tenant` taken from the language's `targets`:
organization: tenant.field,
```

`unique: true` on that kayan is then unique within each organization, and `indexes: [{ within: 'organization', unique: [['code', 'term']] }]` declares a compound one. [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md) has the full rules.

## What's in the box

- **Store:** Postgres through drizzle (`drizzleAdapter`), with a schema push in development and migration files written by `mithaq migrate` for production.
- **Validation:** zod schemas derived from every kayan (`zodTarget`). A field can carry its own zod shape instead.
- **Runtime:** the operation runner (`serviceTarget`) with the default operations (create, update, delete, find, findByID, count, updateMany, deleteMany), steps around every write, an audit step, soft delete and bulk limits.
- **HTTP:** plain fetch routes (`fetchHttp`), or a typed client and OpenAPI through oRPC (`mithaq/orpc`).
- **Access:** role-based access with permission keys per operation and per field (`rbacTarget`, `betterAuthTarget` to keep roles in Better Auth's own tables, or `memberRoleTarget` for Better Auth's own member roles alone).
- **Tenancy:** `betterAuthTenant`, over Better Auth organizations.
- **Auth:** Better Auth (`betterAuth`) or local accounts (`local`), with `mithaq generate auth` writing the Better Auth kayan.
- **Versions and drafts:** the `versions` rukn keeps a row's past versions, with drafts, autosave and restore.
- **Files:** the `storage` rukn and the `upload` kind. The template ships adapters for local disk, Cloudflare R2, S3-compatible services and UploadThing as project files.
- **Rich text:** the `richText` rukn, over Lexical.
- **Admin screens:** `screenTarget` describes each screen; `mithaq generate screens` writes its routes into the host app, and the React components come from the `mithaq-admin` package, drawn with the app's own shadcn primitives, and a project ejects the ones it wants to own. `mithaq upgrade --check` compares the files it holds with the installed version.
- **Copy:** `mithaq generate messages` writes the project's labels and messages to one file per kayan, and refuses a label missing a locale.

`mithaq --help` lists every command.

## Requirements

- npm, pnpm 10.6 or later, Yarn 1 or [Bun](https://bun.sh) 1.3, whichever runs `create mithaq`. Yarn 2 and later install a copy of mithaq for each workspace of a monorepo, which the build refuses, so a monorepo does not take them yet.
- Node.js 24 or later.
- PostgreSQL 15 or later.
- TypeScript, installed by the project.

## Documentation

Each guide is the `README.md` of the folder it describes.

- [Working in a mithaq project](https://github.com/drhomet/mithaq/blob/main/templates/asas/README.md): getting started, where each file lives, adding a kayan, a feature or a step, and running in production. It ships in every created project.
- [The mithaq language](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/README.md): the language, kinds, rules, kayan, targets, the runner and access, and adding a rukn, a kind, a target or a configurable feature.
- [Tenancy](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/runner/README.md): per-organization kayan, what core enforces, and per-organization indexes.
- [The `mithaq` command](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/asas/cli/README.md): every command, flag and exit code.
- [Migrations in production](https://github.com/drhomet/mithaq/blob/main/packages/mithaq/src/drizzle/README.md): `pending: 'refuse'` or `'run'`, the advisory lock, and applying migrations by hand.
- [The admin package](https://github.com/drhomet/mithaq/blob/main/packages/mithaq-admin/README.md): the screen components, ejecting one, `mithaq upgrade --check`, migrating a project that holds copies, and adding a registry item.
- [Contributing](https://github.com/drhomet/mithaq/blob/main/CONTRIBUTING.md): setting up, the checks, the repository layout, and sending a pull request.

## Status and license

mithaq is pre-1.0. The template that `bun create mithaq` creates is the worked example, and every file there is commented.

MIT licensed; see [LICENSE](https://github.com/drhomet/mithaq/blob/main/LICENSE). mithaq includes code adapted from Payload and from openstatus's time picker, both MIT licensed; their notices are in [LICENSES/payload.txt](https://github.com/drhomet/mithaq/blob/main/LICENSES/payload.txt) and [LICENSES/openstatus-time-picker.txt](https://github.com/drhomet/mithaq/blob/main/LICENSES/openstatus-time-picker.txt).
