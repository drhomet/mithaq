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
  return typeof from === 'string' ? text.replaceAll(from, to) : text.replace(from, to)
}
/** Every text file a project's own commands or imports read, outside what an install writes. */
const textsUnder = (folder) =>
  readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => !file.split(/[\\/]/).includes('node_modules') && /\.(tsx?|jsx?|json|css|md)$/.test(file))
    .map((file) => join(folder, file))

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
  // A feature is reached through its index, or its browser-safe `domain/`, as its `exports` say.
  const targetOf = (name, sub) => {
    if (name === 'mithaq') return sub === '' ? 'src/mithaq.ts' : sub === '/auth' ? 'src/mithaq/auth/index.ts' : sub === '/auth/platform-roles' ? 'src/mithaq/auth/platform-roles.ts' : `src${sub}`
    if (sub === '') return `src/features/${name}/index.ts`
    if (sub.startsWith('/domain/')) return `src/features/${name}${sub}`
    throw new Error(`@asas/${name}${sub} reaches past the feature's exports.`)
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
 * Writes the project `name` under `cwd` from `template`, and answers its
 * folder. `version` is the `@drhomet/mithaq` and `@drhomet/mithaq-admin` the
 * project installs, pinned exactly so the two cannot drift apart and an
 * upgrade is a change the project makes; `mithaq` and `mithaqAdmin` replace the
 * dependencies themselves, which only the release check does. `layout` is `monorepo`, the
 * language, each feature and the asas as packages, or `single`, one package with the tenant app and no
 * platform console; `platform` keeps the platform console in a monorepo.
 */
export function create({ name, cwd, template, version, mithaq = `npm:@drhomet/mithaq@${version}`, mithaqAdmin = `npm:@drhomet/mithaq-admin@${version}`, layout = 'monorepo', platform = layout === 'monorepo' }) {
  // A package name npm accepts, so it is also one folder, inside `cwd`, and a scope.
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214) {
    throw new Error(`"${name}" is not a valid project name: use lowercase letters, digits, "-", "." and "_", starting with a letter or digit.`)
  }
  if (!['monorepo', 'single'].includes(layout)) throw new Error(`The layout is monorepo or single, not "${layout}".`)
  if (layout === 'single' && platform) throw new Error('A single package serves the tenant app alone. Choose the monorepo layout to include the platform console.')
  const project = join(cwd, name)
  if (existsSync(project) && readdirSync(project).length > 0) {
    throw new Error(`${project} already exists and is not empty. Pick another name.`)
  }
  cpSync(template, project, { recursive: true })
  // The template's packages sit in `templates/` in the mithaq repository, beside the framework's own `packages/`; a
  // project holds them in `packages/`, and every relative path an app names into them follows.
  renameSync(join(project, 'templates'), join(project, 'packages'))
  for (const file of textsUnder(project)) edit(file, (text) => text.replaceAll(/((?:\.\.\/)+)templates(?=[/'"])/g, '$1packages'))
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
  if (!platform) {
    rmSync(join(project, 'apps/asas-platform'), { recursive: true })
    edit(join(project, 'packages/mithaq/src/mithaq.ts'), (text) => once(text, "platform: '../../apps/asas-platform/src/routes/(screens)/',", 'platform: false,'))
    edit(join(project, 'packages/mithaq/src/mithaq/auth/index.ts'), (text) => once(text, 'export const platformApp: boolean = true', 'export const platformApp: boolean = false'))
  }
  // One `.env` for the asas's commands and one for each app's dev server,
  // the same secrets in each: the tenant app and the platform console sign
  // and read each other's sessions under one `BETTER_AUTH_SECRET`.
  const env = readFileSync(join(project, 'packages/asas/.env.example'), 'utf8').replace(/^([A-Z_]*SECRET)=$/gm, (_, key) => `${key}=${generateSecret()}`)
  if (layout === 'single') {
    foldIntoOnePackage(project)
    writeFileSync(join(project, '.env'), env, { mode: 0o600 })
  } else {
    for (const folder of ['packages/asas', 'apps/asas-tanstack', ...(platform ? ['apps/asas-platform'] : [])]) writeFileSync(join(project, folder, '.env'), env, { mode: 0o600 })
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
  --platform          include the platform console, apps/asas-platform (the default in a monorepo)
  --no-platform       leave the platform console out
  --help              print this

Asked when not given, unless the input is not a terminal, where the defaults stand.

${managers}`

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: { mithaq: { type: 'string' }, 'mithaq-admin': { type: 'string' }, layout: { type: 'string' }, platform: { type: 'boolean' }, help: { type: 'boolean' } },
  })
  if (values.help) return console.log(help)
  let [name] = positionals
  let { layout, platform } = values
  const prompt = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : undefined
  try {
    if (!name) name = (await prompt?.question('Project name: '))?.trim() ?? ''
    layout ??= (await prompt?.question('Monorepo, or a single package? (monorepo/single) [monorepo]: '))?.trim().toLowerCase() || 'monorepo'
    if (layout === 'monorepo') platform ??= !/^n/i.test((await prompt?.question('Include the platform console, apps/asas-platform? (Y/n): '))?.trim() ?? '')
  } finally {
    prompt?.close()
  }
  const { version } = readJson(new URL('package.json', import.meta.url))
  const project = create({ name, cwd: process.cwd(), template: fileURLToPath(new URL('template/', import.meta.url)), version, mithaq: values.mithaq, mithaqAdmin: values['mithaq-admin'], layout, platform: platform ?? false })
  console.log(`Created ${project}.`)
  const manager = managerOf(process.env.npm_config_user_agent)
  const installed = manager !== undefined && spawnSync(manager, ['install'], { cwd: project, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0
  const run = manager ?? 'npm'
  if (!installed) console.warn(`\nNot installed. Run ${run} install in ${project}. ${managers}`)
  const single = layout === 'single'
  const language = single ? '' : 'packages/asas/'
  const push = `node --env-file=.env --input-type=module -e "const { asas } = await import('./src/asas.ts'); await asas.connect(); await asas.destroy()"`
  if (single) console.log(`\nThe package is named asas, not ${name}: the screen host imports the language as asas, and a package reaches itself by its own name.`)
  console.log(`
Next, with PostgreSQL 15 or later serving the database DATABASE_URL names in ${language}.env:

  cd ${name}${installed ? '' : `\n  ${run} install`}${single ? '' : '\n  cd packages/asas'}
  # push the schema once, development only
  ${push}${single ? '' : '\n  cd ../../apps/asas-tanstack'}
  ${run} run dev   # the tenant app, http://localhost:5173${platform ? `\n  # in a second terminal, from apps/asas-platform: ${run} run dev   # the platform console, http://localhost:5174` : ''}

Sign up in the tenant app and create an organization. Then ${run} run seed in ${single ? 'the project' : 'packages/asas'} fills it with sample rows: it takes the first user and that user's first organization, or the ones SEED_EMAIL and SEED_ORGANIZATION name.`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
