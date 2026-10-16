import { sql } from 'mithaq/drizzle'
import type { NodePgDatabase } from 'mithaq/drizzle/node-postgres'
import { serverTargets } from '@asas/mithaq'

/** A write's transaction, which is drizzle's here. */
const txOf = (tx: unknown) => tx as NodePgDatabase

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

/**
 * Serializes every write that takes a seat in one session until its transaction ends: a second write waits here,
 * and under Read Committed its count, a statement after the lock, sees what the first one committed, so two
 * writes never both take the last seat.
 */
export const holdSeats = async ({ tx, session }: { tx: unknown; session: string }) => {
  await txOf(tx).execute(sql`select pg_advisory_xact_lock(hashtext('mithaq.seats'), hashtext(${session}))`)
}

/**
 * What a seat is judged by, read off the columns in the write's transaction rather than through the actor's
 * projection: a role shown no capacity, start or archived mark would otherwise read none and skip each rule. A
 * caller reads the session under the actor's access first, so this reads only a session the actor may reach. Its
 * `id` is the stored one, the same in every case the caller wrote it. Both rows stay locked before the
 * enrollment's reference check, so an archive or capacity change cannot pass the decision, and the later
 * `FOR KEY SHARE` does not require a lock upgrade. `FOR SHARE` lets enrollments share those rows while
 * holding off their changes; `holdSeats` serializes the seat count for a session with a capacity.
 *
 * The tables and columns are written out, as the drizzle target names them; a rename fails R7a, R7b and R7f.
 */
export const sessionHeld = async ({ tx, session }: { tx: unknown; session: string }) =>
  (await txOf(tx).execute<{ id: string; capacity: number | null; startsAt: Date; archived: boolean | null; courseArchived: boolean | null; selfEnroll: boolean | null }>(sql`
    select s.id, s.capacity::float8 as capacity, s.starts_at as "startsAt", s.archived, c.archived as "courseArchived", c.self_enroll as "selfEnroll"
    from course_sessions s join courses c on c.id = s.course_id where s.id = ${session} for share of s, c`)).rows[0]
