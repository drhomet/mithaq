// A template folder as staged for publishing: the template's own packages less what each installs or builds, with
// each `.gitignore` staged as `gitignore`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { addOns, create, exportsPath, keepAddOns, managerOf, resolveAddOns, updatePackageJSONDependencies } from './index.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'create-mithaq-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const template = join(scratch, 'template')
for (const folder of ['templates/mithaq', 'templates/features', 'templates/asas', 'apps/asas-tanstack', 'apps/asas-backoffice']) {
  // What `apps/pack.ts` leaves out: what an install or a build writes, and the repository's own tests and their support.
  const staged = (from: string) => !['node_modules', 'dist', '.tanstack', '.env', '.storage'].includes(basename(from)) && !/(\.test\.tsx?|\.probe\.ts|\.smoke\.ts|\.support\.ts|\.fixture\.[^/]+|(^|\/)(test-[^/]*|memory-store|standard-schema-target)\.ts)$/.test(from)
  cpSync(join(root, folder), join(template, folder), { recursive: true, filter: staged })
}
for (const folder of ['apps/asas-tanstack', 'apps/asas-backoffice']) renameSync(join(template, folder, '.gitignore'), join(template, folder, 'gitignore'))
writeFileSync(join(template, 'package.json'), JSON.stringify({ private: true, type: 'module', engines: { node: '>=24' }, workspaces: ['packages/mithaq', 'packages/features/*', 'packages/asas', 'apps/*'], devDependencies: { '@types/node': '^24.12.3' } }))
const filesUnder = (folder: string) => readdirSync(folder, { recursive: true, encoding: 'utf8' }).map((file) => join(folder, file))

const every = Object.keys(addOns)
const read = (...path: string[]) => readFileSync(join(scratch, ...path), 'utf8')
const json = (...path: string[]) => JSON.parse(read(...path))

test('each add-on removes only copy keys that the template holds', () => {
  const copy = JSON.parse(readFileSync(join(template, 'templates/asas/src/messages/mithaq.json'), 'utf8'))
  for (const [name, { copy: keys }] of Object.entries(addOns)) for (const key of keys) {
    assert.notEqual(key.split('.').reduce((branch, part) => branch?.[part], copy), undefined, `${name}: ${key}`)
  }
})

test('a project takes the published mithaq and mithaq-admin under the names its imports use, at exactly one version', () => {
  create({ name: 'my-app', cwd: scratch, template, version: '1.2.3', addOns: every })
  const features = readdirSync(join(scratch, 'my-app/packages/features')).map((one) => `packages/features/${one}`)
  assert.deepEqual(features, ['audit-log', 'auth', 'courses', 'media', 'rich-text-comments', 'roles', 'settings', 'tags'].map((one) => `packages/features/${one}`))
  for (const workspace of ['packages/mithaq', 'packages/asas', ...features, 'apps/asas-tanstack', 'apps/asas-backoffice']) {
    const { dependencies, devDependencies = {} } = json('my-app', workspace, 'package.json')
    assert.equal(dependencies.mithaq, 'npm:@drhomet/mithaq@1.2.3', workspace)
    assert.equal(devDependencies['mithaq-admin'], undefined, workspace)
    if ('mithaq-admin' in dependencies) assert.equal(dependencies['mithaq-admin'], 'npm:@drhomet/mithaq-admin@1.2.3', workspace)
  }
  assert.equal(json('my-app/apps/asas-tanstack/package.json').dependencies.asas, '*')
  assert.equal(json('my-app/apps/asas-backoffice/package.json').dependencies.asas, '*')
  // The project's own scope, on its packages and every import of one.
  assert.equal(json('my-app/packages/mithaq/package.json').name, '@my-app/mithaq')
  assert.equal(json('my-app/packages/features/courses/package.json').name, '@my-app/courses')
  for (const name of ['mithaq', 'auth', 'courses']) assert.equal(json('my-app/packages/asas/package.json').dependencies[`@my-app/${name}`], '*', name)
  assert.match(read('my-app/packages/asas/src/asas.ts'), /from '@my-app\/courses'/)
  assert.match(read('my-app/packages/mithaq/src/mithaq.ts'), /language: '@my-app\/mithaq',\n/)
  const sources = filesUnder(join(scratch, 'my-app')).filter((file) => /\.(tsx?|json|css)$/.test(file))
  assert.deepEqual(sources.filter((file) => /@asas\/|\.\.\/templates\b/.test(readFileSync(file, 'utf8'))).map((file) => file.slice(join(scratch, 'my-app').length)), [], 'no scope or folder of the mithaq repository is left')
})

test('a project is a workspace every package manager reads, named for it, of the language, its features, the asas and the apps, ignoring its .env', () => {
  const manifest = json('my-app/package.json')
  assert.equal(manifest.name, 'my-app')
  assert.deepEqual(manifest.workspaces, ['packages/mithaq', 'packages/features/*', 'packages/asas', 'apps/*'])
  assert.equal(manifest.devDependencies['@types/node'], '^24.12.3')
  // pnpm reads its own file, and takes a `"*"` workspace over the registry's `asas` only when told to.
  assert.equal(read('my-app/pnpm-workspace.yaml'), 'packages:\n  - packages/mithaq\n  - packages/features/*\n  - packages/asas\n  - apps/*\nlinkWorkspacePackages: true\npreferWorkspacePackages: true\nonlyBuiltDependencies:\n  - esbuild\nallowBuilds:\n  esbuild: true\n')
  assert.equal(read('my-app/.yarnrc.yml'), 'nodeLinker: node-modules\n', 'Yarn 2 and later lay out node_modules, not Plug\'n\'Play')
  assert.ok(!existsSync(join(scratch, 'my-app/bunfig.toml')), 'no installer is required')
  for (const [script, file] of [['seed', 'seed'], ['dev:setup', 'dev-setup']]) assert.equal(json('my-app/packages/asas/package.json').scripts[script], `node --env-file-if-exists=.env src/${file}.ts`, 'run by node, whichever manager runs the script')
  assert.match(read('my-app/packages/asas/.env'), /^DEV_ADMIN_EMAIL=admin@example\.com\nDEV_ADMIN_PASSWORD=dev-admin-password$/m, 'the dev admin dev:setup makes')
  const ignored = read('my-app/.gitignore').split('\n')
  for (const entry of ['node_modules', '.env', 'dist', '.storage/']) assert.ok(ignored.includes(entry), entry)
  assert.ok(existsSync(join(scratch, 'my-app/apps/asas-tanstack/.gitignore')))
  assert.ok(!existsSync(join(scratch, 'my-app/apps/asas-tanstack/gitignore')))
  assert.deepEqual(json('my-app/tsconfig.json').include, ['packages/*/src/**/*.ts', 'packages/features/**/*.ts', 'apps/*/src/**/*.ts'])
  assert.deepEqual(json('my-app/tsconfig.json').exclude, ['apps/*/src/server.ts', 'apps/*/src/components.ts'], 'the server entries and the components maps are checked by each app\'s own config, which reads their .tsx')
})

test('a monorepo holds its guide and agent files at the root, where an agent started there and the repository page read them', () => {
  assert.deepEqual(['AGENTS.md', 'CLAUDE.md', 'README.md'].filter((file) => existsSync(join(scratch, 'my-app', file))), ['AGENTS.md', 'CLAUDE.md', 'README.md'])
  assert.deepEqual(['AGENTS.md', 'CLAUDE.md', 'README.md'].filter((file) => existsSync(join(scratch, 'my-app/packages/asas', file))), [], 'and none is left in packages/asas')
  assert.equal(read('my-app/CLAUDE.md'), '@AGENTS.md\n')
  assert.deepEqual(readdirSync(join(scratch, 'my-app/.claude/skills')).sort(), ['add-field', 'add-kayan', 'eject-admin-piece', 'upgrade-mithaq'], 'the workflow skills, where Claude Code finds them')
  assert.ok(!existsSync(join(scratch, 'my-app/packages/asas/.claude')))
  assert.match(read('my-app/AGENTS.md'), /`README\.md` beside this file/)
  assert.doesNotMatch(read('my-app/README.md'), /<!-- from: /, 'the guide names no file of the mithaq repository its snippets are checked against')
})

test('the template and both apps get the same .env, with fresh secrets only their owner can read', () => {
  const env = read('my-app/packages/asas/.env')
  // One BETTER_AUTH_SECRET across the two apps, since each signs the sessions the other reads.
  for (const app of ['apps/asas-tanstack', 'apps/asas-backoffice']) {
    assert.equal(read('my-app', app, '.env'), env, app)
    assert.equal(statSync(join(scratch, 'my-app', app, '.env')).mode & 0o777, 0o600, app)
  }
  assert.match(env, /^DATABASE_URL=postgres:\/\/postgres:postgres@localhost:5432\/mithaq$/m)
  assert.match(env, /^LOCAL_AUTH_SECRET=[0-9a-f]{64}$/m)
  assert.match(env, /^BETTER_AUTH_SECRET=[0-9a-f]{64}$/m)
  assert.match(env, /^# STORAGE_SECRET=$/m)
  // Left for the owner to choose: a code written here would be one anybody with the repository holds.
  assert.match(env, /^SETUP_CODE=$/m)
  assert.equal(statSync(join(scratch, 'my-app/packages/asas/.env')).mode & 0o777, 0o600)
  create({ name: 'other-app', cwd: scratch, template, version: '1.2.3', mithaq: 'file:/tmp/mithaq.tgz', addOns: every })
  const secret = /^LOCAL_AUTH_SECRET=(.*)$/m
  assert.notEqual(secret.exec(read('other-app/packages/asas/.env'))![1], secret.exec(env)![1])
  assert.equal(json('other-app/apps/asas-tanstack/package.json').dependencies.mithaq, 'file:/tmp/mithaq.tgz')
})

test('each components.json names no @mithaq registry: the pieces come from the installed mithaq-admin, and shadcn adds only primitives', () => {
  for (const workspace of ['packages/mithaq', 'apps/asas-tanstack', 'apps/asas-backoffice']) {
    assert.equal(json('my-app', workspace, 'components.json').registries?.['@mithaq'], undefined, workspace)
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

test('without the backoffice console, its app and its .env are left out, and generate.screens says no app serves its screen', () => {
  create({ name: 'tenant-only', cwd: scratch, template, version: '1.2.3', addOns: every.filter((one) => one !== 'backoffice') })
  assert.ok(!existsSync(join(scratch, 'tenant-only/apps/asas-backoffice')))
  assert.ok(existsSync(join(scratch, 'tenant-only/apps/asas-tanstack/.env')))
  assert.match(read('tenant-only/packages/mithaq/src/mithaq.ts'), /^      backoffice: false,$/m)
  assert.doesNotMatch(read('tenant-only/packages/mithaq/src/mithaq.ts'), /apps\/asas-backoffice\/src/)
  assert.match(read('tenant-only/packages/mithaq/src/mithaq/auth/index.ts'), /^export const backofficeApp: boolean = false$/m, 'the provider asks for no BACKOFFICE_URL and links nobody to a backoffice')
})

test('a single package holds the language, its features, the asas and the tenant app, reaching itself by the name asas and every other part by path', () => {
  create({ name: 'one', cwd: scratch, template, version: '1.2.3', layout: 'single', addOns: every.filter((one) => one !== 'backoffice') })
  const at = join(scratch, 'one')
  assert.deepEqual(readdirSync(at).sort(), ['.claude', '.env', '.env.example', '.gitignore', '.yarnrc.yml', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'components.json', 'mithaq.hints.json', 'package.json', 'pnpm-workspace.yaml', 'public', 'src', 'tsconfig.json', 'vite.config.ts'])
  const manifest = json('one/package.json')
  assert.equal(manifest.name, 'asas', 'the screen host imports the language as asas')
  assert.equal(manifest.workspaces, undefined)
  assert.equal(read('one/pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - esbuild\nallowBuilds:\n  esbuild: true\n', 'pnpm\'s settings, and no workspace')
  assert.equal(manifest.exports['.'], './src/asas.ts')
  assert.equal(manifest.scripts.build, 'mithaq lock --check && vite build')
  assert.equal(manifest.scripts.seed, 'node --env-file-if-exists=.env src/seed.ts')
  assert.equal(manifest.scripts['dev:setup'], 'node --env-file-if-exists=.env src/dev-setup.ts')
  assert.equal(manifest.dependencies.mithaq, 'npm:@drhomet/mithaq@1.2.3')
  for (const name of ['react', 'better-auth', '@tanstack/react-start', 'drizzle-orm']) assert.ok(manifest.dependencies[name], name)
  for (const name of ['asas', '@asas/mithaq', '@asas/auth', '@asas/courses']) assert.equal(manifest.dependencies[name], undefined, name)
  assert.equal(manifest.devDependencies.vite, json('template/apps/asas-tanstack/package.json').devDependencies.vite)
  assert.equal(manifest.devDependencies['mithaq-admin'], undefined)
  assert.equal(manifest.dependencies['mithaq-admin'], 'npm:@drhomet/mithaq-admin@1.2.3')
  for (const name of ['typescript', '@types/node']) assert.ok(manifest.devDependencies[name], name)
  for (const file of ['src/asas.ts', 'src/mithaq.ts', 'src/mithaq/auth/index.ts', 'src/mithaq/auth/backoffice-roles.ts', 'src/roles/tenant-roles.ts', 'src/storage/index.ts', 'src/features/courses/index.ts', 'src/features/courses/courses/courses.ts', 'src/features/auth/user/user.ts', 'src/ui-dashboard/dashboard.tsx', 'src/screens.tsx', 'src/routes/__root.tsx', 'src/ui/app-shell.tsx', 'public/favicon.svg']) assert.ok(existsSync(join(at, file)), file)
  const sources = filesUnder(join(at, 'src')).filter((file) => /\.(tsx?|json|css)$/.test(file))
  assert.deepEqual(sources.filter((file) => /@asas\/|templates\/|packages\/|apps\/asas/.test(readFileSync(file, 'utf8').replaceAll(/^\s*(\/\/|\*).*$/gm, ''))).map((file) => file.slice(at.length)), [], 'no path or name of the monorepo is left')
  assert.match(read('one/src/mithaq/auth/index.ts'), /^export const backofficeApp: boolean = false$/m)
  assert.match(read('one/src/asas.ts'), /from '\.\/features\/courses\/index\.ts'/)
  assert.match(read('one/src/features/courses/courses/courses.ts'), /from '\.\.\/\.\.\/\.\.\/mithaq\.ts'/)
  assert.match(read('one/src/mithaq.ts'), /language: '\.\.\/\.\.\/\.\.\/mithaq\.ts',\n    features: 'src\/features\/',\n    auth: 'src\/features\/auth\/',\n    providers: '\.\.\/\.\.\/\.\.\/mithaq\/auth\/index\.ts',/)
  assert.match(read('one/src/mithaq.ts'), /const asasSource = new URL\('\.\/', import\.meta\.url\)/)
  assert.doesNotMatch(read('one/src/routes/(screens)/dashboard/screen.json'), /"@asas\//, 'every file a screen names is the package\'s own')
  assert.match(read('one/src/mithaq.ts'), /dashboard: 'src\/routes\/\(screens\)\/',\n      portal: 'src\/routes\/\(screens\)\/',\n      backoffice: false,/)
  assert.match(read('one/src/routes/(screens)/portal/files.ts'), /\], \{ base: '\/' \}\)\n/, 'off Vite\'s root, the project\'s own')
  assert.match(read('one/src/styles.css'), /\(`src\/ui\/app-shell\.tsx`\)\. \*\/\n@source '\.\/';\n/)
  assert.doesNotMatch(read('one/tsconfig.json'), /\.\.\//)
  assert.equal(statSync(join(at, '.env')).mode & 0o777, 0o600)
  assert.throws(() => create({ name: 'two', cwd: scratch, template, version: '1.2.3', layout: 'single', addOns: ['backoffice'] }), /single package serves the tenant app alone/)
  assert.throws(() => create({ name: 'three', cwd: scratch, template, version: '1.2.3', layout: 'mono' }), /monorepo or single, not "mono"/)
})

test('--help prints each question\'s flag', () => {
  const done = spawnSync(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url)), '--help'], { encoding: 'utf8' })
  assert.equal(done.status, 0, done.stderr)
  for (const flag of ['--layout monorepo', '--layout single', '--with <a,b>', '--full', '--organizations one|many', '--show-organization yes|no', '--sign-up invite|open', '--organization-name <name>', '--organization-name-ar <name>', 'courses (needs media, roles, audit-log, rich-text)', 'backoffice']) assert.ok(done.stdout.includes(flag), flag)
  assert.match(done.stdout, /npm, pnpm 10\.6 or later, Yarn 1 or Bun 1\.3\. Yarn 2 and later/, 'and which package managers a project installs with')
})

test('a dependency left pointing into the framework repository is refused, whatever the key', () => {
  for (const [key, spec] of [['other', 'workspace:*'], ['tool', 'link:../tool'], ['local', 'file:../local.tgz']] as const) {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const packageJson = { dependencies: { mithaq: '*' }, [field]: { mithaq: '*', [key]: spec } }
      assert.throws(() => updatePackageJSONDependencies({ mithaq: 'npm:@drhomet/mithaq@1.2.3', mithaqAdmin: 'npm:@drhomet/mithaq-admin@1.2.3', packageJson }), new RegExp(`${key}.*${spec}`), `${field} ${spec}`)
    }
  }
  const packageJson = { dependencies: { mithaq: '*', asas: '*', 'mithaq-admin': '*' } }
  updatePackageJSONDependencies({ mithaq: 'file:/tmp/mithaq.tgz', mithaqAdmin: 'file:/tmp/mithaq-admin.tgz', packageJson })
  assert.deepEqual(packageJson, { dependencies: { mithaq: 'file:/tmp/mithaq.tgz', asas: '*', 'mithaq-admin': 'file:/tmp/mithaq-admin.tgz' } })
})

test('an add-on brings every one it needs, said so, and a name the table does not hold is refused with the list', () => {
  assert.deepEqual(resolveAddOns([]), { chosen: [], added: [] })
  assert.deepEqual(resolveAddOns(['courses']), { chosen: ['roles', 'audit-log', 'rich-text', 'jobs', 'uploads', 'media', 'courses'], added: ['roles', 'audit-log', 'rich-text', 'jobs', 'uploads', 'media'] })
  assert.deepEqual(resolveAddOns(['media']), { chosen: ['jobs', 'uploads', 'media'], added: ['jobs', 'uploads'] }, 'and what an add-on it needs needs')
  assert.deepEqual(resolveAddOns(['backoffice', 'roles', 'roles']).chosen, ['roles', 'backoffice'], 'in the table\'s order, once each')
  assert.throws(() => resolveAddOns(['roles', 'images', 'rich']), /^Error: No add-on is named "images", "rich"\. The add-ons are roles, audit-log, settings, rich-text, rich-text-mentions, rich-text-find-replace, rich-text-comments, jobs, uploads, media, courses, backoffice\.$/)
})

test('a region keeps its lines only where its add-ons are chosen, a without region is uncommented only where they are not, and the markers go either way', () => {
  const text = [
    'a',
    '// add-on: roles',
    'b',
    '  // add-on: courses',
    '  c',
    '  // end add-on: courses',
    '// end add-on: roles',
    '// without add-on: roles',
    '// d',
    '//',
    '//   e',
    '// end without add-on: roles',
    'f',
  ].join('\n')
  assert.equal(keepAddOns(text, []), ['a', 'd', '', '  e', 'f'].join('\n'))
  assert.equal(keepAddOns(text, ['roles']), ['a', 'b', 'f'].join('\n'))
  assert.equal(keepAddOns(text, ['roles', 'courses']), ['a', 'b', '  c', 'f'].join('\n'))
  assert.throws(() => keepAddOns('// add-on: roles\nb', []), /leaves "add-on: roles" open/)
  assert.throws(() => keepAddOns('// add-on: roles\n// end add-on: courses', []), /closes "add-on: courses" where no such region is open/)
  assert.throws(() => keepAddOns('// add-on: rolls\n// end add-on: rolls', []), /the add-on "rolls", which the table does not hold/)
  for (const misspelled of ['// addon: roles', '//add-on: roles', '  // ends add-on: roles', '// without addon: roles']) {
    assert.throws(() => keepAddOns(`a\n${misspelled}\nb`, []), /reads like an add-on marker and is none/, misspelled)
  }
})

test('a minimal project holds auth and the tags example alone: no other feature, no file only an add-on reads, and access over Better Auth\'s own member roles', () => {
  create({ name: 'minimal', cwd: scratch, template, version: '1.2.3' })
  const at = join(scratch, 'minimal')
  assert.deepEqual(readdirSync(join(at, 'packages/features')).sort(), ['auth', 'tags'])
  assert.ok(!existsSync(join(at, 'apps/asas-backoffice')))
  for (const file of Object.values(addOns).flatMap((one) => one.files)) assert.ok(!existsSync(join(at, file)), file)
  for (const file of Object.values(addOns).flatMap((one) => one.without)) assert.ok(existsSync(join(at, file)), file)
  assert.deepEqual(Object.keys(json('minimal/packages/asas/package.json').dependencies).filter((one) => one.startsWith('@minimal/')).sort(), ['@minimal/auth', '@minimal/mithaq', '@minimal/tags'])
  // Its code, the comments aside, which may name what an add-on would bring.
  const code = (file: string) => read(file).replaceAll(/^\s*(\/\/|\/?\*).*$/gm, '')
  const language = code('minimal/packages/mithaq/src/mithaq.ts')
  assert.doesNotMatch(language, /\bjobs\b|drizzleJobs|defaultJobLease|defaultJobRetention|mithaq_jobs/)
  assert.doesNotMatch(code('minimal/packages/asas/src/asas.ts'), /tasks:|defaultStorageSweepTask/)
  assert.doesNotMatch(code('minimal/apps/asas-tanstack/src/server.ts'), /work:/)
  assert.match(language, /^import \{ accessTarget \} from '\.\/roles\/member-access\.ts'$/m)
  assert.match(language, /^export \{ accessTarget \}$/m)
  assert.doesNotMatch(language, /rbacTarget|auditSink|sessionLabels|softDelete|'courses'|'roles'|'auditLog'|'settings'|richText|storage\(/)
  assert.deepEqual(Object.keys(json('minimal/packages/asas/src/messages/mithaq.json').kinds).filter((key) => /richText|upload/.test(key)), [], 'nor the copy of a word it left out')
  // No add-on's npm packages either, Lexical's above all.
  for (const workspace of ['', 'packages/mithaq', 'packages/asas', 'apps/asas-tanstack']) {
    const { dependencies = {}, devDependencies = {} } = json('minimal', workspace, 'package.json')
    assert.deepEqual(Object.keys({ ...dependencies, ...devDependencies }).filter((one) => /^(lexical|@lexical\/|aws4fetch|file-type|image-dimensions)/.test(one)), [], workspace)
  }
  assert.match(read('minimal/packages/mithaq/src/roles/tenant-roles.ts'), /\.\.\.defaultMemberRoles,/)
  assert.doesNotMatch(code('minimal/packages/mithaq/src/mithaq/auth/index.ts'), /memberRoles|enrollments/)
  assert.doesNotMatch(code('minimal/packages/asas/src/asas.ts'), /courses|roles\.kayan|auditLog|settings/)
  // The template's migrations build every table, so none ships, and no answer to them either.
  assert.deepEqual(readdirSync(join(at, 'packages/asas/src/migrations')), ['drizzle.config.ts'])
  assert.equal(read('minimal/packages/asas/mithaq.hints.json'), '[]\n')
  const sources = filesUnder(at).filter((file) => /\.tsx?$/.test(file))
  assert.deepEqual(sources.filter((file) => /add-on: /.test(readFileSync(file, 'utf8'))).map((file) => file.slice(at.length)), [], 'no marker is left')
})

test('jobs alone holds its target without tasks, and uploads pulls jobs in for its sweep', () => {
  assert.deepEqual(resolveAddOns(['jobs']), { chosen: ['jobs'], added: [] })
  assert.deepEqual(resolveAddOns(['uploads']), { chosen: ['jobs', 'uploads'], added: ['jobs'] })
  for (const [name, asked] of [['jobs-only', ['jobs']], ['with-uploads', ['uploads']]] as const) {
    create({ name, cwd: scratch, template, version: '1.2.3', addOns: [...asked] })
    assert.match(read(name, 'packages/mithaq/src/mithaq.ts'), /jobs: drizzleJobs\(\{ lease: defaultJobLease, retain: defaultJobRetention \}\)/)
    const asas = read(name, 'packages/asas/src/asas.ts')
    const host = read(name, 'apps/asas-tanstack/src/server.ts')
    if (name === 'jobs-only') {
      assert.doesNotMatch(asas, /tasks:|defaultStorageSweepTask/)
      assert.doesNotMatch(host, /work:/)
    } else {
      assert.match(asas, /tasks: \{ storageSweep: defaultStorageSweepTask \}/)
      assert.match(host, /work: \['maintenance'\]/)
    }
    assert.deepEqual(readdirSync(join(scratch, name, 'packages/asas/src/migrations')), ['drizzle.config.ts'], 'a partial project generates its own first migration')
    const sources = filesUnder(join(scratch, name)).filter((file) => /\.tsx?$/.test(file))
    assert.ok(sources.every((file) => !/add-on: /.test(readFileSync(file, 'utf8'))), 'no marker is left')
  }
})

test('a full project holds every add-on and the template\'s migrations, none of the files that stand in for an add-on, and no marker', () => {
  const at = join(scratch, 'my-app')
  for (const file of Object.values(addOns).flatMap((one) => one.files)) assert.ok(existsSync(join(at, file)), file)
  for (const file of Object.values(addOns).flatMap((one) => one.without)) assert.ok(!existsSync(join(at, file)), file)
  assert.match(read('my-app/packages/mithaq/src/mithaq.ts'), /rbacTarget\(\{ \.\.\.accessOptions, roles \}\)/)
  assert.doesNotMatch(read('my-app/packages/mithaq/src/mithaq.ts'), /member-access/)
  for (const name of ['lexical', '@lexical/react', 'aws4fetch']) assert.ok(json('my-app/apps/asas-tanstack/package.json').dependencies[name] ?? json('my-app/packages/mithaq/package.json').dependencies[name], name)
  assert.ok(readdirSync(join(at, 'packages/asas/src/migrations')).length > 2)
  const sources = filesUnder(at).filter((file) => /\.tsx?$/.test(file))
  assert.deepEqual(sources.filter((file) => /add-on: /.test(readFileSync(file, 'utf8'))).map((file) => file.slice(at.length)), [], 'no marker is left')
})

test('organizations.ts says the mode and who may sign up: one organization by invitation unless asked, the courses example as a school whose open joiners are students, and many founding by open sign-up', () => {
  const settingsOf = (name: string) => {
    const text = read(name, 'packages/mithaq/src/mithaq/auth/organizations.ts')
    const value = (key: string) => new RegExp(`^export const ${key}: [^=]+ = (.+)$`, 'm').exec(text)?.[1]
    return Object.fromEntries(['organizations', 'showOrganization', 'signUp', 'joinRole', 'verifyEmail', 'allowedDomains'].map((key) => [key, value(key)]))
  }
  create({ name: 'school', cwd: scratch, template, version: '1.2.3', addOns: every })
  assert.deepEqual(settingsOf('school'), { organizations: "'one'", showOrganization: 'true', signUp: "'invite'", joinRole: "'student'", verifyEmail: 'false', allowedDomains: '[]' })
  create({ name: 'plain', cwd: scratch, template, version: '1.2.3' })
  assert.deepEqual(settingsOf('plain'), { organizations: "'one'", showOrganization: 'true', signUp: "'invite'", joinRole: 'null', verifyEmail: 'false', allowedDomains: '[]' }, 'without the roles add-on nobody is given a role on joining')
  create({ name: 'hidden', cwd: scratch, template, version: '1.2.3', showOrganization: false, signUp: 'open' })
  assert.deepEqual(settingsOf('hidden'), { organizations: "'one'", showOrganization: 'false', signUp: "'open'", joinRole: 'null', verifyEmail: 'false', allowedDomains: '[]' }, 'one organization the app never names')
  create({ name: 'many', cwd: scratch, template, version: '1.2.3', addOns: every, organizations: 'many', passwordDelivery: 'email' })
  assert.deepEqual(settingsOf('many'), { organizations: "'many'", showOrganization: 'true', signUp: "'open'", joinRole: 'null', verifyEmail: 'true', allowedDomains: '[]' }, 'many founds an organization by every sign-up and proves every address')
  assert.throws(() => create({ name: 'invited-many', cwd: scratch, template, version: '1.2.3', organizations: 'many', signUp: 'invite' }), /many organizations take --sign-up open/)
  assert.throws(() => create({ name: 'hidden-many', cwd: scratch, template, version: '1.2.3', organizations: 'many', showOrganization: false }), /many organizations are shown by name/)
  assert.throws(() => create({ name: 'none', cwd: scratch, template, version: '1.2.3', organizations: 'none' }), /--organizations is one or many, not "none": one organization never shown is --organizations one --show-organization no/)
  assert.throws(() => create({ name: 'some', cwd: scratch, template, version: '1.2.3', organizations: 'some' }), /--organizations is one or many, not "some"/)
  assert.throws(() => create({ name: 'closed', cwd: scratch, template, version: '1.2.3', signUp: 'closed' }), /--sign-up is invite or open, not "closed"/)
  for (const name of ['school', 'plain', 'hidden', 'many']) assert.equal(existsSync(join(scratch, name, 'packages/asas/src/organizations.ts')), true, `${name}: the apps read the mode through the asas`)
})

test('with one organization its name in each locale is written into organizations.ts, the Arabic falling back to the English, and a name of more than one line or past 100 characters is refused', () => {
  // The literal as the file holds it, read as the language reads it.
  const named = (name: string) => new Function(`return ${new RegExp('^export const organizationName: [^=]+ = (.+)$', 'm').exec(read(name, 'packages/mithaq/src/mithaq/auth/organizations.ts'))?.[1]}`)()
  create({ name: 'noor', cwd: scratch, template, version: '1.2.3', organizationName: { en: "Noor's School", ar: 'مدرسة النور' } })
  assert.deepEqual(named('noor'), { en: "Noor's School", ar: 'مدرسة النور' }, 'each locale\'s name as written, quotes and all')
  create({ name: 'dollars', cwd: scratch, template, version: '1.2.3', organizationName: { en: "Price$'s $& $` Shop" } })
  assert.deepEqual(named('dollars'), { en: "Price$'s $& $` Shop", ar: "Price$'s $& $` Shop" }, 'and a name holding a replacement pattern as written')
  create({ name: 'english', cwd: scratch, template, version: '1.2.3', organizationName: { en: 'Light House' } })
  assert.deepEqual(named('english'), { en: 'Light House', ar: 'Light House' }, 'the Arabic falls back to the English')
  create({ name: 'unnamed', cwd: scratch, template, version: '1.2.3' })
  assert.deepEqual(named('unnamed'), { en: 'My organization', ar: 'مؤسستي' }, 'and with none given the template\'s own stands')
  assert.throws(() => create({ name: 'broken', cwd: scratch, template, version: '1.2.3', organizationName: { en: 'Two\nlines' } }), /--organization-name is one line of 1 to 100 characters/)
  assert.throws(() => create({ name: 'long', cwd: scratch, template, version: '1.2.3', organizationName: { en: 'x'.repeat(101) } }), /--organization-name is one line of 1 to 100 characters/)
})

test('a single package reaches the organization mode by path', () => {
  create({ name: 'single-modes', cwd: scratch, template, version: '1.2.3', layout: 'single', showOrganization: false })
  assert.match(read('single-modes/src/organizations.ts'), /from '\.\/mithaq\/auth\/organizations\.ts'/)
  assert.match(read('single-modes/src/mithaq/auth/organizations.ts'), /^export const showOrganization: [^=]+ = false$/m)
})

test('in one package an import of a feature resolves only where that feature exports the path, as its package did', () => {
  const read = (feature: string) => JSON.parse(readFileSync(join(root, 'templates/features', feature, 'package.json'), 'utf8')).exports
  assert.equal(exportsPath(read('roles'), '/roles/ui/role-form.tsx'), true, 'roles exports its role form')
  assert.equal(exportsPath(read('courses'), '/domain/on-offer.ts'), true, 'courses its domain')
  assert.equal(exportsPath(read('roles'), ''), true, 'and every feature its index')
  assert.equal(exportsPath(read('tags'), '/tags/ui/anything.tsx'), false, 'a feature exporting no ui/ admits none')
  assert.equal(exportsPath(read('courses'), '/courses/ui/fee-cell.tsx'), false, 'nor one exporting another path')
  assert.equal(exportsPath(read('roles'), '/roles/roles.ts'), false, 'and a pattern admits only what lies under it')
  for (const sub of ['/roles/ui/../roles.ts', '/roles/ui/./role-form.tsx', '/roles/ui/../../index.ts']) assert.equal(exportsPath(read('roles'), sub), false, `a dot segment climbs nowhere: ${sub}`)
  const excluding = { '.': './index.ts', './ui/*': './ui/*', './ui/private/*': null }
  assert.equal(exportsPath(excluding, '/ui/open.tsx'), true, 'a path under a pattern is admitted')
  assert.equal(exportsPath(excluding, '/ui/private/secret.tsx'), false, 'unless a more specific key excludes it with null, as Node does')
})

test('rich text tools are selected at creation and unknown names fail before writing a project', async () => {
  const { resolveRichTextFeatures } = await import('./index.js')
  assert.deepEqual(resolveRichTextFeatures(), [])
  assert.throws(() => resolveRichTextFeatures(['table']), /distinct features/)
  assert.throws(() => resolveRichTextFeatures(['code', 'code']), /distinct features/)
  create({ name: 'rt-selection', cwd: scratch, template, version: '1.2.3', richText: ['tables', 'counter'] })
  const config = read('rt-selection/packages/mithaq/src/mithaq/rich-text-features.ts')
  assert.match(config, /features: \[\.\.\.defaultRichTextFeatures, 'tables', 'counter'\]/)
  assert.doesNotMatch(config, /'code'|'markdown'|'styling'/)
  create({ name: 'rt-default', cwd: scratch, template, version: '1.2.3', addOns: ['rich-text'] })
  assert.match(read('rt-default/packages/mithaq/src/mithaq/rich-text-features.ts'), /features: \[\.\.\.defaultRichTextFeatures\]/)
})

test('password links default to administrator delivery and email is an explicit project setting', () => {
  for (const delivery of [undefined, 'admin', 'email']) {
    const name = `links-${delivery ?? 'default'}`
    create({ name, cwd: scratch, template, version: '1.2.3', passwordDelivery: delivery })
    assert.match(read(name, 'packages/mithaq/src/mithaq/auth/organizations.ts'), new RegExp(`export const passwordDelivery: 'admin' \\| 'email' = '${delivery ?? 'admin'}'`))
  }
  assert.match(read('links-default', 'packages/mithaq/src/mithaq/auth/organizations.ts'), /export const verifyEmail: boolean = false/)
  assert.match(read('links-email', 'packages/mithaq/src/mithaq/auth/organizations.ts'), /export const verifyEmail: boolean = true/)
  assert.throws(() => create({ name: 'links-many-admin', cwd: scratch, template, version: '1.2.3', organizations: 'many', passwordDelivery: 'admin' }), /many.*verification.*password-delivery email/)
  assert.throws(() => create({ name: 'links-invalid', cwd: scratch, template, version: '1.2.3', passwordDelivery: 'sms' }), /password-delivery/)
})

test('the comments tool installs its private table and audit sink, while other projects carry neither', () => {
  create({ name: 'rt-comments', cwd: scratch, template, version: '1.2.3', richText: ['mentions', 'findReplace', 'comments'] })
  assert.ok(existsSync(join(scratch, 'rt-comments/packages/features/rich-text-comments/threads/threads.ts')))
  assert.ok(existsSync(join(scratch, 'rt-comments/packages/features/audit-log')))
  const config = read('rt-comments/packages/mithaq/src/mithaq/rich-text-features.ts')
  assert.match(config, /'mentions', 'findReplace', 'comments'/)
  assert.match(config, /comments: \{ threads: 'richTextThreads' \}/)
  create({ name: 'rt-no-comments', cwd: scratch, template, version: '1.2.3', richText: ['findReplace'] })
  assert.ok(!existsSync(join(scratch, 'rt-no-comments/packages/features/rich-text-comments')))
  assert.doesNotMatch(read('rt-no-comments/packages/mithaq/src/mithaq/rich-text-features.ts'), /comments:/)
  assert.doesNotMatch(read('rt-no-comments/packages/asas/src/asas.ts'), /richTextComments/)
  assert.doesNotMatch(read('rt-no-comments/apps/asas-tanstack/src/copy.ts'), /'richText\.mentions'|'richText\.comments'/)
  assert.match(read('rt-no-comments/apps/asas-tanstack/src/copy.ts'), /'richText\.findReplace'/)
})
