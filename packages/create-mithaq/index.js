#!/usr/bin/env node
// `bun create mithaq my-app`: lays a new project down from the template this
// package carries, at the version of `@drhomet/mithaq` this package was
// published with. Plain JavaScript on Node's standard library, so `bunx` and
// `npx` run it with nothing to install first.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)

const generateSecret = () => randomBytes(32).toString('hex')

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
 * Writes the project `name` under `cwd` from `template`, and answers its
 * folder. `version` is the `@drhomet/mithaq` the project installs and whose
 * registry it reads, pinned exactly so the two cannot drift apart and an
 * upgrade is a change the project makes; `mithaq` replaces the dependency
 * itself, which only the release check does.
 */
export function create({ name, cwd, template, version, mithaq = `npm:@drhomet/mithaq@${version}` }) {
  // A package name npm accepts, so it is also one folder, inside `cwd`.
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214) {
    throw new Error(`"${name}" is not a valid project name: use lowercase letters, digits, "-", "." and "_", starting with a letter or digit.`)
  }
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
  // One `.env` for the template's commands and one for each app's dev server,
  // the same secrets in each: the tenant app and the platform console sign
  // and read each other's sessions under one `BETTER_AUTH_SECRET`.
  const env = readFileSync(join(project, 'templates/asas/.env.example'), 'utf8').replace(/^([A-Z_]*SECRET)=$/gm, (_, key) => `${key}=${generateSecret()}`)
  for (const folder of ['templates/asas', 'apps/asas-tanstack', 'apps/asas-platform']) writeFileSync(join(project, folder, '.env'), env, { mode: 0o600 })
  // The screens find their files by globs under `node_modules/asas/`, which
  // only Bun's isolated installer lays out.
  writeFileSync(join(project, 'bunfig.toml'), '[install]\nlinker = "isolated"\n')
  writeFileSync(join(project, '.gitignore'), ['node_modules', '.env', 'dist', '.storage/', ''].join('\n'))
  writeJson(join(project, 'tsconfig.json'), {
    compilerOptions: { target: 'es2024', module: 'nodenext', moduleResolution: 'nodenext', strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, erasableSyntaxOnly: true, allowImportingTsExtensions: true, types: ['node'] },
    include: ['templates/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
  })
  return project
}

const main = async () => {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { mithaq: { type: 'string' } } })
  let [name] = positionals
  if (!name) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    name = (await prompt.question('Project name: ')).trim()
    prompt.close()
  }
  const { version } = readJson(new URL('package.json', import.meta.url))
  const project = create({ name, cwd: process.cwd(), template: fileURLToPath(new URL('template/', import.meta.url)), version, mithaq: values.mithaq })
  console.log(`Created ${project}.`)
  // `bunx` and `bun create` name Bun here (`bun/1.3.14 npm/? node/…`).
  const installed = process.env.npm_config_user_agent?.startsWith('bun/') && spawnSync('bun', ['install'], { cwd: project, stdio: 'inherit' }).status === 0
  if (!installed) {
    console.warn(`\nNot installed. Install with Bun: the project is a Bun workspace whose screens need Bun's isolated installer (bunfig.toml), and npm, pnpm and yarn lay node_modules out where they find nothing.`)
  }
  console.log(`
Next, with PostgreSQL 15 or later serving the database DATABASE_URL names in templates/asas/.env:

  cd ${name}${installed ? '' : '\n  bun install'}
  cd templates/asas
  # push the schema once, development only
  bun -e "const { asas } = await import('./src/asas.ts'); await asas.connect(); await asas.destroy()"
  cd ../..
  bun run --cwd apps/asas-tanstack dev   # the tenant app, http://localhost:5173
  bun run --cwd apps/asas-platform dev   # in a second terminal: the platform console, http://localhost:5174

Sign up admin@admin.com with the organization "Admin org", then run bun run seed in templates/asas.`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
