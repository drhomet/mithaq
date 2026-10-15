// `mithaq.lock`: the vocabulary of the object `defineMithaq` received, as plain
// data in one canonical order, signed by the project's owner, and the check that
// turns red when the vocabulary moves without a new signature, and the start that waits on it.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { defaultKinds, defaultRules, defineRukn, storage as storageRukn, versions as versionsRukn, zodTarget } from 'mithaq'
import { defaultNodes, richText as richTextRukn } from 'mithaq/rich-text'
import { checkLock, formatLock, notice, run, sealLanguage, verifyLock, vocabularyOf, warnLock, type Lock, type Seal } from '../../../packages/mithaq/src/mithaq/lock.ts'
import { receivedLanguage } from '../../../packages/mithaq/src/mithaq/language.ts'
import { Refusal } from '../../../packages/mithaq/src/mithaq/refusal.ts'
import { defineKayan } from '../../mithaq/src/mithaq.ts'
import { storageConfig } from '../../mithaq/src/storage/index.ts'

/** The project root, where the template's `mithaq.lock` sits. */
const root = new URL('../', import.meta.url)
const language = receivedLanguage(defineKayan) as Record<string, any>
const block = vocabularyOf(language)
/** A test machine's key: no person approves a test's lock, so the test signs directly. */
const key = generateKeyPairSync('ed25519').privateKey
const lock = sealLanguage({ language: block, key, base: undefined, label: 'test machine' })
const covenant =
  "ميثاق: the language changed and is not signed. Only the project's owner may approve a language change. Stop here, tell the owner what you changed and why, and ask them to run `mithaq lock`."

/**
 * A project of its own in a temporary directory, speaking the template's
 * language, so no test writes the template's own `mithaq.lock`. `at` names a
 * path inside the directory to put the project at.
 */
const project = async (at = '') => {
  const top = await mkdtemp(join(tmpdir(), 'mithaq-project-'))
  const dir = join(top, at)
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src', 'mithaq.ts'), `export { defineKayan } from ${JSON.stringify(new URL('../../mithaq/src/mithaq.ts', import.meta.url).href)}\n`)
  const lockFile = join(dir, 'mithaq.lock')
  return {
    top,
    dir,
    url: pathToFileURL(`${dir}/`),
    lockFile,
    read: async () => JSON.parse(await readFile(lockFile, 'utf8')) as Lock,
    write: (one: Lock) => writeFile(lockFile, formatLock(one)),
    remove: () => rm(top, { recursive: true, force: true }),
  }
}

/** What `fn` printed, to stdout and stderr together, beside what it answered. */
const printing = async <Value>(fn: () => Promise<Value>) => {
  const printed: string[] = []
  const { log, error } = console
  console.log = (...line: unknown[]) => void printed.push(line.join(' '))
  console.error = (...line: unknown[]) => void printed.push(line.join(' '))
  try {
    return { value: await fn(), out: printed.join('\n') }
  } finally {
    console.log = log
    console.error = error
  }
}

/** A machine of its own: a home for its keys that no other test machine shares. */
const machine = () => mkdtemp(join(tmpdir(), 'mithaq-keys-'))
/** An approver who reads the popup and types its number back. */
const approving = (seen: string[] = []) => async (summary: string, code: number) => (seen.push(summary), String(code))
const check = (url: URL) => printing(() => run({ project: url, noun: undefined, flags: ['--check'] }))


test('defineMithaq keeps the object it received, reachable from the defineKayan it returns', () => {
  assert.deepEqual(Object.keys(language).sort(), ['arkan', 'generate', 'locales', 'targets'])
})

// The arkan split the shipped kinds into `base`, `richText` and `upload`, and their merge must sign
// the same kinds and rules as a language that writes them at its root.
// `block` is the template's language, whose arkan are `base`, `richText`,
// `storage` and `versions`, the last two building the storage and versions
// targets.
test('the shipped kinds split into base, richText and upload arkan, and the versions target built by its rukn, record what the root held before them', () => {
  const { text, email, number, integer, decimal, checkbox, datetime, date, textArray, uuid, relationship, json, join: joinKind } = defaultKinds
  const { richText } = richTextRukn({ nodes: defaultNodes }).kinds
  const files = storageRukn(storageConfig)
  const { upload } = files.kinds
  const history = versionsRukn({ max: 100 })
  const arkan = [
    defineRukn({ name: 'base', kinds: { text, email, number, integer, decimal, checkbox, datetime, date, textArray, uuid, relationship, json, join: joinKind }, rules: defaultRules }),
    defineRukn({ name: 'richText', kinds: { richText } }),
    defineRukn({ name: 'storage', kinds: { upload }, targets: files.targets }),
    history,
  ]
  assert.deepEqual(vocabularyOf({ ...language, arkan }), block)
  // A language that writes the same kinds and rules at its root,
  // and lays the storage and versions targets down among its own, records
  // the same vocabulary but for the root keys.
  const { arkan: _arkan, ...root } = language
  const before = vocabularyOf({ ...root, kinds: { ...defaultKinds, richText, upload }, rules: defaultRules, targets: { ...root.targets, ...files.targets, ...history.targets } }) as Record<string, unknown>
  assert.deepEqual(before.keys, ['generate', 'kinds', 'locales', 'rules', 'targets'])
  assert.deepEqual({ ...before, keys: (block as Record<string, unknown>).keys }, block)
})

test('the lock records the vocabulary alone, as plain data, and a lock read back writes the same bytes', () => {
  const text = formatLock(lock)
  assert.equal(JSON.stringify(vocabularyOf(language)), JSON.stringify(block))
  assert.equal(formatLock(JSON.parse(text) as Lock), text)
  assert.deepEqual(Object.keys(block as object), ['keys', 'kinds', 'locales', 'rules', 'targets'])
  assert.deepEqual((block as any).keys, ['arkan', 'generate', 'locales', 'targets'])
  assert.deepEqual((block as any).kinds.checkbox, {
    label: { ar: 'خانة اختيار', en: 'Checkbox' },
    message: { ar: 'يجاب على هذا بنعم أو لا.', en: 'This is answered yes or no.' },
    rules: ['providedBy', 'required', 'index', 'defaultValue'],
  })
  assert.deepEqual((block as any).rules.uppercase, { excludes: ['lowercase'] })
  assert.deepEqual((block as any).targets, {
    dashboard: 'screen',
    drizzle: 'store',
    backoffice: 'screen',
    portal: 'screen',
    rbac: 'access',
    service: 'service',
    storage: 'storage',
    tenant: 'tenant',
    versions: 'versions',
    zod: 'schema',
  })
  const recorded = JSON.stringify(block)
  assert.doesNotMatch(recorded, /sha256:/, 'no function is hashed')
  assert.doesNotMatch(recorded, /src\//, 'no path of the project is written')
  assert.doesNotMatch(recorded, /postgres(ql)?:\/\//, 'and no connection string')
})

test('the same language writes the same lock under Bun and Node', async () => {
  const script = [
    `const { receivedLanguage } = await import(${JSON.stringify(new URL('../../../packages/mithaq/src/mithaq/language.ts', import.meta.url).href)})`,
    `const { formatLock, vocabularyOf } = await import(${JSON.stringify(new URL('../../../packages/mithaq/src/mithaq/lock.ts', import.meta.url).href)})`,
    `const { defineKayan } = await import(${JSON.stringify(new URL('../../mithaq/src/mithaq.ts', import.meta.url).href)})`,
    `process.stdout.write(formatLock({ language: vocabularyOf(receivedLanguage(defineKayan)), seal: 'pending' }))`,
  ].join('\n')
  const written = (program: string, argv: string[]) =>
    new Promise<string>((resolve, reject) =>
      execFile(program, [...argv, script], { cwd: fileURLToPath(root), timeout: 60_000 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr))) : resolve(stdout))),
    )
  const [node, bun] = await Promise.all([written(process.execPath, ['--input-type=module', '-e']), written('bun', ['-e'])])
  assert.equal(node, formatLock({ language: block, seal: 'pending' }))
  assert.equal(bun, node)
})

test('changing the vocabulary turns the check red naming the path, and ends with the covenant', async (t) => {
  const { targets } = language
  const [kinds, rules] = [defaultKinds as Record<string, any>, defaultRules as Record<string, any>]
  /** The template's language over one rukn bringing `kinds` and `rules`, where `base` brings the shipped ones. */
  const arkan = (one: { kinds?: Record<string, unknown>; rules?: Record<string, unknown> }) => ({ ...language, arkan: [{ name: 'base', kinds, rules, ...one }] })
  const variants: [string, Record<string, unknown>, string][] = [
    ['a new locale', { ...language, locales: ['ar', 'en', 'fr'] }, 'locales[2]'],
    ['a renamed locale', { ...language, locales: ['ar', 'fr'] }, 'locales[1]'],
    ['a removed locale', { ...language, locales: ['ar'] }, 'locales[1] was removed'],
    ['a new kind', arkan({ kinds: { ...kinds, words: kinds.text } }), 'kinds.words was added'],
    ['a removed kind', arkan({ kinds: { ...kinds, text: undefined } }), 'kinds.text was removed'],
    ["a kind's accepted rules", arkan({ kinds: { ...kinds, text: { ...kinds.text, rules: ['required'] } } }), 'kinds.text.rules'],
    ["a kind's label", arkan({ kinds: { ...kinds, text: { ...kinds.text, label: { ...kinds.text.label, ar: 'نصوص' } } } }), 'kinds.text.label.ar'],
    ["a kind's message", arkan({ kinds: { ...kinds, date: { ...kinds.date, message: { ...kinds.date.message, en: 'Not a day.' } } } }), 'kinds.date.message.en'],
    ['a new rule', arkan({ rules: { ...rules, slug: rules.trim } }), 'rules.slug was added'],
    ['a removed rule', arkan({ rules: { ...rules, trim: undefined } }), 'rules.trim was removed'],
    ["a rule's message", arkan({ rules: { ...rules, required: { ...rules.required, message: { ...rules.required.message, ar: 'مطلوب.' } } } }), 'rules.required.message.ar'],
    ["a rule's excludes", arkan({ rules: { ...rules, uppercase: { ...rules.uppercase, excludes: [] } } }), 'rules.uppercase.excludes[0] was removed'],
    ['a new target', { ...language, targets: { ...targets, schema: zodTarget } }, 'targets.schema was added'],
    ['a renamed target', { ...language, targets: { ...targets, zod: undefined, validation: zodTarget } }, 'targets.validation was added'],
    ["a target's capability", { ...language, targets: { ...targets, zod: { ...targets.zod, capability: 'store' } } }, 'targets.zod was "schema" and is now "store"'],
    ['a new root key', { ...language, extra: {} }, 'keys[1]'],
    ['a removed root key', { ...language, generate: undefined }, 'keys'],
  ]
  for (const [name, variant, path] of variants) {
    await t.test(name, () => {
      const { code, message } = checkLock(vocabularyOf(variant), formatLock(lock))
      assert.equal(code, 1)
      assert.ok(message.includes(path), message)
      assert.ok(message.endsWith(covenant), message)
    })
  }
})

test("the app's wiring in defineMithaq changes nothing the lock records", async (t) => {
  const { targets } = language
  const variants: [string, Record<string, unknown>][] = [
    [
      'a screen page',
      { ...language, targets: { ...targets, portal: { ...targets.portal, pages: { home: { ...targets.portal.pages.home, path: '/start' } } } } },
    ],
    ["a screen's kayan list", { ...language, targets: { ...targets, dashboard: { ...targets.dashboard, kayan: [...targets.dashboard.kayan, 'lockProbe'] } } }],
    [
      "a role's keys",
      {
        ...language,
        targets: {
          ...targets,
          rbac: { ...targets.rbac, roles: { ...targets.rbac.roles, registrar: { ...targets.rbac.roles.registrar, permissions: ['courses.find'] } } },
        },
      },
    ],
    ['a step', { ...language, targets: { ...targets, service: { ...targets.service, afterSteps: [async () => {}] } } }],
    ['a generate path', { ...language, generate: { ...language.generate, messages: 'src/copy/' } }],
  ]
  for (const [name, variant] of variants) {
    await t.test(name, () => {
      assert.deepEqual(checkLock(vocabularyOf(variant), formatLock(lock)), { code: 0, message: 'mithaq.lock is signed, and the language is the one it records.' })
    })
  }
})

test('a kayan changes nothing the lock records', () => {
  defineKayan({
    name: 'lockProbe',
    fields: { title: { kind: 'text', label: { ar: 'عنوان', en: 'Title' } } },
    targets: { service: { operations: {} } },
  })
  assert.deepEqual(checkLock(vocabularyOf(language), formatLock(lock)), { code: 0, message: 'mithaq.lock is signed, and the language is the one it records.' })
})

test('the seal verifies its own language by one of its signers, and nothing else', () => {
  assert.deepEqual(verifyLock(block, lock), { changed: [], seal: 'signed' })
  const other = sealLanguage({ language: block, key: generateKeyPairSync('ed25519').privateKey })
  assert.equal(
    verifyLock(block, { ...lock, seal: { ...(lock.seal as Seal), signature: (other.seal as Seal).signature } }).seal,
    'invalid',
    "another machine's signature, not a signer",
  )
  const edited = { ...(block as object), locales: ['ar'] }
  assert.deepEqual(verifyLock(edited, { ...lock, language: edited }), { changed: [], seal: 'invalid' }, 'an edited lock')
  assert.equal(verifyLock(block, { language: block } as Lock).seal, 'missing', 'a missing seal')
  const added = { ...(lock.seal as Seal), signers: [...(lock.seal as Seal).signers, (other.seal as Seal).signers[0]!] }
  assert.equal(verifyLock(block, { ...lock, seal: added }).seal, 'invalid', 'a signer added without a new signature')
  for (const broken of [{ language: block }, { language: block, seal: { ...(lock.seal as Seal), signers: [{ publicKey: 'AAAA', label: 'x', addedAt: '' }] } }]) {
    const { code, message } = checkLock(block, JSON.stringify(broken))
    assert.equal(code, 1)
    assert.ok(message.endsWith(covenant), message)
  }
})

test('a pending lock fails like a missing seal, naming the step the owner owes, and a changed language fails naming the paths', () => {
  const pending = formatLock({ language: block, seal: 'pending' })
  const unsigned = checkLock(block, pending)
  assert.equal(unsigned.code, 1, 'nobody signed it, so it holds nothing')
  assert.match(unsigned.message, /^Pending: .*`mithaq lock`/)
  const failed = checkLock(vocabularyOf({ ...language, locales: ['ar'] }), pending)
  assert.equal(failed.code, 1)
  assert.ok(failed.message.includes('locales[1]'), failed.message)
})

test('a project with no lock passes `lock --check` with one notice saying how to lock it', () => {
  assert.deepEqual(checkLock(block, undefined), { code: 0, message: "No mithaq.lock: this project's language is not locked. Run `mithaq lock` to lock it." })
})

test('a project with a lock is still held to it: a changed vocabulary is red', async () => {
  const one = await project()
  try {
    await one.write(lock)
    assert.equal((await check(one.url)).value, 0, 'the lock records this language')
    await one.write(sealLanguage({ language: vocabularyOf({ ...language, locales: ['ar'] }), key, base: undefined, label: 'test machine' }))
    const red = await check(one.url)
    assert.equal(red.value, 1)
    assert.match(red.out, /The language is not the one mithaq\.lock records:\n  - locales\[1\] was added/)
  } finally {
    await one.remove()
  }
})

test('`mithaq lock` signs only when the approver types the number back, and never prints the number', async () => {
  const one = await project()
  const keys = await machine()
  try {
    let shown = 0
    const printed = await printing(async () => {
      await assert.rejects(run({ project: one.url, noun: undefined, flags: [], keys, approve: async (_summary, code) => ((shown = code), String(code === 99 ? 10 : code + 1)) }), Refusal)
      await assert.rejects(readFile(one.lockFile, 'utf8'), { code: 'ENOENT' }, 'a wrong number writes nothing')
      await assert.rejects(run({ project: one.url, noun: undefined, flags: [], keys, approve: async () => undefined }), Refusal)
      await assert.rejects(readFile(one.lockFile, 'utf8'), { code: 'ENOENT' }, 'a cancel writes nothing')
      assert.equal(await run({ project: one.url, noun: undefined, flags: [], keys, approve: async (_summary, code) => ((shown = code), ` ${code}\n`) }), 0)
      assert.equal(verifyLock(block, await one.read()).seal, 'signed')
      assert.equal(await run({ project: one.url, noun: undefined, flags: [], keys, approve: async () => assert.fail('nothing to approve') }), 0, 'an unchanged signed lock asks nothing')
    })
    assert.ok(shown >= 10 && shown <= 99)
    assert.ok(!new RegExp(`\\b${shown}\\b`).test(printed.out), printed.out)
  } finally {
    await one.remove()
    await rm(keys, { recursive: true, force: true })
  }
})

test('stdin never answers the approval, and with no popup and no terminal nothing is signed', async () => {
  const bin = fileURLToPath(new URL('../../../packages/mithaq/src/asas/cli/mithaq.ts', import.meta.url))
  const one = await project()
  const keys = await machine()
  try {
    const answered = await new Promise<{ code: number | null; out: string }>((resolve) => {
      // A new session (`detached`) has no controlling terminal, and an empty
      // PATH has no popup program, so only stdin is left, and it must not count.
      const child = execFile(
        process.execPath,
        [bin, 'lock'],
        { cwd: one.dir, detached: true, env: { ...process.env, PATH: '', HOME: keys, APPDATA: keys, DISPLAY: '', WAYLAND_DISPLAY: '' }, timeout: 60_000 } as never,
        (_error, stdout, stderr) => resolve({ code: child.exitCode, out: String(stdout) + String(stderr) }),
      )
      child.stdin?.end(Array.from({ length: 90 }, (_, index) => index + 10).join('\n') + '\n')
    })
    assert.equal(answered.code, 1, answered.out)
    assert.match(answered.out, /Not approved, so nothing was signed\./)
    assert.doesNotMatch(answered.out, /Type \d\d/)
    await assert.rejects(readFile(one.lockFile, 'utf8'), { code: 'ENOENT' })
  } finally {
    await one.remove()
    await rm(keys, { recursive: true, force: true })
  }
})

test('every lock opens with the notice, and the notice signs nothing', () => {
  const text = formatLock(lock)
  assert.ok(text.startsWith(`{\n  "_notice": ${JSON.stringify(notice)},`), text.slice(0, 200))
  assert.equal(verifyLock(block, { ...(JSON.parse(text) as Lock), _notice: 'edited' }).seal, 'signed')
})

test('every other command shows an unsigned language change first, and runs on', async () => {
  const one = await project()
  const printed: string[] = []
  const error = console.error
  console.error = (...line: unknown[]) => void printed.push(line.join(' '))
  try {
    await one.write(lock)
    await warnLock(one.url)
    assert.equal(printed.length, 0, 'a lock signed over this language says nothing')
    await one.write({ language: block, seal: 'pending' })
    await warnLock(one.url)
    assert.ok(printed.some((line) => line.startsWith('Pending:')), 'a pending lock says so')
    printed.length = 0
    await one.write({ ...lock, language: { ...(block as object), locales: ['ar'] } })
    await warnLock(one.url)
    assert.ok(printed.some((line) => line.includes('locales[1]') && line.includes(covenant)), printed.join('\n'))
    printed.length = 0
    await warnLock(new URL('../does-not-exist/', root))
    assert.deepEqual(printed, [], 'a project that does not load is passed over')
  } finally {
    console.error = error
    await one.remove()
  }
})

test('an unlocked template passes `lock --check` with the notice', async () => {
  const { value, out } = await check(root)
  assert.equal(value, 0)
  assert.equal(out, "No mithaq.lock: this project's language is not locked. Run `mithaq lock` to lock it.")
})

test('the #167 lock, kept as a fixture with `previous` and `restart` in its seal, verifies as it stands', async () => {
  const file = new URL('lock.167.fixture.json', import.meta.url)
  const kept = await readFile(file, 'utf8')
  const seal = (JSON.parse(kept) as Lock).seal as Seal & { restart?: unknown }
  assert.equal(typeof seal.previous, 'string', 'the owner signed it with `previous`')
  assert.ok(seal.restart, 'and wrote `restart` beside it')
  // A lock signed before the `versions`, `storage` and `tenant` targets, the
  // `richText`, `upload`, `integer`, `decimal` and `json` kinds, the `precision` and
  // `scale` rules and the arkan existed holds the language
  // without any of them, its kinds and rules at the root, and names the
  // backoffice target by its old name, `platform`.
  const { arkan: _arkan, ...root } = language
  const vocabulary = vocabularyOf({
    ...root,
    kinds: { ...defaultKinds, richText: undefined, upload: undefined, integer: undefined, decimal: undefined, json: undefined },
    rules: { ...defaultRules, precision: undefined, scale: undefined },
    targets: { ...language.targets, backoffice: undefined, platform: language.targets.backoffice, versions: undefined, storage: undefined, tenant: undefined },
  })
  const { code, message } = checkLock(vocabulary, kept)
  assert.equal(code, 0, message)
  assert.equal(await readFile(file, 'utf8'), kept, 'the check writes nothing')
  // `previous` is signed data: another one fails; `restart` is outside the signature.
  const lockOf = (edit: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(kept), seal: { ...seal, ...edit } })
  assert.equal(checkLock(vocabulary, lockOf({ previous: 'AAAA' })).code, 1)
  assert.equal(checkLock(vocabulary, lockOf({ previous: undefined })).code, 1)
  assert.equal(checkLock(vocabulary, lockOf({ restart: undefined })).code, 0)
})

test('a new machine joins as a signer by passing the popup on its own screen', async () => {
  const one = await project()
  const first = await machine()
  const second = await machine()
  try {
    await printing(() => run({ project: one.url, noun: undefined, flags: [], keys: first, approve: approving() }))
    const [owner] = ((await one.read()).seal as Seal).signers
    const seen: string[] = []
    const refused = await printing(() => assert.rejects(run({ project: one.url, noun: undefined, flags: [], keys: second, approve: async () => undefined }), Refusal))
    assert.match(refused.out, /signs this project's lock for the first time/)
    assert.deepEqual(((await one.read()).seal as Seal).signers, [owner], 'a cancel adds nobody')
    assert.equal((await printing(() => run({ project: one.url, noun: undefined, flags: [], keys: second, approve: approving(seen) }))).value, 0)
    assert.match(seen[0]!, new RegExp(`This machine, ${hostname()} \\(key [A-Za-z0-9+/=]+\\), signs this project's lock for the first time\\.`))
    const joined = (await one.read()).seal as Seal
    assert.equal(joined.signers.length, 2)
    assert.equal(joined.signers[0]!.publicKey, owner!.publicKey)
    assert.equal(joined.previous, undefined, 'a new signature writes no `previous`')
    assert.equal((await check(one.url)).value, 0)
    for (const keys of [first, second]) assert.equal(await run({ project: one.url, noun: undefined, flags: [], keys, approve: async () => assert.fail('nothing to approve') }), 0)
  } finally {
    await one.remove()
    await rm(first, { recursive: true, force: true })
    await rm(second, { recursive: true, force: true })
  }
})

test('a seal that does not verify passes on no signer: the next approval starts the lock over', async () => {
  const one = await project()
  const keys = await machine()
  try {
    const stranger = (sealLanguage({ language: block, key: generateKeyPairSync('ed25519').privateKey, base: undefined, label: 'stranger' }).seal as Seal).signers[0]!
    const forged = { ...(lock.seal as Seal), signers: [...(lock.seal as Seal).signers, stranger] }
    await one.write({ language: block, seal: forged })
    assert.equal((await check(one.url)).value, 1)
    const seen: string[] = []
    await printing(() => run({ project: one.url, noun: undefined, flags: [], keys, approve: approving(seen) }))
    assert.match(seen[0]!, /seal does not verify, so its signers are dropped/)
    const fresh = (await one.read()).seal as Seal
    assert.notEqual(fresh.project, forged.project)
    assert.equal(fresh.signers.length, 1)
    assert.ok(!fresh.signers.some((one) => one.publicKey === stranger.publicKey))
    assert.equal((await check(one.url)).value, 0)
  } finally {
    await one.remove()
    await rm(keys, { recursive: true, force: true })
  }
})

test('a lock holding a root key other than _notice, language and seal is refused when checked and when signed', async () => {
  const one = await project()
  const keys = await machine()
  try {
    await writeFile(one.lockFile, JSON.stringify({ ...lock, padding: 'x' }))
    const read = checkLock(block, await readFile(one.lockFile, 'utf8'))
    assert.equal(read.code, 1)
    assert.match(read.message, /holds keys other than _notice, language and seal/)
    await assert.rejects(printing(() => run({ project: one.url, noun: undefined, flags: [], keys, approve: async () => assert.fail('no popup') })), Refusal)
  } finally {
    await one.remove()
    await rm(keys, { recursive: true, force: true })
  }
})

test('a signer label longer than 64 characters or holding a control character is refused when signing and when read', async () => {
  for (const label of ['a\nb', '‮owner', 'x'.repeat(65)]) assert.throws(() => sealLanguage({ language: block, key, base: undefined, label }), Refusal, JSON.stringify(label))
  const one = await project()
  const keys = await machine()
  try {
    const labelled = { ...lock, seal: { ...(lock.seal as Seal), signers: [{ ...(lock.seal as Seal).signers[0]!, label: '\u001b[2Jowner' }] } }
    await one.write(labelled)
    const read = checkLock(block, formatLock(labelled))
    assert.equal(read.code, 1)
    assert.doesNotMatch(read.message, /\u001b/)
    await assert.rejects(printing(() => run({ project: one.url, noun: undefined, flags: [], keys, approve: async () => assert.fail('the popup never shows it') })), Refusal)
  } finally {
    await one.remove()
    await rm(keys, { recursive: true, force: true })
  }
})

test('a red lock stops every script that starts or builds an app, and an unlocked or signed project runs', async (t) => {
  // Each app's scripts, run by Bun as the developer runs them, in a copy laid
  // out as the repository is: the app two levels below the template it checks.
  // `vite` is a stand-in on PATH that records it ran.
  const repository = new URL('../../../', import.meta.url)
  const bin = join(fileURLToPath(repository), 'packages/mithaq/src/asas/cli/mithaq.ts')
  for (const app of ['asas-tanstack', 'asas-backoffice']) {
    const { scripts } = JSON.parse(await readFile(new URL(`apps/${app}/package.json`, repository), 'utf8')) as { scripts: Record<string, string> }
    for (const name of ['dev', 'build', 'preview']) {
      await t.test(`${app} ${name}`, async () => {
        const one = await project('templates/asas')
        try {
          const appDir = join(one.top, 'apps', app)
          const tools = join(one.top, 'bin')
          await mkdir(appDir, { recursive: true })
          await mkdir(tools)
          await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: app, private: true, scripts: { [name]: scripts[name] } }))
          await writeFile(join(tools, 'vite'), `#!/bin/sh\necho ran > ${JSON.stringify(join(one.top, 'ran'))}\n`)
          await writeFile(join(tools, 'mithaq'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(bin)} "$@"\n`)
          await chmod(join(tools, 'vite'), 0o755)
          await chmod(join(tools, 'mithaq'), 0o755)
          const start = () =>
            new Promise<{ code: number | null; out: string }>((resolve) => {
              const child = execFile('bun', ['run', name], { cwd: appDir, env: { ...process.env, PATH: `${tools}:${process.env.PATH}` }, timeout: 60_000 }, (_error, stdout, stderr) =>
                resolve({ code: child.exitCode, out: String(stdout) + String(stderr) }),
              )
            })
          const ran = () => readFile(join(one.top, 'ran'), 'utf8').then(() => true, () => false)
          // No lock: the project is not locked, and the script runs.
          const unlocked = await start()
          assert.equal(unlocked.code, 0, unlocked.out)
          assert.match(unlocked.out, /No mithaq\.lock: this project's language is not locked\./)
          assert.equal(await ran(), true, 'vite ran')
          await rm(join(one.top, 'ran'))
          // A lock over another language: red, and the script stops.
          await one.write(sealLanguage({ language: vocabularyOf({ ...language, locales: ['ar'] }), key, base: undefined, label: 'test machine' }))
          const red = await start()
          assert.notEqual(red.code, 0, red.out)
          assert.match(red.out, /The language is not the one mithaq\.lock records/)
          assert.equal(await ran(), false, 'vite never ran')
          await one.write(lock)
          const green = await start()
          assert.equal(green.code, 0, green.out)
          assert.equal(await ran(), true, 'vite ran')
        } finally {
          await one.remove()
        }
      })
    }
  }
})
