import assert from 'node:assert/strict'
import { base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, defineMithaq, fetchHttp, defaultMaxBodyBytes, serviceTarget, zodTarget, zodKinds, zodRules, zodIdKinds, type Store, type Where } from '../../../index.ts'

/** The same privacy scenario over the server stores and the injected device store. `dropsEmptyBranch` is set for the SQL stores, which drop an `or` branch that compiles to nothing, as main did. */
export const mixedWherePrivacy = async ({ store, schemaName, dropsEmptyBranch }: { store: Pick<Store, 'capability' | 'placement'>; schemaName?: string; dropsEmptyBranch?: boolean }) => {
  const language = defineMithaq({ arkan: [base], targets: {
    store: store as Store, zod: zodTarget({ kinds: zodKinds, rules: zodRules, idKinds: zodIdKinds }),
    service: serviceTarget({ store: 'store', schema: 'zod', authorize: defaultAuthorize, depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit }),
  } })
  let constraint: Where | true = true
  const access = { create: () => true, read: () => true, update: () => true, delete: () => true }
  const patient = language.defineKayan({ name: 'patient', ...(schemaName && { schemaName }), fields: { ...defaultFields, id: { kind: 'number' }, name: { kind: 'text', rules: { required: true } } }, access: { ...access, read: () => constraint }, targets: { service: { operations: defaultOperations } } })
  const note = language.defineKayan({ name: 'note', ...(schemaName && { schemaName }), fields: { ...defaultFields, id: { kind: 'number' }, title: { kind: 'text' }, patient: { kind: 'relationship', relationTo: 'patient' } }, access, targets: { service: { operations: defaultOperations } } })
  const built = language.buildAsas({ kayan: [patient, note], http: (store.placement === 'device' ? [] : [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: (error) => { throw error } })]) as never })
  // Tables already exist: connecting a Postgres dev store would push unrelated schemas.
  for (const [at, name] of ['visible', 'hidden'].entries()) {
    const row = await built.kayan.patient.operations.create({ id: at + 1, name })
    await built.kayan.note.operations.create({ id: at + 1, title: name, patient: row.id })
  }
  for (const joiner of ['and', 'or', 'both', 'nested'] as const) {
    const present = { id: { exists: true } }
    const sibling = { name: { equals: 'visible' } }
    constraint = joiner === 'both' ? { and: [present], or: [present], ...sibling }
      : joiner === 'nested' ? { and: [{ or: [present], ...sibling }] }
      : { [joiner]: [present], ...sibling } as Where
    assert.equal((await built.kayan.patient.operations.find()).totalDocs, 1, `${joiner}: the direct builder preserves siblings`)
    assert.equal((await built.kayan.patient.operations.count()).totalDocs, 1)
    for (const name of ['visible', 'hidden', 'absent']) {
      const where = { 'patient.name': { equals: name } }
      const expected = name === 'visible' ? 1 : 0
      assert.equal((await built.kayan.note.operations.find({ where })).totalDocs, expected, `${joiner}: related find ${name}`)
      assert.equal((await built.kayan.note.operations.count({ where })).totalDocs, expected, `${joiner}: related count ${name}`)
    }
    // The caller's grammar and normalization must retain both logical keys and field siblings too.
    const where = { and: [{ title: { exists: true } }], or: [{ id: { exists: true } }], title: { equals: 'absent' } }
    assert.equal((await built.kayan.note.operations.find({ where })).totalDocs, 0)
    assert.equal((await built.kayan.note.operations.count({ where })).totalDocs, 0)
  }
  // The default authorizer already refuses empty access arrays; raw stores still need boolean identities.
  constraint = { or: [] }
  await assert.rejects(built.kayan.patient.operations.find(), /access constraint "or" must be a non-empty array/)
  constraint = { and: [] }
  await assert.rejects(built.kayan.patient.operations.find(), /access constraint "and" must be a non-empty array/)
  const raw = built.targets.store as Store
  const sort = { field: 'id', direction: 'asc' as const }
  for (const [where, expected] of [
    [{ or: [] }, 0], [{ and: [] }, 2],
    [{ and: [{ or: [] }] }, 0], [{ or: [{ or: [] }] }, 0],
    [{ and: [], or: [] }, 0], [{ or: [], name: { equals: 'visible' } }, 0],
    [{ or: [{ and: [] }, { name: { equals: 'absent' } }] }, dropsEmptyBranch ? 0 : 2],
    [{ or: [{}, { name: { equals: 'absent' } }] }, dropsEmptyBranch ? 0 : 2],
    [{ and: [{ and: [] }, { name: { equals: 'visible' } }] }, 1],
    ...(dropsEmptyBranch ? [[{ or: [{ name: { like: '   ' } }, { name: { equals: 'visible' } }] }, 1], [{ or: [{ name: { like: '   ' } }] }, 2]] : []),
  ] as [Where, number][]) {
    assert.equal((await raw.find({ kayan: 'patient', args: { where, sort, limit: 10, page: 1 } })).totalDocs, expected, JSON.stringify(where))
    assert.equal(await raw.count!({ kayan: 'patient', args: { where } }), expected, JSON.stringify(where))
    assert.equal(await raw.sum!({ kayan: 'patient', field: 'id', where }), expected === 2 ? '3' : String(expected))
    if (expected === 0) {
      await assert.rejects(raw.transaction((tx) => raw.update({ tx, kayan: 'patient', id: 1, data: { name: 'changed' }, where })))
      await assert.rejects(raw.transaction((tx) => raw.remove({ tx, kayan: 'patient', id: 1, where })))
      await assert.rejects(raw.transaction((tx) => raw.upsert!({ tx, kayan: 'patient', on: ['id'], data: { id: 1, name: 'changed', createdAt: new Date(), updatedAt: new Date() }, where })))
    }
  }
  constraint = true
  assert.equal((await built.kayan.patient.operations.findByID({ id: 1 }))?.name, 'visible')
  assert.equal((await built.kayan.patient.operations.count()).totalDocs, 2)
}
