import assert from 'node:assert/strict'
import { test } from 'node:test'
import { betterAuth as betterAuthServer } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { authOptions, authSettings, domainAllowed, options, settingsProblems, trustedIpHeaders, type AuthSettings } from './index.ts'

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

test('off a local host, or in production, password reset is off: a forgot request is refused the same for any address, and prints no token and no address', async () => {
  assert.equal(process.env.NODE_ENV, undefined, 'a deploy run with plain node, which sets no NODE_ENV')
  const deploys = {
    'a real host with no NODE_ENV': { BETTER_AUTH_URL: 'https://app.example', BETTER_AUTH_SECRET: 'a-deploy-secret' },
    'production on localhost': { NODE_ENV: 'production', BETTER_AUTH_URL: 'http://localhost:5173', PLATFORM_URL: 'http://localhost:5174', BETTER_AUTH_SECRET: 'a-deploy-secret' },
  }
  for (const [deploy, env] of Object.entries(deploys)) {
    const imported = await importedUnder(env)
    const server = betterAuthServer({ ...imported.authOptions().options, database: memoryAdapter(tables()), secret: 'test-secret' })
    await server.api.signUpEmail({ body: { name: 'Held', email: 'held@example.com', password: 'the-old-password' } })
    const ask = (email: string) => server.api.requestPasswordReset({ body: { email }, asResponse: true })
    let held = new Response(), missing = new Response()
    const log = (await printed(async () => (held = await ask('held@example.com')))) + (await printed(async () => (missing = await ask('nobody@example.com'))))
    const answer = await held.text()
    assert.equal(held.status, 400, `${deploy}: the request is refused`)
    // The provider's own code for a reset with no sender, thrown before it looks the address up.
    assert.equal(JSON.parse(answer).code, 'RESET_PASSWORD_DISABLED', `${deploy}: as disabled`)
    assert.deepEqual([missing.status, await missing.text()], [held.status, answer], `${deploy}: and an address with no account is answered the same`)
    for (const leak of ['held@example.com', 'nobody@example.com', 'token=']) assert.equal(log.includes(leak), false, `${deploy}: nothing printed carries ${leak}`)
    assert.equal(imported.options.rateLimit.enabled, true, `${deploy}: and the provider rate limits`)
  }
})

test('an invitation writes its accept link to the log under NODE_ENV=development on a local host, and anywhere else prints neither the link nor the address', async () => {
  // As the reset link above.
  assert.equal(process.env.NODE_ENV, undefined, 'a deploy run with plain node, which sets no NODE_ENV')
  const deploys: [string, Record<string, string>, boolean][] = [
    ['development on localhost', { NODE_ENV: 'development' }, true],
    ['a local host with no NODE_ENV', {}, false],
    ['development on a real host', { NODE_ENV: 'development', BETTER_AUTH_URL: 'https://app.example', BETTER_AUTH_SECRET: 'a-deploy-secret' }, false],
  ]
  for (const [deploy, env, logs] of deploys) {
    const imported = await importedUnder(env)
    const server = betterAuthServer({ ...imported.authOptions().options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
    const headers = new Headers({ cookie: (await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
    await server.api.createOrganization({ body: { name: 'Org', slug: 'org' }, headers })
    let made: { id: string } | undefined
    const log = await printed(async () => (made = (await server.api.createInvitation({ body: { email: 'invitee@example.com', role: 'member' }, headers })) as { id: string }))
    assert.equal(log.includes(`http://localhost:5173/auth/accept-invitation?id=${made!.id}`), logs, `${deploy}: the link is ${logs ? '' : 'not '}logged`)
    assert.equal(log.includes('invitee@example.com'), logs, `${deploy}: nor the address unless the link is`)
  }
})

test('with a mailer the reset and the invitation are mailed through it, each in both locales with its link, and nothing is logged', async () => {
  const sent: { to: string; subject: string; text: string; html: string }[] = []
  const mailer = { send: async (mail: (typeof sent)[number]) => void sent.push(mail) }
  const server = betterAuthServer({ ...authOptions({}, { ...authSettings, mailer }).options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
  const headers = new Headers({ cookie: (await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
  const log = await printed(async () => {
    await server.api.requestPasswordReset({ body: { email: 'owner@example.com' } })
    await server.api.createOrganization({ body: { name: 'Org', slug: 'org' }, headers })
    await server.api.createInvitation({ body: { email: 'invitee@example.com', role: 'member' }, headers })
  })
  assert.deepEqual(sent.map((one) => one.to), ['owner@example.com', 'invitee@example.com'], 'one message to each address')
  assert.equal(typeof tokenIn(sent[0]!.text), 'string', 'the reset carries its link')
  assert.match(sent[1]!.text, /http:\/\/localhost:5173\/auth\/accept-invitation\?id=\w+/, 'the invitation carries its accept link')
  for (const one of sent) assert.match(one.html, /dir="rtl"[\s\S]*[؀-ۿ]/, 'with an Arabic part')
  assert.equal(log.includes('token='), false, 'and the log holds no link')
})

/** The repository's own settings with the changes given. */
const settingsWith = (changes: Partial<AuthSettings>): AuthSettings => ({ ...authSettings, ...changes })
const school = settingsWith({ organizations: 'one', signUp: 'invite', joinRole: 'student', verifyEmail: true, allowedDomains: [] })
const mailer = { send: async () => {} }
/** What `settingsProblems` says of `settings`, as one string per problem, read in development unless said. */
const problems = (settings: AuthSettings, production = false) => settingsProblems({ settings, production, joinRoles: ['administrator', 'registrar', 'instructor', 'student'], everything: ['administrator'] })

test('the organization settings refuse every combination that would mean nothing or open a door, each naming what to change', () => {
  assert.deepEqual(problems(authSettings), [], 'the repository\'s own settings, many organizations, are sound')
  assert.deepEqual(problems(school), [], 'and so is a school: one organization, invitations only')
  assert.deepEqual(problems(settingsWith({ organizations: 'none', signUp: 'open', joinRole: null, verifyEmail: false, allowedDomains: [] })), [])
  const refused: [string, Partial<AuthSettings>, RegExp][] = [
    ['many by invitation', { signUp: 'invite' }, /'many'[\s\S]*signUp = 'open'/],
    ['many with a join role', { joinRole: 'student' }, /'many'[\s\S]*joinRole = null/],
    ['many verifying addresses', { verifyEmail: true }, /'many'[\s\S]*verifyEmail = false/],
    ['many with domains', { allowedDomains: ['example.com'] }, /'many'[\s\S]*allowedDomains/],
  ]
  for (const [name, changes, said] of refused) assert.match(problems(settingsWith(changes)).join('\n'), said, name)
  const ofSchool: [string, Partial<AuthSettings>, RegExp][] = [
    ['domains by invitation', { allowedDomains: ['example.com'] }, /allowedDomains[\s\S]*signUp = 'open'/],
    ['domains with no verification', { signUp: 'open', verifyEmail: false, allowedDomains: ['example.com'] }, /allowedDomains[\s\S]*verifyEmail = true/],
    ['an unknown join role', { joinRole: 'janitor' }, /joinRole[\s\S]*"janitor"/],
    ['a join role holding every key', { joinRole: 'administrator' }, /joinRole[\s\S]*"administrator"[\s\S]*every key/],
  ]
  for (const [name, changes, said] of ofSchool) assert.match(problems({ ...school, ...changes }).join('\n'), said, name)
  for (const entry of ['Example.com', 'example.com.', '*example.com', 'exa mple.com', 'ex\u0430mple.com', '@example.com', '*.*.example.com', 'com']) {
    assert.match(problems({ ...school, signUp: 'open', allowedDomains: [entry] }).join('\n'), /allowedDomains/, `"${entry}" is no domain entry`)
  }
  assert.deepEqual(problems({ ...school, signUp: 'open', allowedDomains: ['example.com', '*.example.org', 'xn--mnchen-3ya.de'] }), [], 'lowercase ASCII hosts and one leading *. are')
  assert.equal(settingsProblems({ settings: { ...school, joinRole: 'student' }, production: false, joinRoles: null, everything: [] }).length, 1, 'without the roles add-on a join role is refused')
})

test('in production an open sign-up of one organization needs a mailer, and invitations alone or many organizations do not', () => {
  const open = { ...school, signUp: 'open' as const }
  assert.match(problems({ ...open, mailer: undefined }, true).join('\n'), /signUp = 'open'[\s\S]*RESEND_API_KEY/)
  assert.deepEqual(problems({ ...open, mailer }, true), [])
  assert.deepEqual(problems({ ...open, mailer: undefined }, false), [], 'development logs its mail instead')
  assert.deepEqual(problems({ ...school, mailer: undefined }, true), [])
  assert.deepEqual(problems(settingsWith({ mailer: undefined }), true), [])
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
    ['no-at-sign', false],
    ['a@', false],
  ]
  for (const [email, expected] of cases) assert.equal(domainAllowed(email, allowed), expected, email)
})

test('in one organization or none, nobody founds an organization over the provider\'s routes, and many founds as before', async () => {
  for (const [settings, founds] of [[school, false], [{ ...school, organizations: 'none' as const }, false], [authSettings, true]] as const) {
    const server = betterAuthServer({ ...authOptions({}, settings).options, database: memoryAdapter({ ...tables(), organizationRole: [] }), secret: 'test-secret' })
    const headers = new Headers({ cookie: (await server.api.signUpEmail({ body: { name: 'Owner', email: 'owner@example.com', password: 'the-old-password' }, returnHeaders: true })).headers.get('set-cookie') ?? '' })
    const made = await server.api.createOrganization({ body: { name: 'Org', slug: 'org' }, headers }).then(() => true, (error: { body?: { code?: string } }) => error.body?.code)
    assert.equal(made, founds || 'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION', `${settings.organizations}: an organization is ${founds ? '' : 'not '}founded`)
  }
})
