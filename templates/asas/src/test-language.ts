// Test support: this project's language for a test's build that holds some of its kayan.
// A screen lists the kayan it draws by name and refuses a build missing one, and a test builds a kayan or two at a time,
// so the dashboard screen here draws only the two role kayan every such build holds and the two provider kayan
// their assignments point at, whose own declarations write `targets.dashboard`.
import { defineMithaq, type SystemRoles } from 'mithaq'
import { accessTarget, arkan, dashboardScreen, platformScreen, portalScreen, serverTargets } from './mithaq.ts'
import { systemRoles } from './roles.ts'

const languageOf = (roles: SystemRoles) => defineMithaq({
  locales: ['ar', 'en'] as const,
  arkan,
  // The dashboard alone, and without its key: the members page names
  // `memberRoles.find` and the dashboard `courses.find`, which a build holding
  // neither kayan's operations could never answer.
  // The platform lists the same four and the members, whose declarations write
  // `targets.platform` too.
  targets: {
    ...serverTargets,
    rbac: accessTarget(roles as typeof systemRoles),
    // No audit step: a test builds a kayan or two and not the audit log the
    // sink writes into, so every write here would reach for a table this
    // build does not hold. The sink stays, which a build allows.
    service: { ...serverTargets.service, afterSteps: [] },
    dashboard: { ...dashboardScreen, kayan: ['roles', 'memberRoles', 'user', 'organization'], pages: { dashboard: { path: '/', component: dashboardScreen.pages.dashboard!.component } } },
    platform: { ...platformScreen, kayan: ['roles', 'memberRoles', 'user', 'organization', 'member'] },
    // The portal titles a person too, for the enrollment drawer's student picker.
    portal: { ...portalScreen, kayan: ['user'] },
  },
})

/**
 * A language whose builds each run over the project's roles narrowed to the
 * keys that build can name. A test builds a kayan or two of this project, and
 * the roles name keys of every kayan it holds, which `buildAsas` refuses,
 * so each build gets the same language over the narrowed roles. A key this
 * drops names a kayan, a field, an operation, a screen or a statement the build
 * does not hold, which nothing in it could ever ask for, so what an actor may
 * do is the same. Each kayan keeps the rows the first language compiled for
 * it, which are the same table read through the same reader.
 *
 * The roles are what the build seeds too: a narrowed build that connects
 * writes each system role's row with the narrowed `permissions`, and a later
 * full build on the same database keeps that row rather than rewriting it.
 * The row is what a screen lists and never what a check reads, since the keys
 * come from code, so what an actor holds is the same; only a listing of that
 * database shows the shorter list.
 */
export const narrowed = <D extends { targets: object; buildAsas: (args: never) => unknown }>(languageOf: (roles: SystemRoles) => D): D => {
  const language = languageOf(systemRoles)
  const screens = Object.entries(language.targets)
    .filter(([, target]) => (target as { capability?: string }).capability === 'screen')
    .map(([name]) => `screen.${name}`)
  const buildAsas = (args: { kayan: readonly Declared[]; global?: readonly Declared[]; statements?: Readonly<Record<string, readonly string[]>> }) => {
    const named = new Set([
      ...screens,
      ...[...args.kayan, ...(args.global ?? [])].flatMap((one) =>
        [...Object.keys(one.targets?.service?.operations ?? {}), ...Object.keys(one.fields).map((field) => `fields.${field}`)].map((action) => `${one.name}.${action}`),
      ),
      ...Object.entries(args.statements ?? {}).flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`)),
    ])
    const roles = Object.fromEntries(
      Object.entries(systemRoles).map(([slug, role]) => [
        slug,
        { ...role, permissions: role.permissions === '*' ? '*' : (role.permissions as readonly string[]).filter((key) => named.has(key)) },
      ]),
    ) as SystemRoles
    // The template reports to the console, and so do the tests,
    // unless one names its own.
    const auth = { onError: console.error, ...(args as { auth?: object }).auth }
    return languageOf(roles).buildAsas({ ...args, auth } as never)
  }
  return { ...language, buildAsas } as D
}

/** What a build reads off each kayan it is handed, before it resolves any. */
type Declared = { name: string; fields: object; targets?: { service?: { operations?: object } } }

export const { defineKayan, defineGlobal, buildAsas, locales } = narrowed(languageOf)
