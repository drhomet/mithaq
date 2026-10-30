import { loweredType } from '../../rich-text/value.ts'
import type { Store } from '../../mithaq/language-core.ts'
import type { ResolvedKayan } from '../../mithaq/types.ts'
import { combineWhere, type Where } from '../../mithaq/where.ts'
import { latestVersion } from '../../versions/versions.ts'
import { AsasError, conflict } from './errors.ts'

/**
 * Refuses a write that lowers the highest stored JSON version of a node type in a rich text field,
 * against the row and its newest version alike, so an editor older than the one that wrote a node
 * never saves it back in a shape that drops what it cannot read. The row is held before it is
 * compared, so a racing upgrade is seen. Answers whether a row was found where rich text is written.
 */
export const assertRichTextVersions = async ({ kayan, store, data, tx, target }: {
  kayan: ResolvedKayan
  store: Pick<Store, 'find'>
  data: Record<string, unknown>
  tx?: unknown
  /** The one row the write lands on, or nothing for a row it makes. */
  target: Where | undefined
}): Promise<boolean | undefined> => {
  const fields = Object.values(kayan.fields).filter((field) => field.richTextPolicy && data[field.name] != null)
  if (!fields.length || !target) return undefined
  // No transaction holds a row until the write, so a comparison here could be stale by then.
  if (!tx) throw richTextVersionRefusal(kayan)
  // `noKeyUpdate` is the lock every managed write of the row takes, so writers queue here and nothing
  // else is blocked; the write that follows keeps it until commit.
  const [row] = (await store.find({ tx, kayan: kayan.name, args: { limit: 1, page: 1, lock: 'noKeyUpdate', sort: { field: 'id', direction: 'asc' }, where: target } })).docs
  if (!row) return false
  const newest = kayan.versions ? (await latestVersion({ kayan: kayan as ResolvedKayan & { versions: NonNullable<ResolvedKayan['versions']> }, store, parent: row.id, tx }))?.version as Record<string, unknown> | undefined : undefined
  for (const field of fields) {
    for (const stored of [row, newest]) {
      if (stored && loweredType({ stored: stored[field.name], next: data[field.name] })) throw richTextVersionRefusal(kayan, field.name)
    }
  }
  return true
}

export const richTextVersionRefusal = (kayan: ResolvedKayan, field?: string) =>
  conflict({ message: 'This rich text holds a newer node than this write. Reload it and edit the newest copy.', key: 'error.conflict.rich_text_version', params: { kayan: kayan.name, ...(field && { field }) } })

/**
 * An upsert holding rich text, by its conflict key: compared with the row `keyed` names, held first.
 * Where no row is there to hold, one another transaction makes meanwhile is refused rather than overwritten unchecked.
 */
export const upsertRichText = async <Row>({ kayan, store, data, tx, keyed, where, upsert }: {
  kayan: ResolvedKayan
  store: Pick<Store, 'find'>
  data: Record<string, unknown>
  tx?: unknown
  keyed: Where
  where: Where | undefined
  upsert: (where: Where | undefined) => Promise<Row>
}): Promise<Row> => {
  if (await assertRichTextVersions({ kayan, store, data, tx, target: keyed }) !== false) return upsert(where)
  return upsert(combineWhere(where, { id: { in: [] } })).catch((thrown: unknown) => {
    throw thrown instanceof AsasError && thrown.status === 404 ? richTextVersionRefusal(kayan) : thrown
  })
}
