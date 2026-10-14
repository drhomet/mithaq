// The tenant target's declaration: the ownership field a kayan places, the
// binding core reads off it, and what `buildAsas` refuses before anything runs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTableConfig, text, type PgTable } from 'mithaq/drizzle/pg-core'
import { z } from 'zod'
import {
  base,
  betterAuth,
  betterAuthTenant,
  defaultAuthorize,
  defaultBulkLimit,
  defaultDepth,
  defaultFields,
  defaultGlobalFields,
  defaultGlobalOperations,
  defaultJoinLimit,
  defaultLimit,
  defaultMaxLimit,
  defaultOperations,
  defineMithaq,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  fetchHttp,
  serviceTarget,
  zodTarget,
  type Kayan,
} from 'mithaq'
import { memoryStore } from './memory-store.ts'

/** The targets of a build that makes tables and never connects. */
const offline = () => ({
  drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules }),
  zod: zodTarget,
  service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
})

const tenanted = defineMithaq({
  arkan: [base],
  targets: { ...offline(), tenant: betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', organizations: 'many' }) },
})
const { targets: { tenant } } = tenanted
const untenanted = defineMithaq({ arkan: [base], targets: offline() })

const operations = { service: { operations: defaultOperations } }
const organization: Kayan = { name: 'organization', fields: { id: { kind: 'text' }, name: { kind: 'text' } }, targets: operations }

/** Builds `organization` and the kayan given, as plain data, through the language given. */
const build = (language: { buildAsas: (args: never) => unknown }, ...kayan: Kayan[]) =>
  language.buildAsas({ http: [fetchHttp()], kayan: [organization, ...kayan] } as never) as {
    targets: { drizzle: { tables: Record<string, PgTable> } }
    kayan: Record<string, { targets: { zod: { schemas: { create: z.ZodObject; update: z.ZodObject } } } }>
  }

const notes = (fields: Kayan['fields']): Kayan => ({ name: 'notes', fields: { ...defaultFields, ...fields, title: { kind: 'text' } }, targets: operations })

test('betterAuthTenant is the tenant target, and its field is one required, indexed organization the application writes once', () => {
  assert.equal(tenant.capability, 'tenant')
  assert.deepEqual(tenant.field, {
    kind: 'relationship',
    relationTo: 'organization',
    rules: { required: true, index: true, providedBy: { create: 'application', update: 'never' }, onDelete: 'restrict' },
    targets: { tenant: true },
  })
})

test('betterAuthTenant takes onDelete restrict alone', () => {
  for (const onDelete of ['cascade', 'set null', undefined]) {
    assert.throws(
      () => betterAuthTenant({ relationTo: 'organization', onDelete: onDelete as never, organizations: 'many' }),
      /betterAuthTenant takes onDelete: 'restrict' alone/,
    )
  }
})

/** What the store and the schema made of the notes field `key`. */
const ownership = (built: ReturnType<typeof build>, key = 'organizationId') => {
  const notes = built.targets.drizzle.tables.notes!
  const name = (notes as unknown as Record<string, { name: string }>)[key]!.name
  const table = getTableConfig(notes)
  const { create, update } = built.kayan.notes!.targets.zod.schemas
  return {
    notNull: table.columns.find((one) => one.name === name)!.notNull,
    indexed: table.indexes.some((one) => one.config.columns.some((each) => (each as { name?: string }).name === name)),
    onDelete: table.foreignKeys.find((one) => one.reference().columns.some((each) => each.name === name))!.onDelete,
    created: Object.hasOwn(create.shape, key),
    updated: Object.hasOwn(update.shape, key),
  }
}
const owned = { notNull: true, indexed: true, onDelete: 'restrict', created: false, updated: false }

test('the binding is read off the field\'s targets.tenant, through a spread, a relabel, defineKayan, plain data and any key', () => {
  const label = { en: 'Organization', ar: 'المؤسسة' }
  for (const field of [tenant.field, { ...tenant.field }, { ...tenant.field, label }, JSON.parse(JSON.stringify(tenant.field))]) {
    assert.deepEqual(ownership(build(tenanted, notes({ organizationId: field }))), owned)
    const defined = build(tenanted, tenanted.defineKayan({ ...notes({ organizationId: field }), name: 'notes' } as never) as Kayan)
    assert.deepEqual(ownership(defined), owned)
  }
  const renamed = build(tenanted, notes({ owner: tenant.field }))
  assert.deepEqual(ownership(renamed, 'owner'), owned)
})

test('a field written by hand with targets.tenant takes the target\'s rules where it leaves them out', () => {
  const byHand = { kind: 'relationship', relationTo: 'organization', targets: { tenant: true } } as const
  const plain = build(tenanted, notes({ organizationId: byHand }))
  assert.deepEqual(ownership(plain), owned)
  const defined = tenanted.defineKayan({ name: 'notes', fields: { ...defaultFields, organizationId: byHand }, targets: operations })
  assert.deepEqual(defined.fields.organizationId, tenant.field)
  const built = build(tenanted, defined as Kayan)
  assert.deepEqual(ownership(built), owned)
  // A rule the binding does not fix, such as unique, is the kayan's to add.
  const unique = build(tenanted, notes({ organizationId: { ...byHand, rules: { unique: true } } }))
  assert.equal(getTableConfig(unique.targets.drizzle.tables.notes!).columns.find((one) => one.name === 'organization_id_id')!.isUnique, true)
})

test('a field is never owned by its name: a relationship called tenant without the binding is an ordinary field', () => {
  const plain = { kind: 'relationship', relationTo: 'organization' } as const
  const built = build(tenanted, notes({ tenant: plain, organizationId: tenant.field }))
  assert.deepEqual(ownership(built), owned)
  assert.equal(ownership(built, 'tenant').notNull, false)
})

test('buildAsas refuses tenant.field spread under targets of its own, which drops the binding and would leave the kayan shared', () => {
  const refusal = /Field "notes\.organizationId" looks like the tenant field but is not bound to the tenant target, so its kayan would be shared\. Add targets: \{ tenant: true \} to it\./
  assert.throws(() => build(tenanted, notes({ organizationId: { ...tenant.field, targets: {} } as never })), refusal)
  assert.throws(() => build(tenanted, notes({ organizationId: { ...tenant.field, targets: { zod: z.string() } } as never })), refusal)
})

test('a global carrying a bound field is one row per organization: the field unique and required in the schema, globalType not unique, and either written otherwise is refused', () => {
  const globalType = { ...defaultGlobalFields.globalType, rules: { required: true } }
  const unique = { ...tenant.field, rules: { ...tenant.field.rules, unique: true } }
  const prefs = (fields: Kayan['fields']) =>
    tenanted.defineGlobal({ name: 'prefs', fields: { ...defaultFields, ...fields, theme: { kind: 'text' } }, access: { read: () => true, update: () => true }, targets: { service: { operations: defaultGlobalOperations } } } as never)
  const built = (fields: Kayan['fields']) => tenanted.buildAsas({ http: [fetchHttp()], kayan: [organization], global: [prefs(fields)] } as never) as ReturnType<typeof build>
  const columns = getTableConfig(built({ owner: unique, globalType }).targets.drizzle.tables.prefs!).columns
  const column = (name: string) => columns.find((one) => one.name === name)!
  assert.deepEqual([column('owner_id').isUnique, column('owner_id').notNull], [true, true], 'one row per organization, under any key')
  assert.equal(column('global_type').isUnique, false, 'and every organization\'s row carries the same name')
  assert.throws(() => built({ owner: tenant.field, globalType }), /Global "prefs" declares tenant field "owner" without required and unique, and that column is what keeps the global to one row per tenant\./)
  assert.throws(() => built({ owner: unique, ...defaultGlobalFields }), /Global "prefs" declares a tenant and a unique "globalType", so a second tenant's row would collide with the first one's\./)
  // A global with no bound field stays one row for the whole project.
  assert.equal(getTableConfig(built({ ...defaultGlobalFields }).targets.drizzle.tables.prefs!).columns.find((one) => one.name === 'global_type')!.isUnique, true)
})

test('buildAsas refuses a second Better Auth kayan beside a tenant-owned kayan, whose organizations one instance alone holds', () => {
  const server = () => ({ api: { getSession: async () => null }, handler: async () => new Response(null) })
  const instance = (name: string): Kayan => ({ name, fields: { id: { kind: 'text' } }, auth: betterAuth({ server: server as never }), targets: operations } as Kayan)
  const twice = { http: [fetchHttp()], kayan: [organization, instance('staff'), instance('shoppers')], auth: { onError: () => {} } }
  const owned = { ...twice, kayan: [...twice.kayan, notes({ organizationId: tenant.field })] }
  assert.throws(() => tenanted.buildAsas(owned as never), /Kayan "staff" and "shoppers" each carry Better Auth, and kayan "notes" belongs to the organization a session names\./)
  assert.doesNotThrow(() => tenanted.buildAsas(twice as never), 'a build with no tenant-owned kayan keeps both')
})

test('buildAsas refuses two fields bound to the tenant in one kayan, written as plain data or through defineKayan, before any store is made', () => {
  let made = 0
  const drizzle = offline().drizzle
  const counted = defineMithaq({
    arkan: [base],
    targets: { ...offline(), drizzle: { ...drizzle, init: (kayan: never) => (made++, drizzle.init(kayan)) }, tenant: tenant },
  })
  const twice = { ...defaultFields, organizationId: tenant.field, owner: { kind: 'relationship', relationTo: 'organization', targets: { tenant: true } } } as const
  const refusal = /Kayan "notes" binds fields "organizationId" and "owner" to the tenant, and a row belongs to one tenant\. Keep one of them\./
  assert.throws(() => build(counted, { name: 'notes', fields: twice, targets: operations }), refusal)
  assert.throws(() => build(counted, counted.defineKayan({ name: 'notes', fields: twice, targets: operations } as never) as Kayan), refusal)
  assert.equal(made, 0)
})

test('buildAsas refuses a field bound to the tenant where the language lays down no tenant target', () => {
  const refusal = /Kayan "notes" field "organizationId" is bound through targets\.tenant, and this language lays down no tenant target\./
  assert.throws(() => build(untenanted, notes({ organizationId: tenant.field })), refusal)
  const defined = untenanted.defineKayan({ name: 'notes', fields: { ...defaultFields, organizationId: tenant.field }, targets: operations } as never)
  assert.throws(() => build(untenanted, defined as Kayan), refusal)
})

test('buildAsas refuses a bound field that loosens the tenant: a set, another kayan, a null, no index, a client value, a default, another delete or a column of its own', () => {
  const byHand = { kind: 'relationship', relationTo: 'organization', targets: { tenant: true } } as const
  const refused: [Kayan['fields'][string], RegExp][] = [
    [{ ...tenant.field, hasMany: true }, /a tenant field holds one row of "organization"/],
    [{ ...tenant.field, relationTo: 'notes' }, /a tenant field holds one row of "organization"/],
    [{ ...tenant.field, kind: 'text' } as never, /a tenant field holds one row of "organization"/],
    [{ ...byHand, rules: { required: false } }, /declares required false, and a tenant field is required: true/],
    [{ ...byHand, rules: { index: false } }, /declares index false, and a tenant field is index: true/],
    [{ ...byHand, rules: { onDelete: 'cascade' } }, /declares onDelete "cascade", and a tenant field is onDelete: "restrict"/],
    [{ ...byHand, rules: { onDelete: 'set null' } }, /declares onDelete "set null"/],
    [{ ...byHand, rules: { providedBy: { create: 'client', update: 'never' } } }, /a tenant field is providedBy: \{ create: 'application', update: 'never' \}/],
    [{ ...byHand, rules: { providedBy: { create: 'application' } } }, /a tenant field is providedBy/],
    [{ ...byHand, rules: { defaultValue: 'org-1' } }, /declares defaultValue, and a tenant field is filled from the session alone/],
    [{ ...byHand, targets: { tenant: false } }, /writes targets\.tenant as false, and a field is bound to the tenant with targets: \{ tenant: true \}/],
    [{ ...tenant.field, targets: { tenant: true, drizzle: text('organization_id') } }, /writes targets\.drizzle, which would build the field in place of the tenant's rules/],
    [{ ...tenant.field, targets: { tenant: true, zod: z.string().nullable() } }, /writes targets\.zod, which would build the field in place of the tenant's rules/],
  ]
  for (const [field, refusal] of refused) {
    assert.throws(() => build(tenanted, notes({ organizationId: field })), refusal)
  }
})

test('the tenant target is registered under the key tenant, the kayan decides by its field alone, and onDelete restrict is the only choice', () => {
  const misnamed = defineMithaq({ arkan: [base], targets: { ...offline(), owner: tenant } } as never)
  assert.throws(() => build(misnamed), /Target "owner" declares capability "tenant" and has to be named "tenant" in targets/)
  const taken = defineMithaq({ arkan: [base], targets: { ...offline(), tenant: zodTarget } } as never)
  assert.throws(() => build(taken), /Target "tenant" declares capability "schema", and the key "tenant" is the tenant target's/)
  const cascading = defineMithaq({ arkan: [base], targets: { ...offline(), tenant: { ...tenant, onDelete: 'cascade' } } } as never)
  assert.throws(() => build(cascading), /The tenant target declares onDelete "cascade", and a tenant takes onDelete: 'restrict' alone\./)
  assert.throws(
    () => build(tenanted, { ...notes({}), targets: { ...operations, tenant: false } }),
    /Kayan "notes" writes targets\.tenant, and a kayan is tenant-owned by the field it places/,
  )
})

test('buildAsas refuses an account kayan that places the tenant field: an account is one identity, looked up by its email and tokens alone', () => {
  const accounts = { ...notes({ organization: tenant.field }), auth: { name: 'test', authenticate: () => ({ user: null }) } } as Kayan
  assert.throws(
    () => build(tenanted, accounts),
    /^Error: Kayan "notes" authenticates accounts and places tenant field "organization", and an account is one identity across every organization, looked up by its email and tokens alone\. Drop the tenant field: an account kayan is shared\.$/,
  )
})

/** A tenant-owned `terms` with the indexes given, or a shared one where `organization` is a plain relationship. */
const terms = (indexes: unknown, organization: Kayan['fields'][string] = tenant.field): Kayan => ({
  name: 'terms',
  fields: { ...defaultFields, organization, title: { kind: 'text' }, code: { kind: 'text', rules: { unique: true } }, term: { kind: 'text' }, startsAt: { kind: 'datetime' } },
  indexes,
  targets: operations,
} as Kayan)
const indexesOf = (kayan: Kayan) =>
  getTableConfig(build(tenanted, kayan).targets.drizzle.tables.terms!).indexes
    .filter(({ config }) => config.name)
    .map(({ config }) => ({ name: config.name, unique: config.unique, columns: config.columns.map((column) => (column as { name: string }).name) }))

test('a group within the tenant field expands to one index per entry, each led by the tenant field and named as the same index written by hand', () => {
  const group = { within: 'organization', unique: ['title', ['term', 'startsAt']], index: ['startsAt'] }
  const expected = [
    { name: 'terms_organization_id_title_idx', unique: true, columns: ['organization_id', 'title'] },
    { name: 'terms_organization_id_term_starts_at_idx', unique: true, columns: ['organization_id', 'term', 'starts_at'] },
    { name: 'terms_organization_id_starts_at_idx', unique: false, columns: ['organization_id', 'starts_at'] },
    { name: 'terms_organization_id_code_idx', unique: true, columns: ['organization_id', 'code'] },
  ]
  assert.deepEqual(indexesOf(terms([group])), expected, 'a group in a list, beside the defaults')
  assert.deepEqual(indexesOf(terms(({ defaults }: { defaults: unknown[] }) => [group, ...defaults])), expected, 'and a group in what a function answers')
  const byHand = [{ fields: ['organization', 'title'], unique: true }, { fields: ['organization', 'term', 'startsAt'], unique: true }, { fields: ['organization', 'startsAt'] }]
  assert.deepEqual(indexesOf(terms(byHand)), expected, 'the same names and columns as the entries written by hand')
})

test('a plain unique entry on a tenant-owned kayan means what it says: one index over its fields alone, unique across every organization', () => {
  assert.deepEqual(indexesOf(terms([{ fields: ['title'], unique: true }]))[0], { name: 'terms_title_idx', unique: true, columns: ['title'] })
})

test('buildAsas refuses a group within anything but the tenant field, a group naming no index, and a group entry that repeats another index', () => {
  const refused = (kayan: Kayan, message: string) => assert.throws(() => build(tenanted, kayan), (thrown: Error) => thrown.message === message, message)
  refused(
    terms([{ within: 'title', unique: ['code'] }]),
    'Kayan "terms" indexes[0] is a group within "title", and a group is within the kayan\'s tenant field, "organization". Write within: \'organization\', or write each index as { fields: [...] }.',
  )
  refused(
    terms([{ within: 'organization', unique: ['title'] }], { kind: 'relationship', relationTo: 'organization' }),
    'Kayan "terms" indexes[0] is a group within "organization", and the kayan places no tenant field, so its rows are within no tenant. Write each index as { fields: [...] }.',
  )
  for (const group of [{ within: 'organization' }, { within: 'organization', unique: [] }, { within: 'organization', unique: [], index: [] }]) {
    refused(terms([group]), 'Kayan "terms" indexes[0] is a group within "organization" that names no index. Write unique: [\'a\', [\'b\', \'c\']], index: [\'d\'], or both.')
  }
  refused(terms([{ within: 'organization', unique: 'title' }]), 'Kayan "terms" indexes[0] writes unique as "title", and a group\'s unique and index are lists of fields and of lists of fields: unique: [\'a\', [\'b\', \'c\']].')
  for (const [key, group] of [['unique', { within: 'organization', unique: ['title', []] }], ['index', { within: 'organization', index: [[]] }]] as const) {
    refused(terms([group]), `Kayan "terms" indexes[0] writes an empty list in ${key}, which would be an index over "organization" alone. Name the fields it is over, or drop the empty list.`)
  }
  refused(terms([{ within: 'organization', unique: ['title'], fields: ['title'] }]), 'Kayan "terms" indexes[0] writes "fields", and a group takes within, unique and index alone.')
  refused(terms([{ within: 'organization', index: ['nope'] }]), 'Kayan "terms" indexes[0]\'s index over "organization", "nope" names "nope", which is no field of the kayan.')
  refused(
    terms([{ within: 'organization', unique: ['code'] }]),
    'Kayan "terms" indexes[0]\'s index over "organization", "code" and the default unique index over "organization", "code" are over the same fields in the same order, so they would be one index built twice. Keep one; a unique index serves every read the other would.',
  )
  refused(
    terms([{ fields: ['organization', 'startsAt'] }, { within: 'organization', index: ['startsAt'] }]),
    'Kayan "terms" indexes[0] and indexes[1]\'s index over "organization", "startsAt" are over the same fields in the same order, so they would be one index built twice. Keep one; a unique index serves every read the other would.',
  )
})

test('betterAuthTenant takes the organization mode, one or many, and nothing else: a project that hid its one organization says so in its own settings', () => {
  for (const organizations of ['one', 'many'] as const) assert.equal(betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', organizations }).organizations, organizations)
  for (const organizations of ['none', 'some', undefined]) {
    assert.throws(() => betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', organizations: organizations as never }), /organizations: 'one' or 'many'/)
  }
})

test('connect() refuses a store holding more than one organization where the tenant target says one, and starts otherwise', async () => {
  /** A build over the memory store holding `count` organizations, connected under the mode given. */
  const connected = async (organizations: 'one' | 'many', count: number, readOnly = false) => {
    const store = memoryStore()
    const language = defineMithaq({
      arkan: [base],
      targets: {
        store,
        zod: zodTarget,
        tenant: betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict', organizations }),
        service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'store', schema: 'zod', authorize: defaultAuthorize }),
      } as {},
    })
    const built = (language as unknown as { buildAsas: (args: unknown) => { connect(args?: { readOnly?: boolean }): Promise<void> } }).buildAsas({ http: [fetchHttp()], kayan: [organization] })
    for (let at = 0; at < count; at++) await store.insert({ tx: undefined, kayan: 'organization', data: { id: `org-${at}`, name: `Org ${at}` } })
    return built.connect({ readOnly })
  }
  await assert.rejects(connected('one', 2), /organizations: 'one'[\s\S]*more than one[\s\S]*'many'/, 'two organizations refuse the start, naming the mode and the way out')
  await connected('one', 1)
  await connected('one', 0)
  await connected('one', 2, true)
  await connected('many', 3)
})
