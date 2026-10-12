# Contributing to mithaq

Thank you for helping. This page covers setting up, running the checks, the rules every change keeps, and sending a pull request. What mithaq is and how it works is in [README.md](README.md) and [packages/mithaq/README.md](packages/mithaq/README.md); the map of the repository is under [Repository layout](#repository-layout) below.

## Set up

You need Bun 1.3, Node.js 24 or later, and PostgreSQL 15 or later.

```sh
git clone https://github.com/drhomet/mithaq.git
cd mithaq
bun install
```

Bun lays `node_modules` out with its isolated linker, which the screens need. npm, pnpm and yarn do not work here.

The tests drop and rebuild their database, so give them a throwaway one. It must be named `mithaq` and must not listen on port 5432 or 55439; the tests refuse anything else. With Docker, for example:

```sh
docker run -d --name mithaq-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mithaq -p 55433:5432 postgres:17
export DATABASE_URL=postgres://postgres:postgres@localhost:55433/mithaq
```

## Run the checks

From the repository root:

```sh
bun run typecheck
bun run lint:args
bun run test
bun run test:tanstack
bun run test:next
```

Before a release, `bun run pack` stages the two published packages in `.pack/`, and `bun run test:release` creates a project from them and runs it end to end.

From `templates/asas/`, with `DATABASE_URL` exported:

```sh
bunx mithaq generate --check
bunx mithaq upgrade --check
```

## Rules

- **The vocabulary is frozen.** The vocabulary of `defineMithaq` (its locales, kinds, rules, target names and capabilities, and root keys) changes only with the maintainer's signed decision. Open an issue first and explain what should change and why. Do not run `mithaq lock` or edit a `mithaq.lock` in a pull request. Everything in `defineKayan`, `defineGlobal` and `buildAsas` is open to change.
- **Defaults are explicit.** Each default is an exported `default<Name>` that a project spreads or names. Core never falls back to a hidden behaviour, and `buildAsas` refuses a config that leaves a required default out.
- **One object for three or more parameters.** A function a project calls or implements takes one object once it has three or more parameters. `bun run lint:args` checks it.
- **Comments say why**, never what. A `ponytail:` comment marks a deliberate shortcut and names its limit.
- **Tenant enforcement stays in core.** No change may add a way around the organization scope. See [packages/mithaq/src/asas/runner/README.md](packages/mithaq/src/asas/runner/README.md).
- **Copies are regenerated.** Edit registry items in `packages/mithaq-admin/registry/` and copy them again; the steps are in `packages/mithaq-admin/AGENTS.md`. Rerun the command that wrote a generated file rather than editing it.
- **Tests first.** Write a failing test that shows the bug or the feature, then the code that makes it pass.
- **Security and data safety come first**, then short code, then speed. Optimize only what you have measured.

## Repository layout

The repository is a Bun workspace over `packages/*`, `templates/*` and `apps/*`. The template and its two apps live in it as they ship, and `bun create mithaq` copies them out; [templates/asas/README.md](templates/asas/README.md#project-structure) maps a created project.

```
mithaq/
  package.json        workspace root and the repository's scripts
  tsconfig.json       the root type check
  README.md  AGENTS.md  CONTRIBUTING.md  LICENSE  LICENSES/
  packages/
    mithaq/           the framework, published as @drhomet/mithaq
    mithaq-admin/     the shadcn registry of screen components, storage adapters and steps
    create-mithaq/    the bun create starter
  templates/
    asas/  auth/      the template a project starts from
  apps/
    asas-tanstack/  asas-platform/   the template's two apps
    asas-next/        a Next.js app that mounts the same API, used to test mounting
    *.ts              repository tooling and cross-package tests
```

`LICENSES/` holds the third-party license notices.

The `AGENTS.md` files hold the rules for a coding agent, each for the tree it sits in:

- `AGENTS.md`, for changing mithaq itself;
- `packages/mithaq/src/asas/runner/AGENTS.md`, for the runner and the tenant scope;
- `packages/mithaq/src/drizzle/AGENTS.md`, for the drizzle store and migrations;
- `packages/mithaq-admin/AGENTS.md`, for the registry and its copies;
- `templates/asas/AGENTS.md`, with `templates/asas/CLAUDE.md` beside it, for working in a created project. Both ship with the template.

The guides sit beside the code they describe, each as its folder's `README.md`:

- `README.md`, the front page, which also ships in the npm package;
- [`templates/asas/README.md`](templates/asas/README.md), the guide to a created project: getting started, its structure, adding to it and running it in production. It ships with the template;
- [`packages/mithaq/README.md`](packages/mithaq/README.md), the language reference and extending the language;
- [`packages/mithaq/src/asas/cli/README.md`](packages/mithaq/src/asas/cli/README.md), the `mithaq` command;
- [`packages/mithaq/src/asas/runner/README.md`](packages/mithaq/src/asas/runner/README.md), tenancy;
- [`packages/mithaq/src/drizzle/README.md`](packages/mithaq/src/drizzle/README.md), migrations in production;
- [`packages/mithaq-admin/README.md`](packages/mithaq-admin/README.md), the admin registry.

### `packages/mithaq/src`

The folders follow the parts of the framework. `index.ts` re-exports the public API, and `package.json` names the other entries, such as `mithaq/admin`, `mithaq/admin/react`, `mithaq/orpc`, `mithaq/rich-text` and `mithaq/drizzle`.

| Folder | What it holds |
|---|---|
| `mithaq/` | The language. `language.ts` has `defineMithaq` and the target types and capabilities; `define.ts` has `defineKayan` and `defineGlobal`; `resolve.ts` resolves each kayan and holds most of the build's refusals; `rukn.ts` has `defineRukn` and how arkan merge; `rows.ts` compiles access row tables; `lock.ts` is `mithaq lock` and `vocabularyOf`; `messages.ts` and `generate-messages.ts` are the copy and `mithaq generate messages`; `where.ts`, `user.ts`, `types.ts`, `refusal.ts` and `standard-schema.ts` are shared types and helpers. |
| `asas/` | The runtime. `build.ts` is `buildAsas`; `actor.ts` resolves who is calling; `http/` holds the two HTTP plugs, `fetchHttp` and `orpcHttp`; `runner/` runs operations (`write.ts`, `read.ts`, `bulk.ts`, the shipped steps and `defaultOperations` in `steps.ts`, the organization scope in `tenant.ts`, refusals in `errors.ts`); `cli/` is the `mithaq` bin (`mithaq.ts`) and `mithaq upgrade --check` (`upgrade.ts`). |
| `base/` | The `base` rukn: the shipped kinds (`kinds.ts`), rules (`rules.ts`), `defaultFields` and its parts (`fields.ts`), and exact decimals (`decimal.ts`). |
| `rich-text/` | The `richText` rukn and its Lexical reading and writing, with `defaultNodes`. |
| `storage/` | The storage rukn: the `upload` kind, the storage target, `uploadFields` and the building blocks the defaults call. |
| `versions/` | The `versions` rukn: the versions target, `draftFields` and `versionOperations`. |
| `drizzle/` | The Postgres store: `drizzleAdapter` and `drizzleTarget` (`index.ts`), its kinds and rules, `mithaq migrate` (`migrate.ts`), and `proxy/`, which re-exports drizzle-orm as `mithaq/drizzle`. |
| `zod/` | The zod schema target, with its kinds and rules. |
| `service/` | `serviceTarget`, the runner as a target, and its named defaults (`defaultDepth`, `defaultLimit`, `defaultMaxLimit`, `defaultJoinLimit`, `defaultBulkLimit`). |
| `rbac/` | `rbacTarget`, the access target over system roles and row tables, and the role-assignment steps. |
| `screen/` | `screenTarget`, `screenKinds` and `folderOf` (`index.ts`); the browser-safe client, `mithaq/admin` (`client.ts`); its React hooks, `mithaq/admin/react` (`react.ts`); `mithaq generate screens` (`generate.ts`); and `mithaq screens` (`studio.ts`). |
| `auth/better-auth/` | The Better Auth strategy, `betterAuthTarget` for access, `betterAuthTenant`, the tenant target, and `mithaq generate auth` (`generate.ts`). |
| `auth/local/` | The `local` strategy, with `localAuthFields`, `localAuthOperations` and its named defaults. |

### `packages/mithaq-admin`

The shadcn registry a project copies from. `registry.json` lists the items. `registry/` holds their sources: the screen components (`controls.tsx`, `cells.tsx`, `form.tsx`, `list*.tsx`, `nodes.tsx`, `nav.tsx` and the rest), `host/` (the screen host an app copies), `storage/` (the storage adapters and defaults), `steps/` (registry steps), and `ui/`, `lib/` and `hooks/`, the shadcn primitives and helpers the registry's own type check and tests build against. An app takes its own primitives from shadcn. `bun run build` in this folder writes `r/`, the built items with a marker line on every file; `r/` is not committed. `test/` holds the registry's tests.

### `packages/create-mithaq`

`index.js` is the `bun create mithaq` starter, in plain JavaScript on Node's standard library. It reads the template that `apps/pack.ts` stages beside it, so it fetches nothing but the install.

### `apps/*.ts`

| File | What it does |
|---|---|
| `lint-args.ts` | `bun run lint:args`: fails an exported function, constructor, method or function type with three or more positional parameters, over `packages/mithaq/src`, the registry and `templates/asas/src`. `lint-args.test.ts` and `lint-args.fixture.ts` test it. |
| `pack.ts` | `bun run pack`: stages `.pack/mithaq/` (the built package, with the registry in `r/`) and `.pack/create-mithaq/` (the starter, with the template minus its tests). |
| `release-consumer.ts` | `bun run test:release`: makes a project from the staged packages as `bun create mithaq` does, then typechecks, migrates, builds and boots it and runs `mithaq generate --check`. |
| `tanstack-boot.ts`, `next-boot.ts` | `bun run test:tanstack` and `bun run test:next`: build and boot the apps and test them over a real socket. |
| `migrated-database.ts` | Builds the boot tests' database with `drizzle-kit migrate`. |
| `client-imports.test.ts` | Checks that no module a browser loads reaches the language, the storage config or `node:crypto`. |
| `screens-host.test.ts` | Checks that each app is exactly the host item, the generated screen files and a skeleton with no screen code. |
| `mounts.test.ts` | Checks that the Next and TanStack routes hand requests to `asas.handler` alike. |

### Where tests and generated files go in the repository

- Template tests sit in `templates/asas/src` and `templates/auth/src` as `*.test.ts`, with helpers named `test-*.ts`, `*.support.ts`, `*.fixture.*`, `memory-store.ts` and `standard-schema-target.ts`. `types.probe.ts` holds type probes, and `storage/r2.smoke.ts` runs against a real bucket with `bun run test:r2`. `apps/pack.ts` leaves all of these out of a new project.
- Package tests sit beside their source in `packages/mithaq/src`, in `packages/mithaq-admin/test/`, and in `packages/create-mithaq/index.test.ts`. App tests sit in `apps/asas-tanstack/src`.
- `bun run test` runs `lint:args` and every `*.test.ts`. `bun run typecheck` runs the root config and the configs of `packages/mithaq-admin` and both apps.
- Generated files in the template and apps are committed, as they are in a project. Build output is not: `packages/mithaq-admin/r/`, `.pack/` and `node_modules/` are ignored.

## Send a pull request

1. Branch from `main`.
2. Make the change, test first.
3. Run every check above until it passes.
4. Write each commit message as one plain sentence about what is now true, with no type prefix and no trailer. For example: `A relationship to another organization's row is refused on update as it is on create.`
5. Open the pull request against `main` on [github.com/drhomet/mithaq](https://github.com/drhomet/mithaq). Say what changed and why, and link the issue it answers.

By contributing you agree that your work is released under the MIT license in [LICENSE](LICENSE).
