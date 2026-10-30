import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import {
  defaultMaxBodyBytes,
  AsasError,
  AfterCommitError,
  audit,
  defaultKinds,
  defaultRules,
  defaultOperations,
  defaultFields,
  deleteMany,
  defaultAuthorize,
  defaultDepth,
  defaultLimit,
  defaultMaxLimit,
  defaultJoinLimit,
  defaultBulkLimit,
  defaults,
  base,
  defineMithaq,
  defineRukn,
  fetchHttp,
  insert,
  find,
  findOne,
  remove,
  update,
  updateMany,
  userRefs,
  validate,
  zodKinds, zodRules, zodIdKinds, zodTarget,
  type Ctx,
  type Field,
  type Kayan,
  type Rules,
  type ReadStep,
  type Step,
  type Tools,
  type WriteStep,
  type Operations,
  type OperationDeclaration,
  type StandardSchemaV1,
  screenTarget,
  serviceTarget,
  defaultGlobalFields,
  defaultGlobalOperations,
  draftFields,
  versionOperations,
  versionsTarget,
} from 'mithaq'
import { dashboardScreen, serverTargets } from '../../mithaq/src/mithaq.ts'
import { memoryStore } from './memory-store.ts'
import { orpcHttp } from 'mithaq/orpc'
import { plainTarget } from './standard-schema-target.ts'
import { expectedUpdatedAt } from '../../mithaq/src/steps/expected-updated-at.ts'
// The comparison a version's merge makes, reached where it lives, since no public operation shows a
// jsonb key order on its own.
import { changedColumns } from '../../../packages/mithaq/src/versions/versions.ts'
import { defaultNodes, richText as richTextRukn } from 'mithaq/rich-text'
import { AutoLinkNode, CalloutNode, toneState } from '../../../packages/mithaq-admin/test/callout-node.ts'
import { ElementNode } from 'lexical'

const allowAccess = { create: () => true, read: () => true, update: () => true, delete: () => true } as const
const user = userRefs<{ id: string }>()
const tenanted = userRefs<{ activeOrganizationId: string }>()
const op = (steps: readonly WriteStep[]): OperationDeclaration => ({ steps })

/**
 * A language on one in-memory store, so a write runs with no database at all. Its service target is
 * written here as data in the shape the service capability fixes, not made by `serviceTarget`, so
 * every test that builds through this language runs on values a project wrote.
 */
const language = (
  store: ReturnType<typeof memoryStore>,
  depth?: number,
) =>
  defineMithaq({
    arkan: [base],
    targets: {
      memory: store,
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: depth ?? defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
    },
  })

test('18a. a step sealed by a second copy of mithaq is refused by name, and no copy can lend this one a seal', async () => {
  const mithaq = language(memoryStore())
  const notes = (operations: Record<string, OperationDeclaration>) => () =>
    mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, targets: { service: { operations: { ...defaultOperations, ...operations } } } })],
    })
  // A second instance of the module, as a second install of the package loads it.
  const copy = await import(new URL('../../../packages/mithaq/src/asas/runner/steps.ts?copy', import.meta.url).href) as { defaultOperations: Record<string, OperationDeclaration> }
  assert.throws(
    notes({ create: copy.defaultOperations.create! }),
    /Kayan "notes" operation "create" holds a step another copy of mithaq sealed, loaded from .*steps\.ts\?copy.*same spec/s,
  )
  // A copy that answers for any function still only refuses: this copy recognises its own seals alone.
  const copies = (globalThis as Record<symbol, Map<string, (step: unknown) => unknown>>)[Symbol.for('mithaq.copies')]!
  copies.set('forged', () => 'insert')
  try {
    assert.throws(notes({ create: op([(ctx) => ctx]) }), /another copy of mithaq sealed, loaded from forged/)
  } finally {
    copies.delete('forged')
  }
})

test('18. a restated list is sealed, and the one step it holds says what the operation does', async () => {
  const mithaq = language(memoryStore())
  const notes = (operations: Record<string, OperationDeclaration>) => () =>
    mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, targets: { service: { operations: { ...defaultOperations, ...operations } } } })],
    })

  assert.throws(
    notes({ create: op([]) }),
    /Kayan "notes" operation "create" has 0 store or managed read steps/,
  )
  assert.throws(
    notes({ create: op([insert, update]) }),
    /Kayan "notes" operation "create" has 2 store or managed read steps/,
  )
  // The effect is read off the one store or read step, so a list holding both
  // says which is which rather than mismatching a declared effect.
  assert.throws(
    notes({ inspect: { steps: [findOne, insert] } as never }),
    /Kayan "notes" operation "inspect" has 2 store or managed read steps/,
  )
  assert.throws(
    notes({ archive: op([]) }),
    /Kayan "notes" operation "archive" has 0 store or managed read steps/,
  )
  assert.doesNotThrow(notes({ peek: { steps: [findOne] } }))
  assert.doesNotThrow(notes({ create: op([remove]) }))

  const ctx = { kayan: {}, data: {}, actor: null, tx: null, context: {} } as unknown as Ctx
  assert.equal(await audit(ctx, undefined as unknown as Tools), ctx)
})

test('19. defaults reads the actor, and a write with none says so', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text', rules: { required: true } },
          createdBy: { kind: 'text', label: { en: 'Created by', ar: 'أنشأه' }, rules: { defaultValue: user.id } },
        },
        access: allowAccess,
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  const row = await built.kayan.notes.operations.create({ id: 1, body: 'mine' }, { actor: { id: 'u1', name: 'Layla' } })
  assert.equal(row.createdBy, 'u1')
  assert.deepEqual(store.rows.get('notes'), [{ id: 1, body: 'mine', createdBy: 'u1' }])

  await assert.rejects(
    () => built.kayan.notes.operations.create({ id: 2, body: 'nobody' }),
    /Kayan "notes" operation "create" field "createdBy" defaults to "user.id", and this write was given no actor/,
  )
  assert.equal(store.rows.get('notes')?.length, 1)
})

test('19c. a default reading a key the actor does not carry throws, the way a row filter on it does', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text', rules: { required: true } },
          createdBy: { kind: 'text', label: { en: 'Created by', ar: 'أنشأه' }, rules: { defaultValue: user.id } },
        },
        access: allowAccess,
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  // An access row's filter refuses both an actor whose key is null and one that
  // has no such key. A default reads them the same way, so the column is never
  // written as null behind a filter that would have thrown.
  await assert.rejects(
    () => built.kayan.notes.operations.create({ body: 'null key' }, { actor: { id: null } as never }),
    /Kayan "notes" operation "create" field "createdBy" defaults to "user\.id", and the actor carries nothing there/,
  )
  await assert.rejects(
    () => built.kayan.notes.operations.create({ body: 'missing key' }, { actor: { name: 'Layla' } as never }),
    /Kayan "notes" operation "create" field "createdBy" defaults to "user\.id", and the actor carries nothing there/,
  )
  assert.equal(store.rows.get('notes')?.length ?? 0, 0)
})

test('19a. transformed zod overrides validate writes and returned rows', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'transformed',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          amount: { kind: 'number', targets: { zod: z.string().transform((value) => value.length).pipe(z.number()) } },
          maybe: {
            kind: 'number',
            targets: { zod: z.string().transform((value) => value.length).pipe(z.number()).nullable() },
          },
          values: {
            kind: 'number',
            targets: { zod: z.array(z.string().transform(Number)).pipe(z.array(z.number())) },
          },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  const row = await built.kayan.transformed.operations.create({ id: 1, amount: '12', maybe: '123', values: ['4'] } as never)
  assert.equal(row.amount, 2)
  assert.equal(row.maybe, 3)
  assert.deepEqual(row.values, [4])

  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'bareTransform',
            fields: { id: { kind: 'number' }, amount: { kind: 'number', targets: { zod: z.string().transform(Number) } } },
            targets: { service: { operations: defaultOperations } },
          }),
        ],
      }),
    /zod transform override needs an output schema/,
  )
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'nestedBareTransform',
            fields: { id: { kind: 'number' }, values: { kind: 'number', targets: { zod: z.array(z.string().transform(Number)) } } },
            targets: { service: { operations: defaultOperations } },
          }),
        ],
      }),
    /zod transform override needs an output schema/,
  )
})

test('19b. `defaultNow` fills a datetime with the write\'s moment on create, `nowOnUpdate` moves one on every update whatever the column is called, a column named updatedAt carrying neither is left alone, and each is refused where it cannot hold', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text', rules: { required: true } },
          stampedAt: { kind: 'datetime', label: { en: 'Stamped at', ar: 'وقت الختم' }, rules: { defaultNow: true } },
          modifiedAt: {
            kind: 'datetime',
            label: { en: 'Modified at', ar: 'وقت التعديل' },
            rules: { defaultNow: true, nowOnUpdate: true, providedBy: { create: 'application', update: 'application' } },
          },
          updatedAt: { kind: 'datetime', label: { en: 'Updated at', ar: 'تاريخ التعديل' } },
        },
        access: allowAccess,
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  const before = new Date()
  const sent = new Date(Date.UTC(2020, 0, 1))
  const row = await built.kayan.notes.operations.create({ id: 1, body: 'stamped', updatedAt: sent })
  assert.ok(row.stampedAt instanceof Date, 'the defaults step wrote a Date where the create sent none')
  assert.ok(row.stampedAt.getTime() >= before.getTime(), 'the moment is the write\'s, not the declaration\'s')
  assert.ok(row.modifiedAt instanceof Date, 'and the column that moves on update is filled on create too')

  await setTimeout(2)
  const changed = await built.kayan.notes.operations.update({ id: 1, body: 'changed' })
  assert.ok(
    (changed.modifiedAt as Date).getTime() > (row.modifiedAt as Date).getTime(),
    'an update moves the column that declares nowOnUpdate, named modifiedAt',
  )
  assert.equal(
    (changed.stampedAt as Date).getTime(),
    (row.stampedAt as Date).getTime(),
    'and leaves the create-time moment where the create put it',
  )
  assert.equal(
    (changed.updatedAt as Date).getTime(),
    sent.getTime(),
    'and a column named updatedAt that declares no rule is not bumped by its name',
  )

  const dynamic = (field: Kayan['fields'][string]) =>
    language(memoryStore()).buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [{ name: 'dynamic', fields: { id: { kind: 'number' }, stamp: field } }] })
  // The two rules sit on the datetime kind's list alone, so any other kind
  // refuses them the way it refuses a rule it never named.
  assert.throws(
    () => dynamic({ kind: 'text', rules: { defaultNow: true } }),
    /field "stamp" has kind "text" which does not accept nested rule "defaultNow"/,
  )
  assert.throws(
    () => dynamic({ kind: 'date', rules: { nowOnUpdate: true } }),
    /field "stamp" has kind "date" which does not accept nested rule "nowOnUpdate"/,
  )
  // The string `$NOW` is no Date, so the kind refuses it.
  assert.throws(
    () => dynamic({ kind: 'datetime', rules: { defaultValue: '$NOW' } }),
    /field "stamp" nested rule "defaultValue" does not match kind "datetime"/,
  )
  assert.throws(
    () => dynamic({ kind: 'datetime', rules: { defaultValue: new Date(), defaultNow: true } }),
    /field "stamp" declares both "defaultValue" and "defaultNow", and the two cannot both hold/,
  )
  // `nowOnUpdate` says the runner supplies the value on every update, so any
  // other provider there is refused: the client's, written out or left to the
  // default every field without a `providedBy` has, and `never`, which would
  // have the store step's seal refuse every update of the field.
  for (const rules of [
    { nowOnUpdate: true, providedBy: { update: 'client' } },
    { nowOnUpdate: true },
    { nowOnUpdate: true, providedBy: { update: 'never' } },
  ] as const) {
    assert.throws(
      () => dynamic({ kind: 'datetime', rules }),
      /Kayan "dynamic" field "stamp" declares "nowOnUpdate", which says the runner supplies the value on every update, and its providedBy\.update is "(client|never)"/,
    )
  }
  assert.doesNotThrow(() => dynamic({ kind: 'datetime', rules: { nowOnUpdate: true, providedBy: { update: 'application' } } }))
  // `defaultNow` fills only what a create left out, so the client may still
  // send it; a create nothing supplies is the one provider it contradicts.
  assert.throws(
    () => dynamic({ kind: 'datetime', rules: { defaultNow: true, providedBy: { create: 'never' } } }),
    /Kayan "dynamic" field "stamp" declares "defaultNow", which says the runner fills the value a create leaves out, and its providedBy\.create is "never"/,
  )
  assert.doesNotThrow(() => dynamic({ kind: 'datetime', rules: { defaultNow: true } }))
  assert.equal(defaultKinds.date.now, undefined)

  const memory = memoryStore()
  memory.kinds.moment = memory.kinds.datetime!
  const custom = defineMithaq({
    arkan: [defineRukn({ name: 'project', kinds: { ...defaultKinds, moment: { ...defaultKinds.datetime, label: { en: 'Moment', ar: 'وقت' } } }, rules: defaultRules })],
    targets: {
      memory,
      zod: zodTarget({ kinds: { ...zodKinds, moment: zodKinds.datetime }, rules: zodRules, idKinds: zodIdKinds }),
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
    },
  })
  assert.doesNotThrow(() =>
    custom.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [
        custom.defineKayan({
          name: 'events',
          fields: { id: { kind: 'number' }, happenedAt: { kind: 'moment', rules: { defaultNow: true } } },
          targets: { service: { operations: defaultOperations } },
        }),
      ],
    }),
  )
  const momentless = memoryStore()
  momentless.kinds.stamp = momentless.kinds.datetime!
  assert.throws(
    () =>
      defineMithaq({
        arkan: [defineRukn({ name: 'project', kinds: { ...defaultKinds, stamp: { ...defaultKinds.datetime, now: undefined, label: { en: 'Stamp', ar: 'ختم' } } }, rules: defaultRules })],
        targets: {
          memory: momentless,
          zod: zodTarget({ kinds: { ...zodKinds, stamp: zodKinds.datetime }, rules: zodRules, idKinds: zodIdKinds }),
          service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
        },
      }).buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [{ name: 'events', fields: { id: { kind: 'number' }, at: { kind: 'stamp', rules: { defaultNow: true } } } }] }),
    /field "at" nested rule "defaultNow" does not match kind "stamp"/,
  )
})

test('20. a write that calls another counts the depth and joins the transaction with nothing passed, the caller bag reaches every write in the chain, and past the cap the throw names it', async () => {
  const store = memoryStore()
  const depths: number[] = []
  const sources: string[] = []
  type Nodes = {
    create(data: { body: string }, options?: { context?: Record<string, unknown> }): Promise<unknown>
  }
  let built: { kayan: { nodes: { operations: Nodes } } }
  const deeper: Step = async (ctx) => {
    depths.push(ctx.context.depth)
    sources.push(String(ctx.context.source))
    await built.kayan.nodes.operations.create({ body: 'child' })
    return ctx
  }
  const mithaq = language(store, 2)
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'nodes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([insert, deeper]) },
          },
        },
      }),
    ],
  }) as typeof built

  await assert.rejects(
    () => built.kayan.nodes.operations.create({ body: 'root' }, { context: { source: 'http' } }),
    /Write depth 3 is past the cap of 2: nodes\.create -> nodes\.create -> nodes\.create/,
  )
  assert.deepEqual(depths, [1, 2])
  // The caller's bag reaches every write in the chain, and the runner's own keys
  // are merged over it, so no caller can hand itself a smaller depth.
  assert.deepEqual(sources, ['http', 'http'])
  assert.equal(store.calls.transaction, 1)
  // This store keeps its rows in an array and cannot roll back, so the two rows the inserts made
  // before the cap was reached are still here. What the transaction buys is asserted on Postgres in
  // asas.test.ts.
  assert.equal(store.rows.get('nodes')?.length, 2)
})

test('20a. nested writes to another store are rejected while a transaction is open', async () => {
  const firstStore = memoryStore()
  const secondStore = memoryStore()
  const secondLanguage = language(secondStore)
  const second = secondLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      secondLanguage.defineKayan({
        name: 'secondNotes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const writeSecond: Step = async (ctx) => {
    await second.kayan.secondNotes.operations.create({ body: 'second' })
    return ctx
  }
  const firstLanguage = language(firstStore)
  const first = firstLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      firstLanguage.defineKayan({
        name: 'firstNotes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([writeSecond, insert]) },
          },
        },
      }),
    ],
  })

  await assert.rejects(
    () => first.kayan.firstNotes.operations.create({ body: 'first' }),
    /cannot write to another store while transaction "firstNotes\.create" is open/,
  )

  assert.equal(firstStore.calls.transaction, 1)
  assert.equal(secondStore.calls.transaction, 0)
  assert.deepEqual(firstStore.rows.get('firstNotes') ?? [], [])
  assert.deepEqual(secondStore.rows.get('secondNotes') ?? [], [])
})

test('20a1. a top-level managed read receives the context its caller passed, and a read started inside a write inherits the one that write opened', async () => {
  const store = memoryStore()
  const seen: unknown[] = []
  const recordContext: ReadStep = async (ctx) => {
    seen.push(ctx.context.requestId)
    return ctx
  }
  type Notes = {
    create(data: { id: number; body: string }, options?: { context?: Record<string, unknown> }): Promise<unknown>
    findByID(data: { id: number }, options?: { context?: Record<string, unknown> }): Promise<unknown>
  }
  let built: { kayan: { notes: { operations: Notes } } }
  const readInside: WriteStep = async (ctx) => {
    await built.kayan.notes.operations.findByID({ id: 1 })
    return ctx
  }
  const mithaq = language(store)
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              create: op([insert, readInside]),
              findByID: { steps: [findOne, recordContext] },
            },
          },
        },
      }),
    ],
  }) as typeof built

  await built.kayan.notes.operations.create({ id: 1, body: 'one' }, { context: { requestId: 'r-nested' } })
  assert.deepEqual(seen, ['r-nested'])
  await built.kayan.notes.operations.findByID({ id: 1 }, { context: { requestId: 'r-top' } })
  assert.deepEqual(seen, ['r-nested', 'r-top'])
  await built.kayan.notes.operations.findByID({ id: 1 })
  assert.deepEqual(seen, ['r-nested', 'r-top', undefined])
})

// The trust boundary is the argument position: a served body is the input and nothing else, and the
// input is what the list shape declares, so a key it does not declare is refused and reaches no
// step, as data or as an option.
for (const [key, value] of [['actor', { id: 'forged' }], ['context', { requestId: 'x', source: 'forged' }]] as const) {
  test(`20a3. a served find whose body carries ${key} is refused and hands it to no step, as data or as an option`, async () => {
    const seen: unknown[] = []
    const record: ReadStep = async (ctx) => {
      seen.push(ctx.data, ctx.actor, ctx.context.requestId, ctx.context.source)
      return ctx
    }
    const mithaq = language(memoryStore())
    const built = mithaq.buildAsas({
      kayan: [
        mithaq.defineKayan({
          name: 'notes',
          access: allowAccess,
          fields: { id: { kind: 'number' }, body: { kind: 'text' } },
          targets: { service: { operations: { ...defaultOperations, find: { steps: [record, find] } } } },
        }),
      ],
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })],
    })
    const response = await built.handler(new Request('http://test/api/notes/find', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    }))
    assert.equal(response.status, 400)
    await response.body?.cancel()
    assert.deepEqual(seen, [], 'no step ran')
  })
}

test('20a3a. a served global read whose body carries an id is refused and hands that id to no access callback, because a global is found by being the only row', async () => {
  const seen: unknown[] = []
  const mithaq = language(memoryStore())
  const built = mithaq.buildAsas({
    kayan: [],
    global: [
      mithaq.defineGlobal({
        name: 'settings',
        access: { read: (args: { id?: unknown }) => { seen.push(args.id); return true }, update: () => true },
        fields: { id: { kind: 'number', rules: { defaultValue: 1 } }, title: { kind: 'text' }, ...defaultGlobalFields },
        targets: { service: { operations: defaultGlobalOperations } },
      }),
    ],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })],
  })
  const response = await built.handler(new Request('http://test/api/settings/findOne', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 5 }),
  }))
  assert.equal(response.status, 400, 'a global read takes no id')
  await response.body?.cancel()
  // Asked once, before the parse, which then refuses the id; never with it.
  assert.deepEqual(seen, [undefined], 'the read access was asked once, without the id')
})

test('20a3b. a global\'s read takes a depth and nothing else, so a query it cannot run is refused at the parse', async () => {
  const mithaq = language(memoryStore())
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [],
    global: [
      mithaq.defineGlobal({
        name: 'settings',
        access: { read: () => true, update: () => true },
        fields: { id: { kind: 'number', rules: { defaultValue: 1 } }, title: { kind: 'text' }, ...defaultGlobalFields },
        targets: { service: { operations: defaultGlobalOperations } },
      }),
    ],
  })
  const read = built.operations.find((one) => one.kayan === 'settings' && one.name === 'findOne')!
  assert.deepEqual(
    await read.input['~standard'].validate({ depth: 1, where: { title: { equals: 'x' } }, sort: 'title', limit: 1 }),
    { issues: [{ message: 'Unrecognized key: "where"' }, { message: 'Unrecognized key: "sort"' }, { message: 'Unrecognized key: "limit"' }] },
  )
  assert.deepEqual(await read.input['~standard'].validate({ depth: 1 }), { value: { depth: 1 } })
})

const contextLanguage = (store: ReturnType<typeof memoryStore>) =>
  defineMithaq({
    arkan: [base],
    targets: {
      memory: store,
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize, context: {} as { requestId: string } }),
    },
  })

test('20a5. a served call hands every step the context the project\'s own function built from the request, the same through both plugs, and never one the body or a header names', async () => {
  const seen: unknown[] = []
  const record: ReadStep = async (ctx) => {
    seen.push({ requestId: ctx.context.requestId, actor: 'actor' in ctx.context, data: 'context' in ctx.data })
    return ctx
  }
  const mithaq = contextLanguage(memoryStore())
  const fromRequest = (request: Request) => ({ requestId: request.headers.get('x-request-id') ?? 'missing' })
  const built = mithaq.buildAsas({
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: { ...defaultOperations, find: { steps: [record, find] } } } },
      }),
    ],
    http: [
      fetchHttp({ onError: console.error, maxBodyBytes: defaultMaxBodyBytes, context: (request) => fromRequest(request) }),
      orpcHttp({ onError: console.error, maxBodyBytes: defaultMaxBodyBytes, api: '/api/orpc', context: (request, actor) => ({ actor, ...fromRequest(request) }) }),
    ],
  })
  for (const [path, id, rpc] of [
    ['/api/notes/find', 1, false],
    ['/api/orpc/notes/find', 2, false],
    ['/api/rpc/notes/find', 3, true],
  ] as const) {
    for (const [input, status] of [[{ context: { requestId: 'forged-body' } }, 400], [{}, 200]] as const) {
      const response = await built.handler(new Request(`http://test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': `r${id}`, context: 'forged-header' },
        body: JSON.stringify(rpc ? { json: input } : input),
      }))
      assert.equal(response.status, status, path)
      await response.body?.cancel()
    }
  }
  assert.deepEqual(seen, [
    { requestId: 'r1', actor: false, data: false },
    { requestId: 'r2', actor: false, data: false },
    { requestId: 'r3', actor: false, data: false },
  ])
})

test('20a6. a served call through a listed plug given no context function, under a runner that declares one, is refused by name before any step runs', async () => {
  const ran: unknown[] = []
  const reported: unknown[] = []
  const record: ReadStep = async (ctx) => {
    ran.push(ctx.context.requestId)
    return ctx
  }
  const mithaq = contextLanguage(memoryStore())
  const notes = mithaq.defineKayan({
    name: 'notes',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text' } },
    targets: { service: { operations: { ...defaultOperations, find: { steps: [record, find] } } } },
  })
  const onError = (error: unknown) => void reported.push(error)
  for (const built of [
    mithaq.buildAsas({ kayan: [notes], http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError })] }),
    mithaq.buildAsas({ kayan: [notes], http: [orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, onError })] }),
  ]) {
    const response = await built.handler(new Request('http://test/api/notes/find', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))
    assert.equal(response.status, 500)
    await response.body?.cancel()
  }
  assert.deepEqual(ran, [], 'no step ran')
  assert.equal(reported.length, 2)
  for (const error of reported) {
    assert.match(String((error as Error).message), /Kayan "notes" operation "find" was served with no context, and this build's runner declares one/)
    // The plug it names is one that builds, with every option a plug requires.
    assert.match(String((error as Error).message), /fetchHttp\(\{ context, maxBodyBytes: defaultMaxBodyBytes, onError: console\.error \}\)/)
  }
})

test('20a4. an override named find on another seal is called with the input and the options, like every other operation', async () => {
  const actors: unknown[] = []
  const record: Step = async (ctx) => {
    actors.push(ctx.actor)
    return ctx
  }
  const mithaq = language(memoryStore())
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: { ...defaultOperations, find: op([record, insert]), look: { steps: [record, findOne] } } } },
      }),
      mithaq.defineKayan({
        name: 'pages',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: { ...defaultOperations, find: { steps: [record, findOne] } } } },
      }),
    ],
  })
  const actor = { id: 'u1' }
  assert.equal((await built.kayan.notes.operations.find({ id: 1, body: 'one' }, { actor })).body, 'one')
  // No page 1 is stored, so the read of one row answers 404; the step was
  // called before it, which is what is counted.
  await assert.rejects(() => built.kayan.pages.operations.find({ id: 1 }, { actor }), (thrown: unknown) => thrown instanceof AsasError && thrown.status === 404)
  await built.kayan.notes.operations.look({ id: 1 }, { actor })
  assert.deepEqual(actors, [actor, actor, actor])
})

test('20b. a store is the target that declares the capability, and one that omits it is refused', async () => {
  const { capability: _capability, ...withoutCapability } = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: withoutCapability as never, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory' as never, schema: 'zod', authorize: defaultAuthorize }) },
  })
  // A target that never says what it is cannot be the store a kayan writes to; nothing is sniffed.
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, access: allowAccess, targets: { service: { operations: defaultOperations } } })],
      }),
    /The service target names store "memory", which is not a store: a store target declares capability "store"/,
  )

  const declared = memoryStore()
  const withCapability = defineMithaq({
    arkan: [base],
    targets: { memory: declared, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const built = withCapability.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [withCapability.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, access: allowAccess, targets: { service: { operations: defaultOperations } } })],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'a declared store' })
  assert.deepEqual(declared.rows.get('notes'), [{ id: 1, body: 'a declared store' }])
})

test('20b1. count asks the store aggregate where the store has one, and find with limit zero where it has none', async () => {
  const store = memoryStore()

  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  for (const [id, body] of [[1, 'one'], [2, 'two'], [3, 'three']] as const) await built.kayan.notes.operations.create({ id, body })

  // A limit of zero is no page limit, so every matching row is returned and the
  // total is the same number the count answers with.
  const everything = await store.find({ kayan: 'notes', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' } } })
  assert.equal(everything.docs.length, 3)
  assert.equal(everything.totalDocs, 3)
  assert.deepEqual(await built.kayan.notes.operations.count(), { totalDocs: 3 })
  assert.deepEqual(await built.kayan.notes.operations.count({ where: { body: { equals: 'two' } } }), { totalDocs: 1 })

  let countCalls = 0
  const find = store.find
  store.find = async () => { throw new Error('count fetched rows') }
  Object.assign(store, { count: async (_args: { kayan: string; args: { where?: unknown }; tx?: unknown }) => {
    countCalls += 1
    return 37
  } })
  assert.deepEqual(await built.kayan.notes.operations.count(), { totalDocs: 37 })
  assert.equal(countCalls, 1)

  // A store without `count` is still asked the same question through `find` with no page limit.
  store.find = find
  Reflect.deleteProperty(store, 'count')
  assert.deepEqual(await built.kayan.notes.operations.count(), { totalDocs: 3 })
  assert.deepEqual(await built.kayan.notes.operations.count({ where: { body: { equals: 'two' } } }), { totalDocs: 1 })
})

test('20b2. a schema target that declares no derive is refused at buildAsas, naming the target and whoever named it', () => {
  // The types refuse a target with no `derive` outright, so this language is
  // written as data, the way a generator or a project's own loader hands one
  // over.
  const { derive: _derive, ...withoutDerive } = zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds })
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), shapeless: withoutDerive as never, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'shapeless' as never, authorize: defaultAuthorize }) },
  })
  // `isStore` reads `capability` alone, so a target that is not a store passes
  // the store half of the check whatever else it is missing. `derive` is the one
  // member core calls on a schema target, so the build asks for it here rather
  // than reaching the derivation and throwing "derive is not a function".
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, access: allowAccess, targets: { service: { operations: defaultOperations } } })],
      }),
    /The service target names "shapeless" as its schema target, which declares no derive/,
  )
  const own = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), shapeless: withoutDerive as never, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  assert.throws(
    () =>
      own.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [{ name: 'notes', targets: { service: { schema: 'shapeless' } }, fields: { id: { kind: 'number' } }, access: allowAccess }],
      }),
    /Kayan "notes" names "shapeless" as its schema target, which declares no derive/,
  )
})

test('20c. count is a default operation: the method, the table entry, the route and the permission are one operation', async () => {
  const asked: unknown[] = []
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: serviceTarget({
        depth: defaultDepth,
        defaultLimit,
        maxLimit: defaultMaxLimit,
        joinLimit: defaultJoinLimit,
        bulkLimit: defaultBulkLimit,
        store: 'memory',
        schema: 'zod',
        authorize: async (args) => {
          asked.push(args.operation)
          return defaultAuthorize(args)
        },
      }),
    },
  })
  const built = mithaq.buildAsas({
    kayan: [mithaq.defineKayan({ name: 'notes', access: allowAccess, fields: { id: { kind: 'number' }, body: { kind: 'text' } }, targets: { service: { operations: defaultOperations } } })],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })],
  })
  for (const [id, body] of [[1, 'one'], [2, 'two']] as const) await built.kayan.notes.operations.create({ id, body })
  const notes = built.kayan.notes
  assert.equal(notes.operations.count, notes.targets.service.operations.count)
  assert.ok(built.operations.some((one) => one.kayan === 'notes' && one.name === 'count' && one.effect === 'read'))
  assert.ok(built.catalog.includes('notes.count'))
  asked.length = 0
  assert.deepEqual(await notes.operations.count({ where: { body: { equals: 'two' } } }), { totalDocs: 1 })
  assert.deepEqual(asked, ['count'], 'the permission asked is the operation named count')
  const response = await built.handler(new Request('http://test/api/notes/count', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ where: { body: { equals: 'one' } } }),
  }))
  assert.deepEqual(await response.json(), { totalDocs: 1 })
})

test('20c0. a kayan overrides count with its own list, or leaves it out of its record, and no name is reserved for it', async () => {
  const mithaq = language(memoryStore())
  const { count: _count, ...countless } = defaultOperations
  const doubled: ReadStep = async (ctx) => ({ ...ctx, data: { totalDocs: (ctx.data as { totalDocs: number }).totalDocs * 2 } })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: { ...defaultOperations, count: { steps: ({ steps }) => [steps.count, doubled] } } } },
      }),
      mithaq.defineKayan({
        name: 'quiet',
        access: allowAccess,
        fields: { id: { kind: 'number' } },
        targets: { service: { operations: countless } },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'one' })
  assert.deepEqual(await built.kayan.notes.operations.count({}), { totalDocs: 2 }, 'the override is what runs')
  assert.ok(!('count' in built.kayan.quiet.operations))
  assert.ok(!built.operations.some((one) => one.kayan === 'quiet' && one.name === 'count'))
  assert.ok(!built.catalog.includes('quiet.count'))
  assert.ok(built.kayan.quiet.operations.find, 'find stays where count is off')
  const signedIn = { create: ({ user }: { user: unknown }) => !!user, read: ({ user }: { user: unknown }) => !!user, update: () => true, delete: () => true }
  const renamed = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'picked',
        access: signedIn,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: { ...defaultOperations, count: { input: () => z.object({ id: z.number() }), steps: ({ steps }) => [steps.findOne] } } } },
      }),
      mithaq.defineKayan({
        name: 'written',
        access: signedIn,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: { ...defaultOperations, count: op([insert]) } } },
      }),
    ],
  })
  const actor = { id: 'u1' }
  await renamed.kayan.picked.operations.create({ id: 1, body: 'one' }, { actor })
  assert.deepEqual(await renamed.kayan.picked.operations.count({ id: 1 }, { actor }), { id: 1, body: 'one' })
  assert.deepEqual(await renamed.kayan.written.operations.count({ id: 2, body: 'two' }, { actor }), { id: 2, body: 'two' })
})

test('20c1. memory store enforces managed read access and field projection', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: {
          create: () => true,
          read: ({ user }) => ({ body: { equals: (user as { body?: string } | null)?.body ?? 'none' } }),
          update: () => true,
          delete: () => true,
        },
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text', rules: { required: true } },
          secret: { kind: 'text', access: { read: () => false } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'mine', secret: 'hidden' })
  await built.kayan.notes.operations.create({ id: 2, body: 'other', secret: 'hidden' })

  const found = await built.kayan.notes.operations.find({}, { actor: { body: 'mine' } })
  assert.deepEqual(found.docs.map((row) => row.body), ['mine'])
  assert.equal(Object.hasOwn(found.docs[0]!, 'secret'), false)
  assert.deepEqual(await built.kayan.notes.operations.count({}, { actor: { body: 'mine' } }), { totalDocs: 1 })
})

test('20d. memory managed reads compare supported scalar types and stable ties', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'rows',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          label: { kind: 'text' },
          amount: { kind: 'number' },
          at: { kind: 'datetime' },
          note: { kind: 'text' },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const date = new Date('2026-01-01T00:00:00.000Z')
  await built.kayan.rows.operations.create({ id: 1, label: 'first', amount: 2, at: date, note: null })
  await built.kayan.rows.operations.create({ id: 2, label: 'second', amount: 10, at: new Date(date), note: 'x' })
  await built.kayan.rows.operations.create({ id: 3, label: 'third', amount: null, at: new Date('2026-01-02T00:00:00.000Z'), note: null })

  assert.deepEqual((await built.kayan.rows.operations.find({ where: { amount: { equals: 2 } } })).docs.map((row) => row.id), [1])
  // The subject is which rows the comparison matches, so the sort is named
  // rather than left to the default, which is `createdAt` descending and would
  // put these two rows, written in the same millisecond, in id order reversed.
  assert.deepEqual((await built.kayan.rows.operations.find({ where: { at: { equals: new Date(date) } }, sort: 'id' })).docs.map((row) => row.id), [1, 2])
  assert.deepEqual((await built.kayan.rows.operations.find({ where: { note: { equals: null } }, sort: 'amount' })).docs.map((row) => row.id), [1, 3])
  assert.deepEqual((await built.kayan.rows.operations.find({ where: { and: [{ amount: { greater_than: 1 } }], note: { in: [null] } }, sort: 'id' })).docs.map((row) => row.id), [1])
  assert.deepEqual((await built.kayan.rows.operations.find({ where: { or: [{ amount: { equals: 2 } }], note: { not_in: [null] } }, sort: 'id' })).docs.map((row) => row.id), [])
  assert.deepEqual((await built.kayan.rows.operations.find({ where: { label: { in: [] } } })).docs.map((row) => row.id), [])
  assert.deepEqual((await built.kayan.rows.operations.find({ where: { label: { like: 'first row' } } })).docs.map((row) => row.id), [])
  assert.deepEqual((await built.kayan.rows.operations.find({ where: { label: { like: 'sec ond' } } })).docs.map((row) => row.id), [2])
  assert.deepEqual((await built.kayan.rows.operations.find({ limit: 1, page: 1, sort: 'at' })).docs.map((row) => row.id), [1])
  assert.deepEqual((await built.kayan.rows.operations.find({ limit: 1, page: 2, sort: 'at' })).docs.map((row) => row.id), [2])
  assert.deepEqual((await built.kayan.rows.operations.find({ limit: 1, sort: '-at' })).docs.map((row) => row.id), [3])
})


test('20d1. a read option the caller wrote badly is refused with 400 and a message key carrying the values its message interpolates, for a limit that is not an integer, a malformed sort, a sort naming an unknown field, and a where naming an unknown field', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'rows',
        access: allowAccess,
        fields: { id: { kind: 'number' }, label: { kind: 'text' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await built.kayan.rows.operations.create({ id: 1, label: 'first' })

  const badLimit = await built.kayan.rows.operations.find({ limit: 1.5 }).catch((thrown: unknown) => thrown)
  assert.ok(badLimit instanceof AsasError, 'a limit that is not an integer is an AsasError')
  assert.equal(badLimit.status, 400, 'a limit that is not an integer carries 400')
  assert.equal(badLimit.message, 'Managed read option "limit" must be an integer >= 0.', 'the limit refusal keeps the message it always had')
  // The English stays for a log. The key and the interpolated values are what a
  // client resolves in the reader's own locale.
  assert.equal(badLimit.key, 'error.invalid.read_option_integer', 'the limit refusal carries its message key')
  assert.deepEqual(badLimit.params, { option: 'limit', minimum: 0 }, 'the limit refusal carries the option and the minimum its message interpolates')

  const badSort = await built.kayan.rows.operations.find({ sort: 'label desc' }).catch((thrown: unknown) => thrown)
  assert.ok(badSort instanceof AsasError, 'a malformed sort is an AsasError')
  assert.equal(badSort.status, 400, 'a malformed sort carries 400')
  assert.equal(badSort.message, 'Managed read option "sort" must be a field name, optionally prefixed with "-".', 'the sort refusal keeps the message it always had')
  assert.equal(badSort.key, 'error.invalid.sort', 'the sort refusal carries its message key')
  assert.deepEqual(badSort.params, {}, 'the sort refusal names no value, because its message interpolates none')

  // `protectedField` is where an unknown field name is refused for a caller's
  // own option, and a `where` never reaches it because `assertWhere` refuses
  // one first, so `sort` is the only caller option that gets there.
  const unknownSort = await built.kayan.rows.operations.find({ sort: 'nosuch' }).catch((thrown: unknown) => thrown)
  assert.ok(unknownSort instanceof AsasError, 'a sort naming an unknown field is an AsasError')
  assert.equal(unknownSort.status, 400, 'a sort naming an unknown field carries 400')
  assert.equal(unknownSort.message, 'Kayan "rows" query names unknown field "nosuch".', 'the unknown-field refusal keeps the message it always had')
  assert.equal(unknownSort.key, 'error.invalid.unknown_field', 'the unknown-field refusal carries its message key')
  assert.deepEqual(unknownSort.params, { kayan: 'rows', field: 'nosuch' }, 'the unknown-field refusal carries the kayan and the field its message interpolates')

  // `assertWhere` serves an access callback's return in `defaultAuthorize`,
  // and `assertWhereGrammar` the caller's `where` here, under the caller's own
  // word for it.
  const badWhere = await built.kayan.rows.operations.find({ where: { nosuch: { equals: 1 } } as never }).catch((thrown: unknown) => thrown)
  assert.ok(badWhere instanceof AsasError, 'a where naming an unknown field is an AsasError')
  assert.equal(badWhere.status, 400, 'a where naming an unknown field carries 400')
  assert.equal(badWhere.message, 'Kayan "rows" query names unknown field "nosuch".', 'the where refusal names the caller\'s query, as the sort refusal does, never an access constraint')
  assert.equal(badWhere.key, 'error.invalid.where', 'the where refusal carries its message key')
  // Eighteen throw sites share this key and each names a field, an operator or
  // both, so the params carry the caller's own query beside the kayan: the field
  // and the operator a message names are keys of it, and nothing server-side is.
  assert.deepEqual(
    badWhere.params,
    { kayan: 'rows', where: { nosuch: { equals: 1 } } },
    'the where refusal carries the kayan and the caller\'s own query, which is where the field and the operator its message names are',
  )
})

test('20d2. a kayan with no sortable field can be counted, but a page needs a sort; a relationship target needs an id', async () => {
  const store = memoryStore()
  // The locales belong to this language alone, because a localized field on a language that
  // declares none is refused at `buildAsas`. The screen is here for `sortable: false` alone: every
  // kayan declares an id, and the id sorts unless the declaration takes it out of sorting.
  const mithaq = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), dashboard: screenTarget({ ...dashboardScreen, kayan: ['allLocalized'], pages: { dashboard: { path: '/', component: dashboardScreen.pages.dashboard!.component } } }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const allLocalized = mithaq.defineKayan({
    name: 'allLocalized',
    access: allowAccess,
    fields: {
      id: { kind: 'number', targets: { dashboard: { sortable: false } } },
      title: { kind: 'text', rules: { localized: true } },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [allLocalized] })

  // The declaration is legal and `buildAsas` takes it, which is what keeps the
  // refusal here rather than there: a write of the kayan runs and stores a row.
  const made = await built.kayan.allLocalized.operations.create({ id: 1, title: { ar: 'عنوان', en: 'Title' } } as never)
  assert.deepEqual(made, { id: 1, title: { ar: 'عنوان', en: 'Title' } }, 'a write of it runs, so the kayan is not an impossible one')

  // A relationship pointing at a kayan with no `id` has no id to take its foreign key's type from.
  // That kayan is refused by name before any relationship reads its id, so the pointer never
  // reaches the column builder.
  const idless = mithaq.defineKayan({ name: 'idless', access: allowAccess, fields: { title: { kind: 'text' } }, targets: { service: { operations: defaultOperations } } })
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'pointsAtIdless',
            access: allowAccess,
            fields: { id: { kind: 'number' }, note: { kind: 'relationship', relationTo: () => idless } },
            targets: { service: { operations: defaultOperations } },
          }),
          idless,
        ],
      }),
    /Kayan "idless" declares no field "id"/,
    'a relationship whose target kayan has no id is refused by a sentence naming the target',
  )

  const page = await built.kayan.allLocalized.operations.find().catch((thrown: unknown) => thrown)
  assert.ok(page instanceof AsasError, 'the read that names no sort is a refusal the caller provoked, never a 500')
  assert.equal(page.status, 400, 'as the 400 the same shape already answers when the caller names the sort')
  assert.equal(page.key, 'error.invalid.no_sortable_field', 'under its own key, so a client resolves it in the reader\'s locale')
  assert.deepEqual(page.params, { kayan: 'allLocalized' }, 'carrying the one name its message interpolates')

  const named = await built.kayan.allLocalized.operations.find({ sort: 'title' }).catch((thrown: unknown) => thrown)
  assert.ok(named instanceof AsasError, 'and naming the sort is the refusal it always was')
  assert.equal(named.status, 400, 'at the same status, so the two halves of one impossibility no longer disagree')
  assert.equal(named.key, 'error.invalid.localized_sort', 'under the sort\'s own key')

  assert.deepEqual(await built.kayan.allLocalized.operations.count(), { totalDocs: 1 })
})

test('20e. custom language authorize cannot bypass collection access or read constraints', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: async () => undefined }) },
  })
  const denied = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({ name: 'denied', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, access: { create: () => false }, targets: { service: { operations: defaultOperations } } })],
  })
  await assert.rejects(() => denied.kayan.denied.operations.create({ body: 'nope' }), /create access denied/)

  const constrained = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: {
          create: () => true,
          read: ({ user }) => ({ body: { equals: (user as { body?: string } | null)?.body ?? 'none' } }),
        },
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await constrained.kayan.notes.operations.create({ id: 1, body: 'mine' })
  await constrained.kayan.notes.operations.create({ id: 2, body: 'other' })
  assert.deepEqual((await constrained.kayan.notes.operations.find({}, { actor: { body: 'mine' } })).docs.map((row) => row.id), [1])
  await assert.rejects(() => constrained.kayan.notes.operations.findByID({ id: 2 }, { actor: { body: 'mine' } }), (thrown: unknown) => thrown instanceof AsasError && thrown.status === 404)
})

test('20f. public output schemas run once after field masking for write/read/list', async () => {
  const fields = {
    id: { kind: 'number' },
    title: { kind: 'text', rules: { required: true } },
    secret: { kind: 'text', rules: { required: true }, access: { read: () => false } },
  } satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
  const outputEvents: unknown[] = []
  const output = z.object({ title: z.string(), secret: z.string().optional().default('masked') }).transform((row) => {
    outputEvents.push(row.secret)
    return { title: `${row.title}:${row.secret}` }
  })

  const writeStore = memoryStore()
  const writeLanguage = language(writeStore)
  const writeBuilt = writeLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [writeLanguage.defineKayan({ name: 'writeRows', access: allowAccess, fields, targets: { service: { operations: { ...defaultOperations, create: { ...defaultOperations.create, output } } } } })],
  })
  assert.equal((await writeBuilt.kayan.writeRows.operations.create({ id: 1, title: 'public', secret: 'hidden' })).title, 'public:masked')

  const readStore = memoryStore()
  const readLanguage = language(readStore)
  const readBuilt = readLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      readLanguage.defineKayan({
        name: 'readRows',
        access: allowAccess,
        fields,
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              findByID: { ...defaultOperations.findByID, output },
              find: { ...defaultOperations.find, output },
            },
          },
        },
      }),
    ],
  })
  readStore.rows.set('readRows', [{ id: 1, title: 'public', secret: 'hidden' }])
  assert.equal((await readBuilt.kayan.readRows.operations.findByID({ id: 1 }))?.title, 'public:masked')
  assert.deepEqual((await readBuilt.kayan.readRows.operations.find()).docs.map((row) => row.title), ['public:masked'])
  assert.deepEqual(outputEvents, ['masked', 'masked', 'masked'])

  const reintroduces = z.object({ title: z.string() }).transform((row) => ({ ...row, secret: 'leaked' }))
  const unsafeLanguage = language(memoryStore())
  const unsafeBuilt = unsafeLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [unsafeLanguage.defineKayan({ name: 'unsafeRows', access: allowAccess, fields, targets: { service: { operations: { ...defaultOperations, create: { ...defaultOperations.create, output: reintroduces } } } } })],
  })
  await assert.rejects(
    () => unsafeBuilt.kayan.unsafeRows.operations.create({ id: 1, title: 'public', secret: 'hidden' }),
    /custom output returned protected field "secret"/,
  )
})

/**
 * The same language on a schema target with no validation library behind it, so
 * everything below is proved through `~standard` alone.
 */
const plainLanguage = (store: ReturnType<typeof memoryStore>) =>
  defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'plain', authorize: defaultAuthorize }) },
  })

test('20f1. a function output receives the derived shapes, behaves as the same schema written bare, and is still masked', async () => {
  const fields = {
    id: { kind: 'number' },
    title: { kind: 'text', rules: { required: true } },
    secret: { kind: 'text', rules: { required: true }, access: { read: () => false } },
  } satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
  // The same schema twice: once as data, once as a function of the derived
  // shapes. The function is handed `row`, which is the shape the fields derive,
  // and it is run once at buildAsas.
  const shouted = z.object({ title: z.string() }).transform((row) => ({ title: row.title.toUpperCase() }))
  let handed: string[] = []
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields,
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              bare: { ...defaultOperations.create, output: shouted },
              shout: {
                ...defaultOperations.create,
                output: (schemas) => {
                  handed = Object.keys(schemas).sort()
                  return schemas.row.pick({ title: true }).extend({ title: z.string() }).transform((row) => ({
                    title: row.title.toUpperCase(),
                  }))
                },
              },
            },
          },
        },
      }),
    ],
  })

  assert.deepEqual(handed, ['byID', 'create', 'draft', 'draftWrite', 'id', 'list', 'row', 'update'])
  const fromData = await built.kayan.notes.operations.bare({ id: 1, title: 'quiet', secret: 'hidden' })
  const fromFunction = await built.kayan.notes.operations.shout({ id: 2, title: 'quiet', secret: 'hidden' })
  assert.deepEqual(fromData, { title: 'QUIET' })
  assert.deepEqual(fromFunction, { title: 'QUIET' })
  // The hidden field never reaches the output. It is deleted from the value
  // before the contract runs, so a contract that names it sees nothing.
  assert.equal((fromFunction as Record<string, unknown>).secret, undefined)
  assert.equal(store.rows.get('notes')![1]!.secret, 'hidden')
})

test('20f2. a read step attaches what a nested read returned, and the output function is what lets it leave', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const attachParts = async (ctx: Ctx, tools: Tools): Promise<Ctx> => {
    const row = ctx.data as { id: number } | null
    if (!row) return ctx
    const found = await (tools.kayans as {
      parts: { find(options: unknown): Promise<{ docs: { id: number }[] }> }
    }).parts.find({ where: { machine: { equals: row.id } }, limit: 0, sort: 'id' })
    return { ...ctx, data: { ...row, parts: found.docs } }
  }
  const parts = mithaq.defineKayan({
    name: 'parts',
    access: { ...allowAccess, read: () => ({ machine: { equals: 1 } }) },
    fields: { id: { kind: 'number' }, machine: { kind: 'number' } },
    targets: { service: { operations: defaultOperations } },
  })
  const machines = mithaq.defineKayan({
    name: 'machines',
    access: allowAccess,
    fields: {
      id: { kind: 'number' },
      title: { kind: 'text', rules: { required: true } },
      serial: { kind: 'text', rules: { required: true }, access: { read: () => false } },
    },
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          withParts: {
            steps: ({ steps }) => [steps.findOne, attachParts],
            // The contract omits the field the mask deletes, because masking runs
            // before the output and a contract that still required `serial` would
            // be asking for a value the actor may not read.
            output: ({ row }) => row.omit({ serial: true }).extend({ parts: z.array(z.object({ id: z.number() })) }),
          },
        },
      },
    },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [machines, parts] })
  await built.kayan.machines.operations.create({ id: 1, title: 'lathe', serial: 'S-1' })
  await built.kayan.machines.operations.create({ id: 2, title: 'press', serial: 'S-2' })
  for (const [id, machine] of [[10, 1], [11, 1], [12, 2]] as const) await built.kayan.parts.operations.create({ id, machine })

  const found = (await built.kayan.machines.operations.withParts({ id: 1 })) as Record<string, unknown>
  assert.deepEqual(found.parts, [{ id: 10 }, { id: 11 }])
  assert.equal(found.title, 'lathe')
  assert.equal(found.serial, undefined)
  assert.equal((await built.kayan.machines.operations.findByID({ id: 1 }) as Record<string, unknown>).parts, undefined)
})

test('20f3. a schema target with no validation library runs create, update, find and a custom output', async () => {
  const store = memoryStore()
  const mithaq = plainLanguage(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'plainNotes',
        targets: {
          service: {
            schema: 'plain',
            operations: {
              ...defaultOperations,
              // Composition stays in the developer's own code. The plain target
              // has no `extend`, so the contract is one more `~standard` object
              // over the derived row, and its result is awaited like any other.
              shout: {
                ...defaultOperations.create,
                output: ({ row }) => ({
                  '~standard': {
                    version: 1 as const,
                    vendor: 'plain',
                    validate: async (value: unknown) => {
                      const result = await row['~standard'].validate(value)
                      if (result.issues) return result
                      const held = result.value as Record<string, unknown>
                      return { value: { ...held, shout: String(held.title).toUpperCase() } }
                    },
                  },
                }),
              },
            },
          },
        },
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          title: { kind: 'text', rules: { required: true, maxLength: 10 } },
          body: { kind: 'text' },
        },
      }),
    ],
  })

  const made = await built.kayan.plainNotes.operations.create({ id: 1, title: 'plain', body: null })
  assert.deepEqual(made, { id: 1, title: 'plain', body: null })
  await assert.rejects(
    () => built.kayan.plainNotes.operations.create({ id: 2, title: 7 as never }),
    /title: Invalid input: expected string, received number/,
  )
  await assert.rejects(
    () => built.kayan.plainNotes.operations.create({ id: 2, title: 'far too long to fit' }),
    /title: Too big: expected string to have <=10 characters/,
  )
  await assert.rejects(
    () => built.kayan.plainNotes.operations.create({ id: 2, title: 'ok', stray: 1 } as never),
    /Unrecognized key: "stray"/,
  )

  const changed = await built.kayan.plainNotes.operations.update({ id: 1, body: 'written' })
  assert.equal(changed.body, 'written')
  assert.deepEqual((await built.kayan.plainNotes.operations.find()).docs, [{ id: 1, title: 'plain', body: 'written' }])
  assert.equal(await built.kayan.plainNotes.operations.findByID({ id: 1 }) !== null, true)
  assert.deepEqual(await built.kayan.plainNotes.operations.shout({ id: 3, title: 'loud', body: null }), {
    id: 3,
    title: 'loud',
    body: null,
    shout: 'LOUD',
  })
})

test('20f4. an output built from row without omitting a hidden field throws, because the mask deleted it', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const machines = mithaq.defineKayan({
    name: 'machines',
    access: allowAccess,
    fields: {
      id: { kind: 'number' },
      title: { kind: 'text', rules: { required: true } },
      serial: { kind: 'text', rules: { required: true }, access: { read: () => false } },
    },
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          // The contract names every column, `serial` among them. Masking runs
          // first, so by the time the contract runs that key is gone and the row
          // shape asks for a value that is not there.
          whole: { steps: ({ steps }) => [steps.findOne], output: ({ row }) => row },
          visible: {
            steps: ({ steps }) => [steps.findOne],
            output: ({ row }) => row.omit({ serial: true }),
          },
        },
      },
    },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [machines] })
  await built.kayan.machines.operations.create({ id: 1, title: 'lathe', serial: 'S-1' })
  await assert.rejects(() => built.kayan.machines.operations.whole({ id: 1 }), /serial/)
  assert.deepEqual(await built.kayan.machines.operations.visible({ id: 1 }), { id: 1, title: 'lathe' })
})

test('20f5. a schema that refuses a value and reports no issues still names itself in the throw', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const silent: StandardSchemaV1 = {
    '~standard': { version: 1, vendor: 'silent', validate: () => ({ issues: [] }) },
  }
  const notes = mithaq.defineKayan({
    name: 'notes',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text' } },
    targets: {
      service: {
        operations: {
          ...defaultOperations,
          create: {
            input: () => silent, steps: ({ steps }) => [steps.insert],
          },
        },
      },
    },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [notes] })
  // An empty issue list joins into an empty message, and an Error with no text
  // says nothing at all, so the vendor the schema declares is the fallback.
  await assert.rejects(
    () => built.kayan.notes.operations.create({ body: 'refused with no issues' } as never),
    /The "silent" schema refused the value and reported no issues\./,
  )
})

test('20f6. the plain target list shape constrains no key and still refuses a value that is not an object', () => {
  const { list } = plainTarget.derive({})
  assert.deepEqual(list['~standard'].validate({ where: { id: { equals: 1 } }, limit: 5 }), {
    value: { where: { id: { equals: 1 } }, limit: 5 },
  })
  // A value that is not an object is refused here, so nothing downstream reads
  // `where` off a string and silently finds everything.
  assert.deepEqual(list['~standard'].validate('every note'), {
    issues: [{ message: 'Invalid input: expected object, received string' }],
  })
})

test('20f7. both shipped targets derive an id shape that takes the id alone, refusing a second key, a missing id and an id of the wrong type, and the empty shape where the fields carry no id', async () => {
  const fields = {
    id: { kind: 'number', name: 'id' },
    title: { kind: 'text', name: 'title', rules: { required: true } },
  } as never
  // The two shipped targets, one built on a validation library and one written
  // by hand against `~standard` alone, so what is asserted below is the seam
  // rather than either library.
  for (const [name, derived] of [
    ['zod', zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive(fields).id],
    ['plain', plainTarget.derive(fields).id],
  ] as const) {
    const parse = (value: unknown) => derived['~standard'].validate(value)
    assert.deepEqual(await parse({ id: 1 }), { value: { id: 1 } }, `the ${name} target's id shape takes the id alone`)
    const second = await parse({ id: 1, title: 'Not the id' })
    assert.ok('issues' in second && second.issues, `the ${name} target's id shape refuses a second key`)
    const absent = await parse({})
    assert.ok('issues' in absent && absent.issues, `the ${name} target's id shape refuses a value naming no id`)
    const wrong = await parse({ id: 'one' })
    assert.ok('issues' in wrong && wrong.issues, `the ${name} target's id shape refuses an id of the wrong type`)
  }

  // A field record with no id addresses no row, so the shape it derives admits
  // the empty object and refuses every key.
  for (const [name, derived] of [
    ['zod', zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive({ title: { kind: 'text', name: 'title' } } as never).id],
    ['plain', plainTarget.derive({ title: { kind: 'text', name: 'title' } } as never).id],
  ] as const) {
    assert.deepEqual(
      await derived['~standard'].validate({}),
      { value: {} },
      `the ${name} target derives the empty shape where the fields carry no id`,
    )
    const stray = await derived['~standard'].validate({ title: 'Still not an id' })
    assert.ok('issues' in stray && stray.issues, `that empty ${name} shape refuses every key`)
  }
})

test('20g. read operation steps run and custom input validates once', async () => {
  const store = memoryStore()
  let parses = 0
  let afterRead = false
  let toolKeys: string[] = []
  const mark: Step = (ctx, tools) => {
    afterRead = true
    toolKeys = Object.keys(tools).sort()
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              inspect: {
                input: () => z.object({ id: z.string().transform((value) => { parses += 1; return Number(value) }) }), steps: [findOne, mark],
              },
            },
          },
        },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'one' })
  assert.equal((await built.kayan.notes.operations.inspect({ id: '1' }))?.body, 'one')
  assert.equal(parses, 1)
  assert.equal(afterRead, true)
  assert.deepEqual(toolKeys, ['audit', 'catalog', 'effect', 'kayans', 'kind', 'of', 'operation', 'output', 'publicOutput', 'read', 'schema'])
})

test('20g6. a field callback judges the value a step wrote, not only the value the caller sent', async () => {
  const store = memoryStore()
  const judged: unknown[] = []
  const raiseFee: Step = (ctx) => ({ ...ctx, data: { ...ctx.data, fee: 500 } })
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text' },
          // The verdict depends on the value being written, so an answer given
          // for one value is not an answer for another.
          fee: {
            kind: 'number',
            access: {
              update: ({ siblingData }) => {
                const fee = (siblingData as { fee?: number } | undefined)?.fee
                judged.push(fee)
                return typeof fee === 'number' && fee <= 100
              },
            },
          },
        },
        targets: {
          service: {
            operations: { ...defaultOperations, raise: op([raiseFee, update]) },
          },
        },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'raised', fee: 10 })

  const row = await built.kayan.notes.operations.raise({ id: 1, body: 'changed', fee: 10 })
  // Asked twice: once with the caller's 10, which it allowed, and once with the 500 the step wrote,
  // which it denied. A first answer reused for the second pass would have written the 500. The rest
  // of the change still lands.
  assert.deepEqual(judged, [10, 500])
  assert.equal(row.fee, 10)
  assert.deepEqual(store.rows.get('notes'), [{ id: 1, body: 'changed', fee: 10 }])

  const lower: Step = (ctx) => ({ ...ctx, data: { ...ctx.data, fee: 50 } })
  const second = memoryStore()
  const secondMithaq = language(second)
  const secondBuilt = secondMithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      secondMithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text' },
          fee: { kind: 'number', access: { update: ({ siblingData }) => ((siblingData as { fee?: number }).fee ?? 0) <= 100 } },
        },
        targets: {
          service: {
            operations: { ...defaultOperations, raise: op([lower, update]) },
          },
        },
      }),
    ],
  })
  await secondBuilt.kayan.notes.operations.create({ id: 1, body: 'kept', fee: 10 })
  assert.equal((await secondBuilt.kayan.notes.operations.raise({ id: 1, body: 'changed', fee: 10 })).fee, 50)
})

test('20g7. a nested read uses the service depth cap or its default of eight', async () => {
  const store = memoryStore()
  let built: { kayan: { notes: { operations: { findByID(data: { id: number }): Promise<unknown>; create(data: { id: number; body: string }): Promise<unknown> } } } }
  const readAgain: Step = async (ctx) => {
    await built.kayan.notes.operations.findByID({ id: ctx.data.id as number })
    return ctx
  }
  const mithaq = language(store, 4)
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, findByID: { steps: [readAgain, findOne] } },
          },
        },
      }),
    ],
  }) as typeof built

  await built.kayan.notes.operations.create({ id: 1, body: 'one' })
  await assert.rejects(
    () => built.kayan.notes.operations.findByID({ id: 1 }),
    /Read depth 5 is past the cap of 4: notes\.findByID -> notes\.findByID -> notes\.findByID -> notes\.findByID -> notes\.findByID\.$/,
  )
  const defaultMithaq = language(memoryStore())
  built = defaultMithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [defaultMithaq.defineKayan({
    name: 'notes',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text' } },
    targets: {
      service: {
        operations: { ...defaultOperations, findByID: { steps: [readAgain, findOne] } },
      },
    },
  })] }) as typeof built
  await built.kayan.notes.operations.create({ id: 1, body: 'one' })
  await assert.rejects(() => built.kayan.notes.operations.findByID({ id: 1 }), /Read depth 9 is past the cap of 8/)
})

test('20g8. a custom read operation with the bare validate step takes the id its type says it takes', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            // No validate function, so the shape is the one the read step implies:
            // `findOne` finds a row by id, so the id is required and the call that
            // typechecks is the call that runs.
            operations: { ...defaultOperations, peek: { steps: [findOne] } },
          },
        },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'one' })

  const found = await built.kayan.notes.operations.peek({ id: 1 })
  assert.equal(found?.body, 'one')
  await assert.rejects(() => built.kayan.notes.operations.peek({} as never), /id/)
})

test('20g4. steps get user, dataBefore, persisted dataAfter snapshots and bound kayan tools', async () => {
  const store = memoryStore()
  const seen: unknown[] = []
  let built: {
    kayan: {
      customers: {
        operations: {
          create(data: { id: number; owner: string; name: string }, options?: { actor?: { id: string } }): Promise<unknown>
          findByID(data: { id: number }, options?: { actor?: { id: string } }): Promise<{ id: number; owner: string; name: string } | null>
          update(data: { id: number; name?: string }, options?: { actor?: { id: string } }): Promise<unknown>
        }
      }
      orders: { operations: { create(data: { id: number; customer: number }, options?: { actor?: { id: string } }): Promise<unknown> } }
    }
  }
  const beforeUpdate: Step = (ctx) => {
    seen.push({
      actor: ctx.actor,
      user: ctx.user,
      dataBefore: ctx.dataBefore,
      dataAfter: ctx.dataAfter,
      data: { ...ctx.data },
    })
    assert.throws(
      () => { ;(ctx.dataBefore as Record<string, unknown>).name = 'mutated' },
      /read only property|object is not extensible|Cannot assign/,
    )
    return ctx
  }
  const afterUpdate: Step = (ctx) => {
    seen.push({ dataAfter: ctx.dataAfter, dataBefore: ctx.dataBefore })
    return ctx
  }
  const linkCustomer: Step = async (ctx, tools) => {
    assert.equal(Object.hasOwn(tools.kayans as Record<string, unknown>, 'customers'), true)
    await assert.rejects(
      async () => { await (tools.kayans as any).customers.findByID({ id: ctx.data.customer }, { actor: { id: 'u2' } }) },
      /inherit the current user and context/,
    )
    const customer = await (tools.kayans as any).customers.findByID({ id: ctx.data.customer })
    assert.equal(customer.name, 'New')
    assert.equal((tools.kayans as any).customers.delete, undefined)
    await (tools.kayans as any).customers.update({ id: ctx.data.customer, name: 'Denied child' })
    return ctx
  }
  const mithaq = language(store)
  // A kayan with no delete leaves the bulk made of it out too: nothing drops it.
  const { delete: _delete, deleteMany: _deleteMany, ...withoutDelete } = defaultOperations
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'customers',
        access: {
          create: () => true,
          read: ({ user }) => ({ owner: { equals: (user as { id?: string } | null)?.id ?? 'nobody' } }),
          update: () => false,
        },
        fields: {
          id: { kind: 'number' },
          owner: { kind: 'text', rules: { required: true } },
          name: { kind: 'text', rules: { required: true } },
        },
        targets: {
          service: {
            operations: {
              ...withoutDelete,
              update: { steps: [beforeUpdate, update, afterUpdate] },
            },
          },
        },
      }),
      mithaq.defineKayan({
        name: 'orders',
        access: allowAccess,
        fields: { id: { kind: 'number' }, customer: { kind: 'number', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([linkCustomer, insert]) },
          },
        },
      }),
    ],
  }) as typeof built

  await built.kayan.customers.operations.create({ id: 1, owner: 'u1', name: 'Old' }, { actor: { id: 'u1' } })
  await assert.rejects(
    () => built.kayan.customers.operations.update({ id: 1, name: 'New' }, { actor: { id: 'u1' } }),
    /update access denied/,
  )
  assert.deepEqual(seen, [])

  const allowedLanguage = language(memoryStore())
  const allowed = allowedLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      allowedLanguage.defineKayan({
        name: 'snapshots',
        access: allowAccess,
        fields: { id: { kind: 'number' }, name: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, update: { steps: [beforeUpdate, update, afterUpdate] } },
          },
        },
      }),
    ],
  })
  await allowed.kayan.snapshots.operations.create({ id: 1, name: 'Old' })
  await allowed.kayan.snapshots.operations.update({ id: 1, name: 'New' }, { actor: { id: 'u1' } })
  assert.deepEqual(seen[0], {
    actor: { id: 'u1' },
    user: { id: 'u1' },
    dataBefore: { id: 1, name: 'Old' },
    dataAfter: { id: 1, name: 'Old' },
    data: { id: 1, name: 'New' },
  })
  assert.deepEqual(seen[1], { dataAfter: { id: 1, name: 'New' }, dataBefore: { id: 1, name: 'Old' } })

  await built.kayan.customers.operations.update({ id: 1, name: 'New' }, { actor: { id: 'u1' } }).catch(() => undefined)
  store.rows.set('customers', [{ id: 1, owner: 'u1', name: 'New' }])
  await assert.rejects(
    () => built.kayan.orders.operations.create({ id: 1, customer: 1 }, { actor: { id: 'u1' } }),
    /update access denied/,
  )
  assert.deepEqual(store.rows.get('orders') ?? [], [])
})

test('20g5. read-step bound kayan tools expose only read effects, and a managed write closed over from there opens its own transaction rather than refusing', async () => {
  const store = memoryStore()
  const seen: string[] = []
  let built: {
    kayan: {
      notes: {
        operations: {
          create(data: { id: number; body: string }): Promise<unknown>
          findByID(data: { id: number }): Promise<{ body: string } | null>
          inspect(data: { id: number }): Promise<unknown>
        }
      }
    }
  }
  const inspect: Step = async (ctx, tools) => {
    const kayans = tools.kayans as any
    seen.push(...Object.keys(kayans.notes).sort())
    assert.equal(kayans.notes.create, undefined)
    assert.equal((await kayans.notes.findByID({ id: ctx.data.id }))?.body, 'one')
    // tools.kayans carries no write in read mode, so the closed-over built
    // operation is what a step reaches for a write; the top-level read
    // declares no ambient transactions map, so this opens its own instead of
    // meeting the cross-transaction refusal.
    await built.kayan.notes.operations.create({ id: 2, body: 'from a read step' })
    return ctx
  }
  const mithaq = language(store)
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, inspect: { input: () => z.object({ id: z.number() }), steps: [inspect, findOne] } },
          },
        },
      }),
    ],
  }) as typeof built
  await built.kayan.notes.operations.create({ id: 1, body: 'one' })
  await built.kayan.notes.operations.inspect({ id: 1 })
  assert.deepEqual(seen, ['count', 'find', 'findByID', 'inspect'])
  assert.equal((await built.kayan.notes.operations.findByID({ id: 2 }))?.body, 'from a read step')
})


test('20g1. read authorization runs before custom read/list steps and aliases use the same guard', async () => {
  const store = memoryStore()
  let steps = 0
  const beforeRead: Step = (ctx) => {
    steps += 1
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'guarded',
        access: { create: () => true, read: () => false },
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              findByID: { steps: [beforeRead, findOne] },
              find: { steps: [beforeRead, find] },
            },
          },
        },
      }),
    ],
  })
  await built.kayan.guarded.operations.create({ id: 1, body: 'hidden' })
  await assert.rejects(() => built.kayan.guarded.operations.findByID({ id: 1 }), /read access denied/)
  await assert.rejects(() => built.kayan.guarded.operations.find(), /read access denied/)
  await assert.rejects(() => built.kayan.guarded.operations.count(), /read access denied/)
  assert.equal(steps, 0)
})


test('20g2. read admission carries target id before custom steps', async () => {
  const store = memoryStore()
  let steps = 0
  const beforeRead: Step = (ctx) => {
    steps += 1
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'idGuarded',
        access: {
          create: () => true,
          read: ({ id }) => id === 1 ? true : false,
        },
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, findByID: { steps: [beforeRead, findOne] } },
          },
        },
      }),
    ],
  })
  await built.kayan.idGuarded.operations.create({ id: 1, body: 'allowed' })
  await built.kayan.idGuarded.operations.create({ id: 2, body: 'denied' })
  assert.equal((await built.kayan.idGuarded.operations.findByID({ id: 1 }))?.body, 'allowed')
  assert.equal(steps, 1)
  await assert.rejects(() => built.kayan.idGuarded.operations.findByID({ id: 2 }), /read access denied/)
  assert.equal(steps, 1)
})

test('20g3. custom outputs must return row objects', async () => {
  const fields = { id: { kind: 'number' }, title: { kind: 'text' } } satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
  const scalarLanguage = language(memoryStore())
  const scalar = scalarLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [scalarLanguage.defineKayan({
      name: 'scalarRows',
      access: allowAccess,
      fields,
      targets: {
        service: {
          operations: { ...defaultOperations, create: { ...defaultOperations.create, output: z.object({ title: z.string() }).transform((row) => row.title) } as unknown as typeof defaultOperations.create },
        },
      },
    })],
  })
  await assert.rejects(() => scalar.kayan.scalarRows.operations.create({ id: 1, title: 'x' }), /custom output must return a row object/)

  const arrayLanguage = language(memoryStore())
  const array = arrayLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [arrayLanguage.defineKayan({
      name: 'arrayRows',
      access: allowAccess,
      fields,
      targets: {
        service: {
          operations: { ...defaultOperations, create: { ...defaultOperations.create, output: z.object({ title: z.string() }).transform((row) => [row.title]) } as unknown as typeof defaultOperations.create },
        },
      },
    })],
  })
  await assert.rejects(() => array.kayan.arrayRows.operations.create({ id: 1, title: 'x' }), /custom output must return a row object/)
})

test('20h. a steps function runs once and is sealed like a list, and depth is top-level', async () => {
  const mithaq = language(memoryStore())
  let runs = 0
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: { id: { kind: 'number' }, body: { kind: 'text' } },
      targets: {
        service: {
          operations: {
            ...defaultOperations,
            create: {
              steps: ({ afterSteps, operations, steps }) => {
                runs += 1
                // Two namespaces: the language's operations are on `operations` and the sealed
                // steps on `steps`, so `update` is a list on one and a step on the other with
                // nothing to resolve between them. `afterSteps` is the third thing: the language's
                // own list, which this operation could spread.
                assert.equal('create' in steps, false)
                assert.equal('insert' in operations, false)
                assert.equal(typeof steps.update, 'function')
                assert.equal(Array.isArray(operations.update), true)
                assert.equal(Array.isArray(afterSteps), true)
                return [...operations.create]
              },
            },
          },
        },
      },
    })],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'from a function' })
  await built.kayan.notes.operations.create({ id: 2, body: 'and again' })
  assert.equal(runs, 1)
  assert.throws(
    () => mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({
        name: 'unsealed',
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: { steps: ({ steps }) => [steps.insert, steps.update] } },
          },
        },
      })],
    }),
    /Kayan "unsealed" operation "create" has 2 store or managed read steps/,
  )

  const badDepthLanguage = language(memoryStore(), 0)
  assert.throws(
    () => badDepthLanguage.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [badDepthLanguage.defineKayan({ name: 'badDepth', fields: { id: { kind: 'number' } }, targets: { service: { operations: defaultOperations } } })] }),
    /service\.depth must be a positive integer/,
  )

  const namedLanguage = language(memoryStore())
  const named = namedLanguage.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [namedLanguage.defineKayan({
      name: 'namedDepth',
      access: allowAccess,
      fields: { id: { kind: 'number' }, body: { kind: 'text' } },
      targets: {
        service: {
          operations: { ...defaultOperations, depth: op([insert]) },
        },
      },
    })],
  })
  await named.kayan.namedDepth.operations.depth({ id: 1, body: 'custom name' })
})

test('21. a step is handed bound store calls and no client, and a seal cannot be forged', async () => {
  const store = memoryStore()
  let handed: Record<string, unknown> = {}
  const peek: WriteStep = (ctx, tools) => {
    handed = tools.store as unknown as Record<string, unknown>
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([peek, insert]) },
          },
        },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'peeked' })

  // Only the bound store calls: no `transaction` to open a second
  // one with, and no `db` to write outside the list's transaction through.
  assert.deepEqual(Object.keys(handed).sort(), ['find', 'hold', 'insert', 'remove', 'sum', 'update', 'upsert'])
  assert.equal(handed.transaction, undefined)
  assert.equal(handed.db, undefined)

  // The seal is not a property of the function, so a step cannot claim one it
  // was not given and pass for the store step the list is missing.
  const forged = Object.assign((ctx: Ctx) => ctx, { seal: 'insert' as const })
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'notes',
            fields: { id: { kind: 'number' }, body: { kind: 'text' } },
            targets: {
              service: {
                operations: { ...defaultOperations, create: op([forged]) },
              },
            },
          }),
        ],
      }),
    /Kayan "notes" operation "create" has 0 store or managed read steps/,
  )
})

test('22. the runner fills the defaults no list names, and a write entry that is not a list throws', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const notes = (operations: Record<string, OperationDeclaration>) => () =>
    mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [
        mithaq.defineKayan({
          name: 'notes',
          access: allowAccess,
          fields: { id: { kind: 'number' }, updatedAt: defaultFields.updatedAt, body: { kind: 'text' } },
          targets: {
            service: {
              operations: { ...defaultOperations, ...operations } as Record<string, OperationDeclaration>,
            },
          },
        }),
      ],
    })

  // The fill is the runner's, so a one-word list moves `updatedAt` and a custom
  // list that names no step for it moves it too.
  const built = notes({ archive: op([update]) })()
  const made = await built.kayan.notes.operations.create!({ id: 1, body: 'kept' })
  await setTimeout(2)
  const archive = built.kayan.notes.operations.archive as (data: { id: number; body: string }) => Promise<Record<string, unknown>>
  const changed = await archive({ id: 1, body: 'changed' })
  assert.ok(made.updatedAt instanceof Date, 'the create filled the column nothing sent')
  assert.ok(
    (changed.updatedAt as Date).getTime() > (made.updatedAt as Date).getTime(),
    'and the custom list moved it without naming a step',
  )
  // A list that only removes a row changes no column, so nothing is filled and
  // the id shape it parses is not handed a key it never named.
  assert.doesNotThrow(notes({ purge: op([remove]) }))
  const purged = notes({ purge: op([remove]) })()
  await purged.kayan.notes.operations.create!({ id: 2, body: 'gone' })
  const purge = purged.kayan.notes.operations.purge as (data: { id: number }) => Promise<Record<string, unknown>>
  assert.equal((await purge({ id: 2 })).id, 2, 'a delete list fills nothing and still runs')

  assert.throws(
    notes({ crate: 8 as never }),
    /Kayan "notes" operation "crate" is not an operation declaration/,
  )
})

test('23. the runner never writes into what it was passed, a change with nothing but an id is refused with 400, and a bad id is refused before the store', async () => {
  const store = memoryStore()
  const scribble: Step = (ctx) => {
    ;(ctx.data as Record<string, unknown>).body = 'scribbled'
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([scribble, insert]) },
          },
        },
      }),
    ],
  })

  const data = { id: 1, body: 'kept' }
  const row = await built.kayan.notes.operations.create(data)
  assert.equal(row.body, 'scribbled')
  // The runner copies the values it was handed, so the caller's object is the
  // object the caller wrote, whatever the list did to it.
  assert.deepEqual(data, { id: 1, body: 'kept' })

  // A change with nothing in it but the id is a write that would do nothing,
  // and this kayan has no `updatedAt` for `defaults` to fill. The caller wrote
  // that change, so the refusal is a 400 rather than the 500 an offline client
  // would retry forever.
  const empty = await built.kayan.notes.operations.update({ id: 1 }).catch((thrown: unknown) => thrown)
  assert.ok(empty instanceof AsasError, 'a change with nothing but an id is an AsasError')
  assert.equal(empty.status, 400, 'a change with nothing but an id carries 400')
  assert.match(
    empty.message,
    /Kayan "notes" operation "update" reached the update step with nothing but an id/,
    'the empty-change refusal keeps the message it always had',
  )

  // `delete` parses the id against the kayan's shape, so the store never sees
  // a bad one and the row it would have found is still there.
  await assert.rejects(
    () => built.kayan.notes.operations.delete({ id: 'x' as never }),
    /id: notes\.id\.invalid/,
  )
  assert.equal(store.rows.get('notes')?.length, 1)
  await built.kayan.notes.operations.delete({ id: 1 })
  assert.equal(store.rows.get('notes')?.length, 0)
})

test('24. the context a step is handed is frozen, so no step can reset the depth for the writes under it', async () => {
  const store = memoryStore()
  const meddle: Step = (ctx) => {
    ctx.context.depth = 0
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([meddle, insert]) },
          },
        },
      }),
    ],
  })

  await assert.rejects(
    () => built.kayan.notes.operations.create({ body: 'meddled' }),
    /Cannot assign to read only property 'depth'|Attempted to assign to readonly property/,
  )
  assert.equal(store.rows.get('notes')?.length ?? 0, 0)
})

test('25. a write that joins a transaction its outer write has already settled says which write was not awaited', async () => {
  const store = memoryStore()
  type Nodes = { create(data: { id: number; body: string }): Promise<unknown> }
  let built: { kayan: { nodes: { operations: Nodes } } }
  let late: Promise<unknown> | undefined
  /**
   * Starts another write and never awaits it, so the outer write returns and
   * its transaction settles while the inner one is still waiting to begin.
   */
  const forgets: Step = (ctx) => {
    late = setTimeout(0).then(() => built.kayan.nodes.operations.create({ id: 2, body: 'late' }))
    return ctx
  }
  const mithaq = language(store)
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'nodes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([insert, forgets]) },
          },
        },
      }),
    ],
  }) as typeof built

  await built.kayan.nodes.operations.create({ id: 1, body: 'root' })
  await assert.rejects(
    () => late!,
    /joined the transaction "nodes\.create" opened, which has already settled, so the write that started this one was not awaited/,
  )
  assert.equal(store.rows.get('nodes')?.length, 1)
})

test('26. an addressed operation carries its id inside its one object: update, delete and findByID', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  await built.kayan.notes.operations.create({ id: 1, body: 'written' })
  const changed = await built.kayan.notes.operations.update({ id: 1, body: 'changed' })
  assert.equal(changed.body, 'changed', 'an update whose id is inside the data changes the row')
  assert.equal((await built.kayan.notes.operations.findByID({ id: 1 }))?.body, 'changed', 'findByID takes one object carrying the id')
  await built.kayan.notes.operations.delete({ id: 1 })
  assert.equal(store.rows.get('notes')?.length, 0, 'delete takes one object carrying the id and removes that row')
})

/**
 * Who supplies each field's value, per operation. `ref` is the application's on
 * create and the client's on update, which is the pair a boolean could never
 * say; `seal` is the client's on create and nobody's on update.
 */
const supplierFields = {
  id: { kind: 'number', name: 'id' },
  body: { kind: 'text', name: 'body', rules: { required: true } },
  ref: { kind: 'text', name: 'ref', rules: { providedBy: { create: 'application', update: 'client' } } },
  seal: { kind: 'text', name: 'seal', rules: { providedBy: { create: 'client', update: 'never' } } },
} as never

const fillRef: Step = (ctx) => ({ ...ctx, data: { ...ctx.data, ref: 'filled' } })

const suppliedNotes = <const Ops extends Record<string, OperationDeclaration>>(
  store: ReturnType<typeof memoryStore>,
  operations: Ops = {} as Ops,
) => {
  const mithaq = language(store)
  return mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text', rules: { required: true } },
          ref: { kind: 'text', rules: { providedBy: { create: 'application', update: 'client' } } },
          seal: { kind: 'text', rules: { providedBy: { create: 'client', update: 'never' } } },
        },
        targets: {
          service: {
            operations: { ...defaultOperations, create: op([fillRef, insert]), ...operations },
          },
        },
      }),
    ],
  })
}

test('27. a field the client does not supply for an operation is absent from that operation\'s derived shape, and the two operations are decided apart', async () => {
  const derived = zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive(supplierFields)
  const keys = (shape: unknown) => Object.keys((shape as z.ZodObject).shape)
  // Absent, never optional: the key is not in the object at all, which is what
  // lets the strict object refuse a caller that sends it.
  assert.deepEqual(keys(derived.create), ['id', 'body', 'seal'], 'the create shape leaves out the field the client does not supply on create')
  assert.deepEqual(keys(derived.update), ['id', 'body', 'ref'], 'the update shape leaves out the field nobody supplies on update')
  assert.deepEqual(keys(derived.row), ['id', 'body', 'ref', 'seal'], 'the row shape keeps every column')

  // Two schema targets: the one the `mithaq` package ships, and the one this package writes by hand
  // against `~standard` alone. This package's entrypoint does not export the second.
  for (const [name, shapes] of [
    ['zod', zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive(supplierFields)],
    ['plain', plainTarget.derive(supplierFields)],
  ] as const) {
    const parse = (shape: StandardSchemaV1, value: unknown) => shape['~standard'].validate(value)
    const sent = await parse(shapes.create, { id: 1, body: 'written', ref: 'mine' })
    assert.ok('issues' in sent && sent.issues, `the ${name} target's create shape refuses a field the application supplies`)
    const kept = await parse(shapes.create, { id: 1, body: 'written', seal: 'sealed' })
    assert.ok(!('issues' in kept && kept.issues), `the ${name} target's create shape takes the field the client supplies on create`)
    const sealed = await parse(shapes.update, { id: 1, seal: 'again' })
    assert.ok('issues' in sealed && sealed.issues, `the ${name} target's update shape refuses a field nobody supplies on update`)
    const changed = await parse(shapes.update, { id: 1, ref: 'changed' })
    assert.ok(!('issues' in changed && changed.issues), `the ${name} target's update shape takes the same field, which the client supplies on update`)
  }

  const store = memoryStore()
  const built = suppliedNotes(store)
  const row = await built.kayan.notes.operations.create({ id: 1, body: 'first', seal: 'sealed' } as never)
  assert.equal(row.ref, 'filled', 'the application supplies the field it declares its own')

  const refused = await built.kayan.notes.operations
    .create({ id: 2, body: 'second', ref: 'mine' } as never)
    .catch((error: unknown) => error)
  assert.ok(refused instanceof AsasError && refused.status === 400, 'a caller sending it is refused 400')
  assert.match((refused as Error).message, /Unrecognized key: "ref"/, 'and the refusal names the key')
  assert.equal(store.rows.get('notes')?.length, 1, 'the refused create left no row')

  const updated = await built.kayan.notes.operations.update({ id: 1, ref: 'changed' } as never)
  assert.equal(updated.ref, 'changed', 'the same field is the client\'s on update and lands')
  await assert.rejects(
    () => built.kayan.notes.operations.update({ id: 1, seal: 'again' } as never),
    /Unrecognized key: "seal"/,
  )
})

test('28. a step that writes a field nobody supplies throws naming it, as a plain Error rather than an AsasError', async () => {
  const store = memoryStore()
  const writeSeal: Step = (ctx) => ({ ...ctx, data: { ...ctx.data, seal: 'written by a step' } })
  const built = suppliedNotes(store, { reseal: op([writeSeal, update]) })
  await built.kayan.notes.operations.create({ id: 1, body: 'first', seal: 'sealed' } as never)

  const thrown = await built.kayan.notes.operations.reseal({ id: 1, body: 'changed' } as never).catch((error: unknown) => error)
  assert.ok(thrown instanceof Error, 'the refusal is an Error')
  // Not an `AsasError`, because an `AsasError` says the caller did this and
  // carries a status a client is shown. Nobody supplies this field, so the step
  // that wrote one is the project's own bug, and a project bug is a hidden 500.
  assert.equal(thrown instanceof AsasError, false, 'the refusal is not an AsasError, so it is a hidden 500 rather than a caller\'s 400')
  assert.match(
    (thrown as Error).message,
    /Kayan "notes" operation "reseal" wrote field "seal", which declares providedBy "never" on update/,
    'the refusal names the field',
  )
  assert.deepEqual(
    store.rows.get('notes'),
    [{ id: 1, body: 'first', ref: 'filled', seal: 'sealed' }],
    'the throw came before the store step, so the row is unchanged',
  )
})

test('29. a field that declares no providedBy is in every shape it was in before', async () => {
  const fields = {
    id: { kind: 'number', name: 'id' },
    body: { kind: 'text', name: 'body', rules: { required: true } },
    ref: { kind: 'text', name: 'ref' },
  } as never
  const derived = zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive(fields)
  const keys = (shape: unknown) => Object.keys((shape as z.ZodObject).shape)
  // The default for a field that says nothing: the client supplies it on create and on update
  // alike.
  assert.deepEqual(keys(derived.create), ['id', 'body', 'ref'], 'the create shape keeps a field that declares nothing')
  assert.deepEqual(keys(derived.update), ['id', 'body', 'ref'], 'the update shape keeps it too')
  assert.deepEqual(keys(derived.row), ['id', 'body', 'ref'], 'and so does the row')

  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } }, ref: { kind: 'text' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const row = await built.kayan.notes.operations.create({ id: 1, body: 'written', ref: 'mine' })
  assert.equal(row.ref, 'mine', 'the client supplies it on create')
  const changed = await built.kayan.notes.operations.update({ id: 1, ref: 'changed' })
  assert.equal(changed.ref, 'changed', 'and on update')
})

test('30. a field that declares both a defaultValue and a provider other than the client\'s builds, and the two halves work together', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = (rules: Rules) =>
    mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [
        mithaq.defineKayan({
          name: 'notes',
          access: allowAccess,
          fields: { id: { kind: 'number' }, body: { kind: 'text', rules: rules as never } },
          targets: { service: { operations: defaultOperations } },
        }),
      ],
    })

  // The validate step sets a server-provided value aside before the parse, so this pair is the
  // ordinary way to say "the runner fills this and no caller may send it".
  assert.doesNotThrow(
    () => built({ defaultValue: 'draft', providedBy: { create: 'application' } }),
    'a defaultValue beside a provider that is not the client\'s builds',
  )
  assert.doesNotThrow(
    () => built({ defaultValue: 'draft', providedBy: { create: 'client', update: 'never' } }),
    'and so does the same pair on update',
  )
  assert.doesNotThrow(built.bind(null, { defaultValue: 'draft' }), 'a defaultValue alone is left alone')
  assert.doesNotThrow(
    built.bind(null, { providedBy: { create: 'application', update: 'never' } }),
    'a provider alone is left alone',
  )

  const one = built({ defaultValue: 'draft', providedBy: { create: 'application' } })
  const made = await one.kayan.notes.operations.create({ id: 1 })
  assert.equal(made.body, 'draft', 'the defaults step fills the field the client does not supply')
  const refused = await one.kayan.notes.operations.create({ id: 2, body: 'mine' } as never).catch((error: unknown) => error)
  assert.ok(refused instanceof AsasError && refused.status === 400, 'and a caller sending it is refused 400')
  assert.match((refused as Error).message, /Unrecognized key: "body"/, 'by the key the wire shape never carried')
})

test('31. the refusal of a field nobody supplies is asked at the store step alone, because past it the data is the row and not what a step wrote', async () => {
  const store = memoryStore()
  const writeSeal: Step = (ctx) => ({ ...ctx, data: { ...ctx.data, seal: 'written by a step' } })
  const built = suppliedNotes(store, { reseal: op([update, writeSeal]) })
  await built.kayan.notes.operations.create({ id: 1, body: 'first', seal: 'sealed' } as never)

  // The gap, stated rather than closed: a step past the store step is not
  // refused, and its value reaches the caller through the row shape, which
  // holds every column whoever supplied it.
  const resealed = await built.kayan.notes.operations.reseal({ id: 1, body: 'changed' } as never)
  assert.equal(resealed.seal, 'written by a step', 'a step past the store step is not refused, and its value is what the caller reads')
  assert.equal(
    store.rows.get('notes')?.[0]?.seal,
    'sealed',
    'the column is untouched, because the store step had already run when the step wrote',
  )

  // A second ask comparing `ctx.data` against `ctx.dataAfter` would not close it: the store step
  // sets both from the same row, so the comparison would catch a step's own write after the store
  // step but miss a step that writes the row's own value back. This plain update, where no step
  // wrote anything, carries the field back the same way.
  const plain = await built.kayan.notes.operations.update({ id: 1, ref: 'changed' } as never)
  assert.equal(plain.seal, 'sealed', 'a plain update carries the same field back, written on this call by nobody')
})

test('32. a global\'s first update parses against the create shape, so a field nobody supplies on update lands on that one call and is refused on the next', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [],
    global: [
      mithaq.defineGlobal({
        name: 'settings',
        access: { read: () => true, update: () => true },
        fields: {
          id: { kind: 'number', rules: { defaultValue: 1 } },
          title: { kind: 'text' },
          seal: { kind: 'text', rules: { providedBy: { create: 'client', update: 'never' } } },
          ...defaultGlobalFields,
        },
        targets: { service: { operations: defaultGlobalOperations } },
      }),
    ],
  })

  // There is no row, so the upsert flips the kind to insert and the create
  // shape is what the write parses against. Coherent, since an upsert is a
  // create, and the field is the client's there.
  const made = await built.global.settings.operations.update({ title: 'first', seal: 'sealed' } as never)
  assert.equal(made.seal, 'sealed', 'the field nobody supplies on update lands on the upsert, which is a create')
  // The store seal writes the global's own name into globalType on every write, and the check that
  // refuses a step writing a field nobody supplies runs over the same object. It never catches the
  // runner's own write, because globalType declares no provider at all and so is the client's on
  // both operations.
  assert.equal(made.globalType, 'settings', 'and the store seal\'s own globalType write is not what the check catches')

  const refused = await built.global.settings.operations
    .update({ title: 'second', seal: 'again' } as never)
    .catch((error: unknown) => error)
  assert.ok(refused instanceof AsasError && refused.status === 400, 'the row now exists, so the update shape is what refuses it')
  assert.match((refused as Error).message, /Unrecognized key: "seal"/, 'and the refusal names the key')

  const changed = await built.global.settings.operations.update({ title: 'third' } as never)
  assert.equal(changed.title, 'third', 'an update that sends nobody\'s field lands')
  assert.equal(changed.globalType, 'settings', 'and the globalType write passes the check on the update branch too')
})

test('32a. a global whose update takes expectedUpdatedAt makes its row on a first save that sends the key or leaves it out, and checks it once the row exists', async () => {
  const mithaq = language(memoryStore())
  const guarded = <const Name extends string>(name: Name) => mithaq.defineGlobal({
    name,
    access: { read: () => true, update: () => true },
    fields: { ...defaultFields, ...defaultGlobalFields, title: { kind: 'text' } },
    targets: { service: { operations: { ...defaultGlobalOperations, update: { input: ({ update }) => update.extend({ expectedUpdatedAt: z.date() }), steps: [expectedUpdatedAt, update] } } } },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [], global: [guarded('profile'), guarded('brand')] })
  const { profile, brand } = built.global
  // The key is still held to the input that adds it, so a value that is no instant is refused before any row is made.
  await assert.rejects(profile.operations.update({ title: 'bad', expectedUpdatedAt: 'not a date' as never }), (error: AsasError) => error.status === 400 && /expectedUpdatedAt/.test(error.message))
  assert.equal(await profile.operations.findOne(), null)
  // A caller that has read no row has no instant to send, and one that sends some instant is not refused for it.
  const made = await profile.operations.update({ title: 'first', expectedUpdatedAt: new Date(0) })
  assert.equal(made.title, 'first')
  assert.equal((await brand.operations.update({ title: 'first' })).title, 'first')
  // Once the row exists the step holds the update to the instant it was read at.
  await assert.rejects(profile.operations.update({ title: 'stale', expectedUpdatedAt: new Date(0) }), (error: AsasError) => error.status === 409)
  assert.equal((await profile.operations.update({ title: 'second', expectedUpdatedAt: made.updatedAt })).title, 'second')
})

// A localized field's value is one object keyed by locale, and that is a claim about every schema
// target rather than about zod: the locales reach a target on the resolved field, which is the one
// value both of a target's maps and its `derive` already take.
test('33. both schema targets derive a localized field as one object keyed by locale, requiring every declared locale and refusing any other', async () => {
  const localizedFields = {
    id: { kind: 'number', name: 'id', column: 'id' },
    title: {
      kind: 'text',
      name: 'title',
      column: 'title',
      locales: ['ar', 'en'],
      rules: { localized: true, required: true, maxLength: 4 },
    },
  }
  for (const [name, shapes] of [
    ['zod', zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive(localizedFields as never)],
    ['plain', plainTarget.derive(localizedFields as never)],
  ] as const) {
    const parse = (shape: StandardSchemaV1, value: unknown) => shape['~standard'].validate(value)
    for (const [which, rest] of [['create', {}], ['update', { id: 1 }], ['row', { id: 1 }]] as const) {
      const shape = shapes[which]
      const whole = await parse(shape, { ...rest, title: { ar: 'عنو', en: 'Ttl' } })
      assert.ok(!('issues' in whole && whole.issues), `the ${name} target's ${which} shape takes an object carrying every declared locale`)
      const short = await parse(shape, { ...rest, title: { ar: 'عنو' } })
      assert.ok('issues' in short && short.issues, `the ${name} target's ${which} shape refuses an object short of a declared locale`)
      const stray = await parse(shape, { ...rest, title: { ar: 'عنو', en: 'Ttl', fr: 'Titre' } })
      assert.ok('issues' in stray && stray.issues, `the ${name} target's ${which} shape refuses a locale the language never declared`)
      // The rules narrow each locale's own value on a write, because `localized` runs after them
      // and before `required`. The row holds each locale to its kind alone, so a value stored
      // before the rule tightened still reads.
      const tooLong = await parse(shape, { ...rest, title: { ar: 'عنو', en: 'Far too long' } })
      if (which === 'row') assert.ok(!('issues' in tooLong && tooLong.issues), `the ${name} target's row shape applies no length rule`)
      else assert.ok('issues' in tooLong && tooLong.issues, `the ${name} target's ${which} shape applies a length rule to each locale's own value`)
    }
  }
})

/**
 * The wire contract and the internal parse are two things. The derived shapes are the wire, and
 * they leave out every field whose provider for the operation is not the client, so a caller
 * sending one is refused by name. What the runner itself wrote is set aside before the parse and
 * put back after it, which is what lets a field declare both a `defaultValue` and a provider that
 * is not the client's.
 */
test('34. the timestamps the runner owns are out of both wire shapes, filled by the defaults step and set aside by the parse', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({ name: 'notes', access: allowAccess, fields: { ...defaultFields, body: { kind: 'text' } }, targets: { service: { operations: defaultOperations } } })],
  })

  // The memory store fills no column, where the uuid column's own default
  // would, so every create here names its id.
  const made = await built.kayan.notes.operations.create({ id: crypto.randomUUID(), body: 'written' })
  assert.ok(made.createdAt instanceof Date, 'the defaults step still fills createdAt, which no shape parses')
  assert.ok(made.updatedAt instanceof Date, 'and updatedAt beside it')

  const sentOnCreate = await built.kayan.notes.operations
    .create({ id: crypto.randomUUID(), body: 'again', createdAt: new Date(0) } as never)
    .catch((error: unknown) => error)
  assert.ok(sentOnCreate instanceof AsasError && sentOnCreate.status === 400, 'a create sending createdAt is refused 400')
  assert.match((sentOnCreate as Error).message, /Unrecognized key: "createdAt"/, 'and the refusal names the key')

  const sentOnUpdate = await built.kayan.notes.operations
    .update({ id: made.id, updatedAt: new Date(0) } as never)
    .catch((error: unknown) => error)
  assert.ok(sentOnUpdate instanceof AsasError && sentOnUpdate.status === 400, 'an update sending updatedAt is refused 400')
  assert.match((sentOnUpdate as Error).message, /Unrecognized key: "updatedAt"/, 'and that refusal names its key')

  // The defaults step writes `updatedAt` on every write that changes a row and `createdAt` on the
  // insert alone, and the parse does not stand between either value and the store.
  await setTimeout(2)
  const changed = await built.kayan.notes.operations.update({ id: made.id, body: 'changed' } as never)
  assert.equal(
    (changed.createdAt as Date).getTime(),
    (made.createdAt as Date).getTime(),
    'an update leaves createdAt where the insert put it',
  )
  assert.ok(
    (changed.updatedAt as Date).getTime() > (made.updatedAt as Date).getTime(),
    'and moves updatedAt to the moment of the write',
  )
})

test('35. a global\'s globalType is unchanged by the split: the runner writes it, a caller naming it is refused 403, and the shapes still carry it', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [],
    global: [
      mithaq.defineGlobal({
        name: 'settings',
        access: { read: () => true, update: () => true },
        fields: { id: { kind: 'number', rules: { defaultValue: 1 } }, title: { kind: 'text' }, ...defaultGlobalFields },
        targets: { service: { operations: defaultGlobalOperations } },
      }),
    ],
  })

  const made = await built.global.settings.operations.update({ title: 'first' } as never)
  assert.equal(made.globalType, 'settings', 'the store seal still writes the global\'s own name')

  // `globalType` declares no provider, so it is the client's on both operations
  // and stays in both shapes; what refuses a caller naming it is the runner's
  // own 403, raised before the transaction opens.
  const sent = await built.global.settings.operations.update({ title: 'second', globalType: 'x' } as never).catch((error: unknown) => error)
  assert.ok(sent instanceof AsasError && sent.status === 403, 'a caller naming globalType is refused 403, not 400')
  assert.match((sent as Error).message, /cannot write field "globalType"/, 'and the refusal names the field')
})

/**
 * A row's organization is the field bound to the tenant target and never a field's name: a column
 * called `tenant` in a language that lays down no tenant target is an ordinary column, written as
 * its `providedBy` lets a caller write it, with no guard the runner keeps for it. The guard on the
 * bound field is `tenant-scope.test.ts`'s.
 */
test('36. a column called tenant is an ordinary column: the runner keeps no guard for a name, and its default and a caller\'s value land as any field\'s do', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          body: { kind: 'text' },
          tenant: { kind: 'text', rules: { defaultValue: tenanted.activeOrganizationId as never } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const actor = { id: 'u1', activeOrganizationId: 'org1' }

  const made = await built.kayan.notes.operations.create({ id: 1, body: 'written' }, { actor })
  assert.equal(made.tenant, 'org1', 'the defaults step fills the column from the actor')
  const named = await built.kayan.notes.operations.create({ id: 2, body: 'named', tenant: 'org2' }, { actor })
  assert.equal(named.tenant, 'org2', 'and a caller writes it as the field lets it')
  assert.deepEqual(store.rows.get('notes')?.map((row) => row.tenant), ['org1', 'org2'])
})

/**
 * The service target's own `authorize` answers a `Where` like a kayan's access callback does, and
 * the combined authorizer proves it the same way. Without the assertion the malformed path would
 * reach the store, which reads it as a column and refuses in its own words: a project's bug
 * reported from whichever store the language names.
 */
test('37. a language authorize returning a malformed constraint is refused by queryField\'s own sentence, as a plain Error', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: store,
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: serviceTarget({
        depth: defaultDepth,
        defaultLimit,
        maxLimit: defaultMaxLimit,
        joinLimit: defaultJoinLimit,
        bulkLimit: defaultBulkLimit,
        store: 'memory',
        schema: 'zod',
        // `title` is not localized, so a second segment names a related field
        // of what a relationship points at, and `title` points at nothing.
        authorize: async () => ({ 'title.ar': { equals: 'x' } }) as never,
      }),
    },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, title: { kind: 'text' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  const thrown = await built.kayan.notes.operations.find().catch((error: unknown) => error)
  assert.ok(thrown instanceof Error, 'the malformed constraint is refused')
  // Not an `AsasError`: the language wrote the constraint, so it is the
  // project's bug and a hidden 500, never a caller's 400.
  assert.equal(thrown instanceof AsasError, false, 'as a plain Error, so a hidden 500 rather than a caller\'s fault')
  assert.match(
    (thrown as Error).message,
    /Kayan "notes" access constraint path "title\.ar" is unsupported\./,
    'in queryField\'s own sentence rather than the store\'s',
  )

  const open = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: async () => undefined }) },
  })
  const plain = open.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [open.defineKayan({ name: 'notes', access: allowAccess, fields: { id: { kind: 'number' }, title: { kind: 'text' } }, targets: { service: { operations: defaultOperations } } })],
  })
  assert.equal((await plain.kayan.notes.operations.find()).totalDocs, 0, 'a language that answers no constraint reads as it always did')
})

test('38. the three normalizing rules rewrite a value before every narrowing rule judges it, on each locale of a localized field, on either schema target, and the address a lowercased email holds still parses as one', async () => {
  const store = memoryStore()
  // The locales are this language's own, because a localized field on a
  // language that declares none is refused at `buildAsas`.
  const mithaq = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const fields = {
    // A code a person types in whatever case, stored in one, and a maximum that judges the stored
    // value rather than the typed one.
    sku: { kind: 'text', rules: { uppercase: true, maxLength: 5 } },
    contact: { kind: 'email', rules: { lowercase: true } },
    name: { kind: 'text', rules: { trim: true, minLength: 1 } },
    title: { kind: 'text', rules: { localized: true, uppercase: true } },
    // Both transforms on one field, which is not the refused pair: each
    // rewrites a different part of the value, so the order they run in
    // cannot change what is stored.
    code: { kind: 'text', rules: { trim: true, uppercase: true } },
  } satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
  const parts = mithaq.defineKayan({ name: 'parts', access: allowAccess, fields: { id: { kind: 'number' }, ...fields }, targets: { service: { operations: defaultOperations } } })
  // The same five fields under the second schema target. None is `required`, so `resolve` fills
  // `required: false` into every one, and each shape is wrapped before the write reaches it: the
  // wrappers carry the rewrite through, and a localized field is wrapped twice.
  const plainParts = mithaq.defineKayan({ name: 'plainParts', targets: { service: { schema: 'plain', operations: defaultOperations } }, access: allowAccess, fields: { id: { kind: 'number' }, ...fields } })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [parts, plainParts] })

  for (const [target, kayan] of [
    ['zod', built.kayan.parts],
    ['plain', built.kayan.plainParts],
  ] as const) {
    assert.deepEqual(
      await kayan.operations.create({
        id: 1,
        sku: 'abc-1',
        contact: 'Sales@Acme.test',
        name: '  Acme  ',
        title: { ar: 'عنوان', en: 'Title' },
        code: '  x-1 ',
      } as never),
      {
        id: 1,
        sku: 'ABC-1',
        contact: 'sales@acme.test',
        name: 'Acme',
        title: { ar: 'عنوان', en: 'TITLE' },
        code: 'X-1',
      },
      `every rule rewrites the value the ${target} target hands the store, and a localized field is rewritten one locale at a time`,
    )
  }

  // The maximum judges the normalized value: six characters are six whatever
  // their case, and the refusal is the length rule's own key rather than a
  // sentence about case, because no case is ever refused.
  const long = await built.kayan.parts.operations.create({ sku: 'abcdef' } as never).catch((thrown: unknown) => thrown)
  assert.equal((long as AsasError).status, 400, 'a value a narrowing rule refuses is a 400')
  assert.deepEqual(
    (long as AsasError).params,
    { issues: [{ path: 'sku', message: 'parts.sku.maxLength' }] },
    'a value the rewritten length refuses carries the length rule\'s key',
  )

  const blank = await built.kayan.parts.operations.create({ name: '   ' } as never).catch((thrown: unknown) => thrown)
  assert.deepEqual(
    (blank as AsasError).params,
    { issues: [{ path: 'name', message: 'parts.name.minLength' }] },
    'a value the trim empties is refused by the minimum, not silently stored',
  )

  const wrong = await built.kayan.parts.operations.create({ contact: 'Nope' } as never).catch((thrown: unknown) => thrown)
  assert.deepEqual(
    (wrong as AsasError).params,
    { issues: [{ path: 'contact', message: 'parts.contact.invalid' }] },
    'the email kind judges the lowercased value, so a string that is no address is still refused',
  )
})

test('104. a bulk over more rows than the ceiling is refused under its own key before one row is written, and a bulk at the ceiling goes through', async () => {
  // The number this file's language names, the template's, written here rather than imported so the
  // test says the number.
  const ceiling = 1000
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' }, round: { kind: 'number' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  // Seeded into the store rather than created one at a time: the ceiling is
  // about how many rows one call may hold, and a thousand creates would say
  // nothing more about it than a thousand rows do.
  const seed = (count: number) =>
    store.rows.set('notes', Array.from({ length: count }, (_, index) => ({ id: index + 1, body: 'seed', round: 0 })))

  seed(ceiling)
  const atCeiling = await built.kayan.notes.operations.updateMany({ where: { body: { equals: 'seed' } }, data: { round: 1 } })
  assert.equal(atCeiling.docs.length, ceiling, 'a bulk matching exactly the ceiling writes every one of its rows')
  assert.deepEqual([...new Set(store.rows.get('notes')!.map((row) => row.round))], [1], 'and every row carries the change')

  seed(ceiling + 1)
  const refused = await built.kayan.notes.operations
    .updateMany({ where: { body: { equals: 'seed' } }, data: { round: 2 } })
    .catch((thrown: unknown) => thrown)
  assert.ok(refused instanceof AsasError, 'one row past the ceiling is refused')
  assert.equal(refused.status, 400, 'as a 400')
  assert.equal(refused.key, 'error.invalid.bulk_limit', 'under its own key')
  assert.match(
    refused.message,
    new RegExp(`matched ${ceiling + 1} rows[\\s\\S]*at most ${ceiling}`),
    'in a sentence naming what it matched and what it may hold',
  )
  // This store rolls nothing back, so a row written before the refusal would
  // still be written here: every row holding what it was seeded with is the
  // proof the refusal came before the loop.
  assert.deepEqual(
    [...new Set(store.rows.get('notes')!.map((row) => row.round))],
    [0],
    'and not one row was written before it',
  )
})

/**
 * A language on one in-memory store with the three slots, so a test can watch what runs inside the
 * transaction, what runs outside it, and what the audit sink was handed.
 */
const slotted = (
  store: ReturnType<typeof memoryStore>,
  slots: {
    afterSteps?: readonly Step[]
    afterCommit?: readonly Step[]
    beforeSteps?: readonly Step[]
    audit?: (entry: { operation: string; dataBefore?: unknown; dataAfter: unknown }) => void
  } = {},
) =>
  defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize, beforeSteps: slots.beforeSteps ?? [], afterSteps: slots.afterSteps ?? (slots.audit ? [audit] : []), afterCommit: slots.afterCommit ?? [], ...(slots.audit ? { audit: slots.audit as never } : {}) }) },
  })

test('109. every shipped list is one word, and the runner fills the defaults, parses the derived shape and audits around it', async () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(defaultOperations).map(([name, one]) => [name, one.steps.length])),
    { create: 1, update: 1, delete: 1, find: 1, findByID: 1, count: 1, updateMany: 1, deleteMany: 1 },
    'every shipped list is its one store or managed read step',
  )
  const entries: { operation: string; dataBefore?: unknown; dataAfter: unknown }[] = []
  const store = memoryStore()
  const mithaq = slotted(store, { audit: (entry) => void entries.push(entry) })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          updatedAt: defaultFields.updatedAt,
          body: { kind: 'text', rules: { required: true } },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      mithaq.defineKayan({
        name: 'locked',
        access: { ...allowAccess, create: () => false },
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })

  const row = await built.kayan.notes.operations.create({ id: 1, body: 'kept' })
  assert.equal(row.body, 'kept', 'the insert wrote the row')
  assert.ok(row.updatedAt instanceof Date, 'and the defaults the runner fills reached the column')
  assert.deepEqual(
    entries.map((entry) => entry.operation),
    ['create'],
    'the service target\'s afterSteps audited the write, with no audit step in the operation list',
  )
  assert.equal(entries[0]!.dataBefore, undefined, 'a create has no row before it')

  const bad = await built.kayan.notes.operations.create({ id: 2, body: 7 as never }).catch((thrown: unknown) => thrown)
  assert.ok(bad instanceof AsasError, 'a bad value is still the caller\'s fault')
  assert.equal(bad.status, 400, 'and still a 400')
  const denied = await built.kayan.locked.operations.create({ id: 3, body: 'no' }).catch((thrown: unknown) => thrown)
  assert.ok(denied instanceof AsasError, 'a denied actor is still refused')
  assert.equal(denied.status, 403, 'and still a 403, before anything opens')
  assert.equal(store.rows.get('locked'), undefined, 'so the denied write reached no store at all')
})

test('110. an operation that names input parses the caller\'s own shape, and the defaults fill after that parse', async () => {
  const store = memoryStore()
  const mithaq = slotted(store)
  const markArchived = (ctx: Ctx): Ctx => {
    const { reason } = ctx.data as { reason: string }
    return { ...ctx, data: { ...ctx.data, archived: true, archiveReason: reason } }
  }
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          updatedAt: defaultFields.updatedAt,
          body: { kind: 'text' },
          archived: { kind: 'checkbox' },
          archiveReason: { kind: 'text' },
        },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              archive: {
                input: () => z.object({ id: z.number(), reason: z.string().max(200) }).strict(),
                steps: [markArchived, update],
              },
            },
          },
        },
      }),
    ],
  })

  // Every column, because this store writes what it is handed and the row boundary wants each one.
  const made = await built.kayan.notes.operations.create({ id: 1, body: 'kept', archived: false, archiveReason: null })
  await setTimeout(2)
  const archived = await built.kayan.notes.operations.archive({ id: 1, reason: 'duplicate' })
  assert.equal(archived.archived, true, 'the step\'s own columns were written')
  assert.equal(archived.archiveReason, 'duplicate', 'from the operation\'s own word')
  assert.ok(
    (archived.updatedAt as Date).getTime() > (made.updatedAt as Date).getTime(),
    'and the defaults filled updatedAt after the parse, so a strict input shape never refused it',
  )

  const missing = await built.kayan.notes.operations.archive({ id: 1 } as never).catch((thrown: unknown) => thrown)
  assert.ok(missing instanceof AsasError, 'the caller\'s own shape is what refuses a missing key')
  assert.equal(missing.status, 400, 'as a 400')
  const stray = await built.kayan.notes.operations
    .archive({ id: 1, reason: 'ok', body: 'sneaked' } as never)
    .catch((thrown: unknown) => thrown)
  assert.ok(stray instanceof AsasError, 'and a strict shape refuses a column of the kayan it never named')
  assert.equal(stray.status, 400, 'as a 400 too')
})

test('111. a list that writes defaults, validate or audit is refused at buildAsas by name', () => {
  const mithaq = slotted(memoryStore())
  const notes = (operations: Record<string, OperationDeclaration>) => () =>
    mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, targets: { service: { operations: { ...defaultOperations, ...operations } } } })],
    })

  assert.throws(
    notes({ create: { steps: [defaults, insert] } }),
    /Kayan "notes" operation "create" writes the "defaults" step/,
  )
  assert.throws(
    notes({ create: { steps: [validate, insert] } }),
    /Kayan "notes" operation "create" writes the "validate" step/,
  )
  assert.throws(
    notes({ create: { steps: [insert, audit] } }),
    /Kayan "notes" operation "create" writes the "audit" step, and audit is a step of the service target's "afterSteps"/,
  )
  // The factory form of the validate step is the same step, so it is refused in the same words and
  // pointed at the same key.
  assert.throws(
    notes({ archive: { steps: [(validate as unknown as (of: unknown) => WriteStep)(() => z.object({})), update] } }),
    /Kayan "notes" operation "archive" writes the "validate" step/,
  )
  assert.doesNotThrow(notes({ create: { steps: [insert] } }), 'and the one word builds')
})

test('112. a store or managed read step outside steps is refused by name, on an operation\'s slot and on the language\'s alike', () => {
  const store = memoryStore()
  const withSlots = (slots: Parameters<typeof slotted>[1]) => () => {
    const mithaq = slotted(store, slots)
    return mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, targets: { service: { operations: defaultOperations } } })],
    })
  }
  assert.throws(
    withSlots({ beforeSteps: [insert as unknown as Step] }),
    /Kayan "notes" operation "create" holds the "insert" step in "beforeSteps"/,
  )
  assert.throws(
    withSlots({ afterSteps: [audit, findOne as unknown as Step] }),
    /Kayan "notes" operation "create" holds the "findOne" step in "afterSteps"/,
  )
  assert.throws(
    withSlots({ afterCommit: [remove as unknown as Step] }),
    /Kayan "notes" operation "create" holds the "remove" step in "afterCommit"/,
  )
  // `audit` is the one sealed step a slot may hold, and holds it in
  // `afterSteps` alone: the other two run outside the transaction, where it is
  // handed no `tx` and a store that refuses every write.
  assert.throws(
    withSlots({ afterCommit: [audit] }),
    /Kayan "notes" operation "create" writes the "audit" step in "afterCommit", and "afterSteps" is audit's slot/,
  )
  assert.throws(
    withSlots({ beforeSteps: [audit] }),
    /Kayan "notes" operation "create" writes the "audit" step in "beforeSteps", and "afterSteps" is audit's slot/,
  )

  const mithaq = slotted(store)
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'notes',
            fields: { id: { kind: 'number' }, body: { kind: 'text' } },
            targets: {
              service: {
                operations: { ...defaultOperations, create: { steps: [insert], afterSteps: [update] } as never },
              },
            },
          }),
        ],
      }),
    /Kayan "notes" operation "create" holds the "update" step in "afterSteps"/,
  )
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'notes',
            fields: { id: { kind: 'number' }, body: { kind: 'text' } },
            targets: {
              service: {
                operations: { ...defaultOperations, create: { steps: [insert], beforeTransaction: [insert] } as never },
              },
            },
          }),
        ],
      }),
    /Kayan "notes" operation "create" holds the "insert" step in "beforeTransaction"/,
  )
  const mark: Step = (ctx) => ctx
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'notes',
            fields: { id: { kind: 'number' }, body: { kind: 'text' } },
            targets: {
              service: {
                operations: { ...defaultOperations, create: { steps: [insert], beforeTransaction: [audit] } as never },
              },
            },
          }),
        ],
      }),
    /Kayan "notes" operation "create" writes the "audit" step in "beforeTransaction", and "afterSteps" is audit's slot/,
    'an operation may not take audit outside afterSteps either',
  )
  // Written on an operation, `beforeSteps` is refused by name rather than
  // dropped, so a precondition an operation restated cannot go missing quietly.
  assert.throws(
    () =>
      mithaq.buildAsas({
        http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
        kayan: [
          mithaq.defineKayan({
            name: 'notes',
            fields: { id: { kind: 'number' }, body: { kind: 'text' } },
            targets: { service: { operations: { ...defaultOperations, create: { steps: [insert], beforeSteps: [mark] } as never } } },
          }),
        ],
      }),
    /Kayan "notes" operation "create" declares "beforeSteps", and that list is the service target's alone/,
  )
})

test('113. beforeTransaction and afterCommit on a read are refused by name, because a read opens no transaction', () => {
  const mithaq = slotted(memoryStore())
  const notes = (operations: Record<string, OperationDeclaration>) => () =>
    mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' } }, targets: { service: { operations: { ...defaultOperations, ...operations } } } })],
    })
  const mark: Step = (ctx) => ctx

  assert.throws(
    notes({ findByID: { steps: [findOne], beforeTransaction: [mark] } as never }),
    /Kayan "notes" operation "findByID" declares "beforeTransaction", and a read opens no transaction/,
  )
  assert.throws(
    notes({ peek: { steps: [findOne], afterCommit: [mark] } as never }),
    /Kayan "notes" operation "peek" declares "afterCommit", and a read opens no transaction/,
  )
  assert.doesNotThrow(
    notes({ peek: { steps: [findOne], afterSteps: [mark] } as never }),
    'a read may still name its own afterSteps, which is how a read that is worth an audit row gets one',
  )
})

test('114. afterSteps on one operation replaces the service target\'s, so a list that returns none writes no audit row and every other one still does', async () => {
  const entries: string[] = []
  const store = memoryStore()
  const mithaq = slotted(store, { audit: (entry) => void entries.push(entry.operation) })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, update: { steps: [update], afterSteps: () => [] } },
          },
        },
      }),
    ],
  })

  await built.kayan.notes.operations.create({ id: 1, body: 'kept' })
  await built.kayan.notes.operations.update({ id: 1, body: 'changed' })
  await built.kayan.notes.operations.delete({ id: 1 })
  assert.deepEqual(entries, ['create', 'delete'], 'the operation that returned an empty afterSteps wrote no audit row')
})

/**
 * The memory store with a transaction that rolls back what was written through it and nothing else,
 * so a test can tell a write that joined the transaction around it from one that opened its own.
 * Every insert is journaled under the `tx` it was given, and a throw undoes that tx's own entries
 * in reverse order.
 */
const journaled = () => {
  const store = memoryStore()
  const journal = new Map<unknown, (() => void)[]>()
  return {
    ...store,
    transaction: async <Result>(run: (tx: unknown) => Promise<Result>) => {
      store.calls.transaction += 1
      const tx = { memory: true }
      journal.set(tx, [])
      try {
        return await run(tx)
      } catch (cause) {
        for (const undo of journal.get(tx)!.toReversed()) undo()
        throw cause
      } finally {
        journal.delete(tx)
      }
    },
    insert: async ({ tx, kayan: name, data: values }: { tx: unknown; kayan: string; data: Record<string, unknown> }) => {
      const row = await store.insert({ tx, kayan: name, data: values })
      journal.get(tx)?.push(() => {
        const kept = store.rows.get(name)!
        kept.splice(kept.indexOf(row), 1)
      })
      return row
    },
  }
}

test('115. a step outside the transaction writes through tools.of in a transaction of its own: from afterCommit at the top level, from a nested write\'s beforeTransaction, and from a bulk\'s afterCommit', async () => {
  const store = journaled()
  const mark = (id: number): WriteStep => async (ctx, tools) => {
    await tools.of(marks).create({ id, body: 'outside' })
    return ctx
  }
  const boom: Step = () => {
    throw new Error('the outer write rolls back')
  }
  let built: {
    kayan: {
      notes: {
        operations: {
          create(data: { id: number; body: string }): Promise<unknown>
          shout(data: { id: number; body: string }): Promise<unknown>
          updateMany(data: { where: unknown; data: { body: string } }): Promise<unknown>
        }
      }
      tags: { operations: { create(data: { id: number; body: string }): Promise<unknown> } }
    }
  }
  const nestTag: Step = async (ctx) => {
    await built.kayan.tags.operations.create({ id: 7, body: 'joined' })
    return ctx
  }
  const mithaq = language(store as unknown as ReturnType<typeof memoryStore>)
  const marks = mithaq.defineKayan({
    name: 'marks',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
    targets: { service: { operations: defaultOperations } },
  })
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              create: { steps: [insert], afterCommit: [mark(1)] },
              shout: { steps: [nestTag, insert, boom] },
              updateMany: { steps: [updateMany], afterCommit: [mark(3)] },
            },
          },
        },
      }),
      mithaq.defineKayan({
        name: 'tags',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: { steps: [insert], beforeTransaction: [mark(2)] } },
          },
        },
      }),
      marks,
    ],
  }) as typeof built

  // The top-level write's own `afterCommit`: the transaction it belonged to has
  // closed, so the managed write this step makes opens one of its own rather
  // than being refused for reaching across a transaction that is no longer
  // there.
  await built.kayan.notes.operations.create({ id: 1, body: 'kept' })
  assert.deepEqual(
    store.rows.get('marks')?.map((row) => row.id),
    [1],
    'the row afterCommit wrote through tools.of is there',
  )
  assert.equal(store.calls.transaction, 2, 'in a second transaction, opened after the first had committed')

  // A nested write's `beforeTransaction`, under an outer write that then rolls
  // back: the step runs outside every transaction, including the one its own
  // write is about to join, so what it wrote stands when the outer one is
  // undone.
  await assert.rejects(() => built.kayan.notes.operations.shout({ id: 2, body: 'lost' }), /the outer write rolls back/)
  assert.deepEqual(
    store.rows.get('marks')?.map((row) => row.id),
    [1, 2],
    'the row beforeTransaction wrote is still there after the outer write rolled back',
  )
  assert.deepEqual(store.rows.get('notes')?.map((row) => row.id), [1], 'and the outer write\'s own row is gone')
  assert.deepEqual(store.rows.get('tags') ?? [], [], 'with the nested write that joined it')

  // The bulk runner runs both outside slots through the same helper, so one
  // call says it inherits the fix.
  await built.kayan.notes.operations.updateMany({ where: { id: { equals: 1 } }, data: { body: 'changed' } })
  assert.deepEqual(
    store.rows.get('marks')?.map((row) => row.id),
    [1, 2, 3],
    'and a bulk write\'s afterCommit writes through tools.of exactly as a single row\'s does',
  )
})

test('116. every queued afterCommit runs even when one throws, and the first error is what the write reports', async () => {
  const store = memoryStore()
  const ran: string[] = []
  const note = (name: string, fail?: true): Step => (ctx) => {
    ran.push(name)
    if (fail) throw new Error(`${name} threw`)
    return ctx
  }
  let built: {
    kayan: {
      notes: { operations: { create(data: { id: number; body: string }): Promise<unknown>; shout(data: { id: number; body: string }): Promise<unknown> } }
      tags: { operations: { create(data: { id: number; body: string }): Promise<unknown> } }
    }
  }
  const nest: Step = async (ctx) => {
    await built.kayan.tags.operations.create({ id: 1, body: 'first' })
    await built.kayan.tags.operations.create({ id: 2, body: 'second' })
    return ctx
  }
  const mithaq = language(store)
  built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, shout: { steps: [nest, insert], afterCommit: [note('opener')] } },
          },
        },
      }),
      mithaq.defineKayan({
        name: 'tags',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: { steps: [insert], afterCommit: [note('queued', true)] } },
          },
        },
      }),
    ],
  }) as typeof built

  await assert.rejects(() => built.kayan.notes.operations.shout({ id: 1, body: 'kept' }), (error: unknown) => {
    assert.ok(error instanceof AfterCommitError)
    assert.equal(error.committed, true)
    assert.deepEqual(error.result, { id: 1, body: 'kept' })
    assert.match(String(error.cause), /afterCommit/)
    return true
  })
  assert.deepEqual(
    ran,
    ['queued', 'queued', 'opener'],
    'the thunk that threw did not silence the queued one behind it or the opener\'s own',
  )
})

test('a committed write returns its original body and a warning on both HTTP plugs', async () => {
  const store = memoryStore()
  const reported: unknown[] = []
  const failed: Step = () => { throw new Error('private callback detail') }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: { id: { kind: 'number' }, body: { kind: 'text' } },
      targets: {
        service: {
          operations: { ...defaultOperations, create: { steps: [insert], afterCommit: [failed] } },
        },
      },
    })],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: (error) => void reported.push(error) }), orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, api: '/api/orpc', onError: (error) => void reported.push(error) })],
  })
  for (const [path, id, rpc] of [
    ['/api/notes/create', 1, false],
    ['/api/orpc/notes/create', 2, false],
    ['/api/rpc/notes/create', 3, true],
  ] as const) {
    const response = await built.handler(new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc ? { json: { id, body: 'kept' } } : { id, body: 'kept' }),
    }))
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('x-mithaq-after-commit'), 'failed', path)
    const body = await response.json() as { json?: { id: number; body: string }; id?: number; body?: string }
    assert.deepEqual(body.json ?? body, { id, body: 'kept' }, path)
    assert.equal(JSON.stringify(body).includes('private callback detail'), false)
  }
  assert.equal(reported.length, 3)
  assert.deepEqual(store.rows.get('notes')!.map((row) => row.id), [1, 2, 3])
})

test('a write whose afterCommit did not fail answers the header ok on both HTTP plugs, and a read, a custom one included, answers none', async () => {
  // The client clears its banner on `ok` alone, so a read never clears it: the
  // effect is known here and nowhere in the browser.
  const mithaq = language(memoryStore())
  const built = mithaq.buildAsas({
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: { id: { kind: 'number' }, body: { kind: 'text' } },
      targets: { service: { operations: { ...defaultOperations, latest: defaultOperations.find } } },
    })],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} }), orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, api: '/api/orpc', onError: () => {} })],
  })
  for (const [prefix, rpc] of [['/api', false], ['/api/orpc', false], ['/api/rpc', true]] as const) {
    const post = async (operation: string, input: unknown) => {
      const response = await built.handler(new Request(`http://test${prefix}/notes/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rpc ? { json: input } : input),
      }))
      assert.equal(response.status, 200, `${prefix}/notes/${operation}`)
      return response.headers.get('x-mithaq-after-commit')
    }
    const id = { '/api': 1, '/api/orpc': 2, '/api/rpc': 3 }[prefix]
    assert.equal(await post('create', { id, body: 'kept' }), 'ok', prefix)
    assert.equal(await post('update', { id, body: 'changed' }), 'ok', prefix)
    assert.equal(await post('find', {}), null, prefix)
    assert.equal(await post('findByID', { id }), null, prefix)
    assert.equal(await post('latest', {}), null, `${prefix}, a custom read`)
    assert.equal(await post('delete', { id }), 'ok', prefix)
  }
})

test('a nested write whose afterCommit throws never answers the outer operation as a 200 with the inner row on either HTTP plug', async () => {
  const store = memoryStore()
  const failed: Step = () => { throw new Error('inner follow-up failed') }
  // A write started from `beforeTransaction` opens its own transaction and
  // commits before the outer one has begun, so its `afterCommit` fails with an
  // operation still running around it.
  const nest: Step = async (ctx) => {
    const id = (ctx.data as { id: number }).id
    await built.kayan.tags.operations.create({ id, body: 'inner' })
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: { beforeTransaction: [nest], steps: [insert] } },
          },
        },
      }),
      mithaq.defineKayan({
        name: 'tags',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: { steps: [insert], afterCommit: [failed] } },
          },
        },
      }),
    ],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} }), orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, api: '/api/orpc', onError: () => {} })],
  })
  for (const [path, id, rpc] of [
    ['/api/notes/create', 1, false],
    ['/api/orpc/notes/create', 2, false],
    ['/api/rpc/notes/create', 3, true],
  ] as const) {
    const response = await built.handler(new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc ? { json: { id, body: 'outer' } } : { id, body: 'outer' }),
    }))
    assert.notEqual(response.status, 200, path)
    assert.equal(response.headers.get('x-mithaq-after-commit'), null, path)
    assert.equal(JSON.stringify(await response.json()).includes('inner'), false, path)
  }
  assert.equal(store.rows.get('notes')?.length ?? 0, 0, 'the outer write never ran')
  assert.deepEqual(store.rows.get('tags')!.map((row) => row.id), [1, 2, 3], 'while each inner row committed')
})

test('a nested bulk whose afterCommit throws never answers the outer operation as a 200', async () => {
  const store = memoryStore()
  const failed: Step = () => { throw new Error('inner follow-up failed') }
  // `updateMany` from `beforeTransaction` opens and commits its own
  // transaction, so its `afterCommit` fails with the outer create still running.
  const nest: Step = async (ctx) => {
    await built.kayan.tags.operations.updateMany({ where: { id: { equals: 1 } }, data: { body: 'inner' } })
    return ctx
  }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: { beforeTransaction: [nest], steps: [insert] } },
          },
        },
      }),
      mithaq.defineKayan({
        name: 'tags',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text' } },
        targets: {
          service: {
            operations: { ...defaultOperations, updateMany: { steps: [updateMany], afterCommit: [failed] } },
          },
        },
      }),
    ],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })],
  })
  await built.kayan.tags.operations.create({ id: 1, body: 'before' })
  const response = await built.handler(new Request('http://test/api/notes/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, body: 'outer' }),
  }))
  assert.notEqual(response.status, 200)
  assert.equal(response.headers.get('x-mithaq-after-commit'), null)
  assert.equal(JSON.stringify(await response.json()).includes('inner'), false)
  assert.equal(store.rows.get('notes')?.length ?? 0, 0, 'the outer write never ran')
  assert.equal(store.rows.get('tags')?.[0]?.body, 'inner', 'while the inner bulk committed')
})

test('a bulk afterCommit failure reports its committed docs while transaction failures carry no committed marker', async () => {
  const store = memoryStore()
  const fail: Step = () => { throw new Error('later failed') }
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: { id: { kind: 'number' }, body: { kind: 'text' } },
      targets: {
        service: {
          operations: { ...defaultOperations, updateMany: { steps: [updateMany], afterCommit: [fail] } },
        },
      },
    })],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'before' })
  const thrown = await built.kayan.notes.operations.updateMany({ where: { id: { equals: 1 } }, data: { body: 'after' } }).catch((error: unknown) => error)
  assert.ok(thrown instanceof AfterCommitError)
  assert.equal(thrown.committed, true)
  assert.equal((thrown.result as { docs: { body: string }[] }).docs[0]?.body, 'after')
  assert.equal(store.rows.get('notes')?.[0]?.body, 'after')

  const refused = await built.kayan.notes.operations.updateMany({ where: { id: { equals: 1 } }, data: { body: 7 as never } }).catch((error: unknown) => error)
  assert.equal(refused instanceof AfterCommitError, false)
  assert.equal((refused as { committed?: unknown }).committed, undefined)
})

test('117. a service target a project wrote in the capability\'s shape runs an operation in #82\'s order, and one missing a member is refused by name', async () => {
  const ran: string[] = []
  const note = (name: string): Step => (ctx) => {
    ran.push(name)
    return ctx
  }
  const archived: Step = (ctx) => {
    ran.push('steps')
    return { ...ctx, data: { ...ctx.data, body: 'archived' } }
  }
  const store = memoryStore()
  // No `serviceTarget` anywhere: the target is its keys and the capability,
  // written out, which is what a project writing its own values in the same
  // shape writes. Core's write still runs them.
  const own = {
    capability: 'service' as const,
    beforeSteps: [note('beforeSteps')],
    afterSteps: [note('afterSteps')],
    afterCommit: [note('afterCommit')],
    authorize: (async (args: Parameters<typeof defaultAuthorize>[0]) => {
      ran.push('authorize')
      return defaultAuthorize(args)
    }) as typeof defaultAuthorize,
    store: 'memory' as const,
    schema: 'zod' as const,
    depth: defaultDepth,
    defaultLimit,
    maxLimit: defaultMaxLimit,
    joinLimit: defaultJoinLimit,
    bulkLimit: defaultBulkLimit,
  }
  const mithaq = defineMithaq({ arkan: [base], targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: own } })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              archive: {
                input: ({ id }) => id,
                beforeTransaction: [note('beforeTransaction')],
                steps: [archived, update],
              },
            },
          },
        },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'kept' })
  ran.length = 0
  assert.equal((await built.kayan.notes.operations.archive({ id: 1 })).body, 'archived')
  assert.deepEqual(
    ran,
    ['authorize', 'beforeTransaction', 'beforeSteps', 'steps', 'afterSteps', 'afterCommit'],
    'the positions of the language\'s three lists read off the runner the project wrote',
  )

  for (const member of ['authorize', 'store', 'schema', 'depth', 'defaultLimit', 'maxLimit', 'joinLimit', 'bulkLimit'] as const) {
    const { [member]: _dropped, ...short } = own
    assert.throws(
      () =>
        (defineMithaq({ arkan: [base], targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: short } } as never) as unknown as {
          buildAsas: (args: { kayan: Kayan[]; http: unknown[] }) => unknown
        }).buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [{ name: 'notes', fields: { id: { kind: 'number' } } }] }),
      new RegExp(`The service target declares no "${member}", and every build's runner has one\\. Add it to serviceTarget\\(\\{ \\.\\.\\. \\}\\)\\.`),
    )
  }
  // A page the runner opens on its own is never larger than one a caller may ask for, and every
  // number is a whole page.
  for (const [change, refusal] of [
    [{ defaultLimit: 101 }, /service\.defaultLimit is 101, past service\.maxLimit 100\./],
    [{ joinLimit: 101 }, /service\.joinLimit is 101, past service\.maxLimit 100\./],
    [{ bulkLimit: 0 }, /service\.bulkLimit must be a positive integer\./],
    [{ maxLimit: 2.5 }, /service\.maxLimit must be a positive integer\./],
  ] as const) {
    assert.throws(
      () => defineMithaq({ arkan: [base], targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: { ...own, ...change } } }).buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [] }),
      refusal,
    )
  }
})

test('118. a kayan\'s own afterSteps function is handed the service target\'s list, so spreading it keeps the project\'s audit and adds its own step after it', async () => {
  const entries: string[] = []
  const ran: string[] = []
  const notify: Step = (ctx) => {
    ran.push('notify')
    return ctx
  }
  const mithaq = slotted(memoryStore(), { audit: (entry) => void entries.push(entry.operation) })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
        targets: {
          service: {
            operations: { ...defaultOperations, create: { steps: [insert], afterSteps: ({ afterSteps }) => [...afterSteps, notify] } },
          },
        },
      }),
    ],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'kept' })
  assert.deepEqual(entries, ['create'], 'the spread list held the service target\'s audit, so the write audited')
  assert.deepEqual(ran, ['notify'], 'and the step the kayan added after it ran too')
})

test('123. tools.of(kayan) is the bound kayan tools.kayans holds under its name: a nested write through it joins the transaction, inherits the actor and the context, counts toward depth, and refuses options', async () => {
  const store = memoryStore()
  const seen: unknown[] = []
  const record: WriteStep = (ctx) => {
    seen.push(ctx.actor, ctx.context.requestId, ctx.context.depth)
    return ctx
  }
  const mithaq = language(store, 2)
  const children = mithaq.defineKayan({
    name: 'children',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
    targets: { service: { operations: { ...defaultOperations, create: { steps: [insert, record] } } } },
  })
  const nest: WriteStep = async (ctx, tools) => {
    assert.equal(tools.of(children), (tools.kayans as Record<string, unknown>).children)
    await tools.of(children).create({ id: 1, body: 'nested' })
    await assert.rejects(
      // @ts-expect-error a bound call takes its input alone
      async () => { await tools.of(children).create({ id: 2, body: 'forged' }, { actor: { id: 'u2' } }) },
      /inherit the current user and context/,
    )
    await assert.rejects(
      // @ts-expect-error and no other options either
      async () => { await tools.of(children).create({ id: 2, body: 'forged' }, { depth: 0 }) },
      /do not accept operation options/,
    )
    return ctx
  }
  const parents = mithaq.defineKayan({
    name: 'parents',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
    targets: { service: { operations: { ...defaultOperations, create: { steps: [insert, nest] } } } },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [children, parents] })

  await built.kayan.parents.operations.create({ id: 1, body: 'outer' }, { actor: { id: 'u1' }, context: { requestId: 'r1' } })
  assert.deepEqual(seen, [{ id: 'u1' }, 'r1', 2], 'the nested write ran under the outer actor and context, one deeper')
  assert.equal(store.calls.transaction, 1, 'and in the transaction the outer write opened')
  assert.deepEqual(store.rows.get('children')?.map((row) => row.id), [1])
})

test('123a. a write through tools.of past the depth cap is refused by name', async () => {
  const mithaq = language(memoryStore(), 2)
  const deeper: WriteStep = async (ctx, tools) => {
    await tools.of(nodes).create({ body: 'child' })
    return ctx
  }
  const nodes = mithaq.defineKayan({
    name: 'nodes',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
    targets: { service: { operations: { ...defaultOperations, create: { steps: [insert, deeper] } } } },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [nodes] })
  await assert.rejects(
    () => built.kayan.nodes.operations.create({ body: 'root' }),
    /Write depth 3 is past the cap of 2: nodes\.create -> nodes\.create -> nodes\.create/,
  )
})

test('123b. a read step\'s tools.of holds the read operations alone, and tools.of refuses a kayan this build did not register and a global, naming it', async () => {
  const mithaq = language(memoryStore())
  const outcomes: unknown[] = []
  const notes = mithaq.defineKayan({
    name: 'notes',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text' } },
    targets: { service: { operations: defaultOperations } },
  })
  const impostor = mithaq.defineKayan({
    name: 'notes',
    access: allowAccess,
    fields: { id: { kind: 'number' }, body: { kind: 'text' } },
    targets: { service: { operations: defaultOperations } },
  })
  const stranger = mithaq.defineKayan({
    name: 'strangers',
    access: allowAccess,
    fields: { id: { kind: 'number' } },
    targets: { service: { operations: defaultOperations } },
  })
  const settings = mithaq.defineGlobal({
    name: 'settings',
    access: { read: () => true, update: () => true },
    fields: { id: { kind: 'number', rules: { defaultValue: 1 } }, title: { kind: 'text' }, ...defaultGlobalFields },
    targets: { service: { operations: defaultGlobalOperations } },
  })
  const refusal = (call: () => unknown) => {
    try {
      call()
      return 'no throw'
    } catch (error) {
      return (error as Error).message
    }
  }
  const peek: ReadStep = async (ctx, tools) => {
    const handle = tools.of(notes)
    // @ts-expect-error a read step's handle has no write
    void handle.create
    outcomes.push(
      Object.keys(handle).sort(),
      (await handle.findByID({ id: 1 }))?.body,
      refusal(() => tools.of(impostor)),
      refusal(() => tools.of(stranger)),
      // @ts-expect-error a global is refused at the type too
      refusal(() => tools.of(settings)),
    )
    return ctx
  }
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [notes, mithaq.defineKayan({
      name: 'readers',
      access: allowAccess,
      fields: { id: { kind: 'number' } },
      targets: { service: { operations: { ...defaultOperations, peek: { steps: [findOne, peek] } } } },
    })],
    global: [settings],
  })
  await built.kayan.notes.operations.create({ id: 1, body: 'one' })
  await built.kayan.readers.operations.create({ id: 1 })
  await built.kayan.readers.operations.peek({ id: 1 })
  assert.deepEqual(outcomes, [
    ['count', 'find', 'findByID'],
    'one',
    'tools.of "notes" is not the registered kayan object.',
    'tools.of "strangers" is not in the buildAsas kayan list.',
    'tools.of "settings" is a global, which a step does not reach through its tools.',
  ])
})

test('124. a resolved kayan\'s access and a resolved field\'s access are frozen at the end of resolve, so reassigning either after build throws, and a relationship\'s target kayan is the same frozen object', () => {
  const mithaq = language(memoryStore())
  const denyRead = () => false
  const authors = mithaq.defineKayan({
    name: 'authors',
    fields: { id: { kind: 'number' } },
    access: { read: denyRead, create: denyRead, update: denyRead, delete: denyRead },
    targets: { service: { operations: defaultOperations } },
  })
  const posts = mithaq.defineKayan({
    name: 'posts',
    fields: {
      id: { kind: 'number' },
      title: { kind: 'text', access: { read: denyRead } },
      author: { kind: 'relationship', relationTo: () => authors },
    },
    targets: { service: { operations: defaultOperations } },
  })
  const asas = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [posts, authors] })

  // Server code holding only `asas.kayan.posts` reaches the related kayan through its relationship
  // field.
  const author = asas.kayan.posts.fields.author as unknown as { target: { access: { read: unknown } } }
  const target = author.target
  assert.throws(() => {
    target.access.read = () => true
  }, TypeError)
  const titleAccess = asas.kayan.posts.fields.title!.access as { read: unknown }
  assert.throws(() => {
    titleAccess.read = () => true
  }, TypeError)

  // The reassignment threw rather than silently no-op'd, so an anonymous caller still reads the
  // refusal every field was declared with: function identity survives the freeze, which the
  // `neverRead` check depends on.
  assert.equal(target.access.read, denyRead)
  assert.equal(titleAccess.read, denyRead)
})

test('125. a field\'s `pattern` RegExp is left unfrozen by the freeze after build, so a write through it parses twice and passes', async () => {
  const mithaq = language(memoryStore())
  const code = /^[A-Z]{3}$/g
  const codes = mithaq.defineKayan({
    name: 'codes',
    fields: { id: { kind: 'number' }, code: { kind: 'text', rules: { pattern: code } } },
    access: allowAccess,
    targets: { service: { operations: defaultOperations } },
  })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [codes] })
  assert.equal(Object.isFrozen(code), false, 'a RegExp in rules is not frozen')
  assert.ok(Object.isFrozen(codes.fields.code.rules), 'while the rules holding it are')
  // zod resets `lastIndex` on every parse, so the second write is the one a
  // frozen RegExp would refuse with a TypeError.
  await built.kayan.codes.operations.create({ id: 1, code: 'ABC' })
  await built.kayan.codes.operations.create({ id: 2, code: 'XYZ' })
})

/**
 * A relationship write checks every id it sets against the target kayan's own read access for the
 * same actor, so an id the actor cannot read is refused whether or not either kayan keeps a tenant
 * field. `people` has none, which is the shape of Better Auth's `user`.
 */
test('126. a relationship write refuses an id the target\'s read access hides from the actor, on a create, an update, an updateMany and a hasMany set, and admits the actor\'s own in one read per target, and a target the actor may not read admits nothing', async () => {
  const store = memoryStore()
  const reads: string[] = []
  const find = store.find
  store.find = (query) => {
    reads.push(query.kayan)
    return find(query)
  }
  const mithaq = language(store)
  const ownOrganization = ({ user }: { user: unknown }) => ({ org: { equals: (user as { activeOrganizationId: string }).activeOrganizationId } })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'people',
        access: { ...allowAccess, read: ownOrganization as never },
        fields: { id: { kind: 'number' }, org: { kind: 'text' } },
        targets: { service: { operations: defaultOperations } },
      }),
      mithaq.defineKayan({
        name: 'sealed',
        access: { ...allowAccess, read: () => false },
        fields: { id: { kind: 'number' } },
        targets: { service: { operations: defaultOperations } },
      }),
      mithaq.defineKayan({
        name: 'rosters',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          lead: { kind: 'relationship', relationTo: 'people' },
          members: { kind: 'relationship', relationTo: 'people', hasMany: true },
          vault: { kind: 'relationship', relationTo: 'sealed' },
        },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  store.rows.set('people', [{ id: 1, org: 'org1' }, { id: 2, org: 'org2' }, { id: 3, org: 'org1' }])
  store.rows.set('sealed', [{ id: 1 }])
  const actor = { id: 'u1', activeOrganizationId: 'org1' }
  const rosters = built.kayan.rosters.operations
  const refused = async (write: Promise<unknown>, field: string, message: string) => {
    const thrown = await write.catch((error: unknown) => error)
    assert.ok(thrown instanceof AsasError, message)
    assert.equal(thrown.status, 400, `${message}, as a 400`)
    assert.equal(thrown.key, 'error.invalid.reference', `${message}, under the reference key`)
    assert.deepEqual(thrown.params, { kayan: 'rosters', field, target: 'people' }, `${message}, naming the field and the target`)
  }

  reads.length = 0
  const made = await rosters.create({ id: 10, lead: 1, members: [1, 3], vault: null }, { actor })
  assert.equal(made.lead, 1, 'the actor\'s own person is admitted')
  assert.deepEqual(reads.filter((name) => name === 'people'), ['people'], 'in one read of the target for both fields and every id')

  await refused(rosters.create({ id: 11, lead: 2 }, { actor }), 'lead', 'another organization\'s person is refused on a create')
  await refused(rosters.create({ id: 11, lead: 99 }, { actor }), 'lead', 'an id that is not there is refused in the same words')
  await refused(rosters.create({ id: 11, members: [1, 2] }, { actor }), 'members', 'one hidden row in a hasMany set refuses the set')
  assert.equal(store.rows.get('rosters')?.length, 1, 'and none of the three wrote a row')

  await refused(rosters.update({ id: 10, lead: 2 }, { actor }), 'lead', 'an update pointing at another organization\'s person is refused')
  await refused(rosters.update({ id: 10, members: [2] }, { actor }), 'members', 'and so is an update replacing the set with one')
  await refused(
    rosters.updateMany({ where: { id: { equals: 10 } }, data: { lead: 2 } }, { actor }),
    'lead',
    'and an updateMany, through the single-row write each row goes through',
  )
  assert.deepEqual(store.rows.get('rosters')?.[0], { id: 10, lead: 1, members: [1, 3], vault: null }, 'the row is as the create left it')

  assert.equal((await rosters.update({ id: 10, lead: 3, members: [3] }, { actor })).lead, 3, 'an update to the actor\'s own is admitted')
  assert.equal(
    (await rosters.updateMany({ where: { id: { equals: 10 } }, data: { lead: 1 } }, { actor })).docs.length,
    1,
    'and so is an updateMany to one',
  )

  // A target whose read access denies the actor outright admits no id: a
  // present one and an absent one are refused alike, before the store is
  // asked, so the write tells the actor nothing about which ids exist.
  const sealed = async (id: number) => {
    const thrown = await rosters.create({ id: 12, lead: null, members: [], vault: id }, { actor }).catch((error: unknown) => error)
    assert.ok(thrown instanceof AsasError && thrown.status === 400, `vault ${id} is refused as a 400`)
    return { message: thrown.message, key: thrown.key, params: thrown.params }
  }
  const present = await sealed(1)
  assert.equal(present.key, 'error.invalid.reference', 'a present row of a target the actor may not read is refused under the reference key')
  assert.deepEqual(await sealed(99), present, 'and an absent one in the same words, key and params')
  assert.equal(store.rows.get('rosters')?.length, 1, 'and neither wrote a row')
})

test('160a. minRows and maxRows bound a list on either schema target, Payload\'s way: an optional list left empty passes, a required one is held to its floor, and a list past either bound carries that rule\'s key', async () => {
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const fields = {
    tags: { kind: 'textArray', rules: { minRows: 2, maxRows: 3 } },
    keys: { kind: 'textArray', rules: { required: true, minRows: 1 } },
  } satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
  const lists = mithaq.defineKayan({ name: 'lists', access: allowAccess, fields: { id: { kind: 'number' }, ...fields }, targets: { service: { operations: defaultOperations } } })
  const plainLists = mithaq.defineKayan({ name: 'plainLists', targets: { service: { schema: 'plain', operations: defaultOperations } }, access: allowAccess, fields: { id: { kind: 'number' }, ...fields } })
  const built = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [lists, plainLists] })
  let id = 0
  for (const [target, kayan, name] of [
    ['zod', built.kayan.lists, 'lists'],
    ['plain', built.kayan.plainLists, 'plainLists'],
  ] as const) {
    const refused = async (data: Record<string, unknown>) => {
      const thrown = await kayan.operations.create({ id: ++id, ...data } as never).catch((error: unknown) => error)
      assert.ok(thrown instanceof AsasError, `${target}: ${JSON.stringify(data)} is refused`)
      assert.equal(thrown.status, 400)
      return (thrown.params as { issues: { path: string; message: string }[] }).issues[0]
    }
    // The zod target writes the rule's key, and the plain one zod's own
    // English, as it does for every other rule.
    const says = (path: string, rule: 'minRows' | 'maxRows') =>
      target === 'zod' ? { path, message: `${name}.${path}.${rule}` } : { path, message: rule === 'minRows' ? 'Too small: expected array to have >=' : 'Too big: expected array to have <=' }
    const issue = async (data: Record<string, unknown>) => {
      const one = (await refused(data))!
      return target === 'zod' ? one : { path: one.path, message: one.message.replace(/\d+ items$/, '') }
    }
    assert.deepEqual(await issue({ keys: ['a'], tags: ['a'] }), says('tags', 'minRows'), `${target}: one row under a floor of two`)
    assert.deepEqual(await issue({ keys: ['a'], tags: ['a', 'b', 'c', 'd'] }), says('tags', 'maxRows'), `${target}: four rows over a ceiling of three`)
    assert.deepEqual(await issue({ keys: [] }), says('keys', 'minRows'), `${target}: a required list is held to its floor when empty`)
    for (const tags of [[], ['a', 'b'], ['a', 'b', 'c'], null]) {
      await assert.doesNotReject(() => kayan.operations.create({ id: ++id, keys: ['a'], tags } as never), `${target}: ${JSON.stringify(tags)} passes an optional list bounded two to three`)
    }
  }

  // A floor above its ceiling is a shape no list passes, refused at the build
  // like a `min` above its `max`, and a bound on a kind that holds no list is
  // refused by the kind.
  const dynamic = (field: Kayan['fields'][string]) =>
    language(memoryStore()).buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [{ name: 'dynamic', fields: { id: { kind: 'number' }, value: field } }] })
  assert.throws(
    () => dynamic({ kind: 'textArray', rules: { minRows: 3, maxRows: 2 } }),
    /field "value" declares "minRows" 3 and "maxRows" 2, and no value is both at once/,
  )
  assert.throws(() => dynamic({ kind: 'text', rules: { maxRows: 2 } }), /kind "text" which does not accept nested rule "maxRows"/)
})

test('161a. a row stored before a stricter rule was declared still reads on either schema target, in process and served, a save of it is refused by that rule until it complies, and a value of the wrong kind still fails the read', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  // The same two kayan twice over one store: first as they were when the rows
  // were written, then with the rules a later release declared on them.
  const loose = {
    tags: { kind: 'textArray' },
    keys: { kind: 'textArray' },
    code: { kind: 'text' },
  } satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
  const strict = {
    tags: { kind: 'textArray', rules: { maxRows: 2 } },
    keys: { kind: 'textArray', rules: { minRows: 2 } },
    code: { kind: 'text', rules: { maxLength: 3, pattern: /^[A-Z]+$/ } },
  } satisfies Record<string, Field<keyof typeof defaultKinds, Rules>>
  const both = (fields: typeof loose | typeof strict) => [
    mithaq.defineKayan({ name: 'zodRows', access: allowAccess, fields: { id: { kind: 'number' }, ...fields }, targets: { service: { operations: defaultOperations } } }),
    mithaq.defineKayan({ name: 'plainRows', access: allowAccess, fields: { id: { kind: 'number' }, ...fields }, targets: { service: { schema: 'plain', operations: defaultOperations } } }),
  ]
  const earlier = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: both(loose) })
  const stored = { id: 1, tags: ['a', 'b', 'c'], keys: ['a'], code: 'toolong' }
  await earlier.kayan.zodRows.operations.create(stored as never)
  await earlier.kayan.plainRows.operations.create(stored as never)

  const later = mithaq.buildAsas({ kayan: both(strict), http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })] })
  const served = (path: string, body: unknown) =>
    later.handler(new Request(`http://test/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  for (const name of ['zodRows', 'plainRows'] as const) {
    const operations = later.kayan[name].operations as unknown as Record<string, (input: unknown) => Promise<Record<string, unknown> | null>>
    assert.deepEqual(await operations.findByID!({ id: 1 }), stored, `${name}: the row reads in process as it was stored`)
    assert.deepEqual((await operations.find!({}))!.docs, [stored], `${name}: and its list holds it`)
    const one = await served(`${name}/findByID`, { id: 1 })
    assert.equal(one.status, 200, `${name}: the served read answers 200`)
    assert.deepEqual(await one.json(), stored)
    const list = await served(`${name}/find`, {})
    assert.equal(list.status, 200, `${name}: the served list answers 200`)
    assert.deepEqual(((await list.json()) as { docs: unknown[] }).docs, [stored])

    // A save is held to every rule the kayan declares.
    for (const [change, rule] of [
      [{ tags: stored.tags }, 'maxRows'],
      [{ keys: stored.keys }, 'minRows'],
      [{ code: stored.code }, 'maxLength'],
      [{ code: 'AB1' }, 'pattern'],
    ] as const) {
      const refused = await operations.update!({ id: 1, ...change }).catch((error: unknown) => error)
      assert.ok(refused instanceof AsasError && refused.status === 400, `${name}: saving ${JSON.stringify(change)} is refused by ${rule}`)
      const issue = (refused.params as { issues: { path: string; message: string }[] }).issues[0]!
      assert.equal(issue.path, Object.keys(change)[0])
      if (name === 'zodRows') assert.equal(issue.message, `zodRows.${issue.path}.${rule}`)
    }
    const complying = { id: 1, tags: ['a', 'b'], keys: ['a', 'b'], code: 'ABC' }
    assert.deepEqual(await operations.update!(complying), complying, `${name}: and the save that complies is taken`)

    // A value that is not what the kind holds is no rule added later: the read
    // still refuses it, under the path of the column that broke.
    store.rows.get(name)!.push({ id: 2, tags: 5, keys: null, code: 'X' })
    // It is the stored data at fault and not the caller, so it is a plain Error naming the field,
    // and a 500 served.
    const broken = (error: unknown) =>
      error instanceof Error && !(error instanceof AsasError) && error.message.includes('field "tags"')
    await assert.rejects(() => operations.findByID!({ id: 2 }), broken, `${name}: a number where a list of text belongs fails the read`)
    await assert.rejects(() => operations.find!({}), broken, `${name}: and the list holding it`)
    const brokenServed = await served(`${name}/findByID`, { id: 2 })
    assert.equal(brokenServed.status, 500, `${name}: served, the read still fails`)
    await brokenServed.body?.cancel()
  }
})

test('164a. a row holding an option the kayan has since removed reads as stored on either schema target, in process and served, and a save is refused until it holds a current option', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const optionsOf = (...values: string[]) => values.map((value) => ({ value, label: {} }))
  // The same two kayan twice over one store: first with the option the rows
  // were written under, then with that option removed.
  const fieldsOf = (...values: string[]) => ({
    id: { kind: 'number' as const },
    status: { kind: 'text' as const, options: optionsOf(...values) },
    tags: { kind: 'textArray' as const, options: optionsOf(...values) },
  })
  const both = (fields: ReturnType<typeof fieldsOf>) => [
    mithaq.defineKayan({ name: 'zodOptions', access: allowAccess, fields, targets: { service: { operations: defaultOperations } } }),
    mithaq.defineKayan({ name: 'plainOptions', access: allowAccess, fields, targets: { service: { schema: 'plain', operations: defaultOperations } } }),
  ]
  const earlier = mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: both(fieldsOf('draft', 'live', 'archived')) })
  const stored = { id: 1, status: 'archived', tags: ['draft', 'archived'] }
  await earlier.kayan.zodOptions.operations.create(stored as never)
  await earlier.kayan.plainOptions.operations.create(stored as never)

  const later = mithaq.buildAsas({ kayan: both(fieldsOf('draft', 'live')), http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} })] })
  const served = (path: string, body: unknown) =>
    later.handler(new Request(`http://test/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  for (const name of ['zodOptions', 'plainOptions'] as const) {
    const operations = later.kayan[name].operations as unknown as Record<string, (input: unknown) => Promise<Record<string, unknown> | null>>
    assert.deepEqual(await operations.findByID!({ id: 1 }), stored, `${name}: the row reads in process as it was stored`)
    assert.deepEqual((await operations.find!({}))!.docs, [stored], `${name}: and its list holds it`)
    const one = await served(`${name}/findByID`, { id: 1 })
    assert.equal(one.status, 200, `${name}: the served read answers 200`)
    assert.deepEqual(await one.json(), stored)
    const list = await served(`${name}/find`, {})
    assert.equal(list.status, 200, `${name}: the served list answers 200`)
    assert.deepEqual(((await list.json()) as { docs: unknown[] }).docs, [stored])

    for (const change of [{ status: 'archived' }, { tags: stored.tags }]) {
      const refused = await operations.update!({ id: 1, ...change }).catch((error: unknown) => error)
      assert.ok(refused instanceof AsasError && refused.status === 400, `${name}: saving ${JSON.stringify(change)} is refused`)
      // zod names the element of a list (`tags.1`), the plain target the list.
      const issue = (refused.params as { issues: { path: string; message: string }[] }).issues[0]!
      const field = issue.path.split('.')[0]
      assert.equal(field, Object.keys(change)[0])
      assert.equal(issue.message, `${name}.${field}.invalid`, `${name}: under the field's invalid key`)
    }
    const complying = { id: 1, status: 'live', tags: ['draft'] }
    assert.deepEqual(await operations.update!(complying), complying, `${name}: and the save that holds a current option is taken`)
  }
})

test('164b. a stored row that is not of its kind is a server fault on either schema target: a plain Error in process and a 500 on both HTTP plugs, naming the kayan, the field and the row id and never the value, and answering no row data', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const fields = { id: { kind: 'number' as const }, body: { kind: 'text' as const }, note: { kind: 'text' as const } }
  const reported: unknown[] = []
  const built = mithaq.buildAsas({
    kayan: [
      mithaq.defineKayan({ name: 'zodBroken', access: allowAccess, fields, targets: { service: { operations: defaultOperations } } }),
      mithaq.defineKayan({ name: 'plainBroken', access: allowAccess, fields, targets: { service: { schema: 'plain', operations: defaultOperations } } }),
    ],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: (error) => void reported.push(error) }), orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, api: '/api/orpc', onError: (error) => void reported.push(error) })],
  })
  // Written past the runner, the way a row reaches a table from a script or
  // an old release: a number where the kind holds text.
  const leaked = (text: string) => text.includes('424242') || text.includes('hidden neighbour')
  const names = (text: string, name: string) => text.includes(name) && text.includes('"body"') && text.includes('7')
  for (const name of ['zodBroken', 'plainBroken'] as const) {
    store.rows.set(name, [{ id: 7, body: 424242, note: 'hidden neighbour' }])
    const operations = built.kayan[name].operations as unknown as Record<string, (input: unknown) => Promise<unknown>>
    for (const [operation, input] of [['findByID', { id: 7 }], ['find', {}]] as const) {
      const thrown = await operations[operation]!(input).catch((error: unknown) => error)
      assert.ok(thrown instanceof Error && !(thrown instanceof AsasError), `${name}.${operation}: in process it is a plain Error, no refusal the caller caused`)
      assert.ok(names(thrown.message, name), `${name}.${operation}: which names the kayan, the field and the row id: ${thrown.message}`)
      assert.ok(!leaked(thrown.message), `${name}.${operation}: and never the value`)
      assert.equal(thrown.cause, undefined, `${name}.${operation}: carrying no cause a reporter could print the value from`)
    }
    for (const [path, body] of [
      [`/api/${name}/findByID`, { id: 7 }],
      [`/api/${name}/find`, {}],
      [`/api/orpc/${name}/findByID`, { id: 7 }],
      [`/api/rpc/${name}/findByID`, { json: { id: 7 } }],
    ] as const) {
      reported.length = 0
      const response = await built.handler(new Request(`http://test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))
      assert.equal(response.status, 500, `${path}: served, it answers 500`)
      const text = await response.text()
      assert.ok(!leaked(text) && !text.includes('"body"'), `${path}: with no row data and no field in the answer: ${text}`)
      assert.equal(reported.length, 1, `${path}: and the fault reaches the plug's onError`)
      const message = (reported[0] as Error).message
      assert.ok(names(message, name) && !leaked(message), `${path}: whose message names the kayan, field and id, never the value: ${message}`)
    }
  }
})

test('160b. a list kind takes a list as its default, the empty one included, and a kind that holds no list refuses one', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'defaults',
        access: allowAccess,
        fields: { id: { kind: 'number' }, none: { kind: 'textArray', rules: { required: true, defaultValue: [] } }, some: { kind: 'textArray', rules: { defaultValue: ['a', 'b'] } } },
        // A step that adds to the list it was handed. An operation that
        // declares `input` is parsed before its defaults are filled, so what
        // the step is handed is the default itself unless each row is made
        // with its own copy.
        targets: { service: { operations: { ...defaultOperations, create: { input: () => z.object({ id: z.number() }), steps: [(ctx: Ctx) => ((ctx.data.some as string[]).push('c'), ctx), insert] } } } },
      }),
    ],
  })
  const first = await built.kayan.defaults.operations.create({ id: 1 } as never)
  assert.deepEqual([first.none, first.some], [[], ['a', 'b', 'c']], 'a create that leaves a list out is given its default')
  const second = await built.kayan.defaults.operations.create({ id: 2 } as never)
  assert.deepEqual(second.some, ['a', 'b', 'c'], 'and each row its own copy of it')

  const dynamic = (field: Kayan['fields'][string]) =>
    language(memoryStore()).buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [{ name: 'dynamic', fields: { id: { kind: 'number' }, value: field } }] })
  assert.throws(() => dynamic({ kind: 'text', rules: { defaultValue: ['a'] } as never }), /field "value" nested rule "defaultValue" does not match kind "text"/)
  assert.throws(() => dynamic({ kind: 'textArray', rules: { defaultValue: [1] } as never }), /field "value" nested rule "defaultValue" does not match kind "textArray"/)
})

test('132. a kayan keeps versions only where the language declares them, and drafts only with a _status field and a draft shape, each refused by name', () => {
  const versioned = (schema: 'zod' | 'plain' = 'zod', targets: Record<string, unknown> = { versions: versionsTarget({ max: 100 }) }) =>
    defineMithaq({
      arkan: [base],
      targets: {
        memory: memoryStore(),
        zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
        plain: plainTarget,
        service: { capability: 'service', store: 'memory', schema, authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
        ...targets,
      } as never,
    })
  const build = (mithaq: ReturnType<typeof versioned>, kayan: Record<string, unknown>) => () =>
    mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [mithaq.defineKayan({ name: 'notes', fields: { ...defaultFields, body: { kind: 'text' } }, ...kayan } as never)] })
  const operations = { service: { operations: { ...defaultOperations, ...versionOperations } } }

  assert.throws(
    build(versioned('zod', {}), { targets: { ...operations, versions: {} } }),
    /Kayan "notes" writes "targets\.versions", which is no target of this build/,
  )
  assert.throws(
    build(versioned(), { targets: { ...operations, versions: { drafts: true } } }),
    /Kayan "notes" writes "targets\.versions" with drafts, and declares no field "_status"/,
  )
  assert.throws(
    build(versioned(), { targets: { ...operations, versions: { max: -1 } } }),
    /Kayan "notes" writes "targets\.versions" with max -1/,
  )
  assert.throws(
    () => {
      const mithaq = versioned()
      mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [mithaq.defineKayan({ name: 'notes', fields: { ...defaultFields, body: { kind: 'text' }, ...draftFields }, targets: { ...operations, versions: { drafts: { autosave: { interval: 0 } } } } } as never)] })
    },
    /Kayan "notes" writes "targets\.versions" with an autosave interval of 0/,
  )
  assert.throws(
    build(versioned(), { targets: operations }),
    /Kayan "notes" operation "findVersions" holds the "findVersions" step, and the kayan keeps no versions/,
  )
  assert.throws(
    () => {
      const mithaq = versioned('plain')
      mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [mithaq.defineKayan({ name: 'notes', fields: { ...defaultFields, body: { kind: 'text' }, ...draftFields }, targets: { ...operations, versions: { drafts: true } } } as never)] })
    },
    /Kayan "notes" keeps drafts, and its schema target "plain" derives no draft shape/,
  )
  assert.throws(
    () => {
      const mithaq = versioned()
      mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [], global: [mithaq.defineGlobal({ name: 'notes', fields: { ...defaultFields, ...defaultGlobalFields }, targets: { service: { operations: defaultGlobalOperations }, versions: {} } } as never)] })
    },
    /Kayan "notes" writes "targets\.versions", and a global keeps no versions/,
  )
  assert.doesNotThrow(() => {
    const mithaq = versioned()
    mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [mithaq.defineKayan({ name: 'notes', fields: { ...defaultFields, body: { kind: 'text' }, ...draftFields }, targets: { ...operations, versions: { drafts: { autosave: true } } } } as never)] })
  })
})

test('132m. a kayan keeping versions has a uuid id, since a version is addressed by one, and the build says so by name', () => {
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
      versions: versionsTarget({ max: 100 }),
    } as never,
  })
  assert.throws(
    () => mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' }, body: { kind: 'text' } }, targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: {} } } as never)] }),
    /Kayan "notes" writes "targets\.versions", and its id is of kind "number"/,
  )
})

test('132n. a stored value compared for a version merge is the same whatever order jsonb gave its keys', () => {
  const kayan = { fields: { title: { name: 'title', kind: 'text', rules: { localized: true } } } } as never
  assert.deepEqual(changedColumns({ kayan, snapshot: { title: { en: 'Same', ar: 'نفسه' } }, row: { title: { ar: 'نفسه', en: 'Same' } } }), {}, 'the same value in another key order is no change')
  assert.deepEqual(changedColumns({ kayan, snapshot: { title: { en: 'New', ar: 'نفسه' } }, row: { title: { ar: 'نفسه', en: 'Same' } } }), { title: { en: 'New', ar: 'نفسه' } }, 'while a changed one is')
})

const pathsOf = (error: AsasError) => (error.params as { issues?: { path: string }[] }).issues?.map(({ path }) => path)

const richText = (text: string) => ({
  root: {
    type: 'root',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children: [{ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '' }] }],
  },
})

test('185. a richText value is Lexical\'s editor state, walked and then parsed with the rukn\'s own node list, refused 400 by name on either schema target and either HTTP plug, and a required one holds text', async () => {
  const store = memoryStore()
  const targets = { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) }
  // The project's own node, spread onto the defaults, which is the list both
  // the server and the editor read with. The autolink registered too, so its
  // address is refused by the walk and not because its type is unknown.
  const mithaq = defineMithaq({ arkan: [base, richTextRukn({ nodes: [...defaultNodes, CalloutNode, AutoLinkNode] })], targets })
  const fields = { id: { kind: 'number' as const }, details: { kind: 'richText' as const }, lead: { kind: 'richText' as const, rules: { required: true } } }
  const built = mithaq.buildAsas({
    kayan: [
      mithaq.defineKayan({ name: 'zodNotes', access: allowAccess, fields, targets: { service: { operations: defaultOperations } } }),
      mithaq.defineKayan({ name: 'plainNotes', access: allowAccess, fields, targets: { service: { schema: 'plain', operations: defaultOperations } } }),
    ],
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: () => {} }), orpcHttp({ maxBodyBytes: defaultMaxBodyBytes, api: '/api/orpc', onError: () => {} })],
  })
  const callout = (tone: string, text: string) => ({ root: { type: 'root', children: [{ type: 'callout', tone, version: 1, direction: null, format: '', indent: 0, children: [{ type: 'paragraph', children: [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '' }] }] }] } })
  const linkTo = (url: string) => ({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'link', url, children: [{ type: 'text', text: 'here' }] }] }] } })
  let deep: Record<string, unknown> = { type: 'text', text: 'deep' }
  for (let at = 0; at < 70; at++) deep = { type: 'listitem', children: [deep] }
  const refused: [string, unknown][] = [
    ['a string', 'Hello'],
    ['an array', [richText('Hello')]],
    ['no root', {}],
    ['a root that is no object', { root: [] }],
    ['a root of another type', { root: { ...richText('x').root, type: 'paragraph' } }],
    ['a root with no children', { root: { type: 'root' } }],
    ['a node with no type', { root: { type: 'root', children: [{ children: [] }] } }],
    ['a node whose type is no string', { root: { type: 'root', children: [{ type: 7 }] } }],
    ['children that are no list', { root: { type: 'root', children: [{ type: 'paragraph', children: {} }] } }],
    ['text that is no string', { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 7 }] }] } }],
    ['a format that is no whole number', { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x', format: 1.5 }] }] } }],
    ['a detail that is no whole number', { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x', detail: 'bold' }] }] } }],
    ['a style the editor never writes', { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x', style: 'color: red' }] }] } }],
    ['a paragraph text style the editor never writes', { root: { type: 'root', children: [{ type: 'paragraph', textStyle: 'font-size: 40px', children: [{ type: 'text', text: 'x' }] }] } }],
    ['an autolink that runs a script', { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'autolink', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'x' }] }] }] } }],
    ['a javascript: link', linkTo('javascript:alert(1)')],
    ['a javascript: link behind a control character', linkTo('java\tscript:alert(1)')],
    ['a data: link', linkTo('data:text/html,<b>x</b>')],
    ['a link with no scheme and no path', linkTo('example.com')],
    ['a link to the bare placeholder the editor starts a link with', linkTo('https://')],
    ['an http link with no host', linkTo('http:///courses')],
    ...['https://@', 'https://:', 'https://.', 'https://user@'].map((url): [string, unknown] => [`a link whose host is only punctuation, ${url}`, linkTo(url)]),
    ['a value nested past the bound', { root: { type: 'root', children: [deep] } }],
    ['a value past the size bound', richText('x'.repeat(600_000))],
    ['a value past the node bound', { root: { type: 'root', children: Array.from({ length: 10_001 }, () => ({ type: 'paragraph', children: [] })) } }],
    ['a node no class of the list registers', { root: { type: 'root', children: [{ type: 'uninstalled', name: 'Huda' }] } }],
    ['a callout whose state its own parse refuses', callout('loud', 'Careful')],
  ]
  for (const name of ['zodNotes', 'plainNotes'] as const) {
    const operations = built.kayan[name].operations as unknown as Record<string, (input: unknown) => Promise<Record<string, unknown>>>
    const kept = { root: { type: 'root', children: [{ type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Title', format: 1 }] }, { type: 'paragraph', children: [{ type: 'link', url: 'https://example.com/', children: [{ type: 'text', text: 'a page' }] }, { type: 'link', url: '/courses', children: [{ type: 'text', text: 'a path' }] }] }] } }
    const row = await operations.create!({ id: 1, details: kept, lead: callout('warning', 'Careful') })
    assert.deepEqual(row.details, kept, `${name}: the value is stored as it was written`)
    assert.deepEqual(row.lead, callout('warning', 'Careful'), `${name}: and so is the project's own node, whose text is what a required field asks for`)
    assert.deepEqual((await operations.findByID!({ id: 1 })).details, kept, `${name}: and read back the same`)
    for (const [what, value] of refused) {
      const thrown = await operations.create!({ id: 2, details: value, lead: richText('Lead') }).catch((error: unknown) => error)
      assert.ok(thrown instanceof AsasError && thrown.status === 400, `${name}: ${what} is a 400`)
      assert.deepEqual(pathsOf(thrown), ['details'], `${name}: ${what} is refused by name`)
    }
    const unknown = await operations.create!({ id: 2, details: refused.find(([what]) => what.startsWith('a node no class'))![1], lead: richText('Lead') }).catch((error: unknown) => error) as AsasError
    assert.deepEqual((unknown.params as { issues: { params?: unknown }[] }).issues[0]!.params, { type: 'uninstalled' }, `${name}: naming the node type`)
    // Required means some text a reader can see, so an empty editor and one
    // holding only spaces are both refused under the field's required key.
    for (const value of [{ root: { type: 'root', children: [] } }, richText('   ')]) {
      const thrown = await operations.create!({ id: 3, lead: value }).catch((error: unknown) => error)
      assert.ok(thrown instanceof AsasError && thrown.status === 400, `${name}: a required field with no text is a 400`)
      assert.deepEqual(pathsOf(thrown), ['lead'], `${name}: naming it`)
    }
    assert.deepEqual(store.rows.get(name)!.map((one) => one.id), [1], `${name}: and nothing refused was stored`)
    // A value saved before a node left the list, written past the runner the
    // way old data reaches a table, still reads, so the page can show it.
    const old = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'uninstalled', name: 'Huda' }, { type: 'text', text: 'joins', style: 'color: red' }] }] } }
    store.rows.get(name)!.push({ id: 9, details: old, lead: { root: { type: 'root', children: [] } } })
    assert.deepEqual((await operations.findByID!({ id: 9 })).details, old, `${name}: a stored node the list no longer holds reads back as it was stored`)
    store.rows.set(name, store.rows.get(name)!.filter((one) => one.id !== 9))
  }
  for (const [path, rpc] of [['/api/zodNotes/create', false], ['/api/orpc/zodNotes/create', false], ['/api/rpc/zodNotes/create', true]] as const) {
    const send = (body: unknown) => built.handler(new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc ? { json: body } : body),
    }))
    const id = 10 + path.length
    const kept = await send({ id, details: richText('Served'), lead: richText('Lead') })
    assert.equal(kept.status, 200, `${path}: a served write takes the value`)
    const answered = await kept.json() as { json?: Record<string, unknown> } & Record<string, unknown>
    assert.deepEqual((answered.json ?? answered).details, richText('Served'), `${path}: and answers it back`)
    for (const [what, value] of refused) {
      const response = await send({ id: id + 1, details: value, lead: richText('Lead') })
      assert.equal(response.status, 400, `${path}: ${what} is a 400`)
    }
  }

  const defaults = defineMithaq({ arkan: [base, richTextRukn({ nodes: defaultNodes })], targets })
  const plain = defaults.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [defaults.defineKayan({ name: 'odd', access: allowAccess, fields, targets: { service: { operations: defaultOperations } } })] })
  const without = await plain.kayan.odd.operations.create({ id: 1, details: callout('info', 'x'), lead: richText('Lead') } as never).catch((error: unknown) => error)
  assert.ok(without instanceof AsasError && without.status === 400, 'a rukn over the default list refuses the callout')
})

test('185i. a draft of a required rich text field may be blank, since required is a rule, and is still walked and parsed, since that is its kind', async () => {
  const mithaq = defineMithaq({
    arkan: [base, richTextRukn({ nodes: defaultNodes })],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }), versions: versionsTarget({ max: 100 }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: { ...defaultFields, lead: { kind: 'richText', rules: { required: true } }, ...draftFields },
      targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: { drafts: { autosave: true } } },
    } as never)],
  })
  const notes = built.kayan.notes!.operations as unknown as Record<string, (input: unknown, options?: unknown) => Promise<Record<string, unknown>>>
  const blank = { root: { type: 'root', children: [] } }
  const row = await notes.create!({ id: '00000000-0000-4000-8000-000000000185', lead: richText('Lead') })
  const drafted = await notes.update!({ id: row.id, lead: blank }, { draft: true })
  assert.deepEqual(drafted.lead, blank, 'a blank draft saves')
  for (const save of [{ draft: true }, { draft: true, autosave: true }]) {
    const thrown = await notes.update!({ id: drafted.id, lead: { root: { type: 'root', children: [{ type: 'mention' }] } } }, save).catch((error: unknown) => error)
    assert.ok(thrown instanceof AsasError && thrown.status === 400, `a node no class registers is a 400 on ${JSON.stringify(save)}`)
  }
  const published = await notes.update!({ id: row.id, lead: blank }).catch((error: unknown) => error)
  assert.ok(published instanceof AsasError && published.status === 400, 'while a publish of the blank value is refused by required')
})

/** The callout a newer editor writes, at JSON version 2, under the same type as `CalloutNode`. */
class NewerCalloutNode extends ElementNode {
  $config() {
    return this.config('callout', { extends: ElementNode, stateConfigs: [{ stateConfig: toneState, flat: true }] })
  }
  exportJSON() {
    return { ...super.exportJSON(), version: 2 }
  }
}

test('185j. no write lowers the highest stored JSON version of a node type in a rich text field: a stale save, draft, autosave, bulk or step upsert is refused 409 and leaves the row, while an edit at the same version and removing every node of the type save', async () => {
  const store = memoryStore()
  const id = '00000000-0000-4000-8000-00000000185a'
  const other = '00000000-0000-4000-8000-00000000185b'
  const callout = (version: number, words: string) => ({ root: { ...richText(words).root, children: [{ type: 'callout', version, tone: 'info', direction: null, format: '', indent: 0, children: richText(words).root.children }] } })
  const buildOf = (nodes: readonly unknown[]) => {
    const mithaq = defineMithaq({
      arkan: [base, richTextRukn({ nodes: nodes as never })],
      targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }), versions: versionsTarget({ max: 100 }) },
    })
    const built = mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { ...defaultFields, body: { kind: 'richText' }, ...draftFields },
        targets: { service: { operations: {
          ...defaultOperations,
          ...versionOperations,
          // A create whose step also writes another row's body, by the conflict key, through the sealed store.
          stamp: { steps: ({ steps }: { steps: { insert: WriteStep } }) => [
            async (ctx: Ctx, tools: Tools) => (await (tools as unknown as { store: { upsert: (args: object) => Promise<unknown> } }).store.upsert({ tx: ctx.tx, kayan: built.kayan.notes, on: ['id'], data: { id, body: callout(1, 'Stamped'), _status: 'published', createdAt: new Date(), updatedAt: new Date() } }), ctx),
            steps.insert,
          ] },
        } }, versions: { drafts: { autosave: true } } },
      } as never)],
    })
    return built.kayan.notes!.operations as unknown as Record<string, (input: unknown, options?: unknown) => Promise<Record<string, unknown>>>
  }
  const older = buildOf([...defaultNodes, CalloutNode])
  const newer = buildOf([...defaultNodes, NewerCalloutNode])
  const stored = async () => (await newer.findByID!({ id }))?.body
  const refused = async (write: Promise<unknown>, what: string) => {
    const thrown = await write.then(() => undefined, (error: unknown) => error)
    assert.ok(thrown instanceof AsasError && thrown.status === 409, `${what} is refused 409: ${String(thrown)}`)
    assert.equal(thrown.key, 'error.conflict.rich_text_version', what)
    assert.equal(thrown.message, 'This rich text holds a newer node than this write. Reload it and edit the newest copy.', `${what} says so in fixed words`)
    assert.deepEqual(await stored(), callout(2, 'Upgraded'), `${what} leaves the stored value`)
  }

  await older.create!({ id, body: callout(1, 'First') })
  await newer.update!({ id, body: callout(2, 'Upgraded') })
  await refused(older.update!({ id, body: callout(1, 'Stale') }), 'a stale save')
  await refused(older.update!({ id, body: callout(1, 'Stale draft') }, { draft: true }), 'a stale draft')
  await refused(older.update!({ id, body: callout(1, 'Stale autosave') }, { draft: true, autosave: true }), 'a stale autosave')
  await refused(older.updateMany!({ where: { id: { equals: id } }, data: { body: callout(1, 'Stale bulk') } }), 'a stale bulk write')
  await refused(older.stamp!({ id: other, body: richText('Stamping') }), 'a step\'s upsert of another row')
  assert.equal(await older.findByID!({ id: other }).then(() => 200, (thrown: AsasError) => thrown.status), 404, 'whose own row is not made either')

  await newer.update!({ id, body: callout(2, 'Edited') })
  assert.deepEqual(await stored(), callout(2, 'Edited'), 'an edit at the same version saves')
  await older.update!({ id, body: richText('No callout left') })
  assert.deepEqual(await stored(), richText('No callout left'), 'and removing every callout saves, since nothing is lowered')
  await older.update!({ id, body: callout(1, 'Callout again') })
  assert.deepEqual(await stored(), callout(1, 'Callout again'), 'after which the older editor writes the type again')
})

test('223c. the memory store gives each version row an id of its own, so every save leaves exactly one latest version, the newest', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }), versions: versionsTarget({ max: 100 }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: { ...defaultFields, body: { kind: 'text' }, ...draftFields },
      targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: { drafts: true } },
    } as never)],
  })
  const notes = built.kayan.notes!.operations as unknown as Record<string, (input: unknown, options?: unknown) => Promise<Record<string, unknown>>>
  const row = await notes.create!({ id: '00000000-0000-4000-8000-000000000c01', body: 'one' })
  for (const body of ['two', 'three']) await notes.update!({ id: row.id, body }, { draft: true })
  const versions = store.rows.get('_notes_versions') ?? []
  assert.equal(new Set(versions.map((one) => one.id)).size, 3, 'three versions, each with an id of its own')
  assert.deepEqual(versions.filter((one) => one.latest).map((one) => (one.version as { body: string }).body), ['three'], 'and the newest alone is the latest')
})

test('266. on a drafts kayan whose findVersions is row-limited, a row it does not admit reads as its published copy, takes a write onto the row as it is, answers a draft or autosave 404, and is held by expectedUpdatedAt against the row, while an admitted row behaves as before', async () => {
  // findVersions admits the rows whose body is "mine" for every actor but the
  // owner, who sets the rows up; every other key is the default's.
  const store = memoryStore()
  const owner = { actor: { id: 'owner' } }
  const blind = { actor: { id: 'blind' } }
  const authorize: typeof defaultAuthorize = async (args) => {
    if (args.operation === 'findVersions' && (args.actor as { id?: string } | null)?.id === 'blind') throw new AsasError('No drafts here.', 403, 'error.forbidden.operation')
    return args.operation === 'findVersions' && !args.actor ? { body: { equals: 'mine' } } : defaultAuthorize(args)
  }
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize }), versions: versionsTarget({ max: 100 }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: { ...defaultFields, body: { kind: 'text' }, note: { kind: 'text' }, fee: { kind: 'number' }, ...draftFields },
      targets: {
        service: { operations: {
          ...defaultOperations,
          ...versionOperations,
          update: { input: ({ update }: { update: z.ZodObject }) => update.extend({ expectedUpdatedAt: z.date().optional() }), steps: ({ steps }: { steps: Record<string, Step> }) => [expectedUpdatedAt, steps.update] },
        } },
        versions: { drafts: { autosave: true } },
      },
    } as never)],
  })
  type Call = (input: unknown, options?: unknown) => Promise<Record<string, unknown>>
  const notes = built.kayan.notes!.operations as unknown as Record<string, Call>
  const refusal = (call: Promise<unknown>) => call.then(() => undefined, (thrown: unknown) => thrown instanceof AsasError ? thrown.status : thrown)
  const mine = await notes.create!({ id: '00000000-0000-4000-8000-000000000b01', body: 'mine', note: 'published', fee: 1 })
  const theirs = await notes.create!({ id: '00000000-0000-4000-8000-000000000b02', body: 'theirs', note: 'published', fee: 1 })
  await notes.update!({ id: mine.id, note: 'draft' }, { draft: true })
  await notes.update!({ id: theirs.id, note: 'hidden draft' }, { draft: true, ...owner })
  const hidden = await notes.create!({ id: '00000000-0000-4000-8000-000000000b03', body: 'theirs', note: 'draft only' }, { draft: true, ...owner })

  const page = await notes.find!({ sort: 'id' }, { draft: true }) as unknown as { docs: Record<string, unknown>[] }
  assert.deepEqual(page.docs.map((one) => [one.id, one.note]), [[mine.id, 'draft'], [theirs.id, 'published']], 'a draft find swaps in the draft of the admitted row alone')
  assert.equal((await notes.findByID!({ id: theirs.id }, { draft: true })).note, 'published', 'findByID reads the same')
  assert.equal(await refusal(notes.findByID!({ id: hidden.id }, { draft: true })), 404, 'and the draft-only row it does not admit is a 404')

  assert.equal(await refusal(notes.update!({ id: theirs.id, fee: 2 }, { draft: true })), 404, 'a draft save is a 404')
  assert.equal(await refusal(notes.update!({ id: theirs.id, fee: 2 }, { draft: true, autosave: true })), 404, 'an autosave is a 404')
  assert.equal(await refusal(notes.update!({ id: theirs.id, fee: 2, _status: 'draft' })), 404, 'a plain write that sets the draft status is a 404')
  assert.equal(await refusal(notes.update!({ id: hidden.id, fee: 2 })), 404, 'a plain write to the draft-only row is a 404')
  assert.equal(await refusal(notes.restoreVersion!({ id: theirs.id })), 404, 'and discarding its draft by the row\'s id is a 404')
  const hiddenVersion = (store.rows.get('_notes_versions') ?? []).find((one) => one.parent === theirs.id && one.latest)!
  assert.equal(await refusal(notes.restoreVersion!({ id: hiddenVersion.id })), 404, 'restoring its hidden draft by the version\'s id is a 404 too')
  assert.equal(await refusal(notes.restoreVersion!({ id: hiddenVersion.id }, blind)), 404, 'and so it is for an actor holding restoreVersion and update and no findVersions')
  assert.equal(store.rows.get('notes')!.find((one) => one.id === theirs.id)!.note, 'published', 'and publishes nothing')

  const theirsRow = await notes.findByID!({ id: theirs.id })
  const theirsDraft = (store.rows.get('_notes_versions') ?? []).find((one) => one.parent === theirs.id && one.latest)!
  assert.equal(await refusal(notes.update!({ id: theirs.id, fee: 3, expectedUpdatedAt: new Date(theirsDraft.updatedAt as string) })), 409, 'the hidden draft\'s instant is stale for an actor not admitted to it')
  const changed = await notes.update!({ id: theirs.id, fee: 3, expectedUpdatedAt: theirsRow.updatedAt })
  assert.deepEqual([changed.note, changed.fee, changed._status], ['published', 3, 'published'], 'a plain update answers the row, never the hidden draft')
  assert.equal(store.rows.get('notes')!.find((one) => one.id === theirs.id)!.note, 'published', 'and the hidden draft is not published')
  const pending = (store.rows.get('_notes_versions') ?? []).find((one) => one.parent === theirs.id && one.latest)!.version as Record<string, unknown>
  assert.deepEqual([pending.note, pending.fee, pending._status], ['hidden draft', 3, 'draft'], 'the hidden draft stays pending, with the change written into it')

  assert.equal((await notes.update!({ id: mine.id, fee: 4 }, { draft: true })).note, 'draft', 'a draft save answers the admitted draft')
  const mineRow = await notes.findByID!({ id: mine.id })
  assert.equal(await refusal(notes.update!({ id: mine.id, fee: 5, expectedUpdatedAt: mineRow.updatedAt })), 409, 'the row\'s instant is stale for an actor admitted to its newer draft')
  const latest = await notes.findByID!({ id: mine.id }, { draft: true })
  const published = await notes.update!({ id: mine.id, fee: 5, expectedUpdatedAt: latest.updatedAt })
  assert.deepEqual([published.note, published.fee, published._status], ['draft', 5, 'published'], 'and a plain update publishes the admitted draft')

  const ownHidden = await notes.create!({ id: '00000000-0000-4000-8000-000000000b04', body: 'mine', note: 'mine only' }, { draft: true })
  const bulk = await notes.updateMany!({ where: { fee: { exists: false } }, data: { fee: 6 } })
  assert.deepEqual((bulk.errors as { id: unknown }[]).map((one) => one.id), [ownHidden.id], 'a bulk names only the admitted row it left')
})

test('205. a bulk call checks its key and access before beforeTransaction, so a refused actor runs no outside step and an allowed one still does', async () => {
  const ran: string[] = []
  const note = (name: string): WriteStep => (ctx) => {
    ran.push(name)
    return ctx
  }
  const build = (allowed: boolean) => {
    const store = memoryStore()
    store.rows.set('notes', [{ id: 1, body: 'kept' }])
    const mithaq = language(store)
    return mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [
        mithaq.defineKayan({
          name: 'notes',
          access: { ...allowAccess, update: () => allowed, delete: () => allowed },
          fields: { id: { kind: 'number' }, body: { kind: 'text', rules: { required: true } } },
          targets: {
            service: {
              operations: {
                ...defaultOperations,
                updateMany: { steps: [updateMany], beforeTransaction: [note('updateMany')] },
                deleteMany: { steps: [deleteMany], beforeTransaction: [note('deleteMany')] },
              },
            },
          },
        }),
      ],
    }).kayan.notes.operations
  }
  const refused = build(false)
  for (const [name, call] of [
    ['updateMany', refused.updateMany({ where: { id: { equals: 1 } }, data: { body: 'x' } })],
    ['deleteMany', refused.deleteMany({ where: { id: { equals: 1 } } })],
  ] as const) {
    const thrown = await call.catch((error: unknown) => error)
    assert.ok(thrown instanceof AsasError && thrown.status === 403, `${name} is refused as a 403`)
  }
  assert.deepEqual(ran, [], 'a refused actor runs no beforeTransaction step')
  const allowed = build(true)
  await allowed.updateMany({ where: { id: { equals: 1 } }, data: { body: 'x' } })
  await allowed.deleteMany({ where: { id: { equals: 1 } } })
  assert.deepEqual(ran, ['updateMany', 'deleteMany'], 'an allowed actor still runs each one')
})

test('207. the page a read opens with, the most a served read may ask for, a join\'s page and the bulk ceiling are the numbers the project names', async () => {
  const { defaultLimit: page, maxLimit, joinLimit, bulkLimit } = serverTargets.service
  assert.deepEqual({ page, maxLimit, joinLimit, bulkLimit }, { page: 10, maxLimit: 100, joinLimit: 10, bulkLimit: 1000 })

  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: {
      memory: store,
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: serviceTarget({ depth: defaultDepth, defaultLimit: 2, maxLimit: 3, joinLimit: 1, bulkLimit: 2, store: 'memory', schema: 'zod', authorize: defaultAuthorize }),
      versions: versionsTarget({ max: 100 }),
    },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error }), orpcHttp({ onError: console.error, maxBodyBytes: defaultMaxBodyBytes, api: '/api/orpc' })],
    kayan: [
      mithaq.defineKayan({
        name: 'parents',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          kids: { kind: 'join', relationTo: 'kids', on: 'parent' },
          // A join's own page, over the project's.
          allKids: { kind: 'join', relationTo: 'kids', on: 'parent', defaultLimit: 3 },
        },
        targets: { service: { operations: defaultOperations } },
      }),
      mithaq.defineKayan({
        name: 'notes',
        access: allowAccess,
        fields: { ...defaultFields },
        targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: {} },
      }),
      mithaq.defineKayan({
        name: 'kids',
        access: allowAccess,
        fields: { id: { kind: 'number' }, parent: { kind: 'relationship', relationTo: 'parents' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  const { parents, kids } = built.kayan
  for (const id of [1, 2, 3]) await parents.operations.create({ id })
  for (const id of [1, 2, 3]) await kids.operations.create({ id, parent: 1 })

  assert.equal((await parents.operations.find()).limit, 2)
  assert.equal((await parents.operations.find()).docs.length, 2)
  const [parent] = (await parents.operations.find({ depth: 1, where: { id: { equals: 1 } } })).docs as { kids: unknown[]; allKids: unknown[] }[]
  assert.equal(parent!.kids.length, 1, 'the project\'s joinLimit')
  assert.equal(parent!.allKids.length, 3, 'the join field\'s own defaultLimit')

  for (const [prefix, rpc] of [['/api', false], ['/api/orpc', false], ['/api/rpc', true]] as const) {
    const post = async (operation: string, input: object) => {
      const kayan = operation === 'find' ? 'parents' : 'notes'
      const response = await built.handler(new Request(`http://test${prefix}/${kayan}/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rpc ? { json: input } : input),
      }))
      const body = await response.json() as { json?: Record<string, unknown> } & Record<string, unknown>
      return { status: response.status, body: (body.json ?? body) as { limit?: number; data?: { key?: string; params?: unknown } } }
    }
    for (const operation of ['find', 'findVersions']) {
      const refused = await post(operation, { limit: 4 })
      assert.equal(refused.status, 400, `${prefix}/${operation} limit 4`)
      assert.deepEqual(refused.body.data, { key: 'error.invalid.read_option_range', params: { option: 'limit', minimum: 1, maximum: 3 } }, `${prefix}/${operation}`)
      assert.equal((await post(operation, { limit: 3 })).status, 200, `${prefix}/${operation} limit 3`)
      assert.equal((await post(operation, {})).body.limit, 2, `${prefix}/${operation} the project's page`)
    }
  }

  const thrown = await kids.operations.updateMany({ where: { parent: { equals: 1 } }, data: { parent: 2 } }).catch((error: unknown) => error)
  assert.ok(thrown instanceof AsasError && thrown.status === 400)
  assert.equal(thrown.key, 'error.invalid.bulk_limit')
  assert.deepEqual(thrown.params, { kayan: 'kids', operation: 'updateMany', matched: 3, ceiling: 2 })
  assert.equal((await kids.operations.updateMany({ where: { id: { in: [1, 2] } }, data: { parent: 2 } })).docs.length, 2, 'two rows are within it')

  const joined = (parentField: Record<string, unknown>, kidField: Record<string, unknown> = {}) => () =>
    mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [
        mithaq.defineKayan({ name: 'parents', fields: { id: { kind: 'number' }, kids: parentField as never }, targets: { service: { operations: defaultOperations } } }),
        mithaq.defineKayan({ name: 'kids', fields: { id: { kind: 'number' }, parent: { kind: 'relationship', relationTo: 'parents', ...kidField } as never }, targets: { service: { operations: defaultOperations } } }),
      ],
    })
  assert.throws(
    joined({ kind: 'join', relationTo: 'kids', on: 'parent', defaultLimit: 4 }),
    /Kayan "parents" field "kids" has defaultLimit 4, and a join's page is a whole number from 1 to service\.maxLimit 3\./,
  )
  assert.throws(
    joined({ kind: 'join', relationTo: 'kids', on: 'parent' }, { defaultLimit: 2 }),
    /Kayan "kids" field "parent" has kind "relationship" and carries key "defaultLimit", which only a join may carry\./,
  )
  const negative = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit: 2, maxLimit: -1, joinLimit: 1, bulkLimit: 2, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  assert.throws(
    () => negative.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [
        negative.defineKayan({ name: 'parents', fields: { id: { kind: 'number' }, kids: { kind: 'join', relationTo: 'kids', on: 'parent', defaultLimit: 1 } }, targets: { service: { operations: defaultOperations } } }),
        negative.defineKayan({ name: 'kids', fields: { id: { kind: 'number' }, parent: { kind: 'relationship', relationTo: 'parents' } }, targets: { service: { operations: defaultOperations } } }),
      ],
    }),
    /^Error: service\.maxLimit must be a positive integer\.$/,
  )

  assert.equal((await kids.operations.find({ limit: 4 })).docs.length, 3, 'a local find past maxLimit answers every row it asked for')
})

test('251. an operation\'s own input key that shares a join\'s name is never read as ids of related rows, since a join takes no write', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  // The kids' reads are counted, so the test sees whether the relationship
  // check asked the store for rows by the join key's values.
  const asked: unknown[] = []
  const find = store.find
  store.find = (async (args: Parameters<typeof find>[0]) => {
    if (args.kayan === 'kids') asked.push(args.args.where)
    return find(args)
  }) as typeof find
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'parents',
        access: allowAccess,
        fields: { id: { kind: 'number' }, title: { kind: 'text' }, kids: { kind: 'join', relationTo: 'kids', on: 'parent' } },
        targets: {
          service: {
            operations: {
              ...defaultOperations,
              setKids: { input: () => z.object({ id: z.number(), title: z.string(), kids: z.array(z.string()) }).strict(), steps: [update] },
            },
          },
        },
      }),
      mithaq.defineKayan({
        name: 'kids',
        access: allowAccess,
        fields: { id: { kind: 'number' }, parent: { kind: 'relationship', relationTo: 'parents' } },
        targets: { service: { operations: defaultOperations } },
      }),
    ],
  })
  await built.kayan.parents.operations.create({ id: 1, title: 'one' })
  const operations = built.kayan.parents.operations as unknown as Record<string, (input: unknown) => Promise<Record<string, unknown>>>
  const thrown = await operations.setKids!({ id: 1, title: 'two', kids: ['wash', 'dry'] }).catch((error: unknown) => error)
  assert.deepEqual(asked, [], 'no kid was looked up by the checklist\'s values')
  // The key reaches the store seal, so the runner names the step's mistake: a
  // join is no column, and nothing writes it.
  assert.ok(thrown instanceof Error && !(thrown instanceof AsasError), 'a fault of the operation, not of the caller')
  assert.equal(thrown.message, 'Kayan "parents" operation "setKids" wrote field "kids", which declares providedBy "never" on update, so nothing supplies it.')
  assert.equal((store.rows.get('parents')![0] as { title: string }).title, 'one', 'and nothing was written')
})

test('241. a join reads its rows in the order its defaultSort names, as Payload\'s join does, and a sort the child kayan cannot order by is refused at build', async () => {
  const mithaq = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: {
      memory: memoryStore(),
      zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
      service: { capability: 'service', store: 'memory', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit },
    },
  })
  const kids = (fields: Record<string, unknown> = {}) => mithaq.defineKayan({
    name: 'kids',
    access: allowAccess,
    fields: {
      id: { kind: 'number' },
      name: { kind: 'text' },
      parent: { kind: 'relationship', relationTo: 'parents' },
      ...fields,
    } as never,
    targets: { service: { operations: defaultOperations } },
  })
  const build = (defaultSort: unknown, fields?: Record<string, unknown>) => mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({
        name: 'parents',
        access: allowAccess,
        fields: {
          id: { kind: 'number' },
          kids: { kind: 'join', relationTo: 'kids', on: 'parent' },
          byName: { kind: 'join', relationTo: 'kids', on: 'parent', defaultSort },
        } as never,
        targets: { service: { operations: defaultOperations } },
      }),
      kids(fields),
    ],
  })
  const built = build('-name')
  await built.kayan.parents.operations.create({ id: 1 } as never)
  for (const [id, name] of [[1, 'b'], [2, 'c'], [3, 'a']] as const) await built.kayan.kids.operations.create({ id, name, parent: 1 } as never)
  const [parent] = (await built.kayan.parents.operations.find({ depth: 1 })).docs as unknown as { kids: { id: number }[]; byName: { id: number }[] }[]
  assert.deepEqual(parent!.byName.map(({ id }) => id), [2, 1, 3], 'by name, descending')
  assert.deepEqual(parent!.kids.map(({ id }) => id), [3, 2, 1], 'a join that names none keeps the child\'s own default order')

  // A localized field, a set of rows, and a field no actor may read: none is
  // an order the child's read takes.
  const unordered = {
    title: { kind: 'text', label: { ar: 'العنوان', en: 'Title' }, rules: { localized: true } },
    tags: { kind: 'relationship', relationTo: 'parents', hasMany: true },
    secret: { kind: 'text', access: { read: () => false } },
  }
  const refused = (defaultSort: unknown, message: string) =>
    assert.throws(() => build(defaultSort, unordered), (thrown: Error) => thrown.message === message, message)
  for (const sort of [3, 'a.b', '', '--name']) {
    refused(sort, `Kayan "parents" field "byName" has defaultSort ${JSON.stringify(sort)}, and a join's sort is one field of kayan "kids", optionally prefixed with "-".`)
  }
  refused('nope', 'Kayan "parents" field "byName" has defaultSort "nope", which is no field of kayan "kids".')
  for (const field of ['title', 'tags', 'secret']) {
    refused(`-${field}`, `Kayan "parents" field "byName" has defaultSort "-${field}", and kayan "kids" cannot be ordered by "${field}".`)
  }
})

test('242. the shipped findByID takes depth, as Payload\'s does, so a served read of one row populates its joins, and delete still takes the id alone', async () => {
  for (const schema of ['zod', 'plain'] as const) {
    const mithaq = defineMithaq({
      arkan: [base],
      targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema, authorize: defaultAuthorize }) },
    })
    const built = mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [
        mithaq.defineKayan({
          name: 'parents',
          access: allowAccess,
          fields: { id: { kind: 'number' }, kids: { kind: 'join', relationTo: 'kids', on: 'parent' } },
          targets: { service: { operations: defaultOperations } },
        }),
        mithaq.defineKayan({
          name: 'kids',
          access: allowAccess,
          fields: { id: { kind: 'number' }, parent: { kind: 'relationship', relationTo: 'parents' } },
          targets: { service: { operations: defaultOperations } },
        }),
      ],
    })
    await built.kayan.parents.operations.create({ id: 1 } as never)
    await built.kayan.kids.operations.create({ id: 1, parent: 1 } as never)
    const post = async (operation: string, input: object) => {
      const response = await built.handler(new Request(`http://test/api/parents/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }))
      return { status: response.status, body: await response.json() as { kids?: { id: number }[]; data?: { key?: string; params?: unknown } } }
    }
    const deep = await post('findByID', { id: 1, depth: 1 })
    assert.equal(deep.status, 200, schema)
    assert.deepEqual(deep.body.kids?.map(({ id }) => id), [1], 'depth 1 populates the join')
    // After it, since this store hands back the very rows it holds: the join is
    // written onto a copy, so no later read carries the rows an earlier one
    // populated, which may be rows the later reader may not see.
    const shallow = await post('findByID', { id: 1, depth: 0 })
    assert.equal(shallow.status, 200, schema)
    assert.equal('kids' in shallow.body, false, 'depth 0 populates nothing')
    assert.equal('kids' in (await post('findByID', { id: 1 })).body, false, 'and nor does a read that names none')
    assert.equal('kids' in (await built.kayan.parents.operations.find()).docs[0]!, false, 'nor a find at depth 0')
    const past = await post('findByID', { id: 1, depth: defaultDepth })
    assert.equal(past.status, 400)
    assert.deepEqual(past.body.data, { key: 'error.invalid.read_option_integer', params: { option: 'depth', maximum: defaultDepth - 1 } })
    assert.equal((await post('findByID', { id: 1, limit: 1 })).status, 400)
    assert.equal((await post('delete', { id: 1, depth: 1 })).status, 400)
  }

  const fields = { id: { kind: 'number', name: 'id' }, title: { kind: 'text', name: 'title' } } as never
  for (const [name, derived] of [['zod', zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive(fields).byID], ['plain', plainTarget.derive(fields).byID]] as const) {
    const parse = (value: unknown) => derived['~standard'].validate(value)
    assert.deepEqual(await parse({ id: 1, depth: 1 }), { value: { id: 1, depth: 1 } }, `the ${name} target's byID takes a depth`)
    assert.deepEqual(await parse({ id: 1 }), { value: { id: 1 } }, `and the ${name} target's needs none`)
    for (const refused of [{ id: 1, title: 'Not the id' }, { depth: 1 }]) {
      const result = await parse(refused)
      assert.ok('issues' in result && result.issues, `the ${name} target's byID refuses ${JSON.stringify(refused)}`)
    }
  }

  // A target that derives no such shape is refused by name at build rather than failing the first
  // read of one row.
  const older = {
    ...zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    derive: (fields: Record<string, never>) => {
      const { byID: _byID, ...rest } = zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }).derive(fields)
      return rest
    },
  } as unknown as typeof serverTargets.zod
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), zod: older, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  assert.throws(
    () => mithaq.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [mithaq.defineKayan({ name: 'notes', fields: { id: { kind: 'number' } }, targets: { service: { operations: defaultOperations } } })] }),
    (thrown: Error) => thrown.message === 'Kayan "notes" names schema target "zod", which derives no byID shape, which is what a read of one row parses. Derive "byID" beside "id": the id and an optional depth.',
  )
})

/**
 * A required text refuses an empty value but not a value of spaces, and a draft save skips the
 * rule, since a draft skips validation.
 */
test('215a. a required text refuses the empty value on a publish and on a kayan without drafts, under its required key, lets spaces through, and a draft still saves it', async () => {
  const mithaq = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }), versions: versionsTarget({ max: 100 }) },
  })
  const fields = {
    id: { kind: 'number' },
    title: { kind: 'text', rules: { required: true } },
    tags: { kind: 'textArray', rules: { required: true } },
    name: { kind: 'text', rules: { required: true, localized: true } },
  } as const
  const full = { title: 'T', tags: ['a'], name: { ar: 'ا', en: 'N' } }
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({ name: 'notes', access: allowAccess, fields, targets: { service: { operations: defaultOperations } } }),
      mithaq.defineKayan({ name: 'plainNotes', access: allowAccess, fields, targets: { service: { schema: 'plain', operations: defaultOperations } } }),
      mithaq.defineKayan({
        name: 'drafts',
        access: allowAccess,
        fields: { ...defaultFields, title: fields.title, ...draftFields },
        targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: { drafts: true } },
      } as never),
    ],
  })
  for (const kayan of ['notes', 'plainNotes'] as const) {
    const operations = built.kayan[kayan].operations as unknown as Record<string, (input: unknown, options?: unknown) => Promise<Record<string, unknown>>>
    for (const [field, empty] of [['title', ''], ['name', { ar: 'ا', en: '' }]] as const) {
      const thrown = await operations.create!({ ...full, [field]: empty }).catch((error: unknown) => error)
      assert.ok(thrown instanceof AsasError && thrown.status === 400, `${kayan} refuses an empty required ${field}`)
      if (kayan === 'notes') assert.deepEqual(thrown.params, { issues: [{ path: field, message: `notes.${field}.required` }] }, `under ${field}'s required key`)
    }
    // A cleared box is sent as null, and a required field refuses it under
    // the same key, never as a value that is not text.
    const cleared = await operations.create!({ ...full, title: null }).catch((error: unknown) => error)
    assert.ok(cleared instanceof AsasError && cleared.status === 400, `${kayan} refuses a null required title`)
    if (kayan === 'notes') assert.deepEqual(cleared.params, { issues: [{ path: 'title', message: 'notes.title.required' }] }, 'under the required key')
    const spaces = await operations.create!({ ...full, id: 1, title: '   ', tags: [] })
    assert.equal(spaces.title, '   ', `${kayan} takes a title of spaces, as Payload does`)
    // A required list is there and may be empty, as a role holding no
    // permission is; `minRows` is how a field asks for one.
    assert.deepEqual(spaces.tags, [], `${kayan} takes an empty required textArray`)
    const refused = await operations.update!({ id: spaces.id, title: '' }).catch((error: unknown) => error)
    assert.ok(refused instanceof AsasError && refused.status === 400, `${kayan} refuses an update that empties a required text`)
  }
  const drafts = built.kayan.drafts!.operations as unknown as Record<string, (input: unknown, options?: unknown) => Promise<Record<string, unknown>>>
  const draft = await drafts.create!({ id: '00000000-0000-4000-8000-000000000215', title: '' }, { draft: true })
  assert.equal(draft.title, '', 'a draft saves an empty required text')
  const published = await drafts.update!({ id: draft.id, title: '' }).catch((error: unknown) => error)
  assert.ok(published instanceof AsasError && published.status === 400, 'and a publish of it is refused')
  assert.deepEqual((published as AsasError).params, { issues: [{ path: 'title', message: 'drafts.title.required' }] })
})

test('215b. a bulk update handed no data writes nothing, and says so under the empty-change key, where it used to move every row\'s updatedAt', async () => {
  const store = memoryStore()
  const mithaq = language(store)
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({ name: 'notes', access: allowAccess, fields: { ...defaultFields, body: { kind: 'text' } }, targets: { service: { operations: defaultOperations } } } as never)],
  })
  const notes = built.kayan.notes!.operations as unknown as Record<string, (input: unknown) => Promise<Record<string, unknown>>>
  const row = await notes.create!({ id: '00000000-0000-4000-8000-000000000215', body: 'kept' })
  for (const data of [{}, undefined]) {
    const thrown = await notes.updateMany!({ where: { body: { equals: 'kept' } }, ...(data && { data }) }).catch((error: unknown) => error)
    assert.deepEqual([(thrown as AsasError).status, (thrown as AsasError).key], [400, 'error.invalid.empty_update'], `${JSON.stringify(data)} is refused as an empty change: ${String(thrown)}`)
  }
  assert.deepEqual(store.rows.get('notes')!.map((one) => one.updatedAt), [row.updatedAt], 'and no row moved')
})

test('215i. a stored empty value in a required text reads on either schema target, since a row read judges no rule', async () => {
  const store = memoryStore()
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const fields = { id: { kind: 'number' }, title: { kind: 'text', rules: { required: true } }, tags: { kind: 'textArray', rules: { required: true } } } as const
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({ name: 'notes', access: allowAccess, fields, targets: { service: { operations: defaultOperations } } }),
      mithaq.defineKayan({ name: 'plainNotes', access: allowAccess, fields, targets: { service: { schema: 'plain', operations: defaultOperations } } }),
    ],
  })
  for (const kayan of ['notes', 'plainNotes'] as const) {
    store.rows.set(kayan, [{ id: 1, title: '', tags: [] }])
    assert.deepEqual(await built.kayan[kayan].operations.findByID({ id: 1 }), { id: 1, title: '', tags: [] }, `${kayan} reads the stored empty values`)
  }
})

test('215j. null is the field\'s own required refusal only where the field is required, and never an element\'s or a locale\'s on a field that is not, and a trimmed required text reads it the same', async () => {
  const mithaq = defineMithaq({
    locales: ['ar', 'en'] as const,
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({
      name: 'notes',
      access: allowAccess,
      fields: {
        id: { kind: 'number' },
        tags: { kind: 'textArray' },
        name: { kind: 'text', rules: { localized: true } },
        title: { kind: 'text', rules: { localized: true, required: true } },
        code: { kind: 'text', rules: { required: true, trim: true } },
      },
      targets: { service: { operations: defaultOperations } },
    })],
  })
  const full = { title: { ar: 'ا', en: 'T' }, code: 'c' }
  const issueOf = async (data: Record<string, unknown>) =>
    ((await built.kayan.notes.operations.create({ ...full, ...data } as never).catch((error: unknown) => error)) as AsasError).params
  assert.deepEqual(await issueOf({ tags: ['a', null] }), { issues: [{ path: 'tags.1', message: 'notes.tags.invalid' }] }, 'a null element is a value the kind refuses')
  assert.deepEqual(await issueOf({ name: { ar: 'ا', en: null } }), { issues: [{ path: 'name.en', message: 'notes.name.invalid' }] }, 'and so is a null locale of a field that is not required')
  assert.deepEqual(await issueOf({ title: { ar: 'ا', en: null } }), { issues: [{ path: 'title.en', message: 'notes.title.required' }] }, 'while a cleared locale of a required field is its required refusal')
  assert.deepEqual(await issueOf({ code: null }), { issues: [{ path: 'code', message: 'notes.code.required' }] }, 'and so is a cleared trimmed required text')
})

test('215k. a draft takes an emptied required title, and a publish of that draft naming nothing but its status is refused', async () => {
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }), versions: versionsTarget({ max: 100 }) },
  })
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [mithaq.defineKayan({
      name: 'drafts',
      access: allowAccess,
      fields: { ...defaultFields, title: { kind: 'text', rules: { required: true } }, ...draftFields },
      targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: { drafts: true } },
    } as never)],
  })
  const drafts = built.kayan.drafts!.operations as unknown as Record<string, (input: unknown, options?: unknown) => Promise<Record<string, unknown>>>
  const row = await drafts.create!({ id: '00000000-0000-4000-8000-000000000216', title: 'Kept' })
  const draft = await drafts.update!({ id: row.id, title: '' }, { draft: true })
  assert.equal(draft.title, '', 'a draft update takes the empty title')
  const published = await drafts.update!({ id: row.id, _status: 'published' }).catch((error: unknown) => error)
  assert.ok(published instanceof AsasError && published.status === 400, 'publishing that draft by its status alone is refused')
  assert.deepEqual(published.params, { issues: [{ path: 'title', message: 'drafts.title.required' }] })
})

test('215l. a bulk over rows never published leaves them and names each in errors, so a list that shows drafts tells the person which ticked rows did not change, and only to an actor who may read drafts', async () => {
  // The same build twice: one runner grants every key, the other refuses
  // `findVersions` alone, the key a draft read asks.
  const build = (readsDrafts: boolean) => {
    const store = memoryStore()
    const authorize: typeof defaultAuthorize = (args) => {
      if (!readsDrafts && args.operation === 'findVersions') throw new AsasError('No drafts here.', 403, 'error.forbidden.operation')
      return defaultAuthorize(args)
    }
    const mithaq = defineMithaq({
      arkan: [base],
      targets: { memory: store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize }), versions: versionsTarget({ max: 100 }) },
    })
    const built = mithaq.buildAsas({
      http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
      kayan: [mithaq.defineKayan({
        name: 'drafts',
        access: allowAccess,
        fields: { ...defaultFields, title: { kind: 'text' }, fee: { kind: 'number' }, ...draftFields },
        targets: { service: { operations: { ...defaultOperations, ...versionOperations } }, versions: { drafts: true } },
      } as never)],
    })
    return { store, drafts: built.kayan.drafts!.operations as unknown as Record<string, (input: unknown, options?: unknown) => Promise<Record<string, unknown>>> }
  }
  const { store, drafts } = build(true)
  const published = await drafts.create!({ id: '00000000-0000-4000-8000-000000000301', title: 'Out', fee: 1 })
  const draft = await drafts.create!({ id: '00000000-0000-4000-8000-000000000302', title: 'Draft', fee: 1 }, { draft: true })
  const pending = await drafts.create!({ id: '00000000-0000-4000-8000-000000000303', title: 'Pending', fee: 1 })
  await drafts.update!({ id: pending.id, title: 'Pending draft' }, { draft: true })
  const where = { id: { in: [published.id, draft.id, pending.id] } }
  const updated = await drafts.updateMany!({ where, data: { fee: 2 } })
  assert.deepEqual((updated.docs as { id: unknown }[]).map((one) => one.id), [published.id, pending.id], 'the published rows are written, the one with a pending draft among them')
  assert.deepEqual((updated.errors as { id: unknown }[]).map((one) => one.id), [draft.id], 'and only the row never published is named as left')
  assert.equal(store.rows.get('drafts')!.find((one) => one.id === draft.id)!.fee, 1, 'and is left as it was')
  const deleted = await drafts.deleteMany!({ where })
  assert.deepEqual((deleted.errors as { id: unknown }[]).map((one) => one.id), [draft.id], 'a bulk delete names it the same way')

  const hidden = build(false)
  const out = await hidden.drafts.create!({ id: '00000000-0000-4000-8000-000000000304', title: 'Out', fee: 1 })
  hidden.store.rows.get('drafts')!.push({ ...hidden.store.rows.get('drafts')![0]!, id: '00000000-0000-4000-8000-000000000305', title: 'Draft', _status: 'draft' })
  const blind = await hidden.drafts.updateMany!({ where: { fee: { equals: 1 } }, data: { fee: 3 } })
  assert.deepEqual((blind.docs as { id: unknown }[]).map((one) => one.id), [out.id], 'the published row is still written')
  assert.deepEqual(blind.errors, [], 'and errors names nothing')
})

test('215n. a required trimmed text refuses a value of spaces on either schema target, since the trim empties it before required reads it', async () => {
  const mithaq = defineMithaq({
    arkan: [base],
    targets: { memory: memoryStore(), zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }), plain: plainTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'memory', schema: 'zod', authorize: defaultAuthorize }) },
  })
  const fields = { id: { kind: 'number' }, code: { kind: 'text', rules: { required: true, trim: true } } } as const
  const built = mithaq.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [
      mithaq.defineKayan({ name: 'notes', access: allowAccess, fields, targets: { service: { operations: defaultOperations } } }),
      mithaq.defineKayan({ name: 'plainNotes', access: allowAccess, fields, targets: { service: { schema: 'plain', operations: defaultOperations } } }),
    ],
  })
  for (const kayan of ['notes', 'plainNotes'] as const) {
    const thrown = await built.kayan[kayan].operations.create({ id: 1, code: '   ' }).catch((error: unknown) => error)
    assert.ok(thrown instanceof AsasError && thrown.status === 400, `${kayan} refuses a trimmed value of spaces`)
    assert.deepEqual(thrown.params, { issues: [{ path: 'code', message: `${kayan}.code.required` }] }, 'under the required key')
    assert.equal((await built.kayan[kayan].operations.create({ id: 2, code: ' x ' })).code, 'x', 'and keeps the trimmed value it takes')
  }
})

test('zodTarget validates with the custom kinds map it receives', { timeout: 10_000 }, () => {
  const custom = zodTarget({ kinds: { custom: () => z.literal('custom') }, rules: {}, idKinds: [] })
  const { create } = custom.derive({ value: { name: 'value', kind: 'custom' } } as never)
  assert.equal(create.safeParse({ value: 'custom' }).success, true)
  assert.equal(create.safeParse({ value: 'other' }).success, false)
})
