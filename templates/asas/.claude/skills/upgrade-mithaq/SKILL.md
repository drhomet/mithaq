---
name: upgrade-mithaq
description: Upgrade this project to a newer mithaq and mithaq-admin. Use when asked to update or upgrade mithaq, or when the installed version is behind the one a task needs.
---

# Upgrade mithaq

Run each command from the project root. The installed mithaq, `$M` below, is `packages/asas/node_modules/mithaq/`, or `node_modules/mithaq/` where the package manager hoists it to the root, as in a project made with `--layout single`; each block finds it first.

1. Before you install, save the developer's own edits to the skills this version shipped. Skip this when `$M/skills` does not exist: that version shipped none.

   ```sh
   M=packages/asas/node_modules/mithaq; [ -d "$M" ] || M=node_modules/mithaq
   ls "$M/skills" > /tmp/mithaq-shipped-skills
   for skill in $(cat /tmp/mithaq-shipped-skills); do diff -ru "$M/skills/$skill" ".claude/skills/$skill"; done > /tmp/mithaq-skill-edits.diff
   ```

2. Set `mithaq` and `mithaq-admin` to the same new version in every `package.json` that names them (`npm:@drhomet/mithaq@<version>` and `npm:@drhomet/mithaq-admin@<version>`), and install.
3. Read "Upgrading" in the new version's project guide, `$M/docs/templates/asas/README.md`: it says what a project made before each round changes. Apply every note for the rounds since this project's version, in order. A note that changes the vocabulary or drops data needs the developer's word first.
4. Replace the shipped skills with the new version's. A skill the old version shipped and the new one does not is deleted; a skill the developer wrote, which no version shipped, is left alone.

   ```sh
   M=packages/asas/node_modules/mithaq; [ -d "$M" ] || M=node_modules/mithaq
   for skill in $(cat /tmp/mithaq-shipped-skills 2>/dev/null); do rm -rf ".claude/skills/$skill"; done
   mkdir -p .claude/skills && cp -R "$M/skills/." .claude/skills/
   git status --short -- .claude/skills
   git diff -- .claude/skills
   ```

   Then put back each of the developer's edits in `/tmp/mithaq-skill-edits.diff` that the new text lost, and ask the developer where an edit no longer fits the new text.
5. From `packages/asas/`, with `DATABASE_URL` exported, run `bunx mithaq generate --check`. It also checks the lock and the migrations; rerun `generate auth`, `screens` or `messages` as it says.
6. Run `bunx mithaq upgrade --check` in each folder holding a `components.json`: `packages/mithaq`, `apps/asas-tanstack` and, when the project has it, `apps/asas-backoffice`. Each file it reports as `differs` came from mithaq-admin: diff it against the package's and merge by hand, keeping the project's own edits.
   For 0.3.3, merge the held auth forms and shared `AuthForm` in both hosts, including both ChoosePassword routes and setup-code branches. Installing dependencies does not rewrite them. Fix every `unsafe form` report and audit custom or renamed auth forms too. Passwords, setup codes and personal values need native POST before hydration and with JavaScript disabled. Preserve the project's handlers and server protections. Follow the mithaq-admin README's 0.3.3 upgrade note, including its private exposure assessment; never ask anyone to paste credential-bearing URLs or logs.
7. From the project root, `bunx --package typescript tsc -p .` and the same with `-p` naming each app, then build and start each app once.

In a project made with `--layout single`, read each path as `AGENTS.md` maps it.
