#!/usr/bin/env node
// `npm create mithaq my-app` (or pnpm, yarn or bun): lays a new project down from
// the template this package carries, at the version of `@drhomet/mithaq` this
// package was published with. Plain JavaScript on Node's standard library, so
// every package manager runs it with nothing to install first.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
const edit = (file, change) => writeFileSync(file, change(readFileSync(file, 'utf8')))

const generateSecret = () => randomBytes(32).toString('hex')

/** The package manager `npm_config_user_agent` names (`pnpm/10.15.0 npm/? node/v24…`), when it is one of the four. */
export const managerOf = (agent = '') => ['npm', 'pnpm', 'yarn', 'bun'].find((name) => agent.startsWith(`${name}/`))

/**
 * Pins the template's manifests to what a published project installs, in
 * `dependencies` and `devDependencies` alike. `mithaq` and `mithaq-admin`
 * become the published packages under the names every import uses; `asas` and
 * `@asas/auth` stay `"*"`, the project's own workspaces. Any other
 * `workspace:`, `link:` or `file:` spec is an error rather than a pin,
 * because nothing published stands behind it.
 */
export function updatePackageJSONDependencies({ mithaq, mithaqAdmin, packageJson }) {
  for (const dependencies of [packageJson.dependencies, packageJson.devDependencies]) {
    if (!dependencies) continue
    if ('mithaq' in dependencies) dependencies.mithaq = mithaq
    if ('mithaq-admin' in dependencies) dependencies['mithaq-admin'] = mithaqAdmin
    for (const [name, spec] of Object.entries(dependencies)) {
      if (spec !== mithaq && spec !== mithaqAdmin && /^(workspace|link|file):/.test(spec)) {
        throw new Error(`The template's dependency ${name} is ${spec}, which only resolves inside the mithaq repository.`)
      }
    }
  }
}

/**
 * Replaces `from`, a string or a pattern with no group, where the template holds it exactly `count` times, so a
 * template line that moved fails creation instead of shipping a wrong path.
 */
const once = (text, from, to, count = 1) => {
  if (text.split(from).length !== count + 1) throw new Error(`The template no longer holds ${from} ${count === 1 ? 'exactly once' : `${count} times`}.`)
  // A function, so a replacement pattern such as `$'` or `$&` in what a person typed, an organization's name among it, is written as typed.
  return typeof from === 'string' ? text.replaceAll(from, () => to) : text.replace(from, () => to)
}
/**
 * What a project may hold beyond the language, the asas, the `auth` feature and the `tags` example. Each add-on names the
 * add-ons it needs, the files that are its alone (removed when it is left out), the files that stand in for it (removed
 * when it is chosen), the npm packages only it uses (a name ending in `/` is a whole scope), the keys of its words in
 * the shared copy file, `mithaq.json`, which can hold no region, and whether it brings
 * tables, without which the template's migrations, written for every table, do not fit the project. Its lines in a
 * shared file sit in `// add-on: <name>` regions, which `keepAddOns` reads. `rich-text` and `uploads` bring words of the
 * language, kinds and a target, so a project's vocabulary follows the add-ons it holds.
 */
export const addOns = {
  roles: {
    needs: [],
    files: ['packages/features/roles', 'packages/mithaq/src/roles/grants.ts', 'packages/asas/src/ui-dashboard/members.tsx', 'packages/asas/src/ui-dashboard/members-card.tsx', 'packages/asas/src/messages/roles.json', 'packages/asas/src/messages/memberRoles.json'],
    without: ['packages/mithaq/src/roles/default-member-roles.ts', 'packages/mithaq/src/roles/member-access.ts'],
    packages: [],
    copy: [],
    tables: true,
  },
  'audit-log': {
    needs: [],
    files: ['packages/features/audit-log', 'packages/mithaq/src/mithaq/audit-sink.ts', 'packages/mithaq/src/ui/activity.tsx', 'packages/mithaq/src/ui/activity-page.tsx', 'packages/asas/src/messages/auditLog.json', 'packages/asas/src/messages/backofficeLog.json'],
    without: [],
    packages: [],
    copy: [],
    tables: true,
  },
  settings: { needs: [], files: ['packages/features/settings', 'packages/asas/src/messages/settings.json'], without: [], packages: [], copy: [], tables: true },
  // The `richText` kind, its Lexical nodes and editor.
  'rich-text': {
    needs: [],
    files: ['packages/mithaq/src/mithaq/rich-text-nodes.ts', 'packages/mithaq/src/ui/rich-text-nodes.tsx'],
    without: [],
    packages: ['lexical', '@lexical/'],
    copy: ['kinds.richText', 'kinds.richText.invalid'],
    tables: false,
  },
  // The `upload` kind, the storage target and its adapters.
  uploads: { needs: [], files: ['packages/mithaq/src/storage'], without: [], packages: ['aws4fetch', 'file-type', 'image-dimensions'], copy: ['kinds.upload', 'kinds.upload.invalid'], tables: false },
  // The organization's images, which an upload field points at.
  media: { needs: ['uploads'], files: ['packages/features/media', 'packages/asas/src/messages/media.json'], without: [], packages: [], copy: [], tables: true },
  // The worked example: its business roles are the roles add-on's, its edit pages draw the audit log's activity, its
  // details are rich text and a course's cover is one of the media.
  courses: {
    needs: ['media', 'roles', 'audit-log', 'rich-text'],
    files: ['packages/features/courses', 'packages/asas/src/ui-dashboard/dashboard.tsx', ...['courses', 'sessions', 'enrollments'].map((one) => `packages/asas/src/messages/${one}.json`)],
    without: ['packages/asas/src/ui-dashboard/home.tsx'],
    packages: [],
    copy: [],
    tables: true,
  },
  backoffice: { needs: [], files: ['apps/asas-backoffice'], without: [], packages: [], copy: [], tables: false },
}

/**
 * The add-ons `asked` names with every one they need, in the table's order, and the ones added for that. A name the
 * table does not hold is refused with the list, so a typo never makes a smaller project than asked for.
 */
export function resolveAddOns(asked) {
  const unknown = asked.filter((name) => !Object.hasOwn(addOns, name))
  if (unknown.length) throw new Error(`No add-on is named ${unknown.map((name) => `"${name}"`).join(', ')}. The add-ons are ${Object.keys(addOns).join(', ')}.`)
  const chosen = new Set()
  const take = (name) => {
    if (chosen.has(name)) return
    chosen.add(name)
    for (const one of addOns[name].needs) take(one)
  }
  for (const name of asked) take(name)
  const ordered = Object.keys(addOns).filter((name) => chosen.has(name))
  return { chosen: ordered, added: ordered.filter((name) => !asked.includes(name)) }
}

/**
 * Keeps the lines of `text` the chosen add-ons hold. A region from `// add-on: <names>` to `// end add-on: <names>` keeps
 * its lines when every add-on it names is chosen; one from `// without add-on: <names>` to its end holds commented lines,
 * uncommented when they are not. The marker lines go either way, so a project reads as if written for its add-ons. A
 * marker that is unbalanced or names no add-on fails creation, as a template line that moved does.
 */
export function keepAddOns(text, chosen) {
  const open = []
  const kept = []
  for (const line of text.split('\n')) {
    const marker = /^\s*\/\/ (end )?(without )?add-on: (.+)$/.exec(line)
    // A misspelled marker would otherwise read as a comment, and leave its region in every project.
    if (!marker && /^\s*\/\/.*\badd-?on\b:/.test(line)) throw new Error(`The template holds "${line.trim()}", which reads like an add-on marker and is none.`)
    if (!marker) {
      if (open.every((one) => one.keep)) kept.push(open.some((one) => one.without) ? line.replace(/^(\s*)\/\/ ?/, '$1') : line)
      continue
    }
    const [, end, without, names] = marker
    const label = `${without ?? ''}add-on: ${names}`
    if (end) {
      if (open.pop()?.label !== label) throw new Error(`The template closes "${label}" where no such region is open.`)
      continue
    }
    const named = names.split(', ')
    for (const name of named) if (!Object.hasOwn(addOns, name)) throw new Error(`The template marks a region of the add-on "${name}", which the table does not hold.`)
    const all = named.every((name) => chosen.includes(name))
    open.push({ label, without: Boolean(without), keep: without ? !all : all })
  }
  if (open.length) throw new Error(`The template leaves "${open.at(-1).label}" open.`)
  return kept.join('\n')
}

/** Every text file a project's own commands or imports read, outside what an install writes. */
const textsUnder = (folder) =>
  readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => !file.split(/[\\/]/).includes('node_modules') && /\.(tsx?|jsx?|json|css|md)$/.test(file))
    .map((file) => join(folder, file))

/**
 * Whether a package's `exports` names `sub` (`''` for the package itself) as Node resolves it: the key equal to it, else
 * the longest `*` pattern it lies under, and not where that key's value is `null`, an exclusion. A `.` or `..` segment
 * names nothing, since it would climb out of what the key exports.
 */
export const exportsPath = (exports, sub) => {
  if (sub.split('/').some((segment) => segment === '.' || segment === '..')) return false
  const asked = sub === '' ? '.' : `.${sub}`
  const [, value] = Object.entries(exports ?? {})
    .filter(([key]) => (key.endsWith('*') ? asked.startsWith(key.slice(0, -1)) : key === asked))
    .sort(([a], [b]) => (b === asked) - (a === asked) || b.length - a.length)[0] ?? [, null]
  return value !== null
}

/**
 * Folds the monorepo into one package at `project`: the language's and the asas's `src/` side by side, each feature
 * under `src/features/`, and the tenant app, whose `src/` holds no file of the same name as theirs. The package keeps
 * the name `asas`, because the screen host imports it by that name and a package reaches itself through its own
 * `exports`, which also keeps it out of Vite's server bundle, so `import.meta.url` and each `ui()` file stay real.
 * Every import of the language or a feature becomes a path.
 */
const foldIntoOnePackage = (project) => {
  const at = (...path) => join(project, ...path)
  const features = readdirSync(at('packages/features'))
  const [root, language, asas, app, ...ofFeatures] = ['', 'packages/mithaq', 'packages/asas', 'apps/asas-tanstack', ...features.map((one) => `packages/features/${one}`)].map((folder) => readJson(at(folder, 'package.json')))
  // Each path the language names from the asas's folder becomes the package's own, before any import is rewritten.
  edit(at('packages/mithaq/src/mithaq.ts'), (text) =>
    [
      ["new URL('../../asas/src/', import.meta.url)", "new URL('./', import.meta.url)"],
      ["new URL('../../features/', import.meta.url)", "new URL('./features/', import.meta.url)"],
      ["language: '@asas/mithaq',", "language: '../../../mithaq.ts',"],
      ["features: '../features/',", "features: 'src/features/',"],
      ["auth: '../features/auth/',", "auth: 'src/features/auth/',"],
      ["providers: '@asas/mithaq/auth',", "providers: '../../../mithaq/auth/index.ts',"],
      // The dashboard's and the portal's, which the tenant app serves.
      ["'../../apps/asas-tanstack/src/routes/(screens)/'", "'src/routes/(screens)/'", 2],
    ].reduce((one, [from, to, count]) => once(one, from, to, count), text),
  )
  for (const entry of readdirSync(at('packages/asas'))) if (!['package.json', 'components.json', 'src'].includes(entry)) renameSync(at('packages/asas', entry), at(entry))
  renameSync(at('packages/asas/src'), at('src'))
  // The asas's `src/mithaq.ts` is where the mithaq command finds the language; the language's own takes its place.
  rmSync(at('src/mithaq.ts'))
  for (const entry of readdirSync(at('packages/mithaq/src'))) renameSync(at('packages/mithaq/src', entry), at('src', entry))
  for (const one of features) {
    mkdirSync(at('src/features', one), { recursive: true })
    for (const entry of readdirSync(at('packages/features', one))) if (entry !== 'package.json') renameSync(at('packages/features', one, entry), at('src/features', one, entry))
  }
  for (const entry of readdirSync(at('apps/asas-tanstack/src'))) renameSync(at('apps/asas-tanstack/src', entry), at('src', entry))
  for (const entry of ['public', 'vite.config.ts', 'tsconfig.json', 'components.json']) renameSync(at('apps/asas-tanstack', entry), at(entry))
  rmSync(at('packages'), { recursive: true })
  rmSync(at('apps'), { recursive: true })
  const own = (dependencies) => Object.fromEntries(Object.entries(dependencies).filter(([name]) => !name.startsWith('@asas/') && name !== 'asas'))
  const lockCheck = (script) => script.replace('(cd ../../packages/asas && mithaq lock --check)', 'mithaq lock --check')
  writeJson(at('package.json'), {
    name: 'asas',
    private: true,
    type: 'module',
    engines: root.engines,
    scripts: { ...Object.fromEntries(Object.entries(app.scripts).map(([name, script]) => [name, lockCheck(script)])), ...asas.scripts },
    exports: asas.exports,
    dependencies: own(Object.assign({}, language.dependencies, ...ofFeatures.map((one) => one.dependencies), asas.dependencies, app.dependencies)),
    devDependencies: own(Object.assign({}, language.devDependencies, ...ofFeatures.map((one) => one.devDependencies), asas.devDependencies, app.devDependencies, root.devDependencies)),
  })
  const exportsOf = Object.fromEntries(ofFeatures.map((one) => [one.name.slice('@asas/'.length), one.exports]))
  // A feature is reached through what its `exports` say, as it was while it was a package.
  const targetOf = (name, sub) => {
    if (name === 'mithaq') return sub === '' ? 'src/mithaq.ts' : sub === '/auth' ? 'src/mithaq/auth/index.ts' : ['/auth/backoffice-roles', '/auth/organizations'].includes(sub) ? `src/mithaq${sub}.ts` : `src${sub}`
    if (sub === '') return `src/features/${name}/index.ts`
    if (!exportsPath(exportsOf[name], sub)) throw new Error(`@asas/${name}${sub} reaches past the feature's exports.`)
    return `src/features/${name}${sub}`
  }
  for (const file of textsUnder(at('src')).filter((one) => /\.tsx?$/.test(one))) {
    edit(file, (text) =>
      text.replaceAll(/(['"])@asas\/([a-z0-9._-]+)((?:\/[^'"]*)?)\1/g, (_, quote, name, sub) => {
        const path = relative(dirname(file), at(targetOf(name, sub))).replaceAll('\\', '/')
        return `${quote}${path.startsWith('.') ? path : `./${path}`}${quote}`
      }),
    )
  }
  // A screen draws the language's and each feature's files by package; in one package they are all its own, read
  // off Vite's root as `mithaq generate screens` writes them for an app that is the project.
  for (const screen of readdirSync(at('src/routes/(screens)')).filter((one) => existsSync(at('src/routes/(screens)', one, 'screen.json')))) {
    const folder = at('src/routes/(screens)', screen)
    edit(join(folder, 'screen.json'), (text) => text.replaceAll('"@asas/mithaq:./', '"./').replaceAll(/"@asas\/([a-z0-9._-]+):\.\//g, '"./src/features/$1/'))
    const referenced = [...new Set([...readFileSync(join(folder, 'screen.json'), 'utf8').matchAll(/"(\.\/[^"#]+)#[^"]*"/g)].map(([, file]) => file))].sort()
    writeFileSync(join(folder, 'files.ts'), `// Written by \`mithaq generate screens\`. Do not edit.\n/// <reference types="vite/client" />\n// Every file the \`${screen}\` screen's references name, each loaded when a page draws it.\nexport const files = import.meta.glob([${referenced.map((file) => `'${file}'`).join(', ')}], { base: '/' })\n`)
  }
  edit(at('src/styles.css'), (text) => once(text, /\/\*[^*]*\*\/\n@source '[^']*';\n/, "/* The project's own shells, pages and components, which the screens load\n   (`src/ui/app-shell.tsx`). */\n@source './';\n"))
  edit(at('tsconfig.json'), (text) => once(text, /, "\.\.\/\.\.\/packages\/[^\]]*\]/, ']'))
}

/**
 * Leaves `project` holding the chosen add-ons alone: each other add-on's files, regions and package go, and so do the
 * files that stand in for a chosen one. The template's migrations build every table, so a project short of any add-on
 * with tables starts with none, and its first `mithaq migrate` writes them for the tables it has.
 */
const keepOnly = ({ project, chosen }) => {
  for (const [name, { files, without }] of Object.entries(addOns)) {
    for (const file of chosen.includes(name) ? without : files) rmSync(join(project, file), { recursive: true })
  }
  for (const file of textsUnder(project).filter((one) => /\.tsx?$/.test(one))) {
    const text = readFileSync(file, 'utf8')
    if (text.includes('add-on: ')) writeFileSync(file, keepAddOns(text, chosen))
  }
  for (const file of textsUnder(project).filter((one) => basename(one) === 'package.json')) {
    const manifest = readJson(file)
    for (const [name, { packages }] of Object.entries(addOns).filter(([one]) => !chosen.includes(one))) {
      for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
        for (const dependency of Object.keys(dependencies ?? {})) {
          if (dependency === `@asas/${name}` || packages.some((one) => (one.endsWith('/') ? dependency.startsWith(one) : dependency === one))) delete dependencies[dependency]
        }
      }
    }
    writeJson(file, manifest)
  }
  const copy = join(project, 'packages/asas/src/messages/mithaq.json')
  const shared = readJson(copy)
  for (const [name, { copy: keys }] of Object.entries(addOns)) if (!chosen.includes(name)) for (const key of keys) delete shared[key]
  writeJson(copy, shared)
  if (Object.entries(addOns).every(([name, { tables }]) => !tables || chosen.includes(name))) return
  const migrations = join(project, 'packages/asas/src/migrations')
  for (const entry of readdirSync(migrations)) if (entry !== 'drizzle.config.ts') rmSync(join(migrations, entry), { recursive: true })
  // Each answer names a change between two of the migrations just removed.
  writeFileSync(join(project, 'packages/asas/mithaq.hints.json'), '[]\n')
}

/**
 * The organization mode and who may sign up, as `organizations.ts` writes them: one organization,
 * shown by name, by invitation unless asked, and many founding one by every sign-up. Open joiners of
 * the courses example are students; without the roles add-on nobody is given a role on joining. Every
 * open sign-up proves its address.
 */
export function organizationSettings({ organizations = 'one', showOrganization = true, signUp, chosen, organizationName }) {
  if (organizations === 'none') throw new Error('--organizations is one or many, not "none": one organization never shown is --organizations one --show-organization no.')
  if (!['one', 'many'].includes(organizations)) throw new Error(`--organizations is one or many, not "${organizations}".`)
  if (signUp !== undefined && !['invite', 'open'].includes(signUp)) throw new Error(`--sign-up is invite or open, not "${signUp}".`)
  const many = organizations === 'many'
  if (many && signUp === 'invite') throw new Error('many organizations take --sign-up open: each sign-up founds its own.')
  if (many && !showOrganization) throw new Error('many organizations are shown by name: a person who belongs to several switches between them.')
  // One line of 1 to 100 characters, as the auth setup keeps an organization's name, so the project loads.
  for (const one of Object.values(organizationName ?? {})) {
    if (typeof one !== 'string' || !one.trim() || one.length > 100 || /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u.test(one)) throw new Error('--organization-name is one line of 1 to 100 characters.')
  }
  return {
    organizations,
    showOrganization,
    signUp: signUp ?? (many ? 'open' : 'invite'),
    joinRole: !many && chosen.includes('courses') ? 'student' : null,
    verifyEmail: true,
    allowedDomains: [],
    // The Arabic falls back to the English, so the language never reads an organization with no name.
    ...(organizationName?.en && { organizationName: { en: organizationName.en.trim(), ar: organizationName.ar?.trim() || organizationName.en.trim() } }),
  }
}

/**
 * Writes `settings` over the values `organizations.ts` holds, each line the template holds once. A name is written as
 * JSON, whose double quotes leave an apostrophe in it as written.
 */
const writeOrganizations = (file, settings) =>
  edit(file, (text) => Object.entries(settings).reduce((one, [key, value]) => once(one, new RegExp(`(?<=^export const ${key}: [^=]+ = ).+$`, 'm'), key === 'organizationName' ? JSON.stringify(value) : JSON.stringify(value).replaceAll('"', "'")), text))

/**
 * Writes the project `name` under `cwd` from `template`, and answers its
 * folder. `version` is the `@drhomet/mithaq` and `@drhomet/mithaq-admin` the
 * project installs, pinned exactly so the two cannot drift apart and an
 * upgrade is a change the project makes; `mithaq` and `mithaqAdmin` replace the
 * dependencies themselves, which only the release check does. `layout` is `monorepo`, the
 * language, each feature and the asas as packages, or `single`, one package with the tenant app and no
 * backoffice console. `addOns` names the add-ons the project holds beside auth and the tags example, with
 * every one they need; none is the minimal project.
 */
export function create({ name, cwd, template, version, mithaq = `npm:@drhomet/mithaq@${version}`, mithaqAdmin = `npm:@drhomet/mithaq-admin@${version}`, layout = 'monorepo', addOns: asked = [], organizations, showOrganization, signUp, organizationName }) {
  // A package name npm accepts, so it is also one folder, inside `cwd`, and a scope.
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214) {
    throw new Error(`"${name}" is not a valid project name: use lowercase letters, digits, "-", "." and "_", starting with a letter or digit.`)
  }
  if (!['monorepo', 'single'].includes(layout)) throw new Error(`The layout is monorepo or single, not "${layout}".`)
  const { chosen } = resolveAddOns(asked)
  const settings = organizationSettings({ organizations, showOrganization, signUp, chosen, organizationName })
  const backoffice = chosen.includes('backoffice')
  if (layout === 'single' && backoffice) throw new Error('A single package serves the tenant app alone. Choose the monorepo layout to include the backoffice console.')
  const project = join(cwd, name)
  if (existsSync(project) && readdirSync(project).length > 0) {
    throw new Error(`${project} already exists and is not empty. Pick another name.`)
  }
  cpSync(template, project, { recursive: true })
  // The template's packages sit in `templates/` in the mithaq repository, beside the framework's own `packages/`; a
  // project holds them in `packages/`, and every relative path an app names into them follows.
  renameSync(join(project, 'templates'), join(project, 'packages'))
  for (const file of textsUnder(project)) edit(file, (text) => text.replaceAll(/((?:\.\.\/)+)templates(?=[/'"])/g, '$1packages'))
  // A snippet's marker names the repository file the docs test checks it against, a path no project holds.
  for (const file of textsUnder(project).filter((one) => one.endsWith('.md'))) edit(file, (text) => text.replaceAll(/^[ \t]*<!-- from: \S+ -->\n/gm, ''))
  const files = readdirSync(project, { recursive: true })
  // npm drops every `.gitignore` from a published package, so the stage keeps
  // each as `gitignore`.
  for (const file of files.filter((file) => basename(file) === 'gitignore')) {
    renameSync(join(project, file), join(project, dirname(file), '.gitignore'))
  }
  for (const file of files.filter((file) => basename(file) === 'package.json')) {
    const packageJson = readJson(join(project, file))
    updatePackageJSONDependencies({ mithaq, mithaqAdmin, packageJson })
    writeJson(join(project, file), file === 'package.json' ? { name, ...packageJson } : packageJson)
  }
  keepOnly({ project, chosen })
  writeOrganizations(join(project, 'packages/mithaq/src/mithaq/auth/organizations.ts'), settings)
  // One `.env` for the asas's commands and one for each app's dev server,
  // the same secrets in each: the tenant app and the backoffice console sign
  // and read each other's sessions under one `BETTER_AUTH_SECRET`.
  const env = readFileSync(join(project, 'packages/asas/.env.example'), 'utf8').replace(/^([A-Z_]*SECRET)=$/gm, (_, key) => `${key}=${generateSecret()}`)
  if (layout === 'single') {
    foldIntoOnePackage(project)
    writeFileSync(join(project, '.env'), env, { mode: 0o600 })
  } else {
    for (const folder of ['packages/asas', 'apps/asas-tanstack', ...(backoffice ? ['apps/asas-backoffice'] : [])]) writeFileSync(join(project, folder, '.env'), env, { mode: 0o600 })
    // An agent started at the root reads no file below it until it touches one, and the repository's page shows the
    // root's README alone, so the guide, the agent files and the skills sit there, as a single package's do.
    for (const file of ['AGENTS.md', 'CLAUDE.md', 'README.md', '.claude']) renameSync(join(project, 'packages/asas', file), join(project, file))
    // The project's own scope, on each of its package names and every import of one.
    for (const file of textsUnder(project)) edit(file, (text) => text.replaceAll('@asas/', `@${name}/`))
    writeJson(join(project, 'tsconfig.json'), {
      compilerOptions: { target: 'es2024', module: 'nodenext', moduleResolution: 'nodenext', strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, erasableSyntaxOnly: true, allowImportingTsExtensions: true, types: ['node'] },
      include: ['packages/*/src/**/*.ts', 'packages/features/**/*.ts', 'apps/*/src/**/*.ts'],
      // Each server entry reads Vite's `import.meta.glob`, and each components map mithaq-admin's `.tsx`, which the app's own config checks.
      exclude: ['apps/*/src/server.ts', 'apps/*/src/components.ts'],
    })
  }
  // npm, yarn and Bun read `workspaces`; pnpm 10.6 and later read this file.
  // Told nothing, pnpm installs a `"*"` workspace from the registry, where
  // another package is named `asas`, and skips esbuild's install script, which
  // pnpm 11 then fails on; pnpm 10 reads `onlyBuiltDependencies`, pnpm 11
  // `allowBuilds`.
  const { workspaces = [] } = readJson(join(project, 'package.json'))
  const packages = workspaces.length ? `packages:\n${workspaces.map((folder) => `  - ${folder}\n`).join('')}linkWorkspacePackages: true\npreferWorkspacePackages: true\n` : ''
  writeFileSync(join(project, 'pnpm-workspace.yaml'), `${packages}onlyBuiltDependencies:\n  - esbuild\nallowBuilds:\n  esbuild: true\n`)
  // Yarn 2 and later would otherwise install Plug'n'Play, which neither Vite's
  // externals nor Node's type stripping read.
  writeFileSync(join(project, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
  writeFileSync(join(project, '.gitignore'), ['node_modules', '.env', 'dist', '.storage/', '.tanstack', ''].join('\n'))
  return project
}

const managers = 'A project installs with npm, pnpm 10.6 or later, Yarn 1 or Bun 1.3. Yarn 2 and later install a copy of mithaq for each workspace of a monorepo, which the build refuses, so a monorepo does not take them yet.'

const help = `Usage: create-mithaq [name] [options]

  --layout monorepo   the language, each feature, the asas and each app as workspace packages (the default)
  --layout single     one package holding the language, the features, the asas and the tenant app
  --with <a,b>        the add-ons to hold beside auth and the tags example, with every one they need
  --full              every add-on: the whole worked example (a single package leaves out backoffice)
  --organizations one|many
                      one organization, made on /auth/first-run (the default), or many, each sign-up
                      founding its own
  --show-organization yes|no
                      with one organization: whether a page names it (the default), or the app never
                      shows one and its members are its users
  --sign-up invite|open
                      with one organization: by invitation alone (the default), or anyone, who joins
                      once their address is proved (production needs a mailer); many takes open
  --organization-name <name>
                      with one organization: its name, which lives in code; first-run asks none
  --organization-name-ar <name>
                      its name in Arabic, the English one where not given
  --help              print this

With neither --with nor --full the project is minimal: auth and the tags example. The add-ons:

${Object.entries(addOns).map(([name, { needs }]) => `  ${name}${needs.length ? ` (needs ${needs.join(', ')})` : ''}`).join('\n')}

Asked when not given, unless the input is not a terminal, where the defaults stand.

${managers}`

/** The `mithaq` bin an install laid down for `folder`, in the nearest `node_modules/.bin` above it. */
const binAbove = (folder) => {
  const at = join(folder, 'node_modules/.bin/mithaq')
  if (existsSync(at)) return at
  return dirname(folder) === folder ? undefined : binAbove(dirname(folder))
}

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { mithaq: { type: 'string' }, 'mithaq-admin': { type: 'string' }, layout: { type: 'string' }, with: { type: 'string' }, full: { type: 'boolean' }, organizations: { type: 'string' }, 'show-organization': { type: 'string' }, 'sign-up': { type: 'string' }, 'organization-name': { type: 'string' }, 'organization-name-ar': { type: 'string' }, help: { type: 'boolean' } },
  })
  if (values.help) return console.log(help)
  if (values.full && values.with !== undefined) throw new Error('Pass --full or --with, not both: --full is every add-on.')
  let [name] = positionals
  let { layout } = values
  let picked = values.with?.split(',').map((one) => one.trim()).filter(Boolean)
  let { organizations, 'show-organization': shown, 'sign-up': signUp, 'organization-name': named, 'organization-name-ar': namedInArabic } = values
  const prompt = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : undefined
  try {
    if (!name) name = (await prompt?.question('Project name: '))?.trim() ?? ''
    layout ??= (await prompt?.question('Monorepo, or a single package? (monorepo/single) [monorepo]: '))?.trim().toLowerCase() || 'monorepo'
    if (!values.full && !picked && prompt) {
      const answer = (await prompt.question('minimal: auth + tags / full: every add-on / pick: choose add-ons (minimal/full/pick) [minimal]: ')).trim().toLowerCase() || 'minimal'
      if (answer === 'full') values.full = true
      else if (answer === 'pick') picked = (await prompt.question(`Add-ons, comma-separated (${Object.keys(addOns).join(', ')}): `)).split(',').map((one) => one.trim()).filter(Boolean)
      else if (answer !== 'minimal') throw new Error(`The answer is minimal, full or pick, not "${answer}".`)
    }
    if (!organizations && prompt) organizations = (await prompt.question('One organization, or many? (one/many) [one]: ')).trim().toLowerCase() || 'one'
    if (!shown && prompt && organizations !== 'many') shown = (await prompt.question('Show the organization\'s name on its pages? (yes/no) [yes]: ')).trim().toLowerCase() || 'yes'
    if (!signUp && prompt && organizations !== 'many') signUp = (await prompt.question('Who signs up: the invited, or anyone? (invite/open) [invite]: ')).trim().toLowerCase() || 'invite'
    if (!named && prompt && organizations !== 'many') named = (await prompt.question('The organization\'s name [My organization]: ')).trim() || undefined
    if (named && !namedInArabic && prompt) namedInArabic = (await prompt.question('Its name in Arabic [the same]: ')).trim() || undefined
  } finally {
    prompt?.close()
  }
  if (shown !== undefined && !['yes', 'no'].includes(shown)) throw new Error(`--show-organization is yes or no, not "${shown}".`)
  const showOrganization = shown !== 'no'
  // A single package cannot hold the backoffice console, so its whole example is every other add-on.
  const asked = values.full ? Object.keys(addOns).filter((one) => layout !== 'single' || one !== 'backoffice') : (picked ?? [])
  const { chosen, added } = resolveAddOns(asked)
  if (added.length) console.log(`Added ${added.join(', ')}, which ${asked.filter((one) => addOns[one].needs.length).join(', ')} need${added.length === 1 ? 's' : ''}.`)
  const { version } = readJson(new URL('package.json', import.meta.url))
  const organizationName = named ? { en: named, ...(namedInArabic && { ar: namedInArabic }) } : undefined
  const project = create({ name, cwd: process.cwd(), template: fileURLToPath(new URL('template/', import.meta.url)), version, mithaq: values.mithaq, mithaqAdmin: values['mithaq-admin'], layout, addOns: chosen, organizations, showOrganization, signUp, organizationName })
  const settings = organizationSettings({ organizations, showOrganization, signUp, chosen, organizationName })
  console.log(`Created ${project}${chosen.length ? `, with ${chosen.join(', ')}` : ', minimal'}.`)
  const manager = managerOf(process.env.npm_config_user_agent)
  const installed = manager !== undefined && spawnSync(manager, ['install'], { cwd: project, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0
  const run = manager ?? 'npm'
  if (!installed) console.warn(`\nNot installed. Run ${run} install in ${project}. ${managers}`)
  const single = layout === 'single'
  const asas = single ? project : join(project, 'packages/asas')
  const backoffice = chosen.includes('backoffice')
  // Each screen's files were generated for every kayan of the template, so a project short of an add-on with tables
  // writes its own once the install has laid the bin down.
  const short = Object.entries(addOns).some(([one, { tables }]) => tables && !chosen.includes(one))
  // With no organization shown, the Members page is named Users, which the template's screens do not say.
  const regenerate = short || !settings.showOrganization
  const bin = installed && regenerate ? binAbove(asas) : undefined
  const generated = bin !== undefined && spawnSync(bin, ['generate', 'screens'], { cwd: asas, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0
  if (regenerate && !generated) console.warn(`\nThe screens are not written for this project yet. Run mithaq generate screens in ${asas}, after the install.`)
  const language = single ? '' : 'packages/asas/'
  if (single) console.log(`\nThe package is named asas, not ${name}: the screen host imports the language as asas, and a package reaches itself by its own name.`)
  console.log(`
Next, with PostgreSQL 15 or later serving the database DATABASE_URL names in ${language}.env:

  cd ${name}${installed ? '' : `\n  ${run} install`}${single ? '' : '\n  cd packages/asas'}
  # push the schema, make the dev admin and fill its organization, development only
  ${run} run dev:setup${run === 'npm' ? ' --' : ''} --seed${single ? '' : '\n  cd ../../apps/asas-tanstack'}
  ${run} run dev   # the tenant app, http://localhost:5173${backoffice ? `\n  # in a second terminal, from apps/asas-backoffice: ${run} run dev   # the backoffice console, http://localhost:5174` : ''}

Sign in${backoffice ? ' to both apps' : ''} with DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD from ${language}.env. A deploy is set up by hand instead: ${settings.organizations === 'many' ? 'sign up in the tenant app, prove your address by the link it mails, sign in and create an organization.' : `open /auth/first-run and make the app's owner${settings.showOrganization ? ' and its organization' : ''} with the SETUP_CODE it was started with.`} A production start needs a mailer: RESEND_API_KEY and MAIL_FROM. ${run} run seed in ${single ? 'the project' : 'packages/asas'} fills an organization with sample rows again: the first user's first, or the ones SEED_EMAIL and SEED_ORGANIZATION name.${short ? `

The project holds no migration yet. Before it runs in production, write its first against an empty database with mithaq migrate --name init in ${single ? 'the project' : 'packages/asas'} (README.md, "Running in production").` : ''}`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
