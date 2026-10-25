import { combineWhere } from '../mithaq/where.ts'
import { sealOf } from '../asas/runner/steps.ts'
import { AsasError, AfterCommitError, conflict } from '../asas/runner/errors.ts'
import { storagePurgeActor } from '../asas/runner/storage-maintenance.ts'
import { uploadReferenced } from './references.ts'
import type { StorageBuild, KayanStorage } from './storage.ts'

export const cleanupUploadedRows = async ({ build, tenant, now }: { build: StorageBuild; tenant?: string; now: Date }) => {
  const counts = { rowsChecked: 0, rowsDeleted: 0, rowsKept: 0, failures: 0 }
  const organizations = tenant === undefined ? await build.tenants() : [tenant]
  for (const kayan of build.kayan) {
    const after = (kayan.targets?.storage as KayanStorage | undefined)?.orphanAfter
    if (after === undefined) continue
    if (!kayan.tenant && tenant !== undefined) continue
    const cutoff = new Date(now.getTime() - after)
    const scopes = kayan.tenant ? organizations : [null]
    const store = build.storeOf(kayan)
    for (const scope of scopes) {
      const where = combineWhere({ createdAt: { less_than: cutoff } }, kayan.tenant ? { [kayan.tenant]: { equals: scope } } : undefined)
      const { docs } = await store.find({ kayan: kayan.name, args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where } })
      for (const row of docs) {
        counts.rowsChecked++
        const actor = storagePurgeActor({
          kayan: kayan.name, id: row.id, tenant: scope, collection: build.collection,
          check: async ({ row: locked, tx }) => {
            if (!(new Date(locked.createdAt as string | Date).getTime() < cutoff.getTime())
              || await uploadReferenced({ kayan, id: locked.id, resolved: build.resolved, storeOf: build.storeOf, tenant: scope, tx })) {
              throw conflict({ message: 'The upload is retained.', key: 'error.conflict.referenced', params: {} })
            }
          },
          afterCommit: async (ctx) => {
            // A soft delete normally keeps its object; this row has now been removed for good.
            const configured = Object.values(kayan.operations).find((one) => one.steps.some((step) => sealOf(step) === 'remove'))!
            if (kayan.softDelete || !configured.afterCommit.includes(build.config.removed as never)) await build.config.removed({ ...ctx, kayan: { ...ctx.kayan, softDelete: undefined } })
          },
        })
        try {
          await build.remove({ kayan: kayan.name, id: row.id, actor })
          counts.rowsDeleted++
        } catch (error) {
          if (error instanceof AfterCommitError) { counts.rowsDeleted++; counts.failures++ }
          else if ((error instanceof AsasError && (error.status === 404 || error.status === 409)) || foreignKey(error)) counts.rowsKept++
          else counts.failures++
        }
      }
    }
  }
  return counts
}
const foreignKey = (error: unknown): boolean => !!error && typeof error === 'object' && (('code' in error && error.code === '23503') || ('cause' in error && foreignKey(error.cause)))
