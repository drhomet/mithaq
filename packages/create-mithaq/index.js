#!/usr/bin/env node
// `npm create mithaq my-app` (or pnpm, yarn or bun): lays a new project down from
// the template this package carries, at the version of `@drhomet/mithaq` this
// package was published with. Plain JavaScript on Node's standard library, so
// every package manager runs it with nothing to install first.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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
 * Pins the template's manifests to what a published project installs. It edits
 * `devDependencies` too, where the template keeps `mithaq-admin`. `mithaq`
 * becomes the published package under the name every import uses, and
 * `mithaq-admin`, which only the framework's own repository has, goes, since a
 * project reads the registry through `@mithaq`; `asas` and `@asas/auth` stay
 * `"*"`, the project's own workspaces. Any other `workspace:`, `link:` or
 * `file:` spec is an error rather than a pin, because nothing published stands
 * behind it.
 */
export function updatePackageJSONDependencies({ mithaq, packageJson }) {
  for (const dependencies of [packageJson.dependencies, packageJson.devDependencies]) {
    if (!dependencies) continue
    if ('mithaq' in dependencies) dependencies.mithaq = mithaq
    delete dependencies['mithaq-admin']
    for (const [name, spec] of Object.entries(dependencies)) {
      if (spec !== mithaq && /^(workspace|link|file):/.test(spec)) {
        throw new Error(`The template's dependency ${name} is ${spec}, which only resolves inside the mithaq repository.`)
      }
    }
  }
}

/**
 * Folds the monorepo into one package at `project`: the template's language and
 * kayan, its auth under `src/auth/`, and the tenant app, whose `src/` holds no
 * file of the same name as theirs. The package keeps the name `asas`, because
 * the registry's copies import it by that name and a package reaches itself
 * through its own `exports`; `@asas/auth` becomes `asas/auth` the same way.
 */
const foldIntoOnePackage = (project) => {
  const at = (...path) => join(project, ...path)
  const [root, language, auth, app] = ['', 'templates/asas', 'templates/auth', 'apps/asas-tanstack'].map((folder) => readJson(at(folder, 'package.json')))
  for (const entry of readdirSync(at('templates/asas'))) if (entry !== 'package.json' && entry !== 'components.json') renameSync(at('templates/asas', entry), at(entry))
  renameSync(at('templates/auth/src'), at('src/auth'))
  for (const entry of readdirSync(at('apps/asas-tanstack/src'))) renameSync(at('apps/asas-tanstack/src', entry), at('src', entry))
  for (const entry of ['public', 'vite.config.ts', 'tsconfig.json', 'components.json']) renameSync(at('apps/asas-tanstack', entry), at(entry))
  rmSync(at('templates'), { recursive: true })
  rmSync(at('apps'), { recursive: true })
  const { asas: _language, '@asas/auth': _auth, ...dependencies } = { ...language.dependencies, ...auth.dependencies, ...app.dependencies }
  const lockCheck = (script) => script.replace('(cd ../../templates/asas && mithaq lock --check)', 'mithaq lock --check')
  writeJson(at('package.json'), {
    name: 'asas',
    private: true,
    type: 'module',
    engines: root.engines,
    scripts: { ...Object.fromEntries(Object.entries(app.scripts).map(([name, script]) => [name, lockCheck(script)])), ...language.scripts },
    exports: { ...language.exports, './auth': './src/auth/index.ts', './auth/platform-roles': './src/auth/platform-roles.ts' },
    dependencies,
    devDependencies: { ...language.devDependencies, ...app.devDependencies, ...root.devDependencies },
  })
  const files = readdirSync(at('src'), { recursive: true }).map((file) => at('src', file)).filter((file) => /\.(tsx?|json)$/.test(file))
  for (const file of files) edit(file, (text) => text.replaceAll(/(['"])@asas\/auth\b/g, '$1asas/auth'))
  // The app is the project now, so each glob reads off Vite's root, as `mithaq generate screens` writes it.
  for (const file of files.filter((one) => basename(one) === 'files.ts')) edit(file, (text) => text.replaceAll(/\{ base: '[^']*', exhaustive: true \}/g, "{ base: '/' }"))
  edit(at('src/mithaq.ts'), (text) => text.replaceAll("'../../apps/asas-tanstack/src/routes/(screens)/'", "'src/routes/(screens)/'"))
  edit(at('src/styles.css'), (text) => text.replace(/\/\*[^*]*\*\/\n@source '[^']*';/, "/* The project's own shells, pages and components, which the screens load\n   (`src/ui/app-shell.tsx`). */\n@source './';"))
  edit(at('tsconfig.json'), (text) => text.replace(/, "\.\.\/\.\.\/templates\/[^\]]*\]/, ']'))
}

/**
 * Writes the project `name` under `cwd` from `template`, and answers its
 * folder. `version` is the `@drhomet/mithaq` the project installs and whose
 * registry it reads, pinned exactly so the two cannot drift apart and an
 * upgrade is a change the project makes; `mithaq` replaces the dependency
 * itself, which only the release check does. `layout` is `monorepo`, a
 * workspace per package, or `single`, one package with the tenant app and no
 * platform console; `platform` keeps the platform console in a monorepo.
 */
export function create({ name, cwd, template, version, mithaq = `npm:@drhomet/mithaq@${version}`, layout = 'monorepo', platform = layout === 'monorepo' }) {
  // A package name npm accepts, so it is also one folder, inside `cwd`.
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
  const files = readdirSync(project, { recursive: true })
  // npm drops every `.gitignore` from a published package, so the stage keeps
  // each as `gitignore`.
  for (const file of files.filter((file) => basename(file) === 'gitignore')) {
    renameSync(join(project, file), join(project, dirname(file), '.gitignore'))
  }
  for (const file of files.filter((file) => basename(file) === 'package.json')) {
    const packageJson = readJson(join(project, file))
    updatePackageJSONDependencies({ mithaq, packageJson })
    writeJson(join(project, file), file === 'package.json' ? { name, ...packageJson } : packageJson)
  }
  // shadcn reads `@mithaq/<item>` from this URL with `{name}` replaced, at the
  // version installed.
  for (const file of files.filter((file) => basename(file) === 'components.json')) {
    const components = readJson(join(project, file))
    writeJson(join(project, file), { ...components, registries: { ...components.registries, '@mithaq': `https://cdn.jsdelivr.net/npm/@drhomet/mithaq@${version}/r/{name}.json` } })
  }
  if (!platform) {
    rmSync(join(project, 'apps/asas-platform'), { recursive: true })
    edit(join(project, 'templates/asas/src/mithaq.ts'), (text) => text.replace("platform: '../../apps/asas-platform/src/routes/(screens)/',", 'platform: false,'))
    edit(join(project, 'templates/auth/src/index.ts'), (text) => text.replace('export const platformApp: boolean = true', 'export const platformApp: boolean = false'))
  }
  // One `.env` for the template's commands and one for each app's dev server,
  // the same secrets in each: the tenant app and the platform console sign
  // and read each other's sessions under one `BETTER_AUTH_SECRET`.
  const env = readFileSync(join(project, 'templates/asas/.env.example'), 'utf8').replace(/^([A-Z_]*SECRET)=$/gm, (_, key) => `${key}=${generateSecret()}`)
  if (layout === 'single') {
    foldIntoOnePackage(project)
    writeFileSync(join(project, '.env'), env, { mode: 0o600 })
  } else {
    for (const folder of ['templates/asas', 'apps/asas-tanstack', ...(platform ? ['apps/asas-platform'] : [])]) writeFileSync(join(project, folder, '.env'), env, { mode: 0o600 })
    // Room for the project's own feature packages, which `packages/features/*` already names as workspaces.
    mkdirSync(join(project, 'packages/features'), { recursive: true })
    writeFileSync(join(project, 'packages/features/.gitkeep'), '')
    writeJson(join(project, 'tsconfig.json'), {
      compilerOptions: { target: 'es2024', module: 'nodenext', moduleResolution: 'nodenext', strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, erasableSyntaxOnly: true, allowImportingTsExtensions: true, types: ['node'] },
      include: ['templates/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
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

  --layout monorepo   the language, its auth and each app as workspace packages (the default)
  --layout single     one package holding the language, the kayan and the tenant app
  --platform          include the platform console, apps/asas-platform (the default in a monorepo)
  --no-platform       leave the platform console out
  --help              print this

Asked when not given, unless the input is not a terminal, where the defaults stand.

${managers}`

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: { mithaq: { type: 'string' }, layout: { type: 'string' }, platform: { type: 'boolean' }, help: { type: 'boolean' } },
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
  const project = create({ name, cwd: process.cwd(), template: fileURLToPath(new URL('template/', import.meta.url)), version, mithaq: values.mithaq, layout, platform: platform ?? false })
  console.log(`Created ${project}.`)
  const manager = managerOf(process.env.npm_config_user_agent)
  const installed = manager !== undefined && spawnSync(manager, ['install'], { cwd: project, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0
  const run = manager ?? 'npm'
  if (!installed) console.warn(`\nNot installed. Run ${run} install in ${project}. ${managers}`)
  const single = layout === 'single'
  const language = single ? '' : 'templates/asas/'
  const push = `node --env-file=.env --input-type=module -e "const { asas } = await import('./src/asas.ts'); await asas.connect(); await asas.destroy()"`
  if (single) console.log(`\nThe package is named asas, not ${name}: the screens' copied files import the language as asas, and a package reaches itself by its own name.`)
  console.log(`
Next, with PostgreSQL 15 or later serving the database DATABASE_URL names in ${language}.env:

  cd ${name}${installed ? '' : `\n  ${run} install`}${single ? '' : '\n  cd templates/asas'}
  # push the schema once, development only
  ${push}${single ? '' : '\n  cd ../../apps/asas-tanstack'}
  ${run} run dev   # the tenant app, http://localhost:5173${platform ? `\n  # in a second terminal, from apps/asas-platform: ${run} run dev   # the platform console, http://localhost:5174` : ''}

Sign up in the tenant app and create an organization. Then ${run} run seed in ${single ? 'the project' : 'templates/asas'} fills it with sample rows: it takes the first user and that user's first organization, or the ones SEED_EMAIL and SEED_ORGANIZATION name.`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
