import { same } from '../mithaq/where.ts'
import type { Field, ResolvedKayan } from '../mithaq/types.ts'
import type { Store } from '../mithaq/language.ts'
import { snakeCase, versionsTableOf } from '../mithaq/resolve.ts'
import { providerOf } from '../base/rules.ts'
import type { Authorize, ManagedAdmin } from '../asas/runner/write.ts'
import type { Where } from '../mithaq/where.ts'
import { missing } from '../asas/runner/errors.ts'
import { findVersionByID, findVersions, issueRefusal, restoreVersion, type Operations } from '../asas/runner/steps.ts'
import type { KayanVersions } from './index.ts'

/**
 * The `_status` field a kayan that keeps drafts spreads into its own `fields`.
 * A plain read leaves out a row that is not `published`.
 */
export const draftFields = {
  _status: {
    kind: 'text',
    label: { en: 'Status', ar: 'الحالة' },
    options: [
      { value: 'draft', label: { en: 'Draft', ar: 'مسودة' } },
      { value: 'published', label: { en: 'Published', ar: 'منشور' } },
    ],
    rules: { defaultValue: 'draft', index: true },
  },
} as const satisfies Record<string, Field>

/**
 * The three operations a kayan that keeps versions spreads beside `defaultOperations`:
 * `findVersions`, `findVersionByID` and `restoreVersion`.
 */
export const versionOperations = {
  findVersions: { steps: [findVersions] },
  findVersionByID: { steps: [findVersionByID] },
  restoreVersion: { steps: [restoreVersion] },
} satisfies Operations

export const versionsOf = ({
  kayan,
  kept,
  name,
  window,
}: {
  kayan: ResolvedKayan
  kept: KayanVersions
  name: string
  window: number
}): NonNullable<ResolvedKayan['versions']> => {
  const where = `Kayan "${kayan.name}" writes "targets.${name}"`
  if (kayan.single) throw new Error(`${where}, and a global keeps no versions: versions are a kayan's alone.`)
  // A version is addressed by its own uuid, which the kayan's id shape takes only where its id is a uuid.
  if (kayan.fields.id?.kind !== 'uuid') {
    throw new Error(`${where}, and its id is of kind "${String(kayan.fields.id?.kind)}", while a version is addressed by a uuid. Keep the uuid id defaultFields spreads.`)
  }
  if (kept.drafts && !kayan.fields._status) {
    throw new Error(
      `${where} with drafts, and declares no field "_status", which is where a row says whether it is a draft or published. Spread draftFields into its fields.`,
    )
  }
  const max = kept.max ?? window
  if (!Number.isInteger(max) || max < 0) throw new Error(`${where} with max ${String(max)}, and max is a whole number of versions, 0 keeping every one.`)
  const interval = typeof kept.drafts === 'object' && typeof kept.drafts.autosave === 'object' ? kept.drafts.autosave.interval : 2000
  if (!Number.isInteger(interval) || interval <= 0) throw new Error(`${where} with an autosave interval of ${String(interval)}, and an interval is a whole number of milliseconds above 0.`)
  const table = versionsTableOf(kayan)
  const column = (field: string, kind: string, named = snakeCase(field)) => ({ name: field, kind, column: named, kayan: table })
  return {
    table,
    drafts: !!kept.drafts,
    autosave: typeof kept.drafts === 'object' && kept.drafts.autosave ? { interval } : false,
    max,
    kayan: {
      name: table,
      table,
      ...(kayan.schemaName !== undefined && { schemaName: kayan.schemaName }),
      store: kayan.store,
      schema: kayan.schema,
      operations: {},
      indexes: [],
      // No prototype, so a query naming `toString` finds no field rather than a function.
      fields: Object.assign(Object.create(null), {
        id: column('id', 'uuid'),
        parent: { ...column('parent', kayan.fields.id!.kind, 'parent_id'), target: kayan },
        latest: column('latest', 'checkbox'),
        autosave: column('autosave', 'checkbox'),
        createdAt: column('createdAt', 'datetime'),
        updatedAt: column('updatedAt', 'datetime'),
      }),
    } as unknown as ResolvedKayan,
  }
}

type Versioned = ResolvedKayan & { versions: NonNullable<ResolvedKayan['versions']> }

const newest = { field: 'updatedAt', direction: 'desc' } as const

// jsonb holds a moment as its ISO string, so each datetime field becomes a `Date` again.
export const revived = (kayan: ResolvedKayan, snapshot: unknown): Record<string, unknown> => {
  const row = { ...(snapshot as Record<string, unknown>) }
  const moment = (held: unknown) => (typeof held === 'string' ? new Date(held) : held)
  for (const field of Object.values(kayan.fields)) {
    const held = row[field.name]
    if (field.kind !== 'datetime' || held === null || held === undefined) continue
    row[field.name] = typeof held === 'object' && !(held instanceof Date)
      ? Object.fromEntries(Object.entries(held).map(([locale, one]) => [locale, moment(one)]))
      : moment(held)
  }
  return row
}

export const latestVersion = async ({
  kayan,
  store,
  parent,
  tx,
}: {
  kayan: Versioned
  store: Pick<Store, 'find'>
  parent: unknown
  tx: unknown
}) =>
  (await store.find({ kayan: kayan.versions.table, args: {
    limit: 1,
    page: 1,
    sort: newest,
    where: { and: [{ parent: { equals: parent as string } }, { latest: { equals: true } }] },
  }, tx })).docs[0]

// In the write's own transaction, so the audit step after it covers it. An
// autosave overwrites the latest version only where that one is an autosave.
export const saveVersion = async ({
  kayan,
  store,
  writes,
  tx,
  row,
  autosave,
}: {
  kayan: Versioned
  store: Pick<Store, 'find'>
  writes: Pick<Store, 'insert' | 'remove' | 'update'>
  tx: unknown
  row: Record<string, unknown>
  autosave: boolean
}) => {
  const { table, max } = kayan.versions
  const latest = await latestVersion({ kayan, store, parent: row.id, tx })
  // A row's version moments only rise: two saves in one millisecond would let the
  // previous-version read skip one and leave the order to the random ids.
  const now = new Date(Math.max(Date.now(), latest ? new Date(latest.updatedAt as string).getTime() + 1 : 0))
  if (autosave && latest?.autosave === true) {
    await writes.update({ tx, kayan: table, id: latest.id, data: { version: row, updatedAt: now } })
    return
  }
  if (latest) await writes.update({ tx, kayan: table, id: latest.id, data: { latest: false } })
  await writes.insert({ tx, kayan: table, data: { parent: row.id, version: row, latest: true, autosave, createdAt: now, updatedAt: now } })
  if (max < 1) return
  // Never the one just inserted: two saves in one write can share a millisecond.
  const older: Where = { and: [{ parent: { equals: row.id as string } }, { latest: { equals: false } }] }
  const past = await store.find({ kayan: table, args: { ...(max > 1 ? { limit: max - 1, page: 2 } : { limit: 0, page: 1 }), sort: newest, where: older }, tx })
  for (const old of past.docs) await writes.remove({ tx, kayan: table, id: old.id })
}

// `_status` is left out because the write decides it: the row always holds the
// last published copy, so a restore that writes the row publishes it.
export const changedColumns = ({
  kayan,
  snapshot,
  row,
  whole = false,
}: {
  kayan: ResolvedKayan
  snapshot: Record<string, unknown>
  row: Record<string, unknown>
  whole?: boolean
}) =>
  Object.fromEntries(
    Object.values(kayan.fields)
      .filter((field) =>
        field.name !== 'id' && field.name !== '_status' && field.kind !== 'join' &&
        providerOf(field, 'update') === 'client' && field.name in snapshot &&
        ((whole && snapshot[field.name] != null && !same(snapshot[field.name], [])) || !same(snapshot[field.name], row[field.name])))
      .map((field) => [field.name, snapshot[field.name] ?? null]),
  )

// The row's read access comes first, so nothing about a row the actor cannot
// read is told: such a version is refused in the words an absent one is.
export const restoreInput = async <Actor>({
  kayan,
  store,
  data,
  actor,
  authorize,
  admin,
  alive,
  seesDrafts,
  admits,
}: {
  kayan: Versioned
  store: Store
  data: Record<string, unknown>
  actor: Actor | null
  authorize: Authorize
  admin: ManagedAdmin<Actor> | undefined
  alive: Where | undefined
  /** Whether the actor holds `findVersions`, which every restore asks. */
  seesDrafts: boolean
  /** The rows that key's answer admits, where it limits them: a restore and a discard reach no other. */
  admits?: Where
}) => {
  const absent = () =>
    missing({
      message: `No "${kayan.name}" version with id ${String(data.id)} to restore.`,
      key: 'error.not_found.row',
      params: { kayan: kayan.name, id: data.id, operation: 'restoreVersion' },
    })
  // Nothing has parsed a version id yet, and it is the versions table's own uuid whatever the row's id is.
  if (typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
    throw issueRefusal([{ message: 'Invalid UUID', path: ['id'] }], 'mithaq')
  }
  // A restore may publish a draft nothing else shows this actor, so it asks the
  // key a draft read asks; without it the id answers as absent.
  if (!seesDrafts) throw absent()
  const [version] = (await store.find({ kayan: kayan.versions.table, args: { limit: 1, page: 1, sort: newest, where: { id: { equals: data.id as string } } } })).docs
  // No version has that id, so it may name a published row whose pending draft is
  // being discarded: restoring the row onto itself publishes the last published copy.
  const parent = version ? version.parent : data.id
  // Asked with no operation, so no key but the restore's own is asked for.
  const rowOf = async (id: unknown, admitted?: Where) => {
    const readable = await authorize({ admin, actor, data: { id }, effect: 'read', kayan })
    const scoped = [{ id: { equals: id as string } }, readable, alive, admitted].filter(Boolean) as Where[]
    return (await store.find({ kayan: kayan.name, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { and: scoped } } })).docs[0]
  }
  // Version and row ids share one uuid space, and a caller may choose a row's id,
  // so an id that also names a row the actor sees is the row's. Looked for in the
  // actor's scope only, or another tenant could block restores with a learned id.
  if (version && await rowOf(data.id)) throw absent()
  const row = await rowOf(parent, admits)
  if (!row || (!version && row._status !== 'published')) throw absent()
  return { ...(version && changedColumns({ kayan, snapshot: revived(kayan, version.version), row, whole: kayan.versions.drafts && row._status !== 'published' })), id: parent }
}
