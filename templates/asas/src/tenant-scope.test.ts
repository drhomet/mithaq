// The tenant scope: what core puts under every managed operation on a tenant-owned kayan,
// whatever the project's access, authorizer or steps answer. Run on the memory store and on Postgres.
// First, so the template's storage reads its folder from it.
import './test-storage-dir.ts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import {
  defaultMaxBodyBytes,
  actorRoles,
  AsasError,
  AfterCommitError,
  base,
  betterAuthStrategy,
  betterAuthTenant,
  defaultAuthorize,
  defaultBulkLimit,
  defaultDepth,
  defaultFields,
  defaultGlobalFields,
  defaultGlobalOperations,
  defaultJoinLimit,
  defaultJsonMaxBytes,
  defaultLimit,
  defaultMaxLimit,
  defaultOperations,
  defineMithaq,
  draftFields,
  drizzleAdapter,
  drizzleKinds,
  drizzleRules,
  fetchHttp,
  serviceTarget,
  zodTarget,
  betterAuth,
  defaultLockTime,
  defaultMaxLoginAttempts,
  defaultTokenExpiration,
  local,
  localAuthFields,
  localAuthOperations,
  storage,
  uploadFields,
  versionOperations,
  versionsTarget,
  withUploadReference,
  type Authorize,
  type StandardSchemaV1,
  type Store,
  type RuntimeField,
  type Ctx,
  type WriteTools,
} from 'mithaq'
import { orpcHttp } from 'mithaq/orpc'
import { storageRoutes } from '../../../packages/mithaq/src/storage/storage.ts'
import { memoryStore } from './memory-store.ts'
import { expectedUpdatedAt } from '../../mithaq/src/steps/expected-updated-at.ts'
import { storageConfig } from '../../mithaq/src/storage/index.ts'
import { testDatabase } from './test-database.ts'
import { blocked as waitForLock, within } from './test-locks.ts'

const schemaName = `tenant_scope_${randomUUID().replaceAll('-', '')}`

const label = (en: string) => ({ en, ar: en })
const reads = ['memos.find', 'memos.peek', 'memos.count', 'memos.findByID', 'memos.nested', 'memos.fields.id', 'memos.fields.title', 'memos.fields.firmId', 'memos.fields.createdAt', 'memos.fields.updatedAt']
const roles = {
  editor: { label: label('Editor'), permissions: '*' },
  // Reads every column but `secret`.
  reader: { label: label('Reader'), permissions: reads },
  staff: { label: label('Staff'), permissions: [...reads, 'memos.fields.secret'] },
  scribe: { label: label('Scribe'), permissions: ['notes.create', 'notes.fields.id', 'notes.fields.title', 'notes.fields.memo'] },
} as const

/** Who holds which roles in which organization, and who is backoffice staff, read by the access target below. */
const assignments = new Map<string, string[]>()
const staff = new Set<string>()
let backofficeApp = false

const keysOf = (slugs: readonly string[]) =>
  slugs.includes('editor') ? '*' as const : [...new Set(slugs.flatMap((slug) => roles[slug as keyof typeof roles]?.permissions as readonly string[] ?? []))]

// An access target written by hand: its roles per organization are the map above.
const access = {
  capability: 'access' as const,
  roles,
  rolesOf: (user: unknown) => actorRoles(user) ?? [],
  access: {},
  reads: [],
  resolve: async ({ tenant, member }: { tenant: unknown; member: unknown }) => {
    const slugs = staff.has(member as string) ? ['staff'] : assignments.get(`${String(tenant)}:${String(member)}`) ?? []
    if (slugs.includes('down')) throw new Error(`The role table of ${String(tenant)} is down.`)
    return { permissions: keysOf(slugs), roles: slugs }
  },
  seed: async () => {},
}

let storeProbe: (ctx: Ctx, tools: WriteTools) => Promise<void> = async () => {}
const probeStore = async (ctx: Ctx, tools: WriteTools) => (await storeProbe(ctx, tools), ctx)

let localProbe = async (_request: Request): Promise<Record<string, unknown>> => ({})

let outside = 0
let members = 0
/** What `onError` was handed, so a resolver failure is seen to be reported. */
const reported: unknown[] = []
/** The row a raw write in a step reaches for, set by the test that makes it. */
const victim: { id?: string; data?: Record<string, unknown> } = {}
/** Each `ctx.tenant` a recording step saw, in order. */
const seenTenants: unknown[] = []
const seeTenant = (ctx: { tenant?: unknown }) => (seenTenants.push(ctx.tenant), ctx)
const rewriteTenant = (ctx: { tenant?: unknown }) => ((ctx.tenant = 'org2'), ctx)
/** The memo a step writes into a note, set by the test that makes it. */
const linked: { memo?: string } = {}
/** What a step writes past the managed write, set by the test that makes it: a new note, or `id`'s. */
const scribbled: { id?: string; data?: Record<string, unknown> } = {}
/** The row a step writes past its own: a kayan, an id and, for an insert or an update, the values. */
const aimed: { kayan?: string; id?: string; data?: Record<string, unknown> } = {}
/** Where a held write stops, inside its transaction with its locks still taken, until the test that set it lets it go. */
const gate: { reached?: PromiseWithResolvers<void>; release?: PromiseWithResolvers<void> } = {}
const pause = async (ctx: unknown) => {
  const { reached, release } = gate
  try {
    reached?.resolve()
    await within(release?.promise ?? Promise.resolve(), 5000)
    return ctx
  } finally {
    release?.resolve()
  }
}
const hold = () => Object.assign(gate, { reached: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }) as Required<typeof gate>
/** The sessions the build's own Better Auth server knows, by the `x-person` header a request carries; `actorOf` writes them. */
const sessions = new Map<string, { active: string | null | undefined; orgs: string[] }>()
const sessionOf = (headers: Headers) => sessions.get(headers.get('x-person') ?? '')
// The build's one Better Auth kayan, whose sessions alone name a tenant.
const stubServer = () => ({
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const held = sessionOf(headers)
      return held ? { session: { activeOrganizationId: held.active }, user: { id: headers.get('x-person') } } : null
    },
    listOrganizations: async ({ headers }: { headers: Headers }) => (sessionOf(headers)?.orgs ?? []).map((id) => ({ id })),
  },
  handler: async () => new Response(null),
})

const languageOf = (store: Record<string, unknown> & { capability: 'store' }, { authorize = defaultAuthorize, withLocal = false, publicFiles = false }: { authorize?: Authorize; withLocal?: boolean; publicFiles?: boolean } = {}) => {
  /** A step that writes the row `aimed` names through the raw store, beside the operation's own. */
  const aimAt = (write: 'insert' | 'update' | 'remove') =>
    async (ctx: { tx: unknown }, tools: { store: Record<typeof write, (args: object) => Promise<unknown>> }) =>
      (await tools.store[write]({ tx: ctx.tx, kayan: declaration(built, aimed.kayan ?? ''), id: aimed.id, data: aimed.data }), ctx)
  const language = defineMithaq({
    arkan: [base, storage(storageConfig)],
    targets: {
      store,
      zod: zodTarget,
      rbac: access,
      versions: versionsTarget({ max: 100 }),
      tenant: betterAuthTenant({ relationTo: 'firms', onDelete: 'restrict', organizations: 'many', backoffice: ({ user }) => backofficeApp && staff.has((user as { id: string }).id) }),
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'store', schema: 'zod', authorize, softDelete: 'deletedAt', beforeSteps: [(ctx: Ctx, tools: { kind: string }) => tools.kind === 'insert' && ctx.kayan.name === 'memos' ? { ...ctx, data: { code: null, globalCode: null, ...ctx.data } } : ctx] }),
    } as {},
  })
  const { tenant } = (language as unknown as { targets: { tenant: ReturnType<typeof betterAuthTenant<'firms'>> } }).targets
  const firms = { name: 'firms', schemaName, fields: { id: { kind: 'text' }, name: { kind: 'text' }, memos: { kind: 'join', relationTo: 'memos', on: 'firmId' } }, access: { read: () => true }, targets: { service: { operations: defaultOperations } } }
  const moveTo = (to: string) => (ctx: { data: Record<string, unknown> }) => ({ ...ctx, data: { ...ctx.data, firmId: to } })
  const memos = language.defineKayan({
    name: 'memos',
    schemaName,
    indexes: [{ fields: ['globalCode'], unique: true }],
    fields: { ...defaultFields, firmId: tenant.field, title: { kind: 'text' }, code: { kind: 'text', rules: { unique: true } }, globalCode: { kind: 'text' }, balance: { kind: 'integer', rules: { defaultValue: 0 } }, quantity: { kind: 'decimal', rules: { precision: 18, scale: 3, defaultValue: '0' } }, amount: { kind: 'number', rules: { defaultValue: 0 } }, secret: { kind: 'text', rules: { defaultValue: '-' } }, meta: { kind: 'json', maxBytes: defaultJsonMaxBytes, rules: { defaultValue: {} } }, notes: { kind: 'join', relationTo: 'notes', on: 'memo' } },
    // `read: true` for an editor: the broadest answer a row gives.
    // A reader's answer is a filter, so under `tenant: 'mine'` its organizations take a branch of their own.
    access: language.rows({ editor: { create: true, read: true, update: true, delete: true }, reader: { read: { title: { not_equals: 'hidden' } } }, staff: { read: true } } as never),
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          outsideProbe: { beforeTransaction: [probeStore], steps: ({ steps }: { steps: { insert: unknown } }) => [steps.insert] },
          afterProbe: { steps: ({ steps }: { steps: { insert: unknown } }) => [steps.insert], afterCommit: [probeStore] },
          probeAfterEdit: { steps: ({ steps }: { steps: { update: unknown } }) => [steps.update, probeStore] },
          probeEdit: { steps: ({ steps }: { steps: { update: unknown } }) => [probeStore, steps.update] },
          probeBulk: { steps: ({ steps }: { steps: { updateMany: unknown } }) => [probeStore, steps.updateMany] },
          probe: { steps: ({ steps }: { steps: { insert: unknown } }) => [probeStore, steps.insert] },
          guarded: { steps: ({ steps }: { steps: { insert: unknown } }) => [steps.insert], beforeTransaction: [(ctx: unknown) => (outside += 1, ctx)] },
          claimed: { input: () => z.object({ title: z.string(), firmId: z.string() }).strict(), steps: ({ steps }: { steps: { insert: unknown } }) => [steps.insert], beforeTransaction: [(ctx: unknown) => (outside += 1, ctx)] },
          stamp: { steps: ({ steps }: { steps: { insert: unknown } }) => [moveTo('org2'), steps.insert] },
          shift: { steps: ({ steps }: { steps: { update: unknown } }) => [moveTo('org2'), steps.update] },
          // Two steps that rewrite `ctx.tenant`, one in place and one by a copy, around steps that record it.
          // Each list opens with a step that rewrites it in place, so the object a list starts from is rewritten too.
          forge: {
            beforeTransaction: [rewriteTenant, seeTenant],
            steps: ({ steps }: { steps: { insert: unknown } }) => [
              rewriteTenant,
              seeTenant,
              (ctx: object) => ({ ...ctx, tenant: 'org3' }),
              seeTenant,
              steps.insert,
            ],
            afterCommit: [rewriteTenant, seeTenant],
          },
          peek: { steps: ({ steps }: { steps: { find: unknown } }) => [seeTenant, steps.find] },
          // A managed read inside a read's step, which keeps the reach the outer read opened.
          peekNested: {
            steps: ({ steps }: { steps: { find: unknown } }) => [
              async (ctx: unknown, tools: { kayans: { memos: { peek: (input: object) => Promise<unknown> } } }) => (await tools.kayans.memos.peek({}), ctx),
              steps.find,
            ],
          },
          // A replaced list: the managed read is the project's own step around the sealed one.
          mine: { steps: ({ steps }: { steps: { find: unknown } }) => [(ctx: unknown) => ctx, steps.find] },
          nested: {
            steps: ({ steps }: { steps: { count: unknown } }) => [
              steps.count,
              async (ctx: { data: unknown }, tools: { kayans: { memos: { find: (input: object) => Promise<{ totalDocs: number }> } } }) =>
                ({ ...ctx, data: { totalDocs: (await tools.kayans.memos.find({ limit: 0 })).totalDocs } }),
            ],
          },
          // A raw write in a bulk list's step, which the sealed store holds to the active organization.
          sweep: {
            steps: ({ steps }: { steps: { updateMany: unknown } }) => [
              async (ctx: { tx: unknown }, tools: { store: { update: (args: object) => Promise<unknown> } }) => (await tools.store.update({ tx: ctx.tx, kayan: declaration(built, 'memos'), id: victim.id, data: victim.data }), ctx),
              steps.updateMany,
            ],
          },
          // A raw write to the row `aimed` names, beside the operation's own.
          poke: { steps: ({ steps }: { steps: { insert: unknown } }) => [aimAt('insert'), steps.insert] },
          // A create whose step changes the row it just made, through the raw store.
          restamp: {
            steps: ({ steps }: { steps: { insert: unknown } }) => [
              steps.insert,
              async (ctx: { tx: unknown; data: Record<string, unknown> }, tools: { store: { update: (args: object) => Promise<Record<string, unknown>> } }) =>
                ({ ...ctx, data: { ...ctx.data, ...(await tools.store.update({ tx: ctx.tx, kayan: declaration(built, 'memos'), id: ctx.data.id, data: { title: 'restamped' } })) } }),
            ],
          },
          touch: { steps: ({ steps }: { steps: { update: unknown } }) => [aimAt('update'), steps.update] },
          heldErase: { steps: ({ steps }: { steps: { update: unknown } }) => [steps.update, pause, async (ctx: { tx: unknown; data: { id: unknown } }, tools: { store: { remove: (args: object) => Promise<unknown> } }) => (await tools.store.remove({ tx: ctx.tx, kayan: declaration(built, 'memos'), id: ctx.data.id }), ctx)] },
          heldDelete: { steps: ({ steps }: { steps: { remove: unknown } }) => [pause, steps.remove] },
          heldSweep: { steps: ({ steps }: { steps: { updateMany: unknown } }) => [steps.updateMany, pause] },
          prune: { steps: ({ steps }: { steps: { remove: unknown } }) => [aimAt('remove'), steps.remove] },
          // A raw insert into another tenant-owned kayan, under another organization.
          plant: {
            steps: ({ steps }: { steps: { insert: unknown } }) => [
              async (ctx: { tx: unknown }, tools: { store: { insert: (args: object) => Promise<unknown> } }) => (await tools.store.insert({ tx: ctx.tx, kayan: declaration(built, 'opens'), data: { title: 'planted', firmId: 'org2', createdAt: new Date(), updatedAt: new Date() } }), ctx),
              steps.insert,
            ],
          },
          twin: {
            steps: ({ steps }: { steps: { insert: unknown } }) => [
              async (ctx: unknown, tools: { kayans: { memos: { create: (input: object) => Promise<unknown> } } }) => (await tools.kayans.memos.create({ title: 'twin' }), ctx),
              steps.insert,
            ],
          },
        },
      },
    },
  } as never)
  // Every callback answers true: no row table and no filter of its own.
  const open = {
    name: 'opens',
    schemaName,
    fields: { ...defaultFields, firmId: tenant.field, title: { kind: 'text' } },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { service: { operations: defaultOperations } },
  }
  // Tenant-owned, naming other rows every way a row can: one, a set, a shared row, and a value its own step writes.
  const notes = {
    name: 'notes',
    schemaName,
    fields: {
      ...defaultFields,
      firmId: tenant.field,
      title: { kind: 'text' },
      memo: { kind: 'relationship', relationTo: 'memos' },
      memoSet: { kind: 'relationship', relationTo: 'memos', hasMany: true },
      tag: { kind: 'relationship', relationTo: 'tags' },
      cover: { kind: 'upload', relationTo: 'files' },
      // Another note, so two edits can each name the row the other changes.
      reply: { kind: 'relationship', relationTo: 'notes' },
    },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          // Names its memo, stops holding it, then changes the row `aimed` names.
          heldLink: { steps: ({ steps }: { steps: { insert: unknown } }) => [steps.insert, pause, aimAt('update')] },
          // Stops with its own row loaded and held, before its references are checked.
          heldEdit: { steps: ({ steps }: { steps: { update: unknown } }) => [pause, steps.update] },
          // Compares the instant its caller read, then stops holding the row before it writes.
          heldStale: { input: ({ update }: { update: z.ZodObject }) => update.extend({ expectedUpdatedAt: z.date() }), steps: ({ steps }: { steps: { update: unknown } }) => [expectedUpdatedAt, pause, steps.update] },
          link: { steps: ({ steps }: { steps: { insert: unknown } }) => [(ctx: { data: Record<string, unknown> }) => ({ ...ctx, data: { ...ctx.data, memo: linked.memo } }), steps.insert] },
          scribble: {
            steps: ({ steps }: { steps: { insert: unknown } }) => [
              async (ctx: { tx: unknown }, tools: { store: { insert: (args: object) => Promise<unknown>; update: (args: object) => Promise<unknown> } }) => {
                await (scribbled.id
                  ? tools.store.update({ tx: ctx.tx, kayan: declaration(built, 'notes'), id: scribbled.id, data: scribbled.data })
                  : tools.store.insert({ tx: ctx.tx, kayan: declaration(built, 'notes'), data: scribbled.data }))
                return ctx
              },
              steps.insert,
            ],
          },
        },
      },
    },
  }
  // Tenant-owned files, which a note's cover names.
  const files = {
    name: 'files',
    schemaName,
    fields: { ...defaultFields, ...uploadFields, firmId: tenant.field },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: {
      storage: { mimeTypes: ['image/png'], ...(publicFiles && { public: true }) },
      service: {
        operations: {
          ...defaultOperations,
          create: { ...defaultOperations.create, input: ({ create }: { create: StandardSchemaV1 }) => withUploadReference(create), beforeTransaction: [storageConfig.uploaded] },
          delete: { ...defaultOperations.delete, afterCommit: ({ afterCommit }: { afterCommit: readonly unknown[] }) => [...afterCommit, storageConfig.removed] },
        },
      },
    },
  }
  // Tenant-owned and drafted, so a draft save and a restore name a memo too.
  const papers = {
    name: 'papers',
    schemaName,
    fields: { ...defaultFields, firmId: tenant.field, title: { kind: 'text' }, balance: { kind: 'integer', rules: { defaultValue: 0 } }, memo: { kind: 'relationship', relationTo: 'memos' }, meta: { kind: 'json', maxBytes: defaultJsonMaxBytes, rules: { defaultValue: {} } }, ...draftFields },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: {
      service: { operations: { ...defaultOperations, ...versionOperations, probeAfterEdit: { input: ({ update }: { update: StandardSchemaV1 }) => update, steps: ({ steps }: { steps: { update: unknown } }) => [steps.update, probeStore] }, draftProbeAfterEdit: { steps: ({ steps }: { steps: { update: unknown } }) => [steps.update, probeStore] }, probe: { steps: ({ steps }: { steps: { insert: unknown } }) => [probeStore, steps.insert] }, bump: { input: ({ update }: { update: StandardSchemaV1 }) => update, steps: ({ steps }: { steps: { update: unknown } }) => [(ctx: Ctx) => ({ ...ctx, data: { ...ctx.data, balance: { $inc: 3 } } }), steps.update] }, draftBump: { steps: ({ steps }: { steps: { update: unknown } }) => [(ctx: Ctx) => ({ ...ctx, data: { ...ctx.data, balance: { $inc: 3 } } }), steps.update] }, touch: { steps: ({ steps }: { steps: { update: unknown } }) => [aimAt('update'), steps.update] }, heldDraft: { steps: ({ steps }: { steps: { update: unknown } }) => [steps.update, pause] } } },
      versions: { drafts: { autosave: true } },
    },
  }
  // Shared files: no organization's, whoever uploads them.
  const assets = { ...files, name: 'assets', fields: { ...defaultFields, ...uploadFields } }
  // One row per organization, kept so by its unique tenant field.
  const prefs = language.defineGlobal({
    name: 'prefs',
    schemaName,
    fields: {
      ...defaultFields,
      firmId: { ...tenant.field, rules: { ...tenant.field.rules, unique: true } },
      theme: { kind: 'text' },
      globalType: { ...defaultGlobalFields.globalType, rules: { required: true } },
    },
    access: { read: () => true, update: () => true },
    targets: { service: { operations: defaultGlobalOperations } },
  } as never)
  // Shared: its own read access admits the open tags alone, the same in every organization.
  const tags = {
    name: 'tags',
    schemaName,
    fields: { ...defaultFields, label: { kind: 'text' }, code: { kind: 'text', rules: { unique: true } }, balance: { kind: 'integer', rules: { defaultValue: 0 } }, quantity: { kind: 'decimal', rules: { precision: 18, scale: 3, defaultValue: '0' } }, amount: { kind: 'number', rules: { defaultValue: 0 } }, open: { kind: 'checkbox' } },
    access: { read: () => ({ open: { equals: true } }) },
    targets: { service: { operations: defaultOperations } },
  }
  // Shared, pointing at a tenant-owned kayan.
  const pins = {
    name: 'pins',
    schemaName,
    fields: { ...defaultFields, label: { kind: 'text' }, memo: { kind: 'relationship', relationTo: 'memos' } },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          probe: { steps: ({ steps }: { steps: { insert: unknown } }) => [probeStore, steps.insert] },
          forge: { steps: ({ steps }: { steps: { insert: unknown } }) => [seeTenant, steps.insert] },
          peek: { steps: ({ steps }: { steps: { find: unknown } }) => [seeTenant, steps.find] },
        },
      },
    },
  }
  // A code is unique within an organization: the default, beside a plain list of the kayan's own.
  const badges = {
    name: 'badges',
    schemaName,
    fields: { ...defaultFields, firmId: tenant.field, code: { kind: 'text', rules: { unique: true } }, title: { kind: 'text' } },
    indexes: [{ fields: ['firmId', 'title'], unique: true }],
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { service: { operations: defaultOperations } },
  }
  // Unique across every organization, on purpose: the per-organization default filtered out, the global one added.
  const serials = {
    ...badges,
    name: 'serials',
    indexes: ({ defaults }: { defaults: { fields: string[]; unique?: boolean }[] }) => [...defaults.filter((index) => !index.fields.includes('code')), { fields: ['code'], unique: true }],
  }
  // A code is unique per term within an organization, written as a group; a plain unique ref is one across every organization.
  const terms = {
    name: 'terms',
    schemaName,
    fields: { ...defaultFields, firmId: tenant.field, code: { kind: 'text' }, term: { kind: 'text' }, ref: { kind: 'text' } },
    indexes: [{ within: 'firmId', unique: [['code', 'term']] }, { fields: ['ref'], unique: true }],
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: { service: { operations: defaultOperations } },
  }
  // Shared, so its unique code is one across the whole table.
  const stamps = {
    ...badges,
    name: 'stamps',
    fields: { ...defaultFields, code: { kind: 'text', rules: { unique: true } } },
    indexes: undefined,
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          // Stops after its UPDATE ran, holding whatever lock that statement took.
          heldEdit: { steps: ({ steps }: { steps: { update: unknown } }) => [steps.update, pause] },
          // Stops with its own row loaded and held, before its UPDATE runs.
          heldRecode: { steps: ({ steps }: { steps: { update: unknown } }) => [pause, steps.update] },
        },
      },
    },
  }
  // Tenant-owned and kept when deleted: a delete marks its row and asks no rows naming it.
  const shelves = {
    name: 'shelves',
    schemaName,
    fields: {
      ...defaultFields,
      firmId: tenant.field,
      title: { kind: 'text' },
      next: { kind: 'relationship', relationTo: 'shelves' },
      deletedAt: { kind: 'datetime', rules: { providedBy: { create: 'never', update: 'never' } } },
    },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true },
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          // Marks its row, stops holding it, then changes the row `aimed` names.
          heldShelve: { steps: ({ steps }: { steps: { remove: unknown } }) => [steps.remove, pause, aimAt('update')] },
          // Changes the row `aimed` names, then makes a row naming another.
          link: { steps: ({ steps }: { steps: { insert: unknown } }) => [aimAt('update'), steps.insert] },
          heldClear: { steps: ({ steps }: { steps: { deleteMany: unknown } }) => [steps.deleteMany, pause] },
        },
      },
    },
  }
  const numbered = { name: 'numbered', schemaName, fields: { id: { kind: 'number' }, name: { kind: 'text' }, code: { kind: 'integer', rules: { unique: true } } }, targets: { service: { operations: defaultOperations } } }
  const user = { name: 'user', schemaName, fields: { id: { kind: 'text' } }, auth: betterAuth({ server: stubServer as never }), targets: { service: { operations: defaultOperations } } }
  // A local account, which is no organization's member.
  const locals = {
    name: 'locals',
    schemaName,
    fields: { ...defaultFields, ...localAuthFields },
    access: { create: () => true, read: () => false, update: () => false, delete: () => false },
    auth: local({ tokenExpiration: defaultTokenExpiration, maxLoginAttempts: defaultMaxLoginAttempts, lockTime: defaultLockTime, ip: () => null, email: { send: async () => {} }, context: (request) => localProbe(request), secret: 'tenant-scope-a-local-auth-test-secret' }),
    targets: { service: { operations: { ...defaultOperations, ...localAuthOperations } } },
  }
  const built: Built = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [firms, memos, open, files, assets, notes, papers, tags, pins, badges, serials, stamps, terms, shelves, numbered, user, ...(withLocal ? [locals] : [])] as never, global: [prefs], auth: { maxBodyBytes: defaultMaxBodyBytes, onError: (error: unknown) => reported.push(error) } } as never) as unknown as Built
  return built
}

type Ops = Record<'probeAfterEdit' | 'draftProbeAfterEdit' | 'bump' | 'draftBump' | 'outsideProbe' | 'afterProbe' | 'probeEdit' | 'probeBulk' | 'probe' | 'create' | 'update' | 'delete' | 'find' | 'findByID' | 'count' | 'updateMany' | 'guarded' | 'claimed' | 'stamp' | 'shift' | 'mine' | 'nested' | 'twin' | 'sweep' | 'poke' | 'restamp' | 'touch' | 'prune' | 'plant' | 'link' | 'scribble' | 'forge' | 'peek' | 'peekNested' | 'findVersions' | 'findVersionByID' | 'restoreVersion' | 'heldDelete' | 'heldLink' | 'heldDraft' | 'heldEdit' | 'heldSweep' | 'heldStale' | 'heldRecode' | 'deleteMany' | 'heldShelve' | 'heldClear' | 'heldErase', (input?: unknown, options?: unknown) => Promise<any>>
type Built = { global: { prefs: { operations: Record<'findOne' | 'update', (input?: unknown, options?: unknown) => Promise<any>> } }; operations: unknown; auth: { actor: (headers: Headers) => Promise<unknown> }; kayan: Record<'memos' | 'opens' | 'firms' | 'files' | 'assets' | 'notes' | 'papers' | 'tags' | 'pins' | 'badges' | 'serials' | 'stamps' | 'terms' | 'shelves' | 'numbered', { operations: Ops }>; handler: (request: Request) => Promise<Response>; targets: Record<string, any>; connect: () => Promise<void>; destroy: () => Promise<void> }

// Generic probes select an existing declaration from the built asas; only negative probes fabricate an unknown one.
const declaration = (built: Built, name: string) => (built.kayan as unknown as Record<string, { name: string; fields: Record<string, RuntimeField> }>)[name]
  ?? (built.global as unknown as Record<string, { name: string; fields: Record<string, RuntimeField> }>)[name]
  ?? { name, fields: {} as Record<string, RuntimeField> }

/** An actor through the real Better Auth strategy, so every fact the scope reads is the trusted snapshot's. */
const actorOf = async ({ active, orgs = active ? { [active]: ['editor'] } : {}, backoffice = false, collection = 'user' }: { active?: string | null; orgs?: Record<string, string[]>; backoffice?: boolean; collection?: string }) => {
  const id = `person-${(members += 1)}`
  sessions.set(id, { active, orgs: Object.keys(orgs) })
  for (const [org, slugs] of Object.entries(orgs)) assignments.set(`${org}:${id}`, slugs)
  if (backoffice) staff.add(id)
  const strategy = betterAuthStrategy({
    server: {
      api: {
        getSession: async () => ({ session: { activeOrganizationId: active }, user: { id } }),
        listOrganizations: async () => Object.keys(orgs).map((org) => ({ id: org })),
      },
      handler: async () => new Response(null),
    } as never,
    collection,
    onError: console.error,
    assigned: ((args: { tenant: unknown; member: unknown }) => access.resolve(args)) as never,
  })
  return (await strategy.authenticate({ headers: new Headers() })).user as unknown as Record<string, unknown>
}

const refusal = async (promise: Promise<unknown>) => {
  const thrown = await promise.then(() => undefined, (error: unknown) => error)
  assert.ok(thrown, 'the call was refused')
  return thrown as AsasError
}

const suite = (name: string, make: () => Promise<{ built: Built; store: Store; done: () => Promise<void> }>, postgres = false) => describe(name, () => {
  let built: Built
  let store: Store
  let done: () => Promise<void>
  let one: Record<string, unknown>
  let two: Record<string, unknown>
  let ids: { org1: string; org2: string; org3: string }
  const memos = () => built.kayan.memos.operations

  before(async () => {
    ;({ built, store, done } = await make())
    await store.transaction(async (tx) => {
      for (const id of ['org1', 'org2', 'org3']) await store.insert({ tx, kayan: 'firms', data: { id, name: id } })
    })
    one = await actorOf({ active: 'org1' })
    two = await actorOf({ active: 'org2' })
    const three = await actorOf({ active: 'org3' })
    ids = {
      org1: (await memos().create({ title: 'one', secret: 's1' }, { actor: one })).id,
      org2: (await memos().create({ title: 'two', secret: 's2' }, { actor: two })).id,
      org3: (await memos().create({ title: 'three', secret: 's3' }, { actor: three })).id,
    }
  })
  after(() => done())

  test('a create is filled with the active organization, and a caller naming the field is refused before any step runs', async () => {
    const made = await memos().create({ title: 'filled' }, { actor: one })
    assert.equal(made.firmId, 'org1')
    for (const operation of ['guarded', 'claimed']) {
      const refused = await refusal(memos()[operation as 'guarded']({ title: 'x', firmId: 'org2' }, { actor: one }))
      assert.equal(refused.status, 400)
      assert.match(refused.message, /Unrecognized key: "firmId"/)
    }
    assert.equal(outside, 0, 'no beforeTransaction step ran')
    const unchanged = await memos().count({ where: { title: { equals: 'x' } } }, { actor: await actorOf({ active: 'org2', orgs: { org2: ['editor'] } }) })
    assert.equal(unchanged.totalDocs, 0, 'and nothing was written in either organization')
  })

  test('no verified active organization is a refusal, never an unfiltered operation: anonymous, unmarked, local-looking, non-member, null and mutated actors', async () => {
    const before = outside
    const nonMember = await actorOf({ active: 'org1', orgs: { org2: ['editor'] } })
    const noActive = await actorOf({ active: null, orgs: { org1: ['editor'] } })
    const unmarked = { id: 'x', strategy: 'better-auth', activeOrganizationId: 'org1', organizations: [{ id: 'org1' }], roles: ['editor'], permissions: '*' }
    // A session of another Better Auth instance, whose organizations are no rows of the tenant kayan.
    const elsewhere = await actorOf({ active: 'org1', collection: 'backofficeUser' })
    for (const actor of [undefined, unmarked, nonMember, noActive, elsewhere]) {
      for (const call of [() => memos().find({}, { actor }), () => memos().count({}, { actor }), () => memos().findByID({ id: ids.org1 }, { actor }), () => memos().guarded({ title: 'no' }, { actor }), () => memos().update({ id: ids.org1, title: 'no' }, { actor }), () => memos().delete({ id: ids.org1 }, { actor })]) {
        assert.equal((await refusal(call())).status, 403)
      }
    }
    assert.equal(outside, before, 'a refused create ran no outside step')
    // Mutating the actor object moves nothing: the scope is the snapshot the strategy took.
    const moved = await actorOf({ active: 'org1' })
    moved.activeOrganizationId = 'org2'
    moved.organizations = [{ id: 'org2' }]
    const page = await memos().find({}, { actor: moved })
    assert.ok(page.docs.length && page.docs.every((row: { firmId: string }) => row.firmId === 'org1'))
  })

  test('a step that moves a created or updated row to another organization is refused, and nothing is written', async () => {
    const before = (await memos().count({}, { actor: two })).totalDocs
    await assert.rejects(memos().stamp({ title: 'moved' }, { actor: one }), /made a row of kayan "memos" in another organization/)
    await assert.rejects(memos().shift({ id: ids.org1, title: 'moved' }, { actor: one }), /declares providedBy "never"|wrote field "firmId"/)
    assert.equal((await memos().count({}, { actor: two })).totalDocs, before)
    assert.equal((await memos().findByID({ id: ids.org1 }, { actor: one })).firmId, 'org1')
  })

  test('a step reads ctx.tenant as the active organization, a step rewriting it moves nothing, and a shared kayan or a read past one organization reads none', async () => {
    seenTenants.length = 0
    const made = await memos().forge({ title: 'forged' }, { actor: one })
    assert.equal(made.firmId, 'org1')
    assert.deepEqual(seenTenants, ['org1', 'org1', 'org1', 'org1'])
    assert.equal((await memos().count({ where: { title: { equals: 'forged' } } }, { actor: two })).totalDocs, 0)
    seenTenants.length = 0
    await memos().peek({}, { actor: one })
    await memos().peek({}, { actor: one, tenant: 'mine' })
    await built.kayan.pins.operations.forge({ label: 'shared', memo: null }, { actor: one })
    await built.kayan.pins.operations.peek({}, { actor: one })
    await memos().peekNested({}, { actor: one })
    await memos().peekNested({}, { actor: one, tenant: 'mine' })
    assert.deepEqual(seenTenants, ['org1', undefined, undefined, undefined, 'org1', undefined])
    const operator = await actorOf({ active: null, backoffice: true })
    backofficeApp = true
    try {
      seenTenants.length = 0
      await memos().peek({}, { actor: operator, tenant: 'all' })
      assert.deepEqual(seenTenants, [undefined])
    } finally {
      backofficeApp = false
    }
  })

  test('reads, counts and reads by id see the active organization alone, and another organization\'s row answers as a missing one', async () => {
    const page = await memos().find({ limit: 0 }, { actor: one })
    assert.ok(page.docs.every((row: { firmId: string }) => row.firmId === 'org1'))
    assert.equal((await memos().count({}, { actor: one })).totalDocs, page.totalDocs, 'the count is the rows')
    assert.equal((await memos().find({ where: { firmId: { equals: 'org2' } } }, { actor: one })).totalDocs, 0, 'a where only narrows')
    assert.equal((await memos().count({ where: { firmId: { in: ['org2', 'org3'] } } }, { actor: one })).totalDocs, 0)
    const hidden = await refusal(memos().findByID({ id: ids.org2 }, { actor: one }))
    const absent = await refusal(memos().findByID({ id: '00000000-0000-4000-8000-000000000000' }, { actor: one }))
    assert.equal(hidden.status, 404)
    assert.equal(hidden.key, absent.key)
  })

  test('an update, a delete and a bulk reach the active organization alone, and another organization\'s row answers as a missing one', async () => {
    for (const call of [() => memos().update({ id: ids.org2, title: 'taken' }, { actor: one }), () => memos().delete({ id: ids.org2 }, { actor: one })]) {
      const refused = await refusal(call())
      assert.equal(refused.status, 404)
      assert.equal(refused.key, 'error.not_found.row')
    }
    assert.equal((await memos().findByID({ id: ids.org2 }, { actor: two })).title, 'two', 'the other row is untouched')
    const bulk = await memos().updateMany({ where: { title: { in: ['one', 'two', 'three'] } }, data: { title: 'bulk' } }, { actor: one })
    assert.equal(bulk.docs.length, 1)
    assert.equal(bulk.docs[0].firmId, 'org1')
    assert.equal((await memos().findByID({ id: ids.org2 }, { actor: two })).title, 'two')
    const named = await refusal(memos().updateMany({ where: { title: { equals: 'bulk' } }, data: { firmId: 'org2' } }, { actor: one }))
    assert.equal(named.status, 400)
    await memos().update({ id: ids.org1, title: 'one' }, { actor: one })
  })

  test('the scope survives a callback answering true, several roles, a custom authorizer and a replaced read list', async () => {
    const opens = built.kayan.opens.operations
    await opens.create({ title: 'a' }, { actor: one })
    await opens.create({ title: 'b' }, { actor: two })
    const seen = await opens.find({ limit: 0 }, { actor: one })
    assert.deepEqual(seen.docs.map((row: { firmId: string }) => row.firmId), ['org1'])
    const both = await actorOf({ active: 'org1', orgs: { org1: ['editor', 'reader'] } })
    assert.ok((await memos().find({ limit: 0 }, { actor: both })).docs.every((row: { firmId: string }) => row.firmId === 'org1'))
    assert.ok((await memos().mine({ limit: 0 }, { actor: one })).docs.every((row: { firmId: string }) => row.firmId === 'org1'))
  })

  test('a nested managed call keeps the scope of the operation around it', async () => {
    const nested = await memos().nested({}, { actor: one })
    assert.equal(nested.totalDocs, (await memos().find({ limit: 0 }, { actor: one })).totalDocs)
    const made = await memos().twin({ title: 'outer' }, { actor: one })
    assert.equal(made.firmId, 'org1')
    const twins = await memos().find({ where: { title: { equals: 'twin' } } }, { actor: one })
    assert.deepEqual(twins.docs.map((row: { firmId: string }) => row.firmId), ['org1'])
    const reader = await actorOf({ active: 'org1', orgs: { org1: ['editor'], org2: ['reader'] } })
    const mine = await memos().nested({}, { actor: reader, tenant: 'mine' })
    const reached = await memos().find({ limit: 0 }, { actor: reader, tenant: 'mine' })
    assert.ok(reached.totalDocs > nested.totalDocs)
    assert.equal(mine.totalDocs, reached.totalDocs, 'a nested read under tenant: \'mine\' reaches the same organizations')
  })

  test('tenant: \'mine\' reads every verified membership, each under its own roles and columns, and a where only narrows', async () => {
    const actor = await actorOf({ active: 'org1', orgs: { org1: ['editor'], org2: ['reader'] } })
    const page = await memos().find({ limit: 0 }, { actor, tenant: 'mine' })
    const firms = [...new Set(page.docs.map((row: { firmId: string }) => row.firmId))].sort()
    assert.deepEqual(firms, ['org1', 'org2'], 'org3 is no membership')
    assert.ok(page.docs.filter((row: { firmId: string }) => row.firmId === 'org1').every((row: { secret?: string }) => 'secret' in row), 'an editor reads the secret')
    assert.ok(page.docs.filter((row: { firmId: string }) => row.firmId === 'org2').every((row: { secret?: string }) => !('secret' in row)), 'a reader does not')
    assert.equal((await memos().count({}, { actor, tenant: 'mine' })).totalDocs, page.totalDocs)
    assert.equal((await memos().find({ where: { firmId: { in: ['org3'] } } }, { actor, tenant: 'mine' })).totalDocs, 0)
    assert.equal((await memos().find({ where: { firmId: { equals: 'org2' } } }, { actor, tenant: 'mine' })).docs.length, 1)
    // A column hidden from one membership cannot filter its rows.
    assert.equal((await refusal(memos().find({ where: { secret: { equals: 's2' } } }, { actor, tenant: 'mine' }))).status, 403)
    assert.equal((await memos().findByID({ id: ids.org2 }, { actor, tenant: 'mine' })).title, 'two')
    // A membership whose roles cannot read adds nothing, and one with none at all is no reach.
    const lone = await actorOf({ active: 'org1', orgs: { org1: [], org2: [] } })
    assert.equal((await refusal(memos().find({}, { actor: lone, tenant: 'mine' }))).status, 403)
  })

  // The memory store reads no path into a json value; the scope it is ANDed beside is the same either way.
  if (postgres) test('a filter along a json path reads the active organization alone, and a reader without the field\'s key is refused it, under tenant: \'mine\' too', async () => {
    const meta = { stage: 'probe', tags: ['x'] }
    const mine = await memos().create({ title: 'json one', meta }, { actor: one })
    await memos().create({ title: 'json two', meta }, { actor: two })
    for (const where of [{ 'meta.stage': { equals: 'probe' } }, { 'meta.tags': { in: ['x'] } }, { meta: { contains: 'probe' } }]) {
      assert.deepEqual((await memos().find({ where }, { actor: one })).docs.map((row: { id: string }) => row.id), [mine.id], JSON.stringify(where))
      assert.equal((await memos().count({ where }, { actor: one })).totalDocs, 1)
    }
    // `meta` is no key of the reader's, so no path into it, nor `exists`, tells a reader what it holds.
    const reader = await actorOf({ active: 'org1', orgs: { org1: ['reader'] } })
    for (const where of [{ 'meta.stage': { equals: 'probe' } }, { 'meta.tags': { exists: true } }, { meta: { like: 'probe' } }, { or: [{ title: { equals: 'x' } }, { 'meta.stage': { equals: 'probe' } }] }]) {
      const refused = await refusal(memos().find({ where }, { actor: reader }))
      assert.equal(refused.status, 403, JSON.stringify(where))
      assert.equal(refused.key, 'error.forbidden.field_read')
    }
    const both = await actorOf({ active: 'org1', orgs: { org1: ['editor'], org2: ['reader'] } })
    assert.equal((await refusal(memos().find({ where: { 'meta.stage': { equals: 'probe' } } }, { actor: both, tenant: 'mine' }))).status, 403)
  })

  test('tenant: \'all\' is backoffice staff in the backoffice app alone, and a write takes no tenant', async () => {
    const operator = await actorOf({ active: null, backoffice: true })
    assert.equal((await refusal(memos().find({}, { actor: operator, tenant: 'all' }))).status, 403, 'outside the backoffice app')
    backofficeApp = true
    try {
      const page = await memos().find({ limit: 0 }, { actor: operator, tenant: 'all' })
      assert.deepEqual([...new Set(page.docs.map((row: { firmId: string }) => row.firmId))].sort(), ['org1', 'org2', 'org3'])
      assert.equal((await refusal(memos().find({}, { actor: one, tenant: 'all' }))).status, 403, 'a member is no backoffice staff')
      for (const reach of ['all', 'mine']) {
        for (const call of [() => memos().create({ title: 'w' }, { actor: one, tenant: reach }), () => memos().update({ id: ids.org1, title: 'w' }, { actor: one, tenant: reach }), () => memos().delete({ id: ids.org1 }, { actor: one, tenant: reach }), () => memos().updateMany({ where: { title: { equals: 'one' } }, data: { title: 'w' } }, { actor: one, tenant: reach })]) {
          const refused = await refusal(call())
          assert.equal(refused.status, 400)
          assert.equal(refused.key, 'error.invalid.tenant_option')
        }
      }
    } finally {
      backofficeApp = false
    }
    assert.equal((await refusal(memos().find({}, { actor: one, tenant: 'every' }))).status, 400)
  })

  test('a raw write in a step, a bulk list\'s included, reaches the active organization alone, whichever tenant-owned kayan it names', async () => {
    const victimRow = await memos().findByID({ id: ids.org2 }, { actor: two })
    for (const data of [{ firmId: 'org1' }, { title: 'pwned' }]) {
      Object.assign(victim, { id: ids.org2, data })
      await assert.rejects(memos().sweep({ where: { title: { equals: 'one' } }, data: { title: 'one' } }, { actor: one }))
    }
    const after = await memos().findByID({ id: ids.org2 }, { actor: two })
    assert.equal(after.firmId, 'org2')
    assert.equal(after.title, victimRow.title)
    const planted = (await built.kayan.opens.operations.count({ where: { title: { equals: 'planted' } } }, { actor: two })).totalDocs
    await assert.rejects(memos().plant({ title: 'plant' }, { actor: one }), /made a row of kayan "opens" in another organization/)
    assert.equal((await built.kayan.opens.operations.count({ where: { title: { equals: 'planted' } } }, { actor: two })).totalDocs, planted)
    assert.equal((await memos().count({ where: { title: { equals: 'plant' } } }, { actor: one })).totalDocs, 0, 'and the operation around it wrote nothing')
  })

  test('a raw write in an update or a delete step reaches exactly the id it names, of its own kayan or another, and never another organization\'s row', async () => {
    const opens = built.kayan.opens.operations
    const own = await memos().create({ title: 'own' }, { actor: one })
    const sibling = await memos().create({ title: 'sibling' }, { actor: one })
    const other = await opens.create({ title: 'other' }, { actor: one })
    const theirs = await memos().create({ title: 'theirs' }, { actor: two })
    const titleOf = async (kayan: 'memos' | 'opens', id: string, actor = one) => (await built.kayan[kayan].operations.findByID({ id }, { actor }).catch(() => undefined))?.title

    Object.assign(aimed, { kayan: 'memos', id: sibling.id, data: { title: 'sibling touched' } })
    await memos().touch({ id: own.id, title: 'own touched' }, { actor: one })
    assert.equal(await titleOf('memos', sibling.id), 'sibling touched', 'the sibling the step named changed')
    assert.equal(await titleOf('memos', own.id), 'own touched', 'and the operation\'s own row holds its own values')

    Object.assign(aimed, { kayan: 'opens', id: other.id, data: { title: 'other touched' } })
    await memos().touch({ id: own.id, title: 'own again' }, { actor: one })
    assert.equal(await titleOf('opens', other.id), 'other touched', 'a row of another kayan changed')
    assert.equal(await titleOf('memos', own.id), 'own again')

    Object.assign(aimed, { kayan: 'memos', id: theirs.id, data: { title: 'pwned' } })
    await memos().touch({ id: own.id, title: 'own third' }, { actor: one }).catch(() => undefined)
    assert.equal(await titleOf('memos', theirs.id, two), 'theirs', 'another organization\'s row is out of reach')
    const ownTitle = await titleOf('memos', own.id)

    const doomed = await memos().create({ title: 'doomed' }, { actor: one })
    Object.assign(aimed, { kayan: 'memos', id: theirs.id, data: undefined })
    await memos().prune({ id: doomed.id }, { actor: one }).catch(() => undefined)
    assert.equal(await titleOf('memos', theirs.id, two), 'theirs', 'another organization\'s row is not removed')

    Object.assign(aimed, { kayan: 'memos', id: sibling.id, data: undefined })
    await memos().prune({ id: doomed.id }, { actor: one })
    assert.equal(await titleOf('memos', sibling.id), undefined, 'the sibling the step named is gone')
    assert.equal(await titleOf('memos', doomed.id), undefined, 'and so is the operation\'s own row')
    assert.equal(await titleOf('memos', own.id), ownTitle, 'no other row was touched')

    const last = await memos().create({ title: 'last' }, { actor: one })
    Object.assign(aimed, { kayan: 'opens', id: other.id, data: undefined })
    await memos().prune({ id: last.id }, { actor: one })
    assert.equal(await titleOf('opens', other.id), undefined, 'a row of another kayan is gone')
    assert.equal(await titleOf('memos', own.id), ownTitle, 'and the row the operation updated before stands')
  })

  test('a create\'s step changes the row it just made through the raw store, whether or not the caller sent its id', async () => {
    for (const sent of [{}, { id: crypto.randomUUID() }]) {
      const made = await memos().restamp({ title: 'stamp', ...sent }, { actor: one })
      assert.equal((await memos().findByID({ id: made.id }, { actor: one })).title, 'restamped', JSON.stringify(sent))
    }
  })

  test('a raw write in a step naming a versions table or a join table is refused, so another organization\'s snapshots and join rows stay out of reach', async () => {
    const papers = built.kayan.papers.operations
    const notes = built.kayan.notes.operations
    const theirs = await papers.create({ title: 'theirs', memo: null, _status: 'published' }, { actor: two })
    const theirNote = await notes.create({ title: 'their note', memo: null, memoSet: [ids.org2], tag: null, cover: null, reply: null }, { actor: two })
    const snapshots = async () => (await store.find({ kayan: '_papers_versions', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { parent: { equals: theirs.id } } } })).docs
    const held = await snapshots()
    const snapshot = held[0]!
    const mine = await memos().create({ title: 'aimer' }, { actor: one })
    const now = new Date()
    const writes: [typeof aimed, () => Promise<unknown>][] = [
      [{ kayan: '_papers_versions', data: { parent: theirs.id, version: { ...(snapshot.version as object), title: 'planted' }, latest: true, autosave: false, createdAt: now, updatedAt: now } }, () => memos().poke({ title: 'poke' }, { actor: one })],
      [{ kayan: '_papers_versions', id: snapshot.id as string, data: { version: { ...(snapshot.version as object), title: 'pwned' } } }, () => memos().touch({ id: mine.id, title: 'touch' }, { actor: one })],
      [{ kayan: '_papers_versions', id: snapshot.id as string }, () => memos().prune({ id: mine.id }, { actor: one })],
      [{ kayan: 'notes_memo_set', data: { parent: theirNote.id, target: ids.org1, order: 1 } }, () => memos().poke({ title: 'poke' }, { actor: one })],
      [{ kayan: 'notes_memo_set', id: theirNote.id, data: { order: 2 } }, () => memos().touch({ id: mine.id, title: 'touch' }, { actor: one })],
      [{ kayan: 'notes_memo_set', id: theirNote.id }, () => memos().prune({ id: mine.id }, { actor: one })],
    ]
    for (const [aim, call] of writes) {
      Object.assign(aimed, { id: undefined, data: undefined }, aim)
      await assert.rejects(call(), /names no kayan/, `${aim.kayan} ${aim.id ? 'by id' : 'insert'} is refused`)
    }
    assert.deepEqual(await snapshots(), held, 'their snapshots are as they were')
    assert.deepEqual((await notes.findByID({ id: theirNote.id }, { actor: two })).memoSet, [ids.org2], 'and their join rows')
    assert.equal((await memos().findByID({ id: mine.id }, { actor: one })).title, 'aimer', 'and the operations around them wrote nothing')
  })

  test('the operation\'s own row keeps its version while a raw write in its step reaches a sibling, which saves none', async () => {
    const papers = built.kayan.papers.operations
    const own = await papers.create({ title: 'own', memo: null, _status: 'published' }, { actor: one })
    const sibling = await papers.create({ title: 'sibling', memo: null, _status: 'published' }, { actor: one })
    const count = async (id: string) => (await papers.findVersions({ where: { parent: { equals: id } } }, { actor: one })).totalDocs
    const before = { own: await count(own.id), sibling: await count(sibling.id) }
    Object.assign(aimed, { kayan: 'papers', id: sibling.id, data: { title: 'sibling raw' } })
    await papers.touch({ id: own.id, title: 'own touched', _status: 'published' }, { actor: one })
    assert.equal(await count(own.id), before.own + 1, 'the own row saved its version')
    assert.equal((await papers.findByID({ id: own.id }, { actor: one })).title, 'own touched')
    assert.equal(await count(sibling.id), before.sibling, 'the raw write saved none')
    assert.equal((await papers.findByID({ id: sibling.id }, { actor: one })).title, 'sibling raw')
  })

  // Postgres answers a uuid in lowercase whatever case it was asked in; the memory store keeps the case it was given.
  test('a step naming its own row as the store answered it, while the caller sent the id in capitals, still saves the row\'s version', { skip: !postgres }, async () => {
    const papers = built.kayan.papers.operations
    const own = await papers.create({ title: 'own', memo: null, _status: 'published' }, { actor: one })
    const count = async () => (await papers.findVersions({ where: { parent: { equals: own.id } } }, { actor: one })).totalDocs
    const before = await count()
    Object.assign(aimed, { kayan: 'papers', id: own.id, data: { title: 'by the step' } })
    await papers.touch({ id: own.id.toUpperCase(), title: 'by the caller', _status: 'published' }, { actor: one })
    assert.equal(await count(), before + 2, 'the step\'s write and the update each saved a version, as writes of the row itself')
    assert.equal((await papers.findByID({ id: own.id }, { actor: one })).title, 'by the caller')
  })

  test('tenant: \'mine\' gives a membership whose roles answer a filter a branch of its own, refuses a sort by a hidden column, and masks joined rows by their membership', async () => {
    const hidden = { org1: await memos().create({ title: 'hidden', secret: 'h1' }, { actor: one }), org2: await memos().create({ title: 'hidden', secret: 'h2' }, { actor: two }) }
    const actor = await actorOf({ active: 'org1', orgs: { org1: ['editor'], org2: ['reader'] } })
    const page = await memos().find({ limit: 0, where: { title: { equals: 'hidden' } } }, { actor, tenant: 'mine' })
    assert.deepEqual(page.docs.map((row: { id: string }) => row.id), [hidden.org1.id], 'the reader\'s filter holds in org2 alone')
    assert.equal((await memos().count({ where: { title: { equals: 'hidden' } } }, { actor, tenant: 'mine' })).totalDocs, 1)
    assert.equal((await refusal(memos().find({ sort: 'secret' }, { actor, tenant: 'mine' }))).status, 403)
    const firms = await built.kayan.firms.operations.find({ depth: 1, limit: 0, sort: 'id' }, { actor, tenant: 'mine' })
    const joined = Object.fromEntries(firms.docs.map((firm: { id: string; memos: Record<string, unknown>[] }) => [firm.id, firm.memos]))
    assert.ok(joined.org1.length && joined.org1.every((row: Record<string, unknown>) => 'secret' in row), 'org1\'s rows carry the editor\'s columns')
    assert.ok(joined.org2.length && joined.org2.every((row: Record<string, unknown>) => !('secret' in row) && row.title !== 'hidden'), 'org2\'s the reader\'s')
    assert.deepEqual(joined.org3, [], 'and org3 is no membership')
    const active = await built.kayan.firms.operations.find({ depth: 1, limit: 0, sort: 'id' }, { actor })
    assert.deepEqual(active.docs.find((firm: { id: string }) => firm.id === 'org2').memos, [], 'without the option a join reads the active organization alone')
    for (const row of Object.values(hidden)) await memos().delete({ id: row.id }, { actor: row.firmId === 'org1' ? one : two })
  })

  test('a membership whose roles fail to resolve holds no key and adds nothing, and the failure is reported', async () => {
    const before = reported.length
    const actor = await actorOf({ active: 'org1', orgs: { org1: ['editor'], org2: ['down'] } })
    const page = await memos().find({ limit: 0 }, { actor, tenant: 'mine' })
    assert.deepEqual([...new Set(page.docs.map((row: { firmId: string }) => row.firmId))], ['org1'])
    assert.ok(reported.length > before)
  })

  // What a refusal tells the caller, which is the same for a row that is not there and one of another organization.
  const told = (error: AsasError) => ({ status: error.status, key: error.key, message: error.message, params: error.params })
  const absent = '00000000-0000-4000-8000-000000000000'
  // Every column named, since the memory store keeps a key it was never handed as absent rather than null.
  const note = (data: Record<string, unknown>) => ({ memo: null, memoSet: [], tag: null, cover: null, reply: null, ...data })
  /** A row written past every operation, as a row older than the scope or another tool would be. */
  const raw = (kayan: string, data: Record<string, unknown>) =>
    store.transaction((tx) => store.insert({ tx, kayan, data: { ...(kayan === 'tags' && { code: null, balance: 0, quantity: '0', amount: 0 }), ...data, createdAt: new Date(), updatedAt: new Date() } })) as Promise<Record<string, unknown>>
  /** Whether another transaction takes the row in that mode now, or is still waiting on it when its lock timeout ends. */
  const takes = (kayan: string, id: unknown, lock: 'noKeyUpdate' | 'keyShare') => store.transaction(async (tx) => {
    await (tx as { execute: (sql: string) => Promise<unknown> }).execute("set local lock_timeout = '200ms'")
    await store.find({ kayan, args: { limit: 1, page: 1, lock, sort: { field: 'id', direction: 'asc' }, where: { id: { equals: id as string } } }, tx })
  }).then(() => 'taken', (error: { cause?: { code?: string } }) => {
    if (error.cause?.code === '55P03') return 'waited'
    throw error
  })
  const blocked = () => waitForLock({ db: built.targets.store.db, where: `pid <> pg_backend_pid() and query like '%"${schemaName}".%'` })

  test('a reference to another organization\'s row is refused exactly as an absent id is: one row, a set, a file and a step\'s value, on create, update and bulk', async () => {
    const notes = built.kayan.notes.operations
    const file = (org: string) => raw('files', { filename: `${org}.png`, mimeType: 'image/png', filesize: 1, key: `tenant-scope/${org}.png`, storage: 'local', firmId: org })
    const covers = { org1: (await file('org1')).id as string, org2: (await file('org2')).id as string }
    const made = await notes.create(note({ title: 'n1', memo: ids.org1, memoSet: [ids.org1], cover: covers.org1 }), { actor: one })
    assert.equal(made.memo, ids.org1)
    assert.equal(made.cover, covers.org1)
    const calls = (other: string, cover: string) => [
      () => notes.create(note({ title: 'x', cover }), { actor: one }),
      () => notes.update({ id: made.id, cover }, { actor: one }),
      () => notes.create(note({ title: 'x', memo: other }), { actor: one }),
      () => notes.create(note({ title: 'x', memoSet: [ids.org1, other] }), { actor: one }),
      () => notes.update({ id: made.id, memo: other }, { actor: one }),
      () => notes.update({ id: made.id, memoSet: [other] }, { actor: one }),
      () => notes.updateMany({ where: { title: { equals: 'n1' } }, data: { memo: other } }, { actor: one }),
      () => {
        linked.memo = other
        return notes.link(note({ title: 'x' }), { actor: one })
      },
    ]
    const missing = calls(absent, absent)
    for (const [index, call] of calls(ids.org2, covers.org2).entries()) {
      const refused = await refusal(call())
      assert.equal(refused.status, 400, `call ${index}`)
      assert.equal(refused.key, 'error.invalid.tenant_reference')
      assert.deepEqual(told(refused), told(await refusal(missing[index]!())), `call ${index} tells nothing an absent id does not`)
    }
    assert.equal((await notes.count({ where: { title: { equals: 'x' } } }, { actor: one })).totalDocs, 0, 'nothing was written')
    const kept = await notes.findByID({ id: made.id }, { actor: one })
    assert.equal(kept.memo, ids.org1)
    assert.deepEqual(kept.memoSet, [ids.org1])
    linked.memo = ids.org1
    assert.equal((await notes.link(note({ title: 'linked' }), { actor: one })).memo, ids.org1, 'a step\'s value in the organization stands')
  })

  test('a step\'s raw write names a tenant-owned row of the active organization alone, refused as an absent id: one row, a set and a file, inserted or updated', async () => {
    const notes = built.kayan.notes.operations
    const cover = (await raw('files', { filename: 'raw.png', mimeType: 'image/png', filesize: 1, key: 'tenant-scope/raw-org2.png', storage: 'local', firmId: 'org2' })).id as string
    const scratch = await notes.create(note({ title: 'scratch' }), { actor: one })
    const made = (data: Record<string, unknown>) => note({ title: 'scribbled', firmId: 'org1', createdAt: new Date(), updatedAt: new Date(), ...data })
    const writes = (other: string, file: string) => [
      { data: made({ memo: other }) },
      { data: made({ memoSet: [ids.org1, other] }) },
      { data: made({ cover: file }) },
      { id: scratch.id, data: { memo: other } },
      { id: scratch.id, data: { memoSet: [other] } },
      { id: scratch.id, data: { cover: file } },
    ]
    const scribble = async (write: typeof scribbled) => {
      Object.assign(scribbled, { id: undefined, data: undefined }, write)
      return refusal(notes.scribble(note({ title: 'outer' }), { actor: one }))
    }
    const missing = writes(absent, absent)
    for (const [index, write] of writes(ids.org2, cover).entries()) {
      const refused = await scribble(write)
      assert.equal(refused.status, 400, `write ${index}`)
      assert.deepEqual(told(refused), told(await scribble(missing[index]!)), `write ${index} tells nothing an absent id does not`)
    }
    assert.equal((await notes.count({ where: { title: { in: ['scribbled', 'outer'] } } }, { actor: one })).totalDocs, 0, 'nothing was written')
    const kept = await notes.findByID({ id: scratch.id }, { actor: one })
    assert.deepEqual([kept.memo, kept.memoSet, kept.cover], [null, [], null])
    Object.assign(scribbled, { id: undefined, data: made({ memo: ids.org1, memoSet: [ids.org1] }) })
    await notes.scribble(note({ title: 'outer' }), { actor: one })
    assert.equal((await notes.count({ where: { title: { equals: 'scribbled' } } }, { actor: one })).totalDocs, 1, 'a row of its own organization stands')
  })

  test('a draft save and a restore that name another organization\'s row are refused, and the row keeps its own', async () => {
    const papers = built.kayan.papers.operations
    const paper = await papers.create({ title: 'paper', memo: ids.org1, _status: 'published' }, { actor: one })
    for (const call of [
      (other: string) => papers.update({ id: paper.id, memo: other }, { actor: one, draft: true }),
      (other: string) => papers.create({ title: 'drafted', memo: other }, { actor: one, draft: true }),
    ]) {
      const refused = await refusal(call(ids.org2))
      assert.equal(refused.status, 400)
      assert.deepEqual(told(refused), told(await refusal(call(absent))))
    }
    // A version naming org2's memo, as one saved before the scope would.
    const [latest] = (await store.find({ kayan: '_papers_versions', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { and: [{ parent: { equals: paper.id } }, { latest: { equals: true } }] } } })).docs
    await store.transaction((tx) => store.update({ tx, kayan: '_papers_versions', id: latest!.id, data: { version: { ...(latest!.version as object), memo: ids.org2 } } }))
    const foreign = latest!
    const refused = await refusal(papers.restoreVersion({ id: foreign.id }, { actor: one }))
    assert.equal(refused.status, 400)
    assert.equal(refused.key, 'error.invalid.tenant_reference')
    assert.equal((await papers.findByID({ id: paper.id }, { actor: one })).memo, ids.org1)
  })

  test('the target\'s own read access holds beside the scope: a row of the active organization the caller may not read is refused as an absent one', async () => {
    const hidden = await memos().create({ title: 'hidden', secret: 'h' }, { actor: one })
    try {
      const reader = await actorOf({ active: 'org1', orgs: { org1: ['reader', 'scribe'] } })
      const refused = await refusal(built.kayan.notes.operations.create(note({ title: 'r', memo: hidden.id }), { actor: reader }))
      assert.deepEqual(told(refused), told(await refusal(built.kayan.notes.operations.create(note({ title: 'r', memo: absent }), { actor: reader }))))
      assert.equal(refused.status, 400)
    } finally {
      await memos().delete({ id: hidden.id }, { actor: one })
    }
  })

  test('a reference to a shared kayan keeps that kayan\'s own access and adds no organization', async () => {
    const notes = built.kayan.notes.operations
    const open = await raw('tags', { label: 'open', open: true })
    const shut = await raw('tags', { label: 'shut', open: false })
    assert.equal((await notes.create(note({ title: 't1', tag: open.id }), { actor: one })).tag, open.id)
    assert.equal((await notes.create(note({ title: 't2', tag: open.id }), { actor: two })).tag, open.id, 'every organization may name it')
    const refused = await refusal(notes.create(note({ title: 't3', tag: shut.id }), { actor: one }))
    assert.equal(refused.status, 400)
    assert.deepEqual(told(refused), told(await refusal(notes.create(note({ title: 't3', tag: absent }), { actor: one }))))
  })

  test('a shared kayan names a tenant-owned row through the scope: another organization\'s, or any under no active organization, is refused as an absent one', async () => {
    const pins = built.kayan.pins.operations
    assert.equal((await pins.create({ label: 'p1', memo: ids.org1 }, { actor: one })).memo, ids.org1)
    const foreign = await refusal(pins.create({ label: 'px', memo: ids.org2 }, { actor: one }))
    assert.equal(foreign.status, 400)
    assert.equal(foreign.key, 'error.invalid.reference')
    assert.deepEqual(told(foreign), told(await refusal(pins.create({ label: 'px', memo: absent }, { actor: one }))))
    const noActive = await actorOf({ active: null, orgs: { org1: ['editor'] } })
    const unscoped = await refusal(pins.create({ label: 'px', memo: ids.org1 }, { actor: noActive }))
    assert.deepEqual(told(unscoped), told(await refusal(pins.create({ label: 'px', memo: absent }, { actor: noActive }))))
    assert.equal((await pins.count({ where: { label: { equals: 'px' } } }, { actor: one })).totalDocs, 0)
  })

  test('a filter through a relationship reads the far row through the scope, its count included, under the active organization and tenant: \'mine\'', async () => {
    const pins = built.kayan.pins.operations
    const notes = built.kayan.notes.operations
    await pins.create({ label: 'p2', memo: ids.org2 }, { actor: two })
    // A note of org1 that names org2's memo, as a row older than the scope would.
    await raw('notes', note({ title: 'stray', firmId: 'org1', memo: ids.org2 }))
    const through = { where: { 'memo.title': { equals: 'two' } } }
    for (const [kayan, actor, expected] of [[pins, one, 0], [pins, two, 1], [notes, one, 0]] as const) {
      const page = await kayan.find({ ...through, limit: 0 }, { actor })
      assert.equal(page.totalDocs, expected)
      assert.equal(page.docs.length, expected)
      assert.equal((await kayan.count(through, { actor })).totalDocs, expected, 'the count is the rows')
    }
    // A bulk write's filter reaches through the same scope, so org2's memo picks none of org1's notes.
    assert.deepEqual((await notes.updateMany({ ...through, data: { title: 'reached' } }, { actor: one })).docs, [])
    assert.equal((await notes.count({ where: { title: { equals: 'stray' } } }, { actor: one })).totalDocs, 1)
    // The secret of a memo another membership reads as a reader alone filters nothing.
    const mine = await actorOf({ active: 'org1', orgs: { org1: ['editor'], org2: ['reader'] } })
    assert.equal((await pins.find({ ...through, limit: 0 }, { actor: mine, tenant: 'mine' })).totalDocs, 1)
    assert.equal((await pins.count(through, { actor: mine, tenant: 'mine' })).totalDocs, 1)
    for (const kayan of [pins, notes]) {
      for (const read of [kayan.find, kayan.count]) {
        assert.equal((await refusal(read({ where: { 'memo.secret': { equals: 's2' } } }, { actor: mine, tenant: 'mine' }))).status, 403)
      }
    }
    assert.equal((await pins.count({ where: { 'memo.secret': { equals: 's2' } } }, { actor: two })).totalDocs, 1, 'org2\'s editor reads it')
    assert.equal((await pins.count({ where: { 'memo.secret': { equals: 's2' } } }, { actor: one })).totalDocs, 0, 'org1\'s does not reach it')
  })

  test('joins at every depth read each level through the scope, under the active organization and tenant: \'mine\'', async () => {
    await built.kayan.notes.operations.create(note({ title: 'n2', memo: ids.org2 }), { actor: two })
    const firms = built.kayan.firms.operations
    const notesOf = (page: { docs: { id: string; memos: { id: string; notes: { title: string; firmId: string }[] }[] }[] }, firm: string) =>
      page.docs.find((one) => one.id === firm)!.memos.find((memo) => memo.id === ids.org2)?.notes
    const both = await actorOf({ active: 'org2', orgs: { org2: ['editor'], org3: ['editor'] } })
    for (const [actor, options] of [[two, {}], [both, { tenant: 'mine' }]] as const) {
      const page = await firms.find({ depth: 2, limit: 0, sort: 'id' }, { actor, ...options })
      const notes = notesOf(page, 'org2')!
      assert.ok(notes.length, 'org2\'s memo carries its notes')
      assert.ok(notes.every((note) => note.firmId === 'org2'), 'and none of org1, which names it')
      assert.deepEqual(page.docs.find((one: { id: string }) => one.id === 'org1')!.memos, [], 'org1 is no membership')
    }
    const outsider = await firms.find({ depth: 2, limit: 0, sort: 'id' }, { actor: one })
    assert.equal(notesOf(outsider, 'org2'), undefined, 'org1 sees no memo of org2 to carry notes')
  })

  /** A paper of org1 with a published copy and a draft after it, so it has two versions. */
  const paperWithVersions = async (title: string) => {
    const papers = built.kayan.papers.operations
    const paper = await papers.create({ title, memo: ids.org1, _status: 'published' }, { actor: one })
    await papers.update({ id: paper.id, title: `${title} draft` }, { actor: one, draft: true })
    const page = await papers.findVersions({ where: { parent: { equals: paper.id } } }, { actor: one })
    assert.equal(page.totalDocs, 2)
    return { paper, versions: page.docs as { id: string }[] }
  }

  test('another organization\'s versions answer as missing ones: a list, a diff\'s read by parent, a read by id, a restore, a discard, a draft save, an autosave and a publish', async () => {
    const papers = built.kayan.papers.operations
    const { paper, versions } = await paperWithVersions('versioned')
    const listed = await papers.findVersions({ limit: 0 }, { actor: two })
    assert.ok(listed.docs.every((one: { parent: string }) => one.parent !== paper.id))
    assert.equal(listed.totalDocs, listed.docs.length, 'the total is the versions it reaches')
    assert.equal((await papers.findVersions({ where: { parent: { equals: paper.id } } }, { actor: two })).totalDocs, 0)
    const absentVersion = '00000000-0000-4000-8000-00000000000a'
    const calls = (id: string, version: string) => [
      () => papers.findVersionByID({ id: version }, { actor: two }),
      () => papers.restoreVersion({ id: version }, { actor: two }),
      // A discard is a restore that names the row itself.
      () => papers.restoreVersion({ id }, { actor: two }),
      () => papers.update({ id, title: 'taken' }, { actor: two, draft: true }),
      () => papers.update({ id, title: 'taken' }, { actor: two, draft: true, autosave: true }),
      () => papers.update({ id, title: 'taken', _status: 'published' }, { actor: two }),
    ]
    const missing = calls(absent, absentVersion)
    for (const [index, call] of calls(paper.id, versions[0]!.id).entries()) {
      const refused = await refusal(call())
      assert.equal(refused.status, 404, `call ${index}`)
      const gone = await refusal(missing[index]!())
      assert.deepEqual([refused.status, refused.key], [gone.status, gone.key], `call ${index} answers as an absent id does`)
    }
    const kept = await papers.findVersions({ where: { parent: { equals: paper.id } } }, { actor: one })
    assert.equal(kept.totalDocs, 2, 'no version was added')
    assert.equal((await papers.findByID({ id: paper.id }, { actor: one })).title, 'versioned')
    assert.equal((await papers.findByID({ id: paper.id }, { actor: one, draft: true })).title, 'versioned draft')
    // Its own organization reaches them, and so does a 'mine' read through a membership there.
    assert.equal((await papers.findVersionByID({ id: versions[0]!.id }, { actor: one })).parent, paper.id)
    const both = await actorOf({ active: 'org2', orgs: { org1: ['editor'], org2: ['editor'] } })
    assert.equal((await papers.findVersions({ where: { parent: { equals: paper.id } } }, { actor: both, tenant: 'mine' })).totalDocs, 2)
  })

  test('a version whose snapshot names another organization reads, drafts and restores as its row\'s own', async () => {
    const papers = built.kayan.papers.operations
    const { paper, versions } = await paperWithVersions('owned')
    const [latest] = (await store.find({ kayan: '_papers_versions', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { equals: versions[0]!.id } } } })).docs
    await store.transaction((tx) => store.update({ tx, kayan: '_papers_versions', id: latest!.id, data: { version: { ...(latest!.version as object), firmId: 'org2', title: 'restored' } } }))
    assert.equal((await papers.findVersionByID({ id: latest!.id }, { actor: one })).version.firmId, 'org1')
    assert.ok((await papers.findVersions({ where: { parent: { equals: paper.id } } }, { actor: one })).docs.every((one: { version: { firmId: string } }) => one.version.firmId === 'org1'))
    assert.equal((await papers.findVersionByID({ id: latest!.id }, { actor: two }).catch((error: AsasError) => error)).status, 404, 'and another organization still reads it as missing')
    const restored = await papers.restoreVersion({ id: latest!.id }, { actor: one })
    assert.equal(restored.title, 'restored')
    assert.equal(restored.firmId, 'org1')
    assert.equal((await papers.findByID({ id: paper.id }, { actor: one })).firmId, 'org1')
    assert.equal((await papers.count({ where: { title: { equals: 'restored' } } }, { actor: two })).totalDocs, 0)
    // A draft read and a draft saved on top of a planted snapshot keep the row's organization too.
    const plant = async () => {
      const [newest] = (await store.find({ kayan: '_papers_versions', args: { limit: 1, page: 1, sort: { field: 'updatedAt', direction: 'desc' }, where: { parent: { equals: paper.id } } } })).docs
      await store.transaction((tx) => store.update({ tx, kayan: '_papers_versions', id: newest!.id, data: { version: { ...(newest!.version as object), firmId: 'org2' } } }))
    }
    await plant()
    assert.equal((await papers.findByID({ id: paper.id }, { actor: one, draft: true })).firmId, 'org1')
    const drafted = await papers.update({ id: paper.id, title: 'drafted again' }, { actor: one, draft: true })
    assert.equal(drafted.firmId, 'org1')
  })

  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
  /** A request through the build's own handler, as the person `actor` is signed in as. */
  const send = (actor: Record<string, unknown> | null, method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) =>
    built.handler(new Request(new URL(path, 'http://test'), { method, headers: { ...(actor && { 'x-person': String(actor.id) }), ...headers }, body }))
  /** Asks for instructions on `kayan` as `actor` and puts the bytes where they say, answering the signed reference. */
  const uploaded = async (actor: Record<string, unknown>, kayan: string) => {
    const asked = await send(actor, 'POST', `/api/${kayan}/uploadInstructions`, JSON.stringify({ filename: 'a.png', filesize: png.length, mimeType: 'image/png' }), { 'content-type': 'application/json' })
    assert.equal(asked.status, 200, await asked.clone().text())
    const { request, file } = await asked.json() as { request: { url: string; headers: Record<string, string> }; file: { uploadReference: Record<string, unknown> } }
    assert.equal((await built.handler(new Request(new URL(request.url, 'http://test'), { method: 'PUT', headers: request.headers, body: png }))).status, 204)
    return file.uploadReference
  }

  test('an upload is signed, checked and served in its kayan\'s own scope: an organization\'s file under its folder, a shared kayan\'s under none', async () => {
    const files = built.kayan.files.operations
    const reference = await uploaded(one, 'files')
    assert.equal(reference.tenant, 'org1')
    assert.match(String(reference.key), /\/org1\/files\//)
    // A session naming org1 without a membership there is no org1, as everywhere else.
    const nonMember = await actorOf({ active: 'org1', orgs: { org2: ['editor'] } })
    const asked = await send(nonMember, 'POST', '/api/files/uploadInstructions', JSON.stringify({ filename: 'a.png', filesize: png.length, mimeType: 'image/png' }), { 'content-type': 'application/json' })
    assert.equal(asked.status, 403)
    assert.equal((await refusal(files.create({ uploadReference: reference }, { actor: nonMember }))).status, 403)
    const elsewhere = await refusal(files.create({ uploadReference: reference }, { actor: two }))
    assert.equal(elsewhere.status, 400)
    assert.equal(elsewhere.key, 'error.invalid.upload_reference')
    const made = await files.create({ uploadReference: reference }, { actor: one })
    assert.equal(made.firmId, 'org1')
    const served = await send(one, 'GET', String(made.url))
    assert.equal(served.status, 200)
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), png)
    const hidden = await send(two, 'GET', String(made.url))
    const missing = await send(two, 'GET', `/api/files/file/${absent}`)
    assert.equal(hidden.status, 404)
    assert.deepEqual(await hidden.json(), await missing.json(), 'another organization\'s file answers as an absent one')
    assert.equal((await send(null, 'GET', String(made.url))).status, 404)
    // Shared: the reference names no organization, whichever session asks.
    const shared = await uploaded(one, 'assets')
    assert.equal(shared.tenant, null)
    assert.match(String(shared.key), /\/_\/assets\//)
    const asset = await built.kayan.assets.operations.create({ uploadReference: shared }, { actor: one })
    assert.equal((await send(two, 'GET', String(asset.url))).status, 200, 'and every organization reads it through its own access')
  })

  test('a scoped global is one row per organization: each reads and writes its own, the first write makes it, and no read reaches past it', async () => {
    const prefs = built.global.prefs.operations
    assert.equal(await prefs.findOne({}, { actor: one }), null)
    const made = await prefs.update({ theme: 'dark' }, { actor: one })
    assert.equal(made.firmId, 'org1')
    assert.equal(await prefs.findOne({}, { actor: two }), null, 'org2 has no row of its own yet')
    const theirs = await prefs.update({ theme: 'light' }, { actor: two })
    assert.equal(theirs.firmId, 'org2')
    assert.notEqual(theirs.id, made.id)
    assert.equal((await prefs.update({ theme: 'dim' }, { actor: one })).id, made.id, 'a second write updates the first row')
    assert.equal((await prefs.findOne({}, { actor: one })).theme, 'dim')
    assert.equal((await prefs.findOne({}, { actor: two })).theme, 'light')
    for (const reach of ['mine', 'all']) {
      const refused = await refusal(prefs.findOne({}, { actor: one, tenant: reach }))
      assert.equal(refused.status, 400)
      assert.equal(refused.key, 'error.invalid.tenant_option')
    }
    const noActive = await actorOf({ active: null, orgs: { org1: ['editor'] } })
    for (const call of [() => prefs.findOne({}, { actor: noActive }), () => prefs.update({ theme: 'x' }, { actor: noActive }), () => prefs.findOne({})]) {
      assert.equal((await refusal(call())).status, 403)
    }
    assert.equal((await refusal(prefs.update({ theme: 'x', firmId: 'org2' }, { actor: one }))).status, 400)
    assert.equal((await prefs.findOne({}, { actor: two })).theme, 'light')
  })

  if (postgres) test('two concurrent first writes of one organization to a scoped global make one row, and a loser is the conflict a unique value gets', async () => {
    const prefs = built.global.prefs.operations
    const racer = await actorOf({ active: 'org3' })
    const results = await Promise.allSettled([prefs.update({ theme: 'first' }, { actor: racer }), prefs.update({ theme: 'second' }, { actor: racer })])
    // Under load one can commit before the other reads, which then updates the row it finds: both succeed.
    const lost = (results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined)?.reason as AsasError | undefined
    if (lost) {
      assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
      assert.equal(lost.status, 409)
      assert.equal(lost.key, 'error.conflict.unique')
      assert.doesNotMatch(lost.message, /org3/)
    }
    const rows = await store.find({ kayan: 'prefs', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { firmId: { equals: 'org3' } } } })
    assert.equal(rows.totalDocs, 1)
    assert.ok(['first', 'second'].includes((await prefs.findOne({}, { actor: racer })).theme))
  })

  if (postgres) test('a local account is no organization\'s member, so a tenant-owned kayan refuses it', async () => {
    const response = await built.handler(new Request('http://test/api/auth/local/first-register', { method: 'POST', body: JSON.stringify({ email: 'local@example.com', password: 'a-long-enough-password' }) }))
    assert.equal(response.status, 201)
    const actor = await built.auth.actor(new Headers({ cookie: (response.headers.get('set-cookie') ?? '').split(';')[0]! }))
    assert.ok(actor, 'the account signed in')
    for (const call of [() => memos().find({}, { actor }), () => memos().create({ title: 'local' }, { actor })]) {
      assert.equal((await refusal(call())).status, 403)
    }
  })

  test('a unique field is unique within one organization: another organization holds the same value, and a second in the same one is a 409 naming no value', async () => {
    const badges = built.kayan.badges.operations
    const first = await badges.create({ code: 'B-1', title: 'first' }, { actor: one })
    assert.equal((await badges.create({ code: 'B-1', title: 'first' }, { actor: two })).firmId, 'org2', 'another organization is never told the value is taken')
    for (const call of [() => badges.create({ code: 'B-1', title: 'second' }, { actor: one }), () => badges.create({ code: 'B-2', title: 'first' }, { actor: one })]) {
      const twice = await refusal(call())
      assert.equal(twice.status, 409)
      assert.equal(twice.key, 'error.conflict.unique')
      assert.deepEqual(twice.params, { kayan: 'badges' })
      assert.doesNotMatch(`${twice.message} ${JSON.stringify(twice.params)}`, /B-1|B-2|first|second|org1/)
    }
    const other = await badges.create({ code: 'B-3', title: 'third' }, { actor: one })
    assert.equal((await refusal(badges.update({ id: other.id, code: 'B-1' }, { actor: one }))).key, 'error.conflict.unique', 'an update into a held value is refused too')
    assert.equal((await badges.findByID({ id: first.id }, { actor: one })).code, 'B-1')
    assert.equal((await badges.count({ where: { code: { equals: 'B-1' } } }, { actor: one })).totalDocs, 1)
  })

  test('a group within the tenant field is unique within one organization, a 409 naming no value, and a plain unique entry beside it is one across every organization', async () => {
    const terms = built.kayan.terms.operations
    await terms.create({ code: 'C-1', term: 'fall', ref: 'R-1' }, { actor: one })
    assert.equal((await terms.create({ code: 'C-1', term: 'fall', ref: 'R-2' }, { actor: two })).firmId, 'org2', 'another organization holds the same pair')
    await terms.create({ code: 'C-1', term: 'spring', ref: 'R-3' }, { actor: one })
    const twice = await refusal(terms.create({ code: 'C-1', term: 'fall', ref: 'R-4' }, { actor: one }))
    assert.equal(twice.status, 409)
    assert.equal(twice.key, 'error.conflict.unique')
    assert.deepEqual(twice.params, { kayan: 'terms' })
    assert.doesNotMatch(twice.message, /C-1|fall/)
    const global = await refusal(terms.create({ code: 'C-2', term: 'fall', ref: 'R-1' }, { actor: two }))
    assert.equal(global.status, 409)
    assert.deepEqual(global.params, { kayan: 'terms' })
  })

  test('a file key stays unique across organizations: it is the address of one object in one shared store', async () => {
    const row = (firmId: string) => ({ id: crypto.randomUUID(), firmId, key: 'app/shared.png', filename: 'shared.png', mimeType: 'image/png', filesize: 1, storage: 'local', createdAt: new Date(), updatedAt: new Date() })
    await store.transaction((tx) => store.insert({ tx, kayan: 'files', data: row('org1') }))
    await assert.rejects(store.transaction((tx) => store.insert({ tx, kayan: 'files', data: row('org2') })), (thrown: AsasError) => thrown.key === 'error.conflict.unique')
  })

  test('a kayan that filters the default out and names a global index is unique across organizations, and a shared kayan\'s unique field stays one across the table', async () => {
    await built.kayan.serials.operations.create({ code: 'S-1', title: 's' }, { actor: one })
    assert.equal((await refusal(built.kayan.serials.operations.create({ code: 'S-1', title: 's' }, { actor: two }))).key, 'error.conflict.unique')
    await built.kayan.stamps.operations.create({ code: 'T-1' }, { actor: one })
    assert.equal((await refusal(built.kayan.stamps.operations.create({ code: 'T-1' }, { actor: two }))).key, 'error.conflict.unique')
  })

  test('the HTTP read route takes ?tenant= on both plugs, and a write route refuses it', async () => {
    const actor = await actorOf({ active: 'org1', orgs: { org1: ['editor'], org2: ['reader'] } })
    for (const plug of [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })(built.operations as never), orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })(built.operations as never)]) {
      const call = async (path: string, body: unknown) => {
        const response = (await plug.handle(new Request(`http://test/api/memos/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), async () => actor))!
        return { status: response.status, body: (await response.json()) as { docs?: { firmId: string }[] } }
      }
      const active = await call('find', { limit: 100 })
      assert.equal(active.status, 200)
      assert.deepEqual([...new Set(active.body.docs!.map((row) => row.firmId))], ['org1'])
      const mine = await call('find?tenant=mine', { limit: 100 })
      assert.deepEqual([...new Set(mine.body.docs!.map((row) => row.firmId))].sort(), ['org1', 'org2'])
      assert.equal((await call('find?tenant=all', {})).status, 403)
      assert.equal((await call('create?tenant=mine', { title: 'served' })).status, 400)
    }
  })

  // A write holds a row it names against the row's delete alone, as a Postgres foreign key does, so
  // another transaction changing that row's other columns passes it, and the two cannot deadlock.
  if (postgres) test('a write naming a row and another transaction changing that row and one the write changes next both commit, with no deadlock', { timeout: 10_000 }, async () => {
    const a = await memos().create({ title: 'a' }, { actor: one })
    const b = await memos().create({ title: 'b' }, { actor: one })
    const held = hold()
    Object.assign(aimed, { kayan: 'memos', id: b.id, data: { title: 'b by the write' } })
    const holdsB = Promise.withResolvers<void>()
    const beside = store.transaction(async (tx) => {
      await store.update({ tx, kayan: 'memos', id: b.id, data: { title: 'b beside' } })
      holdsB.resolve()
      try {
        // The write has named a and goes on to b, which waits on this transaction, which now changes a.
        await within(held.reached.promise)
        held.release.resolve()
        await store.update({ tx, kayan: 'memos', id: a.id, data: { title: 'a beside' } })
      } finally {
        held.release.resolve()
      }
    })
    void beside.catch(() => {})
    let writing: Promise<any> | undefined
    let outcomes: PromiseSettledResult<unknown>[]
    try {
      await within(holdsB.promise)
      writing = built.kayan.notes.operations.heldLink(note({ title: 'between', memo: a.id }), { actor: one })
      void writing.catch(() => {})
      outcomes = await within(Promise.allSettled([beside, writing]), 5000)
    } finally {
      holdsB.resolve()
      held.reached.resolve()
      held.release.resolve()
      await within(Promise.allSettled([beside, ...(writing ? [writing] : [])]), 5000)
    }
    assert.deepEqual(outcomes.map((outcome) => (outcome.status === 'rejected' ? String(outcome.reason) : outcome.status)), ['fulfilled', 'fulfilled'])
    assert.equal((await memos().findByID({ id: a.id }, { actor: one })).title, 'a beside')
    assert.equal((await memos().findByID({ id: b.id }, { actor: one })).title, 'b by the write')
    assert.equal((await writing).memo, a.id)
  })

  if (postgres) test('a delete waits for a draft holding its row first and refuses to leave a reference to a deleted row', { timeout: 10_000 }, async () => {
    const papers = built.kayan.papers.operations
    const paper = await papers.create({ title: 'held', memo: ids.org1, _status: 'published' }, { actor: one })
    // A draft, which no foreign key holds: the row's lock is all that keeps the delete from passing it.
    const first = await memos().create({ title: 'named first' }, { actor: one })
    const drafted = hold()
    const drafting = papers.heldDraft({ id: paper.id, memo: first.id }, { actor: one, draft: true })
    void drafting.catch(() => {})
    let deleting: Promise<AsasError> | undefined
    try {
      await within(drafted.reached.promise)
      deleting = refusal(memos().delete({ id: first.id }, { actor: one }))
      void deleting.catch(() => {})
      assert.equal(await blocked(), 'waited')
    } finally {
      drafted.release.resolve()
      await within(Promise.allSettled([drafting, ...(deleting ? [deleting] : [])]), 5000)
    }
    const referenced = await deleting!
    assert.equal(referenced.status, 409)
    assert.equal(referenced.key, 'error.conflict.referenced')
    assert.equal((await memos().findByID({ id: first.id }, { actor: one })).title, 'named first', 'the row the draft names stays')
  })

  if (postgres) test('a draft waits for a delete holding its row first and refuses to name the deleted row', { timeout: 10_000 }, async () => {
    const papers = built.kayan.papers.operations
    const paper = await papers.create({ title: 'held', memo: ids.org1, _status: 'published' }, { actor: one })
    const second = await memos().create({ title: 'deleted first' }, { actor: one })
    const deleted = hold()
    const removing = memos().heldDelete({ id: second.id }, { actor: one })
    void removing.catch(() => {})
    let naming: Promise<AsasError> | undefined
    try {
      await within(deleted.reached.promise)
      naming = refusal(papers.update({ id: paper.id, memo: second.id }, { actor: one, draft: true }))
      void naming.catch(() => {})
      assert.equal(await blocked(), 'waited')
    } finally {
      deleted.release.resolve()
      await within(Promise.allSettled([removing, ...(naming ? [naming] : [])]), 5000)
    }
    const late = await naming!
    assert.equal(late.status, 400)
    assert.equal(late.key, 'error.invalid.tenant_reference')
    const versions = await store.find({ kayan: '_papers_versions', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { 'version.memo': { equals: second.id } } } })
    assert.equal(versions.totalDocs, 0, 'and no version names the deleted row')
  })

  if (postgres) test('an update step removing its own row waits for a held draft before counting references and refuses the delete', { timeout: 10_000 }, async () => {
    const memo = await memos().create({ title: 'kept for the draft' }, { actor: one })
    const papers = built.kayan.papers.operations
    const paper = await papers.create({ title: 'published', memo: null, _status: 'published' }, { actor: one })
    const removing = { ...hold() }
    const erased = memos().heldErase({ id: memo.id, title: 'changed before removing' }, { actor: one })
    const outcome = erased.then(() => undefined, (error: unknown) => error)
    let drafted: Promise<unknown> | undefined
    let drafting: Required<typeof gate> | undefined
    try {
      await within(removing.reached.promise)
      drafting = { ...hold() }
      drafted = papers.heldDraft({ id: paper.id, memo: memo.id }, { actor: one, draft: true })
      void drafted.catch(() => {})
      assert.equal(await Promise.race([drafting.reached.promise.then(() => 'reached'), blocked()]), 'reached', 'a draft passes the update holding its own row')
      removing.release.resolve()
      assert.equal(await blocked(), 'waited', 'the erase waits before counting references')
    } finally {
      removing.release.resolve()
      drafting?.release.resolve()
      await within(Promise.allSettled([erased, ...(drafted ? [drafted] : [])]), 5000)
    }
    const error = await outcome
    assert.ok(error instanceof AsasError, `the delete is refused: ${String(error)}`)
    assert.equal(error.key, 'error.conflict.referenced')
    assert.equal((await memos().findByID({ id: memo.id }, { actor: one })).title, 'kept for the draft')
    const latest = await papers.findVersions({ where: { parent: { equals: paper.id } }, limit: 1, sort: '-createdAt' }, { actor: one })
    assert.equal(latest.docs[0].version.memo, memo.id)
  })

  if (postgres) test('another organization holding its rows locked never holds up a write: one naming its memo is refused at once as an absent id is, and one naming a shared tag it is changing commits', { timeout: 10_000 }, async () => {
    const notes = built.kayan.notes.operations
    const tag = await raw('tags', { label: 'shared', open: true })
    const holding = Promise.withResolvers<void>()
    const done = Promise.withResolvers<void>()
    const theirs = store.transaction(async (tx) => {
      await store.find({ kayan: 'memos', args: { limit: 1, page: 1, lock: 'update', sort: { field: 'id', direction: 'asc' }, where: { id: { equals: ids.org2 } } }, tx })
      await store.update({ tx, kayan: 'tags', id: tag.id, data: { label: 'relabelled' } })
      holding.resolve()
      try { await within(done.promise, 5000) } finally { done.resolve() }
    })
    void theirs.catch(() => {})
    // Each call answers while the other organization still holds its rows, or is caught waiting.
    const calls: Promise<unknown>[] = []
    const atOnce = (call: Promise<unknown>) => Promise.race([calls[calls.push(call.then((row) => row, (error: unknown) => error)) - 1], setTimeout(2000, 'waited')])
    try {
      await within(holding.promise)
      const refused = await atOnce(notes.create(note({ title: 'reach', memo: ids.org2 }), { actor: one }))
      assert.ok(refused instanceof AsasError, `the reference is refused at once: ${String(refused)}`)
      assert.deepEqual(told(refused), told(await refusal(notes.create(note({ title: 'reach', memo: absent }), { actor: one }))))
      const tagged = await atOnce(notes.create(note({ title: 'tagged', tag: tag.id }), { actor: one }))
      assert.equal((tagged as { tag?: unknown }).tag, tag.id, `the shared tag is named at once: ${String(tagged)}`)
    } finally {
      done.resolve()
      await within(Promise.allSettled([theirs, ...calls]), 5000)
    }
    await theirs
  })

  if (postgres) test('another organization holding its row FOR UPDATE never holds up single or bulk updates and deletes outside its scope', { timeout: 10_000 }, async () => {
    const holding = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const theirs = store.transaction(async (tx) => {
      await store.find({ kayan: 'memos', args: { limit: 1, page: 1, lock: 'update', sort: { field: 'id', direction: 'asc' }, where: { id: { equals: ids.org2 } } }, tx })
      holding.resolve()
      try { await within(release.promise, 5000) } finally { release.resolve() }
    })
    void theirs.catch(() => {})
    const calls: Promise<unknown>[] = []
    const atOnce = (call: Promise<unknown>) => {
      const answered = call.then((answer) => answer, (error: unknown) => error)
      calls.push(answered)
      return Promise.race([answered, setTimeout(2000, 'waited')])
    }
    try {
      await within(holding.promise)
      for (const operation of ['update', 'delete'] as const) {
        const answer = await atOnce(memos()[operation]({ id: ids.org2, ...(operation === 'update' && { title: 'outside scope' }) }, { actor: one }))
        assert.ok(answer instanceof AsasError, `${operation} answers at once: ${String(answer)}`)
        assert.equal(answer.key, 'error.not_found.row')
        assert.equal(answer.status, 404)
      }
      for (const operation of ['updateMany', 'deleteMany'] as const) {
        const answer = await atOnce(memos()[operation]({ where: { id: { equals: ids.org2 } }, ...(operation === 'updateMany' && { data: { title: 'outside scope' } }) }, { actor: one }))
        assert.deepEqual(answer, { docs: [], errors: [] }, `${operation} changes nothing at once`)
      }
      assert.equal((await memos().findByID({ id: ids.org2 }, { actor: two })).title, 'two')
    } finally {
      release.resolve()
      await within(Promise.allSettled([theirs, ...calls]), 5000)
    }
    await theirs
  })

  // An update holds its own row FOR NO KEY UPDATE, as Postgres's own UPDATE of its other columns does,
  // which a write naming that row passes FOR KEY SHARE, so two edits each naming the other's row cannot deadlock.
  if (postgres) test('two updates, each naming the row the other changes, both commit with no deadlock', { timeout: 10_000 }, async () => {
    const notes = built.kayan.notes.operations
    const c = await notes.create(note({ title: 'c' }), { actor: one })
    const v = await notes.create(note({ title: 'v' }), { actor: one })
    // Each stops holding its own row; let go together, each then names the row the other holds.
    const first = { ...hold() }
    const editingC = notes.heldEdit({ id: c.id, title: 'c edited', reply: v.id }, { actor: one })
    void editingC.catch(() => {})
    let second: Required<typeof gate> | undefined
    let editingV: Promise<unknown> | undefined
    let outcomes: PromiseSettledResult<unknown>[] = []
    try {
      await within(first.reached.promise)
      second = { ...hold() }
      editingV = notes.heldEdit({ id: v.id, title: 'v edited', reply: c.id }, { actor: one })
      void editingV.catch(() => {})
      await within(second.reached.promise)
    } finally {
      first.release.resolve()
      second?.release.resolve()
      outcomes = await within(Promise.allSettled([editingC, ...(editingV ? [editingV] : [])]), 5000)
    }
    assert.deepEqual(outcomes.map((outcome) => (outcome.status === 'rejected' ? String(outcome.reason) : outcome.status)), ['fulfilled', 'fulfilled'])
    assert.equal((await notes.findByID({ id: c.id }, { actor: one })).reply, v.id)
    assert.equal((await notes.findByID({ id: v.id }, { actor: one })).reply, c.id)
  })

  if (postgres) test('a bulk update holding the rows it changed never holds up a write naming one of them', { timeout: 10_000 }, async () => {
    const swept = await memos().create({ title: 'swept' }, { actor: one })
    const held = hold()
    const sweeping = memos().heldSweep({ where: { id: { equals: swept.id } }, data: { title: 'swept again' } }, { actor: one })
    void sweeping.catch(() => {})
    let naming: Promise<any> | undefined
    try {
      await within(held.reached.promise)
      naming = built.kayan.notes.operations.create(note({ title: 'names the swept memo', memo: swept.id }), { actor: one })
      void naming.catch(() => {})
      const named = await Promise.race([naming, setTimeout(2000, 'waited')])
      assert.equal((named as { memo?: unknown }).memo, swept.id, `the write commits while the bulk holds its rows: ${String(named)}`)
    } finally {
      held.release.resolve()
      await within(Promise.allSettled([sweeping, ...(naming ? [naming] : [])]), 5000)
    }
    await sweeping
  })

  // No key update conflicts with itself, so a second update waits for the first to commit before it
  // loads the row, and then compares the instant the first wrote.
  if (postgres) test('an update holds its row against a second update until it commits, so expectedUpdatedAt refuses the second, which read the same instant', { timeout: 10_000 }, async () => {
    const notes = built.kayan.notes.operations
    const read = await notes.create(note({ title: 'read once' }), { actor: one })
    await setTimeout(5)
    const held = hold()
    const first = notes.heldStale({ id: read.id, title: 'first', expectedUpdatedAt: read.updatedAt }, { actor: one })
    void first.catch(() => {})
    let second: Promise<unknown> | undefined
    try {
      await within(held.reached.promise)
      assert.equal(await takes('notes', read.id, 'noKeyUpdate'), 'waited', 'another update waits on the row')
      second = notes.heldStale({ id: read.id, title: 'second', expectedUpdatedAt: read.updatedAt }, { actor: one })
    } finally {
      held.release.resolve()
      await within(Promise.allSettled([first, ...(second ? [second] : [])]), 5000)
    }
    assert.equal((await first).title, 'first')
    const stale = await refusal(second!)
    assert.equal(stale.status, 409)
    assert.equal(stale.key, 'error.conflict.stale')
  })

  // Postgres raises an UPDATE to FOR UPDATE only when the unique value differs, which the load cannot know
  // yet, so the runner takes FOR UPDATE for any update naming a unique column, the value kept or not.
  if (postgres) test('an update naming a unique column holds its row against a write naming it, whether or not it changes the value', { timeout: 10_000 }, async () => {
    const stamps = built.kayan.stamps.operations
    const stamp = await stamps.create({ code: 'locked-key' }, { actor: one })
    for (const [code, answer] of [['locked-key', 'waited'], ['changed-key', 'waited']] as const) {
      const held = hold()
      const editing = stamps.heldEdit({ id: stamp.id, code }, { actor: one })
      void editing.catch(() => {})
      try {
        await within(held.reached.promise)
        assert.equal(await takes('stamps', stamp.id, 'keyShare'), answer, `code ${code}`)
      } finally {
        held.release.resolve()
        await within(editing, 5000)
      }
    }
  })

  // A held update changing the row's unique code, and a transaction that names the row, as a reference
  // check does, then changes its other columns. Were the update to load the row FOR NO KEY UPDATE, its
  // UPDATE would raise that to FOR UPDATE past the other's key share while the other waits on it.
  if (postgres) test('an update changing a unique column and a write naming its row and then changing it both commit, with no deadlock', { timeout: 10_000 }, async () => {
    const stamps = built.kayan.stamps.operations
    const stamp = await stamps.create({ code: 'before recode' }, { actor: one })
    const held = hold()
    const recoding = stamps.heldRecode({ id: stamp.id, code: 'after recode' }, { actor: one })
    void recoding.catch(() => {})
    let naming: Promise<unknown> | undefined
    let outcomes: PromiseSettledResult<unknown>[] = []
    try {
      await within(held.reached.promise)
      naming = store.transaction(async (tx) => {
        await store.find({ kayan: 'stamps', args: { limit: 1, page: 1, lock: 'keyShare', sort: { field: 'id', direction: 'asc' }, where: { id: { equals: stamp.id } } }, tx })
        await store.update({ tx, kayan: 'stamps', id: stamp.id, data: { updatedAt: new Date() } })
      })
      void naming.catch(() => {})
      assert.equal(await blocked(), 'waited')
    } finally {
      held.release.resolve()
      outcomes = await within(Promise.allSettled([recoding, ...(naming ? [naming] : [])]), 5000)
    }
    assert.deepEqual(outcomes.map((outcome) => (outcome.status === 'rejected' ? String(outcome.reason?.cause?.code ?? outcome.reason) : outcome.status)), ['fulfilled', 'fulfilled'])
    assert.equal((await stamps.findByID({ id: stamp.id }, { actor: one })).code, 'after recode')
  })

  // A store update naming only a set changes no column of the row, so the store locks the row in its
  // place; under an update's own FOR NO KEY UPDATE, a raise there past a key share would deadlock.
  if (postgres) test('a store update naming only a set and a write naming its row and then changing it both commit, with no deadlock', { timeout: 10_000 }, async () => {
    const notes = built.kayan.notes.operations
    const listed = await notes.create(note({ title: 'sets only' }), { actor: one })
    const held = hold()
    const listing = store.transaction(async (tx) => {
      await store.find({ kayan: 'notes', args: { limit: 1, page: 1, lock: 'noKeyUpdate', sort: { field: 'id', direction: 'asc' }, where: { id: { equals: listed.id } } }, tx })
      await pause(undefined)
      await store.update({ tx, kayan: 'notes', id: listed.id, data: { memoSet: [ids.org1] } })
    })
    void listing.catch(() => {})
    let naming: Promise<unknown> | undefined
    let outcomes: PromiseSettledResult<unknown>[] = []
    try {
      await within(held.reached.promise)
      naming = store.transaction(async (tx) => {
        await store.find({ kayan: 'notes', args: { limit: 1, page: 1, lock: 'keyShare', sort: { field: 'id', direction: 'asc' }, where: { id: { equals: listed.id } } }, tx })
        await store.update({ tx, kayan: 'notes', id: listed.id, data: { title: 'beside the set' } })
      })
      void naming.catch(() => {})
      assert.equal(await blocked(), 'waited')
    } finally {
      held.release.resolve()
      outcomes = await within(Promise.allSettled([listing, ...(naming ? [naming] : [])]), 5000)
    }
    assert.deepEqual(outcomes.map((outcome) => (outcome.status === 'rejected' ? String(outcome.reason?.cause?.code ?? outcome.reason) : outcome.status)), ['fulfilled', 'fulfilled'])
    assert.deepEqual((await notes.findByID({ id: listed.id }, { actor: one })).memoSet, [ids.org1])
  })

  // A soft delete only sets its mark, as an UPDATE of a non-key column does, so it holds its row FOR NO
  // KEY UPDATE: a write naming the row passes it rather than waiting while the delete waits on that write.
  if (postgres) test('a held soft delete and a write naming its row both commit, with no deadlock, and once the delete commits a write naming the row is refused as an absent id is', { timeout: 10_000 }, async () => {
    const shelves = built.kayan.shelves.operations
    const shelved = await shelves.create({ title: 'shelved', next: null }, { actor: one })
    const beside = await shelves.create({ title: 'beside', next: null }, { actor: one })
    Object.assign(aimed, { kayan: 'shelves', id: beside.id, data: { title: 'beside again' } })
    const held = hold()
    const shelving = shelves.heldShelve({ id: shelved.id }, { actor: one })
    void shelving.catch(() => {})
    let naming: Promise<unknown> | undefined
    let outcomes: PromiseSettledResult<unknown>[] = []
    try {
      await within(held.reached.promise)
      naming = shelves.link({ title: 'names the shelved', next: shelved.id }, { actor: one })
      void naming.catch(() => {})
      await within(Promise.race([naming, blocked()]))
    } finally {
      held.release.resolve()
      outcomes = await within(Promise.allSettled([shelving, ...(naming ? [naming] : [])]), 5000)
    }
    assert.deepEqual(outcomes.map((outcome) => (outcome.status === 'rejected' ? String(outcome.reason?.cause?.code ?? outcome.reason) : outcome.status)), ['fulfilled', 'fulfilled'])
    assert.equal((await refusal(shelves.findByID({ id: shelved.id }, { actor: one }))).status, 404, 'the row is marked')
    const late = await refusal(shelves.create({ title: 'too late', next: shelved.id }, { actor: one }))
    assert.deepEqual(told(late), told(await refusal(shelves.create({ title: 'too late', next: absent }, { actor: one }))))
  })

  if (postgres) test('a bulk soft delete holding the rows it marked never holds up a write naming one of them', { timeout: 10_000 }, async () => {
    const shelves = built.kayan.shelves.operations
    const cleared = await shelves.create({ title: 'cleared', next: null }, { actor: one })
    const held = hold()
    const clearing = shelves.heldClear({ where: { id: { equals: cleared.id } } }, { actor: one })
    void clearing.catch(() => {})
    let naming: Promise<any> | undefined
    try {
      await within(held.reached.promise)
      naming = shelves.create({ title: 'names the cleared', next: cleared.id }, { actor: one })
      const named = await Promise.race([naming, setTimeout(2000, 'waited')])
      assert.equal((named as { next?: unknown }).next, cleared.id, `the write commits while the bulk holds its rows: ${String(named)}`)
    } finally {
      held.release.resolve()
      await within(Promise.allSettled([clearing, ...(naming ? [naming] : [])]), 5000)
    }
    await clearing
  })
  test('a step finds only its active organization, even with an opposing filter, and reads shared rows past their access', async () => {
    const tag = await store.transaction((tx) => store.insert({ tx, kayan: 'tags', data: { label: 'private shared', open: false } }))
    storeProbe = async (ctx, tools) => {
      const args = { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' as const } }
      const own = await tools.store.find({ tx: ctx.tx, kayan: declaration(built, 'memos'), args })
      assert.ok(own.docs.length)
      assert.ok(own.docs.every((row) => row.firmId === 'org1'))
      const other = await tools.store.find({ tx: ctx.tx, kayan: declaration(built, 'memos'), args: { ...args, where: { firmId: { equals: 'org2' } } } })
      assert.deepEqual(other, { docs: [], totalDocs: 0 })
      const shared = await tools.store.find({ tx: ctx.tx, kayan: declaration(built, 'tags'), args: { ...args, where: { id: { equals: tag.id as string } } } })
      assert.equal(shared.docs[0]?.label, 'private shared')
    }
    try {
      await memos().probe({ title: 'store find' }, { actor: one })
      await memos().probeEdit({ id: ids.org1, title: 'one' }, { actor: one })
      await memos().probeBulk({ where: { id: { equals: ids.org1 } }, data: { title: 'one' } }, { actor: one })
    } finally { storeProbe = async () => {} }
  })

  test('a step find with a lock requires a transaction on every store', { timeout: 10_000 }, async () => {
    storeProbe = async (_ctx, tools) => {
      await assert.rejects(tools.store.find({ kayan: declaration(built, 'memos'), args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock: 'share' } }), /Holding rows requires a transaction/)
    }
    try { await memos().probe({ title: 'lock without transaction' }, { actor: one }) } finally { storeProbe = async () => {} }
  })

  test('a step hold refuses an invalid mode with 400', { timeout: 10_000 }, async () => {
    storeProbe = async (ctx, tools) => { await tools.store.hold({ tx: ctx.tx, kayan: declaration(built, 'memos'), ids: [ids.org1], mode: 'bad' as 'share' }) }
    try { assert.equal((await refusal(memos().probe({ title: 'invalid hold' }, { actor: one }))).status, 400) } finally { storeProbe = async () => {} }
  })

  test('a step holds duplicate own and shared ids, and refuses foreign ids exactly like missing ones', async () => {
    const tag = await store.transaction((tx) => store.insert({ tx, kayan: 'tags', data: { label: 'shared hold', open: false } }))
    storeProbe = async (ctx, tools) => {
      await tools.store.hold({ tx: ctx.tx, kayan: declaration(built, 'memos'), ids: [ids.org1.toUpperCase(), ids.org1], mode: 'noKeyUpdate' })
      await tools.store.hold({ tx: ctx.tx, kayan: declaration(built, 'tags'), ids: [tag.id, tag.id], mode: 'share' })
      await tools.store.hold({ tx: ctx.tx, kayan: declaration(built, 'memos'), ids: [], mode: 'update' })
      assert.equal((await refusal(tools.store.hold({ tx: ctx.tx, kayan: declaration(built, 'tags'), ids: [randomUUID()], mode: 'share' }))).status, 404)
      const errors = []
      for (const id of [ids.org2, randomUUID()]) errors.push(await refusal(tools.store.hold({ tx: ctx.tx, kayan: declaration(built, 'memos'), ids: [id], mode: 'update' })))
      assert.equal(errors[0]!.status, 404)
      assert.deepEqual([errors[0]!.key, errors[0]!.message], [errors[1]!.key, errors[1]!.message])
      await assert.rejects(tools.store.hold({ tx: undefined, kayan: declaration(built, 'tags'), ids: [], mode: 'share' }), /transaction/)
    }
    try {
      await memos().probe({ title: 'store hold' }, { actor: one })
      await memos().probeEdit({ id: ids.org1, title: 'one' }, { actor: one })
      await memos().probeBulk({ where: { id: { equals: ids.org1 } }, data: { title: 'one' } }, { actor: one })
    } finally { storeProbe = async () => {} }
  })

  if (postgres) for (const method of ['update', 'upsert'] as const) for (const kayan of ['memos', 'tags'] as const) test(`two step ${method} increments of ${kayan} both land and return their new row`, { timeout: 10_000 }, async () => {
    const row = method === 'update' ? await store.transaction((tx) => store.insert({ tx, kayan, data: kayan === 'memos' ? { firmId: 'org1', title: 'initial', balance: 10 } : { label: 'initial', balance: 10 } })) : { id: undefined }
    const reached = Promise.withResolvers<number>()
    const release = Promise.withResolvers<void>()
    const balances: number[] = []
    storeProbe = async (ctx, tools) => {
      const amount = Number(ctx.data.title)
      const data = { balance: { $inc: amount }, [kayan === 'memos' ? 'title' : 'label']: 'incremented' }
      const updated = method === 'update' ? await tools.store.update({ tx: ctx.tx, kayan: declaration(built, kayan), id: row.id, data }) : await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, kayan), on: kayan === 'memos' ? ['firmId', 'code'] : ['code'], data: { ...data, code: 'concurrent-upsert' } })
      row.id = updated.id
      balances.push(updated.balance as number)
      if (amount === 3) {
        try {
          reached.resolve((await (ctx.tx as { execute(query: string): Promise<{ rows: { pid: number }[] }> }).execute('select pg_backend_pid() as pid')).rows[0]!.pid)
          await within(release.promise, 5000)
        } finally { release.resolve() }
      }
    }
    const first = memos().probe({ title: '3' }, { actor: one })
    void first.catch(() => {})
    let second: Promise<unknown> | undefined
    try {
      const holder = await within(reached.promise)
      second = memos().probe({ title: '7' }, { actor: one })
      void second.catch(() => {})
      assert.equal(await Promise.race([second.then(() => 'answered'), waitForLock({ db: built.targets.store.db, where: `pg_blocking_pids(pid) @> array[${holder}]` })]), 'waited')
    } finally {
      release.resolve()
      await within(Promise.allSettled([first, ...(second ? [second] : [])]), 5000)
      storeProbe = async () => {}
    }
    await first
    await second
    assert.deepEqual(balances, method === 'update' ? [13, 20] : [3, 10])
    const found = await store.find({ kayan, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { equals: row.id as string } } } })
    assert.equal(found.docs[0]?.balance, method === 'update' ? 20 : 10)
    assert.equal(found.docs[0]?.[kayan === 'memos' ? 'title' : 'label'], 'incremented')
  })

  if (postgres) test('step increments refuse unsafe amounts, non-integer fields and another organization', async () => {
    const row = await memos().create({ title: 'increment refusals' }, { actor: one })
    for (const data of [{ balance: { $inc: 1.5 } }, { balance: { $inc: Number.MAX_SAFE_INTEGER + 1 } }, { balance: { $inc: NaN } }, { balance: { $inc: Infinity } }, { balance: { $inc: '2' } }, { title: { $inc: 2 } }, { balance: { $inc: 1, extra: true } }]) {
      storeProbe = async (ctx, tools) => { await tools.store.update({ tx: ctx.tx, kayan: declaration(built, 'memos'), id: row.id, data }) }
      try {
        const error = await refusal(memos().probe({ title: 'invalid increment' }, { actor: one }))
        assert.equal(error.status, 400)
        assert.equal(error.key, 'error.invalid.value')
      } finally { storeProbe = async () => {} }
    }
    storeProbe = async (ctx, tools) => { await tools.store.update({ tx: ctx.tx, kayan: declaration(built, 'memos'), id: ids.org2, data: { balance: { $inc: 5 } } }) }
    try { await assert.rejects(memos().probe({ title: 'foreign increment' }, { actor: one })) } finally { storeProbe = async () => {} }
    assert.equal((await memos().findByID({ id: row.id }, { actor: one })).balance, 0)
    assert.equal((await memos().findByID({ id: ids.org2 }, { actor: two })).balance, 0)
  })

  if (postgres) for (const kayan of ['tags', 'firms', 'numbered'] as const) test(`hold sorts and deduplicates ${kayan} ids before waiting on a later row`, { timeout: 10_000 }, async () => {
    const ids = kayan === 'tags' ? ['00000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff'] : kayan === 'firms' ? ['a-hold', 'z-hold'] : [2, 10]
    await store.transaction(async (tx) => { for (const id of ids) await store.insert({ tx, kayan, data: { id, [kayan === 'tags' ? 'label' : 'name']: 'ordered' } }) })
    const reached = Promise.withResolvers<number>()
    const release = Promise.withResolvers<void>()
    const holding = store.transaction(async (tx) => {
      try {
        await store.find({ tx, kayan, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock: 'update', where: { id: { equals: ids[1]! } } } })
        reached.resolve((await (tx as { execute(query: string): Promise<{ rows: { pid: number }[] }> }).execute('select pg_backend_pid() as pid')).rows[0]!.pid)
        await within(release.promise, 5000)
      } finally { release.resolve() }
    })
    void holding.catch(() => {})
    const probePid = Promise.withResolvers<number>()
    storeProbe = async (ctx, tools) => {
      probePid.resolve((await (ctx.tx as { execute(query: string): Promise<{ rows: { pid: number }[] }> }).execute('select pg_backend_pid() as pid')).rows[0]!.pid)
      await tools.store.hold({ tx: ctx.tx, kayan: declaration(built, kayan), ids: [kayan === 'tags' ? String(ids[1]).toUpperCase() : ids[1], ids[0], ids[1]], mode: 'noKeyUpdate' })
    }
    let probing: Promise<unknown> | undefined
    let changing: Promise<unknown> | undefined
    try {
      const holder = await within(reached.promise)
      probing = memos().probe({ title: 'ordered hold' }, { actor: one })
      void probing.catch(() => {})
      const probe = await within(probePid.promise)
      assert.equal(await Promise.race([probing.then(() => 'answered'), waitForLock({ db: built.targets.store.db, where: `pid = ${probe} and pg_blocking_pids(pid) @> array[${holder}]` })]), 'waited')
      changing = store.transaction((tx) => store.update({ tx, kayan, id: ids[0], data: { [kayan === 'tags' ? 'label' : 'name']: 'changed after hold' } }))
      void changing.catch(() => {})
      assert.equal(await Promise.race([changing.then(() => 'answered'), waitForLock({ db: built.targets.store.db, where: `pg_blocking_pids(pid) @> array[${probe}]` })]), 'waited', 'the earlier id is already held despite the reversed input')
    } finally {
      release.resolve()
      await within(Promise.allSettled([holding, ...(probing ? [probing] : []), ...(changing ? [changing] : [])]), 5000)
      storeProbe = async () => {}
    }
    await holding
    await probing
    assert.equal((await changing as Record<string, unknown>)[kayan === 'tags' ? 'label' : 'name'], 'changed after hold')
  })

  for (const operation of ['outsideProbe', 'afterProbe'] as const) test(`step find, hold, sum and upsert are unavailable in ${operation}`, async () => {
    storeProbe = async (ctx, tools) => {
      assert.throws(() => tools.store.find({ tx: ctx.tx, kayan: declaration(built, 'memos'), args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' } } }), /outside.*transaction/)
      assert.throws(() => tools.store.hold({ tx: ctx.tx, kayan: declaration(built, 'memos'), ids: [ids.org1], mode: 'share' }), /outside.*transaction/)
      assert.throws(() => tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'memos'), on: ['firmId', 'code'], data: { code: 'outside' } }), /outside.*transaction/)
      assert.throws(() => tools.store.sum({ tx: ctx.tx, kayan: declaration(built, 'memos'), field: 'balance' }), /outside.*transaction/)
    }
    try { await memos()[operation]({ title: 'outside store' }, { actor: one }) } finally { storeProbe = async () => {} }
  })

  for (const kayan of ['memos', 'tags'] as const) test(`a step upserts ${kayan} by a declared unique key and adds in the database`, async () => {
    const on = kayan === 'memos' ? ['firmId', 'code'] : ['code']
    storeProbe = async (ctx, tools) => {
      const data = { code: 'upsert-paths', [kayan === 'memos' ? 'title' : 'label']: 'inserted', balance: { $inc: 2 } }
      const inserted = await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, kayan), on, data })
      assert.equal(inserted.balance, 2)
      if (kayan === 'memos') assert.equal(inserted.firmId, 'org1')
      const updated = await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, kayan), on, data: { ...data, id: randomUUID(), balance: { $inc: 3 }, [kayan === 'memos' ? 'title' : 'label']: 'updated' } })
      assert.equal(updated.id, inserted.id)
      assert.equal(updated.balance, 5)
      assert.equal(updated[kayan === 'memos' ? 'title' : 'label'], 'updated')
      const keyed = await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, kayan), on, data: { code: 'key-only' } })
      assert.equal((await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, kayan), on, data: { code: 'key-only' } })).id, keyed.id)
    }
    try { await memos().probe({ title: 'upsert paths' }, { actor: one }) } finally { storeProbe = async () => {} }
  })

  test('a step insert fills its organization, accepts its own and refuses another, while shared inserts stay shared', { timeout: 10_000 }, async () => {
    storeProbe = async (ctx, tools) => {
      for (const data of [{ title: 'insert filled' }, { title: 'insert explicit', firmId: 'org1' }]) assert.equal((await tools.store.insert({ tx: ctx.tx, kayan: declaration(built, 'opens'), data })).firmId, 'org1')
      const shared = await tools.store.insert({ tx: ctx.tx, kayan: declaration(built, 'tags'), data: { label: 'shared insert' } })
      assert.equal(shared.label, 'shared insert')
      assert.equal(Object.hasOwn(shared, 'firmId'), false)
    }
    try { await memos().probe({ title: 'insert probe' }, { actor: one }) } finally { storeProbe = async () => {} }
    storeProbe = async (ctx, tools) => { await tools.store.insert({ tx: ctx.tx, kayan: declaration(built, 'opens'), data: { title: 'insert foreign', firmId: 'org2' } }) }
    try { await assert.rejects(memos().probe({ title: 'insert refused' }, { actor: one }), /another organization/) } finally { storeProbe = async () => {} }
    assert.equal((await built.kayan.opens.operations.count({ where: { title: { equals: 'insert foreign' } } }, { actor: two })).totalDocs, 0)
  })

  test('a step upserts by id without an extra index and refuses another organization\'s id', { timeout: 10_000 }, async () => {
    storeProbe = async (ctx, tools) => {
      const kayan = declaration(built, 'memos')
      const data = { id: randomUUID(), title: 'id inserted' }
      assert.equal((await tools.store.upsert({ tx: ctx.tx, kayan, on: ['id'], data })).title, 'id inserted')
      const updated = await tools.store.upsert({ tx: ctx.tx, kayan, on: ['id'], data: { ...data, title: 'id updated' } })
      assert.equal(updated.id, data.id)
      assert.equal(updated.title, 'id updated')
    }
    try { await memos().probe({ title: 'id upsert' }, { actor: one }) } finally { storeProbe = async () => {} }
    const foreign = await memos().findByID({ id: ids.org2 }, { actor: two })
    storeProbe = async (ctx, tools) => { await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'memos'), on: ['id'], data: { id: ids.org2, title: 'stolen' } }) }
    try { assert.equal((await refusal(memos().probe({ title: 'foreign id' }, { actor: one }))).status, 404) } finally { storeProbe = async () => {} }
    assert.equal((await memos().findByID({ id: ids.org2 }, { actor: two })).title, foreign.title)
  })

  test('upsert refuses foreign tenants and undeclared unique keys without changing their rows', async () => {
    const foreign = await memos().create({ code: 'tenant-upsert', globalCode: 'global-upsert', title: 'foreign', balance: 40 }, { actor: two })
    storeProbe = async (ctx, tools) => {
      const own = await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'memos'), on: ['firmId', 'code'], data: { code: 'tenant-upsert', title: 'own', balance: { $inc: 2 } } })
      assert.notEqual(own.id, foreign.id)
      assert.equal(own.firmId, 'org1')
      const same = await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'memos'), on: ['code', 'firmId'], data: { firmId: 'org1', code: 'tenant-upsert', title: 'own updated' } })
      assert.equal(same.id, own.id)
    }
    try { await memos().probe({ title: 'tenant upsert' }, { actor: one }) } finally { storeProbe = async () => {} }
    for (const [on, data, status] of [
      [['firmId', 'code'], { firmId: 'org2', code: 'tenant-upsert', balance: { $inc: 1 } }, undefined],
      [['firmId', 'code'], { firmId: 'org2', code: 'fresh-foreign' }, undefined],
      [['globalCode'], { globalCode: 'global-upsert', title: 'stolen' }, 404],
      [['title'], { title: 'no unique key' }, 400],
      [[], { title: 'no key' }, 400],
      [['code', 'code'], { code: 'duplicate key' }, 400],
      [['firmId', 'code'], { code: { $inc: 1 } }, 400],
      [['firmId', 'code'], { title: 'missing key' }, 400],
      [['firmId', 'code'], { code: 'invalid increment', balance: { $inc: 0.5 } }, 400],
      [['firmId', 'code'], { code: 'wrong field', title: { $inc: 1 } }, 400],
    ] as const) {
      storeProbe = async (ctx, tools) => { await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'memos'), on, data }) }
      try {
        const error = await refusal(memos().probe({ title: 'refused upsert' }, { actor: one }))
        if (status) assert.equal(error.status, status, String(error))
      } finally { storeProbe = async () => {} }
    }
    assert.equal((await store.find({ kayan: 'memos', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { code: { equals: 'fresh-foreign' } } } })).totalDocs, 0)
    const kept = await memos().findByID({ id: foreign.id }, { actor: two })
    assert.equal(kept.balance, 40)
    assert.equal(kept.title, 'foreign')
  })

  test('a step upsert refuses an increment on an integer key field', { timeout: 10_000 }, async () => {
    storeProbe = async (ctx, tools) => { await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'numbered'), on: ['code'], data: { id: 99, name: 'key increment', code: { $inc: 1 } } }) }
    try {
      const error = await refusal(memos().probe({ title: 'integer key' }, { actor: one }))
      assert.equal(error.status, 400)
      assert.match(error.message, /plain key values/)
    } finally { storeProbe = async () => {} }
  })

  if (postgres) test('managed json values keep a $inc key on create and update', { timeout: 10_000 }, async () => {
    const row = await memos().create({ title: 'json increment key', meta: { $inc: 1 } }, { actor: one })
    assert.deepEqual(row.meta, { $inc: 1 })
    assert.deepEqual((await memos().update({ id: row.id, meta: { $inc: 1 } }, { actor: one })).meta, { $inc: 1 })
  })

  test('a draft json update keeps a $inc key and still refuses integer draft arithmetic', { timeout: 10_000 }, async () => {
    const papers = built.kayan.papers.operations
    const row = await papers.create({ title: 'draft json increment key', memo: null, meta: {}, _status: 'published' }, { actor: one })
    await papers.update({ id: row.id, meta: { $inc: 1 } }, { actor: one, draft: true })
    assert.deepEqual((await papers.findByID({ id: row.id }, { actor: one, draft: true })).meta, { $inc: 1 })
    assert.equal((await refusal(papers.draftBump({ id: row.id }, { actor: one, draft: true }))).status, 400)
  })

  if (!postgres) test('memory store json updates and upserts keep a $inc key', { timeout: 10_000 }, async () => {
    const row = await memos().create({ title: 'memory json increment key', meta: {} }, { actor: one })
    assert.deepEqual((await memos().update({ id: row.id, meta: { $inc: 1 } }, { actor: one })).meta, { $inc: 1 })
    storeProbe = async (ctx, tools) => {
      assert.deepEqual((await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'memos'), on: ['id'], data: { id: row.id, meta: { $inc: 1 } } })).meta, { $inc: 1 })
    }
    try { await memos().probe({ title: 'memory json upsert' }, { actor: one }) } finally { storeProbe = async () => {} }
  })

  if (postgres) test('an increment of the operation row keeps numeric versions and its pending draft, and refuses arithmetic in a draft snapshot', async () => {
    const papers = built.kayan.papers.operations
    const row = await papers.create({ title: 'published arithmetic', memo: null, balance: 10, _status: 'published' }, { actor: one })
    assert.equal((await papers.bump({ id: row.id }, { actor: one })).balance, 13)
    await papers.update({ id: row.id, title: 'pending arithmetic', balance: 30 }, { actor: one, draft: true })
    assert.equal((await papers.bump({ id: row.id }, { actor: one })).balance, 16)
    const latest = await papers.findVersions({ where: { parent: { equals: row.id } }, limit: 1, sort: '-createdAt' }, { actor: one })
    assert.equal(latest.docs[0].version.title, 'pending arithmetic')
    assert.equal(latest.docs[0].version.balance, 16)
    const refused = await refusal(papers.draftBump({ id: row.id }, { actor: one, draft: true }))
    assert.equal(refused.status, 400)
    assert.equal(refused.key, 'error.invalid.value')
    assert.equal((await papers.findByID({ id: row.id }, { actor: one })).balance, 16)
  })

  if (postgres) for (const kayan of ['memos', 'tags'] as const) test(`a step sums ${kayan} exactly and refuses a non-numeric field`, async () => {
    await store.transaction(async (tx) => {
      for (const quantity of ['0.1', '0.2']) await store.insert({ tx, kayan, data: { ...(kayan === 'memos' && { firmId: 'org1' }), code: `sum-${quantity}`, quantity, amount: quantity === '0.1' ? '9007199254740993.1' : '0.2', balance: 2 } })
      if (kayan === 'memos') await store.insert({ tx, kayan, data: { firmId: 'org2', code: 'sum-foreign', quantity: '100', balance: 100 } })
    })
    storeProbe = async (ctx, tools) => {
      const where = { code: { in: ['sum-0.1', 'sum-0.2', 'sum-foreign'] } }
      assert.equal(await tools.store.sum({ tx: ctx.tx, kayan: declaration(built, kayan), field: 'amount', where }), '9007199254740993.3')
      assert.equal(await tools.store.sum({ tx: ctx.tx, kayan: declaration(built, kayan), field: 'quantity', where }), '0.300')
      assert.equal(await tools.store.sum({ tx: ctx.tx, kayan: declaration(built, kayan), field: 'balance', where }), '4')
      assert.equal(await tools.store.sum({ tx: ctx.tx, kayan: declaration(built, kayan), field: 'quantity', where: { code: { equals: 'sum-empty' } } }), '0')
      if (kayan === 'memos') assert.equal(await tools.store.sum({ tx: ctx.tx, kayan: declaration(built, kayan), field: 'balance', where: { firmId: { equals: 'org2' } } }), '0')
      for (const field of [kayan === 'memos' ? 'title' : 'label', 'absent']) {
        const error = await refusal(tools.store.sum({ tx: ctx.tx, kayan: declaration(built, kayan), field }))
        assert.equal(error.status, 400)
        assert.equal(error.key, 'error.invalid.value')
      }
    }
    try { await memos().probe({ title: 'sum values' }, { actor: one }) } finally { storeProbe = async () => {} }
  })

  if (postgres) for (const state of ['40P01', '40001'] as const) for (const surface of ['local', 'fetch', 'openapi', 'rpc', 'storage', 'local-auth'] as const) test(`${surface} maps a forced ${state} to a retry conflict without leaking database errors`, { timeout: 20_000 }, async () => {
    const rows = await store.transaction(async (tx) => Promise.all([0, 1].map(() => store.insert({ tx, kayan: 'tags', data: { balance: 0 } }))))
    const reached = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const release = Promise.withResolvers<void>()
    const reports: unknown[] = []
    const work = async (tx: any, first: boolean) => {
      try {
        if (state === '40001') {
          await tx.setTransaction({ isolationLevel: 'serializable' })
          await store.find({ tx, kayan: 'tags', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { equals: rows[0]!.id as string } } } })
        } else await store.update({ tx, kayan: 'tags', id: rows[first ? 0 : 1]!.id, data: { balance: { $inc: 1 } } })
        reached[first ? 0 : 1]!.resolve()
        await within(release.promise, 5000)
        await store.update({ tx, kayan: 'tags', id: rows[state === '40001' || !first ? 0 : 1]!.id, data: { balance: { $inc: 1 } } })
      } finally { release.resolve() }
    }
    const raw = (first: boolean) => built.targets.store.db.transaction((tx: unknown) => work(tx, first))
    const table = [{ kayan: 'work', name: 'run', effect: 'create', single: false, input: z.object({ first: z.boolean() }), call: async ({ first }: { first: boolean }) => (await raw(first), {}) }]
    const plug = surface === 'fetch' ? fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: (error) => reports.push(error) })(table as never) : orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: (error) => reports.push(error) })(table as never)
    const files = storageRoutes({ kayan: [{ name: 'files', storage: { operation: 'create' } }] as never, config: { ...storageConfig, adapters: {}, serve: async ({ id }) => (await raw(id === 'first'), new Response('{}', { headers: { 'content-type': 'application/json' } })), onError: (error) => reports.push(error) }, read: async () => null, authorize: async () => undefined })
    localProbe = async (request) => (await raw(request.headers.get('x-first') === 'yes'), {})
    const call = async (first: boolean) => {
      if (surface === 'local') {
        storeProbe = async (ctx) => work(ctx.tx, ctx.data.title === 'first')
        return memos().probe({ title: first ? 'first' : 'second' }, { actor: one }).then(() => ({ status: 200, key: undefined }), (error: AsasError) => ({ status: error.status, key: error.key }))
      }
      const request = new Request(surface === 'storage' ? `http://test/api/files/file/${first ? 'first' : 'second'}` : surface === 'local-auth' ? 'http://test/api/auth/local/first-register' : `http://test/${surface === 'rpc' ? 'api/rpc' : 'api'}/work/run`, {
        method: surface === 'storage' ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-first': first ? 'yes' : 'no' },
        ...(surface !== 'storage' && { body: JSON.stringify(surface === 'local-auth' ? { email: `retry-${state}-${first}@test.com`, password: 'a-long-test-password' } : surface === 'rpc' ? { json: { first } } : { first }) }),
      })
      const response = (surface === 'storage' ? await files(request, async () => one) : surface === 'local-auth' ? await built.handler(request) : await plug.handle(request, async () => one))!
      const body = await response.json() as { json?: { data?: { key?: string } }; data?: { key?: string } }
      assert.doesNotMatch(JSON.stringify(body), /deadlock detected|could not serialize|tenant_scope_/)
      return { status: response.status, key: (body.json ?? body).data?.key }
    }
    const calls: Promise<{ status: number; key?: string }>[] = []
    let outcomes: PromiseSettledResult<{ status: number; key?: string }>[] = []
    try {
      calls.push(call(true), call(false))
      for (const promise of calls) void promise.catch(() => {})
      await within(Promise.all(reached.map((gate) => gate.promise)))
    } finally {
      release.resolve()
      outcomes = await within(Promise.allSettled(calls), 5000)
      localProbe = async () => ({})
      storeProbe = async () => {}
    }
    assert.ok(outcomes.every((one) => one.status === 'fulfilled'), String(outcomes.find((one) => one.status === 'rejected')?.reason))
    const answers = outcomes.map((one) => (one as PromiseFulfilledResult<{ status: number; key?: string }>).value)
    assert.equal(answers.filter((one) => one.status === 409 && one.key === 'error.conflict.retry').length, 1, JSON.stringify(answers))
    assert.ok(answers.every((one) => one.status !== 500), JSON.stringify(answers))
    assert.equal(reports.length, 0)
    const final = await store.find({ kayan: 'tags', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { in: rows.map((row) => row.id as string) } } } })
    assert.deepEqual(final.docs.map((row) => row.balance).sort(), state === '40P01' ? [1, 1] : [0, 1])
  })

  if (postgres) test('a versioned operation upserts a sibling with versions and keeps its references in the organization', async () => {
    const papers = built.kayan.papers.operations
    const id = randomUUID()
    storeProbe = async (ctx, tools) => {
      const data = { id, title: 'upserted sibling', memo: ids.org1, balance: { $inc: 2 }, _status: 'published' }
      assert.equal((await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'papers'), on: ['id'], data })).balance, 2)
      const refused = await refusal(tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'papers'), on: ['id'], data: { ...data, memo: ids.org2 } }))
      assert.equal(refused.key, 'error.invalid.tenant_reference')
      assert.equal((await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'papers'), on: ['id'], data: { ...data, balance: { $inc: 3 } } })).balance, 5)
    }
    try { await papers.probe({ title: 'upsert outer', memo: null }, { actor: one }) } finally { storeProbe = async () => {} }
    assert.equal((await papers.findByID({ id }, { actor: one })).balance, 5)
    const versions = await papers.findVersions({ where: { parent: { equals: id } }, limit: 10 }, { actor: one })
    assert.deepEqual(versions.docs.map((row: { version: { balance: number } }) => row.version.balance).sort(), [2, 5])
  })

  if (postgres) for (const kayan of ['memos', 'papers'] as const) test(`an upsert of the operation's own ${kayan} row keeps successive edits and numeric versions`, async () => {
    const operations = built.kayan[kayan].operations
    const row = await operations.create({ title: 'upsert own row', balance: 10, ...(kayan === 'memos' ? { code: 'upsert-own' } : { memo: null, _status: 'published' }) }, { actor: one })
    if (kayan === 'papers') await operations.update({ id: row.id, title: 'pending own row', balance: 30 }, { actor: one, draft: true })
    storeProbe = async (ctx, tools) => {
      ctx.data = await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, kayan), on: kayan === 'memos' ? ['firmId', 'code'] : ['id'], data: { ...(kayan === 'memos' ? { code: 'upsert-own' } : { id: row.id }), balance: { $inc: 3 } } })
    }
    try {
      const updated = await operations.probeAfterEdit({ id: row.id, title: 'edited own row' }, { actor: one })
      assert.equal(updated.balance, 13)
      assert.equal(updated.title, 'edited own row')
      if (kayan === 'papers') {
        const latest = await operations.findVersions({ where: { parent: { equals: row.id } }, limit: 1, sort: '-createdAt' }, { actor: one })
        assert.equal(latest.docs[0].version.balance, 13)
        assert.equal(latest.docs[0].version.title, 'edited own row')
        assert.equal((await refusal(operations.draftProbeAfterEdit({ id: row.id, title: 'refused draft' }, { actor: one, draft: true }))).key, 'error.invalid.value')
      }
    } finally { storeProbe = async () => {} }
    assert.equal((await operations.findByID({ id: row.id }, { actor: one })).balance, 13)
  })

  for (const method of ['insert', 'update', 'upsert'] as const) test(`a step ${method} refuses a field the kayan never declared`, async () => {
    storeProbe = async (ctx, tools) => {
      const data = { title: 'unknown field', baalance: 5, ...(method === 'insert' && { firmId: 'org1' }) }
      if (method === 'insert') await tools.store.insert({ tx: ctx.tx, kayan: declaration(built, 'memos'), data })
      else if (method === 'upsert') await tools.store.upsert({ tx: ctx.tx, kayan: declaration(built, 'memos'), on: ['firmId', 'code'], data: { ...data, code: 'unknown-field' } })
      else await tools.store.update({ tx: ctx.tx, kayan: declaration(built, 'memos'), id: ids.org1, data })
    }
    try {
      const error = await refusal(memos().probe({ title: 'unknown field guard' }, { actor: one }))
      assert.equal(error.status, 400)
      assert.equal(error.key, 'error.invalid.value')
    } finally { storeProbe = async () => {} }
  })

  test('step store filters, sort and conflict keys refuse undeclared fields and never trust a forged declaration', async () => {
    storeProbe = async (ctx, tools) => {
      const kayan = declaration(built, 'memos')
      const args = { tx: ctx.tx, kayan }
      const query = { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' as const } }
      const cases = [
        ['find', { ...args, args: { ...query, where: { baalance: { equals: 0 } } } }],
        ['find', { ...args, args: { ...query, where: { constructor: { equals: 0 } } } }],
        ['find', { ...args, args: { ...query, sort: { field: 'baalance', direction: 'asc' } } }],
        ['sum', { ...args, field: 'balance', where: { baalance: { equals: 0 } } }],
        ['update', { ...args, id: ids.org1, data: { title: 'wrong filter' }, where: { baalance: { equals: 0 } } }],
        ['remove', { ...args, id: ids.org1, where: { baalance: { equals: 0 } } }],
        ['upsert', { ...args, on: ['baalance'], data: { title: 'wrong key' } }],
        ['update', { ...args, kayan: { name: 'memos', fields: { baalance: { kind: 'integer' } } }, id: ids.org1, data: { baalance: 2 } }],
      ] as const
      for (const [word, input] of cases) {
        const error = await refusal((tools.store[word] as (args: unknown) => Promise<unknown>)(input))
        assert.equal(error.status, 400, word)
        assert.equal(error.key, 'error.invalid.value', word)
      }
      assert.throws(() => tools.store.find({ kayan: 'memos', args: query } as never), (error: unknown) => error instanceof AsasError && error.status === 400)
    }
    try { await memos().probe({ title: 'unknown query fields' }, { actor: one }) } finally { storeProbe = async () => {} }
  })

  if (postgres) test('the raw adapter refuses undeclared write and sort fields before a statement can change rows', async () => {
    for (const word of ['insert', 'update', 'upsert'] as const) {
      const error = await refusal(store.transaction((tx) => {
        const data = { firmId: 'org1', title: 'raw unknown field', baalance: 2 }
        return word === 'insert' ? store.insert({ tx, kayan: 'memos', data }) : word === 'update' ? store.update({ tx, kayan: 'memos', id: ids.org1, data }) : store.upsert({ tx, kayan: 'memos', on: ['firmId', 'code'], data: { ...data, code: 'raw-unknown' } })
      }))
      assert.equal(error.status, 400, word)
      assert.equal(error.key, 'error.invalid.value', word)
    }
    const error = await refusal(store.find({ kayan: 'memos', args: { limit: 1, page: 1, sort: { field: 'baalance', direction: 'asc' } } }))
    assert.equal(error.status, 400)
  })

  test('step store name checks preserve empty raw filters without widening the tenant', async () => {
    const row = await memos().create({ title: 'empty raw filter', balance: 7 }, { actor: one })
    storeProbe = async (ctx, tools) => {
      const kayan = declaration(built, 'memos')
      const found = await tools.store.find({ tx: ctx.tx, kayan, args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: {} } })
      assert.ok(found.docs.some((one) => one.id === row.id))
      assert.ok(found.docs.every((one) => one.firmId === 'org1'))
      assert.equal((await tools.store.update({ tx: ctx.tx, kayan, id: row.id, where: { and: [] }, data: { title: 'empty filter kept' } })).title, 'empty filter kept')
      assert.ok(BigInt(await tools.store.sum({ tx: ctx.tx, kayan, field: 'balance', where: { and: [{}] } })) >= 7n)
      await tools.store.remove({ tx: ctx.tx, kayan, id: row.id, where: {} })
    }
    try { await memos().probe({ title: 'empty filter probe' }, { actor: one }) } finally { storeProbe = async () => {} }
  })

  if (postgres) test('locked store calls refuse to run without a transaction', async () => {
    for (const lock of ['update', 'noKeyUpdate', 'share', 'keyShare'] as const) await assert.rejects(store.find({ kayan: 'memos', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock } }), /transaction/)
    await assert.rejects(store.upsert({ tx: undefined, kayan: 'tags', on: ['code'], data: { code: 'no transaction' } }), /transaction/)
  })

  if (postgres) for (const method of ['find', 'hold'] as const) for (const mode of ['update', 'noKeyUpdate', 'share', 'keyShare'] as const) for (const kayan of ['memos', 'tags'] as const) test(`a step ${method} holds ${kayan} in ${mode} until its transaction ends`, { timeout: 10_000 }, async () => {
    const row = await store.transaction((tx) => store.insert({ tx, kayan, data: kayan === 'memos' ? { firmId: 'org1', title: 'held' } : { label: 'held', open: false } }))
    const reached = Promise.withResolvers<number>()
    const release = Promise.withResolvers<void>()
    storeProbe = async (ctx, tools) => {
      try {
        if (method === 'hold') await tools.store.hold({ tx: ctx.tx, kayan: declaration(built, kayan), ids: [row.id], mode })
        else {
          const found = await tools.store.find({ tx: ctx.tx, kayan: declaration(built, kayan), args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock: mode, where: { id: { equals: row.id as string } } } })
          assert.equal(found.docs[0]?.id, row.id)
        }
        reached.resolve((await (ctx.tx as { execute(query: string): Promise<{ rows: { pid: number }[] }> }).execute('select pg_backend_pid() as pid')).rows[0]!.pid)
        await within(release.promise, 5000)
      } finally { release.resolve() }
    }
    const holding = memos().probe({ title: 'find holder' }, { actor: one })
    void holding.catch(() => {})
    let changing: Promise<unknown> | undefined
    let reading: Promise<unknown> | undefined
    try {
      const holder = await within(reached.promise)
      if (mode !== 'update') {
        const compatible = mode === 'share' ? 'share' : mode === 'noKeyUpdate' ? 'keyShare' : 'noKeyUpdate'
        reading = store.transaction((tx) => store.find({ tx, kayan, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock: compatible, where: { id: { equals: row.id as string } } } })).then(() => 'compatible')
        void reading.catch(() => {})
        assert.equal(await Promise.race([reading, waitForLock({ db: built.targets.store.db, where: `pg_blocking_pids(pid) @> array[${holder}]` })]), 'compatible')
      }
      changing = store.transaction((tx) => mode === 'keyShare' ? store.remove({ tx, kayan, id: row.id }) : store.update({ tx, kayan, id: row.id, data: kayan === 'memos' ? { title: 'changed' } : { label: 'changed' } }))
      void changing.catch(() => {})
      assert.equal(await Promise.race([changing.then(() => 'answered'), waitForLock({ db: built.targets.store.db, where: `pg_blocking_pids(pid) @> array[${holder}]` })]), 'waited')
    } finally {
      release.resolve()
      await within(Promise.allSettled([holding, ...(changing ? [changing] : []), ...(reading ? [reading] : [])]), 5000)
      storeProbe = async () => {}
    }
    await holding
    const changed = await changing as Record<string, unknown>
    assert.equal(mode === 'keyShare' ? changed.id : changed[kayan === 'memos' ? 'title' : 'label'], mode === 'keyShare' ? row.id : 'changed')
  })


})

suite('memory store', async () => {
  const store = memoryStore()
  return { built: languageOf(store as never), store: store as unknown as Store, done: async () => {} }
})

suite('postgres', async () => {
  const built = languageOf(drizzleAdapter({ connectionString: testDatabase(), kinds: drizzleKinds, rules: drizzleRules }) as never, { withLocal: true })
  await built.connect()
  return {
    built,
    store: built.targets.store as Store,
    done: async () => {
      await built.destroy()
    },
  }
}, true)

test('a local operation maps a custom store transaction deadlock to a retry conflict', { timeout: 10_000 }, async () => {
  const built = languageOf({ ...memoryStore(), transaction: async () => { throw Object.assign(new Error('deadlock'), { code: '40P01' }) } } as never)
  const error = await refusal(built.kayan.memos.operations.create({ title: 'retry' }, { actor: await actorOf({ active: 'org1' }) }))
  assert.equal(error.status, 409)
  assert.equal(error.key, 'error.conflict.retry')
  assert.equal((await refusal(built.kayan.memos.operations.updateMany({ where: { title: { equals: 'retry' } }, data: { title: 'retry' } }, { actor: await actorOf({ active: 'org1' }) }))).status, 409)
})

test('a step insert without an active organization throws and writes nothing', { timeout: 10_000 }, async () => {
  const store = memoryStore()
  const built = languageOf(store as never, { authorize: async () => undefined })
  storeProbe = async (ctx, tools) => { await tools.store.insert({ tx: ctx.tx, kayan: declaration(built, 'opens'), data: { title: 'organizationless insert' } }) }
  try { await assert.rejects(built.kayan.pins.operations.probe({ label: 'shared probe', memo: null }), /another organization/) } finally { storeProbe = async () => {} }
  assert.equal((await store.find({ kayan: 'opens', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { title: { equals: 'organizationless insert' } } } })).totalDocs, 0)
})

test('buildAsas refuses a store missing sum with a plain error naming the word', { timeout: 10_000 }, () => {
  const { sum: _sum, ...store } = memoryStore()
  assert.throws(() => languageOf(store as never), (error) => error instanceof Error && !(error instanceof TypeError) && /store.*sum/.test(error.message))
})

test('a language with no tenant target hands every step ctx.tenant undefined', async () => {
  const language = defineMithaq({
    arkan: [base],
    targets: {
      store: memoryStore(),
      zod: zodTarget,
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'store', schema: 'zod', authorize: defaultAuthorize }),
    } as {},
  })
  const notes = {
    name: 'notes',
    fields: { ...defaultFields, title: { kind: 'text' } },
    access: { create: () => true, read: () => true },
    targets: {
      service: {
        operations: {
          create: { steps: ({ steps }: { steps: { insert: unknown } }) => [seeTenant, steps.insert] },
          find: { steps: ({ steps }: { steps: { find: unknown } }) => [seeTenant, steps.find] },
        },
      },
    },
  }
  const built = language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [notes] } as never) as unknown as { kayan: { notes: { operations: Record<'create' | 'find', (input: object) => Promise<unknown>> } } }
  seenTenants.length = 0
  await built.kayan.notes.operations.create({ title: 'shared' })
  await built.kayan.notes.operations.find({})
  assert.deepEqual(seenTenants, [undefined, undefined])
})

test('buildAsas refuses public files for a tenant-owned kayan, whose address would hand one organization\'s file to anyone', () => {
  assert.throws(() => languageOf(memoryStore() as never, { publicFiles: true }), /Kayan "files" writes "targets.storage" with public: true, and its rows belong to an organization/)
})

test('a custom service authorizer answering nothing still runs under the scope', async () => {
  const store = memoryStore()
  const built = languageOf(store as never, { authorize: async () => undefined })
  const one = await actorOf({ active: 'org1' })
  const two = await actorOf({ active: 'org2' })
  await built.kayan.memos.operations.create({ title: 'a' }, { actor: one })
  await built.kayan.memos.operations.create({ title: 'b' }, { actor: two })
  const page = await built.kayan.memos.operations.find({ limit: 0 }, { actor: one })
  assert.deepEqual(page.docs.map((row: { firmId: string }) => row.firmId), ['org1'])
})


test('an error wrapping an after-commit failure is not advertised as a retryable rollback', async () => {
  const committed = new AfterCommitError({}, Object.assign(new Error('database failure after commit'), { code: '40P01' }))
  const table = [{ kayan: 'work', name: 'run', effect: 'create', single: false, input: z.object({}), call: async () => { throw new Error('wrapped committed failure', { cause: committed }) } }]
  const plug = fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })(table as never)
  const response = await plug.handle(new Request('http://test/api/work/run', { method: 'POST', body: '{}' }), async () => null)
  assert.equal(response?.status, 500)
})
