// Stages the published packages in `.pack/mithaq/`, `.pack/mithaq-admin/`, `.pack/mithaq-rich-text/` and `.pack/create-mithaq/`, to publish with `npm publish <dir> --access public`.
// Staged rather than published from `packages/mithaq`, because npm and Bun ignore `publishConfig.exports` and only pnpm applies it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'packages/mithaq')
const staged = join(root, '.pack/mithaq')

const { publishConfig, private: _private, devDependencies: _dev, scripts: _scripts, ...manifest } = JSON.parse(
  readFileSync(join(source, 'package.json'), 'utf8'),
) as { publishConfig: { version: string; exports: Record<string, string> }; exports: Record<string, string>; [key: string]: unknown }

// Committed files only, as the template is staged, so nothing left in the working tree ships.
const tracked = (...paths: string[]) => execFileSync('git', ['ls-files', '-z', ...paths], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const guides = ['packages/mithaq/src/drizzle/sqlite/README.md', 'packages/mithaq/README.md', 'packages/mithaq/src/auth/better-auth/README.md', 'packages/mithaq/src/asas/cli/README.md', 'packages/mithaq/src/asas/runner/README.md', 'packages/mithaq/src/drizzle/README.md', 'packages/mithaq-admin/README.md', 'packages/mithaq-rich-text/README.md', 'templates/asas/README.md']
const skills = 'templates/asas/.claude/skills'
// The build compiles every `src/**/*.ts` it finds, so a file git does not track there would ship in `dist/`. Release CI
// checks out clean; this guards a publish from a working tree, over every path staged from the tree.
const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard', 'packages/mithaq/src', 'packages/mithaq-rich-text/src', 'LICENSES', ...guides, skills], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
assert.deepEqual(untracked, [], 'git tracks none of these files: commit or remove each before packing')
const stageLicenses = (to: string) => {
  cpSync(join(root, 'LICENSE'), join(to, 'LICENSE'))
  for (const file of tracked('LICENSES')) cpSync(join(root, file), join(to, file))
}

rmSync(staged, { recursive: true, force: true })
execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(source, 'tsconfig.build.json'), '--outDir', join(staged, 'dist')], { stdio: 'inherit' })
assert.deepEqual(Object.keys(publishConfig.exports), Object.keys(manifest.exports), 'publishConfig.exports names the same entries as exports')
for (const [entry, file] of Object.entries(manifest.exports)) {
  const built = publishConfig.exports[entry]!
  assert.equal(built, file.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js'), `${entry} is published from the build of ${file}`)
  assert.ok(existsSync(join(staged, built)), `${built} was built`)
}
writeFileSync(join(staged, 'package.json'), `${JSON.stringify({ ...manifest, ...publishConfig, dependencies: { ...(manifest.dependencies as Record<string, string>), '@drhomet/mithaq-rich-text': publishConfig.version } }, null, 2)}\n`)

// The shared readers and node classes ship alone, without core or the admin's server dependencies.
const rich = join(root, 'packages/mithaq-rich-text')
const stagedRich = join(root, '.pack/mithaq-rich-text')
rmSync(stagedRich, { recursive: true, force: true })
const { publishConfig: richPublished, private: _richPrivate, devDependencies: _richDev, ...richManifest } = JSON.parse(readFileSync(join(rich, 'package.json'), 'utf8')) as { publishConfig: { exports: Record<string, string> }; exports: Record<string, string>; [key: string]: unknown }
execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(rich, 'tsconfig.build.json'), '--outDir', join(stagedRich, 'dist')], { stdio: 'inherit' })
assert.deepEqual(Object.keys(richPublished.exports), Object.keys(richManifest.exports))
for (const [entry, file] of Object.entries(richManifest.exports)) {
  const built = richPublished.exports[entry]!
  assert.equal(built, file.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js'))
  assert.ok(existsSync(join(stagedRich, built)), `${built} was built`)
}
writeFileSync(join(stagedRich, 'package.json'), `${JSON.stringify({ ...richManifest, ...richPublished, version: publishConfig.version }, null, 2)}\n`)
cpSync(join(rich, 'README.md'), join(stagedRich, 'README.md'))
stageLicenses(stagedRich)
console.log(`staged ${stagedRich}`)

// The admin's pieces as TSX source, which each project compiles against its own primitives. registry/ui, lib and hooks are
// shadcn's own, held for the package's typecheck and tests; only directional-icon.tsx, which an item names, ships.
const admin = join(root, 'packages/mithaq-admin')
const stagedAdmin = join(root, '.pack/mithaq-admin')
rmSync(stagedAdmin, { recursive: true, force: true })
const { publishConfig: adminPublished, private: _adminPrivate, devDependencies: _adminDev, ...adminManifest } = JSON.parse(readFileSync(join(admin, 'package.json'), 'utf8')) as { publishConfig: Record<string, unknown>; [key: string]: unknown }
// Committed files only, as the template is staged, so nothing left in the working tree ships.
const adminFiles = execFileSync('git', ['ls-files', '-z', 'registry', 'registry.json', 'source.css', 'README.md'], { cwd: admin, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file && (!/^registry\/(ui|lib|hooks)\//.test(file) || file === 'registry/ui/directional-icon.tsx'))
for (const file of adminFiles) cpSync(join(admin, file), join(stagedAdmin, file))
const { items } = JSON.parse(readFileSync(join(admin, 'registry.json'), 'utf8')) as { items: { name: string; files: { path: string }[] }[] }
for (const { name, files } of items) for (const { path } of files) assert.ok(existsSync(join(stagedAdmin, path)), `${name} names ${path}, which ships`)
// One version for the four packages, so a project that pins them together cannot pair two that drifted apart.
// ponytail: the `mithaq` peer stays "*". A `file:` tarball, as test:release installs mithaq, satisfies only `*` in Bun's
// isolated linker; whether an `npm:` alias satisfies an exact pin is untested. Pin the release version once a consumer
// installed from the registry proves it.
writeFileSync(join(stagedAdmin, 'package.json'), `${JSON.stringify({ ...adminManifest, ...adminPublished, version: publishConfig.version, dependencies: { ...(adminManifest.dependencies as Record<string, string>), '@drhomet/mithaq-rich-text': publishConfig.version } }, null, 2)}\n`)
stageLicenses(stagedAdmin)
console.log(`staged ${stagedAdmin}, with ${adminFiles.length} files`)

cpSync(join(root, 'README.md'), join(staged, 'README.md'))
writeFileSync(join(staged, 'CHANGELOG.md'), readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/\]\((packages|templates)\//g, '](docs/$1/'))
// The user guides at their repository paths, so each relative link between them resolves as it does on GitHub, and a
// project's agent reads the ones that match the version it installed. The contributor AGENTS.md files stay out.
for (const guide of tracked(...guides)) {
  cpSync(join(root, guide), join(staged, 'docs', guide))
}
// The workflow skills a created project carries in `.claude/skills/`, at this version, for an upgrade to copy again.
for (const file of tracked(skills)) cpSync(join(root, file), join(staged, 'skills', relative(skills, file)))
stageLicenses(staged)
console.log(`staged ${staged}`)

// The template as it is at this version, so creating a project reads nothing over the network but the install.
// npm leaves every `.gitignore` out of a package, so each is staged as `gitignore` and named back on creation.
const creator = join(root, '.pack/create-mithaq')
const creatorSource = join(root, 'packages/create-mithaq')
rmSync(creator, { recursive: true, force: true })
const { private: _creatorPrivate, publishConfig: creatorPublished, ...creatorManifest } = JSON.parse(readFileSync(join(creatorSource, 'package.json'), 'utf8')) as { publishConfig: Record<string, unknown>; [key: string]: unknown }
const excluded = /(\.test\.tsx?|\.probe\.ts|\.smoke\.ts|\.support\.ts|\.fixture\.[^/]+|(^|\/)(test-[^/]*|memory-store|standard-schema-target)\.ts)$/
const templateFiles = execFileSync('git', ['ls-files', '-z', 'templates/mithaq', 'templates/features', 'templates/asas', 'apps/asas-tanstack', 'apps/asas-backoffice'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file && !excluded.test(file))
for (const file of templateFiles) {
  cpSync(join(root, file), join(creator, 'template', file.replace(/(^|\/)\.gitignore$/, '$1gitignore')), { dereference: true })
}
// No `packageManager`: a project installs with whichever manager made it, and corepack refuses any other the field does not name.
// No `typescript` either: each workspace that type-checks names its own, because npm, seeing a root `typescript` 7 that an
// optional peer of better-auth's would refuse, installs better-auth and mithaq again under every workspace, and two copies of
// mithaq are two languages.
const { engines, devDependencies: { typescript: _typescript, 'playwright-core': _playwright, '@babel/parser': _parser, ...devDependencies } } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines: unknown; devDependencies: Record<string, string> }
writeFileSync(join(creator, 'template/package.json'), `${JSON.stringify({ private: true, type: 'module', engines, workspaces: ['packages/mithaq', 'packages/features/*', 'packages/asas', 'apps/*'], devDependencies }, null, 2)}\n`)
writeFileSync(join(creator, 'package.json'), `${JSON.stringify({ ...creatorManifest, ...creatorPublished, version: publishConfig.version }, null, 2)}\n`)
cpSync(join(creatorSource, 'index.js'), join(creator, 'index.js'))
stageLicenses(creator)
console.log(`staged ${creator}, with ${templateFiles.length} template files`)
