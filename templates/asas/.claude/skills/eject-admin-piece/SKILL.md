---
name: eject-admin-piece
description: Change how the admin draws something in this mithaq project, by replacing a control, cell or node in the components map or by ejecting a mithaq-admin piece. Use when asked to restyle or change an admin control, list, form, shell or page piece.
---

# Change an admin piece

The installed mithaq is `packages/asas/node_modules/mithaq/`, or `node_modules/mithaq/` where the package manager hoists it to the root. The guide is the admin's, its `docs/packages/mithaq-admin/README.md` ("Add or replace a control", "Replace a node", "Eject a piece"), and `eject` in its `docs/packages/mithaq/src/asas/cli/README.md`.

1. Reach for the components map first: a control, a cell or a node is replaced in the app's `src/components.ts` without ejecting anything.
2. Otherwise eject the piece, in the app that draws it (`apps/asas-tanstack` or `apps/asas-backoffice`):

   ```sh
   bunx mithaq eject <item>          # an unknown name lists every item
   ```

   It writes the piece into `src/components/mithaq/`, drawn in place of the package's, and names any shadcn primitive or npm package to add. Restart the dev server.
3. Edit the ejected file in place; it is the project's now. Keep its last line, the `// mithaq-admin` marker, which `upgrade --check` reads.
4. Check, in the app:

   ```sh
   bunx mithaq upgrade --check       # the held files against the installed mithaq-admin
   bunx --package typescript tsc -p .
   ```

To go back to the package's piece, delete the file, or run `bunx mithaq eject --prune`, which deletes every ejected file nobody edited.

In a project made with `--layout single`, read each path as `AGENTS.md` maps it; the installed mithaq is `node_modules/mithaq/`.
