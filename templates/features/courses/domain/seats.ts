import { serverTargets } from '@asas/mithaq'

/**
 * How many seats of a session are held, a withdrawn one not among them. Counted through the store, past the
 * reader's own access, which a student's narrows to its own seat: a caller reads the session under that access first.
 */
export const seatsTaken = async ({ session, tx }: { session: string; tx?: unknown }) =>
  (await serverTargets.drizzle.find({
    tx,
    kayan: 'enrollments',
    args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { and: [{ session: { equals: session } }, { deletedAt: { exists: false } }] } },
  })).totalDocs
