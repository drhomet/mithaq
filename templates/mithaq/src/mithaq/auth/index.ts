import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { domainToUnicode } from 'node:url'
import { runWithAdapter, tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import { BASE_ERROR_CODES, betterAuth as betterAuthServer, getCurrentAdapter } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthEndpoint, createAuthMiddleware, formCsrfMiddleware, getSessionFromCtx, sessionMiddleware } from 'better-auth/api'
import { admin, oneTimeToken, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements as adminStatements, userAc } from 'better-auth/plugins/admin/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'
import { holdsPermission, requestOrganization, type Vocabulary, type Where } from 'mithaq'
import { z } from 'zod'
import { sql } from 'mithaq/drizzle'
import { configuredMailer, logMailer, type Mail, type Mailer } from '../../mail/index.ts'
// A module of its own so a screen can list the roles without loading the provider.
import { backofficeRoles } from './backoffice-roles.ts'
import { allowedDomains, defaultLocale, joinRole, nameIn, organizationName, organizations, passwordDelivery, showOrganization, signUp, verifyEmail } from './organizations.ts'
// add-on: roles
import { tenantRoles } from '../../roles/tenant-roles.ts'
import { managesRoles } from '../../roles/grants.ts'
// end add-on: roles

export { backofficeRoles }

// Set only by the backoffice app, which wraps every request it serves in `asBackoffice`. Nothing a
// client sends sets it.
const backofficeRequest = new AsyncLocalStorage<true>()
/** Runs `run` as a request the backoffice app serves. Only the backoffice app calls it. */
export const asBackoffice = <Result>(run: () => Result): Result => backofficeRequest.run(true, run)
/**
 * Whether the current request is the backoffice app's, which picks the backoffice's Better Auth
 * instance and its role set.
 */
export const onBackoffice = () => backofficeRequest.getStore() === true

/**
 * Whether this project serves the backoffice console, `apps/asas-backoffice`, as `generate.screens`
 * in `src/mithaq.ts` says too. Without it no boot asks for BACKOFFICE_URL, and nobody is linked or
 * sent to a backoffice app that does not exist.
 */
// add-on: backoffice
export const backofficeApp: boolean = true
// end add-on: backoffice
// without add-on: backoffice
// export const backofficeApp: boolean = false
// end without add-on: backoffice

// A production boot needs all three: the fallbacks below are for development only, and Better
// Auth's refusal of its default secret never fires for the backoffice, whose secret is derived here.
const production = process.env.NODE_ENV === 'production'
const secret = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET
if (production && ((backofficeApp && !process.env.BACKOFFICE_URL) || !process.env.BETTER_AUTH_URL || !secret)) {
  throw new Error(backofficeApp
    ? 'A production boot needs BACKOFFICE_URL and BETTER_AUTH_URL, where the two apps are served, and BETTER_AUTH_SECRET, which both sign their sessions under. Set all three.'
    : 'A production boot needs BETTER_AUTH_URL, where the app is served, and BETTER_AUTH_SECRET, which signs its sessions. Set both.')
}

// `NODE_ENV` is unset when a deploy runs plain `node` or `bun`, so the check above never runs and
// both apps would boot on a public secret. Refuse on a non-local host with no secret instead.
export const isLocalHost = (url: string): boolean => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
const remoteWithNoSecret = process.env.BETTER_AUTH_SECRET
  ? undefined
  : [process.env.BACKOFFICE_URL, process.env.BETTER_AUTH_URL].filter((url): url is string => typeof url === 'string').find((url) => !isLocalHost(url))
if (remoteWithNoSecret) {
  throw new Error(`BETTER_AUTH_SECRET must be set: ${remoteWithNoSecret} is not localhost, and this file's own secret falls back to a public default without it.`)
}

/**
 * Where the backoffice app is served, and the backoffice instance's `baseURL`. Outside production, or
 * where no backoffice app is served, it falls back to the `vite dev` port, and nothing links there.
 */
export const backofficeURL = process.env.BACKOFFICE_URL ?? 'http://localhost:5174'

// The backoffice's first administrator is made by first-register, and the first owner of a project
// of one organization by first-run, and both ask for the `SETUP_CODE` the deploy set, so nobody who
// merely reaches a new deploy first takes it. Only `vite dev` on this machine skips it: a deploy
// run with plain `node` sets no `NODE_ENV`, and an unset URL falls back to localhost. The code is
// the one bar, so a value short enough to guess is no code at all.
const setupCode = (process.env.SETUP_CODE?.length ?? 0) >= 32 ? process.env.SETUP_CODE : undefined
const developing = process.env.NODE_ENV === 'development'
const setupCodeState = (url: string): 'none' | 'required' | 'unset' => (developing && isLocalHost(url) ? 'none' : setupCode ? 'required' : 'unset')
// Mirrors the tenant's `rateLimit.enabled`, read off the backoffice's own address.
const backofficeLimited = production || !isLocalHost(backofficeURL)
// Digests, so both sides are always 32 bytes and `timingSafeEqual` neither throws on nor answers
// sooner for a code of another length.
const digest = (text: string) => createHash('sha256').update(text).digest()
const isSetupCode = (given: unknown) => typeof given === 'string' && setupCode !== undefined && timingSafeEqual(digest(given), digest(setupCode))
/** Why a setup route served at `url` refuses `code`, or nothing; `app` names where SETUP_CODE is set. */
const refusedSetup = ({ url, code, app }: { url: string; code: unknown; app: string }) => {
  const state = setupCodeState(url)
  if (state === 'unset') return new APIError('FORBIDDEN', { code: 'SETUP_CODE_UNSET', message: `Set SETUP_CODE where the ${app} runs, to a random value of 32 characters or more: the first administrator is made only with it.` })
  if (state === 'required' && !isSetupCode(code)) return new APIError('FORBIDDEN', { code: 'SETUP_CODE_WRONG', message: 'That is not the setup code.' })
  return undefined
}
// Set only around the calls first-register and first-run make once they found nobody under their
// lock, and around the account add-person makes: the only calls that may write a role or make an
// account no sign-up would.
const firstRegistering = new AsyncLocalStorage<true>()
// Without TRUSTED_IP_HEADER, Better Auth keys its limit on an `x-forwarded-for` the caller writes,
// so each setup route also keeps one window that every caller shares.
// ponytail: process-local, and a flood holds setup off for everyone until it stops; set
// TRUSTED_IP_HEADER for per-address limits alone.
const sharedWindow = () => {
  const tries: number[] = []
  return () => {
    const now = Date.now()
    while (tries.length && now - tries[0]! >= 60_000) tries.shift()
    return tries.length >= 10 || (tries.push(now), false)
  }
}
const overSharedLimit = sharedWindow()
const overFirstRunLimit = sharedWindow()
// First-register and first-run take one lock, so neither reads "nobody yet" while the other is
// making the first administrator.
const setupLock = sql`select pg_advisory_xact_lock(hashtext('mithaq.setup'))`

/**
 * One JSON line, in the shape of the backoffice's audit, for what the provider does where no kayan
 * logs it: a sign-up, a join, a first-run and a role given. Operators keep this output.
 */
const authAudit = (line: Record<string, unknown>) => console.log(JSON.stringify({ audit: 'auth', ...line, at: new Date().toISOString() }))

/**
 * Where the tenant app is served, the tenant instance's `baseURL` and the target of an
 * impersonation hand-off. Outside production it falls back to the `vite dev` port.
 */
export const tenantURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:5173'

// A browser isolates scripts by origin and sends cookies by host whatever the port, so the
// backoffice on a path or another port of the customer app's host would put staff sessions within
// reach of any script flaw in the customer app. Two subdomains are two hosts. Only this machine's
// development ports share one.
const [backofficeAt, tenantAt] = [URL.parse(backofficeURL), URL.parse(tenantURL)]
if (backofficeApp && backofficeAt && tenantAt && (backofficeAt.origin === tenantAt.origin || (backofficeAt.hostname === tenantAt.hostname && !isLocalHost(backofficeURL)))) {
  throw new Error(`BACKOFFICE_URL (${backofficeURL}) and BETTER_AUTH_URL (${tenantURL}) are served on one host, ${backofficeAt.hostname}. Serve the backoffice on a host of its own, such as backoffice.example.com beside app.example.com: browsers isolate scripts by origin and send cookies by host, so on one host a script flaw (XSS) in the customer app would reach staff sessions in the backoffice.`)
}

/**
 * The origins the backoffice instance trusts beside its own `baseURL`: the `vite dev` and `vite
 * preview` ports, outside production only.
 */
export const backofficeOrigins = production ? [] : ['http://localhost:4174', 'http://localhost:5174']

// Derived from the deployment secret and never equal to it, so a cookie one app signed fails
// verification in the other. The apps share one session table and never a session; a session
// crosses only through the one-time hand-off. The label keeps the console's old name, `platform`,
// so a deploy that renamed it derives the same secret and keeps what that secret signed.
const backofficeSecret = createHmac('sha256', secret ?? 'mithaq-development-only').update('mithaq-platform-session').digest('base64url')

/** The backoffice's session cookie name, `mithaq-backoffice.session_token`, beside the tenant's `better-auth.session_token`. */
export const backofficeCookiePrefix = 'mithaq-backoffice'

/**
 * Better Auth's own actions, which no kayan declares; `buildAsas` adds them to the catalog.
 *
 * `member` and `user` are each a provider resource and a generated kayan, so one key opens both
 * doors. They never meet while no auth kayan carries a tenant field. They cannot be renamed: the
 * provider's routes ask under these exact names.
 */
export const providerStatements = { ...defaultStatements, ...adminStatements }


// `APIError` makes the refusal the provider's own 403 rather than the 500 an unrecognised throw
// becomes.
const gate = (key: string) => async ({ organization }: { organization?: { [key: string]: unknown; id?: unknown } } = {}) => {
  sameOrganization(organization)
  if (holdsPermission(key)) return
  throw new APIError('FORBIDDEN', { message: `You do not hold the permission "${key}".` })
}

// `holdsPermission` answers with the caller's keys in their active organization, but a provider
// route that takes an `organizationId` in its body acts on that one. Refuse any other, or keys held
// in one organization would open another. Outside `asas.handler` nothing is resolved and the
// provider's own roles decide alone.
const sameOrganization = (organization?: { [key: string]: unknown; id?: unknown }) => {
  const active = requestOrganization()
  if (active === undefined || typeof organization?.id !== 'string' || organization.id === active) return
  throw new APIError('FORBIDDEN', { message: 'Your keys are your active organization\'s, and this action is in another. Make it the active organization first.' })
}

// The provider refuses only an `owner` invite from a non-owner, so without this an inviter could
// hand out `admin` with no `member.update`.
const invitedAs = (role: string) => {
  if (role.split(',').every((name) => name === 'member') || holdsPermission('member.update')) return
  throw new APIError('FORBIDDEN', { message: 'An invitation as anything but a member needs the permission "member.update".' })
}

// The provider checks an invitation's role names trimmed but stores the value as written, and its
// owner checks match untrimmed, so `member, owner` could slip past an inviter who may not invite an
// owner. Refuse whitespace and empty names.
const exactRoles = (role: unknown) => {
  if (typeof role === 'string' && role.split(',').every((name) => name !== '' && name === name.trim())) return
  throw new APIError('BAD_REQUEST', {
    code: 'error.invalid.member_role',
    message: `A role value holds exact role names, comma-joined, with no whitespace around a name and no empty one: ${JSON.stringify(role)}.`,
  })
}

/**
 * What the auth setup reads beyond the provider's own options: the organization mode and who may
 * join (`organizations.ts`), and the mailer that sends the password reset, the invitation and the
 * verification. The deploy names its mailer in `src/mail/index.ts`. Administrator password
 * delivery needs none; open sign-up still needs one for address proof.
 */
export type AuthSettings = {
  mailer: Mailer | undefined
  passwordDelivery: 'admin' | 'email'
  organizations: typeof organizations
  showOrganization: boolean
  signUp: typeof signUp
  joinRole: string | null
  verifyEmail: boolean
  allowedDomains: readonly string[]
  /** In `'one'`, the organization's name in each locale, which lives in code. */
  organizationName: Readonly<Record<string, string>>
}
const passwordDeliveryProblem = ({ passwordDelivery, verifyEmail }: Pick<AuthSettings, 'passwordDelivery' | 'verifyEmail'>) =>
  passwordDelivery === 'admin' && verifyEmail ? "passwordDelivery = 'admin' with verifyEmail = true cannot prove mailbox ownership. Set passwordDelivery = 'email', or verifyEmail = false." : undefined

export const authSettings: AuthSettings = { mailer: configuredMailer(), organizations, showOrganization, signUp, joinRole, verifyEmail, allowedDomains, organizationName, passwordDelivery }

/** An address as the provider's own sign-up takes one. */
const anAddress = z.email()

/** A lowercase ASCII host of two labels or more, which an `xn--` international one is. */
const host = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Whether `email`'s domain, taken after its last `@`, lowercased and turned into punycode as a URL
 * does, is one `allowed` names: equal to an entry, or under a `*.` entry's domain. Never a suffix
 * match, which lets `notexample.com` pass for `example.com`.
 */
export const domainAllowed = (email: string, allowed: readonly string[]) => {
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1) return false
  const written = email.slice(at + 1).toLowerCase()
  let domain: string
  try {
    domain = new URL(`http://${written}`).hostname
  } catch {
    return false
  }
  // A URL also decodes `%2e` and folds a fullwidth `ｅ` or `．` into ASCII, which no mail server
  // does, so the domain must read back as written: an international one does, a disguised one not.
  // One written in its `xn--` form, which the provider's address check asks of an international
  // domain, is its own reading.
  if (domainToUnicode(domain) !== written && domain !== written) return false
  return allowed.some((entry) => (entry.startsWith('*.') ? domain.endsWith(entry.slice(1)) : domain === entry))
}

/**
 * An organization's name as it is kept: one line of 1 to 100 characters. Anyone founds one with many
 * organizations, and its name goes into the plain text of every mail that names it, where a line
 * break would be the founder's own line.
 */
// Control characters (NEL among them), the line and paragraph separators, and the direction
// overrides and isolates, which would make a name read as other words than it holds.
export const oneLine = /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]+/gu
const asLine = (name: unknown) => (typeof name === 'string' ? name.replace(oneLine, ' ').replace(/ {2,}/g, ' ').trim() : '')
const badName = (message: string) => new APIError('BAD_REQUEST', { code: 'ORGANIZATION_NAME', message })
const oneLineName = (name: unknown) => {
  const line = asLine(name)
  if (!line || line.length > 100) throw badName('An organization has a name of 1 to 100 characters on one line.')
  return line
}
/** The locales an organization is named in: the project's own, as `organizationName` lists them. */
const nameLocales = Object.keys(organizationName)
/** Why `names` is no organization's names in every locale, the default's required, or nothing. */
const namesProblem = (names: Readonly<Record<string, unknown>>) => {
  const stray = Object.keys(names).filter((locale) => !nameLocales.includes(locale))
  if (stray.length) return `names ${stray.join(', ')}, which is none of the project's locales: ${nameLocales.join(', ')}.`
  if (!asLine(names[defaultLocale])) return `holds no name in ${defaultLocale}, the locale every other falls back to.`
  const long = Object.entries(names).find(([, one]) => asLine(one).length > 100)
  return long ? `holds a name in ${long[0]} past 100 characters.` : undefined
}
/**
 * An organization's names as they are kept: the JSON of one line of 1 to 100 characters per locale it is named in,
 * the default locale's required and the others left out where empty, and `name`, the default locale's. `written` is
 * the JSON a client sends, or the names themselves.
 */
export const namesOf = (written: unknown) => {
  let names: unknown = written
  if (typeof written === 'string') {
    try {
      names = JSON.parse(written)
    } catch {
      throw badName('An organization\'s names are a JSON object, one name per locale.')
    }
  }
  if (!names || typeof names !== 'object' || Array.isArray(names)) throw badName('An organization\'s names are a JSON object, one name per locale.')
  const problem = namesProblem(names as Record<string, unknown>)
  if (problem) throw badName(`An organization's names ${problem}`)
  const kept = Object.fromEntries(Object.entries(names).map(([locale, one]) => [locale, asLine(one)]).filter(([, one]) => one))
  return { name: kept[defaultLocale]!, names: JSON.stringify(kept) }
}
/** The names a create or a rename writes: from `names` where it carries them, else `name` as the default locale's. */
const named = (data: { name?: unknown; names?: unknown }) => {
  if (data.names !== undefined && data.names !== null) return namesOf(data.names)
  const name = oneLineName(data.name)
  return { name, names: JSON.stringify({ [defaultLocale]: name }) }
}
/**
 * Why `names`, the organization's name in code, does not name it in each of `locales`, the language's and no other,
 * the first required, or nothing. Every mode holds a founder's names to its locales and falls back to its first, so
 * the language checks it as it loads (`src/mithaq.ts`).
 */
export const organizationNameProblem = ({ names, locales }: { names: Readonly<Record<string, string>>; locales: readonly string[] }) => {
  const held = Object.keys(names)
  if (held.length !== locales.length || locales.some((one) => !held.includes(one))) return `organizationName names ${held.join(', ') || 'no locale'}, and the language reads ${locales.join(', ')}: name the organization in each, the first the one every other falls back to.`
  const problem = namesProblem(names)
  return problem && `organizationName ${problem}`
}
const nameInCode = () => new APIError('FORBIDDEN', { code: 'ORGANIZATION_NAME_IN_CODE', message: 'With one organization its name lives in code: organizationName in src/mithaq/auth/organizations.ts.' })

/**
 * A key no stranger who signs up is given: one that gives a role, writes a role, invites, or changes
 * the people or the organization. Reading them is not one.
 */
const grantsPower = (key: string) => /^(roles|member(Roles)?|invitation|ac|organization)\.(?!(find|findByID|count|read)$|fields\.)/.test(key)

/**
 * Every way `settings` means nothing or opens a door, one sentence each naming the line of
 * `organizations.ts` to change. `joinRoles` is the roles a joiner may be given, each with what it
 * holds (`null` without the roles add-on). `deployed` is a start anywhere but development on this
 * machine.
 */
export const settingsProblems = ({ settings, deployed, joinRoles }: { settings: AuthSettings; deployed: boolean; joinRoles: Readonly<Record<string, '*' | readonly string[]>> | null }) => {
  const { organizations, showOrganization, signUp, joinRole, verifyEmail, allowedDomains, mailer } = settings
  const problems: string[] = []
  const deliveryProblem = passwordDeliveryProblem(settings)
  if (deliveryProblem) problems.push(deliveryProblem)
  if (organizations === 'many') {
    if (!showOrganization) problems.push("organizations = 'many' takes showOrganization = true: a person who belongs to several switches between them by name.")
    if (signUp !== 'open') problems.push("organizations = 'many' takes signUp = 'open': each sign-up founds its own organization, and nobody joins one but by invitation.")
    if (joinRole !== null) problems.push("organizations = 'many' takes joinRole = null: nobody joins an organization there but by invitation.")
    // Anyone founds an organization there, so a sign-up that answered an address with an account
    // differently would tell anyone which addresses do, and an unproved account would keep one.
    if (!verifyEmail) problems.push("organizations = 'many' takes verifyEmail = true: every sign-up proves its address, so a sign-up tells nobody which addresses have an account and nobody keeps another's.")
    if (allowedDomains.length) problems.push("organizations = 'many' takes no allowedDomains: nobody joins an organization there but by invitation.")
  } else {
    problemsOfOne({ problems, signUp, verifyEmail, allowedDomains, joinRole, joinRoles })
  }
  // Address proof still needs mail; invitation-only administrator delivery does not.
  if (deployed && !mailer && (signUp === 'open' || settings.passwordDelivery === 'email')) problems.push('A start needs a mailer in production, which proves each address, sends each reset and mails each invitation: set RESEND_API_KEY and MAIL_FROM.')
  return problems
}
/** `settingsProblems` of one organization. */
const problemsOfOne = ({ problems, signUp, verifyEmail, allowedDomains, joinRole, joinRoles }: Omit<AuthSettings, 'passwordDelivery' | 'mailer' | 'organizations' | 'showOrganization' | 'organizationName'> & { problems: string[]; joinRoles: Readonly<Record<string, '*' | readonly string[]>> | null }) => {
  if (allowedDomains.length && signUp !== 'open') problems.push("allowedDomains is read only with signUp = 'open': empty it, or open the sign-up.")
  if (allowedDomains.length && !verifyEmail) problems.push('allowedDomains needs verifyEmail = true: an address nobody proved is any domain its writer wants.')
  for (const entry of allowedDomains) {
    if (!host.test(entry.startsWith('*.') ? entry.slice(2) : entry)) problems.push(`allowedDomains holds ${JSON.stringify(entry)}, which is no lowercase ASCII domain, or *. and one: write an international domain as its xn-- form.`)
  }
  const held = joinRole === null || joinRoles === null || !Object.hasOwn(joinRoles, joinRole) ? undefined : joinRoles[joinRole]!
  const powers = held === '*' ? ['every key'] : (held ?? []).filter(grantsPower)
  if (joinRole !== null && joinRoles === null) problems.push('joinRole is a role of the roles add-on, which this project does not hold: set joinRole = null, and a joiner holds the provider\'s member.')
  else if (joinRole !== null && held === undefined) problems.push(`joinRole names ${JSON.stringify(joinRole)}, which is none of roles/tenant-roles.ts: ${Object.keys(joinRoles!).join(', ')}.`)
  else if (powers.length) problems.push(`joinRole names ${JSON.stringify(joinRole)}, which holds ${powers.join(', ')}, and a stranger who signs up is never given a role that gives roles or invites.`)
}

// add-on: roles
const joinRoles: Record<string, '*' | readonly string[]> | null = Object.fromEntries(Object.entries(tenantRoles).map(([slug, role]) => [slug, (role as { permissions: '*' | readonly string[] }).permissions]))
// end add-on: roles
// without add-on: roles
// const joinRoles: Record<string, '*' | readonly string[]> | null = null
// end without add-on: roles
// Declaration checks also run during generation. Delivery credentials are checked at server start.
const settingsRefused = settingsProblems({ settings: authSettings, deployed: false, joinRoles })
if (settingsRefused.length) throw new Error(`src/mithaq/auth/organizations.ts: ${settingsRefused.join(' ')}`)

const escaped = (text: string) => text.replace(/[&<>"']/g, (one) => `&#${one.charCodeAt(0)};`)
/** A subject on one line: a line break in it would start a header of the writer's own. */
export const subjectLine = (subject: string) => subject.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim()
/**
 * One message in both of the project's locales, English then Arabic, since a mail is sent before
 * anyone says which they read. The link sits on a line of its own in each.
 */
const letter = ({ to, subject, en, ar, link }: { to: string; subject: string; en: string; ar: string; link: string }): Mail => ({
  to,
  subject: subjectLine(subject),
  text: `${en}\n\n${link}\n\n${ar}\n\n${link}\n`,
  html: `<p>${escaped(en)}</p><p><a href="${escaped(link)}">${escaped(link)}</a></p><div dir="rtl" lang="ar"><p>${escaped(ar)}</p><p><a href="${escaped(link)}">${escaped(link)}</a></p></div>`,
})

// The subject is fixed and only the body names the organization, escaped: its name is words an
// administrator wrote. With no organization shown, the invitation is to the app, as every page says.
// With many organizations anyone founds one and invites, so only an inviter whose own address is
// proved has an invitation mailed: nobody sends a stranger the project's mail from an address they
// do not hold. The inviter still copies the link from the Members page.
const invitationMail = ({ mailer, organizations, showOrganization }: { mailer: Mailer; organizations: AuthSettings['organizations']; showOrganization: boolean }) => async ({ id, email, organization, inviter }: { id: string; email: string; organization: { name: string; names?: unknown }; inviter: { user: { emailVerified?: boolean } } }) => {
  if (organizations === 'many' && !inviter.user.emailVerified) return
  const [en, ar] = showOrganization ? [nameIn(organization, 'en'), nameIn(organization, 'ar')] : ['this app', 'هذا التطبيق']
  await mailer.send(letter({
    to: email,
    subject: 'You are invited · لديك دعوة',
    en: `You are invited to join ${en}. Open the link below with this address to accept; it lasts 48 hours.`,
    ar: `أنت مدعو للانضمام إلى ${ar}. افتح الرابط أدناه بهذا العنوان لقبول الدعوة؛ وهو صالح 48 ساعة.`,
    link: new URL(`/auth/accept-invitation?id=${encodeURIComponent(id)}`, tenantURL).href,
  }))
}


/**
 * How many invitations one organization makes, whoever makes them, so no organization turns the
 * project's mailer into a flood: `perMinute` in any minute and `perDay` in any day.
 */
export const invitationLimits = { perMinute: 10, perDay: 100 }

/**
 * The provider's organization limits, each set here so none is a silent default of the provider's:
 * left unset, anyone signed in founds organizations without end, and an organization stops taking
 * members and listing them at 100.
 *
 * - `allowUserToCreateOrganization`: in `'many'`, sign-up founds each person's own organization. In
 *   `'one'` nobody founds one over HTTP; first-run makes the one on the server.
 * - `organizationLimit`: a person who belongs to this many organizations, however they joined, founds
 *   no more, so one account cannot fill the database with organizations. An invitation still adds
 *   them to more.
 * - `membershipLimit`: the members one organization holds, and the most `list-members` answers
 *   unasked; the Members page pages past it.
 * - `invitationLimit`: the pending invitations one organization holds.
 */
export const organizationLimitsFor = (mode: AuthSettings['organizations']) => ({
  allowUserToCreateOrganization: mode === 'many',
  organizationLimit: 5,
  // In `'one'` the one organization is every person of the app, so it takes members without end.
  // A function, so the provider's unasked member lists keep their own 100 rather than this.
  membershipLimit: mode === 'one' ? async () => Number.MAX_SAFE_INTEGER : 10_000,
  invitationLimit: 1_000,
})

// These options do not depend on this project's vocabulary, so `mithaq generate auth` reads the
// same schema the runtime builds.
//
// `beforeAddMember` is deliberately not gated. `addMember` has no HTTP route, and its other firing
// is inside `createOrganization`, where the creator is in no organization yet and holds no key, so
// gating it would make creating an organization impossible. `member.create` is left to the
// provider's static roles.
const organizationOptionsFor = ({ mailer, organizations, showOrganization }: AuthSettings) => ({
  ...organizationLimitsFor(organizations),
  // An organization's name in each locale of the project, the JSON `namesOf` writes; `name` is the default
  // locale's. `mithaq generate auth` writes it onto the organization kayan.
  // When each member was last seen in the organization, which the tenant's session hooks stamp and no caller writes.
  schema: { organization: { additionalFields: { names: { type: 'string', required: false } } }, member: { additionalFields: { lastSeenAt: { type: 'date', required: false, input: false } } } } as const,
  dynamicAccessControl: { enabled: true as const },
  // An organization that was ever used holds rows that cannot all be removed (an audit log,
  // settings, its last administrator), and every tenant key is `restrict`, so deletion is off over
  // HTTP.
  disableOrganizationDeletion: true,
  // Every invitation is mailed through the fixed letter, where a mailer exists.
  ...(mailer ? { sendInvitationEmail: invitationMail({ mailer, organizations, showOrganization }) } : {}),
  // The provider compares the invited address with the signed-in one on every invitation route.
  // `requireEmailVerificationOnInvitation` stays unset rather than `false`, so the provider asks
  // for a verified address only if invitation ids become guessable. An account made by invitation
  // is not verified, since holding the id is its proof, so asking for one would leave every
  // invitation unanswerable.
  organizationHooks: {
    beforeCreateOrganization: async ({ organization }: { organization: { name?: unknown; names?: unknown } & Record<string, unknown> }) => ({ data: { ...organization, ...named(organization) } }),
    beforeUpdateOrganization: async ({ organization }: { organization: { name?: unknown; names?: unknown } & Record<string, unknown> }) => {
      await gate('organization.update')({ organization })
      if (organization.name === undefined && organization.names === undefined) return undefined
      if (organizations === 'one') throw nameInCode()
      // A name alone renames the default locale's, and each other locale keeps its own.
      return { data: { ...organization, ...(organization.names === undefined ? { name: oneLineName(organization.name) } : namesOf(organization.names)) } }
    },
    beforeRemoveMember: gate('member.delete'),
    beforeUpdateMemberRole: async ({ newRole, organization }: { newRole: string; organization: { id: string } }) => {
      await gate('member.update')({ organization })
      exactRoles(newRole)
    },
    beforeCreateInvitation: async ({ invitation, organization }: { invitation: { role: string }; organization: { id: string } }) => {
      await gate('invitation.create')({ organization })
      exactRoles(invitation.role)
      invitedAs(invitation.role)
    },
    beforeAcceptInvitation: async ({ invitation }: { invitation: { role: string } }) => exactRoles(invitation.role),
    beforeCancelInvitation: gate('invitation.cancel'),
  },
})

// `'*'` is the plugin's `adminAc`, every action but `impersonate-admins`, so no backoffice
// administrator mimics another.
const adminAccess = createAccessControl(adminStatements)
const adminGrant = (permissions: '*' | readonly string[]) => {
  if (permissions === '*') return adminAc
  const grant: Record<string, string[]> = {}
  for (const key of permissions) {
    const [resource, action] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)]
    const actions: readonly string[] | undefined = Object.hasOwn(adminStatements, resource) ? adminStatements[resource as keyof typeof adminStatements] : undefined
    if (actions?.includes(action)) (grant[resource] ??= []).push(action)
  }
  return adminAccess.newRole(grant as Parameters<typeof adminAccess.newRole>[0])
}

// `adminRoles`, not `adminUserIds`: an id list in code is a secret in the repository that no audit
// trail records a change to, while a column is written like any other row and can be taken back
// without a deploy.
//
// `roles` is the backoffice roles and `user` only. The plugin's gate reads `roles`, so spreading its
// `defaultRoles` would make `user.role = 'admin'` a backoffice administrator this project never
// declared. `user` is the plugin's `userAc`, which holds no action, and is here because `set-role`
// refuses a name `roles` does not hold.
//
// `adminRoles` is every backoffice role. None holds `impersonate-admins`, so no staff member can be
// impersonated. A backoffice role holds nothing inside a tenant.
const adminOptions = {
  adminRoles: Object.keys(backofficeRoles),
  roles: {
    ...Object.fromEntries(Object.entries(backofficeRoles).map(([slug, role]) => [slug, adminGrant(role.permissions)])),
    user: userAc,
  },
}

// The backoffice screen's actions are the admin plugin's own routes, not this project's operations,
// so the audit step never sees them. Every `/admin/` route is audited here: one JSON line per
// successful call naming the actor, the real person behind an impersonated session, the route, the
// target and the role, never a password or other body field. With the audit-log add-on the
// impersonations, backoffice roles set and bans are rows of its staff history too
// (`recordBackoffice`); every other route is this output alone, so operators must retain it.
//
// The caller is read before the route runs because stopping an impersonation deletes the session
// that made the request.
const audited = (path: string) => path.startsWith('/admin/') || path === '/sign-out'
type Caller = { user: { id: string; email?: string; role?: unknown }; session: Record<string, unknown> } | null
const callers = new WeakMap<object, Caller>()
/** The person a route acts on, as they stood before it ran, which the history row names the role they held by. */
type Target = ({ email?: string; role?: string | null } & Record<string, unknown>) | null
const targets = new WeakMap<object, Target>()
/** The role a call writes, on `set-role` and `create-user` as `role` and on `update-user` and `create-user` as `data.role`. */
const roleOf = (body: { role?: unknown; data?: { role?: unknown } }) => body.role ?? body.data?.role
/** A global administrator promotion also spends organization-issued links before a later demotion. */
const cancelsStaffPasswordLinks = async (user: { id: string; role?: unknown }, context: HookContext | null) => {
  if (!context || !holdsRole(roleOf((context.body ?? {}) as { role?: unknown; data?: { role?: unknown } }), (role) => Object.hasOwn(backofficeRoles, role))) return
  const adapter = await getCurrentAdapter(context.context.adapter)
  await adapter.deleteMany({ model: 'verification', where: [{ field: 'value', value: user.id }, { field: 'identifier', operator: 'starts_with', value: 'reset-password:' }] })
}
/** Whether a provider `member.role` names the owner, matched exactly as the provider matches it. */
const isOwnerRole = (role: unknown) => typeof role === 'string' && role.split(',').includes('owner')
/** Whether a `user.role` value names a role `test` admits, read as the plugin reads it, comma-separated. */
const holdsRole = (role: unknown, test: (one: string) => boolean) => typeof role === 'string' && role.split(',').some((one) => test(one.trim()))
/**
 * The plugin's own permission for each admin route that acts on a person, as its routes ask it, so
 * it is asked before this hook or any plugin's judges the input. `stop-impersonating` and
 * `has-permission` ask none.
 */
const routePermissions: Record<string, Record<string, string[]> | undefined> = {
  '/admin/set-role': { user: ['set-role'] },
  '/admin/get-user': { user: ['get'] },
  '/admin/create-user': { user: ['create'] },
  '/admin/update-user': { user: ['update'] },
  '/admin/list-users': { user: ['list'] },
  '/admin/list-user-sessions': { session: ['list'] },
  '/admin/unban-user': { user: ['ban'] },
  '/admin/ban-user': { user: ['ban'] },
  '/admin/impersonate-user': { user: ['impersonate'] },
  '/admin/revoke-user-session': { session: ['revoke'] },
  '/admin/revoke-user-sessions': { session: ['revoke'] },
  '/admin/remove-user': { user: ['delete'] },
  '/admin/set-user-password': { user: ['set-password'] },
}
/** The key this project asks for each of the provider's role-writing routes. */
const roleWrites = new Map([
  ['/organization/create-role', 'ac.create'],
  ['/organization/update-role', 'ac.update'],
  ['/organization/delete-role', 'ac.delete'],
])
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]
type Members = { findMany<Row>(query: { model: string; where: { field: string; value: string | Date }[]; limit: number; sortBy: { field: string; direction: 'asc' | 'desc' } }): Promise<Row[]> }
/**
 * The organization a session opens in when nothing names one: the person's oldest membership,
 * usually the one they founded, so every sign-in lands in the same place. The adapter sorts by one
 * column, so memberships made in the same instant are read again and the first by id is taken.
 */
const oldestMembership = async ({ adapter, user }: { adapter: Members; user: string }) => {
  const [oldest] = await adapter.findMany<{ createdAt: Date; organizationId: string }>({ model: 'member', where: [{ field: 'userId', value: user }], limit: 1, sortBy: { field: 'createdAt', direction: 'asc' } })
  if (!oldest) return undefined
  const [first] = await adapter.findMany<{ organizationId: string }>({ model: 'member', where: [{ field: 'userId', value: user }, { field: 'createdAt', value: oldest.createdAt }], limit: 1, sortBy: { field: 'id', direction: 'asc' } })
  // A database timestamp finer than the adapter's date matches no row; the oldest stands then.
  return first?.organizationId ?? oldest.organizationId
}
// The provider's member reads take the organization by `organizationId` or by `organizationSlug`,
// the slug winning, so both are compared with the active organization.
const sameOrganizationNamed = async (ctx: HookContext) => {
  const { organizationId, organizationSlug } = (ctx.query ?? {}) as { organizationId?: unknown; organizationSlug?: unknown }
  sameOrganization({ id: organizationId })
  if (typeof organizationSlug !== 'string') return
  const named = await ctx.context.adapter.findOne<{ id: string }>({ model: 'organization', where: [{ field: 'slug', value: organizationSlug }] })
  sameOrganization({ id: named?.id })
}
/** The names of the organization `id`, one per locale, as a reader of an invitation sees them. */
const namesById = async (ctx: HookContext, id: unknown) => {
  const found = typeof id === 'string' ? await ctx.context.adapter.findOne<{ name: string; names?: unknown }>({ model: 'organization', where: [{ field: 'id', value: id }] }) : null
  return found ? Object.fromEntries(nameLocales.map((locale) => [locale, nameIn(found, locale)])) : undefined
}
// When a member was last seen is a column with a key of its own, so a caller who may list, change or remove members
// reads it only holding that key as well, as a managed read hides a column its key does not open. Every member row an
// answer carries, at any depth, loses it.
const unseen = <Answer,>(answer: Answer): Answer =>
  holdsPermission('member.fields.lastSeenAt') ? answer : JSON.parse(JSON.stringify(answer), (key, value) => (key === 'lastSeenAt' ? undefined : value))
const auditBefore = async (ctx: HookContext) => {
  // The provider hands any member every member's name, address, image, role and join date, and
  // anyone's role by `userId`, and these routes have no hook to gate. Only a caller who may read
  // members does, in the active organization alone. A caller's own role, asked with no `userId`,
  // stays open: every request's actor is read through it.
  //
  // The key is asked first, so a caller without it learns nothing of whether a slug names an
  // organization.
  if (ctx.path === '/organization/list-members' || (ctx.path === '/organization/get-active-member-role' && (ctx.query as { userId?: unknown } | undefined)?.userId !== undefined)) {
    await gate('member.find')()
    await sameOrganizationNamed(ctx)
  }
  // The full read's members are emptied afterwards for a caller who may not list them, so the
  // provider loads one rather than up to `membershipLimit`.
  if (ctx.path === '/organization/get-full-organization') {
    const mayList = await gate('member.find')().then(() => sameOrganizationNamed(ctx)).then(() => true, () => false)
    if (!mayList) return { context: { query: { ...(ctx.query as object | undefined), membersLimit: 1 } } }
  }
  // The provider lets any member list invitations, invitee emails among them, and this route has no
  // hook to gate. Only a caller who may invite reads them, in the active organization alone.
  if (ctx.path === '/organization/list-invitations') {
    sameOrganization({ id: (ctx.query as { organizationId?: unknown } | undefined)?.organizationId })
    await gate('invitation.create')()
  }
  // A rename takes an `organizationId` in its body, but its hook is handed the new data, which
  // carries no id, so the organization is compared here. A body naming none updates the active
  // organization and passes.
  if (ctx.path === '/organization/update') sameOrganization({ id: (ctx.body as { organizationId?: unknown } | undefined)?.organizationId })
  // The provider's `organizationRole` writes take an `organizationId` in their body and ask the
  // provider's own `ac` keys, which it answers from governance roles alone, so a governance admin
  // of another organization could write roles there with no key. Ask this project's keys instead,
  // in the active organization alone.
  const roleWrite = roleWrites.get(ctx.path)
  if (roleWrite) {
    sameOrganization({ id: (ctx.body as { organizationId?: unknown } | undefined)?.organizationId })
    await gate(roleWrite)()
  }
  if (!audited(ctx.path)) return
  const caller: Caller = await getSessionFromCtx(ctx).catch(() => null)
  callers.set(ctx.context, caller)
  // `/admin/has-permission` is excepted: it carries `role` to ask what that role may do and writes
  // nothing.
  const body = (ctx.body ?? {}) as Parameters<typeof roleOf>[0] & { userId?: unknown; banReason?: unknown; data?: { banned?: unknown; banReason?: unknown } }
  const acts = ctx.path.startsWith('/admin/') && ctx.path !== '/admin/has-permission'
  // Every route that names the person it acts on names them as `userId` in its body. Nobody acts on
  // their own row, and only a super admin acts on a staff member's.
  //
  // A caller with no session is left to the provider's own 401, so the answer never says whether an
  // id names staff.
  if (!acts || !caller) return
  // The route's own permission, asked as the plugin asks it, before any input is judged: a caller who
  // may not use the route learns nothing of what it takes.
  const asks = routePermissions[ctx.path]
  // The serving instance's own plugin roles, which a project's second instance may hold differently.
  const roles = (ctx.context.options.plugins?.find((one) => one.id === 'admin') as { options?: { roles?: Record<string, { authorize: (asked: typeof asks) => { success: boolean } } | undefined> } } | undefined)?.options?.roles ?? {}
  if (asks && !String(caller.user.role ?? 'user').split(',').some((one) => roles[one]?.authorize(asks).success)) {
    throw new APIError('FORBIDDEN', { message: 'This role may not use this route.' })
  }
  // Only a `super_admin` writes a role, on any route that takes one. The plugin already asks
  // `user.set-role` of these routes, which only `'*'` holds, but a project's own backoffice role
  // granted `user.update` must still write no role through `update-user`.
  const grants = holdsRole(caller.user.role, (one) => one === 'super_admin')
  if (roleOf(body) !== undefined && !grants && !firstRegistering.getStore()) throw new APIError('FORBIDDEN', { message: 'Only a backoffice administrator sets a role.' })
  // A ban needs a reason. The provider writes `data.banned` raw unless it is `=== true`, so a
  // non-boolean such as `'true'` would store a ban with no reason and end no session.
  const writes = ctx.path === '/admin/update-user' || ctx.path === '/admin/create-user'
  if (writes && body.data && Object.hasOwn(body.data, 'banned') && typeof body.data.banned !== 'boolean') {
    throw new APIError('BAD_REQUEST', { message: 'A ban is true or false.' })
  }
  const banning = ctx.path === '/admin/ban-user' ? body : writes && body.data?.banned === true ? body.data : undefined
  if (banning && (typeof banning.banReason !== 'string' || !banning.banReason.trim())) {
    throw new APIError('BAD_REQUEST', { message: 'A ban carries a reason.' })
  }
  if (body.userId === undefined) return
  const userId = String(body.userId)
  if (userId === caller.user.id) throw new APIError('FORBIDDEN', { message: 'Nobody acts on their own row on the backoffice.' })
  // The admin plugin's own `role` column, which the core user type does not name.
  const target = (await ctx.context.internalAdapter.findUserById(userId)) as Target
  targets.set(ctx.context, target)
  if (holdsRole(target?.role, (one) => Object.hasOwn(backofficeRoles, one)) && !grants) {
    throw new APIError('FORBIDDEN', { message: 'Only a backoffice administrator acts on a staff member.' })
  }
  // A role written as it already stands is answered and written nowhere, so the audit holds no line
  // for it.
  if (ctx.path === '/admin/set-role' && target && [body.role].flat().join(',') === (target.role ?? 'user')) return ctx.json({ user: target })
}
/**
 * One row of the staff history: an impersonation started or stopped, a backoffice role set and a
 * ban set or lifted, each person by id and by the address they had then.
 */
export type BackofficeEntry = {
  action: 'impersonate' | 'stopImpersonating' | 'setRole' | 'ban' | 'unban'
  actor: string | null
  actorEmail: string | null
  target: string | null
  targetEmail: string | null
  previousRole?: string | null
  role?: string | null
  banReason?: string | null
}

const textOf = (value: unknown) => (typeof value === 'string' ? value : null)

/** The history rows one successful admin route or impersonation-ending sign-out makes, none for any other. */
const historyOf = async (ctx: HookContext, caller: Caller): Promise<BackofficeEntry[]> => {
  if (!caller) return []
  const body = (ctx.body ?? {}) as Parameters<typeof roleOf>[0] & { userId?: unknown; banReason?: unknown; data?: { banned?: unknown; banReason?: unknown } }
  const before = targets.get(ctx.context)
  const made = (ctx.context.returned as { user?: { id?: unknown; email?: unknown } } | undefined)?.user
  const staff = { actor: caller.user.id, actorEmail: caller.user.email ?? null }
  const person = { target: textOf(body.userId) ?? textOf(made?.id), targetEmail: textOf(before?.email) ?? textOf(made?.email) }
  if (ctx.path === '/admin/impersonate-user') return [{ action: 'impersonate', ...staff, ...person }]
  // Ended from inside the impersonated session, whose person is the member: the staff member is the
  // one the session names as behind it.
  if (ctx.path === '/sign-out' || ctx.path === '/admin/stop-impersonating') {
    const behind = textOf(caller.session.impersonatedBy)
    if (!behind) return []
    const found = (await ctx.context.internalAdapter.findUserById(behind)) as Target
    return [{ action: 'stopImpersonating', actor: behind, actorEmail: textOf(found?.email), target: caller.user.id, targetEmail: caller.user.email ?? null }]
  }
  const entries: BackofficeEntry[] = []
  const role = roleOf(body)
  const previousRole = before?.role ?? null
  if (role !== undefined && [role].flat().join(',') !== (previousRole ?? 'user')) entries.push({ action: 'setRole', ...staff, ...person, previousRole, role: [role].flat().join(',') })
  const banned = ctx.path === '/admin/ban-user' ? true : ctx.path === '/admin/unban-user' ? false : body.data?.banned
  if (banned === true) entries.push({ action: 'ban', ...staff, ...person, banReason: textOf(ctx.path === '/admin/ban-user' ? body.banReason : body.data?.banReason) })
  if (banned === false && (ctx.path === '/admin/unban-user' || before?.banned === true)) entries.push({ action: 'unban', ...staff, ...person })
  return entries
}

/**
 * The hooks that audit the backoffice's routes. `record` writes each row of the staff history,
 * where the project keeps one, and its failure answers the route an error. Only an impersonation
 * fails closed: its row is written before the hand-off, so one no row records is one nobody can
 * use. A stop, a role set and a ban or its lifting are already committed by the provider when the
 * row fails; the route still answers an error and the line above stays the record of them.
 */
export const backofficeAuditOf = (record?: (entry: BackofficeEntry) => Promise<unknown>) => ({
  before: createAuthMiddleware(auditBefore),
  after: createAuthMiddleware(async (ctx) => {
    // `get-full-organization` also answers members and invitations, addresses among them, to any
    // member, so each is emptied unless the caller holds the key its own list route asks. The
    // organization itself stays readable to every member.
    const full = ctx.context.returned as { id?: unknown; members?: unknown; invitations?: unknown } | null | undefined
    if (ctx.path === '/organization/get-full-organization' && full && typeof full === 'object' && 'id' in full) {
      const holds = (key: string) => gate(key)({ organization: full }).then(() => true, () => false)
      const [mayInvite, mayList] = [await holds('invitation.create'), await holds('member.find')]
      return ctx.json(unseen({ ...full, ...(mayInvite ? {} : { invitations: [] }), members: mayList ? full.members : [] }))
    }
    // The provider hands the invitee the inviter's address, which the accept page never shows, and
    // an invitation is no reason to learn a member's address.
    const invitation = ctx.context.returned as { inviterEmail?: unknown; organizationId?: unknown } | null | undefined
    if (ctx.path === '/organization/get-invitation' && invitation && typeof invitation === 'object' && 'inviterEmail' in invitation) return ctx.json({ ...invitation, inviterEmail: '', organizationNames: await namesById(ctx, invitation.organizationId) })
    // The provider names an invitation's organization in the default locale alone, so each locale's is added.
    const invitations = ctx.context.returned as { organizationId?: unknown }[] | null | undefined
    if (ctx.path === '/organization/list-user-invitations' && Array.isArray(invitations)) return ctx.json(await Promise.all(invitations.map(async (one) => ({ ...one, organizationNames: await namesById(ctx, one.organizationId) }))))
    // Leaving the active organization leaves the session in none, where every read is refused,
    // so it opens the person's oldest remaining membership, as a new session would.
    const leaving = ctx.context.session
    if (ctx.path === '/organization/leave' && leaving && !(ctx.context.returned instanceof Error) && leaving.session.activeOrganizationId === (ctx.body as { organizationId?: unknown } | undefined)?.organizationId) {
      const next = await oldestMembership({ adapter: ctx.context.adapter as unknown as Members, user: leaving.user.id })
      if (next) await ctx.context.internalAdapter.updateSession(leaving.session.token, { activeOrganizationId: next })
    }
    const answered = ctx.context.returned
    if (ctx.path.startsWith('/organization/') && answered && typeof answered === 'object' && !(answered instanceof Error) && !(answered instanceof Response) && JSON.stringify(answered).includes('"lastSeenAt"')) return ctx.json(unseen(answered))
    if (!audited(ctx.path) || ctx.context.returned instanceof Error) return
    const caller = callers.get(ctx.context)
    // A sign-out is audited only where it ends an impersonation, which is how the tenant app stops
    // one: the provider's own stop route would put the staff member's session back under the tenant
    // app's cookie, which the tenant app refuses.
    if (ctx.path === '/sign-out' && !caller?.session.impersonatedBy) return
    const body = (ctx.body ?? {}) as { userId?: unknown; role?: unknown; data?: { role?: unknown } }
    const query = (ctx.query ?? {}) as { id?: unknown; userId?: unknown }
    // The person acted on: named in the body or the query, or made by the call, `create-user`'s.
    const target = body.userId ?? query.userId ?? query.id ?? (ctx.context.returned as { user?: { id?: unknown } } | undefined)?.user?.id
    const role = roleOf(body)
    console.log(JSON.stringify({
      audit: 'backoffice',
      action: ctx.path,
      actor: caller?.user.id ?? null,
      impersonatedBy: caller?.session.impersonatedBy ?? null,
      ...(target === undefined ? {} : { target }),
      ...(role === undefined ? {} : { role }),
      at: new Date().toISOString(),
    }))
    if (record) for (const entry of await historyOf(ctx, caller ?? null)) await record(entry)
    if (ctx.path === '/admin/impersonate-user' && ctx.context.newSession) return handOff(ctx)
    // Ending an impersonation sends the staff member back to the backoffice, whose session is still
    // theirs, not to the tenant's sign-in. The answer keeps the provider's `success` and the
    // cookies it cleared.
    if (ctx.path === '/sign-out') return ctx.json({ success: true, url: backofficeApp ? backofficeURL : tenantURL })
  }),
})

// The backoffice never writes the tenant app's cookie (two origins, two cookies), so an impersonation
// answers a one-time link into the tenant app, which trades it for the session under its own
// cookie.
//
// The token is stored the way the one-time-token plugin stores its own, because that plugin's
// `verifyOneTimeToken` consumes it: once, setting the session cookie of whichever instance served
// the verify. Every cookie the impersonation set is dropped from the answer, so the backoffice's own
// session is untouched.
const handOff = async (ctx: HookContext) => {
  const token = randomBytes(32).toString('base64url')
  await ctx.context.internalAdapter.createVerificationValue({
    value: ctx.context.newSession!.session.token,
    identifier: `one-time-token:${token}`,
    expiresAt: new Date(Date.now() + 3 * 60 * 1000),
  })
  ctx.context.responseHeaders?.delete('set-cookie')
  return ctx.json({ url: new URL(`/auth/handoff?token=${token}`, tenantURL).href })
}

// A session is made only for staff or for the person an impersonation mimics, which the provider
// makes with `impersonatedBy` set. Anyone else gets the provider's wrong-password refusal, the one
// its sign-in throws for an unknown address and a wrong password alike. The hook runs after the
// password was checked, so nobody learns which accounts exist or hold a password.
//
// Without the endpoint context there is no adapter to read the person with, so the session is
// refused. The read is the transaction's where one is open.
type SessionBefore = typeof options.databaseHooks.session.create.before
const staffSession = (next: SessionBefore): SessionBefore => async (session, context) => {
  const mimics = !!(session as { impersonatedBy?: unknown }).impersonatedBy
  const user = mimics || !context ? null : await (await getCurrentAdapter(context.context.adapter as never)).findOne<{ role?: unknown }>({ model: 'user', where: [{ field: 'id', value: session.userId }] })
  if (!mimics && !holdsRole(user?.role, (one) => Object.hasOwn(backofficeRoles, one))) {
    throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD)
  }
  return next(session, context)
}

/**
 * Called once by the provider inside `createOrganization`, with the organization and the member row
 * it made for the caller. The template uses it to give a new organization an administrator.
 */
export type AssignFirstRole = (data: {
  organization: { id: string } & Record<string, unknown>
  member: { id: string } & Record<string, unknown>
  user: { id: string } & Record<string, unknown>
}) => Promise<void>

/**
 * The organization hooks that need this project's store, which only the factory below holds. A
 * `beforeRemoveMember` or `beforeAcceptInvitation` here runs after the template's own, never in its
 * place. An invitation the server accepts for a sign-up, and a person Add person adds, run
 * `beforeAddMember` and no accept hook: the membership is made without the accept route.
 */
type Joining = { organization: { id: string } & Record<string, unknown> }
export type StoreHooks = {
  afterCreateOrganization?: AssignFirstRole
  beforeRemoveMember?: (data: Joining & { member: { userId: string } & Record<string, unknown> }) => Promise<void>
  beforeAcceptInvitation?: (data: Joining & { invitation: { role: string } & Record<string, unknown>; user: { id: string } & Record<string, unknown> }) => Promise<void>
  afterUpdateMemberRole?: (data: { member: { userId: string; role: string } }) => Promise<void>
  beforeAddMember?: (data: Joining & { member: { userId: string } & Record<string, unknown> }) => Promise<void>
  /** Writes one row of the staff history, which the audit-log add-on keeps. */
  recordBackoffice?: (entry: BackofficeEntry) => Promise<unknown>
}

/**
 * Parses `TRUSTED_IP_HEADER`, the header names this deployment's proxy overwrites with the real
 * client address (`cf-connecting-ip` behind Cloudflare, `x-forwarded-for` behind a reverse proxy
 * configured to overwrite it, comma-separated for several). It feeds Better Auth's
 * `advanced.ipAddress.ipAddressHeaders`.
 *
 * `undefined` when unset, so Better Auth keeps its default of `x-forwarded-for` alone. A header is
 * trustworthy only when the proxy overwrites it on every request; otherwise any caller picks its
 * own rate-limit bucket.
 */
export const trustedIpHeaders = (value: string | undefined): string[] | undefined => {
  const headers = value
    ?.split(',')
    .map((header) => header.trim())
    .filter(Boolean)
  return headers?.length ? headers : undefined
}

const ipAddressHeaders = trustedIpHeaders(process.env.TRUSTED_IP_HEADER)

// Password links go only to the selected delivery. They are never automatically logged.
//
// The link is the tenant app's reset page, not the provider's `url`, which names
// `/api/auth/reset-password` while this project serves the provider under `/api/auth/user`.
const onLocalHost = !production && isLocalHost(tenantURL)
// An address is proved by choosing the account's password from a link mailed to it: the reset
// page's link, which ends every session and marks the address verified. Proving it never keeps a
// password somebody else typed at sign-up, so whoever signed up first with another's address never
// signs in once its owner proves it.
// A first password is chosen on a page of its own, which names the account it is for; a forgotten one on the reset
// page. Both send the same token to the same route.
const setPasswordLink = (token: string) => new URL(`/auth/set-password?token=${encodeURIComponent(token)}`, tenantURL).href
// A link that also accepts an invitation names the organization, so opening it is the word to join.
const confirmMail = (mailer: Mailer) => async ({ email, token, joining }: { email: string; token: string; joining?: { name: string; names?: unknown } }) =>
  mailer.send(letter({
    to: email,
    subject: 'Confirm your address · تأكيد عنوانك',
    en: joining === undefined
      ? 'Someone made an account with this address. If it was you, open the link below within an hour to confirm it and choose your password. If not, ignore this message: an account nobody confirms never signs in.'
      : `Someone made an account with this address to join ${nameIn(joining, 'en')}. If it was you, open the link below within an hour to confirm it, choose your password and join. If not, ignore this message: an account nobody confirms never signs in.`,
    ar: joining === undefined
      ? 'أنشأ أحدهم حسابا بهذا العنوان. إن كنت أنت، فافتح الرابط أدناه خلال ساعة لتأكيده واختيار كلمة المرور. وإلا فتجاهل هذه الرسالة: الحساب الذي لا يؤكده أحد لا يسجل الدخول أبدا.'
      : `أنشأ أحدهم حسابا بهذا العنوان للانضمام إلى ${nameIn(joining, 'ar')}. إن كنت أنت، فافتح الرابط أدناه خلال ساعة لتأكيده واختيار كلمة المرور والانضمام. وإلا فتجاهل هذه الرسالة: الحساب الذي لا يؤكده أحد لا يسجل الدخول أبدا.`,
    link: setPasswordLink(token),
  }))

// The set-password link of a person an administrator added, which they open to choose their password.
const addedMail = ({ mailer, showOrganization }: { mailer: Mailer; showOrganization: boolean }) => async ({ email, organization, token }: { email: string; organization: { name: string; names?: unknown }; token: string }) => {
  const [en, ar] = showOrganization ? [nameIn(organization, 'en'), nameIn(organization, 'ar')] : ['this app', 'هذا التطبيق']
  await mailer.send(letter({
    to: email,
    subject: 'Your account · حسابك',
    en: `An administrator added you to ${en}. Open the link below to choose your password; it lasts 24 hours.`,
    ar: `أضافك أحد المسؤولين إلى ${ar}. افتح الرابط أدناه لاختيار كلمة المرور؛ وهو صالح 24 ساعة.`,
    link: setPasswordLink(token),
  }))
}

// The first administrator is made with no proof of the address, the setup code standing in for it, so the address
// is told once: whoever set the app up and typed it wrong notices the mail that never came.
const adminMadeMail = ({ mailer, email, at }: { mailer: Mailer; email: string; at: string }) =>
  mailer.send(letter({
    to: email,
    subject: 'Your administrator account · حساب المسؤول',
    en: 'An administrator account was made with this address. Sign in at the link below. If you did not expect this, ignore this message and tell whoever set up this app.',
    ar: 'أُنشئ حساب مسؤول بهذا العنوان. سجّل الدخول من الرابط أدناه. إن لم تكن تتوقع هذا، فتجاهل هذه الرسالة وأخبر من أعدّ هذا التطبيق.',
    link: new URL('/auth/sign-in', at).href,
  }))

const resetMail = (mailer: Mailer) => async ({ user, token }: { user: { email: string }; token: string }) =>
  mailer.send(letter({
    to: user.email,
    subject: 'Reset your password · إعادة تعيين كلمة المرور',
    en: 'Someone asked to reset the password of the account at this address. If it was you, open the link below within 24 hours. If not, ignore this message: nothing changes.',
    ar: 'طلب أحدهم إعادة تعيين كلمة مرور الحساب بهذا العنوان. إن كنت أنت، فافتح الرابط أدناه خلال 24 ساعة. وإلا فتجاهل هذه الرسالة: لن يتغير شيء.',
    link: new URL(`/auth/reset-password?token=${encodeURIComponent(token)}`, tenantURL).href,
  }))

/**
 * The Better Auth options, with no `database`: the strategy supplies the tables mithaq built.
 * `mithaq generate auth` reads this module to write the auth kayan.
 *
 * The hooks that write rows of this project (`StoreHooks`) are a parameter of `authOptions`
 * instead. A hook changes no table, so the schema read here is the schema the runtime builds.
 */
// Mail goes out after the answer, so how long an answer takes never says whether an address has an
// account, and a slow mailer holds up no request. Each send is kept until it settles, so a test or a
// shutdown can wait for what is still going out. The development log is written at once.
const background = new Set<Promise<unknown>>()
const inBackground = (promise: Promise<unknown>) => {
  background.add(promise)
  void promise.finally(() => background.delete(promise))
}
/** Resolves once every mail sent in the background has gone out or failed. */
export const backgroundSettled = async () => {
  while (background.size) await Promise.allSettled([...background])
}

export const optionsFor = (settings: AuthSettings) => {
  return ({
  // A reset ends every session of the account, in both apps, since they share one session table.
  emailAndPassword: {
    enabled: true as const,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 86_400,
    // Where a sign-up proves its address, an address with an account is answered with a made-up
    // user. The admin plugin gives a real one its role as it is written, not as a default the
    // made-up one reads, so without this the answer's `role` would say which addresses exist.
    customSyntheticUser: ({ coreFields, additionalFields, id }: { coreFields: Record<string, unknown>; additionalFields: Record<string, unknown>; id: string }) => ({ ...coreFields, ...additionalFields, role: 'user', id }),
    ...(settings.passwordDelivery === 'email' && settings.mailer ? { sendResetPassword: resetMail(settings.mailer) } : {}),
  },
  // The provider rate limits only when `NODE_ENV` is `production`, so a deploy that sets none would
  // answer every sign-in and reset request unlimited. Off a local host it limits whatever
  // `NODE_ENV` says.
  //
  // Invitations are mailed, so they are limited apart: ten a minute from one address, beside each
  // organization's own `invitationLimits`.
  rateLimit: { enabled: !onLocalHost, customRules: { '/organization/invite-member': { window: 60, max: invitationLimits.perMinute }, '/organization/add-person': { window: 60, max: invitationLimits.perMinute }, '/organization/send-password-link': { window: 60, max: invitationLimits.perMinute } } },
  // Better Auth reads it for the links it writes into mail and the origin it checks a request
  // against; without it every boot prints `Base URL is not set`.
  baseURL: tenantURL,
  // The origins a browser may carry a cookie of this project to: the template's `vite dev`, `vite
  // preview` and Next ports, outside production only. Better Auth adds `baseURL` itself. A project
  // that serves a mobile client adds its scheme here.
  trustedOrigins: production ? [] : ['http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173'],
  ...((ipAddressHeaders || (settings.mailer && settings.mailer !== logMailer)) && {
    advanced: {
      ...(ipAddressHeaders && { ipAddress: { ipAddressHeaders } }),
      ...(settings.mailer && settings.mailer !== logMailer && { backgroundTasks: { handler: inBackground } }),
    },
  }),
  // How an impersonation crosses from the backoffice app into the tenant app (`handOff`). The plugin
  // adds no table, and no client may mint a token over HTTP.
  plugins: [admin(adminOptions), organization(organizationOptionsFor(settings)), oneTimeToken({ disableClientRequest: true })],
  hooks: backofficeAuditOf(),
  // The active organization, set where the session is made. Every row this project reads is keyed
  // on it and the provider sets it only when an organization is created, so a user who signed in
  // held none and was refused every read. The user's oldest membership becomes active on a session
  // that names none; a session that names one is left alone.
  //
  // The read goes through `getCurrentAdapter`, the transaction's adapter where the provider opened
  // one: the base adapter would take a second pool client while the transaction holds the first,
  // and a full pool would wait on itself.
  databaseHooks: {
    user: { update: { after: cancelsStaffPasswordLinks } },
    session: {
      create: {
        before: async (
          session: { userId: string; activeOrganizationId?: string | null },
          context: { context: { adapter: { findOne: <Row>(query: { model: string; where: { field: string; value: string }[] }) => Promise<Row | null> } } } | null,
        ) => {
          if (session.activeOrganizationId || !context) return
          const organization = await oldestMembership({ adapter: await getCurrentAdapter(context.context.adapter as never), user: session.userId })
          return organization ? { data: { ...session, activeOrganizationId: organization } } : undefined
        },
      },
    },
  },
})
}
/** This project's options, which `mithaq generate auth` reads. */
export const options = optionsFor(authSettings)

/**
 * The same options with the provider's own access control built, which is what the template builds
 * its server from. It is a function because the roles are made from an `ac` that has to exist
 * first.
 *
 * The three built-in roles are the provider's defaults over the provider's own resources and grade
 * nothing of this project: what a member may do is the access target's answer, which reads the
 * project's own keys. A project narrows these where its own governance differs.
 */
export const authOptions = (hooks: StoreHooks = {}, settings: AuthSettings = authSettings) => {
  const options = optionsFor(settings)
  const organizationOptions = organizationOptionsFor(settings)
  // Only the provider's own vocabulary. Merging this project's catalog in would make the provider's
  // `owner` hold every project key before any role row was read, and a `roles` row could then widen
  // and never narrow. The provider gates its own actions; this project's keys are the access
  // target's.
  const ac = createAccessControl({ ...defaultStatements })
  // A role's type is a subset of the statements it was made from, and these are derived at runtime,
  // so what a role holds is only a string list here. The assertion is at the one line that crosses
  // that boundary.
  type Grant = Parameters<typeof ac.newRole>[0]
  const everything: Record<string, string[]> = Object.fromEntries(
    Object.entries(ac.statements).map(([resource, actions]) => [resource, [...(actions as readonly string[])]]),
  )
  const roles = {
    owner: ac.newRole(everything as Grant),
    admin: ac.newRole({
      ...everything,
      organization: (everything.organization ?? []).filter((one) => one !== 'delete'),
    } as Grant),
    member: ac.newRole({ ac: ['read'] }),
  }
  return {
    options: {
      ...options,
      // The same audit, writing each row of the staff history where the project keeps one.
      hooks: backofficeAuditOf(hooks.recordBackoffice),
      plugins: [
        // The same object as in `options`, so the schema `mithaq generate auth` reads is the schema
        // the runtime builds. Leaving it out of the rebuilt list would drop five columns from the
        // runtime that the generated kayan still describe.
        admin(adminOptions),
        oneTimeToken({ disableClientRequest: true }),
        organization({
          ...organizationOptions,
          organizationHooks: {
            ...organizationOptions.organizationHooks,
            // The project's own, written where the store is in hand: `providers.user.server`.
            ...hooks,
            beforeRemoveMember: async (data: Parameters<NonNullable<StoreHooks['beforeRemoveMember']>>[0]) => {
              await organizationOptions.organizationHooks.beforeRemoveMember(data)
              await hooks.beforeRemoveMember?.(data)
            },
            beforeAcceptInvitation: async (data: Parameters<NonNullable<StoreHooks['beforeAcceptInvitation']>>[0]) => {
              await organizationOptions.organizationHooks.beforeAcceptInvitation(data)
              await hooks.beforeAcceptInvitation?.(data)
            },
          },
          ac,
          roles,
        }),
      ],
    },
    roles,
  }
}

/**
 * Every Better Auth instance this project runs, one key per kayan it authenticates. `mithaq
 * generate auth` reads `options` to write that kayan's directory, and the generated kayan reads
 * `server` back, so one record is both halves of one instance.
 *
 * A second population is a second key here: a second kayan, cookie name and `/api/auth/<kayan>/*`
 * prefix. Its tables carry their own `modelName`, because one database holds them all.
 */
export const providers = {
  user: {
    options,
    /**
     * Built from the targets the language carries and the vocabulary the build derived. Neither
     * exists where a kayan is written, so this is a factory the kayan names.
     */
    server: (targets: ServerTargets, vocabulary: Pick<Vocabulary, 'referenced'>) => serverFor(authSettings)(targets, vocabulary),
  },
}

type ServerTargets = {
  drizzle: {
    db: Parameters<typeof drizzleAdapter>[0]
    tables: Record<string, unknown>
    insert(args: { tx: unknown; kayan: string; data: Record<string, unknown> }): Promise<unknown>
    remove(args: { tx: unknown; kayan: string; id: unknown }): Promise<unknown>
    find(args: { tx?: unknown; kayan: string; args: { limit: number; page: number; sort: { field: string; direction: 'asc' | 'desc' }; where?: Where; lock?: 'update' | 'share' } }): Promise<{ docs: Record<string, unknown>[] }>
    transaction<Result>(run: (tx: unknown) => Promise<Result>): Promise<Result>
    count?(args: { kayan: string; args: { where?: Where; lock?: 'update' | 'share' } }): Promise<number>
  }
}

// Generators build the provider too; only a serving host needs delivery credentials.
export const requireMailer = (settings: AuthSettings) => {
  if (!settings.mailer && settings.passwordDelivery === 'email') throw new Error('passwordDelivery is email: set RESEND_API_KEY and MAIL_FROM before starting the app.')
  if (!settings.mailer && settings.signUp === 'open' && (production || !isLocalHost(tenantURL))) throw new Error('A start needs a mailer in production: set RESEND_API_KEY and MAIL_FROM.')
}

/**
 * The provider for `settings`, which is this project's own in `providers.user.server`. A test builds
 * one for another organization mode over the same tables.
 */
export const serverFor = (settings: AuthSettings) => (targets: ServerTargets, { referenced }: Pick<Vocabulary, 'referenced'>) => {
  const deliveryProblem = passwordDeliveryProblem(settings)
  if (deliveryProblem) throw new Error(deliveryProblem)
  const store = targets.drizzle
  // add-on: roles
  // The drizzle store always counts; `Store` types it optional for stores that cannot.
  const heldRoles = (organization: string, user: string) => store.count!({ kayan: 'memberRoles', args: { where: { organization: { equals: organization }, user: { equals: user } } } })
  const holdsRoles = () => new APIError('CONFLICT', { code: 'error.conflict.member_holds_roles', message: 'This member still holds a role in this organization. Take each role from them first.' })
  // The roles a person holds in an organization they are not a member of, taken as they come
  // back in by an accepted invitation or an added membership: nobody gave them anew, and the
  // assignment guards never ran for whoever invited them back. Taken rather than refused,
  // because no screen reaches the roles of a non-member and a refusal would shut the person out
  // for good.
  const clearsLeftRoles = async ({ organization, user }: { organization: string; user: string }) => {
    // A current member left no organization: the provider runs this hook before it notices that
    // an old invitation or an added membership names a member already, and their roles are
    // theirs.
    if (await store.count!({ kayan: 'member', args: { where: { organizationId: { equals: organization }, userId: { equals: user } } } })) return
    if (!(await heldRoles(organization, user))) return
    await store.transaction(async (tx) => {
      const left = await store.find({ tx, kayan: 'memberRoles', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organization: { equals: organization }, user: { equals: user } } } })
      for (const row of left.docs) await store.remove({ tx, kayan: 'memberRoles', id: row.id })
    })
  }
  // end add-on: roles
  // add-on: roles
  // A role given by the auth setup itself, which nothing inside the project can give: straight
  // through the store rather than through `asas.kayan.memberRoles.operations.create`, which is
  // graded against the actor making it.
  const grantRole = async ({ tx, organization, user, role }: { tx: unknown; organization: string; user: string; role: string }) => {
    const written = new Date()
    await store.insert({ tx, kayan: 'memberRoles', data: { createdAt: written, role, organization, updatedAt: written, user } })
    authAudit({ action: 'role', user, organization, role })
  }
  // end add-on: roles
  // The hooks that write this project's rows, in their own transaction, or in `tx` where a route
  // that holds one makes the organization: a second client would wait on the rows it has not
  // committed.
  const storeHooks = (tx?: unknown): StoreHooks => ({
    afterUpdateMemberRole: async ({ member }) => {
      if (member.role.split(',').some((role) => role === 'admin' || role === 'owner')) {
        await (await getCurrentAdapter((await tenant.$context).adapter)).deleteMany({ model: 'verification', where: [{ field: 'value', value: member.userId }, { field: 'identifier', operator: 'starts_with', value: 'reset-password:' }] })
      }
    },
    // add-on: roles
    // The tenant's first assignment: a role holding `memberRoles.create` has to be assigned before
    // it can assign anything, and the caller of `createOrganization` is in no organization until
    // that route puts it in one. The row is `administrator`, which holds `'*'`, so the
    // organization has a root granter from its first moment and every later assignment is the
    // gated one.
    afterCreateOrganization: async ({ organization, user: creator }) => {
      const granted = { organization: organization.id, user: creator.id, role: 'administrator' }
      await (tx === undefined ? store.transaction((own) => grantRole({ tx: own, ...granted })) : grantRole({ tx, ...granted }))
    },
    // A member who still holds a role of this project in the organization is not removed. The
    // provider deletes the member row alone and leaves this project's rows behind, which are
    // read again the moment the person is a member again. Their roles are taken first, each
    // through the assignment kayan's own delete, whose guards decide whether this caller may
    // take that role. The Members page does that before removing, so a person sees this refusal
    // only where a role was given in between or the route was called by hand.
    //
    // Counted outside any transaction, so a role assigned between the count and the delete is
    // left behind; it is dormant while the person is no member and taken as they come back in
    // (`clearsLeftRoles`).
    beforeRemoveMember: async ({ member, organization }) => {
      if (await heldRoles(organization.id, member.userId)) throw holdsRoles()
    },
    beforeAcceptInvitation: ({ user, organization }) => clearsLeftRoles({ organization: organization.id, user: user.id }),
    beforeAddMember: ({ member, organization }) => clearsLeftRoles({ organization: organization.id, user: member.userId }),
    // end add-on: roles
    // add-on: audit-log
    // The staff history, straight through the store: the kayan declares no write a caller could run.
    recordBackoffice: (entry) => {
      const row = { kayan: 'backofficeLog', data: { createdAt: new Date(), ...entry } }
      return tx === undefined ? store.transaction((own) => store.insert({ tx: own, ...row })) : store.insert({ tx, ...row })
    },
    // end add-on: audit-log
  })
  const built = authOptions(storeHooks(), settings).options
  // `transaction: true` makes the provider's own transaction helper open a real transaction
  // wherever it asks for one: a sign-up writes its user, account and session in one, and an
  // accepted invitation its member and the session's organization. Without it each statement
  // runs on its own.
  const database = drizzleAdapter(store.db, { provider: 'pg', schema: store.tables, transaction: true })
  // Two instances over one database and one user table, one per app, so a person is one row and
  // one password in both. The tenant app's refuses every route of the admin plugin, and its
  // stop route, which would put a staff member's session back under the tenant app's cookie.
  // The plugin stays in it because it refuses a banned user a session and carries
  // `impersonatedBy` onto the session it reads.
  const tenantOnly = Object.values(admin(adminOptions).endpoints).map((endpoint) => endpoint.path)
  // add-on: roles
  // Leaving is refused while a role is held, as a removal is above. The provider's leave route
  // runs no hook, so it is matched by path, on both instances. A member who holds a
  // role-managing role takes it from nobody else, so leaves only once another member has taken
  // it from them. An owner who holds an `administrator` row never leaves and is never removed,
  // because that row cannot be taken (`error.forbidden.owner_role`); that is stricter than the
  // provider, which lets an owner go while another remains, and intended.
  const keepsRoles = {
    id: 'keeps-roles',
    hooks: { before: [{
      matcher: (ctx: { path?: string }) => ctx.path === '/organization/leave',
      handler: createAuthMiddleware(async (ctx) => {
        const organization = (ctx.body as { organizationId?: unknown } | undefined)?.organizationId
        const caller = await getSessionFromCtx(ctx).catch(() => null)
        if (typeof organization !== 'string' || !caller) return
        if (await heldRoles(organization, caller.user.id)) throw holdsRoles()
      }),
    }] },
  }
  // end add-on: roles
  // Whether anyone holds a backoffice role, read as `holdsRole` reads `user.role`: comma-separated,
  // each name trimmed of the whitespace `.trim()` takes. Every tenant user's `user` is passed
  // over before the split, and the scan stops at the first holder.
  type Executes = { execute(query: unknown): Promise<{ rows: unknown[] }> }
  const users = store.tables.user as { role: unknown }
  const administered = async (db: Executes) =>
    (await db.execute(sql`select 1 from ${users} where ${users.role} <> 'user' and exists (select 1 from unnest(string_to_array(${users.role}, ',')) as one where btrim(one, E' \\t\\n\\r\\f\\x0b') in ${Object.keys(backofficeRoles)}) limit 1`)).rows.length > 0
  const organizationTable = store.tables.organization as { id: unknown; createdAt: unknown; name: unknown; names: unknown }
  const organized = async (db: Executes) => (await db.execute(sql`select 1 from ${organizationTable} limit 1`)).rows.length > 0
  const oneOrganization = settings.organizations !== 'many'
  // With one organization its name lives in code, and the row takes it on the first request this process serves,
  // after the tables exist: a deploy that changed `organizationName` renames it, and nothing else does.
  let synced: Promise<void> | undefined
  const syncName = async () => {
    const { name, names } = namesOf(settings.organizationName)
    // The oldest row alone, the one `joinOpen` joins: a project that held many keeps every other's own name.
    const one = sql`(select ${organizationTable.id} from ${organizationTable} order by ${organizationTable.createdAt}, ${organizationTable.id} limit 1)`
    await (store.db as Executes).execute(sql`update ${organizationTable} set ${sql.identifier('name')} = ${name}, ${sql.identifier('names')} = ${names} where ${organizationTable.id} = ${one} and (${organizationTable.name} is distinct from ${name} or ${organizationTable.names} is distinct from ${names})`)
  }
  const namedInCode = {
    id: 'named-in-code',
    hooks: { before: [{
      matcher: () => oneOrganization,
      handler: createAuthMiddleware(async () => {
        await (synced ??= syncName().catch((error: unknown) => {
          // Asked again on the next request, so a database that was not ready yet is not left unnamed.
          synced = undefined
          console.error('The organization\'s name in code was not written onto its row:', error)
        }))
      }),
    }] },
  }
  // After the answer, and never failing it: the account is made and committed whatever the mailer says.
  const toldAdmin = async ({ ctx, email, at }: { ctx: HookContext; email: string; at: string }) => {
    if (!settings.mailer) return
    await ctx.context.runInBackgroundOrAwait(adminMadeMail({ mailer: settings.mailer, email, at }).catch((error: unknown) => console.error('The first administrator\'s mail was not sent:', error)))
  }
  // The tenant's first-run, in one organization: the first owner and the one organization,
  // which nothing else makes, under the lock first-register takes and the setup code. It makes
  // the owner backoffice staff too while the backoffice app is served and has none, so one person
  // sets up both. The account is verified: the setup code is the proof.
  const firstRunClosed = () => new APIError('FORBIDDEN', { code: 'FIRST_RUN_CLOSED', message: 'This app has its organization, so first-run is closed. Sign in instead.' })
  const firstRun = {
    id: 'first-run',
    endpoints: {
      firstRunState: createAuthEndpoint('/first-run/state', { method: 'GET' }, async (ctx) =>
        ctx.json((await organized(store.db as Executes)) ? { open: false } : { open: true, code: setupCodeState(tenantURL) })),
      // `formCsrfMiddleware`, as sign-up has: no session guards this route.
      firstRun: createAuthEndpoint('/first-run', { method: 'POST', use: [formCsrfMiddleware] }, async (ctx) => {
        if (!onLocalHost && !ipAddressHeaders && overFirstRunLimit()) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many tries. Wait a minute and try again.' })
        if (await organized(store.db as Executes)) throw firstRunClosed()
        const { name, email, password, code } = (ctx.body ?? {}) as Record<string, unknown>
        const refused = refusedSetup({ url: tenantURL, code, app: 'tenant app' })
        if (refused) throw refused
        const { minPasswordLength: min, maxPasswordLength: max } = ctx.context.password.config
        if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || typeof password !== 'string' || password.length < min || password.length > max) {
          throw new APIError('BAD_REQUEST', { message: `A name, an email and a password of ${min} to ${max} characters are required.` })
        }
        // The organization's name lives in code, so nobody who reaches a new deploy first names it.
        const inCode = namesOf(settings.organizationName)
        const made = await store.transaction(async (tx) => {
          await (tx as Executes).execute(sql`set transaction isolation level read committed`)
          await (tx as Executes).execute(setupLock)
          if (await organized(tx as Executes)) throw firstRunClosed()
          const staff = backofficeApp && !(await administered(tx as Executes))
          // ponytail: an instance per call over this transaction, as first-register's; it runs
          // once in a project's life.
          const bound = betterAuthServer({ ...authOptions(storeHooks(tx), settings).options, database: drizzleAdapter(tx as never, { provider: 'pg', schema: store.tables }) })
          const adapter = (await bound.$context).adapter
          return runWithAdapter(adapter, () => firstRegistering.run(true, async () => {
            const { user } = await bound.api.createUser({ body: { name, email, password, role: (staff ? 'super_admin' : 'user') as never, data: { emailVerified: true } } })
            const slug = !settings.showOrganization ? 'main' : `${inCode.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'organization'}-${randomBytes(3).toString('hex')}`
            const made = (await bound.api.createOrganization({ body: { name: inCode.name, names: inCode.names, slug, userId: user.id } as never }))!
            authAudit({ action: 'first-run', user: user.id, organization: made.id, backoffice: staff })
            return { user: { id: user.id }, organization: { id: made.id } }
          }))
        })
        await toldAdmin({ ctx, email, at: tenantURL })
        return ctx.json(made)
      }),
    },
    rateLimit: [{ pathMatcher: (path: string) => path === '/first-run', window: 60, max: 3 }],
  }
  // Whether `id` names a pending invitation, unexpired, sent to `email` as the provider compares
  // addresses, lowercased. The id is ~190 random bits, so holding it is the proof.
  type Finds = { findOne<Row>(query: { model: string; where: { field: string; value: string }[] }): Promise<Row | null> }
  const holdsInvitation = async ({ adapter, id, email }: { adapter: Finds; id: unknown; email: unknown }) => {
    if (typeof id !== 'string' || typeof email !== 'string') return false
    const invitation = await adapter.findOne<{ email: string; status: string; expiresAt: Date | string }>({ model: 'invitation', where: [{ field: 'id', value: id }] })
    return !!invitation && invitation.status === 'pending' && new Date(invitation.expiresAt) > new Date() && invitation.email.toLowerCase() === email.toLowerCase()
  }
  // One answer for every refused sign-up by invitation, so it tells nobody whether an address has
  // an account or an invitation.
  const inviteOnly = () => new APIError('FORBIDDEN', { code: 'SIGN_UP_INVITE_ONLY', message: 'Sign-up here is by invitation: open the link of the invitation sent to you.' })
  const outsideDomains = () => new APIError('FORBIDDEN', { code: 'SIGN_UP_DOMAIN', message: 'This address is not at a domain that may sign up here.' })
  // Who may make an account in one organization, asked before the provider's route, which
  // would answer an address that has an account differently from one that has none.
  const signUpGate = {
    id: 'sign-up-gate',
    hooks: { before: [{
      matcher: (ctx: { path?: string }) => ctx.path === '/sign-up/email',
      handler: createAuthMiddleware(async (ctx) => {
        if (!(await organized(store.db as Executes))) throw new APIError('FORBIDDEN', { code: 'FIRST_RUN_PENDING', message: 'This app is not set up yet: its administrator opens /auth/first-run first.' })
        const { email, invitationId } = (ctx.body ?? {}) as { email?: unknown; invitationId?: unknown }
        if (settings.signUp === 'invite' && !(await holdsInvitation({ adapter: ctx.context.adapter as unknown as Finds, id: invitationId, email }))) throw inviteOnly()
        if (settings.signUp === 'open' && settings.allowedDomains.length && !(typeof email === 'string' && domainAllowed(email, settings.allowedDomains))) throw outsideDomains()
      }),
    }] },
  }
  // The same rule wherever the tenant app makes an account, so a sign-in method added later
  // (social, a magic link, a one-time code) never opens a way past it. First-run holds
  // `firstRegistering`. The backoffice console's `/admin/create-user`, which only staff reach, makes
  // accounts on its own instance and is not asked: staff add whom they choose.
  const accountGate = async (user: { email: string }, context: { body?: unknown; context: { adapter: unknown } } | null) => {
    if (!oneOrganization || firstRegistering.getStore()) return
    if (settings.signUp === 'invite') {
      const invitationId = (context?.body as { invitationId?: unknown } | undefined)?.invitationId
      if (!context || !(await holdsInvitation({ adapter: (await getCurrentAdapter(context.context.adapter as never)) as unknown as Finds, id: invitationId, email: user.email }))) throw inviteOnly()
    } else if (settings.allowedDomains.length && !domainAllowed(user.email, settings.allowedDomains)) throw outsideDomains()
  }
  // Whether a new account proves its address before it signs in and joins: with many organizations
  // always, and with one where the sign-up is open and says so.
  const verifying = settings.signUp === 'open' && settings.verifyEmail
  // Who joins the one organization by signing up: in one organization with an open sign-up,
  // when the account is made or, where addresses are verified, when its address is proved. The
  // settings are read now, not at sign-up, so a project that closed its sign-up since joins nobody.
  // Backoffice staff join no tenant, and the domains are asked again. Someone who is a member, or holds
  // an invitation still to answer, is passed over: the invitation is how they join; and so is someone
  // who accepted one, who was a member, perhaps removed since. An account joins once in its life,
  // recorded beside it, so a removed member whose address is made unverified and proved again stays
  // out.
  const joinedOnce = (user: string) => `joined-open:${user}`
  const joinOpen = async (user: { id: string; email: string; role?: unknown }) => {
    // An account first-run or add-person makes is placed by them.
    if (!oneOrganization || settings.signUp !== 'open' || firstRegistering.getStore()) return
    if (holdsRole(user.role, (one) => Object.hasOwn(backofficeRoles, one))) return
    if (settings.allowedDomains.length && !domainAllowed(user.email, settings.allowedDomains)) return
    const { internalAdapter } = await tenant.$context
    // Staff links already name a member. Use the active adapter's marker before taking another pool client.
    if (await internalAdapter.findVerificationValue(joinedOnce(user.id))) return
    const [organization] = (await store.find({ kayan: 'organization', args: { limit: 1, page: 1, sort: { field: 'createdAt', direction: 'asc' } } })).docs
    if (!organization) return
    if (await store.count!({ kayan: 'member', args: { where: { userId: { equals: user.id } } } })) return
    // An invitation still to answer, or one accepted, is how this address joins; one cancelled,
    // declined or expired is none.
    const answering: Where = { or: [{ status: { equals: 'accepted' } }, { and: [{ status: { equals: 'pending' } }, { expiresAt: { greater_than: new Date() } }] }] }
    if (await store.count!({ kayan: 'invitation', args: { where: { and: [{ email: { equals: user.email.toLowerCase() } }, answering] } } })) return
    const joined = String(organization.id)
    // ponytail: the record is a verification row that never expires, the one table the provider
    // lets a project write a fact about an account to with no column of its own; a column on the
    // user, written by `generate auth`, if more such facts come. Never purge `joined-open:` rows:
    // without one, a removed member who resets their password joins again.
    await internalAdapter.createVerificationValue({ identifier: joinedOnce(user.id), value: joined, expiresAt: new Date('9999-12-31T00:00:00Z') })
    await tenant.api.addMember({ body: { userId: user.id, organizationId: joined, role: 'member' } })
    // add-on: roles
    if (settings.joinRole !== null) await store.transaction((tx) => grantRole({ tx, organization: joined, user: user.id, role: settings.joinRole! }))
    // end add-on: roles
    // A session made before the join names no organization, and every read would be refused in it.
    for (const one of await internalAdapter.listSessions(user.id)) {
      // The organization plugin's own column, which the core session type does not name.
      if (!(one as { activeOrganizationId?: string | null }).activeOrganizationId) await internalAdapter.updateSession(one.token, { activeOrganizationId: joined })
    }
    authAudit({ action: 'join', user: user.id, organization: joined, role: settings.joinRole })
  }
  // The invitation a sign-up carried is accepted for the account it made: at once where holding the id
  // is the proof, or, where the address is proved, by the one link mailed for that sign-up alone. The
  // binding is `invited:<that link's token>` and names the account, so anyone who signs up with an
  // address they invited, before its owner, never joins the owner to their organization: the owner's
  // own sign-up or reset takes every binding off, and their own link carries none. It is read again
  // when accepted, so one cancelled, expired or sent to another address joins nobody.
  const bound = (token: string) => `invited:${token}`
  const acceptCarried = async ({ user, invitationId }: { user: { id: string; email: string }; invitationId: unknown }) => {
    const { adapter, internalAdapter } = await tenant.$context
    if (!(await holdsInvitation({ adapter: adapter as unknown as Finds, id: invitationId, email: user.email }))) return
    const id = invitationId as string
    // The accept route's own rule on the role, which a row written past the invite route may break.
    const asked = await adapter.findOne<{ role: unknown }>({ model: 'invitation', where: [{ field: 'id', value: id }] })
    try {
      exactRoles(asked?.role)
    } catch {
      return
    }
    // Pending to accepted once, so a second proof never adds the person twice.
    const accepted = await adapter.update<{ organizationId: string; role: string }>({ model: 'invitation', where: [{ field: 'id', value: id }, { field: 'status', value: 'pending' }], update: { status: 'accepted' } })
    if (!accepted) return
    // Put back as the provider's own accept puts it back, so a refused membership leaves the
    // invitation to answer.
    await tenant.api.addMember({ body: { userId: user.id, organizationId: accepted.organizationId, role: accepted.role as 'member' } }).catch(async (error: unknown) => {
      await adapter.update({ model: 'invitation', where: [{ field: 'id', value: id }], update: { status: 'pending' } })
      throw error
    })
    // A session made before the acceptance names no organization, and every read would be refused in it.
    for (const one of await internalAdapter.listSessions(user.id)) {
      if (!(one as { activeOrganizationId?: string | null }).activeOrganizationId) await internalAdapter.updateSession(one.token, { activeOrganizationId: accepted.organizationId })
    }
    authAudit({ action: 'accept', user: user.id, organization: accepted.organizationId, invitation: id })
  }
  const bindings = (user: string) => [{ field: 'identifier', operator: 'starts_with' as const, value: 'invited:' }, { field: 'value', operator: 'starts_with' as const, value: `${user} ` }]
  const unbind = async (user: string) => (await getCurrentAdapter((await tenant.$context).adapter)).deleteMany({ model: 'verification', where: bindings(user) })
  // `token` is the link the address was proved with: only its own binding is accepted.
  const acceptBound = async ({ user, token }: { user: { id: string; email: string }; token: unknown }) => {
    const { internalAdapter } = await tenant.$context
    const held = typeof token === 'string' ? await internalAdapter.findVerificationValue(bound(token)) : null
    await unbind(user.id)
    const [owner, invitationId] = held?.value.split(' ') ?? []
    if (owner === user.id) await acceptCarried({ user, invitationId })
  }
  // Whether the account was mailed a link to choose its password in the last five minutes, other
  // than `except`: that one still works, so nobody fills a mailbox by asking again and again.
  const resetLinks = [{ field: 'identifier', operator: 'starts_with' as const, value: 'reset-password:' }]
  const mailedLately = async (user: string, except?: string) => {
    const rows = await (await tenant.$context).adapter.findMany<{ identifier: string; createdAt: Date | string }>({ model: 'verification', where: [{ field: 'value', value: user }, ...resetLinks] })
    return rows.some((row) => row.identifier !== `reset-password:${except}` && Date.now() - new Date(row.createdAt).getTime() < 5 * 60 * 1000)
  }
  // The set-password link that proves an address, stored as the provider stores a reset's, so the
  // reset page and route answer it. Address confirmation lasts an hour; password resets last 24.
  const confirmLink = async (user: { id: string; email: string }) => {
    if (!settings.mailer || (await mailedLately(user.id))) return
    const { adapter, internalAdapter } = await tenant.$context
    const token = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    await internalAdapter.createVerificationValue({ identifier: `reset-password:${token}`, value: user.id, expiresAt })
    // The invitation this sign-up carried rides on this link alone.
    const asked = tryGetCurrentAuthEndpointContext()
    const invitationId = asked?.path === '/sign-up/email' ? (asked.body as { invitationId?: unknown } | undefined)?.invitationId : undefined
    let joining: { name: string; names?: unknown } | undefined
    if (await holdsInvitation({ adapter: adapter as unknown as Finds, id: invitationId, email: user.email })) {
      await internalAdapter.createVerificationValue({ identifier: bound(token), value: `${user.id} ${invitationId as string}`, expiresAt })
      const invitation = await adapter.findOne<{ organizationId: string }>({ model: 'invitation', where: [{ field: 'id', value: invitationId as string }] })
      joining = (await adapter.findOne<{ name: string; names?: unknown }>({ model: 'organization', where: [{ field: 'id', value: invitation!.organizationId }] })) ?? undefined
    }
    await confirmMail(settings.mailer)({ email: user.email, token, ...(joining !== undefined && { joining }) })
  }
  // Every invitation an organization mails, new or sent again, and every person it adds, is one
  // `mailed:<organization>` row, written once the request succeeds and counted against
  // `invitationLimits` before the next goes, so every process of the deploy keeps one count and a
  // refused request spends nothing.
  // ponytail: two at the same instant may both pass the last place; a lock per organization if that
  // is ever seen.
  const withinLimits = async (organization: string) => {
    const since = (ago: number) => store.count!({ kayan: 'verification', args: { where: { value: { equals: `mailed:${organization}` }, createdAt: { greater_than: new Date(Date.now() - ago) } } } })
    if ((await since(60_000)) >= invitationLimits.perMinute) throw new APIError('TOO_MANY_REQUESTS', { code: 'INVITATIONS_PER_MINUTE', message: `This organization has sent ${invitationLimits.perMinute} invitations in the last minute. Wait a minute and try again.` })
    if ((await since(86_400_000)) >= invitationLimits.perDay) throw new APIError('TOO_MANY_REQUESTS', { code: 'INVITATIONS_PER_DAY', message: `This organization has sent ${invitationLimits.perDay} invitations in the last day. Try again tomorrow.` })
  }
  const mailedFor = async (organization: string) =>
    (await tenant.$context).internalAdapter.createVerificationValue({ identifier: `mailed:${randomBytes(16).toString('base64url')}`, value: `mailed:${organization}`, expiresAt: new Date(Date.now() + 86_400_000) })
  // The organization an invitation is made in, where the caller may invite there: the active one, as
  // every key of theirs is.
  const invitingIn = async (ctx: HookContext) => {
    const caller = await getSessionFromCtx(ctx).catch(() => null)
    const named = (ctx.body as { organizationId?: unknown } | undefined)?.organizationId ?? (caller?.session as { activeOrganizationId?: unknown } | undefined)?.activeOrganizationId
    const active = requestOrganization()
    return caller && typeof named === 'string' && (active === undefined || active === named) && holdsPermission('invitation.create') ? named : undefined
  }
  // The provider's invite route sends an invitation again on `resend` with no hook of its own, which
  // its governance `admin` passes holding no key of this project's, so the route itself asks the
  // key and the limits.
  const invitationLimit = {
    id: 'invitation-limit',
    hooks: {
      before: [{
        matcher: (ctx: { path?: string }) => ctx.path === '/organization/invite-member',
        handler: createAuthMiddleware(async (ctx) => {
          const organization = await invitingIn(ctx)
          if (organization) return withinLimits(organization)
          if ((ctx.body as { resend?: unknown } | undefined)?.resend) throw new APIError('FORBIDDEN', { message: 'Sending an invitation again needs the permission "invitation.create" in your active organization.' })
        }),
      }],
      after: [{
        matcher: (ctx: { path?: string }) => ctx.path === '/organization/invite-member',
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.context.returned instanceof Error) return
          const organization = await invitingIn(ctx)
          if (organization) await mailedFor(organization)
        }),
      }],
    },
  }
  // The only owner of an organization is not deleted, by staff or by themselves: the provider would
  // take their member row with them and leave an organization nobody governs. Asked before the route,
  // which deletes sessions and accounts before the person, so nothing goes. Another owner first.
  const soleOwner = async (user: string) => {
    const owned = (await store.find({ kayan: 'member', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { userId: { equals: user }, role: { contains: 'owner' } } } })).docs.filter((one) => isOwnerRole(one.role))
    // ponytail: read with no lock, so two owners deleted at the same instant may both pass and leave
    // none; a lock per organization if staff ever do that.
    for (const one of owned) {
      const owners = (await store.find({ kayan: 'member', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organizationId: { equals: String(one.organizationId) }, role: { contains: 'owner' } } } })).docs.filter((other) => isOwnerRole(other.role))
      if (owners.length < 2) return true
    }
    return false
  }
  // A person a row still names through a relationship that restricts their delete, a withdrawn seat
  // among them, is not deleted either. The provider's delete runs in no transaction, so the key alone
  // would fail after the person's sessions and accounts were gone, leaving someone who can never sign
  // in again. The count reads every organization's rows, marked ones included.
  const keepsPerson = {
    id: 'keeps-person',
    hooks: { before: [{
      matcher: (ctx: { path?: string }) => ['/admin/remove-user', '/delete-user', '/delete-user/callback'].includes(ctx.path ?? ''),
      handler: createAuthMiddleware(async (ctx) => {
        const caller = await getSessionFromCtx(ctx).catch(() => null)
        if (!caller) return
        // The id read the way the route reads it, after its own `z.coerce.string()`, so an id sent
        // as a list or a number is the same person here as there.
        const raw = ctx.path === '/admin/remove-user' ? (ctx.body as { userId?: unknown } | undefined)?.userId : caller.user.id
        if (raw === undefined || raw === null) return
        if (await soleOwner(String(raw))) {
          throw new APIError('CONFLICT', { code: 'error.conflict.sole_owner', message: 'This person is the only owner of an organization, so they are not deleted. Make another member its owner first.' })
        }
        if (await referenced(String(raw))) {
          throw new APIError('CONFLICT', { code: 'error.conflict.referenced', message: 'Rows still name this person, a seat among them, so they are not deleted while those rows stand.' })
        }
      }),
    }] },
  }
  // add-on: roles
  // Whether the caller may hand over `role` in `organization`, measured as `assignableRole` measures
  // an assignment: a root granter any role, anyone else one whose every key they hold.
  const assignable = async ({ organization, role }: { organization: string; role: string }) => {
    const custom = async () => (await store.find({ kayan: 'roles', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organization: { equals: organization }, name: { equals: role } } } })).docs[0]?.permissions as readonly string[] | undefined
    const keys = Object.hasOwn(tenantRoles, role) ? (tenantRoles[role as keyof typeof tenantRoles] as { permissions: '*' | readonly string[] }).permissions : await custom()
    if (keys === undefined) throw new APIError('BAD_REQUEST', { code: 'error.invalid.role', message: `Role "${role}" is none of this organization's.` })
    if (holdsPermission('memberRoles.create') && (holdsPermission('*') || (keys !== '*' && keys.every((key) => key !== '*' && holdsPermission(key))))) return
    throw new APIError('FORBIDDEN', { code: 'error.forbidden.assign', message: `You may not give role "${role}": it holds keys you do not hold.` })
  }
  // end add-on: roles
  // without add-on: roles
  // const assignable = async (_: { organization: string; role: string }) => {
  //   throw new APIError('BAD_REQUEST', { message: 'A role is given on adding a person with the roles add-on alone.' })
  // }
  // end without add-on: roles
  // An existing account is invited and keeps its credential. New staff, their origin and their
  // first link commit together, so a refused grant cannot leave a later-adoptable account behind.
  // The tenant instance's own routes, typed here so the route below, which the instance holds, does
  // not make the instance's type depend on itself.
  type Invites = { createInvitation(args: { body: Record<string, unknown>; headers: Headers }): Promise<unknown>; addMember(args: { body: { userId: string; organizationId: string; role: 'member' } }): Promise<unknown> }
  const tenantApi = (): Invites => tenant.api as unknown as Invites
  const addPerson = {
    id: 'add-person',
    endpoints: {
      addPerson: createAuthEndpoint('/organization/add-person', { method: 'POST', use: [sessionMiddleware] }, async (ctx) => {
        const organization = requestOrganization()
        // Outside `asas.handler` no key is resolved, so the route answers nothing there.
        if (typeof organization !== 'string' || !holdsPermission('member.create')) throw new APIError('FORBIDDEN', { message: 'Adding a person needs the permission "member.create" in your active organization.' })
        const { name, email: written, role } = (ctx.body ?? {}) as Record<string, unknown>
        if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof written !== 'string' || !anAddress.safeParse(written.trim()).success || (role !== undefined && (typeof role !== 'string' || !role))) {
          throw new APIError('BAD_REQUEST', { message: 'A name of 1 to 100 characters and an email are required, and a role, where given, is a role\'s name.' })
        }
        if (typeof role === 'string') await assignable({ organization, role })
        const email = written.trim().toLowerCase()
        const { adapter, internalAdapter } = ctx.context
        const found = (await internalAdapter.findUserByEmail(email))?.user as ({ id: string; emailVerified: boolean; role?: unknown } | undefined)
        if (found && (await store.count!({ kayan: 'member', args: { where: { organizationId: { equals: organization }, userId: { equals: found.id } } } }))) {
          throw new APIError('CONFLICT', { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', message: 'This person is already a member.' })
        }
        // Staff hold the backoffice, so a tenant never touches their sign-in.
        if (found) {
          const invitation = await tenantApi().createInvitation({ body: { email, role: 'member', organizationId: organization }, headers: ctx.headers! })
          return ctx.json({ invited: true, invitation })
        }
        if (settings.passwordDelivery === 'email' && settings.mailer) await withinLimits(organization)
        const authority = await passwordAuthority(ctx)
        const { user, issued } = await store.transaction(async (tx) => {
          const bound = betterAuthServer({ ...built, database: drizzleAdapter(tx as never, { provider: 'pg', schema: store.tables, transaction: false }) })
          const { adapter, internalAdapter } = await bound.$context
          return runWithAdapter(adapter, () => firstRegistering.run(true, async () => {
            const user = await internalAdapter.createUser({ name: name.trim(), email, emailVerified: false }, { method: 'admin' })
            await (bound.api as unknown as Invites).addMember({ body: { userId: user.id, organizationId: organization, role: 'member' } })
            // A removal must not let an open sign-up join again later.
            await internalAdapter.createVerificationValue({ identifier: joinedOnce(user.id), value: organization, expiresAt: new Date('9999-12-31T00:00:00Z') })
            // add-on: roles
            if (typeof role === 'string') await grantRole({ tx, organization, user: user.id, role })
            // end add-on: roles
            await internalAdapter.createVerificationValue({ identifier: `password-origin:${user.id}`, value: organization, expiresAt: new Date('9999-12-31T00:00:00Z') })
            if (!authority.superAdmin && !(await passwordAccount({ tx, user: user.id, organization, privileged: authority.privileged }))) throw new APIError('FORBIDDEN', { message: 'Only owners and super admins issue links for administrators.' })
            const issued = await issuePassword({ user: user.id, email: settings.passwordDelivery === 'email', ...(authority.superAdmin ? {} : { organization, privileged: authority.privileged }) })
            return { user, issued }
          }))
        })
        authAudit({ action: 'add-person', actor: ctx.context.session?.user.id ?? null, user: user.id, organization, role: role ?? null })
        let emailFailed = false
        if (settings.passwordDelivery === 'email' && settings.mailer) {
          const held = (await adapter.findOne<{ name: string; names?: unknown }>({ model: 'organization', where: [{ field: 'id', value: organization }] }))!
          try {
            await addedMail({ mailer: settings.mailer, showOrganization: settings.showOrganization })({ email, organization: held, token: issued.mailToken! })
            await mailedFor(organization)
          } catch { emailFailed = true }
        }
        ctx.setHeader('cache-control', 'no-store')
        ctx.setHeader('referrer-policy', 'no-referrer')
        return ctx.json({ added: true, user: { id: user.id }, emailFailed, link: setPasswordLink(issued.token), expiresAt: issued.expiresAt })
      }),
    },
  }
  // The origin survives ordinary verification cleanup. Only creation of a new account writes it;
  // membership alone never gives an organization authority over a global credential.
  const passwordRows = (user: string) => [{ field: 'value', value: user }, ...resetLinks]
  const passwordTx = new AsyncLocalStorage<unknown>()
  const passwordAccount = async ({ tx, user, organization, privileged }: { tx?: unknown; user: string; organization: string; privileged: boolean }) => {
    const readTx = tx ?? passwordTx.getStore()
    const { adapter: fallback, internalAdapter } = await tenant.$context
    const adapter = await getCurrentAdapter(fallback)
    const account = await internalAdapter.findUserById(user)
    const members = await adapter.findMany<{ organizationId: string; role: string }>({ model: 'member', where: [{ field: 'userId', value: user }] })
    const origin = await internalAdapter.findVerificationValue(`password-origin:${user}`)
    if (!account || members.length !== 1 || members[0]?.organizationId !== organization || (!origin || origin.value !== organization || !(new Date(origin.expiresAt).getTime() > Date.now())) || holdsRole((account as { role?: unknown }).role, (role) => Object.hasOwn(backofficeRoles, role))) return false
    if (privileged) return true
    if (members[0].role.split(',').some((role) => role === 'owner' || role === 'admin')) return false
    // add-on: roles
    const assignments = await store.find({ tx: readTx, kayan: 'memberRoles', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organization: { equals: organization }, user: { equals: user } } } })
    for (const assignment of assignments.docs) {
      const role = String(assignment.role)
      const keys = Object.hasOwn(tenantRoles, role) ? tenantRoles[role as keyof typeof tenantRoles].permissions : (await store.find({ tx: readTx, kayan: 'roles', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { organization: { equals: organization }, name: { equals: role } } } })).docs[0]?.permissions
      if (keys === '*' || (Array.isArray(keys) && managesRoles(keys))) return false
    }
    // end add-on: roles
    return true
  }
  const issuePassword = async ({ user, organization, privileged = true, email = false }: { user: string; organization?: string; privileged?: boolean; email?: boolean }) => {
    const prefix = organization ? `org.${Buffer.from(organization).toString('base64url')}.${privileged ? 'owner' : 'member'}.` : 'admin.'
    const token = `${prefix}${randomBytes(32).toString('base64url')}`
    // Copy must never reveal, or allow deriving, the bearer that proves mailbox ownership.
    const mailToken = email ? `mail.${prefix}${randomBytes(32).toString('base64url')}` : undefined
    const expiresAt = new Date(Date.now() + 86_400_000)
    const { adapter: fallback, internalAdapter } = await tenant.$context
    const adapter = await getCurrentAdapter(fallback)
    try {
      await adapter.deleteMany({ model: 'verification', where: passwordRows(user) })
      for (const bearer of [token, ...(mailToken ? [mailToken] : [])]) await internalAdapter.createVerificationValue({ identifier: `reset-password:${bearer}`, value: user, expiresAt })
    } catch {
      // Adapter errors can carry bound token values. Hand the provider a safe refusal to log.
      throw new APIError('INTERNAL_SERVER_ERROR', { message: 'No password link was issued.' })
    }
    return { token, mailToken, expiresAt }
  }
  const passwordLock = async <Result,>({ user, run }: { user: string; run: (tx: unknown) => Promise<Result> }) => store.transaction(async (tx) => {
    // An inserted membership takes a user FK key-share lock. Holding this row for the whole
    // credential write closes the gap between the origin check and token consumption.
    await store.find({ tx, kayan: 'user', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { id: { equals: user } }, lock: 'update' } })
    await store.find({ tx, kayan: 'member', args: { limit: 0, page: 1, sort: { field: 'id', direction: 'asc' }, where: { userId: { equals: user } }, lock: 'share' } })
    return passwordTx.run(tx, () => runWithAdapter(drizzleAdapter(tx as never, { provider: 'pg', schema: store.tables })(built), () => run(tx)))
  })
  const passwordAuthority = async (ctx: HookContext) => {
    const organization = requestOrganization()
    const caller = await getSessionFromCtx(ctx)
    const superAdmin = holdsRole((caller?.user as { role?: unknown } | undefined)?.role, (role) => role === 'super_admin')
    if (!caller || (!superAdmin && (typeof organization !== 'string' || !holdsPermission('member.create')))) throw new APIError('FORBIDDEN', { message: 'Issuing a password link needs member.create in your active organization.' })
    const owner = typeof organization === 'string' && await ctx.context.adapter.findOne<{ role: string }>({ model: 'member', where: [{ field: 'userId', value: caller.user.id }, { field: 'organizationId', value: organization }] })
    return { organization, superAdmin, issuer: caller.user.id, privileged: superAdmin || isOwnerRole(owner && owner.role) }
  }
  const sendPasswordLink = {
    id: 'send-password-link',
    endpoints: {
      sendPasswordLink: createAuthEndpoint('/organization/send-password-link', { method: 'POST', use: [sessionMiddleware] }, async (ctx) => {
        const authority = await passwordAuthority(ctx)
        const { userId } = (ctx.body ?? {}) as Record<string, unknown>
        if (typeof userId !== 'string') throw new APIError('BAD_REQUEST', { message: 'Name the member by userId.' })
        if (userId === authority.issuer) throw new APIError('FORBIDDEN', { message: 'Ask another administrator to issue your link.' })
        if (settings.passwordDelivery === 'email' && settings.mailer && typeof authority.organization === 'string') await withinLimits(authority.organization)
        const issued = await passwordLock({ user: userId, run: async (tx) => {
            const user = await ctx.context.internalAdapter.findUserById(userId)
            const member = authority.superAdmin || await (await getCurrentAdapter(ctx.context.adapter)).findOne({ model: 'member', where: [{ field: 'userId', value: userId }, { field: 'organizationId', value: authority.organization! }] })
            if (!user || !member) throw new APIError('NOT_FOUND', { message: 'No member has that id.' })
            if (!authority.superAdmin && !(await passwordAccount({ tx, user: userId, organization: authority.organization!, privileged: authority.privileged }))) throw new APIError('FORBIDDEN', { code: 'PASSWORD_LINK_PLATFORM_REQUIRED', message: 'Ask an owner or a super admin. Organization links require an account created here, belonging to this organization alone; only owners and super admins issue for administrators.' })
            const recent = settings.passwordDelivery === 'email' ? (await (await getCurrentAdapter(ctx.context.adapter)).findMany<{ identifier: string; createdAt: Date; expiresAt: Date }>({ model: 'verification', where: passwordRows(userId) })).find((row) => !row.identifier.startsWith('reset-password:mail.') && Date.now() - new Date(row.createdAt).getTime() < 5 * 60 * 1000 && new Date(row.expiresAt).getTime() > Date.now()) : undefined
            // A repeated email request retains Copy without rotating or mailing the link. A mailed
            // address-proof token is never returned to an administrator.
            const prefix = authority.superAdmin ? 'reset-password:admin.' : `reset-password:org.${Buffer.from(authority.organization!).toString('base64url')}.${authority.privileged ? 'owner' : 'member'}.`
            if (recent?.identifier.startsWith(prefix)) return { token: recent.identifier.slice('reset-password:'.length), expiresAt: recent.expiresAt, mailToken: undefined, email: user.email, throttled: true }
            const value = await issuePassword({ user: userId, email: settings.passwordDelivery === 'email', ...(authority.superAdmin ? {} : { organization: authority.organization!, privileged: authority.privileged }) })
            return { ...value, email: user.email, throttled: !!recent }
        } })
        let emailed = false
        let emailFailed = false
        if (settings.passwordDelivery === 'email' && settings.mailer && !issued.throttled) {
          try {
            await settings.mailer.send(letter({ to: issued.email, subject: 'Choose your password · اختر كلمة المرور', en: 'Open this one-time link within 24 hours to choose your password.', ar: 'افتح هذا الرابط خلال 24 ساعة لاختيار كلمة المرور. يستخدم مرة واحدة.', link: setPasswordLink(issued.mailToken!) }))
          emailed = true
          if (typeof authority.organization === 'string') await mailedFor(authority.organization)
          } catch {
            // Delivery can fail after issuance. Keep Copy available without logging the mail body.
            emailFailed = true
          }
        }
        authAudit({ action: 'send-password-link', actor: ctx.context.session?.user.id ?? null, user: userId, organization: authority.organization })
        ctx.setHeader('cache-control', 'no-store')
        ctx.setHeader('referrer-policy', 'no-referrer')
        return ctx.json({ sent: true, emailed, emailFailed, link: setPasswordLink(issued.token), expiresAt: issued.expiresAt })
      }),
      cancelPasswordLink: createAuthEndpoint('/organization/cancel-password-link', { method: 'POST', use: [sessionMiddleware] }, async (ctx) => {
        const authority = await passwordAuthority(ctx)
        const { userId } = (ctx.body ?? {}) as Record<string, unknown>
        if (typeof userId !== 'string' || (!authority.superAdmin && !(await passwordAccount({ user: userId, organization: authority.organization!, privileged: authority.privileged })))) throw new APIError('FORBIDDEN', { message: 'This account needs an owner or a super admin.' })
        await ctx.context.adapter.deleteMany({ model: 'verification', where: passwordRows(userId) })
        ctx.setHeader('cache-control', 'no-store')
        ctx.setHeader('referrer-policy', 'no-referrer')
        return ctx.json({ cancelled: true })
      }),
      operatorPasswordLink: createAuthEndpoint('/password-link/operator', { method: 'POST', metadata: { SERVER_ONLY: true } }, async (ctx) => {
        const email = (ctx.body as { email?: unknown } | undefined)?.email
        const user = typeof email === 'string' ? (await ctx.context.internalAdapter.findUserByEmail(email.trim().toLowerCase()))?.user : undefined
        if (!user) throw new APIError('NOT_FOUND', { message: 'No account has that email.' })
        const issued = await passwordLock({ user: user.id, run: () => issuePassword({ user: user.id }) })
        return { link: setPasswordLink(issued.token), expiresAt: issued.expiresAt }
      }),
    },
  }
  // Match Better Auth's `body.token || query.token`, including an empty body token.
  const checkPasswordToken = async (token: unknown) => {
    if (typeof token !== 'string') return
    const scoped = token.startsWith('mail.') ? token.slice('mail.'.length) : token
    if (!scoped.startsWith('org.')) return
    const [, encoded, privilege] = scoped.split('.')
    const link = await (await tenant.$context).internalAdapter.findVerificationValue(`reset-password:${token}`).catch(() => { throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Password link lookup failed.' }) })
    if (!link || !(await passwordAccount({ user: link.value, organization: Buffer.from(encoded!, 'base64url').toString(), privileged: privilege === 'owner' }))) throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.INVALID_TOKEN)
  }
  const passwordPolicy = {
    id: 'password-policy',
    hooks: { before: [{ matcher: (ctx: { path?: string }) => ctx.path === '/reset-password' || (settings.passwordDelivery === 'admin' && ctx.path === '/request-password-reset'), handler: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/request-password-reset') return ctx.json({ status: true, message: 'Ask your administrator for a password link.' })
      await checkPasswordToken((ctx.body as { token?: unknown } | undefined)?.token || (ctx.query as { token?: unknown } | undefined)?.token)
    }) }] },
  }
  // Where a sign-up proves its address, the password is chosen once, from the mailed link, so the sign-up asks none:
  // whatever one carries is replaced by one nobody knows, and whoever signs up with another's address never holds a
  // password to it.
  const chosenLater = {
    id: 'chosen-later',
    hooks: { before: [{
      matcher: (ctx: { path?: string }) => ctx.path === '/sign-up/email',
      handler: createAuthMiddleware(async (ctx) => ({ context: { body: { ...(ctx.body as object | undefined), password: randomBytes(32).toString('base64url') } } })),
    }] },
  }
  // The address a live set-password link is for, which the page shows as the account it chooses a password of. The
  // token is the proof, as it is for choosing the password itself; anything else is one refusal. The page reads it in
  // process alone: over HTTP the token would sit in a query string, which access logs keep.
  const setPasswordState = {
    id: 'set-password-state',
    endpoints: {
      setPasswordState: createAuthEndpoint('/set-password/state', { method: 'GET', metadata: { SERVER_ONLY: true } }, async (ctx) => {
        const { token } = (ctx.query ?? {}) as { token?: unknown }
        const { internalAdapter } = ctx.context
        await checkPasswordToken(token)
        const link = typeof token === 'string' && token ? await internalAdapter.findVerificationValue(`reset-password:${token}`) : null
        const user = link && new Date(link.expiresAt) > new Date() ? await internalAdapter.findUserById(link.value) : null
        if (!user) throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.INVALID_TOKEN)
        return ctx.json({ email: user.email })
      }),
    },
  }
  // A member is seen in the organization a session of theirs opens or refreshes in, and only there: their activity
  // in another organization is that organization's business. An impersonation is staff, not the person. The provider
  // refreshes a session once a day, so this is a day's resolution and one write a day per person. The stamp is
  // best-effort: the provider rethrows what an after hook throws, so a failed stamp would fail the sign-in or the
  // session read it rode on, and a refresh racing a sign-out hands it no session at all.
  const lastSeen = async (session: { userId: string; activeOrganizationId?: string | null; impersonatedBy?: string | null } | null) => {
    if (!session?.activeOrganizationId || session.impersonatedBy) return
    try {
      const adapter = await getCurrentAdapter((await tenant.$context).adapter as never)
      await adapter.updateMany({ model: 'member', where: [{ field: 'userId', value: session.userId }, { field: 'organizationId', value: session.activeOrganizationId }], update: { lastSeenAt: new Date() } })
    } catch (error) {
      console.error('A member\'s last seen was not written:', error)
    }
  }
  const tenant = betterAuthServer({
    ...built,
    emailAndPassword: {
      ...built.emailAndPassword,
      requireEmailVerification: verifying,
      // Only a bearer delivered to the mailbox proves it. Copy and operator links
      // prove possession of a bearer handed to the issuer, never ownership of its address.
      onPasswordReset: async ({ user }: { user: { id: string; email: string; emailVerified?: boolean; role?: unknown } }) => {
        const { adapter: fallback, internalAdapter } = await tenant.$context
        const adapter = await getCurrentAdapter(fallback)
        const endpoint = tryGetCurrentAuthEndpointContext()
        const token = (endpoint?.body as { token?: unknown } | undefined)?.token || (endpoint?.query as { token?: unknown } | undefined)?.token
        const administrative = typeof token === 'string' && (token.startsWith('org.') || token.startsWith('admin.'))
        if (!administrative) await internalAdapter.updateUser(user.id, { emailVerified: true })
        // The password is chosen, so every other link to choose it is spent.
        await adapter.deleteMany({ model: 'verification', where: [{ field: 'value', value: user.id }, ...resetLinks] })
        if (!administrative && !user.emailVerified) {
          await acceptBound({ user, token })
          await joinOpen(user)
        }
      },
      // A second sign-up with the address of an account nobody proved, such as its owner's after
      // someone squatted it, is answered as any sign-up and mails the address the link that proves it.
      ...(settings.passwordDelivery === 'email' && settings.mailer && {
        sendResetPassword: async (data: { user: { id: string; email: string }; token: string }) => {
          // Whoever asks for a reset proves the address afresh, carrying no invitation.
          await unbind(data.user.id)
          if (!(await mailedLately(data.user.id, data.token))) await resetMail(settings.mailer!)(data)
        },
      }),
      // An owner who signs up after someone else did takes off whatever that first sign-up carried.
      ...(verifying && {
        onExistingUserSignUp: async ({ user }: { user: { id: string; email: string; emailVerified?: boolean } }) => {
          if (user.emailVerified) return
          await unbind(user.id)
          await confirmLink(user)
        },
      }),
    },
    // A sign-up mails the link once. A sign-in before the proof mails nothing, and the provider's own
    // resend and verify routes are off, so nobody pushes a link to an address on demand.
    ...(verifying && { emailVerification: { sendVerificationEmail: ({ user }: { user: { id: string; email: string } }) => confirmLink(user), sendOnSignUp: true } }),
    plugins: [
      ...built.plugins,
      // add-on: roles
      keepsRoles,
      // end add-on: roles
      keepsPerson,
      invitationLimit,
      setPasswordState,
      passwordPolicy,
      ...(oneOrganization ? [addPerson] : []),
      sendPasswordLink,
      namedInCode,
      ...(verifying ? [chosenLater] : []),
      ...(oneOrganization ? [firstRun, signUpGate] : []),
    ],
    // In one organization, nobody founds another or leaves the one: leaving would leave the
    // person in no organization at all, where every read is refused.
    disabledPaths: [
      ...tenantOnly,
      ...(oneOrganization ? ['/organization/create', '/organization/leave'] : []),
      ...(verifying ? ['/send-verification-email', '/verify-email'] : []),
    ],
    databaseHooks: {
      ...built.databaseHooks,
      session: {
        ...built.databaseHooks.session,
        create: { ...built.databaseHooks.session.create, after: lastSeen },
        update: { after: lastSeen },
      },
      user: {
        ...built.databaseHooks.user,
        create: {
          before: async (user: { email: string }, context: { body?: unknown; context: { adapter: unknown } } | null) => {
            await accountGate(user, context)
          },
          after: async (user: { id: string; email: string; role?: unknown }, context: { body?: unknown } | null) => {
            authAudit({ action: 'sign-up', user: user.id })
            const invitationId = (context?.body as { invitationId?: unknown } | undefined)?.invitationId
            // Where the address is proved, the invitation rides on the link `confirmLink` mails.
            if (typeof invitationId === 'string' && !firstRegistering.getStore() && !verifying) await acceptCarried({ user, invitationId })
            if (!verifying) await joinOpen(user)
          },
        },
      },
    },
    database,
  })
  // One answer however often and by whomever it is asked, naming nobody.
  const closed = () => new APIError('FORBIDDEN', { code: 'FIRST_REGISTER_CLOSED', message: 'This backoffice has its administrator, so first-register is closed. Sign in instead.' })
  // The backoffice's first `super_admin`, which nothing else can make: the provider's own
  // `create-user`, run on an instance bound to a transaction that holds an advisory lock and
  // read no administrator under it, so two concurrent calls never both make one.
  const firstRegister = {
    id: 'first-register',
    endpoints: {
      init: createAuthEndpoint('/init', { method: 'GET' }, async (ctx) =>
        ctx.json((await administered(store.db as Executes)) ? { initialized: true } : { initialized: false, code: setupCodeState(backofficeURL) })),
      // `formCsrfMiddleware`, as sign-up has: no session guards this route, so another site's
      // form must not post to it.
      firstRegister: createAuthEndpoint('/first-register', { method: 'POST', use: [formCsrfMiddleware] }, async (ctx) => {
        if (backofficeLimited && !ipAddressHeaders && overSharedLimit()) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many tries. Wait a minute and try again.' })
        if (await administered(store.db as Executes)) throw closed()
        const { name, email, password, code } = (ctx.body ?? {}) as Record<string, unknown>
        const refused = refusedSetup({ url: backofficeURL, code, app: 'backoffice app' })
        if (refused) throw refused
        // `create-user` checks the address but not the password's length, which sign-up does.
        const { minPasswordLength: min, maxPasswordLength: max } = ctx.context.password.config
        if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || typeof password !== 'string' || password.length < min || password.length > max) {
          throw new APIError('BAD_REQUEST', { message: `A name, an email and a password of ${min} to ${max} characters are required.` })
        }
        const made = await store.transaction(async (tx) => {
          // Read committed whatever the database's default, so the read below sees an
          // administrator another call committed while this one waited on the lock.
          await (tx as Executes).execute(sql`set transaction isolation level read committed`)
          await (tx as Executes).execute(setupLock)
          if (await administered(tx as Executes)) throw closed()
          // ponytail: an instance per call, built over this transaction; it runs once in a
          // project's life. `built` carries the admin plugin and the audit hooks, which is all
          // `create-user` reads.
          const bound = betterAuthServer({ ...built, secret: backofficeSecret, database: drizzleAdapter(tx as never, { provider: 'pg', schema: store.tables }) })
          // The provider writes through the adapter its request stored, which is the backoffice's
          // pool here, so the user and account rows are pointed at this transaction instead:
          // both commit with the check or neither does, and no second client is taken.
          const adapter = (await bound.$context).adapter
          // The plugin types a role from `adminOptions.roles`, whose backoffice roles are built at
          // runtime, so it names `user` alone.
          // Verified, as first-run's owner is: the setup code is the proof, and staff are never
          // asked to verify an address.
          return runWithAdapter(adapter, () => firstRegistering.run(true, () => bound.api.createUser({ body: { name, email, password, role: 'super_admin' as never, data: { emailVerified: true } } })))
        })
        await toldAdmin({ ctx, email, at: backofficeURL })
        return ctx.json(made)
      }),
    },
    // Production limits every route; this one to three tries a minute from one address, as the
    // provider limits a password reset.
    rateLimit: [{ pathMatcher: (path: string) => path === '/first-register', window: 60, max: 3 }],
  }
  // The backoffice app's own instance: its own cookie name, so on `localhost`, where ports do not
  // keep cookies apart, the two apps never read each other's session; its own secret, so
  // neither signs a cookie the other accepts; its own origin alone trusted, so a tenant page
  // cannot post to it with the backoffice's cookie; no verify of a one-time token, which would
  // turn an impersonation into a backoffice session; and no sign-up, since staff are people the
  // backoffice already has. A project with no backoffice console has no first-register either.
  const backoffice = betterAuthServer({
    ...built,
    plugins: [
      ...built.plugins,
      keepsPerson,
      // add-on: roles
      keepsRoles,
      // end add-on: roles
      namedInCode,
      ...(backofficeApp ? [firstRegister] : []),
    ],
    baseURL: backofficeURL,
    trustedOrigins: backofficeOrigins,
    rateLimit: { ...built.rateLimit, enabled: backofficeLimited },
    secret: backofficeSecret,
    advanced: { ...built.advanced, cookiePrefix: backofficeCookiePrefix },
    // Nor a password reset of its own: staff reset through the tenant app's page like anyone,
    // and the reset ends their sessions here too.
    disabledPaths: ['/one-time-token/verify', '/sign-up/email', '/request-password-reset', '/reset-password'],
    databaseHooks: { ...built.databaseHooks, session: { create: { before: staffSession(built.databaseHooks.session.create.before) } } },
    database,
  })
  const resetLocked = async <Result,>({ token, run }: { token: unknown; run: (server: Pick<typeof tenant, 'handler'> & { api: Pick<typeof tenant.api, 'resetPassword'> }) => Promise<Result> }) => {
    const link = typeof token === 'string' && (token.startsWith('org.') || token.startsWith('admin.') || token.startsWith('mail.')) ? await (await tenant.$context).internalAdapter.findVerificationValue(`reset-password:${token}`).catch(() => { throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Password link lookup failed.' }) }) : null
    return link ? passwordLock({ user: link.value, run: (tx) => run(betterAuthServer({ ...tenant.options, logger: { disabled: true }, database: drizzleAdapter(tx as never, { provider: 'pg', schema: store.tables, transaction: false }) })) }) : run(tenant)
  }
  const api = new Proxy(tenant.api, { get: (target, key) => {
    if (key !== 'resetPassword') return Reflect.get(target, key)
    return (args: Parameters<typeof tenant.api.resetPassword>[0]) => resetLocked({ token: args?.body?.token || args?.query?.token, run: (server) => server.api.resetPassword(args) })
  } })
  const handler = async (request: Request) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/auth/reset-password') return tenant.handler(request)
    if (new URL(request.url).searchParams.getAll('token').length > 1) return Response.json({ code: 'INVALID_TOKEN', message: 'Invalid token.' }, { status: 400 })
    const copy = request.clone()
    const body = request.headers.get('content-type')?.toLowerCase().includes('application/json') ? await copy.json().catch(() => ({})) as { token?: unknown } : Object.fromEntries(await copy.formData().catch(() => new FormData()))
    return resetLocked({ token: body.token || new URL(request.url).searchParams.get('token'), run: (server) => server.handler(request) })
  }
  // One object for the kayan, which answers from whichever instance serves the request.
  return new Proxy(tenant, { get: (_target, key) => onBackoffice() ? Reflect.get(backoffice, key) : key === 'api' ? api : key === 'handler' ? handler : Reflect.get(tenant, key) })
}
