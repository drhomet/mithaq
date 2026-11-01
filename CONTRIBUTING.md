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

Before a release, `bun run pack` stages the four published packages in `.pack/`, and `bun run test:release` creates a project from them and runs it end to end.

From `templates/asas/`, with `DATABASE_URL` exported, and then from `templates/mithaq/`, `apps/asas-tanstack/` and `apps/asas-backoffice/`, which hold files from mithaq-admin:

```sh
bunx mithaq generate --check   # in templates/asas
bunx mithaq upgrade --check    # in each of the other three
```

## Rules

- **The vocabulary is frozen.** The vocabulary of `defineMithaq` (its locales, kinds, rules, target names and capabilities, and root keys) changes only with the maintainer's signed decision. Open an issue first and explain what should change and why. Do not run `mithaq lock` or edit a `mithaq.lock` in a pull request. Everything in `defineKayan`, `defineGlobal` and `buildAsas` is open to change.
- **Defaults are explicit.** Each default is named and a project spreads or names it. Most exports start with `default`; the target maps are `drizzleKinds`, `drizzleRules`, `drizzleIdKinds`, `zodKinds`, `zodRules` and `zodIdKinds`. Core never falls back to a hidden behaviour, and `buildAsas` refuses a config that leaves a required default out.
- **One object for three or more parameters.** A function a project calls or implements takes one object once it has three or more parameters. `bun run lint:args` checks it.
- **Comments say why**, never what. A `ponytail:` comment marks a deliberate shortcut and names its limit.
- **Tenant enforcement stays in core.** No change may add a way around the organization scope. See [packages/mithaq/src/asas/runner/README.md](packages/mithaq/src/asas/runner/README.md).
- **Held files are ejected again.** Edit the admin's pieces in `packages/mithaq-admin/registry/`; a file an app or the template holds from it is ejected again, as `packages/mithaq-admin/AGENTS.md` says. Rerun the command that wrote a generated file rather than editing it.
- **Tests first.** Write a failing test that shows the bug or the feature, then the code that makes it pass.
- **Security and data safety come first**, then short code, then speed. Optimize only what you have measured.

## Repository layout

The repository is a Bun workspace over `packages/*`, `templates/*`, `templates/features/*` and `apps/*`. The template and its two apps live in it as they ship, and `bun create mithaq` copies them out, the template's `templates/` becoming a project's `packages/`; [templates/asas/README.md](templates/asas/README.md#project-structure) maps a created project.

The template holds every add-on, and the repository's tests build all of them. A project takes only the ones it asks for: `addOns` in `packages/create-mithaq/index.js` lists each add-on's needs and its own files, and a line only an add-on needs in a shared file sits in a `// add-on: <name>` region, with any line that stands in for it commented in a `// without add-on: <name>` region. `create-mithaq` keeps or drops each region and removes the markers; `bun run test:release` makes a minimal project, a full one and a pick, checks the full one speaks the frozen vocabulary, and each other one that vocabulary less the words of the add-ons it left out.

```
mithaq/
  package.json        workspace root and the repository's scripts
  tsconfig.json       the root type check
  README.md  AGENTS.md  CONTRIBUTING.md  LICENSE  LICENSES/
  .github/workflows/  ci.yml runs the checks; release.yml publishes a pushed v tag
  packages/
    mithaq/           the framework, published as @drhomet/mithaq
    mithaq-rich-text/ the shared nodes, JSON readers, policy and registry, published as @drhomet/mithaq-rich-text
    mithaq-admin/     the admin's pieces, the screen host, storage adapters and steps, published as @drhomet/mithaq-admin
    create-mithaq/    the bun create starter
  templates/          the template a project starts from, in its three steps
    mithaq/           the language, @asas/mithaq, with its Better Auth setup, roles, storage and shared pieces
    features/         a package per feature, @asas/<feature>, each holding its kayan
    asas/             the asas that builds them, where every mithaq command runs
  apps/
    asas-tanstack/  asas-backoffice/   the template's two apps
    asas-next/        a Next.js app that mounts the same API, used to test mounting
    *.ts              repository tooling and cross-package tests
```

`LICENSES/` holds the third-party license notices.

The `AGENTS.md` files hold the rules for a coding agent, each for the tree it sits in:

- `AGENTS.md`, for changing mithaq itself;
- `packages/mithaq/src/asas/runner/AGENTS.md`, for the runner and the tenant scope;
- `packages/mithaq/src/drizzle/AGENTS.md`, for the drizzle store and migrations;
- `packages/mithaq-admin/AGENTS.md`, for the admin package and the files projects hold from it;
- `templates/asas/AGENTS.md`, with `templates/asas/CLAUDE.md` beside it, for working in a created project. Both ship with the template, and `create-mithaq` lays them, with the project's `README.md`, at the project's root.

The skills are Claude Code's `SKILL.md` files, each opening with its folder's `name` and a `description` (`apps/docs.test.ts` checks both). `.claude/skills/ponytail/` is the one the repository ships for changing mithaq; the `tdd` skill the root `AGENTS.md` asks for is Matt Pocock's, from [mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md), which a contributor installs. `templates/asas/.claude/skills/` holds the workflow skills a created project carries at its root, each short, pointing at the guides and naming the checks to run; `apps/pack.ts` also ships them in `@drhomet/mithaq` under `skills/`, for an upgrade to copy again.

The guides sit beside the code they describe, each as its folder's `README.md`:

- `README.md`, the front page, which also ships in the npm package;
- [`templates/asas/README.md`](templates/asas/README.md), the guide to a created project: getting started, its structure, adding to it and running it in production. It ships with the template;
- [`packages/mithaq/README.md`](packages/mithaq/README.md), the language reference and extending the language;
- [`packages/mithaq/src/asas/cli/README.md`](packages/mithaq/src/asas/cli/README.md), the `mithaq` command;
- [`packages/mithaq/src/asas/runner/README.md`](packages/mithaq/src/asas/runner/README.md), tenancy;
- [`packages/mithaq/src/drizzle/README.md`](packages/mithaq/src/drizzle/README.md), migrations in production;
- [`packages/mithaq-admin/README.md`](packages/mithaq-admin/README.md), the admin package;
- [`packages/mithaq-rich-text/README.md`](packages/mithaq-rich-text/README.md), shared rich text.

Every guide above but the front page also ships in `@drhomet/mithaq` under `docs/`, at its repository path, so the links between them resolve in `node_modules/mithaq/docs/`, where a created project's agent reads the guides of the version it installed. A new user guide joins the list in `apps/pack.ts`, and `apps/pack.test.ts` proves the package holds it.

### `packages/mithaq/src`

The folders follow the parts of the framework. `index.ts` re-exports the public API, and `package.json` names the other entries, such as `mithaq/admin`, `mithaq/admin/react`, `mithaq/orpc`, `mithaq/rich-text` and `mithaq/drizzle`.

| Folder | What it holds |
|---|---|
| `mithaq/` | The language. `language.ts` has `defineMithaq` and the target types and capabilities; `define.ts` has `defineKayan` and `defineGlobal`; `resolve.ts` resolves each kayan and holds most of the build's refusals; `rukn.ts` has `defineRukn` and how arkan merge; `rows.ts` compiles access row tables; `lock.ts` is `mithaq lock` and `vocabularyOf`; `messages.ts` and `generate-messages.ts` are the copy and `mithaq generate messages`; `where.ts`, `user.ts`, `types.ts`, `refusal.ts` and `standard-schema.ts` are shared types and helpers. |
| `asas/` | The runtime. `build.ts` is `buildAsas`; `actor.ts` resolves who is calling; `http/` holds the two HTTP plugs, `fetchHttp` and `orpcHttp`; `runner/` runs operations (`write.ts`, `read.ts`, `bulk.ts`, the shipped steps and `defaultOperations` in `steps.ts`, the organization scope in `tenant.ts`, refusals in `errors.ts`); `cli/` is the `mithaq` bin (`mithaq.ts`) and `mithaq upgrade --check` (`upgrade.ts`). |
| `base/` | The `base` rukn: the shipped kinds (`kinds.ts`), rules (`rules.ts`), `defaultFields` and its parts (`fields.ts`), and exact decimals (`decimal.ts`). |
| `rich-text/` | The `richText` rukn, comments service and compatibility exports; shared readers, nodes, policy and registry live in `packages/mithaq-rich-text`. Core imports its Lexical-free `/value` and `/policy` entries. |
| `storage/` | The storage rukn: the `upload` kind, the storage target, `uploadFields` and the building blocks the defaults call. |
| `versions/` | The `versions` rukn: the versions target, `draftFields` and `versionOperations`. |
| `drizzle/` | The Postgres store: `drizzleAdapter` (`index.ts`), its kinds and rules, `mithaq migrate` (`migrate.ts`), and `proxy/`, which re-exports drizzle-orm as `mithaq/drizzle`. |
| `zod/` | The zod schema target, with its kinds and rules. |
| `service/` | `serviceTarget`, the runner as a target, and its named defaults (`defaultDepth`, `defaultLimit`, `defaultMaxLimit`, `defaultJoinLimit`, `defaultBulkLimit`). |
| `rbac/` | `rbacTarget`, the access target over system roles and row tables, and the role-assignment steps. |
| `screen/` | `screenTarget`, `screenKinds` and `folderOf` (`index.ts`); the browser-safe client, `mithaq/admin` (`client.ts`); its React hooks, `mithaq/admin/react` (`react.ts`); `mithaq generate screens` (`generate.ts`); and `mithaq screens` (`studio.ts`). |
| `auth/better-auth/` | The Better Auth strategy, `betterAuthTarget` for access, `betterAuthTenant`, the tenant target, and `mithaq generate auth` (`generate.ts`). |
| `auth/local/` | The `local` strategy, with `localAuthFields`, `localAuthOperations` and its named defaults. |

### `packages/mithaq-admin`

The admin's pieces as TSX source, published as `@drhomet/mithaq-admin`; an app imports each as `mithaq-admin/<file>`, and `mithaq eject` writes one into a project. `registry.json` lists the items. `registry/` holds their sources: the screen components (one file per control family such as `text-control.tsx`, `default-components.tsx` and the `components.tsx` map they are drawn from, `cells.tsx`, `form.tsx` and the pieces it is composed of (`form-*.tsx`, `use-*.tsx`, `field-value.tsx`, `operation-button.tsx`, `delete-button.tsx`, `discard-dialog.tsx`, `draft-banner.tsx`), `list*.tsx`, `nodes.tsx` and the pieces a page's tree is drawn with (`node-*.tsx`, `node-tree.ts`, `default-nodes.tsx`, `leaf-control.tsx`, `record-frame.tsx`), `nav.tsx` and the pieces of the shell (`nav-*.tsx`, `organization-switcher.tsx`, `theme.tsx`, `locale-menu.ts`), the add-ons a language with rich text or files spreads into its map, `rich-text.tsx` and its pieces (`rich-text-*.ts*`) and `upload.tsx` and its pieces (`upload-*.ts*`, `file-thumb.tsx`), and the rest), `host/` (the screen host an app holds), `storage/` (the storage adapters and defaults), `steps/` (registry steps), and `ui/`, `lib/` and `hooks/`, the shadcn primitives and helpers the registry's own type check and tests build against. An app takes its own primitives from shadcn. `source.css` points Tailwind at `registry/`. `test/` holds the package's tests.

### `packages/create-mithaq`

`index.js` is the `bun create mithaq` starter, in plain JavaScript on Node's standard library. It reads the template that `apps/pack.ts` stages beside it, so it fetches nothing but the install.

### `apps/*.ts`

| File | What it does |
|---|---|
| `lint-args.ts` | `bun run lint:args`: fails an exported function, constructor, method or function type with three or more positional parameters, over `packages/mithaq/src`, the registry and the template's packages. `lint-args.test.ts` and `lint-args.fixture.ts` test it. |
| `pack.ts` | `bun run pack`: stages `.pack/mithaq/` (the built package and the user guides under `docs/`; `pack.test.ts` checks the guides), `.pack/mithaq-admin/` (the pieces as source, at the same version) and `.pack/create-mithaq/` (the starter, with the template minus its tests). |
| `release.ts` | `node apps/release.ts <version>` commits the version and tags it; `--publish` is release.yml's publish step. `release.test.ts` tests it. |
| `release-consumer.ts` | `bun run test:release`: makes projects from the staged packages as `bun create mithaq` does, full, minimal and with add-ons picked, then typechecks, migrates, builds, boots and seeds each and runs `mithaq generate --check`. |
| `tanstack-boot.ts`, `next-boot.ts` | `bun run test:tanstack` and `bun run test:next`: build and boot the apps and test them over a real socket. |
| `migrated-database.ts` | Builds the boot tests' database with `drizzle-kit migrate`. |
| `client-imports.test.ts` | Checks that no module a browser loads reaches the language, the storage config or `node:crypto`. |
| `screens-host.test.ts` | Checks that each app is exactly the host item, the generated screen files and a skeleton with no screen code. |
| `mounts.test.ts` | Checks that the Next and TanStack routes hand requests to `asas.handler` alike. |
| `docs.test.ts` | Checks the Markdown: links, retired names and marked snippets (see [Docs](#docs)). |

### Where tests and generated files go in the repository

- Template tests sit in `templates/asas/src` as `*.test.ts`, and a test of one file beside it in `templates/mithaq/src` or a feature, with helpers named `test-*.ts`, `*.support.ts`, `*.fixture.*`, `memory-store.ts` and `standard-schema-target.ts`. `types.probe.ts` holds type probes, and `storage/r2.smoke.ts` runs against a real bucket with `bun run test:r2`. `apps/pack.ts` leaves all of these out of a new project.
- Package tests sit beside their source in `packages/mithaq/src`, in `packages/mithaq-admin/test/`, and in `packages/create-mithaq/index.test.ts`. App tests sit in `apps/asas-tanstack/src`.
- `bun run test` runs `lint:args` and every `*.test.ts`. `bun run typecheck` runs the root config and the configs of `packages/mithaq-admin` and both apps.
- Generated files in the template and apps are committed, as they are in a project. Build output is not: `.pack/` and `node_modules/` are ignored.

## Docs

`apps/docs.test.ts`, part of `bun run test`, checks every tracked `.md` file:

- **Links.** Every relative link, every `#anchor`, and every link to `https://github.com/drhomet/mithaq/blob/main/...` resolves to a tracked file and, for a Markdown file, one of its headings.
- **Retired names.** A name the project dropped, such as the backoffice console's old one, appears in no guide. The commit that renames something adds the old name to `retired` in the test. A guide's "Upgrading" section may name them, to say what each became.
- **Copied snippets.** A snippet copied from a file of the repository is marked by the line `<!-- from: <path from the repository root> -->` right above its fence. The test reads each of its lines, trimmed of indentation, in order in that file, so an excerpt may leave lines out, and a line `// ...` says where it does. A snippet that no longer matches is fixed in the guide, never by changing the code to fit it. `create-mithaq` removes the marker from a created project's guide, whose paths differ. A snippet written for the guide alone, such as a kayan the template does not hold, carries no marker.

## Release

A pull request that changes what a project gets adds its entry under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md), as a breaking change, an addition or a fix. A push to `main` releases nothing; only a pushed `v*` tag does. `node apps/release.ts <version>` renames `## Unreleased` to `## <version>` in the version commit and refuses a release with no entries, and that section becomes the GitHub release's notes. The 0.2.0 entry records what changed since 0.1.1; its upgrade link gives the steps a project takes.

The four packages share one version, `publishConfig.version` in `packages/mithaq/package.json`. The maintainer releases:

```sh
node apps/release.ts 0.2.0          # on a clean, up-to-date main: commits the version and tags v0.2.0
git push --atomic origin main v0.2.0
```

The `release` run runs every check and stages the packages, then waits for the maintainer's approval in the repository's Actions tab. Approved, it publishes the four packages through npm trusted publishing (a version with a `-`, such as `1.0.0-rc.1`, goes to the `next` dist-tag), and creates the GitHub release with the version's changelog section as its notes. A tag with no `## <version>` section publishes nothing. A re-run skips a package already at the version. The `release-check` label on a pull request runs `test:release` on it and uploads the tarballs.

Set up once:

The owner must create `@drhomet/mithaq-rich-text` with a first manual publish,
because trusted publishing cannot create a package. After this change is
merged and checked, stage the release and run
`npm publish .pack/mithaq-rich-text --access public` with two-factor
authentication. On npmjs.com add its Trusted Publisher: GitHub Actions,
repository `drhomet/mithaq`, workflow `release.yml`, environment `npm`, allowed
action `npm publish`. Complete its first trusted publish within two days of
saving that configuration. Set Publishing access to "Require two-factor
authentication and disallow tokens", and revoke old tokens. This is owner setup;
contributors do not publish from a pull request. The shared package publishes
before core, then admin and the starter, all at one version.

1. On npmjs.com, for each of `@drhomet/mithaq-rich-text`, `@drhomet/mithaq`, `@drhomet/mithaq-admin` and `create-mithaq`, add a Trusted Publisher: GitHub Actions, repository `drhomet/mithaq`, workflow `release.yml`, environment `npm`, allowed action `npm publish`. Then set Publishing access to "Require two-factor authentication and disallow tokens", and revoke the old tokens.
2. In the repository's settings, create the environment `npm` with the maintainer as required reviewer and deployment tags limited to `v*`, and add a tag ruleset so only the maintainer creates `v*` tags.

## Send a pull request

1. Branch from `main`.
2. Make the change, test first.
3. Run every check above until it passes.
4. Write each commit message as one plain sentence about what is now true, with no type prefix and no trailer. For example: `A relationship to another organization's row is refused on update as it is on create.`
5. Open the pull request against `main` on [github.com/drhomet/mithaq](https://github.com/drhomet/mithaq). Say what changed and why, and link the issue it answers.

By contributing you agree that your work is released under the MIT license in [LICENSE](LICENSE).
