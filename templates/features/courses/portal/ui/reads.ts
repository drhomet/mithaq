// What the portal's pages read, each read the viewer's own through the screen's client, so a row the viewer may
// not read is left out of what comes back and a page draws what it can.
import type { FetchClient, Row } from 'mithaq/admin'
import { onOffer } from '../../domain/on-offer.ts'
import { nextByCourse } from './rules.ts'

type Reads = { client: FetchClient; maxLimit: number }
type Found = { docs: Row[]; totalDocs: number }

const find = ({ client, kayan, input }: { client: FetchClient; kayan: string; input: Record<string, unknown> }) =>
  client({ kayan, operation: 'find', input }) as Promise<Found>

/** A read the viewer may not make is an empty one; anything else failed and throws, for the query to try again. */
const unread = (thrown: unknown): never[] => {
  const key = (thrown as { data?: { key?: unknown } } | null)?.data?.key
  if (typeof key === 'string' && key.startsWith('error.forbidden')) return []
  throw thrown
}

const idsOf = (rows: readonly Row[], field: string) =>
  [...new Set(rows.flatMap((one) => { const value = one[field]; return Array.isArray(value) ? value : [value] }).filter((id): id is string => typeof id === 'string'))].sort()

/** Some rows of one kayan by id, as the viewer reads them, a page of the build's cap at a time. */
export const byIds = async ({ client, kayan, ids, maxLimit }: Reads & { kayan: string; ids: readonly string[] }): Promise<Map<string, Row>> => {
  const rows: Row[] = []
  for (let at = 0; at < ids.length; at += maxLimit) {
    const piece = ids.slice(at, at + maxLimit)
    rows.push(...(await find({ client, kayan, input: { where: { id: { in: piece } }, limit: piece.length } }).then((found) => found.docs, unread)))
  }
  return new Map(rows.map((one) => [String(one.id), one]))
}

export type Catalogue = { courses: Row[]; next: Map<string, Row>; covers: Map<string, Row>; tags: Map<string, Row> }

/**
 * The courses on offer, published and not archived, by title, each with its next session, its cover and its
 * tags. A plain read answers the published courses alone, whoever reads.
 */
export const catalogueOf = async ({ client, maxLimit, now }: Reads & { now: number }): Promise<Catalogue> => {
  // ponytail: one page of the build's cap, searched and filtered in the browser; a server search and pages once a
  // school offers more courses than that.
  const courses = (await find({ client, kayan: 'courses', input: { where: onOffer, sort: 'title', limit: maxLimit } })).docs
  const ids = idsOf(courses, 'id')
  const [sessions, covers, tags] = await Promise.all([
    ids.length
      ? find({ client, kayan: 'sessions', input: { where: { and: [{ course: { in: ids } }, { startsAt: { greater_than: new Date(now).toISOString() } }] }, sort: 'startsAt', limit: maxLimit } }).then((found) => found.docs, unread)
      : [],
    byIds({ client, maxLimit, kayan: 'media', ids: idsOf(courses, 'cover') }),
    byIds({ client, maxLimit, kayan: 'tags', ids: idsOf(courses, 'tags') }),
  ])
  return { courses, next: nextByCourse(sessions, now), covers, tags }
}

/** One seat as the portal draws it: its session, the session's course and that course's cover, and its student. */
export type Seat = { seat: Row; startsAt?: unknown; session?: Row; course?: Row; cover?: Row; student?: Row }

/**
 * The seats the viewer reads, the newest first, each with what it draws. `where` narrows them, as the home does to
 * the viewer's own. People are read only where `people` is set, and each is one the viewer may read: a name the
 * server keeps from it is left out.
 */
export const readSeats = async ({ client, maxLimit, where, people = false }: Reads & { where?: Row; people?: boolean }): Promise<Seat[]> => {
  // ponytail: one page of the build's cap, the newest; pages once a viewer holds more seats than that.
  const seats = (await find({ client, kayan: 'enrollments', input: { sort: '-createdAt', limit: maxLimit, ...(where && { where }) } })).docs
  const sessions = await byIds({ client, maxLimit, kayan: 'sessions', ids: idsOf(seats, 'session') })
  const courses = await byIds({ client, maxLimit, kayan: 'courses', ids: idsOf([...sessions.values()], 'course') })
  const [covers, students] = await Promise.all([
    byIds({ client, maxLimit, kayan: 'media', ids: idsOf([...courses.values()], 'cover') }),
    people ? byIds({ client, maxLimit, kayan: 'user', ids: idsOf(seats, 'student') }) : new Map<string, Row>(),
  ])
  return seats.map((seat) => {
    const session = sessions.get(String(seat.session))
    const course = session && courses.get(String(session.course))
    return { seat, startsAt: session?.startsAt, session, course, cover: course && covers.get(String(course.cover)), student: students.get(String(seat.student)) }
  })
}
