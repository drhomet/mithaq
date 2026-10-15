import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FetchClient, Row } from 'mithaq/admin'
import { catalogueOf, seatsOf } from './reads.ts'

const now = Date.parse('2026-10-15T12:00:00Z')
const refused = Object.assign(new Error('Forbidden'), { status: 403, data: { key: 'error.forbidden.read' } })

/** A client over rows held in memory, answering `id in` and nothing else of a where, and recording every call. */
const clientOf = (rows: Record<string, Row[]>, refuses: readonly string[] = []) => {
  const asked: { kayan: string; input: Record<string, unknown>; draft?: boolean }[] = []
  const client = (async ({ kayan, input, draft }: { kayan: string; input: Record<string, unknown>; draft?: boolean }) => {
    asked.push({ kayan, input, ...(draft !== undefined && { draft }) })
    if (refuses.includes(kayan)) throw refused
    const ids = ((input.where as { id?: { in?: string[] } } | undefined)?.id?.in)
    const docs = (rows[kayan] ?? []).filter((one) => !ids || ids.includes(String(one.id)))
    return { docs, totalDocs: docs.length }
  }) as unknown as FetchClient
  return { client, asked }
}

test('the catalogue reads the published courses not archived, each with its next session, cover and tags, and a read the viewer may not make leaves its part out', async () => {
  const { client, asked } = clientOf({
    courses: [{ id: 'c1', title: 'Calligraphy', cover: 'm1', tags: ['t1'] }, { id: 'c2', title: 'Python', tags: [] }],
    sessions: [{ id: 's1', course: 'c1', startsAt: '2026-10-20T09:00:00Z' }, { id: 's2', course: 'c1', startsAt: '2026-11-20T09:00:00Z' }],
    media: [{ id: 'm1', url: '/api/media/file/m1' }],
  }, ['tags'])
  const found = await catalogueOf({ client, maxLimit: 100, now })
  const courses = asked.find((one) => one.kayan === 'courses')!
  assert.equal(courses.draft, undefined, 'a plain read, which answers published courses alone')
  assert.deepEqual(courses.input.where, { or: [{ archived: { exists: false } }, { archived: { equals: false } }] }, 'and none archived')
  assert.deepEqual(found.courses.map((one) => one.id), ['c1', 'c2'])
  assert.equal(found.next.get('c1')?.id, 's1', 'the first session still to start')
  assert.equal(found.next.has('c2'), false, 'and none for a course with none')
  assert.equal(found.covers.get('m1')?.url, '/api/media/file/m1')
  assert.equal(found.tags.size, 0, 'tags the viewer may not read are no tags, and the page still draws')
  const sessions = asked.find((one) => one.kayan === 'sessions')!
  assert.deepEqual((sessions.input.where as { and: unknown[] }).and[0], { course: { in: ['c1', 'c2'] } }, 'the sessions of the courses on offer alone')
})

test('an empty catalogue asks for no session', async () => {
  const { client, asked } = clientOf({ courses: [] })
  assert.deepEqual((await catalogueOf({ client, maxLimit: 100, now })).courses, [])
  assert.equal(asked.some((one) => one.kayan === 'sessions'), false)
})

test('a seat is drawn with its session, its course, the course\'s cover and, where people are asked, its student', async () => {
  const { client, asked } = clientOf({
    enrollments: [{ id: 'e1', session: 's1', student: 'u1' }, { id: 'e2', session: 'gone', student: 'u2' }],
    sessions: [{ id: 's1', course: 'c1', startsAt: '2026-10-20T09:00:00Z', venue: 'campus' }],
    courses: [{ id: 'c1', title: 'Calligraphy', cover: 'm1' }],
    media: [{ id: 'm1', url: '/api/media/file/m1' }],
    user: [{ id: 'u1', name: 'Sara' }],
  })
  const seats = await seatsOf({ client, maxLimit: 100, people: true })
  assert.deepEqual(seats.map((one) => [one.seat.id, one.session?.id, one.course?.title, one.cover?.id, one.student?.name, one.startsAt]), [
    ['e1', 's1', 'Calligraphy', 'm1', 'Sara', '2026-10-20T09:00:00Z'],
    ['e2', undefined, undefined, undefined, undefined, undefined],
  ], 'a session the viewer cannot read leaves its seat bare, and a person it cannot read leaves the name out')
  asked.length = 0
  await seatsOf({ client, maxLimit: 100, where: { student: { equals: 'u1' } } })
  assert.equal(asked.some((one) => one.kayan === 'user'), false, 'no person is read unless asked')
  assert.deepEqual(asked[0]!.input.where, { student: { equals: 'u1' } })
})
