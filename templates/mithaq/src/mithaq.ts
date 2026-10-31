import { navGroups } from './mithaq/pages.ts'
import {
  // add-on: audit-log
  audit,
  // end add-on: audit-log
  base,
  betterAuthTenant,
  defaultAuthorize,
  defaultBulkLimit,
  defaultDepth,
  defaultJoinLimit,
  // add-on: jobs
  defaultJobLease,
  defaultJobRetention,
  drizzleJobs,
  // end add-on: jobs
  defaultLimit,
  defaultMaxLimit,
  screenKinds,
  defineMithaq,
  drizzleAdapter,
  drizzleKinds, drizzleRules, drizzleIdKinds,
  folderOf,
  // add-on: roles
  rbacTarget,
  // end add-on: roles
  Refusal,
  screenTarget,
  serviceTarget,
  // add-on: uploads
  storage,
  // end add-on: uploads
  versions,
  zodKinds, zodRules, zodIdKinds, zodTarget,
  type CommandInput,
} from 'mithaq'
// add-on: rich-text
import { richText } from 'mithaq/rich-text'
// end add-on: rich-text
import { fileURLToPath } from 'node:url'
// add-on: audit-log
import { auditSink } from './mithaq/audit-sink.ts'
// end add-on: audit-log
// add-on: rich-text
import { richTextNodes } from './mithaq/rich-text-nodes.ts'
import { richTextConfig } from './mithaq/rich-text-features.ts'
// end add-on: rich-text
import { systemRoles } from './roles/system-roles.ts'
// add-on: uploads
import { storageConfig } from './storage/index.ts'
// end add-on: uploads
import { authSettings, onBackoffice, organizationNameProblem, requireMailer } from './mithaq/auth/index.ts'
import { organizationName, organizations, showOrganization } from './mithaq/auth/organizations.ts'
import { assignedRoles, backofficeRolesOf, tenantAccess } from './roles/tenant-access.ts'
// without add-on: roles
// import { accessTarget } from './roles/member-access.ts'
// end without add-on: roles

/**
 * A local PostgreSQL on its default port, which `vite dev` falls back to when
 * no DATABASE_URL is set; it is also the URL `.env.example` names. A
 * deployment passes its own. `testDatabase` refuses an unset DATABASE_URL and
 * this URL's port, so a test never reaches it.
 */
export const devDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/mithaq'
/**
 * Production refuses the dev fallback, whose password sits in this file. This
 * runs on import, before anything connects.
 */
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('A production boot needs DATABASE_URL, the database this deployment uses. Nothing here falls back to the dev database in production.')
}
/**
 * `node --test` sets `NODE_TEST_CONTEXT` on every process it runs, so a test
 * that forgot DATABASE_URL never reaches the dev database.
 */
if (process.env.NODE_TEST_CONTEXT && !process.env.DATABASE_URL) {
  throw new Error('A test run needs DATABASE_URL, a database of its own: set DATABASE_URL. Nothing under node --test falls back to the dev database.')
}
const connectionString = process.env.DATABASE_URL ?? devDatabaseUrl

/**
 * Refuses a command that would open a real connection with no DATABASE_URL
 * named. `vite dev` never calls it and uses the dev fallback.
 */
const requireDatabaseUrl = () => {
  if (!process.env.DATABASE_URL) {
    throw new Refusal(
      'Refusing to connect: set DATABASE_URL to the database this command should use. Nothing here falls back to the dev database.',
    )
  }
}

/**
 * The asas's own source folder, which holds the migrations and each screen's
 * own pieces. The language names it, and a feature's folder, by path and
 * imports neither, so the packages depend one way: the asas on the language.
 */
const asasSource = new URL('../../asas/src/', import.meta.url)
const featuresFolder = new URL('../../features/', import.meta.url)

/**
 * A production `connect()` refuses to start while migrations are unapplied, so
 * a deploy changes the database only when someone runs
 * `drizzle-kit migrate --config src/migrations/drizzle.config.ts`; `'run'`
 * applies them on boot instead. The folder comes from this file because each
 * app calls `connect()` from its own folder.
 */
const drizzleStore = drizzleAdapter({
  connectionString,
  /** The column builders per kind, mithaq's default. */
  kinds: drizzleKinds,
  /** The column rules, mithaq's default. */
  rules: drizzleRules,
  /** The kinds an id may use, mithaq's default. */
  idKinds: drizzleIdKinds,
  prodMigrations: { migrationsFolder: fileURLToPath(new URL('migrations/', asasSource)), pending: 'refuse' },
})

/**
 * A drizzle store whose `connect()` (the schema push) and `migrate` command are
 * refused without DATABASE_URL, since either could silently reach the dev
 * database. `init` returns a fresh store per build, so it is guarded too.
 */
const guarded = (store: typeof drizzleStore): typeof drizzleStore => ({
  ...store,
  init: (kayan, options) => guarded((store.init(kayan, options) ?? store) as typeof drizzleStore) as never,
  connect: async (args?: { readOnly?: boolean }) => {
    requireDatabaseUrl()
    if (process.env.NODE_ENV === 'production' && !args?.readOnly) requireMailer(authSettings)
    await store.connect(args)
  },
  commands: {
    migrate: async (input: CommandInput) => {
      requireDatabaseUrl()
      return store.commands!.migrate!(input)
    },
  },
})
// add-on: roles
// A build has one `access` target. Swapping this line for `betterAuthTarget` moves
// custom roles into the provider's own rows, but the assignment guard
// `assignableRole` stays bound to this shape: it reads the `roles` kayan by a
// `name` filter and a `permissions` list, where the provider keys rows on `role`
// and holds a `permission` object. It fails closed (an unreadable role is every
// key of the project), so a project that swaps this must teach the guard the
// provider's table and columns too.
const accessOptions = {
  /** The roles this project ships, and the names a row may be keyed on. */
  roles: systemRoles,
  /** How an actor's assigned slugs are read, for every row table. */
  rolesOf: assignedRoles,
  // The rows every kayan placing `tenant.field` answers from. A kayan drops them
  // with `access: { tenant: false }`; a shared one never had them, which is how
  // the generated auth kayan keep their default deny, except the two whose
  // `<kayan>.access.ts` the generator imports.
  access: tenantAccess,
  /** Where the target seeds the system roles and reads the assignments. */
  kayan: { roles: 'roles', memberRoles: 'memberRoles' },
} as const

/**
 * The access target over these roles: `rbacTarget` whole, except `assign`,
 * which writes and is refused without DATABASE_URL unless run with `--check`.
 */
export const accessTarget = (roles: typeof systemRoles = systemRoles) => {
  const target = rbacTarget({ ...accessOptions, roles })
  return {
    ...target,
    commands: {
      assign: async (input: CommandInput) => {
        if (!input.flags.includes('--check')) requireDatabaseUrl()
        return target.commands!.assign!(input)
      },
    },
  }
}
// end add-on: roles
// without add-on: roles
// export { accessTarget }
// end without add-on: roles

/**
 * Every target but the screens. A screen names the kayan it draws, so a build
 * holding only some of this project's kayan, as a test's does, is refused by it
 * and uses a language whose screen draws only what it holds.
 */
export const serverTargets = {
  drizzle: guarded(drizzleStore),
  zod: zodTarget({
    /** The schema builders per kind, mithaq's default. */
    kinds: zodKinds,
    /** The schema rules, mithaq's default. */
    rules: zodRules,
    /** The kinds an id may use, mithaq's default. */
    idKinds: zodIdKinds,
  }),
  rbac: accessTarget(),
  // Every kayan placing `organization` belongs to one organization,
  // the session's active one. `restrict`: an organization that still holds a row
  // is not deleted, so no row is left behind with no tenant to read it.
  tenant: betterAuthTenant({
    relationTo: 'organization',
    onDelete: 'restrict',
    // New rows take the active organization, mithaq's tenant fill rule.
    newRows: 'active',
    // How many organizations this project holds; in one a start over more is refused.
    organizations,
    // Staff read every organization with `tenant: 'all'` in the backoffice app
    // alone, which is the app's own fact and never the request's; their rows
    // there write nothing.
    backoffice: ({ user }) => onBackoffice() && backofficeRolesOf(user).length > 0,
  }),
  // The runner is a target too (`capability: 'service'`); a build has exactly
  // one, under this name. It holds no operations: each kayan spreads
  // `defaultOperations` into its own `targets.service.operations` and leaves
  // out any it does not want, such as `count`.
  service: serviceTarget({
    // One of the three lists every write runs around its own: a step here runs
    // last inside the write's transaction, as the audit log's `audit` does,
    // writing one `auditLog` row in it. A precondition goes in `beforeSteps`, and
    // a webhook or email after a durable write in `afterCommit`.
    afterSteps: [
      // add-on: audit-log
      audit,
      // end add-on: audit-log
    ],
    // add-on: audit-log
    /** Where the `audit` step hands each write: the template's audit log. */
    audit: auditSink,
    // end add-on: audit-log
    /** The access evaluator every operation runs before its first step. */
    authorize: defaultAuthorize,
    /** The deepest a read or a write may nest another before it is refused, eight. */
    depth: defaultDepth,
    /**
     * The page a `find` or a `findVersions` answers when its caller names no
     * `limit`, ten, and the most rows a served one may ask for, a hundred.
     */
    defaultLimit,
    maxLimit: defaultMaxLimit,
    /** How many child rows a populated join carries where its field names none, ten. */
    joinLimit: defaultJoinLimit,
    /** The most rows one bulk write may match, a thousand. */
    bulkLimit: defaultBulkLimit,
    // add-on: courses
    // The field that marks a row deleted. A kayan takes soft delete by declaring
    // a field of this name, as `enrollments` does. A build where no kayan
    // declares it is refused, because every delete in it would remove rows for
    // good. Spreading the field into every kayan is refused where a permission
    // store reads the kayan, since a role row the delete marked would still grant
    // its keys.
    softDelete: 'deletedAt',
    // end add-on: courses
    /** The database a kayan writes through when it names no other. */
    store: 'drizzle',
    /** The target a write is validated against when a kayan names no other. */
    schema: 'zod',
  }),
}

// add-on: uploads
/**
 * Files: the `upload` kind and the storage target, from the storage rukn over
 * this project's config. `mithaq storage sweep` reads every row, so it is
 * refused without DATABASE_URL like `migrate`.
 */
const files = storage(storageConfig)
const guardedFiles = {
  ...files,
  targets: {
    ...files.targets,
    storage: {
      ...files.targets.storage,
      commands: {
        ...files.targets.storage.commands,
        sweep: async (input: CommandInput) => {
          requireDatabaseUrl()
          return files.targets.storage.commands.sweep(input)
        },
      },
    },
  },
}
// end add-on: uploads

/**
 * The pillars the language's kinds, rules and built targets come from: `base`
 * brings the shipped kinds and rules, and `versions` the target a kayan keeps
 * its past and drafts through by writing `targets.versions`. One row keeps its
 * last hundred versions unless its kayan names another window. A rukn of the
 * project's own goes beside them.
 */
export const arkan = [
  base,
  // add-on: rich-text
  // The rich text kind over this project's node list.
  richText({ nodes: richTextNodes, ...richTextConfig }),
  // end add-on: rich-text
  // add-on: uploads
  // The `upload` kind and the storage target.
  guardedFiles,
  // end add-on: uploads
  versions({ max: 100 }),
] as const

/**
 * The context every served call and first registration hands its steps, built
 * here from the request: mithaq reads no header and no body key into it. A
 * fresh id per request, so nothing a client sends names it. A step reads the
 * key untyped unless the runner declares `context`, for example
 * `context: {} as { requestId: string }`, and then every call in the app passes
 * one too.
 */
export const requestContext = (_request: Request) => ({ requestId: crypto.randomUUID() })

/**
 * Each screen file is named `ui('file.tsx#Export')` off a folder URL taken from
 * this file, so the build reads it wherever it runs and refuses a missing file
 * or export. `ui/` holds what several screens draw with, each screen's own
 * folder what only it does.
 */
export const ui = folderOf(new URL('./ui/', import.meta.url))
export const dashboardUi = folderOf(new URL('ui-dashboard/', asasSource))
export const portalUi = folderOf(new URL('ui-portal/', asasSource))
export const backofficeUi = folderOf(new URL('ui-backoffice/', asasSource))
// add-on: courses
/** Every screen's provider of course titles for a session's label, which the courses feature draws. */
const sessionLabels = folderOf(new URL('courses/enrollments/ui/', featuresFolder))('session-labels.tsx#SessionLabels')
/** The portal's own look, which the courses feature draws for its students. */
const coursesPortal = folderOf(new URL('courses/portal/ui/', featuresFolder))
// end add-on: courses

/**
 * Written once and spread into each screen: what draws each kind and the
 * shared layouts. A piece only one screen draws is written on that screen.
 */
const shared = {
  controls: screenKinds,
  icons: ['layout-dashboard', 'user-round', 'building-2', 'users', 'book-open', 'calendar-days', 'clipboard-list', 'tags', 'shield-check', 'user-cog', 'settings-2', 'history', 'table-2'] as const,
  layouts: {
    app: ui('app-shell.tsx#AppShell'),
    record: ui('record-page.tsx#RecordPage'),
    table: ui('table-page.tsx#TablePage'),
  },
}

/** The portal screen, the students' and instructors' own. The test language narrows it to the kayan a test builds. */
export const portalScreen = screenTarget({
  ...shared,
  path: '/portal',
  kayan: [
    // add-on: courses
    // `sessions` is listed for its title alone, which an enrollment's session
    // reads by; it has no page here and so no nav entry.
    'courses',
    'enrollments',
    'sessions',
    // end add-on: courses
    // add-on: media
    // `media` is listed for an image's title alone, such as a course's cover,
    // which a course page draws read-only; it has no page here.
    'media',
    // end add-on: media
    // `user` is listed for its title alone, which a relationship to a person reads by.
    'user',
  ],
  providers: [
    // add-on: rich-text
    ui('rich-text-nodes.tsx#RichTextNodes'),
    // end add-on: rich-text
    // add-on: courses
    sessionLabels,
    // end add-on: courses
  ],
  pages: {
    // add-on: courses
    // A greeting, the viewer's next session, and courses it can join.
    home: { path: '/', component: portalUi('courses-home.tsx#Home') },
    // end add-on: courses
    // without add-on: courses
    // home: { path: '/', component: portalUi('home.tsx#Home') },
    // end without add-on: courses
  },
  // Its own shell, which draws no link to the backoffice app: staff reach it from
  // the dashboard alone. Every page a tree draws is that shell over the portal's
  // single column; the courses example's pages draw it whole.
  layouts: {
    // add-on: courses
    top: coursesPortal('shell.tsx#PortalShell'),
    // end add-on: courses
    // without add-on: courses
    // top: ui('top-shell.tsx#PortalTopShell'),
    // end without add-on: courses
    page: portalUi('page.tsx#Page'),
  },
  components: {},
})

/** The dashboard screen, the tenant back office. The test language narrows it to the kayan a test builds. */
export const dashboardScreen = screenTarget({
  ...shared,
  // The top-bar shell too, which the courses board page is rooted at.
  layouts: { ...shared.layouts, top: ui('top-shell.tsx#TopShell') },
  path: '/dashboard',
  kayan: [
    // add-on: courses
    'courses',
    'sessions',
    'enrollments',
    // end add-on: courses
    'tags',
    // add-on: media
    'media',
    // end add-on: media
    // add-on: roles
    // `memberRoles` is listed for its access report alone, which the members
    // page's sheet is drawn by; it has no page of its own.
    'roles',
    'memberRoles',
    // end add-on: roles
    // add-on: settings
    'settings',
    // end add-on: settings
    // `user` and `organization` are listed for their titles alone: they have no
    // page and so no nav entry, and a relationship to either shows the row's name.
    'user',
    'organization',
    // add-on: audit-log
    // `auditLog` is listed for its access report, which the edit pages' activity
    // and the Activity page are drawn by, and for the person filter's own field.
    'auditLog',
    // end add-on: audit-log
  ],
  providers: [
    dashboardUi('theme-provider.tsx#ThemeProvider'),
    // add-on: rich-text
    ui('rich-text-nodes.tsx#RichTextNodes'),
    // end add-on: rich-text
    // add-on: courses
    sessionLabels,
    // end add-on: courses
  ],
  pages: {
    // add-on: courses
    // The page at `/`, served only to an actor who reads the courses it counts.
    dashboard: { path: '/', component: dashboardUi('dashboard.tsx#Dashboard'), permission: 'courses.find' },
    // end add-on: courses
    // without add-on: courses
    // // The page at `/`: a figure for each list the nav offers the viewer.
    // dashboard: { path: '/', component: dashboardUi('home.tsx#Home') },
    // end without add-on: courses
    // add-on: roles
    // A page that belongs to no kayan, listed in the nav under its own label
    // and served only to an actor holding the key it names: `member.find`, the
    // key the auth setup asks before the provider lists members.
    members: {
      path: '/members',
      component: dashboardUi('members.tsx#Members'),
      // With no organization shown, its members are the app's users.
      nav: { icon: 'users', group: navGroups.settings, order: 1, label: showOrganization ? { en: 'Members', ar: 'الأعضاء' } : { en: 'Users', ar: 'المستخدمون' } },
      permission: 'member.find',
    },
    fixedRole: { path: '/roles/fixed/:name', component: dashboardUi('fixed-role.tsx#FixedRole'), permission: 'roles.find' },
    member: { path: '/members/:id', component: dashboardUi('member.tsx#Member'), permission: 'member.find' },
    // end add-on: roles
    // add-on: audit-log
    // Every change in the organization, filtered and paged, for an actor holding the log's key,
    // which reads the entries of the kayan it lists alone. Read-only, as the log is.
    activity: {
      path: '/activity',
      component: ui('activity-page.tsx#ActivityPage'),
      nav: { icon: 'history', group: navGroups.settings, order: 4, label: { en: 'Activity', ar: 'النشاط' } },
      permission: 'auditLog.find',
    },
    // end add-on: audit-log
  },
  // A piece only one kayan draws is named by `ui()` in that kayan's file; these
  // are drawn by name from many.
  components: {
    // add-on: audit-log
    // A record's own audit entries, which each edit page draws in its side column.
    activity: ui('activity.tsx#Activity'),
    // A record's whole history, filtered and paged, which an edit page draws in a tab beside Versions.
    activityLog: ui('activity.tsx#ActivityTab'),
    // end add-on: audit-log
    // A row's versions, with their restore, which the edit page of a kayan that
    // keeps drafts draws in a tab of its own.
    versions: dashboardUi('versions.tsx#Versions'),
    // add-on: uploads
    // What an upload kayan draws of its own files: the list's file and size
    // cells, its New page, and the file beside its edit form.
    fileCell: ui('uploads.tsx#FileCell'),
    fileSizeCell: ui('uploads.tsx#FileSizeCell'),
    fileDetails: ui('uploads.tsx#FileDetails'),
    newUpload: ui('uploads.tsx#NewUpload'),
    // end add-on: uploads
  },
})

/**
 * The backoffice screen: staff above every tenant, entered by `screen.backoffice`,
 * which only a backoffice role holds, and served by its own app,
 * `apps/asas-backoffice`, whose requests alone get the backoffice roles from the
 * template's role reader. It lists the provider's generated kayan and every
 * tenant kayan across organizations, read-only: a backoffice role reads every
 * tenant's rows by its keys and writes none. Local accounts are listed for a
 * super admin alone, who verifies a sign-up there. The settings global is not
 * listed: a list across tenants reads by `find`, which a global declares none
 * of.
 */
export const backofficeScreen = screenTarget({
  ...shared,
  // The dashboard's frame with no organization switcher, which staff have no
  // use for, and a record page with a link back to its list.
  layouts: { ...shared.layouts, app: ui('app-shell.tsx#BackofficeShell'), record: backofficeUi('record-page.tsx#BackofficeRecordPage') },
  path: '/backoffice',
  kayan: [
    'user',
    'organization',
    'member',
    // add-on: courses
    'courses',
    'sessions',
    'enrollments',
    // end add-on: courses
    'tags',
    // add-on: roles
    'roles',
    'memberRoles',
    // end add-on: roles
    'localUsers',
    // add-on: audit-log
    // Who impersonated whom, set whose backoffice role and banned whom, for the roles that read it.
    'backofficeLog',
    // end add-on: audit-log
  ],
  providers: [
    dashboardUi('theme-provider.tsx#ThemeProvider'),
    // add-on: rich-text
    ui('rich-text-nodes.tsx#RichTextNodes'),
    // end add-on: rich-text
    // add-on: courses
    sessionLabels,
    // end add-on: courses
  ],
  pages: { home: { path: '/', component: backofficeUi('home.tsx#Home') } },
  components: {},
})

const language = defineMithaq({
  /** Every locale this project's copy is written in, so a missing one is a type error. */
  locales: ['ar', 'en'] as const,
  arkan,
  // A project's own target spreads in here beside the shipped ones and is
  // checked exactly like them.
  targets: {
    ...serverTargets,
    // add-on: jobs
    jobs: drizzleJobs({ lease: defaultJobLease, retain: defaultJobRetention }),
    // end add-on: jobs
    // The three screens, each a target of capability `screen` under its own key.
    // A kayan says what each screen draws of it under `targets.<screen>`, and
    // `mithaq generate screens` writes each screen's `screen.json`, `types.ts`,
    // glob and route files under `generate.screens`.
    dashboard: dashboardScreen,
    portal: portalScreen,
    backoffice: backofficeScreen,
  },
  // Not a key the language knows: the project's own, passed through typed, and
  // read by `mithaq generate auth`, `messages` and `screens` to find where each
  // writes. `providers` is the module `generate auth` reads the Better Auth
  // instances from and writes into each generated kayan's import, and `language`
  // the module each of them imports `defineKayan` from. `screens` is
  // the host app's routes folder, one per screen because more than one app
  // serves them: the tenant's two by `apps/asas-tanstack`, the backoffice by
  // `apps/asas-backoffice`.
  // Each path is from the asas's folder, where every `mithaq` command runs.
  generate: {
    language: '@asas/mithaq',
    features: '../features/',
    auth: '../features/auth/',
    providers: '@asas/mithaq/auth',
    messages: 'src/messages/',
    migrations: 'src/migrations/',
    screens: {
      dashboard: '../../apps/asas-tanstack/src/routes/(screens)/',
      portal: '../../apps/asas-tanstack/src/routes/(screens)/',
      // add-on: backoffice
      backoffice: '../../apps/asas-backoffice/src/routes/(screens)/',
      // end add-on: backoffice
      // without add-on: backoffice
      // backoffice: false,
      // end without add-on: backoffice
    },
  },
})

// `targets` is the language's own, which `mithaq generate auth` reads beside
// `generate` to title a provider kayan on each screen that lists it.
export const { defineKayan, defineGlobal, buildAsas, rows, user, generate, locales, targets, targets: { tenant } } = language
/** The language's type, which the apps check their admin components map against: a kind of this project's own needs a control there. */
export type Language = typeof language

// Every mode holds an organization's names to `organizationName`'s locales and falls back to its first, so a locale it
// leaves out would be one no organization could be named in.
const unnamed = organizationNameProblem({ names: organizationName, locales })
if (unnamed) throw new Error(`src/mithaq/auth/organizations.ts: ${unnamed}`)

/**
 * The field every tenant-owned kayan places, as `organization`: the tenant target's own, under the
 * backoffice's word for a tenant. Its copy is all a kayan may change of it, and a kayan that places
 * none is shared.
 */
export const organization = { ...tenant.field, label: { en: 'Organization', ar: 'المؤسسة' } }
