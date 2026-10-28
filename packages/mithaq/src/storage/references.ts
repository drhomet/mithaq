import { aliveWhere } from '../asas/runner/write.ts'
import { authActor } from '../asas/actor.ts'
import { combineWhere, type Where } from '../mithaq/where.ts'
import type { ResolvedField, ResolvedKayan } from '../mithaq/types.ts'
import type { Store } from '../mithaq/language.ts'

/** An access callback may mutate the public actor; ownership follows its authenticated snapshot. */
export const uploaderId = (actor: unknown): string | undefined => {
  const trusted = authActor(actor)
  const id = trusted ? trusted.id : actor && typeof actor === 'object' && 'id' in actor ? actor.id : undefined
  return typeof id === 'string' ? id : typeof id === 'number' && Number.isFinite(id) ? String(id) : undefined
}

export { cleanupUploadTargets, richTextUploads } from './upload-references.ts'
import { richTextUploads } from './upload-references.ts'

const contains = (value: unknown, id: unknown): boolean => {
  if (typeof value === 'string' || typeof value === 'number') return String(value).toLowerCase() === String(id).toLowerCase()
  return !!value && typeof value === 'object' && Object.values(value).some((child) => contains(child, id))
}

/** Includes trashed owners and every retained snapshot, not only the latest draft. */
export const uploadReferenced = async ({ kayan, id, resolved, storeOf, tenant, tx }: {
  kayan: ResolvedKayan
  id: unknown
  resolved: readonly ResolvedKayan[]
  storeOf: (one: ResolvedKayan) => Store
  tenant: string | null
  tx?: unknown
}) => {
  const names = (field: ResolvedField, value: unknown) => field.kind === 'richText'
    ? richTextUploads(value).some((reference) => reference.kayan === kayan.name && contains(reference.id, id))
    : contains(value, id)
  // ponytail: scan owners and snapshots per candidate; use indexed reference queries if measured slow.
  for (const owner of resolved) {
    const fields = Object.values(owner.fields).filter((field) => field.kind !== 'join' && (field.target?.name === kayan.name || field.kind === 'richText'))
    if (!fields.length) continue
    const store = storeOf(owner)
    // A restore takes its organization from the parent, even when an old snapshot carries none or a stale one.
    const scope = (snapshot: boolean): Where | undefined => owner.tenant && tenant !== null ? { [snapshot ? `parent.${owner.tenant}` : owner.tenant]: { equals: tenant } } : undefined
    const args = { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' as const } }
    const found = await store.find({ kayan: owner.name, args: { ...args, where: scope(false) }, tx })
    if (found.docs.some((row) => fields.some((field) => names(field, row[field.name])))) return true
    if (!owner.versions) continue
    const versions = await store.find({ kayan: owner.versions.table, args: { ...args, where: scope(true) }, tx })
    if (versions.docs.some((row) => fields.some((field) => names(field, (row.version as Record<string, unknown>)?.[field.name])))) return true
  }
  return false
}

export const countUnattached = async ({ kayan, actor, tenant, resolved, storeOf }: {
  kayan: ResolvedKayan
  actor: unknown
  tenant: string | null | undefined
  resolved: readonly ResolvedKayan[]
  storeOf: (one: ResolvedKayan) => Store
}) => {
  const id = uploaderId(actor)
  if (id === undefined || (kayan.tenant && tenant === undefined)) return undefined
  const where = combineWhere(combineWhere({ uploadedBy: { equals: id } }, kayan.tenant ? { [kayan.tenant]: { equals: tenant! } } : undefined), aliveWhere(kayan))
  const { docs } = await storeOf(kayan).find({ kayan: kayan.name, args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where } })
  let count = 0
  for (const row of docs) if (!await uploadReferenced({ kayan, id: row.id, resolved, storeOf, tenant: tenant ?? null })) count++
  return count
}
