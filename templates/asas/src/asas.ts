import { providerStatements } from '@asas/auth'
// Each feature is read through its index alone, as a namespace, so its list
// (`courses.kayan`) never collides with a kayan of the same name.
import * as auditLog from './features/audit-log/index.ts'
import * as auth from './features/auth/index.ts'
import * as courses from './features/courses/index.ts'
import * as roles from './features/roles/index.ts'
import * as settings from './features/settings/index.ts'
import * as tags from './features/tags/index.ts'
import { fetchHttp, Notice } from 'mithaq'
import { orpcHttp } from 'mithaq/orpc'
import { buildAsas, requestContext } from './mithaq.ts'
import { platformHttp } from './platform-http.ts'
import { projectStatements } from './roles/statements.ts'
import { superAdmin } from './roles/tenant-access.ts'

export const asas = buildAsas({
  kayan: [...auth.kayan, ...roles.kayan, ...tags.kayan, ...courses.kayan, ...auditLog.kayan],
  global: [...settings.global],
  // The HTTP layer, a list the handler asks in order. `orpcHttp()` is first
  // because it owns `/api/rpc`, where a typed client would reach the build, and
  // because `asas.router` is the first plug's. It also claims `/api`, so the
  // plain plug behind it answers only what oRPC's own OpenAPI arm matched
  // nothing for; it is listed so a build that drops the typed client keeps plain
  // HTTP by deleting one line. Core picks no plug of its own, so a build that
  // leaves `http` out is refused.
  // Each plug is handed the same context function, so a step reads the same
  // bag whichever plug served it.
  // The platform's rename of an organization sits between them, before the
  // plain plug would read `/api/platform/*` as a kayan's route.
  // A fault either plug answers 500 is written to this project's log, the
  // console, as `fetchHttp`'s default does; the oRPC plug takes no default.
  http: [
    orpcHttp({ context: (request, actor) => ({ actor, ...requestContext(request) }), onError: (error) => console.error(error) }),
    platformHttp(),
    fetchHttp({ context: requestContext }),
  ],
  // Better Auth's own actions, which no declaration of this project derives.
  // They join the catalog under the resources they name, so a role holds
  // `invitation.cancel` or `user.impersonate` exactly as it holds
  // `courses.find`, and the hooks in @asas/auth ask for them under whichever
  // store this project turned on. `organization.rename` is this project's own,
  // the key the platform's rename route asks, which is neither the
  // provider's `organization.update` nor the managed kayan's, both of which
  // share that name. The project's own keys beside a kayan's operations are
  // listed with the role form that offers them.
  statements: { ...providerStatements, organization: [...providerStatements.organization, 'rename'], ...projectStatements },
  // `onError` hears a strategy that threw and an access target that could not
  // answer, which the build reports nowhere of its own. The console is this
  // project's log; a project with an error tracker names it here. A `Notice`
  // is expected, such as the build of a local auth kayan with no mailer, and
  // prints as its one line; anything else prints with its stack.
  //
  // `admin.access` is the answer `/api/access` reports as `canAccessAdmin`:
  // `true` for a super admin in the platform app, `false` for every other
  // actor. The local `unlock` endpoint asks the same answer of the caller local
  // auth alone resolves, which is never a Better Auth super admin, so it stays
  // closed.
  //
  // The administrator is a super admin in the platform app and nobody else: the
  // one who verifies a local sign-up. A kayan with no callback of its own falls
  // to this answer, so every table Better Auth alone writes closes itself.
  auth: { admin: { kayan: auth.user, access: superAdmin }, onError: (error) => console.error(error instanceof Notice ? error.message : error) },
})

// The platform slug, the screen the platform app serves, the reader that
// answers the platform roles, and the tenant app's link to the platform, for a
// host.
export { PLATFORM, PLATFORM_SCREEN, assignedRoles, platformEntry } from './roles/tenant-access.ts'
// What the platform app wraps every request it serves in, whether a request is
// one of those, and where each app is served: re-exported here so a host reaches
// the one instance of the store behind it through the same module the build reads.
export { asPlatform, onPlatform, platformURL, tenantURL } from '@asas/auth'
export type { Language } from './mithaq.ts'
