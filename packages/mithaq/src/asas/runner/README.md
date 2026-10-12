# Tenancy

mithaq keeps each organization's rows apart. A kayan (an entity or collection)
whose fields include the organization field belongs to one organization per
row, and core holds every managed operation on it to the organization the
caller's session has active. A kayan without that field is shared by every
organization.

The organizations are Better Auth's: the `organization` kayan of the
provider's organization plugin, with its `member` rows. This page covers the
setup, what core enforces and why it cannot be turned off, how a read reaches
further, and what is refused. Read [the language reference](../../../README.md) first if the
words kayan, rukn, asas, target or operation are new.

## Setup

1. **Lay down the tenant target** in `defineMithaq`'s `targets`, under the key
   `tenant`:

   ```ts
   tenant: betterAuthTenant({
     relationTo: 'organization',
     onDelete: 'restrict',
     platform: ({ user }) => onPlatform() && platformRolesOf(user).length > 0,
   }),
   ```

   `relationTo` names the kayan an organization is. `onDelete: 'restrict'` is
   the only value it takes: an organization that still holds a row is not
   deleted. `platform` is optional; see [The platform app](#the-platform-app).

2. **Export the field.** The language returns the target as `targets: {
   tenant }`, and its `field` is what a kayan places. The template exports a
   labelled copy, under its own word for a tenant:

   ```ts
   export const { defineKayan, defineGlobal, buildAsas, rows, user, targets: { tenant } } = language

   export const organization = { ...tenant.field, label: { en: 'Organization', ar: 'المؤسسة' } }
   ```

3. **Build with one Better Auth kayan.** The provider's kayan (`user`,
   `organization`, `member` and the rest, written by `mithaq generate auth`)
   go in the `buildAsas` kayan list. A build with any per-organization kayan
   carries one Better Auth kayan, and a second is refused, because its sessions
   name the organizations the field points at.

4. **Lay down an access target** for roles per organization. The template's
   `rbacTarget` reads each member's roles from `memberRoles` and each
   organization's custom roles from `roles`, and both kayan place
   `organization`. `tenant: 'mine'` needs it.

5. **Place the field** in each kayan that belongs to an organization, then run
   `mithaq migrate` to add the column.

Where it lives: `packages/mithaq/src/auth/better-auth/tenant.ts`
`betterAuthTenant`; the template's setup is `templates/asas/src/mithaq.ts`
`serverTargets`.

## The field and its binding

A kayan is per-organization when it carries a field bound to the tenant target.
The binding is the field's `targets: { tenant: true }`, which `tenant.field`
already carries:

```ts
export const tags = defineKayan({
  name: 'tags',
  fields: {
    ...defaultFields,
    organization,
    name: { kind: 'text', label: { en: 'Name', ar: 'الاسم' }, rules: { required: true } },
  },
  targets: { service: { operations: defaultOperations } },
})
```

`tenant.field` is a relationship to one `organization` row with these rules:
`required`, `index`, `providedBy: { create: 'application', update: 'never' }`
and `onDelete: 'restrict'`. Its column is named after the field,
`organization_id` for a field called `organization`, with a foreign key that
restricts.

A field written by hand works too. It takes every rule of the target's field
that it leaves out:

```ts
organization: {
  kind: 'relationship',
  relationTo: 'organization',
  label: { en: 'Organization', ar: 'المؤسسة' },
  targets: { tenant: true },
},
```

A bound field may change its copy (label, description), add `unique`, and say
how a screen draws it under `targets.<screen>`. Nothing else about it can
change; see [What is refused](#what-is-refused).

A kayan that places no bound field is shared: every organization reads it
through its own access, and its rows belong to none. There is no per-kayan
opt-out and no list of per-organization kayan: the field alone decides. (A
kayan's `access: { tenant: false }` drops the row table it would inherit from
the access target. It does not touch the organization scope.)

## What core enforces

On every managed operation of a per-organization kayan, from the HTTP plugs,
from `asas.kayan.<name>.operations` in the app, and from a step's nested call,
core does all of this:

- **The scope is the session's active organization.** It is the
  `activeOrganizationId` of the actor's Better Auth session, from the build's
  one Better Auth kayan, and it counts only when the provider lists the actor as
  a member of that organization. Anything else has no scope: an anonymous
  caller, a local-auth account, a session with no active organization, a
  session naming an organization the actor is not a member of, and a session of
  another Better Auth instance. Each is refused with a 403 before any step runs.
  It fails closed: no scope never means no filter.
- **A create is filled from the scope.** The runner writes the field after the
  parse, from the session. A caller who sends the field is refused with a 400
  (`Unrecognized key`) before any step runs.
- **Reads, updates and deletes are ANDed with `organization = active`**, on
  top of whatever the kayan's access answers. This covers `find`, `findByID`,
  `count`, the row an update or delete loads, a bulk write's matched rows, a
  filter across a relationship to a per-organization kayan, and every level of
  `join` population.
- **Another organization's row answers like a missing one.** A read by id, an
  update and a delete of it are the same 404 (`error.not_found.row`) an absent
  id gets, so the answer never says the id exists.
- **The field never changes.** It is `providedBy: { update: 'never' }`. A
  step that writes it on an update, or writes another organization into it on a
  create, fails, so nothing moves a row to another organization.
- **References stay in the organization.** Every relationship and upload
  value a write names, single or `hasMany`, must point at a row the actor may
  read, and one that points at a per-organization kayan must name a row of the
  written row's organization. Another organization's row is refused with the
  same 400 an absent id gets.
- **Versions, uploads and globals are scoped.** A version is read and restored
  through its row's own access, and a snapshot never moves its row to another
  organization. An upload is signed for the active organization and served
  through the row's read. A global that places the field is one row per
  organization.
- **A step's raw store write is sealed.** `tools.store.insert` must name the
  active organization in the field, or it throws. `tools.store.update` and
  `tools.store.remove` are ANDed with `organization = active` and may not name
  the field. A relationship value a raw write names must point at the active
  organization's row. This holds whichever per-organization kayan the step
  names, not only the operation's own.

`ctx.tx` is the store's transaction itself. Raw SQL through it is the
project's own privileged path, which core does not scope; see
[Privileged paths](#privileged-paths).

### Why it cannot be bypassed

- The scope wraps the build's access evaluator, whichever one the service
  target names, and it is asked before the project's own callback. A row table,
  an access callback answering `true`, a custom `authorize` or a replaced step
  list can narrow what an operation reaches and never widen it.
- The organization comes from the trusted snapshot the auth strategy took of
  the session, not from the actor object. Changing `activeOrganizationId` on
  the object moves nothing.
- The only store a step is handed is the sealed one. `ctx.tx` is the raw way
  past it, and that is the project's own.
- A nested managed call runs under the scope of the call around it, and a read's
  reach is opened by the outermost read alone, so a call inside it cannot widen
  what it reaches.

Where it lives: `packages/mithaq/src/asas/runner/tenant.ts` `tenancy` (with
`scoped`, `sealWrites` and `activeTenant`), `writeTenant` there, and
`packages/mithaq/src/asas/runner/write.ts` `assertReferences`. The tests are
`templates/asas/src/tenant-scope.test.ts` and
`templates/asas/src/tenant-target.test.ts`.

## Reading further: `tenant: 'mine' | 'all'`

A read may ask to reach past the active organization with the `tenant` option.
In the app it is the second argument; over HTTP it is `?tenant=` on a read
route.

```ts
const page = await asas.kayan.courses.operations.find({ limit: 20 }, { actor, tenant: 'mine' })
```

```
POST /api/courses/find?tenant=mine
```

- **`'mine'`** reads every organization the actor is a verified member of. Each
  membership is judged under the roles the actor holds in that organization: a
  membership whose roles may not read the kayan adds nothing, and each row comes
  back cut to the fields that membership may read. A filter or a sort on a field
  any reached membership may not read is a 403. A membership whose roles fail to
  resolve holds no key, adds nothing, and the failure goes to `auth.onError`.
  It needs a Better Auth session and an access target; without either it is a
  403, and so is a read no membership may make.
- **`'all'`** reads every organization. Only platform staff in the trusted
  platform app may ask it: the actor must be an authenticated one and the
  target's `platform` callback must answer `true`. Anyone else gets a 403.

Both are for reads alone:

- A `where` on the organization field only narrows: `{ organization: { equals:
  'org2' } }` reaches org2 only where the reach already includes it.
- A write always lands in the active organization. A `tenant` option on a
  create, update, delete or bulk write is a 400 (`error.invalid.tenant_option`).
- A global refuses the option with the same 400: its read is the active
  organization's row.
- So does a build with no tenant target, and any value other than `'mine'` or
  `'all'`.

## The platform app

`'all'` is meant for an app that serves platform staff and nothing else. The
`platform` callback decides who that is, and the project decides which app is
trusted: the answer must come from the app's own facts, never from the request.

The template does it like this:

- `apps/asas-platform` runs every request it serves inside `asPlatform`, an
  `AsyncLocalStorage` that nothing a client sends can set. `onPlatform()`
  answers `true` there and nowhere else.
- Platform roles (`super_admin`, `support`, `explorer`) live on Better Auth's
  `user.role`, never in an organization's `memberRoles`. The template's
  `assignedRoles` answers them in the platform app alone, and the tenant app
  never answers them.
- `platform: ({ user }) => onPlatform() && platformRolesOf(user).length > 0`.
- The platform screen's reads of a kayan pass `tenant: 'all'`; a global's read
  and every write pass nothing.
- The rows give every platform role `read: true` and `false` for every write,
  so staff read every organization's rows and write none.

Where it lives: `templates/auth/src/index.ts` `asPlatform` and `onPlatform`;
`templates/asas/src/tenant-access.ts` `assignedRoles` and `platformReads`;
`apps/asas-platform/src/screens.tsx` `inProcess`.

## Unique values and indexes

On a per-organization kayan, a field's `unique: true` means unique within the
organization. Its default index is `(organization, field)`, so another
organization may hold the same value and never learns it is taken. On a shared
kayan the same rule is unique across the table.

A second row with a value the organization already holds is a 409
(`error.conflict.unique`) whose message and params name no value.

A kayan's `indexes` is a list, or a function of the defaults:

- Left out, the kayan gets the defaults: one unique index per `unique` field.
- A list is added to the defaults.
- `({ defaults }) => [...]` answers the whole list, so it can drop or replace a
  default.

A group expands to indexes led by the organization field:

```ts
indexes: [{ within: 'organization', unique: ['code', ['code', 'term']], index: ['startsAt'] }],
```

This builds unique `(organization, code)`, unique `(organization, code, term)`
and a plain index `(organization, startsAt)`. Each entry of `unique` and
`index` is a field or a list of fields. `within` must name the kayan's bound
field, and a group takes `within`, `unique` and `index` alone and names at
least one index.

A plain entry means exactly what it says. `{ fields: ['code'], unique: true }`
on a per-organization kayan is unique across every organization, on purpose:
use it for a value that must be unique everywhere.

```ts
indexes: ({ defaults }) => [
  ...defaults.filter((index) => !index.fields.includes('code')),
  { fields: ['code'], unique: true },
],
```

Two more rules hold:

- A `unique` field that no unique index covers is refused, so dropping a
  default without replacing it fails the build.
- A file kayan's storage `key` stays unique across the table, even on a
  per-organization kayan: a key is the address of one object in a store every
  organization shares.

Where it lives: `packages/mithaq/src/mithaq/resolve.ts`, the `indexes` handling
after `uniqueRuleIndexes`.

## Storage

A per-organization kayan that holds files keeps each organization's files
apart:

- `POST /api/<kayan>/uploadInstructions` asks the create access of the kayan
  under the scope, so an actor with no active organization is refused with a
  403.
- The upload reference is signed with the active organization. A create that
  sends a reference signed for another organization, another kayan or another
  hour is refused with a 400 (`error.invalid.upload_reference`).
- The storage config's `key` function is handed the organization. The
  template's `defaultKey` writes `<prefix>/<organization>/<kayan>/<id>/<filename>`,
  and `_` in place of the organization for a shared kayan.
- Every key must hold the row id as a whole path segment, and sit under the
  adapter's prefix where it has one, whatever the project's `key` function
  answers.
- `GET /api/<kayan>/file/<id>` reads the row through the kayan's own
  `findByID` as the actor, so another organization's file answers the same 404
  as an absent one.
- `public: true` is refused on a per-organization file kayan: a public address
  would hand one organization's file to anyone who has it.

A shared kayan's files belong to no organization, whichever session uploads
them.

Where it lives: `packages/mithaq/src/storage/storage.ts` `signReference`,
`checkReference` and `resolveStorage`; `templates/asas/src/storage/defaults.ts`
`defaultKey`.

## Globals

A global that places the bound field is one row per organization. Write the
field `unique` and `globalType` not unique:

```ts
export const settings = defineGlobal({
  name: 'settings',
  fields: {
    ...defaultFields,
    organization: { ...organization, rules: { ...organization.rules, unique: true } },
    siteTitle: { kind: 'text', label: { en: 'Site title', ar: 'عنوان الموقع' }, rules: { required: true } },
    globalType: { ...defaultGlobalFields.globalType, rules: { required: true } },
  },
  targets: { service: { operations: defaultGlobalOperations } },
})
```

- `findOne({}, { actor })` answers the active organization's row, or `null`
  before its first write.
- `update(data, { actor })` writes it, and the first update makes it.
- Two concurrent first writes of one organization make one row; the other is
  the 409 a unique value gets.
- With no active organization both are a 403, and a `tenant` option is a 400.

`buildAsas` refuses the field without `unique`, a `unique` `globalType`, and a
global that drops the unique index over the field alone. The template's global
is `templates/asas/src/settings/settings.ts` `settings`.

## What is refused

`buildAsas`, or the target itself, refuses each of these with a message that
names the fix:

- `onDelete` other than `'restrict'`. `cascade` would delete rows in the
  database, where no step runs and no file or audit follows them; `set null`
  would leave rows no organization owns or can read.
- Two bound fields in one kayan: a row belongs to one organization.
- A bound field where the language lays down no tenant target.
- A tenant target under any key but `tenant`, or another capability under
  `tenant`.
- A kayan that writes `targets.tenant` itself: the field decides, not the
  kayan.
- A store or schema target's entry on the bound field, such as
  `targets.drizzle`, which would build the column in place of the tenant's
  rules. A screen's entry is the only other one it takes.
- A bound field that loosens the binding: `hasMany`, another `relationTo`, a
  missing `required` or `index`, another `providedBy`, another `onDelete`, a
  `defaultValue`, or `targets.tenant` set to anything but `true`.
- A field that looks like the tenant field but is unbound: a relationship to
  the organization kayan filled by the application on create and never after,
  with no `targets.tenant`. This is what a spread of `tenant.field` with its own
  `targets` produces, and it would leave the kayan shared.
- A per-organization kayan with `auth`: an account is one identity across every
  organization, found by its email and tokens alone.
- More than one Better Auth kayan in a build with any per-organization kayan.
- `storage.public: true` on a per-organization file kayan.
- A per-organization global whose field is not `unique`, whose `globalType` is
  `unique`, or that drops the unique index over the field.
- A `within` group on a shared kayan, or within any field but the bound one.

At run time:

- A `tenant` option on a write or a global, or a value other than `'mine'` or
  `'all'`: 400.
- The bound field sent by a caller: 400.
- An actor with no verified active organization: 403.
- `'all'` from anyone but platform staff in the platform app: 403.

## What is not supported

- **Public sites per organization.** An anonymous caller has no organization, so
  every operation of a per-organization kayan refuses it. A public page reads a
  shared kayan, or reads through the project's own server code.
- **Writes across organizations.** A write lands in the active organization
  alone. To act in another organization, switch the session's active
  organization first.

## Privileged paths

Core scopes managed operations. These paths are not managed operations, and
whoever writes them scopes them:

- **Raw SQL through `ctx.tx`.** A step's `ctx.tx` is the store's own
  transaction, and a query through it sees every organization. Name the
  organization in the query yourself. The template's
  `templates/asas/src/member-roles/member-roles.ts` `managerRemains` does it:

  ```ts
  const tx = ctx.tx as NodePgDatabase
  await tx.execute(sql`select id, user_id as "user", role from member_roles where organization_id = ${tenant}`)
  ```

  Prefer a managed call, `tools.of(kayan)`, wherever one does the job: it
  carries the scope, the access and the transaction.
- **The store outside any operation**, such as `asas.targets.drizzle.db`. It
  reads and writes every organization.
- **Seeds.** The template's `templates/asas/src/seed.ts` writes every row
  through the build's own operations, with a real session whose active
  organization is the one it fills, so the scope applies as it does to a person.
  The few raw updates it makes name `organization_id` themselves.
- **Migrations.** `mithaq migrate` writes the migrations, and applying them
  runs outside the runner. A migration that moves data names the organization
  itself.
- **Commands.** `mithaq rbac assign --tenant <id> --user <id> --role <slug>`
  writes one assignment directly, after checking the user is a member of that
  organization. `mithaq storage sweep` reads every row of every file kayan to
  find objects no row names.
