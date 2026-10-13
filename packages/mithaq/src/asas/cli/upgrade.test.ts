import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { hashOf, mark, upgradeCheck } from './upgrade.ts'

const exec = promisify(execFile)
const bin = new URL('./mithaq.ts', import.meta.url).pathname
const upstream = 'import { a } from "a"\nexport const now = a\n'
const older = 'import { a } from "a"\nexport const then = a\n'
const copied = (body: string, from = body) => `${body}// mithaq-admin 0123456789abcdef0123456789abcdef01234567 ${hashOf(from)}\n`

// One item of seven files, each at a target of one of the two forms the real registry writes.
const project = async (copies: Record<string, string>, at?: URL) => {
  const root = at ?? pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  const write = async (path: string, text: string) => {
    await mkdir(new URL('.', new URL(path, root)), { recursive: true })
    await writeFile(new URL(path, root), text)
  }
  await write('package.json', '{ "name": "probe", "private": true }')
  await write('components.json', JSON.stringify({ aliases: { components: '@/components' } }))
  await write('src/.keep', '')
  const names = ['current', 'edited', 'differs', 'differs-edited', 'unmarked', 'absent', 'rooted']
  const files = names.map((name) => ({
    path: `registry/${name}.ts`,
    type: 'registry:lib',
    target: name === 'rooted' ? `~/src/${name}.ts` : `@components/mithaq/${name}.ts`,
    // The registry's own leading comment, which `shadcn add` drops.
    content: `/** The registry's note. */\n${upstream}`,
  }))
  await write('node_modules/mithaq-admin/package.json', '{ "name": "mithaq-admin" }')
  await write('node_modules/mithaq-admin/r/registry.json', JSON.stringify({ items: [{ name: 'probe', files }] }))
  await write('node_modules/mithaq-admin/r/probe.json', JSON.stringify({ name: 'probe', files }))
  await mark(new URL('node_modules/mithaq-admin/r/', root))
  for (const [path, text] of Object.entries(copies)) await write(path, text)
  return root
}

const everyCase = {
  // What `shadcn add` writes: the registry's text with its leading comment gone.
  'src/components/mithaq/current.ts': copied(upstream),
  'src/components/mithaq/edited.ts': copied(`${upstream}// mine\n`, upstream),
  'src/components/mithaq/differs.ts': copied(older),
  'src/components/mithaq/differs-edited.ts': copied(`${older}// mine\n`, older),
  'src/components/mithaq/unmarked.ts': upstream,
  'src/rooted.ts': copied(upstream),
}

/** A `mithaq.lock` signed by a throwaway key over the language a fixture project's `src/mithaq.ts` defines. */
const signedLock = async (root: URL) => {
  const { defineKayan } = (await import(new URL('src/mithaq.ts', root).href)) as { defineKayan: unknown }
  const { formatLock, sealLanguage, vocabularyOf } = await import('../../mithaq/lock.ts')
  const { receivedLanguage } = await import('../../mithaq/language.ts')
  const { generateKeyPairSync } = await import('node:crypto')
  await writeFile(new URL('mithaq.lock', root), formatLock(sealLanguage({ language: vocabularyOf(receivedLanguage(defineKayan)), key: generateKeyPairSync('ed25519').privateKey })))
}

test('the build marks every file it ships on its last line, with the commit and the hash of what shadcn add writes', async (t) => {
  const root = await project({})
  t.after(() => rm(root, { recursive: true, force: true }))
  const built = JSON.parse(await readFile(new URL('node_modules/mithaq-admin/r/probe.json', root), 'utf8')) as { files: { content: string }[] }
  for (const file of built.files) {
    assert.match(file.content, /\n\/\/ mithaq-admin (?:[0-9a-f]{40}|unknown) [0-9a-f]{64}\n$/)
    assert.ok(file.content.endsWith(`${hashOf(upstream)}\n`), 'the hash ignores the leading comment shadcn add strips')
  }
  // Marking twice leaves one marker, so a rebuild over a marked `r/` holds.
  await mark(new URL('node_modules/mithaq-admin/r/', root))
  const again = JSON.parse(await readFile(new URL('node_modules/mithaq-admin/r/probe.json', root), 'utf8')) as { files: { content: string }[] }
  assert.equal(again.files[0]!.content.split('// mithaq-admin').length, 2)
})

test('each copied file reads one state, and a file the project never copied is not listed', async (t) => {
  const root = await project(everyCase)
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(
    (await upgradeCheck(root))!.map(({ path, state }) => [path, state]),
    [
      ['src/components/mithaq/current.ts', 'up to date'],
      ['src/components/mithaq/edited.ts', 'up to date, edited'],
      ['src/components/mithaq/differs.ts', 'differs'],
      ['src/components/mithaq/differs-edited.ts', 'differs, edited'],
      ['src/components/mithaq/unmarked.ts', 'unknown'],
      ['src/rooted.ts', 'up to date'],
    ],
  )
})

test('a copied file no registry item names any more is reported removed, and a file of the project\'s own beside it is not', async (t) => {
  // An item the registry dropped.
  const root = await project({
    'src/components/mithaq/current.ts': copied(upstream),
    'src/components/mithaq/join-control.tsx': copied(older),
    'src/components/mithaq/mine.ts': upstream,
  })
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(
    (await upgradeCheck(root))!.map(({ path, state }) => [path, state]),
    [
      ['src/components/mithaq/current.ts', 'up to date'],
      ['src/components/mithaq/join-control.tsx', 'removed'],
    ],
  )
  const { stdout } = await exec(process.execPath, [bin, 'upgrade', '--check'], { cwd: root.pathname })
  assert.match(stdout, /src\/components\/mithaq\/join-control\.tsx was copied from mithaq-admin at 0123456789ab, and no item of the installed registry names it any more: it was removed from the registry, so delete it\./)
})

test('upgrade --check exits 1 when a file differs from the installed registry, says which side is newer is not known, writes nothing, and exits 0 when none differs', async (t) => {
  const differing = await project(everyCase)
  const current = await project({ 'src/components/mithaq/current.ts': copied(upstream), 'src/components/mithaq/unmarked.ts': upstream })
  t.after(() => Promise.all([differing, current].map((root) => rm(root, { recursive: true, force: true }))))
  const failed = await exec(process.execPath, [bin, 'upgrade', '--check'], { cwd: differing.pathname }).then(
    () => assert.fail('a differing file fails the check'),
    (error: { code: number; stdout: string; stderr: string }) => error,
  )
  assert.equal(failed.code, 1)
  // A hash proves a difference, never its direction nor that a replacement loses nothing.
  assert.match(failed.stdout, /src\/components\/mithaq\/differs\.ts differs from the installed mithaq-admin's copy \(built at \S+\), and is not edited since it was copied from 0123456789ab\. A hash shows a difference, not which side is newer: diff the two, or rebuild mithaq-admin, before replacing it\./)
  assert.match(failed.stdout, /src\/components\/mithaq\/differs-edited\.ts differs from the installed mithaq-admin's copy \(built at \S+\), and is edited since it was copied from 0123456789ab: diff the two and merge by hand\./)
  assert.doesNotMatch(failed.stdout, /behind|losing nothing/)
  assert.match(failed.stdout, /src\/components\/mithaq\/unmarked\.ts carries no mithaq-admin marker/)
  assert.match(failed.stderr, /2 files differ from the installed mithaq-admin/)
  assert.equal(await readFile(new URL('src/components/mithaq/differs.ts', differing), 'utf8'), everyCase['src/components/mithaq/differs.ts'], 'and it wrote nothing')
  const passed = await exec(process.execPath, [bin, 'upgrade', '--check'], { cwd: current.pathname })
  assert.match(passed.stdout, /src\/components\/mithaq\/current\.ts is up to date/)
  // `upgrade` only reports, so the bare word is the usage line.
  await assert.rejects(exec(process.execPath, [bin, 'upgrade'], { cwd: current.pathname }), /Usage: /)
})

test('a project with no components.json copied nothing, and says so', async (t) => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  t.after(() => rm(root, { recursive: true, force: true }))
  const { stdout } = await exec(process.execPath, [bin, 'upgrade', '--check'], { cwd: root.pathname })
  assert.match(stdout, /No components\.json/)
})

test("this repository's app holds every registry file it copied up to date and unedited", async () => {
  const app = new URL('../../../../../apps/asas-tanstack/', import.meta.url)
  const states = (await upgradeCheck(app))!
  assert.equal(states.length, 84, 'every file of every item the app copied')
  assert.deepEqual(states.filter((one) => one.state !== 'up to date'), [])
})

test('the sweep reports the copies and never fails on them: no mithaq-admin, or a components.json that does not parse, answers 0', async (t) => {
  // A project every other step of the sweep passes.
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(new URL('src/', root))
  // A real, empty language and its signed lock, so the sweep's first step passes.
  await writeFile(
    new URL('src/mithaq.ts', root),
    `import { defineMithaq } from ${JSON.stringify(new URL('../../index.ts', import.meta.url).href)}\nexport const { defineKayan } = defineMithaq({ targets: {}, arkan: [] })\nexport const generate = { auth: 'src/kayan/auth/', providers: '../../../auth.ts', messages: 'src/messages/' }\n`,
  )
  await signedLock(root)
  await writeFile(new URL('src/auth.ts', root), 'export const providers = {}\n')
  await writeFile(new URL('src/asas.ts', root), "export const asas = { messages: { locales: ['en'], scopes: [], localized: [], collisions: {} }, targets: {}, connect: async () => {}, destroy: async () => {} }\n")
  await writeFile(new URL('components.json', root), '{}')
  // No registry to read is said plainly, never as "nothing copied".
  const missing = /No mithaq-admin registry to check the copies against: none is installed here, and the installed mithaq ships no r\/ at \S+\/r\//
  const bare = await exec(process.execPath, [bin, 'generate', '--check'], { cwd: root.pathname })
  assert.match(bare.stdout, missing)
  assert.doesNotMatch(bare.stdout, /Nothing from mithaq-admin here/)
  // Standalone, the same project answers the same thing rather than a refusal.
  const alone = await exec(process.execPath, [bin, 'upgrade', '--check'], { cwd: root.pathname })
  assert.match(alone.stdout, missing)
  await writeFile(new URL('components.json', root), '{')
  const malformed = await exec(process.execPath, [bin, 'generate', '--check'], { cwd: root.pathname })
  assert.match(malformed.stderr, /upgrade --check could not read the copies: .*JSON/)
})

test('with no mithaq-admin installed, the copies are read against the r/ the installed mithaq ships, as it is published', async (t) => {
  const base = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  t.after(() => rm(base, { recursive: true, force: true }))
  // The published layout: this module under `dist/asas/cli/` and the registry three folders up.
  const published = new URL('mithaq/', base)
  await mkdir(new URL('dist/asas/cli/', published), { recursive: true })
  await writeFile(new URL('package.json', published), '{ "type": "module" }')
  await cp(fileURLToPath(new URL('./upgrade.ts', import.meta.url)), fileURLToPath(new URL('dist/asas/cli/upgrade.ts', published)))
  const files = [{ path: 'registry/current.ts', type: 'registry:lib', target: '@components/mithaq/current.ts', content: older }]
  await mkdir(new URL('r/', published))
  await writeFile(new URL('r/registry.json', published), JSON.stringify({ items: [{ name: 'probe', files }] }))
  await writeFile(new URL('r/probe.json', published), JSON.stringify({ name: 'probe', files }))
  await mark(new URL('r/', published))
  const root = new URL('project/', base)
  await mkdir(new URL('src/components/mithaq/', root), { recursive: true })
  await writeFile(new URL('package.json', root), '{ "name": "probe", "private": true }')
  await writeFile(new URL('components.json', root), JSON.stringify({ aliases: { components: '@/components' } }))
  await writeFile(new URL('src/components/mithaq/current.ts', root), copied(older))
  const shipped = (await import(new URL('dist/asas/cli/upgrade.ts', published).href)) as typeof import('./upgrade.ts')
  assert.deepEqual((await shipped.upgradeCheck(root))?.map(({ path, state }) => [path, state]), [['src/components/mithaq/current.ts', 'up to date']])
  // A copy that differs names the registry it was read against, which is no
  // installed mithaq-admin, and nothing to rebuild.
  await writeFile(new URL('src/components/mithaq/current.ts', root), copied(upstream))
  const run = `import { run } from ${JSON.stringify(new URL('dist/asas/cli/upgrade.ts', published).href)}; process.exitCode = await run(new URL('${root.href}'))`
  const failed = await exec(process.execPath, ['--input-type=module', '-e', run], { cwd: fileURLToPath(root) }).catch((error: { stdout: string; stderr: string }) => error)
  assert.match(failed.stdout, /src\/components\/mithaq\/current\.ts differs from the copy in the registry the installed mithaq ships \(built at \S+\), and is not edited since it was copied from 0123456789ab\. A hash shows a difference, not which side is newer: diff the two before replacing it\./)
  assert.match(failed.stderr, /1 file differs from the registry the installed mithaq ships/)
  assert.doesNotMatch(`${failed.stdout}${failed.stderr}`, /installed mithaq-admin|rebuild mithaq-admin/)
  // An installed mithaq-admin, which ships another text, still comes first, as
  // it does in this repository.
  await project({}, root)
  assert.deepEqual((await shipped.upgradeCheck(root))?.map(({ path, state }) => [path, state]), [['src/components/mithaq/current.ts', 'up to date']])
})

test('a target or an item name that climbs out of its folder is reported outside and read nowhere', async (t) => {
  const base = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = new URL('project/', base)
  await project({}, root)
  // Every escape a registry or a components.json could write, each with a
  // file waiting where it lands, so reading one would list it.
  await writeFile(new URL('components.json', root), JSON.stringify({ aliases: { components: '@/../../outside' } }))
  const registry = new URL('node_modules/mithaq-admin/r/', root)
  const probe = JSON.parse(await readFile(new URL('probe.json', registry), 'utf8')) as { files: { target: string; content: string }[] }
  probe.files.push({ ...probe.files[0]!, target: '~/../escape.ts' })
  await writeFile(new URL('probe.json', registry), JSON.stringify(probe))
  await writeFile(new URL('registry.json', registry), JSON.stringify({ items: [{ name: 'probe' }, { name: '../../escape' }] }))
  await writeFile(new URL('node_modules/escape.json', root), JSON.stringify(probe))
  await writeFile(new URL('escape.ts', base), copied(upstream))
  await mkdir(new URL('outside/mithaq/', base), { recursive: true })
  await writeFile(new URL('outside/mithaq/current.ts', base), copied(upstream))
  assert.deepEqual(
    (await upgradeCheck(root))!.map(({ path, state }) => [path, state]),
    [
      ...['current', 'edited', 'differs', 'differs-edited', 'unmarked', 'absent'].map((name) => [`@components/mithaq/${name}.ts`, 'outside']),
      ['~/../escape.ts', 'outside'],
      ['../../escape', 'outside'],
    ],
  )
})

