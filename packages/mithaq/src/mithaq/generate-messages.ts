import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Copy, MessageRegistry } from './messages.ts'
import { Refusal } from './refusal.ts'

// `null` for a label written as a function, which has no string to write down.
type Entry = Record<string, string> | string | null

/**
 * What a run found: `changed`, the files a run writes, and the refusals, each naming what is wrong
 * and where. `unverifiable`, the labels written as functions, is reported and never fails.
 */
export type MessagesReport = {
  changed: string[]
  missing: string[]
  noSource: string[]
  resolver: string[]
  collisions: string[]
  unverifiable: string[]
  data: string[]
}

const fileOf = (name: string, out: string | undefined, directory: URL, root: URL) =>
  out ? new URL(out, root) : new URL(`${name}.json`, directory)

// What is on disk wins: these files are the project's to translate, so a run adds a
// missing key and never deletes or rewrites one.
const merge = (copy: Copy, current: Entry | undefined, locales: readonly string[]): Entry => {
  if (typeof copy === 'function') return null
  if (typeof copy === 'string') return copy
  const held = current && typeof current === 'object' ? current : {}
  // `??`, not `||`: a locale the project left empty is its answer, and is still reported missing.
  return Object.fromEntries(locales.map((locale) => [locale, held[locale] ?? copy[locale] ?? '']))
}

/**
 * Writes one file per scope, and with `check` writes nothing and reports what a run would change and every gap:
 * a missing locale, a key with no source or missing from the resolver, a key two scopes claim, and rows short of a locale.
 */
export const generateMessages = async ({
  registry,
  directory,
  check = false,
  root = directory,
  rows,
}: {
  registry: MessageRegistry
  directory: URL
  check?: boolean
  /** The project's own root, which a scope's own `out` is resolved from. */
  root?: URL
  /** Reads a page of one kayan's rows, for the data gap. Omitted, the scan is skipped. */
  rows?: (entry: MessageRegistry['localized'][number]) => Promise<Record<string, unknown>[]>
}): Promise<MessagesReport> => {
  // With no locale every record would be `{}` and every gate would pass, dropping
  // every string and reporting nothing.
  if (!registry.locales.length) {
    throw new Refusal('The language declares no locales, so `mithaq generate messages` has nothing to write a copy file against.')
  }
  // Two scopes resolving to one path would each report the other's keys as having no source.
  const files = registry.scopes.map((scope) => fileOf(scope.name, scope.out, directory, root))
  files.forEach((file, at) => {
    // Compared ignoring case, because macOS's default volume puts `courses.json` into
    // an existing `Courses.json`.
    const first = files.findIndex((one) => one.href.toLowerCase() === file.href.toLowerCase())
    if (first !== at) {
      throw new Refusal(
        `Scopes "${registry.scopes[first]!.name}" and "${registry.scopes[at]!.name}" both write ${file.pathname}. Give one of them its own \`out\`.`,
      )
    }
  })
  // Read before any write, so a file that stops the run stops it before the first write.
  const committed: Record<string, Entry>[] = []
  for (const file of files) {
    // A file that is there and does not parse is refused, not read as `{}`: every
    // translation in it would be rewritten with nothing reported.
    const held = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    let parsed: unknown = {}
    try {
      if (held !== undefined) parsed = JSON.parse(held)
    } catch {
      parsed = undefined
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Refusal(
        `${file.pathname} is not a copy file \`mithaq generate messages\` can read, and generating would overwrite it. Fix it or delete it.`,
      )
    }
    committed.push(parsed as Record<string, Entry>)
  }
  const report: MessagesReport = { changed: [], missing: [], noSource: [], resolver: [], collisions: [], unverifiable: [], data: [] }
  for (const [key, claims] of Object.entries(registry.collisions)) {
    report.collisions.push(`"${key}" is claimed by ${claims.join(' and ')}.`)
  }
  // Needs no database, so it is found here and not hidden by `--no-data-scan`.
  for (const kayan of new Set(registry.localized.filter((entry) => !entry.sort).map((entry) => entry.kayan))) {
    report.data.push(
      `Kayan "${kayan}" has no field the store can sort a page by, so its localized fields cannot be scanned. Give it one field that is not localized.`,
    )
  }
  // `messagesOf` puts this scope first, so it is filled before any kayan's scope reads it.
  let floor: Record<string, Entry> = {}
  for (const [at, scope] of registry.scopes.entries()) {
    const file = files[at]!
    const current = committed[at]!
    const wanted: Record<string, Entry> = { ...current }
    for (const key of Object.keys(current)) {
      if (!Object.hasOwn(scope.keys, key)) report.noSource.push(`${scope.name}.${key} is an entry with no source. Delete it; a run keeps it.`)
    }
    if (scope.name === 'mithaq') floor = wanted
    for (const key of Object.keys(scope.keys).sort()) {
      const source = scope.seeds?.[key]
      const from = source ? floor[source] : undefined
      let held = current[key]
      // A locale still holding core's sentence is a seed rather than a person's, so a default
      // changed in `mithaq.json` reaches every field that never said otherwise.
      if (from && typeof from === 'object' && held && typeof held === 'object') {
        const shipped = scope.keys[key] as Record<string, string>
        held = Object.fromEntries(Object.entries(held).filter(([locale, value]) => value !== (shipped[locale] ?? '')))
      }
      const entry = merge(from && typeof from === 'object' ? from : scope.keys[key]!, held, registry.locales)
      wanted[key] = entry
      if (entry === null) {
        report.unverifiable.push(`${scope.name}.${key} is a function, so no locale of it can be verified.`)
        continue
      }
      if (typeof entry === 'string') {
        report.unverifiable.push(`${scope.name}.${key} is one string the resolver returned, so no locale of it can be verified.`)
        continue
      }
      for (const locale of registry.locales) {
        if (!entry[locale]) report.missing.push(`${scope.name}.${key} has no "${locale}".`)
      }
    }
    const source = `${JSON.stringify(Object.fromEntries(Object.keys(wanted).sort().map((key) => [key, wanted[key]])), null, 2)}\n`
    if (source === `${JSON.stringify(current, null, 2)}\n`) continue
    report.changed.push(scope.out ?? `${scope.name}.json`)
    if (check) continue
    // Per file: a scope's own `out` may name a directory no run has made yet.
    await mkdir(new URL('.', file), { recursive: true })
    await writeFile(file, source)
  }
  // The same refusal as the type error, for a build where a resolver reached this far short of a key.
  if (registry.resolved) {
    const shipped = registry.scopes.find((scope) => scope.name === 'mithaq')!
    const project = registry.scopes.find((scope) => scope.name === 'project')!
    for (const key of Object.keys(shipped.keys)) {
      // A refusal sentence seeds every per-field key one locale at a time, which one opaque string cannot.
      if (/^(rules\.|kinds\.[^.]+\.invalid$)/.test(key)) continue
      if (!(key in project.keys)) report.resolver.push(`The messages resolver returned no "${key}".`)
    }
  }
  if (rows) {
    for (const entry of registry.localized) {
      // Already named above, once for the kayan rather than once for each of
      // its localized fields, and there is no page to ask for without a sort.
      if (!entry.sort) continue
      for (const row of await rows(entry)) {
        const value = row[entry.field]
        if (!value || typeof value !== 'object') continue
        const held = Object.values(value as Record<string, unknown>)
        if (held.some((one) => one === null) && held.some((one) => one !== null)) {
          report.data.push(
            `Kayan "${entry.kayan}" field "${entry.field}" holds a row written before a locale was added, so every read of that kayan fails. Backfill it.`,
          )
          break
        }
      }
    }
  }
  return report
}

/** Everything a `--check` refuses, which is everything but the unverifiable list. */
export const refusals = (report: MessagesReport): string[] => [
  ...report.collisions,
  ...report.resolver,
  ...report.missing,
  ...report.noSource,
  ...report.data,
  ...report.changed.map((file) => `${file} is not what a run would write.`),
]

/**
 * `mithaq generate messages`, from the project's root, answering its exit code. The data scan connects
 * read-only, and a check that could not scan fails: rows short of a locale break every read of the kayan.
 */
export const run = async ({ project, check, dataScan = true }: { project: URL; check: boolean; dataScan?: boolean }): Promise<number> => {
  const { generate } = (await import(new URL('src/mithaq.ts', project).href)) as { generate?: { messages?: string } }
  const directory = new URL(generate?.messages ?? 'src/messages/', project)
  const { asas } = (await import(new URL('src/asas.ts', project).href)) as {
    asas: {
      messages: MessageRegistry
      targets: Record<string, { find(args: { kayan: string; args: unknown }): Promise<{ docs: Record<string, unknown>[] }> }>
      connect(args: { readOnly: boolean }): Promise<void>
      destroy(): Promise<void>
    }
  }
  let rows: Parameters<typeof generateMessages>[0]['rows']
  /** Why the scan did not answer, which fails the check rather than shading it. */
  let unscanned = ''
  if (check && dataScan && asas.messages.localized.length) {
    try {
      // Read-only: a connect that pushed would apply a migration past its guards and seed the roles.
      await asas.connect({ readOnly: true })
      rows = async (entry) => {
        try {
          return (await asas.targets[entry.store]!.find({
            kayan: entry.kayan,
            args: { limit: 0, page: 1, sort: { field: entry.sort, direction: 'asc' } },
          })).docs
        } catch (error) {
          // The scan did not run, so the check cannot say the table is clean.
          unscanned = (error as Error).message
          return []
        }
      }
    } catch (error) {
      unscanned = (error as Error).message
    }
  }
  // In a `finally`: a refusal is a throw, and one escaping it would leave the connection open.
  let report: MessagesReport
  try {
    report = await generateMessages({ registry: asas.messages, directory, check, root: project, rows })
  } finally {
    // `try`/`catch`: a synchronous throw from `destroy` returns nothing to attach a `.catch()` to.
    try {
      await asas.destroy()
    } catch {
      // Nothing was connected, which is the ordinary path.
    }
  }
  for (const line of report.unverifiable) console.log(`Unverifiable: ${line}`)
  if (check && !dataScan && asas.messages.localized.length) {
    console.log('The data scan was skipped: --no-data-scan.')
  }
  const refused = refusals(report)
  if (!check) for (const line of report.noSource) console.log(line)
  if (check && (refused.length || unscanned)) {
    for (const line of refused) console.error(line)
    // Only a file a run would rewrite: a run leaves an empty locale, a
    // collision, a resolver gap and a data gap exactly as they are.
    if (report.changed.length) console.error('Run `mithaq generate messages`.')
    // Its own line: it is no gap in the copy, but the one a diff cannot show went unmeasured.
    if (unscanned) {
      console.error(`The data scan did not run: ${unscanned}`)
      console.error('Run it against the database, or pass `--no-data-scan` on a project that has none.')
    }
    return 1
  }
  console.log(report.changed.length ? `Wrote ${report.changed.sort().join(', ')}.` : 'Messages are up to date.')
  return 0
}
