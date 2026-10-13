import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actorPermissions,
  actorRoles,
  AsasError,
  assignableRole,
  authActor,
  betterAuthStrategy,
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
  betterAuthTarget,
  betterAuthTenant,
  memberRoleTarget,
  grantedPermissions,
  holdsPermission,
  rbacTarget,
  requestOrganization,
  userRefs,
  zodTarget,
  type AccessRow,
  type Field,
  type FieldAccessArgs,
  type Rules,
  type RowTable,
  type SystemRoles,
  serviceTarget,
  defaultGlobalOperations,
  defaultGlobalFields,
  fetchHttp,
} from 'mithaq'
import { createAccessControl } from 'better-auth/plugins/access'
import { memoryStore } from './memory-store.ts'

// The roles the access target declares. They hold nothing: a row table here grades with its own `permissions`.
const fourRoles = {
  member: { label: { ar: 'عضو', en: 'Member' }, permissions: [] },
  auditor: { label: { ar: 'مدقق', en: 'Auditor' }, permissions: [] },
  admin: { label: { ar: 'مدير', en: 'Admin' }, permissions: [] },
  viewer: { label: { ar: 'مشاهد', en: 'Viewer' }, permissions: [] },
} as const satisfies SystemRoles

const language = (store: ReturnType<typeof memoryStore>, access?: RowTable) =>
  defineMithaq({
    arkan: [base],
    // No `rolesOf`, so the rows read `user.roles` off the actor, which every plain-object actor in this file carries.
    targets: { memory: store, zod: zodTarget, rbac: rbacTarget({ roles: fourRoles, access: (access ?? {}) as never, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })

// The same language with the tenant target laid down, so a kayan placing `tenant.field` is tenant-owned and inherits the
// language's rows. Nothing here runs an operation through it: the scope core holds is `tenant-scope.test.ts`'s.
const tenantLanguage = (store: ReturnType<typeof memoryStore>, access?: RowTable) =>
  defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, rbac: rbacTarget({ roles: fourRoles, access: (access ?? {}) as never, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), tenant: betterAuthTenant({ relationTo: 'organization', onDelete: 'restrict' }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })

// The target may answer `'*'`, which the snapshot keeps as `true`; every case here that reads a key back reads a list.
const keysOf = (actor: unknown) => actorPermissions(actor) as ReadonlySet<string> | undefined

// The rows are written before the language that would type them, so they name the actor the way a project's own tenancy table does.
const user = userRefs<{ activeOrganizationId: string }>()
const tenantRow = { tenant: { equals: user.activeOrganizationId } } as const

// The tenant column the kayan in this file spread into their own `fields`. A caller may name no tenant unless its session
// is a trusted one, so the fixtures below write the column by acting as an actor of that organization rather than by
// sending its name.
const tenantField = {
  tenant: { kind: 'text', label: { en: 'Tenant', ar: 'المستأجر' }, rules: { defaultValue: user.activeOrganizationId } },
} as const satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
const member = { id: 'u1', roles: ['member'], activeOrganizationId: 'org1' }
const admin = { id: 'u2', roles: ['admin'], activeOrganizationId: 'org1' }
const otherAdmin = { id: 'u2b', roles: ['admin'], activeOrganizationId: 'org2' }
const both = { id: 'u3', roles: ['member', 'auditor'], activeOrganizationId: 'org1' }
const guest = { id: 'u4', roles: ['guest'], activeOrganizationId: null }

const courseTable = {
  member: { create: true, read: tenantRow, update: tenantRow, delete: false, fields: ['*', '!fee'] },
  auditor: { read: tenantRow, update: false, fields: ['*', '!fee'] },
  admin: { create: true, read: true, update: true, delete: true },
} as const satisfies RowTable

const courseRows = (mithaq: ReturnType<typeof language>) => mithaq.rows(courseTable)

/** The memory store keeps whatever it is handed, so every row carries its id. */
const courseFields = {
  id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
  title: { kind: 'text', label: { en: 'Title', ar: 'العنوان' }, rules: { required: true } },
  fee: { kind: 'number', label: { en: 'Fee', ar: 'الرسوم' } },
  ...tenantField,
} as const

// The two kayan an access target reads, as thin as they can be. `buildAsas` refuses a target whose kayan the build does
// not declare, since one that cannot read its rows resolves nothing for every actor.
const accessKayan = (() => {
  // One language instance makes them, because neither carries a tenant field and so neither inherits a row table.
  const { defineKayan } = language(memoryStore())
  return [
    defineKayan({
      name: 'roles',
      fields: {
        id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
        name: { kind: 'text', label: { en: 'Name', ar: 'الاسم' } },
        permissions: { kind: 'textArray', label: { en: 'Permissions', ar: 'الصلاحيات' } },
      },
      targets: { service: { operations: defaultOperations } },
    }),
    defineKayan({
      name: 'memberRoles',
      fields: {
        id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
        user: { kind: 'text', label: { en: 'Member', ar: 'العضو' } },
        role: { kind: 'text', label: { en: 'Role', ar: 'الدور' } },
        // Named `organization` rather than `tenant`, so neither inherits the language's row table: a pair carrying `tenant` would
        // be graded by holdings written for a global this build does not declare.
        organization: { kind: 'text', label: { en: 'Organization', ar: 'المنظمة' } },
      },
      targets: { service: { operations: defaultOperations } },
    }),
  ]
})()

const built = () => {
  const store = memoryStore()
  const mithaq = language(store)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: courseRows(mithaq),
    targets: { service: { operations: defaultOperations } },
  })
  return { courses, store, ...mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] }) }
}

const seed = async (asas: ReturnType<typeof built>) => {
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })
  await asas.kayan.courses.operations.create({ id: 2, title: 'Theirs', fee: 400 }, { actor: otherAdmin })
}

test('1. tenancy is one row, and a member reads only its own organization', async () => {
  const asas = built()
  await seed(asas)

  assert.deepEqual(await asas.courses.access!.read({ slug: 'courses', user: member }), {
    tenant: { equals: 'org1' },
  })
  const page = await asas.kayan.courses.operations.find({}, { actor: member })
  assert.deepEqual(page.docs.map((row) => row.title), ['Mine'])
  assert.equal(page.totalDocs, 1)
})

test('2. zero applicable rows deny, and never an empty filter', async () => {
  const asas = built()
  await seed(asas)

  assert.equal(await asas.courses.access!.read({ slug: 'courses', user: guest }), false)
  assert.equal(await asas.courses.access!.read({ slug: 'courses', user: null }), false)
  await assert.rejects(() => asas.kayan.courses.operations.find({}, { actor: guest }), /Forbidden/)
  await assert.rejects(() => asas.kayan.courses.operations.find(), /Forbidden/)
})

test('3. a row with no filter passes whole', async () => {
  const asas = built()
  await seed(asas)

  assert.equal(await asas.courses.access!.read({ slug: 'courses', user: admin }), true)
  // The subject is which rows the access lets through, not their order, so the sort is named: a language with no
  // `createdAt` falls back to `-id`.
  assert.deepEqual(
    (await asas.kayan.courses.operations.find({ sort: 'id' }, { actor: admin })).docs.map((row) => row.title),
    ['Mine', 'Theirs'],
  )
})

test('4. a false in any applicable row wins over a filter in another', async () => {
  const asas = built()
  await seed(asas)

  assert.equal(await asas.courses.access!.update({ slug: 'courses', user: both }), false)
  await assert.rejects(
    () => asas.kayan.courses.operations.update({ id: 1, title: 'Changed' }, { actor: both }),
    /Forbidden: "courses" update access denied/,
  )
  assert.deepEqual(await asas.courses.access!.read({ slug: 'courses', user: both }), {
    or: [{ tenant: { equals: 'org1' } }, { tenant: { equals: 'org1' } }],
  })
})

test('5. a field list hides a field per role', async () => {
  const asas = built()
  await seed(asas)

  assert.equal((await asas.kayan.courses.operations.findByID({ id: 1 }, { actor: admin }))?.fee, 300)
  const seen = await asas.kayan.courses.operations.findByID({ id: 1 }, { actor: member })
  assert.equal(seen?.title, 'Mine')
  assert.equal(Object.hasOwn(seen!, 'fee'), false)
})

test('6. the rows are readable as data, without running a callback', () => {
  const table = courseRows(language(memoryStore()))
  assert.deepEqual(table.rows.member, {
    create: true,
    read: tenantRow,
    update: tenantRow,
    delete: false,
    fields: ['*', '!fee'],
  })
  assert.deepEqual(Object.keys(table.rows), ['member', 'auditor', 'admin'])
  assert.deepEqual(built().courses.access!.rows.admin, {
    create: true,
    read: true,
    update: true,
    delete: true,
  })
})

test('7. a denied field write names the kayan, the operation, the roles and every denied field, carries 403, and carries a message key with the values its message interpolates', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: {
      ...courseFields,
      summary: { kind: 'text', label: { en: 'Summary', ar: 'الملخص' } },
    },
    access: mithaq.rows({
      member: { create: true, read: true, update: true, fields: ['*', '!fee', '!summary'] },
    }),
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })

  await assert.rejects(
    () => asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300, summary: 'x' }, { actor: member }),
    /Forbidden: kayan "courses" operation "create" for roles "member" cannot write fields "fee", "summary"\.$/,
  )
  // Thrown before validation, so a value zod would refuse never reaches the parse; a 403 rather than the 500 an unlabelled
  // throw would become.
  const refusal = await asas.kayan.courses.operations
    .create({ id: 2, title: 'Mine', fee: 'not a number' as never }, { actor: member })
    .catch((thrown: unknown) => thrown)
  assert.ok(refusal instanceof AsasError, 'a denied field write is an AsasError')
  assert.equal(refusal.status, 403, 'a denied field write carries 403')
  assert.match(refusal.message, /cannot write field "fee"\.$/, 'the denied field write names the field')
  assert.equal(refusal.key, 'error.forbidden.field_write', 'a denied field write carries its message key')
  assert.deepEqual(
    refusal.params,
    { kayan: 'courses', operation: 'create', roles: ['member'], fields: ['fee'] },
    'a denied field write carries the kayan, the operation, the roles and the fields its message interpolates, the roles as a list a client resolves key by key rather than one English string',
  )
  assert.equal(store.rows.get('courses')?.length ?? 0, 0)

  const notes = mithaq.defineKayan({
    name: 'notes',
    fields: {
      id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
      body: { kind: 'text', label: { en: 'Body', ar: 'المتن' } },
      secret: { kind: 'text', label: { en: 'Secret', ar: 'السر' }, access: { update: () => false } },
      ...tenantField,
    },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { service: { operations: defaultOperations } },
  })
  const plain = mithaq.buildAsas({ http: [fetchHttp()], kayan: [notes, ...accessKayan] })
  await plain.kayan.notes.operations.create({ id: 1, body: 'kept', secret: 'kept' }, { actor: admin })
  const changed = await plain.kayan.notes.operations.update({ id: 1, body: 'changed', secret: 'dropped' })
  assert.equal(changed.body, 'changed')
  assert.equal(store.rows.get('notes')![0]!.secret, 'kept')
})

test('8. a callback beside rows narrows and cannot widen', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const table = mithaq.rows({
    member: { create: true, read: true, update: true, delete: true },
    auditor: { create: false, read: false, update: false, delete: false },
  })
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: { ...table, read: () => ({ title: { equals: 'Kept' } }) },
    targets: { service: { operations: defaultOperations } },
  })
  const guarded = mithaq.defineKayan({
    name: 'guarded',
    fields: {
      id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
      title: { kind: 'text', label: { en: 'Title', ar: 'العنوان' } },
      fee: { kind: 'number', label: { en: 'Fee', ar: 'الرسوم' }, access: { read: () => false } },
      ...tenantField,
    },
    access: table,
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, guarded, ...accessKayan] })
  await asas.kayan.courses.operations.create({ id: 1, title: 'Kept', fee: 300 }, { actor: member })
  await asas.kayan.courses.operations.create({ id: 2, title: 'Dropped', fee: 400 }, { actor: member })

  assert.deepEqual((await asas.kayan.courses.operations.find({}, { actor: member })).docs.map((row) => row.title), ['Kept'])
  await assert.rejects(() => asas.kayan.courses.operations.find({}, { actor: { id: 'u5', roles: ['auditor'] } }), /Forbidden/)

  const row = await asas.kayan.guarded.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: member })
  assert.equal(Object.hasOwn(row, 'fee'), false)
})

test('9. two rows in either order give the same answers', async () => {
  const table = {
    member: { read: tenantRow, update: true },
    auditor: { read: { title: { contains: 'Open' } }, update: false },
  } as const satisfies Record<string, AccessRow>
  const store = memoryStore()
  const mithaq = language(store)
  const forward = mithaq.defineKayan({
    name: 'forward',
    fields: courseFields,
    access: mithaq.rows({ member: table.member, auditor: table.auditor }),
    targets: { service: { operations: defaultOperations } },
  })
  const backward = mithaq.defineKayan({
    name: 'backward',
    fields: courseFields,
    access: mithaq.rows({ auditor: table.auditor, member: table.member }),
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [forward, backward, ...accessKayan] })
  for (const name of ['forward', 'backward'] as const) {
    store.rows.set(name, [
      { id: 1, title: 'Open one', fee: null, tenant: 'org1' },
      { id: 2, title: 'Closed one', fee: null, tenant: 'org1' },
      { id: 3, title: 'Open two', fee: null, tenant: 'org2' },
    ])
  }

  // The two row orders must answer alike, so the read names its own sort rather than take the default, which on a language
  // with no `createdAt` is `-id`.
  const read = async (name: 'forward' | 'backward') =>
    (await asas.kayan[name].operations.find({ sort: 'id' }, { actor: both })).docs.map((row) => row.id)
  assert.deepEqual(await read('forward'), await read('backward'))
  assert.deepEqual(await read('forward'), [1, 2, 3])
  assert.equal(await forward.access!.update({ slug: 'forward', user: both }), false)
  assert.equal(await backward.access!.update({ slug: 'backward', user: both }), false)
})

test('10. a user reference is resolved against the actor when the callback runs', async () => {
  const asas = built()
  await seed(asas)
  const moving = { id: 'u6', roles: ['member'], activeOrganizationId: 'org1' }

  assert.deepEqual((await asas.kayan.courses.operations.find({}, { actor: moving })).docs.map((row) => row.title), ['Mine'])
  moving.activeOrganizationId = 'org2'
  assert.deepEqual((await asas.kayan.courses.operations.find({}, { actor: moving })).docs.map((row) => row.title), ['Theirs'])

  await assert.rejects(
    () => asas.kayan.courses.operations.find({}, { actor: { id: 'u7', roles: ['member'] } }),
    /Access row filter "user\.activeOrganizationId" found nothing on the actor/,
  )
})

test('11. the language\'s rows reach every kayan placing the tenant field and nothing else: not a shared kayan, not one that opts out, and not a column that is only called tenant', () => {
  const table = {
    member: { create: true, read: true, update: true, delete: false },
    admin: { create: true, read: true, update: true, delete: true },
  } as const satisfies RowTable
  const mithaq = tenantLanguage(memoryStore(), table)
  const { tenant } = mithaq.targets
  const body = { kind: 'text', label: { en: 'Body', ar: 'المتن' } } as const
  const ops = { service: { operations: defaultOperations } }
  const owned = mithaq.defineKayan({ name: 'owned', fields: { id: courseFields.id, organization: tenant.field, body }, targets: ops })
  const byHand = mithaq.defineKayan({ name: 'byHand', fields: { id: courseFields.id, organizationId: { kind: 'relationship', relationTo: 'organization', targets: { tenant: true } }, body }, targets: ops })
  const optedOut = mithaq.defineKayan({ name: 'optedOut', access: { tenant: false, create: () => true, read: () => true }, fields: { id: courseFields.id, organization: tenant.field, body }, targets: ops })
  const shared = mithaq.defineKayan({ name: 'shared', fields: { id: courseFields.id, body }, targets: ops })
  const named = mithaq.defineKayan({ name: 'named', fields: { id: courseFields.id, body, ...tenantField }, targets: ops })
  const rowsOf = (kayan: { access?: unknown }) => (kayan.access as { rows?: unknown } | undefined)?.rows

  assert.deepEqual(rowsOf(owned), table, 'a kayan placing tenant.field answers from the language\'s rows')
  assert.deepEqual(rowsOf(byHand), table, 'and so does one binding a field by hand')
  assert.equal(rowsOf(optedOut), undefined, 'a kayan opting out on its access keeps its own callbacks alone')
  assert.equal((shared as { access?: unknown }).access, undefined, 'a shared kayan keeps its default deny, like the generated auth kayan')
  assert.equal((named as { access?: unknown }).access, undefined, 'and a column called tenant binds nothing: a kayan is owned by its field\'s binding, never a name')
  assert.equal((shared.fields as Record<string, unknown>).organization, undefined, 'nothing outside the kayan file added a column')
})

test('12. a user reference that resolves to null throws, exactly as a missing one does', async () => {
  const asas = built()
  await seed(asas)
  // A `null` active organization is not "every row whose tenant is null": it is
  // an actor with no organization, and the filter has nothing to constrain with.
  const between = { id: 'u8', roles: ['member'], activeOrganizationId: null }

  assert.throws(
    () => asas.courses.access!.read({ slug: 'courses', user: between }),
    /Access row filter "user\.activeOrganizationId" found nothing on the actor/,
  )
  await assert.rejects(
    () => asas.kayan.courses.operations.find({}, { actor: between }),
    /Access row filter "user\.activeOrganizationId" found nothing on the actor/,
  )
  await assert.rejects(
    () => asas.kayan.courses.operations.findByID({ id: 1 }, { actor: between }),
    /Access row filter "user\.activeOrganizationId" found nothing on the actor/,
  )
})

test('13. the rows are frozen all the way down, so a tool handed them cannot rewrite the policy', () => {
  const table = courseRows(language(memoryStore()))

  assert.throws(() => {
    ;(table.rows as Record<string, { delete?: unknown }>).member!.delete = true
  }, TypeError)
  assert.throws(() => {
    ;(table.rows as Record<string, unknown>).admin = { read: true }
  }, TypeError)
  // A nested `Where` and a field list are read live every time a callback runs,
  // so a change inside one would be a change to the policy.
  assert.throws(() => {
    ;(table.rows.member.read as { tenant: { equals: unknown } }).tenant.equals = 'org2'
  }, TypeError)
  assert.throws(() => {
    ;(table.rows.member.read as { tenant: unknown }).tenant = { equals: 'org2' }
  }, TypeError)
  assert.throws(() => {
    ;(table.rows.member.fields as unknown as string[]).push('fee')
  }, TypeError)
  assert.equal(table.rows.member.delete, false)
  assert.deepEqual(table.rows.member.fields, ['*', '!fee'])
  assert.deepEqual(Object.keys(table.rows), ['member', 'auditor', 'admin'])
  assert.equal(table.delete({ slug: 'courses', user: member }), false)
  assert.deepEqual(table.read({ slug: 'courses', user: member }), { tenant: { equals: 'org1' } })
})

test('14. a fields list of only exclusions reads as every field but those', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: mithaq.rows({
      member: { create: true, read: true, update: true, fields: ['!fee'] },
      admin: { create: true, read: true, update: true },
    }),
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })

  const seen = await asas.kayan.courses.operations.findByID({ id: 1 }, { actor: member })
  assert.equal(seen?.title, 'Mine')
  assert.equal(seen?.tenant, 'org1')
  assert.equal(Object.hasOwn(seen!, 'fee'), false)
})

test('15. under rows, a field callback beside them throws the naming error too', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: {
      ...courseFields,
      tenant: {
        kind: 'text',
        label: { en: 'Tenant', ar: 'المستأجر' },
        rules: { defaultValue: user.activeOrganizationId },
        access: { update: () => false },
      },
    },
    access: mithaq.rows({ member: { create: true, read: true, update: true, delete: true } }),
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: member })

  await assert.rejects(
    () => asas.kayan.courses.operations.update({ id: 1, title: 'Changed', tenant: 'org2' }, { actor: member }),
    /Forbidden: kayan "courses" operation "update" for roles "member" cannot write field "tenant"\.$/,
  )
  assert.equal(store.rows.get('courses')![0]!.tenant, 'org1')
  assert.equal(store.rows.get('courses')![0]!.title, 'Mine')
})

test('16. rule 3: a denied value is omitted, never wrapped in a sentinel that keeps it', async () => {
  const asas = built()
  await seed(asas)

  const seen = await asas.kayan.courses.operations.findByID({ id: 1 }, { actor: member })
  assert.equal('fee' in seen!, false)
  assert.equal(Object.keys(seen!).includes('fee'), false)
  assert.equal(JSON.stringify(seen).includes('fee'), false)
  assert.equal(seen!.fee, undefined)
  assert.equal(asas.store.rows.get('courses')![0]!.fee, 300)
})

test('17. rule 4: no option on a managed method skips access', async () => {
  const asas = built()
  await seed(asas)

  // There is no bypass flag; an unknown option is not one either. A system
  // actor is a role with a row, which is the only way in.
  for (const options of [
    { actor: guest, overrideAccess: true },
    { actor: guest, disableErrors: true },
    { overrideAccess: true },
  ] as never[]) {
    await assert.rejects(() => asas.kayan.courses.operations.find({}, options), /Forbidden/)
  }
  await assert.rejects(
    () => asas.kayan.courses.operations.create({ id: 3, title: 'Slipped', tenant: 'org1' }, { overrideAccess: true } as never),
    /Forbidden/,
  )
  assert.equal(asas.store.rows.get('courses')!.length, 2)
})

test('18. the string form that a typed reference replaced throws and names the replacement', async () => {
  const store = memoryStore()
  const table = {
    member: { read: { tenant: { equals: '$CURRENT_USER.activeOrganizationId' } } as never },
  } as const
  const mithaq = language(store, table)
  const courses = mithaq.defineKayan({ name: 'courses', fields: courseFields, access: mithaq.rows(table), targets: { service: { operations: defaultOperations } } })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })

  await assert.rejects(
    () => asas.kayan.courses.operations.find({}, { actor: member }),
    /names the actor as the string "\$CURRENT_USER\.activeOrganizationId".*write `user\.activeOrganizationId`/s,
  )
})

test('19. a user reference is data, so the rows a tool reads survive JSON', () => {
  const mithaq = language(memoryStore())
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: courseRows(mithaq),
    targets: { service: { operations: defaultOperations } },
  })

  assert.deepEqual(JSON.parse(JSON.stringify(courses.access!.rows)).member.read, {
    tenant: { equals: { $user: 'activeOrganizationId' } },
  })
  assert.equal(Object.isFrozen(tenantRow.tenant.equals), true)
})

test('20. a kayan table is compiled with the language reader, so a role it never returns can never fire', async () => {
  const store = memoryStore()
  // This language reads roles off `tier`, not off `roles`, and only the two
  // tiers below are ever returned: `admin` is a role the table may be keyed on
  // and the reader can never produce.
  const tiers = ['member', 'auditor']
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: store,
      zod: zodTarget,
      rbac: rbacTarget({
        roles: fourRoles,
        rolesOf: (actor: { tier?: string }) => (actor?.tier && tiers.includes(actor.tier) ? [actor.tier] : []),
        kayan: { roles: 'roles', memberRoles: 'memberRoles' },
      }),
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
    },
  })
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: mithaq.rows({
      member: { create: true, read: tenantRow, update: true, delete: true },
      auditor: { create: true, read: true },
      // A row the reader can never fire, because `admin` is not a tier it
      // returns. Nothing at build says so; the row is simply dead.
      admin: { create: true, read: true, update: true, delete: true },
    }),
    targets: { service: { operations: defaultOperations } },
  })
  const options = mithaq.rows({ member: { create: true, read: true } }, {})
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })
  const tiered = { id: 'u1', tier: 'member', activeOrganizationId: 'org1' }
  const audited = { id: 'u2', tier: 'auditor', roles: ['member'], activeOrganizationId: 'org1' }
  const roled = { id: 'u3', roles: ['member'], activeOrganizationId: 'org1' }
  const claimingAdmin = { id: 'u4', tier: 'admin', roles: ['admin'], activeOrganizationId: 'org1' }

  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: tiered })
  assert.deepEqual((await asas.kayan.courses.operations.find({}, { actor: tiered })).docs.map((row) => row.title), ['Mine'])
  await assert.rejects(() => asas.kayan.courses.operations.find({}, { actor: roled }), /Forbidden/)
  assert.equal(await courses.access!.read({ slug: 'courses', user: audited }), true)
  assert.deepEqual(mithaq.rows({}, {}).roles(claimingAdmin), [])
  assert.equal(await courses.access!.read({ slug: 'courses', user: claimingAdmin }), false)
  await assert.rejects(() => asas.kayan.courses.operations.find({}, { actor: claimingAdmin }), /Forbidden/)
  await assert.rejects(
    () => asas.kayan.courses.operations.create({ id: 2, title: 'Claimed', fee: 1, tenant: 'org1' }, { actor: claimingAdmin }),
    /Forbidden/,
  )
  assert.deepEqual(options.roles(tiered), ['member'])
  assert.deepEqual(options.roles(roled), [])
})

test('21. an update naming an id that is not there and a delete naming a row another tenant owns are both refused with 404 in the same words, and that row stays', async () => {
  const store = memoryStore()
  const table = {
    member: { create: true, read: tenantRow, update: tenantRow, delete: tenantRow },
    admin: { create: true, read: true, update: true, delete: true },
  } as const satisfies RowTable
  const mithaq = language(store, table)
  const courses = mithaq.defineKayan({ name: 'courses', fields: courseFields, access: mithaq.rows(table), targets: { service: { operations: defaultOperations } } })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })
  await asas.kayan.courses.operations.create({ id: 2, title: 'Theirs', fee: 400 }, { actor: otherAdmin })

  const absent = await asas.kayan.courses.operations.update({ id: 99, title: 'Nothing' }, { actor: admin }).catch((thrown: unknown) => thrown)
  assert.ok(absent instanceof AsasError, 'an update naming an id that is not there is an AsasError')
  assert.equal(absent.status, 404, 'an update naming an id that is not there carries 404')
  assert.equal(absent.message, 'No "courses" row with id 99 to update.', 'the update refusal carries the runner\'s own wording')

  // Row 2 is addressed but never found: 404 rather than 403, because 403 says the operation was denied, which this one was
  // not.
  const theirs = await asas.kayan.courses.operations.delete({ id: 2 }, { actor: member }).catch((thrown: unknown) => thrown)
  assert.ok(theirs instanceof AsasError, 'a delete naming a row another tenant owns is an AsasError')
  assert.equal(theirs.status, 404, 'a delete naming a row another tenant owns carries 404, not 403')

  // The same sentence with the caller's own id in it, so nothing in the words says whether the row exists.
  const gone = await asas.kayan.courses.operations.delete({ id: 99 }, { actor: member }).catch((thrown: unknown) => thrown)
  assert.ok(gone instanceof AsasError, 'a delete naming an id that is not there is an AsasError')
  assert.equal(gone.status, theirs.status, 'the absent row and the excluded row carry the same status')
  assert.equal(theirs.message, 'No "courses" row with id 2 to delete.', 'the excluded row is refused in the runner\'s own wording')
  assert.equal(gone.message, 'No "courses" row with id 99 to delete.', 'the absent row is refused in those same words')

  assert.deepEqual(store.rows.get('courses')?.map((row) => row.id), [1, 2])
})

/** `member` holds a named list, `auditor` holds nothing, and `admin` holds every key. */
const gradedTable = {
  member: {
    create: true,
    read: tenantRow,
    update: tenantRow,
    permissions: [
      'courses.create',
      'courses.find',
      'courses.findByID',
      'courses.fields.id',
      'courses.fields.tenant',
      'courses.fields.title',
    ],
  },
  auditor: { read: true, permissions: [] },
  // A row naming no `permissions` in a table where another row does: a half-graded table denies rather than letting a role
  // through ungraded.
  viewer: { read: true },
  admin: { create: true, read: true, update: true, delete: true, permissions: '*' },
} as const satisfies RowTable

/**
 * The rows the graded global answers from, shared with no kayan, because `courses` declares its own. `member` holds every
 * key this global has except `settings.update`, the one the gate has to refuse.
 */
const gradedGlobalTable = {
  member: {
    read: true,
    update: true,
    permissions: [
      'settings.findOne',
      'settings.fields.globalType',
      'settings.fields.id',
      'settings.fields.maintenance',
      'settings.fields.siteTitle',
    ],
  },
  admin: { create: true, read: true, update: true, delete: true, permissions: '*' },
} as const satisfies RowTable

/** A global of the whole project: it places no tenant field, so its `globalType` keeps it to one row. */
const settingsFields = {
  id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
  siteTitle: { kind: 'text', label: { en: 'Site title', ar: 'عنوان الموقع' } },
  maintenance: { kind: 'checkbox', label: { en: 'Maintenance', ar: 'الصيانة' } },
  globalType: defaultGlobalFields.globalType,
} as const

/** The same global, one row per organization: the tenant field made unique, and a `globalType` that is not. */
const tenantSettingsFields = (mithaq: ReturnType<typeof tenantLanguage>) => ({
  id: settingsFields.id,
  siteTitle: settingsFields.siteTitle,
  maintenance: settingsFields.maintenance,
  organization: { ...mithaq.targets.tenant.field, rules: { ...mithaq.targets.tenant.field.rules, unique: true } },
  globalType: { ...defaultGlobalFields.globalType, rules: { required: true } },
} as const)

/** The organization a tenant field points at: a shared kayan, so it inherits no row and keeps its default deny. */
const organizationOf = (mithaq: ReturnType<typeof tenantLanguage>) =>
  mithaq.defineKayan({ name: 'organization', fields: { id: { kind: 'text', label: { en: 'ID', ar: 'المعرف' } } }, targets: { service: { operations: defaultOperations } } })

const graded = () => {
  const store = memoryStore()
  const mithaq = language(store, gradedGlobalTable)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: mithaq.rows(gradedTable),
    targets: { service: { operations: defaultOperations } },
  })
  const settings = mithaq.defineGlobal({ name: 'settings', fields: settingsFields, access: mithaq.rows(gradedGlobalTable) as Pick<ReturnType<typeof mithaq.rows>, 'read' | 'update'>, targets: { service: { operations: defaultGlobalOperations } } })
  return { courses, settings, store, ...mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan], global: [settings] }) }
}

test('22. the catalog is derived once, an operation key and a field key per declared kayan and per declared global and nothing for a kayan the project never declared', () => {
  const asas = graded()

  assert.deepEqual(
    Object.keys(asas.statements).sort(),
    ['courses', 'memberRoles', 'roles', 'settings'],
    'one resource per declared kayan and per declared global, and no other',
  )
  assert.ok(asas.catalog.includes('courses.find'), 'a shipped operation is a key')
  assert.ok(asas.catalog.includes('courses.delete'), 'every operation the kayan kept is a key')
  assert.ok(asas.catalog.includes('courses.fields.fee'), 'every field is a key under fields')
  assert.ok(asas.catalog.includes('courses.fields.tenant'), 'a default field is a key like any other')
  assert.ok(asas.catalog.includes('settings.findOne'), 'a global contributes its operations like any kayan')
  assert.ok(asas.catalog.includes('settings.fields.siteTitle'), 'and one key per field of its own')
  assert.ok(
    !asas.catalog.some((key) => key.startsWith('sessions.')),
    'a kayan this project never declared has no key at all',
  )
  assert.equal(new Set(asas.catalog).size, asas.catalog.length, 'the catalog names each key once')

  // Derived once and never stored: the flat keys are exactly the statements flattened, so the two publications cannot
  // drift.
  assert.deepEqual(
    [...asas.catalog].sort(),
    Object.entries(asas.statements)
      .flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`))
      .sort(),
    'the flat catalog and the statements are one derivation in two shapes',
  )
  assert.deepEqual([...graded().catalog].sort(), [...asas.catalog].sort(), 'a second build derives the same keys')
})

test('23. the statements are that same catalog in Better Auth\'s shape, and createAccessControl takes them', () => {
  const asas = built()

  assert.deepEqual(
    [...asas.statements.courses!].sort(),
    ['count', 'create', 'delete', 'deleteMany', 'fields.fee', 'fields.id', 'fields.tenant', 'fields.title', 'find', 'findByID', 'update', 'updateMany'],
    'one resource per kayan, whose actions are its operations, the two bulk ones included, and its field keys',
  )
  for (const key of asas.catalog) {
    const [resource, ...rest] = key.split('.')
    assert.ok(asas.statements[resource!]?.includes(rest.join('.')), `${key} is in the statements`)
  }

  const ac = createAccessControl(asas.statements)
  const reader = ac.newRole({ courses: ['find', 'fields.fee'] })
  assert.equal(reader.authorize({ courses: ['find'] }).success, true, 'an action the role holds authorizes')
  assert.equal(reader.authorize({ courses: ['fields.fee'] }).success, true, 'a field key is an action like any other')
  assert.equal(reader.authorize({ courses: ['delete'] }).success, false, 'an action the role lacks does not')
})

test('24. a permission key gates the operation: the role that holds it passes and the role that does not is refused with 403', async () => {
  const asas = graded()
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })

  const page = await asas.kayan.courses.operations.find({}, { actor: member })
  assert.deepEqual(page.docs.map((row) => row.title), ['Mine'], 'the row table still gives the scope')

  // `courses.update` is not among the keys the member row holds, and the row's own `update` answer is a filter, so the
  // refusal is the permission's alone.
  assert.deepEqual(
    await asas.courses.access!.update({ slug: 'courses', user: member }),
    { tenant: { equals: 'org1' } },
    'the row answer still admits the update',
  )
  const refused = await asas.kayan.courses.operations
    .update({ id: 1, title: 'Changed' }, { actor: member })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'a missing permission is a refusal the caller caused')
  assert.equal(refused.status, 403, 'a missing permission is 403, never a 401 and never a 500')
  assert.equal(refused.key, 'error.forbidden.permission', 'the refusal carries its own key')
  assert.match(refused.message, /needs permission "courses\.update"/, 'the refusal names the key it wanted')

  const changed = await asas.kayan.courses.operations.update({ id: 1, title: 'Changed' }, { actor: admin })
  assert.equal(changed.title, 'Changed', 'a role whose row holds every key is not gated')
})

test('25. an empty permission list refuses, a forged one refuses, and so does a row naming no permissions inside a grading table', async () => {
  const asas = graded()
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })

  // `auditor` reads with no filter and holds no key, so the row admits and the permission refuses. An empty list is a list,
  // never an absent one.
  const empty = await asas.kayan.courses.operations.find({}, { actor: { id: 'u9', roles: ['auditor'], activeOrganizationId: 'org1' } }).catch((thrown: unknown) => thrown)
  assert.ok(empty instanceof AsasError, 'an empty permission list refuses')
  assert.equal(empty.status, 403, 'and refuses with 403')

  // Nothing marked this actor, so its `permissions` property is a claim and not a grant.
  const forged = { id: 'u10', roles: ['auditor'], activeOrganizationId: 'org1', permissions: ['courses.find', 'courses.fields.fee'] }
  const refused = await asas.kayan.courses.operations.find({}, { actor: forged }).catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'a permission an actor wrote on itself grants nothing')
  assert.equal(refused.status, 403, 'and it is the same 403')

  // `viewer` names no `permissions` key in a table where the other rows do: the table grades, so a half-graded table denies
  // rather than letting the role through ungraded.
  const absent = await asas.kayan.courses.operations
    .find({}, { actor: { id: 'u11', roles: ['viewer'], activeOrganizationId: 'org1' } })
    .catch((thrown: unknown) => thrown)
  assert.ok(absent instanceof AsasError, 'a row naming no permissions inside a grading table holds none')
  assert.equal(absent.status, 403, 'and it refuses with the same 403')
  assert.match(absent.message, /needs permission "courses\.find"/, 'naming the key it wanted')
})

test('26. a field key narrows the readable fields, so the row stays readable and the field it never names is gone', async () => {
  const asas = graded()
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })

  const page = await asas.kayan.courses.operations.find({}, { actor: member })
  assert.equal(page.docs.length, 1, 'the row is readable')
  assert.equal(page.docs[0]!.title, 'Mine', 'a field whose key the row holds is there')
  assert.equal('fee' in page.docs[0]!, false, 'a field whose key the row never holds is gone')

  // The row's own `fields` list admits everything, so the narrowing is the permission key's alone, and it hides the field on
  // every path a value leaves through, `where` included.
  await assert.rejects(
    () => asas.kayan.courses.operations.find({ where: { fee: { equals: 300 } } }, { actor: member }),
    /fee/,
    'a field the permission hides cannot be filtered on either',
  )
})

test('27. a permission key no kayan declares is refused at buildAsas, naming the key and the role that wrote it', () => {
  const store = memoryStore()
  const mithaq = language(store)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: mithaq.rows({ member: { read: true, permissions: ['courses.archive'] } }),
    targets: { service: { operations: defaultOperations } },
  })
  assert.throws(
    () => mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses] }),
    /Access row "member" holds permission "courses\.archive", which is not a key of this project's catalog/,
  )
})

test('28. a global is gated by the same permission key a kayan is, so the operation the rows grade and the role does not hold is refused with 403', async () => {
  const asas = graded()
  // Written straight into the store rather than through `update`: `settingsFields.id` carries no `defaultValue`, so the
  // insert branch would refuse it with `id: Invalid input: expected number, received undefined`.
  asas.store.rows.set('settings', [{ id: 1, siteTitle: 'Theirs', maintenance: false, globalType: 'settings' }])

  assert.equal(
    await (asas.settings.access as unknown as { update(args: unknown): Promise<unknown> }).update({ slug: 'settings', user: member }),
    true,
    'the row answer still admits the update',
  )
  const found = await asas.global.settings.operations.findOne({}, { actor: member })
  assert.equal(found?.siteTitle, 'Theirs', 'the key the row holds passes the operation it names')

  const refused = await asas.global.settings.operations
    .update({ siteTitle: 'Mine' }, { actor: member })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'a global operation whose key the row never holds is refused')
  assert.equal(refused.status, 403, 'and it is the same 403 a kayan carries')
  assert.equal(refused.key, 'error.forbidden.permission', 'under the same message key')
  assert.match(refused.message, /needs permission "settings\.update"/, 'naming the key it wanted')
  assert.equal(asas.store.rows.get('settings')![0]!.siteTitle, 'Theirs', 'and the row it refused is unchanged')
})

test('29. a global holding a row table no kayan shares has its keys checked against the catalog at buildAsas', () => {
  const store = memoryStore()
  // The rows are the language's, inherited by the global alone, which places the tenant field, while the organization keeps
  // its default deny.
  const mithaq = tenantLanguage(store, { member: { read: true, permissions: ['settings.archive'] } })
  const settings = mithaq.defineGlobal({ name: 'settings', fields: tenantSettingsFields(mithaq), targets: { service: { operations: defaultGlobalOperations } } })

  assert.throws(
    () => mithaq.buildAsas({ http: [fetchHttp()], kayan: [organizationOf(mithaq)], global: [settings] }),
    /Access row "member" holds permission "settings\.archive", which is not a key of this project's catalog/,
  )
})

test('30. the access target\'s answer decides whenever the strategy writes one, and the layer stands aside only where no target answered at all, so an answer that is no list of strings holds nothing rather than everything', async () => {
  // The snapshot is taken inside a strategy, so the actor goes through one, and
  // the key reaches it the one way it may: the build's access target answering
  // for this actor. A build with no access target answers nothing at all.
  const marked = async (answer: unknown) => {
    const strategy = betterAuthStrategy({
      server: {
        api: { getSession: async () => ({ session: {}, user: { id: 'u1' } }) },
        handler: async () => new Response(null),
      } as never,
      collection: 'user',
      onError: console.error,
      assigned: (answer === undefined ? undefined : () => ({ permissions: answer, roles: [] })) as never,
    })
    return actorPermissions((await strategy.authenticate({ headers: new Headers() })).user)
  }

  assert.equal(await marked(undefined), undefined, 'no target answering at all is no target deciding')
  assert.deepEqual([...(await marked(['courses.find'])) as ReadonlySet<string>], ['courses.find'], 'a list of strings is the keys it names')
  assert.deepEqual([...(await marked([])) as ReadonlySet<string>], [], 'an empty list is a target that decided and found none')
  assert.equal(await marked('*'), true, 'and the one string that is not a key is every key of the project')

  // A present key is an answer, and one that is no list of strings is a target that decided nothing this layer can read,
  // which holds no key. A partial list is malformed too: narrowing it to its strings would hand out a subset of a claim
  // nothing vouched for.
  for (const claimed of [null, 'courses.find', 42, true, {}, new Set(['courses.find']), ['courses.find', 1, null]]) {
    const keys = await marked(claimed)
    assert.notEqual(keys, undefined, `a permissions value of ${String(claimed)} is present, so it is never read as absent`)
    assert.equal((keys as ReadonlySet<string>).size, 0, `and a permissions value of ${String(claimed)} holds no key`)
  }
})

/**
 * Access is a target. A system role is code, a tenant's own role is a row in the `roles` kayan scoped by the tenant field,
 * and who holds which is a row in `memberRoles`. The target resolves both at the moment the strategy makes the actor.
 * `memberRole` is Better Auth's own governance column, which nothing here reads.
 */
type RbacActor = { activeOrganizationId: string; memberRole?: string }

/**
 * The roles this fixture ships. `member` holds no `courses.update` and no `courses.delete`, so those are what a custom role
 * has to widen and what a granter may not hand out. `admin` holds `'*'`, the tenant's root granter.
 */
const rbacRoles = {
  member: {
    label: { ar: 'عضو', en: 'Member' },
    permissions: [
      'courses.create',
      'courses.find',
      'courses.findByID',
      'courses.fields.fee',
      'courses.fields.id',
      'courses.fields.tenant',
      'courses.fields.title',
      'roles.create',
      'roles.find',
      'roles.findByID',
      'roles.update',
      'roles.fields.id',
      'roles.fields.name',
      'roles.fields.permissions',
      'roles.fields.tenant',
    ],
  },
  admin: { label: { ar: 'مدير', en: 'Admin' }, permissions: '*' },
} as const satisfies SystemRoles

/**
 * One table on the access target, inherited by every kayan that keeps the tenant field: tenancy is one `'*'` row and no row
 * names a holding, because what a role holds is the target's answer and never a second one written here.
 */
const rbacTable = {
  '*': { create: true, read: tenantRow, update: tenantRow, delete: tenantRow },
} as const satisfies RowTable

const rbacBuilt = () => {
  const store = memoryStore()
  const target = rbacTarget({
    roles: rbacRoles,
    access: rbacTable,
    // The slugs the target resolved, off the trusted snapshot. Better Auth's own `member.role` is read nowhere.
    rolesOf: (actor: RbacActor) => actorRoles(actor) ?? [],
    kayan: { roles: 'roles', memberRoles: 'memberRoles' },
  })
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, rbac: target, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  // Every kayan names the target's rows as its own: no kayan here places a tenant field, so none inherits them.
  const own = mithaq.rows(rbacTable)
  const courses = mithaq.defineKayan({ name: 'courses', fields: courseFields, access: own, targets: { service: { operations: defaultOperations } } })
  const roleFields = {
    id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
    name: { kind: 'text', label: { en: 'Name', ar: 'الاسم' }, rules: { required: true } },
    permissions: { kind: 'textArray', label: { en: 'Permissions', ar: 'الصلاحيات' }, rules: { required: true } },
    ...tenantField,
  } as const
  const roles = mithaq.defineKayan({
    name: 'roles',
    fields: roleFields,
    access: own,
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          create: { steps: ({ steps }) => [grantedPermissions, steps.insert] },
          update: { steps: ({ steps }) => [grantedPermissions, steps.update] },
        },
      },
    },
  })
  const memberRoles = mithaq.defineKayan({
    name: 'memberRoles',
    access: own,
    fields: {
      id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
      user: { kind: 'text', label: { en: 'Member', ar: 'العضو' }, rules: { required: true } },
      role: { kind: 'text', label: { en: 'Role', ar: 'الدور' }, rules: { required: true } },
      ...tenantField,
    },
    targets: { service: { operations: defaultOperations } },
  })
  // A kayan whose own table names no `permissions`, so it grades nothing of its own and the target's answer is the whole
  // answer for it.
  const notes = mithaq.defineKayan({
    name: 'notes',
    fields: {
      id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
      body: { kind: 'text', label: { en: 'Body', ar: 'النص' } },
      ...tenantField,
    },
    access: mithaq.rows({ '*': { create: true, read: tenantRow, update: tenantRow } }),
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, roles, memberRoles, notes] })
  return { asas, courses, notes, roles, store, target }
}

/** A different member each call, so one test's assignments never reach another's. */
let members = 0

/**
 * Written structurally rather than as `rbacBuilt`'s own return, so a case building its own pair of kayan under other names
 * can hand over the same two things.
 */
type Resolving = {
  store: ReturnType<typeof memoryStore>
  target: { resolve(args: { store: never; tenant: unknown; member: unknown; actor: object; ownership: (kayan: string) => string | undefined }): Promise<unknown> }
}

/**
 * An actor through the real strategy, so its roles and keys come from the snapshot the strategy took and never from the
 * object. Passing the build turns the access target on.
 */
const rbacActor = async (
  assigned: string | undefined,
  organizationId: string | undefined,
  built?: Resolving,
  resolve?: Parameters<typeof betterAuthStrategy>[0]['assigned'],
) => {
  const id = `u${(members += 1)}`
  if (built && organizationId && assigned) {
    const rows = built.store.rows.get('memberRoles') ?? []
    for (const role of assigned.split(',')) {
      rows.push({ id: rows.length + 1, role, tenant: organizationId, user: id })
    }
    built.store.rows.set('memberRoles', rows)
  }
  const answer = resolve ?? (built ? ({ tenant, member, actor }: { tenant: unknown; member: unknown; actor: object }) => built.target.resolve({ store: built.store as never, tenant, member, actor, ownership: () => 'tenant' }) : undefined)
  const strategy = betterAuthStrategy({
    server: {
      api: {
        getSession: async () => ({ session: { activeOrganizationId: organizationId }, user: { id } }),
        getActiveMemberRole: async () => ({ role: 'member' }),
        listOrganizations: async () => (organizationId ? [{ id: organizationId }] : []),
      },
      handler: async () => new Response(null),
    } as never,
    collection: 'user',
    onError: console.error,
    assigned: answer as never,
  })
  return (await strategy.authenticate({ headers: new Headers() })).user as unknown as RbacActor
}

const seedRole = (built: ReturnType<typeof rbacBuilt>, rows: Record<string, unknown>[]) => {
  built.store.rows.set('roles', rows)
}

test('30a. a session whose active organization is not one the provider lists it a member of resolves no key there, and its provider requests act in no organization', async () => {
  const built = rbacBuilt()
  // An assignment in the organization the session names, which the provider does not list for this person.
  built.store.rows.set('memberRoles', [{ id: 1, role: 'member', tenant: 'org-other', user: 'u-stray' }])
  const seen: [string | null | undefined, boolean][] = []
  const strategy = betterAuthStrategy({
    server: {
      api: {
        getSession: async () => ({ session: { activeOrganizationId: 'org-other' }, user: { id: 'u-stray' } }),
        getActiveMemberRole: async () => ({ role: 'member' }),
        listOrganizations: async () => [{ id: 'org-own' }],
      },
      handler: async () => (seen.push([requestOrganization(), holdsPermission('courses.find')]), new Response(null)),
    } as never,
    collection: 'user',
    onError: console.error,
    assigned: (({ tenant, member, actor }: { tenant: unknown; member: unknown; actor: object }) =>
      built.target.resolve({ store: built.store as never, tenant, member, actor, ownership: () => 'tenant' })) as never,
  })
  const actor = (await strategy.authenticate({ headers: new Headers() })).user
  assert.ok(actor, 'the person is signed in')
  assert.deepEqual([...keysOf(actor)!], [], 'and holds no key of the organization its session names')
  assert.deepEqual(actorRoles(actor), [], 'and no role there')
  await strategy.handler(new Request('http://test/api/auth/user/organization/update'))
  assert.deepEqual(seen, [[null, false]], 'a provider route it calls acts in no organization and holds no key')
})

test('31. a role row grants its keys inside the tenant, and an operation outside them is refused with 403', async () => {
  const built = rbacBuilt()
  seedRole(built, [{ id: 1, name: 'editor', permissions: ['courses.update'], tenant: 'org1' }])
  await built.asas.kayan.courses.operations.create(
    { id: 1, title: 'Mine', fee: 300, tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  const plain = await rbacActor('member', 'org1', built)
  const refused = await built.asas.kayan.courses.operations
    .update({ id: 1, title: 'Changed' }, { actor: plain })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'an operation no role grants is a refusal the caller caused')
  assert.equal(refused.status, 403, 'and it is 403, never a 401 and never a 500')
  assert.match(refused.message, /needs permission "courses\.update"/, 'naming the key it wanted')

  const widened = await rbacActor('member,editor', 'org1', built)
  assert.ok(keysOf(widened)!.has('courses.update'), 'the target put the role row\'s key on the actor')
  assert.ok(keysOf(widened)!.has('courses.find'), 'beside the system role\'s own keys')
  assert.ok(!keysOf(widened)!.has('courses.delete'), 'and nothing neither of them holds')
  const changed = await built.asas.kayan.courses.operations.update({ id: 1, title: 'Changed' }, { actor: widened })
  assert.equal(changed.title, 'Changed', 'and the operation the role names now passes')

  const stillRefused = await built.asas.kayan.courses.operations
    .delete({ id: 1 }, { actor: widened })
    .catch((thrown: unknown) => thrown)
  assert.ok(stillRefused instanceof AsasError, 'an operation outside both roles is still refused')
  assert.equal(stillRefused.status, 403, 'with the same 403')
})

test('32. a granter cannot write a key it does not itself hold, and the keys it is measured by are the trusted snapshot', async () => {
  const built = rbacBuilt()
  const granter = await rbacActor('member', 'org1', built)

  const refused = await built.asas.kayan.roles.operations
    .create({ id: 1, name: 'super', permissions: ['courses.delete', 'courses.fields.title'], tenant: 'org1' }, { actor: granter })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'granting a key the granter lacks is a refusal the caller caused')
  assert.equal(refused.status, 403, 'and it is 403')
  assert.equal(refused.key, 'error.forbidden.grant', 'under its own message key')
  assert.match(refused.message, /"courses\.delete"/, 'naming the key it would not hand over')
  assert.equal(built.store.rows.get('roles')?.length ?? 0, 0, 'and no row was written')

  const made = await built.asas.kayan.roles.operations.create(
    { id: 2, name: 'finder', permissions: ['courses.find', 'courses.fields.title'], tenant: 'org1' },
    { actor: granter },
  )
  assert.deepEqual(made.permissions, ['courses.find', 'courses.fields.title'], 'a key the granter holds is written')

  // A `permissions` array written onto the actor after the strategy returned it is a claim and not a grant: the guard reads
  // the snapshot `markAuthActor` took. The actor is the real one, so the row answer admits the write and the refusal is the
  // guard's.
  const forged = await rbacActor('member', 'org1', built)
  ;(forged as { permissions?: unknown }).permissions = ['courses.delete']
  assert.ok(!keysOf(forged)!.has('courses.delete'), 'the snapshot is unchanged by the property')
  const bought = await built.asas.kayan.roles.operations
    .create({ id: 3, name: 'forged', permissions: ['courses.delete', 'courses.fields.title'], tenant: 'org1' }, { actor: forged })
    .catch((thrown: unknown) => thrown)
  assert.ok(bought instanceof AsasError, 'a forged holding buys nothing')
  assert.equal(bought.status, 403, 'and the refusal is the same 403')
  assert.equal(bought.key, 'error.forbidden.grant', 'from the guard, which the write reached, and not from the row answer')
})

test('33. a key the catalog does not name is refused by the validate step with 400, whether the resource exists with an action that does not or the resource does not exist at all', async () => {
  const built = rbacBuilt()
  const granter = await rbacActor('admin', 'org1', built)
  assert.equal(actorPermissions(granter), true, 'the admin holds every key of the project, which is what `\'*\'` means')

  for (const key of ['courses.archive', 'lessons.find']) {
    const refused = await built.asas.kayan.roles.operations
      .create({ id: 1, name: 'typo', permissions: [key], tenant: 'org1' }, { actor: granter })
      .catch((thrown: unknown) => thrown)
    assert.ok(refused instanceof AsasError, `"${key}" is refused even though the granter holds every key`)
    assert.equal(refused.status, 400, 'a key outside the vocabulary is the caller sending something the project has no name for')
    assert.equal(refused.key, 'error.invalid.permission', 'under its own message key')
    assert.match(refused.message, new RegExp(key.replace('.', '\\.')), 'naming the key it refused')
  }
  assert.ok(built.asas.catalog.includes('courses.find'), 'the resource exists in the catalog')
  assert.ok(!built.asas.catalog.includes('courses.archive'), 'and the action it was asked for does not')
})

test('63a. a role row written at runtime that holds an operation key of a kayan and no field key of it is refused 400, naming the key and the kayan, as a system role is at buildAsas', async () => {
  const built = rbacBuilt()
  const granter = await rbacActor('admin', 'org1', built)
  const refusal = (call: Promise<unknown>) => call.then(() => undefined, (thrown: unknown) => thrown)
  const refused = await refusal(built.asas.kayan.roles.operations.create({ id: 1, name: 'reader', permissions: ['courses.find'], tenant: 'org1' }, { actor: granter }))
  assert.ok(refused instanceof AsasError, 'a create holding courses.find and no courses field key is refused')
  assert.equal(refused.status, 400, 'as the caller\'s 400')
  assert.equal(refused.key, 'error.invalid.permission_fields', 'under its own message key')
  assert.deepEqual(refused.params, { kayan: 'roles', permission: 'courses.find', resource: 'courses' }, 'naming the key and the kayan')
  assert.equal(built.store.rows.get('roles')?.length ?? 0, 0, 'and no row was written')

  const made = await built.asas.kayan.roles.operations.create({ id: 2, name: 'reader', permissions: ['courses.find', 'courses.fields.title'], tenant: 'org1' }, { actor: granter })
  assert.deepEqual(made.permissions, ['courses.find', 'courses.fields.title'], 'one field key of the kayan is enough')
  const dropped = await refusal(built.asas.kayan.roles.operations.update({ id: 2, permissions: ['courses.find', 'roles.fields.name'] }, { actor: granter }))
  assert.ok(dropped instanceof AsasError && dropped.status === 400 && dropped.key === 'error.invalid.permission_fields', 'an update that leaves the kayan with no field key is refused the same way')
  assert.equal((await built.asas.kayan.roles.operations.update({ id: 2, permissions: ['courses.fields.title'] }, { actor: granter })).permissions?.length, 1, 'while a field key alone, with no operation, is written')
})

test('34. a role row in another tenant is not resolvable, and the same name in this one is', async () => {
  const built = rbacBuilt()
  seedRole(built, [
    { id: 1, name: 'editor', permissions: ['courses.update'], tenant: 'org2' },
    { id: 2, name: 'reader', permissions: ['courses.findByID'], tenant: 'org1' },
  ])
  await built.asas.kayan.courses.operations.create(
    { id: 1, title: 'Mine', fee: 300, tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  const outsider = await rbacActor('editor', 'org1', built)
  assert.deepEqual([...keysOf(outsider)!], [], 'a role row another tenant owns resolves to nothing here')
  const refused = await built.asas.kayan.courses.operations
    .update({ id: 1, title: 'Changed' }, { actor: outsider })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'so the key it would have granted is not held')
  assert.equal(refused.status, 403, 'and the operation is refused with 403')

  const inside = await rbacActor('reader', 'org1', built)
  assert.deepEqual([...keysOf(inside)!], ['courses.findByID'], 'a row in this tenant resolves')

  // The same name in the other tenant resolves to the other tenant's keys, so the filter is the tenant's and never the
  // name's alone.
  const theirs = await rbacActor('editor', 'org2', built)
  assert.deepEqual([...keysOf(theirs)!], ['courses.update'], 'and the other tenant reads its own row')
})

test('35. a role name matching no row writes an empty list, which refuses rather than standing the layer aside', async () => {
  const built = rbacBuilt()
  await built.asas.kayan.notes.operations.create(
    { id: 1, body: 'Mine', tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  // `notes` names no `permissions` in its own table and the target answered a list, so the list is the whole answer.
  const decided = await rbacActor('ghost', 'org1', built)
  assert.deepEqual([...keysOf(decided)!], [], 'a target that resolved nothing writes an empty list, never nothing')
  const refused = await built.asas.kayan.notes.operations.find({}, { actor: decided }).catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'an empty list refuses the operation the ungraded table would have allowed')
  assert.equal(refused.status, 403, 'with 403')
  assert.match(refused.message, /needs permission "notes\.find"/, 'naming the key it wanted')

  const homeless = await rbacActor('member', undefined, built)
  assert.deepEqual([...keysOf(homeless)!], [], 'no tenant resolves no assignment, and still decides')
})

test('36. a malformed permissions column holds no key and takes the well-formed row beside it with it, so the operation only a role row could have granted is refused', async () => {
  const built = rbacBuilt()
  await built.asas.kayan.courses.operations.create(
    { id: 1, title: 'Mine', fee: 300, tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  for (const malformed of [null, 'courses.update', 42, {}, ['courses.update', 7]]) {
    seedRole(built, [
      { id: 1, name: 'editor', permissions: malformed, tenant: 'org1' },
      { id: 2, name: 'reader', permissions: ['courses.findByID'], tenant: 'org1' },
    ])
    const actor = await rbacActor('editor,reader', 'org1', built)
    assert.deepEqual(
      [...keysOf(actor)!],
      [],
      `a permissions column of ${JSON.stringify(malformed)} holds no key, and takes the well-formed row beside it with it`,
    )
    const refused = await built.asas.kayan.courses.operations
      .update({ id: 1, title: 'Changed' }, { actor })
      .catch((thrown: unknown) => thrown)
    assert.ok(refused instanceof AsasError, 'so the key only a role row could have granted is not held')
    assert.equal(refused.status, 403, 'and the operation is refused with 403')
    assert.match(refused.message, /needs permission "courses\.update"/, 'naming the key it wanted')
  }

  // A well-formed pair of rows grants both, so the refusals above are the malformed column's doing.
  seedRole(built, [
    { id: 1, name: 'editor', permissions: ['courses.update'], tenant: 'org1' },
    { id: 2, name: 'reader', permissions: ['courses.findByID'], tenant: 'org1' },
  ])
  const sound = await rbacActor('editor,reader', 'org1', built)
  assert.deepEqual(
    [...keysOf(sound)!].sort(),
    ['courses.findByID', 'courses.update'],
    'two well-formed rows union',
  )
})

test('37. Better Auth\'s member.role is governance and grants nothing: the assignment is this project\'s own row, and a name only that column carries selects no row and holds no key', async () => {
  const built = rbacBuilt()
  seedRole(built, [{ id: 1, name: 'editor', permissions: ['courses.update'], tenant: 'org1' }])
  await built.asas.kayan.courses.operations.create(
    { id: 1, title: 'Mine', fee: 300, tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  // The provider writes `owner` on whoever created the organization and the fixture's session always carries a
  // `member.role`. Neither is an assignment: with no `memberRoles` row this actor takes no row, the `'*'` row included, and is
  // denied before any key is asked for.
  const governed = await rbacActor(undefined, 'org1', built)
  assert.deepEqual([...keysOf(governed)!], [], 'a member.role alone holds no key of this project')
  const denied = await built.asas.kayan.courses.operations.find({}, { actor: governed }).catch((thrown: unknown) => thrown)
  assert.ok(denied instanceof AsasError, 'and it takes no row, so the read is refused')
  assert.equal(denied.status, 403, 'with 403')
  assert.equal(denied.key, 'error.forbidden.read', 'by the row answer rather than by a key')

  const assigned = await rbacActor('member', 'org1', built)
  assert.equal((await built.asas.kayan.courses.operations.find({}, { actor: assigned })).docs.length, 1, 'an assignment is what opens the tenancy row')
  assert.ok(keysOf(assigned)!.has('courses.find'), 'and the keys are the assigned role\'s')
})

test('38. a permissions column on the provider\'s own user row is not the access target, so it neither grants nor refuses', async () => {
  const strategy = (resolve?: Parameters<typeof betterAuthStrategy>[0]['assigned']) =>
    betterAuthStrategy({
      server: {
        api: {
          getSession: async () => ({ session: { activeOrganizationId: 'org1' }, user: { id: 'u1', permissions: ['courses.delete'], roles: ['admin'] } }),
        },
        handler: async () => new Response(null),
      } as never,
      collection: 'user',
      onError: console.error,
      assigned: resolve,
    })

  // Nothing validated that column against the catalog and nothing guarded it at a grant, so it is not the target's answer:
  // the key is absent and the layer stands aside.
  const aside = (await strategy().authenticate({ headers: new Headers() })).user
  assert.equal(actorPermissions(aside), undefined, 'the column does not turn an access target on')
  assert.equal(actorRoles(aside), undefined, 'and a roles column on the same row assigns nothing either')
  assert.equal(
    (aside as unknown as { permissions?: unknown }).permissions,
    undefined,
    'and the copy the spread made is gone from the actor as well',
  )

  const decided = (await strategy((() => ({ permissions: ['courses.find'], roles: ['member'] })) as never).authenticate({ headers: new Headers() })).user
  assert.deepEqual([...keysOf(decided)!], ['courses.find'], 'the target\'s keys, and only those')
  assert.deepEqual(actorRoles(decided), ['member'], 'and the target\'s slugs, and only those')
})

test('39. renaming a role row is measured against the granter, so a granter that holds none of the row\'s keys cannot re-target them at its own role name', async () => {
  const built = rbacBuilt()
  // A row that entered outside the guard, as a seed, a migration or an operation whose list lacks the step leaves behind. It
  // holds `courses.delete`, which `member` does not.
  seedRole(built, [{ id: 1, name: 'editor', permissions: ['courses.delete', 'courses.fields.title'], tenant: 'org1' }])
  await built.asas.kayan.courses.operations.create(
    { id: 1, title: 'Mine', fee: 300, tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  const granter = await rbacActor('member', 'org1', built)
  assert.ok(!keysOf(granter)!.has('courses.delete'), 'the granter holds none of the row\'s keys')

  // The write touches the name alone, never the `permissions` column; what changes is who the keys answer for.
  const renamed = await built.asas.kayan.roles.operations
    .update({ id: 1, name: 'member' }, { actor: granter })
    .catch((thrown: unknown) => thrown)
  assert.ok(renamed instanceof AsasError, 'a rename that re-targets keys the granter lacks is a refusal the caller caused')
  assert.equal(renamed.status, 403, 'and it is 403')
  assert.equal(renamed.key, 'error.forbidden.grant', 'under the grant key, because a rename is a grant')
  assert.match(renamed.message, /"courses\.delete"/, 'naming the key it would not hand over')

  const after = await rbacActor('member', 'org1', built)
  assert.ok(!keysOf(after)!.has('courses.delete'), 'so the granter still holds none of them')
  const refused = await built.asas.kayan.courses.operations.delete({ id: 1 }, { actor: after }).catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'and the operation those keys would have opened is still refused')
  assert.equal(refused.status, 403, 'with 403')

  const holder = await rbacActor('admin', 'org1', built)
  const moved = await built.asas.kayan.roles.operations.update({ id: 1, name: 'renamed' }, { actor: holder })
  assert.equal(moved.name, 'renamed', 'a granter holding the row\'s keys renames it')
  assert.deepEqual(moved.permissions, ['courses.delete', 'courses.fields.title'], 'and the keys it holds are untouched')
})

test('40. a role read that throws is an access target that decided none, never an actor with no target and never no actor at all', async () => {
  const built = rbacBuilt()
  await built.asas.kayan.notes.operations.create(
    { id: 1, body: 'Mine', tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  // The store the target reads is down. The strategy loop catches whatever a strategy throws and moves to the next one, so a
  // throw that escaped the target would make this caller anonymous: the 401 path, not the 403 this layer owes.
  // Both ways a read fails: a rejected promise, and a throw before one exists.
  const rejects = {
    find: async ({ kayan: name, args }: { kayan: string; args: never }) => {
      if (name === 'roles') throw new Error('connection terminated unexpectedly')
      return built.store.find({ kayan: name, args })
    },
  }
  const throws = {
    find: ({ kayan: name, args }: { kayan: string; args: never }) => {
      if (name === 'roles') throw new Error('connection terminated unexpectedly')
      return built.store.find({ kayan: name, args })
    },
  }
  for (const store of [rejects, throws]) {
    const actor = await rbacActor('ghost', 'org1', built, (({ tenant, member, actor }: { tenant: unknown; member: unknown; actor: object }) =>
      built.target.resolve({ store: store as never, tenant, member, actor, ownership: () => 'tenant' })) as never)
    assert.ok(actor, 'a store that threw is not a caller who is not signed in')
    assert.deepEqual([...keysOf(actor)!], [], 'it is a target that decided and found no key')

    const refused = await built.asas.kayan.notes.operations.find({}, { actor }).catch((thrown: unknown) => thrown)
    assert.ok(refused instanceof AsasError, 'so the operation is refused')
    assert.equal(refused.status, 403, 'with 403 and not 401')
    assert.match(refused.message, /needs permission "notes\.find"/, 'naming the key it wanted')
  }
})

test('41. every Where operator but exists is refused on a list field with 400, because none of them compares a member of the list', async () => {
  const built = rbacBuilt()
  seedRole(built, [{ id: 1, name: 'editor', permissions: ['courses.update'], tenant: 'org1' }])
  const actor = await rbacActor('member', 'org1', built)

  // `equals` and `in` read as a comparison against one key and are not one: drizzle maps the operand through the column's
  // array mapper, which calls `.map` on a string and throws a TypeError before any SQL is built, so without this guard a
  // caller's query is a 500 rather than a refusal.
  for (const operator of ['contains', 'equals', 'greater_than', 'in', 'like', 'not_equals', 'not_in']) {
    const operand = operator === 'in' || operator === 'not_in' ? ['courses.update'] : 'courses.update'
    const refused = await built.asas.kayan.roles.operations
      .find({ where: { permissions: { [operator]: operand } } }, { actor })
      .catch((thrown: unknown) => thrown)
    assert.ok(refused instanceof AsasError, `"${operator}" on a list field is a refusal the caller caused`)
    assert.equal(refused.status, 400, 'and it is 400, never a 500 out of the store')
    assert.equal(refused.key, 'error.invalid.where', 'under the key a malformed query already uses')
    assert.match(refused.message, /list field/, 'naming what it is about the field')
  }

  const present = await built.asas.kayan.roles.operations.find({ where: { permissions: { exists: true } } }, { actor })
  assert.equal(present.docs.length, 1, 'a list column that is there is found')

  const byName = await built.asas.kayan.roles.operations.find({ where: { name: { equals: 'editor' } } }, { actor })
  assert.equal(byName.docs.length, 1, 'a text column still compares')
})

test('42. the catalog and the statements are frozen, so nothing that is handed them can widen the vocabulary a granter is measured against', async () => {
  const built = rbacBuilt()
  // One array instance is `asas.catalog` and `tools.catalog` on every operation, so a push anywhere would widen what
  // `grantedPermissions` accepts project-wide.
  assert.ok(Object.isFrozen(built.asas.catalog), 'the flat keys are frozen')
  assert.ok(Object.isFrozen(built.asas.statements), 'and so is the shape store `betterAuth` is given')
  assert.ok(
    Object.values(built.asas.statements).every((actions) => Object.isFrozen(actions)),
    'down to each resource\'s own action list, which is what a push would reach',
  )
  assert.throws(
    () => (built.asas.catalog as string[]).push('courses.archive'),
    TypeError,
    'a push is refused rather than silently dropped, because this module is strict',
  )
  assert.ok(!built.asas.catalog.includes('courses.archive'), 'and the key is not in the vocabulary')

  const granter = await rbacActor('admin', 'org1', built)
  const refused = await built.asas.kayan.roles.operations
    .create({ id: 1, name: 'typo', permissions: ['courses.archive'], tenant: 'org1' }, { actor: granter })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'a key nothing widened the catalog with is still outside it')
  assert.equal(refused.status, 400, 'with 400')
})

test('43. a global\'s access is exactly what defineKayan produced: the same inherited row callbacks a kayan gets, the mark beside them, and a declared create still refused', () => {
  const store = memoryStore()
  // One language, one row table, so the kayan and the global inherit the same compiled `Rows` instance and every callback on
  // the two access objects is the same function object unless something rebuilt one of them.
  const mithaq = tenantLanguage(store, { member: { read: true, update: true } })
  const courses = mithaq.defineKayan({ name: 'courses', fields: { id: courseFields.id, title: courseFields.title, organization: mithaq.targets.tenant.field }, targets: { service: { operations: defaultOperations } } })
  const settings = mithaq.defineGlobal({ name: 'settings', fields: tenantSettingsFields(mithaq), targets: { service: { operations: defaultGlobalOperations } } })
  const kayanAccess = courses.access as unknown as Record<string | symbol, unknown>
  const globalAccess = settings.access as unknown as Record<string | symbol, unknown>

  for (const operation of ['create', 'delete', 'read', 'update']) {
    assert.equal(
      globalAccess[operation],
      kayanAccess[operation],
      `a global inherits the row callback for "${operation}" the same way a kayan does, never a rebuilt one`,
    )
  }
  assert.deepEqual(
    Reflect.ownKeys(globalAccess),
    Reflect.ownKeys(kayanAccess),
    'and carries exactly the keys defineKayan wrote, the rows mark among them',
  )
  const [mark] = Object.getOwnPropertySymbols(globalAccess)
  assert.ok(mark, 'the mark that says this access came from rows is a symbol key')
  assert.equal(globalAccess[mark], kayanAccess[mark], 'and it is the one compiled table, shared')

  // The refusal reads the declaration rather than the compiled object, so this global builds.
  assert.ok(mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, organizationOf(mithaq), ...accessKayan], global: [settings] }), 'a global inheriting four callbacks builds')

  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp()],
        kayan: [organizationOf(mithaq)],
        global: [
          mithaq.defineGlobal({
            name: 'refused',
            fields: tenantSettingsFields(mithaq),
            access: { create: () => true } as never,
            targets: { service: { operations: defaultGlobalOperations } },
          }),
        ],
      }),
    /Global "refused" declares access "create", and a global has read and update only, which is Payload's GlobalAccess/,
  )
})

/**
 * The same roles, table and assignment rows as above, with the custom roles read out of the provider's own
 * `organizationRole` rows instead of the `roles` kayan. The rows are read straight from the store, never through the
 * provider's `hasPermission`, whose module-level `cacheAllRoles` is read back by any caller passing `useMemoryCache` with no
 * invalidation and no expiry, so a role narrowed or deleted since the snapshot would still read as wide.
 */
const organizationRoleRows = (built: ReturnType<typeof rbacBuilt>, rows: Record<string, unknown>[]) => {
  built.store.rows.set('organizationRole', rows)
}

/** One `organizationRole` row as the provider writes it: the permission is a string. */
const organizationRole = (id: number, role: string, organizationId: string, permission: Record<string, string[]>) => ({
  id,
  organizationId,
  role,
  permission: JSON.stringify(permission),
})

const betterAuthResolve = (
  built: ReturnType<typeof rbacBuilt>,
  statements?: Record<string, { statements: Record<string, readonly string[]> }>,
) => {
  const target = betterAuthTarget({
    roles: rbacRoles,
    access: rbacTable,
    rolesOf: (actor: RbacActor) => actorRoles(actor) ?? [],
    kayan: { roles: 'organizationRole', memberRoles: 'memberRoles' },
    ...(statements ? { statements } : {}),
  })
  return ({ tenant, member, actor }: { tenant: unknown; member: unknown; actor: object }) => target.resolve({ store: built.store as never, tenant, member, actor, ownership: () => 'tenant' })
}

test('44. betterAuthTarget grants what the provider\'s own roles and its organizationRole rows hold, inside the tenant and nowhere else', async () => {
  const built = rbacBuilt()
  const ac = createAccessControl(built.asas.statements)
  const statements = { editor: ac.newRole({ courses: ['update', 'fields.id', 'fields.tenant', 'fields.title'] }) }
  organizationRoleRows(built, [
    organizationRole(1, 'reader', 'org1', { courses: ['findByID'] }),
    organizationRole(2, 'reader', 'org2', { courses: ['delete'] }),
  ])
  await built.asas.kayan.courses.operations.create(
    { id: 1, title: 'Mine', fee: 300, tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )

  // A compile-time role of the provider's, which is code beside this project's own system roles, and a row of its own,
  // which is the tenant's.
  const both = await rbacActor('editor,reader', 'org1', built, betterAuthResolve(built, statements) as never)
  assert.ok(keysOf(both)!.has('courses.update'), 'the provider\'s own compile-time role answers its keys')
  assert.ok(keysOf(both)!.has('courses.findByID'), 'and its runtime row answers beside it, exactly as two rows of the roles kayan do')
  assert.ok(!keysOf(both)!.has('courses.delete'), 'and nothing either of them never named')
  const changed = await built.asas.kayan.courses.operations.update({ id: 1, title: 'Changed' }, { actor: both })
  assert.equal(changed.title, 'Changed', 'and the operation those keys open passes')

  const outsider = await rbacActor('reader', 'org1', built, betterAuthResolve(built) as never)
  assert.deepEqual([...keysOf(outsider)!], ['courses.findByID'], 'a row another tenant owns is not read here')
  const refused = await built.asas.kayan.courses.operations.delete({ id: 1 }, { actor: outsider }).catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'so the key that row holds elsewhere grants nothing here')
  assert.equal(refused.status, 403, 'and the operation is refused with 403')
})

test('45. swapping rbacTarget for betterAuthTarget answers the same questions with the provider\'s rows as the store, and the assignment stays this project\'s own', async () => {
  const built = rbacBuilt()
  await built.asas.kayan.courses.operations.create(
    { id: 1, title: 'Mine', fee: 300, tenant: 'org1' },
    { actor: await rbacActor('admin', 'org1', built) },
  )
  // One custom role named the same in both stores, holding the same key.
  seedRole(built, [{ id: 1, name: 'editor', permissions: ['courses.update'], tenant: 'org1' }])
  organizationRoleRows(built, [organizationRole(1, 'editor', 'org1', { courses: ['update'] })])

  for (const [name, resolve] of [
    ['rbacTarget', undefined],
    ['betterAuthTarget', betterAuthResolve(built)],
  ] as const) {
    const actor = await rbacActor('member,editor', 'org1', built, resolve as never)
    assert.ok(keysOf(actor)!.has('courses.find'), `${name} answers the system role's keys from code`)
    assert.ok(keysOf(actor)!.has('courses.update'), `${name} answers the custom role's key from its own store`)
    assert.deepEqual([...actorRoles(actor)!].sort(), ['editor', 'member'], `${name} reads the assignment from memberRoles`)
    const changed = await built.asas.kayan.courses.operations.update({ id: 1, title: name }, { actor })
    assert.equal(changed.title, name, `and the operation runs under ${name}`)
    const refused = await built.asas.kayan.courses.operations.delete({ id: 1 }, { actor }).catch((thrown: unknown) => thrown)
    assert.ok(refused instanceof AsasError, `an operation neither role holds is refused under ${name}`)
    assert.equal(refused.status, 403, 'with the same 403')
  }
})

test('46. a field key narrows the readable fields through betterAuthTarget exactly as it does through rbacTarget', async () => {
  const built = rbacBuilt()
  const ac = createAccessControl(built.asas.statements)
  built.store.rows.set('notes', [{ id: 1, body: 'Private', tenant: 'org1' }])
  // Every key the read needs except the one that would admit the body.
  const held = ['find', 'findByID', 'fields.id', 'fields.tenant']
  seedRole(built, [{ id: 1, name: 'reader', permissions: held.map((one) => `notes.${one}`), tenant: 'org1' }])
  organizationRoleRows(built, [organizationRole(1, 'reader', 'org1', { notes: held })])
  const byProvider = await rbacActor(
    'reader',
    'org1',
    built,
    betterAuthResolve(built, { reader: ac.newRole({ notes: held }) }) as never,
  )
  const byRow = await rbacActor('reader', 'org1', built)

  for (const [target, actor] of [['betterAuthTarget', byProvider], ['rbacTarget', byRow]] as const) {
    const page = await built.asas.kayan.notes.operations.find({}, { actor })
    assert.deepEqual(
      Object.keys(page.docs[0]!).sort(),
      ['id', 'tenant'],
      `${target} hides the field its keys never name`,
    )
    const refused = await built.asas.kayan.notes.operations
      .find({ where: { body: { equals: 'Private' } } }, { actor })
      .catch((thrown: unknown) => thrown)
    assert.ok(refused instanceof AsasError, `and ${target} hides it in where as well as in the projection`)
    assert.equal(refused.status, 403, 'with the 403 a hidden field already carried')
  }
})

test('47. an access target that throws holds none rather than making the caller anonymous, whichever target it was', async () => {
  const built = rbacBuilt()
  const thrower = { find: async () => { throw new Error('the store is down') } }
  const broken = betterAuthTarget({
    roles: rbacRoles,
    access: rbacTable,
    rolesOf: (actor: RbacActor) => actorRoles(actor) ?? [],
    kayan: { roles: 'organizationRole', memberRoles: 'memberRoles' },
  })
  for (const [target, resolve] of [
    ['betterAuthTarget', ({ tenant, member, actor }: { tenant: unknown; member: unknown; actor: object }) => broken.resolve({ store: thrower as never, tenant, member, actor, ownership: () => 'tenant' })],
    ['rbacTarget', ({ tenant, member, actor }: { tenant: unknown; member: unknown; actor: object }) => built.target.resolve({ store: thrower as never, tenant, member, actor, ownership: () => 'tenant' })],
    ['a project\'s own', () => { throw new Error('the target is broken') }],
  ] as const) {
    const actor = await rbacActor('member,editor', 'org1', built, resolve as never)
    assert.ok(actor, `${target} failing leaves the caller signed in, never anonymous`)
    assert.deepEqual([...keysOf(actor)!], [], `and ${target} answers none rather than nothing`)
    const refused = await built.asas.kayan.courses.operations
      .update({ id: 1, title: 'Changed' }, { actor })
      .catch((thrown: unknown) => thrown)
    assert.ok(refused instanceof AsasError, 'so a graded operation is the 403 the layer owes')
    assert.equal(refused.status, 403, 'and never the 401 an anonymous caller would have got')
  }
})

test('48. a malformed organizationRole permission takes the whole answer with it, so a row nothing vouched for grants nothing', async () => {
  const built = rbacBuilt()
  const ac = createAccessControl(built.asas.statements)
  const statements = { editor: ac.newRole({ courses: ['update'] }) }
  // The provider stores the permission as `JSON.stringify(...)` rather than as the record its own zod object describes, so
  // every shape a column can hold that is not that string is a store answering something unreadable.
  for (const malformed of ['not json', '["courses.update"]', '{"courses":"update"}', '{"courses":[1]}', null, 42]) {
    organizationRoleRows(built, [
      organizationRole(1, 'reader', 'org1', { courses: ['update'] }),
      { id: 2, organizationId: 'org1', role: 'reader', permission: malformed },
    ])
    const actor = await rbacActor('reader', 'org1', built, betterAuthResolve(built, statements) as never)
    assert.deepEqual(
      [...keysOf(actor)!],
      [],
      `a permission column of ${String(malformed)} holds no key, and takes the row beside it with it`,
    )
  }
})

test('49. a build has exactly one access target, two are refused by name, and a build with none keeps the floor: the access callbacks alone, graded by nothing', async () => {
  const store = memoryStore()
  const first = rbacTarget({ roles: rbacRoles, access: rbacTable, kayan: { roles: 'roles', memberRoles: 'memberRoles' } })
  const second = rbacTarget({ roles: rbacRoles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } })
  const two = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, rbac: first, provider: second, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const courses = two.defineKayan({ name: 'courses', fields: courseFields, targets: { service: { operations: defaultOperations } } })
  assert.throws(
    () => two.buildAsas({ http: [fetchHttp()], kayan: [courses] }),
    (thrown: unknown) =>
      thrown instanceof Error &&
      /Targets "rbac" and "provider" both declare capability "access"/.test(thrown.message) &&
      /exactly one access target/.test(thrown.message),
    'two targets answering one question are refused by name, because nothing could pick between them',
  )

  const floorStore = memoryStore()
  const floor = defineMithaq({
    arkan: [base],
    targets: { memory: floorStore, zod: zodTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const plain = floor.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: { create: () => true, read: () => true, update: () => false, delete: () => false },
    targets: { service: { operations: defaultOperations } },
  })
  const asas = floor.buildAsas({ http: [fetchHttp()], kayan: [plain] })
  const anyone = { id: 'u1', activeOrganizationId: 'org1' }
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: anyone })
  assert.equal((await asas.kayan.courses.operations.find({}, { actor: anyone })).docs.length, 1, 'a callback that allows admits, with no key asked for')
  const refused = await asas.kayan.courses.operations.update({ id: 1, title: 'No' }, { actor: anyone }).catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'and a callback that denies refuses')
  assert.equal(refused.key, 'error.forbidden.operation', 'by the callback and never by a permission key')
})

/**
 * A build that names statements of its own: `invitation` is a resource of the provider's alone, and `courses` is one this
 * project also declares, so it is the union branch with a non-empty left side.
 */
const withStatements = () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, rbac: rbacTarget({ roles: fourRoles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const courses = mithaq.defineKayan({ name: 'courses', fields: courseFields, targets: { service: { operations: defaultOperations } } })
  return {
    asas: mithaq.buildAsas({
      http: [fetchHttp()],
      kayan: [courses, ...accessKayan],
      statements: { invitation: ['cancel'], courses: ['archive'] },
    }),
    store,
  }
}

test('50. a provider\'s own actions join the catalog under the resources they name, beside the actions this project derives', () => {
  const { asas } = withStatements()

  assert.ok(asas.catalog.includes('invitation.cancel'), 'an action no kayan declares is a key of this project')
  assert.ok(!asas.catalog.includes('courses.cancel'), 'and it is a key of the resource it was named under and no other')
  assert.deepEqual([...asas.statements.invitation!], ['cancel'], 'a resource no kayan declares is one of its own')
  // A resource that is both keeps its derived actions and gains the provider's beside them, because `organization.update` is
  // one kayan's operation and one provider action under one key. `courses` is that resource here: the fixture declares
  // `archive` on it and the kayan derives `find` and the rest.
  assert.ok(asas.statements.courses!.includes('find'), 'a kayan keeps every action it derives')
  assert.ok(asas.statements.courses!.includes('archive'), 'and gains the provider\'s action under the same resource')
  assert.ok(asas.catalog.includes('courses.archive'), 'so the flat catalog names the joined key too')
  assert.equal(new Set(asas.catalog).size, asas.catalog.length, 'the catalog still names each key once')
})

test('51. the default sort runs the chosen field\'s own read access and takes the next candidate when it denies, and with every candidate denied it keeps the page only where the caller may read no field at all', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  // mithaq's own default fields, spread into both kayan below, because `createdAt` is the one the default sort reaches for.
  const title = {
    ...defaultFields,
    title: { kind: 'text', label: { en: 'Title', ar: 'العنوان' } },
    tenant: { kind: 'text', label: { en: 'Tenant', ar: 'المستأجر' } },
  } as const
  // One kayan hides `createdAt` and one hides every field; a list of nothing but
  // exclusions reads as every other field, so the second admits none.
  const hidden = mithaq.defineKayan({
    name: 'hidden',
    fields: title,
    access: mithaq.rows({ member: { create: true, read: true, update: true, delete: true, fields: ['*', '!createdAt'] } }),
    targets: { service: { operations: defaultOperations } },
  })
  const opaque = mithaq.defineKayan({
    name: 'opaque',
    fields: title,
    access: mithaq.rows({
      member: { create: true, read: true, update: true, delete: true, fields: ['!id', '!title', '!tenant', '!updatedAt', '!createdAt'] },
    }),
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [hidden, opaque, ...accessKayan] })
  // The id order and the `createdAt` order disagree, so the page says which of
  // the two it was ordered by.
  const uuid = (last: number) => `00000000-0000-4000-8000-00000000000${last}`
  const seeded = [
    { id: uuid(1), title: 'newest row, first id', createdAt: new Date(3), updatedAt: new Date(3), tenant: 'org1' },
    { id: uuid(2), title: 'middle', createdAt: new Date(2), updatedAt: new Date(2), tenant: 'org1' },
    { id: uuid(3), title: 'oldest row, last id', createdAt: new Date(1), updatedAt: new Date(1), tenant: 'org1' },
  ]
  store.rows.set('hidden', seeded.map((row) => ({ ...row })))
  store.rows.set('opaque', seeded.map((row) => ({ ...row })))

  const page = await asas.kayan.hidden.operations.find({}, { actor: member })
  assert.deepEqual(
    page.docs.map((row) => row.id),
    [uuid(3), uuid(2), uuid(1)],
    'a field the actor may not read cannot order the default page either, so the scan falls to the next candidate, which is the id',
  )
  assert.equal(Object.hasOwn(page.docs[0]!, 'createdAt'), false, 'and the field is still absent from the row')
  const named = await asas.kayan.hidden.operations.find({ sort: '-createdAt' }, { actor: member }).catch((thrown: unknown) => thrown)
  assert.ok(named instanceof AsasError, 'naming the same field is refused, which is what made the silent default a disclosure')
  assert.equal(named.status, 403, 'as the 403 it always was')

  // Every candidate denied and no field readable at all: the rows are empty objects, so no order of them tells the caller
  // anything, and the page comes back rather than a 403 nobody asked for.
  const opaquePage = await asas.kayan.opaque.operations.find({}, { actor: member })
  assert.equal(opaquePage.totalDocs, 3, 'a page whose every column is hidden is still a page')
  assert.deepEqual(opaquePage.docs.map((row) => Object.keys(row)), [[], [], []], 'and every row of it is empty, so no order of them is a disclosure')

  // Every candidate denied and one field readable: the order would run against values the caller can see, so the last
  // candidate's own denial stands. The readable field has to be a localized one, because every field that is not localized is
  // a candidate, so this language declares locales.
  const localizedMithaq = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: { memory: store, zod: zodTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const partial = localizedMithaq.buildAsas({
    http: [fetchHttp()],
    kayan: [
      localizedMithaq.defineKayan({
        name: 'partial',
        access: { create: () => true, read: () => true, update: () => true, delete: () => true },
        fields: {
          id: { kind: 'number', access: { read: () => false } },
          title: { kind: 'text', rules: { localized: true } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await partial.kayan.partial.operations.create({ id: 1, title: { ar: 'عنوان', en: 'Title' } } as never)
  const seen = await partial.kayan.partial.operations.find().catch((thrown: unknown) => thrown)
  assert.ok(seen instanceof AsasError, 'a readable field with no readable field the store can sort by is refused')
  assert.equal(seen.status, 403, 'as the last candidate\'s own denial')
  assert.equal(seen.key, 'error.forbidden.field_read', 'under the same key naming the field would have given')
  assert.deepEqual(seen.params, { kayan: 'partial', field: 'id' }, 'naming the candidate that denied')

  // `findByID` picks the row by an id equality at limit 1, so no order can change which row it is: the default sort's denial
  // has nothing to protect, and the row comes back with the denied field masked rather than a 403.
  const one = await partial.kayan.partial.operations.findByID({ id: 1 } as never)
  assert.deepEqual(one, { title: { ar: 'عنوان', en: 'Title' } }, 'the addressed row comes back with the field it may not read masked away')
})

test('52. a field read callback that reads the row denies the actor-only sort probe and allows the row mask, so the fallen-through default page is ordered by the id rather than by createdAt', async () => {
  const store = memoryStore()
  // The sort probe hands the callback the actor alone, so `doc` is absent and it denies; the row mask hands it the row, so it
  // allows. That empties the candidate list and reaches the branch under test with rows that are not empty.
  const perRow = { read: ({ doc }: FieldAccessArgs) => doc !== undefined }
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp()],
    kayan: [
      mithaq.defineKayan({
        name: 'perRow',
        access: { create: () => true, read: () => true, update: () => true, delete: () => true },
        fields: {
          id: { ...defaultFields.id, access: perRow },
          updatedAt: { ...defaultFields.updatedAt, access: perRow },
          createdAt: { ...defaultFields.createdAt, access: perRow },
          title: { kind: 'text', access: perRow },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  // The id order and the `createdAt` order disagree, so the page says which of
  // the two it was ordered by.
  const uuid = (last: number) => `00000000-0000-4000-8000-00000000000${last}`
  store.rows.set('perRow', [
    { id: uuid(1), title: 'newest row, first id', createdAt: new Date(3), updatedAt: new Date(3) },
    { id: uuid(2), title: 'middle', createdAt: new Date(2), updatedAt: new Date(2) },
    { id: uuid(3), title: 'oldest row, last id', createdAt: new Date(1), updatedAt: new Date(1) },
  ])

  const page = await built.kayan.perRow.operations.find()
  assert.deepEqual(
    Object.keys(page.docs[0]!).sort(),
    ['createdAt', 'id', 'title', 'updatedAt'],
    'the mask keeps every field, because it hands the callback the row the probe had no way to hand it',
  )
  assert.deepEqual(
    page.docs.map((row) => row.id),
    [uuid(3), uuid(2), uuid(1)],
    'so the order every candidate denying falls through to is the id, which both stores already append to every other sort, and never createdAt',
  )
})

test('53. a service target whose store names no target is refused by name on the target, even where every kayan names its own store', () => {
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget,
      rbac: rbacTarget({ roles: fourRoles, access: { member: { create: true, read: true, update: true, delete: true } }, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }),
      service: serviceTarget({
        depth: defaultDepth,
        defaultLimit,
        maxLimit: defaultMaxLimit,
        joinLimit: defaultJoinLimit,
        bulkLimit: defaultBulkLimit,
        // The one way past the type, which refuses this name where the service target is written; `defineMithaq` checks no name at
        // runtime, which is why the refusal below has to exist.
        store: 'nope' as never,
        schema: 'zod',
        authorize: defaultAuthorize,
      }),
    },
  })
  // Every kayan names the real store, so no kayan looks the default up. The target is checked itself, with the sentence a
  // kayan naming a wrong store gets.
  const users = mithaq.defineKayan({
    name: 'users',
    targets: {
      service: {
        store: 'memory',
        operations: defaultOperations,
      },
    },
    fields: { id: { kind: 'text', label: { en: 'ID', ar: 'المعرف' } } },
  })
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp()],
        // Never invoked: the refusal throws before the factory is reached.
        kayan: [{ ...users, auth: { provider: 'better-auth' as const, server: (() => ({})) as never } }],
      }),
    /The service target names store "nope", which is not a store: a store target declares capability "store"/,
    'the refusal names the target and the name it holds, rather than reading capability off undefined',
  )
})

// On the in-memory store, because what is under test is the path and the access callback rather than any SQL.
test('54. a filter names a locale as a second path segment, and a locale of a field whose read access denies is refused exactly as the field\'s own name is', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: { memory: store, zod: zodTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp()],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: { create: () => true, read: () => true, update: () => true, delete: () => true },
        fields: {
          id: { kind: 'number' },
          title: { kind: 'text', rules: { localized: true } },
          secret: { kind: 'text', rules: { localized: true }, access: { read: () => false } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, title: { ar: 'عنوان', en: 'Title' }, secret: { ar: 'سر', en: 'Secret' } } as never)
  await built.kayan.notes.operations.create({ id: 2, title: { ar: 'ثان', en: 'Second' }, secret: { ar: 'سر', en: 'Secret' } } as never)

  const page = await built.kayan.notes.operations.find({ where: { 'title.en': { equals: 'Second' } } } as never)
  assert.equal(page.totalDocs, 1, 'the locale segment reads that locale and no other')
  assert.equal(page.docs[0]!.id, 2, 'so the row it matched is the one holding that locale\'s value')
  const other = await built.kayan.notes.operations.find({ where: { 'title.ar': { equals: 'Second' } } } as never)
  assert.equal(other.totalDocs, 0, 'and the same value under the other locale of the same field matches nothing')

  // The half-translated row the copy scan looks for, written to the store
  // directly because a create carries every locale or none.
  await store.insert({ tx: null, kayan: 'notes', data: { id: 3, title: { ar: 'ثالث', en: null }, secret: null } })
  const gap = await store.find({ kayan: 'notes', args: {
    limit: 0,
    page: 1,
    sort: { field: 'id', direction: 'asc' },
    where: { and: [{ 'title.ar': { exists: true } }, { 'title.en': { exists: false } }] },
  } })
  assert.deepEqual(gap.docs.map((row) => row.id), [3], 'and this store answers the same locale path the drizzle one does, so a test of it is not a test of another behaviour')

  const denied = await built.kayan.notes.operations
    .find({ where: { 'secret.en': { equals: 'Secret' } } } as never)
    .catch((thrown: unknown) => thrown)
  assert.ok(denied instanceof AsasError, 'a locale of a field the actor may not read is refused')
  assert.equal(denied.status, 403, 'as the 403 the field\'s own name already gave')
  assert.equal(denied.key, 'error.forbidden.field_read', 'under the same key, because read access is per field and never per locale')
  assert.deepEqual(denied.params, { kayan: 'notes', field: 'secret' }, 'naming the field rather than the locale, which is what the callback was asked about')
})

test('55. a dotted key whose near field carries no relationTo is refused by name at the memory store, exactly as it is at the drizzle one', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp()],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: { create: () => true, read: () => true, update: () => true, delete: () => true },
        fields: {
          id: { kind: 'number' },
          title: { kind: 'text' },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, title: 'First' })

  // A second segment on a field that is neither localized nor a relationship. A managed read never reaches the store with it,
  // so this is the direct store call; it must name the kayan, the field and the path rather than throw a `TypeError` naming
  // nothing.
  const noHop = await store
    .find({ kayan: 'notes', args: {
      limit: 0,
      page: 1,
      sort: { field: 'id', direction: 'asc' },
      where: { 'title.ar': { equals: 'x' } } as never,
    } })
    .catch((thrown: unknown) => thrown)
  assert.ok(noHop instanceof Error, 'a dotted key whose near field carries no relationTo is refused at the memory store')
  assert.equal(
    noHop.message,
    'Kayan "notes" field "title" names no relationship, so the path "title.ar" reaches no second table.',
    'against the literal sentence rather than a second call to noRelationship, so the two-sided pin is not a comparison to itself',
  )

  const missing = await store
    .find({ kayan: 'notes', args: {
      limit: 0,
      page: 1,
      sort: { field: 'id', direction: 'asc' },
      where: { 'nothing.ar': { equals: 'x' } } as never,
    } })
    .catch((thrown: unknown) => thrown)
  assert.ok(missing instanceof Error, 'and a first segment the kayan never declared is refused by the same sentence')
  assert.equal(
    missing.message,
    'Kayan "notes" field "nothing" names no relationship, so the path "nothing.ar" reaches no second table.',
    'naming the segment that named nothing, rather than reading `target` off undefined',
  )
})

test('56. a field\'s keys other than its name contribute nothing to the catalog, so a rbac target carrying onDenied beside the access phases is not a permission', () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    // The rbac target is named because the field below writes `targets.rbac`, and a `targets.<name>` naming no target of the
    // build is refused by name. It reads the one kayan this build declares, because a target reading a kayan the build does not
    // have is refused too, and nothing here connects, so it never seeds a row.
    targets: {
      memory: store,
      zod: zodTarget,
      rbac: rbacTarget({ roles: {}, access: {}, kayan: { memberRoles: 'notes', roles: 'notes' } }),
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
    },
  })
  // Every key a field may carry beside its name, declared at once, with the three access phases and, under `targets.rbac`,
  // the `onDenied`.
  const built = mithaq.buildAsas({
    http: [fetchHttp()],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: { create: () => true, read: () => true, update: () => true, delete: () => true },
        fields: {
          id: { kind: 'number' },
          title: {
            kind: 'text',
            label: { en: 'Title', ar: 'العنوان' },
            dbName: 'note_title',
            rules: { required: true },
            targets: { rbac: { onDenied: 'refuse', create: 'notes.create', read: 'notes.find', update: 'notes.update' } },
            access: { create: () => true, read: () => true, update: () => true },
          },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  // Asserted as a list rather than key by key: anything a field's declaration leaked in would be an extra member here,
  // whatever it was named.
  assert.deepEqual(
    [...built.statements.notes!].sort(),
    ['count', 'create', 'delete', 'deleteMany', 'fields.id', 'fields.title', 'find', 'findByID', 'update', 'updateMany'],
    'one action per operation and one per field name, and nothing else',
  )
  assert.ok(
    !built.catalog.some((key) => key.includes('refuse') || key.includes('onDenied')),
    'no value and no key of the rbac target is a permission',
  )
  assert.deepEqual(
    built.catalog.filter((key) => key.startsWith('notes.fields.')).sort(),
    ['notes.fields.id', 'notes.fields.title'],
    'a field is one key whatever its access declares',
  )
})

test('57. a bulk operation is graded by its own catalog key, and holding that key alone does not let it run the write it is made of', async () => {
  const asas = graded()
  await asas.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })

  const refused = await asas.kayan.courses.operations
    .updateMany({ where: { title: { equals: 'Mine' } }, data: { fee: 1 } }, { actor: member })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'a role without the bulk key is refused')
  assert.equal(refused.status, 403, 'as a 403')
  assert.equal(refused.key, 'error.forbidden.permission', 'by the permission gate')
  assert.deepEqual((refused.params as { operation?: string }).operation, 'updateMany', 'named by the bulk operation')

  // A role holding the bulk key and not the write it is made of is refused too, because every matched row asks for the
  // write's own key. `viewer` is a declared role of this language, borrowed for that one holding.
  const halfGranted = { id: 'u5', roles: ['viewer'], activeOrganizationId: 'org1' }
  const store = memoryStore()
  const mithaq = language(store, gradedGlobalTable)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    access: mithaq.rows({
      viewer: {
        read: tenantRow,
        update: tenantRow,
        permissions: ['courses.updateMany', 'courses.find', 'courses.fields.id', 'courses.fields.tenant', 'courses.fields.title', 'courses.fields.fee'],
      },
      admin: { create: true, read: true, update: true, delete: true, permissions: '*' },
    } as const satisfies RowTable),
    targets: { service: { operations: defaultOperations } },
  })
  const half = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })
  await half.kayan.courses.operations.create({ id: 1, title: 'Mine', fee: 300 }, { actor: admin })
  const partial = await half.kayan.courses.operations
    .updateMany({ where: { title: { equals: 'Mine' } }, data: { fee: 1 } }, { actor: halfGranted })
    .catch((thrown: unknown) => thrown)
  assert.ok(partial instanceof AsasError, 'the bulk key alone is refused')
  assert.equal(partial.status, 403, 'as a 403')
  assert.equal(partial.key, 'error.forbidden.permission', 'by the same gate')
  assert.deepEqual((partial.params as { operation?: string }).operation, 'update', 'named by the write the bulk is made of')
  assert.equal(
    ((await half.kayan.courses.operations.findByID({ id: 1 }, { actor: admin })) as { fee: number }).fee,
    300,
    'and the row it would have written is unchanged',
  )
})

test('58. the access report answers per operation name beside the four effects, so a role holding one operation of an effect does not read the rest as allowed', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const courses = mithaq.defineKayan({
    name: 'courses',
    fields: courseFields,
    targets: {
      service: {
        // One operation of this kayan's own, so `update` is an effect two named operations share and a role can hold one of the
        // two.
        operations: {
          ...defaultOperations,
          archive: { steps: ({ steps }) => [steps.update] },
        },
      },
    },
    access: mithaq.rows({
      member: {
        read: tenantRow,
        update: tenantRow,
        permissions: [
          'courses.find',
          'courses.findByID',
          'courses.update',
          'courses.fields.fee',
          'courses.fields.id',
          'courses.fields.tenant',
          'courses.fields.title',
        ],
      },
    } as const satisfies RowTable),
  })
  // The report answers for whatever actor the strategy loop resolved, so the actor is handed over by a one-line strategy
  // instead of as an option.
  const asas = mithaq.buildAsas({
    http: [fetchHttp()],
    kayan: [{ ...courses, auth: { name: 'fixture', authenticate: () => ({ user: member }) } }, ...accessKayan],
    auth: { onError: console.error },
  })
  const answer = (await (await asas.handler(new Request('http://test/api/access'))).json()) as {
    collections: Record<string, { operations: Record<string, boolean>; update: boolean }>
  }
  const report = answer.collections.courses!

  assert.equal(report.update, true, 'the effect is allowed, because one of its operations is')
  assert.equal(report.operations.update, true, 'and the operation the role holds answers for itself')
  assert.equal(
    report.operations.archive,
    false,
    'while the operation of the same effect it holds no key for is refused, which the effect answer alone could not say',
  )
  assert.equal(report.operations.updateMany, false, 'the bulk pair is its own key, and this role holds neither half')
  assert.equal(report.operations.find, true, 'a read operation the role does hold')
  assert.deepEqual(
    Object.keys(report.operations).sort(),
    ['archive', 'count', 'create', 'delete', 'deleteMany', 'find', 'findByID', 'update', 'updateMany'],
    'one entry per operation of this kayan: the default six, the bulk pair, and the one it declares',
  )

  // It reports and never grants, per name as well as per effect: the operation it named refused is the 403 the runner
  // answers, and the one it named allowed reaches the row it was given rather than the gate.
  const refused = await asas.kayan.courses.operations
    .archive({ id: 1, title: 'Archived' }, { actor: member })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'the operation reported refused is refused')
  assert.equal(refused.status, 403, 'as a 403')
  assert.equal(refused.key, 'error.forbidden.permission', 'by the permission gate')
  assert.equal((refused.params as { operation?: string }).operation, 'archive', 'named by the operation the report answered for')

  const allowed = await asas.kayan.courses.operations
    .update({ id: 1, title: 'Changed' }, { actor: member })
    .catch((thrown: unknown) => thrown)
  assert.ok(allowed instanceof AsasError, 'and the operation reported allowed still answers for the row it was given')
  assert.equal(allowed.status, 404, 'which is the missing row and never the 403 the gate raises')
})

/**
 * `assignableRole` takes the role kayan's name, defaulting to `'roles'`, so a build whose role kayan carries another name
 * leaves that default naming a kayan the registry does not have. The read then answers nothing, and a guard that could not
 * read the role treats it as the largest thing it could be handing over, as it does when `heldPermissions` answers
 * `undefined` or a role row's `permissions` column is unreadable.
 */
test('59. a role the assignment guard cannot read is the largest role it could be, so a build whose role kayan is not the name the guard was handed refuses the assignment rather than passing it', async () => {
  const store = memoryStore()
  const clerkKeys = [
    'memberRoles.create',
    'memberRoles.fields.id',
    'memberRoles.fields.role',
    'memberRoles.fields.tenant',
    'memberRoles.fields.user',
  ]
  const roles = { clerk: { label: { ar: 'كاتب', en: 'Clerk' }, permissions: clerkKeys } } as const satisfies SystemRoles
  const target = rbacTarget({
    roles,
    access: rbacTable,
    rolesOf: (actor: RbacActor) => actorRoles(actor) ?? [],
    // The role kayan of this build is `roleCatalog` while the guard below is handed `'roles'`. The build stands, because
    // `buildAsas` checks the names the target reads and never the name a step was handed.
    kayan: { roles: 'roleCatalog', memberRoles: 'memberRoles' },
  })
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, rbac: target, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const roleCatalog = mithaq.defineKayan({
    name: 'roleCatalog',
    access: mithaq.rows(rbacTable),
    fields: {
      id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
      name: { kind: 'text', label: { en: 'Name', ar: 'الاسم' }, rules: { required: true } },
      permissions: { kind: 'textArray', label: { en: 'Permissions', ar: 'الصلاحيات' }, rules: { required: true } },
      ...tenantField,
    },
    targets: { service: { operations: defaultOperations } },
  })
  const memberRoles = mithaq.defineKayan({
    name: 'memberRoles',
    access: mithaq.rows(rbacTable),
    fields: {
      id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
      user: { kind: 'text', label: { en: 'Member', ar: 'العضو' }, rules: { required: true } },
      role: { kind: 'text', label: { en: 'Role', ar: 'الدور' }, rules: { required: true } },
      ...tenantField,
    },
    targets: {
      service: {
        operations: { ...defaultOperations, create: { steps: ({ steps }) => [assignableRole(roles, 'roles'), steps.insert] } },
      },
    },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp()], kayan: [roleCatalog, memberRoles] })
  // A custom role of this tenant, in the kayan the target reads. The guard
  // never sees it, because it looks in a kayan of another name.
  store.rows.set('roleCatalog', [{ id: 1, name: 'super', permissions: ['memberRoles.delete'], tenant: 'org1' }])

  const clerk = await rbacActor('clerk', 'org1', { store, target })
  assert.ok(keysOf(clerk)!.has('memberRoles.create'), 'the clerk holds the assignment key, so the operation is open to it')
  assert.ok(!keysOf(clerk)!.has('memberRoles.delete'), 'and not the key the custom role would hand it')

  const refused = await asas.kayan.memberRoles.operations
    .create({ id: 2, user: 'u-other', role: 'super' }, { actor: clerk })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'a role the guard cannot read is a refusal the caller caused')
  assert.equal(refused.status, 403, 'and it is 403, never a 401 and never a 500')
  assert.equal(refused.key, 'error.forbidden.assign', 'under the assignment guard\'s own message key')
  assert.equal((refused.params as { role?: string }).role, 'super', 'naming the role it wanted')
  assert.deepEqual(
    (refused.params as { permissions?: string[] }).permissions,
    ['*'],
    'and reading it as every key of the project, which is the largest thing it could be',
  )
  assert.equal(
    store.rows.get('memberRoles')?.length,
    1,
    'so no row was written, and the clerk still holds only the one it was assigned',
  )
})

/**
 * A system role's keys are code, and nothing but the build reads them against the catalog: a typo or a field renamed under
 * a role grants nothing and would otherwise say nothing. Core knows no platform, so a tenant role and a platform role are the
 * same entry of the target's `roles`.
 */
test('60. a system role key the catalog does not name is refused at buildAsas, naming the role and the key, for a tenant role and a platform role alike, and \'*\' passes', () => {
  const build = (roles: SystemRoles) => () => {
    const mithaq = defineMithaq({
      arkan: [base],
      targets: { memory: memoryStore(), zod: zodTarget, rbac: rbacTarget({ roles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
    })
    const courses = mithaq.defineKayan({ name: 'courses', fields: courseFields, targets: { service: { operations: defaultOperations } } })
    return mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })
  }
  const label = { ar: 'دور', en: 'Role' }

  assert.throws(
    build({ administrator: { label, permissions: '*' }, registrar: { label, permissions: ['courses.find', 'courses.fields.titel'] } }),
    /System role "registrar" holds permission "courses\.fields\.titel", which is not a key of this project's catalog\. A key is "<kayan>\.<operation>", "<kayan>\.fields\.<field>" or "screen\.<screen>", and this project's are: /,
    'a misspelled column under a tenant role fails the build by name',
  )
  assert.throws(
    build({ super_admin: { label, permissions: '*' }, support: { label, permissions: ['courses.find', 'courses.fields.archiveReason'] } }),
    /System role "support" holds permission "courses\.fields\.archiveReason", which is not a key of this project's catalog/,
    'and so does a column a platform role still names after the kayan dropped it',
  )
  assert.throws(
    build({ explorer: { label, permissions: ['screen.platform'] } }),
    /System role "explorer" holds permission "screen\.platform"/,
    'a screen this build does not hold is no key either',
  )
  assert.doesNotThrow(
    build({ administrator: { label, permissions: '*' }, registrar: { label, permissions: ['courses.find', 'courses.fields.title', 'roles.find', 'roles.fields.name'] } }),
    'every key the catalog names, and \'*\', builds',
  )
})

test('61. both access targets require the project to name the role kayan and the assignment kayan, and refuse one left out by its key', () => {
  for (const [name, make] of [['rbacTarget', rbacTarget], ['betterAuthTarget', betterAuthTarget]] as const) {
    for (const key of ['roles', 'memberRoles'] as const) {
      const kayan = { roles: 'roles', memberRoles: 'memberRoles', [key]: undefined }
      assert.throws(
        () => make({ roles: fourRoles, kayan: kayan as never }),
        new RegExp(`^Error: The access target names no kayan\\.${key}\\.`),
        `${name} without kayan.${key}`,
      )
    }
    // @ts-expect-error `kayan` is required.
    assert.throws(() => make({ roles: fourRoles }), /^Error: The access target names no kayan\.roles\./, `${name} without kayan`)
    assert.doesNotThrow(() => make({ roles: fourRoles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), `${name} with both`)
  }
})

test('62. the assignment guard requires the name of the kayan holding the custom roles, so a Better Auth project never reads a roles kayan it does not have', () => {
  // @ts-expect-error `roleKayan` is required.
  assert.throws(() => assignableRole(fourRoles), /^Error: assignableRole\(roles, roleKayan\) names no roleKayan\./)
  assert.equal(typeof assignableRole(fourRoles, 'organizationRole'), 'function')
})

/**
 * An operation key with no field key of its kayan answers 403 `field_read` on every managed read, so a list draws nothing
 * and the role looks broken rather than refused. The build says so instead, naming the role, the key and the kayan. A
 * provider action on a kayan's resource is no operation of it, so it is not counted.
 */
test('63. a system role holding an operation key of a kayan and no field key of it is refused at buildAsas, naming the role, the key and the kayan', () => {
  const build = (roles: SystemRoles) => () => {
    const mithaq = defineMithaq({
      arkan: [base],
      targets: { memory: memoryStore(), zod: zodTarget, rbac: rbacTarget({ roles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
    })
    const courses = mithaq.defineKayan({ name: 'courses', fields: courseFields, targets: { service: { operations: defaultOperations } } })
    return mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, ...accessKayan] })
  }
  const label = { ar: 'دور', en: 'Role' }
  assert.throws(
    build({ registrar: { label, permissions: ['courses.find', 'courses.fields.title', 'roles.find', 'roles.count'] } }),
    /^Error: System role "registrar" holds operation key "roles\.find" of kayan "roles" and no "roles\.fields\.<field>" key, so every read of it is refused for its fields\. Grant the fields it reads, or drop the operation\.$/,
    'the first operation key of the kayan is named',
  )
  assert.throws(
    build({ instructor: { label, permissions: ['courses.create'] } }),
    /System role "instructor" holds operation key "courses\.create" of kayan "courses"/,
    'a write counts as much as a read',
  )
  assert.doesNotThrow(build({ administrator: { label, permissions: '*' }, door: { label, permissions: [] } }), "'*' and a role holding nothing build")
  assert.doesNotThrow(build({ registrar: { label, permissions: ['courses.find', 'courses.count', 'courses.fields.id'] } }), 'one field key of the kayan is enough')

  // A provider's own action is not counted, whether it names no operation of
  // the kayan or also names one; a key is read up to its first dot, so two
  // kayan whose names share a prefix are told apart.
  const withProvider = (roles: SystemRoles) => () => {
    const mithaq = defineMithaq({
      arkan: [base],
      targets: { memory: memoryStore(), zod: zodTarget, rbac: rbacTarget({ roles, kayan: { roles: 'roles', memberRoles: 'memberRoles' } }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
    })
    const kayan = ['user', 'tag', 'tags'].map((name) => mithaq.defineKayan({ name, fields: { id: courseFields.id, title: courseFields.title }, targets: { service: { operations: defaultOperations } } }))
    return mithaq.buildAsas({ http: [fetchHttp()], kayan: [...kayan, ...accessKayan], statements: { user: ['impersonate', 'update'] } })
  }
  assert.doesNotThrow(withProvider({ support: { label, permissions: ['user.impersonate'] } }), 'a role holding only a provider action builds')
  assert.doesNotThrow(withProvider({ support: { label, permissions: ['user.update'] } }), 'and so does one holding a provider action that also names an operation')
  assert.throws(withProvider({ support: { label, permissions: ['user.impersonate', 'user.find'] } }), /System role "support" holds operation key "user\.find" of kayan "user"/, 'while an operation the provider does not declare is counted')
  assert.throws(
    withProvider({ clerk: { label, permissions: ['tags.find', 'tags.fields.title', 'tag.find'] } }),
    /System role "clerk" holds operation key "tag\.find" of kayan "tag" and no "tag\.fields\.<field>" key/,
    'a field key of tags is no field key of tag',
  )
  assert.throws(
    withProvider({ clerk: { label, permissions: ['tag.find', 'tag.fields.title', 'tags.find'] } }),
    /System role "clerk" holds operation key "tags\.find" of kayan "tags" and no "tags\.fields\.<field>" key/,
    'and a field key of tag is no field key of tags',
  )
})

test('64. memberRoleTarget answers a member the system roles its Better Auth membership names in that organization, reads no role table, and refuses a build without the member kayan', async () => {
  const roles = {
    owner: { label: { ar: 'مالك', en: 'Owner' }, permissions: '*' },
    member: { label: { ar: 'عضو', en: 'Member' }, permissions: ['courses.find', 'courses.fields.id', 'courses.fields.title'] },
  } as const satisfies SystemRoles
  const store = memoryStore()
  const target = memberRoleTarget({ roles, access: rbacTable, rolesOf: (actor: RbacActor) => actorRoles(actor) ?? [] })
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget, rbac: target, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const courses = mithaq.defineKayan({ name: 'courses', fields: courseFields, access: mithaq.rows(rbacTable), targets: { service: { operations: defaultOperations } } })
  const membership = mithaq.defineKayan({
    name: 'member',
    fields: {
      id: { kind: 'number', label: { en: 'ID', ar: 'المعرف' } },
      organizationId: { kind: 'text', label: { en: 'Organization', ar: 'المنظمة' } },
      userId: { kind: 'text', label: { en: 'User', ar: 'المستخدم' } },
      role: { kind: 'text', label: { en: 'Role', ar: 'الدور' } },
    },
    targets: { service: { operations: defaultOperations } },
  })
  assert.throws(() => mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses] }), /The access target reads kayan "member", which this build does not declare/)
  const built = mithaq.buildAsas({ http: [fetchHttp()], kayan: [courses, membership] })
  // `owner,stray` names a role the project does not ship, which grants nothing beside the one it does.
  store.rows.set('member', [
    { id: 1, organizationId: 'org1', userId: 'u-owner', role: 'owner,stray' },
    { id: 2, organizationId: 'org1', userId: 'u-member', role: 'member' },
    { id: 3, organizationId: 'org2', userId: 'u-elsewhere', role: 'owner' },
  ])
  const held = (member: string, tenant = 'org1') => target.resolve({ store: store as never, tenant, member, actor: { activeOrganizationId: tenant }, ownership: () => undefined })
  assert.deepEqual(await held('u-owner'), { permissions: '*', roles: ['owner', 'stray'] }, 'an owner holds every key')
  assert.deepEqual(await held('u-member'), { permissions: ['courses.find', 'courses.fields.id', 'courses.fields.title'], roles: ['member'] }, 'a member holds what its role lists')
  assert.deepEqual(await held('u-elsewhere'), { permissions: [], roles: [] }, 'a membership of another organization holds nothing here')
  assert.deepEqual(await held('u-nobody'), { permissions: [], roles: [] }, 'and no membership holds nothing')
  assert.deepEqual(await held('u-owner', ''), { permissions: [], roles: [] }, 'nor does a read with no organization')
  // Through the strategy, so the keys are the ones the actor carries into an operation.
  const resolve = ({ tenant, member, actor }: { tenant: unknown; member: unknown; actor: object }) => target.resolve({ store: store as never, tenant, member, actor, ownership: () => undefined })
  store.rows.set('courses', [{ id: 1, title: 'Mine', fee: 300, tenant: 'org1' }])
  const strategy = betterAuthStrategy({
    server: {
      api: {
        getSession: async () => ({ session: { activeOrganizationId: 'org1' }, user: { id: 'u-member' } }),
        getActiveMemberRole: async () => ({ role: 'member' }),
        listOrganizations: async () => [{ id: 'org1' }],
      },
      handler: async () => new Response(null),
    } as never,
    collection: 'user',
    onError: console.error,
    assigned: resolve as never,
  })
  const actor = (await strategy.authenticate({ headers: new Headers() })).user
  assert.equal((await built.kayan.courses.operations.find({}, { actor: actor as never })).docs.length, 1, 'a member reads what its role lists')
  const refused = await built.kayan.courses.operations.delete({ id: 1 }, { actor: actor as never }).catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError && refused.status === 403, 'and is refused what it does not')
})
