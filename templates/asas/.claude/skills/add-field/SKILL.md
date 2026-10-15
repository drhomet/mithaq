---
name: add-field
description: Add, change or remove a field of an existing kayan in this mithaq project and write the migration for it. Use when asked to add a column, change a field's kind or rules, or write a migration.
---

# Add a field and its migration

The guide is "A field" under "Add a feature to an existing kayan" in `README.md`, and "Migrations" in `AGENTS.md`. The installed mithaq is `packages/asas/node_modules/mithaq/`, or `node_modules/mithaq/` where the package manager hoists it to the root: every kind and rule is in its `docs/packages/mithaq/README.md`, and `mithaq migrate` in its `docs/packages/mithaq/src/asas/cli/README.md`.

1. Edit `fields` in the kayan's file. A kind or rule the language does not hold changes the vocabulary: stop and ask the developer.
2. A new `required` field on a table with rows needs a literal `defaultValue`, or goes in without `required` and becomes required in a later migration.
3. Add the field to the pages that should draw it, and to the roles' grants when they list fields one by one (`<kayan>.fields.<field>`).
4. From `packages/asas/`, with `DATABASE_URL` pointing at a database built from the migrations (never a pushed one; `AGENTS.md` "Migrations" says how to build one):

   ```sh
   bunx mithaq generate screens      # when a page draws it
   bunx mithaq generate messages     # then fill every empty translation
   bunx mithaq migrate --name <slug>
   bunx mithaq generate --check
   ```

5. When `mithaq migrate` stops and asks for an answer in `mithaq.hints.json`, it is a rename or a drop. A drop deletes rows: ask the developer before you answer it.
6. From the project root, `bunx --package typescript tsc -p .` and the same with `-p` naming each app.

Commit the migration folder.

In a project made with `--layout single`, read each path as `AGENTS.md` maps it; the installed mithaq is `node_modules/mithaq/`.
