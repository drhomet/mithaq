// Boots the built Next host and asserts over a real socket. Not named `*.test.ts`
// so the default run stays fast; run it with `bun run test:next`.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { asas } from '../templates/asas/src/asas.ts'
import { migratedDatabase } from './migrated-database.ts'

const app = fileURLToPath(new URL('./asas-next', import.meta.url))
const next = `${app}/node_modules/.bin/next`

/**
 * The port Next chose for `--port 0`, read off its startup banner. The banner
 * prints only once the socket accepts, and its host is `localhost`, which can
 * resolve to `::1` while Next bound IPv4, so only the port is taken.
 */
const announced = async (child: ReturnType<typeof spawn>) =>
  await new Promise<number>((resolve, reject) => {
    let seen = ''
    const read = (chunk: string) => {
      seen += chunk
      const port = /- Local:\s+\S+:(\d+)\s/.exec(seen)?.[1]
      if (!port) return
      child.stdout?.off('data', read)
      resolve(Number(port))
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', read)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      seen += chunk
    })
    child.on('exit', (code) => reject(new Error(`next start exited with ${code} before it announced a port:\n${seen}`)))
  })

let origin = ''
let served: ReturnType<typeof spawn> | undefined
let env: NodeJS.ProcessEnv = process.env

before(async () => {
  // `next start` connects in `register()`, which refuses a database with a pending migration.
  await migratedDatabase()
  // A production boot refuses to start without these; `next build` loads the route module,
  // so it needs them too. Without LOCAL_AUTH_SECRET local auth answers every POST 503.
  env = {
    ...process.env,
    BETTER_AUTH_SECRET: 'asas-next-boot-test-secret',
    LOCAL_AUTH_SECRET: 'asas-next-boot-local-secret-of-32-characters',
    PLATFORM_URL: 'http://127.0.0.1:4174',
    BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    STORAGE_SECRET: 'asas-next-boot-storage-secret-of-32-characters',
    STORAGE_PREFIX: 'mithaq/asas',
    STORAGE_ADAPTER: 'local',
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'mithaq-next-storage-')),
    // A production start needs a mailer. Nothing here mails, and the discard port refuses what would.
    RESEND_API_KEY: 're_next_boot_never_sent',
    MAIL_FROM: 'Next <mail@example.com>',
    RESEND_BASE_URL: 'http://127.0.0.1:9',
  }
  const buildStarted = performance.now()
  const built = spawnSync(next, ['build'], { cwd: app, encoding: 'utf8', env })
  assert.equal(built.status, 0, `next build exits 0\n${built.stdout}\n${built.stderr}`)
  const builtIn = performance.now() - buildStarted

  const startStarted = performance.now()
  served = spawn(next, ['start', '--port', '0'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'], env })
  origin = `http://127.0.0.1:${await announced(served)}`
  // One request, not a poll: the banner prints once the socket accepts.
  await fetch(`${origin}/api/not-ours`)
  const startedIn = performance.now() - startStarted
  console.log(
    `boot: next build ${(builtIn / 1000).toFixed(1)}s, next start to first answer ${(startedIn / 1000).toFixed(1)}s`,
  )
}, { timeout: 300_000 })

after(async () => {
  await asas.destroy()
  // A child already gone has fired `exit`; waiting for it again would never return.
  if (!served || served.exitCode !== null || served.signalCode !== null) return
  // Awaited: `kill` only sends the signal, and returning early leaves a server holding a port.
  served.kill()
  await once(served, 'exit')
})

const verbs = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

// Six exports and not seven: Next gives a route with no `HEAD` export the `GET` one, so a
// HEAD that comes back proves the request reached `asas.handler`, not the export named `HEAD`.
test('1. six of the seven verb exports are dispatched to asas.handler and a HEAD reaches it too, and the unowned path under the mount gets the handler\'s own 404 rather than Next\'s', async () => {
  for (const method of verbs) {
    const response = await fetch(`${origin}/api/not-ours`, { method })
    assert.equal(response.status, 404, `${method} /api/not-ours comes back 404, so Next routed ${method} into the catch-all`)
    // `asas.handler` answers text/plain; Next's own not-found is rendered HTML.
    assert.equal(
      response.headers.get('content-type'),
      'text/plain;charset=UTF-8',
      `the ${method} 404 is the handler's own text/plain body and not Next's rendered HTML not-found page`,
    )
    if (method !== 'HEAD') {
      assert.equal(await response.text(), 'Not found', `the ${method} 404 carries the handler's own two words`)
    }
  }
})

test('2. the host reshapes nothing on the way in: the body is not consumed and the content-type header is neither dropped nor rewritten', async () => {
  // One URL, three bodies. The arm answers a different message for each, so one assertion rules out
  // both a consumed body (`received undefined`) and a rewritten content-type (`received string`).
  // `text/plain` is used for the rewrite check because a missing content-type reads as JSON.
  const message = async (init: RequestInit) =>
    ((await (await fetch(`${origin}/api/courses/create`, init)).json()) as { message: string }).message

  assert.equal(
    await message({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    'title: courses.title.required',
    'the arm parsed an object out of the body, which it can only do when the body arrived whole and the content-type came with it',
  )
  // `fetch` gives a string body a `text/plain;charset=UTF-8` of its own.
  assert.equal(
    await message({ method: 'POST', body: '{}' }),
    'Invalid input: expected object, received string',
    'the arm sees the text/plain the request carried and reads the body as a string, so the host rewrote no content-type on the way in',
  )
  assert.equal(
    await message({ method: 'POST', headers: { 'content-type': 'application/json' } }),
    'Invalid input: expected object, received undefined',
    'with no body at all the arm sees undefined, which is the message the first case would carry had the host consumed the body',
  )
})

test('3. a refusal keeps its own status across the wire, so an offline client reads 400 and 403 as terminal rather than a 500 it retries forever', async () => {
  const sent = async (path: string, body: unknown) =>
    await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  const auth = await sent('/api/auth/local/reset-password', {})
  assert.equal(auth.status, 400, 'the auth arm refuses this body 400 over the wire')
  assert.equal(
    ((await auth.json()) as { message: string }).message,
    'A token and a password of 8 to 1024 characters are required.',
    'the refusal carries the local strategy\'s own message (`packages/mithaq/src/auth/local/index.ts` `A token and a password of ${passwordLength.min} to ${passwordLength.max} characters are required.`), so the auth arm answered and not the plug',
  )

  const rpc = await sent('/api/rpc/courses/create', { json: {} })
  assert.equal(rpc.status, 400, 'the RPC arm refuses a create with no title 400, not 500')
  assert.equal(
    ((await rpc.json()) as { json: { data: { key: string } } }).json.data.key,
    'error.invalid.value',
    'the RPC arm answered, because the refusal carries the key inside the `json` envelope the RPC protocol wraps every body in',
  )

  const plain = await sent('/api/courses/create', {})
  assert.equal(plain.status, 400, 'the plain HTTP arm refuses the same create 400, not 500')

  const denied = await sent('/api/rpc/courses/find', { json: {} })
  assert.equal(denied.status, 403, 'a read with no actor is refused 403 across the wire, and never the 401 an offline client cannot tell from a session it can refresh')
  assert.equal(
    ((await denied.json()) as { json: { data: { key: string } } }).json.data.key,
    'error.forbidden.read',
    'the 403 is the access refusal itself, so the status and the reason travelled together',
  )
})

test('5. next start against a database that has not applied a migration exits non-zero in register(), naming the folders', async () => {
  const db = asas.targets.drizzle.db as unknown as { execute(query: string): Promise<unknown> }
  const name = `pending_${randomUUID().replaceAll('-', '')}`
  await db.execute(`create database ${name}`)
  const url = new URL(env.DATABASE_URL!)
  url.pathname = `/${name}`
  try {
    const refused = spawnSync(next, ['start', '--port', '0'], { cwd: app, encoding: 'utf8', env: { ...env, DATABASE_URL: url.href }, timeout: 120_000 })
    const said = `${refused.stdout}${refused.stderr}`
    assert.ok(refused.status !== 0 && refused.status !== null, `next start exits non-zero, not ${refused.status} (${refused.signal}):\n${said}`)
    assert.match(said, /This database has not applied 20260920080701_parched_tombstone, /)
  } finally {
    await db.execute(`drop database ${name} with (force)`)
  }
})
