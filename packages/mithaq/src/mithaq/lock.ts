// The lock signs only when a person types back a code shown in a popup, never in
// this command's own output, so an agent running `mithaq lock` cannot approve it.
import { execFile } from 'node:child_process'
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomInt, sign, verify, type KeyObject } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { receivedLanguage } from './language.ts'
import { Refusal } from './refusal.ts'
import { composeArkan, type Rukn } from './rukn.ts'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
/** A machine whose key may sign this project's lock. */
export type Signer = { publicKey: string; label: string; addedAt: string }
// Any key of a seal but these is outside the signature and read by nothing.
export type Seal = { project: string; signers: Signer[]; previous?: string; signature: string; sealedAt: string }
/** A lock's `seal` is `'pending'` until a person first approves `mithaq lock`. */
export type Lock = { _notice?: string; language: Json; seal: Seal | 'pending' }

/** The first thing anyone reads in `mithaq.lock`. It signs nothing. */
export const notice =
  "ميثاق: do not change the vocabulary of defineMithaq (src/mithaq.ts), which is its locales, kinds, rules, targets and root keys, or this file unless the project's developer asked for that change. When the vocabulary must change, tell the developer what and why, then run `mithaq lock` and let them approve it in the popup it shows."

export const covenant =
  "ميثاق: the language changed and is not signed. Only the project's owner may approve a language change. Stop here, tell the owner what you changed and why, and ask them to run `mithaq lock`."

const pathOf = (path: string, key: string | number) =>
  typeof key === 'number' ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`

// Keys sorted and `undefined` dropped, so one value always writes the same bytes.
const canonical = (value: unknown): Json => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value as Json
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, canonical(record[key])]),
  )
}

type Received = {
  locales?: unknown
  kinds?: Record<string, { label?: unknown; message?: unknown; rules?: unknown } | undefined>
  rules?: Record<string, { message?: unknown; excludes?: unknown } | undefined>
  targets?: Record<string, { capability?: unknown } | undefined>
  arkan?: readonly Rukn[]
}

/** Each entry of a record through `pick`; an `undefined` entry stays one, and `canonical` drops it. */
const each = <Value>(record: Record<string, Value | undefined> | undefined, pick: (value: Value) => unknown) =>
  Object.fromEntries(Object.entries(record ?? {}).map(([name, value]) => [name, value === undefined ? undefined : pick(value)]))

/**
 * What the lock records of the object `defineMithaq` received: the locales, each kind's label, message
 * and accepted rules, each rule's message and excludes, each target's name and capability, and the root keys.
 */
export const vocabularyOf = (received: unknown): Json => {
  const language = received as Received & Record<string, unknown>
  // A language with no `arkan` holds its kinds and rules at the root; a lock signed in that shape still reads.
  const { kinds, rules, targets } = (language.arkan ? composeArkan(language as Parameters<typeof composeArkan>[0]) : language) as Received
  return canonical({
    keys: Object.keys(language)
      .filter((key) => language[key] !== undefined)
      .sort(),
    locales: language.locales,
    kinds: each(kinds, ({ label, message, rules }) => ({ label, message, rules })),
    rules: each(rules, ({ message, excludes }) => ({ message, excludes })),
    targets: each(targets, ({ capability }) => capability ?? null),
  })
}

/** The lock as its file holds it: canonical, two-space indented, one trailing newline. */
export const formatLock = (lock: Lock) =>
  `${JSON.stringify(canonical({ ...lock, _notice: notice }), null, 2)}\n`

/** Each path at which two canonical languages differ, as a line a person reads. */
export const changedPaths = ({ was, now, path = '' }: { was: Json | undefined; now: Json | undefined; path?: string }): string[] => {
  if (JSON.stringify(was) === JSON.stringify(now)) return []
  const name = path || 'the whole language'
  if (was === undefined) return [`${name} was added`]
  if (now === undefined) return [`${name} was removed`]
  const branch = (one: Json) => one !== null && typeof one === 'object'
  if (!branch(was) || !branch(now) || Array.isArray(was) !== Array.isArray(now)) {
    return [branch(was) || branch(now) ? `${name} changed` : `${name} was ${JSON.stringify(was)} and is now ${JSON.stringify(now)}`]
  }
  const keyed = (one: Json) => one as Record<string, Json>
  if (Array.isArray(was)) {
    const nowList = now as Json[]
    return Array.from({ length: Math.max(was.length, nowList.length) }, (_, index) =>
      changedPaths({ was: was[index], now: nowList[index], path: pathOf(path, index) }),
    ).flat()
  }
  return [...new Set([...Object.keys(keyed(was)), ...Object.keys(keyed(now))])]
    .sort()
    .flatMap((key) => changedPaths({ was: keyed(was)[key], now: keyed(now)[key], path: pathOf(path, key) }))
}

const spki = Buffer.from('302a300506032b6570032100', 'hex')
const publicKeyOf = (key: KeyObject) => createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(spki.length).toString('base64')
const keyFromPublic = (publicKey: string) => createPublicKey({ key: Buffer.concat([spki, Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' })
// `canonical` drops a missing `previous`, so a seal without one signs the same bytes.
const signed = (language: Json, project: string, signers: Signer[], previous?: string) =>
  Buffer.from(JSON.stringify(canonical({ language, project, signers, previous })))
// Checked before it names a file.
const projectId = /^[0-9a-f]{32}$/
// Printed into the popup, so short and free of control characters.
const labelled = (label: unknown) => typeof label === 'string' && label.length <= 64 && !/[\p{Cc}\p{Cf}]/u.test(label)
const labelRule = 'is longer than 64 characters or holds a control character'

/**
 * Signs a canonical language with this machine's key, over `base`'s project and
 * signers, adding this machine to the signers when it is not one of them yet.
 */
export const sealLanguage = ({
  language,
  key,
  base,
  label = hostname(),
}: {
  language: Json
  key: KeyObject
  base?: Pick<Seal, 'project' | 'signers'>
  label?: string
}): Lock => {
  const project = base?.project ?? randomBytes(16).toString('hex')
  const publicKey = publicKeyOf(key)
  const signers = base?.signers.some((one) => one.publicKey === publicKey)
    ? base.signers
    : [...(base?.signers ?? []), { publicKey, label, addedAt: new Date().toISOString() }]
  if (!signers.every((one) => labelled(one.label))) throw new Refusal(`A signer's label ${labelRule}, so nothing is signed.`)
  const signature = sign(null, signed(language, project, signers), key).toString('base64')
  return { language, seal: { project, signers, signature, sealedAt: new Date().toISOString() } }
}

// A key a lock never holds is one a forgery could pad itself with.
const unreadable = (lock: unknown) => {
  if (lock === null || typeof lock !== 'object' || Array.isArray(lock)) return 'is not a JSON object'
  if (Object.keys(lock).some((key) => !['_notice', 'language', 'seal'].includes(key))) return 'holds keys other than _notice, language and seal'
  const seal = (lock as Lock).seal as Partial<Seal> | null
  const signers = seal && typeof seal === 'object' && Array.isArray(seal.signers) ? seal.signers : []
  if (signers.some((one) => !labelled((one as Signer | null)?.label))) return `names a signer whose label ${labelRule}`
  return undefined
}

/** Where a lock stands against the current language: the paths that changed, and its seal's state. */
export const verifyLock = (language: Json, lock: Lock): { changed: string[]; seal: 'signed' | 'pending' | 'missing' | 'invalid' } => {
  const changed = changedPaths({ was: lock.language, now: language })
  const seal = lock.seal as unknown
  if (unreadable(lock)) return { changed, seal: 'invalid' }
  if (seal === 'pending') return { changed, seal: 'pending' }
  if (seal === undefined || seal === null) return { changed, seal: 'missing' }
  const { project, signers, signature, previous } = seal as Partial<Seal>
  if (typeof project !== 'string' || !Array.isArray(signers) || typeof signature !== 'string' || !['string', 'undefined'].includes(typeof previous)) {
    return { changed, seal: 'invalid' }
  }
  const payload = signed(lock.language, project, signers, previous)
  const valid = signers.some((one) => {
    try {
      return verify(null, payload, keyFromPublic(String(one.publicKey)), Buffer.from(signature, 'base64'))
    } catch {
      return false
    }
  })
  return { changed, seal: valid ? 'signed' : 'invalid' }
}

/** `mithaq lock --check`. A project with no `mithaq.lock` passes with one notice; one with a lock is held to it. */
export const checkLock = (language: Json, text: string | undefined): { code: 0 | 1; message: string } => {
  if (text === undefined) {
    return { code: 0, message: "No mithaq.lock: this project's language is not locked. Run `mithaq lock` to lock it." }
  }
  let lock: Lock
  try {
    lock = JSON.parse(text) as Lock
  } catch {
    return { code: 1, message: `mithaq.lock is not JSON, so nobody's signature over it can be read.\n\n${covenant}` }
  }
  const why = unreadable(lock)
  if (why) return { code: 1, message: `mithaq.lock ${why}, so nobody's signature over it is read.\n\n${covenant}` }
  const { changed, seal } = verifyLock(language, lock)
  if (changed.length) {
    return { code: 1, message: `The language is not the one mithaq.lock records:\n${changed.map((line) => `  - ${line}`).join('\n')}\n\n${covenant}` }
  }
  // Nobody has signed a pending lock, so it fails like a missing seal.
  if (seal === 'pending') {
    return {
      code: 1,
      message: 'Pending: mithaq.lock records this language and nobody has signed it yet. Run `mithaq lock`, and the project\'s owner approves it in the popup it shows.',
    }
  }
  if (seal !== 'signed') {
    return { code: 1, message: `mithaq.lock's seal is ${seal === 'missing' ? 'missing' : 'not a signature of the language it records'}.\n\n${covenant}` }
  }
  return { code: 0, message: 'mithaq.lock is signed, and the language is the one it records.' }
}

/** Asks a person to type `code` back, beside `summary`. The code is never written to this process's output. */
export type Approve = (summary: string, code: number) => Promise<string | undefined>

/** Runs a program, feeding `input` on stdin, and answers its stdout, or nothing where it failed. */
const ask = (program: string, argv: readonly string[], input?: string) =>
  new Promise<string | undefined>((resolve) => {
    const child = execFile(program, argv, { timeout: 5 * 60_000 }, (error, stdout) => resolve(error ? undefined : stdout.trim()))
    child.stdin?.end(input ?? '')
  })

/** Whether a program answers on this machine's PATH. */
const has = (program: string) => ask(process.platform === 'win32' ? 'where' : 'which', [program]).then((found) => Boolean(found))

// Opened directly, so a piped or scripted stdin never answers it.
const terminal: Approve = async (summary, code) => {
  const [inPath, outPath] = process.platform === 'win32' ? ['CONIN$', 'CONOUT$'] : ['/dev/tty', '/dev/tty']
  const opened = await new Promise<[NodeJS.ReadableStream, NodeJS.WritableStream] | undefined>((resolve) => {
    const input = createReadStream(inPath)
    input.once('error', () => resolve(undefined))
    input.once('open', () => {
      const output = createWriteStream(outPath)
      output.once('error', () => resolve(undefined))
      output.once('open', () => resolve([input, output]))
    })
  })
  if (!opened) return undefined
  const [input, output] = opened
  const line = createInterface({ input, output, terminal: true })
  try {
    return await line.question(`${summary}\n\nType ${code} to approve, or anything else to cancel: `)
  } finally {
    line.close()
    ;(input as unknown as { destroy(): void }).destroy()
    output.end()
  }
}

const appleText = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const powershellText = (text: string) => `'${text.replaceAll("'", "''")}'`

// The script reaches `osascript` and PowerShell on stdin, so the code is in no command
// line another process can list. `zenity` and `kdialog` take it as an argument.
export const popup: Approve = async (summary, code) => {
  const text = `${summary}\n\nType ${code} to approve.`
  if (process.platform === 'darwin') {
    const script = `text returned of (display dialog ${appleText(text)} with title "mithaq.lock" default answer "" buttons {"Cancel", "Approve"} default button "Approve")`
    const answer = await ask('osascript', ['-'], script)
    if (answer !== undefined) return answer
  } else if (process.platform === 'win32') {
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox(${powershellText(text)}, 'mithaq.lock', '')`
    const answer = await ask('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], script)
    if (answer !== undefined) return answer
  } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    if (await has('zenity')) return ask('zenity', ['--entry', '--title=mithaq.lock', `--text=${text}`])
    if (await has('kdialog')) return ask('kdialog', ['--title', 'mithaq.lock', '--inputbox', text])
  }
  return terminal(summary, code)
}

/** Where this machine keeps its signing keys, one file per project, outside every repository. */
const keysHome = () =>
  process.platform === 'win32' && process.env.APPDATA ? join(process.env.APPDATA, 'mithaq', 'keys') : join(homedir(), '.mithaq', 'keys')

/** This machine's key for a project: read, or made and kept (mode 0600) on first use. */
const machineKey = async (keys: string, project: string) => {
  if (!projectId.test(project)) throw new Refusal(`mithaq.lock names the project "${project}", which is not a project id, so no key file is read for it.`)
  const file = join(keys, `${project}.key`)
  const pem = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (pem) return createPrivateKey(pem)
  const { privateKey } = generateKeyPairSync('ed25519')
  await mkdir(keys, { recursive: true, mode: 0o700 })
  await writeFile(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  return privateKey
}

// Never stops the command it runs before: `mithaq generate --check` is where an unsigned change fails.
export const warnLock = async (project: URL) => {
  try {
    const { defineKayan } = (await import(new URL('src/mithaq.ts', project).href)) as { defineKayan?: unknown }
    const received = receivedLanguage(defineKayan)
    if (received === undefined) return
    const text = await readFile(new URL('mithaq.lock', project), 'utf8').catch(() => undefined)
    const { code, message } = checkLock(vocabularyOf(received), text)
    if (code || message.startsWith('Pending:')) console.error(`${message}\n`)
  } catch {
    // The command itself reports a project that does not load.
  }
}

const usage = 'Usage: mithaq lock | mithaq lock --check'

/** `mithaq lock` and `mithaq lock --check`, run from the project root. `approve` and `keys` are for tests. */
export const run = async ({
  project,
  noun,
  flags,
  approve = popup,
  keys = keysHome(),
}: {
  project: URL
  noun: string | undefined
  flags: readonly string[]
  approve?: Approve
  keys?: string
}): Promise<number> => {
  const check = flags.includes('--check')
  if (noun !== undefined || flags.some((flag) => flag !== '--check')) {
    console.error(usage)
    return 1
  }
  const { defineKayan } = (await import(new URL('src/mithaq.ts', project).href)) as { defineKayan?: unknown }
  const received = receivedLanguage(defineKayan)
  if (received === undefined) {
    throw new Refusal(
      'src/mithaq.ts exports no `defineKayan` returned by `defineMithaq`, so there is no language to lock. Export it as `export const { defineKayan, ... } = defineMithaq({ ... })`.',
    )
  }
  const language = vocabularyOf(received)
  const file = new URL('mithaq.lock', project)
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (check) {
    const { code, message } = checkLock(language, text)
    if (code) console.error(message)
    else console.log(message)
    return code
  }
  const lock = text === undefined ? undefined : (JSON.parse(text) as Lock)
  const why = text === undefined ? undefined : unreadable(lock)
  if (why) throw new Refusal(`mithaq.lock ${why}, so it is not read. Restore it from its last commit, then run \`mithaq lock\` again.`)
  const seal = lock !== undefined && lock.seal !== 'pending' && lock.seal ? (lock.seal as Seal) : undefined
  // A seal that does not verify is dropped whole, so no name it lists is signed by the next approval.
  const valid = seal !== undefined && verifyLock(lock!.language, lock!).seal === 'signed'
  const id = valid ? seal.project : randomBytes(16).toString('hex')
  const signers = valid ? seal.signers : []
  const key = await machineKey(keys, id)
  const label = hostname()
  if (!labelled(label)) throw new Refusal(`This machine's name, which labels it in mithaq.lock, ${labelRule}, so nothing is signed.`)
  const newSigner = !signers.some((one) => one.publicKey === publicKeyOf(key))
  const changed = changedPaths({ was: lock?.language, now: language })
  if (valid && !changed.length && !newSigner) {
    console.log('mithaq.lock is signed, and the language is the one it records. Nothing to sign.')
    return 0
  }
  const summary = [
    changed.length ? `These changes to the language:\n${changed.map((line) => `  - ${line}`).join('\n')}` : 'The language is the one mithaq.lock records.',
    seal && !valid ? "mithaq.lock's seal does not verify, so its signers are dropped and the lock starts over as a new project." : '',
    newSigner ? `This machine, ${label} (key ${publicKeyOf(key)}), signs this project's lock for the first time.` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  console.log(`${summary}\n\nWaiting for a person to approve in the popup on this machine's screen.`)
  const code = randomInt(10, 100)
  const answer = await approve(summary, code)
  if (answer?.trim() !== String(code)) throw new Refusal('Not approved, so nothing was signed.')
  await writeFile(file, formatLock(sealLanguage({ language, key, base: { project: id, signers }, label })))
  console.log(`Approved. Wrote mithaq.lock, signed by ${label}.`)
  return 0
}
