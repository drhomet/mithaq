// A template folder as staged for publishing: the template's own packages less what each installs or builds, with
// each `.gitignore` staged as `gitignore`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { create, managerOf, updatePackageJSONDependencies } from './index.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'create-mithaq-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const template = join(scratch, 'template')
for (const folder of ['templates/asas', 'templates/auth', 'apps/asas-tanstack', 'apps/asas-platform']) {
  // What `apps/pack.ts` leaves out: what an install or a build writes, and the repository's own tests and their support.
  const staged = (from: string) => !['node_modules', 'dist', '.tanstack', '.env', '.storage'].includes(basename(from)) && !/(\.test\.tsx?|\.probe\.ts|\.smoke\.ts|\.support\.ts|\.fixture\.[^/]+|(^|\/)(test-[^/]*|memory-store|standard-schema-target)\.ts)$/.test(from)
  cpSync(join(root, folder), join(template, folder), { recursive: true, filter: staged })
}
for (const folder of ['apps/asas-tanstack', 'apps/asas-platform']) renameSync(join(template, folder, '.gitignore'), join(template, folder, 'gitignore'))
writeFileSync(join(template, 'package.json'), JSON.stringify({ private: true, type: 'module', engines: { node: '>=24' }, workspaces: ['templates/*', 'apps/*', 'packages/features/*'], devDependencies: { '@types/node': '^24.12.3' } }))
const filesUnder = (folder: string) => readdirSync(folder, { recursive: true, encoding: 'utf8' }).map((file) => join(folder, file))

const read = (...path: string[]) => readFileSync(join(scratch, ...path), 'utf8')
const json = (...path: string[]) => JSON.parse(read(...path))

test('a project takes the published mithaq under the name its imports use, at exactly the version whose registry it reads, and no mithaq-admin', () => {
  create({ name: 'my-app', cwd: scratch, template, version: '1.2.3' })
  for (const workspace of ['templates/asas', 'templates/auth', 'apps/asas-tanstack', 'apps/asas-platform']) {
    const { dependencies, devDependencies = {} } = json('my-app', workspace, 'package.json')
    assert.equal(dependencies.mithaq, 'npm:@drhomet/mithaq@1.2.3', workspace)
    assert.equal(devDependencies['mithaq-admin'], undefined, workspace)
  }
  assert.equal(json('my-app/apps/asas-tanstack/package.json').dependencies.asas, '*')
  assert.equal(json('my-app/apps/asas-platform/package.json').dependencies.asas, '*')
  assert.equal(json('my-app/templates/asas/package.json').dependencies['@asas/auth'], '*')
})

test('a project is a workspace every package manager reads, named for it, with room for feature packages, ignoring its .env', () => {
  const manifest = json('my-app/package.json')
  assert.equal(manifest.name, 'my-app')
  assert.deepEqual(manifest.workspaces, ['templates/*', 'apps/*', 'packages/features/*'])
  assert.equal(manifest.devDependencies['@types/node'], '^24.12.3')
  // pnpm reads its own file, and takes a `"*"` workspace over the registry's `asas` only when told to.
  assert.equal(read('my-app/pnpm-workspace.yaml'), 'packages:\n  - templates/*\n  - apps/*\n  - packages/features/*\nlinkWorkspacePackages: true\npreferWorkspacePackages: true\nallowBuilds:\n  esbuild: true\n')
  assert.ok(!existsSync(join(scratch, 'my-app/bunfig.toml')), 'no installer is required')
  assert.ok(existsSync(join(scratch, 'my-app/packages/features/.gitkeep')))
  assert.equal(json('my-app/templates/asas/package.json').scripts.seed, 'node --env-file-if-exists=.env src/seed.ts', 'run by node, whichever manager runs the script')
  const ignored = read('my-app/.gitignore').split('\n')
  for (const entry of ['node_modules', '.env', 'dist', '.storage/']) assert.ok(ignored.includes(entry), entry)
  assert.ok(existsSync(join(scratch, 'my-app/apps/asas-tanstack/.gitignore')))
  assert.ok(!existsSync(join(scratch, 'my-app/apps/asas-tanstack/gitignore')))
  assert.deepEqual(json('my-app/tsconfig.json').include, ['templates/*/src/**/*.ts', 'apps/*/src/**/*.ts'])
})

test('the template and both apps get the same .env, with fresh secrets only their owner can read', () => {
  const env = read('my-app/templates/asas/.env')
  // One BETTER_AUTH_SECRET across the two apps, since each signs the sessions the other reads.
  for (const app of ['apps/asas-tanstack', 'apps/asas-platform']) {
    assert.equal(read('my-app', app, '.env'), env, app)
    assert.equal(statSync(join(scratch, 'my-app', app, '.env')).mode & 0o777, 0o600, app)
  }
  assert.match(env, /^DATABASE_URL=postgres:\/\/postgres:postgres@localhost:5432\/mithaq$/m)
  assert.match(env, /^LOCAL_AUTH_SECRET=[0-9a-f]{64}$/m)
  assert.match(env, /^BETTER_AUTH_SECRET=[0-9a-f]{64}$/m)
  assert.match(env, /^# STORAGE_SECRET=$/m)
  assert.equal(statSync(join(scratch, 'my-app/templates/asas/.env')).mode & 0o777, 0o600)
  create({ name: 'other-app', cwd: scratch, template, version: '1.2.3', mithaq: 'file:/tmp/mithaq.tgz' })
  const secret = /^LOCAL_AUTH_SECRET=(.*)$/m
  assert.notEqual(secret.exec(read('other-app/templates/asas/.env'))![1], secret.exec(env)![1])
  assert.equal(json('other-app/apps/asas-tanstack/package.json').dependencies.mithaq, 'file:/tmp/mithaq.tgz')
})

test('each components.json declares the @mithaq registry at the version the project installs', () => {
  for (const workspace of ['templates/asas', 'apps/asas-tanstack', 'apps/asas-platform']) {
    assert.equal(json('my-app', workspace, 'components.json').registries['@mithaq'], 'https://cdn.jsdelivr.net/npm/@drhomet/mithaq@1.2.3/r/{name}.json', workspace)
  }
})

test('a name that is no package name, or a folder already holding files, is refused before anything is written', () => {
  for (const name of ['', '../escape', 'My App', 'a/b', '.hidden']) {
    assert.throws(() => create({ name, cwd: scratch, template, version: '1.2.3' }), /is not a valid project name/, name)
  }
  assert.ok(!existsSync(join(scratch, 'escape')))
  mkdirSync(join(scratch, 'taken'))
  writeFileSync(join(scratch, 'taken/keep.txt'), 'mine')
  assert.throws(() => create({ name: 'taken', cwd: scratch, template, version: '1.2.3' }), /already exists and is not empty/)
  assert.equal(read('taken/keep.txt'), 'mine')
})

test('the package manager is read from the user agent each of the four sets, and any other is none of them', () => {
  assert.equal(managerOf('npm/11.10.0 node/v24.13.1 darwin arm64 workspaces/false'), 'npm')
  assert.equal(managerOf('pnpm/10.15.0 npm/? node/v24.13.1 darwin arm64'), 'pnpm')
  assert.equal(managerOf('yarn/1.22.22 npm/? node/v24.13.1 darwin arm64'), 'yarn')
  assert.equal(managerOf('bun/1.3.14 npm/? node/v24.13.1 darwin arm64'), 'bun')
  assert.equal(managerOf('cnpm/9.0.0 node/v24.13.1'), undefined)
  assert.equal(managerOf(undefined), undefined)
})

test('without the platform console, its app and its .env are left out, and generate.screens says no app serves its screen', () => {
  create({ name: 'tenant-only', cwd: scratch, template, version: '1.2.3', platform: false })
  assert.ok(!existsSync(join(scratch, 'tenant-only/apps/asas-platform')))
  assert.ok(existsSync(join(scratch, 'tenant-only/apps/asas-tanstack/.env')))
  assert.match(read('tenant-only/templates/asas/src/mithaq.ts'), /^      platform: false,$/m)
  assert.doesNotMatch(read('tenant-only/templates/asas/src/mithaq.ts'), /apps\/asas-platform\/src/)
  assert.match(read('tenant-only/templates/auth/src/index.ts'), /^export const platformApp: boolean = false$/m, 'the provider asks for no PLATFORM_URL and links nobody to a platform')
})

test('a single package holds the language, the kayan, its auth and the tenant app, reaching itself by the name asas', () => {
  create({ name: 'one', cwd: scratch, template, version: '1.2.3', layout: 'single', platform: false })
  const at = join(scratch, 'one')
  assert.deepEqual(readdirSync(at).sort(), ['.env', '.env.example', '.gitignore', 'components.json', 'mithaq.hints.json', 'package.json', 'pnpm-workspace.yaml', 'public', 'src', 'tsconfig.json', 'vite.config.ts'])
  const manifest = json('one/package.json')
  assert.equal(manifest.name, 'asas', 'the registry copies import the language as asas')
  assert.equal(manifest.workspaces, undefined)
  assert.equal(read('one/pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n', 'pnpm\'s settings, and no workspace')
  assert.equal(manifest.exports['.'], './src/asas.ts')
  assert.equal(manifest.exports['./auth'], './src/auth/index.ts')
  assert.equal(manifest.exports['./auth/platform-roles'], './src/auth/platform-roles.ts')
  assert.equal(manifest.scripts.build, 'mithaq lock --check && vite build')
  assert.equal(manifest.scripts.seed, 'node --env-file-if-exists=.env src/seed.ts')
  assert.equal(manifest.dependencies.mithaq, 'npm:@drhomet/mithaq@1.2.3')
  for (const name of ['react', 'better-auth', '@tanstack/react-start', 'drizzle-orm']) assert.ok(manifest.dependencies[name], name)
  for (const name of ['asas', '@asas/auth']) assert.equal(manifest.dependencies[name], undefined, name)
  assert.equal(manifest.devDependencies.vite, json('template/apps/asas-tanstack/package.json').devDependencies.vite)
  assert.equal(manifest.devDependencies['mithaq-admin'], undefined)
  for (const name of ['typescript', '@types/node']) assert.ok(manifest.devDependencies[name], name)
  for (const file of ['src/asas.ts', 'src/mithaq.ts', 'src/auth/index.ts', 'src/auth/platform-roles.ts', 'src/screens.tsx', 'src/routes/__root.tsx', 'src/ui/app-shell.tsx', 'public/favicon.svg']) assert.ok(existsSync(join(at, file)), file)
  const sources = filesUnder(join(at, 'src')).filter((file) => /\.(tsx?|json|css)$/.test(file))
  assert.deepEqual(sources.filter((file) => /@asas\/auth|templates\/asas|apps\/asas/.test(readFileSync(file, 'utf8').replaceAll(/^\s*(\/\/|\*).*$/gm, ''))).map((file) => file.slice(at.length)), [], 'no path or name of the monorepo is left')
  assert.match(read('one/src/auth/index.ts'), /^export const platformApp: boolean = false$/m)
  assert.match(read('one/src/mithaq.ts'), /dashboard: 'src\/routes\/\(screens\)\/',\n      portal: 'src\/routes\/\(screens\)\/',\n      platform: false,/)
  assert.match(read('one/src/routes/(screens)/portal/files.ts'), /\], \{ base: '\/' \}\)\n/, 'off Vite\'s root, the project\'s own')
  assert.match(read('one/src/styles.css'), /\(`src\/ui\/app-shell\.tsx`\)\. \*\/\n@source '\.\/';\n/)
  assert.doesNotMatch(read('one/tsconfig.json'), /\.\.\//)
  assert.equal(statSync(join(at, '.env')).mode & 0o777, 0o600)
  assert.throws(() => create({ name: 'two', cwd: scratch, template, version: '1.2.3', layout: 'single', platform: true }), /single package serves the tenant app alone/)
  assert.throws(() => create({ name: 'three', cwd: scratch, template, version: '1.2.3', layout: 'mono' }), /monorepo or single, not "mono"/)
})

test('--help prints each question\'s flag', () => {
  const done = spawnSync(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url)), '--help'], { encoding: 'utf8' })
  assert.equal(done.status, 0, done.stderr)
  for (const flag of ['--layout monorepo', '--layout single', '--platform', '--no-platform']) assert.ok(done.stdout.includes(flag), flag)
})

test('a dependency left pointing into the framework repository is refused, whatever the key', () => {
  for (const [key, spec] of [['other', 'workspace:*'], ['tool', 'link:../tool'], ['local', 'file:../local.tgz']] as const) {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const packageJson = { dependencies: { mithaq: '*' }, [field]: { mithaq: '*', [key]: spec } }
      assert.throws(() => updatePackageJSONDependencies({ mithaq: 'npm:@drhomet/mithaq@1.2.3', packageJson }), new RegExp(`${key}.*${spec}`), `${field} ${spec}`)
    }
  }
  const packageJson = { dependencies: { mithaq: '*', asas: '*' }, devDependencies: { 'mithaq-admin': 'link:mithaq-admin' } }
  updatePackageJSONDependencies({ mithaq: 'file:/tmp/mithaq.tgz', packageJson })
  assert.deepEqual(packageJson, { dependencies: { mithaq: 'file:/tmp/mithaq.tgz', asas: '*' }, devDependencies: {} })
})
