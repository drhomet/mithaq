// A template folder as staged for publishing: the template's own manifests and settings, with each
// `.gitignore` staged as `gitignore`.
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { create, updatePackageJSONDependencies } from './index.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'create-mithaq-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const template = join(scratch, 'template')
for (const file of ['templates/asas/package.json', 'templates/asas/components.json', 'templates/asas/.env.example', 'templates/auth/package.json', 'apps/asas-tanstack/package.json', 'apps/asas-tanstack/components.json', 'apps/asas-platform/package.json', 'apps/asas-platform/components.json']) {
  mkdirSync(join(template, file, '..'), { recursive: true })
  cpSync(join(root, file), join(template, file))
}
cpSync(join(root, 'apps/asas-tanstack/.gitignore'), join(template, 'apps/asas-tanstack/gitignore'))
writeFileSync(join(template, 'package.json'), JSON.stringify({ private: true, type: 'module', workspaces: ['templates/*', 'apps/*'], devDependencies: { typescript: '^7.0.2' } }))

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

test('a project is a Bun workspace named for it, installed isolated, ignoring its .env', () => {
  const manifest = json('my-app/package.json')
  assert.equal(manifest.name, 'my-app')
  assert.deepEqual(manifest.workspaces, ['templates/*', 'apps/*'])
  assert.equal(manifest.devDependencies.typescript, '^7.0.2')
  assert.match(read('my-app/bunfig.toml'), /^linker = "isolated"$/m)
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
