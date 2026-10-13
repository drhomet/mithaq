import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createServer } from 'vite'
import { mithaqAdmin } from '../../vite.ts'
import { hashOf, stateOf, upgradeCheck } from './upgrade.ts'

const exec = promisify(execFile)
const bin = new URL('./mithaq.ts', import.meta.url).pathname
const upstream = 'import { a } from "a"\nexport const now = a\n'
const older = 'import { a } from "a"\nexport const then = a\n'
// A copy `shadcn add` made before the package: its marker names the commit it was built at.
const copied = (body: string, from = body) => `${body}// mithaq-admin 0123456789abcdef0123456789abcdef01234567 ${hashOf(from)}\n`
// What an eject writes: the hash of exactly the text above the marker.
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
// The package's own text, with the leading comment an older copy lost to `shadcn add`.
const packaged = `/** The package's note. */\n${upstream}`

const write = async (root: URL, path: string, text: string) => {
  await mkdir(new URL('.', new URL(path, root)), { recursive: true })
  await writeFile(new URL(path, root), text)
}

// One item of seven files, each at a target of one of the two forms the package names, installed as a real folder.
const project = async (copies: Record<string, string>, at?: URL) => {
  const root = at ?? pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  await write(root, 'package.json', '{ "name": "probe", "private": true }')
  await write(root, 'components.json', JSON.stringify({ aliases: { components: '@/components', ui: '@/components/ui' } }))
  await write(root, 'src/.keep', '')
  const names = ['current', 'edited', 'differs', 'differs-edited', 'unmarked', 'absent', 'rooted']
  const files = names.map((name) =>
    name === 'rooted' ? { path: `registry/host/${name}.ts`, target: `~/src/${name}.ts` } : { path: `registry/${name}.ts`, target: `@components/mithaq/${name}.ts` },
  )
  await write(root, 'node_modules/mithaq-admin/package.json', JSON.stringify({ name: 'mithaq-admin', version: '1.2.3', type: 'module', exports: { './package.json': './package.json', './registry.json': './registry.json', './*': './registry/*' } }))
  await write(root, 'node_modules/mithaq-admin/registry.json', JSON.stringify({ items: [{ name: 'mithaq-probe', files }] }))
  for (const file of files) await write(root, `node_modules/mithaq-admin/${file.path}`, packaged)
  for (const [path, text] of Object.entries(copies)) await write(root, path, text)
  return root
}

const everyCase = {
  'src/components/mithaq/current.ts': copied(upstream),
  'src/components/mithaq/edited.ts': copied(`${upstream}// mine\n`, upstream),
  'src/components/mithaq/differs.ts': copied(older),
  'src/components/mithaq/differs-edited.ts': copied(`${older}// mine\n`, older),
  'src/components/mithaq/unmarked.ts': upstream,
  'src/rooted.ts': copied(upstream),
}

const mithaq = (root: URL, ...args: string[]) => exec(process.execPath, [bin, ...args], { cwd: fileURLToPath(root) })
const failed = (root: URL, ...args: string[]) =>
  mithaq(root, ...args).then(
    () => assert.fail(`mithaq ${args.join(' ')} fails`),
    (error: { code: number; stdout: string; stderr: string }) => error,
  )

/** A `mithaq.lock` signed by a throwaway key over the language a fixture project's `src/mithaq.ts` defines. */
const signedLock = async (root: URL) => {
  const { defineKayan } = (await import(new URL('src/mithaq.ts', root).href)) as { defineKayan: unknown }
  const { formatLock, sealLanguage, vocabularyOf } = await import('../../mithaq/lock.ts')
  const { receivedLanguage } = await import('../../mithaq/language.ts')
  const { generateKeyPairSync } = await import('node:crypto')
  await writeFile(new URL('mithaq.lock', root), formatLock(sealLanguage({ language: vocabularyOf(receivedLanguage(defineKayan)), key: generateKeyPairSync('ed25519').privateKey })))
}

test('each file the project holds reads one state against the installed package, and a file it never ejected is not listed', async (t) => {
  const root = await project(everyCase)
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(
    (await upgradeCheck(root))!.map(({ path, state, to }) => [path, state, to]),
    [
      ['src/components/mithaq/current.ts', 'up to date', '1.2.3'],
      ['src/components/mithaq/edited.ts', 'up to date, edited', '1.2.3'],
      ['src/components/mithaq/differs.ts', 'differs', '1.2.3'],
      ['src/components/mithaq/differs-edited.ts', 'differs, edited', '1.2.3'],
      ['src/components/mithaq/unmarked.ts', 'unknown', '1.2.3'],
      ['src/rooted.ts', 'up to date', '1.2.3'],
    ],
  )
})

test('a marked file no item names any more is reported removed, and a file of the project\'s own beside it is not', async (t) => {
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
  const { stdout } = await mithaq(root, 'upgrade', '--check')
  assert.match(stdout, /src\/components\/mithaq\/join-control\.tsx was ejected from mithaq-admin 0123456789ab, and no item of the installed package names it any more: it was removed from the package, so delete it\./)
})

test('upgrade --check exits 1 when a file differs from the installed package, says which side is newer is not known, writes nothing, and exits 0 when none differs', async (t) => {
  // A held file at the project's root, which the app needs: deleting it would break the app.
  const differing = await project({ ...everyCase, 'src/rooted.ts': copied(older) })
  const current = await project({ 'src/components/mithaq/current.ts': copied(upstream), 'src/components/mithaq/unmarked.ts': upstream })
  t.after(() => Promise.all([differing, current].map((root) => rm(root, { recursive: true, force: true }))))
  const failure = await failed(differing, 'upgrade', '--check')
  assert.equal(failure.code, 1)
  // A hash proves a difference, never its direction nor that a replacement loses nothing.
  assert.match(failure.stdout, /src\/components\/mithaq\/differs\.ts differs from the installed mithaq-admin's file \(1\.2\.3\), and is not edited since it was ejected from 0123456789ab\. A hash shows a difference, not which side is newer: diff the two before replacing it, or delete it to draw the package's\./)
  assert.match(failure.stdout, /src\/components\/mithaq\/differs-edited\.ts differs from the installed mithaq-admin's file \(1\.2\.3\), and is edited since it was ejected from 0123456789ab: diff the two and merge by hand\./)
  assert.doesNotMatch(failure.stdout, /behind|losing nothing/)
  assert.match(failure.stdout, /src\/components\/mithaq\/unmarked\.ts carries no mithaq-admin marker/)
  assert.match(failure.stdout, /src\/rooted\.ts differs from the installed mithaq-admin's file \(1\.2\.3\), and is not edited since it was ejected from 0123456789ab\. A hash shows a difference, not which side is newer: diff the two before replacing it, or delete it and run `mithaq eject mithaq-probe` to take the package's\./)
  assert.doesNotMatch(failure.stdout, /rooted\.ts.*delete it to draw/)
  assert.match(failure.stderr, /3 files differ from the installed mithaq-admin/)
  assert.equal(await readFile(new URL('src/components/mithaq/differs.ts', differing), 'utf8'), everyCase['src/components/mithaq/differs.ts'], 'and it wrote nothing')
  const passed = await mithaq(current, 'upgrade', '--check')
  assert.match(passed.stdout, /src\/components\/mithaq\/current\.ts is up to date/)
  // `upgrade` only reports, so the bare word is the usage line.
  await assert.rejects(mithaq(current, 'upgrade'), /Usage: /)
})

test('a project with no components.json says nothing says where the files go', async (t) => {
  const root = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  t.after(() => rm(root, { recursive: true, force: true }))
  const { stdout } = await mithaq(root, 'upgrade', '--check')
  assert.match(stdout, /No components\.json/)
})

test("this repository's app holds the host and the icon up to date and unedited, and nothing else of the package", async () => {
  const app = new URL('../../../../../apps/asas-tanstack/', import.meta.url)
  const states = (await upgradeCheck(app))!
  assert.equal(states.length, 13, 'the host and the icon, the files the app holds')
  assert.deepEqual(states.filter((one) => one.state !== 'up to date'), [])
})

test('the sweep reports the files and never fails on them: no mithaq-admin, or a components.json that does not parse, answers 0', async (t) => {
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
  // No package to read is said plainly, never as "nothing ejected".
  const missing = /No mithaq-admin is installed here\. Nothing to check the files against\./
  const bare = await mithaq(root, 'generate', '--check')
  assert.match(bare.stdout, missing)
  assert.doesNotMatch(bare.stdout, /Nothing from mithaq-admin here/)
  // Standalone, the same project answers the same thing rather than a refusal.
  assert.match((await mithaq(root, 'upgrade', '--check')).stdout, missing)
  await writeFile(new URL('components.json', root), '{')
  const malformed = await mithaq(root, 'generate', '--check')
  assert.match(malformed.stderr, /upgrade --check could not read the copies: .*JSON/)
})

test('a target or a package path that climbs out of its folder is reported outside and read nowhere, and eject writes nothing for it', async (t) => {
  const base = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'mithaq-upgrade-'))}/`)
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = new URL('project/', base)
  await project({}, root)
  // Every escape a package or a components.json could write, each with a file waiting where it lands, so reading one would list it.
  await writeFile(new URL('components.json', root), JSON.stringify({ aliases: { components: '@/../../outside' } }))
  const registry = new URL('node_modules/mithaq-admin/registry.json', root)
  const probe = JSON.parse(await readFile(registry, 'utf8')) as { items: { name: string; files: { path: string; target: string }[] }[] }
  probe.items[0]!.files.push({ path: 'registry/current.ts', target: '~/../escape.ts' }, { path: 'registry/../../../escape.ts', target: '~/src/escape.ts' })
  await writeFile(registry, JSON.stringify(probe))
  await writeFile(new URL('escape.ts', base), copied(upstream))
  await writeFile(new URL('node_modules/escape.ts', root), packaged)
  await mkdir(new URL('outside/mithaq/', base), { recursive: true })
  await writeFile(new URL('outside/mithaq/current.ts', base), copied(upstream))
  assert.deepEqual(
    (await upgradeCheck(root))!.map(({ path, state }) => [path, state]),
    [
      ...['current', 'edited', 'differs', 'differs-edited', 'unmarked', 'absent'].map((name) => [`@components/mithaq/${name}.ts`, 'outside']),
      ['~/../escape.ts', 'outside'],
      ['registry/../../../escape.ts', 'outside'],
    ],
  )
  const refused = await failed(root, 'eject', 'probe')
  assert.match(refused.stderr, /resolves outside this project or the package, so nothing was written/)
  assert.ok(!existsSync(new URL('src/escape.ts', root)) && !existsSync(new URL('src/rooted.ts', root)), 'and no file of the item was written')
})

/** A package of three pieces that import each other by its name, as the real one does, with what an item lacks named. */
const pieces = async () => {
  const root = await project({})
  const piece = (name: string, text: string) => write(root, `node_modules/mithaq-admin/registry/${name}`, text)
  await piece('copy.ts', "export const who = 'package'\n")
  await piece('widget.ts', "import { who } from 'mithaq-admin/copy.ts'\nexport const widget = `widget sees ${who}`\n")
  // With no newline at its end, which an eject adds before the marker.
  await piece('list.ts', "import { widget } from 'mithaq-admin/widget.ts'\nexport const list = `list holds ${widget}`")
  const files = (name: string) => [{ path: `registry/${name}.ts`, target: `@components/mithaq/${name}.ts` }]
  await write(root, 'node_modules/mithaq-admin/registry.json', JSON.stringify({
    items: [
      { name: 'mithaq-copy', files: files('copy'), registryDependencies: ['button', 'card'], dependencies: ['lexical@0.52.0', 'node:fs'] },
      { name: 'mithaq-widget', files: files('widget') },
      { name: 'mithaq-list', files: files('list') },
      { name: 'mithaq-probe', files: [{ path: 'registry/host/rooted.ts', target: '~/src/rooted.ts' }] },
    ],
  }))
  await write(root, 'src/components/ui/button.tsx', 'export const Button = null\n')
  await write(root, 'src/entry.ts', "import { who } from 'mithaq-admin/copy.ts'\nimport { list } from 'mithaq-admin/list.ts'\nexport const seen = { who, list }\n")
  return root
}

const served = async (root: URL) => {
  const server = await createServer({ root: fileURLToPath(root), configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, plugins: [mithaqAdmin(fileURLToPath(new URL('src/components/mithaq/', root)))] })
  try {
    return (await server.ssrLoadModule('/src/entry.ts')).seen as { who: string; list: string }
  } finally {
    await server.close()
  }
}

test('eject writes the piece byte for byte with a marker, every importer draws it, and a second eject leaves an edit alone', async (t) => {
  const root = await pieces()
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(await served(root), { who: 'package', list: 'list holds widget sees package' })
  for (const name of ['copy', 'copy.ts', 'mithaq-copy']) {
    await rm(new URL('src/components/mithaq/', root), { recursive: true, force: true })
    const { stdout } = await mithaq(root, 'eject', name)
    assert.match(stdout, /src\/components\/mithaq\/copy\.ts is ejected\. Edit it in place; delete it to draw mithaq-admin's again\./, name)
  }
  const text = "export const who = 'package'\n"
  const at = new URL('src/components/mithaq/copy.ts', root)
  assert.equal(await readFile(at, 'utf8'), `${text}// mithaq-admin 1.2.3 ${sha(text)}\n`)
  assert.deepEqual((await upgradeCheck(root))!.map(({ path, state }) => [path, state]), [['src/components/mithaq/copy.ts', 'up to date']], 'and upgrade --check reads it up to date')
  await writeFile(at, (await readFile(at, 'utf8')).replace("'package'", "'ejected'"))
  assert.deepEqual(await served(root), { who: 'ejected', list: 'list holds widget sees ejected' }, 'the app, and the package\'s widget through its list, draw the edit')
  const again = await mithaq(root, 'eject', 'copy')
  assert.match(again.stdout, /src\/components\/mithaq\/copy\.ts is already ejected, so it was left as it is\./)
  assert.match(await readFile(at, 'utf8'), /'ejected'/, 'and the edit stands')
  // No sibling is copied, and what the item lacks is named, never installed.
  assert.ok(!existsSync(new URL('src/components/mithaq/widget.ts', root)))
  assert.match(again.stdout, /src\/components\/ui\/card\.tsx is missing: run shadcn add card/)
  assert.doesNotMatch(again.stdout, /button/)
  assert.match(again.stdout, /lexical is not installed: install lexical@0\.52\.0/)
  assert.doesNotMatch(again.stdout, /node:fs/)
  assert.equal(await readFile(new URL('package.json', root), 'utf8'), '{ "name": "probe", "private": true }', 'and package.json is not touched')
})

test('eject refuses an unknown item by listing the items, and a word with an item and --prune is the usage line', async (t) => {
  const root = await pieces()
  t.after(() => rm(root, { recursive: true, force: true }))
  const unknown = await failed(root, 'eject', 'nothing')
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /mithaq-admin has no item "nothing"\. Its items are: mithaq-copy, mithaq-widget, mithaq-list, mithaq-probe\./)
  for (const args of [['eject'], ['eject', 'copy', '--prune'], ['eject', '--check']]) assert.match((await failed(root, ...args)).stderr, /Usage: /, args.join(' '))
})

test('eject --prune deletes each unedited ejected piece, stale ones too, and never an edited, unmarked or project-root file', async (t) => {
  const root = await pieces()
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['copy', 'widget', 'list']) await mithaq(root, 'eject', name)
  // A file the project always holds is never deleted, so its eject says nothing of deleting it.
  assert.equal((await mithaq(root, 'eject', 'probe')).stdout, 'src/rooted.ts is ejected. Edit it in place.\n')
  const at = (path: string) => new URL(path, root)
  await writeFile(at('src/components/mithaq/widget.ts'), `${await readFile(at('src/components/mithaq/widget.ts'), 'utf8')}// mine\n`)
  await write(root, 'src/components/mithaq/mine.ts', 'export const mine = 1\n')
  await write(root, 'src/components/mithaq/stale.ts', copied(older))
  const { stdout } = await mithaq(root, 'eject', '--prune')
  assert.match(stdout, /src\/components\/mithaq\/copy\.ts was not edited since it was ejected, so it is deleted and mithaq-admin draws its own\./)
  assert.deepEqual(
    ['copy', 'list', 'stale', 'widget', 'mine'].map((name) => existsSync(at(`src/components/mithaq/${name}.ts`))),
    [false, false, false, true, true],
    'the unedited and the stale go; the edited and the project\'s own stay',
  )
  assert.ok(existsSync(at('src/rooted.ts')), 'a file at the project\'s root is the project\'s, ejected or not')
})

test('an edit only in the leading comments of an ejected file is an edit, so prune keeps it, and a file ejected with a newline added hashes what was written', async (t) => {
  const root = await pieces()
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['copy', 'list']) await mithaq(root, 'eject', name)
  const at = (path: string) => new URL(path, root)
  const list = "import { widget } from 'mithaq-admin/widget.ts'\nexport const list = `list holds ${widget}`\n"
  assert.equal(await readFile(at('src/components/mithaq/list.ts'), 'utf8'), `${list}// mithaq-admin 1.2.3 ${sha(list)}\n`)
  await writeFile(at('src/components/mithaq/copy.ts'), `// @ts-nocheck\n${await readFile(at('src/components/mithaq/copy.ts'), 'utf8')}`)
  assert.deepEqual(
    (await upgradeCheck(root))!.map(({ path, state }) => [path, state]),
    [['src/components/mithaq/copy.ts', 'up to date, edited'], ['src/components/mithaq/list.ts', 'up to date']],
  )
  await mithaq(root, 'eject', '--prune')
  assert.deepEqual(['copy', 'list'].map((name) => existsSync(at(`src/components/mithaq/${name}.ts`))), [true, false], 'the pragma stands, and the unedited list goes')
})

test('a held file with a leading comment, freshly ejected, reads up to date by the check the repository holds its own files to', async (t) => {
  const root = await project({})
  t.after(() => rm(root, { recursive: true, force: true }))
  await mithaq(root, 'eject', 'probe')
  const ejected = await readFile(new URL('src/rooted.ts', root), 'utf8')
  assert.ok(ejected.startsWith(packaged), 'the leading comment is written')
  assert.equal(stateOf(ejected, packaged), 'up to date')
  assert.equal(stateOf(`// mine\n${ejected}`, packaged), 'up to date, edited')
  assert.equal(stateOf(copied(upstream), packaged), 'up to date', 'and a copy shadcn add made reads as it always did')
})

test('prune keeps a copy shadcn add made whose leading block differs from the package file, and deletes one whose leading block is empty or that of the package file', async (t) => {
  const root = await project({
    'src/components/mithaq/current.ts': copied(upstream),
    'src/components/mithaq/edited.ts': `// @ts-nocheck\n${copied(upstream)}`,
    'src/components/mithaq/differs.ts': copied(packaged, upstream),
  })
  t.after(() => rm(root, { recursive: true, force: true }))
  await mithaq(root, 'eject', '--prune')
  assert.deepEqual(['current', 'edited', 'differs'].map((name) => existsSync(new URL(`src/components/mithaq/${name}.ts`, root))), [false, true, false])
})
