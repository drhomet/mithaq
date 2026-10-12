import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The last line of every registry file: the commit it was built at and the hash of the
// file above. Trailing, because `shadcn add` drops a file's leading comments only.
const marker = /\n\/\/ mithaq-admin (\S+) ([0-9a-f]{64})\n?$/
// What `shadcn add` drops, so a hash is the same over the registry's text and the copy's.
const leading = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/

/** The hash of a file as `shadcn add` writes it, without its marker. */
export const hashOf = (text: string) => createHash('sha256').update(text.replace(marker, '\n').replace(leading, '')).digest('hex')

type Built = { files?: { content: string; target: string }[] }

/** Appends the marker to every file of every item `shadcn build` wrote into `built`, the registry's `r/`. */
export const mark = async (built: URL) => {
  let commit = 'unknown'
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(built), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {}
  for (const name of await readdir(built)) {
    if (!name.endsWith('.json') || name === 'registry.json') continue
    const item = JSON.parse(await readFile(new URL(name, built), 'utf8')) as Built
    for (const file of item.files ?? []) {
      const body = file.content.replace(marker, '\n')
      const text = body.endsWith('\n') ? body : `${body}\n`
      file.content = `${text}// mithaq-admin ${commit} ${hashOf(text)}\n`
    }
    await writeFile(new URL(name, built), `${JSON.stringify(item, null, 2)}\n`)
  }
}

// Beside `dist/` when published, at the same depth from this file.

// Beside `dist/` when published; in this repository the apps read the workspace's `mithaq-admin`.
const registry = new URL('../../../r/', import.meta.url)

// The installed `mithaq-admin`'s `r/`, else the one this mithaq ships, else none.
const registryOf = (project: URL): URL | undefined => {
  try {
    return new URL('r/', pathToFileURL(createRequire(new URL('package.json', project)).resolve('mithaq-admin/package.json')))
  } catch {
    return existsSync(new URL('registry.json', registry)) ? registry : undefined
  }
}

export type Copied = {
  /** The file, relative to the project, or the target or item name that resolved outside it. */
  path: string
  state: 'up to date' | 'up to date, edited' | 'differs' | 'differs, edited' | 'unknown' | 'outside' | 'removed'
  /** The commit the copy's marker names, when it carries one. */
  from?: string
  /** The commit the installed registry was built at. */
  to?: string
}

/**
 * Every registry file the project holds where `shadcn add` writes it, with its state. Reads only;
 * a path that climbs out of the project or the registry is listed as outside, never followed.
 */
export const upgradeCheck = async (project: URL): Promise<Copied[] | undefined> => {
  const components = JSON.parse(await readFile(new URL('components.json', project), 'utf8')) as { aliases?: Record<string, string> }
  const built = registryOf(project)
  if (!built) return undefined
  const { items } = JSON.parse(await readFile(new URL('registry.json', built), 'utf8')) as { items: { name: string }[] }
  const src = existsSync(new URL('src/', project)) ? 'src/' : ''
  const pathOf = (target: string) => {
    if (target.startsWith('~/')) return target.slice(2)
    const [, alias = '', rest] = /^@([^/]+)\/(.+)$/.exec(target) ?? []
    // shadcn resolves an alias through the app's tsconfig `paths`; this reads `@/` as `src/`
    // when the project has one and as its root otherwise, shadcn's own fallback.
    const at = components.aliases?.[alias]
    return at?.startsWith('@/') ? `${src}${at.slice(2)}/${rest}` : undefined
  }
  const copied: Copied[] = []
  /** Every path an item names, copied or not, and the folders they sit in, which a file no item names any more is looked for in. */
  const named = new Set<string>()
  const folders = new Set<string>()
  // `new URL` resolves every `..`, encoded or not, so a prefix is the whole test.
  const within = (url: URL, folder: URL) => url.href.startsWith(folder.href)
  for (const { name } of items) {
    const source = new URL(`${name}.json`, built)
    if (!within(source, built)) {
      copied.push({ path: name, state: 'outside' })
      continue
    }
    const item = JSON.parse(await readFile(source, 'utf8')) as Built
    for (const file of item.files ?? []) {
      const path = pathOf(file.target)
      if (path && !within(new URL(path, project), project)) {
        copied.push({ path: file.target, state: 'outside' })
        continue
      }
      if (path) {
        named.add(path)
        folders.add(path.slice(0, path.lastIndexOf('/') + 1))
      }
      const text = path && (await readFile(new URL(path, project), 'utf8').catch(() => undefined))
      if (!path || text === undefined) continue
      const [, from, hash] = marker.exec(text) ?? []
      const to = marker.exec(file.content)?.[1]
      if (!hash) {
        copied.push({ path, state: 'unknown', to })
        continue
      }
      const differs = hash !== hashOf(file.content)
      const edited = hash !== hashOf(text)
      copied.push({ path, state: `${differs ? 'differs' : 'up to date'}${edited ? ', edited' : ''}`, from, to })
    }
  }
  // A marked file no item names any more: an item the registry dropped, which the project deletes.
  for (const folder of folders) {
    const entries = await readdir(new URL(folder || './', project), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = `${folder}${entry.name}`
      if (!entry.isFile() || named.has(path)) continue
      const from = marker.exec(await readFile(new URL(path, project), 'utf8'))?.[1]
      if (from) copied.push({ path, state: 'removed', from })
    }
  }
  return copied
}

const sentence = ({ path, state, from = '', to = 'unknown' }: Copied, own: boolean) =>
  ({
    'up to date': `${path} is up to date.`,
    'up to date, edited': `${path} is up to date, and edited since it was copied.`,
    differs: `${path} differs from ${own ? 'the copy in the registry the installed mithaq ships' : "the installed mithaq-admin's copy"} (built at ${to.slice(0, 12)}), and is not edited since it was copied from ${from.slice(0, 12)}. A hash shows a difference, not which side is newer: diff the two${own ? '' : ', or rebuild mithaq-admin,'} before replacing it.`,
    'differs, edited': `${path} differs from ${own ? 'the copy in the registry the installed mithaq ships' : "the installed mithaq-admin's copy"} (built at ${to.slice(0, 12)}), and is edited since it was copied from ${from.slice(0, 12)}: diff the two and merge by hand.`,
    unknown: `${path} carries no mithaq-admin marker on its last line, so nothing says what it was copied from.`,
    outside: `${path} resolves outside this project or the registry, so it was not read.`,
    removed: `${path} was copied from mithaq-admin at ${from.slice(0, 12)}, and no item of the installed registry names it any more: it was removed from the registry, so delete it.`,
  })[state]

/** `mithaq upgrade --check`: one line per copied file, and 1 where any differs. It never writes. */
export const run = async (project: URL): Promise<number> => {
    if (!existsSync(new URL('components.json', project))) {
    console.log('No components.json here, so nothing was copied with `shadcn add`.')
    return 0
  }
  const copied = await upgradeCheck(project)
  if (!copied) {
    console.log(`No mithaq-admin registry to check the copies against: none is installed here, and the installed mithaq ships no r/ at ${fileURLToPath(registry)}.`)
    return 0
  }
  const own = registryOf(project)?.href === registry.href
  if (!copied.length) console.log('Nothing from mithaq-admin here.')
  for (const one of copied) console.log(sentence(one, own))
  const differing = copied.filter((one) => one.state.startsWith('differs')).length
  if (differing) {
    console.error(`${differing} ${differing === 1 ? 'file differs' : 'files differ'} from ${own ? 'the registry the installed mithaq ships' : 'the installed mithaq-admin'}.`)
    return 1
  }
  return 0
}
