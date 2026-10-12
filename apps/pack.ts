// Stages the published packages in `.pack/mithaq/` and `.pack/create-mithaq/`, to publish with `npm publish <dir> --access public`.
// Staged rather than published from `packages/mithaq`, because npm and Bun ignore `publishConfig.exports` and only pnpm applies it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hashOf, mark } from '../packages/mithaq/src/asas/cli/upgrade.ts'

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

// Inside this repository an item names a sibling by the consumer's install path, which shadcn reads against the app's
// working directory; a published project reads the registry over HTTP under `@mithaq`, so each such entry becomes `@mithaq/<item>`.
const admin = join(root, 'packages/mithaq-admin')
const registry = join(staged, 'r')
execFileSync(join(admin, 'node_modules/.bin/shadcn'), ['build', '--output', registry], { cwd: admin, stdio: 'inherit' })
await mark(pathToFileURL(`${registry}/`))
type Item = { name: string; registryDependencies?: string[]; files?: { content: string }[] }
const installed = /^\.\/node_modules\/mithaq-admin\/r\/([^/]+)\.json$/
// shadcn reads `@scope/item` as the registry `@scope` and the item `item`, and fetches the URL `components.json` gives
// that registry with `{name}` replaced, so each rewritten entry must name a file here.
const namespaced = /^(@[a-zA-Z0-9](?:[a-zA-Z0-9-_]*[a-zA-Z0-9])?)\/(.+)$/
// A bare registry name shadcn does not serve answers 404 and aborts the whole `shadcn add`. This list is kept by hand,
// so add a name only after `shadcn add @mithaq/mithaq-screens-host --dry-run` resolves it.
const shadcnServes = new Set(['accordion', 'alert-dialog', 'avatar', 'badge', 'button', 'button-group', 'calendar', 'card', 'checkbox', 'collapsible', 'combobox', 'dialog', 'direction', 'drawer', 'dropdown-menu', 'field', 'input', 'input-group', 'input-otp', 'label', 'popover', 'radio-group', 'resizable', 'scroll-area', 'select', 'separator', 'sheet', 'sidebar', 'slider', 'spinner', 'switch', 'table', 'tabs', 'textarea', 'toggle', 'toggle-group'])
const names = new Set(readdirSync(registry).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)))
for (const name of names) {
  const file = join(registry, `${name}.json`)
  const json = JSON.parse(readFileSync(file, 'utf8')) as Item & { items?: Item[] }
  if (!json.items) assert.equal(json.name, name, `r/${name}.json is the item @mithaq/${name} names`)
  for (const item of json.items ?? [json]) {
    assert.ok(names.has(item.name), `@mithaq/${item.name} resolves to r/${item.name}.json`)
    if (item.registryDependencies) item.registryDependencies = item.registryDependencies.map((dependency) => {
      const [, sibling] = installed.exec(dependency) ?? []
      return sibling ? `@mithaq/${sibling}` : dependency
    })
    for (const dependency of item.registryDependencies ?? []) {
      assert.ok(!dependency.includes('/') || namespaced.test(dependency), `${item.name} names ${dependency}, which only resolves inside this repository`)
      const [, scope, target] = namespaced.exec(dependency) ?? []
      if (scope) assert.ok(scope === '@mithaq' && names.has(target!), `${item.name} names ${dependency}, which is no item of r/`)
      else assert.ok(shadcnServes.has(dependency), `${item.name} names ${dependency}, which shadcn's registry is not known to serve`)
    }
    // The marker hashes a file's text alone, so the rewrite above leaves every marker true; the index lists files without text.
    for (const { content } of json.items ? [] : (item.files ?? [])) {
      assert.equal(/ ([0-9a-f]{64})\n$/.exec(content)?.[1], hashOf(content), `a file of ${item.name} still hashes to its marker`)
    }
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
}
cpSync(join(root, 'LICENSE'), join(staged, 'LICENSE'))
cpSync(join(root, 'LICENSES'), join(staged, 'LICENSES'), { recursive: true })
console.log(`staged ${staged}, with ${names.size} files in r/`)

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
const { packageManager, engines, devDependencies } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
writeFileSync(join(creator, 'template/package.json'), `${JSON.stringify({ private: true, type: 'module', packageManager, engines, workspaces: ['templates/*', 'apps/*'], devDependencies }, null, 2)}\n`)
writeFileSync(join(creator, 'package.json'), `${JSON.stringify({ ...creatorManifest, ...creatorPublished, version: publishConfig.version }, null, 2)}\n`)
cpSync(join(creatorSource, 'index.js'), join(creator, 'index.js'))
cpSync(join(root, 'LICENSE'), join(creator, 'LICENSE'))
cpSync(join(root, 'LICENSES'), join(creator, 'LICENSES'), { recursive: true })
console.log(`staged ${creator}, with ${templateFiles.length} template files`)
