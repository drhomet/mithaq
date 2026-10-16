// The backoffice screen's one action no managed operation carries: renaming an
// organization and its slug. An organization has no admin route for staff:
// every route of Better Auth's organization plugin acts as a member of that
// organization, which staff are not, and the managed `organization` kayan
// writes nothing, because Better Auth owns the table and the tenant's `'*'`
// row, which every backoffice role takes too, names no update. So the rename is
// this one route of the project's own, refused without `organization.rename`,
// a key of the project's own that only `super_admin` holds, and audited in the
// line every admin route of the backoffice writes.
//
// Deleting an organization, removing a member and changing a member's
// governance role stay out: each is irreversible or passes the plugin's own
// owner rules by, and staff do each by impersonating a member, which is
// audited under the real person's name.
import { AsasError, actorPermissions, conflict, denied, invalid, missing, type HttpPlug } from 'mithaq'
import { namesOf, oneLine, backofficeRoles } from '@asas/mithaq/auth'
import { organizations as mode } from '@asas/mithaq/auth/organizations'
import { targets } from '@asas/mithaq'
import { assignedRoles, type OrganizationActor } from '@asas/mithaq/roles/tenant-access.ts'

const path = '/api/backoffice/organizations/update'
/**
 * The project's own key, not `organization.update`: that name is both the
 * provider's action and the managed kayan's update, which the rows refuse to
 * everyone.
 */
const key = 'organization.rename'

const slugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * The longest name and slug a rename writes. The columns are unbounded `text`,
 * so the caps are this route's own: a name as long as the auth setup lets a
 * founder write one, and a slug that fits in a URL segment.
 */
const most = { name: 100, slug: 64 }

/** The names `written` holds as the auth setup keeps them, or `null` where it refuses them. */
const namedOrNull = (written: unknown) => {
  try {
    return namesOf(written)
  } catch {
    return null
  }
}

/** The body the shipped plain plug answers every refusal with. */
const codes: Record<number, string> = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' }
const refusal = (thrown: AsasError) =>
  Response.json({ code: codes[thrown.status], data: { key: thrown.key, params: thrown.params }, message: thrown.message }, { status: thrown.status })

/**
 * Answers the route only for an actor the template's reader gave a backoffice
 * role holding `organization.rename`, which it does in the backoffice app alone:
 * `'*'` inside a tenant is a tenant's and renames nothing here. The body is
 * `{ id, names, slug }`, a name per locale with the default locale's required,
 * or `{ id, name, slug }`, the default locale's alone; a slug another
 * organization holds is the store's own 409. With one organization its name
 * lives in code, so the route renames nothing: `organizations` is the project's
 * mode, which a test sets.
 */
export const backofficeHttp = ({ organizations }: { organizations: 'one' | 'many' } = { organizations: mode }) => (): HttpPlug => ({
  name: 'backoffice',
  router: undefined,
  handle: async (request, who) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== path) return null
    try {
      const actor = (await who()) as (OrganizationActor & { id?: string }) | null
      const held = actorPermissions(actor)
      const staff = !!actor && assignedRoles(actor).some((slug) => Object.hasOwn(backofficeRoles, slug))
      if (!staff || !(held === true || held?.has(key))) {
        throw denied({ message: `Forbidden: renaming an organization is the backoffice's, and it asks "${key}".`, key: 'error.forbidden.permission', params: { permission: key } })
      }
      // JSON alone, so a form another site posts, which a browser sends with
      // no preflight, is never read as one.
      const body = request.headers.get('content-type')?.startsWith('application/json') ? ((await request.json().catch(() => null)) as Record<string, unknown> | null) : null
      if (organizations === 'one') {
        throw conflict({ message: 'With one organization its name lives in code: organizationName in src/mithaq/auth/organizations.ts. Change it there and deploy.', key: 'error.conflict.organization_name_in_code' })
      }
      const id = body?.id
      const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
      // Each locale's name is the auth setup's own rule, so a rename keeps what a founder may write and no more.
      const names = body?.names === undefined ? undefined : namedOrNull(body.names)
      const name = names ? names.name : typeof body?.name === 'string' ? body.name.trim() : ''
      // A name is one line: mail bodies carry it, where a break would be a line of the writer's own.
      if (typeof id !== 'string' || !id || names === null || !name || name.length > most.name || new RegExp(oneLine.source, 'u').test(name) || !slugShape.test(slug) || slug.length > most.slug) {
        throw invalid({
          message: `An organization is renamed with its id, a name of one line and at most ${most.name} characters, and a slug of at most ${most.slug} lowercase letters, digits and hyphens.`,
          key: 'error.invalid.value',
        })
      }
      const store = targets.drizzle
      // The row is found and written under one lock, so a delete between the
      // two answers 404 rather than failing the write. `FOR UPDATE`, not `FOR NO
      // KEY UPDATE`: the slug is unique, so the UPDATE would raise to it anyway.
      await store.transaction(async (tx) => {
        const found = await store.find({ kayan: 'organization', args: { limit: 1, lock: 'update', page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { equals: id } } }, tx })
        if (!found.docs.length) throw missing({ message: `No organization "${id}".`, key: 'error.not_found.row', params: { kayan: 'organization' } })
        await store.update({ tx, kayan: 'organization', id, data: { name, ...(names && { names: names.names }), slug, updatedAt: new Date() } })
      })
      // The line `backofficeAudit` writes for an admin route, under this route's own name.
      console.log(JSON.stringify({
        audit: 'backoffice',
        action: '/backoffice/organizations/update',
        actor: actor.id ?? null,
        impersonatedBy: actor.impersonatedBy ?? null,
        target: id,
        at: new Date().toISOString(),
      }))
      return Response.json({ id, name, slug })
    } catch (thrown) {
      if (thrown instanceof AsasError) return refusal(thrown)
      throw thrown
    }
  },
})
