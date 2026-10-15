---
name: tdd
description: Test first in the mithaq repository. Use on every change to behaviour, a feature or a bug fix, before writing the code that makes it work.
---

# Test first

1. Write one `node:test` test beside the code it proves (`<file>.test.ts`; a template or runner change goes in `templates/asas/src/`, as the nearest `AGENTS.md` says). Assert through the public seam: an operation, a command, `create()`, a request to an app. Take expected values from the spec or a worked example, never from the code under test.
2. Run it alone and watch it fail for the reason you expect: `node --test <file>`, with `DATABASE_URL` set for a test that needs Postgres (see "Checks" in the root `AGENTS.md`). A test that passes before the change proves nothing.
3. Write the least code that makes it pass, and run it again.
4. Repeat, one test and one change at a time. Refactor only once the tests are green.
5. Before calling the change done, run the whole set under "Checks" in the root `AGENTS.md`.
