// What `apps/pack.ts` stages beside the build: the user guides, at their repository paths so a link from one to another
// resolves inside `node_modules/mithaq/docs/`, where a project's agent reads the guides of the version it installed, and
// the workflow skills a created project carries. Each from committed files alone.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const staged = join(root, '.pack/mithaq')
const packed = spawnSync(process.execPath, ['apps/pack.ts'], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
assert.equal(packed.status, 0, `apps/pack.ts failed:\n${packed.stdout}\n${packed.stderr}`)

const tracked = (path: string) => execFileSync('git', ['ls-files', path], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).map((file) => file.slice(path.length + 1)).sort()
const filesUnder = (folder: string) => readdirSync(join(staged, folder), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(join(staged, folder).length + 1)).sort()
const guides = ['packages/mithaq/src/drizzle/sqlite/README.md', 'packages/mithaq/README.md', 'packages/mithaq/src/auth/better-auth/README.md', 'packages/mithaq/src/asas/cli/README.md', 'packages/mithaq/src/asas/runner/README.md', 'packages/mithaq/src/drizzle/README.md', 'packages/mithaq-admin/README.md', 'packages/mithaq-rich-text/README.md', 'templates/asas/README.md']

test('the mithaq package ships each user guide as the repository holds it, and every link between them resolves inside the package', () => {
  assert.deepEqual(filesUnder('docs'), execFileSync('git', ['ls-files', ...guides], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).sort(), 'the tracked guides alone, no contributor AGENTS.md')
  assert.equal(filesUnder('docs').length, guides.length)
  for (const guide of guides) {
    const text = readFileSync(join(staged, 'docs', guide), 'utf8')
    assert.equal(text, readFileSync(join(root, guide), 'utf8'), guide)
    for (const [, link] of text.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) assert.ok(existsSync(join(staged, 'docs', dirname(guide), link!)), `${guide} links ${link}`)
  }
  assert.ok((JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')) as { files: string[] }).files.includes('docs'), 'and npm packs them')
})

test('the mithaq package ships the workflow skills a created project carries in .claude/skills, at that version', () => {
  const skills = join(root, 'templates/asas/.claude/skills')
  for (const skill of readdirSync(skills)) assert.equal(readFileSync(join(staged, 'skills', skill, 'SKILL.md'), 'utf8'), readFileSync(join(skills, skill, 'SKILL.md'), 'utf8'), skill)
  assert.ok((JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')) as { files: string[] }).files.includes('skills'), 'and npm packs them')
})

test('the skills and the license notices staged are exactly the files git tracks there', () => {
  assert.deepEqual(filesUnder('skills'), tracked('templates/asas/.claude/skills'))
  assert.deepEqual(filesUnder('LICENSES'), tracked('LICENSES'))
})

test('the staged mithaq package ships the release changelog and includes it in the npm file list', () => {
  const changelog = readFileSync(join(staged, 'CHANGELOG.md'), 'utf8')
  assert.equal(changelog.replaceAll('](docs/', ']('), readFileSync(join(root, 'CHANGELOG.md'), 'utf8'))
  for (const [, link] of changelog.matchAll(/\]\((?![a-z]+:|#)([^)#\s]+)/gi)) {
    assert.ok(existsSync(join(staged, link!)), `CHANGELOG.md links ${link}`)
  }
  const manifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')) as { files: string[] }
  assert.ok(manifest.files.includes('CHANGELOG.md'))
})

test('four staged packages share a release and core and admin pin the one shared rich text package', () => {
  const manifest = (name: string) => JSON.parse(readFileSync(join(root, '.pack', name, 'package.json'), 'utf8'))
  const version = manifest('mithaq').version
  for (const name of ['mithaq', 'mithaq-admin', 'mithaq-rich-text', 'create-mithaq']) assert.equal(manifest(name).version, version, name)
  for (const name of ['mithaq', 'mithaq-admin']) assert.equal(manifest(name).dependencies['@drhomet/mithaq-rich-text'], version, name)
  const rich = manifest('mithaq-rich-text')
  assert.equal(rich.name, '@drhomet/mithaq-rich-text')
  assert.equal(rich.dependencies, undefined, 'phone consumers install no server dependencies')
  for (const version of Object.values(rich.peerDependencies)) assert.equal(version, '0.52.0')
  for (const entry of Object.values(rich.exports)) assert.ok(existsSync(join(root, '.pack/mithaq-rich-text', entry as string)))
  assert.ok(existsSync(join(root, '.pack/mithaq-rich-text', rich.bin['mithaq-check-rich-text'])))
  assert.ok(existsSync(join(root, '.pack/mithaq-rich-text/LICENSE')))
  assert.ok(existsSync(join(root, '.pack/mithaq-rich-text/README.md')))
})

test('ejected pieces name the shared package at the same release version', () => {
  const admin = join(root, '.pack/mithaq-admin')
  const { version } = JSON.parse(readFileSync(join(admin, 'package.json'), 'utf8'))
  const { items } = JSON.parse(readFileSync(join(admin, 'registry.json'), 'utf8')) as { items: { name: string; dependencies?: string[]; files: { path: string }[] }[] }
  let shared = 0
  for (const item of items) {
    const importsShared = item.files.some(({ path }) => readFileSync(join(admin, path), 'utf8').includes("from '@drhomet/mithaq-rich-text/"))
    if (importsShared) shared++
    assert.deepEqual((item.dependencies ?? []).filter((one) => one.startsWith('@drhomet/mithaq-rich-text')), importsShared ? [`@drhomet/mithaq-rich-text@${version}`] : [], item.name)
  }
  assert.ok(shared > 0)
})
