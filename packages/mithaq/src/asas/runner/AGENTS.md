# The runner

Every managed read and write runs here. Tenant isolation is enforced here, and nothing outside this folder can turn it off. `README.md` beside this file is the user guide to tenancy; keep it true when the rules change.

## Tenant enforcement

`tenancy` in `tenant.ts` returns the pieces `build.ts` wires in:

- `scoped` wraps the build's `authorize`. On a kayan that places the tenant field it asks for the active organization first, then ANDs `{ [field]: { equals: org } }` onto whatever the project's access answers. Reads, updates and deletes all go through it. A create takes no `where` from it, because `writeTenant` already set the field from the session.
- `active` is the organization of the trusted Better Auth session from the build's one Better Auth kayan, and only when the session lists the actor as a member of it. Anything else answers nothing, and a tenant-owned kayan refuses that actor. It fails closed.
- `writeTenant` and `refuseTenantOption` run before any step. The first refuses a caller's own value for the field, the second a `tenant` option on a write.
- `sealWrites` wraps the `tools.store` a step is handed. A raw `insert` must carry the active organization, and `update` and `remove` are ANDed with it and may never name the field. References are checked to stay in the same organization.
- `open` reads a read's `tenant: 'mine' | 'all'` option. `'mine'` covers every verified membership, each judged under that organization's roles. `'all'` is only for the tenant target's `platform` check, and only for reads.

Keep it that way:

- Every new managed path goes through `scoped` and `sealWrites`. A new option, flag, context key or code path that skips them is a security bug, whatever it is for.
- A row of another organization answers exactly like a missing row: the same 404, key and message. The load uses the scoped `where`, so the row is simply not found. Never return a 403 or a message that tells a caller the row exists.
- The tenant field never changes after the row is made, and a caller never sets it.
- `ctx.tx` is the project's own privileged path for raw SQL. Core does not scope it, and core never uses it to bypass the scope itself.
- Add a test in `templates/asas/src/tenant-scope.test.ts` or `tenant-target.test.ts` for any change here, with a second organization that must not see or change the first one's rows.

## Write order

`write.ts`, for one write:

1. The depth cap and the id shape, then the tenant checks above, before any step.
2. Access: the kayan's access answer and the operation's permission key, under `scoped`.
3. `beforeTransaction`, outside the transaction. No row is loaded and no lock is held.
4. The transaction opens. The existing row loads under the scoped access `where`.
5. Field access, then the parse, with `defaults` filling values. On a create the tenant field is filled from the session after the parse.
6. `beforeSteps`, the operation's own list (exactly one store step), then `afterSteps`, where `audit` runs. All of them run inside the transaction through `ctx.tx`.
7. The commit, then `afterCommit`. A throw there leaves the write standing and answers `AfterCommitError`.

A nested write through `tools.of(kayan)` or `tools.kayans` joins the outer transaction, and its `afterCommit` waits for the outer commit.

## Refusals

Refuse through `denied`, `invalid`, `missing` and `conflict` from `errors.ts`, each with a message and a copy `key`, so a screen can translate it.

A delete that removes its row asks `refuseReferenced` first, in its transaction: every field of every kayan whose `onDelete` is `restrict`, a set's unless it says `cascade`, over live rows and each row's latest version. It counts every row naming the deleted one and titles only those the actor reads, through `authorize`, so the count is all it says of rows past the scope. A soft delete keeps its row and is not asked.
