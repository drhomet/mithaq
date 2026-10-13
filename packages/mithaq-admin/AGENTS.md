# mithaq-admin, the admin package

This package ships the admin's pieces as TSX source, published as `@drhomet/mithaq-admin` and installed by projects under the name `mithaq-admin`. An app imports each piece as `mithaq-admin/<file>` and compiles it against its own shadcn primitives. A project holds a piece only when it ejects it (`mithaq eject <item>`), and always holds the screen host, the storage adapters and defaults, the `expectedUpdatedAt` step and the directional icon. `README.md` beside this file is the user guide.

## Layout

- `registry.json` lists every item: its files, each file's `target` in a project, the shadcn primitives it imports (`registryDependencies`) and the npm packages it alone needs (`dependencies`). `mithaq eject` and `mithaq upgrade --check` read it from the installed package.
- `registry/` holds the source of every item. `registry/ui`, `registry/lib` and `registry/hooks` are shadcn's own primitives the pieces build on, for this package's typecheck and tests; they are not published, except `ui/directional-icon.tsx`, which an item names.
- `source.css` points Tailwind at `registry/`, which it never scans inside `node_modules`.
- `test/` renders the pieces under happy-dom and checks the files the apps hold.

## Changing a piece

1. Edit the source in `registry/`. A piece imports a sibling as `mithaq-admin/<file>`, never by a relative path, so a project's ejected copy of the sibling is drawn in its place.
2. Run `bun run test`. The apps import the pieces from this package, so they draw the change at once.
3. A file the apps or the template always hold (`registry/host/`, `registry/storage/`, `registry/steps/`, `registry/ui/directional-icon.tsx`) is ejected again where it lives: delete the old file and run `node ../../packages/mithaq/src/asas/cli/mithaq.ts eject <item>` in `apps/asas-tanstack`, `apps/asas-platform` (the host, less the files it deleted) or `templates/asas` (storage and the step). `test/render.test.ts` fails when one differs from its source, and `apps/screens-host.test.ts` rebuilds each app from the host item.

Never hand-edit a file the apps or the template hold from this package. A user's project may edit its own; here they must equal the source.

## Publishing

`apps/pack.ts` stages `.pack/mithaq-admin/` with the registry less shadcn's own primitives, `registry.json`, `source.css`, this README and the licenses, at the version of `mithaq`. Every library a piece imports is a peer dependency in `package.json`; a store layout links only peers beside the package. Publish it before `create-mithaq`, which pins it.

## upgrade --check

`mithaq upgrade --check`, run in a project, reads each held file's marker and compares it with the installed package. It reports each file as `up to date`, `up to date, edited`, `differs`, `differs, edited`, `unknown`, `outside` or `removed`. It only reads, and answers 1 when any file differs. Inside `mithaq generate --check` it is a report and never fails the sweep, because a file that differs is a file the project owns. Markers made by `shadcn add` before the package (`// mithaq-admin <commit> <hash>`) stay valid: keep `hashOf` compatible with them.
