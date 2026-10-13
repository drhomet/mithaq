import { actorPermissions, type Where } from 'mithaq'
import { serverTargets } from '@asas/mithaq'
import { currentOrganization } from '@asas/mithaq/roles/tenant-access.ts'
import { courses } from './courses.ts'

/**
 * The images an actor reads as covers: the cover of a published course it
 * reads, of the organization its session has active, under the courses kayan's
 * own read access for this actor. So a student or an instructor reads no image
 * of a draft, of an archived course or of none. The media feature asks it of
 * an actor that holds no `media.create`, and holds no import of this file.
 *
 * The organization is read off the trusted snapshot and named here, since the
 * courses are read straight through the store, past the runner's scope. An
 * image has no field that points at a course, so a row filter cannot reach
 * one, and the covers are read first and named by id.
 */
export const coverReads = async ({ user }: { user: unknown }): Promise<Where | false> => {
  const held = actorPermissions(user)
  if (held !== true && !held?.has('courses.find')) return false
  const active = currentOrganization(user)
  const readable = active && (await courses.access!.read!({ user }))
  if (!readable) return false
  const published: Where = { and: [{ organization: { equals: active } }, { _status: { equals: 'published' } }] }
  const found = await serverTargets.drizzle.find({ kayan: 'courses', args: {
    limit: 0,
    page: 1,
    sort: { field: 'id', direction: 'asc' },
    where: readable === true ? published : { and: [readable, published] },
  } })
  const ids = [...new Set(found.docs.map((row) => row.cover).filter((id): id is string => typeof id === 'string'))]
  return ids.length ? { id: { in: ids } } : false
}
