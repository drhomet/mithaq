# The mithaq language

This page is the mental model of mithaq, in the order you need it. Each section
gives a short definition, a small example taken from the template, and a pointer
to the code. Paths are relative to the repository root; a pointer names a file
and, in backticks, the symbol or a short fragment to search for.

Three Arabic words name the main parts:

- **kayan** (plural the same): an entity or collection, such as `courses`.
- **rukn** (plural **arkan**): a pillar, a pluggable part that brings kinds,
  rules or targets.
- **asas**: the foundation, the runtime that `buildAsas` builds from your kayan.

If you have not made a project yet, start with
[Getting started](../../templates/asas/README.md#getting-started). Tenancy has its own page,
[Tenancy](src/asas/runner/README.md).

## The language

The language is the one object a project hands to `defineMithaq` in
`src/mithaq.ts`. It names the locales, the arkan and the targets. Everything
else in the project is written in its words.

```ts
const language = defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan: [base, richText({ nodes: richTextNodes }), files, versions({ max: 100 })],
  targets: {
    drizzle: drizzleStore,
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    rbac: accessTarget(),
    tenant: betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', newRows: 'active', organizations: 'many' }),
    service: serviceTarget({ /* ... */ }),
    dashboard: dashboardScreen,
  },
  // Each path is from the folder every mithaq command runs in, the asas's.
  generate: { language: '@asas/mithaq', features: '../features/', auth: '../features/auth/', providers: '@asas/mithaq/auth', messages: 'src/messages/', migrations: 'src/migrations/', screens: { /* ... */ } },
})

export const { defineKayan, defineGlobal, buildAsas, rows, user, targets: { tenant } } = language
```

Where it lives: `packages/mithaq/src/mithaq/language.ts` `defineMithaq`; the
template's language is `templates/mithaq/src/mithaq.ts`.

### Root keys

- `locales`: every locale the project's copy is written in. Each label then
  needs one string per locale, so a half-translated project fails to compile.
  mithaq never picks a locale itself.
- `arkan`: the pillars the kinds, rules and some targets come from. Kinds and
  rules come from arkan alone: a `kinds` or `rules` key at the root is refused.
- `targets`: one entry per target, by the name the project gives it. A
  target's name is how a kayan addresses it (`targets.dashboard`,
  `targets.versions`).
- Any other key, such as `generate`, is the project's own. mithaq passes it
  through typed, and the generators read `generate` to find where to write.

The service target's own keys (`beforeSteps`, `authorize`, `softDelete`,
`store`, `schema` and the rest) are refused at the root, by name, and so is
`operations`: each kayan declares its own.

A caller's `where` lists at most 1000 values in one `in` or `not_in`, and
holds at most 200 fields, `and`s and `or`s however nested; past either it is
refused 400 before the store is asked. An access callback's `where` is the
project's own and is not held to them.

### What it returns

`defineMithaq` returns the language's own keys (`locales`, `kinds`, `rules`,
`targets` and the rest) and five functions bound to the language:

- `defineKayan`, which declares a kayan in this language's kinds and rules;
- `defineGlobal`, which declares a kayan of one row;
- `buildAsas`, which builds the runtime;
- `rows`, which compiles an access row table, with its role keys checked
  against the access target's roles;
- `user`, which writes a reference to a key of the actor, such as `user.id`,
  checked against the actor the access target reads.

A kayan is checked against the language it was declared in: a kind the arkan
do not bring, a rule its kind does not accept, or a label missing a locale is a
type error.

### The frozen vocabulary

The vocabulary of `defineMithaq` is its locales, the kinds (each one's label,
message and accepted rules), the rules (each one's message and excludes), the
targets (each one's name and capability) and the list of root keys. It changes
only with the project owner's signed decision.

`mithaq.lock` records that vocabulary as plain data, with a signature. `mithaq
lock` writes and signs it; it signs only when a person types back a code shown
in a popup, never in the command's own output. `mithaq lock --check`, and
`mithaq generate --check` as its first step, fail when the vocabulary no longer
matches the lock or the seal does not verify.

The lock is optional. A project without `mithaq.lock` passes `mithaq lock
--check` with a notice, and `mithaq lock` locks it.

Everything outside that vocabulary is free to change: every `defineKayan`,
`defineGlobal` and `buildAsas` call, and the rest of `defineMithaq` (screen
pages, a screen's kayan list, shells, components, roles, steps and `generate`
paths).

Where it lives: `packages/mithaq/src/mithaq/lock.ts` `vocabularyOf` and
`checkLock`. The commands are in [The `mithaq` command](src/asas/cli/README.md).

## Arkan

A rukn is one pillar of capability: some kinds, some rules, some targets, and
the capabilities it needs from other targets. Two arkan may not bring the same
kind, rule or target, and a rukn's target may not share a name with one the
project lays down; `buildAsas` names both sides of the clash.

```ts
export const slugs = defineRukn({
  name: 'slugs',
  rules: {
    slug: rule<boolean>({
      accepts: (value): value is boolean => typeof value === 'boolean',
      message: { en: 'This is not a slug.', ar: 'هذا ليس معرفا نصيا.' },
    }),
  },
})
```

Where it lives: `packages/mithaq/src/mithaq/rukn.ts` `defineRukn` and
`composeArkan`. A rukn of your own, and the target maps it needs, are covered in
[Add a rukn](#add-a-rukn).

### The shipped arkan

- **`base`**: the shipped kinds and rules, listed below. Every project lays it
  down first. `packages/mithaq/src/base/index.ts` `base`.
- **`richText({ nodes })`**: the `richText` kind, a Lexical tree checked
  against the project's own node list. It can be searched and is never sorted.
  It is imported from `mithaq/rich-text`, the one entry that loads Lexical, so a
  project that uses it installs `lexical`, `@lexical/extension`, `@lexical/link`,
  `@lexical/list` and `@lexical/rich-text` (mithaq's optional peers) and a project
  without it installs none. `packages/mithaq/src/rich-text/index.ts` `richText`.
- **`storage(config)`**: the `upload` kind, a relationship drawn as a file
  picker, and the `storage` target over the project's config. The config holds
  the signing secret, so the module that builds the language stays on the
  server. `packages/mithaq/src/storage/index.ts` `storage`.
- **`versions({ max })`**: the `versions` target. A kayan that writes
  `targets.versions` keeps up to `max` past copies of each row, or its own
  window, and may keep drafts. It needs a target of capability `store`.
  `packages/mithaq/src/versions/index.ts` `versions`.

The fields a kayan spreads to use them ship beside each one: `uploadFields` for
a kayan that holds files, `draftFields` (the `_status` field) and
`versionOperations` for a kayan that keeps drafts and versions.

## Kinds and rules

A kind is what a field holds: its value's type, the label and message a person
reads, and the rules it accepts. A rule is a constraint or a behaviour a field
switches on in `rules`.

<!-- from: templates/features/courses/courses/courses.ts -->
```ts
title: {
  kind: 'text',
  label: { en: 'Title', ar: 'العنوان' },
  rules: { required: true, trim: true, maxLength: 120, index: true },
},
```

### Kinds

From `base` (`packages/mithaq/src/base/kinds.ts` `defaultKinds`):

- `text`: a string.
- `email`: a string written as an email address.
- `number`: a JavaScript number.
- `integer`: a whole number in Postgres `integer` range.
- `decimal`: a decimal number carried as text, so money never rounds.
- `checkbox`: `true` or `false`.
- `datetime`: a moment, as a `Date`.
- `date`: a calendar day, as an ISO string such as `2026-02-28`.
- `textArray`: a list of strings.
- `uuid`: a uuid string; also the kind of the shipped `id`.
- `relationship`: the id of one row of another kayan, or a set of ids with
  `hasMany: true`. Without `onDelete` it restricts: a row a live row or a row's
  latest draft still names is not deleted, and the refusal counts those rows and
  names by title the ones the caller finds and whose title it reads. A title
  that is itself a relationship is never sent, and a `date` or `datetime` title
  is marked `titleKind` for the screen to format. A person a restricting
  relationship names is not removed by Better Auth's delete routes either: the
  build hands the provider `referenced(id)`, which counts those rows first.
  `filterOptions: ({ user, tx }) => Where | boolean`
  narrows what its picker offers, as Payload's does: the picker reads `for`
  the field and the server ANDs the answer beside the target's own read, so it
  never widens it. A create or an update is held to the same answer, refused
  in the words a missing row gets, and is handed its transaction as `tx`.
- `join`: the rows of another kayan whose `on` relationship points back at
  this row. It builds no column; a read populates it through the child kayan's
  own access.
- `json`: any JSON value, Payload's json field. It is a `jsonb` column holding
  the value itself, so a row Payload wrote reads back unchanged and Payload
  reads what mithaq writes; Postgres keeps no key order and one copy of a
  repeated key. Its rules are `required`, `defaultValue` and `providedBy`.
  Every json field names `maxBytes`, the most UTF-8 bytes its value's JSON
  text may hold: `defaultJsonMaxBytes` (1,000,000 bytes) or a number of its
  own.
  `jsonSchema` checks each written value against a JSON Schema, as Payload's
  does:

  ```ts
  meta: {
    kind: 'json',
    label: { en: 'Metadata', ar: 'البيانات الوصفية' },
    maxBytes: defaultJsonMaxBytes,
    jsonSchema: {
      uri: 'a://b/meta.json',
      fileMatch: ['a://b/meta.json'],
      schema: { type: 'object', properties: { size: { type: 'integer', minimum: 0 } }, required: ['size'] },
    },
  },
  ```

  A value JSON cannot say (`undefined`, `NaN`, a `Date`, a function, a cycle),
  one nested past 64 levels, and a string or key holding a NUL or half a
  surrogate pair, which Postgres cannot store, are refused 400. The schema is
  held in the field and never fetched from its `uri`. It is checked with Ajv,
  as draft 2020-12, or as draft-07 where `$schema` names it, with or without
  its trailing `#`. A keyword, a format or a reference Ajv cannot check is
  refused at build rather than skipped, and so is a `defaultValue` the
  field's own schema or `maxBytes` refuses. Rows stored before a schema was
  added still read; their next save is held to it.

  A schema's `pattern` runs as JavaScript's own `RegExp`, on the server, over
  each value a writer sends. A pattern that backtracks without end on some
  input, such as `^(a+)+$`, holds the server for as long as it runs, so write
  patterns that cannot.

  A query names a path into the value with dots, `{ 'meta.size': { equals: 3 } }`,
  each segment a key, and a list met at any segment, a list inside a list
  included, is matched by any of its entries, as Payload's `$.a[*].b[*]` is.
  It takes `equals`, `not_equals`, `in`, `not_in`, `exists`, `like` and
  `contains`, each compared with a string, a number, a boolean or `null`. The
  field's read access covers every path into it, and a path that reaches a
  json field across a relationship is refused. Nothing orders by one. The
  admin draws it as a left-to-right JSON text box, and a row's cell as one
  line of it.

  Where mithaq departs from Payload:

  - A JSON `null` is no value, as a missing key is: `exists: false` and
    `equals: null` match both, where Payload's `exists` finds a `null`.
  - `not_equals` and `not_in` hold where the path holds a value and no entry
    of it equals one named, so a list holding the value does not match.
    Payload's holds where any entry differs.
  - An empty `{}` or `[]` is checked against the schema; Payload skips it.
  - A draft-04 schema is refused at build; Payload reads one.
  - `contains` is a substring and `like` every word of it, both ignoring
    case, over each entry as text: a string without its quotes, and an object
    or a list as its JSON. Payload's `like` is a regular expression.

From the other arkan:

- `richText` (`richText` rukn): a rich text tree.
- `upload` (`storage` rukn): one row of a kayan that holds files. A file a row
  still names is never deleted from under it.

### Rules

From `base` (`packages/mithaq/src/base/rules.ts` `defaultRules`):

- `required`: the value must be there.
- `unique`: no two rows hold the same value. On a per-organization kayan that
  means within the organization; see [Tenancy](src/asas/runner/README.md).
- `index`: the column is indexed.
- `defaultValue`: a literal, JSON for a `json` field, or a reference such as
  `user.id` to the actor's value. Excludes `defaultNow`.
- `defaultNow`: the moment of the write, on create.
- `nowOnUpdate`: the moment of the write, on every update.
- `providedBy`: who supplies the value on `create` and on `update`: `client`,
  `application` or `never`. A field that declares nothing is the client's.
- `localized`: one value per locale, stored as one column per locale.
- `maxLength`, `minLength`: the length of a string.
- `pattern`: a `RegExp` the string must match.
- `min`, `max`: bounds on a number, or on an ISO day for `date`.
- `precision`, `scale`: a decimal's size, declared together.
- `minRows`, `maxRows`: how few and how many entries a list holds.
- `uppercase`, `lowercase`, `trim`: rewrite the value before it is checked.
- `onDelete`: what happens to this row when the row it points at is deleted:
  `restrict`, the default of `relationship` and `upload`, `cascade` or `set null`.
  A set takes `restrict` or `cascade`, since its join row holds no null.

Each kind lists the rules it accepts; a rule a kind does not accept is a type
error on the field.

## Kayan and globals

### `defineKayan`

A kayan is declared once, as data, and every target derives its part from that
declaration: the table, the validation shapes, the operations and the screens.

<!-- from: templates/features/tags/tags/tags.ts -->
```ts
export const tags = defineKayan({
  name: 'tags',
  messages: {
    singular: { en: 'Tag', ar: 'وسم' },
    plural: { en: 'Tags', ar: 'الوسوم' },
  },
  targets: {
    // ...
    dashboard: {
      useAsTitle: 'name',
      // ...
    },
    service: {
      operations: ({ defaults }) => ({
        ...defaults,
        // ...
      }),
    },
  },
  fields: {
    ...defaultFields,
    organization,
    name: {
      kind: 'text',
      label: { en: 'Name', ar: 'الاسم' },
      rules: { localized: true, required: true, trim: true, maxLength: 60, index: true },
    },
  },
})
```

Where it lives: `packages/mithaq/src/mithaq/define.ts` `defineKayan`; the
example is `templates/features/tags/tags/tags.ts`.

**Fields.** The key order of `fields` is the column order. Each field names a
`kind`, a `label` in every locale, and its `rules`. It may also carry a
`description`, a `placeholder`, a `prefix` and `suffix`, `options` (the closed
list a text field's value is one of), `access` for the field, a `dbName`, and
`targets.<name>` for what one target says about it. A store's or schema
target's entry under `targets` replaces what that target would derive; a
screen's entry says how the field is drawn.

**Default fields.** A project spreads its id and timestamps; nothing is merged
in for it.

- `defaultIdField`: `id`, a uuid Postgres fills when a create leaves it out.
- `defaultTimestampFields`: `updatedAt`, written by the runner on every write
  that changes a row, and `createdAt`, written on insert and indexed.
- `defaultFields`: both of the above, `{ ...defaultIdField,
  ...defaultTimestampFields }`.

Every kayan needs an `id`. The template's `expectedUpdatedAt` step, which
refuses a stale update with a 409, refuses to run on a kayan without
`updatedAt`. The default fields are not vocabulary: `mithaq.lock` does not
record them, so changing them needs no signature. Where it lives:
`packages/mithaq/src/base/fields.ts`.

**Labels and messages.** Every label holds one string per declared locale. A
kayan's `messages` is its own copy, nested by the parts of each key:
`singular` and `plural` name the kayan on every screen, and a field's own
refusal messages go under its name (`fee: { min: { en, ar } }`). `mithaq
generate messages` writes the copy files and refuses a gap.

**Access.** `access` holds `create`, `read`, `update` and `delete`. Each is a
callback that answers `true`, `false` or a `Where`, or the project compiles them
from a row table with `rows(...)`. A field's own `access` holds `create`,
`read` and `update`, each answering `true` or `false`. See
[Access and roles](#access-and-roles) below.

**Operations.** A kayan answers exactly the operations it lists under
`targets.service.operations`, and nothing else. Spread `defaultOperations`
(`create`, `update`, `delete`, `find`, `findByID`, `count`, `updateMany`,
`deleteMany`) and leave out any you do not want, or add your own:

```ts
operations: {
  ...defaultOperations,
  archive: {
    input: () => archiveInput,
    steps: ({ steps }) => [markArchived, steps.update],
  },
},
```

An operation is a list of steps with exactly one store or read step in it
(`steps.insert`, `steps.update`, `steps.remove`, `steps.find`,
`steps.findOne`, `steps.count`, and the bulk and version steps). Its name is
its permission key: `courses.archive`. It may also declare `input` (the shape it
parses, from the derived shapes), `output`, and three more lists:
`beforeTransaction`, `afterSteps` and `afterCommit`. Where it lives:
`packages/mithaq/src/asas/runner/steps.ts` `defaultOperations` and
`OperationDeclaration`.

**Steps.** A step is a function `(ctx, tools)` that returns the context.
`ctx` holds the kayan, `data`, the `actor` (also as `user`), `dataBefore` on an
update or delete, the transaction `tx` and the call's `context`. `tools` holds
the operation's name, its schema, the bound store writes on a write, and
`tools.of(kayan)` for a managed call to another kayan in the same transaction.

```ts
const markArchived = (ctx: Ctx<z.infer<typeof archiveInput>>): Ctx => {
  const { reason } = ctx.data
  return { ...ctx, data: { ...ctx.data, archived: true, archiveReason: reason } }
}
```

The example is `templates/features/courses/courses/courses.ts` `markArchived`.

**Indexes.** `indexes` lists the indexes over a kayan's own columns. Every
field with `unique: true` gets a default unique index. A list is built beside
those defaults, and a function `({ defaults }) => [...]` answers the whole list:

```ts
indexes: ({ defaults }) => [
  ...defaults.filter((index) => !index.fields.includes('code')),
  { fields: ['code'], unique: true },
],
```

An entry is `{ fields, unique?, nullsNotDistinct? }`. On a per-organization
kayan a group `{ within: 'organization', unique: [...], index: [...] }` builds
indexes led by the organization field. A `unique` field that no unique index
covers is refused. The group, and what `unique` means per organization, are
explained in [Tenancy](src/asas/runner/README.md#unique-values-and-indexes). Where it
lives: `packages/mithaq/src/mithaq/resolve.ts` `uniqueRuleIndexes`.

**Versions and drafts.** A kayan keeps versions by writing `targets.versions`
and spreading `versionOperations` (`findVersions`, `findVersionByID`,
`restoreVersion`). With `drafts`, it also spreads `draftFields`: a write with
`{ draft: true }` saves a version alone, a plain read leaves a never-published
row out, and `{ draft: true }` on a read answers each row's latest version.

```ts
targets: {
  versions: { drafts: { autosave: true } },
  service: { operations: { ...defaultOperations, ...versionOperations } },
},
fields: { ...defaultFields, ...draftFields, /* ... */ },
```

Where it lives: `packages/mithaq/src/versions/versions.ts` `versionsOf`.

**Storage.** A kayan holds files by writing `targets.storage` (`mimeTypes`,
optional `fileSize`, optional `public: true`) and spreading `uploadFields`.
Exactly one of its operations makes rows, and that operation runs the config's
`uploaded` step in `beforeTransaction`. The browser asks `POST
/api/<kayan>/uploadInstructions`, uploads the file, and sends the signed
reference back in the create; `GET /api/<kayan>/file/<id>` serves it through
the kayan's own `findByID`. A global holds no files, and a kayan that holds
files keeps no versions. Where it lives:
`packages/mithaq/src/storage/storage.ts` `resolveStorage`.

**Screens.** A kayan says what each screen draws of it under
`targets.<screen>`: its title field, its pages, and per-field drawing hints. See
[Screens](#screens) below.

### `defineGlobal`

A global is a kayan of one row, such as site settings. It spreads
`defaultGlobalFields` (the `globalType` constant) and runs
`defaultGlobalOperations`: `findOne` and `update`. The first `update` makes the
row; a read before it answers `null`. Its access takes `read` and `update`
alone.

```ts
export const settings = defineGlobal({
  name: 'settings',
  fields: {
    ...defaultFields,
    contactEmail: { kind: 'email', label: { en: 'Contact email', ar: 'بريد التواصل' } },
    ...defaultGlobalFields,
  },
  targets: { service: { operations: defaultGlobalOperations } },
})
```

A global that places the organization field is one row per organization; the
template's `templates/features/settings/settings/settings.ts` is one, and
[Tenancy](src/asas/runner/README.md#globals) shows what changes. Where it lives:
`packages/mithaq/src/mithaq/define.ts` `defineGlobal`.

## Targets

A target is one consumer of the declarations: a database, a validator, a screen,
the runner. Each declares one **capability**, and `buildAsas` treats it by that
capability alone:

| Capability | What it does | How many |
| --- | --- | --- |
| `store` | holds the rows and builds a column per field | any |
| `schema` | builds a validation shape per field and derives a kayan's shapes | any |
| `access` | names the system roles and answers what an actor holds | at most one |
| `service` | the runner: its step lists, limits and access evaluator | exactly one, named `service` |
| `screen` | draws kayan in an admin app | any, none named `screen` |
| `tenant` | says which kayan a row's organization is | at most one, named `tenant` |
| `storage` | where a kayan's files are kept | at most one |
| `versions` | where a kayan's past copies are kept | at most one |

A store or schema target has one entry per kind and per rule; a kind may also
carry its own implementation for a target's `type`. A target may carry
commands, run as `mithaq <target> <command>`.

### Targets and adapters

A **target** is one setting in `defineMithaq`'s `targets`, each with one
capability from the table above, as many as that row allows.
It says what a kayan declaration becomes or runs through: a drizzle table,
zod shapes, service operations, screens or the tenant rule. Each kayan can
carry its own settings for a target under its own `targets`.
An **adapter** connects mithaq to a system outside it: `drizzleAdapter` is a
store target that connects to Postgres, and the storage target takes adapters
such as `r2` or `s3`. Mithaq's own service, roles, versions, screens and tenant
parts connect to nothing outside, so they are targets and not adapters.
An adapter provides a fixed set of words every adapter of its kind must
have, such as the [store words](../../templates/asas/README.md#add-a-step);
those words are not settings and are never written out in the config.
Each named default mithaq ships (`drizzleKinds`, `drizzleIdKinds`, `zodKinds`,
`defaultLimit`, `newRows: 'active'`) is written out by name in a project's config,
so reading it shows which defaults are in force.

### The shipped targets

- **drizzle** (`store`): Postgres through Drizzle.
  `drizzleAdapter({ connectionString, kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds, prodMigrations })`. Its
  `migrate` command is `mithaq migrate`. `packages/mithaq/src/drizzle/index.ts`
  `drizzleAdapter`.
- **zod** (`schema`): the create, update, id, byID, row and list shapes, and
  the draft shapes. `packages/mithaq/src/zod/index.ts` `zodTarget`.
- **rbac** (`access`): system roles in code, custom roles and assignments in
  two kayan, and the `assign` command. `packages/mithaq/src/rbac/index.ts`
  `rbacTarget`. `betterAuthTarget` is the alternative that keeps custom roles
  in the provider's own rows, and `memberRoleTarget` the one with no custom
  role at all: a member holds the system roles its Better Auth `member.role`
  names in that organization.
- **service** (`service`): the runner. `packages/mithaq/src/service/index.ts`
  `serviceTarget`.
- **screen** (`screen`): one admin app's pages. `packages/mithaq/src/screen/index.ts`
  `screenTarget`.
- **tenant** (`tenant`): per-organization rows over Better Auth's
  organizations. `packages/mithaq/src/auth/better-auth/tenant.ts`
  `betterAuthTenant`.
- **storage** (`storage`): built by the `storage` rukn, with the `sweep`
  command that finds objects no row names.
- **versions** (`versions`): built by the `versions` rukn.

## Asas

`buildAsas` takes the kayan, the globals, the HTTP plugs and the auth settings,
checks everything, and returns the runtime.

```ts
export const asas = buildAsas({
  kayan: [...betterAuth.core, ...betterAuth.organization, roles, memberRoles, tags, courses],
  global: [settings],
  http: [orpcHttp({ /* ... */ }), fetchHttp({ context: requestContext, maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
  statements: { ...providerStatements },
  auth: { admin: { kayan: user, access: superAdmin }, onError: (error) => console.error(error), maxBodyBytes: defaultMaxBodyBytes },
})
```

Where it lives: `packages/mithaq/src/asas/build.ts` `buildAsas`; the template's
is `templates/asas/src/asas.ts`.

### Defaults are explicit

Core never falls back to a behaviour of its own. Each default has an exported
name that the project spreads or names. Most start with `default`; the target
maps are `drizzleKinds`, `drizzleRules`, `drizzleIdKinds`, `zodKinds`, `zodRules`
and `zodIdKinds`. The project sees and owns
every behaviour it might change. `buildAsas` refuses a config that leaves a
required one out:

- `http`: at least one plug, such as `fetchHttp({ maxBodyBytes:
  defaultMaxBodyBytes, onError: console.error })`. Each plug requires its
  `maxBodyBytes`, the largest request body it reads, and answers one past it
  with 413 before it reads the rest; the template names `defaultMaxBodyBytes`
  (4 MiB) on both. Files are never sent this way. Each plug requires its
  `onError` too, handed every fault it answers 500.
- `auth.onError` and `auth.maxBodyBytes`, the largest body an auth route
  reads, once any kayan carries auth.
- On the service target: `authorize` (`defaultAuthorize`), `depth`
  (`defaultDepth`, 8), `defaultLimit` (10), `maxLimit` (100), `joinLimit` (10),
  `bulkLimit` (1000), `store` and `schema`. An `audit` step needs an `audit`
  sink.
- On the storage config: `secret`, `adapters`, `adapter`, `fileSize`
  (`defaultFileSize`), `maxBodyBytes` (`defaultMaxBodyBytes`), which bounds
  the instructions request as a plug's bounds a call, `onError`, and the functions `key`, `verify`,
  `disposition`, `sweep`, `instructions`, `uploaded`, `removed` and `serve`.

A default that holds policy or talks to the outside world, such as the storage
functions or the `expectedUpdatedAt` step, is a registry file copied into the
project, which the project edits there.

### What it returns

- `handler(request)`: answers every HTTP request. It serves
  `/api/auth/<strategy>/*`, `GET /api/access` (what the actor may do), the file
  routes, and then asks each plug in order, answering 404 when none matched.
- `operations`: the flat table of every built operation, one entry per
  operation of every kayan and global, which the plugs read.
- `kayan.<name>.operations` and `global.<name>.operations`: each operation as a
  function, `(input, { actor })`, for code in the app:
  `asas.kayan.courses.operations.find({ limit: 20 }, { actor })`.
- `connect({ readOnly? })`: reaches every store and prepares it, and with
  `readOnly` writes nothing. With the drizzle store's `prodMigrations`, it runs
  or refuses pending migrations; see [Migrations in production](src/drizzle/README.md).
- `destroy()`: closes every store.
- `catalog` and `statements`: every permission key, as a list and in Better
  Auth's shape.
- `targets`, `auth` (the strategies and `auth.actor(headers)`), `router` and
  `messages`.

## Operations and the runner

Every operation runs through the runner in a fixed order. A step list cannot
skip a check, because the checks belong to the runner, not to the list.

### Create, update and delete

1. The depth cap and the call's context. A write nested past `depth` throws.
2. On an update or delete, the id is checked against the id shape: a 400, not a
   store error.
3. On a per-organization kayan, the organization scope is checked; see
   [Tenancy](src/asas/runner/README.md).
4. Access: the kayan's access answer and the permission key
   `<kayan>.<operation>`. A create needs `true`; an update or delete may get a
   `Where` that narrows the row it reaches.
5. `beforeTransaction`, outside the transaction. No row is loaded yet.
6. The transaction opens. An update or delete loads its row under the access
   answer and locks it as Postgres's own statement would: an update `FOR NO KEY
   UPDATE`, which a write naming the row passes. A hard delete, or an update
   naming a column of a unique index, takes `FOR UPDATE`, which holds that write
   off. A soft delete updates its mark, so it takes `FOR NO KEY UPDATE` unless
   that mark belongs to a unique index, as enrollments' `deletedAt` does, when it
   takes `FOR UPDATE`. `FOR KEY SHARE` lets a named row's other columns change
   before the writer commits. The field's `filterOptions`, the target's read
   access and `publishedWhere` are checked under that same `FOR KEY SHARE`; a
   project whose concurrent writes must not slip past those checks locks the
   row in a step, as courses does. A step judging those columns must lock that row
   itself before the store step, for example with `'noKeyUpdate'`. Taking `FOR UPDATE` after
   the reference check can deadlock with another writer doing the same.
7. Field access for the fields the write names.
8. The parse and the defaults. Without an `input`, the defaults fill and the
   whole row is parsed; with one, the caller's shape is parsed first and the
   defaults fill after it.
9. The service target's `beforeSteps`, the operation's `steps`, then
   `afterSteps` (the operation's own, or else the service target's). At the
   store step the runner answers 404 for a row that was not found, asks field
   access again, checks every relationship value, and refuses a step that wrote
   a `providedBy: 'never'` field.
10. The commit. The result is parsed against the row shape and cut to the
    fields the actor may read.
11. `afterCommit`, after the commit. A throw there leaves the write standing
    and answers `AfterCommitError`.

A nested managed write, such as `tools.of(sessions).create(...)` inside a step,
joins the outer transaction, so both commit or roll back together.

### Read

1. The depth cap, and the organization reach (`tenant: 'mine'` or `'all'`),
   opened by the outermost read alone.
2. Access: the read answer and the permission key. A `Where` narrows every row
   the read reaches.
3. The parse, then the operation's steps and its own `afterSteps`. A read runs
   no service-target list and has no `beforeTransaction`.
4. Inside the read step: the caller's `where` and `sort` are checked against
   field read access (a filter on a field the actor may not read is a 403), a
   filter across a relationship carries the far kayan's read access, rows a
   soft delete marked or a draft never published are left out, and `join`
   fields are populated through the child kayan's own read.
5. Each row is parsed against the row shape and cut to the fields the actor may
   read. A row addressed by id that is absent or hidden answers 404.

### Bulk

`updateMany` and `deleteMany` take `{ where, data }`. The bulk's own key is
asked once; a `where` is required; the match is refused when it holds more than
`bulkLimit` rows. Each matched row then goes through the single-row write, with
its own key and field access, all in one transaction: one failing row rolls
the whole call back. A draft never published is left alone, and an actor who
may read drafts finds it listed under `errors`. A bulk operation of the
kayan's own runs `each: '<operation>'` on each row instead, such as an
`archiveMany` that runs `archive`. Where it lives: `packages/mithaq/src/asas/runner/bulk.ts` `bulk`.

### How access is answered

- **Rows.** The access callback, or the row table, answers `true`, `false` or a
  `Where`. A `Where` is ANDed onto the query or the row lookup, so it narrows
  and never widens. A kayan with no access of its own answers only to the
  `auth.admin` kayan's actor, through `auth.admin.access`.
- **Keys.** Where the actor's keys are graded, an operation also needs
  `<kayan>.<operation>`, and a field needs `<kayan>.fields.<field>`.
- **Field access.** On read, a field the actor may not read is removed from the
  row. On write, a field a row table denies is a 403 that names it, and a field
  a hand-written callback denies is dropped from the write.

Where it lives: `packages/mithaq/src/asas/runner/write.ts` `defaultAuthorize`
and `projectReadableFields`; `packages/mithaq/src/asas/runner/read.ts`
`readers`.

### Errors and refusals

A refusal the caller caused is an `AsasError` with a status, a message `key` a
client translates, and `params`:

- 400 (`invalid`): the input, a `where`, a reference or an option is wrong.
- 403 (`denied`): the actor may not do this.
- 404 (`missing`): no such row. An absent row and one the actor may not reach
  answer alike, so a 404 never says which.
- 409 (`conflict`): the write collides with a row already there, such as a
  unique value. It never names the value. A transaction aborted by a deadlock or serialization failure answers `error.conflict.retry`, so the caller may try again; core does not retry it.

Any other throw is a fault: the HTTP plugs answer it as a 500 with the message
replaced. `AfterCommitError` means the write committed and an `afterCommit`
step failed. Where it lives: `packages/mithaq/src/asas/runner/errors.ts`.

## Access and roles

### Keys

Every permission key comes from the declarations, and `asas.catalog` lists
them all:

- `<kayan>.<operation>`, one per operation: `courses.find`,
  `courses.archive`;
- `<kayan>.fields.<field>`, one per field: `courses.fields.title`;
- `screen.<screen>`, one per screen, which decides who enters it.

A key a role names that is not in the catalog fails the build.

### System roles and custom roles

The access target (`rbacTarget`) holds two kinds of role:

- **System roles** are code: a slug, a label and the keys it holds (`'*'` for
  every key). The template's are `templates/mithaq/src/roles/system-roles.ts` `systemRoles`:
  the backoffice's and the organizations' (`administrator`, `registrar`,
  `instructor`, `student`).
- **Custom roles** are rows of the `roles` kayan, each organization's own:
  a `name` and a `permissions` list.

Which roles an actor holds in an organization are rows of the `memberRoles`
kayan. The target reads them for the active organization, adds each system
role's keys from code and each custom role's keys from that organization's
`roles` rows, and puts the result on the trusted actor. `mithaq rbac assign
--tenant <id> --user <id> --role <slug>` writes one assignment from the
command line.

<!-- from: templates/mithaq/src/mithaq.ts -->
```ts
const accessOptions = {
  roles: systemRoles,
  rolesOf: assignedRoles,
  access: tenantAccess,
  kayan: { roles: 'roles', memberRoles: 'memberRoles' },
} as const

export const accessTarget = (roles: typeof systemRoles = systemRoles) => {
  const target = rbacTarget({ ...accessOptions, roles })
  // ...
}
```

Where it lives: `packages/mithaq/src/rbac/index.ts` `rbacTarget`.

### Row tables

A row table says, per role, what each operation may do. Its keys are `'*'`
(the row every actor assigned a role gets beside its own) and system role
slugs. An actor with no role takes no row and is denied.

```ts
access: rows({
  '*': { create: true, read: true, update: { owner: { equals: user.id } }, delete: false },
}),
```

Each row answers `create` (only `true` allows), `read`, `update` and `delete`
with `true`, `false` or a `Where`, and may list `fields` (`'*'`, a name, or
`!name`). A `false` in any applicable row denies; several `Where` answers admit
a row any one of them admits. The access target's `access` table is inherited
by every per-organization kayan; a kayan drops it with `access: { tenant: false
}`, and a callback written beside the rows is ANDed with them.

Where it lives: `packages/mithaq/src/mithaq/rows.ts` `rows`; the template's
table is `templates/mithaq/src/roles/tenant-access.ts` `tenantAccess`.

## Screens

Mobile first: every screen is designed for the phone (390px) first and widened with min-width breakpoints (sm:, md:, lg:); max-* overrides only where no min-width form exists, each with a comment saying why.

A screen is a target of capability `screen`: one admin app's pages over the
kayan it lists. It names its path, its kayan, the control and cell that draw
each kind (`screenKinds` and the project's own), its providers, its own pages,
and the shells, layouts and components its pages name. A kayan says what the
screen draws of it under `targets.<screen>`.

<!-- from: templates/mithaq/src/mithaq.ts -->
```ts
const shared = {
  controls: screenKinds,
  layouts: {
    app: ui('app-shell.tsx#AppShell'),
    record: ui('record-page.tsx#RecordPage'),
    table: ui('table-page.tsx#TablePage'),
  },
}

export const dashboardScreen = screenTarget({
  ...shared,
  layouts: { ...shared.layouts, top: ui('top-shell.tsx#TopShell') },
  path: '/dashboard',
  kayan: [
    'courses',
    // ...
    'tags',
    // ...
    'settings',
    // ...
  ],
  providers: [
    dashboardUi('theme-provider.tsx#ThemeProvider'),
    ui('rich-text-nodes.tsx#RichTextNodes'),
    // ...
  ],
  pages: {
    dashboard: { path: '/', component: dashboardUi('dashboard.tsx#Dashboard'), permission: 'courses.find' },
    // ...
  },
  // ...
})
```

A file is named `ui('file.tsx#Export')` off a folder URL from `folderOf`, and
a missing file or export fails the build. Where it lives:
`packages/mithaq/src/screen/index.ts` `screenTarget`.

A kayan's `targets.<screen>.nav` controls its sidebar entry. It accepts
`label`, `icon`, `order`, `hidden` and `group`. A group names `name`, a localized `label`,
optional `order` and optional `position: 'bottom'`. A screen's own page puts
the same keys beside its `nav.label`. `navOf(screen, report)` removes entries
without permission, keeps hidden entries, and orders the groups and their
entries. Navigation menus filter hidden entries when drawing. Omitted orders keep declaration order. Empty groups never
render. Use the same group metadata wherever a group is named.

`hidden: true` changes the sidebar alone. The list route, its read operation
and its permission remain declared and authorized as before. Regenerate
screens after changing navigation metadata.

`icon` is a name in the host app's `components.icons` map, for example
`nav: { icon: 'receipt' }`. Import only the icons the app uses:

```ts
import { Receipt } from 'lucide-react'
import { defaultComponents } from 'mithaq-admin/default-components.tsx'

export const components = { ...defaultComponents, icons: { receipt: Receipt } }
```

The same map is mounted with `ComponentsProvider` and passed to
`checkComponents({ client, components })` for every screen at boot. That check
refuses an unregistered name, including one on a hidden entry, and names its
screen and path. The generator checks that a name is a non-empty string; it
cannot see a host's React map, so registration is checked at boot. Names remain
strings in generated screens, and TypeScript accepts the same names boot does.
The starter's sidebar and phone sheet draw the declared icon first, then the
existing path icon when none is declared, then `Table2`. The backoffice uses
the same resolver. Existing shells need to read `entry.icon` from `useNav()`
and resolve it with `navIconFor` from `mithaq-admin/components.tsx` to adopt it.
The starter's named imports live in `ui/nav-icons.ts`; no icon-library lookup
or dynamic import pulls the whole library into the bundle.

### Lists

A list node declares `columns`, `filters`, `search`, `sort`, `limit`, `tabs`,
`empty`, `menu`, `toolbar`, `bulk`, `row`, `of` and `where`. Its `phone` layout is `'cards'` by default.
`phone: 'table'` keeps a visible header and scrolls the table inside its frame
below 640px, with 44px targets and no page-level sideways scroll. This is a
declaration, with no runtime layout switch. A phone table cannot declare `card`.

A card list may declare `card` for phone details:

```ts
{ list: { columns: ['title', 'fee', 'opensOn', '_status'], card: ['_status', 'fee', 'opensOn'] } }
```

`card` orders up to three of this list's column names after its title. The
listed kayan's `useAsTitle` column is the title when active; otherwise the first
active column is, initially in kayan field order. For `of` lists this is the related kayan.
Types check column membership, at most three details and the phone layout;
the build refuses a repeated title when booting or running `mithaq generate --check`.
A hidden or unreadable
column stays absent, with no replacement from outside `card`. Without `card`,
the first three visible non-title columns remain the details. An empty `card`
shows the title alone. This applies to tenant and backoffice lists, including
related lists. From 640px upward, each list keeps its table and column order.

**The admin package.** The controls, cells, forms, lists and shells a screen draws with, `mithaq eject`, and `mithaq upgrade --check`, which compares the files a project holds with them, are described in [The admin package](../mithaq-admin/README.md).

**`mithaq generate screens`** writes each screen's route files into the host
app, and `mithaq screens` prints each screen's page tree. Where it lives:
`packages/mithaq/src/screen/generate.ts` `run`.
[The `mithaq` command](src/asas/cli/README.md) describes both commands.

## Extending the language

This part covers adding to the language itself: a rukn, a kind or a rule, a target, and a configurable feature. Adding a kayan, a feature on a kayan or a step to a project is in [Adding to the project](../../templates/asas/README.md#adding-to-the-project).

### Add a rukn

A rukn is one object made with `defineRukn({ name, kinds, rules, targets, needs })`. It may bring:

- **kinds**, each with its own implementation for each target type under `targets`: `drizzle` its column, `zod` its shape, `screen` its control and cell;
- **rules**;
- **targets** it builds, which merge with the project's own (the storage rukn builds the storage target over the config it is handed);
- **needs**, the capabilities it requires of the build, such as `needs: ['store']`. A need names a capability, never a target type, so any store meets `'store'`.

A project adds a rukn with one line in `arkan` in `templates/mithaq/src/mithaq.ts`, and one line in `targets` for each capability the rukn needs that the build does not already lay down.

```ts
import { defineRukn, kind } from 'mithaq'
import { varchar } from 'mithaq/drizzle/pg-core'
import { z } from 'zod'

const isSlug = (value: unknown): value is string => typeof value === 'string'

/** A rukn of this project's own: the `slug` kind, with its column, its shape and how a screen draws it. */
export const slugs = defineRukn({
  name: 'slugs',
  kinds: {
    slug: kind<string>(isSlug)({
      label: { en: 'Slug', ar: 'معرف نصي' },
      message: { en: 'This is not a slug.', ar: 'هذا ليس معرفا نصيا.' },
      rules: ['required', 'unique', 'index'],
      targets: {
        drizzle: (field: { column: string }) => varchar(field.column, { length: 40 }),
        zod: () => z.string().regex(/^[a-z0-9-]+$/),
        screen: { control: 'text', cell: 'text' },
      },
    }),
  },
})

// templates/mithaq/src/mithaq.ts
export const arkan = [base, richText({ nodes: richTextNodes }), guardedFiles, versions({ max: 100 }), slugs] as const
```

A kind's `screen` control and cell each name one the registry ships, a `ui()` reference, or the kind's own name, which the app's admin components map then draws: see [Add or replace a control](../mithaq-admin/README.md#add-or-replace-a-control). A target reads the project's own entry for a kind first, then the kind's own under `targets`, then its shipped table. `buildAsas` refuses a kind, rule or target that two arkan bring, a rukn target under a key the project's `targets` already use, and a rukn whose need no target meets, naming both sides each time.

A rukn's kinds, rules and target names are vocabulary, so adding a rukn, or changing what one brings, follows [Add a kind or a rule](#add-a-kind-or-a-rule). Fields a feature needs, such as `uploadFields` or `draftFields`, are not part of a rukn: they are exported beside it as named values a kayan spreads.

When you write a rukn factory whose kinds depend on its argument, type that argument as `<const C>`, or the kinds widen and the type checks pass silently. A factory whose kinds do not depend on its argument, such as `richText({ nodes })` or `storage(config)`, takes no generic.

### Add a kind or a rule

A kind or a rule is vocabulary, so it changes only with the owner's signature.

1. Ask the owner first. Say what the kayan needs to say and why the existing kinds and rules cannot say it.
2. Bring the kind or rule in a rukn, as above. A rule is made with `rule({ accepts, message, excludes })`. Each store and schema target needs an entry for a new rule in its `rules` table, or the build refuses a field that carries it with "has no entry in the ... target's rules". A new kind carries its own entry per target type under `targets`.
3. Run `bunx mithaq lock --check`. In a project that keeps a `mithaq.lock`, it turns red and lists each changed path. The red message ends with the sentence that starts with `ميثاق:`.
4. Stop there and hand over. The owner runs `bunx mithaq lock`, which signs only when a person types back the code its popup shows. Never sign the lock, approve a signature, or edit `mithaq.lock` by hand: an edited lock fails the check too.

A red lock also stops both apps' `dev`, `build` and `preview` scripts. While a project runs without a lock, the vocabulary still changes only with the owner's explicit word. [The `mithaq` command](src/asas/cli/README.md#lock-and-lock---check) describes both commands.

### Add a target

A target is one entry in `defineMithaq`'s `targets`, under a name, with a `capability` core knows: `store`, `schema`, `access`, `service`, `screen`, `tenant`, `storage` or `versions`. A target's name and capability are vocabulary, so the owner signs every new one. A new capability is a change to mithaq itself.

A target of an existing capability can be the project's own and spreads into `targets` beside the shipped ones. A new target shipped by mithaq follows the order below. Paths from here on are in the mithaq repository.

#### What goes where

| What it is | Where it lives | How a project uses it |
|---|---|---|
| The target's name and capability, a kind's label, message and rules | A rukn the project lays down in `arkan`, recorded in `mithaq.lock` | Only the owner signs a change. |
| Plain data a project extends: fields, operations, nodes | Core, exported as `default<Name>` | The project spreads it: `{ ...defaultOperations, archive }`, `richText({ nodes: [...defaultNodes, MyNode] })`. |
| A behaviour a project may replace: a step, a key format, a verify, a serve, a sweep | A `default<Name>` function | The project names it in its own config: `verify: defaultVerify`. |
| Code that holds policy or talks to the outside world: a provider SDK, a bucket, a mailer, UI | A registry file copied into the project with its marker line | The project edits its copy in place. |
| An invariant no project may break: access before a read, the tenant from the session, the shape check at the trust boundary, a guard against data loss | Core | Exposed as small building blocks the defaults call, such as `checkReference` and `readForFile`, never as a hidden fallback. |

#### The rules

1. **Every default has a name, and the project passes it.** Core never writes `config.verify ?? coreVerify`. Most exports start with `default`; the target maps are `drizzleKinds`, `drizzleRules`, `drizzleIdKinds`, `zodKinds`, `zodRules` and `zodIdKinds`.
2. **`buildAsas` refuses a config that leaves a default out**, naming the key. The storage target refuses a config with no `verify`, saying "storage names no "verify" function", and the build refuses a config with no `http` plug.
3. **A default that holds policy lives in the project.** What a valid file is, how a key is built and which orphans the sweep deletes are registry files copied to `templates/mithaq/src/<target>/defaults.ts`, not core code.
4. **Operations are spread, never injected.** A target ships `<target>Operations` built from exported `default*` steps, and a kayan spreads it beside `defaultOperations`, as `versionOperations` is spread into `courses`.
5. **Core keeps only what is not a choice,** and the target's documentation says why each piece core keeps is not the project's. If you cannot write the reason, the piece belongs to the project.
6. **Replacing a default must not need core's internals.** The building blocks a default calls are exported, and the default's tests ship beside it.
7. **One object argument** for any function a project calls or implements with three or more parameters, or two whose order matters and whose types match. `bun run lint:args` checks the first case.
8. **A store that writes at `connect()`** (a push, a seed, a marker) skips that under `connect({ readOnly: true })`, because `generate messages --check` reads through that connect and relies on it writing nothing.
9. **A target that holds a secret makes the language module server-only.** Check that no module a browser loads imports it; `apps/client-imports.test.ts` walks the apps for this.
10. **A store handles every `lock` mode `find` is handed:** `'update'`, `'noKeyUpdate'`, `'share'` and `'keyShare'`. One written as `lock === 'update' ? … : none` takes no lock for the other three, and the runner's delete guard and `expectedUpdatedAt` rely on them.

#### Order

1. **Agree the design with the owner.** Cover the lock change, every `default*` function and value and where it lives (core spread, project config or registry copy), and what core keeps and why.
2. **Add the vocabulary:** the target, or the kind in the rukn that brings it, under `packages/mithaq/src/<target>/`. The lock goes red and stays red until the owner signs at the end.
3. **Write the core building blocks and their types,** each project-facing function taking one object. Give the target constructor a `type`. If a kayan writes anything under the target, augment `KayanConfigs` with that type's shape, as `packages/mithaq/src/versions/index.ts` does. Export it from `packages/mithaq/src/index.ts`.
4. **Write the defaults,** as registry files under `packages/mithaq-admin/registry/<target>/` where they hold policy or talk to the outside world, otherwise as exported `default*` values.
5. **Name every function in the template's config,** in `templates/mithaq/src/mithaq.ts` or a file it imports, such as `templates/mithaq/src/storage/index.ts`.
6. **Write the tests:** the security cases first, each default's own tests, a test that `buildAsas` refuses the config with each function removed, and a test that a replaced default is called rather than silently ignored. Add a `@ts-expect-error` probe for the rukn to `templates/asas/src/types.probe.ts`.
7. **Document it:** what is a default, what core keeps and why, and how to replace each default.

Before review, check that:

- a search of core for `??` finds no fallback to a behaviour;
- every function the template's config names starts with `default` or is the project's own;
- `buildAsas` refuses the config with any one function removed, and a replaced default is called (both tested);
- `bunx mithaq upgrade --check` lists every copied file;
- the lock diff holds only the target or kind.

### Add a configurable feature

Storage adapters, auth strategies, rich-text nodes, the service target's limits and the HTTP plugs are all configured the same way: the project names every piece, and core supplies named defaults for it to name.

- **A list the project extends is spread.** Rich text nodes are `[...defaultNodes, UploadNode]` in `templates/mithaq/src/mithaq/rich-text-nodes.ts`, the one list the server and every editor read. A node that draws React keeps its DOM-free class there and its React subclass in the client file.
- **A value or a function the project may replace is named.** The service target names `authorize: defaultAuthorize`, `depth: defaultDepth`, `defaultLimit`, `maxLimit: defaultMaxLimit`, `joinLimit: defaultJoinLimit` and `bulkLimit: defaultBulkLimit`. Local auth names `tokenExpiration: defaultTokenExpiration`, `maxLoginAttempts: defaultMaxLoginAttempts` and `lockTime: defaultLockTime`. To change one, put your own value or function in its place.
- **A default that holds policy or talks to the outside world is a registry file.** The storage adapters (`local`, `r2`, `s3`, `uploadthing`) and `defaults.ts` in `templates/mithaq/src/storage/` are copies of the `mithaq-storage` item. `templates/mithaq/src/storage/index.ts` names each of `defaultKey`, `defaultVerify`, `defaultDisposition`, `defaultSweep`, `defaultUploadInstructions`, `defaultUploaded`, `defaultRemoveFile` and `defaultServeFile`. To add an adapter, write it beside the others and add it to `adapters`; to change a policy, edit `defaults.ts`.
- **Core never falls back.** A missing piece is refused when the project builds, never filled in. A storage config without `verify`, a build without `http`, or a service target without `authorize` is a configuration error, not a default.

Tenancy has no default to replace. Scoping a per-organization kayan to the active organization is not a choice, so core enforces it on every managed operation and nothing turns it off. See [Tenancy](src/asas/runner/README.md).

## Upgrading

In 0.2.0, `drizzleTarget` is removed. `drizzleAdapter` is already the store
target, so a separate object of implicit maps hid which defaults a project
used. Pass `kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds`
to `drizzleAdapter` instead. It is an adapter because it connects mithaq's
store contract to Postgres through Drizzle; it still has the `store` capability.
The [0.1.1 to 0.2.0 upgrade guide](../../templates/asas/README.md#011-to-020)
covers the other breaking changes.
