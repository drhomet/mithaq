import { markAuthActor } from '../actor.ts'
import type { Authorize } from './write.ts'
import type { Ctx } from './steps.ts'
import { denied } from './errors.ts'

// Neither the actor nor this capability is constructed from request data or exported by mithaq.
type Purge = {
  kayan: string
  id: unknown
  check: (args: { row: Record<string, unknown>; tx: unknown }) => Promise<void>
  afterCommit: (ctx: Ctx) => Promise<void>
}
const purges = new WeakMap<object, Purge>()
export const storagePurgeActor = ({ tenant, collection, ...purge }: Purge & { tenant: string | null; collection: string | undefined }) => {
  const actor = markAuthActor({ collection: collection ?? '', strategy: 'better-auth', activeOrganizationId: tenant, organizations: tenant === null ? [] : [{ id: tenant }] })
  purges.set(actor, purge)
  return actor
}
export const storagePurge = ({ actor, kayan, id }: { actor: unknown; kayan: string; id: unknown }) => {
  const purge = actor && typeof actor === 'object' ? purges.get(actor) : undefined
  return purge?.kayan === kayan && String(purge.id) === String(id) ? purge : undefined
}

/** The ordinary tenant wrapper still scopes this narrowly authorized delete. */
export const storageMaintenanceAccess = (inner: Authorize): Authorize => async (args) => {
  if (!args.actor || typeof args.actor !== 'object' || !purges.has(args.actor)) return inner(args)
  if (args.effect !== 'delete' || args.kind !== 'remove' || !storagePurge({ actor: args.actor, kayan: args.kayan.name, id: args.data.id })) {
    throw denied({ message: 'Storage maintenance can only delete its selected upload.', key: 'error.forbidden.operation', params: {} })
  }
  return { id: { equals: args.data.id as string } }
}
