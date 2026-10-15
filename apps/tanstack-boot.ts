// Boots the built TanStack hosts (tenant and backoffice apps) and asserts over real sockets.
// Not named `*.test.ts` so the default run stays fast; run it with `bun run test:tanstack`.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
// Relative path: no `node_modules/asas` symlink resolves from `apps/`.
import { asas } from '../templates/asas/src/asas.ts'
import { testDatabase } from '../templates/asas/src/test-database.ts'
import { migratedDatabase } from './migrated-database.ts'
import { backofficeRoles } from '../templates/mithaq/src/mithaq/auth/backoffice-roles.ts'
import { tenantRoles } from '../templates/mithaq/src/roles/system-roles.ts'
import { defaultRules, providerOf } from '../packages/mithaq/src/index.ts'
import type { ScreenClient } from '../packages/mithaq/src/screen/client.ts'

/** What a list draws when the viewer's role reads no column, from its apostrophe on: the server render writes that as an entity. */
const noColumns = (await import('./asas-tanstack/src/copy.ts')).scopes.admin!.noColumns!.en!.split("'").at(-1)!

const app = fileURLToPath(new URL('./asas-tanstack', import.meta.url))
const backofficeApp = fileURLToPath(new URL('./asas-backoffice', import.meta.url))

let served: ReturnType<typeof spawn> | undefined
let backofficeServed: ReturnType<typeof spawn> | undefined
/**
 * Every message the apps mail, caught on this machine: a production start needs a mailer, and the apps' Resend
 * mailer posts here through `RESEND_BASE_URL`, so nothing reaches Resend.
 */
const mailed: { to: string[]; text: string }[] = []
const mailbox = createHttpServer((request, response) => {
  let body = ''
  request.on('data', (chunk: Buffer) => { body += chunk })
  request.on('end', () => {
    mailed.push(JSON.parse(body) as (typeof mailed)[number])
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"caught"}')
  })
})
let env: NodeJS.ProcessEnv = process.env
// `after` is not reached on these signals, and a child left running holds its port.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    served?.kill()
    backofficeServed?.kill()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

// One `memberRoles` row written straight through the store, as a provisioning script does for
// every actor after the first, because a managed create is graded against the actor making it.
const assignRole = async (tenant: string, member: string, role: string) => {
  const store = asas.targets.drizzle as unknown as {
    insert(args: { tx: unknown; kayan: string; data: Record<string, unknown> }): Promise<unknown>
    transaction<Result>(fn: (tx: unknown) => Promise<Result>): Promise<Result>
  }
  const written = new Date()
  await store.transaction((tx) =>
    store.insert({ tx, kayan: 'memberRoles', data: { createdAt: written, role, organization: tenant, updatedAt: written, user: member } }),
  )
}
const vite = `${app}/node_modules/.bin/vite`

/** A port nothing listens on, taken by binding zero and releasing it; the window before the child binds is a race not expected to be lost. */
const freePort = async () => {
  const held = createServer()
  held.listen(0, '127.0.0.1')
  await once(held, 'listening')
  const { port } = held.address() as { port: number }
  await new Promise((resolve) => held.close(resolve))
  return port
}

let origin = ''
let backofficeOrigin = ''
let backofficeCookie = ''
let cookie = ''
let actorEmail = ''
const actorName = 'Boot'
let organizationName = ''
const password = 'a-long-enough-password'
const title = `Tajweed ${Date.now()}`
const setupCode = 'asas-tanstack-boot-setup-code-of-32-characters'

const post = async (path: string, body: unknown, headers: Record<string, string> = {}, at = origin) => {
  const response = await fetch(`${at}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  // A disabled route or a host refusal answers plain text, which reads as no body.
  return { response, body: (await response.json().catch(() => ({}))) as Record<string, unknown> }
}

before(async () => {
  // Refuses anything but a throwaway database named for this run: the migration, sign-ups and role rows all write to it.
  testDatabase()
  // Migrated, not pushed: the built servers run in production and refuse a database a push built.
  // This process never connects, since outside production that would push.
  await migratedDatabase()

  const buildStarted = performance.now()
  for (const folder of [app, backofficeApp]) {
    const built = spawnSync(vite, ['build'], { cwd: folder, encoding: 'utf8' })
    assert.equal(built.status, 0, `vite build exits 0 in ${folder}\n${built.stdout}\n${built.stderr}`)
    // Vite replaces only `process.env.NODE_ENV`; a built server run without production would push instead of connecting.
    assert.match(readFileSync(join(folder, 'dist/server/server.js'), 'utf8'), /if \(env\.NODE_ENV === "production"\)/, `the built entry of ${folder} still reads NODE_ENV`)
  }
  const builtIn = performance.now() - buildStarted

  const startStarted = performance.now()
  mailbox.listen(0, '127.0.0.1')
  await once(mailbox, 'listening')
  const [port, backofficePort] = [await freePort(), await freePort()]
  origin = `http://127.0.0.1:${port}`
  backofficeOrigin = `http://127.0.0.1:${backofficePort}`
  // No LOCAL_AUTH_SECRET, so both apps draw their screens with local auth switched off.
  const { LOCAL_AUTH_SECRET: _local, ...inherited } = process.env
  env = {
    ...inherited,
    // Under the production NODE_ENV the build sets, Better Auth refuses its default secret.
    BETTER_AUTH_SECRET: 'asas-tanstack-boot-test-secret',
    // The ports are chosen at run time, so each app is handed its own origin and the other's:
    // an impersonation started in the backoffice lands in the tenant app.
    BETTER_AUTH_URL: origin,
    BACKOFFICE_URL: backofficeOrigin,
    // A production backoffice makes its first administrator only with this code.
    SETUP_CODE: setupCode,
    RESEND_API_KEY: 're_tanstack_boot_never_sent',
    MAIL_FROM: 'Boot <mail@example.com>',
    RESEND_BASE_URL: `http://127.0.0.1:${(mailbox.address() as { port: number }).port}`,
    STORAGE_SECRET: 'asas-tanstack-boot-storage-secret-of-32-chars',
    STORAGE_PREFIX: 'mithaq/asas',
    STORAGE_ADAPTER: 'local',
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'mithaq-tanstack-storage-')),
  }
  // `vite preview` serves the build's fetch handler and client assets; the app builds no standalone server.
  const start = (cwd: string, at: number) => {
    const child = spawn(vite, ['preview', '--port', String(at), '--host', '127.0.0.1', '--strictPort'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env })
    let said = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { said += chunk })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { said += chunk })
    return { child, said: () => said }
  }
  // Both start at once over a database with no system roles, so both first requests seed them together.
  const tenant = start(app, port)
  served = tenant.child
  const backoffice = start(backofficeApp, backofficePort)
  backofficeServed = backoffice.child
  await Promise.all([[origin, tenant], [backofficeOrigin, backoffice]].map(async ([at, one]) => {
    const { child, said } = one as ReturnType<typeof start>
    for (let attempt = 0; ; attempt += 1) {
      if (child.exitCode !== null) assert.fail(`the preview server exited with ${child.exitCode} before it answered:\n${said()}`)
      const answered = await fetch(`${at}/api/not-ours`).catch(() => undefined)
      if (answered) {
        assert.equal(answered.status, 404, `the server on ${at} serves over the migrated database:\n${said()}`)
        break
      }
      assert.ok(attempt < 300, `the preview server never answered on ${at}:\n${said()}`)
      await sleep(100)
    }
  }))
  const startedIn = performance.now() - startStarted
  console.log(
    `boot: vite build of both apps ${(builtIn / 1000).toFixed(1)}s, start to first answer ${(startedIn / 1000).toFixed(1)}s`,
  )
}, { timeout: 600_000 })

after(async () => {
  for (const child of [served, backofficeServed]) {
    if (!child || child.exitCode !== null || child.signalCode !== null) continue
    child.kill()
    await once(child, 'exit')
  }
  mailbox.close()
})

/**
 * A sign-in over the socket. The provider answers three sign-ins from one address in ten seconds and this file signs in
 * more often, so a refusal for that alone waits the time it names and asks again.
 */
const signedInOver = async (email: string) => {
  for (;;) {
    const signedIn = await post('/api/auth/user/sign-in/email', { email, password }, { origin })
    if (signedIn.response.status !== 429) return signedIn
    await sleep(Number(signedIn.response.headers.get('x-retry-after') ?? 1) * 1000 + 100)
  }
}

/** The link last mailed to `email`, waited for briefly: the apps mail after they answer. */
const linkMailed = async (email: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const link = /https?:\/\/\S+/.exec(mailed.filter((one) => one.to.includes(email)).at(-1)?.text ?? '')?.[0]
    if (link) return new URL(link)
    await sleep(50)
  }
  assert.fail(`no link was mailed to ${email}`)
}

/**
 * Signs `email` up over the socket and proves its address as its owner does, by choosing `password` from the mailed link:
 * a sign-up opens no session until then. Answers the sign-up's own answer.
 */
const provedSignUp = async ({ name, email }: { name: string; email: string }) => {
  const signedUp = await fetch(`${origin}/api/auth/user/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name, email, password: 'typed-at-sign-up' }),
  })
  assert.equal(signedUp.status, 200, `the account is made: ${await signedUp.clone().text()}`)
  const token = (await linkMailed(email)).searchParams.get('token')
  const chosen = await post('/api/auth/user/reset-password', { token, newPassword: password }, { origin })
  assert.equal(chosen.response.status, 200, `the mailed link proves the address: ${JSON.stringify(chosen.body)}`)
  return signedUp
}

test('1. the /api catch-all still forwards every arm to asas.handler, and a path it does not own keeps the handler\'s own 404', async () => {
  const unowned = await fetch(`${origin}/api/not-ours`)
  assert.equal(unowned.status, 404, 'a path under /api that names no procedure comes back 404')
  assert.equal(
    unowned.headers.get('content-type'),
    'text/plain;charset=UTF-8',
    'the 404 is the handler\'s own text/plain body (`packages/mithaq/src/asas/build.ts` `return new Response(\'Not found\', { status: 404 })`) and not the app\'s rendered page',
  )
  assert.equal(await unowned.text(), 'Not found', 'and it carries the handler\'s own two words')

  const anonymous = await post('/api/courses/find', {})
  assert.equal(anonymous.response.status, 403, 'a read with no actor is refused 403 through the plain HTTP arm')
  assert.equal(
    (anonymous.body.data as { key?: string } | undefined)?.key,
    'error.forbidden.read',
    'the refusal carries its key, so the arm answered and not the framework',
  )
})

test('2. a session is signed up and an organization created through the auth arm, and a course is created over the plain HTTP arm', async () => {
  const stamp = Date.now()
  // Better Auth's CSRF check requires the `origin` header a browser sends; `fetch` does not set it.
  actorEmail = `boot-${stamp}@example.com`
  const signUp = await provedSignUp({ name: actorName, email: actorEmail })
  assert.equal((signUp.headers.getSetCookie?.() ?? []).some((one) => one.includes('session_token')), false, 'the sign-up opens no session before its address is proved')
  const signedIn = await signedInOver(actorEmail)
  assert.equal(signedIn.response.status, 200, `the proved account signs in: ${JSON.stringify(signedIn.body)}`)
  cookie = (signedIn.response.headers.getSetCookie?.() ?? []).map((one) => one.split(';')[0]).join('; ')
  assert.ok(cookie, 'with the session cookie the rest of this file is made with')

  // `tenantAccess` keys rows on the active organization, so an actor in none holds no role and is denied.
  organizationName = `Boot ${stamp}`
  const organization = await post('/api/auth/user/organization/create', { name: organizationName, slug: `boot-${stamp}` }, { cookie, origin })
  assert.equal(organization.response.status, 200, `the organization is created: ${JSON.stringify(organization.body)}`)

  const active = await post(
    '/api/auth/user/organization/set-active',
    { organizationId: String(organization.body.id) },
    { cookie, origin },
  )
  assert.equal(active.response.status, 200, `the active organization is set through the auth arm: ${JSON.stringify(active.body)}`)

  // No role assignment here: the template's `afterCreateOrganization` hook writes the tenant's first one.
  const created = await post('/api/courses/create', { title, fee: 300 }, { cookie })
  assert.equal(created.response.status, 200, `the create answers 200: ${JSON.stringify(created.body)}`)
  assert.equal(created.body.title, title, 'the plain HTTP arm answered with the row the runner wrote')
})

test('2b. while no one holds a backoffice role, the backoffice sends sign-in to the first-administrator page, which asks for the setup code, and both close once an administrator exists', async () => {
  assert.equal(await sentTo('/auth/sign-in', '', backofficeOrigin), '/auth/create-first-user', 'sign-in sends a visitor to make the first administrator')
  const page = await fetch(`${backofficeOrigin}/auth/create-first-user`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(html.includes('Create the first administrator') && html.includes('name="code"'), `the page draws the form with a setup code box:\n${html.slice(0, 600)}`)
  const wrong = await post('/api/auth/user/first-register', { name: 'Boot', email: `first-${Date.now()}@example.com`, password, code: 'not-the-code' }, { origin: backofficeOrigin }, backofficeOrigin)
  assert.deepEqual([wrong.response.status, wrong.body.code], [403, 'SETUP_CODE_WRONG'], 'a wrong code is refused')
  await staffAs('super_admin', async () => {
    assert.equal(await sentTo('/auth/create-first-user', '', backofficeOrigin), '/auth/sign-in', 'the page sends everyone to sign-in once an administrator exists')
    assert.equal(await sentTo('/auth/sign-in', '', backofficeOrigin), null, 'where sign-in is served')
    const closed = await post('/api/auth/user/first-register', { name: 'Boot', email: `first-${Date.now()}@example.com`, password, code: setupCode }, { origin: backofficeOrigin }, backofficeOrigin)
    assert.deepEqual([closed.response.status, closed.body.code], [403, 'FIRST_REGISTER_CLOSED'], 'and first-register refuses even the right code')
  })
})

test('3. the list page is server-rendered with the row the create wrote, under the labels the project declared', async () => {
  const response = await fetch(`${origin}/dashboard/courses`, { headers: { cookie } })
  assert.equal(response.status, 200, 'the list page answers 200')
  const html = await response.text()
  assert.ok(html.includes(title), `the course this run created is in the served HTML, so the route resolved it on the server:\n${html.slice(0, 1200)}`)
  for (const label of ['Title', 'Fee', 'Status']) {
    assert.ok(html.includes(`>${label}<`), `the served HTML heads a column with the declared label "${label}"`)
  }
})

test('4. the create page is server-rendered over the same kayan, walking the form node the page declared', async () => {
  const response = await fetch(`${origin}/dashboard/courses/new`, { headers: { cookie } })
  assert.equal(response.status, 200, 'the create page answers 200')
  const html = await response.text()
  assert.ok(html.includes('About the course'), 'the section the page declared is in the served HTML')
  assert.ok(html.includes('Pricing'), 'and so is the section below it')
  assert.ok(html.indexOf('About the course') < html.indexOf('Pricing'), 'in the order the page named them')
  for (const name of ['id', 'organization', 'createdAt', 'updatedAt']) {
    assert.ok(!html.includes(`id="courses-${name}"`), `the create page draws no control for ${name}`)
  }
  assert.ok(!html.includes('name="organization"'), 'and no input carries the organization\'s name for a browser to submit')
})

test('5. the edit page draws no control for a field the server provides, and an edit built the way that form builds one leaves createdAt alone', async () => {
  const made = await post('/api/courses/create', { title: `${title} edited`, fee: 100 }, { cookie })
  assert.equal(made.response.status, 200, `the row to edit is created: ${JSON.stringify(made.body)}`)
  const id = String(made.body.id)
  const createdAt = String(made.body.createdAt)

  const page = await fetch(`${origin}/dashboard/courses/${id}`, { headers: { cookie } })
  assert.equal(page.status, 200, 'the edit page answers 200 for a row that exists')
  const html = await page.text()
  assert.match(html, /data-record="row"/, 'and draws the row')
  for (const name of ['id', 'organization', 'createdAt', 'updatedAt']) {
    assert.equal(new RegExp(`<input[^>]*id="courses-${name}"`).test(html), false, `the served form draws no ${name} control for a browser to submit`)
  }

  const saved = await post('/api/courses/update', { id, title: `${title} saved` }, { cookie })
  assert.equal(saved.response.status, 200, `the update answers 200: ${JSON.stringify(saved.body)}`)
  assert.equal(saved.body.title, `${title} saved`, 'the edit landed')
  assert.equal(String(saved.body.createdAt), createdAt, 'and the row keeps the moment it was created')
  assert.notEqual(String(saved.body.updatedAt), String(made.body.updatedAt), 'while updatedAt is the moment of this write')
})

test('6. the list page serves the limit the screen offers and not the one the URL asked for', async () => {
  const response = await fetch(`${origin}/dashboard/courses?limit=1000000`, { headers: { cookie } })
  assert.equal(response.status, 200, 'an unreasonable limit is not an error, it is a limit the screen did not ask for')
  const html = await response.text()
  assert.ok(!html.includes('1000000'), `the limit the URL asked for reaches nothing:\n${html.slice(0, 600)}`)

  // A `where` the page never offered is refused, not read as a smaller filter:
  // `archiveReason` is not one of the list's filters.
  const filtered = await fetch(`${origin}/dashboard/courses?where[archiveReason][equals]=no-such-reason`, { headers: { cookie } })
  assert.equal(filtered.status, 200, 'a where naming a field the page never made filterable is drawn as a refusal, not an error page')
  const filteredHtml = await filtered.text()
  assert.ok(filteredHtml.includes('data-mithaq-refused='), `the list draws the refusal:\n${filteredHtml.slice(0, 600)}`)
  assert.ok(!filteredHtml.includes(title), 'and no row, because nothing was read')
  assert.ok(html.includes('limit:10'), 'and the page the loader resolved, serialized into the document for hydration, was read at the screen\'s own default of 10')
})

test('7. every dashboard page answers a visitor with no session with a redirect to sign-in, and server-renders no projection to one', async () => {
  // `redirect: 'manual'`: fetch follows a 3xx and the sign-in page answers 200, which would read as the route serving the visitor.
  for (const path of ['/dashboard/courses', '/dashboard/courses/new', '/dashboard', '/dashboard/courses?page=2']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' })
    assert.ok(response.status >= 300 && response.status < 400, `${path} answers a redirect without a session, and not a page: ${response.status}`)
    const location = new URL(response.headers.get('location') ?? '', origin)
    assert.equal(location.pathname, '/auth/sign-in', `and the redirect names the sign-in page for ${path}`)
    // Read as a search parameter, so a changed encoding is not a failure.
    assert.equal(location.searchParams.get('redirect'), path, `and carries the path the visitor asked for, for ${path}`)
    // Followed: a 3xx carries no body, so the claim that no kayan field leaks belongs on the page it leads to.
    const followed = await fetch(`${origin}${path}`)
    assert.equal(followed.status, 200, `following the redirect from ${path} reaches a page`)
    const html = await followed.text()
    assert.ok(html.includes('type="password"'), `which is the sign-in form, so the body below is a page and not an empty 3xx, for ${path}`)
    assert.ok(!html.includes('About the course'), `and the page the projection carries is not in what ${path} led to`)
    assert.ok(!html.includes('archiveReason'), `nor is a field name of the kayan, for ${path}`)
  }

  // Served to a visitor with no session and outside every screen, so no screen shell is drawn around it.
  const page = await fetch(`${origin}/auth/sign-in`)
  assert.equal(page.status, 200, 'the sign-in page is served to a visitor with no session')
  const form = await page.text()
  assert.ok(form.includes('Sign in'), `the sign-in card is in the served HTML:\n${form.slice(0, 600)}`)
  assert.ok(form.includes('type="password"'), 'with the password box the form is for')
  assert.ok(!form.includes('data-shell='), 'and no shell around it, because a shell is a screen\'s and this page is none')
})

test('7b. the sign-in page\'s own arm answers a session cookie for a signed-up actor, refuses a wrong password, and the provider\'s sign-out ends the session it was made with', async () => {
  // The provider's CSRF check requires the `origin` header a browser sends; `fetch` does not set it.
  const stamp = Date.now()
  const email = `signin-${stamp}@example.com`
  await provedSignUp({ name: 'Sign In', email })

  const signedIn = await signedInOver(email)
  assert.equal(signedIn.response.status, 200, `the sign-in the page makes answers 200: ${JSON.stringify(signedIn.body)}`)
  const set = signedIn.response.headers.getSetCookie?.() ?? []
  assert.ok(set.length > 0, 'and answers with the session cookie a screen is then drawn from')

  const wrong = await post('/api/auth/user/sign-in/email', { email, password: 'not-the-password' }, { origin })
  assert.notEqual(wrong.response.status, 200, 'a wrong password is refused')
  assert.equal(typeof wrong.body.message, 'string', `and the refusal carries the sentence the page shows: ${JSON.stringify(wrong.body)}`)

  const mine = set.map((one) => one.split(';')[0]).join('; ')

  // No second sign-up here: the provider allows three `/sign-up/email` calls per ten seconds from one
  // address and the tests above already make all three.

  // Over this throwaway session, not the one the rest of this file uses.
  const signedOut = await post('/api/auth/user/sign-out', {}, { cookie: mine, origin })
  assert.equal(signedOut.response.status, 200, `the sign-out answers 200: ${JSON.stringify(signedOut.body)}`)
  const after = await fetch(`${origin}/dashboard/courses`, { headers: { cookie: mine }, redirect: 'manual' })
  assert.ok(after.status >= 300 && after.status < 400, `and the session it ended no longer reaches a screen: ${after.status}`)
})

test('8. the dashboard shell links each kayan this request\'s own access report lets it read, under the plural the project declared', async () => {
  const report = await fetch(`${origin}/api/access`, { headers: { cookie } })
  assert.equal(report.status, 200, 'the access route answers this session')
  const body = (await report.json()) as { collections: Record<string, { read?: boolean }> }
  assert.equal(body.collections.courses?.read, true, 'and says this actor may read courses')

  const page = await fetch(`${origin}/dashboard`, { headers: { cookie } })
  assert.equal(page.status, 200, 'the screen answers 200')
  const html = await page.text()
  assert.ok(html.includes('href="/dashboard/courses"'), `the served HTML carries the nav entry for courses:\n${html.slice(0, 900)}`)
  assert.ok(html.includes('>Courses<'), 'under the plural the project declared for it')
  assert.ok(!html.includes('href="#"'), 'no sidebar row points at "#"')
  for (const word of ['Quick Create', 'Inbox', 'Documents', 'Get Help']) {
    assert.ok(!html.includes(word), `the sidebar draws no "${word}" row`)
  }

  // The report omits a kayan this actor may not read, so the denied set comes from the build;
  // each kayan crosses in the page as the pair `name:"<kayan>",single:`.
  const denied = [...Object.keys(asas.kayan), ...Object.keys(asas.global)].filter((name) => !(name in body.collections))
  assert.ok(denied.length > 0, 'this session is denied at least one kayan of the build, so the next assertion is not vacuous')
  for (const name of denied) {
    assert.ok(!html.includes(`name:"${name}",single:`), `the document carries nothing of "${name}", which the report leaves out for this session`)
  }
})

test('9. the list page serves a filter, a sort and a hidden column off the URL, and pages through what they matched', async () => {
  // Twelve rows, so page two of the default limit of ten holds two; the route narrows the limit to
  // the per-page control's four, so a smaller limit cannot be asked for.
  const prefix = `Paged ${Date.now()}`
  for (let at = 0; at < 12; at += 1) {
    const made = await post('/api/courses/create', { title: `${prefix} ${String(at).padStart(2, '0')}`, fee: at * 10 }, { cookie })
    assert.equal(made.response.status, 200, `row ${at} is created: ${JSON.stringify(made.body)}`)
  }

  const where = `where[or][0][and][0][title][contains]=${encodeURIComponent(prefix)}`

  // Newest first by default, so the last row written is shown first and the two oldest are on page two.
  const filtered = await fetch(`${origin}/dashboard/courses?${where}`, { headers: { cookie } })
  assert.equal(filtered.status, 200, 'a where the panel could have written is served')
  const firstPage = await filtered.text()
  assert.ok(firstPage.includes(`${prefix} 11`), 'the newest row the filter matched is in the served HTML')
  assert.ok(!firstPage.includes(`${prefix} 00`), 'the oldest of the twelve is not, because ten fit on a page')
  assert.ok(!firstPage.includes(title), `and a course the filter does not match is not there at all:\n${firstPage.slice(0, 600)}`)

  const second = await fetch(`${origin}/dashboard/courses?${where}&sort=fee&page=2`, { headers: { cookie } })
  assert.equal(second.status, 200, 'page two of that filter is served')
  const secondPage = await second.text()
  assert.ok(secondPage.includes(`${prefix} 10`), 'page two carries the eleventh row of the sort')
  assert.ok(secondPage.includes(`${prefix} 11`), 'and the twelfth')
  assert.ok(!secondPage.includes(`${prefix} 00`), 'and not the first, which is on page one')
  assert.ok(secondPage.indexOf(`${prefix} 10`) < secondPage.indexOf(`${prefix} 11`), 'in the ascending order the sort asked for')

  const hidden = await fetch(`${origin}/dashboard/courses?${where}&cols=title,-fee,_status`, { headers: { cookie } })
  assert.equal(hidden.status, 200, 'a column list on the URL is served')
  const hiddenHtml = await hidden.text()
  // Read off the table head: the filter panel also names `Title`, so the whole document would mix two screens.
  const head = /<thead[\s\S]*?<\/thead>/.exec(hiddenHtml)?.[0] ?? ''
  assert.ok(head, `the table has a head:\n${hiddenHtml.slice(0, 600)}`)
  assert.ok(head.includes('>Title<'), 'the column the list kept is still headed')
  assert.ok(!head.includes('>Fee<'), `and the one the URL hid is not:\n${head}`)
  assert.ok(head.includes('>Status<'), 'while the third is untouched')

  // The app's select mounts its items only while open, so a server render carries the chosen field
  // and operator on the triggers, which is where the URL's `where` arrives.
  assert.ok(hiddenHtml.includes('data-mithaq-filters='), 'the where panel is server-rendered beside the table')
  const trigger = (label: string) =>
    new RegExp(`<button[^>]*aria-label="${label}"[\\s\\S]*?</button>`).exec(hiddenHtml)?.[0] ?? ''
  assert.ok(trigger('Field').includes('>Title<'), `the panel names the field this URL filters by:\n${trigger('Field')}`)
  assert.ok(
    trigger('Operator').includes('>contains<'),
    `and the operator it filters with, under the label that tells \`contains\` from \`like\`, which is "matches every word":\n${trigger('Operator')}`,
  )
})

test('10. the empty state says whether the kayan is empty or the filter matched nothing, and only the second offers to clear', async () => {
  const matched = await fetch(`${origin}/dashboard/courses?where[title][equals]=no-such-course-anywhere`, { headers: { cookie } })
  assert.equal(matched.status, 200, 'a filter that matches nothing is not an error')
  const matchedHtml = await matched.text()
  assert.ok(matchedHtml.includes('No rows match this filter.'), `the second sentence is the one served:\n${matchedHtml.slice(0, 600)}`)
  assert.ok(matchedHtml.includes('Clear filters'), 'with the action that takes the filter off')
  assert.ok(!matchedHtml.includes('Nothing here yet.'), 'and not the sentence for an empty kayan')

  const stamp = Date.now()
  const signUp = await provedSignUp({ name: 'Empty Person', email: `empty-${stamp}@example.com` })
  const emptyUser = (await signUp.json()) as { user?: { id?: unknown } }
  const signedIn = await signedInOver(`empty-${stamp}@example.com`)
  assert.equal(signedIn.response.status, 200, `the second session signs in: ${JSON.stringify(signedIn.body)}`)
  const empty = (signedIn.response.headers.getSetCookie?.() ?? []).map((one) => one.split(';')[0]).join('; ')
  const organization = await post('/api/auth/user/organization/create', { name: `Empty ${stamp}`, slug: `empty-${stamp}` }, { cookie: empty, origin })
  assert.equal(organization.response.status, 200, `the second organization is created: ${JSON.stringify(organization.body)}`)
  // Its creator is already its administrator, and a second assignment of one role is refused.
  assert.ok(emptyUser.user?.id)

  const blank = await fetch(`${origin}/dashboard/tags`, { headers: { cookie: empty } })
  assert.equal(blank.status, 200, 'the list page answers a tenant holding no row')
  const blankHtml = await blank.text()
  assert.ok(blankHtml.includes('No tags yet.'), `the first sentence is the one served:\n${blankHtml.slice(0, 600)}`)
  assert.ok(!blankHtml.includes('No rows match this filter.'), 'and not the one for a filter, because there is no filter')
  assert.ok(!blankHtml.includes('Clear filters'), 'so nothing offers to clear one')
  const none2 = await fetch(`${origin}/dashboard/courses`, { headers: { cookie: empty } })
  assert.equal(none2.status, 200, 'the courses list answers the same tenant')
  const noneHtml = await none2.text()
  assert.match(noneHtml, /data-empty="courses\/courses"/, 'with the component its page names')
  assert.ok(!noneHtml.includes('Nothing here yet.'), 'in place of the registry\'s sentence')
})

test('11. a screen crosses only the kayan and the fields the report lets this request read, so a signed-in visitor\'s document names no field the report denies', async () => {
  const report = await fetch(`${origin}/api/access`, { headers: { cookie } })
  assert.equal(report.status, 200, 'the access route answers this session')
  const body = (await report.json()) as { collections: Record<string, { read?: boolean; fields?: Record<string, { read?: boolean }> }> }
  const page = await fetch(`${origin}/dashboard`, { headers: { cookie } })
  const html = await page.text()
  const allowed = new Set(Object.keys(asas.targets.dashboard.client.kayan).filter((name) => body.collections[name]?.read === true))
  const named = new Set([...html.matchAll(/name:"([^"]+)",single:/g)].map((hit) => hit[1]!))
  assert.ok(named.size > 0, 'the document carries the screen it was handed')
  assert.deepEqual(named, allowed, 'the document names exactly the kayan of the screen this session may read')

  // A denied name that a readable field also carries is the one exception, because that field crossing is right.
  const readable = new Set(
    [...allowed].flatMap((kayan) => Object.entries(body.collections[kayan]?.fields ?? {}).filter(([, one]) => one.read === true).map(([field]) => field)),
  )
  const built = { ...asas.kayan, ...asas.global } as unknown as Record<string, { fields: Record<string, unknown> }>
  let swept = 0
  for (const [kayan, { fields }] of Object.entries(built)) {
    for (const field of Object.keys(fields)) {
      if (readable.has(field) || body.collections[kayan]?.fields?.[field]?.read === true) continue
      swept += 1
      assert.ok(!html.includes(`name:"${field}",kind:`), `no field named "${field}" of "${kayan}" crossed into the document`)
    }
  }
  assert.ok(swept > 10, `and the sweep looked for the denied fields rather than skipping over the lot: ${swept}`)
})

test('11b. the blocking script in the head reads the key the theme provider writes, so a chosen theme survives the first paint', async () => {
  // The theme is decided in React after hydration and in a script the document carries for the first
  // paint; only this holds both to the same key.
  const { themeStorageKey } = await import('./asas-tanstack/src/theme.ts')
  const page = await fetch(`${origin}/auth/sign-in`)
  assert.equal(page.status, 200, 'a page is served')
  const html = await page.text()
  assert.ok(
    html.includes(`localStorage.getItem(storageKey)`),
    `the served document carries the blocking script:\n${html.slice(0, 600)}`,
  )
  assert.ok(
    html.includes(`var storageKey = "${themeStorageKey}"`),
    `and it reads the key the provider is handed: ${themeStorageKey}`,
  )
})

test('12. every copy key the copied registry asks for is answered in both of the project\'s locales, so an Arabic viewer reads no English control', async () => {
  // A key the copy table does not answer is no error, since callers write an English fallback;
  // it is an Arabic viewer reading English.
  const { locales, translator } = await import('./asas-tanstack/src/copy.ts')
  const { operatorsByKind } = await import('../packages/mithaq-admin/registry/filter-operators.ts')
  // Registry and routes both ask for keys; only files are read, so the `api` directory is walked past.
  const directories = [
    fileURLToPath(new URL('../packages/mithaq-admin/registry', import.meta.url)),
    fileURLToPath(new URL('./asas-tanstack/src/routes', import.meta.url)),
    ...['mithaq/src/ui', 'asas/src/ui-dashboard', 'asas/src/ui-portal', 'asas/src/ui-backoffice', 'features/roles/roles/ui', 'features/courses/enrollments/ui'].map((where) => fileURLToPath(new URL(`../templates/${where}`, import.meta.url))),
  ]
  const source = [
    ...directories.flatMap((directory) =>
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
        .map((entry) => readFileSync(`${directory}/${entry.name}`, 'utf8')),
    ),
    readFileSync(new URL('./asas-tanstack/src/screens.tsx', import.meta.url), 'utf8'),
  ].join('\n')
  // Single-quoted calls only: a key built as a template literal carries no literal to match, so those are added below.
  const keys = new Set([...source.matchAll(/\bt\(\s*'([a-z][A-Za-z]*\.[A-Za-z.]+)'/g)].map((hit) => hit[1]!))
  // Built from the operator table, so the sweep is not satisfied by the thing it checks.
  for (const operator of new Set(Object.values(operatorsByKind).flat())) keys.add(`operator.${operator}`)
  for (const [name, target] of Object.entries(asas.targets)) {
    if ((target as { capability?: string }).capability === 'screen') keys.add(`screens.${name}`)
  }
  // Nav labels come from the projection, so an entry the copy table forgot fails here instead of
  // showing a raw kayan name.
  for (const target of Object.values(asas.targets) as { capability?: string; client?: ScreenClient }[]) {
    if (target.capability !== 'screen') continue
    for (const entry of target.client!.nav) {
      if (entry.kayan) keys.add(`${entry.kayan}.${target.client!.kayan[entry.kayan]?.single ? 'singular' : 'plural'}`)
    }
  }
  for (const named of ['sessions.plural', 'enrollments.plural', 'tags.plural', 'settings.singular']) {
    assert.ok(keys.has(named), `the sweep found the nav label "${named}"`)
  }
  // Refusal keys: `<kayan>.<field>.invalid` for a refused value, `<kayan>.<field>.<rule>` for a rule, taken from the
  // projection and the rule table so the sweep is not satisfied by the thing it checks. Only a rule with a message writes one.
  const writesKey = (rule: string) => !!defaultRules[rule as keyof typeof defaultRules]?.message
  const courses = asas.targets.dashboard.client.kayan.courses!
  assert.ok(courses.fields.length >= 5, `the projection carries this kayan's fields: ${courses.fields.length}`)
  // This field's whole zod shape is the project's own, so mithaq writes none of its keys; the kayan
  // claims these two under `messages`.
  const ownShape: Record<string, readonly string[]> = { fee: ['courses.fee.invalid', 'courses.fee.min'] }
  for (const field of courses.fields) {
    if (providerOf(field, 'create') !== 'client' && providerOf(field, 'update') !== 'client') continue
    const own = ownShape[field.name]
    if (own) {
      for (const key of own) keys.add(key)
      continue
    }
    keys.add(`courses.${field.name}.invalid`)
    for (const rule of Object.keys(field.rules ?? {}).filter(writesKey)) keys.add(`courses.${field.name}.${rule}`)
  }
  // The same keys one scope deeper, for an operation's own dialog; its schema is the project's, so these
  // are the keys its `archive` names. No `.invalid`: its box sends a string or nothing.
  for (const operation of courses.operations) {
    for (const field of operation.fields ?? []) {
      for (const rule of Object.keys(field.rules ?? {}).filter(writesKey)) {
        keys.add(`courses.operations.${operation.name}.${field.name}.${rule}`)
      }
    }
  }
  for (const named of ['admin.search', 'admin.filters', 'columns.up', 'filter.join', 'operator.like', 'auth.signIn', 'auth.passwordsDiffer', 'admin.navigation', 'portal.home', 'admin.signOut']) {
    assert.ok(keys.has(named), `the sweep found "${named}", so the pattern matched what it is for`)
  }
  assert.ok(keys.size >= 40, `the sweep found every key rather than a handful: ${keys.size}`)

  for (const key of keys) {
    for (const locale of locales) {
      assert.ok(translator(locale)(key), `the project answers "${key}" in "${locale}" rather than leaving the registry's fallback`)
    }
  }
  // Asserted as a difference: an Arabic answer equal to the English one is the fallback coming through.
  for (const key of ['admin.search', 'operator.like']) {
    assert.notEqual(
      translator('ar')(key),
      translator('en')(key),
      `"${key}" reads as Arabic in Arabic and not as the English the registry falls back to`,
    )
  }
})

test('13. a field cleared in the form is saved as empty, and the edit page renders the row back both before and after', async () => {
  // A cleared control holds `null`, so a cleared field is saved as empty; this makes that write over the wire the browser uses.
  const made = await post('/api/courses/create', { title: `${title} clearable`, summary: 'A summary to clear' }, { cookie })
  assert.equal(made.response.status, 200, `the row to clear is created: ${JSON.stringify(made.body)}`)
  assert.equal(made.body.summary, 'A summary to clear', 'and it holds the value the clear is about')
  const id = String(made.body.id)

  const before = await fetch(`${origin}/dashboard/courses/${id}`, { headers: { cookie } })
  assert.equal(before.status, 200, 'the edit page answers 200 for the row')
  const filled = await before.text()
  const input = /<input[^>]*id="courses-summary"[^>]*>/.exec(filled)?.[0] ?? ''
  assert.ok(input, `the served form renders the summary control:\n${filled.slice(0, 600)}`)
  assert.ok(input.includes('A summary to clear'), `holding the stored value, so the control is controlled from the first paint:\n${input}`)

  const saved = await post('/api/courses/update', { id, summary: null }, { cookie })
  assert.equal(saved.response.status, 200, `the update answers 200: ${JSON.stringify(saved.body)}`)
  assert.equal(saved.body.summary, null, 'and the field the form cleared reads back empty')
  assert.equal(saved.body.title, `${title} clearable`, 'while the field nothing touched is unchanged')

  const after = await fetch(`${origin}/dashboard/courses/${id}`, { headers: { cookie } })
  assert.equal(after.status, 200, 'the edit page still answers 200 over the cleared row')
  const cleared = await after.text()
  assert.match(cleared, /data-record="row"/, 'drawing the row')
  assert.ok(!cleared.includes('A summary to clear'), 'with the cleared value gone from the control')
})

test('15. a raw sign-in cookie lands with its active organization and reaches a screen with no page step between', async () => {
  // The provider sets the active organization when the session is made and every row is keyed on it,
  // so the list page reads rows on the first request the cookie is used for.
  const signedIn = await signedInOver(actorEmail)
  assert.equal(signedIn.response.status, 200, `the actor of test 2 signs in again: ${JSON.stringify(signedIn.body)}`)
  const fresh = (signedIn.response.headers.getSetCookie?.() ?? []).map((one) => one.split(';')[0]).join('; ')
  assert.ok(fresh, 'and the sign-in answers a session cookie of its own')

  const before = await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie: fresh } })
  const held = (await before.json()) as { session?: { activeOrganizationId?: string | null } } | null
  assert.ok(held?.session?.activeOrganizationId, `the fresh session carries its organization before any page is loaded: ${JSON.stringify(held)}`)

  const page = await fetch(`${origin}/dashboard/courses`, { headers: { cookie: fresh } })
  assert.equal(page.status, 200, 'the list page answers that cookie on the first request it is used for')
  const html = await page.text()
  assert.ok(html.includes('data-shell="app"'), `with the shell around it:\n${html.slice(0, 600)}`)
  assert.ok(html.includes(title), 'and the row the create wrote, so the read ran under that organization')
})

test('16. the path a redirect carries is honoured only when it names this origin', async () => {
  // The query is the one part of the sign-in URL somebody else writes, so what the page does with it is a security boundary.
  const { wanted } = await import('./asas-tanstack/src/redirect.ts')
  assert.equal(wanted({ asked: '/dashboard/courses/abc', home: '/dashboard' }), '/dashboard/courses/abc', 'a path of this origin is where sign-in returns')
  assert.equal(wanted({ asked: '/dashboard/courses?page=2', home: '/dashboard' }), '/dashboard/courses?page=2', 'with its search kept, because the screen sends the whole location')
  assert.equal(wanted({ asked: undefined, home: '/dashboard' }), '/dashboard', 'no path at all lands on the home it is handed')
  assert.equal(wanted({ asked: '', home: '/dashboard' }), '/dashboard', 'and neither does an empty one')
  // The URL parser rewrites a backslash to a slash and strips a C0 control before reading the host, so a
  // check on the first character alone lets those through; a scheme carries no slash at all.
  assert.equal(wanted({ asked: 'https://elsewhere.example/steal', home: '/dashboard' }), '/dashboard', 'an absolute URL naming another origin is refused')
  assert.equal(wanted({ asked: '//elsewhere.example/steal', home: '/dashboard' }), '/dashboard', 'and so is a protocol-relative path, which names another origin while starting with a slash')
  assert.equal(wanted({ asked: 'courses', home: '/dashboard' }), '/dashboard', 'and a value that is no path at all')
  assert.equal(wanted({ asked: '/\\evil.example', home: '/dashboard' }), '/dashboard', 'a backslash after the slash, which the parser reads as the second slash of another origin')
  assert.equal(wanted({ asked: '/\\/evil.example', home: '/dashboard' }), '/dashboard', 'and a backslash before a slash, which it reads the same way')
  assert.equal(wanted({ asked: '/\t/evil.example', home: '/dashboard' }), '/dashboard', 'and a control character between the two slashes, which it strips before it reads the host')
  assert.equal(wanted({ asked: 'javascript:alert(1)', home: '/dashboard' }), '/dashboard', 'and a scheme that is no origin at all')
  assert.equal(wanted({ asked: undefined, home: '/backoffice' }), '/backoffice', 'no path at all lands on the home it is handed')
  assert.equal(wanted({ asked: '//elsewhere.example/steal', home: '/backoffice' }), '/backoffice', 'and another origin is refused there too')
})

test('17. every page of every kayan the access report lets this session read answers, and a path no page has answers 404', async () => {
  // One route answers every page of a screen, so the claim is over the whole screen, not one list.
  const report = await fetch(`${origin}/api/access`, { headers: { cookie } })
  assert.equal(report.status, 200, 'the access route answers this session')
  const body = (await report.json()) as { collections: Record<string, { read?: boolean }> }
  const listed = Object.values(asas.targets.dashboard.client.kayan).filter((one) => body.collections[one.name]?.read === true && Object.keys(one.pages).length > 0)
  assert.ok(listed.length >= 2, `this actor reads more than one kayan, so the sweep is not one screen again: ${listed.length}`)
  assert.ok(listed.some((one) => one.single), 'and one of them is a global, so the page that draws a global is walked')

  for (const kayan of listed) {
    const path = `/dashboard${(kayan.pages.list ?? Object.values(kayan.pages)[0]!).path}`
    const page = await fetch(`${origin}${path}`, { headers: { cookie } })
    assert.equal(page.status, 200, `${path} answers 200`)
    const html = await page.text()
    assert.ok(html.includes('data-shell="app"'), `${path} is drawn inside the shell`)
    assert.ok(!html.includes('read access denied'), `and ${path} carries no refusal in place of the screen`)
    if (kayan.single) assert.ok(html.includes(`id="${kayan.name}-`), `the global ${path} draws a control for a field of its own`)
    else if (kayan.pages.create) assert.ok(html.includes(`href="/dashboard${kayan.pages.create.path}"`), `the list ${path} links to its own create page`)
  }

  // A name no kayan has, a path outside every screen and two shapes of row URL that name no row are all a not-found:
  // the root route's for the path outside every screen, the screen page route's for the rest, whose loader answers null.
  for (const path of ['/nope', '/dashboard/nope', '/dashboard/nope/new', '/dashboard/settings/anything', '/dashboard/courses/abc', `/dashboard/courses/${randomUUID()}`]) {
    const missing = await fetch(`${origin}${path}`, { headers: { cookie } })
    assert.equal(missing.status, 404, `${path} answers 404`)
    assert.ok(
      (await missing.text()).includes('That page does not exist.'),
      `and carries the sentence the project wrote for it, for ${path}`,
    )
  }
})

test('18. only a refusal the caller caused turns a row read into the not-found page; anything else the read throws is rethrown', async () => {
  // A read that fails for a reason the caller did not cause must reach the error boundary as a 500, not a
  // missing row; provoking one over a socket means breaking the database, so the predicate is asserted directly.
  const { caused } = await import('./asas-tanstack/src/api.ts')
  const { invalid, missing } = await import('../packages/mithaq/src/asas/runner/errors.ts')
  // Built by the helpers the read itself throws through, so a status that stopped being a number is caught.
  assert.equal(caused(invalid({ message: 'id: Invalid GUID', key: 'error.invalid.value' })), true, 'a 400 the caller caused is the caller\'s')
  assert.equal(caused(missing({ message: 'No such row', key: 'error.not_found.row' })), true, 'and so is a 404')
  for (const thrown of [new Error('the connection was closed'), new TypeError('x is not a function'), 'a string', null, undefined, {}]) {
    assert.equal(caused(thrown), false, `${String(thrown)} is not a refusal the caller caused, so the loader rethrows it`)
  }
})

test('19. the locale a request carries in its cookie is the document it is served, and a locale this project does not declare is English', async () => {
  // The locale is resolved once per request before any route runs, and read off the served HTML:
  // a `lang` and `dir` written after hydration would be the flash this guards against.
  const { translator } = await import('./asas-tanstack/src/copy.ts')
  const arabic = translator('ar')
  const english = translator('en')

  const page = await fetch(`${origin}/dashboard/courses`, { headers: { cookie: `${cookie}; locale=ar` } })
  assert.equal(page.status, 200, 'the list page answers the same 200 in Arabic')
  const html = await page.text()
  assert.ok(html.includes('lang="ar"'), `the document names the locale it was asked for:\n${html.slice(0, 400)}`)
  assert.ok(html.includes('dir="rtl"'), 'and runs the way that locale runs')
  // Two labels from two scopes and files, so this is the document in Arabic and not one translated string.
  for (const key of ['admin.search', 'courses.plural']) {
    const written = arabic(key)!
    assert.notEqual(written, english(key), `"${key}" reads differently in the two locales, so the next assertion can fail`)
    assert.ok(html.includes(written), `the Arabic document carries "${written}" for "${key}"`)
  }
  assert.ok(!html.includes('>Courses<'), 'and carries none of the English the same screen reads without the cookie')

  // An undeclared locale is refused: `lang="xx"` would claim a locale nothing can be read in.
  for (const asked of ['xx', 'ar-SA', '', 'en']) {
    const other = await fetch(`${origin}/dashboard/courses`, { headers: { cookie: `${cookie}; locale=${asked}` } })
    assert.equal(other.status, 200, `the list page answers 200 for the cookie "${asked}"`)
    const served = await other.text()
    assert.ok(served.includes('lang="en"'), `"${asked}" is not one of this project's locales, so the document is English`)
    assert.ok(served.includes('dir="ltr"'), `and runs left to right for "${asked}"`)
  }
  const bare = await fetch(`${origin}/dashboard/courses`, { headers: { cookie } })
  assert.ok((await bare.text()).includes('lang="en"'), 'a request carrying no locale cookie reads in English')
})

test('20. a server function reached with a foreign origin is refused by start.ts\'s own csrf middleware, and every other request in this file is untouched', async () => {
  // The framework classifies a server function by the URL prefix alone, before the id is read, so a
  // made-up id is refused like a real one such as `loadScreen`.
  const foreign = await fetch(`${origin}/_serverFn/made-up-id`, {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(foreign.status, 403, 'a server function call carrying another origin is refused before its id is even read')
  assert.equal(await foreign.text(), 'Forbidden', 'with the middleware\'s own two words')

  // Every other request here has no `origin` header or this server's own, or lands on a page or the plain
  // `/api` route, so the earlier tests passing in the same run is the proof.
})

test('21. the cookie the user menu\'s locale entry writes is the one the middleware reads back, so the switch serves an Arabic document', async () => {
  // The click cannot be made here, so the cookie string the menu writes is replayed as the reload's request,
  // parsed as a browser does: name and value up to the first semicolon, since attributes never travel in `Cookie`.
  const { localeCookieValue } = await import('./asas-tanstack/src/copy.ts')
  for (const [asked, lang, dir] of [['ar', 'ar', 'rtl'], ['en', 'en', 'ltr']] as const) {
    const written = localeCookieValue(asked)
    assert.ok(written.startsWith(`locale=${asked};`), `the menu writes the cookie as "locale=${asked}" with its attributes after it: ${written}`)
    assert.ok(written.includes('Path=/'), 'at the root, so every screen is served in the chosen locale')
    const sent = written.split(';')[0]!
    const page = await fetch(`${origin}/dashboard/courses`, { headers: { cookie: `${cookie}; ${sent}` } })
    assert.equal(page.status, 200, `the list page answers 200 after a switch to "${asked}"`)
    const html = await page.text()
    assert.ok(html.includes(`lang="${lang}"`), `and the reloaded document is the one the switch asked for: lang="${lang}"`)
    assert.ok(html.includes(`dir="${dir}"`), `running the way that locale runs: dir="${dir}"`)
  }
})

test('21b. both screens draw the user menu inside their own shell, where the sign-out and the locale switch now sit', async () => {
  // The menu's rows are drawn when it opens, which a server render never does, so the document carries only the trigger.
  for (const [path, shell] of [['/dashboard', 'app'], ['/portal', 'top']] as const) {
    const response = await fetch(`${origin}${path}`, { headers: { cookie } })
    assert.equal(response.status, 200, `${path} answers 200`)
    const html = await response.text()
    assert.ok(!html.includes('data-screen-bar'), `${path} draws no frame bar of the host's own above the shell`)
    const trigger = /<button[^>]*data-slot="dropdown-menu-trigger"[^>]*data-sidebar="menu-button"[\s\S]*?<\/button>/g
    const menus = html.slice(html.indexOf(`data-shell="${shell}"`)).match(trigger) ?? []
    assert.ok(menus.some((one) => one.includes(actorEmail)), `${path} draws the user menu naming the viewer inside its ${shell} shell:\n${html.slice(0, 600)}`)
  }
})

const screened: Record<string, string> = {}
let screenCourse = ''
let screenTitle = ''
let screenSession = ''
let screenTag = ''
const screenHtml = async (path: string) => {
  const response = await fetch(`${origin}${path}`, { headers: { cookie } })
  assert.equal(response.status, 200, `${path} answers 200`)
  return (screened[path] = await response.text())
}

test('36. each screen answers at its own path inside its providers and shell, and its own path draws its dashboard', async () => {
  screenTitle = `Screens ${Date.now()}`
  const course = await post('/api/courses/create', { title: screenTitle, fee: 120, currency: 'SAR', audience: 'beginner', delivery: 'live', accessCode: 'LIVE01' }, { cookie })
  assert.equal(course.response.status, 200, JSON.stringify(course.body))
  screenCourse = String(course.body.id)
  const session = await post('/api/sessions/create', { course: screenCourse, startsAt: new Date().toISOString(), capacity: 12 }, { cookie })
  assert.equal(session.response.status, 200, JSON.stringify(session.body))
  screenSession = String(session.body.id)
  const tag = await post('/api/tags/create', { name: { en: `tag-${Date.now()}`, ar: `وسم-${Date.now()}` } }, { cookie })
  assert.equal(tag.response.status, 200, JSON.stringify(tag.body))
  screenTag = String(tag.body.id)

  const screen = await screenHtml('/dashboard')
  assert.match(screen, /data-provider="theme"/, 'the dashboard folds its provider')
  assert.ok(screen.indexOf('data-provider="theme"') < screen.indexOf('data-shell="app"'), 'around its shell')
  assert.match(screen, /data-dashboard="dashboard"/, 'and draws its dashboard at its own path')
  const sidebar = /data-slot="sidebar-content"[\s\S]*?<\/ul>/.exec(screen.slice(screen.indexOf('data-slot="sidebar"')))?.[0] ?? ''
  assert.match(screen.slice(screen.indexOf('data-slot="sidebar"')), /^[\s\S]*?<nav aria-label="Navigation"[^>]*><div[^>]*data-slot="sidebar-header"/, 'the one named navigation landmark opens the sidebar around its header')
  assert.deepEqual(
    [...sidebar.matchAll(/href="([^"]+)"/g)].map((hit) => hit[1]),
    ['/dashboard', '/dashboard/members', '/dashboard/activity', '/dashboard/courses', '/dashboard/sessions', '/dashboard/enrollments', '/dashboard/tags', '/dashboard/media', '/dashboard/roles', '/dashboard/settings'],
    `the dashboard sidebar links the dashboard and every entry this administrator may open, and no Member roles:\n${sidebar.slice(0, 600)}`,
  )
  assert.match(screen, /data-slot="sidebar-footer"[\s\S]*data-slot="dropdown-menu-trigger"/, 'with the user menu at the sidebar\'s foot')
  // The page's loader reads the figures on the server as the viewer, so none waits for hydration.
  for (const kpi of ['courses', 'fees', 'enrollments', 'recent']) assert.match(screen, new RegExp(`data-kpi="${kpi}"`), `the dashboard draws its ${kpi} card`)
  const figure = (kpi: string) => new RegExp(`data-kpi="${kpi}"[\\s\\S]*?data-slot="card-title"[^>]*>([^<]*)<`).exec(screen)?.[1]
  const total = async (kayan: string) => String((await post(`/api/${kayan}/count`, {}, { cookie })).body.totalDocs)
  assert.equal(figure('courses'), await total('courses'), 'the served HTML carries the number of courses this viewer may read')
  assert.equal(figure('enrollments'), await total('enrollments'), 'and the number of enrollments')
  assert.match(screen, /data-chart-card="enrollments"[\s\S]*data-slot="chart"/, 'and its enrollments chart')
  const portal = await screenHtml('/portal')
  assert.match(portal, /data-shell="top"/, 'the portal draws the top shell the two screens share')
  assert.match(portal, /data-dashboard="portal"/, 'and its own home')
  assert.ok(portal.includes('href="/portal/courses"') && portal.includes('href="/portal/enrollments"'), 'linking its two kayan')
  assert.ok(!portal.includes('href="/portal/tags"'), 'and no kayan it does not list')

  const signedOut = await fetch(`${origin}/portal/courses`, { redirect: 'manual' })
  assert.equal(signedOut.status, 307, 'a screen answers a visitor with no session with a redirect')
  assert.match(signedOut.headers.get('location') ?? '', /\/auth\/sign-in/, 'to sign-in')
})

test('37. the dashboard list page draws its layout and its list node: the columns, the search and a row link to the edit page', async () => {
  const html = await screenHtml('/dashboard/courses')
  assert.match(html, /data-layout="table" data-page="\/courses"/, 'the registered table layout draws the page')
  for (const label of ['Title', 'Fee', 'Status', 'Opens on']) assert.ok(html.includes(`>${label}<`), `the list node's column ${label}`)
  assert.ok(html.includes(`href="/dashboard/courses/${screenCourse}"`), 'a row links to its edit page on this screen')
  assert.ok(html.includes('href="/dashboard/courses/new"'), 'and the create button to the create page')
  assert.match(html, /placeholder="Title, Summary, or Details"/, 'the search runs over the node\'s three fields')
})

test('38. the dashboard create page draws the edit page\'s Details sections and Catalogue side in the record layout, and nothing that needs a row', async () => {
  const html = await screenHtml('/dashboard/courses/new')
  assert.match(html, /data-layout="record" data-page="\/courses\/new" data-record="none"/, 'the record layout draws a create')
  assert.ok(html.indexOf('id="courses-tags"') > html.indexOf('data-region="side"'), 'tags sit in the side region')
  const edit = await screenHtml(`/dashboard/courses/${screenCourse}`)
  const headings = (page: string) => ['About the course', 'Pricing', 'Teaching', 'Catalogue'].map((label) => page.indexOf(`>${label}<`))
  assert.ok(headings(html).every((at, index, all) => at > 0 && (index === 0 || at > all[index - 1]!)), `the create page draws About, Pricing, Teaching and Catalogue in order: ${headings(html)}`)
  assert.ok(headings(edit).every((at) => at > 0), 'and so does the edit page')
  assert.ok(html.indexOf('for="courses-notifications"') > html.indexOf('>Teaching<'), 'notifications sit in Teaching')
  assert.ok(!html.includes('data-panel="activity"') && !html.includes('data-region="danger"') && !html.includes('data-slot="tabs-trigger"'), 'and a create draws no activity, no danger zone and no tab, Sessions and Versions among them')
  assert.ok(edit.includes('data-panel="activity"') && edit.includes('data-region="danger"') && edit.includes('data-slot="tabs-trigger"'), 'which the edit page draws beside the same sections')
  assert.ok(!html.includes('courseActivityPanel'), 'no placeholder panel')
  assert.ok(!html.includes('id="courses-archivedAt"'), 'and nothing the page names nowhere')
})

test('39. the dashboard course pages draw every control a course field they name decides', async () => {
  const html = screened['/dashboard/courses/new']!
  assert.match(html, /id="courses-title"[^>]*type="text"|type="text"[^>]*id="courses-title"/, 'text')
  assert.match(html, /data-slot="switch"/, 'switch')
  // A create draws no Archived since a new course is never archived, so the checkbox is the edit page's.
  assert.match(await screenHtml(`/dashboard/courses/${screenCourse}`), /data-slot="checkbox"/, 'checkbox')
  assert.match(html, /id="courses-fee"[^>]*type="number"|type="number"[^>]*id="courses-fee"/, 'number')
  assert.match(html, /data-slot="select-trigger"/, 'select')
  assert.match(html, /data-slot="radio-group-item"/, 'radio')
  assert.match(html, /id="courses-tags"/, 'relationship')
  // The access code follows a live delivery, which a create holds only once
  // one is picked; the course this file made is live.
  assert.match(await screenHtml(`/dashboard/courses/${screenCourse}`), /data-slot="input-otp-slot"/, 'otp')
})

test('40. the dashboard edit page carries the row, a leaf read-only on this page alone, and the danger zone its button asks for', async () => {
  const html = await screenHtml(`/dashboard/courses/${screenCourse}`)
  assert.match(html, /data-record="row"/, 'the layout gets the row')
  assert.match(html, /data-field-value="archived"/, 'archived is read-only here, read as text')
  assert.equal(html.includes('id="courses-archived"'), false, 'and no control')
  assert.ok(html.includes('Danger zone') && html.includes('>Archive<'), 'and archive sits in the danger zone')
  const zone = html.slice(html.indexOf('data-region="danger"'))
  assert.ok(zone.indexOf('>Archive<') > 0 && zone.indexOf('data-button="delete"') > zone.indexOf('>Archive<'), 'the delete sits in the danger zone, after the archive')
  const header = html.slice(html.indexOf('data-region="header"'), html.indexOf('</header>'))
  assert.ok(header.includes('>Publish changes<') && header.includes('>Back to list<') && header.includes('>Save draft<') && !header.includes('>Delete<'), 'and the controls hold Back to list beside the autosaved draft, Save draft and Publish changes, and no delete')
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'))
  assert.ok(!form.includes('type="submit"') && !form.includes('>Delete<'), 'while the form draws no save and no delete of its own')
  assert.ok(!html.includes('courseActivityPanel'), 'with no placeholder panel on the page')
})

test('41. a custom page by inline path draws the same file the registered name does', async () => {
  const html = await screenHtml('/dashboard/courses/board')
  assert.match(html, /data-layout="table" data-page="\/courses\/board"/, 'the layout its inline path names')
  assert.match(html, /data-empty="courses\/courses\/board"/, 'and the component its inline path names, handed the page')
})

test('42. the dashboard draws the session, tag and settings controls, a role\'s keys as badges, a localized name as one box per locale, and no id no page names', async () => {
  const sessions = await screenHtml('/dashboard/sessions/new')
  assert.match(sessions, /<button[^>]*id="sessions-startsAt"[\s\S]*?data-time-field/, 'datetime, a date picker and its time of day')
  assert.match(sessions, /id="sessions-course"/, 'relationship')
  assert.match(sessions, /data-slot="select-trigger"[^>]*id="sessions-venue"|id="sessions-venue"[^>]*data-slot="select-trigger"/, 'nativeSelect is the select')
  assert.ok(!sessions.includes('data-slot="native-select"'), 'and no native box is drawn')
  assert.match(sessions, /id="sessions-format"[^>]*role="combobox"/, 'combobox')
  const tag = await screenHtml(`/dashboard/tags/${screenTag}`)
  assert.ok(!tag.includes('id="tags-id"'), 'no id, because the page names none')
  assert.ok(tag.includes('id="tags-name"') && tag.includes('id="tags-name-ar"'), 'the name, once per locale, the viewer\'s own first')
  const roles = await screenHtml('/dashboard/roles/new')
  assert.ok(roles.includes('data-role-form') && roles.includes('data-key="courses.find"') && !roles.includes('<textarea'), 'a role\'s keys are badges')
  assert.ok(roles.includes('id="roles-label-en"') && roles.includes('id="roles-label-ar"'), 'beside its label, once per locale')
  const settings = await screenHtml('/dashboard/settings')
  assert.match(settings, /type="email"/, 'email')
  assert.match(settings, /role="switch"/, 'switch')
})

test('43. a session\'s edit is a page of its own in the editor layout, a create opens as the full-page drawer over the dashboard list, and the portal\'s enrollment create is a page of its own in the portal\'s shell', async () => {
  const page = await screenHtml(`/dashboard/sessions/${screenSession}`)
  assert.ok(!page.includes('data-record-mode='), 'no dialog over the list')
  assert.match(page, /data-layout="record" data-page="\/sessions\/:id"/, 'the record layout')
  assert.match(page, /data-region="side"[\s\S]*id="sessions-course"/, 'the course in the side column')
  const tag = await screenHtml('/dashboard/tags/new')
  assert.match(tag, /data-record-mode="drawer"/, 'a drawer')
  assert.match(tag, /data-layout="table" data-page="\/tags"/, 'over the tags list')
  const made = await screenHtml('/portal/enrollments/new')
  assert.ok(!made.includes('data-record-mode='), 'no drawer, since the portal\'s list is drawn whole')
  assert.match(made, /data-portal=""[\s\S]*data-layout="page" data-page="\/enrollments\/new"/, 'a page of its own in the portal\'s shell')
})

test('44. the portal draws its catalogue and a course\'s page whole, in its own look and with no admin table or form', async () => {
  const list = await screenHtml('/portal/courses')
  assert.match(list, /data-portal=""/, 'the portal\'s own shell')
  assert.match(list, /<input[^>]*type="search"/, 'with the catalogue\'s search')
  assert.ok(!list.includes('<table') && !list.includes('<form'), 'and no table or form')
  const view = await screenHtml(`/portal/courses/${screenCourse}`)
  assert.ok(view.includes(screenTitle), 'a course\'s page names it from the first paint')
  assert.match(view, /aria-label="Back to courses"/, 'with the way back to the catalogue')
  assert.ok(!view.includes('<form') && !view.includes('data-region="danger"'), 'and no form or danger zone')
})

test('45. a user who switches organization keeps it: no screen load sets it back', async () => {
  // Creating a second organization makes it the session's active one, a switch; a screen load must leave that choice alone.
  const active = async () =>
    ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { session: { activeOrganizationId: string | null } }).session.activeOrganizationId
  const first = await active()
  assert.ok(first, 'the session works in the organization test 2 created')
  const stamp = Date.now()
  const second = await post('/api/auth/user/organization/create', { name: `Second ${stamp}`, slug: `second-${stamp}` }, { cookie, origin })
  assert.equal(second.response.status, 200, `a second organization is created: ${JSON.stringify(second.body)}`)
  assert.equal(await active(), String(second.body.id), 'and the session works in it now')
  assert.ok(!(await screenHtml('/dashboard/courses')).includes(screenTitle), 'whose list holds none of the first organization\'s rows')
  assert.equal(await active(), String(second.body.id), 'and the screen load kept the organization the user chose')

  const back = await post('/api/auth/user/organization/set-active', { organizationId: first }, { cookie, origin })
  assert.equal(back.response.status, 200, `the session switches back: ${JSON.stringify(back.body)}`)
  assert.ok((await screenHtml('/dashboard/courses')).includes(screenTitle), 'and reads the first organization\'s rows again')
  assert.equal(await active(), first, 'still in the organization it switched back to')
})

/**
 * Asserts every node kind, control and mode one screen's `screen.json` declares by its marker in the served pages.
 * A page opening over its list draws its form in a portal a server render skips, so only its mode is asserted.
 */
const walkScreen = async (name: 'dashboard' | 'portal') => {
  const screen = JSON.parse(readFileSync(new URL(`./asas-tanstack/src/routes/(screens)/${name}/screen.json`, import.meta.url), 'utf8')) as {
    path: string
    layouts: Record<string, string>
    pages: Record<string, { path: string }>
    kayan: Record<string, {
      fields: { name: string; prefix?: Record<string, string>; suffix?: Record<string, string> }[]
      pages: Record<string, { path: string; mode?: string; page?: Record<string, unknown>; component?: string }>
    }>
  }
  // A layout's `when` is its condition, not a region.
  const regionsOf = (frame: Record<string, unknown>) => Object.entries(frame).filter(([key]) => !['shell', 'layout', 'when'].includes(key)).map(([, nodes]) => nodes as unknown[])
  // A student holds one seat in a session, so the second screen's walk reads the seat the first one made.
  const seated = ((await post('/api/enrollments/find', { where: { session: { equals: screenSession } }, limit: 1 }, { cookie })).body.docs as { id: string }[])[0]
  const enrollment = seated ? { response: { status: 200 }, body: seated } : await asStudent(() => post('/api/enrollments/create', { session: screenSession }, { cookie }))
  assert.equal(enrollment.response.status, 200, JSON.stringify(enrollment.body))
  const ids: Record<string, string> = { courses: screenCourse, sessions: screenSession, tags: screenTag, enrollments: String(enrollment.body.id) }
  for (const kayan of ['roles', 'memberRoles']) {
    const found = await post(`/api/${kayan}/find`, { limit: 1 }, { cookie })
    const first = (found.body.docs as { id: string }[] | undefined)?.[0]
    if (first) ids[kayan] = first.id
  }
  const expected: [string, RegExp][] = []
  let affixes = 0
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const walk = (kayan: string, nodes: unknown[], inForm: boolean) => {
    for (const node of nodes as Record<string, unknown>[]) {
      if (typeof node.field === 'string') {
        if (!inForm) continue
        const id = `${kayan}-${node.field}`
        if (node.readOnly === true) {
          expected.push([`read-only value of ${id}`, new RegExp(`data-field-value="${escape(String(node.field))}"`)])
          continue
        }
        expected.push([`control ${node.component} on ${id}`, new RegExp(`data-control="${escape(String(node.component))}"(?:(?!data-control=)[^])*?for="${id}"`)])
        const placeholder = (node.placeholder as Record<string, string> | undefined)?.en
        if (placeholder) expected.push([`placeholder of ${id}`, new RegExp(`placeholder="${escape(placeholder)}"`)])
        const declared = screen.kayan[kayan]!.fields.find((one) => one.name === node.field)
        for (const [key, align] of [['prefix', 'inline-start'], ['suffix', 'inline-end']] as const) {
          const copy = declared?.[key]?.en
          if (!copy) continue
          affixes += 1
          expected.push([`${key} of ${id}`, new RegExp(`data-align="${align}"[^>]*>(?:<[^>]+>)*${escape(copy)}<`)])
        }
        continue
      }
      const kind = 'layout' in node ? 'layout' : ['form', 'list', 'button', 'title', 'nav', 'controls', 'component', 'row', 'separator', 'section', 'tabs', 'accordion'].find((one) => one in node)!
      expected.push([`node ${kind}`, new RegExp(`data-node="${kind}"`)])
      if (kind === 'layout') {
        for (const nodes of regionsOf(node)) walk(kayan, nodes, inForm)
        continue
      }
      // A form node that names a component is drawn by it, so none of its leaves is a control to look for.
      if (kind === 'form' && node.component) continue
      if (kind === 'row' && node.resizable) expected.push(['a resizable row', /data-slot="resizable-panel-group"/])
      if (kind === 'section' && node.scroll) expected.push(['a scrolling section', /data-slot="scroll-area"/])
      const inner = kind === 'form' ? node.form : kind === 'row' ? node.row : kind === 'section' ? node.fields
        : kind === 'tabs' ? (node.tabs as { fields: unknown[] }[]).flatMap((tab) => tab.fields)
        : kind === 'accordion' ? (node.accordion as { fields: unknown[] }[]).flatMap((item) => item.fields) : []
      walk(kayan, inner as unknown[], inForm || kind === 'form')
    }
  }
  let html = ''
  for (const [kayan, { pages }] of Object.entries(screen.kayan)) {
    for (const page of Object.values(pages)) {
      if (page.path.includes(':id') && !ids[kayan]) continue
      html += await screenHtml(`${screen.path}${page.path.replace(':id', encodeURIComponent(ids[kayan] ?? ''))}`)
      if (page.mode) {
        expected.push([`mode ${page.mode}`, new RegExp(`data-record-mode="${page.mode}"`)])
        continue
      }
      if (!page.page) continue
      const shell = Object.entries(screen.layouts).find(([, file]) => file === page.page!.shell)![0]
      expected.push([`shell ${shell}`, new RegExp(`data-shell="${shell}"`)])
      for (const [region] of Object.entries(page.page).filter(([key]) => key !== 'shell')) expected.push([`${shell} region ${region}`, new RegExp(`data-region="${region}"`)])
      // A page whose tree holds a form is drawn by the form from its shell
      // down, so every leaf on it is a control.
      const holdsForm = JSON.stringify(page.page).includes('"form":[')
      for (const nodes of regionsOf(page.page)) walk(kayan, nodes, holdsForm)
    }
  }
  for (const page of Object.values(screen.pages)) html += await screenHtml(`${screen.path}${page.path === '/' ? '' : page.path}`)
  assert.ok(expected.length > 10, `the walk found what ${name} declares: ${expected.length}`)
  // The portal's courses are drawn whole, so its trees, the enrollment's two forms, hold no field with an affix.
  if (name === 'dashboard') assert.ok(affixes >= 2, `and ${name} draws a field with a prefix and one with a suffix: ${affixes}`)
  for (const [what, marker] of expected) assert.match(html, marker, `${name} draws ${what}`)
}

test('46. the dashboard screen draws every node kind, decided control and mode its screen.json declares', () => walkScreen('dashboard'))
test('47. the portal screen draws every node kind, decided control and mode its screen.json declares', () => walkScreen('portal'))

test('47b. every kayan\'s list is the registry\'s one table, a form node that names a component draws through it while the host supplies the data, and a button asks its confirm', async () => {
  const enrollments = await screenHtml('/dashboard/enrollments')
  assert.ok(enrollments.includes('<table') && !enrollments.includes('data-enrollment-cards'), 'the enrollments list is the table')
  assert.match(enrollments, /<tr[^>]*data-row="[0-9a-f-]{36}"[^>]*>/, 'a row per enrollment')
  assert.match(enrollments, /href="\/dashboard\/enrollments\/[0-9a-f-]{36}"/, 'each linked to its own page')
  assert.ok(enrollments.includes('href="/dashboard/enrollments/new"'), 'and the link to a new one')
  // A custom role, since a fixed one opens read-only and draws no form.
  const made = await post('/api/roles/create', { name: `form-${Date.now()}`, label: { en: 'Test role', ar: 'دور تجريبي' }, permissions: ['tags.find', 'tags.fields.id'] }, { cookie })
  assert.equal(made.response.status, 200, JSON.stringify(made.body))
  const role = made.body as { id: string; name: string }
  const edit = await screenHtml(`/dashboard/roles/${role.id}`)
  assert.match(edit, /data-role-form=""/, 'the role edit form is drawn by the project\'s own component')
  assert.ok(edit.includes(`value="${role.name}"`), 'handed the values the form read')
  assert.ok(edit.includes('>Save<'), 'and the form still draws its save around it')
  // A confirm is the browser's own dialog, so a server render carries the button and nothing of the question.
  const course = await screenHtml(`/dashboard/courses/${screenCourse}`)
  // The Sessions tab's bulk archive is the sessions kayan's own and sits before it.
  assert.ok(course.indexOf('>Archive<', course.indexOf('data-region="danger"')) > 0, 'the archive button sits in the danger region it was put in')
})

test('48. a screen load slides the session\'s expiry forward through the provider\'s own refresh', async () => {
  // The screen's organization reads run the provider's session middleware, which refreshes a session past its `updateAge`.
  // The row is read and written through the store, because every provider route would slide it on its own.
  const store = asas.targets.drizzle as unknown as {
    find(args: { kayan: string; args: unknown }): Promise<{ docs: { id: string; expiresAt: Date }[] }>
    update(args: { tx: unknown; kayan: string; id: string; data: Record<string, unknown> }): Promise<unknown>
    transaction<Result>(fn: (tx: unknown) => Promise<Result>): Promise<Result>
  }
  const token = decodeURIComponent(/better-auth\.session_token=([^;]+)/.exec(cookie)![1]!).split('.')[0]!
  const held = async () =>
    (await store.find({ kayan: 'session', args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, where: { token: { equals: token } } } })).docs[0]!
  // Aged to an hour from now: past the provider's `updateAge`, short of its `expiresIn`.
  const aged = new Date(Date.now() + 60 * 60 * 1000)
  const { id } = await held()
  await store.transaction((tx) => store.update({ tx, kayan: 'session', id, data: { expiresAt: aged } }))
  assert.equal((await held()).expiresAt.getTime(), aged.getTime(), 'the session reads back aged')
  const response = await fetch(`${origin}/dashboard`, { headers: { cookie } })
  assert.equal(response.status, 200, '/dashboard answers 200')
  const slid = (await held()).expiresAt.getTime()
  assert.ok(slid > aged.getTime() + 24 * 60 * 60 * 1000, `a screen load refreshed it: ${new Date(slid).toISOString()}`)
  // The browser's cookie slides with the row: the refresh's `Set-Cookie` reaches the response under the seven-day `expiresIn`.
  const set = response.headers.getSetCookie().find((one) => one.startsWith('better-auth.session_token='))
  assert.ok(set, `the screen load answers the refreshed session cookie: ${JSON.stringify(response.headers.getSetCookie())}`)
  assert.match(set, /Max-Age=604800/, `with its expiry moved to seven days from now: ${set}`)
})

/**
 * Holds `role` alone while `body` runs, then `administrator` again. Rows are rewritten through the store (the sign-up rate
 * limit is spent), and the member row is made plain `member` because an owner holds `administrator` whatever the rows say.
 */
const holding = async (role: string, body: () => Promise<void>) => {
  const user = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { user: { id: string } }).user.id
  const db = (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<{ rows: unknown[] }> } }).db
  const memberships = (await db.execute(`select id, role from member where user_id = '${user}'`)).rows as { id: string; role: string }[]
  await db.execute(`update member_roles set role = '${role}' where user_id = '${user}'`)
  await db.execute(`update member set role = 'member' where user_id = '${user}'`)
  try {
    await body()
  } finally {
    for (const one of memberships) await db.execute(`update member set role = '${one.role}' where id = '${one.id}'`)
    await db.execute(`update member_roles set role = 'administrator' where user_id = '${user}'`)
  }
}

const sentTo = async (path: string, session: string, at = origin) => {
  const response = await fetch(`${at}${path}`, { headers: { cookie: session }, redirect: 'manual' })
  if (response.status === 200) return null
  assert.equal(response.status, 307, `${path} is either served or redirected, never ${response.status}`)
  return new URL(response.headers.get('location') ?? '', at).pathname
}

test('49. a screen is entered only with its key: the registrar enters the dashboard and is sent to /unauthorized from the portal, the instructor the reverse, page and frame alike', async () => {
  for (const [role, enters, refused] of [['registrar', '/dashboard', '/portal'], ['instructor', '/portal', '/dashboard'], ['student', '/portal', '/dashboard']] as const) {
    await holding(role, async () => {
      assert.equal(await sentTo(enters, cookie), null, `${enters} is served to a ${role}, who holds its key`)
      assert.equal(await sentTo(`${enters}/courses`, cookie), null, `and so is a page of it`)
      assert.equal(await sentTo(refused, cookie), '/unauthorized', `${refused} sends a ${role}, who does not hold its key, to /unauthorized`)
      assert.equal(await sentTo(`${refused}/courses`, cookie), '/unauthorized', `and so does a page of it`)
      // The provider lists members to any member; the auth setup asks `member.find`, which no fixed role but the
      // administrator holds.
      assert.equal((await fetch(`${origin}/api/auth/user/organization/list-members`, { headers: { cookie } })).status, 403, `a ${role} lists no member through the provider`)
      const full = (await (await fetch(`${origin}/api/auth/user/organization/get-full-organization`, { headers: { cookie } })).json()) as { members: unknown[] }
      assert.deepEqual(full.members, [], `and reads its organization with no member`)
    })
  }
  // A page that names a key is served only to an actor holding it, and its nav entry is drawn only for one.
  assert.equal(await sentTo('/dashboard/members', cookie), null, 'the members page is served to the tenant administrator, who holds every key')
  assert.ok((await screenHtml('/dashboard/members')).includes('data-members'), 'and draws it')
  assert.ok(screened['/dashboard/members']!.includes('>Last seen<'), 'with when each member was last seen, to the administrator')
  // With many organizations people join by invitation alone: Invite is the page's first action, and nobody is added.
  assert.ok(screened['/dashboard/members']!.includes('data-invite=') && !screened['/dashboard/members']!.includes('data-add-person'), 'with many organizations Invite is the first action, and there is no Add person')
  const members = (await (await fetch(`${origin}/api/auth/user/organization/list-members`, { headers: { cookie } })).json()) as { members: { userId: string; user: { email: string } }[] }
  const drawn = screened['/dashboard/members']!
  /** The members' table alone, the first of the page's two. */
  const memberRows = (html: string) => html.slice(html.indexOf('data-members-tab="members"'), html.indexOf('</table>', html.indexOf('data-members-tab="members"')))
  assert.deepEqual(
    [...memberRows(drawn).matchAll(/<tr[^>]*data-row="([^"]+)"/g)].map((hit) => hit[1]).sort(),
    members.members.map((member) => member.userId).sort(),
    `the members page draws one row per member of the active organization:\n${drawn.slice(drawn.indexOf('data-members'), drawn.indexOf('data-members') + 600)}`,
  )
  for (const member of members.members) assert.ok(drawn.includes(member.user.email), `and names ${member.user.email}`)
  // A production build hands an invitation over too: its link is copied from the pending row by whoever may invite.
  const invited = await post('/api/auth/user/organization/invite-member', { email: `copied-${Date.now()}@example.com`, role: 'member' }, { cookie, origin })
  assert.equal(invited.response.status, 200, JSON.stringify(invited.body))
  const pendingPage = await (await fetch(`${origin}/dashboard/members`, { headers: { cookie } })).text()
  assert.ok(new RegExp(`<tr[^>]*data-row="${String(invited.body.id)}"[\\s\\S]*?data-row-menu="${String(invited.body.id)}"`).test(pendingPage), `the pending invitation is listed under Invitations with its menu, which copies its link, in production:\n${pendingPage.slice(pendingPage.indexOf('data-members-tab'), pendingPage.indexOf('data-members-tab') + 600)}`)
  assert.equal((await post('/api/auth/user/organization/cancel-invitation', { invitationId: String(invited.body.id) }, { cookie, origin })).response.status, 200)
  await holding('registrar', async () => {
    assert.equal(await sentTo('/dashboard/members', cookie), '/unauthorized', 'the registrar is sent from it to /unauthorized')
    // A page of a kayan the registrar may not read is the same denial and not a 404, while a path naming no page is still none.
    assert.equal(await sentTo('/dashboard/roles', cookie), '/unauthorized', 'and from the roles list, which it may not read, to the same page')
    assert.equal(await sentTo('/dashboard/roles/00000000-0000-0000-0000-000000000000', cookie), '/unauthorized', 'and from a role\'s page')
    assert.equal((await fetch(`${origin}/dashboard/no-such-page`, { headers: { cookie }, redirect: 'manual' })).status, 404, 'while a path that names no page answers 404')
    const home = await (await fetch(`${origin}/dashboard`, { headers: { cookie } })).text()
    assert.ok(home.includes('href="/dashboard/courses"') && !home.includes('href="/dashboard/members"'), 'and its nav leaves the page out, while it keeps a kayan the registrar may read')
  })
  // The page at `/` is gated the same way: the dashboard's dashboard names `courses.find`, so a role holding the
  // screen's key and not that one is sent to /unauthorized.
  const porter = await post('/api/roles/create', { name: 'porter', label: { en: 'Test role', ar: 'دور تجريبي' }, permissions: ['screen.dashboard', 'tags.find', 'tags.count', 'tags.fields.id'] }, { cookie })
  assert.equal(porter.response.status, 200, JSON.stringify(porter.body))
  await holding('porter', async () => {
    assert.equal(await sentTo('/dashboard', cookie), '/unauthorized', 'the dashboard is refused to an actor without courses.find')
    assert.equal(await sentTo('/dashboard/tags', cookie), null, 'while a page of the same screen its keys reach is served')
  })
  // Called as a client navigation calls it, so the refusal is proved where the projection would cross. The id is read off
  // the built server and the payload is what the client writes for `{ data: 'dashboard' }` (seroval's `toJSONAsync`).
  const assets = `${app}/dist/server/assets`
  const rpc = readdirSync(assets).map((file) => readFileSync(`${assets}/${file}`, 'utf8')).join('\n')
  const id = /id: "([0-9a-f]+)",\s*name: "loadScreen"/.exec(rpc)?.[1]
  assert.ok(id, 'the built server records loadScreen\'s id')
  const payloadOf = (screen: string) => encodeURIComponent(JSON.stringify({ t: { t: 10, i: 0, p: { k: ['data'], v: [{ t: 1, s: screen }] }, o: 0 }, f: 127, m: [] }))
  const frame = async (session: string, screen = 'dashboard') =>
    (await fetch(`${origin}/_serverFn/${id}?payload=${payloadOf(screen)}`, { headers: { cookie: session, origin, 'x-tsr-serverFn': 'true' } })).text()
  // The frame's `user.screens` links each other screen the actor enters: each frame names the other, never itself.
  const toDashboard = await frame(cookie, 'portal')
  const toPortal = await frame(cookie)
  const linked = (frameText: string) => [...frameText.matchAll(/"s":"([a-z]+)"\},\{"t":1,"s":"(\/[a-z]+)"\}/g)].map((hit) => `${hit[1]} ${hit[2]}`)
  assert.deepEqual(linked(toDashboard), ['dashboard /dashboard'], 'the portal\'s frame links the dashboard and nothing else')
  assert.deepEqual(linked(toPortal), ['portal /portal'], 'and the dashboard\'s frame the portal')
  await holding('registrar', async () => {
    const entered = await frame(cookie)
    assert.ok(entered.includes('"courses"'), `the registrar's call answers the dashboard's projection: ${entered.slice(0, 300)}`)
  })
  await holding('instructor', async () => {
    const refusal = await frame(cookie)
    assert.ok(refusal.includes('unauthorized'), `the instructor's call answers the refusal: ${refusal.slice(0, 300)}`)
    assert.ok(!refusal.includes('courses') && !refusal.includes('"kayan"'), 'and carries no kayan of the screen it refused')

    assert.equal(await sentTo('/unauthorized', cookie), '/portal', 'an instructor, whose role opens the portal alone, is sent straight there with no page to read')
  })
  // The tenant administrator opens both screens, so is asked where to go.
  const page = await fetch(`${origin}/unauthorized`, { headers: { cookie } })
  assert.equal(page.status, 200, '/unauthorized is served to a signed-in member who opens several screens')
  const html = await page.text()
  assert.ok(html.includes('href="/portal"') && html.includes('href="/dashboard"'), 'it offers each screen the role opens')
  assert.ok(html.includes('>Sign out<'), 'and offers sign-out')
  assert.ok(!/name:"[^"]+",single:/.test(html), 'and crosses no kayan of any screen')
  // A visitor with no session is sent to sign-in, and the redirect names /unauthorized so signing in lands back there.
  const toSignIn = await fetch(`${origin}/unauthorized`, { redirect: 'manual' })
  assert.equal(toSignIn.status, 307)
  const signInLocation = new URL(toSignIn.headers.get('location') ?? '', origin)
  assert.equal(signInLocation.pathname, '/auth/sign-in', 'the refusal page sends a visitor with no session to sign-in')
  assert.equal(signInLocation.searchParams.get('redirect'), '/unauthorized', 'and carries /unauthorized itself as the redirect')
})

/**
 * Seats the signed-in administrator while it also holds the student role, since a seat's student
 * holds it; the role goes again after, so a test that swaps the administrator's role finds one row.
 */
const asStudent = async <T>(body: () => Promise<T>): Promise<T> => {
  const me = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { user: { id: string } }).user.id
  const role = await post('/api/memberRoles/create', { user: me, role: 'student' }, { cookie })
  assert.equal(role.response.status, 200, JSON.stringify(role.body))
  try {
    return await body()
  } finally {
    await post('/api/memberRoles/delete', { id: role.body.id }, { cookie })
  }
}

/**
 * Signed up in this process, not over the socket, which the provider's sign-up rate limit would refuse after this file's
 * first few, and proved here as the mailed link proves it.
 */
const signedUpHere = async (slug: string) => {
  const server = (asas.auth.strategies.find((one) => one.name === 'user') as unknown as { server: { api: { signUpEmail(args: unknown): Promise<{ user: { id: string } }> }; $context: Promise<{ password: { hash(password: string): Promise<string> } }> } }).server
  const email = `${slug}-${Date.now()}@example.com`
  const made = await server.api.signUpEmail({ body: { name: slug, email } })
  // A sign-up keeps no password, so the one the mailed link would choose is written as that link writes it.
  const hashed = await (await server.$context).password.hash(password)
  await (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<unknown> } }).db.execute(`update "user" set email_verified = true where id = '${made.user.id}'; update account set password = '${hashed}' where user_id = '${made.user.id}' and provider_id = 'credential'`)
  return { id: made.user.id, email }
}

const jarOf = (sent: string, response: Response) => {
  const jar = new Map(sent.split('; ').filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair = '', ...attributes] = line.split(';')
    const name = pair.slice(0, pair.indexOf('='))
    if (attributes.some((one) => /max-age=\s*0|expires=\s*thu, 01 jan 1970/i.test(one))) jar.delete(name)
    else jar.set(name, pair.slice(pair.indexOf('=') + 1))
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

const staffAs = async (role: string, body: () => Promise<void>) => {
  const user = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { user: { id: string } }).user.id
  const db = (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<unknown> } }).db
  await db.execute(`update "user" set role = '${role}' where id = '${user}'`)
  try {
    await body()
  } finally {
    await db.execute(`update "user" set role = null where id = '${user}'`)
  }
}

/**
 * Signs this file's actor in to the backoffice app once, under the backoffice's own cookie. That app makes a session for
 * staff alone, so the actor holds a backoffice role while signing in; `staffAs` sets the role each test walks under.
 */
const backofficeSignIn = async () => {
  if (backofficeCookie) return backofficeCookie
  await staffAs('explorer', async () => {
    const signedIn = await fetch(`${backofficeOrigin}/api/auth/user/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: backofficeOrigin },
      body: JSON.stringify({ email: actorEmail, password }),
    })
    assert.equal(signedIn.status, 200, `the backoffice app signs the actor in: ${await signedIn.clone().text()}`)
    backofficeCookie = signedIn.headers.getSetCookie().map((one) => one.split(';')[0]).join('; ')
  })
  return backofficeCookie
}

test('50. the web studio is gone: each screen\'s former _studio path is that screen\'s own not-found page, and every answer of either app is framed by its own origin alone', async () => {
  // Every answer of either app, a page, a redirect or the data API, may be
  // framed by its own origin alone.
  for (const [at, paths] of [[origin, ['/', '/dashboard', '/auth/sign-in', '/api/not-ours']], [backofficeOrigin, ['/', '/backoffice', '/auth/sign-in']]] as const) {
    for (const path of paths) {
      const answer = await fetch(`${at}${path}`, { headers: { cookie: at === origin ? cookie : '' }, redirect: 'manual' })
      assert.equal(answer.headers.get('content-security-policy'), "frame-ancestors 'self'", `${at}${path} (${answer.status}) is framed by its own app alone`)
    }
  }
  const notFound = async (at: string, path: string, session: string) => {
    const answer = await fetch(`${at}${path}`, { headers: { cookie: session }, redirect: 'manual' })
    return { status: answer.status, studio: (await answer.text()).includes('data-studio') }
  }
  for (const name of ['dashboard', 'portal']) {
    assert.deepEqual(await notFound(origin, `/${name}/_studio`, cookie), await notFound(origin, `/${name}/no-such-page`, cookie), `/${name}/_studio is the ${name} screen's not-found page`)
    assert.deepEqual(await notFound(origin, `/${name}/_studio`, cookie), { status: 404, studio: false }, 'a 404 that draws no studio')
  }
  const session = await backofficeSignIn()
  await staffAs('super_admin', async () => {
    assert.deepEqual(await notFound(backofficeOrigin, '/backoffice/_studio', session), await notFound(backofficeOrigin, '/backoffice/no-such-page', session), '/backoffice/_studio is the backoffice screen\'s not-found page')
    assert.deepEqual(await notFound(backofficeOrigin, '/backoffice/_studio', session), { status: 404, studio: false }, 'a 404 that draws no studio')
  })
})

test('50b. the backoffice app: support lists people and organizations, opens each row\'s read-only record, and may impersonate into the tenant app, explorer reads everything and changes nothing, a tenant administrator is sent to /unauthorized, a super admin moves between the two apps without signing out, and the tenant app serves no backoffice route', async () => {
  const organization = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { session: { activeOrganizationId: string } }).session.activeOrganizationId
  const server = (asas.auth.strategies.find((one) => one.name === 'user') as unknown as { server: { api: { addMember(args: unknown): Promise<unknown> } } }).server
  const member = await signedUpHere('backoffice-member')
  await server.api.addMember({ body: { userId: member.id, organizationId: organization, role: 'member' } })
  await assignRole(organization, member.id, 'registrar')
  const colleague = await signedUpHere('backoffice-colleague')
  const db = (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<unknown> } }).db
  await db.execute(`update "user" set role = 'super_admin' where id = '${colleague.id}'`)
  const session = await backofficeSignIn()
  const pageAt = async (at: string, path: string, with_: string) => {
    const response = await fetch(`${at}${path}`, { headers: { cookie: with_ } })
    assert.equal(response.status, 200, `${at}${path} answers 200`)
    return response.text()
  }
  const tenantPage = (path: string) => pageAt(origin, path, cookie)
  const backofficePage = (path: string) => pageAt(backofficeOrigin, path, session)
  // The member's own page draws its buttons on the server, where the list's row menu holds the same actions only while open.
  const actions = async () =>
    (/data-person-actions="([a-z -]+)"/.exec(await backofficePage(`/backoffice/users/${member.id}`))?.[1]?.split(' ') ?? []).sort()
  const backofficePost = (path: string, body: unknown) => post(`/api/auth/user/${path}`, body, { cookie: session, origin: backofficeOrigin }, backofficeOrigin)
  const link = `href="${backofficeOrigin}/backoffice"`
  const usersAt = `/backoffice/users?search=${encodeURIComponent(member.email)}`
  const slug = ((await db.execute(`select slug from "organization" where id = '${organization}'`)) as unknown as { rows: { slug: string }[] }).rows[0]!.slug
  const organizationsAt = `/backoffice/organizations?search=${encodeURIComponent(slug)}`
  const organizationActions = (html: string) => {
    const row = html.slice(html.indexOf(`data-organization="${organization}"`)).split('data-organization="')[1] ?? ''
    return [...new Set([...row.matchAll(/data-action="([a-z-]+)"/g)].map((hit) => hit[1]))].sort()
  }
  const opensRecords = async (lists: string[]) => {
    for (const list of lists) {
      const href = /<a href="([^"]+)" data-row-link=/.exec(await backofficePage(`/backoffice/${list}`))?.[1]
      assert.ok(href?.startsWith(`/backoffice/${list}/`), `a row of ${list} opens its record: ${href}`)
      const record = await backofficePage(href!)
      assert.ok(record.includes('data-layout="record"') && record.includes('data-field-value='), `${href} draws the record, each field by its cell`)
      assert.ok(!record.includes('<form') && !record.includes('data-control=') && !record.includes('type="submit"'), `${href} draws no box and nothing that submits`)
    }
  }
  const navOf = (html: string) => ['users', 'organizations', 'members', 'courses', 'sessions', 'enrollments', 'tags', 'roles', 'member-roles', 'local-users', 'history'].filter((one) => html.includes(`href="/backoffice/${one}"`))

  for (const path of ['/backoffice', '/backoffice/users']) {
    assert.equal((await fetch(`${origin}${path}`, { headers: { cookie }, redirect: 'manual' })).status, 404, `the tenant app answers ${path} 404`)
  }
  // Nor any of the provider's admin routes, to a staff member's own tenant session least of all.
  await staffAs('super_admin', async () => {
    const refused = await post('/api/auth/user/admin/ban-user', { userId: member.id }, { cookie, origin })
    assert.equal(refused.response.status, 404, 'a tenant session calls no admin route')
  })
  assert.ok(cookie.startsWith('better-auth.session_token=') && session.startsWith('mithaq-backoffice.session_token='), 'the two apps keep sessions under two names')
  // `/` is the backoffice screen, which sends a visitor to sign-in, whose page offers no sign-up.
  const landing = await fetch(`${backofficeOrigin}/`, { redirect: 'manual' })
  assert.equal(landing.status, 307)
  assert.equal(landing.headers.get('location'), '/backoffice', '/ is the backoffice screen')
  assert.equal(await sentTo('/backoffice', '', backofficeOrigin), '/auth/sign-in', 'which sends a visitor to sign in')
  const signInPage = await (await fetch(`${backofficeOrigin}/auth/sign-in`)).text()
  assert.ok(signInPage.includes('Sign in to reach the backoffice.') && !signInPage.includes('/auth/sign-up'), 'a sign-in for the backoffice, with no sign-up offered')
  assert.equal((await fetch(`${backofficeOrigin}/auth/sign-up`, { redirect: 'manual' })).status, 404, 'and no sign-up page')

  // A tenant administrator: `'*'` inside its tenant, nothing in the backoffice app.
  assert.equal(await sentTo('/backoffice', session, backofficeOrigin), '/unauthorized', 'a tenant administrator is sent from /backoffice to /unauthorized')
  assert.equal(await sentTo('/backoffice/users', session, backofficeOrigin), '/unauthorized', 'and from its pages')
  assert.ok(!(await tenantPage('/dashboard')).includes('data-backoffice-link'), 'and its dashboard header links no backoffice')

  await staffAs('super_admin', async () => {
    const dashboard = await tenantPage('/dashboard')
    assert.match(dashboard, /data-dashboard="dashboard"/, 'the super admin uses /dashboard as its organization\'s owner')
    assert.ok(dashboard.includes('data-backoffice-link') && dashboard.includes(link), 'whose header links the backoffice app')
    assert.ok(dashboard.includes('[[data-node=controls]:not(:empty)~&amp;]:ms-0'), 'which gives up its margin only to controls that drew something')
    const home = await backofficePage('/backoffice')
    assert.match(home, /data-dashboard="backoffice"/, 'and the backoffice app as the backoffice, with no sign-out between')
    assert.ok(!home.includes('/_studio'), 'which links no studio')
    const users = await backofficePage(usersAt)
    assert.ok(users.includes(`data-row="${member.id}"`) && users.includes(member.email), 'lists every person, searched by the URL')
    assert.deepEqual(await actions(), ['ban', 'impersonate', 'set-role'], 'with every action')
    assert.ok(users.includes(`value="${member.email}"`), 'and the search box holds what the URL asked')
    const organizations = await backofficePage(organizationsAt)
    assert.ok(organizations.includes(`data-organization="${organization}"`), 'and every organization')
    assert.deepEqual(organizationActions(organizations), ['members', 'rename'], 'with its rename and its members')
    assert.ok(organizations.includes(`/backoffice/members?where%5Bor%5D%5B0%5D%5Band%5D%5B0%5D%5BorganizationId%5D%5Bequals%5D=${organization}`), 'whose members link is the members list filtered to it')
    assert.deepEqual(navOf(home), ['users', 'organizations', 'members', 'courses', 'sessions', 'enrollments', 'tags', 'roles', 'member-roles', 'local-users', 'history'], 'the nav lists every list, the local accounts and the staff history last')
    const courses = await backofficePage(`/backoffice/courses?where[organization][equals]=${organization}&search=${encodeURIComponent(title)}`)
    assert.ok(courses.includes(title), 'the backoffice lists a tenant\'s course, filtered to its organization')
    assert.ok(!courses.includes('href="/backoffice/courses/new"'), 'and offers no create')
    const course = ((await db.execute(`select id from courses where title = '${title}'`)) as unknown as { rows: { id: string }[] }).rows[0]!.id
    const row = [...courses.matchAll(/<tr[^>]*data-row="[^"]+"[^>]*>[\s\S]*?<\/tr>/g)].map((hit) => hit[0]).find((one) => one.includes(`data-row="${course}"`)) ?? ''
    assert.ok(row.includes(title), 'the course is a row of the table')
    assert.ok(row.includes(`href="/backoffice/courses/${course}"`) && row.includes('tabindex="0"') && row.includes('data-row-menu='), `and opens the course's record: ${row.slice(0, 300)}`)
    const heads = [...courses.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((hit) => hit[1]!.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
    assert.equal(heads[0], 'Title', `the title column first: ${heads.join(', ')}`)
    await opensRecords(['users', 'organizations', 'members', 'courses', 'sessions', 'enrollments', 'tags', 'roles', 'member-roles'])
    const record = await backofficePage(`/backoffice/courses/${course}`)
    assert.ok(record.includes(title) && record.includes('About the course') && !record.includes('data-field-value="accessCode"'), 'the course\'s record draws the dashboard\'s sections, and no access code even for super_admin')
    assert.ok(record.includes('data-field-value="organization"') && record.includes('data-node="list"'), 'with its organization and its sessions')
    const arabic = await pageAt(backofficeOrigin, `/backoffice/courses/${course}`, `${session}; locale=ar`)
    assert.ok(['عن الدورة', 'التسعير', 'الجلسات', 'السجل', 'العنوان'].every((words) => arabic.includes(words)), 'and every label of it in Arabic')
    const sessionRecord = await backofficePage(`/backoffice/sessions/${screenSession}`)
    assert.ok(sessionRecord.includes('data-node="list"') && /<tr[^>]*data-row="/.test(sessionRecord), 'a session\'s record lists its enrollments')
    const write = await post('/api/courses/update', { id: course, fee: 1 }, { cookie: session }, backofficeOrigin)
    assert.equal(write.response.status, 403, 'a write to it from the backoffice app is refused')
    // Both apps run without LOCAL_AUTH_SECRET, so local auth is off and a sign-up is refused; the account is one
    // written straight to the table, which the super admin still lists and verifies.
    const localEmail = `local-50b-${Date.now()}@example.com`
    assert.equal((await post('/api/localUsers/create', { email: localEmail, password })).response.status, 403, 'a public sign-up is refused without the secret')
    const made = ((await db.execute(`insert into local_users (email, hash, salt) values ('${localEmail}', 'not-a-hash', 'not-a-salt') returning id`)) as unknown as { rows: { id: string }[] }).rows[0]!
    const signUp = { body: { id: made.id } }
    const accounts = await backofficePage(`/backoffice/local-users?search=${encodeURIComponent(localEmail)}`)
    assert.ok(accounts.includes(localEmail) && accounts.includes(`href="/backoffice/local-users/${String(signUp.body.id)}"`), 'the backoffice lists the sign-up and opens its edit page')
    // The row's link holds the address as text: a mail link inside it would nest one `<a>` in another, which React reports on hydration.
    const rowLink = new RegExp(`<a href="/backoffice/local-users/${String(signUp.body.id)}" data-row-link="[^"]*"[^>]*>([^<]*)</a>`).exec(accounts)?.[1]
    assert.equal(rowLink, localEmail, 'the row link holds the plain address')
    assert.ok(!accounts.includes('href="mailto:'), 'and the list draws no mail link inside it')
    const localHeads = [...accounts.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((hit) => hit[1]!.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
    assert.deepEqual(localHeads.filter((head) => head !== 'Actions').sort(), ['Created at', 'Email', 'Verified'], `by its email, its verified state and its date: ${localHeads.join(', ')}`)
    const account = await backofficePage(`/backoffice/local-users/${String(signUp.body.id)}`)
    assert.ok(account.includes('<form') && account.includes(localEmail), 'the edit page is a form titled by the email')
    assert.match(account, /<a href="\/backoffice\/local-users"[^>]*data-back/, 'and links back to the list')
    assert.deepEqual([...account.matchAll(/data-control="([^"]+)"/g)].map((hit) => hit[1]), ['checkbox'], 'whose one control is the verified toggle')
    assert.deepEqual([...account.matchAll(/data-field-value="([^"]+)"/g)].map((hit) => hit[1]), ['email', 'createdAt'], 'under the email and the date as text')
    assert.ok(!/<input[^>]*type="email"/.test(account), 'with no email box')
    assert.ok(!account.includes('type="password"'), 'and there is no password box')
    const arabicAccount = await pageAt(backofficeOrigin, `/backoffice/local-users/${String(signUp.body.id)}`, `${session}; locale=ar`)
    assert.ok(['التحقق', 'موثق'].every((words) => arabicAccount.includes(words)), 'labelled in Arabic too')
    assert.match(await tenantPage('/dashboard'), /data-dashboard="dashboard"/, 'and is back in /dashboard as the owner')
  })

  await staffAs('support', async () => {
    assert.ok((await tenantPage('/dashboard')).includes(link), 'support is linked to the backoffice app too')
    const users = await backofficePage(usersAt)
    assert.ok(users.includes(`data-row="${member.id}"`), 'support lists the people')
    assert.deepEqual(await actions(), ['impersonate'], 'and draws impersonate and neither ban nor set role')
    const organizations = await backofficePage(organizationsAt)
    assert.ok(organizations.includes(`data-organization="${organization}"`), 'and lists the organizations')
    assert.deepEqual(organizationActions(organizations), ['members'], 'and opens their members and renames none')
    await opensRecords(['users', 'organizations', 'members', 'courses', 'sessions', 'enrollments', 'tags'])
    const course = ((await db.execute(`select id from courses where title = '${title}'`)) as unknown as { rows: { id: string }[] }).rows[0]!.id
    const record = await backofficePage(`/backoffice/courses/${course}`)
    assert.ok(record.includes('data-field-value="title"') && !record.includes('data-field-value="accessCode"'), 'support opens a course\'s record without its access code, which it holds no key of')
    assert.equal((await post('/api/backoffice/organizations/update', { id: organization, name: 'By support', slug: 'by-support' }, { cookie: session }, backofficeOrigin)).response.status, 403, 'the server refuses support a rename')
    assert.deepEqual(navOf(await backofficePage('/backoffice')), ['users', 'organizations', 'members', 'courses', 'sessions', 'enrollments', 'tags'], 'the nav lists the tenants\' business and none of their roles')
    // A page of a kayan support may not read is the same denial as a page whose key it does not hold.
    assert.equal(await sentTo('/backoffice/local-users', session, backofficeOrigin), '/unauthorized', 'and the local accounts send it to /unauthorized')
    assert.equal(await sentTo('/backoffice/roles', session, backofficeOrigin), '/unauthorized', 'and so does a role list it holds no key of')
    assert.equal((await post('/api/roles/find', {}, { cookie: session }, backofficeOrigin)).response.status, 403, 'and the server refuses the read')
    assert.equal((await backofficePost('admin/ban-user', { userId: member.id, banReason: 'Spam' })).response.status, 403, 'the server refuses support a ban')
    assert.equal((await backofficePost('admin/set-role', { userId: member.id, role: 'support' })).response.status, 403, 'and a role change')
    assert.equal((await backofficePost('admin/impersonate-user', { userId: colleague.id })).response.status, 403, 'and an impersonation of a super admin')
    // A page of the tenant app's origin cannot drive the backoffice's routes.
    assert.equal((await post('/api/auth/user/admin/impersonate-user', { userId: member.id }, { cookie: session, origin }, backofficeOrigin)).response.status, 403, 'the backoffice refuses a post from the tenant app\'s origin')

    // The impersonation: the backoffice keeps no cookie of it and answers a
    // one-time link into the tenant app, which trades it for the session.
    const started = await fetch(`${backofficeOrigin}/api/auth/user/admin/impersonate-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session, origin: backofficeOrigin },
      body: JSON.stringify({ userId: member.id }),
    })
    assert.equal(started.status, 200, `support impersonates a tenant user: ${await started.clone().text()}`)
    assert.deepEqual(started.headers.getSetCookie(), [], 'the backoffice app sets no cookie')
    const { url } = (await started.json()) as { url: string }
    assert.equal(new URL(url).origin + new URL(url).pathname, `${origin}/auth/handoff`, 'the link lands in the tenant app')
    const landed = await fetch(url, { redirect: 'manual' })
    assert.equal(landed.status, 302)
    assert.equal(landed.headers.get('location'), '/dashboard', 'and sends the browser on to the first screen the registrar enters')
    const as = jarOf('', landed)
    assert.ok(as.startsWith('better-auth.session_token='), 'under the tenant app\'s own cookie')
    assert.equal((await fetch(url, { redirect: 'manual' })).headers.get('location'), '/auth/sign-in', 'a link is spent once')
    const mimicked = await fetch(`${origin}/dashboard`, { headers: { cookie: as } })
    assert.equal(mimicked.status, 200, 'the impersonated registrar enters the dashboard')
    const html = await mimicked.text()
    assert.ok(html.includes('data-impersonating') && html.includes('You are impersonating') && html.includes('Stop impersonating'), 'under the bar that says so and stops it')
    assert.ok(!html.includes('data-backoffice-link'), 'and with no link to the backoffice, since the registrar is no staff')
    const stopped = await post('/api/auth/user/sign-out', {}, { cookie: as, origin })
    assert.equal(stopped.response.status, 200, 'stopping is signing out of the tenant app')
    assert.equal((await fetch(`${origin}/dashboard`, { headers: { cookie: as }, redirect: 'manual' })).status, 307, 'which ends the impersonation')
    assert.ok((await backofficePage(usersAt)).includes(`data-row="${member.id}"`), 'while support stays signed in to the backoffice app')
  })

  await staffAs('explorer', async () => {
    assert.ok((await tenantPage('/dashboard')).includes(link), 'explorer is linked to the backoffice app')
    assert.deepEqual(await actions(), [], 'explorer reads the people and acts on none')
    const organizations = await backofficePage(organizationsAt)
    assert.ok(organizations.includes(`data-organization="${organization}"`), 'reads the organizations')
    assert.deepEqual(organizationActions(organizations), ['members'], 'renames none')
    assert.ok(navOf(await backofficePage('/backoffice')).includes('roles'), 'and reads the tenants\' roles too')
    assert.ok(!navOf(await backofficePage('/backoffice')).includes('local-users'), 'and no local account, which a super admin alone reads')
    assert.ok(navOf(await backofficePage('/backoffice')).includes('history'), 'and the staff history, which support, who impersonates, does not')
    await opensRecords(['users', 'organizations', 'members', 'courses', 'sessions', 'enrollments', 'tags', 'roles', 'member-roles'])
  })
})

test('51. the portal\'s route chunks do not carry the dashboard\'s members page, which its glob loads by import() when a page draws it: a bundle-weight property, not access', () => {
  // A chunk's static imports load with it; a dynamic `import()` loads only when a page draws what it names. This is weight, not access:
  // every screen's glob ships in the main chunk and any lazy chunk is public; the server's gate decides who sees a screen.
  const assets = `${app}/dist/client/assets`
  const chunks = new Map(readdirSync(assets).filter((file) => file.endsWith('.js')).map((file) => [file, readFileSync(`${assets}/${file}`, 'utf8')]))
  const staticImports = (file: string) => [...chunks.get(file)!.matchAll(/import\s*(?:[^'"()`]*?from\s*)?["']\.\/([^"']+)["']/g)].map((hit) => hit[1]!)
  const loadedWith = (roots: string[]) => {
    const seen = new Set(roots)
    for (const file of seen) for (const next of staticImports(file)) seen.add(next)
    return seen
  }
  // The marker is a copy key only the dashboard's members page asks for.
  const holding = [...chunks].filter(([, source]) => source.includes('dashboard.membersAbout')).map(([file]) => file)
  assert.equal(holding.length, 1, `one client chunk holds the dashboard's members page: ${holding.join(', ')}`)
  const routes = (screen: string) => [...chunks.keys()].filter((file) => new RegExp(`^${screen}[-._]`).test(file))
  // Four: the frame, the home, the page route and that route's not-found chunk, which the router splits out.
  assert.equal(routes('portal').length, 4, 'the portal has its four route chunks')
  assert.ok(!loadedWith(routes('portal')).has(holding[0]!), 'and nothing a portal route loads carries the dashboard\'s members page')
  assert.ok(!loadedWith(routes('dashboard')).has(holding[0]!), 'which not even the dashboard\'s own routes load before a page draws it')
  assert.ok(
    [...chunks.values()].some((source) => source.includes(`import(\`./${holding[0]}\`)`) || source.includes(`import("./${holding[0]}")`)),
    'the dashboard\'s glob reaches it by a dynamic import',
  )
  // The project's server code stays on the server: two refusals only `buildAsas` and the drizzle target write are in no client chunk.
  assert.deepEqual([...chunks].filter(([, source]) => source.includes('declares no target of capability') || source.includes('mithaq_dev_push')).map(([file]) => file), [], 'no client chunk carries asas\'s server code')
  // A role's label is handed over by the server, so no page imports the code declaring the fixed roles,
  // whose backoffice labels are in no copy.
  const declared = [backofficeRoles.super_admin.label.ar, backofficeRoles.explorer.label.ar]
  assert.deepEqual([...chunks].filter(([, source]) => declared.some((label) => source.includes(label))).map(([file]) => file), [], 'no client chunk carries the fixed roles\' code')
})

test('52. a when decides what the dashboard draws: the access code follows the delivery and the archive button the row, while the server still refuses the operation to an actor without its key', async () => {
  // A server render draws the form's first values, so the redraw as a value changes is proved in the rendered tree elsewhere.
  const recorded = await post('/api/courses/create', { title: `Recorded ${Date.now()}`, delivery: 'recorded', accessCode: 'REC001' }, { cookie })
  assert.equal(recorded.response.status, 200, JSON.stringify(recorded.body))
  const id = String(recorded.body.id)
  // The portal draws a course whole and holds no form of it.
  for (const screen of ['dashboard']) {
    const live = await screenHtml(`/${screen}/courses/${screenCourse}`)
    assert.ok(live.includes('for="courses-delivery"') && live.includes('for="courses-accessCode"'), `the ${screen} draws the access code over a live course`)
    const other = await screenHtml(`/${screen}/courses/${id}`)
    assert.ok(other.includes('for="courses-delivery"'), `the ${screen} draws the delivery of a recorded course`)
    assert.ok(!other.includes('for="courses-accessCode"'), `and no access code beside it`)
  }
  // Keyed on the record: an archived row has no archive button.
  const archived = await post('/api/courses/archive', { id, reason: 'Moved online' }, { cookie })
  assert.equal(archived.response.status, 200, JSON.stringify(archived.body))
  // The danger region alone, since the Sessions tab draws the sessions' own bulk archive.
  const danger = (html: string) => html.slice(html.indexOf('data-region="danger"'), html.indexOf('</section>', html.indexOf('data-region="danger"')))
  assert.ok(danger(await screenHtml(`/dashboard/courses/${screenCourse}`)).includes('>Archive<'), 'a row not archived draws the archive button')
  assert.ok(!danger(await screenHtml(`/dashboard/courses/${id}`)).includes('>Archive<'), 'and an archived one does not')
  await holding('registrar', async () => {
    // What a page draws is no permission: the operation behind a button no
    // page draws is still the server's to refuse.
    const refused = await post('/api/courses/unpublish', { id, _status: 'draft' }, { cookie })
    assert.equal(refused.response.status, 403, `the server refuses the registrar the unpublish: ${JSON.stringify(refused.body)}`)
  })
})

test('53. the dashboard\'s list is its qs URL: a filtered, sorted page two reloads to the same rows, the list node\'s sort and limit are defaults the URL overrides, a hostile URL reads nothing, and each row carries its menu', async () => {
  // Twelve rows under one prefix, the oldest archived, so a page of this run's own rows is known.
  const prefix = `Listed ${Date.now()}`
  const ids: string[] = []
  for (let at = 0; at < 12; at += 1) {
    const made = await post('/api/courses/create', { title: `${prefix} ${String(at).padStart(2, '0')}`, fee: at * 10 }, { cookie })
    assert.equal(made.response.status, 200, `row ${at} is created: ${JSON.stringify(made.body)}`)
    ids.push(String(made.body.id))
  }
  const archived = await post('/api/courses/archive', { id: ids[0], reason: 'Done' }, { cookie })
  assert.equal(archived.response.status, 200, JSON.stringify(archived.body))
  // Read off the table body alone: the document also carries the loader's answer for hydration, which names the rows again.
  const body = (html: string) => /<tbody[\s\S]*?<\/tbody>/.exec(html)?.[0] ?? ''
  // As text between tags, since each row's menu names its row too.
  const rows = (html: string) => [...body(html).matchAll(new RegExp(`>(${prefix} \\d\\d)<`, 'g'))].map((one) => one[1])
  const rowOf = (html: string, name: string) => [...body(html).matchAll(/<tr[\s\S]*?<\/tr>/g)].map((one) => one[0]).find((one) => one.includes(`>${name}<`)) ?? ''
  const where = `where[title][like]=${encodeURIComponent(prefix)}`
  // The portal's catalogue is drawn whole and reads its courses in the browser, so the dashboard's list alone is a URL.
  for (const screen of ['dashboard']) {
    // The dashboard's All tab, since its list opens on Active, which leaves the archived row out.
    const all = '&tab=all'
    const url = `/${screen}/courses?${where}&sort=-fee&page=2&limit=10${all}`
    const first = await screenHtml(url)
    const two = [`${prefix} 01`, `${prefix} 00`]
    assert.deepEqual(rows(first), two, `the ${screen} serves page two of the filter, by fee descending, ten to a page`)
    assert.deepEqual(rows(await screenHtml(url)), rows(first), `and a reload of the same URL lands on the same list`)

    // A hostile or unknown filter is refused before any read: the page draws the refusal where the table would be.
    for (const hostile of ['where[__proto__][polluted]=1', 'where[or][0][and][0][title][in][0][a][b][c]=1', 'where[archiveReason][like]=x', 'where[title][greater_than]=x']) {
      const refused = await screenHtml(`/${screen}/courses?${hostile}`)
      assert.ok(refused.includes('data-mithaq-refused='), `the ${screen} refuses ${hostile}`)
      assert.equal(body(refused), '', `and draws no row for it: ${hostile}`)
    }

    // Each row carries its menu, which offers the archive only where the button's `when` holds over the row once opened in the browser.
    const page = await screenHtml(`/${screen}/courses?${where}&sort=fee${all}`)
    assert.ok(rowOf(page, `${prefix} 01`).includes('data-row-menu='), `the ${screen} draws the menu on a row not archived`)
    if (screen === 'dashboard') assert.ok(rowOf(page, `${prefix} 00`).includes('data-row-menu='), `and on the archived row`)
  }

  const active = rows(await screenHtml(`/dashboard/courses?${where}&sort=fee&limit=25`))
  assert.deepEqual([active.length, active.includes(`${prefix} 00`)], [11, false], 'the dashboard opens on Active, the archived row out of the way')
  assert.deepEqual(rows(await screenHtml(`/dashboard/courses?${where}&tab=archived`)), [`${prefix} 00`], 'and its Archived tab holds that row alone')

  // The dashboard's list names no sort or limit, so it opens newest first, ten to a page.
  const screen = await screenHtml(`/dashboard/courses?${where}`)
  assert.deepEqual(rows(screen).slice(0, 2), [`${prefix} 11`, `${prefix} 10`], 'the dashboard opens newest first')
  assert.equal(rows(screen).length, 10, 'ten to a page')

  // The bulk buttons are the dashboard node's, shown once a row is ticked; a page as served ticks none, so they sit only
  // inside a hidden wrapper. The portal names none, so it draws no selection.
  const hidden = screen.indexOf('<span hidden="">')
  // The wrapper's own closing tag, counting the spans a button opens inside it.
  let depth = 0
  let end = -1
  for (const tag of screen.slice(Math.max(hidden, 0)).matchAll(/<(\/?)span\b/g)) {
    depth += tag[1] ? -1 : 1
    if (depth === 0) {
      end = hidden + tag.index
      break
    }
  }
  const inside = (words: string) => {
    const at = screen.indexOf(words, hidden)
    return at !== -1 && at < end
  }
  assert.ok(screen.includes('Select every row on this page'), 'the dashboard draws its boxes')
  assert.ok(!screen.includes('data-mithaq-selected') && hidden !== -1 && end > hidden && inside('>Delete<') && inside('>Update<'), 'and the bulk buttons only inside a wrapper hidden by its attribute, over a selection of none')
  assert.ok(!screen.includes('>Create</button>'), 'and draws no second Create')
})

test('54. / is a real landing page, not a redirect: 200 with the hero and a sign-in link for a visitor, and a working dashboard link for the boot admin', async () => {
  const visitor = await fetch(`${origin}/`)
  assert.equal(visitor.status, 200, 'a visitor is served the page itself, not a 3xx')
  const visitorHtml = await visitor.text()
  assert.ok(visitorHtml.includes('Run your organization without the busywork'), `the hero is in the served HTML:\n${visitorHtml.slice(0, 600)}`)
  assert.ok(visitorHtml.includes('href="/auth/sign-in"'), 'the header offers sign-in to a visitor')
  assert.ok(visitorHtml.includes('href="/auth/sign-up"'), 'and get started')
  assert.ok(!visitorHtml.includes('Open Dashboard'), 'and no dashboard link, because there is no session to open one for')

  // The boot admin, whose session `cookie` has carried since test 2, holds `'*'` and enters every screen, so the header
  // links the first one it lists rather than either screen by name.
  const signedIn = await fetch(`${origin}/`, { headers: { cookie } })
  assert.equal(signedIn.status, 200, 'a signed-in actor is served the same page')
  const signedInHtml = await signedIn.text()
  assert.ok(!signedInHtml.includes('href="/auth/sign-in"'), 'the header offers no sign-in to a signed-in actor')
  const dashboardHref = /<a href="([^"]+)"><button[^>]*>\s*Open Dashboard/.exec(signedInHtml)?.[1]
  assert.ok(dashboardHref, `the header carries a dashboard link:\n${signedInHtml.slice(0, 900)}`)
  const dashboard = await fetch(`${origin}${dashboardHref}`, { headers: { cookie } })
  assert.equal(dashboard.status, 200, `the dashboard link ${dashboardHref} answers 200`)
  assert.ok((await dashboard.text()).includes('data-shell='), `and is a real screen, drawn inside its shell, for ${dashboardHref}`)
})

test('55. the tenant back office is served at /dashboard, and every old /admin path answers a 308 to the same path under /dashboard, query kept', async () => {
  const served = await fetch(`${origin}/dashboard`, { headers: { cookie } })
  assert.equal(served.status, 200, '/dashboard answers 200')
  assert.match(await served.text(), /data-dashboard="dashboard"/, 'and draws the dashboard page of the dashboard screen')
  for (const [from, to] of [['/admin', '/dashboard'], ['/admin/courses?page=2', '/dashboard/courses?page=2'], ['/admin/courses/new', '/dashboard/courses/new']]) {
    const moved = await fetch(`${origin}${from}`, { redirect: 'manual' })
    assert.equal(moved.status, 308, `${from} answers 308`)
    const location = new URL(moved.headers.get('location') ?? '', origin)
    assert.equal(location.pathname + location.search, to, `and names ${to}`)
  }
  // The middleware itself: the query rides along as written, a path that only starts with the old name is no old path,
  // and a doubled slash stays a path of this origin.
  const query = await fetch(`${origin}/admin/courses?x=1`, { redirect: 'manual' })
  assert.equal(query.status, 308)
  assert.equal(query.headers.get('location'), '/dashboard/courses?x=1', 'the Location is the path and query under /dashboard')
  const prefix = await fetch(`${origin}/adminfoo`, { redirect: 'manual' })
  assert.notEqual(prefix.status, 308, '/adminfoo is not under /admin and is not moved')
  assert.equal(prefix.headers.get('location'), null, 'and names nowhere to go')
  const doubled = await fetch(`${origin}/admin//evil.com`, { redirect: 'manual' })
  assert.equal(doubled.status, 308)
  assert.ok(doubled.headers.get('location')?.startsWith('/dashboard/'), `a doubled slash lands under /dashboard/ on this origin: ${doubled.headers.get('location')}`)
})

test('56. in Arabic, no page of the dashboard draws a word of the English copy: every page of every kayan, a row of each, the screen\'s own pages, the header\'s backoffice link and the impersonation bar', async () => {
  // Every piece of copy carries every locale and nothing falls back. The English side is every English string the copy holds
  // where its Arabic differs, every English record the projection carries, and every English fallback the copied files write.
  const { scopes } = await import('./asas-tanstack/src/copy.ts')
  const english = new Set<string>()
  for (const scope of Object.values(scopes)) for (const copy of Object.values(scope)) if (copy.en && copy.ar && copy.en !== copy.ar) english.add(copy.en)
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.en === 'string' && typeof record.ar === 'string' && record.en !== record.ar) english.add(record.en)
    for (const one of Object.values(record)) walk(one)
  }
  const screen = asas.targets.dashboard.client
  walk(screen)
  const sources = [
    fileURLToPath(new URL('../packages/mithaq-admin/registry', import.meta.url)),
    fileURLToPath(new URL('./asas-tanstack/src/routes', import.meta.url)),
    ...['mithaq/src/ui', 'asas/src/ui-dashboard', 'features/courses/courses/ui', 'features/courses/enrollments/ui', 'features/roles/roles/ui', 'features/media/media/ui'].map((where) => fileURLToPath(new URL(`../templates/${where}`, import.meta.url))),
  ].flatMap((directory) => readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name)).map((entry) => readFileSync(`${directory}/${entry.name}`, 'utf8')))
  // The host's own bar, which draws the impersonation's words over every page.
  sources.push(readFileSync(new URL('./asas-tanstack/src/screens.tsx', import.meta.url), 'utf8'))
  for (const hit of sources.join('\n').matchAll(/\bt\(\s*[`'][^`']+[`'],\s*'([^']+)'\s*\)/g)) english.add(hit[1]!)
  assert.ok(english.size > 200, `the English side is the whole copy, not a handful: ${english.size}`)

  // One row of each kayan, so every edit page draws a record.
  const me = (await (await fetch(`${origin}/api/auth/user/get-session`, { headers: { cookie } })).json()) as { user: { id: string } }
  const course = (await post('/api/courses/create', { title: `${title} ar`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  // Tomorrow, so the home's table of upcoming sessions has a row to draw in Arabic too.
  const session = (await post('/api/sessions/create', { course: course.id, startsAt: new Date(Date.now() + 86_400_000).toISOString(), capacity: 5, venue: 'campus', format: 'lecture' }, { cookie })).body
  const enrollment = (await asStudent(() => post('/api/enrollments/create', { session: session.id, student: me.user.id }, { cookie }))).body
  const tag = (await post('/api/tags/create', { name: { en: 'Boot tag', ar: 'وسم الاختبار' } }, { cookie })).body
  // A custom role, whose page is its form and its delete; the fixed ones are code, drawn on the list and walked below.
  const role = (await post('/api/roles/create', { name: `ar-${Date.now()}`, label: { en: 'Test role', ar: 'دور تجريبي' }, permissions: ['tags.find', 'tags.fields.id'] }, { cookie })).body
  // An image, sent the way the upload control sends one: instructions, the bytes where they say, then the create.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const asked = (await post('/api/media/uploadInstructions', { filename: 'boot.png', filesize: png.length, mimeType: 'image/png' }, { cookie })).body as { request: { url: string; headers: Record<string, string> }; file: { uploadReference: unknown } }
  assert.equal((await fetch(`${origin}${asked.request.url}`, { method: 'PUT', headers: asked.request.headers, body: png })).status, 204, 'the bytes are taken')
  const image = (await post('/api/media/create', { uploadReference: asked.file.uploadReference, alt: { en: 'Boot image', ar: 'صورة الاختبار' } }, { cookie })).body
  const rows: Record<string, unknown> = {
    courses: course.id,
    sessions: session.id,
    enrollments: enrollment.id,
    tags: tag.id,
    media: image.id,
    roles: role.id,
  }
  for (const [name, id] of Object.entries(rows)) assert.ok(typeof id === 'string', `a row of ${name} to draw: ${JSON.stringify(id)}`)

  const paths = [
    ...Object.values(screen.pages).map((one) => one.path),
    ...Object.values(screen.kayan).flatMap((kayan) => Object.values(kayan.pages).map((one) => one.path.replace(':id', String(rows[kayan.name]))),),
  ]
  const decode = (text: string) => text.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const drawn = async (path: string, session: string) => {
    const page = await fetch(`${origin}/dashboard${path === '/' ? '' : path}`, { headers: { cookie: `${session}; locale=ar` } })
    assert.equal(page.status, 200, `${path} answers 200 in Arabic`)
    const html = (await page.text()).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    assert.ok(html.includes('lang="ar"'), `${path} is the Arabic document`)
    const shown = [
      ...[...html.matchAll(/>([^<]+)</g)].map((hit) => decode(hit[1]!).trim()),
      ...[...html.matchAll(/\s(?:placeholder|aria-label|title)="([^"]*)"/g)].map((hit) => decode(hit[1]!).trim()),
    ].filter(Boolean)
    const leaked = shown.filter((text) => english.has(text) || text === '[object Object]')
    assert.deepEqual(leaked, [], `${path} draws no English copy in Arabic`)
    return { html, shown }
  }
  // As backoffice staff, so every page's header draws the link to the backoffice app.
  await staffAs('super_admin', async () => {
    for (const path of paths) {
      const { html, shown } = await drawn(path, cookie)
      assert.ok(html.includes('data-backoffice-link') && shown.includes('فتح لوحة الإدارة الخلفية'), `${path} draws the backoffice link in Arabic`)
      if (path === '/') assert.ok(html.includes('data-home-table="sessions"') && shown.includes('الجلسات القادمة'), 'the home draws its table in Arabic')
      if (path === '/courses') assert.ok(html.includes('data-row-menu=') && html.includes('aria-label="إجراءات '), 'a list draws each row\'s menu, named in Arabic')
      if (/\/[0-9a-f-]{36}$/.test(path)) assert.ok(html.includes('data-button="delete"') && shown.includes('حذف'), `${path} draws its delete in Arabic`)
      if (/^\/(courses|sessions|enrollments)\/[0-9a-f-]{36}$/.test(path)) assert.ok(html.includes('data-panel="activity"') && shown.includes('النشاط'), `${path} draws its activity in Arabic`)
      if (/^\/courses\/[0-9a-f-]{36}$/.test(path)) {
        // Save draft shows beside the course's autosave, and the controls say when the course was last saved.
        for (const word of ['نشر التغييرات', 'حفظ المسودة', 'الحالة', 'منشور', 'الإصدارات', 'جارٍ تحميل الإصدارات…']) assert.ok(shown.includes(word), `the course page says ${word} in Arabic`)
        assert.ok(shown.some((text) => text.startsWith('تم التحديث ')), 'and says when it was last saved in Arabic')
      }
      if (path === '/courses/new') assert.ok(shown.includes('حفظ المسودة') && shown.includes('نشر'), 'the create page offers Save draft and Publish, in Arabic')
      // The members page's sheet is a closed dialog in the first paint, so every word it shows is walked here.
      if (path === '/members') {
        assert.ok(html.includes('data-members-tab="invitations"') && html.includes('data-role-filter'), 'the members page draws its tabs and its role filter')
        for (const word of ['الأعضاء', 'الاسم', 'الأدوار', 'تاريخ الانضمام', 'آخر ظهور', 'كل الأدوار', 'البريد الإلكتروني', 'أرسلها', 'تنتهي في', tenantRoles.registrar.label.ar]) assert.ok(shown.includes(word), `the members page says ${word} in Arabic`)
      }
      if (path === `/roles/${role.id}`) {
        assert.ok(html.includes('data-role-form') && html.includes('data-key="courses.find"'), 'the role form draws its badges')
        for (const word of ['الشاشات', 'لوحة التحكم', 'الدورات', 'عرض القائمة', 'أرشفة', 'الحقول', 'التسمية (العربية)']) assert.ok(shown.includes(word), `the role form says ${word} in Arabic`)
        // The key this project adds beside the enrollments' operations, offered by its own label.
        assert.ok(html.includes('data-key="enrollments.others"') && shown.includes('تسجيلات الجميع'), 'the role form offers every seat of the organization, named in Arabic')
      }
    }
    const list = await drawn('/roles', cookie)
    assert.ok(list.html.includes('data-fixed-role') && list.shown.includes(tenantRoles.registrar.label.ar) && list.shown.includes('الدورات'), 'a fixed role names itself and its permissions in Arabic on the list')
    assert.ok(list.shown.includes('ثابت') && list.shown.includes('مخصص'), 'the Roles list names each kind in Arabic')
    assert.ok(list.shown.includes(tenantRoles.administrator.label.ar) && !list.shown.includes('administrator'), 'and each role by its Arabic label, never its slug')
  })

  const member = await signedUpHere('arabic-bar')
  const server = (asas.auth.strategies.find((one) => one.name === 'user') as unknown as { server: { api: { addMember(args: unknown): Promise<unknown> } } }).server
  const organization = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { session: { activeOrganizationId: string } }).session.activeOrganizationId
  await server.api.addMember({ body: { userId: member.id, organizationId: organization, role: 'member' } })
  await assignRole(organization, member.id, 'registrar')
  const staff = await backofficeSignIn()
  await staffAs('support', async () => {
    const started = await fetch(`${backofficeOrigin}/api/auth/user/admin/impersonate-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: staff, origin: backofficeOrigin },
      body: JSON.stringify({ userId: member.id }),
    })
    assert.equal(started.status, 200, await started.clone().text())
    const as = jarOf('', await fetch(((await started.json()) as { url: string }).url, { redirect: 'manual' }))
    const { html, shown } = await drawn('/', as)
    assert.ok(html.includes('data-impersonating') && shown.some((text) => text.startsWith('أنت تنتحل صفة')) && shown.includes('إيقاف انتحال الصفة'), 'the impersonation bar is drawn in Arabic')
    await post('/api/auth/user/sign-out', {}, { cookie: as, origin })
  })
})

test('57. the course page lists only its own sessions in a Sessions tab, searched, filtered and paged on the server under its own URL keys, the session page lists its enrollments the same way, and an actor who may read courses but not sessions sees the tab refuse, as the server does', async () => {
  const course = (await post('/api/courses/create', { title: `${title} with sessions`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  const other = (await post('/api/courses/create', { title: `${title} without`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  const made: string[] = []
  for (let at = 0; at < 12; at++) {
    const one = await post('/api/sessions/create', { course: course.id, startsAt: new Date(Date.UTC(2031, 0, 1 + at)).toISOString(), capacity: 5, venue: at < 3 ? 'online' : 'campus', format: 'lecture' }, { cookie })
    assert.equal(one.response.status, 200, JSON.stringify(one.body))
    made.push(String(one.body.id))
  }
  const stray = String((await post('/api/sessions/create', { course: other.id, startsAt: new Date(Date.UTC(2031, 0, 1)).toISOString(), capacity: 5, venue: 'online', format: 'lecture' }, { cookie })).body.id)
  const rows = (html: string) => [...html.matchAll(/href="\/dashboard\/sessions\/([0-9a-f-]{36})"/g)].map((hit) => hit[1])
  const at = (query = '') => screenHtml(`/dashboard/courses/${course.id}${query}`)

  const first = await at()
  assert.match(first, /data-node="tabs"[^]*?>Sessions</, 'the edit page draws a Sessions tab')
  assert.deepEqual(rows(first), made.slice(0, 10), 'its first page, sorted by start, holds this course\'s sessions alone')
  assert.ok(!first.includes(stray), 'and none of another course')
  assert.deepEqual(rows(await at('?sessions.course.page=2')), made.slice(10), 'the list pages under its own key')
  assert.deepEqual(rows(await at('?page=2')), made.slice(0, 10), 'and never reads a key of the page\'s own list')
  assert.deepEqual(rows(await at('?sessions.course.search=online')), made.slice(0, 3), 'its search runs on the server')
  assert.deepEqual(rows(await at('?sessions.course.where[venue][equals]=online')), made.slice(0, 3), 'and so does its filter')
  assert.match(await at('?sessions.course.where[title][like]=x'), /data-mithaq-refused=/, 'a filter the list does not offer is refused and reads nothing')
  // No URL widens the scope: a filter naming the relationship itself is no
  // filter the list offers, and an `or` is ANDed under the scope, not beside it.
  const widened = await at(`?sessions.course.where[course][equals]=${other.id}`)
  assert.match(widened, /data-mithaq-refused=/, 'a filter on the scoping relationship is refused')
  assert.ok(!widened.includes(stray) && rows(widened).every((id) => made.includes(id!)), 'and draws no session of another course')
  const either = await at('?sessions.course.where[or][0][and][0][venue][equals]=online&sessions.course.where[or][1][and][0][venue][equals]=campus')
  assert.deepEqual(rows(either), made.slice(0, 10), 'an or over every venue still holds this course\'s sessions alone')
  assert.ok(!either.includes(stray))

  // The bulk archive archives and does nothing else: whatever `data` a call sends, the matched row reads archived
  // and an unmatched session is untouched.
  const archived = await post('/api/sessions/archiveMany', { where: { id: { in: [made[1]] } }, data: { archived: false } }, { cookie })
  assert.equal(archived.response.status, 200, JSON.stringify(archived.body))
  const held = (await post('/api/sessions/find', { where: { id: { in: [made[1], stray] } } }, { cookie })).body.docs as { id: string; archived?: boolean }[]
  assert.equal(held.find((one) => one.id === made[1])?.archived, true, 'the matched session reads archived, whatever data the call sent')
  assert.notEqual(held.find((one) => one.id === stray)?.archived, true, 'and another course\'s session is untouched')

  const me = (await (await fetch(`${origin}/api/auth/user/get-session`, { headers: { cookie } })).json()) as { user: { id: string } }
  const enrollment = (await asStudent(() => post('/api/enrollments/create', { session: made[0], student: me.user.id }, { cookie }))).body
  const session = await screenHtml(`/dashboard/sessions/${made[0]}`)
  assert.match(session, /data-node="tabs"[^]*?>Enrollments</, 'the session page draws an Enrollments tab')
  assert.ok(session.includes(`href="/dashboard/enrollments/${enrollment.id}"`), 'listing its enrollment')

  // A role that reads courses and holds no key of sessions.
  const reader = await post('/api/roles/create', {
    name: 'catalogue-reader',
    label: { en: 'Test role', ar: 'دور تجريبي' },
    permissions: ['screen.dashboard', 'courses.find', 'courses.count', 'courses.findByID', 'courses.fields.id', 'courses.fields.title', 'courses.fields.organization', 'courses.fields.createdAt', 'courses.fields.updatedAt'],
  }, { cookie })
  assert.equal(reader.response.status, 200, JSON.stringify(reader.body))
  await holding('catalogue-reader', async () => {
    const found = await post('/api/sessions/find', { where: { course: { equals: course.id } } }, { cookie })
    assert.equal(found.response.status, 403, 'the server refuses this actor a read of sessions')
    const page = await (await fetch(`${origin}/dashboard/courses/${course.id}`, { headers: { cookie } })).text()
    assert.match(page, /data-mithaq-refused-list="sessions"[^>]*>You can(&#x27;|&#39;|')t see this</, 'and the tab says the viewer cannot see it')
    assert.deepEqual(rows(page), [], 'drawing no session')
  })
})

test('58. the backoffice link is the dashboard\'s alone: a dashboard page in the top shell draws it for staff, and no portal page draws it for the same person', async () => {
  // The portal draws its own top shell, which has no link, and the dashboard's keeps it: decided by the shell each screen names, not the URL.
  const course = (await post('/api/courses/create', { title: `${title} portal link`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  const me = (await (await fetch(`${origin}/api/auth/user/get-session`, { headers: { cookie } })).json()) as { user: { id: string } }
  const session = (await post('/api/sessions/create', { course: course.id, startsAt: new Date().toISOString(), capacity: 5, venue: 'campus', format: 'lecture' }, { cookie })).body
  const enrollment = (await asStudent(() => post('/api/enrollments/create', { session: session.id, student: me.user.id }, { cookie }))).body
  const rows: Record<string, string> = { courses: String(course.id), enrollments: String(enrollment.id) }
  const portal = asas.targets.portal.client
  const paths = [
    ...Object.values(portal.pages).map((one) => one.path),
    ...Object.values(portal.kayan).flatMap((kayan) => Object.values(kayan.pages).map((one) => one.path.replace(':id', rows[kayan.name]!))),
  ]
  assert.ok(paths.length >= 6, `every portal page: ${paths.join(', ')}`)
  await staffAs('super_admin', async () => {
    const board = await screenHtml('/dashboard/courses/board')
    assert.ok(board.includes('data-shell="top"') && board.includes('data-backoffice-link'), 'the dashboard\'s top-shell page draws the link for staff')
    for (const path of paths) {
      const html = await screenHtml(`/portal${path === '/' ? '' : path}`)
      assert.ok(!html.includes('data-backoffice-link'), `the portal's ${path} draws no backoffice link`)
    }
  })
})

test('59. an enrollment served over HTTP names the tenant\'s own member as its student, and another tenant\'s user is refused 403 by the reference key', async () => {
  // Another tenant's owner, made in this process, since the provider's rate
  // limit on sign-up refuses a socket sign-up this late in the file.
  const stranger = await signedUpHere('stranger')
  const server = (asas.auth.strategies.find((one) => one.name === 'user') as unknown as { server: { api: { createOrganization(args: unknown): Promise<unknown> } } }).server
  const stamp = Date.now()
  await server.api.createOrganization({ body: { name: `Stranger ${stamp}`, slug: `stranger-${stamp}`, userId: stranger.id } })
  const me = (await (await fetch(`${origin}/api/auth/user/get-session`, { headers: { cookie } })).json()) as { user: { id: string } }

  const crossed = await post('/api/enrollments/create', { session: screenSession, student: stranger.id }, { cookie })
  assert.equal(crossed.response.status, 400, `another tenant's user is refused as the student: ${JSON.stringify(crossed.body)}`)
  assert.equal((crossed.body.data as { key?: string }).key, 'error.invalid.reference', 'under the reference key')
  // A session of its own, since the actor already holds its one seat in the screen's session.
  const session = (await post('/api/sessions/create', { course: screenCourse, startsAt: new Date(Date.now() + 86_400_000).toISOString() }, { cookie })).body as { id: string }
  const own = await asStudent(() => post('/api/enrollments/create', { session: session.id, student: me.user.id }, { cookie }))
  assert.equal(own.response.status, 200, `the tenant's own member is admitted: ${JSON.stringify(own.body)}`)
})

test('60. the dashboard is one look: affixes are addons, every checkbox and select draws the same classes, every row opens its record with its title first and a menu last, the Roles page lists no backoffice role, and the home carries the table of upcoming sessions, in both locales', async () => {
  const course = (await post('/api/courses/create', { title: `${title} one look`, fee: 450, delivery: 'live', currency: 'USD' }, { cookie })).body
  const soon = (await post('/api/sessions/create', { course: course.id, startsAt: new Date(Date.now() + 3_600_000).toISOString(), capacity: 7, venue: 'campus', format: 'lecture' }, { cookie })).body
  assert.equal(typeof soon.id, 'string', JSON.stringify(soon))
  const as = async (path: string, locale: 'en' | 'ar') => {
    const page = await fetch(`${origin}${path}`, { headers: { cookie: `${cookie}; locale=${locale}` } })
    assert.equal(page.status, 200, `${path} answers 200 in ${locale}`)
    return (await page.text()).replace(/<script[\s\S]*?<\/script>/g, '')
  }
  const classesOf = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((hit) => /class="([^"]*)"/.exec(hit[0])?.[1] ?? '')
  for (const locale of ['en', 'ar'] as const) {
    // An affix is an addon on a fill of its own, ruled off the box, never text inside it.
    const edit = await as(`/dashboard/courses/${course.id}`, locale)
    const affix = (which: string) => new RegExp(`<div[^>]*data-affix="${which}"[^>]*>[\\s\\S]*?</div>`).exec(edit)?.[0] ?? ''
    assert.match(affix('prefix'), /bg-muted[^"]*border-e|border-e[^"]*bg-muted/, `the prefix is an addon in ${locale}`)
    assert.ok(affix('prefix').includes(locale === 'ar' ? 'دورة' : 'Course'), `holding the prefix in ${locale}`)
    assert.match(affix('suffix'), /bg-muted[^"]*border-s|border-s[^"]*bg-muted/, `the suffix is an addon in ${locale}`)
    assert.ok(affix('suffix').includes(locale === 'ar' ? 'لكل مقعد' : 'per seat'), `holding the suffix in ${locale}`)

    for (const path of ['/dashboard/courses', `/dashboard/courses/${course.id}`]) {
      const html = await as(path, locale)
      const boxes = classesOf(html, /<[a-z]+[^>]*data-slot="checkbox"[^>]*>/g)
      assert.ok(boxes.length > 0, `${path} draws checkboxes`)
      for (const box of boxes) assert.ok(box.split(' ').includes('size-4'), `every checkbox on ${path} is size-4: ${box}`)
    }
    const session = await as('/dashboard/sessions/new', locale)
    const triggers = classesOf(session, /<button[^>]*data-slot="select-trigger"[^>]*>/g)
    const groups = classesOf(session, /<div[^>]*data-slot="input-group"[^>]*>/g)
    assert.ok(triggers.length >= 1 && groups.length >= 2, `the venue is a select and the format and the course are comboboxes: ${triggers.length}, ${groups.length}`)
    for (const one of [...triggers, ...groups]) {
      for (const look of ['border-input', 'bg-input/30', 'rounded-4xl']) assert.ok(one.split(' ').includes(look), `every select and picker carries ${look}: ${one}`)
    }
    assert.ok(!session.includes('data-slot="native-select"'), 'and none is the native box')

    const list = await as('/dashboard/courses', locale)
    const heads = [...list.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((hit) => hit[1]!.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
    assert.equal(heads[0], locale === 'ar' ? 'العنوان' : 'Title', `the title column comes first in ${locale}: ${heads.join(', ')}`)
    const row = new RegExp(`<tr[^>]*data-row="${course.id}"[^>]*>[\\s\\S]*?</tr>`).exec(list)?.[0] ?? ''
    assert.match(row, /tabindex="0"/, 'the row is a stop of the tab order')
    assert.ok(row.includes(`data-row-link="${course.id}"`) && row.includes(`href="/dashboard/courses/${course.id}"`), 'carrying the link it opens')
    const menu = `${locale === 'ar' ? 'إجراءات' : 'Actions for'} \u2068${course.title}\u2069`
    assert.match(row, new RegExp(`data-row-menu="${course.id}"[^>]*aria-label="${menu}"|aria-label="${menu}"[^>]*data-row-menu="${course.id}"`), 'and a menu at its end named for its row')

    const roles = await as('/dashboard/roles', locale)
    for (const [slug, role] of Object.entries(backofficeRoles)) assert.ok(!roles.includes(`>${slug}<`) && !roles.includes(`>${role.label[locale]}<`), `the Roles page lists no ${slug}`)
    assert.ok(roles.includes(`>${tenantRoles.administrator.label[locale]}<`), 'and still lists the tenant roles, by their labels')
    assert.ok(!roles.includes('>administrator<'), 'never by their slugs')

    const home = await as('/dashboard', locale)
    const table = home.slice(home.indexOf('data-home-table="sessions"'))
    assert.ok(home.indexOf('data-home-table="sessions"') > home.indexOf('data-chart-card="enrollments"'), 'the table sits under the chart')
    assert.ok(table.includes(locale === 'ar' ? 'الجلسات القادمة' : 'Upcoming sessions'), `headed in ${locale}`)
    assert.ok(table.includes(`href="/dashboard/sessions/${soon.id}"`) && table.includes(`${title} one look`), 'listing the session about to start under its course')
    assert.ok(table.includes(locale === 'ar' ? 'الحرم' : 'Campus'), `its venue in ${locale}`)
  }
})

test('61. each dashboard edit page draws the record\'s activity beside its form in both locales, and the log it reads answers that record\'s writes newest first and takes no write', async () => {
  const course = (await post('/api/courses/create', { title: `${title} audited`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  await post('/api/courses/update', { id: course.id, fee: 20 }, { cookie })
  await post('/api/courses/archive', { id: course.id, reason: 'Boot' }, { cookie })
  const read = await post('/api/auditLog/find', { where: { and: [{ kayan: { equals: 'courses' } }, { record: { equals: course.id } }] }, sort: '-createdAt', limit: 10, page: 1, depth: 0 }, { cookie })
  assert.equal(read.response.status, 200, JSON.stringify(read.body))
  assert.deepEqual((read.body.docs as { operation: string }[]).map((entry) => entry.operation), ['archive', 'update', 'create'], 'one entry per write, newest first')
  const fee = JSON.parse((read.body.docs as { changes: string }[])[1]!.changes).fee
  assert.deepEqual(fee, { from: 10, to: 20 }, 'the update holds the fee before and after')
  // A create names what it set and no field empty before and after, so the panel draws no line of a dash to a dash.
  const created = Object.keys(JSON.parse((read.body.docs as { changes: string }[])[2]!.changes) as object)
  assert.ok(['title', 'fee', 'delivery', 'currency'].every((name) => created.includes(name)) && !['summary', 'accessCode', 'notifications', 'tags', 'topics'].some((name) => created.includes(name)), `the create's entry lists what it set alone: ${created}`)
  for (const operation of ['create', 'update', 'delete']) {
    const refused = await post(`/api/auditLog/${operation}`, { id: (read.body.docs as { id: string }[])[0]!.id, operation: 'forged' }, { cookie })
    assert.equal(refused.response.status, 404, `no ${operation} of an entry is served`)
  }

  // Of an open course, as the archived one's sessions take no seat.
  const open = (await post('/api/courses/create', { title: `${title} audited open`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  const session = (await post('/api/sessions/create', { course: open.id, startsAt: new Date(Date.now() + 86_400_000).toISOString(), capacity: 5, venue: 'campus', format: 'lecture' }, { cookie })).body
  const me = (await (await fetch(`${origin}/api/auth/user/get-session`, { headers: { cookie } })).json()) as { user: { id: string } }
  const enrollment = (await asStudent(() => post('/api/enrollments/create', { session: session.id, student: me.user.id }, { cookie }))).body
  for (const locale of ['en', 'ar'] as const) {
    for (const path of [`/courses/${course.id}`, `/sessions/${session.id}`, `/enrollments/${enrollment.id}`]) {
      const page = await fetch(`${origin}/dashboard${path}`, { headers: { cookie: `${cookie}; locale=${locale}` } })
      const html = await page.text()
      const side = html.slice(html.indexOf('data-region="side"'))
      assert.ok(side.includes('data-panel="activity"'), `${path} draws the panel in its side column`)
      assert.ok(side.includes(locale === 'ar' ? 'النشاط' : 'Activity') && side.includes(locale === 'ar' ? 'جارٍ تحميل النشاط…' : 'Loading activity…'), `headed and loading in ${locale}`)
    }
  }
  // The panel follows the report: the registrar holds the log's find and sees it, and a role that reads courses
  // and holds no key of the log is drawn no panel, which the server would refuse it anyway.
  await holding('registrar', async () => {
    const page = await (await fetch(`${origin}/dashboard/courses/${course.id}`, { headers: { cookie } })).text()
    assert.ok(page.includes('data-panel="activity"'), 'the registrar is drawn the panel')
  })
  await holding('catalogue-reader', async () => {
    assert.equal((await post('/api/auditLog/find', { where: { record: { equals: course.id } } }, { cookie })).response.status, 403, 'the server refuses the log to a role without its key')
    const page = await (await fetch(`${origin}/dashboard/courses/${course.id}`, { headers: { cookie } })).text()
    assert.ok(page.includes('data-record="row"') && !page.includes('data-panel="activity"'), 'and the edit page draws no panel for it')
  })
  // A student reads no archived course, so a link to one in the portal opens the not-found state and no record.
  await holding('student', async () => {
    const page = await (await fetch(`${origin}/portal/courses/${course.id}`, { headers: { cookie: `${cookie}; locale=en` } })).text()
    assert.ok(page.includes('That page does not exist.') && !page.includes(String(course.title)), 'a student opening an archived course is drawn not-found')
  })
  // A change is searched by one `contains` alone, which the server narrows to the kayan its reader reads whole.
  for (const body of [{ where: { changes: { equals: '"fee"' } } }, { where: { or: [{ record: { equals: course.id } }, { changes: { like: 'fee' } }] } }, { where: { changed: { contains: 'fee' } } }, { sort: 'changes' }, { sort: 'changed' }]) {
    assert.equal((await post('/api/auditLog/find', body, { cookie })).response.status, 400, `the log refuses ${JSON.stringify(body)}`)
  }
  assert.equal((await post('/api/auditLog/find', { where: { changes: { contains: '"fee"' } } }, { cookie })).response.status, 200, 'and answers a search of a change\'s text')
  assert.equal((await post('/api/auditLog/find?tenant=mine', { where: { record: { equals: course.id } } }, { cookie })).response.status, 403, 'and no read widened past the active organization')
})

test('62. a member\'s roles are changed on the members page: its sheet offers every role of the tenant and no backoffice role, an administrator adds and removes one through the assignment kayan, a role the actor may not grant is offered disabled and refused anyway, and the Roles page locks each fixed role and counts a custom one\'s holders', async () => {
  const server = (asas.auth.strategies.find((one) => one.name === 'user') as unknown as { server: { api: { addMember(args: unknown): Promise<unknown> } } }).server
  const organization = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { session: { activeOrganizationId: string } }).session.activeOrganizationId
  const member = await signedUpHere('sheet')
  await server.api.addMember({ body: { userId: member.id, organizationId: organization, role: 'member' } })
  const custom = (await post('/api/roles/create', { name: `teacher-${Date.now()}`, label: { en: 'Teacher 62', ar: 'معلم 62' }, permissions: ['screen.dashboard', 'tags.find', 'tags.fields.id'] }, { cookie })).body as { id: string; name: string }
  assert.equal(typeof custom.id, 'string', JSON.stringify(custom))

  const page = await screenHtml('/dashboard/members')
  // The roles the filter offers are the roles the Edit roles drawer offers: the page's one list of them.
  const offered = [...page.slice(page.indexOf('data-role-filter'), page.indexOf('</select>', page.indexOf('data-role-filter'))).matchAll(/<option value="([^"]+)"/g)].map((hit) => hit[1]!)
  for (const role of ['administrator', 'registrar', 'instructor', custom.name]) assert.ok(offered.includes(role), `the page offers ${role}`)
  for (const role of Object.keys(backofficeRoles)) assert.ok(!offered.includes(role), `and never the backoffice role ${role}`)
  assert.ok(page.includes(`data-row-menu="${member.id}"`), 'each member row carries its menu, which edits its roles')
  assert.ok(!page.includes('href="/dashboard/member-roles'), 'and nothing links a Member roles page, which the dashboard no longer has')
  assert.equal((await fetch(`${origin}/dashboard/member-roles`, { headers: { cookie } })).status, 404, 'nor serves one')

  const added = await post('/api/memberRoles/create', { user: member.id, role: custom.name }, { cookie })
  assert.equal(added.response.status, 200, JSON.stringify(added.body))
  const drawn = await screenHtml('/dashboard/members')
  const row = new RegExp(`<tr[^>]*data-row="${member.id}"[\\s\\S]*?</tr>`).exec(drawn)?.[0] ?? ''
  assert.ok(row.includes('>Teacher 62<') && !row.includes(`>${custom.name}<`), 'the member now holds the role on the page, read by its label')
  assert.ok(drawn.includes(`<option value="registrar">${tenantRoles.registrar.label.en}</option>`), 'and the page names a fixed role by the label its code declares')

  for (const [operation, body] of [['delete', { id: custom.id }], ['update', { id: custom.id, name: `${custom.name}-renamed` }]] as const) {
    const refused = await post(`/api/roles/${operation}`, body, { cookie })
    assert.equal(refused.response.status, 409, `a held role's ${operation} is refused 409: ${JSON.stringify(refused.body)}`)
    const data = refused.body.data as { key?: string; params?: { members?: { id: string; name: string }[] } }
    assert.equal(data.key, 'error.conflict.role_held')
    assert.deepEqual(data.params?.members?.map((one) => one.id), [member.id], 'naming the member who holds it')
  }
  assert.equal((await fetch(`${origin}/dashboard/members?member=${member.id}`, { headers: { cookie } })).status, 200, 'and the page each name links to, the members page on that member, answers')
  const mine = ((await post('/api/memberRoles/find', { where: { role: { equals: 'administrator' } } }, { cookie })).body.docs as { id: string; user: string }[])
  const me = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { user: { id: string } }).user.id
  const own = await post('/api/memberRoles/delete', { id: mine.find((one) => one.user === me)!.id }, { cookie })
  assert.equal(own.response.status, 403, 'an administrator is refused removing their own administrator row')
  assert.equal((own.body.data as { key?: string }).key, 'error.forbidden.own_role')
  const counted = await post('/api/memberRoles/count', { where: { role: { equals: custom.name } } }, { cookie })
  assert.equal(counted.body.totalDocs, 1, 'and the count the role\'s delete asks with says one member holds it')
  assert.equal((await post('/api/memberRoles/delete', { id: added.body.id }, { cookie })).response.status, 200, 'unticking it removes the row')
  assert.ok(!new RegExp(`<tr[^>]*data-row="${member.id}"[\\s\\S]*?</tr>`).exec(await screenHtml('/dashboard/members'))?.[0]?.includes('>Teacher 62<'), 'and the page no longer lists it')

  const assigner = await post('/api/roles/create', {
    name: 'assigner',
    label: { en: 'Test role', ar: 'دور تجريبي' },
    permissions: [
      'screen.dashboard', 'tags.find', 'tags.fields.id', 'member.find', 'member.fields.id',
      'memberRoles.find', 'memberRoles.create', 'memberRoles.delete', 'memberRoles.fields.id', 'memberRoles.fields.user', 'memberRoles.fields.role', 'memberRoles.fields.organization',
      'roles.find', 'roles.findByID', 'roles.fields.id', 'roles.fields.name', 'roles.fields.label', 'roles.fields.permissions',
    ],
  }, { cookie })
  assert.equal(assigner.response.status, 200, JSON.stringify(assigner.body))
  await holding('assigner', async () => {
    // Which boxes the Edit roles drawer disables is the page's own test; here the server refuses whatever it draws.
    const delegated = await screenHtml('/dashboard/members')
    assert.ok(delegated.includes(`data-row="${member.id}"`) && !delegated.includes('>Last seen<'), 'the delegate lists the members, and without member.fields.lastSeenAt no one\'s last seen')
    const listed = (await (await fetch(`${origin}/api/auth/user/organization/list-members`, { headers: { cookie } })).json()) as { members: Record<string, unknown>[] }
    assert.ok(listed.members.length > 0 && listed.members.every((one) => !('lastSeenAt' in one)), 'nor does the server answer it')
    for (const role of ['administrator', 'registrar']) {
      const refused = await post('/api/memberRoles/create', { user: member.id, role }, { cookie })
      assert.equal(refused.response.status, 403, `the server refuses ${role} anyway: ${JSON.stringify(refused.body)}`)
      assert.equal((refused.body.data as { key?: string }).key, 'error.forbidden.assign', 'under the assignment guard\'s own key')
    }
    const picker = await screenHtml(`/dashboard/roles/${custom.id}`)
    const badge = (key: string) => new RegExp(`<button[^>]*data-key="${key.replace('.', '\\.')}"[^>]*>`).exec(picker)?.[0] ?? ''
    assert.match(badge('tags.find'), /data-disabled="false"/, 'a key the delegate holds is offered')
    assert.match(badge('tags.create'), /data-disabled="true"/, 'a key it does not hold is offered disabled')
    assert.ok(!picker.includes('data-key="courses.find"'), 'and a kayan it may not read is offered nowhere')
  })

  const list = await screenHtml('/dashboard/roles')
  const lock = (name: string) => new RegExp(`<tr[^>]*data-fixed="true"[^>]*>(?:(?!</tr>)[\\s\\S])*data-lock=""(?:(?!</tr>)[\\s\\S])*>${name}<`).test(list)
  for (const role of ['administrator', 'registrar', 'instructor'] as const) assert.ok(lock(tenantRoles[role].label.en), `${role} is listed with its lock, by its label`)
  assert.ok(new RegExp(`<tr[^>]*data-fixed="false"[^>]*>(?:(?!</tr>)[\\s\\S])*>Teacher 62<`).test(list), 'a custom role without one')
  assert.ok(!list.includes(`>${custom.name}<`) && !list.includes('>registrar<'), 'and no slug is drawn')
  assert.ok(!list.includes('data-row-menu'), 'and no row carries a menu, so no role is deleted from the list')
  // A fixed role is code, so it has no row and no page of its own: its row on the list holds its keys, read only.
  const locked = list.slice(list.indexOf('data-row="instructor"')).split('</tr>')[0]!
  assert.ok(locked.includes('data-fixed-role') && !locked.includes('href=') && !locked.includes('data-button='), 'a fixed role opens no page, and offers no save and no delete')
  assert.ok(locked.includes(`>${tenantRoles.instructor.label.en}<`) && !locked.includes('>instructor<'), 'named by its label')
  assert.ok(locked.includes('data-group="courses"') && locked.includes('data-key="courses.find"') && !locked.includes('data-key="courses.delete"'), 'its keys as badges grouped by kayan, the ones it holds alone')
  assert.equal(((await post('/api/roles/find', { where: { name: { equals: 'instructor' } } }, { cookie })).body.docs as unknown[]).length, 0, 'and no row of the roles kayan names it')
  const opened = await screenHtml(`/dashboard/roles/${custom.id}`)
  assert.ok(opened.includes('data-role-form') && opened.includes('data-button="delete"'), 'a custom role opens its form and its delete')
  assert.ok(!opened.includes('id="roles-permissions"') && !opened.includes('<textarea'), 'with no box to type a key into')
  assert.ok(opened.includes('value="Teacher 62"') && opened.includes('value="معلم 62"'), 'a box per locale holding its label')
  const keys = [...opened.matchAll(/<button[^>]*data-key="([^"]+)"[^>]*>/g)].map((hit) => [hit[1]!, hit[0]] as const)
  for (const group of ['screen', 'courses', 'tags', 'roles']) assert.ok(opened.includes(`data-group="${group}"`), `the badges hold a ${group} group`)
  assert.ok(keys.length > 100, `a badge per key: ${keys.length}`)
  for (const [key] of keys) assert.ok(asas.catalog.includes(key), `every badge is a key of the catalog: ${key}`)
  assert.ok(!keys.some(([key]) => key === 'screen.backoffice'), 'and none the backoffice\'s')
  for (const [key, element] of keys) assert.match(element, new RegExp(`data-selected="${key === 'screen.dashboard' || key === 'tags.find' || key === 'tags.fields.id'}"`), `${key} is selected exactly when the role holds it`)
  assert.ok(keys.every(([, element]) => element.includes('data-disabled="false"')), 'and none is disabled for a root granter')
  assert.ok(opened.includes('>List<') && opened.includes('>Archive<'), 'each operation named in words')
  const taken = await post('/api/roles/create', { name: 'instructor', label: { en: 'Instructor', ar: 'مدرس' }, permissions: ['tags.find', 'tags.fields.id'] }, { cookie })
  assert.equal(taken.response.status, 400, 'the server refuses a row taking a fixed role\'s name to the tenant administrator')
  assert.equal((taken.body.data as { key?: string }).key, 'error.invalid.system_role_name', 'naming it a role this project ships')
})

test('63. a course keeps drafts on its edit page: an actor holding findVersions edits the latest draft under Save draft and Publish changes, sees where the row stands and its Versions tab, and an actor without the key edits the published row under a plain Save with no status and no tab', async () => {
  // The clicks and the autosave timer are the form's, driven in a DOM by registry tests; here the page is read as the
  // server renders it and each write is the request the form sends.
  const course = (await post('/api/courses/create', { title: `${title} published`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  const edit = async (id = String(course.id), session = cookie) => (await fetch(`${origin}/dashboard/courses/${id}`, { headers: { cookie: session } })).text()
  const statusOf = (html: string) => html.match(/data-status="([a-z]+)"/)?.[1]

  let html = await edit()
  assert.equal(statusOf(html), 'published', 'a course written plainly reads published')
  assert.ok(html.includes('data-button="save-draft"') && html.includes('data-button="publish"') && html.includes('>Publish changes<') && html.includes('>Save draft<'), 'and offers Save draft and Publish changes beside its autosave')
  assert.ok(!html.includes('>Save<'), 'in place of the plain Save')
  assert.match(html, /data-node="tabs"[^]*?>Versions</, 'beside a Versions tab')
  assert.ok(html.includes('data-panel="versions"'), 'which draws the versions panel')

  const drafted = await post('/api/courses/update?draft=true', { id: course.id, title: `${title} drafted` }, { cookie })
  assert.equal(drafted.response.status, 200, JSON.stringify(drafted.body))
  const autosaved = await post('/api/courses/update?draft=true&autosave=true', { id: course.id, title: `${title} autosaved` }, { cookie })
  assert.equal(autosaved.response.status, 200, JSON.stringify(autosaved.body))
  html = await edit()
  assert.ok(html.includes(`value="${title} autosaved"`), 'the form holds the latest draft')
  assert.equal(statusOf(html), 'changed', 'and the row reads published with changes')

  const never = (await post('/api/courses/create?draft=true', { title: `${title} never published` }, { cookie })).body
  assert.equal(statusOf(await edit(String(never.id))), 'draft', 'a course never published reads draft')
  const create = await (await fetch(`${origin}/dashboard/courses/new`, { headers: { cookie } })).text()
  assert.ok(create.includes('data-button="save-draft"') && create.includes('data-button="publish"'), 'the create page offers Save draft and Publish changes ()')
  assert.equal(statusOf(create), 'draft', 'and reads Draft from the start, as Payload\'s create does, so the row its first autosave makes is no surprise')

  // Publish: the plain write naming the row alone publishes the pending draft.
  const published = await post('/api/courses/update', { id: course.id }, { cookie })
  assert.equal(published.response.status, 200, JSON.stringify(published.body))
  html = await edit()
  assert.equal(statusOf(html), 'published', 'once published, nothing is pending')
  assert.ok(html.includes(`value="${title} autosaved"`), 'and the row carries the draft it published')
  await post('/api/courses/update?draft=true', { id: course.id, title: `${title} drafted again` }, { cookie })

  // A role that edits courses and holds no key of their versions.
  const editor = await post('/api/roles/create', {
    name: 'course-editor-63',
    label: { en: 'Course editor', ar: 'محرر الدورات' },
    permissions: ['screen.dashboard', 'courses.find', 'courses.count', 'courses.findByID', 'courses.update', 'courses.fields.id', 'courses.fields.title', 'courses.fields.organization', 'courses.fields.createdAt', 'courses.fields.updatedAt', 'courses.fields._status'],
  }, { cookie })
  assert.equal(editor.response.status, 200, JSON.stringify(editor.body))
  await holding('course-editor-63', async () => {
    const page = await edit()
    assert.ok(page.includes(`value="${title} autosaved"`) && !page.includes(`${title} drafted again`), 'the form holds the published row, and nothing of the draft')
    assert.ok(page.includes('>Save<') && !page.includes('data-button="save-draft"') && !page.includes('data-button="publish"'), 'under a plain Save alone')
    assert.ok(!page.includes('data-status='), 'with no status')
    assert.ok(!page.includes('>Versions<') && !page.includes('data-panel="versions"'), 'and no Versions tab')
    assert.equal((await fetch(`${origin}/dashboard/courses/${never.id}`, { headers: { cookie } })).status, 404, 'a course never published is not there for it')
  })
})

test('64. the course edit page draws its tabs at page level as the line bar, Details holding the record layout, and the form\'s controls in the sticky header on every tab, in both locales', async () => {
  const course = (await post('/api/courses/create', { title: `${title} controls`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  for (const [locale, words] of [['en', { publish: 'Publish changes', cancel: 'Back to list', published: 'Published', updated: 'Updated ' }], ['ar', { publish: 'نشر التغييرات', cancel: 'العودة إلى القائمة', published: 'منشور', updated: 'تم التحديث ' }]] as const) {
    const page = await fetch(`${origin}/dashboard/courses/${course.id}`, { headers: { cookie: `${cookie}; locale=${locale}` } })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.ok(html.includes(`lang="${locale}"`), `the ${locale} document`)
    const header = html.slice(html.indexOf('data-region="header"'), html.indexOf('</header>'))
    assert.ok(header.includes('data-node="controls"'), `${locale}: the header holds the form's controls`)
    assert.match(header, new RegExp(`data-slot="badge"[^>]*data-status="published"[^>]*>${words.published}<|data-status="published"[^>]*data-slot="badge"[^>]*>${words.published}<`), `${locale}: where the row stands, as a pill`)
    assert.ok(header.includes(`>${words.updated}`), `${locale}: when it was last saved`)
    assert.ok(header.includes(`>${words.cancel}<`), `${locale}: Back to list, beside a draft that saves itself`)
    const formId = html.match(/<form id="([^"]+)"/)?.[1]
    assert.ok(formId, 'the page holds one form')
    assert.match(header, new RegExp(`<button[^>]*type="submit"[^>]*form="${formId}"[^>]*data-button="publish"|<button[^>]*form="${formId}"[^>]*type="submit"`), `${locale}: and a submit naming the page's form by its id`)
    assert.ok(header.includes(`>${words.publish}<`), `${locale}: worded Publish changes`)
    const bar = html.indexOf('data-slot="tabs-list"')
    assert.ok(bar > html.indexOf('</header>') && /data-slot="tabs-list"[^>]*data-variant="line"|data-variant="line"[^>]*data-slot="tabs-list"/.test(html), `${locale}: the page's tabs draw the line bar`)
    assert.ok(html.indexOf('data-layout="record"') > bar, `${locale}: and Details holds the record layout, below the bar`)
  }
})

test('66. a changed course draws its amber pill, the Draft and Published switch and the draft strip in both locales, the served plug answers Discard changes, and the create page offers Save draft beside Publish', async () => {
  // The switch, the strip's two buttons and the autosave on a create are the form's, driven in a DOM by registry tests;
  // here the page is read as the server renders it, and Discard changes is the request the form sends.
  const course = (await post('/api/courses/create', { title: `${title} discard`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  await post('/api/courses/update?draft=true', { id: course.id, title: `${title} discard pending` }, { cookie })
  for (const [locale, words] of [
    ['en', { changed: 'Changed', draft: 'Draft', published: 'Published', editing: 'You are editing a draft. The published version is different.', view: 'View published', discard: 'Discard changes', publish: 'Publish' }],
    ['ar', { changed: 'تغييرات غير منشورة', draft: 'مسودة', published: 'منشور', editing: 'أنت تحرر مسودة. النسخة المنشورة مختلفة.', view: 'عرض النسخة المنشورة', discard: 'تجاهل التغييرات', publish: 'نشر' }],
  ] as const) {
    const html = await (await fetch(`${origin}/dashboard/courses/${course.id}`, { headers: { cookie: `${cookie}; locale=${locale}` } })).text()
    const header = html.slice(html.indexOf('data-region="header"'), html.indexOf('</header>'))
    const pill = header.match(/<span[^>]*data-status="changed"[^>]*>([^<]*)</)
    assert.equal(pill?.[1], words.changed, `${locale}: the pill says Changed`)
    assert.ok(pill![0].includes('bg-amber-500/15') && !pill![0].includes('max-sm:hidden'), `${locale}: in amber, and on a phone too`)
    const toggle = header.slice(header.indexOf('data-view-switch'))
    assert.ok(header.includes('data-view-switch') && toggle.includes(`>${words.draft}<`) && toggle.includes(`>${words.published}<`), `${locale}: the header holds the Draft and Published switch`)
    assert.ok(html.includes('data-draft-banner="draft"') && html.includes(words.editing), `${locale}: the draft strip above the form`)
    assert.ok(html.includes(`>${words.view}<`) && html.includes(`>${words.discard}<`), `${locale}: with View published and Discard changes`)
    if (locale === 'ar') {
      const english = ['Changed', 'Draft', 'Published', 'View published', 'Discard changes', 'Version shown', 'You are editing a draft. The published version is different.']
      assert.deepEqual(english.filter((one) => html.includes(`>${one}<`) || html.includes(`aria-label="${one}"`) || html.includes(`title="${one}"`)), [], 'ar: the switch and the strip draw no English')
    }
    const create = await (await fetch(`${origin}/dashboard/courses/new`, { headers: { cookie: `${cookie}; locale=${locale}` } })).text()
    assert.ok(create.includes(`>${words.publish}<`) && create.includes('data-button="save-draft"'), `${locale}: the create page offers Save draft beside Publish, as a course never published has no changes to publish`)
  }
  const discarded = await post('/api/courses/restoreVersion', { id: course.id }, { cookie })
  assert.equal(discarded.response.status, 200, JSON.stringify(discarded.body))
  const after = await (await fetch(`${origin}/dashboard/courses/${course.id}`, { headers: { cookie } })).text()
  assert.equal(after.match(/data-status="([a-z]+)"/)?.[1], 'published', 'Discard changes leaves the course Published')
  assert.ok(after.includes(`value="${title} discard"`) && !after.includes(`${title} discard pending`), 'holding the published copy and nothing of the draft')
  assert.ok(!after.includes('data-draft-banner') && !after.includes('data-view-switch'), 'with no strip and no switch')
})

test('65. the Versions tab draws in both locales, and the reads and the restore as a draft its compare sheet sends are answered by the served plug, leaving the published row as it is', async () => {
  // The list, the sheet, its select and its restore are driven in a DOM by registry tests; here the page is read as the
  // server renders it and each read and write is the request the sheet sends.
  const course = (await post('/api/courses/create', { title: `${title} v1`, fee: 10, delivery: 'live', currency: 'SAR' }, { cookie })).body
  await post('/api/courses/update', { id: course.id, title: `${title} v2` }, { cookie })
  await post('/api/courses/update?draft=true', { id: course.id, title: `${title} v3` }, { cookie })
  for (const [locale, words, english] of [
    ['en', { tab: 'Versions', loading: 'Loading versions…' }, []],
    ['ar', { tab: 'الإصدارات', loading: 'جارٍ تحميل الإصدارات…' }, ['>Versions<', 'Loading versions', 'Latest', 'Restore this version']],
  ] as const) {
    const html = await (await fetch(`${origin}/dashboard/courses/${course.id}`, { headers: { cookie: `${cookie}; locale=${locale}` } })).text()
    assert.match(html, new RegExp(`data-node="tabs"[^]*?>${words.tab}<`), `${locale}: the Versions tab`)
    assert.ok(html.includes('data-panel="versions"') && html.includes(words.loading), `${locale}: whose panel draws its first line in the viewer's words`)
    assert.deepEqual(english.filter((word) => html.includes(word)), [], `${locale}: and no English`)
  }

  const where = { parent: { equals: course.id } }
  const listed = await post('/api/courses/findVersions', { where, sort: '-updatedAt', limit: 10 }, { cookie })
  assert.equal(listed.response.status, 200, JSON.stringify(listed.body))
  const docs = listed.body.docs as { id: string; latest: boolean; version: { title: string; _status: string } }[]
  assert.deepEqual(docs.map((one) => [one.version.title, one.version._status, one.latest]), [[`${title} v3`, 'draft', true], [`${title} v2`, 'published', false], [`${title} v1`, 'published', false]], 'the list reads the history newest first')
  const opened = docs[1] as unknown as { updatedAt: string }
  const before = await post('/api/courses/findVersions', { where: { and: [where, { updatedAt: { less_than: opened.updatedAt } }] }, sort: '-updatedAt', limit: 1 }, { cookie })
  assert.equal(before.response.status, 200, JSON.stringify(before.body))
  assert.deepEqual((before.body.docs as { id: string }[]).map((one) => one.id), [docs[2]!.id], 'the sheet reads the newest version older than the one it opens')

  const restored = await post('/api/courses/restoreVersion?draft=true', { id: docs[2]!.id }, { cookie })
  assert.equal(restored.response.status, 200, JSON.stringify(restored.body))
  const plain = await post('/api/courses/findByID', { id: course.id }, { cookie })
  assert.deepEqual([plain.body.title, plain.body._status], [`${title} v2`, 'published'], 'a restore as a draft leaves the published row')
  const draft = await post('/api/courses/findByID?draft=true', { id: course.id }, { cookie })
  assert.deepEqual([draft.body.title, draft.body._status], [`${title} v1`, 'draft'], 'and the draft read is the version it restored')
})

test('67. every dashboard list reads cleanly in both locales: its title is the plural and an edit page\'s its record, its filters stay closed until asked for, sessions and enrollments draw a search box, a date and a fee read in the viewer\'s locale', async () => {
  const title = `Clean ${Date.now()}`
  const course = (await post('/api/courses/create', { title, fee: 450, currency: 'SAR', delivery: 'live', accessCode: 'LIVE01', opensOn: '2026-07-31' }, { cookie })).body
  assert.equal(typeof course.id, 'string', JSON.stringify(course))
  const page = async (path: string, locale: 'en' | 'ar') => {
    const response = await fetch(`${origin}/dashboard${path}`, { headers: { cookie: `${cookie}; locale=${locale}` } })
    assert.equal(response.status, 200, `${path} answers 200 in ${locale}`)
    return response.text()
  }
  const heading = (html: string) => /<h1[^>]*data-node="title"[^>]*>([^<]*)</.exec(html)?.[1]
  const rowOf = (html: string) => [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((one) => one[0]).find((one) => one.includes(`>${title}<`)) ?? ''
  for (const [locale, words] of [['en', { many: 'Courses', month: 'July', sar: 'SAR' }], ['ar', { many: 'الدورات', month: 'يوليو', sar: 'ر.س' }]] as const) {
    const list = await page(`/courses?where[title][like]=${encodeURIComponent(title)}`, locale)
    assert.equal(heading(list), words.many, `the ${locale} list is headed by the plural`)
    assert.equal(heading(await page(`/courses/${course.id}`, locale)), title, `and the ${locale} edit page by its course`)
    assert.ok(list.includes('data-mithaq-filters='), `a list the URL filters shows its filter in ${locale}`)
    assert.ok(!(await page('/courses', locale)).includes('data-mithaq-filters='), `and one nobody filtered keeps it closed in ${locale}`)
    const row = rowOf(list)
    assert.ok(row.includes(words.sar) && /450/.test(row), `the fee reads with its currency in ${locale}: ${row.replace(/<[^>]+>/g, ' ')}`)
    assert.ok(row.includes(`31 ${words.month} 2026`) || row.includes(`${words.month} 31, 2026`), `and the day it opens in the locale's own words: ${row.replace(/<[^>]+>/g, ' ')}`)
    for (const path of ['/sessions', '/enrollments']) assert.ok((await page(path, locale)).includes('type="search"'), `${path} draws its search box in ${locale}`)
    assert.ok((await page('/courses', locale)).includes('type="search"'), `while courses keep theirs in ${locale}`)
  }
})

const divFrom = (html: string, start: number) => {
  let depth = 0
  for (const tag of html.slice(start).matchAll(/<div[\s>]|<\/div>/g)) {
    depth += tag[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(start, start + tag.index + tag[0].length)
  }
  return html.slice(start)
}

test('68. every dashboard create and edit page and Settings reads cleanly in both locales: the record layout, under the kayan\'s sentence on a create and Settings alone, its fields in sections, a switch with its label beside it, text boxes that follow their text, a date picker in place of the browser\'s box, and no Archived on a create', async () => {
  const role = (await post('/api/roles/create', { name: `clean-${Date.now()}`, label: { en: 'Clean', ar: 'نظيف' }, permissions: ['courses.find', 'courses.fields.title'] }, { cookie })).body
  assert.equal(typeof role.id, 'string', JSON.stringify(role))
  // The tag's create opens as a sheet, a portal a server render draws nothing of, so its tree is read off the projection instead.
  const paths = ['/courses/new', `/courses/${screenCourse}`, '/sessions/new', `/sessions/${screenSession}`, '/enrollments/new', `/tags/${screenTag}`, '/roles/new', `/roles/${role.id}`, '/settings']
  for (const locale of ['en', 'ar'] as const) {
    for (const path of paths) {
      const response = await fetch(`${origin}/dashboard${path}`, { headers: { cookie: `${cookie}; locale=${locale}` } })
      assert.equal(response.status, 200, `${path} answers 200 in ${locale}`)
      const html = await response.text()
      const at = `${path} in ${locale}`
      assert.match(html, /data-layout="record"/, `${at} draws the record layout`)
      // A role's form is the project's own component, drawing one card per heading. Each is read inside its own element,
      // so a control further down the page proves nothing about it.
      const roles = path.startsWith('/roles')
      const within = roles ? divFrom(html, html.lastIndexOf('<div', html.indexOf('data-role-form'))) : html
      const parts = [...within.matchAll(roles ? /<div[^>]*data-slot="card"[^>]*>/g : /<div[^>]*data-node="section"[^>]*>/g)].map((one) => divFrom(within, one.index))
      // A role's cards hold its name's box and its permissions; a section holds some field's control,
      // the rich text editor's being the box Lexical draws as a textbox.
      const holds = roles ? [/id="roles-name"/, /data-permissions/] : parts.map(() => /<(?:input|button|textarea|div(?=[^>]*role="textbox"))[^>]*id="(?!base-ui)[a-z]+-[A-Za-z]+/)
      assert.ok(parts.length >= (roles ? 2 : 1), `${at} draws ${roles ? 'two cards' : 'a section'}`)
      holds.forEach((one, index) => assert.match(parts[index]!, one, `${at} puts its fields in ${roles ? 'card' : 'section'} ${index + 1}`))
      // A page that draws a row is about that row, so only a create draws the kayan's sentence, and a global's page
      // is the one place its sentence is drawn.
      const sentence = /<header class="max-w-3xl"><p[^>]*>[^<]+<\/p><\/header>/
      if (path.endsWith('/new') || path === '/settings') assert.match(html, sentence, `${at} draws its kayan's sentence under the title`)
      else assert.doesNotMatch(html, sentence, `${at} draws no sentence of its kayan's on a page of one row`)
      assert.equal(/type="(?:date|datetime-local)"/.test(html), false, `${at} draws no browser date box`)
      // A picker's search box is no value of the row, and a time's spin boxes are digits inside a left-to-right span,
      // so only the boxes a field's text is typed into are read.
      for (const box of html.match(/<input[^>]*type="text"[^>]*>|<textarea[^>]*>/g) ?? []) if (!/role="(?:combobox|spinbutton)"/.test(box)) assert.match(box, /dir="auto"/, `${at}: a text box follows its text: ${box}`)
      // A list's own page box is no value of the row either.
      for (const box of html.match(/<input[^>]*type="(?:email|number)"[^>]*>/g) ?? []) if (!box.includes('id="base-ui-')) assert.match(box, /dir="ltr"/, `${at}: an email or a number reads left to right: ${box}`)
      if (path.endsWith('/new')) assert.equal(html.includes('-archived"'), false, `${at} draws no Archived`)
    }
    const settings = await (await fetch(`${origin}/dashboard/settings`, { headers: { cookie: `${cookie}; locale=${locale}` } })).text()
    const field = /<div role="group"[^>]*data-control="switch"[^>]*>[\s\S]*?<\/label>/.exec(settings)?.[0] ?? ''
    assert.match(field, /data-orientation="horizontal"/, `the maintenance switch has its label beside it in ${locale}`)
    assert.match(field, /role="switch"[^>]*aria-checked="(?:true|false)"|aria-checked="(?:true|false)"[^>]*role="switch"/, `and says whether it is on in ${locale}`)
    assert.ok((await (await fetch(`${origin}/dashboard/courses/${screenCourse}`, { headers: { cookie: `${cookie}; locale=${locale}` } })).text()).includes('data-field-value="archived"'), `while the course edit page keeps Archived in ${locale}`)
  }
})

test('69. every auth page reads cleanly in both locales: a way home, the language switch, left-to-right email and password boxes with a show toggle, the password rule, no referrer, a forgot request answered the same for any address, a refusal in this app\'s words, and a signed-in visitor sent on or told so', async () => {
  // React writes the attribute as `autoComplete`, which HTML reads without regard to case.
  const { scopes } = await import('./asas-tanstack/src/copy.ts')
  // The provider's own minimum, read off the instance that refuses a short password.
  const provider = (asas.auth.strategies as unknown as { name: string; server: { $context: Promise<{ password: { config: { minPasswordLength: number } } }> } }[]).find((one) => one.name === 'user')!
  const minimum = (await provider.server.$context).password.config.minPasswordLength
  const pages = ['/auth/sign-in', '/auth/sign-up', '/auth/forgot-password', '/auth/reset-password?token=not-a-real-one', '/auth/set-password?token=not-a-real-one']
  // A live link, so the page it opens draws its form: a sign-up's, which chooses the first password.
  const chooser = `chooser-${Date.now()}@example.com`
  assert.equal((await fetch(`${origin}/api/auth/user/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ name: 'Chooser', email: chooser }) })).status, 200, 'a sign-up asks a name and an address alone')
  const chosen = await linkMailed(chooser)
  assert.equal(chosen.pathname, '/auth/set-password', 'and its link opens the page that chooses a first password')
  pages.push(`${chosen.pathname}${chosen.search}`)
  for (const locale of ['en', 'ar'] as const) {
    const english = Object.values(scopes.auth!).map((one) => one.en!).filter((one) => one.length > 3)
    for (const path of pages) {
      const response = await fetch(`${origin}${path}`, { headers: { cookie: `locale=${locale}` } })
      assert.equal(response.status, 200, `${path} answers 200 in ${locale}`)
      const html = await response.text()
      const at = `${path} in ${locale}`
      assert.match(html, new RegExp(`<a[^>]*href="/"[^>]*>${scopes.marketing!.brand![locale]}</a>`), `${at} links home under the app's name`)
      for (const one of ['en', 'ar']) assert.ok(html.includes(`aria-label="${new Intl.DisplayNames([one], { type: 'language' }).of(one)}"`), `${at} offers ${one} in the language switch`)
      const boxes = html.match(/<input[^>]*type="(?:email|password)"[^>]*>/g) ?? []
      for (const box of boxes) assert.match(box, /dir="ltr"/, `${at}: an email or password box reads left to right: ${box}`)
      const passwords = boxes.filter((box) => box.includes('type="password"')).length
      const toggles = html.match(/<button[^>]*aria-pressed="false"[^>]*>/g)?.filter((one) => one.includes(`aria-label="${scopes.auth!.showPassword![locale]}"`)).length ?? 0
      assert.equal(toggles, passwords, `${at} draws a show toggle for each of its ${passwords} password boxes`)
      if (locale === 'ar') for (const words of english) assert.ok(!html.includes(`>${words}<`), `${at} draws no English: ${words}`)
    }
    const signIn = await (await fetch(`${origin}/auth/sign-in`, { headers: { cookie: `locale=${locale}` } })).text()
    assert.ok(new RegExp(`<a[^>]*href="/auth/forgot-password"[^>]*>([^<]*)</a>`).exec(signIn)?.[1] === scopes.auth!.forgotPasswordQuestion![locale], `sign-in links the forgot page in ${locale}`)
    assert.match(signIn, /autocomplete="current-password"/i, `and its password is the current one in ${locale}`)
    const signUp = await (await fetch(`${origin}/auth/sign-up`, { headers: { cookie: `locale=${locale}` } })).text()
    assert.doesNotMatch(signUp, /autocomplete="organization"/i, `the sign-up asks no organization in ${locale}: one is made once the address is proved`)
    assert.doesNotMatch(signUp, /type="password"/, `and no password in ${locale}: it is chosen from the mailed link`)
    for (const path of [`${chosen.pathname}${chosen.search}`, `/auth/reset-password${chosen.search}`]) {
      const page = (await (await fetch(`${origin}${path}`, { headers: { cookie: `locale=${locale}` } })).text()).replace(/&#x27;|&#39;/g, "'")
      assert.equal(page.match(/autocomplete="new-password"/gi)?.length, 2, `${path} asks a new password twice in ${locale}`)
      assert.ok(page.includes(scopes.auth!.passwordRule![locale]!.replace('{count}', String(minimum))), `and states the provider's minimum of ${minimum} before a submit in ${locale}`)
      assert.match(page, new RegExp(`<input(?=[^>]*value="${chooser}")(?=[^>]*readonly)[^>]*>`, 'i'), `and shows the account it is for, read-only, in ${locale}`)
    }
    for (const path of ['/auth/reset-password', '/auth/set-password?token=not-a-real-one']) {
      const invalid = await (await fetch(`${origin}${path}`, { headers: { cookie: `locale=${locale}` } })).text()
      assert.ok(invalid.includes(scopes.auth!.tokenInvalid![locale]!), `${path} says the link is no good in ${locale}`)
    }
  }

  // The reset page's address carries its token, so it is sent on as no referrer.
  assert.equal((await fetch(`${origin}/auth/reset-password?token=t`)).headers.get('referrer-policy'), 'no-referrer', 'the reset page sends no referrer')
  assert.equal((await fetch(`${origin}/auth/set-password?token=t`)).headers.get('referrer-policy'), 'no-referrer', 'nor the page that chooses a first password')

  const { refusalKey } = await import('./asas-tanstack/src/copy.ts')
  const refused = async (path: string, body: unknown) => {
    const response = await fetch(`${origin}/api/auth/user/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, text, key: refusalKey(response.status, (JSON.parse(text) as { code?: unknown }).code) }
  }
  const badToken = await refused('reset-password', { newPassword: 'a-long-enough-password', token: 'not-a-real-one' })
  assert.equal(badToken.key, 'auth.tokenInvalid', `a token the provider does not hold is said as the link being no good: ${badToken.text}`)
  // A production build starts only with a mailer, so the forgot request is answered alike for an address with an
  // account and one without.
  const held = await refused('request-password-reset', { email: actorEmail })
  assert.equal(held.status, 200, `the forgot request is answered: ${held.text}`)
  assert.deepEqual(await refused('request-password-reset', { email: `nobody-${Date.now()}@example.com` }), held, 'and an address with no account is answered the same')
  for (const key of [badToken.key]) {
    for (const locale of ['en', 'ar'] as const) assert.ok(scopes.auth![key.slice('auth.'.length)]![locale], `${key} has words in ${locale}`)
  }

  // A signed-in visitor is sent on from sign-in and sign-up, where signing in sends anyone, and told so on the two
  // password pages, with that same way on.
  for (const path of pages) {
    for (const [asked, landing] of [['', '/dashboard'], ['/dashboard/courses', '/dashboard/courses'], ['https://elsewhere.example', '/dashboard']] as const) {
      const url = `${origin}${path}${asked ? `${path.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(asked)}` : ''}`
      if (path.startsWith('/auth/sign-')) {
        const response = await fetch(url, { headers: { cookie }, redirect: 'manual' })
        assert.ok(response.status >= 300 && response.status < 400, `${path} sends a signed-in visitor on: ${response.status}`)
        assert.equal(new URL(response.headers.get('location') ?? '', origin).pathname, landing, `${path} with ${asked || 'no redirect'} lands on ${landing}`)
        continue
      }
      for (const locale of ['en', 'ar'] as const) {
        const response = await fetch(url, { headers: { cookie: `${cookie}; locale=${locale}` }, redirect: 'manual' })
        const html = await response.text()
        assert.equal(response.status, 200, `${path} keeps a signed-in visitor in ${locale}`)
        assert.ok(html.includes(scopes.auth!.alreadySignedIn![locale]!), `${path} says they are already signed in, in ${locale}`)
        // Named for the screen where it opens the first one, and plainly where the visitor asked for a page of their own.
        const said = landing === '/dashboard' ? scopes.auth!.backTo![locale]!.replace('{screen}', scopes.screens!.dashboard![locale]!) : scopes.auth!.continue![locale]!
        assert.match(html, new RegExp(`<a[^>]*href="${landing}"[^>]*>${said}</a>`), `${path} with ${asked || 'no redirect'} links on to ${landing} as "${said}" in ${locale}`)
        assert.ok(html.includes(`>${scopes.admin!.signOut![locale]}</button>`), `${path} offers a sign-out in ${locale}`)
      }
    }
  }
})

test('70. every page names itself and its app in the browser tab in both locales, both apps serve a favicon, a page draws one h1, and the portal nav marks where the viewer is', async () => {
  const { scopes } = await import('./asas-tanstack/src/copy.ts')
  const backoffice = await backofficeSignIn()
  const html = async (at: string, path: string, sent: string) => {
    const response = await fetch(`${at}${path}`, { headers: { cookie: sent } })
    assert.equal(response.status, 200, `${path} answers 200`)
    return response.text()
  }
  const tabOf = (page: string) => /<title>([^<]*)<\/title>/.exec(page)?.[1]
  await staffAs('explorer', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const word = (scope: string, key: string) => scopes[scope]?.[key]?.[locale] ?? ''
      const tenant = word('marketing', 'brand')
      const staff = word('backoffice', 'brand')
      const pages: [string, string, string, string][] = [
        [origin, '/portal', cookie, word('screens', 'portal')],
        [origin, '/portal/courses', cookie, word('courses', 'plural')],
        [origin, `/portal/courses/${screenCourse}`, cookie, screenTitle],
        [origin, '/portal/enrollments/new', cookie, word('enrollments', 'new')],
        [origin, '/dashboard', cookie, word('screens', 'dashboard')],
        [origin, '/dashboard/members', cookie, word('dashboard', 'members')],
        [origin, '/dashboard/sessions', cookie, word('sessions', 'plural')],
        [origin, '/auth/sign-in', '', word('auth', 'signIn')],
        [origin, '/auth/sign-up', '', word('auth', 'signUp')],
        [origin, '/auth/forgot-password', '', word('auth', 'forgotPassword')],
        [origin, '/auth/reset-password?token=not-a-real-one', '', word('auth', 'resetPassword')],
        [origin, '/auth/set-password?token=not-a-real-one', '', word('auth', 'setPassword')],
        [backofficeOrigin, '/auth/sign-in', '', word('auth', 'signIn')],
        [backofficeOrigin, '/backoffice', backoffice, word('screens', 'backoffice')],
        [backofficeOrigin, '/backoffice/courses', backoffice, word('courses', 'plural')],
      ]
      for (const [at, path, sent, name] of pages) {
        const page = await html(at, path, `${sent}; locale=${locale}`)
        assert.equal(tabOf(page), `${name} · ${at === origin ? tenant : staff}`, `${path} names itself in ${locale}`)
        // The drawer is a portal, which a server render draws nothing of.
        assert.equal(page.match(/<h1[\s>]/g)?.length, 1, `${path} draws one h1 in ${locale}`)
      }
    }
  })

  for (const at of [origin, backofficeOrigin]) {
    const icon = await fetch(`${at}/favicon.svg`)
    assert.equal(icon.status, 200, `${at} serves its favicon`)
    assert.equal(icon.headers.get('content-type')?.split(';')[0], 'image/svg+xml', 'as an SVG')
    assert.match(await html(at, '/auth/sign-in', ''), /<link rel="icon"[^>]*href="\/favicon\.svg"/, 'and every document names it')
  }

  const currentOf = async (path: string) => [...(await html(origin, path, cookie)).matchAll(/<a\b[^>]*>/g)].map((one) => one[0]).filter((one) => one.includes('aria-current="page"')).map((one) => /href="([^"]*)"/.exec(one)?.[1])
  // Twice each: the portal's nav across the top from md up, and its tab bar at the foot of a phone.
  assert.deepEqual(await currentOf('/portal'), ['/portal', '/portal'], 'Home is current on the portal\'s home')
  assert.deepEqual(await currentOf('/portal/courses'), ['/portal/courses', '/portal/courses'], 'Courses on the courses list')
  assert.deepEqual(await currentOf(`/portal/courses/${screenCourse}`), ['/portal/courses', '/portal/courses'], 'and on a course')
  assert.deepEqual(await currentOf('/portal/enrollments'), ['/portal/enrollments', '/portal/enrollments'], 'Enrollments on the enrollments list')
})

test('71. a tab names the page then the app, the app alone where the page names nothing, and the page alone where the route context has no app', async () => {
  const { documentHead } = await import('./asas-tanstack/src/copy.ts')
  const title = (head: ReturnType<typeof documentHead>) => head.meta[0]!.title
  assert.equal(title(documentHead({ locale: 'en', app: 'marketing.brand' }, () => 'Courses')), `Courses · ${title(documentHead({ locale: 'en', app: 'marketing.brand' }))}`)
  assert.equal(title(documentHead({ locale: 'en', app: undefined as never }, () => 'Courses')), 'Courses', 'no separator without an app')
  assert.equal(title(documentHead({ locale: 'en', app: undefined as never })), '', 'and nothing at all where neither is named')
})

test('72. the portal holds what its viewer may do: its home greets in each locale\'s own words, an enrollment\'s session reads by its start, and an instructor reads the course\'s page with no form and every seat as a table', async () => {
  const arabic = await (await fetch(`${origin}/portal`, { headers: { cookie: `${cookie}; locale=ar` } })).text()
  assert.match(arabic, new RegExp(`<h1[^>]*>مرحبا، ${actorName}</h1>`), 'the Arabic greeting takes the Arabic comma')
  assert.match(arabic, /data-dashboard="portal"/, 'on the portal\'s own home')

  // An enrollment's session reads by its start. The control resolves the title in the browser through the portal's
  // projection of `sessions` and a read as the viewer; the first paint holds the id until then, which no fetch here
  // can see past, so both halves are read here.
  const enrollment = (await post('/api/enrollments/find', { where: { session: { equals: screenSession } }, limit: 1 }, { cookie })).body.docs as { id: string }[]
  assert.equal(enrollment.length, 1, 'the owner holds an enrollment on the screens\' session')
  assert.ok((await screenHtml(`/portal/enrollments/${enrollment[0]!.id}`)).includes('for="enrollments-session"'), 'whose portal page draws its session')
  const titled = asas.targets.portal.client.kayan.sessions?.useAsTitle
  assert.equal(titled, 'startsAt', 'which the portal titles by its start, as the dashboard does')
  const read = (await post('/api/sessions/find', { where: { id: { in: [screenSession] } }, depth: 0 }, { cookie })).body.docs as Record<string, unknown>[]
  assert.equal(typeof read[0]?.[titled!], 'string', 'and the owner\'s read of it answers that start to draw, not the id alone')

  await holding('instructor', async () => {
    const view = await screenHtml(`/portal/courses/${screenCourse}`)
    assert.ok(view.includes(screenTitle), 'an instructor reads the course\'s page')
    assert.ok(!view.includes('<form') && !view.includes('data-region="danger"'), 'with no form of boxes it may not change, nor a danger zone')
  })
})

test('73. the backoffice reads by name in both locales: its sign-in is the tenant\'s frame, its shell names itself and switches no organization, its home counts what staff may read, a person\'s actions sit in one menu, a record is titled by its row and reads every value in words, a list joins in the locale\'s own words, every search finds a person, a session and a role by what staff look for, and an impersonation lands where the person may enter, under the bar', async () => {
  const backoffice = await backofficeSignIn()
  const page = async (path: string, locale: 'en' | 'ar', sent = backoffice) => {
    const response = await fetch(`${backofficeOrigin}${path}`, { headers: { cookie: `${sent}; locale=${locale}` } })
    assert.equal(response.status, 200, `${path} answers 200 in ${locale}`)
    return (await response.text()).replace(/<script[\s\S]*?<\/script>/g, '')
  }
  const decode = (text: string) => text.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const shownIn = (html: string) => [...html.matchAll(/>([^<]+)</g)].map((hit) => decode(hit[1]!).trim()).filter(Boolean)
  const db = (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<{ rows: Record<string, unknown>[] }> } }).db
  const me = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { user: { id: string }; session: { activeOrganizationId: string } })
  const organization = me.session.activeOrganizationId

  // The sign-in is the tenant's auth frame, with no session in either locale.
  for (const locale of ['en', 'ar'] as const) {
    const signIn = await page('/auth/sign-in', locale, '')
    assert.equal(signIn.match(/<h1[\s>]/g)?.length, 1, `the sign-in draws one h1 in ${locale}`)
    assert.ok(/<a [^>]*href="\/"[^>]*>[^<]+<\/a>/.test(signIn), `and the app's name links home in ${locale}`)
    assert.ok(signIn.includes('aria-current="true"'), `and the language switch marks the locale in use in ${locale}`)
    assert.ok(/<input[^>]*dir="ltr"[^>]*type="email"|<input[^>]*type="email"[^>]*dir="ltr"/.test(signIn) && /<input[^>]*dir="ltr"[^>]*id="password"|<input[^>]*id="password"[^>]*dir="ltr"/.test(signIn), `and its email and password read left to right in ${locale}: ${/<input[^>]*id="password"[^>]*>/.exec(signIn)?.[0]}`)
    assert.ok(signIn.includes('aria-pressed="false"'), `and the password has its show toggle in ${locale}`)
  }

  await staffAs('super_admin', async () => {
    // The backoffice's shell names the app where the switcher sat, and its home entry and its home page say one word.
    for (const locale of ['en', 'ar'] as const) {
      const home = await page('/backoffice', locale)
      const word = locale === 'en' ? 'Backoffice' : 'لوحة الإدارة الخلفية'
      assert.ok(home.includes('data-brand=') && !shownIn(home).includes(locale === 'en' ? 'No organization' : 'لا توجد مؤسسة'), `the shell draws the app's name and no organization switcher in ${locale}`)
      assert.ok(/<a href="\/backoffice"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span>([^<]+)<\/span>/.exec(home)?.[1] === word && new RegExp(`<h1>${word}</h1>`).test(home), `the nav's home entry and the page both say ${word}`)
      for (const kayan of ['user', 'organization', 'member', 'courses', 'sessions', 'enrollments', 'tags', 'roles', 'memberRoles']) {
        assert.ok(home.includes(`data-kpi="${kayan}"`), `the home counts ${kayan} in ${locale}`)
      }
    }
    assert.ok((await page('/backoffice/courses', 'en')).includes('data-brand='), 'and so does every list')

    // A person's role cell is the role alone, never a picker or a button: the actions are the row's menu and the person's page.
    const other = await signedUpHere('menu')
    const users = await page(`/backoffice/users?search=${encodeURIComponent(other.email)}`, 'en')
    const row = users.slice(users.indexOf(`data-row="${other.id}"`)).split('</tr>')[0]!
    assert.ok(!row.includes('<select') && !row.includes('data-action='), `a person's row holds no picker and no action outside its menu: ${row.slice(0, 300)}`)
    assert.ok(row.includes(`data-row-menu="${other.id}"`), 'and one menu, which holds the actions')
    assert.match(await page(`/backoffice/users/${other.id}`, 'en'), /data-person-actions="set-role ban impersonate"/, 'and the person\'s page offers every action this viewer may take')

    // A person's record is titled by their name, reads their backoffice role by its label, an unticked box as the word No, and no id.
    const person = await page(`/backoffice/users/${me.user.id}`, 'en')
    assert.match(person, /<h1[^>]*data-node="title"[^>]*>Boot<\/h1>/, 'a person\'s record is titled by their name')
    assert.ok(person.includes('Backoffice administrator') && !/data-field-value="role"[\s\S]{0,400}>user</.test(person), 'and reads the backoffice role by its label')
    assert.ok(/data-field-value="emailVerified"[^>]*>[\s\S]*?<span class="text-sm">No<\/span>/.test(person), 'and an unticked box as a no')
    assert.ok(!person.includes('data-field-value="id"'), 'and draws no id')
    // A tenant's own role, since the roles this project ships are code and never a row.
    const role = (await db.execute(`select id, name, label_en, label_ar from roles where permissions @> array['courses.find']::text[] order by created_at limit 1`)).rows[0] as { id: string; name: string; label_en: string; label_ar: string }
    for (const locale of ['en', 'ar'] as const) {
      const custom = await page(`/backoffice/roles/${role.id}`, locale)
      assert.match(custom, new RegExp(`<h1[^>]*data-node="title"[^>]*>${locale === 'en' ? role.label_en : role.label_ar}</h1>`), `a role's record is titled by its label in ${locale}`)
      assert.ok(custom.includes('data-permissions=') && custom.includes('data-group="courses"') && !custom.includes('courses.find, courses'), `and draws its keys grouped, never as one run in ${locale}`)
      assert.ok(!custom.includes('data-field-value="id"') && !shownIn(custom).includes(role.name), `and no id and no slug in ${locale}`)
    }

    // A course's topics join in the locale's own words, and the Arabic pages draw no English copy and no slug of a role or a membership.
    const course = (await post('/api/courses/create', { title: `Topics ${Date.now()}`, fee: 10, currency: 'SAR', delivery: 'live', topics: ['script', 'grammar'] }, { cookie })).body
    assert.ok(typeof course.id === 'string', `a course with two topics: ${JSON.stringify(course)}`)
    assert.ok(shownIn(await page(`/backoffice/courses/${course.id}`, 'ar')).includes('الخط والنحو'), 'its topics join in Arabic\'s own words, never with an ASCII comma')
    assert.ok(shownIn(await page(`/backoffice/courses/${course.id}`, 'en')).includes('Script, Grammar'), 'and the English one')
    const members = shownIn(await page(`/backoffice/members?search=${encodeURIComponent(actorEmail)}`, 'ar'))
    assert.ok(members.includes('المالك') && !members.includes('owner'), `a membership's role reads in Arabic: ${members.join(' | ')}`)
    const assignments = shownIn(await page('/backoffice/member-roles?search=Boot', 'ar'))
    assert.ok(assignments.includes(tenantRoles.administrator.label.ar) && !assignments.includes('administrator'), 'an assignment names its role by its label')
    const roles = shownIn(await page('/backoffice/roles', 'ar'))
    assert.ok(!roles.includes('registrar') && !roles.includes('Organization') && roles.includes('المؤسسة'), 'the roles list draws no slug, and its organization column in Arabic')

    // No page of the backoffice draws a word of the English copy in Arabic, as test 56 holds the dashboard to.
    const { scopes } = await import('./asas-tanstack/src/copy.ts')
    const english = new Set<string>()
    for (const scope of Object.values(scopes)) for (const copy of Object.values(scope)) if (copy.en && copy.ar && copy.en !== copy.ar) english.add(copy.en)
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof record.en === 'string' && typeof record.ar === 'string' && record.en !== record.ar) english.add(record.en)
      for (const one of Object.values(record)) walk(one)
    }
    const screen = asas.targets.backoffice.client
    walk(screen)
    // A person's name is data, never copy, so no fixture names a person like
    // a copy string: one that did would hide that string from the check below.
    const named = (await db.execute('select name from "user"')).rows.map((row) => row.name as string).filter((name) => english.has(name))
    assert.deepEqual(named, [], 'no person is named like a string of the English copy')
    for (const [name, kayan] of Object.entries(screen.kayan)) {
      for (const one of Object.values(kayan.pages)) {
        const id = one.path.includes(':id') ? (/<a href="\/backoffice[^"]*\/([^"/]+)" data-row-link=/.exec(await page(`/backoffice${one.path.replace('/:id', '')}`, 'ar'))?.[1]) : undefined
        if (one.path.includes(':id') && !id) continue
        const html = await page(`/backoffice${one.path.replace(':id', id ?? '')}`, 'ar')
        const leaked = shownIn(html).filter((text) => english.has(text))
        assert.deepEqual(leaked, [], `${name} ${one.path} draws no English copy in Arabic`)
      }
    }

    const rowsOf = (html: string) => [...html.matchAll(/<tr[^>]*data-row="([^"]+)"/g)].map((hit) => hit[1])
    const membership = (await db.execute(`select id from member where user_id = '${me.user.id}' and organization_id = '${organization}'`)).rows[0]!.id as string
    assert.ok(rowsOf(await page(`/backoffice/members?search=${encodeURIComponent(actorEmail)}`, 'en')).includes(membership), 'a membership is found by its person\'s email')
    assert.ok(rowsOf(await page(`/backoffice/members?search=${actorName}`, 'en')).includes(membership), 'and by their name')
    assert.ok(rowsOf(await page(`/backoffice/sessions?search=${encodeURIComponent(screenTitle)}`, 'en')).includes(screenSession), 'a session by its course\'s title')
    assert.ok(rowsOf(await page(`/backoffice/roles?search=${encodeURIComponent(role.label_ar)}`, 'ar')).includes(role.id), 'a role by its name in Arabic')
    assert.ok(rowsOf(await page(`/backoffice/roles?search=${encodeURIComponent(role.label_en)}`, 'en')).includes(role.id), 'and in English')
  })

  // A lower role: support counts only what it reads, and no role or assignment.
  await staffAs('support', async () => {
    const home = await page('/backoffice', 'en')
    assert.ok(home.includes('data-kpi="user"') && !home.includes('data-kpi="roles"') && !home.includes('data-kpi="memberRoles"'), 'support\'s home counts the people and no role')
    const ar = await page(`/backoffice/members?search=${encodeURIComponent(actorEmail)}`, 'ar')
    assert.ok(shownIn(ar).includes('المالك'), 'and reads a membership\'s role in Arabic')
  })

  // An impersonation lands on the first screen the person may enter, under the bar: the dashboard for a registrar,
  // the portal for an instructor.
  const server = (asas.auth.strategies.find((one) => one.name === 'user') as unknown as { server: { api: { addMember(args: unknown): Promise<unknown> } } }).server
  for (const [held, lands] of [['registrar', '/dashboard'], ['instructor', '/portal']] as const) {
    const person = await signedUpHere(`lands-${held}`)
    await server.api.addMember({ body: { userId: person.id, organizationId: organization, role: 'member' } })
    await assignRole(organization, person.id, held)
    await staffAs('support', async () => {
      const started = await fetch(`${backofficeOrigin}/api/auth/user/admin/impersonate-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: backoffice, origin: backofficeOrigin },
        body: JSON.stringify({ userId: person.id }),
      })
      assert.equal(started.status, 200, await started.clone().text())
      const landed = await fetch(((await started.json()) as { url: string }).url, { redirect: 'manual' })
      assert.equal(landed.headers.get('location'), lands, `impersonating a ${held} lands on ${lands}`)
      const as = jarOf('', landed)
      for (const locale of ['en', 'ar'] as const) {
        const screen = await fetch(`${origin}${lands}`, { headers: { cookie: `${as}; locale=${locale}` } })
        assert.equal(screen.status, 200, `which the ${held} enters`)
        assert.ok((await screen.text()).includes('data-impersonating'), `under the impersonation bar in ${locale}`)
      }
      await post('/api/auth/user/sign-out', {}, { cookie: as, origin })
    })
  }
})

test('74. every template role signs in to the first screen it enters, the landing page names it, and its lists draw rows; an actor who enters none is told whose account it is and whom to ask', async () => {
  const { scopes } = await import('./asas-tanstack/src/copy.ts')
  const tag = await post('/api/tags/create', { name: { en: `Tag ${Date.now()}`, ar: 'وسم' } }, { cookie })
  assert.equal(tag.response.status, 200, JSON.stringify(tag.body))
  // A seat of the actor's own and one of another member's, so the student's list has a row to draw and one to leave out.
  const server = (asas.auth.strategies.find((one) => one.name === 'user') as unknown as { server: { api: { addMember(args: unknown): Promise<unknown> } } }).server
  const classmate = await signedUpHere('classmate')
  const current = (await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { session: { activeOrganizationId: string }; user: { id: string } }
  const organization = current.session.activeOrganizationId
  await server.api.addMember({ body: { userId: classmate.id, organizationId: organization, role: 'member' } })
  await post('/api/memberRoles/create', { user: classmate.id, role: 'student' }, { cookie })
  // The actor's own seat, which the screen walk made already: a student holds one seat in a session.
  const held = ((await post('/api/enrollments/find', { where: { and: [{ session: { equals: screenSession } }, { student: { equals: current.user.id } }] }, limit: 1 }, { cookie })).body.docs as { id: string }[])[0]
  const ownSeat = held ?? (await asStudent(() => post('/api/enrollments/create', { session: screenSession }, { cookie }))).body as { id: string }
  const classmateSeat = (await post('/api/enrollments/create', { session: screenSession, student: classmate.id }, { cookie })).body as { id: string }
  assert.equal(typeof ownSeat.id, 'string', JSON.stringify(ownSeat))
  assert.equal(typeof classmateSeat.id, 'string', JSON.stringify(classmateSeat))
  /** Where opening sign-in sends a signed-in actor, which is where a sign-in lands with nothing asked. */
  const landsOn = async () => {
    const response = await fetch(`${origin}/auth/sign-in`, { headers: { cookie }, redirect: 'manual' })
    assert.ok(response.status >= 300 && response.status < 400, `sign-in sends a signed-in actor on: ${response.status}`)
    return new URL(response.headers.get('location') ?? '', origin).pathname
  }
  const rowsOf = (html: string) => [...html.matchAll(/<tr[^>]*data-row="([^"]+)"/g)].map((hit) => hit[1])
  const page = async (path: string) => {
    const response = await fetch(`${origin}${path}`, { headers: { cookie } })
    assert.equal(response.status, 200, `${path} answers 200`)
    return response.text()
  }
  for (const [role, landing, screen, lists] of [
    ['administrator', '/dashboard', 'dashboard', ['/dashboard/courses', '/dashboard/sessions', '/dashboard/tags', '/dashboard/enrollments']],
    ['registrar', '/dashboard', 'dashboard', ['/dashboard/courses', '/dashboard/sessions', '/dashboard/tags']],
    ['instructor', '/portal', 'portal', ['/portal/courses', '/portal/enrollments']],
    ['student', '/portal', 'portal', ['/portal/courses', '/portal/enrollments']],
  ] as const) {
    await holding(role, async () => {
      assert.equal(await landsOn(), landing, `a ${role} lands on ${landing}`)
      const home = await page(landing)
      if (screen === 'dashboard') assert.match(home, /data-kpi="courses"[\s\S]*?data-slot="card-title"[^>]*>[1-9][0-9,]*</, `which counts the courses a ${role} reads`)
      else assert.match(home, /data-dashboard="portal"/, `which is the portal's own home to a ${role}`)
      const named = scopes.marketing!.openScreen!.en!.replace('{screen}', scopes.screens![screen]!.en!)
      assert.match(await page('/'), new RegExp(`<a href="${landing}"><button[^>]*>\\s*${named}`), `the landing page's button says "${named}" to a ${role}`)
      // The portal's lists are drawn whole and read their rows in the browser; the server draws their shell.
      for (const list of lists) {
        const html = await page(list)
        if (screen === 'portal') {
          assert.match(html, /data-portal=""/, `${list} draws the portal for a ${role}`)
          continue
        }
        assert.ok(!html.includes(noColumns), `${list} shows a ${role} its columns`)
        assert.ok(rowsOf(html).length > 0, `and draws its rows`)
      }
    })
  }
  await holding('registrar', async () => {
    const course = await page(`/dashboard/courses/${screenCourse}`)
    assert.ok(rowsOf(course).includes(screenSession), 'the registrar\'s course page lists the course\'s session')
    assert.equal((await post('/api/tags/find', {}, { cookie })).response.status, 200, 'and reads the tags')
    assert.ok((await post('/api/courses/find', { limit: 1 }, { cookie })).body.docs instanceof Array, 'and the courses')
    assert.ok(!/^\[\{\}/.test(JSON.stringify((await post('/api/sessions/find', {}, { cookie })).body.docs)), 'and a session as its columns, not an empty object')
  })
  // The student reads a course's page and its own seats and nothing the role leaves out: no other student's seat, and no
  // column of a course that is staff's or handed out by the course alone.
  await holding('student', async () => {
    const course = await page(`/portal/courses/${screenCourse}`)
    assert.ok(course.includes(screenTitle), 'a student opens a course page')
    const seats = await post('/api/enrollments/find', { limit: 100 }, { cookie })
    assert.equal(seats.response.status, 200, JSON.stringify(seats.body))
    const seen = (seats.body.docs as { id: string }[]).map((one) => one.id)
    assert.ok(seen.includes(ownSeat.id) && !seen.includes(classmateSeat.id), 'the server reads a student its own seats and not a classmate\'s')
    assert.equal((await post('/api/enrollments/findByID', { id: classmateSeat.id }, { cookie })).response.status, 404, 'a classmate\'s seat by id answers 404')
    const self = await post('/api/enrollments/create', { session: screenSession }, { cookie })
    assert.equal(self.response.status, 400, `the student enrolls itself only where the course lets students do so: ${JSON.stringify(self.body)}`)
    assert.equal((self.body.data as { key?: string }).key, 'error.invalid.enrollment_closed')
    const read = await post('/api/courses/findByID', { id: screenCourse }, { cookie })
    assert.equal(read.response.status, 200, JSON.stringify(read.body))
    assert.equal(read.body.title, screenTitle, 'a student reads a course by its id')
    for (const field of ['accessCode', 'archiveReason', 'notifications']) assert.ok(!(field in read.body), `and is answered no ${field}`)
  })
  const idle = await post('/api/roles/create', { name: 'idle', label: { en: 'Idle', ar: 'خامل' }, permissions: [] }, { cookie })
  assert.equal(idle.response.status, 200, JSON.stringify(idle.body))
  await holding('idle', async () => {
    assert.equal(await landsOn(), '/unauthorized', 'sign-in lands an actor with no screen on /unauthorized')
    const html = (await page('/unauthorized')).replace(/&#x27;|&#39;/g, "'")
    assert.ok(html.includes(scopes.auth!.noAccess!.en!), 'which says the account has no access yet')
    assert.ok(html.includes(actorEmail) && html.includes(organizationName), `naming the account and its organization: ${html.slice(html.indexOf('data-no-access'), html.indexOf('data-no-access') + 300)}`)
    assert.ok(!html.includes(scopes.auth!.unauthorized!.en!), 'and not that a role was refused a screen')
    assert.match(await page('/'), new RegExp(`<a href="/unauthorized"><button[^>]*>\\s*${scopes.auth!.accountStatus!.en!}`), 'and the landing page leads there by a button that names an action')
  })
  // The sentence is chosen on the memberships the actor holds, not on its active organization: a person in no organization
  // is told to ask for an invitation, and one made a member of one, with none active on the session, is told whom to ask.
  const stamp = Date.now()
  const signUp = await provedSignUp({ name: 'Unplaced', email: `unplaced-${stamp}@example.com` })
  const signedIn = await signedInOver(`unplaced-${stamp}@example.com`)
  assert.equal(signedIn.response.status, 200, `a person with no organization signs in: ${JSON.stringify(signedIn.body)}`)
  const unplaced = (signedIn.response.headers.getSetCookie?.() ?? []).map((one) => one.split(';')[0]).join('; ')
  const unplacedId = ((await signUp.json()) as { user: { id: string } }).user.id
  // Read as the text it shows: each name put in is its own isolated element.
  const told = async () => (await (await fetch(`${origin}/unauthorized`, { headers: { cookie: unplaced } })).text()).replace(/&#x27;|&#39;/g, "'").replace(/<!-- -->|<\/?(bdi|span)[^>]*>/g, '')
  const said = (key: 'noOrganization' | 'noAccessDescription') => scopes.auth![key]!.en!.replace('{email}', `unplaced-${stamp}@example.com`).replaceAll('{organization}', organizationName)
  assert.ok((await told()).includes(said('noOrganization')), 'a person in no organization is told so')
  const unplacedPage = await (await fetch(`${origin}/unauthorized`, { headers: { cookie: unplaced } })).text()
  assert.ok(unplacedPage.includes('data-create-organization') && unplacedPage.includes('id="new-organization"'), 'and, with many organizations, offered to found one')
  assert.ok((await told()).includes(scopes.auth!.askToBeInvited!.en!.replace('{email}', `unplaced-${stamp}@example.com`)), 'or to ask an administrator to invite their address')
  const me = ((await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { session: { activeOrganizationId: string } }).session.activeOrganizationId
  const db = (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<unknown> } }).db
  await db.execute(`insert into member (id, organization_id, user_id, role, created_at) values ('unplaced-${stamp}', '${me}', '${unplacedId}', 'member', now())`)
  const session = (await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie: unplaced } })).json()) as { session: { activeOrganizationId?: string | null } }
  assert.ok(!session.session.activeOrganizationId, 'whose session names no active organization once it is a member')
  const placed = await told()
  assert.ok(placed.includes(said('noAccessDescription')), `and who is then told it is a member of ${organizationName} and whom to ask: ${placed.slice(placed.indexOf('data-no-access'), placed.indexOf('data-no-access') + 300)}`)
  // The card as served, each name it puts in isolated and kept whole where it fits a line.
  const card = (await (await fetch(`${origin}/unauthorized`, { headers: { cookie: unplaced } })).text())
  assert.ok(card.includes(`<bdi class="inline-block max-w-full [overflow-wrap:anywhere]">unplaced-${stamp}@example.com</bdi>`), `the email in its own bdi: ${card.slice(card.indexOf('data-no-access'), card.indexOf('data-no-access') + 400)}`)
  assert.ok(card.includes(`<span class="inline-block max-w-full [overflow-wrap:anywhere]">${organizationName}</span></bdi>`), 'and the organization in its own')
})

test('75. a role the server refuses is told so: the sessions tab says it cannot see them, a list of no readable column says whom to ask under no header band and offers no New, a create page with no field to write is refused, the danger zone of no allowed operation and the fees card without the currency are not drawn', async () => {
  const { scopes } = await import('./asas-tanstack/src/copy.ts')
  // A project's own role: the keys of a course and of the sessions it lists, and no session field, currency, archive or delete.
  // The guard refuses a session operation with no session field on a write, so the row is written with one and then stripped of it.
  const refused = await post('/api/roles/create', {
    name: 'refused-214',
    label: { en: 'Refused', ar: 'مرفوض' },
    permissions: [
      'screen.dashboard',
      'courses.find', 'courses.count', 'courses.findByID', 'courses.update',
      ...['id', 'title', 'organization', 'createdAt', 'updatedAt', 'fee', 'tags', '_status'].map((field) => `courses.fields.${field}`),
      'sessions.find', 'sessions.count', 'sessions.create', 'sessions.fields.id',
      'tags.find', 'tags.fields.id',
    ],
  }, { cookie })
  assert.equal(refused.response.status, 200, JSON.stringify(refused.body))
  const db = (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<unknown> } }).db
  await db.execute(`update roles set permissions = array_remove(permissions, 'sessions.fields.id') where id = '${(refused.body as { id: string }).id}'`)
  const said = (key: string) => scopes.admin![key]!.en!
  const plain = (html: string) => html.replace(/&#x27;|&#39;/g, "'")
  await holding('refused-214', async () => {
    assert.equal((await post('/api/sessions/find', { where: { course: { equals: screenCourse } } }, { cookie })).response.status, 403, 'the server refuses this role the course\'s sessions')
    const course = plain(await (await fetch(`${origin}/dashboard/courses/${screenCourse}`, { headers: { cookie } })).text())
    assert.match(course, new RegExp(`data-mithaq-refused-list="sessions"[^>]*>${said('cannotSee')}<`), 'the sessions tab says the viewer cannot see them, rather than going blank')
    assert.ok(!course.includes('data-region="danger"'), 'and the course page draws no danger zone, since the role may neither archive nor delete')

    const list = plain(await (await fetch(`${origin}/dashboard/sessions`, { headers: { cookie } })).text())
    assert.ok(list.includes(said('noColumns')), 'the sessions list says the role sees no column and whom to ask')
    assert.ok(!list.includes('<thead'), 'under no header band')
    assert.ok(!list.includes('href="/dashboard/sessions/new"'), 'and offers no New, since no field of a session is the role\'s to write')
    assert.equal(await sentTo('/dashboard/sessions/new', cookie), '/unauthorized', 'a create page with no field to write is refused, never a form with no input')

    const home = await (await fetch(`${origin}/dashboard`, { headers: { cookie } })).text()
    assert.ok(home.includes('data-kpi="courses"'), 'the home still counts the courses')
    assert.ok(!home.includes('data-kpi="fees"'), 'and draws no fees card for a reader of the fee without its currency')
  })
  const home = await (await fetch(`${origin}/dashboard`, { headers: { cookie } })).text()
  assert.match(home, /data-kpi="fees"[\s\S]*?<bdi dir="ltr"/, 'the administrator\'s fees card draws each sum in a left-to-right isolate')
})

test('76. the not-found page is a page with a way home, inside the screen\'s shell for a missing record; a refused page is named and the way back is its own screen; a switch that strands the actor offers the other organizations; HTML is never stored; tabs name their record', async () => {
  const { scopes } = await import('./asas-tanstack/src/copy.ts')
  const en = (scope: string, key: string) => scopes[scope]![key]!.en!
  const plain = (html: string) => html.replace(/&#x27;|&#39;/g, "'").replace(/<!-- -->/g, '')
  const titleOf = (html: string) => plain(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '')

  for (const session of [cookie, '']) {
    const answer = await fetch(`${origin}/no-such-page-230`, { headers: { cookie: session } })
    assert.equal(answer.status, 404)
    const html = await answer.text()
    assert.equal(html.match(/<main/g)?.length, 1, 'one main landmark')
    assert.ok(plain(html).includes(`<h1`) && plain(html).includes(en('admin', 'notFoundTitle')), 'an h1 that says the page was not found')
    assert.match(html, /<a[^>]*href="\/"/, 'a link home')
    assert.equal(titleOf(html), `${en('admin', 'notFoundTitle')} · ${en('marketing', 'brand')}`, 'and a tab that says so')
  }
  for (const [path, shell] of [[`/dashboard/courses/${randomUUID()}`, 'app'], ['/dashboard/nope-230', 'app'], ['/portal/nope-230', 'top']] as const) {
    const answer = await fetch(`${origin}${path}`, { headers: { cookie } })
    assert.equal(answer.status, 404, `${path} answers 404`)
    const html = plain(await answer.text())
    assert.ok(html.includes(`data-shell="${shell}"`), `${path} is drawn inside the ${shell} shell`)
    assert.ok(html.includes(en('admin', 'notFound')), `and says the page does not exist`)
    assert.equal(html.match(/<h1/g)?.length, 1, 'under one h1')
    assert.match(html, new RegExp(`<a[^>]*href="/${path.split('/')[1]}"[^>]*>[^<]*${en('auth', 'backTo').replace('{screen}', '')}`), 'with a link back to the screen\'s home')
    assert.equal(titleOf(html), `${en('admin', 'notFoundTitle')} · ${en('marketing', 'brand')}`, 'and a tab that says it was not found')
  }

  // No HTML page is kept by the browser, and a page restored from the back-forward cache reloads.
  const dashboard = await fetch(`${origin}/dashboard`, { headers: { cookie } })
  assert.match(dashboard.headers.get('cache-control') ?? '', /no-store/, 'a signed-in page is never stored')
  assert.ok((await dashboard.text()).includes('event.persisted'), 'and reloads when the browser restores it from its cache')
  assert.match((await fetch(`${backofficeOrigin}/auth/sign-in`)).headers.get('cache-control') ?? '', /no-store/, 'the backoffice\'s pages too')

  await holding('registrar', async () => {
    const refused = await fetch(`${origin}/dashboard/enrollments`, { headers: { cookie }, redirect: 'manual' })
    const location = new URL(refused.headers.get('location') ?? '', origin)
    assert.equal(`${location.pathname}${location.search}`, `/unauthorized?from=${encodeURIComponent('/dashboard/enrollments')}`, 'the refusal carries the refused path')
    const card = plain(await (await fetch(location, { headers: { cookie } })).text()).replace(/<\/?bdi[^>]*>/g, '')
    assert.ok(card.includes(en('auth', 'unauthorizedPage').replace('{page}', en('enrollments', 'plural'))), `the card names the refused page: ${card.slice(card.indexOf('<h1'), card.indexOf('<h1') + 600)}`)
    assert.ok(!card.includes(en('auth', 'unauthorizedDescription')), 'and never says the screen is closed')
    assert.match(card, new RegExp(`<a[^>]*href="/dashboard"[^>]*>${en('auth', 'backTo').replace('{screen}', en('screens', 'dashboard'))}<`), 'and leads back to the dashboard')
    assert.ok(card.includes('aria-label="العربية"'), 'NF-22: the card has the language switch')
    const created = plain(await (await fetch(`${origin}/unauthorized?from=${encodeURIComponent('/dashboard/tags/new')}`, { headers: { cookie } })).text()).replace(/<\/?bdi[^>]*>/g, '')
    assert.ok(created.includes(en('auth', 'unauthorizedPage').replace('{page}', en('tags', 'new'))), 'a create page is named as new')
    const outside = await fetch(`${origin}/unauthorized?from=${encodeURIComponent('/portal')}`, { headers: { cookie }, redirect: 'manual' })
    assert.equal(new URL(outside.headers.get('location') ?? '', origin).pathname, '/dashboard', 'a screen the role does not enter sends it on to the one screen it does')
  })

  // A switch into an organization where the actor holds no role names that organization alone and offers the others.
  const db = (asas.targets.drizzle as unknown as { db: { execute(query: string): Promise<{ rows: unknown[] }> } }).db
  const me = (await (await fetch(`${origin}/api/auth/user/get-session?disableRefresh=true`, { headers: { cookie } })).json()) as { user: { id: string }; session: { activeOrganizationId: string } }
  const stranded = `Stranded ${Date.now()}`
  await db.execute(`insert into organization (id, name, slug, created_at) values ('stranded-230', '${stranded}', 'stranded-230', now())`)
  await db.execute(`insert into member (id, organization_id, user_id, role, created_at) values ('stranded-230', 'stranded-230', '${me.user.id}', 'member', now())`)
  const setActive = (organizationId: string) => post('/api/auth/user/organization/set-active', { organizationId }, { cookie, origin })
  assert.equal((await setActive('stranded-230')).response.status, 200)
  try {
    const card = plain(await (await fetch(`${origin}/unauthorized`, { headers: { cookie } })).text()).replace(/<\/?(bdi|span)[^>]*>/g, '')
    const sentence = en('auth', 'noAccessDescription').replace('{email}', actorEmail).replaceAll('{organization}', stranded)
    assert.ok(card.includes(sentence), `the card names the active organization alone: ${card.slice(card.indexOf('data-no-access'), card.indexOf('data-no-access') + 400)}`)
    assert.match(card, new RegExp(`<button[^>]*data-switch-organization="${me.session.activeOrganizationId}"[^>]*>${en('auth', 'switchTo').replace('{organization}', organizationName)}<`), 'and offers the organization the actor holds a role in')
    // Two memberships of one name are told apart by their slugs, in the sentence and on the button.
    const slug = ((await db.execute(`select slug from organization where id = '${me.session.activeOrganizationId}'`)).rows[0] as { slug: string }).slug
    await db.execute(`update organization set name = '${organizationName}' where id = 'stranded-230'`)
    const twin = plain(await (await fetch(`${origin}/unauthorized`, { headers: { cookie } })).text()).replace(/<\/?(bdi|span)[^>]*>/g, '')
    assert.ok(twin.includes(`member of ${organizationName} stranded-230 and`), `the sentence names the active one with its slug: ${twin.slice(twin.indexOf('data-no-access'), twin.indexOf('data-no-access') + 400)}`)
    assert.match(twin, new RegExp(`data-switch-organization="${me.session.activeOrganizationId}"[^>]*>${en('auth', 'switchTo').replace('{organization}', `${organizationName} ${slug}`)}<`), 'and the button the other with its own')
  } finally {
    assert.equal((await setActive(me.session.activeOrganizationId)).response.status, 200)
    await db.execute(`delete from member where id = 'stranded-230'`)
    await db.execute(`delete from organization where id = 'stranded-230'`)
  }

  // What a caller writes in `from` is matched against the build's pages and never said back.
  const course = await post('/api/courses/create', { title: `Secret ${Date.now()}`, fee: 1, currency: 'SAR', audience: 'beginner', delivery: 'live', accessCode: 'SEC230' }, { cookie })
  assert.equal(course.response.status, 200, JSON.stringify(course.body))
  const mainOf = (html: string) => html.slice(html.indexOf('<main'), html.indexOf('</main>'))
  const named = plain(mainOf(await (await fetch(`${origin}/unauthorized?from=${encodeURIComponent(`/dashboard/courses/${course.body.id}`)}`, { headers: { cookie } })).text())).replace(/<\/?bdi[^>]*>/g, '')
  assert.ok(named.includes(en('auth', 'unauthorizedPage').replace('{page}', en('courses', 'singular'))), `a refused row is named by its kind: ${named.slice(0, 600)}`)
  assert.ok(!named.includes(String(course.body.title)), 'and never by its title, which the actor was refused')
  const injected = mainOf(await (await fetch(`${origin}/unauthorized?from=${encodeURIComponent('/dashboard/<script>x')}`, { headers: { cookie } })).text())
  assert.ok(!injected.includes('<script>x') && !injected.includes('&lt;script&gt;x') && !injected.includes('/dashboard/'), `a path that names no page is not said back: ${injected.slice(0, 600)}`)
  assert.ok(plain(injected).includes(en('auth', 'unauthorizedDescription')), 'and the card says what it says with no path at all')
  // A visitor with no session is sent to sign-in from a missing page inside a screen, never shown the screen.
  const anonymous = await fetch(`${origin}/dashboard/nope-230`, { redirect: 'manual' })
  assert.equal(anonymous.status, 307)
  assert.equal(new URL(anonymous.headers.get('location') ?? '', origin).pathname, '/auth/sign-in', 'an anonymous visitor is sent to sign-in')
  const staff = await backofficeSignIn()
  await staffAs('explorer', async () => {
    const missing = await fetch(`${backofficeOrigin}/backoffice/nonsense`, { headers: { cookie: staff } })
    assert.equal(missing.status, 404, '/backoffice/nonsense answers 404')
    const html = await missing.text()
    assert.ok(html.includes('data-shell="app"'), 'inside the backoffice\'s shell')
    assert.match(html, /<a[^>]*href="\/backoffice"/, 'with the way back to the backoffice\'s home')
  })

  const made = await post('/api/courses/create', { title: `Tab ${Date.now()}`, fee: 1, currency: 'SAR', audience: 'beginner', delivery: 'live', accessCode: 'TAB230' }, { cookie })
  assert.equal(made.response.status, 200, JSON.stringify(made.body))
  assert.equal(titleOf(await (await fetch(`${origin}/dashboard/courses/${made.body.id}`, { headers: { cookie } })).text()), `${made.body.title} · ${en('marketing', 'brand')}`)
  assert.equal(titleOf(await (await fetch(`${origin}/dashboard/courses/new`, { headers: { cookie } })).text()), `${en('courses', 'new')} · ${en('marketing', 'brand')}`)
  const session = await post('/api/sessions/create', { course: made.body.id, startsAt: new Date().toISOString(), capacity: 2 }, { cookie })
  const seat = await asStudent(() => post('/api/enrollments/create', { session: session.body.id, student: me.user.id }, { cookie }))
  assert.equal(seat.response.status, 200, JSON.stringify(seat.body))
  assert.equal(titleOf(await (await fetch(`${origin}/dashboard/enrollments/${seat.body.id}`, { headers: { cookie } })).text()), `${actorName} · ${en('marketing', 'brand')}`, 'an enrollment is named by its student')
})

test('77. a production start against a database that has not applied a migration refuses before serving: it answers no 200, exits non-zero and names the folders', async () => {
  // A database of its own beside the run's, with nothing applied, so every folder of the template is pending.
  const db = asas.targets.drizzle.db as unknown as { execute(query: string): Promise<unknown> }
  const name = `pending_${randomUUID().replaceAll('-', '')}`
  await db.execute(`create database ${name}`)
  const url = new URL(env.DATABASE_URL!)
  url.pathname = `/${name}`
  const port = await freePort()
  const child = spawn(vite, ['preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, DATABASE_URL: url.href } })
  let said = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { said += chunk })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { said += chunk })
  const exited = once(child, 'exit')
  try {
    // The preview server loads the entry at its first request, and the entry
    // exits the process on the refusal. Every answer until then is not a 200.
    const at = `http://127.0.0.1:${port}`
    const paths = ['/', '/dashboard', '/portal', '/api/not-ours', '/api/access', '/api/rpc/courses/find']
    for (let attempt = 0; child.exitCode === null && child.signalCode === null; attempt += 1) {
      assert.ok(attempt < 300, `the preview server never exited:\n${said}`)
      const answer = await fetch(`${at}${paths[attempt % paths.length]}`).catch(() => undefined)
      if (answer) assert.notEqual(answer.status, 200, `${paths[attempt % paths.length]} is not served:\n${said}`)
      await sleep(100)
    }
    const [code] = await exited
    assert.ok(code !== 0 && code !== null, `the start exits non-zero, not ${code}:\n${said}`)
    assert.match(said, /This database has not applied 20260920080701_parched_tombstone, /)
    assert.match(said, /drizzle-kit migrate --config \S*templates\/asas\/src\/migrations\/drizzle\.config\.ts/)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
      await exited
    }
    await db.execute(`drop database ${name} with (force)`)
  }
})

test('78. behind a TLS proxy that routes by Host, each app answers its own public name over plain HTTP and refuses any other, and a backoffice write is checked against BACKOFFICE_URL\'s origin rather than the URL it was served on', async () => {
  const names = { tenant: 'app.example.test', backoffice: 'backoffice.example.test' }
  const proxied = { ...env, BETTER_AUTH_URL: `https://${names.tenant}`, BACKOFFICE_URL: `https://${names.backoffice}` }
  const children: ReturnType<typeof spawn>[] = []
  /** A request as the proxy forwards it: plain HTTP to the loopback port, under the public name. */
  const forwarded = ({ port, host, method = 'GET', path = '/api/not-ours', headers = {} }: { port: number; host: string; method?: string; path?: string; headers?: Record<string, string> }) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const sent = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => { body += chunk })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
      })
      sent.on('error', reject)
      sent.end(method === 'GET' ? undefined : '{}')
    })
  try {
    const ports = { tenant: await freePort(), backoffice: await freePort() }
    for (const [which, cwd] of [['tenant', app], ['backoffice', backofficeApp]] as const) {
      // No `--host`: the app's own `preview.host` binds the loopback address the proxy targets.
      const child = spawn(vite, ['preview', '--port', String(ports[which]), '--strictPort'], { cwd, stdio: 'ignore', env: proxied })
      children.push(child)
      for (let attempt = 0; !(await forwarded({ port: ports[which], host: names[which] }).catch(() => undefined)); attempt += 1) {
        assert.ok(attempt < 300 && child.exitCode === null, `the ${which} preview never answered on 127.0.0.1:${ports[which]}`)
        await sleep(100)
      }
      assert.equal((await forwarded({ port: ports[which], host: names[which] })).status, 404, `the ${which} app answers ${names[which]}`)
      const other = await forwarded({ port: ports[which], host: 'elsewhere.example.test' })
      assert.equal(other.status, 403, `and refuses a name it is not served under`)
      assert.match(other.body, /Blocked request/)
    }
    const posted = (path: string, origin: string) =>
      forwarded({ port: ports.backoffice, host: names.backoffice, method: 'POST', path, headers: { origin, 'content-type': 'application/json' } })
    assert.notEqual((await posted('/api/tags/create', `https://${names.backoffice}`)).status, 403, 'a write from the public origin reaches the handler')
    assert.equal((await posted('/api/tags/create', `http://${names.backoffice}`)).status, 403, 'and one from the URL the proxy forwarded to is refused')
    assert.notEqual((await posted('/api/auth/user/sign-in/email', `https://${names.backoffice}`)).status, 403, 'and a sign-in from the public origin is not refused for its origin')
  } finally {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      child.kill()
      await once(child, 'exit')
    }
  }
})
