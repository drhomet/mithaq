# Changelog

## 0.2.1

Documentation only; no code changed. The guides that ship in the package now cover every 0.2.0 change: the [0.1.1 to 0.2.0 upgrade guide](templates/asas/README.md#011-to-020), the whole store contract, why `drizzleTarget` became `drizzleAdapter`'s named defaults, the nested message format with `$value`, and the query limits. This changelog starts.

## 0.2.0

Changes since 0.1.1. Existing projects should follow the [0.1.1 to 0.2.0 upgrade guide](templates/asas/README.md#011-to-020) before deploying.

### Breaking

- Message JSON files are nested, with locale leaves and `$value` for a parent's own message. Names starting with `$` are reserved. Load files through `flattenMessageFile`, as the app's `copyFile` does, before regenerating; flat files still read for this release. Page about text moves to `<kayan>.page.description`, and every locale needs `error.conflict.target` copy.
- A global's `update` call is typed from its declared input. Its first save still uses the create shape and can reject required update-only keys; the upgrade guide links the open first-save issue.
- Core lower-cases UUID ids and relationship values before access and steps, and normalizes UUID filters too. An HTTP read's `limit`, when supplied, must be an integer in `1..maxLimit`; `0` is refused, so callers read page by page.
- The Postgres store takes `drizzleKinds`, `drizzleRules` and `drizzleIdKinds` directly in `drizzleAdapter`; `zodTarget` is called with its corresponding maps. `betterAuthTenant` requires `newRows: 'active'` and `organizations: 'one' | 'many'`, and throws if either is missing or invalid. Step store calls take kayan declarations. Custom stores implement `upsert`, `sum` and all four row-lock modes.
- The admin is the `mithaq-admin` package. Apps use its components map for controls, cells and nodes, spread rich-text and upload maps explicitly, and use `mithaq/vite` for ejected pieces. Rich text is imported from `mithaq/rich-text` and Lexical is an optional peer. The starter separates the language, features and asas, with configurable generator paths.
- The staff console is renamed to backoffice, including its target, app, routes, permission keys, environment variable and session cookie. It requires a separate origin and, off this machine, a separate host. Remote auth URLs require `BETTER_AUTH_SECRET` even outside production.
- Organization mode `'none'` becomes `'one'` with `showOrganization: false`. Many organizations require verified addresses, and production requires a mailer in every mode. In `src/mail/`, `configuredMailer` is a function and `resendMailer` takes `baseURL`. Verified sign-up asks for name and address; a mailed link lets the person choose a password. First-run takes the one organization's names from `organizationName` in code. Organization rows gain names in every locale, with role keys and a migration to match; names are one line of at most 100 characters. Apps supply `no-organization.tsx`, `showLocale` and the updated auth copy and pages.
- Relationships restrict deletion by default, including sets, uploads and references in the latest draft. A student has one standing seat per session. Courses gain `selfEnroll`; settings use the organization's name in place of their old title column. Existing data needs the migrations and checks in the upgrade guide.
- Every HTTP plug, auth and storage names `maxBodyBytes`; every HTTP plug names `onError`. JSON `maxBytes` counts UTF-8 bytes, and `like` accepts at most 1000 words. The `json` kind adds vocabulary for a signed lock to approve. Audit `changes` becomes JSON and replaces the separate list of changed fields, with a guarded data migration and path queries.
- Each `in` or `not_in` in a caller's query holds at most 1,000 values; a `where` holds at most 200 field, `and` and `or` nodes in total, however nested. Split larger queries into separate requests within these bounds; combine alternatives by union and conjunctions or `not_in` chunks by intersection.

### Added

- `create-mithaq` offers minimal, full or selected add-ons, monorepo or single-package layouts, and installs with npm, pnpm, Yarn 1 or Bun. `dev:setup` prepares a fresh local database and its dev administrator, with optional sample rows.
- Organization first-run, invitation and open sign-up modes, invitation limits and server-side acceptance, Add person, password links, and a page for people in no organization. Member visibility follows permissions and audience rules.
- The Members page lists members and invitations with row actions and role editing. Records have searchable activity, the dashboard has an organization-wide Activity page, and the backoffice keeps staff history.
- The student portal supports self-enrollment within session capacity, with course and session details and maintenance settings. Records expose draft, published, changed and archived states, with archive, unarchive and unpublish actions.
- The `json` kind stores JSON in `jsonb`, validates optional JSON Schema, queries dotted paths under field access and tenant scope, and draws a JSON editor. Audit entries bound large change values.
- Steps can hold rows, apply integer `$inc`, upsert by a unique key and read exact sums. Deadlocks and serialization failures, SQLSTATE `40P01` and `40001`, answer `error.conflict.retry` with 409 so callers can retry; core does not retry automatically.
- Generated auth kayan can import project operations from a sibling operations file. The CLI resolves extensionless relative project imports. User guides and project workflow skills ship with the package, and the docs check verifies links and copied snippets.
- `mithaq-admin` includes a temporary Payload password checker for projects moving accounts to Better Auth. Release checks cover PostgreSQL 17 and 18.

### Fixed

- Reference checks and writes use compatible row locks, including set-only updates and soft deletes, reducing deadlocks while keeping referenced rows protected. Enrollment checks hold sessions and courses against concurrent archive and capacity changes. PostgreSQL 18 restrict violations answer the same referenced conflict as foreign-key violations.
- Step writes stay within the active organization and the named kayan row, including raw updates and deletes, UUIDs sent in another case, insert organization defaults, upsert conflicts and draft writes. A step cannot switch the authorized target id. JSON values containing `$inc` remain ordinary JSON.
- A second copy of mithaq is refused by name. Auth generation preserves Better Auth's lookup indexes. Migrations use mithaq's own drizzle-orm and read drizzle-kit's complete output, including output larger than a pipe buffer.
- Request bodies are bounded before auth or plug fallthrough can consume them whole; oversized bodies answer 413 and interrupted reads answer 499. JSON checks reject invalid Unicode and excessive nesting, and query limits bound lists and conditions.
- Sign-in redirects stay within screens the person can open. Field relationship filters apply to pickers and writes. Rich-text editing, date-time saves, save feedback and role permission displays follow the current components.
- Message generation keeps translations when nesting files, separates page and field descriptions, and removes only a left-out add-on's shared copy in a new project. UUID normalization leaves ordinary JSON values unchanged and preserves omitted input fields.
