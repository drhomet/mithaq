// Run with DATABASE_URL set to a dedicated local PostgreSQL database named mithaq, which this check writes to.
// It proves what the boot tests do not: the staged packages (`apps/pack.ts`) make a project the way `bun create mithaq` does,
// with `mithaq` installed from the packed tarball and no framework source or `mithaq-admin`; the consumer typechecks, migrates,
// builds both apps, boots each under Node, answers a signed-in request and passes `mithaq generate --check`.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { testDatabase } from '../templates/asas/src/test-database.ts'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const database = process.env.DATABASE_URL
assert.ok(database, 'Set DATABASE_URL to a dedicated release database')
const databaseUrl = new URL(database)
assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'the release database must be local')
assert.equal(databaseUrl.pathname, '/mithaq', 'the release database must be named mithaq')
// The check empties this database, so it refuses the dev database and the study container like every test step that drops a schema.
testDatabase()

const command = (program: string, args: string[], cwd: string) => {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 600_000 })
  assert.equal(result.status, 0, `${program} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
}

let consumer: string | undefined
const servers: ReturnType<typeof spawn>[] = []
let output = ''
try {
  const scratch = mkdtempSync(join(tmpdir(), 'mithaq-release-'))
  consumer = join(scratch, 'consumer')
  command(process.execPath, ['apps/pack.ts'], root)
  command('npm', ['pack', '.pack/mithaq', '--pack-destination', scratch], root)
  const { version: published } = JSON.parse(readFileSync(join(root, '.pack/mithaq/package.json'), 'utf8')) as { version: string }
  for (const name of ['mithaq', 'create-mithaq']) {
    const { repository, homepage, bugs } = JSON.parse(readFileSync(join(root, `.pack/${name}/package.json`), 'utf8')) as { repository?: { url: string }; homepage?: string; bugs?: { url: string } }
    assert.deepEqual([repository?.url, homepage, bugs?.url], ['git+https://github.com/drhomet/mithaq.git', 'https://github.com/drhomet/mithaq#readme', 'https://github.com/drhomet/mithaq/issues'], `.pack/${name} names the public repository`)
  }
  // The project as `bun create mithaq consumer` makes it, with `mithaq` pointed at the tarball through a flag only this check
  // passes, so nothing is fetched from npm or jsDelivr.
  const created = spawnSync(process.execPath, [join(root, '.pack/create-mithaq/index.js'), 'consumer', '--mithaq', `file:${join(scratch, `drhomet-mithaq-${published}.tgz`)}`], {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 600_000,
    env: { ...process.env, npm_config_user_agent: 'bun/1.3.14 npm/? node/v24' },
  })
  assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`)
  assert.ok(!created.stderr.includes('Not installed'), created.stderr)
  assert.match(created.stdout, /bun run --cwd apps\/asas-tanstack dev/)
  assert.match(created.stdout, /bun run --cwd apps\/asas-platform dev/)
  for (const workspace of ['templates/asas', 'templates/auth', 'apps/asas-tanstack', 'apps/asas-platform']) {
    const manifest = JSON.parse(readFileSync(join(consumer, workspace, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> }
    assert.ok(!manifest.devDependencies?.['mithaq-admin'], `${workspace} names no mithaq-admin`)
    assert.ok(!existsSync(join(consumer, workspace, 'src/asas.test.ts')) && !existsSync(join(consumer, workspace, 'src/test-database.ts')), `${workspace} has no tests`)
  }
  const app = join(consumer, 'apps/asas-tanstack')
  const platformApp = join(consumer, 'apps/asas-platform')
  const installed = realpathSync(join(app, 'node_modules/mithaq'))
  assert.ok(installed.startsWith(join(realpathSync(consumer), 'node_modules')), `mithaq resolves to the installed tarball, not ${installed}`)
  assert.equal((JSON.parse(readFileSync(join(app, 'node_modules/mithaq/package.json'), 'utf8')) as { name: string }).name, '@drhomet/mithaq')
  const template = join(consumer, 'templates/asas')
  // Every copy each workspace holds is read against the `r/` the installed package ships and must be up to date;
  // with no `r/` there the check answers undefined and this fails.
  for (const [workspace, files] of [[app, 31], [platformApp, 30], [template, 6]] as const) {
    assert.ok(existsSync(join(workspace, 'node_modules/.bin/mithaq')), `${workspace} has the mithaq bin`)
    assert.ok(!existsSync(join(workspace, 'node_modules/mithaq-admin')), `${workspace} has no mithaq-admin`)
    const check = spawnSync(process.execPath, ['--input-type=module', '-e', "import { pathToFileURL } from 'node:url'; import { upgradeCheck } from 'mithaq/upgrade'; console.log(JSON.stringify(await upgradeCheck(pathToFileURL(`${process.cwd()}/`))))"], { cwd: workspace, encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr)
    const states = JSON.parse(check.stdout) as { path: string; state: string }[] | null
    assert.equal(states?.length, files, `${workspace} reads every copy against the package's r/:\n${check.stdout}`)
    assert.deepEqual(states.filter((one) => one.state !== 'up to date'), [])
  }
  const targets = spawnSync(process.execPath, ['--input-type=module', '-e', "import * as targets from 'mithaq/targets'; console.log(Object.keys(targets).sort().join(' '))"], { cwd: template, encoding: 'utf8' })
  assert.equal(targets.status, 0, targets.stderr)
  for (const name of ['betterAuthTenant', 'drizzleAdapter', 'rbacTarget', 'screenTarget', 'serviceTarget', 'storageTarget', 'versionsTarget', 'zodTarget']) {
    assert.ok(targets.stdout.trim().split(' ').includes(name), `mithaq/targets exports ${name}:\n${targets.stdout}`)
  }
  // The rukn that add a key to every kayan augment `KayanConfigs` from their own module. A declaration file that cannot resolve
  // that module drops the augmentation and `skipLibCheck` hides it, so the consumer checks the keys arrive; a stray key must be
  // refused too, since a `KayanConfigs` widened to `any` would pass otherwise.
  writeFileSync(join(app, 'src/augmentations.probe.ts'), [
    "import type { KayanConfigs } from 'mithaq'",
    "export const keys: Record<'versions' | 'storage' | 'screen' | 'drizzle', true> = {} as Record<keyof KayanConfigs<{}, {}, {}>, true>",
    '// @ts-expect-error a key no rukn adds',
    "export const stray: keyof KayanConfigs<{}, {}, {}> = 'no-such-rukn'",
    '',
  ].join('\n'))
  command('bun', ['x', 'tsc', '-p', 'apps/asas-tanstack'], consumer)
  command('bun', ['x', 'tsc', '-p', 'apps/asas-platform'], consumer)
  command('bun', ['x', 'tsc', '-p', '.'], consumer)
  // The database as a deploy leaves it: emptied, then migrated with the `drizzle-kit` the installed `mithaq` resolves.
  // Node runs the rest: the project's `.ts` lies outside `node_modules`, where Node strips types.
  command(process.execPath, ['--input-type=module', '-e', "import { asas } from './src/asas.ts'; await asas.targets.drizzle.db.execute('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;'); await asas.destroy()"], template)
  const drizzleKit = createRequire(join(realpathSync(join(template, 'node_modules/mithaq')), 'package.json')).resolve('drizzle-kit')
  command(process.execPath, [join(dirname(drizzleKit), 'bin.cjs'), 'migrate', '--config', 'src/migrations/drizzle.config.ts'], template)
  command(join(template, 'node_modules/.bin/mithaq'), ['lock', '--check'], template)
  // Without `--bun`, each program the build script runs starts under the `node` its shebang names.
  command('bun', ['run', 'build'], app)
  command('bun', ['run', 'build'], platformApp)

  const freePort = async () => {
    const held = createServer().listen(0, '127.0.0.1')
    await once(held, 'listening')
    const { port } = held.address() as { port: number }
    await new Promise((done) => held.close(done))
    return port
  }
  const [port, platformPort] = [await freePort(), await freePort()]
  const origin = `http://127.0.0.1:${port}`
  const platformOrigin = `http://127.0.0.1:${platformPort}`
  const { BETTER_AUTH_SECRET: _secret, AUTH_SECRET: _fallback, ...withoutAuthSecret } = process.env
  const start = (cwd: string, at: number) => {
    const child = spawn(process.execPath, [join(cwd, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(at), '--host', '127.0.0.1', '--strictPort'], {
      cwd,
      // A production boot needs these settings. `BETTER_AUTH_SECRET` is left out on purpose: each app answering proves it read
      // the `.env` `create-mithaq` wrote, which TanStack Start loads into `process.env`, a variable already set winning.
      env: { ...withoutAuthSecret, NODE_ENV: 'production', BETTER_AUTH_URL: origin, PLATFORM_URL: platformOrigin, STORAGE_SECRET: 'mithaq-release-consumer-storage-secret-32', STORAGE_PREFIX: 'mithaq/asas', STORAGE_ADAPTER: 'local', STORAGE_DIR: join(consumer!, '.storage') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    servers.push(child)
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk })
    return child
  }
  // `vite preview` because the build writes a fetch handler and no server; spawned as Node on Vite's own entry,
  // not through `bun run`, so `kill()` reaches the process that holds the port.
  for (const [at, child] of [[origin, start(app, port)], [platformOrigin, start(platformApp, platformPort)]] as const) {
    for (let attempt = 0; ; attempt++) {
      assert.ok(child.exitCode === null && child.signalCode === null, `the app on ${at} exited:\n${output}`)
      const answered = await fetch(`${at}/api/not-ours`, { signal: AbortSignal.timeout(1_000) }).catch(() => undefined)
      if (answered) {
        // The handler's own 404, so the entry loaded and its `connect()` let it serve.
        assert.equal(answered.status, 404, `the app on ${at} serves over the migrated database:\n${output}`)
        break
      }
      assert.ok(attempt < 300, `the app on ${at} never answered:\n${output}`)
      await sleep(100)
    }
  }

  const stamp = randomUUID()
  const signUp = await fetch(`${origin}/api/auth/user/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Release', email: `release-${stamp}@example.com`, password: 'release-test-password' }),
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(signUp.status, 200, `${await signUp.text()}\n${output}`)
  const cookie = signUp.headers.getSetCookie().map((part) => part.split(';')[0]).join('; ')
  assert.ok(cookie, 'the sign-up answered with a session cookie')
  const organization = await fetch(`${origin}/api/auth/user/organization/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie },
    body: JSON.stringify({ name: 'Release', slug: `release-${stamp}` }),
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(organization.status, 200, `${await organization.text()}\n${output}`)
  command(join(template, 'node_modules/.bin/mithaq'), ['generate', '--check'], template)
  console.log('release consumer passed')
} finally {
  for (const server of servers) {
    if (server.exitCode !== null || server.signalCode !== null) continue
    const exited = once(server, 'exit')
    server.kill()
    // A host that ignores SIGTERM is killed outright rather than left holding the port.
    if (!(await Promise.race([exited.then(() => true), sleep(5_000, false, { ref: false })]))) {
      server.kill('SIGKILL')
      await exited
    }
  }
  if (consumer) rmSync(dirname(consumer), { recursive: true, force: true })
}
