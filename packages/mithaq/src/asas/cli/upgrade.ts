import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// The last line of every ejected file: the version (or, for a copy `shadcn add` made, the commit) it came from and the
// hash of the file above. Trailing, because `shadcn add` dropped a file's leading comments only.
const marker = /\n\/\/ mithaq-admin (\S+) ([0-9a-f]{64})\n?$/
// What `shadcn add` dropped, so a hash is the same over the package's text and a copy it made.
const leading = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/

/** What an eject writes above the marker: the file's text, ending in a newline. */
const bodyOf = (text: string) => {
  const body = text.replace(marker, '\n')
  return body.endsWith('\n') ? body : `${body}\n`
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

/** The hash of a copy `shadcn add` made, without its marker and the leading comments it dropped. */
export const hashOf = (text: string) => sha(bodyOf(text).replace(leading, ''))
/**
 * The hash a marker from `from` holds: of the whole text above it for an eject, which writes byte for byte, so an edit
 * to a leading pragma is an edit; without leading comments only for a copy made at a commit, as `shadcn add` wrote it.
 */
const hashFrom = (from: string) => (text: string) => (/^(?:[0-9a-f]{40}|unknown)$/.test(from) ? hashOf(text) : sha(bodyOf(text)))

/** A held file's state against the package's text of it, read as `upgrade --check` reads it. */
export const stateOf = (text: string, source: string): 'up to date' | 'up to date, edited' | 'differs' | 'differs, edited' | 'unknown' => {
  const [, from, hash] = marker.exec(text) ?? []
  if (!hash) return 'unknown'
  const hashed = hashFrom(from!)
  return `${hash !== hashed(source) ? 'differs' : 'up to date'}${hash !== hashed(text) ? ', edited' : ''}`
}

type Item = { name: string; dependencies?: string[]; registryDependencies?: string[]; files: { path: string; target: string }[] }

/** The `mithaq-admin` the project installed: its folder, its version and its items, or none. */
const installedOf = async (project: URL) => {
  let manifest: URL
  try {
    manifest = pathToFileURL(createRequire(new URL('package.json', project)).resolve('mithaq-admin/package.json'))
  } catch {
    return undefined
  }
  const root = new URL('./', manifest)
  const { version } = JSON.parse(await readFile(manifest, 'utf8')) as { version: string }
  const { items } = JSON.parse(await readFile(new URL('registry.json', root), 'utf8')) as { items: Item[] }
  return { root, version, items }
}

// `new URL` resolves every `..`, encoded or not, so a prefix is the whole test.
const within = (url: URL, folder: URL) => url.href.startsWith(folder.href)

/** Where the project keeps each target: `@<alias>/…` through `components.json`, `~/…` from the project's root. */
const targetsOf = async (project: URL) => {
  const components = JSON.parse(await readFile(new URL('components.json', project), 'utf8')) as { aliases?: Record<string, string> }
  const src = existsSync(new URL('src/', project)) ? 'src/' : ''
  return (target: string) => {
    if (target.startsWith('~/')) return target.slice(2)
    const [, alias = '', rest] = /^@([^/]+)\/(.+)$/.exec(target) ?? []
    // shadcn resolves an alias through the app's tsconfig `paths`; this reads `@/` as `src/`
    // when the project has one and as its root otherwise, shadcn's own fallback.
    const at = components.aliases?.[alias]
    return at?.startsWith('@/') ? `${src}${at.slice(2)}/${rest}` : undefined
  }
}

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

/** The folders a piece the package serves (`registry/<file>`) is ejected into: what `eject --prune` sweeps. */
const ejectedFolders = (items: readonly Item[], pathOf: (target: string) => string | undefined) =>
  new Set(items.flatMap((item) => item.files.filter((file) => !file.path.slice('registry/'.length).includes('/')).flatMap((file) => { const path = pathOf(file.target); return path ? folderOf(path) : [] })))

export type Copied = {
  /** The file, relative to the project, or the target or package path that resolved outside it. */
  path: string
  state: 'up to date' | 'up to date, edited' | 'differs' | 'differs, edited' | 'unknown' | 'outside' | 'removed'
  /** The version or commit the file's marker names, when it carries one. */
  from?: string
  /** The installed mithaq-admin's version. */
  to?: string
  /** The item of a file the project always holds, which it never deletes: it ejects the item again instead. */
  item?: string
}

/**
 * Every package file the project holds at its target, ejected or always the project's, with its state. Reads only;
 * a path that climbs out of the project or the package is listed as outside, never followed.
 */
export const upgradeCheck = async (project: URL): Promise<Copied[] | undefined> => {
  const pathOf = await targetsOf(project)
  const installed = await installedOf(project)
  if (!installed) return undefined
  const copied: Copied[] = []
  /** Every path an item names, held or not, and the folders they sit in, which a file no item names any more is looked for in. */
  const named = new Set<string>()
  const folders = new Set<string>()
  const ejected = ejectedFolders(installed.items, pathOf)
  for (const { name, files } of installed.items) {
    for (const file of files) {
      const source = new URL(file.path, installed.root)
      const path = pathOf(file.target)
      if (!within(source, installed.root)) {
        copied.push({ path: file.path, state: 'outside' })
        continue
      }
      if (path && !within(new URL(path, project), project)) {
        copied.push({ path: file.target, state: 'outside' })
        continue
      }
      if (path) {
        named.add(path)
        folders.add(folderOf(path))
      }
      const text = path && (await readFile(new URL(path, project), 'utf8').catch(() => undefined))
      if (!path || text === undefined) continue
      const state = stateOf(text, await readFile(source, 'utf8'))
      const to = installed.version
      copied.push(state === 'unknown' ? { path, state, to } : { path, state, from: marker.exec(text)![1], to, ...(!ejected.has(folderOf(path)) && { item: name }) })
    }
  }
  // A marked file no item names any more: an item the package dropped, which the project deletes.
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

const sentence = ({ path, state, from = '', to = 'unknown', item }: Copied) =>
  ({
    'up to date': `${path} is up to date.`,
    'up to date, edited': `${path} is up to date, and edited since it was ejected.`,
    differs: `${path} differs from the installed mithaq-admin's file (${to}), and is not edited since it was ejected from ${from.slice(0, 12)}. A hash shows a difference, not which side is newer: diff the two before replacing it, or ${item ? `delete it and run \`mithaq eject ${item}\` to take the package's` : 'delete it to draw the package\'s'}.`,
    'differs, edited': `${path} differs from the installed mithaq-admin's file (${to}), and is edited since it was ejected from ${from.slice(0, 12)}: diff the two and merge by hand.`,
    unknown: `${path} carries no mithaq-admin marker on its last line, so nothing says what it was ejected from.`,
    outside: `${path} resolves outside this project or the package, so it was not read.`,
    removed: `${path} was ejected from mithaq-admin ${from.slice(0, 12)}, and no item of the installed package names it any more: it was removed from the package, so delete it.`,
  })[state]

const noComponents = 'No components.json here, so nothing says where mithaq-admin files go.'
const noPackage = 'No mithaq-admin is installed here.'

/** `mithaq upgrade --check`: one line per file the project holds, and 1 where any differs. It never writes. */
export const run = async (project: URL): Promise<number> => {
  if (!existsSync(new URL('components.json', project))) {
    console.log(noComponents)
    return 0
  }
  const copied = await upgradeCheck(project)
  if (!copied) {
    console.log(`${noPackage} Nothing to check the files against.`)
    return 0
  }
  if (!copied.length) console.log('Nothing from mithaq-admin here.')
  for (const one of copied) console.log(sentence(one))
  const differing = copied.filter((one) => one.state.startsWith('differs')).length
  if (differing) {
    console.error(`${differing} ${differing === 1 ? 'file differs' : 'files differ'} from the installed mithaq-admin.`)
    return 1
  }
  return 0
}

/**
 * `mithaq eject <item>`: writes the item's own files where the project keeps them, each byte for byte with a marker,
 * and never over a file already there. It copies no other item and installs nothing: the package serves every
 * sibling, so it only names a primitive or an npm package the project lacks.
 */
export const eject = async (project: URL, name: string): Promise<number> => {
  if (!existsSync(new URL('components.json', project))) {
    console.error(noComponents)
    return 1
  }
  const pathOf = await targetsOf(project)
  const installed = await installedOf(project)
  if (!installed) {
    console.error(`${noPackage} Install it at the version of mithaq, then eject.`)
    return 1
  }
  const wanted = `mithaq-${name.replace(/\.tsx?$/, '').replace(/^mithaq-/, '')}`
  const item = installed.items.find((one) => one.name === wanted)
  if (!item) {
    console.error(`mithaq-admin has no item "${name}". Its items are: ${installed.items.map((one) => one.name).join(', ')}.`)
    return 1
  }
  const files = item.files.map((file) => ({ source: new URL(file.path, installed.root), path: pathOf(file.target), target: file.target }))
  const refused = files.filter(({ source, path }) => !within(source, installed.root) || !path || !within(new URL(path, project), project))
  if (refused.length) {
    console.error(`${refused.map((one) => one.target).join(', ')} resolves outside this project or the package, so nothing was written.`)
    return 1
  }
  const ejected = ejectedFolders(installed.items, pathOf)
  for (const { source, path } of files as { source: URL; path: string }[]) {
    const at = new URL(path, project)
    const text = await readFile(source, 'utf8')
    await mkdir(new URL('./', at), { recursive: true })
    // `wx` fails on a file already there, so an eject never overwrites, whatever raced it.
    const body = bodyOf(text)
    const written = await writeFile(at, `${body}// mithaq-admin ${installed.version} ${sha(body)}\n`, { flag: 'wx' }).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return false
        throw error
      },
    )
    // A file the project always holds (the host, storage, a step) is never deleted: the app needs it.
    const drawn = ejected.has(folderOf(path)) ? '; delete it to draw mithaq-admin\'s again' : ''
    console.log(written ? `${path} is ejected. Edit it in place${drawn}.` : `${path} is already ejected, so it was left as it is.`)
  }
  for (const primitive of item.registryDependencies ?? []) {
    const path = pathOf(`@ui/${primitive}.tsx`)
    if (path && !existsSync(new URL(path, project))) console.log(`${path} is missing: run shadcn add ${primitive}`)
  }
  const require = createRequire(new URL('package.json', project))
  for (const dependency of item.dependencies ?? []) {
    const npm = /^(@?[^@]+)/.exec(dependency)![1]!
    try {
      require.resolve(npm)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') console.log(`${npm} is not installed: install ${dependency}`)
    }
  }
  return 0
}

/**
 * `mithaq eject --prune`: deletes every marked file in the folders pieces are ejected into whose text still hashes
 * to its marker, so the package draws it again. Never an edited, unmarked or `~/` file.
 */
export const prune = async (project: URL): Promise<number> => {
  if (!existsSync(new URL('components.json', project))) {
    console.error(noComponents)
    return 1
  }
  const pathOf = await targetsOf(project)
  const installed = await installedOf(project)
  if (!installed) {
    console.error(noPackage)
    return 1
  }
  for (const folder of ejectedFolders(installed.items, pathOf)) {
    if (!within(new URL(folder, project), project)) continue
    const entries = await readdir(new URL(folder, project), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const path = `${folder}${entry.name}`
      const text = await readFile(new URL(path, project), 'utf8')
      const [, from, hash] = marker.exec(text) ?? []
      if (!hash || hash !== hashFrom(from!)(text)) continue
      await rm(new URL(path, project))
      console.log(`${path} was not edited since it was ejected, so it is deleted and mithaq-admin draws its own.`)
    }
  }
  return 0
}
