import { providerStatements } from '@asas/mithaq/auth'
// Each feature is read through its index alone, as a namespace, so its list
// (`courses.kayan`) never collides with a kayan of the same name.
// add-on: audit-log
import * as auditLog from '@asas/audit-log'
// end add-on: audit-log
import * as auth from '@asas/auth'
// add-on: courses
import * as courses from '@asas/courses'
// end add-on: courses
// add-on: media
import * as media from '@asas/media'
// end add-on: media
// add-on: roles
import * as roles from '@asas/roles'
// end add-on: roles
// add-on: settings
import * as settings from '@asas/settings'
// end add-on: settings
import * as tags from '@asas/tags'
import { defaultMaxBodyBytes, fetchHttp, Notice } from 'mithaq'
import { orpcHttp } from 'mithaq/orpc'
import { buildAsas, requestContext } from '@asas/mithaq'
import { backofficeHttp } from './backoffice-http.ts'
import { projectStatements } from '@asas/mithaq/roles/statements.ts'
import { superAdmin } from '@asas/mithaq/roles/tenant-access.ts'

/**
 * Where a fault the build answers 500 to, or a strategy that threw, is reported: this project's
 * log, the console. A project with an error tracker names it here. A `Notice` is expected, such
 * as the build of a local auth kayan with no mailer, and prints as its one line; anything else
 * prints with its stack.
 */
const report = (error: unknown) => console.error(error instanceof Notice ? error.message : error)

export const asas = buildAsas({
  kayan: [
    ...auth.kayan,
    // add-on: roles
    ...roles.kayan,
    // end add-on: roles
    ...tags.kayan,
    // add-on: media
    // An image is read by a holder of `media.create`, and otherwise through
    // what the features pointing at images say of it.
    ...media.kayan({
      // add-on: courses
      reads: [courses.coverReads],
      // end add-on: courses
      // without add-on: courses
      // reads: [],
      // end without add-on: courses
    }),
    // end add-on: media
    // add-on: courses
    ...courses.kayan,
    // end add-on: courses
    // add-on: audit-log
    ...auditLog.kayan,
    // end add-on: audit-log
  ],
  global: [
    // add-on: settings
    ...settings.global,
    // end add-on: settings
  ],
  // The HTTP layer, a list the handler asks in order. `orpcHttp` is first
  // because it owns `/api/rpc`, where a typed client would reach the build, and
  // because `asas.router` is the first plug's. It also claims `/api`, so the
  // plain plug behind it answers only what oRPC's own OpenAPI arm matched
  // nothing for; it is listed so a build that drops the typed client keeps plain
  // HTTP by deleting one line. Core picks no plug of its own, so a build that
  // leaves `http` out is refused.
  // Each plug is handed the same context function, so a step reads the same
  // bag whichever plug served it.
  // The backoffice's rename of an organization sits between them, before the
  // plain plug would read `/api/backoffice/*` as a kayan's route.
  // A fault either plug answers 500 is handed to `report`; core reports none of its own.
  // A body past `maxBodyBytes` is answered 413 before it is read whole.
  http: [
    orpcHttp({ context: (request, actor) => ({ actor, ...requestContext(request) }), onError: report, maxBodyBytes: defaultMaxBodyBytes }),
    backofficeHttp(),
    fetchHttp({ context: requestContext, onError: report, maxBodyBytes: defaultMaxBodyBytes }),
  ],
  // Better Auth's own actions, which no declaration of this project derives.
  // They join the catalog under the resources they name, so a role holds
  // `invitation.cancel` or `user.impersonate` exactly as it holds
  // `tags.find`, and the hooks in @asas/mithaq/auth ask for them under whichever
  // store this project turned on. `organization.rename` is this project's own,
  // the key the backoffice's rename route asks, which is neither the
  // provider's `organization.update` nor the managed kayan's, both of which
  // share that name. The project's own keys beside a kayan's operations are
  // listed with the role form that offers them.
  statements: { ...providerStatements, organization: [...providerStatements.organization, 'rename'], ...projectStatements },
  // `onError` hears a strategy that threw and an access target that could not
  // answer, which the build reports nowhere of its own.
  //
  // `admin.access` is the answer `/api/access` reports as `canAccessAdmin`:
  // `true` for a super admin in the backoffice app, `false` for every other
  // actor. The local `unlock` endpoint asks the same answer of the caller local
  // auth alone resolves, which is never a Better Auth super admin, so it stays
  // closed.
  //
  // The administrator is a super admin in the backoffice app and nobody else: the
  // one who verifies a local sign-up. A kayan with no callback of its own falls
  // to this answer, so every table Better Auth alone writes closes itself.
  auth: { admin: { kayan: auth.user, access: superAdmin }, onError: report },
})

// The backoffice slug, the screen the backoffice app serves, the reader that
// answers the backoffice roles, and the tenant app's link to the backoffice, for a
// host.
export { BACKOFFICE, BACKOFFICE_SCREEN, assignedRoles, backofficeEntry } from '@asas/mithaq/roles/tenant-access.ts'
// What the backoffice app wraps every request it serves in, whether a request is
// one of those, and where each app is served: re-exported here so a host reaches
// the one instance of the store behind it through the same module the build reads.
export { asBackoffice, onBackoffice, backofficeURL, tenantURL } from '@asas/mithaq/auth'
export type { Language } from '@asas/mithaq'
