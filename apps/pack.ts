// Stages the published packages in `.pack/mithaq/`, `.pack/mithaq-admin/` and `.pack/create-mithaq/`, to publish with `npm publish <dir> --access public`.
// Staged rather than published from `packages/mithaq`, because npm and Bun ignore `publishConfig.exports` and only pnpm applies it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'packages/mithaq')
const staged = join(root, '.pack/mithaq')

const { publishConfig, private: _private, devDependencies: _dev, scripts: _scripts, ...manifest } = JSON.parse(
  readFileSync(join(source, 'package.json'), 'utf8'),
) as { publishConfig: { version: string; exports: Record<string, string> }; exports: Record<string, string>; [key: string]: unknown }

rmSync(staged, { recursive: true, force: true })
execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(source, 'tsconfig.build.json'), '--outDir', join(staged, 'dist')], { stdio: 'inherit' })
assert.deepEqual(Object.keys(publishConfig.exports), Object.keys(manifest.exports), 'publishConfig.exports names the same entries as exports')
for (const [entry, file] of Object.entries(manifest.exports)) {
  const built = publishConfig.exports[entry]!
  assert.equal(built, file.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js'), `${entry} is published from the build of ${file}`)
  assert.ok(existsSync(join(staged, built)), `${built} was built`)
}
writeFileSync(join(staged, 'package.json'), `${JSON.stringify({ ...manifest, ...publishConfig }, null, 2)}\n`)

// The admin's pieces as TSX source, which each project compiles against its own primitives. registry/ui, lib and hooks are
// shadcn's own, held for the package's typecheck and tests; only directional-icon.tsx, which an item names, ships.
const admin = join(root, 'packages/mithaq-admin')
const stagedAdmin = join(root, '.pack/mithaq-admin')
rmSync(stagedAdmin, { recursive: true, force: true })
const { publishConfig: adminPublished, private: _adminPrivate, devDependencies: _adminDev, ...adminManifest } = JSON.parse(readFileSync(join(admin, 'package.json'), 'utf8')) as { publishConfig: Record<string, unknown>; [key: string]: unknown }
cpSync(join(admin, 'registry'), join(stagedAdmin, 'registry'), { recursive: true })
for (const folder of ['ui', 'lib', 'hooks']) rmSync(join(stagedAdmin, 'registry', folder), { recursive: true })
cpSync(join(admin, 'registry/ui/directional-icon.tsx'), join(stagedAdmin, 'registry/ui/directional-icon.tsx'))
for (const file of ['registry.json', 'source.css', 'README.md']) cpSync(join(admin, file), join(stagedAdmin, file))
const { items } = JSON.parse(readFileSync(join(admin, 'registry.json'), 'utf8')) as { items: { name: string; files: { path: string }[] }[] }
for (const { name, files } of items) for (const { path } of files) assert.ok(existsSync(join(stagedAdmin, path)), `${name} names ${path}, which ships`)
// One version for the three packages, so a project that pins them together cannot pair two that drifted apart.
writeFileSync(join(stagedAdmin, 'package.json'), `${JSON.stringify({ ...adminManifest, ...adminPublished, version: publishConfig.version }, null, 2)}\n`)
cpSync(join(root, 'LICENSE'), join(stagedAdmin, 'LICENSE'))
cpSync(join(root, 'LICENSES'), join(stagedAdmin, 'LICENSES'), { recursive: true })
console.log(`staged ${stagedAdmin}, with ${readdirSync(join(stagedAdmin, 'registry'), { recursive: true }).length} entries in registry/`)

cpSync(join(root, 'README.md'), join(staged, 'README.md'))
cpSync(join(root, 'LICENSE'), join(staged, 'LICENSE'))
cpSync(join(root, 'LICENSES'), join(staged, 'LICENSES'), { recursive: true })
console.log(`staged ${staged}`)

// The template as it is at this version, so creating a project reads nothing over the network but the install.
// npm leaves every `.gitignore` out of a package, so each is staged as `gitignore` and named back on creation.
const creator = join(root, '.pack/create-mithaq')
const creatorSource = join(root, 'packages/create-mithaq')
rmSync(creator, { recursive: true, force: true })
const { private: _creatorPrivate, publishConfig: creatorPublished, ...creatorManifest } = JSON.parse(readFileSync(join(creatorSource, 'package.json'), 'utf8')) as { publishConfig: Record<string, unknown>; [key: string]: unknown }
const excluded = /(\.test\.tsx?|\.probe\.ts|\.smoke\.ts|\.support\.ts|\.fixture\.[^/]+|(^|\/)(test-[^/]*|memory-store|standard-schema-target)\.ts)$/
const templateFiles = execFileSync('git', ['ls-files', '-z', 'templates/asas', 'templates/auth', 'apps/asas-tanstack', 'apps/asas-platform'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file && !excluded.test(file))
for (const file of templateFiles) {
  cpSync(join(root, file), join(creator, 'template', file.replace(/(^|\/)\.gitignore$/, '$1gitignore')), { dereference: true })
}
// No `packageManager`: a project installs with whichever manager made it, and corepack refuses any other the field does not name.
// No `typescript` either: each workspace that type-checks names its own, because npm, seeing a root `typescript` 7 that an
// optional peer of better-auth's would refuse, installs better-auth and mithaq again under every workspace, and two copies of
// mithaq are two languages.
const { engines, devDependencies: { typescript: _typescript, ...devDependencies } } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines: unknown; devDependencies: Record<string, string> }
writeFileSync(join(creator, 'template/package.json'), `${JSON.stringify({ private: true, type: 'module', engines, workspaces: ['templates/*', 'apps/*', 'packages/features/*'], devDependencies }, null, 2)}\n`)
writeFileSync(join(creator, 'package.json'), `${JSON.stringify({ ...creatorManifest, ...creatorPublished, version: publishConfig.version }, null, 2)}\n`)
cpSync(join(creatorSource, 'index.js'), join(creator, 'index.js'))
cpSync(join(root, 'LICENSE'), join(creator, 'LICENSE'))
cpSync(join(root, 'LICENSES'), join(creator, 'LICENSES'), { recursive: true })
console.log(`staged ${creator}, with ${templateFiles.length} template files`)
