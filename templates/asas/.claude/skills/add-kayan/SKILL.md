---
name: add-kayan
description: Add a kayan, one data type with its table, operations, access and admin pages, to this mithaq project. Use when asked for a new entity, table, resource or list in the dashboard.
---

# Add a kayan

The steps are "Adding a kayan" in `AGENTS.md`. The guide's worked example is "Add a kayan" in `README.md`; the guides of the installed version are in `node_modules/mithaq/docs/`, as `AGENTS.md` says, where `packages/mithaq/README.md` lists every kind and rule a field can take.

1. Ask, unless the request says: does each row belong to one organization (place `organization`, the usual answer) or does every organization share it?
2. Follow `AGENTS.md` "Adding a kayan", copying `packages/features/tags/`. Use only the kinds and rules the language holds; a new one changes the vocabulary, so stop and ask the developer.
3. Grant its keys to the roles that use it, as step 4 there says. A kayan no role is granted answers no one.
4. From `packages/asas/`, with `DATABASE_URL` exported:

   ```sh
   bunx mithaq generate screens      # when a screen draws it
   bunx mithaq generate messages     # then fill every empty translation
   bunx mithaq migrate --name add_<name>
   bunx mithaq generate --check
   ```

5. From the project root, `bunx tsc -p .` and `bunx tsc -p apps/asas-tanstack` (and `apps/asas-backoffice` when the project has it).

Commit the migration folder. Never edit a file whose first line reads ``// Written by `mithaq <command>` ``; run the command again.

In a project made with `--layout single`, read each path as `AGENTS.md` maps it.
