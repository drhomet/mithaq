// Run with DATABASE_URL set to a dedicated local PostgreSQL database named mithaq, which this check writes to.
// It proves what the boot tests do not: the staged packages (`apps/pack.ts`) make a project the way `bun create mithaq` and
// `npm create mithaq` do, with `mithaq` and `mithaq-admin` installed from the packed tarballs and no framework source; each
// consumer typechecks, migrates, builds its apps, boots each under Node, answers a signed-in request, seeds and passes
// `mithaq generate --check`: a monorepo with every add-on with Bun, a minimal one (auth and the tags example) with npm,
// which writes its own first migration and boots with no BACKOFFICE_URL, a single package with every add-on it can hold,
// and a monorepo with settings, rich text, media without courses and the backoffice console but no roles, whose staff hold their keys through
// Better Auth's member roles' access target as they do through the roles add-on's. A full project speaks the frozen
// vocabulary, and every other one that vocabulary less the words its missing add-ons bring. A project with no rich text,
// `mithaq` alone with npm, proves no Lexical is installed with it.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { testDatabase } from '../templates/asas/src/test-database.ts'
import { base, storage } from '../packages/mithaq/src/index.ts'
import { richText } from '../packages/mithaq/src/rich-text/index.ts'
import { vocabularyOf } from '../packages/mithaq/src/mithaq/lock.ts'
import { richTextNodes } from '../templates/mithaq/src/mithaq/rich-text-nodes.ts'
import { storageConfig } from '../templates/mithaq/src/storage/index.ts'

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

/** The vocabulary the language `folder` runs its commands from speaks, read through the mithaq whose files are under `source`. */
const vocabularyIn = ({ folder, source, extension }: { folder: string; source: string; extension: string }) => {
  const script = [
    `const { receivedLanguage } = await import(${JSON.stringify(pathToFileURL(join(source, `mithaq/language${extension}`)).href)})`,
    `const { vocabularyOf } = await import(${JSON.stringify(pathToFileURL(join(source, `mithaq/lock${extension}`)).href)})`,
    "const { defineKayan } = await import('./src/mithaq.ts')",
    'console.log(JSON.stringify(vocabularyOf(receivedLanguage(defineKayan))))',
  ].join('\n')
  const read = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: folder, encoding: 'utf8' })
  assert.equal(read.status, 0, read.stderr)
  return read.stdout.trim().split('\n').at(-1)
}
// The template's, which holds every add-on and so every word, frozen until the owner signs a change.
const vocabulary = vocabularyIn({ folder: join(root, 'templates/asas'), source: join(root, 'packages/mithaq/src'), extension: '.ts' })
assert.equal(createHash('sha256').update(vocabulary!).digest('hex'), 'bbea29bc3551d376f822fb2b5cdd1161a13c7043603ab8f23de652b9ba35bd21', 'the template speaks the frozen vocabulary')
type Words = Record<'kinds' | 'rules' | 'targets', Record<string, unknown>>
const bare = vocabularyOf({ arkan: [base] }) as Words
/** The words each add-on that brings any adds to the language: its rukn's kinds, rules and targets beyond `base`'s. */
const wordsOf = Object.fromEntries(Object.entries({ 'rich-text': richText({ nodes: richTextNodes }), uploads: storage(storageConfig) }).map(([name, rukn]) => {
  const own = vocabularyOf({ arkan: [base, rukn] }) as Words
  return [name, (['kinds', 'rules', 'targets'] as const).flatMap((part) => Object.keys(own[part]).filter((key) => !Object.hasOwn(bare[part], key)).map((key) => [part, key] as const))]
}))
/** The template's vocabulary less the words of each add-on a project left out. */
const vocabularyWithout = (missing: readonly string[]) => {
  const words = JSON.parse(vocabulary!) as Words
  for (const [part, key] of missing.flatMap((name) => wordsOf[name] ?? [])) delete words[part][key]
  return words
}
const scratch = mkdtempSync(join(tmpdir(), 'mithaq-release-'))
/**
 * Every message a consumer mails, caught on this machine: a production start needs a mailer, and the project's Resend
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
}).listen(0, '127.0.0.1')
await once(mailbox, 'listening')
/** The link last mailed to `email`, waited for briefly: an app mails after it answers. */
const linkMailed = async (email: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const link = /https?:\/\/\S+/.exec(mailed.filter((one) => one.to.includes(email)).at(-1)?.text ?? '')?.[0]
    if (link) return new URL(link)
    await sleep(50)
  }
  assert.fail(`no link was mailed to ${email}`)
}
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
  // Each organization mode once: the worked example as created, one organization by invitation; many, which founds
  // by sign-up; one never shown, with an open sign-up, which a production start refuses without a mailer.
  for (const run of [
    { manager: 'bun', addOns: ['--full'], modes: [] },
    { manager: 'npm', addOns: [], modes: ['--organizations', 'many'] },
    { manager: 'bun', layout: 'single', addOns: ['--full'], modes: ['--organizations', 'one', '--show-organization', 'no', '--sign-up', 'open'] },
    { manager: 'bun', addOns: ['--with', 'settings,backoffice,rich-text,media'], modes: ['--organizations', 'many'] },
  ]) await release({ tarball, adminTarball, ...run })
  console.log('release consumer passed')
} finally {
  mailbox.close()
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

async function release({ manager, tarball, adminTarball, layout = 'monorepo', addOns, modes }: { manager: string; tarball: string; adminTarball: string; layout?: string; addOns: string[]; modes: string[] }) {
  const single = layout === 'single'
  const many = modes.includes('many')
  const open = modes.includes('open')
  const full = addOns.includes('--full')
  // `--full` holds the backoffice console where the layout can.
  const backoffice = !single && (full || addOns.some((one) => /(^|,)backoffice(,|$)/.test(one)))
  const name = `${manager}-${layout}-${full ? 'full' : addOns.length ? 'pick' : 'minimal'}`
  const consumer = join(scratch, name)
  const servers: ReturnType<typeof spawn>[] = []
  let output = ''
  try {
    // The project as `<manager> create mithaq` makes it, with `mithaq` and `mithaq-admin` pointed at the tarballs through flags
    // only this check passes, so neither is fetched from npm.
    const created = spawnSync(process.execPath, [join(root, '.pack/create-mithaq/index.js'), name, '--layout', layout, ...addOns, ...modes, '--mithaq', tarball, '--mithaq-admin', adminTarball], {
      cwd: scratch,
      encoding: 'utf8',
      timeout: 600_000,
      env: { ...process.env, npm_config_user_agent: `${manager}/0 npm/? node/v24` },
    })
    assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`)
    assert.ok(!created.stderr.includes('Not installed'), created.stderr)
    assert.ok(!created.stderr.includes('The screens are not written'), created.stderr)
    const chosen = /^Created .*?, (?:with (.+)|minimal)\.$/m.exec(created.stdout)?.[1]?.split(', ') ?? []
    assert.match(created.stdout, new RegExp(`\\n  ${manager} run dev   # the tenant app`))
    assert.match(created.stdout, new RegExp(`\\n  ${manager} run dev:setup${manager === 'npm' ? ' --' : ''} --seed\\n`))
    assert.equal(created.stdout.includes(`from apps/asas-backoffice: ${manager} run dev`), backoffice)
    assert.equal(created.stdout.includes('The package is named asas'), single)
    const features = single ? [] : readdirSync(join(consumer, 'packages/features')).map((one) => `packages/features/${one}`)
    const workspaces = single ? [''] : ['packages/mithaq', ...features, 'packages/asas', 'apps/asas-tanstack', ...(backoffice ? ['apps/asas-backoffice'] : [])]
    assert.deepEqual(['templates', 'packages', 'apps/asas-backoffice'].filter((folder) => existsSync(join(consumer, folder))), single ? [] : backoffice ? ['packages', 'apps/asas-backoffice'] : ['packages'])
    // Each package that draws or ejects a piece names mithaq-admin; one that holds only kayan or the auth setup's server side need not.
    const drawing = workspaces.filter((workspace) => (JSON.parse(readFileSync(join(consumer, workspace, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies?.['mithaq-admin'] !== undefined)
    assert.ok(['packages/mithaq', 'packages/asas', 'apps/asas-tanstack'].every((one) => single || drawing.includes(one)), `${drawing.join(', ')} name mithaq-admin`)
    for (const workspace of workspaces) {
      const manifest = JSON.parse(readFileSync(join(consumer, workspace, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      if (drawing.includes(workspace)) assert.equal(manifest.dependencies?.['mithaq-admin'], adminTarball, `${workspace} pins mithaq-admin`)
      assert.ok(!existsSync(join(consumer, workspace, 'src/asas.test.ts')) && !existsSync(join(consumer, workspace, 'src/test-database.ts')), `${workspace} has no tests`)
    }
    const app = single ? consumer : join(consumer, 'apps/asas-tanstack')
    const backofficeApp = join(consumer, 'apps/asas-backoffice')
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
    // The storage adapters and their defaults come with uploads; the step and the mailers are every project's.
    const held = chosen.includes('uploads') ? 7 : 2
    for (const [workspace, files] of single ? [[consumer, 13 + held]] as const : [[app, 13], ...(backoffice ? [[backofficeApp, 12]] as const : []), [language, held]] as const) {
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
    for (const project of single ? ['.'] : ['apps/asas-tanstack', ...(backoffice ? ['apps/asas-backoffice'] : []), '.']) command(tsc, ['-p', project], consumer)
    // The database as a deploy leaves it: emptied, then migrated with the `drizzle-kit` the installed `mithaq` resolves.
    // Node runs the rest: the project's `.ts` lies outside `node_modules`, where Node strips types.
    command(process.execPath, ['--input-type=module', '-e', "import { asas } from './src/asas.ts'; await asas.targets.drizzle.db.execute('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;'); await asas.destroy()"], template)
    // The template's migrations build every table, so a project short of an add-on writes its own first one, as a new
    // project does before it first deploys.
    const migrations = join(template, 'src/migrations')
    assert.equal(readdirSync(migrations).length > 1, full, `${name} ships the template's migrations only when it holds every add-on with tables`)
    if (readdirSync(migrations).length === 1) command(installed(template, '.bin/mithaq'), ['migrate', '--name', 'init'], template)
    const drizzleKit = createRequire(join(mithaq, 'package.json')).resolve('drizzle-kit')
    command(process.execPath, [join(dirname(drizzleKit), 'bin.cjs'), 'migrate', '--config', 'src/migrations/drizzle.config.ts'], template)
    const spoken = vocabularyIn({ folder: template, source: join(mithaq, 'dist'), extension: '.js' })!
    if (full) assert.equal(spoken, vocabulary, `${name} speaks the frozen vocabulary`)
    const missing = Object.keys(wordsOf).filter((one) => !chosen.includes(one))
    assert.deepEqual(JSON.parse(spoken), vocabularyWithout(missing), `${name} speaks the template's vocabulary less what ${missing.join(' and ') || 'nothing'} would bring`)
    command(installed(template, '.bin/mithaq'), ['lock', '--check'], template)
    // Without `--bun`, each program the build script runs starts under the `node` its shebang names.
    command(manager, ['run', 'build'], app)
    const client = join(app, 'dist/client')
    assert.ok(readdirSync(client, { recursive: true, encoding: 'utf8' }).some((file) => file.endsWith('.js') && readFileSync(join(client, file), 'utf8').includes('mithaq-ejected-probe')), 'the build draws the ejected nav-links.tsx')
    if (backoffice) command(manager, ['run', 'build'], backofficeApp)

    const freePort = async () => {
      const held = createServer().listen(0, '127.0.0.1')
      await once(held, 'listening')
      const { port } = held.address() as { port: number }
      await new Promise((done) => held.close(done))
      return port
    }
    const [port, backofficePort] = [await freePort(), await freePort()]
    const origin = `http://127.0.0.1:${port}`
    const backofficeOrigin = `http://127.0.0.1:${backofficePort}`
    const { BETTER_AUTH_SECRET: _secret, AUTH_SECRET: _fallback, BACKOFFICE_URL: _backoffice, ...withoutAuthSecret } = process.env
    // One organization is set up with the code alone; many leaves it unset, so the backoffice says to set it.
    const setupCode = 'mithaq-release-consumer-setup-code-of-40-chars'
    // A production boot needs these settings, BACKOFFICE_URL only where a backoffice app is served. `BETTER_AUTH_SECRET` is
    // left out on purpose: each app answering proves it read the `.env` `create-mithaq` wrote, which TanStack Start
    // loads into `process.env`, a variable already set winning. Every production start needs a mailer, which mails into
    // this check's own catcher.
    const production: NodeJS.ProcessEnv = {
      ...withoutAuthSecret,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: origin,
      ...(backoffice && { BACKOFFICE_URL: backofficeOrigin }),
      STORAGE_SECRET: 'mithaq-release-consumer-storage-secret-32',
      STORAGE_PREFIX: 'mithaq/asas',
      STORAGE_ADAPTER: 'local',
      STORAGE_DIR: join(consumer, '.storage'),
      ...(!many && { SETUP_CODE: setupCode }),
      RESEND_API_KEY: 're_release_consumer_never_sent',
      MAIL_FROM: 'Release <mail@example.com>',
      RESEND_BASE_URL: `http://127.0.0.1:${(mailbox.address() as { port: number }).port}`,
    }
    {
      const { RESEND_API_KEY: _key, MAIL_FROM: _from, ...unmailed } = production
      const refused = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/mithaq/auth/index.ts')"], { cwd: language, encoding: 'utf8', env: { ...unmailed, BETTER_AUTH_SECRET: 'a-release-consumer-secret' } })
      assert.notEqual(refused.status, 0, `${name}: a production start with no mailer is refused`)
      assert.match(refused.stderr, /needs a mailer in production/, refused.stderr)
    }
    const start = (cwd: string, at: number) => {
      const child = spawn(process.execPath, [join(installed(cwd, 'vite'), 'bin/vite.js'), 'preview', '--port', String(at), '--host', '127.0.0.1', '--strictPort'], {
        cwd,
        env: production,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      servers.push(child)
      child.stdout?.on('data', (chunk: Buffer) => { output += chunk })
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk })
      return child
    }
    // `vite preview` because the build writes a fetch handler and no server; spawned as Node on Vite's own entry,
    // not through `bun run`, so `kill()` reaches the process that holds the port.
    for (const [at, child] of [[origin, start(app, port)], ...(backoffice ? [[backofficeOrigin, start(backofficeApp, backofficePort)]] as const : [])] as const) {
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

    // Only the backoffice app makes a first administrator, so a project without one has no way to.
    const tenantFirst = await fetch(`${origin}/api/auth/user/first-register`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}', signal: AbortSignal.timeout(10_000) })
    assert.equal(tenantFirst.status, 404, 'the tenant app serves no first-register')
    if (backoffice) {
      // The `.env` `create-mithaq` wrote leaves SETUP_CODE empty, and a production backoffice says to set it; set, it asks for it.
      const page = await (await fetch(`${backofficeOrigin}/auth/create-first-user`, { signal: AbortSignal.timeout(10_000) })).text()
      assert.equal(page.includes('SETUP_CODE is unset or shorter than 32 characters'), many, `the first-administrator page says whether SETUP_CODE is set:\n${page.slice(0, 600)}`)
      assert.equal(page.includes('The SETUP_CODE this server was started with.'), !many, 'and asks for it where it is')
    }

    const stamp = randomUUID()
    const post = (path: string, body: unknown, headers: Record<string, string> = {}, at = origin) =>
      fetch(`${at}/api/auth/user/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: at, ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
    const codeOf = async (response: Response) => [response.status, ((await response.json().catch(() => null)) as { code?: string } | null)?.code] as const
    const cookieOf = (response: Response) => response.headers.getSetCookie().map((part) => part.split(';')[0]).join('; ')
    if (!many) {
      // One organization: nothing signs up before its owner is made, and only the setup code makes them.
      const setUp = await (await fetch(`${origin}/auth/first-run`, { signal: AbortSignal.timeout(10_000) })).text()
      assert.ok(setUp.includes('The SETUP_CODE this server was started with.'), `first-run asks for the setup code:\n${setUp.slice(0, 600)}`)
      assert.equal(setUp.includes('id="organization"'), !modes.includes('no'), 'and a name for the organization only where it is shown')
      assert.deepEqual(await codeOf(await post('sign-up/email', { name: 'Early', email: `early-${stamp}@example.com`, password: 'release-test-password' })), [403, 'FIRST_RUN_PENDING'], 'a sign-up before first-run is refused')
      // The takeover race over HTTP: three at once, one owner.
      const runs = await Promise.all([0, 1, 2].map(async (at) => [at, await codeOf(await post('first-run', { name: `Owner ${at}`, email: `owner-${at}-${stamp}@example.com`, password: 'release-test-password', organization: 'Release', code: setupCode }))] as const))
      const won = runs.filter(([, [status]]) => status === 200)
      assert.equal(won.length, 1, `one first-run wins: ${JSON.stringify(runs)}\n${output}`)
      assert.deepEqual(runs.filter(([, [status]]) => status !== 200).map(([, answer]) => answer), [[403, 'FIRST_RUN_CLOSED'], [403, 'FIRST_RUN_CLOSED']])
      const owner = `owner-${won[0]![0]}-${stamp}@example.com`
      const signedIn = await post('sign-in/email', { email: owner, password: 'release-test-password' })
      assert.equal(signedIn.status, 200, `the owner signs in\n${output}`)
      const session = (await (await fetch(`${origin}/api/auth/user/get-session`, { headers: { origin, cookie: cookieOf(signedIn) }, signal: AbortSignal.timeout(10_000) })).json()) as { session?: { activeOrganizationId?: string | null } } | null
      assert.ok(session?.session?.activeOrganizationId, 'into the one organization')
      if (!open) assert.deepEqual(await codeOf(await post('sign-up/email', { name: 'Stranger', email: `stranger-${stamp}@example.com`, password: 'release-test-password' })), [403, 'SIGN_UP_INVITE_ONLY'], 'by invitation, a sign-up with none is refused')
      // The owner adds a person in one request, and the link that chooses the password goes to that person's mailbox.
      const person = `added-${stamp}@example.com`
      const added = await post('organization/add-person', { name: 'Added', email: person }, { cookie: cookieOf(signedIn) })
      assert.equal(added.status, 200, `${await added.text()}\n${output}`)
      const chosen = await post('reset-password', { token: (await linkMailed(person)).searchParams.get('token'), newPassword: 'release-test-password' })
      assert.equal(chosen.status, 200, `the added person chooses their password from the mailed link: ${await chosen.text()}`)
      assert.equal((await post('sign-in/email', { email: person, password: 'release-test-password' })).status, 200, 'and signs in')
      const membersPage = await (await fetch(`${origin}/dashboard/members`, { headers: { cookie: cookieOf(signedIn) }, signal: AbortSignal.timeout(10_000) })).text()
      assert.ok(membersPage.includes('data-add-person'), `the Members page offers Add person:\n${membersPage.slice(0, 600)}`)
      if (backoffice) {
        // First-run made the owner the backoffice's administrator too, since it had none.
        const staff = await post('sign-in/email', { email: owner, password: 'release-test-password' }, {}, backofficeOrigin)
        assert.equal(staff.status, 200, `${await staff.text()}\n${output}`)
        const report = await (await fetch(`${backofficeOrigin}/api/access`, { headers: { origin: backofficeOrigin, cookie: cookieOf(staff) }, signal: AbortSignal.timeout(10_000) })).json() as { canAccessAdmin?: boolean; permissions?: unknown }
        assert.deepEqual([report.canAccessAdmin, report.permissions], [true, '*'], `${name}'s first owner holds every backoffice key: ${JSON.stringify(report).slice(0, 400)}`)
      }
    } else {
      const email = `release-${stamp}@example.com`
      const signUp = await post('sign-up/email', { name: 'Release', email, password: 'typed-at-sign-up' })
      assert.equal(signUp.status, 200, `${await signUp.text()}\n${output}`)
      assert.equal(cookieOf(signUp).includes('session_token'), false, 'the sign-up opens no session before its address is proved')
      const chosen = await post('reset-password', { token: (await linkMailed(email)).searchParams.get('token'), newPassword: 'release-test-password' })
      assert.equal(chosen.status, 200, `the mailed link proves the address: ${await chosen.text()}\n${output}`)
      const signedIn = await post('sign-in/email', { email, password: 'release-test-password' })
      assert.equal(signedIn.status, 200, `${await signedIn.text()}\n${output}`)
      const cookie = cookieOf(signedIn)
      const organization = await post('organization/create', { name: 'Release', slug: `release-${stamp}` }, { cookie })
      assert.equal(organization.status, 200, `${await organization.text()}\n${output}`)
      if (backoffice) {
        // A staff member who belongs to no organization, so the backoffice session has none active: the access target is
        // asked with no tenant, and only the project's role reader answers the backoffice role. Whichever target the
        // project's add-ons chose, staff hold every key there.
        const email = `staff-${stamp}@example.com`
        const joined = await fetch(`${origin}/api/auth/user/sign-up/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({ name: 'Staff', email, password: 'release-test-password' }),
          signal: AbortSignal.timeout(10_000),
        })
        assert.equal(joined.status, 200, `${await joined.text()}\n${output}`)
        command(process.execPath, ['--input-type=module', '-e', `import { asas } from './src/asas.ts'; await asas.targets.drizzle.db.execute("update \\"user\\" set role = 'super_admin' where email = '${email}'"); await asas.destroy()`], template)
        const staff = await fetch(`${backofficeOrigin}/api/auth/user/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: backofficeOrigin },
          body: JSON.stringify({ email, password: 'release-test-password' }),
          signal: AbortSignal.timeout(10_000),
        })
        assert.equal(staff.status, 200, `${await staff.text()}\n${output}`)
        const staffCookie = staff.headers.getSetCookie().map((part) => part.split(';')[0]).join('; ')
        const session = await (await fetch(`${backofficeOrigin}/api/auth/user/get-session`, { headers: { origin: backofficeOrigin, cookie: staffCookie }, signal: AbortSignal.timeout(10_000) })).json() as { session?: { activeOrganizationId?: string | null } } | null
        assert.equal(session?.session?.activeOrganizationId ?? null, null, `the staff session has no organization active: ${JSON.stringify(session).slice(0, 400)}`)
        const report = await (await fetch(`${backofficeOrigin}/api/access`, { headers: { origin: backofficeOrigin, cookie: staffCookie }, signal: AbortSignal.timeout(10_000) })).json() as { canAccessAdmin?: boolean; permissions?: unknown }
        assert.deepEqual([report.canAccessAdmin, report.permissions], [true, '*'], `${name}'s backoffice staff hold every key: ${JSON.stringify(report).slice(0, 400)}`)
      }
    }
    // The sample rows of whatever the project holds, written through its own operations as that organization's owner.
    const seeded = spawnSync(process.execPath, ['src/seed.ts'], { cwd: template, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } })
    assert.equal(seeded.status, 0, `${seeded.stdout}\n${seeded.stderr}`)
    assert.match(seeded.stdout, /"totals":\{"tags":6[,}]/, seeded.stdout)
    if (!many) {
      // A second organization in a project of one: the next production start refuses, naming the mode.
      const sql = (statement: string) => command(process.execPath, ['--input-type=module', '-e', `import { asas } from './src/asas.ts'; await asas.targets.drizzle.db.execute(${JSON.stringify(statement)}); await asas.destroy()`], template)
      sql("insert into organization (id, name, slug, created_at) values ('release-second', 'Second', 'release-second', now())")
      const restarted = spawnSync(process.execPath, ['--env-file=.env', '--input-type=module', '-e', "const { asas } = await import('./src/asas.ts'); await asas.connect(); await asas.destroy()"], { cwd: template, encoding: 'utf8', env: production })
      assert.notEqual(restarted.status, 0, `${name}: a start over two organizations is refused`)
      assert.match(restarted.stderr, /organizations: 'one', and the "organization" table holds more than one/, restarted.stderr)
      sql("delete from organization where id = 'release-second'")
    }
    command(installed(template, '.bin/mithaq'), ['generate', '--check'], template)
    // An empty database of its own, as a fresh clone starts from, set up by the command the next steps name: pushed, the
    // dev admin `.env` names made and its organization seeded. The dev admin then signs in to each app the project serves.
    const fresh = Object.assign(new URL(databaseUrl), { pathname: '/mithaq_dev_setup' }).href
    const recreate = "import { asas } from './src/asas.ts'; await asas.targets.drizzle.db.execute('drop database if exists mithaq_dev_setup with (force)'); await asas.targets.drizzle.db.execute('create database mithaq_dev_setup'); await asas.destroy()"
    command(process.execPath, ['--input-type=module', '-e', recreate], template)
    const setUp = spawnSync(manager, ['run', 'dev:setup', ...(manager === 'npm' ? ['--'] : []), '--seed'], { cwd: template, encoding: 'utf8', timeout: 600_000, env: { ...process.env, DATABASE_URL: fresh } })
    assert.equal(setUp.status, 0, `${setUp.stdout}\n${setUp.stderr}`)
    assert.match(setUp.stdout, /"totals":\{"tags":6[,}]/, setUp.stdout)
    const signIn = [
      "import { asas } from './src/asas.ts'",
      `const { asBackoffice, backofficeApp } = await import('${single ? './src/mithaq/auth/index.ts' : `@${name}/mithaq/auth`}')`,
      "const server = asas.auth.strategies.find((one) => one.name === 'user').server",
      'const body = { email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD }',
      'const tenant = (await server.api.signInEmail({ body, asResponse: true })).status',
      'const backoffice = backofficeApp ? (await asBackoffice(() => server.api.signInEmail({ body, asResponse: true }))).status : null',
      'console.log(JSON.stringify({ tenant, backoffice }))',
      'await asas.destroy()',
    ].join('\n')
    const signedIn = spawnSync(process.execPath, ['--env-file=.env', '--input-type=module', '-e', signIn], { cwd: template, encoding: 'utf8', env: { ...process.env, DATABASE_URL: fresh } })
    assert.equal(signedIn.status, 0, signedIn.stderr)
    assert.deepEqual(JSON.parse(signedIn.stdout.trim().split('\n').at(-1)!), { tenant: 200, backoffice: backoffice ? 200 : null }, `${name}'s dev admin signs in to each app`)
    command(process.execPath, ['--input-type=module', '-e', recreate.replace("; await asas.targets.drizzle.db.execute('create database mithaq_dev_setup')", '')], template)
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
