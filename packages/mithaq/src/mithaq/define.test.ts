import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  base,
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
  draftFields,
  drizzleAdapter,
  drizzleKinds, drizzleRules, drizzleIdKinds,
  defaultMaxBodyBytes,
  fetchHttp,
  serviceTarget,
  versionOperations,
  versions,
  zodKinds, zodRules, zodIdKinds, zodTarget,
} from '../index.ts'

const language = defineMithaq({
  arkan: [base, versions({ max: 10 })],
  targets: {
    drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', kinds: drizzleKinds, rules: drizzleRules, idKinds: drizzleIdKinds }),
    zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }),
  },
})
const title = { kind: 'text', label: { en: 'Title' } } as const
const same = (derived: { fields: object; targets: { service: { operations: object } } }, byHand: typeof derived) => {
  assert.deepEqual(derived, byHand)
  assert.deepEqual(Object.keys(derived.fields), Object.keys(byHand.fields))
  assert.deepEqual(Object.keys(derived.targets.service.operations), Object.keys(byHand.targets.service.operations))
}

test('a kayan whose fields and operations are written over the defaults is the kayan that spreads them by hand', () => {
  same(
    language.defineKayan({ name: 'posts', fields: ({ defaults }) => ({ ...defaults, title }), targets: { service: { operations: ({ defaults }) => defaults } } }),
    language.defineKayan({ name: 'posts', fields: { ...defaultFields, title }, targets: { service: { operations: defaultOperations } } }),
  )
})

test('the defaults of a kayan that keeps versions hold their operations, and with drafts the status field', () => {
  same(
    language.defineKayan({ name: 'posts', fields: ({ defaults }) => ({ ...defaults, title }), targets: { versions: {}, service: { operations: ({ defaults }) => defaults } } }),
    language.defineKayan({ name: 'posts', fields: { ...defaultFields, title }, targets: { versions: {}, service: { operations: { ...defaultOperations, ...versionOperations } } } }),
  )
  same(
    language.defineKayan({ name: 'posts', fields: ({ defaults }) => ({ ...defaults, title }), targets: { versions: { drafts: true }, service: { operations: ({ defaults }) => defaults } } }),
    language.defineKayan({ name: 'posts', fields: { ...defaultFields, ...draftFields, title }, targets: { versions: { drafts: true }, service: { operations: { ...defaultOperations, ...versionOperations } } } }),
  )
})

test('a global\'s defaults are its own fields and operations, in the order its documentation spreads them', () => {
  same(
    language.defineGlobal({ name: 'site', fields: ({ defaults }) => ({ ...defaults, title }), targets: { service: { operations: ({ defaults }) => defaults } } }),
    language.defineGlobal({ name: 'site', fields: { ...defaultFields, ...defaultGlobalFields, title }, targets: { service: { operations: defaultGlobalOperations } } }),
  )
})

test('a kayan built without defineKayan that writes its operations as a function is refused, since nothing hands it the defaults', () => {
  const raw = { name: 'raw', fields: defaultFields, targets: { service: { operations: () => defaultOperations } } }
  assert.throws(() => language.buildAsas({ http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], kayan: [raw] } as never), /Kayan "raw" writes its operations as a function, which only defineKayan and defineGlobal run/)
})

test('wire input validates an omitted toString field after uuid normalization', async () => {
  const built = language.buildAsas({
    http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })],
    kayan: [language.defineKayan({
      name: 'wireInputs',
      fields: { ...defaultFields, toString: { kind: 'text' } },
      targets: { service: { operations: defaultOperations } },
    })],
  })
  const create = built.operations.find((operation) => operation.kayan === 'wireInputs' && operation.name === 'create')!
  const input = Object.assign(Object.create(null), { id: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF' })
  const result = await create.input['~standard'].validate(input)
  assert.equal(result.issues, undefined, 'normalizing the id must not supply Object.prototype.toString as a field value')
  if (!result.issues) assert.equal((result.value as { id: string }).id, 'abcdefab-cdef-4abc-8def-abcdefabcdef')
  assert.equal(input.id, 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF', 'the caller keeps its input')
})
