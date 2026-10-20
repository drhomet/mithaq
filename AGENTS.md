# Working on the mithaq repository

mithaq is a TypeScript language for declaring a backend and its admin once. `defineMithaq` declares the language; each kayan built from it becomes a Postgres table, a zod schema, HTTP operations, access rules and admin screens.
It ships as `@drhomet/mithaq` (projects import it as `mithaq`), the admin's pieces as `@drhomet/mithaq-admin` (imported as `mithaq-admin`), and the starter `create-mithaq` (`bun create mithaq my-app`).
This file is for an agent changing mithaq itself. An agent working inside a created project reads `templates/asas/AGENTS.md`.

## Words

- **kayan**: an entity, one data type: its fields, their kinds and rules, its access and its operations. Declared with `defineKayan`, or `defineGlobal` for a single-row kayan.
- **rukn**, plural **arkan**: a pillar, a pluggable part that brings kinds, rules, fields or targets (`base`, `richText`, `storage`, `versions`).
- **asas**: the foundation, the runtime `buildAsas` returns from a list of kayan.
- **target**: what a declaration is built into, named under `defineMithaq`'s `targets` (`drizzle`, `zod`, `service`, `tenant`, a screen).
- **capability**: the role a target plays: `store`, `schema`, `service`, `screen`, `access`, `storage`, `tenant` or `versions`.
- **step**: one function `(ctx, tools)` in an operation's list. Each list holds exactly one store or managed read step and whatever surrounds it.
- **tenant field**: the field `betterAuthTenant` binds. A kayan that places it belongs to one organization; a kayan without it is shared.

## Map

- `packages/mithaq/`: the core package: the language (`src/mithaq/`), the runner (`src/asas/runner/`), the CLI (`src/asas/cli/mithaq.ts`), the drizzle and zod targets, screens, storage, versions.
- `packages/mithaq-admin/`: the admin's pieces, which the apps import as `mithaq-admin/<file>` and a project ejects one by one. Read `packages/mithaq-admin/AGENTS.md` before you edit it.
- `packages/create-mithaq/`: the `bun create mithaq` starter.
- `templates/`: the template project that ships into every created project, and the worked example, in three steps: `templates/mithaq/` is the language (`@asas/mithaq`, with its Better Auth setup at `src/mithaq/auth/`), `templates/features/<feature>/` a package per feature holding its kayan, and `templates/asas/` the asas that builds them, where every `mithaq` command runs. `create-mithaq` lays them out under a project's `packages/`, or folds them into one package with `--layout single`. A new project is minimal, the `auth` and `tags` features, and takes add-ons (`roles`, `audit-log`, `settings`, `rich-text`, `uploads`, `media`, `courses`, `backoffice`) by `--with` or `--full`; the repository holds and builds every one. `create-mithaq` writes the organization mode, who may sign up and the one organization's name (`--organizations`, `--show-organization`, `--sign-up`, `--organization-name`, one organization by invitation by default) into `templates/mithaq/src/mithaq/auth/organizations.ts`. The repository's own copy holds `'many'`, the mode its suites boot; tests prove one, shown and not, through `serverFor` and `test:release`.
- `apps/`: the hosts (`asas-tanstack` for the tenant app, `asas-backoffice` for the backoffice console, `asas-next`), plus the repository's own scripts: `lint-args.ts`, `pack.ts`, `release.ts`, `release-consumer.ts` and the boot tests. `.github/workflows/` runs the checks and publishes releases.
- `LICENSES/`: notices for code mithaq adapts.
- `.claude/skills/ponytail/`: the skill behind `ponytail:` comments.
- `templates/asas/.claude/skills/`: the workflow skills a created project carries at its root (add a kayan, add a field, eject a piece, upgrade mithaq), which `@drhomet/mithaq` also ships under `skills/`. They are a project's, not this repository's.

## Checks

Bun 1.3 with its isolated linker and Node 24 or later. From the root:

```sh
bun install
bun run typecheck
bun run lint:args
bun run test             # needs DATABASE_URL
bun run test:tanstack    # builds and boots both TanStack apps
bun run test:next        # builds and boots the Next host
bun run pack             # stages the three published packages in .pack/
bun run test:release     # creates a project from .pack/ and runs it
```

`bun run test`, the boot tests and `test:release` need `DATABASE_URL` pointing at a local throwaway Postgres whose database is named `mithaq`, on any port except 5432 and 55439. `testDatabase` in `templates/asas/src/test-database.ts` refuses anything else, and the tests drop and rebuild that database.

From `templates/asas/`, with `DATABASE_URL` exported (the `mithaq` bin runs under Node and reads no `.env`):

```sh
bunx mithaq generate --check   # the lock, generated files, migrations, messages, screens
```

From `templates/mithaq/`, `apps/asas-tanstack/` and `apps/asas-backoffice/`, each of which holds files from mithaq-admin where its `components.json` says:

```sh
bunx mithaq upgrade --check    # the files a project holds from mithaq-admin against the package
```

Run the whole set before you call a change done.

## Rules

Mobile first: every screen is designed for the phone (390px) first and widened with min-width breakpoints (sm:, md:, lg:); max-* overrides only where no min-width form exists, each with a comment saying why.

- **Start every task the same way.** Load the `ponytail` skill (`.claude/skills/ponytail/`) and Matt Pocock's `tdd` skill, and follow both; an agent with the `caveman` skill loads it too. The repository does not ship `tdd`: a contributor installs it from [mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md), for example with `npx skills@latest add mattpocock/skills`. Copy Payload wherever it already does the thing: its shape and names first, its code when it is already the shortest correct version. When mithaq can do the same with less code, keep Payload's behaviour and write less. Review checks this.
- **The vocabulary is frozen.** The vocabulary of `defineMithaq` is its locales, kinds, rules, target names and capabilities, and root keys (`vocabularyOf` in `packages/mithaq/src/mithaq/lock.ts`). The template's, which holds every add-on, changes only with the owner's signed decision; `bun run test:release` checks it against the frozen hash. A created project's vocabulary is the template's less the words of the add-ons it left out (`rich-text` brings the `richText` kind, `uploads` the `upload` kind and the `storage` target), and its own `mithaq.lock` records its own words. When a task needs it changed, stop and tell the owner what and why. Never run `mithaq lock` without `--check`, and never edit a `mithaq.lock`. Everything in `defineKayan`, `defineGlobal` and `buildAsas` is free to change. In a project, `mithaq lock --check`, part of `mithaq generate --check`, fails on words the lock does not record.
- **Defaults are explicit.** Each default is named and the project spreads it (`{ ...defaultOperations, archive }`) or names it (`authorize: defaultAuthorize`). Most exports start with `default`; the target maps are `drizzleKinds`, `drizzleRules`, `drizzleIdKinds`, `zodKinds`, `zodRules` and `zodIdKinds`. Core never falls back to a behaviour of its own (`config.x ?? coreX`); `buildAsas` refuses a config that leaves a required default out. A default that holds policy or talks to the outside world is a registry file copied into the project. Review checks that core adds no fallback; the refusals `buildAsas` makes are tested in `templates/asas/src/asas.test.ts`.
- **One object for three or more parameters.** A function a project calls or implements takes one object once it has three or more parameters, or two of the same type whose order matters: `client({ kayan, operation, input })`. Steps keep `(ctx, tools)`. `bun run lint:args` checks the count; review checks the rest.
- **Comments say why.** Write the reason a line exists, never a restatement of what it does. A `ponytail:` comment marks a deliberate shortcut and names its ceiling and the upgrade. Review checks this.
- **Commits are one plain sentence** about what is now true, with no type prefix and no trailer: `The drizzle target names every compound index after its table and columns.` Review checks this.
- **Tenant enforcement stays in core.** The scope lives in `packages/mithaq/src/asas/runner/tenant.ts` and is ANDed onto every managed operation. Never add an option, flag or path that skips it. Read `packages/mithaq/src/asas/runner/AGENTS.md` before you touch the runner. `templates/asas/src/tenant-scope.test.ts` and `tenant-target.test.ts` prove it with a second organization, and every change to the runner adds a case there.
- **The backoffice has a host of its own.** It is served on its own subdomain (`backoffice.example.com` beside `app.example.com`), never mounted under a path of the customer app: browsers isolate scripts by origin and send cookies by host, so on one host a script flaw in the customer app would reach staff sessions. `templates/mithaq/src/mithaq/auth/index.ts` refuses to start when `BACKOFFICE_URL` and `BETTER_AUTH_URL` share an origin, or a host off this machine; never add a path-based mount or a way around that refusal. The Origin checks (`apps/asas-backoffice/src/routes/api/$.ts` against `BACKOFFICE_URL`, and Better Auth's) are the barrier between the two subdomains: every state-changing backoffice route keeps one. Test 142j in `templates/asas/src/asas.test.ts` proves the refusal, and test 78 in `apps/tanstack-boot.ts` (`bun run test:tanstack`) the Origin check.
- **Held files are ejected again.** The apps import every piece from `mithaq-admin`. The files they and `templates/mithaq/` hold from it (the screen host, storage, the mailers, the step, the directional icon) end with a `// mithaq-admin` marker. Edit the source in `packages/mithaq-admin/registry/` and eject it again; never edit a held file by hand. `mithaq upgrade --check` in `templates/mithaq`, `apps/asas-tanstack` and `apps/asas-backoffice`, and `packages/mithaq-admin/test/render.test.ts`, fail when a held file differs from its source.
- **An add-on is a table entry and regions.** `addOns` in `packages/create-mithaq/index.js` names each add-on, the add-ons it needs and the files that are its alone. A line only an add-on needs, in a file every project holds, sits between `// add-on: <name>` and `// end add-on: <name>`; a line that stands in for it sits commented between `// without add-on: <name>` and its end. `create-mithaq` keeps or drops each region and removes every marker. The language never imports an add-on outside its region. Only `rich-text` and `uploads` bring words of the language; every other add-on brings kayan and pages alone. `packages/create-mithaq/index.test.ts` refuses an unbalanced or misspelled marker and finds none left in a project, and `bun run test:release` builds and boots projects with and without add-ons.
- **Generated files are regenerated.** A file whose first line reads ``// Written by `mithaq <command>` `` comes from that command (`generate auth`, `generate screens`, `migrate`), as does each screen's `screen.json`. Rerun the command. The copy files in `src/messages/` are the exception: translations are edited by hand, and `generate messages` adds missing keys and rewrites flat files into nested form, keeping every translation. `mithaq generate --check` in `templates/asas` fails when a generated file differs from what its command writes.
- **Tests first.** Write the failing `node:test` test beside the code, watch it fail, then make it pass. Review checks this.
- **The docs stay true.** A link between two guides is relative and resolves; a snippet copied from a file of the repository carries `<!-- from: <path> -->` above its fence and is fixed in the guide when it drifts; a renamed name joins `retired` in `apps/docs.test.ts`. That test, in `bun run test`, checks all three (CONTRIBUTING.md, "Docs").
- **Security and data safety come before brevity**, and brevity before performance. Measure before optimizing. Review checks this.

## Docs

Start at `README.md`. Each guide is the `README.md` of the folder it describes:

- `templates/asas/README.md`: working in a created project, from getting started to production. It ships with the template, so its links to this repository are absolute.
- `packages/mithaq/README.md`: the language reference, and adding a rukn, a kind, a target or a configurable feature.
- `packages/mithaq/src/asas/cli/README.md`: the `mithaq` command.
- `packages/mithaq/src/asas/runner/README.md`: tenancy.
- `packages/mithaq/src/drizzle/README.md`: migrations in production.
- `packages/mithaq-admin/README.md`: the admin package, ejecting a piece, and migrating a project that holds copies.

Each of these guides also ships in `@drhomet/mithaq` under `docs/` at its repository path (`apps/pack.ts`), where a created project's agent reads it, so a link between two guides is relative and a link out of them is absolute.

`CONTRIBUTING.md` has the repository layout and the pull request steps. Keep each guide beside the code it describes.
