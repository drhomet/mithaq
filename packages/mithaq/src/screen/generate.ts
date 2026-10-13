import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { isIdentifierName } from '@babel/helper-validator-identifier'
import { packageOf, type ScreenClient, type ClientField, type ClientKayan } from './index.ts'
import { referencesIn } from './client.ts'
import { Refusal } from '../mithaq/refusal.ts'

const typesHeader = '// Written by `mithaq generate screens`. Do not edit.'
const exec = promisify(execFile)
// Not shared with `generate auth`: that module imports `better-auth/db`, which
// `generate screens` would then load for one line.
const sourceString = (value: string) => `'${JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'")}'`

const camel = (name: string) => name.replace(/[-_](.)/g, (_, letter: string) => letter.toUpperCase())
const pascal = (name: string) => {
  const cased = camel(name)
  return cased.charAt(0).toUpperCase() + cased.slice(1)
}

const sourceKey = (name: string) => (isIdentifierName(name) ? name : sourceString(name))

// One type per kayan of the screen from its fields, which `useValues<CoursesValues>()` is typed from.
const typesOf = (client: ScreenClient, locales: readonly string[]) => {
  const kayan = Object.values(client.kayan) as ClientKayan[]
  const nameOf = (name: string) => `${/^[0-9]/.test(name) ? '_' : ''}${pascal(name)}Values`
  const names = kayan.map((one) => nameOf(one.name))
  if (new Set(names).size !== names.length) throw new Refusal('Two kayan of one screen generate the same values type name. Rename one kayan.')
  const idOf = (name: string) => {
    const kind = client.kayan[name]?.fields.find((field) => field.name === 'id')?.kind
    return kind === 'number' ? 'number' : kind === 'text' || kind === 'uuid' ? 'string' : 'unknown'
  }
  const fieldType = (field: ClientField): string => {
    let value: string
    if (field.kind === 'text' && field.options?.length) value = field.options.map((option) => sourceString(option.value)).join(' | ')
    else if (field.rules.localized === true) value = `Record<${locales.map(sourceString).join(' | ') || 'string'}, string>`
    else if (field.kind === 'relationship' || field.kind === 'upload') value = `${idOf(field.relationTo ?? '')}${field.hasMany ? '[]' : ''}`
    // A join to a kayan this screen does not draw has no type here to name.
    else if (field.kind === 'join') value = field.relationTo && client.kayan[field.relationTo] ? `Values[${sourceString(field.relationTo)}][]` : 'unknown[]'
    else value = ({ text: 'string', email: 'string', uuid: 'string', date: 'string', number: 'number', integer: 'number', decimal: 'string', checkbox: 'boolean', datetime: 'Date', textArray: 'string[]', richText: '{ root: Record<string, unknown> }' } as Record<string, string>)[field.kind] ?? 'unknown'
    // A stored row always holds an id, so it is never `| null`.
    return field.name !== 'id' && field.kind !== 'join' && field.rules.required !== true && value !== 'unknown' ? `${value} | null` : value
  }
  const values = kayan.map((one, at) => `export type ${names[at]} = {\n${one.fields.map((field) => `  ${sourceKey(field.name)}: ${fieldType(field)}`).join('\n')}\n}`)
  const pages = kayan.map((one) => `  ${sourceKey(one.name)}: ${Object.keys(one.pages).map(sourceString).join(' | ') || 'never'}`)
  return `${typesHeader}
import type { ScreenClient as Client } from 'mithaq/admin'
export type { PageClient } from 'mithaq/admin'
${values.join('\n')}
export type Values = {
${kayan.map((one, at) => `  ${sourceKey(one.name)}: ${names[at]}`).join('\n')}
}
export type Pages = {
${pages.join('\n')}
}
export type ScreenClient = Client<Pages>
`
}

// One literal, lazy `import.meta.glob` per package over exactly the files the
// references name: Vite resolves a glob at build and takes no variable.
const globOf = ({ screen, client, root, app, appName, from }: { screen: string; client: ScreenClient; root: URL; app: URL; appName: unknown; from: URL }) => {
  // Each base is written from the screen's own folder into the project, the
  // folder holding both the language and the app: the workspace root of a
  // monorepo, the package itself otherwise. `files.ts` is committed, so a base
  // never names a folder outside it, which differs from machine to machine.
  const realApp = realpathSync(fileURLToPath(app))
  const here = join(realApp, relative(fileURLToPath(app), fileURLToPath(from)))
  const ours = realpathSync(fileURLToPath(root)).split(sep)
  const theirs = realApp.split(sep)
  let shared = 0
  while (shared < ours.length && ours[shared] === theirs[shared]) shared++
  const project = ours.slice(0, shared).join(sep) || sep
  const inProject = (folder: string) => !isAbsolute(relative(project, folder)) && relative(project, folder).split(sep)[0] !== '..'
  const baseOf = (folder: string) => {
    if (!inProject(folder)) throw new Refusal(`The ${screen} screen's files are read from ${folder}, outside the project at ${project}.`)
    return `${relative(here, folder).replaceAll('\\', '/')}/`
  }
  const linkFrom = ({ start, name }: { start: string; name: string }) => {
    for (let folder = start; ; folder = dirname(folder)) {
      const link = join(folder, 'node_modules', name)
      if (existsSync(link)) return link
      if (folder === project || dirname(folder) === folder) return undefined
    }
  }
  // A workspace package is read where it is, which npm, pnpm, yarn and Bun
  // agree on. Any other is read through its `node_modules` link, because the
  // folder behind it names a version and a hash, or lies outside the project.
  // An app that depends on the asas alone links no feature package under an
  // isolated install (pnpm, Bun), so the asas, which depends on each, is asked next.
  const installed = (name: string) => {
    const link = linkFrom({ start: realApp, name }) ?? linkFrom({ start: ours.join(sep), name })
    if (!link) throw new Refusal(`The ${screen} screen names files of ${name}, which no node_modules in the project holds. Install it in the app.`)
    const real = realpathSync(link)
    return baseOf(inProject(real) && !relative(project, real).split(sep).includes('node_modules') ? real : link)
  }
  const linked = app.href === root.href ? '/' : baseOf(ours.join(sep))
  const byPackage = new Map<string, string[]>()
  for (const key of new Set(referencesIn(client).map((reference) => reference.slice(0, reference.indexOf('#'))))) {
    const name = key.startsWith('./') ? '' : key.slice(0, key.indexOf(':'))
    byPackage.set(name, [...(byPackage.get(name) ?? []), name ? key.slice(name.length + 1) : key])
  }
  const glob = (files: string[], base: string) => `import.meta.glob([${files.sort().map(sourceString).join(', ')}], { base: ${sourceString(base)}${base === '/' ? '' : ', exhaustive: true'} })`
  const bare = byPackage.get('') ?? []
  // `screen.json` prints a path decoded, which `new URL` would misread at a `%` or a `?`.
  const base = bare.length && bare.every((file) => existsSync(join(fileURLToPath(app), file))) ? '/' : linked
  const at = base === '/' ? app : root
  const missing = bare.filter((file) => !existsSync(join(fileURLToPath(at), file)))
  if (missing.length) {
    throw new Refusal(`The ${screen} screen's root page is drawn from a package that is neither the app serving it nor the project: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} in neither. Draw a screen's root page from the app or the project.`)
  }
  const own = glob(bare, base)
  const named = [...byPackage.keys()].filter(Boolean).sort()
  if (!named.length) {
    return `${typesHeader}
/// <reference types="vite/client" />
// Every file the \`${screen}\` screen's references name, each loaded when a page draws it.
export const files = ${own}
`
  }
  return `${typesHeader}
/// <reference types="vite/client" />
// Every file the \`${screen}\` screen's references name, each loaded when a page draws it, keyed as the reference prints it.
const named = (name: string, files: Record<string, () => Promise<unknown>>) => Object.fromEntries(Object.entries(files).map(([file, load]) => [\`\${name}:\${file}\`, load]))
export const files = {
${bare.length ? `  ...${own},\n` : ''}${named.map((name) => `  ...named(${sourceString(name)}, ${glob(byPackage.get(name)!, name === appName ? '/' : installed(name))}),\n`).join('')}}
`
}

const routesOf = (screen: string, client: ScreenClient, prefix: string) => {
  const segments = client.path.split('/').filter(Boolean)
  const base = segments.join('.')
  const id = `${prefix}${segments.join('/')}`
  const name = sourceString(screen)
  const imports = (names: string, host: string) => `${typesHeader}
import { ${names} } from '@tanstack/react-router'
import { ${host} } from '@/screens.tsx'
import { files } from './${screen}/files.ts'
`
  return [
    [`${base}.tsx`, `${imports('Outlet, createFileRoute', 'ScreenFrame, frameLoader')}
export const Route = createFileRoute('${id}')({
  loader: ({ location }) => frameLoader({ screen: ${name}, files, href: location.href }),
  component: () => (
    <ScreenFrame files={files} data={Route.useLoaderData()}>
      <Outlet />
    </ScreenFrame>
  ),
})
`],
    [`${base}.index.tsx`, `${imports('createFileRoute', 'ScreenPageView, askedFor, pageHead, pageLoader')}
export const Route = createFileRoute('${id}/')({
  loader: ({ location }) => pageLoader({ screen: ${name}, files, path: '', query: {}, href: location.href }),
  head: ({ loaderData, match }) => pageHead(loaderData, match.context),
  component: () => <ScreenPageView files={files} data={Route.useLoaderData()} query={askedFor({})} onQuery={() => {}} />,
})
`],
    [`${base}.$.tsx`, `${imports('createFileRoute', 'ScreenNotFound, ScreenPageView, askedFor, pageHead, pageLoader')}
export const Route = createFileRoute('${id}/$')({
  validateSearch: askedFor,
  loader: ({ location, params }) => pageLoader({ screen: ${name}, files, path: params._splat ?? '', query: location.search, href: location.href }),
  head: ({ loaderData, match }) => pageHead(loaderData, match.context),
  notFoundComponent: () => <ScreenNotFound files={files} screen={${name}} />,
  component: Page,
})

function Page() {
  const navigate = Route.useNavigate()
  return <ScreenPageView files={files} data={Route.useLoaderData()} query={Route.useSearch()} onQuery={(search) => void navigate({ search })} />
}
`],
  ] as const
}

/**
 * Writes each screen's `screen.json`, `types.ts`, `files.ts` and route files under `into`, and answers the
 * stale files. With `check` it writes nothing. `into` must sit under a TanStack Router `routes` folder.
 */
export const generateScreens = async ({
  root,
  screens,
  into,
  locales = [],
  check = false,
}: {
  root: URL
  screens: Readonly<Record<string, ScreenClient>>
  into: URL
  locales?: readonly string[]
  check?: boolean
}): Promise<string[]> => {
  const stale: string[] = []
  const named = (at: URL) => relative(fileURLToPath(root), fileURLToPath(at)).replaceAll('\\', '/')
  const routesAt = into.pathname.lastIndexOf('/routes/')
  if (routesAt < 0 && Object.keys(screens).length) {
    throw new Refusal(`${named(into)}/ is under no \`routes\` folder, and \`mithaq generate screens\` writes each screen's route files there. Name a folder under src/routes/ in generate.screens.`)
  }
  const prefix = decodeURIComponent(into.pathname.slice(routesAt + '/routes'.length))
  // The app is the package holding `into`, and Vite's root is its folder.
  const app = packageOf(into) ?? root
  const appName: unknown = JSON.parse(await readFile(new URL('package.json', app), 'utf8').catch(() => '{}')).name
  const wanted = Object.entries(screens).flatMap(([key, client]) => {
    const from = new URL(`${key}/`, into)
    return [
      [new URL('screen.json', from), `${JSON.stringify(client, null, 2)}\n`],
      [new URL('types.ts', from), typesOf(client, locales)],
      [new URL('files.ts', from), globOf({ screen: key, client, root, app, appName, from })],
      ...routesOf(key, client, prefix).map(([file, source]) => [new URL(file, into), source] as const),
    ] as const
  })
  const before = await Promise.all(wanted.map(([at]) => readFile(at, 'utf8').catch(() => undefined)))
  // A file of the project's own is never overwritten, and nothing is written until every file has been asked.
  wanted.forEach(([at], index) => {
    const held = before[index]
    if (held !== undefined && !at.pathname.endsWith('.json') && !held.startsWith(typesHeader)) {
      throw new Refusal(`${named(at)} was not written by \`mithaq generate screens\` and generating would overwrite it. Move it or delete it.`)
    }
  })
  for (const [index, [at, source]] of wanted.entries()) {
    if (before[index] === source) continue
    stale.push(named(at))
    if (check) continue
    await mkdir(new URL('./', at), { recursive: true })
    await writeFile(at, source)
  }
  // Only a file carrying the header is ever deleted.
  const kept = new Set(wanted.map(([at]) => fileURLToPath(at)))
  const held = await readdir(into, { recursive: true, withFileTypes: true }).catch(() => [])
  for (const entry of held.filter((one) => one.isFile()).map((one) => join(one.parentPath, one.name)).sort()) {
    if (kept.has(entry) || !(await readFile(entry, 'utf8')).startsWith(typesHeader)) continue
    stale.push(named(pathToFileURL(entry)))
    if (!check) await rm(entry)
  }
  return stale
}

/** The command, given the project's own root, answering the code it exits with. */
export const run = async (project: URL, check: boolean): Promise<number> => {
  const source = `import { asas } from ${JSON.stringify(new URL('src/asas.ts', project).href)}; const { locales, generate } = await import(${JSON.stringify(new URL('src/mithaq.ts', project).href)}).catch(() => ({})); const own = Object.entries(asas.targets ?? {}).filter(([, target]) => target?.capability === 'screen'); process.stdout.write(JSON.stringify({ locales: locales ?? [], into: generate?.screens, screens: Object.fromEntries(own.map(([name, target]) => [name, target.client])) }))`
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', source], { cwd: fileURLToPath(project), maxBuffer: 16 * 1024 * 1024 })
  const { locales, into, screens } = JSON.parse(stdout) as { locales: string[]; into?: unknown; screens: Record<string, ScreenClient> }
  // A build with no screen writes nothing, so it needs no folder named.
  const folder = (value: unknown) => (typeof value === 'string' && value.endsWith('/') ? value : undefined)
  if (!folder(into) && (typeof into !== 'object' || into === null) && Object.keys(screens).length) {
    throw new Refusal('`mithaq generate screens` writes under the folder `generate.screens` names in src/mithaq.ts, and it names none. Write `generate: { screens: \'src/routes/(screens)/\' }`.')
  }
  // Every folder named is swept even when it holds no screen now, so a removed screen leaves no route behind.
  const byFolder = new Map<string, Record<string, ScreenClient>>()
  for (const at of folder(into) ? [into] : Object.values(into ?? {})) if (folder(at)) byFolder.set(at as string, {})
  for (const [name, client] of Object.entries(screens)) {
    // `false` is a project saying no app of its own serves this screen, so nothing is written for it.
    if (!folder(into) && (into as Record<string, unknown>)[name] === false) continue
    const at = folder(into) ?? folder((into as Record<string, unknown>)[name])
    if (!at) throw new Refusal(`generate.screens names no folder for the screen ${name}. Name one: \`screens: { ${name}: 'src/routes/(screens)/' }\`.`)
    byFolder.set(at, { ...byFolder.get(at), [name]: client })
  }
  const stale: string[] = []
  for (const [at, own] of byFolder) stale.push(...(await generateScreens({ root: project, screens: own, into: new URL(at, project), locales, check })))
  if (check && stale.length) {
    console.error(`${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} not what a run would write. Run \`mithaq generate screens\`.`)
    return 1
  }
  console.log(stale.length ? `Wrote ${stale.join(', ')}.` : 'Screens are up to date.')
  return 0
}
