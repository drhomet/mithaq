---
name: upgrade-mithaq
description: Upgrade this project to a newer mithaq and mithaq-admin. Use when asked to update or upgrade mithaq, or when the installed version is behind the one a task needs.
---

# Upgrade mithaq

1. Set `mithaq` and `mithaq-admin` to the same new version in every `package.json` that names them (`npm:@drhomet/mithaq@<version>` and `npm:@drhomet/mithaq-admin@<version>`), and install.
2. Read "Upgrading" in the new version's project guide, `node_modules/mithaq/docs/templates/asas/README.md`: it says what a project made before each round changes. Apply every note for the rounds since this project's version, in order. A note that changes the vocabulary or drops data needs the developer's word first.
3. Copy the new version's skills, `node_modules/mithaq/skills/`, over `.claude/skills/`.
4. Check, from `packages/asas/` with `DATABASE_URL` exported:

   ```sh
   bunx mithaq generate --check      # rerun generate auth, screens or messages as it says
   bunx mithaq migrate --check
   ```

5. Run `bunx mithaq upgrade --check` in each folder holding a `components.json`: `packages/mithaq`, `apps/asas-tanstack` and, when the project has it, `apps/asas-backoffice`. Each file it reports as `differs` came from mithaq-admin: diff it against the package's and merge by hand, keeping the project's own edits.
6. From the project root, `bunx tsc -p .` and each app's config, then build and start each app once.

In a project made with `--layout single`, read each path as `AGENTS.md` maps it.
