// Run with DATABASE_URL set to a dedicated local PostgreSQL database named mithaq, which this check writes to.
// It proves what the boot tests do not: the staged packages (`apps/pack.ts`) make a project the way `bun create mithaq` and
// `npm create mithaq` do, with `mithaq` and `mithaq-admin` installed from the packed tarballs and no framework source; each
// consumer typechecks, migrates, builds its apps, boots each under Node, answers a signed-in request and passes
// `mithaq generate --check`: a monorepo with Bun and with npm, and with Bun a single package and a monorepo with no
// platform console, which boots with no PLATFORM_URL. A project with no rich text, `mithaq` alone with npm, proves no
// Lexical is installed with it.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

/** Where Node finds `name` from `folder`: the nearest `node_modules` above it holding it, wherever the manager put it. */
const installed = (folder: string, name: string): string => {
  const at = join(folder, 'node_modules', name)
  if (existsSync(at)) return at
  assert.notEqual(dirname(folder), folder, `${name} is installed nowhere above the folder`)
  return installed(dirname(folder), name)
}

const scratch = mkdtempSync(join(tmpdir(), 'mithaq-release-'))
try {
  command(process.execPath, ['apps/pack.ts'], root)
  for (const name of ['mithaq', 'mithaq-admin']) command('npm', ['pack', `.pack/${name}`, '--pack-destination', scratch], root)
  const { version: published } = JSON.parse(readFileSync(join(root, '.pack/mithaq/package.json'), 'utf8')) as { version: string }
  for (const name of ['mithaq', 'mithaq-admin', 'create-mithaq']) {
    const { repository, homepage, bugs } = JSON.parse(readFileSync(join(root, `.pack/${name}/package.json`), 'utf8')) as { repository?: { url: string }; homepage?: string; bugs?: { url: string } }
    assert.deepEqual([repository?.url, homepage, bugs?.url], ['git+https://github.com/drhomet/mithaq.git', 'https://github.com/drhomet/mithaq#readme', 'https://github.com/drhomet/mithaq/issues'], `.pack/${name} names the public repository`)
  }
  const tarball = `file:${join(scratch, `drhomet-mithaq-${published}.tgz`)}`
  const adminTarball = `file:${join(scratch, `drhomet-mithaq-admin-${published}.tgz`)}`
  withoutRichText(tarball)
  for (const run of [{ manager: 'bun' }, { manager: 'npm' }, { manager: 'bun', layout: 'single' }, { manager: 'bun', platform: false }]) await release({ tarball, adminTarball, ...run })
  console.log('release consumer passed')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

/** A project with no rich text installs `mithaq` and no Lexical, and still typechecks and builds its language. */
function withoutRichText(tarball: string) {
  const project = join(scratch, 'npm-without-rich-text')
  mkdirSync(project)
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'without-rich-text', private: true, type: 'module', dependencies: { mithaq: tarball } }))
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'nodenext', target: 'esnext', noEmit: true, skipLibCheck: true, types: [] }, files: ['index.ts'] }))
  writeFileSync(join(project, 'index.ts'), [
    "import { base, defaultAuthorize, defaultBulkLimit, defaultDepth, defaultFields, defaultJoinLimit, defaultLimit, defaultMaxLimit, defaultOperations, defineMithaq, drizzleAdapter, drizzleTarget, fetchHttp, serviceTarget, zodTarget } from 'mithaq'",
    'const { defineKayan, buildAsas } = defineMithaq({',
    '  arkan: [base],',
    "  targets: { drizzle: drizzleAdapter({ connectionString: 'postgresql://never-connected', ...drizzleTarget }), zod: zodTarget, service: serviceTarget({ depth: defaultDepth, defaultLimit, maxLimit: defaultMaxLimit, joinLimit: defaultJoinLimit, bulkLimit: defaultBulkLimit, store: 'drizzle', schema: 'zod', authorize: defaultAuthorize }) },",
    '})',
    "const notes = defineKayan({ name: 'notes', fields: { ...defaultFields, title: { kind: 'text', label: { en: 'Title' } } }, targets: { service: { operations: defaultOperations } } })",
    '// @ts-expect-error a language without the richText rukn has no richText kind',
    "defineKayan({ name: 'pages', fields: { ...defaultFields, body: { kind: 'richText', label: { en: 'Body' } } }, targets: { service: { operations: defaultOperations } } })",
    'buildAsas({ http: [fetchHttp()], kayan: [notes] })',
    "console.log('built without rich text')",
    '',
  ].join('\n'))
  // npm installs every peer that is not optional, so a Lexical left required would land here.
  command('npm', ['install', '--no-audit', '--no-fund'], project)
  assert.deepEqual(readdirSync(join(project, 'node_modules')).filter((name) => /^@?lexical$/.test(name)), [], 'no Lexical is installed')
  // `skipLibCheck` would hide a declaration that names Lexical, so the built files are read for it.
  const dist = join(project, 'node_modules/mithaq/dist')
  const naming = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) => /\.(js|d\.ts)$/.test(file) && /'(lexical|@lexical\/[^']+)'/.test(readFileSync(join(dist, file), 'utf8')))
  assert.ok(naming.length > 0 && naming.every((file) => file.startsWith('rich-text/')), `only mithaq/rich-text names Lexical: ${naming.join(', ')}`)
  command(join(root, 'node_modules/.bin/tsc'), ['-p', '.'], project)
  command(process.execPath, ['index.ts'], project)
  console.log('release consumer passed: npm-without-rich-text')
}

async function release({ manager, tarball, adminTarball, layout = 'monorepo', platform = layout === 'monorepo' }: { manager: string; tarball: string; adminTarball: string; layout?: string; platform?: boolean }) {
  const name = `${manager}-${layout === 'single' ? 'single' : platform ? 'monorepo' : 'tenant'}`
  const consumer = join(scratch, name)
  const single = layout === 'single'
  const servers: ReturnType<typeof spawn>[] = []
  let output = ''
  try {
    // The project as `<manager> create mithaq` makes it, with `mithaq` and `mithaq-admin` pointed at the tarballs through flags
    // only this check passes, so neither is fetched from npm.
    const created = spawnSync(process.execPath, [join(root, '.pack/create-mithaq/index.js'), name, '--layout', layout, platform ? '--platform' : '--no-platform', '--mithaq', tarball, '--mithaq-admin', adminTarball], {
      cwd: scratch,
      encoding: 'utf8',
      timeout: 600_000,
      env: { ...process.env, npm_config_user_agent: `${manager}/0 npm/? node/v24` },
    })
    assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`)
    assert.ok(!created.stderr.includes('Not installed'), created.stderr)
    assert.match(created.stdout, new RegExp(`\\n  ${manager} run dev   # the tenant app`))
    assert.equal(created.stdout.includes(`from apps/asas-platform: ${manager} run dev`), platform)
    assert.equal(created.stdout.includes('The package is named asas'), single)
    const features = single ? [] : readdirSync(join(consumer, 'packages/features')).map((one) => `packages/features/${one}`)
    const workspaces = single ? [''] : ['packages/mithaq', ...features, 'packages/asas', 'apps/asas-tanstack', ...(platform ? ['apps/asas-platform'] : [])]
    assert.deepEqual(['templates', 'packages', 'apps/asas-platform'].filter((folder) => existsSync(join(consumer, folder))), single ? [] : platform ? ['packages', 'apps/asas-platform'] : ['packages'])
    // Each package that draws or ejects a piece names mithaq-admin; one that holds only kayan or the auth setup's server side need not.
    const drawing = workspaces.filter((workspace) => (JSON.parse(readFileSync(join(consumer, workspace, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies?.['mithaq-admin'] !== undefined)
    assert.ok(['packages/mithaq', 'packages/asas', 'apps/asas-tanstack'].every((one) => single || drawing.includes(one)), `${drawing.join(', ')} name mithaq-admin`)
    for (const workspace of workspaces) {
      const manifest = JSON.parse(readFileSync(join(consumer, workspace, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      if (drawing.includes(workspace)) assert.equal(manifest.dependencies?.['mithaq-admin'], adminTarball, `${workspace} pins mithaq-admin`)
      assert.ok(!existsSync(join(consumer, workspace, 'src/asas.test.ts')) && !existsSync(join(consumer, workspace, 'src/test-database.ts')), `${workspace} has no tests`)
    }
    const app = single ? consumer : join(consumer, 'apps/asas-tanstack')
    const platformApp = join(consumer, 'apps/asas-platform')
    const mithaq = realpathSync(installed(app, 'mithaq'))
    assert.ok(mithaq.startsWith(join(realpathSync(consumer), 'node_modules')), `mithaq resolves to the installed tarball, not ${mithaq}`)
    assert.equal((JSON.parse(readFileSync(join(mithaq, 'package.json'), 'utf8')) as { name: string }).name, '@drhomet/mithaq')
    const admin = realpathSync(installed(app, 'mithaq-admin'))
    assert.equal((JSON.parse(readFileSync(join(admin, 'package.json'), 'utf8')) as { name: string }).name, '@drhomet/mithaq-admin')
    assert.ok(!existsSync(join(app, 'src/components/mithaq')), 'the app holds no piece: each is drawn from the package')
    // A manager that cannot hoist a package installs it again under each workspace, and a second mithaq is a second language.
    for (const workspace of workspaces) assert.equal(realpathSync(installed(join(consumer, workspace), 'mithaq')), mithaq, `${workspace} loads the one mithaq`)
    // A second mithaq-admin is a second components map, so the template's shells and the app must draw from one.
    for (const workspace of drawing) assert.equal(realpathSync(installed(join(consumer, workspace), 'mithaq-admin')), admin, `${workspace} loads the one mithaq-admin`)
    // The asas, where every mithaq command runs, and the language, which holds the files a project keeps from mithaq-admin.
    const template = single ? consumer : join(consumer, 'packages/asas')
    const language = single ? consumer : join(consumer, 'packages/mithaq')
    // The files each workspace always holds (the host, the icon, the storage adapters and the step) are read against the
    // installed mithaq-admin and must be up to date; with no package there the check answers undefined and this fails.
    for (const [workspace, files] of single ? [[consumer, 19]] as const : [[app, 13], ...(platform ? [[platformApp, 12]] as const : []), [language, 6]] as const) {
      installed(workspace, '.bin/mithaq')
      const check = spawnSync(process.execPath, ['--input-type=module', '-e', "import { pathToFileURL } from 'node:url'; import { upgradeCheck } from 'mithaq/upgrade'; console.log(JSON.stringify(await upgradeCheck(pathToFileURL(`${process.cwd()}/`))))"], { cwd: workspace, encoding: 'utf8' })
      assert.equal(check.status, 0, check.stderr)
      const states = JSON.parse(check.stdout) as { path: string; state: string }[] | null
      assert.equal(states?.length, files, `${workspace} reads every file it holds against the installed mithaq-admin:\n${check.stdout}`)
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
    // Each workspace names its own `typescript` (`apps/pack.ts`), so the root has no `tsc` where a manager installs isolated.
    const tsc = installed(template, '.bin/tsc')
    // An ejected piece is drawn in place of the package's by every importer, the package's own pieces among them, in
    // whatever layout the manager installed: the type check reads it through `paths` and the build through `mithaq/vite`.
    command(installed(app, '.bin/mithaq'), ['eject', 'nav-links'], app)
    const ejected = join(app, 'src/components/mithaq/nav-links.tsx')
    writeFileSync(ejected, `${readFileSync(ejected, 'utf8')}(globalThis as { ejectedProbe?: string }).ejectedProbe = 'mithaq-ejected-probe'\n`)
    for (const project of single ? ['.'] : ['apps/asas-tanstack', ...(platform ? ['apps/asas-platform'] : []), '.']) command(tsc, ['-p', project], consumer)
    // The database as a deploy leaves it: emptied, then migrated with the `drizzle-kit` the installed `mithaq` resolves.
    // Node runs the rest: the project's `.ts` lies outside `node_modules`, where Node strips types.
    command(process.execPath, ['--input-type=module', '-e', "import { asas } from './src/asas.ts'; await asas.targets.drizzle.db.execute('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;'); await asas.destroy()"], template)
    const drizzleKit = createRequire(join(mithaq, 'package.json')).resolve('drizzle-kit')
    command(process.execPath, [join(dirname(drizzleKit), 'bin.cjs'), 'migrate', '--config', 'src/migrations/drizzle.config.ts'], template)
    command(installed(template, '.bin/mithaq'), ['lock', '--check'], template)
    // Without `--bun`, each program the build script runs starts under the `node` its shebang names.
    command(manager, ['run', 'build'], app)
    const client = join(app, 'dist/client')
    assert.ok(readdirSync(client, { recursive: true, encoding: 'utf8' }).some((file) => file.endsWith('.js') && readFileSync(join(client, file), 'utf8').includes('mithaq-ejected-probe')), 'the build draws the ejected nav-links.tsx')
    if (platform) command(manager, ['run', 'build'], platformApp)

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
    const { BETTER_AUTH_SECRET: _secret, AUTH_SECRET: _fallback, PLATFORM_URL: _platform, ...withoutAuthSecret } = process.env
    const start = (cwd: string, at: number) => {
      const child = spawn(process.execPath, [join(installed(cwd, 'vite'), 'bin/vite.js'), 'preview', '--port', String(at), '--host', '127.0.0.1', '--strictPort'], {
        cwd,
        // A production boot needs these settings, PLATFORM_URL only where a platform app is served. `BETTER_AUTH_SECRET` is
        // left out on purpose: each app answering proves it read the `.env` `create-mithaq` wrote, which TanStack Start
        // loads into `process.env`, a variable already set winning.
        env: { ...withoutAuthSecret, NODE_ENV: 'production', BETTER_AUTH_URL: origin, ...(platform && { PLATFORM_URL: platformOrigin }), STORAGE_SECRET: 'mithaq-release-consumer-storage-secret-32', STORAGE_PREFIX: 'mithaq/asas', STORAGE_ADAPTER: 'local', STORAGE_DIR: join(consumer, '.storage') },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      servers.push(child)
      child.stdout?.on('data', (chunk: Buffer) => { output += chunk })
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk })
      return child
    }
    // `vite preview` because the build writes a fetch handler and no server; spawned as Node on Vite's own entry,
    // not through `bun run`, so `kill()` reaches the process that holds the port.
    for (const [at, child] of [[origin, start(app, port)], ...(platform ? [[platformOrigin, start(platformApp, platformPort)]] as const : [])] as const) {
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

    // Only the platform app makes a first administrator, so a project without one has no way to.
    const tenantFirst = await fetch(`${origin}/api/auth/user/first-register`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}', signal: AbortSignal.timeout(10_000) })
    assert.equal(tenantFirst.status, 404, 'the tenant app serves no first-register')
    if (platform) {
      // The `.env` `create-mithaq` wrote leaves SETUP_CODE empty, and a production platform says to set it.
      const page = await (await fetch(`${platformOrigin}/auth/create-first-user`, { signal: AbortSignal.timeout(10_000) })).text()
      assert.ok(page.includes('SETUP_CODE is unset or shorter than 32 characters'), `the first-administrator page asks for SETUP_CODE:\n${page.slice(0, 600)}`)
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
    command(installed(template, '.bin/mithaq'), ['generate', '--check'], template)
    console.log(`release consumer passed: ${name}`)
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
  }
}
