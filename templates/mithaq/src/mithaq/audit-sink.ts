import type { AuditHandler } from 'mithaq'
import { same } from 'mithaq/admin'

/**
 * The kayan this sink writes, which `./audit-log.ts` declares under the same
 * name. A file of its own, apart from the kayan's, because the service target
 * that holds this sink is built in `../mithaq.ts` and the kayan imports its
 * `defineKayan` from there, so one file holding both would be a cycle.
 */
export const auditLogName = 'auditLog'

/** One changed column: what it held before the write and what it holds after. */
export type Change = { from: unknown; to: unknown }

/**
 * What the Activity panel draws as a dash: absent, `null`, an empty string or
 * an empty list. A column that is one of these before and after changed
 * nothing a reader could see.
 */
export const empty = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)

/**
 * The columns whose value differs, each with its value on both sides and
 * `null` for a side that held none. A column empty on both sides is no change,
 * so a create lists only what it set and a delete only what the row held.
 */
export const changesOf = (before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>) => {
  const changes: Record<string, Change> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!same(before[key], after[key]) && !(empty(before[key]) && empty(after[key]))) changes[key] = { from: before[key] ?? null, to: after[key] ?? null }
  }
  return changes
}

const rowOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) && 'id' in value ? (value as Record<string, unknown>) : undefined

const stringOf = (value: unknown) => (typeof value === 'string' ? value : null)

/**
 * The service target's audit sink: one `auditLog` row per row a write changed,
 * written through the store and the transaction the write itself runs in, so
 * the entry commits with the change or not at all. It goes to the store and
 * not through an operation, because the log declares none that writes: this is
 * the only thing that writes it.
 *
 * A bulk runs every row through the single-row write of its effect, which
 * audits that row, and then audits itself with the page of rows as its
 * result; that second call names no row and is passed over here. An update
 * that moved nothing but the columns the runner bumps on every write declines
 * its own row. A delete of a kayan with no soft-delete field removes the row,
 * so its change is every column to nothing; a soft delete hands back the row it
 * marked, and its change is the mark.
 *
 * The actor is the person the write ran as, and `impersonatedBy` the real one
 * behind an impersonated session. `mithaq rbac assign` hands the sink no person
 * but the command and the operating-system user, and the entry names both. The
 * organization is the one the row belongs to, which is the active one inside a
 * managed write and the one the log is read in; a shared kayan writes no entry.
 */
export const auditSink: AuditHandler = async ({ effect, kayan, operation, dataBefore, dataAfter, store, tx, user }) => {
  // A shared kayan writes no entry: the log is read in one organization alone,
  // so an entry of none is one nobody reads, and the shared kayan are the
  // provider's generated auth tables and local auth's accounts, whose rows hold
  // tokens and hashes a log should never keep.
  const owner = kayan.tenant
  if (effect === 'read' || !store || kayan.name === auditLogName || !owner) return
  const before = dataBefore ?? {}
  const after = rowOf(dataAfter)
  const record = after?.id ?? dataBefore?.id
  if (record === undefined || record === null) return
  const removed = effect === 'delete' && !kayan.softDelete
  const changes = changesOf(before, removed ? {} : (after ?? {}))
  if (effect === 'update' && Object.keys(changes).every((name) => kayan.fields[name]?.rules?.nowOnUpdate)) return
  const actor = user && typeof user === 'object' ? (user as { id?: unknown; impersonatedBy?: unknown; command?: unknown; osUser?: unknown }) : undefined
  await store.insert({ tx, kayan: auditLogName, data: {
    createdAt: new Date(),
    organization: stringOf(after?.[owner] ?? before[owner]),
    kayan: kayan.name,
    record: String(record),
    // An update that took a draft to published is named a publish, as Payload's
    // own history says it, so the Activity filters it apart from an edit.
    operation: operation === 'update' && changes._status?.to === 'published' ? 'publish' : operation,
    actor: stringOf(actor?.id) ?? (typeof actor?.command === 'string' ? `${actor.command} (${String(actor.osUser)})` : null),
    impersonatedBy: stringOf(actor?.impersonatedBy),
    // JSON in a text column, because the language ships no json kind. The log
    // refuses any filter or sort on it, since a `contains` over the text would
    // read a value its reader may not.
    changes: JSON.stringify(changes),
    // Each name between two spaces, so a search of one never matches part of another.
    changed: ` ${Object.keys(changes).join(' ')} `,
  } })
}
