import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { generateAuth, header as authHeader, run as runAuth } from 'mithaq/generate-auth'
import { generateScreens } from 'mithaq/generate-screens'
import { generateMessages, refusals, run } from 'mithaq/generate-messages'
import {
  defaultAuthorize,
  defaultDepth,
  defaultLimit,
  defaultMaxLimit,
  defaultJoinLimit,
  defaultBulkLimit,
  defaultFields,
  defaultKinds,
  defaultOperations,
  defaultRules,
  base,
  defineMithaq,
  defineRukn,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  rule,
  screenTarget,
  upload,
  zodKinds,
  zodRules,
  zodTarget,
  serviceTarget,
  fetchHttp,
} from 'mithaq'
import type { ColumnRule, MessageRegistry, ZodRule } from 'mithaq'
import { richText } from 'mithaq/rich-text'
import { asas } from './asas.ts'
import { options } from '@asas/auth'
import { betterAuth } from './kayan/auth/user/index.ts'
import { buildAsas, defineKayan } from './test-language.ts'
import { dashboardScreen as templateDashboard } from './mithaq.ts'
import { memberRoles } from './member-roles/member-roles.ts'
import { memoryStore } from './memory-store.ts'
import { richTextNodes } from './rich-text-nodes.ts'
import { roles } from './roles/roles.ts'
import { Refusal } from '../../../packages/mithaq/src/mithaq/refusal.ts'
import { formatLock, sealLanguage, vocabularyOf } from '../../../packages/mithaq/src/mithaq/lock.ts'
import { receivedLanguage } from '../../../packages/mithaq/src/mithaq/language.ts'
import {
  appliedIn,
  commandIn,
  foldersIn,
  kayanSourceOf,
  migrateDatabase,
  migrateEnv,
  migrateName,
  migrating,
  migrationProject,
  sqlIn,
  withSummary,
} from './migrate.support.ts'

/**
 * The kayan the access target reads, the two the assignment relationships point at, and one
 * carrying the soft-delete mark. Every build of this language declares them because `buildAsas`
 * refuses a target whose kayan the build lacks.
 */
const accessKayan = [
  roles,
  memberRoles,
  ...betterAuth.core,
  ...betterAuth.organization,
  defineKayan({
    name: 'accessMarked',
    dbName: 'access_marked',
    fields: { ...defaultFields, deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } } },
    targets: { service: { operations: defaultOperations } },
  }),
]

/**
 * One screen and no access target, for tests that write `targets.dashboard` and need neither the
 * project's screens nor its rbac target.
 */
const dashboardScreen = (kayan: readonly string[]) =>
  defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget,
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
      dashboard: screenTarget({ ...templateDashboard, kayan, pages: { dashboard: { path: '/', component: templateDashboard.pages.dashboard!.component } } }),
    },
  })

test('generateAuth maps Better Auth modelName and fieldName to its Drizzle schema', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-'))}/`)
  // One directory per instance, three levels under the project's `src/`, which is what a generated
  // file's imports reach back through.
  const directory = new URL('kayan/auth/user/', root)
  const options = {
    user: { modelName: "people'sProfiles", fields: { name: 'display-name' } },
    session: { modelName: 'logins', fields: { userId: 'personAPI' } },
    account: { modelName: 'identities', fields: { userId: 'personId' } },
  }

  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), [])

    const user = await readFile(new URL('user.ts', directory), 'utf8')
    const session = await readFile(new URL('session.ts', directory), 'utf8')
    assert.match(user, /export const user = defineKayan\({\n  name: 'people\\'sProfiles',\n  dbName: 'people\\'s_profiles'/)
    assert.match(user, /'display-name': \{ kind: 'text', rules: \{ required: true \} \}/)
    assert.doesNotMatch(user, /\n  name: \{ kind:/)
    assert.match(session, /import \{ user \} from '\.\/user\.ts'/)
    assert.match(session, /export const session = defineKayan\({\n  name: 'logins'/)
    assert.match(
      session,
      /personAPI: \{ kind: 'relationship', relationTo: \(\) => user, dbName: 'person_api', rules: \{ required: true, onDelete: 'cascade' \} \}/,
    )

    await writeFile(new URL('mithaq.ts', root), 'export const defineKayan = (kayan) => kayan\n')
    // A generated kayan spreads `defaultFields` and `defaultOperations`, so the bare specifier has to
    // resolve from the temporary root the file is imported out of.
    await mkdir(new URL('node_modules/mithaq/', root), { recursive: true })
    await writeFile(
      new URL('node_modules/mithaq/package.json', root),
      JSON.stringify({ name: 'mithaq', type: 'module', exports: { '.': './index.js' } }),
    )
    await writeFile(new URL('node_modules/mithaq/index.js', root), 'export const defaultFields = {}\nexport const defaultOperations = {}\n')
    const generated = await import(new URL('session.ts', directory).href)
    assert.equal(generated.session.fields.personAPI.relationTo().name, "people'sProfiles")

    await writeFile(new URL('user.ts', directory), `${user}\n`)
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), ['user.ts'])
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateAuth spreads the shipped operations onto every generated kayan, named field or not', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-'))}/`)
  const directory = new URL('kayan/auth/', root)
  const options = {
    plugins: [
      {
        id: 'test',
        schema: {
          team: { fields: { name: { type: 'string' as const, required: true } } },
          ticket: { fields: { code: { type: 'string' as const } } },
        },
      },
    ],
  }

  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), [])

    const read = async (file: string) => readFile(new URL(file, directory), 'utf8')
    assert.match(await read('team.ts'), /\n  targets: \{ service: \{ operations: defaultOperations \} \},\n/)
    assert.match(await read('ticket.ts'), /\n  targets: \{ service: \{ operations: defaultOperations \} \},\n/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateAuth titles a table that has a name field by it, on each screen that lists its kayan and on no other', async () => {
  // A screen is a name the project picks, so the generator is handed each screen and the kayan it
  // lists; a `targets.<screen>` naming a screen that does not list the kayan is refused at build.
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-'))}/`)
  const directory = new URL('kayan/auth/', root)
  const options = {
    user: { fields: { name: 'displayName' } },
    plugins: [{ id: 'test', schema: { team: { fields: { name: { type: 'string' as const, required: true } } }, ticket: { fields: { code: { type: 'string' as const } } } } }],
  }
  const screens = { dashboard: ['user', 'team', 'ticket'], portal: ['team'], platform: [] }
  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory, screens })
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, screens, check: true }), [])
    const read = async (file: string) => readFile(new URL(file, directory), 'utf8')
    assert.match(await read('team.ts'), /\n  targets: \{ service: \{ operations: defaultOperations \}, dashboard: \{ useAsTitle: 'name' \}, portal: \{ useAsTitle: 'name' \} \},\n/)
    assert.match(await read('user.ts'), /\n  targets: \{ service: \{ operations: defaultOperations \}, dashboard: \{ useAsTitle: 'displayName' \} \},\n/, 'a renamed name field titles under the name Better Auth gave it')
    assert.match(await read('ticket.ts'), /\n  targets: \{ service: \{ operations: defaultOperations \} \},\n/, 'a table with no name field keeps its id')
    assert.match(await read('session.ts'), /\n  targets: \{ service: \{ operations: defaultOperations \} \},\n/, 'a kayan no screen lists writes no screen block')
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, screens: { ...screens, portal: [] }, check: true }), ['team.ts'])
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateAuth imports a kayan\'s access from a <kayan>.access.ts beside it, writes none without one, and reports the file drifted when one comes or goes', async () => {
  // A generated file is the generator's, and a kayan built beside it under its name is refused by
  // every relationship to it, so the project's own access goes in a sibling file the generator
  // reads.
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-access-'))}/`)
  const directory = new URL('kayan/auth/user/', root)
  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    const read = async (file: string) => readFile(new URL(file, directory), 'utf8')
    assert.doesNotMatch(await read('user.ts'), /import \{ access \}|\n  access,/, 'with no sibling the kayan names no access')
    const sibling = new URL('user.access.ts', directory)
    await writeFile(sibling, 'export const access = { read: () => true }\n')
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), ['user.ts'], 'a sibling that came is drift')
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    const user = await read('user.ts')
    assert.match(user, /\nimport \{ access \} from '\.\/user\.access\.ts'\n/)
    assert.match(user, /\n  access,\n  fields: \{/)
    assert.doesNotMatch(await read('session.ts'), /import \{ access \}|\n  access,/, 'and only the kayan it sits beside imports it')
    assert.equal(await read('user.access.ts'), 'export const access = { read: () => true }\n', 'the sibling is the project\'s and is left as written')
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), [])
    await rm(sibling)
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), ['user.ts'], 'and so is one that went')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateAuth takes what the screens draw of a kayan from a <kayan>.screens.ts beside it, which wins each screen it names while every other screen keeps its generated title, and reports the file drifted when one comes or goes', async () => {
  // A generated file is the generator's, so a kayan's pages on a screen go in a sibling file the
  // generator reads, beside `<kayan>.access.ts`.
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-screens-sibling-'))}/`)
  const directory = new URL('kayan/auth/user/', root)
  const screens = { dashboard: ['user'], platform: ['user'] }
  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory, screens })
    const read = async (file: string) => readFile(new URL(file, directory), 'utf8')
    const sibling = new URL('user.screens.ts', directory)
    const written = "export const screens = { platform: { useAsTitle: 'name', pages: {} } } as const\n"
    await writeFile(sibling, written)
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, screens, check: true }), ['user.ts'], 'a sibling that came is drift')
    await generateAuth({ language: '../../../mithaq.ts', options, directory, screens })
    const user = await read('user.ts')
    assert.match(user, /\nimport \{ screens \} from '\.\/user\.screens\.ts'\n/)
    assert.match(user, /\n  targets: \{ dashboard: \{ useAsTitle: 'name' \}, \.\.\.screens, service: \{ operations: defaultOperations \} \},\n/, 'the dashboard the sibling does not name keeps its generated title, the platform is the sibling\'s, and the service stays the generator\'s')
    assert.match(await read('session.ts'), /\n  targets: \{ service: \{ operations: defaultOperations \} \},\n/, 'and only the kayan it sits beside imports it')
    assert.equal(await read('user.screens.ts'), written, 'the sibling is the project\'s and is left as written')
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, screens, check: true }), [])
    await rm(sibling)
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, screens, check: true }), ['user.ts'], 'and so is one that went')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('mithaq generate auth reads the screens off the language\'s own targets in src/mithaq.ts', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-screens-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(
    new URL('src/mithaq.ts', root),
    [
      "export const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../providers.ts' }",
      "export const targets = { store: { capability: 'store' }, back: { capability: 'screen', kayan: ['user'] }, front: { capability: 'screen', kayan: [] } }",
      '',
    ].join('\n'),
  )
  await writeFile(new URL('src/providers.ts', root), 'export const providers = { user: { options: {}, server: () => ({}) } }\n')
  try {
    assert.equal(await quietly(() => runAuth(root, false)), 0)
    const kayan = await readFile(new URL('src/kayan/auth/user/user.ts', root), 'utf8')
    assert.match(kayan, /\n  targets: \{ service: \{ operations: defaultOperations \}, back: \{ useAsTitle: 'name' \} \},\n/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('mithaq generate auth --check writes nothing, not even the folder, and reports every file of a folder that is missing as stale', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-check-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(
    new URL('src/mithaq.ts', root),
    "export const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../providers.ts' }\n",
  )
  await writeFile(new URL('src/providers.ts', root), 'export const providers = { user: { options: {}, server: () => ({}) } }\n')
  try {
    assert.deepEqual(
      await generateAuth({ language: '../../../mithaq.ts', options: {}, directory: new URL('src/kayan/auth/user/', root), check: true }),
      ['account.ts', 'index.ts', 'session.ts', 'user.ts', 'verification.ts'],
    )
    assert.equal(await quietly(() => runAuth(root, true)), 1)
    assert.deepEqual(await readdir(new URL('src/', root)), ['mithaq.ts', 'providers.ts'])
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateAuth marks Better Auth onUpdate fields as application-supplied on update', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-'))}/`)
  const directory = new URL('kayan/auth/user/', root)
  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    for (const file of ['user.ts', 'session.ts']) {
      const source = await readFile(new URL(file, directory), 'utf8')
      assert.match(source, /updatedAt: \{ kind: 'datetime', rules: \{ required: true, nowOnUpdate: true, providedBy: \{ update: 'application' \} \} \}/)
      assert.doesNotMatch(source, /defaultNow: true/)
    }
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), [])
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateAuth keeps a non-date onUpdate field away from clients without a datetime bump', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-'))}/`)
  const directory = new URL('kayan/auth/', root)
  try {
    const options = {
      plugins: [{ id: 'test', schema: { audit: { fields: { label: { type: 'string' as const, onUpdate: () => 'next' } } } } }],
    }
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    assert.match(
      await readFile(new URL('audit.ts', directory), 'utf8'),
      /label: \{ kind: 'text', rules: \{ providedBy: \{ update: 'application' \} \} \}/,
    )
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), [])
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateAuth rejects reserved exported names but permits reserved property keys', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-auth-'))}/`)
  try {
    for (const name of ['class', 'await', 'implements', 'eval', 'arguments']) {
      const options = { plugins: [{ id: 'test', schema: { [name]: { fields: {} } } }] }
      await assert.rejects(
        () => generateAuth({ language: '../../../mithaq.ts', options, directory: new URL(`${name}/`, root) }),
        /cannot be a generated file or export name/,
      )
    }

    const directory = new URL('valid-name/', root)
    const options = {
      plugins: [{ id: 'test', schema: { validName: { fields: { await: { type: 'string' as const } } } } }],
    }
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    assert.match(await readFile(new URL('validName.ts', directory), 'utf8'), /  await: \{ kind: 'text' \}/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test("the registry carries the labels mithaq ships under one scope of its own, each in the language's own locales", () => {
  const floor = asas.messages.scopes.find((scope) => scope.name === 'mithaq')
  assert.ok(floor, 'the shipped copy is a scope of its own')
  for (const key of ['kinds.text', 'kinds.email', 'kinds.number', 'kinds.checkbox', 'kinds.datetime', 'kinds.date', 'kinds.textArray', 'kinds.relationship', 'fields.id', 'fields.updatedAt', 'fields.createdAt', 'globalType']) {
    assert.ok(key in floor.keys, `the floor claims ${key}`)
  }
  assert.deepEqual(floor.keys['kinds.text'], { en: 'Text', ar: 'نص' })
  assert.deepEqual(floor.keys.globalType, { en: 'Global type', ar: 'النوع العام' })
  assert.deepEqual(asas.messages.locales, ['ar', 'en'])
})

test("a kayan's own messages entry overrides the seed for that rule, and the seed is no collision", () => {
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'notes',
        messages: { title: { maxLength: { en: 'A title fits on one line.', ar: 'العنوان يتسع في سطر واحد.' } } },
        fields: {
          id: defaultFields.id,
          title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' }, rules: { maxLength: 120 } },
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  const scope = messages.scopes.find((one) => one.name === 'notes')!
  assert.deepEqual(scope.keys['title.maxLength'], { en: 'A title fits on one line.', ar: 'العنوان يتسع في سطر واحد.' })
  // A seed is a floor, not a claim, so overriding one is not the two-scopes-claim-one-key finding
  // `--check` refuses.
  assert.deepEqual(messages.collisions, {})
  assert.deepEqual(scope.keys['title.required'], defaultRules.required.message)
})

test("a kayan's messages nest by the parts of the key, and a key that names no field nests the same way", () => {
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'notes',
        messages: {
          singular: { ar: 'ملاحظة', en: 'Note' },
          delete: { confirm: { ar: 'احذف نهائيا', en: 'Delete for good' } },
          title: { maxLength: { ar: 'العنوان يتسع في سطر واحد.', en: 'A title fits on one line.' } },
          operations: { archive: { reason: { ar: 'السبب', en: 'Reason' } } },
        },
        fields: {
          id: defaultFields.id,
          title: { kind: 'text', rules: { maxLength: 120 } },
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  const scope = messages.scopes.find((one) => one.name === 'notes')!
  assert.deepEqual(scope.keys.singular, { ar: 'ملاحظة', en: 'Note' })
  assert.deepEqual(scope.keys['delete.confirm'], { ar: 'احذف نهائيا', en: 'Delete for good' })
  assert.deepEqual(scope.keys['title.maxLength'], { ar: 'العنوان يتسع في سطر واحد.', en: 'A title fits on one line.' })
  assert.deepEqual(scope.keys['operations.archive.reason'], { ar: 'السبب', en: 'Reason' })
  assert.equal(scope.keys.delete, undefined)
  assert.equal(scope.keys.operations, undefined)
  assert.equal(scope.keys['operations.archive'], undefined)
  assert.deepEqual(messages.collisions, {})
})

test('a message key written flat is refused at build, naming the first part and the nested spelling', () => {
  const notes = (messages: Record<string, unknown>) =>
    buildAsas({
      http: [fetchHttp()],
      kayan: [
        defineKayan({
          name: 'notes',
          messages: messages as { [key: string]: { ar: string; en: string } },
          fields: {
            id: defaultFields.id,
            title: { kind: 'text', rules: { maxLength: 120 } },
            deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
          },
          targets: { service: { operations: defaultOperations } },
        }),
        ...accessKayan,
      ],
    })
  assert.throws(
    () => notes({ 'fee.invalid': { ar: 'الرسوم رقم.', en: 'A fee is a number.' } }),
    new Error('Kayan "notes" writes the message key "fee.invalid" flat. Nest it under "fee": messages: { fee: { invalid: ... } }.'),
  )
  assert.throws(
    () => notes({ operations: { 'archive.reason': { ar: 'السبب', en: 'Reason' } } }),
    new Error(
      'Kayan "notes" writes the message key "operations.archive.reason" flat. Nest it under "archive": messages: { operations: { archive: { reason: ... } } }.',
    ),
  )
})

test('a message that is no object at all is refused at build by what was written, rather than destroyed or thrown past', () => {
  const notes = (messages: Record<string, unknown>) =>
    buildAsas({
      http: [fetchHttp()],
      kayan: [
        defineKayan({
          name: 'notes',
          messages: messages as { [key: string]: { ar: string; en: string } },
          fields: {
            id: defaultFields.id,
            title: { kind: 'text', rules: { maxLength: 120 } },
            deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
          },
          targets: { service: { operations: defaultOperations } },
        }),
        ...accessKayan,
      ],
    })
  // A bare string is the reason the guard exists: it would reach the registry as one opaque string,
  // which `mithaq generate messages` reports as `unverifiable` and never refuses.
  assert.throws(
    () => notes({ title: 'Title' }),
    new Error(
      'Kayan "notes" writes the message key "title" as a string, and a message is one string per declared locale, a group of those, or a function. Write one string per declared locale under it.',
    ),
  )
  assert.throws(
    () => notes({ title: null }),
    new Error(
      'Kayan "notes" writes the message key "title" as null, and a message is one string per declared locale, a group of those, or a function. Write one string per declared locale under it.',
    ),
  )
  assert.throws(
    () => notes({ title: 3 }),
    new Error(
      'Kayan "notes" writes the message key "title" as a number, and a message is one string per declared locale, a group of those, or a function. Write one string per declared locale under it.',
    ),
  )
})

test('a part of a message that is neither a string, a group nor a function is refused naming that part', () => {
  const notes = (messages: Record<string, unknown>) =>
    buildAsas({
      http: [fetchHttp()],
      kayan: [
        defineKayan({
          name: 'notes',
          messages: messages as { [key: string]: { ar: string; en: string } },
          fields: {
            id: defaultFields.id,
            title: { kind: 'text', rules: { maxLength: 120 } },
            deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
          },
          targets: { service: { operations: defaultOperations } },
        }),
        ...accessKayan,
      ],
    })
  assert.throws(
    () => notes({ title: { ar: 'العنوان', en: null } }),
    new Error(
      'Kayan "notes" writes "en" under the message key "title" as null, and every part of a message is a string, a group of parts, or a function. Write a string there, or drop the part.',
    ),
  )
  assert.throws(
    () => notes({ title: { ar: 'العنوان', en: 3 } }),
    new Error(
      'Kayan "notes" writes "en" under the message key "title" as a number, and every part of a message is a string, a group of parts, or a function. Write a string there, or drop the part.',
    ),
  )
  assert.throws(
    () => notes({ operations: { archive: { reason: { ar: 'السبب', en: 'Reason' } }, label: 3 } }),
    new Error(
      'Kayan "notes" writes "label" under the message key "operations" as a number, and every part of a message is a string, a group of parts, or a function. Write a string there, or drop the part.',
    ),
  )
})

test('a message whose parts are strings under keys the language never declared as locales is refused, rather than written over', () => {
  const notes = (messages: Record<string, unknown>) =>
    buildAsas({
      http: [fetchHttp()],
      kayan: [
        defineKayan({
          name: 'notes',
          messages: messages as { [key: string]: { ar: string; en: string } },
          fields: {
            id: defaultFields.id,
            title: { kind: 'text', rules: { maxLength: 120 } },
            deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
          },
          targets: { service: { operations: defaultOperations } },
        }),
        ...accessKayan,
      ],
    })
  // `archive` was meant as a part of its own and reads as a locale of `operations`. `merge` keys
  // the entry by the declared locales alone, so a write run would drop `Archive` and leave empty
  // locales in the committed file.
  assert.throws(
    () => notes({ operations: { archive: 'Archive' } }),
    new Error(
      'Kayan "notes" writes "archive" under the message key "operations", and it is no locale this language declares: ar, en. Write one string per declared locale under it, or nest "archive" as a part of its own.',
    ),
  )
  assert.throws(
    () => notes({ title: ['first', 'second'] }),
    new Error(
      'Kayan "notes" writes "0" under the message key "title", and it is no locale this language declares: ar, en. Write one string per declared locale under it, or nest "0" as a part of its own.',
    ),
  )
  assert.throws(
    () => notes({ title: { ar: 'العنوان', en: 'Title', fr: 'Titre' } }),
    new Error(
      'Kayan "notes" writes "fr" under the message key "title", and it is no locale this language declares: ar, en. Write one string per declared locale under it, or nest "fr" as a part of its own.',
    ),
  )
  // A message short of a declared locale is not this guard's: a run fills it in and `--check`
  // reports it missing.
  const short = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'notes',
        messages: { title: { en: 'Title' } as { ar: string; en: string } },
        fields: {
          id: defaultFields.id,
          title: { kind: 'text', rules: { maxLength: 120 } },
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  assert.deepEqual(short.messages.scopes.find((one) => one.name === 'notes')!.keys.title, { en: 'Title' })
})

test('a message key that is a sentence and a group at once is refused at build, and so is one that is neither', () => {
  const notes = (messages: Record<string, unknown>) =>
    buildAsas({
      http: [fetchHttp()],
      kayan: [
        defineKayan({
          name: 'notes',
          messages: messages as { [key: string]: { ar: string; en: string } },
          fields: {
            id: defaultFields.id,
            title: { kind: 'text', rules: { maxLength: 120 } },
            deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
          },
          targets: { service: { operations: defaultOperations } },
        }),
        ...accessKayan,
      ],
    })
  // Nesting has no spelling for a node that is both a sentence and a group. Read as a group it
  // would flatten the locales into `title.ar` and `title.en`, destroying the copy under a check
  // that passes.
  assert.throws(
    () => notes({ title: { ar: 'العنوان', en: 'Title', maxLength: { ar: 'طويل', en: 'Too long' } } }),
    new Error(
      'Kayan "notes" writes the message key "title" as a sentence and as a group at once, and a key is one or the other. Give the sentence a part of its own under "title".',
    ),
  )
  // An empty object read as a leaf would write `"title": { "ar": "", "en": "" }` into the committed
  // file and be reported missing on the next check, a gap a run opened.
  assert.throws(
    () => notes({ title: {} }),
    new Error(
      'Kayan "notes" writes the message key "title" as an empty object, so it is a sentence in no locale and a group with no parts. Write one string per declared locale under it, or drop the key.',
    ),
  )
  assert.throws(
    () => notes({ operations: { archive: { ar: 'أرشفة', en: 'Archive', reason: { ar: 'السبب', en: 'Reason' } } } }),
    new Error(
      'Kayan "notes" writes the message key "operations.archive" as a sentence and as a group at once, and a key is one or the other. Give the sentence a part of its own under "operations.archive".',
    ),
  )
  assert.throws(
    () => notes({ operations: { archive: {} } }),
    new Error(
      'Kayan "notes" writes the message key "operations.archive" as an empty object, so it is a sentence in no locale and a group with no parts. Write one string per declared locale under it, or drop the key.',
    ),
  )
  assert.throws(
    () => notes({ title: new Date() }),
    new Error(
      'Kayan "notes" writes the message key "title" as a Date, so it is a sentence in no locale and a group with no parts. Write one string per declared locale under it, or drop the key.',
    ),
  )
  // Reading the constructor name is the one part of the sentence that can fail; the refusal still
  // carries on without it.
  assert.throws(
    () => notes({ title: Object.create(Object.defineProperty({}, 'constructor', { get: () => { throw new Error('not saying') } })) }),
    new Error(
      'Kayan "notes" writes the message key "title" as an object, so it is a sentence in no locale and a group with no parts. Write one string per declared locale under it, or drop the key.',
    ),
  )
  assert.throws(
    () => notes({ title: Object.create(Object.create(null)) }),
    new Error(
      'Kayan "notes" writes the message key "title" as an object, so it is a sentence in no locale and a group with no parts. Write one string per declared locale under it, or drop the key.',
    ),
  )
  assert.throws(
    () => notes({ title: Object.defineProperty({}, 'constructor', { get: () => { throw new Error('not saying') } }) }),
    new Error(
      'Kayan "notes" writes the message key "title" as an empty object, so it is a sentence in no locale and a group with no parts. Write one string per declared locale under it, or drop the key.',
    ),
  )
})

const registryOf = (over: Partial<MessageRegistry> = {}): MessageRegistry => ({
  locales: ['ar', 'en'],
  scopes: [{ name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } }],
  collisions: {},
  resolved: false,
  localized: [],
  ...over,
})

const inTemporary = async (run: (directory: URL) => Promise<void>) => {
  const directory = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-messages-'))}/`)
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true })
  }
}


const writtenIn = async (directory: URL) =>
  Object.fromEntries(
    await Promise.all(
      (await readdir(directory)).map(async (file) => [
        file.replace(/\.json$/, ''),
        JSON.parse(await readFile(new URL(file, directory), 'utf8')) as Record<string, Record<string, string>>,
      ]),
    ),
  ) as Record<string, Record<string, Record<string, string>>>

const refusingRules = ['max', 'maxLength', 'maxRows', 'min', 'minLength', 'minRows', 'pattern', 'precision', 'required', 'scale']

test('message seeds cover only fields clients can supply on a write', async () => {
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'seedProviders',
        fields: {
          id: defaultFields.id,
          onCreate: { kind: 'text', rules: { required: true, providedBy: { create: 'client', update: 'application' } } },
          application: { kind: 'text', rules: { required: true, providedBy: { create: 'application', update: 'application' } } },
          never: { kind: 'text', rules: { required: true, providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  const keys = messages.scopes.find((scope) => scope.name === 'seedProviders')!.keys
  assert.ok(keys['onCreate.invalid'])
  assert.ok(keys['onCreate.required'])
  for (const name of ['application', 'never']) {
    assert.equal(keys[`${name}.invalid`], undefined)
    assert.equal(keys[`${name}.required`], undefined)
  }

  const courses = asas.messages.scopes.find((scope) => scope.name === 'courses')!.keys
  const enrollments = asas.messages.scopes.find((scope) => scope.name === 'enrollments')!.keys
  for (const key of ['createdAt.invalid', 'createdAt.required', 'updatedAt.invalid', 'updatedAt.required']) {
    assert.equal(courses[key], undefined)
  }
  assert.equal(enrollments['deletedAt.invalid'], undefined)
  assert.equal(enrollments['deletedAt.required'], undefined)
  assert.ok(courses['title.maxLength'])
  assert.ok(courses['fee.min'])
})

test('an id still seeds refusal keys when its provider is application on both writes', () => {
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'serverIds',
        fields: { id: { kind: 'uuid', rules: { providedBy: { create: 'application', update: 'application' } } } },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  const keys = messages.scopes.find((scope) => scope.name === 'serverIds')!.keys
  assert.ok(keys['id.invalid'])
  assert.ok(keys['id.required'])
})

test("the shipped rule and kind refusal sentences are keys of the project's mithaq scope, each seeded with the shipped sentence, and a check after a run is green", async () => {
  await inTemporary(async (directory) => {
    await generateMessages({ registry: asas.messages, directory })
    const floor = (await writtenIn(directory)).mithaq!
    assert.deepEqual(Object.keys(floor).filter((key) => key.startsWith('rules.')), refusingRules.map((rule) => `rules.${rule}`))
    for (const rule of refusingRules) {
      assert.deepEqual(floor[`rules.${rule}`], defaultRules[rule as keyof typeof defaultRules].message, `rules.${rule}`)
    }
    assert.deepEqual(floor['rules.maxLength'], { ar: 'القيمة طويلة جدًا.', en: 'The value is too long.' })
    assert.deepEqual(floor['rules.max'], { ar: 'القيمة أكبر من المسموح.', en: 'The value is too large.' })
    const kinds = { ...defaultKinds, ...richText({ nodes: richTextNodes }).kinds, upload }
    assert.deepEqual(
      Object.keys(floor).filter((key) => key.endsWith('.invalid')),
      Object.keys(kinds).sort().map((kind) => `kinds.${kind}.invalid`),
    )
    for (const kind of Object.keys(kinds)) {
      assert.deepEqual(floor[`kinds.${kind}.invalid`], kinds[kind as keyof typeof kinds].message, `kinds.${kind}.invalid`)
    }
    assert.deepEqual(floor['kinds.text.invalid'], { ar: 'هذا ليس نصا.', en: 'This is not text.' })
    assert.deepEqual(refusals(await generateMessages({ registry: asas.messages, directory, check: true })), [])
  })
})

test("a per-field key still equal to the scope's default is a seed, so a changed default reseeds it, while one a person edited is left alone", async () => {
  await inTemporary(async (directory) => {
    await generateMessages({ registry: asas.messages, directory })
    const before = await writtenIn(directory)
    const seeded = Object.entries(before).flatMap(([scope, keys]) =>
      Object.keys(keys).filter((key) => key.endsWith('.maxLength')).map((key) => [scope, key] as const),
    )
    assert.ok(seeded.length > 1, 'more than one field binds maxLength')
    const [edited, ...rest] = seeded
    const theirs = { ar: 'اسم قصير من فضلك.', en: 'A short name, please.' }
    await writeFile(new URL(`${edited![0]}.json`, directory), `${JSON.stringify({ ...before[edited![0]], [edited![1]]: theirs }, null, 2)}\n`)
    const changedDefault = { ar: 'النص أطول من المسموح.', en: 'This is longer than allowed.' }
    await writeFile(new URL('mithaq.json', directory), `${JSON.stringify({ ...before.mithaq, 'rules.maxLength': changedDefault }, null, 2)}\n`)

    // A seed that no longer matches its default is what a run would rewrite, so the check reports
    // it rather than reading it as an override.
    const report = await generateMessages({ registry: asas.messages, directory, check: true })
    assert.ok(report.changed.includes(`${rest[0]![0]}.json`))

    await generateMessages({ registry: asas.messages, directory })
    const after = await writtenIn(directory)
    assert.deepEqual(after.mithaq!['rules.maxLength'], changedDefault, 'what is on disk wins in the scope')
    for (const [scope, key] of rest) assert.deepEqual(after[scope]![key], changedDefault, `${scope}.${key} reseeded`)
    assert.deepEqual(after[edited![0]]![edited![1]], theirs, "the person's sentence is kept")
    assert.deepEqual(refusals(await generateMessages({ registry: asas.messages, directory, check: true })), [])
  })
})

test('a locale the language adds is refused on the mithaq scope first, and once the scope is filled a rerun writes it on every per-field key', async () => {
  await inTemporary(async (directory) => {
    const registry = { ...asas.messages, locales: ['ar', 'en', 'fr'] }
    const { missing } = await generateMessages({ registry, directory, check: true })
    const firstPerField = missing.findIndex((line) => !line.startsWith('mithaq.'))
    assert.ok(missing.indexOf('mithaq.rules.maxLength has no "fr".') >= 0)
    assert.ok(missing.indexOf('mithaq.rules.maxLength has no "fr".') < firstPerField, 'the mithaq scope comes before any per-field line')
    assert.ok(missing.includes('courses.archiveReason.maxLength has no "fr".'))

    await generateMessages({ registry, directory })
    const floor = (await writtenIn(directory)).mithaq!
    const french = Object.fromEntries(Object.entries(floor).map(([key, entry]) => [key, { ...entry, fr: `${entry.en} (fr)` }]))
    await writeFile(new URL('mithaq.json', directory), `${JSON.stringify(french, null, 2)}\n`)
    await generateMessages({ registry, directory })

    const courses = (await writtenIn(directory)).courses!
    assert.equal(courses['archiveReason.maxLength']!.fr, 'The value is too long. (fr)')
    assert.equal(courses['archiveReason.required']!.fr, 'This field is required. (fr)')
    assert.equal(courses['archiveReason.invalid']!.fr, 'This is not text. (fr)')
    assert.equal(courses['createdAt.invalid'], undefined)
    // Every per-field refusal key a rule or kind seeds carries `fr`; what is left is copy the
    // project wrote itself, which no default reaches.
    const left = (await generateMessages({ registry, directory, check: true })).missing.filter((line) =>
      /\.(invalid|max|maxLength|min|minLength|pattern|required) has no "fr"\.$/.test(line),
    )
    assert.deepEqual(left, ['courses.fee.invalid has no "fr".', 'courses.fee.min has no "fr".'])
  })
})

test("a project rule carrying its own sentence seeds mithaq.rules.<name>, and its per-field keys seed from that entry", async () => {
  const message = { ar: 'هذه القيمة ليست موجبة.', en: 'This value is not positive.' }
  const language = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [defineRukn({ name: 'project', kinds: { ...defaultKinds, number: { ...defaultKinds.number, rules: [...defaultKinds.number.rules, 'positive'] as const } }, rules: { ...defaultRules, positive: rule<boolean>({ accepts: (value): value is boolean => typeof value === 'boolean', message }) } })],
    targets: {
      drizzle: drizzleAdapter({
        connectionString: 'postgresql://never-connected',
        kinds: drizzleKinds,
        rules: { ...drizzleRules, positive: (({ column }) => column) satisfies ColumnRule<boolean> },
      }),
      zod: { ...zodTarget, kinds: zodKinds, rules: { ...zodRules, positive: (({ shape }) => shape) satisfies ZodRule<boolean> } },
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
    },
  })
  const { messages } = language.buildAsas({
    http: [fetchHttp()],
    kayan: [
      language.defineKayan({
        name: 'scores',
        fields: { id: defaultFields.id, score: { kind: 'number', label: { ar: 'النتيجة', en: 'Score' }, rules: { positive: true } } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await inTemporary(async (directory) => {
    await generateMessages({ registry: messages, directory })
    assert.deepEqual((await writtenIn(directory)).mithaq!['rules.positive'], message)
    assert.deepEqual((await writtenIn(directory)).scores!['score.positive'], message)
    const theirs = { ar: 'يجب أن تكون النتيجة موجبة.', en: 'A score is above zero.' }
    const floor = (await writtenIn(directory)).mithaq!
    await writeFile(new URL('mithaq.json', directory), `${JSON.stringify({ ...floor, 'rules.positive': theirs }, null, 2)}\n`)
    await generateMessages({ registry: messages, directory })
    assert.deepEqual((await writtenIn(directory)).scores!['score.positive'], theirs)
  })
})
test('a run keeps entries with no source and a check refuses them by name', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({
      scopes: [
        { name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } },
        { name: 'courses', keys: { title: { ar: 'العنوان', en: 'Title' } } },
      ],
    })
    assert.deepEqual((await generateMessages({ registry, directory })).changed, ['mithaq.json', 'courses.json'])
    assert.deepEqual((await generateMessages({ registry, directory })).changed, [], 'a rerun writes nothing')

    await writeFile(new URL('courses.json', directory), JSON.stringify({ 'createdAt.required': { ar: 'x', en: 'y' }, title: { ar: 'عنوان', en: 'Title' } }))
    const report = await generateMessages({ registry, directory, check: true })
    assert.deepEqual(refusals(report), ['courses.createdAt.required is an entry with no source. Delete it; a run keeps it.'])
    await generateMessages({ registry, directory })
    assert.deepEqual(JSON.parse(await readFile(new URL('courses.json', directory), 'utf8')), {
      title: { ar: 'عنوان', en: 'Title' },
      'createdAt.required': { ar: 'x', en: 'y' },
    })
  })
})

test('a run places a new copy key in sorted order beside existing keys', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({ scopes: [{ name: 'courses', keys: { alpha: { ar: 'أ', en: 'A' }, zulu: { ar: 'ز', en: 'Z' } } }] })
    await writeFile(new URL('courses.json', directory), `${JSON.stringify({ zulu: { ar: 'ز', en: 'Z' } }, null, 2)}\n`)
    await generateMessages({ registry, directory })
    const copy = JSON.parse(await readFile(new URL('courses.json', directory), 'utf8'))
    assert.deepEqual(Object.keys(copy), ['alpha', 'zulu'])
  })
})

test('a declared locale with no entry is refused by name, and writing it closes the refusal', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({ locales: ['ar', 'en', 'fr'] })
    const report = await generateMessages({ registry, directory, check: true })
    assert.deepEqual(report.missing, ['mithaq.kinds.text has no "fr".'])
    assert.ok(refusals(report).includes('mithaq.kinds.text has no "fr".'))
    assert.deepEqual(await readdir(directory), [], '--check writes nothing')

    await generateMessages({ registry, directory })
    await writeFile(new URL('mithaq.json', directory), JSON.stringify({ 'kinds.text': { ar: 'نص', en: 'Text', fr: 'Texte' } }, null, 2) + '\n')
    assert.deepEqual(refusals(await generateMessages({ registry, directory, check: true })), [])
  })
})

test("a key the resolver's returned object never carried is refused by name", async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({
      resolved: true,
      scopes: [
        { name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' }, globalType: { ar: 'ن', en: 'G' } } },
        { name: 'project', keys: { 'kinds.text': 'Text' } },
      ],
    })
    const report = await generateMessages({ registry, directory, check: true })
    assert.deepEqual(report.resolver, ['The messages resolver returned no "globalType".'])
    assert.deepEqual(report.unverifiable, ['project.kinds.text is one string the resolver returned, so no locale of it can be verified.'])
  })
})

test('a key two scopes both claim is refused by name, and a field beats the kayan messages that claimed it', async () => {
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'collisions',
        messages: { title: { ar: 'من الرسائل', en: 'From messages' }, error: { forbidden: { ar: 'ممنوع', en: 'Forbidden' } } },
        fields: {
          id: defaultFields.id,
          title: { kind: 'text', label: { ar: 'من الحقل', en: 'From the field' } },
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  assert.deepEqual(messages.collisions, { 'collisions.title': ['field "title" label', 'messages'] })
  const scope = messages.scopes.find((one) => one.name === 'collisions')!
  assert.deepEqual(scope.keys.title, { ar: 'من الحقل', en: 'From the field' }, 'the narrowest scope wins')
  assert.deepEqual(scope.keys['error.forbidden'], { ar: 'ممنوع', en: 'Forbidden' })

  await inTemporary(async (directory) => {
    const report = await generateMessages({ registry: messages, directory, check: true })
    assert.ok(
      refusals(report).includes('"collisions.title" is claimed by field "title" label and messages.'),
      'the collision is one of the lines a check refuses',
    )
  })
})

test('a label written as a function is reported unverifiable rather than refused', async () => {
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'hatches',
        fields: {
          id: defaultFields.id,
          title: { kind: 'text', label: () => 'whatever the project resolved' },
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  await inTemporary(async (directory) => {
    const report = await generateMessages({ registry: messages, directory, check: true })
    assert.deepEqual(report.unverifiable, ['hatches.title is a function, so no locale of it can be verified.'])
    assert.deepEqual(report.missing, [], 'a function has no locale to be short of')
    assert.deepEqual(refusals(report).filter((line) => line.includes('hatches.title')), [])
    await generateMessages({ registry: messages, directory })
    const written = JSON.parse(await readFile(new URL('hatches.json', directory), 'utf8')) as Record<string, unknown>
    assert.equal(written.title, null, 'the function label is a marker rather than a hole')
    // The seeded refusal keys are the kind's and the rules' sentences, not this field's label.
    assert.deepEqual(written['title.invalid'], defaultKinds.text.message)
  })
})

test('a row written before a locale was added is refused by kayan and field, and the first such row ends the scan of that kayan', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({ localized: [{ kayan: 'courses', store: 'drizzle', field: 'title', sort: 'id' }] })
    const whole = [{ id: 1, title: { ar: 'عنوان', en: 'Title' } }]
    // Two un-backfilled rows, so one line rather than two proves the scan stopped at the first: a
    // kayan is refused once, not once per row.
    const part = [...whole, { id: 2, title: { ar: 'عنوان', en: null } }, { id: 3, title: { ar: 'ثالث', en: null } }]
    const backfilled = await generateMessages({ registry, directory, check: true, rows: async () => whole })
    assert.deepEqual(backfilled.data, [])
    assert.deepEqual(refusals(backfilled).filter((line) => line.includes('courses')), [])
    const refused = 'Kayan "courses" field "title" holds a row written before a locale was added, so every read of that kayan fails. Backfill it.'
    const report = await generateMessages({ registry, directory, check: true, rows: async () => part })
    assert.deepEqual(report.data, [refused])
    assert.ok(refusals(report).includes(refused))
  })
})

test("the project's own resolver rides on buildAsas, is called with nothing, and its returned object is one scope of opaque strings", async () => {
  // The project's own i18n. mithaq imports none, so the resolver closes over this the way a
  // paraglide message closes over its own `getLocale`.
  const t = (key: string) => `resolved:${key}`
  // A rest parameter is what observes an argument mithaq did not pass: a
  // zero-argument arrow would report nothing whatever mithaq handed it.
  let handed: unknown[] | undefined
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'resolverProbe',
        fields: { id: defaultFields.id, deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } } },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
    messages: (...args: unknown[]) => {
      handed = args
      return {
        kinds: { text: t('kind.text'), email: t('kind.email'), number: t('kind.number'), integer: t('kind.integer'), decimal: t('kind.decimal'), checkbox: t('kind.checkbox'), datetime: t('kind.datetime'), date: t('kind.date'), textArray: t('kind.text_list'), uuid: t('kind.uuid'), relationship: t('kind.relationship'), upload: t('kind.upload'), richText: t('kind.rich_text'), join: t('kind.join') },
        fields: { id: t('field.id'), updatedAt: t('field.updated'), createdAt: t('field.created'), tenant: t('field.tenant') },
        globalType: t('field.global_type'),
      }
    },
  })
  const project = messages.scopes.find((scope) => scope.name === 'project')!
  assert.deepEqual(handed, [], 'the resolver was called, and with nothing')
  assert.equal(project.keys['kinds.text'], 'resolved:kind.text')
  assert.equal(project.keys.globalType, 'resolved:field.global_type')
  await inTemporary(async (directory) => {
    const report = await generateMessages({ registry: messages, directory, check: true })
    assert.deepEqual(report.resolver, [], 'every key the floor claims came back')
    assert.equal(report.unverifiable.length, Object.keys(project.keys).length)
    await generateMessages({ registry: messages, directory })
    assert.equal(JSON.parse(await readFile(new URL('project.json', directory), 'utf8'))['fields.id'], 'resolved:field.id')
  })
})

test('a language that declares no locales is refused, rather than every record being written empty', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({ locales: [] })
    await assert.rejects(
      () => generateMessages({ registry, directory, check: true }),
      /declares no locales/,
      'a check refuses too, because an empty record file passes every other gate',
    )
    await assert.rejects(() => generateMessages({ registry, directory }), /declares no locales/)
    assert.deepEqual(await readdir(directory), [], 'nothing was written')
  })
})

test('two scopes that resolve to one file are refused naming both, before anything is written', async () => {
  await inTemporary(async (directory) => {
    const both = registryOf({
      scopes: [
        { name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } },
        { name: 'courses', out: 'copy/shared.json', keys: { title: { ar: 'العنوان', en: 'Title' } } },
        { name: 'lessons', out: 'copy/shared.json', keys: { name: { ar: 'الاسم', en: 'Name' } } },
      ],
    })
    await assert.rejects(
      () => generateMessages({ registry: both, directory, root: directory }),
      /Scopes "courses" and "lessons" both write/,
    )
    assert.deepEqual(await readdir(directory), [], 'the refusal comes before the first write')

    const shadow = registryOf({
      scopes: [
        { name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } },
        { name: 'courses', out: 'mithaq.json', keys: { title: { ar: 'العنوان', en: 'Title' } } },
      ],
    })
    await assert.rejects(
      () => generateMessages({ registry: shadow, directory, root: directory }),
      /Scopes "mithaq" and "courses" both write/,
    )
  })
})

test('two scopes whose out differs only in case are refused, because this filesystem holds one file for both', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({
      scopes: [
        { name: 'courses', out: 'copy/Shared.json', keys: { title: { ar: 'العنوان', en: 'Title' } } },
        { name: 'lessons', out: 'copy/shared.json', keys: { name: { ar: 'الاسم', en: 'Name' } } },
      ],
    })
    await assert.rejects(
      () => generateMessages({ registry, directory, root: directory }),
      /Scopes "courses" and "lessons" both write/,
    )
  })
})

test('a copy file that is not JSON is refused by name, rather than read as an empty file and overwritten', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf()
    const broken = '{ "kinds.text": { "ar": "نص", }\n'
    await writeFile(new URL('mithaq.json', directory), broken)
    await assert.rejects(() => generateMessages({ registry, directory }), /mithaq\.json is not a copy file/)
    assert.equal(await readFile(new URL('mithaq.json', directory), 'utf8'), broken, 'the file is left exactly as it is')
    await assert.rejects(() => generateMessages({ registry, directory, check: true }), /mithaq\.json is not a copy file/)
  })
})

test('a later scope whose file does not parse ends the run before the first scope is written, rather than after it', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({
      scopes: [
        { name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } },
        { name: 'courses', keys: { title: { ar: 'العنوان', en: 'Title' } } },
      ],
    })
    const broken = '{ "title": { "ar": "العنوان", }\n'
    await writeFile(new URL('courses.json', directory), broken)
    await assert.rejects(() => generateMessages({ registry, directory }), /courses\.json is not a copy file/)
    assert.deepEqual(await readdir(directory), ['courses.json'], 'the scope before it was not written')
    assert.equal(await readFile(new URL('courses.json', directory), 'utf8'), broken, 'and the broken file is untouched')
  })
})

test('a kayan with no field the store can sort a page by is named whether or not the scan runs, and once for the kayan rather than once for each of its localized fields', async () => {
  // A screen of its own, because `sortable: false` is a fact a screen writes on a field and
  // `test-language.ts` draws no screens.
  const { buildAsas, defineKayan } = dashboardScreen(['allLocalized'])
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'allLocalized',
        // Two localized fields, since the registry holds one entry per field and the sentence names
        // the kayan alone. The id is out of sorting, so no field is left to sort a page by.
        fields: {
          id: { ...defaultFields.id, targets: { dashboard: { sortable: false } } },
          title: { kind: 'text', rules: { localized: true } },
          summary: { kind: 'text', rules: { localized: true } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      defineKayan({ name: 'keeper', fields: { id: defaultFields.id }, targets: { service: { operations: defaultOperations } } }),
    ],
  })
  assert.deepEqual(messages.localized, [
    { kayan: 'allLocalized', store: 'memory', field: 'title', sort: undefined },
    { kayan: 'allLocalized', store: 'memory', field: 'summary', sort: undefined },
  ])
  const sentence =
    'Kayan "allLocalized" has no field the store can sort a page by, so its localized fields cannot be scanned. Give it one field that is not localized.'
  await inTemporary(async (directory) => {
    const registry = registryOf({ localized: messages.localized })
    const skipped = await generateMessages({ registry, directory, check: true })
    assert.deepEqual(skipped.data, [sentence], 'the gap needs no database, so skipping the scan does not hide it')
    assert.ok(refusals(skipped).includes(sentence))
    const scanned = await generateMessages({ registry, directory, check: true, rows: async () => [] })
    assert.deepEqual(scanned.data, [sentence], 'and the scan says it once too, rather than once per localized field')
  })
})

test('a scope names its own out, and the run makes the directory that path needs', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf({
      scopes: [{ name: 'courses', out: 'src/copy/deep/courses.json', keys: { title: { ar: 'العنوان', en: 'Title' } } }],
    })
    const root = new URL('project/', directory)
    assert.deepEqual((await generateMessages({ registry, directory, root, check: true })).changed, ['src/copy/deep/courses.json'])
    assert.deepEqual(await readdir(directory), [], '--check makes no directory either')

    assert.deepEqual((await generateMessages({ registry, directory, root })).changed, ['src/copy/deep/courses.json'])
    assert.deepEqual(JSON.parse(await readFile(new URL('src/copy/deep/courses.json', root), 'utf8')), {
      title: { ar: 'العنوان', en: 'Title' },
    })
    assert.deepEqual((await generateMessages({ registry, directory, root })).changed, [], 'a rerun writes nothing')
  })
})

test('a locale the project deliberately left empty is kept and reported, rather than filled from the shipped copy', async () => {
  await inTemporary(async (directory) => {
    const registry = registryOf()
    await generateMessages({ registry, directory })
    await writeFile(new URL('mithaq.json', directory), `${JSON.stringify({ 'kinds.text': { ar: '', en: 'Text' } }, null, 2)}\n`)
    const report = await generateMessages({ registry, directory, check: true })
    assert.deepEqual(report.changed, [], 'the empty string is what a run would write, so nothing changed')
    assert.deepEqual(report.missing, ['mithaq.kinds.text has no "ar".'])
  })
})

test('a kayan that takes the name of a scope mithaq writes is refused at buildAsas, whether or not it declares any copy', () => {
  for (const name of ['mithaq', 'project']) {
    // No label and no `messages`: the refusal must not depend on a scope being written for the
    // kayan.
    const bare = defineKayan({
      name,
      fields: { deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } } },
      targets: { service: { operations: defaultOperations } },
    })
    // `buildAsas` itself, not the `messages` getter, so a project is told at boot rather than when
    // the CLI asks for its copy.
    assert.throws(() => buildAsas({ http: [fetchHttp()], kayan: [bare, ...accessKayan] }), new RegExp(`Kayan name "${name}" is reserved`))
  }
})

test('the localized scan sorts by a field it can sort by, rather than by whichever field was declared first', () => {
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'notes',
        // The first declared field is the localized one, which `find` refuses
        // to sort by, and the id comes after the one field the scan should take.
        fields: {
          title: { kind: 'text', rules: { localized: true } },
          fee: { kind: 'number' },
          id: defaultFields.id,
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  // `roles` is one of the access kayan, and its label is localized too.
  assert.deepEqual(messages.localized.filter((one) => one.kayan === 'notes'), [{ kayan: 'notes', store: 'drizzle', field: 'title', sort: 'fee' }])
})

test('the messages registry is assembled when it is read, not when the project is built', () => {
  let called = 0
  const built = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'lazyProbe',
        fields: { id: defaultFields.id, deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } } },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
    messages: () => {
      called += 1
      return {
        kinds: { text: 'Text', email: 'Email', number: 'Number', integer: 'Integer', decimal: 'Decimal', checkbox: 'Checkbox', datetime: 'Date and time', date: 'Date', textArray: 'Text list', uuid: 'UUID', relationship: 'Relationship', upload: 'Upload', richText: 'Rich text', join: 'Related rows' },
        fields: { id: 'ID', updatedAt: 'Updated', createdAt: 'Created', tenant: 'Tenant' },
        globalType: 'Global type',
      }
    },
  })
  assert.equal(called, 0, "buildAsas never calls the project's resolver")
  assert.ok(built.messages.scopes.length)
  assert.equal(called, 1)
  assert.equal(built.messages, built.messages, 'a second read is the same registry')
  assert.equal(called, 1)
})

/** One screen's projection, as `asas.targets.<screen>.client` holds it. */
/**
 * The files `screenClient` names, empty, under a project's root: `generateScreens` refuses a bare
 * file the folder behind its glob's base does not hold.
 */
const screenFiles = async (root: URL) => {
  await mkdir(new URL('src/', root), { recursive: true })
  for (const file of ['page', 'shell', 'other']) await writeFile(new URL(`src/${file}.tsx`, root), '')
}
const screenClient = (layout = './src/page.tsx#Page') => ({
  path: '/portal',
  providers: [],
  pages: { home: { path: '/', component: './src/shell.tsx#Home' } },
  nav: [{ path: '/courses', page: 'list', kayan: 'courses', permission: 'courses.find' }],
  layouts: {},
  components: {},
  controls: { text: { control: 'text', cell: 'text' } },
  maxLimit: 100,
  kayan: {
    courses: {
      name: 'courses',
      single: false,
      operations: [],
      fields: [
        { name: 'id', kind: 'uuid', rules: {}, component: 'uuid', cell: 'uuid' },
        { name: 'currency', kind: 'text', rules: { required: true }, component: './src/shell.tsx#Shell', cell: 'text', options: [
          { value: 'SAR', label: { ar: 'ريال', en: 'Riyal' } }, { value: 'USD', label: { ar: 'دولار', en: 'Dollar' } },
        ] },
        { name: 'summary', kind: 'text', rules: {}, component: 'text', cell: 'text' },
        { name: 'names', kind: 'text', rules: { localized: true }, component: 'text', cell: 'text' },
        { name: 'seats', kind: 'integer', rules: { required: true }, component: 'integer', cell: 'integer' },
        { name: 'fee', kind: 'decimal', rules: { precision: 7, scale: 2 }, component: 'decimal', cell: 'decimal' },
      ],
      pages: { list: { path: '/courses', page: { shell: './src/shell.tsx#Shell', main: [{ layout, main: [{ list: { columns: [{ field: 'summary', cell: 'text' }] } }] }] } } },
    },
  },
})

test('generateScreens writes screen.json and types.ts under the folder it is handed, one folder per screen, and --check refuses either stale', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-screens-'))}/`)
  const folder = 'src/routes/(screens)/portal/'
  const client = screenClient()
  const into = new URL('src/routes/(screens)/', root)
  await screenFiles(root)
  try {
    assert.deepEqual((await generateScreens({ root, screens: { portal: client }, into, locales: ['ar', 'en'] })).slice(0, 2), [`${folder}screen.json`, `${folder}types.ts`])
    assert.deepEqual(JSON.parse(await readFile(new URL(`${folder}screen.json`, root), 'utf8')), client, 'the projection verbatim')
    const source = await readFile(new URL(`${folder}types.ts`, root), 'utf8')
    assert.match(source, /export type CoursesValues = \{/)
    assert.match(source, /currency: 'SAR' \| 'USD'/, 'options at the field root narrow the value')
    assert.match(source, /summary: string \| null/)
    assert.match(source, /names: Record<'ar' \| 'en', string> \| null/)
    assert.match(source, /seats: number\n/, 'an integer is a number')
    assert.match(source, /fee: string \| null/, 'and a decimal its exact text')
    assert.match(source, /  id: string\n/, 'the id is never null on a stored row')
    assert.match(source, /export type Pages = \{\n  courses: 'list'\n\}/, 'each kayan\'s page names, which a link is typed against')
    assert.match(source, /export type ScreenClient = Client<Pages>/)
    assert.deepEqual(await generateScreens({ root, screens: { portal: client }, into, locales: ['ar', 'en'], check: true }), [], 'a second run finds nothing stale')
    const grown = { ...client, kayan: { courses: { ...client.kayan.courses, pages: { ...client.kayan.courses.pages, board: { path: '/board', component: './src/page.tsx#Page' } } } } }
    assert.deepEqual(await generateScreens({ root, screens: { portal: grown }, into, locales: ['ar', 'en'], check: true }), [`${folder}screen.json`, `${folder}types.ts`], 'a page added makes both stale')
    assert.match(await readFile(new URL(`${folder}types.ts`, root), 'utf8'), /courses: 'list'\n/, 'and a check writes nothing')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateScreens writes each screen a lazy glob over exactly the files its references name and its three route files, and --check refuses either stale', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-screens-'))}/`)
  const into = new URL('src/routes/(screens)/', root)
  const at = (file: string) => new URL(`src/routes/(screens)/${file}`, root)
  const routes = ['portal.tsx', 'portal.index.tsx', 'portal.$.tsx']
  // One package holding the project and its app, so Vite's root is the project's.
  await writeFile(new URL('package.json', root), '{ "name": "portal-project" }\n')
  await screenFiles(root)
  try {
    assert.deepEqual(await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] }), [
      'src/routes/(screens)/portal/screen.json',
      'src/routes/(screens)/portal/types.ts',
      'src/routes/(screens)/portal/files.ts',
      ...routes.map((file) => `src/routes/(screens)/${file}`),
    ])
    const glob = await readFile(at('portal/files.ts'), 'utf8')
    // Literal, because Vite resolves a glob at build and takes no variable, and
    // keyed off the project's root, so a key is the file half of a reference
    // exactly as `screen.json` prints it.
    assert.match(glob, /export const files = import\.meta\.glob\(\['\.\/src\/page\.tsx', '\.\/src\/shell\.tsx'\], \{ base: '\/' \}\)/, 'off the app\'s root, which is the project\'s own here')
    assert.doesNotMatch(glob, /eager/, 'lazy, so a page loads only the files it draws')
    const frame = await readFile(at('portal.tsx'), 'utf8')
    assert.match(frame, /createFileRoute\('\/\(screens\)\/portal'\)/, 'the route id is the file\'s path under the routes folder, from the screen\'s own path')
    assert.match(frame, /import \{ files \} from '\.\/portal\/files\.ts'/, 'the route imports its screen\'s glob')
    assert.match(await readFile(at('portal.$.tsx'), 'utf8'), /createFileRoute\('\/\(screens\)\/portal\/\$'\)/)
    assert.match(await readFile(at('portal.index.tsx'), 'utf8'), /createFileRoute\('\/\(screens\)\/portal\/'\)/)
    assert.deepEqual(await generateScreens({ root, screens: { portal: screenClient() }, into, check: true, locales: ['ar', 'en'] }), [], 'a second run finds nothing stale')

    assert.deepEqual(
      await generateScreens({ root, screens: { portal: screenClient('./src/other.tsx#Page') }, into, check: true, locales: ['ar', 'en'] }),
      ['src/routes/(screens)/portal/screen.json', 'src/routes/(screens)/portal/files.ts'],
      'a reference to a new file makes the glob stale',
    )
    await rm(at('portal.$.tsx'))
    assert.deepEqual(await generateScreens({ root, screens: { portal: screenClient() }, into, check: true, locales: ['ar', 'en'] }), ['src/routes/(screens)/portal.$.tsx'], 'and a missing route file is stale')

    await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] })

    // A screen whose path changes leaves its old route files behind, still serving the old path, so
    // a write run deletes them.
    const moved = { portal: { ...screenClient(), path: '/members' } }
    assert.deepEqual(
      (await generateScreens({ root, screens: moved, into, check: true, locales: ['ar', 'en'] })).filter((file) => file.includes('portal')).sort(),
      ['src/routes/(screens)/portal/screen.json', ...routes.map((file) => `src/routes/(screens)/${file}`)].sort(),
      'the old route files are stale, and so is the projection that moved',
    )
    await generateScreens({ root, screens: moved, into, locales: ['ar', 'en'] })
    assert.deepEqual(
      (await readdir(new URL('src/routes/(screens)/', root))).sort(),
      ['members.$.tsx', 'members.index.tsx', 'members.tsx', 'portal'],
      'a write run deletes them',
    )
    assert.deepEqual((await generateScreens({ root, screens: {}, into, check: true })).sort(), [
      'src/routes/(screens)/members.$.tsx',
      'src/routes/(screens)/members.index.tsx',
      'src/routes/(screens)/members.tsx',
      'src/routes/(screens)/portal/files.ts',
      'src/routes/(screens)/portal/types.ts',
    ], 'and a screen removed leaves every generated file of its own stale')
    await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] })

    await writeFile(at('portal.$.tsx'), 'export const Route = null\n')
    await assert.rejects(generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] }), /portal\.\$\.tsx was not written by `mithaq generate screens`/, 'a route file of the project\'s own is never overwritten')
    await assert.rejects(
      generateScreens({ root, screens: { portal: screenClient() }, into: new URL('src/screens/', root), locales: ['ar', 'en'] }),
      /src\/screens\/ is under no `routes` folder/,
      'route files are written only where a routes folder holds them',
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateScreens keys a screen served by another app off that app when it holds every file the screen names, and off the project\'s own folder otherwise', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-screens-'))}/`)
  const app = new URL('apps/mobile/', root)
  const into = new URL('src/routes/(screens)/', app)
  const glob = () => readFile(new URL('portal/files.ts', into), 'utf8')
  await writeFile(new URL('package.json', root), '{ "name": "portal-project" }\n')
  await mkdir(new URL('src/', root), { recursive: true })
  for (const file of ['src/page.tsx', 'src/shell.tsx']) await writeFile(new URL(file, root), '')
  await mkdir(new URL('src/', app), { recursive: true })
  await writeFile(new URL('package.json', app), '{ "name": "mobile" }\n')
  try {
    await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] })
    // The project's real folder from the screen's, which every package manager agrees on wherever it links the project.
    assert.match(await glob(), /\{ base: '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/', exhaustive: true \}/, 'the files are the project\'s, read from its own folder')
    await writeFile(new URL('src/page.tsx', app), 'export const Page = () => null\n')
    await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] })
    // Files a screen prints bare are one package's, since a file of any other package prints its
    // package's name; an app holding one at the same path gives no reason to read it as the app's.
    assert.match(await glob(), /\{ base: '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/', exhaustive: true \}/, 'the app holding some of them is not the app holding them')
    await writeFile(new URL('src/shell.tsx', app), 'export const Shell = () => null\nexport const Home = () => null\n')
    await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] })
    assert.match(await glob(), /\['\.\/src\/page\.tsx', '\.\/src\/shell\.tsx'\], \{ base: '\/' \}\)/, 'every file is the app\'s own')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateScreens refuses a screen whose root page is drawn from a third package where the app is the project, since its bare files are in neither', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-screens-'))}/`)
  const into = new URL('src/routes/(screens)/', root)
  await writeFile(new URL('package.json', root), '{ "name": "portal-project" }\n')
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(new URL('src/page.tsx', root), '')
  try {
    await assert.rejects(
      generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'], check: true }),
      /The portal screen's root page is drawn from a package that is neither the app serving it nor the project: \.\/src\/shell\.tsx is in neither\./,
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateScreens keys each package a screen names off its own base, and merges them into one record keyed as the references print them', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-screens-'))}/`)
  const app = new URL('apps/mobile/', root)
  const into = new URL('src/routes/(screens)/', app)
  await writeFile(new URL('package.json', root), '{ "name": "portal-project" }\n')
  await mkdir(new URL('src/', root), { recursive: true })
  for (const file of ['src/page.tsx', 'src/shell.tsx']) await writeFile(new URL(file, root), '')
  await mkdir(new URL('src/', app), { recursive: true })
  await writeFile(new URL('package.json', app), '{ "name": "mobile" }\n')
  // Linked where npm, yarn and a hoisted Bun put a workspace package: at the root, not under the app.
  await mkdir(new URL('packages/centers/', root), { recursive: true })
  await mkdir(new URL('node_modules/@cr/', root), { recursive: true })
  await symlink(fileURLToPath(new URL('packages/centers/', root)), fileURLToPath(new URL('node_modules/@cr/centers', root)))
  const client = { ...screenClient(), components: { own: 'mobile:./src/own.tsx#Own', center: '@cr/centers:./src/center.tsx#Center' } }
  try {
    await generateScreens({ root, screens: { portal: client }, into, locales: ['ar', 'en'] })
    assert.equal(await readFile(new URL('portal/files.ts', into), 'utf8'), `// Written by \`mithaq generate screens\`. Do not edit.
/// <reference types="vite/client" />
// Every file the \`portal\` screen's references name, each loaded when a page draws it, keyed as the reference prints it.
const named = (name: string, files: Record<string, () => Promise<unknown>>) => Object.fromEntries(Object.entries(files).map(([file, load]) => [\`\${name}:\${file}\`, load]))
export const files = {
  ...import.meta.glob(['./src/page.tsx', './src/shell.tsx'], { base: '../../../../../../', exhaustive: true }),
  ...named('@cr/centers', import.meta.glob(['./src/center.tsx'], { base: '../../../../../../packages/centers/', exhaustive: true })),
  ...named('mobile', import.meta.glob(['./src/own.tsx'], { base: '/' })),
}
`)
    await assert.rejects(
      generateScreens({ root, screens: { portal: { ...client, components: { gone: '@cr/gone:./src/gone.tsx#Gone' } } }, into, locales: ['ar', 'en'] }),
      /The portal screen names files of @cr\/gone, which no node_modules in the project holds\. Install it in the app\./,
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generateScreens reads an installed package through its node_modules link, never its store path, and only what the project holds', async () => {
  // The project in a folder of its own, so a package installed above it can be put where the walk must not reach.
  const outer = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-screens-'))}/`)
  const elsewhere = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-store-'))}/`)
  const root = new URL('project/', outer)
  const app = new URL('apps/mobile/', root)
  const into = new URL('src/routes/(screens)/', app)
  const files = () => readFile(new URL('portal/files.ts', into), 'utf8')
  const link = async (name: string, target: URL) => {
    await mkdir(new URL(`${name}/src/`, target), { recursive: true })
    await writeFile(new URL(`${name}/src/center.tsx`, target), '')
    await mkdir(new URL(`node_modules/${name.slice(0, name.indexOf('/'))}/`, app), { recursive: true })
    await symlink(fileURLToPath(new URL(name, target)), fileURLToPath(new URL(`node_modules/${name}`, app)))
  }
  await mkdir(new URL('src/', app), { recursive: true })
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(new URL('package.json', root), '{ "name": "portal-project" }\n')
  await writeFile(new URL('package.json', app), '{ "name": "mobile" }\n')
  for (const file of ['src/page.tsx', 'src/shell.tsx']) await writeFile(new URL(file, root), '')
  const naming = (name: string) => ({ ...screenClient(), components: { center: `${name}:./src/center.tsx#Center` } })
  try {
    // pnpm's store, whose folder names the version and a hash of the peers, and pnpm's global store outside the project.
    await link('@cr/centers', new URL('node_modules/.pnpm/@cr+centers@1.0.0_abc123/node_modules/', root))
    await link('@cr/far', elsewhere)
    await generateScreens({ root, screens: { portal: naming('@cr/centers') }, into, locales: ['ar', 'en'] })
    assert.match(await files(), /named\('@cr\/centers', import\.meta\.glob\(\['\.\/src\/center\.tsx'\], \{ base: '\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/@cr\/centers\/', exhaustive: true \}\)\)/)
    await generateScreens({ root, screens: { portal: naming('@cr/far') }, into, locales: ['ar', 'en'] })
    assert.match(await files(), /\{ base: '\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/@cr\/far\/', exhaustive: true \}/)
    await mkdir(new URL('node_modules/@cr/above/src/', outer), { recursive: true })
    await assert.rejects(
      generateScreens({ root, screens: { portal: naming('@cr/above') }, into, locales: ['ar', 'en'] }),
      /The portal screen names files of @cr\/above, which no node_modules in the project holds\./,
      'the walk stops at the project, so a package installed above it is not read',
    )
  } finally {
    await rm(outer, { recursive: true })
    await rm(elsewhere, { recursive: true })
  }
})

test('packageOf answers no package for a file under a Windows drive root that no package.json sits above, rather than walking up forever', async () => {
  // `new URL('../', 'file:///C:/')` is `file:///C:/` again on every platform,
  // so a walk that waits for the pathname `/` never ends there. The walk runs
  // in a child the test kills, so a regression fails here instead of hanging.
  const source = `import { packageOf } from ${JSON.stringify(new URL('../../../packages/mithaq/src/screen/index.ts', import.meta.url).href)}; process.stdout.write(String(packageOf(new URL('file:///C:/outside/any/package/Page.tsx'))))`
  const answered = await new Promise<string>((resolve, reject) =>
    execFile(process.execPath, ['--input-type=module', '-e', source], { timeout: 10_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  )
  assert.equal(answered, 'undefined')
})

test('a project generated before the studio was removed loses its old _studio route in one run of generateScreens', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-screens-'))}/`)
  const into = new URL('src/routes/(screens)/', root)
  await writeFile(new URL('package.json', root), '{ "name": "portal-project" }\n')
  await screenFiles(root)
  try {
    await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] })
    const old = new URL('portal_.[_studio].tsx', into)
    await writeFile(old, `// Written by \`mithaq generate screens\`. Do not edit.
import { createFileRoute } from '@tanstack/react-router'
import { StudioView, studioGate, studioLoader } from '@/screens.tsx'
import { files } from './portal/files.ts'
export const Route = createFileRoute('/(screens)/portal_/_studio')({
  loader: ({ location, context }) => studioLoader({ screen: 'portal', files, search: location.search, locale: context.locale }),
  component: () => <StudioView files={files} data={Route.useLoaderData()} />,
})
`)
    assert.deepEqual(await generateScreens({ root, screens: { portal: screenClient() }, into, locales: ['ar', 'en'] }), ['src/routes/(screens)/portal_.[_studio].tsx'], 'the old route is the one stale file')
    assert.deepEqual((await readdir(into)).sort(), ['portal', 'portal.$.tsx', 'portal.index.tsx', 'portal.tsx'], 'and one run deletes it')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq generate screens` writes each screen\'s files under generate.screens, and --check is green once they are written', async () => {
  const root = await projectOf(`export const asas = { targets: { portal: { capability: 'screen', client: ${JSON.stringify(screenClient())} } } }
`)
  try {
    const wrote = await command(root, 'generate', 'screens')
    assert.equal(wrote.code, 0, wrote.stderr)
    assert.match(wrote.stdout, /Wrote src\/routes\/\(screens\)\/portal\/screen\.json, src\/routes\/\(screens\)\/portal\/types\.ts, .*portal\.\$\.tsx\./)
    const again = await command(root, 'generate', 'screens', '--check')
    assert.equal(again.code, 0, again.stderr)
    assert.match(again.stdout, /Screens are up to date\./)
    await writeFile(new URL('src/mithaq.ts', root), "export const generate = { messages: 'src/messages/' }\n")
    const unnamed = await command(root, 'generate', 'screens')
    assert.notEqual(unnamed.code, 0, 'a project naming no generate.screens is refused')
    assert.match(unnamed.stderr, /writes under the folder `generate\.screens` names in src\/mithaq\.ts, and it names none/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq generate screens` writes each screen into the folder generate.screens names for it, where the screens are served by more than one app', async () => {
  const platform = { ...screenClient(), path: '/platform' }
  const root = await projectOf(`export const asas = { targets: {
  portal: { capability: 'screen', client: ${JSON.stringify(screenClient())} },
  platform: { capability: 'screen', client: ${JSON.stringify(platform)} },
} }
`)
  try {
    await writeFile(
      new URL('src/mithaq.ts', root),
      "export const generate = { messages: 'src/messages/', screens: { portal: 'tenant/src/routes/(screens)/', platform: 'staff/src/routes/(screens)/' } }\n",
    )
    const wrote = await command(root, 'generate', 'screens')
    assert.equal(wrote.code, 0, wrote.stderr)
    const under = async (folder: string) => (await readdir(new URL(folder, root))).sort()
    assert.deepEqual(await under('tenant/src/routes/(screens)/'), ['portal', 'portal.$.tsx', 'portal.index.tsx', 'portal.tsx'], 'the tenant app holds the portal and no other screen')
    assert.deepEqual(await under('staff/src/routes/(screens)/'), ['platform', 'platform.$.tsx', 'platform.index.tsx', 'platform.tsx'], 'the staff app holds the platform and no other screen')
    const again = await command(root, 'generate', 'screens', '--check')
    assert.equal(again.code, 0, again.stderr)
    await writeFile(new URL('src/mithaq.ts', root), "export const generate = { messages: 'src/messages/', screens: { portal: 'tenant/src/routes/(screens)/' } }\n")
    const unnamed = await command(root, 'generate', 'screens')
    assert.notEqual(unnamed.code, 0, 'a screen generate.screens names no folder for is refused')
    assert.match(unnamed.stderr, /generate\.screens names no folder for the screen platform/)
    // A project with no app serving the platform screen says so, and nothing is written for it.
    await rm(new URL('staff/', root), { recursive: true })
    await writeFile(new URL('src/mithaq.ts', root), "export const generate = { messages: 'src/messages/', screens: { portal: 'tenant/src/routes/(screens)/', platform: false } }\n")
    const unserved = await command(root, 'generate', 'screens')
    assert.equal(unserved.code, 0, unserved.stderr)
    await assert.rejects(readdir(new URL('staff/', root)), 'no folder is made for a screen no app serves')
    assert.equal((await command(root, 'generate', 'screens', '--check')).code, 0)
  } finally {
    await rm(root, { recursive: true })
  }
})

/**
 * A project as the command reads one: the two modules `run` imports, and an `asas` whose store the
 * test sets.
 */
const projectOf = async (asas: string) => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-project-'))}/`)
  await mkdir(new URL('src/', root))
  await writeFile(new URL('src/mithaq.ts', root), "export const generate = { messages: 'src/messages/', screens: 'src/routes/(screens)/' }\n")
  await writeFile(new URL('src/asas.ts', root), asas)
  await screenFiles(root)
  return root
}

/** `run` reports to the console, and a passing test should not read as a failing one. */
const quietly = async (call: () => Promise<number>) => {
  const { error, log } = console
  Object.assign(console, { error: () => {}, log: () => {} })
  try {
    return await call()
  } finally {
    Object.assign(console, { error, log })
  }
}

test('a no-source copy entry tells a person to delete it on checks and writes', async () => {
  const root = await projectOf(`export const asas = {
  messages: {
    locales: ['ar', 'en'],
    scopes: [
      { name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } },
      { name: 'courses', keys: { title: { ar: 'العنوان', en: 'Title' } } },
    ],
    collisions: {}, resolved: false, localized: [],
  },
  targets: {}, connect: async () => {}, destroy: async () => {},
}
`)
  try {
    const directory = new URL('src/messages/', root)
    await mkdir(directory)
    await writeFile(new URL('mithaq.json', directory), `${JSON.stringify({ 'kinds.text': { ar: 'نص', en: 'Text' } }, null, 2)}\n`)
    const courses = { 'createdAt.required': { ar: 'x', en: 'y' }, title: { ar: 'العنوان', en: 'Title' } }
    await writeFile(new URL('courses.json', directory), `${JSON.stringify(courses, null, 2)}\n`)
    const sentence = 'courses.createdAt.required is an entry with no source. Delete it; a run keeps it.'
    const checked = await command(root, 'generate', 'messages', '--check')
    assert.equal(checked.code, 1)
    assert.equal(checked.stderr, `${sentence}\n`)

    const written = await command(root, 'generate', 'messages')
    assert.equal(written.code, 0)
    assert.ok(written.stdout.includes(sentence))
    assert.deepEqual(JSON.parse(await readFile(new URL('courses.json', directory), 'utf8')), courses)

    await writeFile(new URL('courses.json', directory), `${JSON.stringify({ 'createdAt.required': courses['createdAt.required'] }, null, 2)}\n`)
    const otherGap = await command(root, 'generate', 'messages', '--check')
    assert.equal(otherGap.code, 1)
    assert.match(otherGap.stderr, /courses\.json is not what a run would write\./)
    assert.match(otherGap.stderr, /Run `mithaq generate messages`\./)

    // An empty locale is a person's to fill: a run keeps it empty, so the check
    // does not send the person to one.
    courses.title.ar = ''
    await writeFile(new URL('courses.json', directory), `${JSON.stringify(courses, null, 2)}\n`)
    const emptyAr = await command(root, 'generate', 'messages', '--check')
    assert.equal(emptyAr.code, 1)
    assert.match(emptyAr.stderr, /courses\.title has no "ar"\./)
    assert.doesNotMatch(emptyAr.stderr, /Run `mithaq generate messages`/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a check that cannot reach the database fails, and a project with no database says so with a flag', async () => {
  const root = await projectOf(`export const asas = {
  messages: {
    locales: ['ar', 'en'],
    scopes: [{ name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } }],
    collisions: {},
    resolved: false,
    localized: [{ kayan: 'notes', store: 'drizzle', field: 'title', sort: 'id' }],
  },
  targets: { drizzle: { find: async () => ({ docs: [] }) } },
  connect: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432') },
  destroy: async () => {},
}
`)
  try {
    assert.equal(await quietly(() => run({ project: root, check: false })), 0, 'a write needs no database')
    assert.equal(await quietly(() => run({ project: root, check: true })), 1, 'a check that could not scan is a failed check')
    assert.equal(await quietly(() => run({ project: root, check: true, dataScan: false })), 0, '--no-data-scan is the project saying it has none')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a store error during the scan fails the check rather than crashing the command', async () => {
  const root = await projectOf(`export const asas = {
  messages: {
    locales: ['ar', 'en'],
    scopes: [{ name: 'mithaq', keys: { 'kinds.text': { ar: 'نص', en: 'Text' } } }],
    collisions: {},
    resolved: false,
    localized: [{ kayan: 'notes', store: 'drizzle', field: 'title', sort: 'id' }],
  },
  targets: { drizzle: { find: async () => { throw new Error('relation "notes" does not exist') } } },
  connect: async () => {},
  destroy: async () => {},
}
`)
  try {
    assert.equal(await quietly(() => run({ project: root, check: true })), 1)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a refusal closes the connection the scan opened, rather than throwing past destroy', async () => {
  const root = await projectOf(`export const calls = { destroyed: 0 }
export const asas = {
  messages: {
    locales: ['ar', 'en'],
    scopes: [
      { name: 'courses', out: 'copy/Shared.json', keys: { title: { ar: 'العنوان', en: 'Title' } } },
      { name: 'lessons', out: 'copy/shared.json', keys: { name: { ar: 'الاسم', en: 'Name' } } },
    ],
    collisions: {},
    resolved: false,
    localized: [{ kayan: 'notes', store: 'drizzle', field: 'title', sort: 'id' }],
  },
  targets: { drizzle: { find: async () => ({ docs: [] }) } },
  connect: async () => {},
  destroy: async () => { calls.destroyed += 1 },
}
`)
  try {
    // The duplicate path is refused after the scan has connected, the ordering that leaves a
    // connection open when the throw escapes.
    await assert.rejects(() => quietly(() => run({ project: root, check: true })), /both write/)
    const { calls } = (await import(new URL('src/asas.ts', root).href)) as { calls: { destroyed: number } }
    assert.equal(calls.destroyed, 1)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a synchronous throw from destroy does not escape the finally and mask the refusal it exists to preserve', async () => {
  // `destroy` is not `async` here, so its throw is synchronous and a `.catch()` on its return never
  // sees it.
  const root = await projectOf(`export const asas = {
  messages: {
    locales: ['ar', 'en'],
    scopes: [
      { name: 'courses', out: 'copy/Shared.json', keys: { title: { ar: 'العنوان', en: 'Title' } } },
      { name: 'lessons', out: 'copy/shared.json', keys: { name: { ar: 'الاسم', en: 'Name' } } },
    ],
    collisions: {},
    resolved: false,
    localized: [{ kayan: 'notes', store: 'drizzle', field: 'title', sort: 'id' }],
  },
  targets: { drizzle: { find: async () => ({ docs: [] }) } },
  connect: async () => {},
  destroy: () => { throw new Error('the connection was already gone') },
}
`)
  try {
    await assert.rejects(
      () => quietly(() => run({ project: root, check: true })),
      /both write/,
      'the refusal is what the caller sees, rather than whatever destroy threw over it',
    )
  } finally {
    await rm(root, { recursive: true })
  }
})
const command = (cwd: URL, ...argv: string[]) => commandIn(cwd, process.env, argv)
/**
 * The core package by path, so a temporary project imports the real `drizzleAdapter`: the commands
 * the bin dispatches live on the target the adapter returns, so a stand-in proves nothing about
 * dispatch.
 */
const core = new URL('../../../packages/mithaq/src/index.ts', import.meta.url).href
const memory = new URL('memory-store.ts', import.meta.url).href

/**
 * The module holding a build's resolved declarations, where `mithaq rbac assign` reads a kayan's
 * store from. Reached by path because it is the build's internal metadata and no export of
 * `mithaq`.
 */
const resolved = new URL('../../../packages/mithaq/src/mithaq/types.ts', import.meta.url).href

const rbacCommandProject = (options: { audit?: boolean; failCommit?: boolean; member?: boolean; memberStore?: 'primary' | 'memory'; serviceStore?: 'primary' | 'secondary'; owned?: boolean } = {}) => projectOf(`import { rbacTarget } from '${core}'
import { resolvedKayans } from '${resolved}'
import { memoryStore } from '${memory}'
const primary = {
  capability: 'store',
  transaction: async (run) => {
    const result = await run({})
    ${options.failCommit ? "throw new Error('commit failed')" : "console.log('committed'); return result"}
  },
  find: async ({ kayan }) => ({ docs: kayan === 'member' ? [{ id: 'membership' }] : [] }),
  insert: async ({ data }) => ({ id: 'assignment', ...data }),
}
const secondary = { capability: 'store', transaction: async () => { throw new Error('wrong store') } }
export const asas = {
  targets: {
    primary, secondary, memory: memoryStore(),
    service: { capability: 'service', store: '${options.serviceStore ?? 'secondary'}'${options.audit ? ", audit: async (entry) => console.log('sink:' + JSON.stringify({ operation: entry.operation, dataAfter: entry.dataAfter.id, organization: entry.dataAfter.organization, actor: entry.user, store: entry.store === primary, tx: !!entry.tx, kayan: entry.kayan.name, context: entry.context, frozen: Object.isFrozen(entry.context) }))" : ''} },
    rbac: rbacTarget({ roles: { administrator: { label: { en: 'Administrator' }, permissions: '*' } }, access: {}, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }),
  },
  destroy: async () => { console.log('destroyed') },
}
resolvedKayans.set(asas, { memberRoles: { name: 'memberRoles', store: 'primary'${options.owned === false ? '' : ", tenant: 'organization'"} }${options.member === false ? '' : `, member: { name: 'member', store: '${options.memberStore ?? 'primary'}' }`} })
`)

test('rbac assign uses its assignment kayan store and closes the project', async () => {
  const root = await rbacCommandProject()
  try {
    const result = await command(root, 'rbac', 'assign', '--tenant', 'org', '--user', 'person', '--role', 'administrator')
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /committed/)
    assert.match(result.stdout, /destroyed/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('rbac assign refuses an assignment kayan that places no field bound to the tenant, and writes nothing', async () => {
  const root = await rbacCommandProject({ owned: false })
  try {
    const result = await command(root, 'rbac', 'assign', '--tenant', 'org', '--user', 'person', '--role', 'administrator')
    assert.equal(result.code, 1)
    assert.match(result.stderr, /kayan "memberRoles" places no field bound to the tenant target/)
    assert.doesNotMatch(result.stdout, /committed/)
    assert.match(result.stdout, /destroyed/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('rbac assign calls the service audit sink inside the transaction and reports success after commit', async () => {
  const root = await rbacCommandProject({ audit: true, serviceStore: 'primary' })
  try {
    const result = await command(root, 'rbac', 'assign', '--tenant', 'org', '--user', 'person', '--role', 'administrator')
    assert.equal(result.code, 0, result.stderr)
    const lines = result.stdout.trim().split('\n')
    assert.match(lines[0]!, /^sink:/)
    assert.deepEqual(JSON.parse(lines[0]!.slice(5)), {
      operation: 'assign', dataAfter: 'assignment', organization: 'org', actor: { command: 'mithaq rbac assign', osUser: userInfo().username },
      store: true, tx: true, kayan: 'memberRoles',
      context: { depth: 1, source: 'cli', chain: ['memberRoles.assign'] }, frozen: true,
    })
    assert.equal(lines[1], 'committed')
    assert.deepEqual(JSON.parse(lines[2]!), { actor: { command: 'mithaq rbac assign', osUser: userInfo().username }, tenant: 'org', user: 'person', role: 'administrator' })
  } finally {
    await rm(root, { recursive: true })
  }
})

test('rbac assign prints no success line if commit fails and still destroys the project', async () => {
  const root = await rbacCommandProject({ failCommit: true, serviceStore: 'primary' })
  try {
    const result = await command(root, 'rbac', 'assign', '--tenant', 'org', '--user', 'person', '--role', 'administrator')
    assert.equal(result.code, 1)
    assert.equal(result.stdout, 'destroyed\n')
    assert.match(result.stderr, /commit failed/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('rbac assign names a missing provider member kayan', async () => {
  const root = await rbacCommandProject({ member: false, serviceStore: 'primary' })
  try {
    const result = await command(root, 'rbac', 'assign', '--tenant', 'org', '--user', 'person', '--role', 'administrator')
    assert.equal(result.code, 1)
    assert.match(result.stderr, /requires the provider "member" kayan/)
    assert.equal(result.stdout, 'destroyed\n')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('rbac assign refuses a provider member kayan in another store than the assignment', async () => {
  const root = await rbacCommandProject({ memberStore: 'memory', serviceStore: 'primary' })
  try {
    const result = await command(root, 'rbac', 'assign', '--tenant', 'org', '--user', 'person', '--role', 'administrator')
    assert.equal(result.code, 1)
    assert.match(result.stderr, /"member" is in store "memory" and kayan "memberRoles" is in store "primary"/)
    assert.equal(result.stdout, 'destroyed\n')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('the bin prints a designed refusal as its sentence alone, and leaves the stack of a genuine failure exactly as it was', async () => {
  const refusing = await projectOf(`export const asas = {
  messages: { locales: [], scopes: [], collisions: {}, resolved: false, localized: [] },
  targets: {},
  connect: async () => {},
  destroy: async () => {},
}
`)
  // A project's own `src/asas.ts` failing to import is the commonest real failure, and the one case
  // where the stack is the whole diagnosis.
  const crashing = await projectOf("throw new Error('src/asas.ts could not be imported')\n")
  try {
    const refused = await command(refusing, 'generate', 'messages', '--check')
    assert.equal(refused.code, 1)
    assert.equal(
      refused.stderr,
      'The language declares no locales, so `mithaq generate messages` has nothing to write a copy file against.\n',
      'the sentence and nothing else: no `Error:` prefix and no stack',
    )

    const crashed = await command(crashing, 'generate', 'messages', '--check')
    assert.equal(crashed.code, 1)
    assert.match(crashed.stderr, /src\/asas\.ts could not be imported/)
    assert.match(crashed.stderr, /\n\s+at /, 'and its stack, which is the whole of what a developer debugs it from')
  } finally {
    await rm(refusing, { recursive: true })
    await rm(crashing, { recursive: true })
  }
})

/**
 * The whole database as text, the schemas, the history table and every row,
 * through `pg_dump`. It runs inside the container that publishes the port
 * DATABASE_URL names, so the dump is the server's own version, or from PATH
 * when no container does. The `\restrict` pair newer `pg_dump` releases
 * wrap a dump in carries a key drawn fresh on every run, so it is left out.
 */
const dumpOf = async () => {
  const url = new URL(migrateEnv.DATABASE_URL!)
  const output = (file: string, argv: string[]) =>
    new Promise<string>((resolve, reject) =>
      execFile(file, argv, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout))))
  const listed = await output('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}']).catch(() => '')
  const container = listed.split('\n').find((line) => line.includes(`:${url.port || '5432'}->`))?.split('\t')[0]
  const dump = container
    ? await output('docker', ['exec', container, 'pg_dump', '-U', decodeURIComponent(url.username), migrateName])
    : await output('pg_dump', [url.href])
  return dump.replace(/^\\(un)?restrict .*\n/gm, '')
}

/**
 * A migration project the whole `generate --check` sweep runs in: a language
 * with every `generate` path, and a localized field, which is what makes the
 * message scan read the database.
 */
const sweepProject = async (fields = withSummary) => {
  const root = await migrationProject(`${fields}\n        title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' }, rules: { localized: true } },`)
  await writeFile(
    new URL('src/mithaq.ts', root),
    `import { base, defineMithaq } from '${core}'
export const { defineKayan, generate } = defineMithaq({
  arkan: [base],
  targets: {},
  generate: { migrations: 'src/migrations/', messages: 'src/messages/', auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../auth.ts', screens: 'src/routes/' },
})
`,
  )
  await writeFile(new URL('src/auth.ts', root), 'export const providers = {}\n')
  // The template's screens draw their pages from the template's own `src/`, and a screen's bare
  // files are globbed off the app or the project, which refuses them anywhere else, so the project
  // holds those folders as links.
  for (const folder of ['audit-log', 'courses', 'enrollments', 'media', 'roles', 'ui', 'ui-dashboard', 'ui-platform', 'ui-portal']) {
    await symlink(fileURLToPath(new URL(`${folder}/`, import.meta.url)), fileURLToPath(new URL(`src/${folder}`, root)))
  }
  return root
}
const generated = async (root: URL) => {
  for (const argv of [['migrate'], ['generate', 'auth'], ['generate', 'messages'], ['generate', 'screens']]) {
    const wrote = await migrating(root, ...argv)
    assert.equal(wrote.code, 0, `${argv.join(' ')}: ${wrote.stderr}`)
  }
}
const freshDatabase = 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;'

test('`mithaq generate --check` reads a migrated database and writes nothing to it, twice over, and a fresh one fails at `migrate`, naming the folder it has not applied', async (t) => {
  await migrateDatabase()
  const root = await sweepProject()
  const migrations = new URL('src/migrations/', root)
  try {
    await sqlIn(root, freshDatabase)
    await generated(root)
    const [folder] = await foldersIn(root)

    // The fresh database a CI job starts from has applied nothing, so the
    // sweep stops at the drift check, before any data scan, and says how.
    const empty = await dumpOf()
    const unmigrated = await migrating(root, 'generate', '--check')
    assert.equal(unmigrated.code, 1, unmigrated.stderr)
    assert.match(unmigrated.stderr, new RegExp(`This database has not applied ${folder}\\.`))
    assert.match(unmigrated.stderr, /`mithaq drizzle migrate --check` answered 1, so the sweep stopped there\./)
    assert.equal(await dumpOf(), empty, 'the refused sweep created nothing')

    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, `insert into notes (id, summary) values ('kept', 'a value')`), 0)
    const migrated = await dumpOf()
    for (const pass of ['first', 'second']) {
      const swept = await migrating(root, 'generate', '--check')
      assert.equal(swept.code, 0, `${pass}: ${swept.stderr}`)
      assert.match(swept.stdout, /The database schema is up to date\./, `${pass}: the drift check ran in the sweep`)
      assert.equal(await dumpOf(), migrated, `the ${pass} sweep pushed nothing, marked nothing and seeded nothing`)
    }

    await sqlIn(root, freshDatabase)
    await rm(new URL(`${folder}/`, migrations), { recursive: true })
    const stale = await migrating(root, 'generate', '--check')
    assert.notEqual(stale.code, 0, 'a migration the kayan need and the folder lacks fails the sweep')
    assert.match(stale.stderr, /`mithaq drizzle migrate --check` answered 1, so the sweep stopped there\./)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a database one migration behind fails `migrate --check` and the sweep, naming the folder, and neither applies its SET NOT NULL nor marks the database', async (t) => {
  await migrateDatabase()
  const root = await sweepProject()
  try {
    await sqlIn(root, freshDatabase)
    await generated(root)
    const applied = await appliedIn(root)
    assert.equal(applied.code, 0, applied.output)
    assert.equal(await sqlIn(root, `insert into notes (id, summary) values ('kept', 'a value')`), 0)
    const required = await sweepProject("        id: { kind: 'text' },\n        summary: { kind: 'text', rules: { required: true } },")
    await writeFile(new URL('src/asas.ts', root), await readFile(new URL('src/asas.ts', required), 'utf8'))
    await rm(required, { recursive: true })
    const wrote = await migrating(root, 'migrate')
    assert.equal(wrote.code, 0, wrote.stderr)
    const [, behind] = await foldersIn(root)
    assert.ok(behind, 'a second migration was written')

    const before = await dumpOf()
    for (const argv of [['migrate', '--check'], ['generate', '--check']]) {
      const checked = await migrating(root, ...argv)
      assert.equal(checked.code, 1, `${argv.join(' ')}: ${checked.stdout}${checked.stderr}`)
      assert.match(checked.stderr, new RegExp(`This database has not applied ${behind}\\.`))
      assert.match(checked.stderr, /drizzle-kit migrate --config src\/migrations\/drizzle\.config\.ts/)
      assert.equal(await dumpOf(), before, `${argv.join(' ')} changed nothing`)
    }
    assert.equal(
      await sqlIn(root, `do $$ begin
        assert (select is_nullable from information_schema.columns where table_name = 'notes' and column_name = 'summary') = 'YES';
        assert (select count(*) from drizzle.__mithaq_migrations where name = 'mithaq_dev_push') = 0;
      end $$;`),
      0,
      'no SET NOT NULL applied and no marker written',
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate` and its check count, per field, the stored rows a rule or option declared since would refuse on their next save, read-only and without changing the exit', async (t) => {
  await migrateDatabase()
  const loose = [
    "        id: { kind: 'text' },",
    "        code: { kind: 'text' },",
    "        level: { kind: 'number' },",
    "        topics: { kind: 'textArray' },",
    "        status: { kind: 'text' },",
    "        title: { kind: 'text', rules: { localized: true } },",
    "        name: { kind: 'text' },",
  ].join('\n')
  const root = await migrationProject(loose)
  await sqlIn(root, 'drop schema public cascade; create schema public; drop schema if exists drizzle cascade;')
  assert.equal((await migrating(root, 'migrate')).code, 0)
  assert.equal((await appliedIn(root)).code, 0)
  // One row breaks every rule of the stricter release below; one holds nothing at all, which no
  // rule but `required` judges.
  assert.equal(await sqlIn(root, `insert into notes (id, code, level, topics, status, title_ar, title_en, name) values
    ('a', 'no', 9, array['x', 'y', 'z'], 'gone', 'عنوان', 'x', ' x'),
    ('b', 'fine', 1, array['x'], 'draft', 'عنوان', 'title', 'name'),
    ('c', null, null, null, null, null, null, null)`), 0)

  const label = "{ ar: 'x', en: 'x' }"
  await writeFile(new URL('src/asas.ts', root), kayanSourceOf([
    "        id: { kind: 'text' },",
    "        code: { kind: 'text', rules: { minLength: 3, pattern: /^[a-z]+$/ } },",
    "        level: { kind: 'number', rules: { max: 5 } },",
    `        topics: { kind: 'textArray', rules: { maxRows: 2 }, options: [{ value: 'x', label: ${label} }, { value: 'y', label: ${label} }] },`,
    `        status: { kind: 'text', options: [{ value: 'draft', label: ${label} }, { value: 'live', label: ${label} }] },`,
    // A localized field's rule is each locale's, so one short locale is a
    // refusal; a transform rewrites the value before its length is judged, so
    // that length is not counted.
    "        title: { kind: 'text', rules: { localized: true, minLength: 2 } },",
    "        name: { kind: 'text', rules: { trim: true, minLength: 2 } },",
  ].join('\n')))

  for (const argv of [['migrate', '--check'], ['migrate']]) {
    const ran = await migrating(root, ...argv)
    assert.equal(ran.code, 0, `${argv.join(' ')} exits as it did, since none of these rules changes a column: ${ran.stderr}`)
    assert.match(ran.stdout, /The database schema is up to date\./, ran.stderr)
    assert.match(ran.stdout, /^notes\.code: 1 stored row breaks minLength\. Each is refused on its next save until it complies\.$/m, ran.stderr)
    assert.match(ran.stdout, /^notes\.level: 1 stored row breaks max\./m)
    assert.match(ran.stdout, /^notes\.topics: 1 stored row breaks maxRows, 1 breaks options\./m)
    assert.match(ran.stdout, /^notes\.status: 1 stored row breaks options\./m)
    assert.match(ran.stdout, /^notes\.title: 1 stored row breaks minLength\./m)
    assert.doesNotMatch(ran.stdout, /^notes\.name:/m)
    assert.match(ran.stdout, /^Not counted, since SQL cannot judge them the way the schema does: notes\.code pattern, notes\.name minLength \(trim\)\.$/m)
    assert.doesNotMatch(ran.stdout, /gone|'no'/, 'counts only, never a value')
  }
  assert.equal(
    await sqlIn(root, `do $$ begin assert (select count(*) from notes where (id, code, status) = ('a', 'no', 'gone')) = 1 and (select count(*) from notes) = 3; end $$;`),
    0,
  )

  // A table the count cannot finish inside its timeout is said to have timed
  // out, and the run answers what it would have answered. Two hundred thousand
  // rows under a timeout of one millisecond is a scan no machine finishes.
  assert.equal(await sqlIn(root, `insert into notes (id, code) select 'bulk' || g, 'x' from generate_series(1, 200000) g`), 0)
  for (const argv of [['migrate', '--check'], ['migrate']]) {
    const ran = await commandIn(root, { ...migrateEnv, MITHAQ_COUNT_TIMEOUT_MS: '1' }, argv)
    assert.equal(ran.code, 0, `${argv.join(' ')} exits as it did: ${ran.stderr}`)
    assert.match(ran.stdout, /The database schema is up to date\./)
    assert.doesNotMatch(ran.stdout, /^notes\.code:/m, 'no count is reported for the table that timed out')
    assert.match(ran.stdout, /^Not counted, since SQL cannot judge them the way the schema does: notes\.code pattern, notes\.name minLength \(trim\), notes \(timed out after 1 ms\)\.$/m)
  }
})

test('`mithaq migrate` refuses a language whose every target declares no such command', async () => {
  const root = await projectOf(`export const asas = {
  targets: { prisma: { capability: 'store' } },
  connect: async () => {},
  destroy: async () => {},
}
`)
  try {
    const refused = await command(root, 'migrate')
    assert.equal(refused.code, 1)
    assert.equal(
      refused.stderr,
      'No target of this language declares a `migrate` command, and that is what `mithaq migrate` runs. Name a store that declares one in `targets`, or migrate that store with its own tool.\n',
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate` refuses a config that names a schema file other than the module it writes', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  try {
    // Its migration is never applied: a config refusal comes before the
    // refusal of a database behind its migrations.
    assert.equal((await migrating(root, 'migrate')).code, 0)
    const config = await readFile(new URL('drizzle.config.ts', migrations), 'utf8')
    await writeFile(new URL('drizzle.config.ts', migrations), config.replace("'schema.ts'", "'other.ts'"))
    const refused = await migrating(root, 'migrate')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /names a schema file `mithaq migrate` did not write/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq migrate` refuses a migration folder holding a migration.sql with no snapshot.json beside it', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  try {
    assert.equal((await migrating(root, 'migrate')).code, 0)
    await mkdir(new URL('20200101000000_hand_written/', migrations))
    await writeFile(new URL('20200101000000_hand_written/migration.sql', migrations), 'SELECT 1;\n')
    const refused = await migrating(root, 'migrate', '--check')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /20200101000000_hand_written holds a migration\.sql with no snapshot\.json/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test("`mithaq migrate` refuses a language whose drizzle target was built from a ready client rather than a connection string", async () => {
  // `execute` answers no rows, as the client of a database no push has marked does: the dev-push
  // marker is read through it first. This is the store `init` returns for a build of no kayan,
  // which migrates nothing.
  const root = await projectOf(`import { drizzleAdapter, drizzleTarget } from '${core}'

export const asas = {
  targets: { drizzle: drizzleAdapter({ db: { execute: async () => ({ rows: [] }) }, ...drizzleTarget }).init([]) },
  connect: async () => {},
  destroy: async () => {},
}
`)
  try {
    const refused = await command(root, 'migrate')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /needs the connection string/)
    assert.doesNotMatch(refused.stderr, /\n\s+at /, 'a refusal, so its sentence alone')

    // A check writes nothing and applies nothing, so it needs no url: it is
    // answered rather than refused, and what it reports is the drift it was
    // asked about. This project has written no config, so that is what it says.
    const checked = await command(root, 'migrate', '--check')
    assert.equal(checked.code, 1, 'a check of the same language is answered rather than refused')
    assert.doesNotMatch(checked.stderr, /needs the connection string/, 'and never on the url it does not need')
    assert.match(checked.stderr, /drizzle\.config\.ts/, 'it reports the config the project has not written')

    const baseline = await command(root, 'migrate', '--baseline')
    assert.equal(baseline.code, 1)
    assert.match(baseline.stderr, /needs the connection string/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq generate --check` with no noun checks the lock first, then stops at the first non-zero of the three generators, names it, and never reaches a target command', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-sweep-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(
    new URL('src/mithaq.ts', root),
    `import { base, defineMithaq } from '${core}'
export const { defineKayan, generate } = defineMithaq({ arkan: [base], targets: {}, generate: { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../auth.ts' } })
`,
  )
  // Better Auth's own defaults under one instance, so the sweep's first command
  // has a table to find stale: the directory holds none of the kayan a run
  // would write.
  await writeFile(new URL('src/auth.ts', root), 'export const providers = { user: { options: {} } }\n')
  try {
    // A project with no lock is not locked, so the sweep goes past the lock to its next step.
    const unlocked = await command(root, 'generate', '--check')
    assert.equal(unlocked.code, 1)
    assert.match(unlocked.stdout, /No mithaq\.lock: this project's language is not locked\./)
    assert.doesNotMatch(unlocked.stderr, /`mithaq lock --check` answered/)
    assert.match(unlocked.stderr, /`mithaq generate auth --check` answered 1, so the sweep stopped there\./)
    // A pending lock, which nobody signed, stops the sweep like a missing one.
    const { defineKayan } = (await import(new URL('src/mithaq.ts', root).href)) as { defineKayan: unknown }
    const language = vocabularyOf(receivedLanguage(defineKayan))
    await writeFile(new URL('mithaq.lock', root), formatLock({ language, seal: 'pending' }))
    const pending = await command(root, 'generate', '--check')
    assert.match(pending.stderr, /^Pending: /)
    assert.match(pending.stderr, /`mithaq lock --check` answered 1, so the sweep stopped there\./)
    await writeFile(new URL('mithaq.lock', root), formatLock(sealLanguage({ language, key: generateKeyPairSync('ed25519').privateKey })))
    const swept = await command(root, 'generate', '--check')
    assert.equal(swept.code, 1)
    assert.match(swept.stderr, /Stale auth kayan/)
    assert.match(swept.stderr, /`mithaq generate auth --check` answered 1, so the sweep stopped there\./)
    await assert.rejects(() => readdir(new URL('src/migrations/', root)), '`drizzle migrate` never ran')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('the copy sweep ignores a custom bag, whatever locale-shaped value it holds', async () => {
  // A label inside `custom` is the developer's, not a key of the kayan's scope: the sweep reads the
  // positions the language names and no others, so a record that happens to look like copy claims
  // no key and is refused for no missing locale.
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'bagCopy',
        dbName: 'bag_copy',
        custom: { blurb: { ar: 'نبذة', en: 'Blurb' } },
        targets: { service: { operations: defaultOperations } },
        fields: {
          id: defaultFields.id,
          title: {
            kind: 'text',
            label: { ar: 'العنوان', en: 'Title' },
            custom: { hint: { ar: 'تلميح', en: 'Hint' } },
          },
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
      }),
      ...accessKayan,
    ],
  })
  const scope = messages.scopes.find((one) => one.name === 'bagCopy')!
  // The seed's own keys sit beside the label; what this test measures is that no `blurb` or `hint`
  // key is claimed.
  assert.deepEqual(
    Object.keys(scope.keys).filter((key) => !/\.(invalid|required)$/.test(key)),
    ['title'],
  )
  await inTemporary(async (directory) => {
    const report = await generateMessages({ registry: messages, directory, check: true })
    assert.deepEqual(refusals(report).filter((line) => /blurb|hint/i.test(line)), [])
  })
})

test('a field overriding only the store target still seeds the schema target\'s messages', () => {
  // `targets.drizzle` replaces the column mithaq would have derived, but the zod shape this kayan's
  // `schema` reads through is still mithaq's own, so the seed still writes for it.
  const { messages } = buildAsas({
    http: [fetchHttp()],
    kayan: [
      defineKayan({
        name: 'storeOverridden',
        dbName: 'store_overridden',
        fields: {
          id: defaultFields.id,
          note: {
            kind: 'text',
            label: { ar: 'ملاحظة', en: 'Note' },
            rules: { required: true },
            targets: { drizzle: drizzleKinds.text({ name: 'note', column: 'note', kind: 'text' }) },
          },
          deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      ...accessKayan,
    ],
  })
  const scope = messages.scopes.find((one) => one.name === 'storeOverridden')!
  assert.deepEqual(
    Object.keys(scope.keys).filter((key) => key.startsWith('note')).sort(),
    ['note', 'note.invalid', 'note.required'],
  )
})

test('generateAuth writes a barrel naming one key per plugin, with core for Better Auth\'s own four', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-barrel-'))}/`)
  const directory = new URL('kayan/auth/', root)

  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options, directory, check: true }), [], 'a second run over what the first wrote reports no drift')

    const barrel = await readFile(new URL('index.ts', directory), 'utf8')
    assert.ok(barrel.startsWith(authHeader), 'the barrel carries the header every generated file carries, so the generator owns it')
    assert.match(
      barrel,
      /export const betterAuth = \{\n  core: \[user, session, account, verification\],\n  organization: \[organization, organizationRole, member, invitation\],\n\} as const\n/,
      'one key per plugin the vocabulary names, and core for the four Better Auth ships without one',
    )

    // A table called `index` would be written over the barrel, so it is refused
    // before anything is written rather than silently losing one of the two.
    await assert.rejects(
      () =>
        generateAuth({
          language: '../../../mithaq.ts',
          options: { plugins: [{ id: 'test', schema: { index: { fields: {} } } }] },
          directory: new URL('clash/', root),
        }),
      /Better Auth model "index" would be written to the same file as the barrel this generator writes\. Rename the model\./,
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a vocabulary that drops its plugins writes core alone, and the check reports the barrel, the organization plugin\'s four files and every core table a plugin added a column to as stale', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-barrel-drop-'))}/`)
  const directory = new URL('kayan/auth/', root)
  const withoutPlugin = { ...options, plugins: [] }

  try {
    await generateAuth({ language: '../../../mithaq.ts', options, directory })
    assert.deepEqual(
      (await generateAuth({ language: '../../../mithaq.ts', options: withoutPlugin, directory, check: true })).toSorted(),
      ['index.ts', 'invitation.ts', 'member.ts', 'organization.ts', 'organizationRole.ts', 'session.ts', 'user.ts'],
      'the organization plugin\'s four tables, the barrel that spread them, and the two core tables the admin plugin added its five columns to',
    )

    await generateAuth({ language: '../../../mithaq.ts', options: withoutPlugin, directory })
    const barrel = await readFile(new URL('index.ts', directory), 'utf8')
    assert.match(barrel, /export const betterAuth = \{\n  core: \[user, session, account, verification\],\n\} as const\n/, 'the rewritten barrel names core alone')
    assert.doesNotMatch(barrel, /organization/, 'and nothing of the plugin that left is still spread')
    assert.deepEqual(await generateAuth({ language: '../../../mithaq.ts', options: withoutPlugin, directory, check: true }), [], 'after which the check is green again')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('the template names no auth kayan file one by one: it spreads the barrel\'s two keys, and the build carries every kayan they name', () => {
  assert.deepEqual(betterAuth.core.map((one) => one.name), ['user', 'session', 'account', 'verification'])
  assert.deepEqual(betterAuth.organization.map((one) => one.name), ['organization', 'organizationRole', 'member', 'invitation'])
  for (const one of [...betterAuth.core, ...betterAuth.organization]) {
    assert.ok(
      (asas.kayan as Record<string, unknown>)[one.name],
      `the build made from the two spreads carries "${one.name}"`,
    )
  }
})

test('`mithaq drizzle migrate` and `mithaq migrate` are one command reached two ways, and print the same sentence', async (t) => {
  await migrateDatabase()
  const root = await migrationProject(withSummary)
  const migrations = new URL('src/migrations/', root)
  await sqlIn(root, 'drop schema public cascade; create schema public;')

  try {
    const first = await migrating(root, 'drizzle', 'migrate')
    assert.equal(first.code, 0, first.stderr)
    const written = (await readdir(migrations)).filter((entry) => /^\d{14}_/.test(entry))
    assert.equal(written.length, 1, 'the target name reaches the same command the bare noun did')
    assert.equal((await appliedIn(root)).code, 0)

    const named = await migrating(root, 'drizzle', 'migrate', '--check')
    const aliased = await migrating(root, 'migrate', '--check')
    assert.equal(named.code, 0, named.stderr)
    assert.equal(aliased.code, named.code, 'the alias answers the code the target name answered')
    assert.equal(aliased.stdout, named.stdout, 'and the same sentence')
    assert.equal(aliased.stderr, named.stderr)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a target that declares no `migrate` is refused naming both, while the alias still finds the one target that declares it', async () => {
  const root = await projectOf(`import { drizzleAdapter, drizzleTarget } from '${core}'
import { memoryStore } from '${memory}'

export const asas = {
  targets: {
    drizzle: drizzleAdapter({ db: { execute: async () => ({ rows: [] }) }, ...drizzleTarget }).init([]),
    memory: memoryStore(),
  },
  connect: async () => {},
  destroy: async () => {},
}
`)
  try {
    const refused = await command(root, 'memory', 'migrate')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /"memory"/, 'the target it was asked of')
    assert.match(refused.stderr, /`migrate`/, 'and the command that target does not declare')
    assert.doesNotMatch(refused.stderr, /\n\s+at /, 'a refusal, so its sentence alone')

    // The alias resolves to the one target that declares `migrate`, which is
    // proved by the sentence that command and no other writes.
    const aliased = await command(root, 'migrate')
    assert.equal(aliased.code, 1)
    assert.match(aliased.stderr, /needs the connection string/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('two targets declaring `migrate` refuse the bare alias by name, and each runs under its own target name', async () => {
  const root = await projectOf(`export const asas = {
  targets: {
    one: { capability: 'store', commands: { migrate: async () => { console.log('one migrated'); return 0 } } },
    two: { capability: 'store', commands: { migrate: async () => { console.log('two migrated'); return 0 } } },
  },
  connect: async () => {},
  destroy: async () => {},
}
`)
  try {
    const refused = await command(root, 'migrate')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /one/)
    assert.match(refused.stderr, /two/)

    const first = await command(root, 'one', 'migrate')
    assert.equal(first.code, 0, first.stderr)
    assert.equal(first.stdout, 'one migrated\n')
    const second = await command(root, 'two', 'migrate')
    assert.equal(second.code, 0, second.stderr)
    assert.equal(second.stdout, 'two migrated\n')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a first word that is neither a mithaq command nor a target is refused with both lists', async () => {
  const root = await projectOf(`export const asas = {
  targets: { drizzle: { capability: 'store' }, zod: { capability: 'schema' } },
  connect: async () => {},
  destroy: async () => {},
}
`)
  try {
    const refused = await command(root, 'nothing', 'migrate')
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /"nothing"/)
    assert.match(refused.stderr, /generate/, 'the words the bin answers itself')
    assert.match(refused.stderr, /migrate/)
    assert.match(refused.stderr, /drizzle/, 'and the targets this language declares')
    assert.match(refused.stderr, /zod/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('a word off `Object.prototype` is refused as a target and as a command, rather than called', async () => {
  const root = await projectOf(`export const asas = {
  targets: { drizzle: { capability: 'store', commands: { migrate: async () => 0 } } },
  connect: async () => {},
  destroy: async () => {},
}
`)
  try {
    // `constructor` is on every object, so a plain read would answer `Object`
    // here and the bin would exit on what calling it returned.
    const asCommand = await command(root, 'drizzle', 'constructor')
    assert.equal(asCommand.code, 1)
    assert.match(asCommand.stderr, /"drizzle" declares no `constructor` command/)
    assert.doesNotMatch(asCommand.stderr, /\n\s+at /, 'a refusal, so its sentence alone')

    const asTarget = await command(root, 'constructor', 'migrate')
    assert.equal(asTarget.code, 1)
    assert.match(asTarget.stderr, /"constructor" is neither a command of mithaq nor a target/)
    assert.doesNotMatch(asTarget.stderr, /\n\s+at /)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('`mithaq generate --check` runs every declared target command with `--check`, `migrate` before the messages noun and the others after the three nouns, in `targets` order, and stops at the first non-zero', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-sweep-targets-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  // A real, empty language and its pending lock, so the sweep's first step, the lock, passes.
  await writeFile(
    new URL('src/mithaq.ts', root),
    `import { defineMithaq } from ${JSON.stringify(new URL('../../../packages/mithaq/src/index.ts', import.meta.url).href)}\nexport const { defineKayan } = defineMithaq({ targets: {}, arkan: [] })\nexport const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../auth.ts', messages: 'src/messages/' }\n`,
  )
  {
    const { defineKayan } = (await import(new URL('src/mithaq.ts', root).href)) as { defineKayan: unknown }
    const { formatLock, sealLanguage, vocabularyOf } = await import('../../../packages/mithaq/src/mithaq/lock.ts')
    const { receivedLanguage } = await import('../../../packages/mithaq/src/mithaq/language.ts')
    await writeFile(new URL('mithaq.lock', root), formatLock(sealLanguage({ language: vocabularyOf(receivedLanguage(defineKayan)), key: generateKeyPairSync('ed25519').privateKey })))
  }
  await writeFile(new URL('src/auth.ts', root), 'export const providers = { user: { options: {} } }\n')
  // Two targets, each declaring one command, so the sweep's order over
  // `targets` and over a target's own commands is what the output shows.
  await writeFile(
    new URL('src/asas.ts', root),
    `export const asas = {
  messages: { locales: ['en'], scopes: [{ name: 'mithaq', keys: { 'kinds.text': { en: 'Text' } } }], collisions: {}, resolved: false, localized: [] },
  targets: {
    store: { capability: 'store', commands: { migrate: async ({ flags }) => { console.log(\`store migrate saw \${flags.join(' ')}\`); return 0 } } },
    extra: { commands: { check: async () => { console.error('extra check refused'); return 3 } } },
  },
  connect: async () => {},
  destroy: async () => {},
}
`,
  )
  try {
    // The three nouns are made green first, so what the sweep stops at is the
    // target command and not a generator that had nothing written for it.
    for (const argv of [['generate', 'auth'], ['generate', 'messages'], ['generate', 'screens']]) {
      const wrote = await command(root, ...argv)
      assert.equal(wrote.code, 0, `${argv.join(' ')}: ${wrote.stderr}`)
    }

    const swept = await command(root, 'generate', '--check')
    assert.equal(swept.code, 3, swept.stderr)
    assert.match(swept.stdout, /store migrate saw --check/, 'a declared command is run with `--check` and no rule of its own')
    assert.ok(
      swept.stdout.indexOf('store migrate saw') < swept.stdout.indexOf('Messages are up to date'),
      '`migrate` comes before the messages scan, which can connect and push',
    )
    assert.ok(
      swept.stderr.indexOf('extra check refused') > -1 && swept.stdout.indexOf('Screens are up to date') > -1,
      'the extra command stops the sweep at exit 3, so the screens output is there only because the three nouns ran before it',
    )
    assert.match(swept.stderr, /extra check refused/, 'the second target ran after the first')
    assert.match(swept.stderr, /`mithaq extra check --check` answered 3, so the sweep stopped there\./)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('mithaq generate auth writes one directory per kayan a Better Auth instance authenticates, with the auth key on the kayan named, and --check is green for two of them', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-two-instances-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(new URL('src/mithaq.ts', root), "export const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../auth.ts' }\n")
  // Two populations on two instances: staff on `user`, shoppers on `customers`. One database holds
  // both, so the second instance renames every table it brings.
  await writeFile(
    new URL('src/auth.ts', root),
    `export const providers = {
  user: { options: {}, server: () => ({}) },
  customers: {
    options: {
      user: { modelName: 'customers' },
      session: { modelName: 'customerSession' },
      account: { modelName: 'customerAccount' },
      verification: { modelName: 'customerVerification' },
    },
    server: () => ({}),
  },
}
`,
  )
  try {
    assert.equal(await runAuth(root, false), 0)
    assert.equal(await runAuth(root, true), 0, 'a second run over what the first wrote reports no drift')

    const read = (path: string) => readFile(new URL(`src/kayan/auth/${path}`, root), 'utf8')
    const staff = await read('user/user.ts')
    const shoppers = await read('customers/user.ts')
    assert.match(staff, /\n  auth: betterAuth\(\{ server: providers\.user\.server \}\),\n/, 'the kayan the instance is named after carries its provider')
    assert.match(staff, /import \{ providers \} from '\.\.\/\.\.\/\.\.\/auth\.ts'/)
    assert.match(shoppers, /\n  name: 'customers',\n  auth: betterAuth\(\{ server: providers\.customers\.server \}\),\n/)
    assert.doesNotMatch(await read('user/session.ts'), /auth: betterAuth/, 'and no other table of the instance carries it')
    assert.doesNotMatch(await read('customers/session.ts'), /auth: betterAuth/)

    assert.match(await read('user/index.ts'), /export const betterAuth = \{\n  core: \[user, session, account, verification\],\n\} as const\n/)
    assert.match(await read('customers/index.ts'), /export const betterAuth = \{\n  core: \[user, session, account, verification\],\n\} as const\n/)

    // A directory of an instance the project no longer declares is reported and
    // never removed: the generator owns the files it wrote, not the directory.
    await mkdir(new URL('src/kayan/auth/legacy/', root), { recursive: true })
    await writeFile(new URL('src/kayan/auth/legacy/index.ts', root), `${authHeader}\nexport const betterAuth = {} as const\n`)
    assert.equal(await runAuth(root, true), 1, 'the check reports the instance that left')
    assert.equal(
      (await readdir(new URL('src/kayan/auth/legacy/', root))).length,
      1,
      'and leaves its files exactly where they are',
    )

    // A plain run says the same thing in its own sentence and never under
    // "Wrote": that word is for the files this command wrote, and it wrote
    // nothing in there.
    const said: string[] = []
    const log = console.log
    console.log = (...parts: unknown[]) => void said.push(parts.join(' '))
    try {
      assert.equal(await runAuth(root, false), 0, 'a plain run is not a failure over a directory it does not own')
    } finally {
      console.log = log
    }
    assert.ok(
      said.some((one) => one.startsWith('legacy/ is a directory of an instance ../../../auth.ts no longer declares.')),
      `the stale directory is its own sentence: ${JSON.stringify(said)}`,
    )
    assert.ok(said.every((one) => !one.includes('Wrote legacy/')), 'and never reported as written')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('mithaq generate auth refuses an instance whose tables hold no kayan of its own name, because the auth key would be written onto nothing', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-misnamed-instance-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(new URL('src/mithaq.ts', root), "export const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../auth.ts' }\n")
  await writeFile(new URL('src/auth.ts', root), "export const providers = { shoppers: { options: {}, server: () => ({}) } }\n")
  try {
    await assert.rejects(
      () => runAuth(root, false),
      /No Better Auth table of the "shoppers" instance is named "shoppers", so there is no kayan for its `auth` to sit on\./,
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generate auth on the template imports providers from the package generate.providers names, and --check is green', async () => {
  // The provider is a workspace package of its own, so the generated kayan imports it by its bare
  // name and needs no relative depth.
  const kayan = await readFile(new URL('kayan/auth/user/user.ts', import.meta.url), 'utf8')
  assert.match(kayan, /\nimport \{ providers \} from '@asas\/auth'\n/)
  assert.equal(await quietly(() => runAuth(new URL('../', import.meta.url), true)), 0)
})

test('mithaq generate auth refuses a language whose generate record names no providers, naming the key', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-no-providers-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(new URL('src/mithaq.ts', root), "export const generate = { auth: 'src/kayan/auth/' }\n")
  try {
    await assert.rejects(() => runAuth(root, false), /`generate\.providers`/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('#196: mithaq generate auth refuses a language whose generate record names no auth folder, naming the key, and writes nothing', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-no-auth-folder-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(new URL('src/mithaq.ts', root), "export const generate = { providers: '../../../providers.ts' }\n")
  await writeFile(new URL('src/providers.ts', root), 'export const providers = { user: { options: {}, server: () => ({}) } }\n')
  try {
    await assert.rejects(() => runAuth(root, false), /^Error: src\/mithaq\.ts names no `generate\.auth`/)
    assert.deepEqual((await readdir(new URL('src/', root))).sort(), ['mithaq.ts', 'providers.ts'], 'and no folder of its own choosing was written')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generate.providers as a relative path is written into the generated kayan verbatim', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-providers-path-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(
    new URL('src/mithaq.ts', root),
    "export const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '../../../providers.ts' }\n",
  )
  await writeFile(new URL('src/providers.ts', root), 'export const providers = { user: { options: {}, server: () => ({}) } }\n')
  try {
    assert.equal(await quietly(() => runAuth(root, false)), 0)
    const kayan = await readFile(new URL('src/kayan/auth/user/user.ts', root), 'utf8')
    assert.match(kayan, /\nimport \{ providers \} from '\.\.\/\.\.\/\.\.\/providers\.ts'\n/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('generate.language is written into each generated kayan as the module defineKayan comes from, wherever generate.auth puts it', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-language-path-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(
    new URL('src/mithaq.ts', root),
    "export const generate = { auth: 'src/auth/', language: '../../mithaq.ts', providers: '../../providers.ts' }\n",
  )
  await writeFile(new URL('src/providers.ts', root), 'export const providers = { user: { options: {}, server: () => ({}) } }\n')
  try {
    assert.equal(await quietly(() => runAuth(root, false)), 0)
    const kayan = await readFile(new URL('src/auth/user/user.ts', root), 'utf8')
    assert.match(kayan, /\nimport \{ defineKayan \} from '\.\.\/\.\.\/mithaq\.ts'\n/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('mithaq generate auth refuses a generate record that names no language, or one it cannot find, and writes nothing', async () => {
  // One project each, since a module is imported once per URL.
  for (const [language, refused] of [[undefined, 'names no `generate.language`'], ['@nowhere/language', '"@nowhere/language"']] as const) {
    const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-language-missing-'))}/`)
    await mkdir(new URL('src/', root), { recursive: true })
    await writeFile(new URL('src/providers.ts', root), 'export const providers = { user: { options: {}, server: () => ({}) } }\n')
    await writeFile(new URL('src/mithaq.ts', root), `export const generate = ${JSON.stringify({ auth: 'src/kayan/auth/', language, providers: '../../../providers.ts' })}\n`)
    try {
      await assert.rejects(() => runAuth(root, false), (error: Error) => error instanceof Refusal && error.message.includes(refused))
      assert.deepEqual((await readdir(new URL('src/', root))).sort(), ['mithaq.ts', 'providers.ts'])
    } finally {
      await rm(root, { recursive: true })
    }
  }
})

test('the provider package depends on Better Auth\'s own two packages and mithaq alone, and no non-test source of asas outside the generated kayan imports better-auth', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../auth/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, '@asas/auth')
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['@better-auth/core', 'better-auth', 'mithaq'])
  // The core `better-auth` itself runs on, never a second version beside it.
  assert.equal(manifest.dependencies['@better-auth/core'], manifest.dependencies['better-auth'])
  assert.equal(manifest.devDependencies, undefined)
  const source = new URL('./', import.meta.url)
  const importers: string[] = []
  for (const file of await readdir(source, { recursive: true })) {
    if (!/\.tsx?$/.test(file) || file.endsWith('.test.ts') || file.startsWith('kayan/auth/')) continue
    if (/from 'better-auth/.test(await readFile(new URL(file, source), 'utf8'))) importers.push(file)
  }
  assert.deepEqual(importers, [])
})

test('mithaq generate auth refuses a generate.providers it cannot find, naming the key and the specifier', async () => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-providers-missing-'))}/`)
  await mkdir(new URL('src/', root), { recursive: true })
  await writeFile(
    new URL('src/mithaq.ts', root),
    "export const generate = { auth: 'src/kayan/auth/', language: '../../../mithaq.ts', providers: '@nowhere/auth' }\n",
  )
  try {
    await assert.rejects(
      () => runAuth(root, false),
      (error: Error) =>
        error instanceof Refusal &&
        error.message.includes('`generate.providers`') &&
        error.message.includes('"@nowhere/auth"') &&
        !error.message.includes('instance/index.ts'),
    )
  } finally {
    await rm(root, { recursive: true })
  }
})
