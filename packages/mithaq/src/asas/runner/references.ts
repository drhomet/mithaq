import type { ResolvedKayan, ResolvedField } from '../../mithaq/types.ts'
import type { Store } from '../../mithaq/language-core.ts'
import { combineWhere, type Scalar, type Where } from '../../mithaq/where.ts'
import { AsasError, invalid } from './errors.ts'
import { publishedWhere } from './row-state.ts'
import { cleanupUploadTargets, richTextUploads } from '../../storage/upload-references.ts'

// Postgres answers a uuid in lowercase, so ids are compared in that case.
export const keyIn = (kayan: ResolvedKayan) => (value: unknown) =>
  kayan.fields.id?.kind === 'uuid' && typeof value === 'string' ? value.toLowerCase() : value

export const assertReferences = async ({ kayan, store, data, tenant, access, offered, tx }: {
  kayan: ResolvedKayan
  store: Pick<Store, 'find'>
  data: Record<string, unknown>
  /** The organization the written row belongs to, or the active one where the row belongs to none. */
  tenant: unknown
  /** What else the target's row must meet: its read access for this actor. */
  access?: (target: ResolvedKayan) => Promise<Where | undefined>
  /** What one field's `filterOptions` offers this actor, which a managed write is held to. */
  offered?: (field: ResolvedField) => Promise<Where | undefined>
  tx?: unknown
}) => {
  const own = kayan.tenant
  // Gathered per target, so two fields at one kayan and a whole `hasMany` set are one read; a
  // field whose options are its own is read apart.
  const targets = new Map<ResolvedKayan | ResolvedField, { target: ResolvedKayan; sets: { field: string; value: unknown }[] }>()
  for (const field of Object.values(kayan.fields)) {
    // The ownership column is the runner's, or was judged above. A join takes no write.
    if (!field.target || field.name === own || field.kind === 'join') continue
    const given = data[field.name]
    if (given === undefined || given === null) continue
    const key = offered && field.filterOptions ? field : field.target
    for (const value of field.hasMany ? (given as readonly unknown[]) : [given]) {
      if (value === undefined || value === null) continue
      const held = targets.get(key) ?? { target: field.target, sets: [] }
      held.sets.push({ field: field.name, value })
      targets.set(key, held)
    }
  }
  const uploads = new Set<ResolvedKayan>()
  for (const field of Object.values(kayan.fields)) {
    if (field.kind !== 'richText') continue
    for (const reference of richTextUploads(data[field.name])) {
      const target = cleanupUploadTargets.get(field)?.find((one) => one.name === reference.kayan)
      if (!target) continue
      const held = targets.get(target) ?? { target, sets: [] }
      held.sets.push({ field: field.name, value: reference.id })
      targets.set(target, held)
      uploads.add(target)
    }
  }
  for (const [key, { target, sets }] of targets) {
    const far = target.tenant
    // A raw write to a shared row names it as it likes; the foreign key holds it.
    if (!access && !far && !uploads.has(target)) continue
    // Held whatever the target's own access answers, so no access widens it.
    const tenanted = tenant !== undefined && tenant !== null && far ? { [far]: { equals: tenant as Scalar } } : undefined
    // A 400: the value is what the caller sent wrong. Absent, hidden and another tenant's
    // ids are one refusal, so none tells the caller which ids exist.
    const refuse = (field: string) => {
      const params = { kayan: kayan.name, field, target: target.name }
      return tenanted
        ? invalid({
            message: `"${kayan.name}" field "${field}" must reference a "${target.name}" row in the same tenant.`,
            key: 'error.invalid.tenant_reference',
            params,
          })
        : invalid({
            message: `"${kayan.name}" field "${field}" must reference a "${target.name}" row the actor can read.`,
            key: 'error.invalid.reference',
            params,
          })
    }
    // With no organization and no access to ask, nothing scopes the target, so nothing is admitted.
    if (!access && !tenanted && (far || !uploads.has(target))) throw refuse(sets[0]!.field)
    let admits: Where | undefined
    try {
      admits = await access?.(target)
    } catch (thrown) {
      if (!(thrown instanceof AsasError) || thrown.status !== 403) throw thrown
      // Fail closed before the store is asked, so the foreign key cannot tell which ids exist.
      throw refuse(sets[0]!.field)
    }
    const keyOf = keyIn(target)
    const ids = [...new Set(sets.map(({ value }) => keyOf(value)))]
    const found = await store.find({ kayan: target.name, args: {
      limit: ids.length,
      // The lock a foreign key takes: it holds off the row's delete, and never another write naming the
      // row or a plain update of its other columns, so those neither wait on it nor deadlock with it.
      // See "Create, update and delete" in packages/mithaq/README.md for checks that need a stronger lock.
      lock: 'keyShare',
      page: 1,
      sort: { field: 'id', direction: 'asc' },
      where: combineWhere(
        combineWhere(
          combineWhere({ id: { in: ids as Scalar[] } }, admits),
          tenanted,
        ),
        // Nothing a plain read shows may point at a row no plain read shows; a step's own write may.
        combineWhere(access ? publishedWhere(target) : undefined, key === target ? undefined : await offered!(key as ResolvedField)),
      ),
    }, tx })
    const admitted = new Set(found.docs.map((row) => keyOf(row.id)))
    const refused = sets.find(({ value }) => !admitted.has(keyOf(value)))
    if (refused) throw refuse(refused.field)
  }
}


