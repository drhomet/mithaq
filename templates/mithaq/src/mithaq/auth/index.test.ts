import assert from 'node:assert/strict'
import { test } from 'node:test'
import { betterAuth as betterAuthServer } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { authOptions, authSettings, backgroundSettled, domainAllowed, options, organizationLimitsFor, settingsProblems, subjectLine, trustedIpHeaders, type AuthSettings } from './index.ts'

test('trustedIpHeaders splits TRUSTED_IP_HEADER into a header list, and is undefined when unset', () => {
  assert.deepEqual(trustedIpHeaders('cf-connecting-ip'), ['cf-connecting-ip'])
  assert.deepEqual(trustedIpHeaders('cf-connecting-ip, x-forwarded-for'), ['cf-connecting-ip', 'x-forwarded-for'])
  assert.equal(trustedIpHeaders(undefined), undefined)
  assert.equal(trustedIpHeaders(''), undefined)
})

// Better Auth's own rate limiter keys every bucket on the address it resolves
// from `advanced.ipAddress.ipAddressHeaders`. Two callers naming different
// trusted addresses must land in different buckets, so a login flood from one
// address never limits another visitor.
test('with TRUSTED_IP_HEADER set, requests naming different trusted addresses get separate rate-limit buckets', async () => {
  const server = betterAuthServer({
    ...authOptions().options,
    database: memoryAdapter({}),
    secret: 'test-secret',
    rateLimit: { enabled: true, window: 60, max: 1 },
    advanced: { ipAddress: { ipAddressHeaders: trustedIpHeaders('cf-connecting-ip') } },
  })
  const ok = (ip: string) => server.handler(new Request('http://localhost/api/auth/ok', { headers: { 'cf-connecting-ip': ip } }))

  assert.equal((await ok('203.0.113.1')).status, 200)
  assert.equal((await ok('203.0.113.1')).status, 429)
  assert.equal((await ok('198.51.100.7')).status, 200)
})

// With the variable unset, `options` sets no `advanced.ipAddress` of its own, so
// Better Auth reads only its own default header, `x-forwarded-for`. A caller
// naming `cf-connecting-ip` is not on that list and must be ignored: two
// different forged values still collapse onto the one shared bucket.
test('with TRUSTED_IP_HEADER unset, a forged cf-connecting-ip header is ignored and requests share one bucket', async () => {
  assert.equal(process.env.TRUSTED_IP_HEADER, undefined)
  const server = betterAuthServer({
    ...options,
    database: memoryAdapter({}),
    secret: 'test-secret',
    rateLimit: { enabled: true, window: 60, max: 1 },
  })
  const ok = (forgedIp: string) => server.handler(new Request('http://localhost/api/auth/ok', { headers: { 'cf-connecting-ip': forgedIp } }))

  assert.equal((await ok('203.0.113.1')).status, 200)
  assert.equal((await ok('198.51.100.7')).status, 429)
})

// Forgot and reset password over the tenant's own provider, with the reset link
// read off the development log, which is the only place it is ever written, and
// only under `NODE_ENV=development`.
const tables = () => ({ user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [] })
const serverWith = async (emailAndPassword = {}) => {
  const developed = (await importedUnder({ NODE_ENV: 'development' })).authOptions().options
  return betterAuthServer({ ...developed, emailAndPassword: { ...developed.emailAndPassword, ...emailAndPassword }, database: memoryAdapter(tables()), secret: 'test-secret' })
}

const printed = async (run: () => Promise<unknown>) => {
  const said: string[] = []
  const [log, warn, error] = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = (...words: unknown[]) => void said.push(words.join(' '))
  try {
    await run()
  } finally {
    Object.assign(console, { log, warn, error })
  }
  return said.join('\n')
}
const tokenIn = (log: string) => /\/auth\/reset-password\?token=([\w-]+)/.exec(log)?.[1]

test('a forgot-password request answers the same for an address with an account and one without, and only the first gets a link', async () => {
  const server = await serverWith()
  await server.api.signUpEmail({ body: { name: 'Held', email: 'held@example.com', password: 'the-old-password' } })
  const ask = (email: string) => server.api.requestPasswordReset({ body: { email }, asResponse: true })
  let held = new Response(), missing = new Response()
  const heldLog = await printed(async () => (held = await ask('held@example.com')))
  const missingLog = await printed(async () => (missing = await ask('nobody@example.com')))
  assert.equal(held.status, 200, 'an address with an account is answered 200')
  assert.deepEqual([missing.status, await missing.text()], [held.status, await held.text()], 'and one without is answered the same status and the same body')
  assert.equal(typeof tokenIn(heldLog), 'string', 'the development log carries the reset link for the account')
  assert.equal(tokenIn(missingLog), undefined, 'and no link for an address with none')
})

test('a reset link changes the password once and ends every session: the new one signs in, the old one, a second use of the link and a session made before are refused', async () => {
  const server = await serverWith()
  const before = new Headers({ cookie: (await server.api.signUpEmail({ body: { name: 'Reset', email: 'reset@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
  assert.ok(await server.api.getSession({ headers: before }), 'the session sign-up made resolves before the reset')
  const token = tokenIn(await printed(() => server.api.requestPasswordReset({ body: { email: 'reset@example.com' } })))!
  const reset = (newPassword: string) => server.api.resetPassword({ body: { newPassword, token }, asResponse: true })
  const signIn = (password: string) => server.api.signInEmail({ body: { email: 'reset@example.com', password }, asResponse: true })
  assert.equal((await reset('the-new-password')).status, 200, 'a valid token resets the password')
  assert.equal(await server.api.getSession({ headers: before }), null, 'and the session made before it no longer does')
  assert.equal((await signIn('the-new-password')).status, 200, 'the new password signs in')
  assert.equal((await signIn('the-old-password')).status, 401, 'the old one no longer does')
  assert.equal((await reset('a-third-password')).status, 400, 'a spent token is refused')
  assert.equal((await signIn('a-third-password')).status, 401, 'and changed nothing')
})

test('an expired reset link is refused and changes nothing', async () => {
  // A token that expired a second before it was minted (`emailAndPassword.resetPasswordTokenExpiresIn`, in seconds).
  const server = await serverWith({ resetPasswordTokenExpiresIn: -1 })
  await server.api.signUpEmail({ body: { name: 'Late', email: 'late@example.com', password: 'the-old-password' } })
  const token = tokenIn(await printed(() => server.api.requestPasswordReset({ body: { email: 'late@example.com' } })))!
  assert.equal((await server.api.resetPassword({ body: { newPassword: 'the-new-password', token }, asResponse: true })).status, 400, 'the expired token is refused')
  assert.equal((await server.api.signInEmail({ body: { email: 'late@example.com', password: 'the-old-password' }, asResponse: true })).status, 200, 'and the old password still signs in')
})

/**
 * This module as a deploy imports it under `env`: a fresh instance under its
 * own URL, because every guard of the module is read once, at import.
 */
const importedUnder = async (env: Record<string, string>) => {
  // `NODE_ENV` is typed read-only, and written here through a plain record.
  const vars: Record<string, string | undefined> = process.env
  const was = Object.fromEntries(Object.keys(env).map((key) => [key, vars[key]]))
  Object.assign(vars, env)
  try {
    return (await import(`./index.ts?${new URLSearchParams(env)}`)) as typeof import('./index.ts')
  } finally {
    for (const [key, value] of Object.entries(was)) {
      if (value === undefined) delete vars[key]
      else vars[key] = value
    }
  }
}

test('on a local host with NODE_ENV unset, password reset is off and prints nothing: only NODE_ENV=development, set explicitly, logs a link', async () => {
  // A deploy run with plain node and BETTER_AUTH_URL unset falls back to localhost.
  assert.equal(process.env.NODE_ENV, undefined, 'a deploy run with plain node, which sets no NODE_ENV')
  const server = betterAuthServer({ ...authOptions().options, database: memoryAdapter(tables()), secret: 'test-secret' })
  await server.api.signUpEmail({ body: { name: 'Held', email: 'held@example.com', password: 'the-old-password' } })
  let held = new Response()
  const log = await printed(async () => (held = await server.api.requestPasswordReset({ body: { email: 'held@example.com' }, asResponse: true })))
  assert.equal(held.status, 400, 'the request is refused')
  assert.equal(JSON.parse(await held.text()).code, 'RESET_PASSWORD_DISABLED', 'as disabled')
  for (const leak of ['held@example.com', 'token=']) assert.equal(log.includes(leak), false, `nothing printed carries ${leak}`)
  const developed = await serverWith()
  await developed.api.signUpEmail({ body: { name: 'Held', email: 'held@example.com', password: 'the-old-password' } })
  assert.equal(typeof tokenIn(await printed(() => developed.api.requestPasswordReset({ body: { email: 'held@example.com' } }))), 'string', 'while under NODE_ENV=development the link is logged')
})

test('off a local host, or in production, the auth setup refuses to start without a mailer, since no reset, proof or invitation would reach anyone, and with one the provider rate limits', async () => {
  assert.equal(process.env.NODE_ENV, undefined, 'a deploy run with plain node, which sets no NODE_ENV')
  const deploys = {
    'a real host with no NODE_ENV': { BETTER_AUTH_URL: 'https://app.example', BETTER_AUTH_SECRET: 'a-deploy-secret' },
    'production on localhost': { NODE_ENV: 'production', BETTER_AUTH_URL: 'http://localhost:5173', PLATFORM_URL: 'http://localhost:5174', BETTER_AUTH_SECRET: 'a-deploy-secret' },
  }
  for (const [deploy, env] of Object.entries(deploys)) {
    await assert.rejects(importedUnder(env), /needs a mailer in production[\s\S]*RESEND_API_KEY/, `${deploy}: refused without a mailer`)
    const imported = await importedUnder({ ...env, RESEND_API_KEY: 're_never_sent', MAIL_FROM: 'mail@example.com' })
    assert.equal(imported.options.rateLimit.enabled, true, `${deploy}: and with one the provider rate limits`)
  }
})

test('an invitation writes its accept link to the log under NODE_ENV=development on a local host, and anywhere else prints neither the link nor the address', async () => {
  // As the reset link above.
  assert.equal(process.env.NODE_ENV, undefined, 'a deploy run with plain node, which sets no NODE_ENV')
  const deploys: [string, Record<string, string>, boolean][] = [
    ['development on localhost', { NODE_ENV: 'development' }, true],
    // A real host starts only with a mailer, which the link goes to instead.
    ['a local host with no NODE_ENV', {}, false],
  ]
  for (const [deploy, env, logs] of deploys) {
    const imported = await importedUnder(env)
    const server = betterAuthServer({ ...imported.authOptions().options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
    const { user } = await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' } })
    // Proved, as many organizations mail an invitation only for an inviter whose address is.
    await (await server.$context).internalAdapter.updateUser(user.id, { emailVerified: true })
    const headers = new Headers({ cookie: (await server.api.signInEmail({ body: { email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
    await server.api.createOrganization({ body: { name: 'Org', slug: 'org' }, headers })
    let made: { id: string } | undefined
    const log = await printed(async () => (made = (await server.api.createInvitation({ body: { email: 'invitee@example.com', role: 'member' }, headers })) as { id: string }))
    assert.equal(log.includes(`http://localhost:5173/auth/accept-invitation?id=${made!.id}`), logs, `${deploy}: the link is ${logs ? '' : 'not '}logged`)
    assert.equal(log.includes('invitee@example.com'), logs, `${deploy}: nor the address unless the link is`)
  }
})

/** A server of `settings` with a mailer that keeps what it sends, whose owner founded `Org` and is signed in. */
const mailingOwner = async (settings: AuthSettings, organizationName = 'Org') => {
  const sent: { to: string; subject: string; text: string; html: string }[] = []
  const mailer = { send: async (mail: (typeof sent)[number]) => void sent.push(mail) }
  const server = betterAuthServer({ ...authOptions({}, { ...settings, mailer }).options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
  const { user } = await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' } })
  await server.api.createOrganization({ body: { name: organizationName, slug: 'org', userId: user.id } })
  const headers = new Headers({ cookie: (await server.api.signInEmail({ body: { email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
  return { sent, server, headers }
}

test('with a mailer the reset and, with one organization, the invitation are mailed through it, each in both locales with its link, and nothing is logged', async () => {
  const { sent, server, headers } = await mailingOwner({ ...authSettings, organizations: 'one', signUp: 'invite', joinRole: null, verifyEmail: true })
  const log = await printed(async () => {
    await server.api.requestPasswordReset({ body: { email: 'owner@example.com' } })
    await server.api.createInvitation({ body: { email: 'invitee@example.com', role: 'member' }, headers })
    await backgroundSettled()
  })
  assert.deepEqual(sent.map((one) => one.to), ['owner@example.com', 'invitee@example.com'], 'one message to each address')
  assert.equal(typeof tokenIn(sent[0]!.text), 'string', 'the reset carries its link')
  assert.match(sent[1]!.text, /http:\/\/localhost:5173\/auth\/accept-invitation\?id=\w+/, 'the invitation carries its accept link')
  for (const one of sent) assert.match(one.html, /dir="rtl"[\s\S]*[؀-ۿ]/, 'with an Arabic part')
  assert.equal(log.includes('token='), false, 'and the log holds no link')
})

test('with many organizations an invitation is mailed in the fixed letter only for an inviter whose own address is proved, and invitations are rate limited there too', async () => {
  const { sent, server, headers } = await mailingOwner(authSettings, 'Evil <b>\r\nBcc: x@example.com')
  await server.api.createInvitation({ body: { email: 'first@example.com', role: 'member' }, headers })
  await backgroundSettled()
  assert.equal(sent.length, 0, 'an inviter nobody proved sends no words of theirs through the mailer; the link is still copied')
  const { internalAdapter } = await server.$context
  await internalAdapter.updateUser((await internalAdapter.findUserByEmail('owner@example.com'))!.user.id, { emailVerified: true })
  const proved = new Headers({ cookie: (await server.api.signInEmail({ body: { email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
  await server.api.createInvitation({ body: { email: 'second@example.com', role: 'member' }, headers: proved })
  await backgroundSettled()
  assert.deepEqual(sent.map((one) => one.to), ['second@example.com'], 'a proved inviter\'s invitation is mailed')
  assert.equal(sent[0]!.subject, 'You are invited · لديك دعوة', 'under the fixed subject')
  assert.equal(sent[0]!.html.includes('<b>'), false, 'with the organization\'s name escaped')
  assert.ok(authOptions({}, authSettings).options.rateLimit.customRules?.['/organization/invite-member'], 'and invitations have a limit of their own')
})

test('with one organization an invitation\'s subject is fixed, its body escapes the organization\'s name, invitations are rate limited, and no subject carries a line break', async () => {
  const { sent, server, headers } = await mailingOwner({ ...authSettings, organizations: 'one', signUp: 'invite', joinRole: null, verifyEmail: true }, 'Evil <b>\r\nBcc: x@example.com')
  await server.api.createInvitation({ body: { email: 'invitee@example.com', role: 'member' }, headers })
  await backgroundSettled()
  assert.equal(sent[0]!.subject.includes('Evil'), false, 'the subject names no organization')
  assert.equal(/[\r\n]/.test(sent[0]!.subject), false)
  assert.equal(sent[0]!.html.includes('<b>'), false, 'the name is escaped in the HTML')
  assert.ok(authOptions({}, { ...authSettings, organizations: 'one', signUp: 'invite', joinRole: null, verifyEmail: true }).options.rateLimit.customRules?.['/organization/invite-member'], 'invitations have a limit of their own')
  assert.equal(subjectLine('Reset\r\nBcc: x@example.com\u0007'), 'Reset Bcc: x@example.com')
})

/** The repository's own settings with the changes given. */
const settingsWith = (changes: Partial<AuthSettings>): AuthSettings => ({ ...authSettings, ...changes })
const school = settingsWith({ organizations: 'one', signUp: 'invite', joinRole: 'student', verifyEmail: true, allowedDomains: [] })
const mailer = { send: async () => {} }
/** What `settingsProblems` says of `settings`, as one string per problem, read in development unless said. */
const schoolRoles = { administrator: '*', registrar: ['courses.find', 'memberRoles.create'], instructor: ['courses.find', 'invitation.create'], student: ['courses.find', 'courses.fields.title', 'memberRoles.find', 'screen.portal'] } as const
const problems = (settings: AuthSettings, deployed = false) => settingsProblems({ settings, deployed, joinRoles: schoolRoles })

test('the organization settings refuse every combination that would mean nothing or open a door, each naming what to change', () => {
  assert.deepEqual(problems(authSettings), [], 'the repository\'s own settings, many organizations, are sound')
  assert.deepEqual(problems(school), [], 'and so is a school: one organization, invitations only')
  assert.deepEqual(problems(settingsWith({ organizations: 'one', showOrganization: false, signUp: 'open', joinRole: null, verifyEmail: false, allowedDomains: [] })), [], 'and one organization the app never names')
  const refused: [string, Partial<AuthSettings>, RegExp][] = [
    ['many by invitation', { signUp: 'invite' }, /'many'[\s\S]*signUp = 'open'/],
    ['many with a join role', { joinRole: 'student' }, /'many'[\s\S]*joinRole = null/],
    ['many proving no address', { verifyEmail: false }, /'many'[\s\S]*verifyEmail = true/],
    ['many with domains', { allowedDomains: ['example.com'] }, /'many'[\s\S]*allowedDomains/],
    ['many hiding its organizations', { showOrganization: false }, /'many'[\s\S]*showOrganization = true/],
  ]
  for (const [name, changes, said] of refused) assert.match(problems(settingsWith(changes)).join('\n'), said, name)
  const ofSchool: [string, Partial<AuthSettings>, RegExp][] = [
    ['domains by invitation', { allowedDomains: ['example.com'] }, /allowedDomains[\s\S]*signUp = 'open'/],
    ['domains with no verification', { signUp: 'open', verifyEmail: false, allowedDomains: ['example.com'] }, /allowedDomains[\s\S]*verifyEmail = true/],
    ['an unknown join role', { joinRole: 'janitor' }, /joinRole[\s\S]*"janitor"/],
    ['a join role holding every key', { joinRole: 'administrator' }, /joinRole[\s\S]*"administrator"[\s\S]*gives roles or invites/],
    ['a join role that gives roles', { joinRole: 'registrar' }, /joinRole[\s\S]*"registrar"[\s\S]*memberRoles\.create/],
    ['a join role that invites', { joinRole: 'instructor' }, /joinRole[\s\S]*"instructor"[\s\S]*invitation\.create/],
  ]
  for (const [name, changes, said] of ofSchool) assert.match(problems({ ...school, ...changes }).join('\n'), said, name)
  for (const entry of ['Example.com', 'example.com.', '*example.com', 'exa mple.com', 'ex\u0430mple.com', '@example.com', '*.*.example.com', 'com']) {
    assert.match(problems({ ...school, signUp: 'open', allowedDomains: [entry] }).join('\n'), /allowedDomains/, `"${entry}" is no domain entry`)
  }
  assert.deepEqual(problems({ ...school, signUp: 'open', allowedDomains: ['example.com', '*.example.org', 'xn--mnchen-3ya.de'] }), [], 'lowercase ASCII hosts and one leading *. are')
  assert.equal(settingsProblems({ settings: { ...school, joinRole: 'student' }, deployed: false, joinRoles: null }).length, 1, 'without the roles add-on a join role is refused')
})

test('in production every mode needs a mailer: an open sign-up proves addresses by mail, invitations and resets are mailed, and many proves every address', () => {
  const open = { ...school, signUp: 'open' as const }
  for (const [name, settings] of [['one, open', open], ['one, by invitation', school], ['many', authSettings]] as const) {
    assert.match(problems({ ...settings, mailer: undefined }, true).join('\n'), /needs a mailer in production[\s\S]*RESEND_API_KEY/, name)
    assert.deepEqual(problems({ ...settings, mailer }, true), [], `${name}, with a mailer`)
    assert.deepEqual(problems({ ...settings, mailer: undefined }, false), [], `${name}: development logs its mail instead`)
  }
})

test('an allowed domain matches exactly after lowercasing and punycode, a subdomain only through *., and never by suffix', () => {
  const allowed = ['example.com', '*.corp.org', 'xn--mnchen-3ya.de']
  const cases: [string, boolean][] = [
    ['a@example.com', true],
    ['A@EXAMPLE.COM', true],
    ['a@sub.example.com', false],
    ['a@notexample.com', false],
    ['a@example.com.evil.net', false],
    ['a@evil.net@example.com', true],
    ['a@ex\u0430mple.com', false],
    ['a@team.corp.org', true],
    ['a@deep.team.corp.org', true],
    ['a@corp.org', false],
    ['a@evilcorp.org', false],
    ['a@m\u00fcnchen.de', true],
    ['a@xn--mnchen-3ya.de', true],
    ['a@\uff45xample.com', false],
    ['a@example\uff0ecom', false],
    ['a@example%2ecom', false],
    ['a@EXAMPLE.COM.', false],
    ['no-at-sign', false],
    ['a@', false],
  ]
  for (const [email, expected] of cases) assert.equal(domainAllowed(email, allowed), expected, email)
})

test('in one organization, shown or not, nobody founds an organization over the provider\'s routes, and many founds as before', async () => {
  for (const [settings, founds] of [[school, false], [{ ...school, showOrganization: false }, false], [authSettings, true]] as const) {
    const server = betterAuthServer({ ...authOptions({}, settings).options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
    const headers = new Headers({ cookie: (await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
    const made = await server.api.createOrganization({ body: { name: 'Org', slug: 'org' }, headers }).then(() => true, (error: { body?: { code?: string } }) => error.body?.code)
    assert.equal(made, founds || 'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION', `${settings.organizations}: an organization is ${founds ? '' : 'not '}founded`)
  }
})

test('with no organization shown, an invitation invites to the app and never names the organization', async () => {
  const sent: { subject: string; text: string }[] = []
  const settings = { ...authSettings, organizations: 'one' as const, showOrganization: false, signUp: 'invite' as const, mailer: { send: async (mail: (typeof sent)[number]) => void sent.push(mail) } }
  const server = betterAuthServer({ ...authOptions({}, settings).options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
  const { user } = await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' } })
  await server.api.createOrganization({ body: { name: 'Main', slug: 'main', userId: user.id } })
  const headers = new Headers({ cookie: (await server.api.signInEmail({ body: { email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
  await server.api.createInvitation({ body: { email: 'invitee@example.com', role: 'member' }, headers })
  assert.equal(sent.length, 1)
  assert.doesNotMatch(`${sent[0]!.subject} ${sent[0]!.text}`, /Main/, 'the organization is not named')
  assert.match(sent[0]!.text, /this app/)
})

test('one organization holds every person of the app, so it takes members without end, while each of many holds 10,000', async () => {
  const one = organizationLimitsFor('one').membershipLimit
  assert.equal(typeof one === 'function' ? await one() : one, Number.MAX_SAFE_INTEGER)
  assert.equal(organizationLimitsFor('many').membershipLimit, 10_000)
})

test('an organization\'s name, which founders write and mail bodies carry, is one line of at most 100 characters, however it is made or renamed', async () => {
  for (const settings of [authSettings, { ...authSettings, organizations: 'one' as const }]) {
    const server = betterAuthServer({ ...authOptions({}, settings).options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
    const { user } = await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' } })
    const made = (await server.api.createOrganization({ body: { name: ' Evil\r\nBcc: x@example.com\u0007 ', slug: 'evil', userId: user.id } }))!
    assert.equal(made.name, 'Evil Bcc: x@example.com', `${settings.organizations}: a line break or control character is taken out`)
    await assert.rejects(server.api.createOrganization({ body: { name: 'x'.repeat(101), slug: 'long', userId: user.id } }), /1 to 100 characters/, `${settings.organizations}: a name past 100 characters is refused`)
    await assert.rejects(server.api.createOrganization({ body: { name: '\r\n', slug: 'blank', userId: user.id } }), /1 to 100 characters/, `${settings.organizations}: and one of nothing but breaks`)
    const headers = new Headers({ cookie: (await server.api.signInEmail({ body: { email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
    const renamed = await server.api.updateOrganization({ body: { organizationId: made.id, data: { name: 'Line\none' } }, headers })
    assert.equal(renamed?.name, 'Line one', `${settings.organizations}: a rename is one line too`)
  }
})

test('a mailer is never waited on: a reset is answered as fast for an address with an account as for one without, and the mail follows', async () => {
  const sent: string[] = []
  const slow = { send: async ({ to }: { to: string }) => { await new Promise((done) => setTimeout(done, 1000)); sent.push(to) } }
  const server = betterAuthServer({ ...authOptions({}, { ...authSettings, mailer: slow }).options, database: memoryAdapter(tables()), secret: 'test-secret' })
  await server.api.signUpEmail({ body: { name: 'Held', email: 'held@example.com', password: 'the-old-password' } })
  const timed = async (email: string) => {
    const started = performance.now()
    await server.api.requestPasswordReset({ body: { email } })
    return performance.now() - started
  }
  const [held, missing] = [await timed('held@example.com'), await timed('nobody@example.com')]
  assert.ok(held < 500 && missing < 500, `neither answer waits on the mailer: ${Math.round(held)}ms and ${Math.round(missing)}ms`)
  await backgroundSettled()
  assert.deepEqual(sent, ['held@example.com'], 'and the mail is sent after')
})
