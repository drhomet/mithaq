// The arkan: the pillars of capability a language is made of, each bringing
// kinds, rules and targets of its own, merged by `defineMithaq` and refused by
// `buildAsas` where two say one thing.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTableConfig, pgTable, text, uuid, varchar } from 'mithaq/drizzle/pg-core'
import { z } from 'zod'
import {
  defaultMaxBodyBytes,
  base,
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
  defineMithaq,
  defineRukn,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  kind,
  rule,
  screenKinds,
  screenTarget,
  serviceTarget,
  storage,
  uploadFields,
  versions,
  versionsTarget,
  zodKinds,
  withUploadReference,
  zodTarget,
  fetchHttp,
  type StandardSchemaV1,
} from 'mithaq'
import { defaultNodes, richText } from 'mithaq/rich-text'
import { dashboardScreen } from '../../mithaq/src/mithaq.ts'
import { plainTarget } from './standard-schema-target.ts'
import { storageConfig } from '../../mithaq/src/storage/index.ts'

/** The targets of a build that makes tables and never connects. */
const offline = (kinds: Record<string, unknown> = drizzleKinds) => ({
  drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: kinds as typeof drizzleKinds, rules: drizzleRules }),
  zod: zodTarget,
  service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
})

const build = (language: unknown, fields: Record<string, unknown> = { title: { kind: 'text' } }) => {
  const one = language as { defineKayan: (kayan: unknown) => unknown; buildAsas: (args: unknown) => unknown }
  return one.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })],
    kayan: [one.defineKayan({ name: 'notes', fields: { id: defaultFields.id, ...fields }, targets: { service: { operations: defaultOperations } } })],
  }) as {
    targets: Record<string, { tables?: Record<string, Record<string, { getSQLType(): string }>>; client?: { controls: Record<string, { control: string; cell: string }>; kayan: Record<string, { fields: { name: string; cell: string }[] }> } }>
    kayan: { notes: { targets: { zod: { schemas: { create: z.ZodType } } } } }
    destroy(): Promise<void>
  }
}

const label = { en: 'Slug', ar: 'معرف نصي' }
const message = { en: 'This is not a slug.', ar: 'هذا ليس معرفا نصيا.' }
const isString = (value: unknown): value is string => typeof value === 'string'

test('defineMithaq merges every rukn\'s kinds, rules and targets into the language', () => {
  const history = defineRukn({ name: 'history', targets: { versions: versionsTarget({ max: 100 }) } })
  const language = defineMithaq({ locales: ['ar', 'en'] as const, targets: offline(), arkan: [base, history] })
  assert.deepEqual(Object.keys(language.kinds), Object.keys(defaultKinds))
  assert.equal(language.kinds.text, defaultKinds.text)
  assert.deepEqual(Object.keys(language.rules), Object.keys(defaultRules))
  assert.deepEqual(Object.keys(language.targets).sort(), ['drizzle', 'service', 'versions', 'zod'])
  assert.equal(language.targets.versions, history.targets.versions)
})

test('defineMithaq refuses kinds or rules written at the root, which come from the arkan alone', () => {
  assert.throws(
    () => defineMithaq({ kinds: defaultKinds, targets: offline(), arkan: [base] } as never),
    /The language declares "kinds" at its root, and kinds and rules come from its arkan alone/,
  )
  assert.throws(() => defineMithaq({ rules: defaultRules, targets: offline(), arkan: [base] } as never), /declares "rules" at its root/)
})

test('buildAsas refuses a kind, a rule or a target two arkan bring, naming both', () => {
  const slug = kind<string>(isString)({ label, message, rules: ['required'] })
  const twice = (mine: object) => () => build(defineMithaq({ targets: offline(), arkan: [base, defineRukn({ name: 'mine', ...mine })] } as never))
  assert.throws(twice({ kinds: { text: slug } }), /Rukn "base" and rukn "mine" both bring kind "text"\. One kind is brought by one rukn: drop it from one of them\./)
  const positive = rule<boolean>({ accepts: (value): value is boolean => typeof value === 'boolean' })
  assert.throws(twice({ rules: { required: positive } }), /Rukn "base" and rukn "mine" both bring rule "required"/)
  const one = defineRukn({ name: 'one', targets: { history: versionsTarget({ max: 100 }) } })
  const two = defineRukn({ name: 'two', targets: { history: versionsTarget({ max: 100 }) } })
  assert.throws(
    () => build(defineMithaq({ targets: offline(), arkan: [base, one, two] } as never)),
    /Rukn "one" and rukn "two" both bring target "history"/,
  )
})

test('buildAsas refuses a rukn target under a key the project\'s targets already use', () => {
  const history = defineRukn({ name: 'history', targets: { versions: versionsTarget({ max: 100 }) } })
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), versions: versionsTarget({ max: 5 }) }, arkan: [base, history] } as never)),
    /The project lays down target "versions", and rukn "history" builds one under that key\. Rename the project's target or leave it to the rukn\./,
  )
})

test('buildAsas refuses a rukn that needs a capability the build lays down no target of, and builds one that has it', () => {
  const drafts = defineRukn({ name: 'drafts', needs: ['versions', 'store'] })
  assert.throws(
    () => build(defineMithaq({ targets: offline(), arkan: [base, drafts] } as never)),
    /Rukn "drafts" needs a target of capability "versions", and this build lays down none\. Add one to targets\./,
  )
  // Any store meets `store`: the drizzle store is of type "drizzle" and of capability "store".
  void build(defineMithaq({ targets: { ...offline(), versions: versionsTarget({ max: 100 }) }, arkan: [base, drafts] })).destroy()
  void build(defineMithaq({ targets: offline(), arkan: [base, defineRukn({ name: 'history', targets: { versions: versionsTarget({ max: 100 }) } }), drafts] })).destroy()
})

test('a kind builds through its own targets, and the project\'s own entry on a target wins over it', async () => {
  const slug = kind<string>(isString)({
    label,
    message,
    rules: ['required'],
    targets: {
      drizzle: (field: { column: string }) => varchar(field.column, { length: 40 }),
      zod: () => z.string().regex(/^[a-z-]+$/),
      screen: { control: 'text', cell: 'text' },
    },
  })
  const slugs = defineRukn({ name: 'slugs', kinds: { slug } })
  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const own = build(defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, slugs] }), { slug: { kind: 'slug' } })
  assert.equal(own.targets.drizzle!.tables!.notes!.slug!.getSQLType(), 'varchar(40)', 'the kind\'s own column')
  assert.equal(own.kayan.notes.targets.zod.schemas.create.safeParse({ slug: 'Not a slug' }).success, false, 'the kind\'s own shape')
  assert.equal(own.kayan.notes.targets.zod.schemas.create.safeParse({ slug: 'a-slug' }).success, true)
  assert.equal(own.targets.dashboard!.client!.controls.slug!.control, 'text', 'the kind\'s own control')
  await own.destroy()

  const mine = build(
    defineMithaq({ targets: offline({ ...drizzleKinds, slug: (field: { column: string }) => text(field.column) }), arkan: [base, slugs] }),
    { slug: { kind: 'slug' } },
  )
  assert.equal(mine.targets.drizzle!.tables!.notes!.slug!.getSQLType(), 'text', 'the project\'s own entry wins')
  await mine.destroy()

  // A kind the target ships an entry for builds through its own, because an
  // entry identical to the shipped one is the target's table and comes last.
  const ownText = defineRukn({ name: 'mine', kinds: { ...defaultKinds, text: { ...defaultKinds.text, targets: slug.targets } }, rules: defaultRules })
  const shipped = build(defineMithaq({ targets: offline(), arkan: [ownText] }))
  assert.equal(shipped.targets.drizzle!.tables!.notes!.title!.getSQLType(), 'varchar(40)')
  await shipped.destroy()
})

test('a kind no registry control draws names itself as its control, which the project\'s components map draws, and no other kind may name it', async () => {
  const color = kind<string>(isString)({
    label,
    message,
    rules: ['required'],
    targets: { drizzle: (field: { column: string }) => text(field.column), zod: () => z.string(), screen: { control: 'color', cell: 'text' } },
  })
  const colors = defineRukn({ name: 'colors', kinds: { color } })
  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const own = build(defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, colors] }), { color: { kind: 'color' } })
  assert.equal(own.targets.dashboard!.client!.controls.color!.control, 'color', 'the kind is drawn by its own name')
  await own.destroy()
  const borrowed = screenTarget({ ...screen, controls: { ...screenKinds, text: { control: 'color', cell: 'text' } } })
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), dashboard: borrowed }, arkan: [base, colors] }), { color: { kind: 'color' } }),
    /controls "text" control names "color", which is no name in this screen's components and no control the registry ships/,
    'another kind cannot borrow it, since the map draws it by the kind',
  )
  // A registry control only a rukn's kind brings, such as richText, is never claimed by a kind of the same name that the rukn did not bring.
  const lookalike = kind<string>(isString)({ label, message, rules: ['required'], targets: { drizzle: (field: { column: string }) => text(field.column), zod: () => z.string() } })
  const claiming = screenTarget({ ...screen, controls: { ...screenKinds, richText: { control: 'richText', cell: 'text' } } })
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), dashboard: claiming }, arkan: [base, defineRukn({ name: 'lookalikes', kinds: { richText: lookalike } })] }), { body: { kind: 'richText' } }),
    /controls "richText" control names "richText", which is no name in this screen's components and no control the registry ships/,
  )
})

test('a kind no registry cell draws names itself as its cell, which the project\'s components map draws, and no other kind may name it', async () => {
  const swatch = kind<string>(isString)({
    label,
    message,
    rules: ['required'],
    targets: { drizzle: (field: { column: string }) => text(field.column), zod: () => z.string(), screen: { control: 'text', cell: 'swatch' } },
  })
  const swatches = defineRukn({ name: 'swatches', kinds: { swatch } })
  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const own = build(defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, swatches] }), { swatch: { kind: 'swatch' } })
  assert.equal(own.targets.dashboard!.client!.controls.swatch!.cell, 'swatch', 'the kind is drawn by its own name')
  assert.equal(own.targets.dashboard!.client!.kayan.notes!.fields.find((field) => field.name === 'swatch')!.cell, 'swatch', 'and so is a field of it')
  await own.destroy()
  const borrowed = screenTarget({ ...screen, controls: { ...screenKinds, text: { control: 'text', cell: 'swatch' } } })
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), dashboard: borrowed }, arkan: [base, swatches] }), { swatch: { kind: 'swatch' } }),
    /controls "text" cell names "swatch", which is no name in this screen's components and no cell the registry ships/,
    'another kind cannot borrow it, since the map draws it by the kind',
  )
  // A registry cell only a rukn's kind brings, such as richText, is never claimed by a kind of the same name that the rukn did not bring.
  const lookalike = kind<string>(isString)({ label, message, rules: ['required'], targets: { drizzle: (field: { column: string }) => text(field.column), zod: () => z.string() } })
  const claiming = screenTarget({ ...screen, controls: { ...screenKinds, richText: { control: 'text', cell: 'richText' } } })
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), dashboard: claiming }, arkan: [base, defineRukn({ name: 'lookalikes', kinds: { richText: lookalike } })] }), { body: { kind: 'richText' } }),
    /controls "richText" cell names "richText", which is no name in this screen's components and no cell the registry ships/,
  )
})

test('buildAsas refuses a field whose kind neither the target nor the kind itself builds, naming both', () => {
  const slug = kind<string>(isString)({ label, message, rules: ['required'], targets: { zod: () => z.string() } })
  assert.throws(
    () => build(defineMithaq({ targets: offline(), arkan: [base, defineRukn({ name: 'slugs', kinds: { slug } })] } as never), { slug: { kind: 'slug' } }),
    /Kayan "notes" field "slug" has kind "slug", which has no entry in the "drizzle" target's kinds and carries none of its own under targets\.drizzle\./,
  )
})

test('a kayan\'s table is read under its own store\'s key, whatever the store is named', async () => {
  // `KayanConfigs` types the table under every target of type `drizzle`, so
  // the store reads it under the name the kayan's store has in this build.
  const own = pgTable('own_notes', { id: uuid('id').primaryKey(), title: text('title') })
  /** A language whose one store is keyed `db`, each with a pool of its own. */
  const dbLanguage = () => {
    const { drizzle, ...rest } = offline()
    return defineMithaq({ targets: { ...rest, db: drizzle, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'db', schema: 'zod', authorize: defaultAuthorize }) }, arkan: [base] })
  }
  const language = dbLanguage()
  const built = language.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })],
    kayan: [language.defineKayan({ name: 'notes', fields: { id: defaultFields.id, title: { kind: 'text' } }, targets: { db: own, service: { operations: defaultOperations } } })],
  })
  assert.equal(built.targets.db.tables.notes, own)
  await built.destroy()

  // A field's own column is read under the same name: `note` is declared a
  // number, and the override makes it a text column.
  const fieldLanguage = dbLanguage()
  const field = fieldLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })],
    kayan: [
      fieldLanguage.defineKayan({
        name: 'notes',
        fields: { id: defaultFields.id, note: { kind: 'number', targets: { db: text('note') } }, plain: { kind: 'number' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const columns = field.targets.db.tables.notes as unknown as Record<string, { getSQLType(): string }>
  assert.equal(columns.note!.getSQLType(), 'text')
  assert.equal(columns.plain!.getSQLType(), 'numeric')
  await field.destroy()
})

test('a field\'s own shape is read under its kayan\'s schema target\'s key, whatever the target is named', async () => {
  // `fee` carries a shape under `check`, the zod target's name in this build,
  // which refuses a negative number the derived `number` shape accepts.
  const { zod, ...rest } = offline()
  const language = defineMithaq({ targets: { ...rest, check: zod, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'check', authorize: defaultAuthorize }) }, arkan: [base] })
  const built = language.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })],
    kayan: [
      language.defineKayan({
        name: 'notes',
        fields: { id: defaultFields.id, fee: { kind: 'number', targets: { check: z.number().min(0) } } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const create = built.kayan.notes.targets.check.schemas.create
  assert.equal(create.safeParse({ fee: -1 }).success, false, 'the field\'s own shape')
  assert.equal(create.safeParse({ fee: 1 }).success, true)
  await built.destroy()
})

test('the richText rukn brings the kind, with its own column, shape and control over the nodes it is handed, and base brings none', async () => {
  assert.equal(Object.hasOwn(defaultKinds, 'richText'), false, 'base brings no richText kind')
  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const over = (nodes: typeof defaultNodes) =>
    build(defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, richText({ nodes })] }), { body: { kind: 'richText' } })
  const quote = { body: { root: { type: 'root', children: [{ type: 'quote', children: [{ type: 'text', text: 'Said' }] }] } } }
  const all = over(defaultNodes)
  assert.equal(all.targets.drizzle!.tables!.notes!.body!.getSQLType(), 'jsonb', 'its own column')
  assert.equal(all.kayan.notes.targets.zod.schemas.create.safeParse(quote).success, true, 'its own shape, over the nodes it was handed')
  assert.equal(all.targets.dashboard!.client!.controls.richText!.control, 'richText', 'its own control')
  await all.destroy()
  const fewer = over(defaultNodes.filter((node) => node.getType() !== 'quote'))
  assert.equal(fewer.kayan.notes.targets.zod.schemas.create.safeParse(quote).success, false, 'a node the list leaves out is refused')
  await fewer.destroy()
})

test('the storage rukn brings the upload kind, with its own reference column, id shape and control, builds the storage target over its config, and base brings neither', async () => {
  assert.equal(Object.hasOwn(defaultKinds, 'upload'), false, 'base brings no upload kind')
  const files = storage(storageConfig)
  assert.equal(files.targets.storage.capability, 'storage')
  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const language = defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, files] })
  assert.equal(language.targets.storage, files.targets.storage, 'the rukn lays its own target down')
  const media = language.defineKayan({
    name: 'media',
    fields: { id: defaultFields.id, ...uploadFields },
    targets: {
      storage: { mimeTypes: ['image/png'] },
      service: {
        operations: {
          ...defaultOperations,
          create: { ...defaultOperations.create, input: ({ create }: { create: StandardSchemaV1 }) => withUploadReference(create), beforeTransaction: [storageConfig.uploaded] },
          delete: { ...defaultOperations.delete, afterCommit: ({ afterCommit }: { afterCommit: readonly unknown[] }) => [...afterCommit, storageConfig.removed] },
        },
      },
    },
  } as never)
  const notes = language.defineKayan({
    name: 'notes',
    fields: { id: defaultFields.id, cover: { kind: 'upload', relationTo: () => media }, gallery: { kind: 'upload', relationTo: () => media, hasMany: true } },
    targets: { service: { operations: defaultOperations } },
  } as never)
  const built = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [media, notes] } as never) as unknown as {
    targets: { drizzle: { tables: Record<string, Parameters<typeof getTableConfig>[0] & Record<string, { getSQLType(): string }>> }; dashboard: { client: { controls: Record<string, { control: string; cell: string }> } } }
    kayan: { notes: { targets: { zod: { schemas: { create: z.ZodType } } } } }
    destroy(): Promise<void>
  }
  const { tables } = built.targets.drizzle
  assert.equal(tables.notes!.cover!.getSQLType(), 'uuid', 'its own column takes the type of the id it points at')
  const onDelete = (table: string) => getTableConfig(tables[table]!).foreignKeys.map((key) => key.onDelete).sort()
  assert.deepEqual(onDelete('notes'), ['restrict'], 'a file a row names is not deleted from under it')
  assert.deepEqual(onDelete('notes_gallery'), ['cascade', 'restrict'], 'nor one a set names, while the set goes with its row')
  const { create } = built.kayan.notes.targets.zod.schemas
  assert.equal(create.safeParse({ cover: 'not-an-id' }).success, false, 'its own shape is the id of the kayan it points at')
  assert.equal(create.safeParse({ cover: '00000000-0000-4000-8000-000000000001', gallery: ['00000000-0000-4000-8000-000000000002'] }).success, true)
  assert.deepEqual(built.targets.dashboard.client.controls.upload, { control: 'upload', cell: 'upload' }, 'its own control and cell')
  await built.destroy()
})

test('a screen ships the control and the cell a kind of its language names for itself, and none a rukn the language does not lay down', async () => {
  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const at = 'Screen "dashboard" kayan "notes" field "body" targets\\.dashboard'
  // Base alone: no kind of this language names the editor or the file picker.
  const plain = defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base] })
  assert.throws(
    () => build(plain, { body: { kind: 'text', targets: { dashboard: { component: 'richText' } } } }),
    new RegExp(`${at}\\.component names "richText", which is no name in this screen's components and no control the registry ships\\.`),
  )
  assert.throws(
    () => build(plain, { body: { kind: 'text', targets: { dashboard: { cell: 'upload' } } } }),
    new RegExp(`${at}\\.cell names "upload", which is no name in this screen's components and no cell the registry ships\\.`),
  )
  // With the richText rukn, its kind's own control and cell are shipped, and
  // its control draws that kind and no other.
  const rich = defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, richText({ nodes: defaultNodes })] })
  const built = build(rich, { body: { kind: 'richText', targets: { dashboard: { component: 'richText', cell: 'richText' } } } }) as unknown as {
    targets: { dashboard: { client: { kayan: Record<string, { fields: { name: string; sortable?: false }[] }> } } }
    destroy(): Promise<void>
  }
  // The kind cannot order a page, so the screen offers no sort the server refuses.
  assert.equal(built.targets.dashboard.client.kayan.notes!.fields.find((field) => field.name === 'body')!.sortable, false, 'a rich text column is projected unsortable')
  assert.equal(built.targets.dashboard.client.kayan.notes!.fields.find((field) => field.name === 'id')!.sortable, undefined, 'and a column of a kind that sorts is not')
  await built.destroy()
  assert.throws(
    () => build(rich, { body: { kind: 'text', targets: { dashboard: { component: 'richText' } } } }),
    new RegExp(`${at}\\.component names built-in control "richText", which draws richText and not text\\.`),
  )
  assert.throws(
    () => build(rich, { body: { kind: 'richText', targets: { dashboard: { component: 'text' } } } }),
    new RegExp(`${at}\\.component names built-in control "text", which draws text, email, date, datetime, decimal and not richText\\.`),
  )
})

test('a kind\'s own control counts only where the registry ships it, and a kind naming a base control takes any built-in control', async () => {
  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const slugOf = (own: { control: string; cell: string }) => defineRukn({
    name: 'slugs',
    kinds: {
      slug: kind<string>(isString)({
        label,
        message,
        rules: ['required'],
        targets: { drizzle: (field: { column: string }) => varchar(field.column, { length: 40 }), zod: () => z.string(), screen: own },
      }),
    },
  })
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, slugOf({ control: 'slugPicker', cell: 'text' })] }), { slug: { kind: 'slug' } }),
    /Screen "dashboard" controls "slug" control names "slugPicker", which is no name in this screen's components and no control the registry ships\./,
  )
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, slugOf({ control: 'text', cell: 'slugCell' })] }), { slug: { kind: 'slug' } }),
    /Screen "dashboard" controls "slug" cell names "slugCell", which is no name in this screen's components and no cell the registry ships\./,
  )
  // A kind drawn by the plain text input is not a kind whose value shape the
  // build knows, so any built-in control draws it.
  const texted = build(
    defineMithaq({ targets: { ...offline(), dashboard: screen }, arkan: [base, slugOf({ control: 'text', cell: 'text' })] }),
    { slug: { kind: 'slug', targets: { dashboard: { component: 'textarea' } } } },
  ) as unknown as { destroy(): Promise<void> }
  await texted.destroy()
})

test('the versions rukn builds the versions target over its window, brings no kind, and is refused without a store', async () => {
  const history = versions({ max: 7 })
  assert.deepEqual(history.targets.versions, { capability: 'versions', type: 'versions', max: 7 })
  assert.equal(Object.hasOwn(history, 'kinds'), false, 'it brings no kind')
  const language = defineMithaq({ targets: offline(), arkan: [base, history] })
  assert.equal(language.targets.versions, history.targets.versions, 'the rukn lays its own target down')
  const built = build(language, { title: { kind: 'text' }, _status: { kind: 'text' } }) as unknown as { destroy(): Promise<void> }
  await built.destroy()
  const { drizzle: _drizzle, ...storeless } = offline()
  assert.throws(
    () => build(defineMithaq({ targets: storeless, arkan: [base, history] } as never)),
    /Rukn "versions" needs a target of capability "store", and this build lays down none\. Add one to targets\./,
  )
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), versions: versionsTarget({ max: 7 }) }, arkan: [base, history] } as never)),
    /The project lays down target "versions", and rukn "versions" builds one under that key/,
  )
  // A second versions target under another key would split the kayan between
  // two windows, and the first found would win with nothing said.
  assert.throws(
    () => build(defineMithaq({ targets: { ...offline(), history: versionsTarget({ max: 100 }) }, arkan: [base, history] })),
    /Targets "versions" and "history" both declare capability "versions", and a build has at most one versions target\. Drop one of them\./,
  )
})

test('a localized field whose column is overridden under a store keyed db is that one column, and a locale path on it is refused', async () => {
  const { drizzle, ...rest } = offline()
  const language = defineMithaq({ locales: ['ar', 'en'] as const, targets: { ...rest, db: drizzle, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'db', schema: 'zod', authorize: defaultAuthorize }) }, arkan: [base] })
  const built = language.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })],
    kayan: [
      language.defineKayan({
        name: 'notes',
        fields: { id: defaultFields.id, title: { kind: 'text', rules: { localized: true }, targets: { db: text('title') } }, subtitle: { kind: 'text', rules: { localized: true } } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const columns = Object.keys(built.targets.db.tables.notes as object)
  assert.ok(columns.includes('title') && !columns.includes('title_ar'), 'the override is the whole column')
  assert.ok(columns.includes('subtitle_ar') && columns.includes('subtitle_en'), 'and a localized field with none is one column per locale')
  const refused = await built.targets.db
    .find({ kayan: 'notes', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { 'title.ar': { equals: 'x' } } } })
    .catch((thrown: unknown) => thrown)
  assert.match(String((refused as Error).message), /Kayan "notes" field "title" is localized/)
  await built.destroy()
})

test('the template\'s plain target reads a field\'s own shape under the plain target\'s name in the build', async () => {
  // `fee` carries a shape under `check`, which refuses a negative number the
  // derived `number` shape accepts.
  const nonNegative = {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) => (typeof value === 'number' && value >= 0 ? { value } : { issues: [{ message: 'negative' }] }),
    },
  }
  const { zod: _zod, ...rest } = offline()
  const language = defineMithaq({ targets: { ...rest, check: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'check', authorize: defaultAuthorize }) }, arkan: [base] })
  const built = language.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })],
    kayan: [
      language.defineKayan({
        name: 'notes',
        fields: { id: defaultFields.id, fee: { kind: 'number', targets: { check: nonNegative } } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const create = (built.kayan.notes.targets as unknown as Record<string, { schemas: { create: typeof nonNegative } }>).check!.schemas.create
  assert.ok(create['~standard'].validate({ fee: -1 }).issues, 'the field\'s own shape')
  assert.equal(create['~standard'].validate({ fee: 1 }).issues, undefined)
  await built.destroy()
})

test('a project kind says for itself which operators it takes, that it cannot order a page, that it points at a row, and what its rows do when that row is deleted', async () => {
  const tag = kind<string>(isString)({
    label,
    message,
    rules: ['required'],
    operators: ['equals', 'like'],
    sortable: false,
    targets: { drizzle: (field: { column: string }) => text(field.column), zod: () => z.string(), screen: { control: 'text', cell: 'text' } },
  })
  const isId = (value: unknown): value is number | string => typeof value === 'number' || typeof value === 'string'
  const anchorOf = (own: Record<string, unknown>) =>
    kind<number | string>(isId)({ label, message, rules: ['required', 'onDelete'], ...own, targets: { drizzle: drizzleKinds.relationship, zod: zodKinds.relationship } })
  const anchor = anchorOf({ pointsAtRow: true, onDelete: 'cascade' })
  const languageOf = (kinds: Record<string, unknown>, targets: Record<string, unknown> = {}) =>
    defineMithaq({ targets: { ...offline(), ...targets }, arkan: [base, defineRukn({ name: 'own', kinds: kinds as { tag: typeof tag } })] } as never) as unknown as {
      defineKayan: (kayan: unknown) => unknown
      buildAsas: (args: unknown) => { targets: { drizzle: { tables: Record<string, Parameters<typeof getTableConfig>[0]> } }; destroy(): Promise<void> }
    }

  const pointing = languageOf({ anchor })
  const parents = pointing.defineKayan({ name: 'parents', fields: { id: defaultFields.id }, targets: { service: { operations: defaultOperations } } })
  const children = pointing.defineKayan({
    name: 'children',
    fields: {
      id: defaultFields.id,
      parent: { kind: 'anchor', relationTo: () => parents },
      kept: { kind: 'anchor', relationTo: () => parents, rules: { required: true } },
      named: { kind: 'anchor', relationTo: () => parents, rules: { onDelete: 'set null' } },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const built = pointing.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [parents, children] })
  const { columns, foreignKeys } = getTableConfig(built.targets.drizzle.tables.children!)
  assert.deepEqual(columns.map((column) => column.name).sort(), ['id', 'kept_id', 'named_id', 'parent_id'], 'each holds the id of the row it points at')
  assert.deepEqual(
    Object.fromEntries(foreignKeys.map((key) => [key.reference().columns[0]!.name, key.onDelete])),
    { parent_id: 'cascade', kept_id: 'restrict', named_id: 'set null' },
    'the kind\'s own default, under a required field\'s and the field\'s own',
  )
  await built.destroy()
  const silent = languageOf({ anchor: anchorOf({ pointsAtRow: true }) })
  const lone = silent.defineKayan({ name: 'parents', fields: { id: defaultFields.id }, targets: { service: { operations: defaultOperations } } })
  assert.throws(
    () => silent.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })], kayan: [lone, silent.defineKayan({ name: 'children', fields: { id: defaultFields.id, parent: { kind: 'anchor', relationTo: () => lone } }, targets: { service: { operations: defaultOperations } } })] }),
    /Kayan "children" field "parent" has kind "anchor", which points at a row and says no onDelete default\. Give the kind its own onDelete\./,
  )

  const screen = screenTarget({ ...dashboardScreen, kayan: ['notes'], controls: screenKinds, pages: { home: { path: '/', component: dashboardScreen.pages.dashboard!.component } } })
  const tagged = languageOf({ tag }, { dashboard: screen })
  const notes = (pages: Record<string, unknown>) =>
    tagged.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes })],
      kayan: [tagged.defineKayan({ name: 'notes', fields: { id: defaultFields.id, tag: { kind: 'tag' } }, targets: { service: { operations: defaultOperations }, dashboard: { pages } } })],
    })
  const form = (when: unknown) => ({ create: { path: '/notes/new', page: { shell: 'app', main: [{ layout: 'record', main: [{ form: [{ field: 'tag', when }] }] }] } } })
  const liked = notes(form({ tag: { like: 'a' } }))
  await liked.destroy()
  assert.throws(() => notes(form({ tag: { in: ['a'] } })), /field "tag" operator "in" is not supported on a field of kind "tag"; only "equals" and "like" are\./)
  assert.throws(
    () => notes({ list: { path: '/notes', page: { shell: 'app', main: [{ layout: 'table', main: [{ list: { columns: ['tag'], sort: 'tag' } }] }] } } }),
    /list sort names "tag", which cannot order a page\./,
  )
  const tabbed = (tabs: unknown) => () => notes({ list: { path: '/notes', page: { shell: 'app', main: [{ layout: 'table', main: [{ list: { columns: ['tag'], tabs } }] }] } } })
  assert.throws(tabbed([{ tab: 'some', label: { en: 'Some', ar: 'بعض' }, where: { tag: { in: ['a'] } } }]), /field "tag" operator "in" is not supported on a field of kind "tag"/, 'a tab\'s where is held to the kinds')
  assert.throws(tabbed([{ tab: 'all', label: { en: 'All', ar: 'الكل' } }, { tab: 'all', label: { en: 'All', ar: 'الكل' } }]), /list tab 1 is named "all", and a tab is named once in a list, in letters and digits\./)
})
