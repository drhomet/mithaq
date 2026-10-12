# mithaq-admin, the registry

This package is a shadcn registry. A project copies its items into its own source and owns the copies from then on. The admin screens, the screen host, the storage adapters and the `expectedUpdatedAt` step all reach projects this way. `README.md` beside this file is the user guide to the registry.

## Layout

- `registry.json` lists every item: its files, each file's `target` in the project, and its dependencies.
- `registry/` holds the source of every item. `registry/ui`, `registry/lib` and `registry/hooks` are shadcn's own primitives the items build on; they are not published.
- `r/` is the built registry. It is not committed. `bun install` builds it through the `prepare` script.
- `test/` renders the items under happy-dom and checks the copies.

## Changing an item

1. Edit the source in `registry/`, never a copy.
2. Rebuild `r/`: `bun run --cwd packages/mithaq-admin build`. The build runs `shadcn build` and then `mark`, from `packages/mithaq/src/asas/cli/upgrade.ts`, which appends a marker as the last line of every file: `// mithaq-admin <commit> <hash>`. The hash is the SHA-256 of the text without its leading comments, which `shadcn add` drops.
3. Copy the item again into every folder that holds it, with the pinned shadcn 4.18.0, from that folder: `shadcn add ./node_modules/mithaq-admin/r/<item>.json --overwrite --yes`. The screen items live in `apps/asas-tanstack/` and `apps/asas-platform/`. `mithaq-storage` and `mithaq-expected-updated-at` live in `templates/asas/`.
4. Run `bun run test`. `test/render.test.ts` fails when a copy's text or marker differs from its source, and `apps/screens-host.test.ts` rebuilds each app from the host item.

Never hand-edit a copy in this repository. A user's project may edit its copies; here they must equal the source.

## Dependencies between items

Inside this repository an item names a sibling by its install path, `./node_modules/mithaq-admin/r/<item>.json`. `apps/pack.ts` rewrites each one to `@mithaq/<item>`, which a created project's `components.json` resolves from the published package on jsDelivr. A bare name means shadcn's own registry, and `pack.ts` refuses a name missing from its `shadcnServes` list. Add a name there only after `shadcn add @mithaq/mithaq-screens-host --dry-run` resolves it.

## upgrade --check

`mithaq upgrade --check`, run in a project, reads each copy's marker and compares it with the installed registry. It reports each file as `up to date`, `up to date, edited`, `differs`, `differs, edited`, `unknown`, `outside` or `removed`. It only reads, and answers 1 when any copy differs. Inside `mithaq generate --check` it is a report and never fails the sweep, because a copy that differs is a file the project owns. Keep marker changes compatible with copies made by older builds.
