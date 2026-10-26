---
name: running-tests
description: Choose focused mithaq checks during implementation and run the release suite within the shared machine's memory and database limits.
---

# Running tests

During implementation, run tests covering changed files plus `bun --no-env-file run test:unit`. Keep existing assertions. The coordinator runs the full suite once per release, before publishing; a brief may assign that check to a builder.

For a database-free file, use `bun --no-env-file run test --unit path/to/changed.test.ts`. `--unit` supplies unreachable database URLs for modules that build declarations on import. For a database case, use `bun --no-env-file run test --workers 1 path/to/changed.test.ts` with the throwaway settings your brief names.

## Shared machine

Run your own checks when you need them. Close every emulator, server and browser you start once you are done with it.

Use only the throwaway database your brief names, never a protected one. Set `DATABASE_URL`, `DATABASE_URI`, `DATABASE_URI_V2` and `POSTGRES_URL` explicitly to the active database. Drop every database you create after checking. Supply settings directly instead of reading `.env`, `run.env` or credential files.

Protected ports are `55439`, `55480`, `5432`, `5433`, `5173`, `5174`, `5320` and `55620`. Hand a check requiring a protected resource to the coordinator.

## Release check

`bun --no-env-file run test` chooses two workers at 50% or more free memory, otherwise one; `--workers N` overrides the default. CI explicitly keeps Node's previous cores-minus-one parallelism.

For comparisons, use the same command, assertions and worker count on both sides. Record elapsed time and test counts, and change only the behavior being measured.
