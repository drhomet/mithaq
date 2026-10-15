import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { isIdentifierName, isKeyword, isStrictBindReservedWord } from '@babel/helper-validator-identifier'
import { getAuthTables } from 'better-auth/db'
import { snakeCase } from '../../mithaq/resolve.ts'
import { isScreen } from '../../mithaq/language.ts'
import { Refusal } from '../../mithaq/refusal.ts'

const kinds: Record<string, string> = {
  boolean: 'checkbox',
  date: 'datetime',
  number: 'number',
  string: 'text',
}

type AuthField = {
  type: string
  fieldName?: string
  required?: boolean
  unique?: boolean
  index?: boolean
  onUpdate?: () => unknown
  references?: { model: string }
}

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const sourceString = (value: string) => `'${JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'")}'`
const sourceKey = (name: string) => (identifier.test(name) ? name : sourceString(name))
const databaseName = (name: string) =>
  name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
const exportName = (name: string) => {
  if (!identifier.test(name) || !isIdentifierName(name) || isKeyword(name) || isStrictBindReservedWord(name, true)) {
    throw new Refusal(`Better Auth model "${name}" cannot be a generated file or export name.`)
  }
  return name
}

/**
 * The first line of every file this generator writes. A file without it is the
 * developer's, and is left exactly as it is.
 */
export const header =
  '// Written by `mithaq generate auth` from the Better Auth options generate.providers names. Do not edit.'

const fieldSource = (name: string, field: AuthField) => {
  const fieldName = field.fieldName ?? name
  const dbName = databaseName(fieldName)
  // Better Auth computes every `onUpdate` value; only a date is ours to bump.
  const keys = [
    field.required ? 'required: true' : '',
    field.unique ? 'unique: true' : '',
    // Better Auth's own migrations build it, so leaving it out would have the next migrate drop it.
    // A unique column's constraint is already its index.
    field.index && !field.unique ? 'index: true' : '',
    field.onUpdate && field.type === 'date' ? 'nowOnUpdate: true' : '',
    field.onUpdate ? "providedBy: { update: 'application' }" : '',
  ]
  const rules = keys.filter(Boolean).join(', ')
  if (field.references) {
    // An explicit dbName keeps the relationship from becoming `user_id_id`. A required
    // foreign key is ownership: a user's sessions and accounts go when the user goes.
    const onDelete = field.required ? `onDelete: 'cascade'` : ''
    const bindings = [rules, onDelete].filter(Boolean).join(', ')
    return `  ${sourceKey(fieldName)}: { kind: 'relationship', relationTo: () => ${exportName(field.references.model)}, dbName: ${sourceString(dbName)}${bindings ? `, rules: { ${bindings} }` : ''} },`
  }
  const kind = kinds[field.type]
  if (!kind) {
    throw new Refusal(
      `Better Auth field "${name}" has type "${field.type}", which mithaq has no kind for. Add one to the kinds map in auth/better-auth/generate.ts.`,
    )
  }
  const named = dbName === snakeCase(fieldName) ? '' : `, dbName: ${sourceString(dbName)}`
  return `  ${sourceKey(fieldName)}: { kind: '${kind}'${named}${rules ? `, rules: { ${rules} }` : ''} },`
}

const kayanSource = ({
  name,
  table,
  language,
  provider,
  providers,
  screens = {},
  access = false,
  drawn,
  schemaName,
  idKind,
}: {
  name: string
  table: { modelName?: string; fields: Record<string, AuthField> }
  language: string
  provider?: string
  providers?: string
  screens?: Readonly<Record<string, readonly string[]>>
  access?: boolean
  drawn?: readonly string[]
  schemaName?: string
  idKind: 'text' | 'uuid'
}) => {
  const exported = exportName(name)
  // Written only under screens that list the kayan: a `targets.<screen>` on a kayan
  // the screen does not list is refused at build.
  const title = table.fields.name && (table.fields.name.fieldName ?? 'name')
  const modelName = table.modelName ?? name
  const dbName = databaseName(modelName)
  const titled = title
    ? Object.entries(screens)
        .filter(([screen, kayan]) => kayan.includes(modelName) && !drawn?.includes(screen))
        .map(([screen]) => `, ${sourceKey(screen)}: { useAsTitle: ${sourceString(title)} }`)
        .join('')
    : ''
  const references = [
    ...new Set(
      Object.values(table.fields)
        .map((field) => field.references?.model)
        .filter((model): model is string => model !== undefined && model !== name),
    ),
  ].sort()
  const carries = provider !== undefined && provider === modelName
  const key = identifier.test(provider ?? '') ? `.${provider}` : `[${sourceString(provider ?? '')}]`
  const imports = [
    `import { betterAuth, defaultFields, defaultOperations } from 'mithaq'`,
    `import { defineKayan } from ${sourceString(language)}`,
    ...(carries ? [`import { providers } from ${sourceString(providers ?? '')}`] : []),
    ...references.map((model) => `import { ${exportName(model)} } from './${exportName(model)}.ts'`),
    ...(access ? [`import { access } from './${exported}.access.ts'`] : []),
    ...(drawn ? [`import { screens } from './${exported}.screens.ts'`] : []),
  ]
  if (!carries) imports[0] = `import { defaultFields, defaultOperations } from 'mithaq'`
  return `${header}
// This kayan's access and what each screen draws of it are the project's:
// \`${exported}.access.ts\` exporting \`access\` and \`${exported}.screens.ts\` exporting
// \`screens\`, beside this file, are imported here on the next run. A kayan
// built under this one's name elsewhere is refused by every relationship to it.
${imports.join('\n')}

export const ${exported} = defineKayan({
  name: ${sourceString(modelName)}${dbName === modelName ? '' : `,
  dbName: ${sourceString(dbName)}`},${schemaName === undefined ? '' : `
  schemaName: ${sourceString(schemaName)},`}${carries ? `
  auth: betterAuth({ server: providers${key}.server }),` : ''}
  targets: { ${drawn ? `${titled.slice(2)}${titled ? ', ' : ''}...screens, service: { operations: defaultOperations }` : `service: { operations: defaultOperations }${titled}`} },${access ? `
  access,` : ''}
  fields: {
    ...defaultFields,
    id: { kind: '${idKind}' },
${Object.entries(table.fields)
  .map(([field, definition]) => `  ${fieldSource(field, definition)}`)
  .join('\n')}
  },
})
`
}

const readFolder = (folder: URL) =>
  readdir(folder, { withFileTypes: true }).catch((error: { code?: string }) => {
    if (error.code === 'ENOENT') return []
    throw error
  })

const barrelName = 'index'

// A plugin that only adds fields to `user` or `session` names those tables in its
// schema too, so the tables Better Auth ships with no plugin are subtracted.
const barrelSource = (options: Parameters<typeof getAuthTables>[0], tables: readonly string[]) => {
  const shipped = new Set(Object.keys(getAuthTables({} as Parameters<typeof getAuthTables>[0])))
  const claimed = new Map<string, string>()
  const plugins = (options as { plugins?: readonly { id?: string; schema?: Record<string, unknown> }[] }).plugins ?? []
  for (const plugin of plugins) {
    if (!plugin?.id || !plugin.schema) continue
    for (const table of Object.keys(plugin.schema)) {
      if (shipped.has(table) || claimed.has(table)) continue
      claimed.set(table, plugin.id)
    }
  }
  const groups = new Map<string, string[]>([['core', []]])
  for (const table of tables) {
    const key = claimed.get(table) ?? 'core'
    groups.set(key, [...(groups.get(key) ?? []), exportName(table)])
  }
  const barrelImports = [...tables].map((table) => exportName(table)).sort()
  return `${header}
// One key per plugin that brought tables of its own, and \`core\` for the tables
// Better Auth ships without one, so a project spreads these lists into
// \`buildAsas\` instead of naming every file. A plugin that leaves takes its key
// with it, and \`mithaq generate auth --check\` reports the drift.
${barrelImports.map((one) => `import { ${one} } from './${one}.ts'`).join('\n')}

export const betterAuth = {
${[...groups].map(([key, list]) => `  ${sourceKey(key)}: [${list.join(', ')}],`).join('\n')}
} as const
`
}

/**
 * Writes one kayan file per Better Auth table, and one barrel beside them. With `check`, writes
 * nothing and returns the files a run would change or delete. A file without the header is never touched.
 */
export const generateAuth = async ({
  options,
  directory,
  language,
  check = false,
  provider,
  providers,
  screens,
  schemaName,
}: {
  options: Parameters<typeof getAuthTables>[0]
  directory: URL
  /** The module each generated kayan imports `defineKayan` from: `generate.language`, as given. */
  language: string
  check?: boolean
  /** The Postgres schema every kayan of this instance is built in, from its `providers` entry. */
  schemaName?: string
  /** Each screen of the language by name, and the kayan it lists, which is where a title is written. */
  screens?: Readonly<Record<string, readonly string[]>>
} & (
  | { provider?: undefined; providers?: undefined }
  | {
      /** The kayan this instance authenticates, whose file carries the `auth` key. */
      provider: string
      /** The module that file imports `providers` from: `generate.providers`, as given. */
      providers: string
    }
)): Promise<string[]> => {
  const tables = getAuthTables(options)
  const names = Object.keys(tables)
  // With a `uuid` id, Better Auth's pg adapter leaves the id out of the insert and the
  // column's `defaultRandom` fills it; a text kayan under a uuid instance fails every insert.
  const idKind = options.advanced?.database?.generateId === 'uuid' ? 'uuid' : 'text'
  if (names.includes(barrelName)) {
    throw new Refusal(
      `Better Auth model "${barrelName}" would be written to the same file as the barrel this generator writes. Rename the model.`,
    )
  }
  // The whole directory is read before anything is written or removed, so a file
  // that stops the run stops it before the first deletion.
  if (!check) await mkdir(directory, { recursive: true })
  const files = (await readFolder(directory)).map((entry) => entry.name)
  // A sibling `<kayan>.access.ts` or `<kayan>.screens.ts` is the only way in: the
  // generated file is the generator's.
  const siblings = new Set(files.filter((file) => file.endsWith('.access.ts') || file.endsWith('.screens.ts')))
  // Read by importing it: a title written beside a block the sibling also writes is
  // one the compiler refuses as overwritten.
  const drawnBy = new Map<string, string[]>()
  for (const file of siblings) {
    if (!file.endsWith('.screens.ts')) continue
    const exported = ((await import(new URL(file, directory).href)) as { screens?: unknown }).screens
    drawnBy.set(file, exported && typeof exported === 'object' ? Object.keys(exported) : [])
  }
  const wanted = new Map(
    Object.entries(tables).map(([name, table]) => [
      `${name}.ts`,
      kayanSource({ name, table: table as never, language, provider, providers, screens, access: siblings.has(`${name}.access.ts`), drawn: drawnBy.get(`${name}.screens.ts`), schemaName, idKind }),
    ]),
  )
  // Otherwise the `auth` key would be written onto nothing.
  const named = Object.entries(tables).some(([name, table]) => ((table as { modelName?: string }).modelName ?? name) === provider)
  if (provider !== undefined && !named) {
    throw new Refusal(
      `No Better Auth table of the "${provider}" instance is named "${provider}", so there is no kayan for its \`auth\` to sit on. Name the instance after the table its sessions belong to, which is \`user\` unless its options rename it.`,
    )
  }
  wanted.set(`${barrelName}.ts`, barrelSource(options, names))
  const changed: string[] = []
  const stale: string[] = []
  const theirs: string[] = []

  for (const file of files) {
    if (!file.endsWith('.ts')) continue
    const current = await readFile(new URL(file, directory), 'utf8')
    if (wanted.has(file)) {
      if (!current.startsWith(header)) theirs.push(file)
      else if (current === wanted.get(file)) wanted.delete(file)
      continue
    }
    if (current.startsWith(header)) stale.push(file)
  }
  if (theirs.length) {
    throw new Refusal(
      theirs.length > 1
        ? `${theirs.sort().join(', ')} were not written by \`mithaq generate auth\` and generating would overwrite them. Move them or delete them.`
        : `${theirs[0]} was not written by \`mithaq generate auth\` and generating would overwrite it. Move it or delete it.`,
    )
  }

  for (const file of stale) {
    changed.push(file)
    if (!check) await rm(new URL(file, directory))
  }

  for (const [file, source] of wanted) {
    changed.push(file)
    if (!check) await writeFile(new URL(file, directory), source)
  }
  return changed.sort()
}

/** The auth generator as the CLI runs it. */
export const run = async (project: URL, check: boolean): Promise<number> => {
  const { generate, targets } = (await import(new URL('src/mithaq.ts', project).href)) as {
    generate?: { auth?: string; language?: unknown; providers?: unknown }
    targets?: Record<string, Parameters<typeof isScreen>[0]>
  }
  const screens = Object.fromEntries(
    Object.entries(targets ?? {}).flatMap(([name, target]) => (isScreen(target) ? [[name, target.kayan] as const] : [])),
  )
  // Where the files go is the project's choice, so nothing stands in for a folder it left out.
  const folder: unknown = generate?.auth
  if (typeof folder !== 'string') {
    throw new Refusal(
      "src/mithaq.ts names no `generate.auth`, which is the folder this generator writes the Better Auth kayan into. Add `auth: '<folder>'` to `generate`, such as `auth: 'src/kayan/auth/'`.",
    )
  }
  const root = new URL(folder, project)
  // Resolved from where the generated files sit, since each imports it exactly as written.
  const from: unknown = generate?.providers
  if (typeof from !== 'string') {
    throw new Refusal(
      `src/mithaq.ts names no \`generate.providers\`, which is the module this generator reads \`providers\` from and writes into each generated kayan's import. Add \`providers: '<package name, or a path relative to a generated file>'\` to \`generate\`, beside \`auth: ${sourceString(folder)}\`.`,
    )
  }
  // Resolved under `require`'s conditions, because `import.meta.resolve` takes no
  // parent without a flag on Node 24.
  let resolved: string
  try {
    resolved = createRequire(new URL('instance/index.ts', root)).resolve(from)
  } catch (error) {
    if ((error as { code?: string }).code !== 'MODULE_NOT_FOUND') throw error
    throw new Refusal(
      `\`generate.providers\` names "${from}", which cannot be found from a generated file under ${sourceString(folder)}. Name a package this project depends on, or a path relative to a generated file.`,
    )
  }
  // The language sits wherever the project's layout puts it, a package or a file, so nothing stands in for it either.
  const language: unknown = generate?.language
  if (typeof language !== 'string') {
    throw new Refusal(
      `src/mithaq.ts names no \`generate.language\`, which is the module each generated kayan imports \`defineKayan\` from. Add \`language: '<package name, or a path relative to a generated file>'\` to \`generate\`, beside \`auth: ${sourceString(folder)}\`.`,
    )
  }
  try {
    createRequire(new URL('instance/index.ts', root)).resolve(language)
  } catch (error) {
    if ((error as { code?: string }).code !== 'MODULE_NOT_FOUND') throw error
    throw new Refusal(
      `\`generate.language\` names "${language}", which cannot be found from a generated file under ${sourceString(folder)}. Name the language's package, or a path relative to a generated file.`,
    )
  }
  const { providers } = (await import(pathToFileURL(resolved).href)) as {
    providers?: Record<string, { options: Parameters<typeof getAuthTables>[0]; schemaName?: unknown }>
  }
  if (!providers) {
    throw new Refusal(
      `${from} exports no \`providers\`, which is the record this generator reads: one key per kayan a Better Auth instance authenticates, each \`{ options, server }\`.`,
    )
  }
  // Checked for every entry before any instance's files are written.
  for (const [provider, { schemaName }] of Object.entries(providers)) {
    if (schemaName === undefined || typeof schemaName === 'string') continue
    // `JSON.stringify` throws on a BigInt and answers `undefined` for a function.
    let shown: string
    try {
      shown = JSON.stringify(schemaName) ?? String(schemaName)
    } catch {
      shown = String(schemaName)
    }
    throw new Refusal(
      `${from} gives the "${provider}" instance the schemaName ${shown}, and a schemaName is the name of a Postgres schema, a string such as 'auth'.`,
    )
  }
  const changed: string[] = []
  for (const [provider, one] of Object.entries(providers)) {
    const schemaName = one.schemaName as string | undefined
    const files = await generateAuth({ options: one.options, directory: new URL(`${provider}/`, root), language, check, provider, providers: from, screens, schemaName })
    changed.push(...files.map((file) => `${provider}/${file}`))
  }
  // A directory of an instance no longer declared is reported, never removed: the
  // generator owns the files it wrote, not the directory holding them.
  if (!check) await mkdir(root, { recursive: true })
  const stale: string[] = []
  for (const entry of await readFolder(root)) {
    if (!entry.isDirectory() || Object.hasOwn(providers, entry.name)) continue
    const barrel = await readFile(new URL(`${entry.name}/${barrelName}.ts`, root), 'utf8').catch(() => '')
    if (barrel.startsWith(header)) stale.push(`${entry.name}/`)
  }
  const report = () => {
    if (!stale.length) return
    const sentence = `${stale.join(', ')} ${stale.length > 1 ? 'are directories' : 'is a directory'} of an instance ${from} no longer declares. Delete ${stale.length > 1 ? 'them' : 'it'}: this command never removes a directory.`
    if (check) console.error(sentence)
    else console.log(sentence)
  }
  if (check && (changed.length || stale.length)) {
    if (changed.length) console.error(`Stale auth kayan: ${changed.join(', ')}. Run \`mithaq generate auth\`.`)
    report()
    return 1
  }
  console.log(changed.length ? `Wrote ${changed.join(', ')}.` : 'Auth kayan are up to date.')
  report()
  return 0
}
