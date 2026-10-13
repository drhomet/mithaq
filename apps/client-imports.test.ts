// No module a browser loads may reach the language (it holds the storage config and its upload-signing secret),
// the template's storage folder, core's storage target or `node:crypto`.
// The walk follows static value imports and every file an `import.meta.glob` names. It skips dynamic `import()` (server
// functions, compiled out of the client), `routeTree.gen.ts`, the platform's `server.ts` and a route whose options hold only
// `server`; a route with `server` beside a `loader` or component runs in the browser and is walked whole.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { after, test } from 'node:test'
import { SyntaxKind, type Node } from 'typescript/unstable/ast'
import { API } from 'typescript/unstable/sync'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const trackedFiles = (root: string) =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter((file) => file && existsSync(join(root, file)))
const apps = ['apps/asas-tanstack', 'apps/asas-platform']
const forbidden = [
  (path: string) => path === 'templates/mithaq/src/mithaq.ts',
  (path: string) => path.startsWith('templates/mithaq/src/storage/'),
  (path: string) => path === 'packages/mithaq/src/storage/storage.ts',
  (path: string) => path === 'node:crypto' || path === 'crypto',
]

const code = trackedFiles(root).filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts') && /^(apps\/asas-(tanstack|platform)\/src|templates\/((mithaq|asas)\/src|features)|packages\/mithaq\/src)\//.test(file))
const routeFixture = (options: string) => `import { createFileRoute } from '@tanstack/react-router'
import { arkan } from '../../../../templates/mithaq/src/mithaq.ts'
export const Route = createFileRoute('/fixture')({ ${options} })
`
const routes = 'apps/asas-tanstack/src/routes'
const fixtures = {
  [`${routes}/fixture-loader.tsx`]: routeFixture('server: { handlers: { GET: () => new Response(String(arkan.length)) } }, loader: () => arkan.length'),
  [`${routes}/fixture-server.tsx`]: routeFixture('server: { handlers: { GET: () => new Response(String(arkan.length)) } }'),
} as Record<string, string>
const config = join(root, 'client-imports.tsconfig.json')
const api = new API({
  cwd: root,
  fs: {
    readFile: (name) => {
      if (name === config) return JSON.stringify({ files: [...code, ...Object.keys(fixtures)].map((file) => join(root, file)), compilerOptions: { noResolve: true, jsx: 'preserve', allowImportingTsExtensions: true, noEmit: true } })
      return fixtures[relative(root, name)]
    },
  },
})
after(() => api.close())
const program = api.updateSnapshot({ openProjects: [config] }).getProject(config)!.program
type Any = Node & Record<string, any>

const read = (file: string) => {
  const source = program.getSourceFile(join(root, file))
  if (!source) return { statics: [], globs: [], dynamic: 0, serverRoute: false }
  const statics: string[] = []
  const globs: { patterns: string[]; base: string }[] = []
  let dynamic = 0
  let serverRoute = false
  const text = (node: Any) => node.getText(source) as string
  const visit = (node: Any) => {
    if (node.kind === SyntaxKind.ImportDeclaration) {
      const clause = node.importClause as Any | undefined
      const elements = (clause?.namedBindings?.elements ?? []) as Any[]
      const typeOnly = clause?.isTypeOnly || (clause && !clause.name && elements.length && elements.every((one) => one.isTypeOnly))
      if (!typeOnly) statics.push(text(node.moduleSpecifier).slice(1, -1))
    } else if (node.kind === SyntaxKind.ExportDeclaration && node.moduleSpecifier) {
      const elements = (node.exportClause?.elements ?? []) as Any[]
      if (!node.isTypeOnly && !(elements.length && elements.every((one) => one.isTypeOnly))) statics.push(text(node.moduleSpecifier).slice(1, -1))
    } else if (node.kind === SyntaxKind.CallExpression && node.expression.kind === SyntaxKind.ImportKeyword) {
      dynamic += 1
    } else if (node.kind === SyntaxKind.CallExpression && text(node.expression) === 'import.meta.glob') {
      const [list, options] = node.arguments as Any[]
      const strings = (one: Any | undefined): string[] => (one?.kind === SyntaxKind.StringLiteral ? [text(one).slice(1, -1)] : ((one?.elements ?? []) as Any[]).flatMap(strings))
      const base = ((options?.properties ?? []) as Any[]).find((one) => text(one.name) === 'base')
      globs.push({ patterns: strings(list), base: base ? text(base.initializer).slice(1, -1) : '' })
    } else if (node.kind === SyntaxKind.CallExpression && node.expression.kind === SyntaxKind.CallExpression && text(node.expression.expression) === 'createFileRoute') {
      const names = ((node.arguments[0]?.properties ?? []) as Any[]).map((one) => (one.name ? text(one.name) : ''))
      serverRoute = names.length > 0 && names.every((name) => name === 'server')
    }
    node.forEachChild((child: Node) => void visit(child as Any))
  }
  visit(source as unknown as Any)
  return { statics, globs, dynamic, serverRoute }
}

const resolveFrom = ({ app, file, specifier }: { app: string; file: string; specifier: string }): string | undefined => {
  const bare = specifier.replace(/\?.*$/, '')
  if (isBuiltin(bare)) return bare.startsWith('node:') ? bare : `node:${bare}`
  const local = bare.startsWith('@/') ? join(root, app, 'src', bare.slice(2)) : bare.startsWith('.') ? join(root, dirname(file), bare) : undefined
  let found: string | undefined
  if (local) found = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((ending) => local + ending).find((one) => existsSync(one) && !one.endsWith('/'))
  else {
    try {
      found = createRequire(join(root, file)).resolve(bare)
    } catch {
      return undefined
    }
  }
  if (!found) return undefined
  const path = relative(root, realpathSync(found))
  return path.startsWith('..') || path.includes('node_modules/') ? undefined : path
}

const walk = ({ app, from: given }: { app: string; from?: readonly string[] }) => {
  const server = (file: string) => file.endsWith('/routeTree.gen.ts') || file === `${app}/src/server.ts` || read(file).serverRoute
  const entries = (given ?? code.filter((file) => file.startsWith(`${app}/src/`) && !/\.test\.tsx?$/.test(file))).filter((file) => !server(file))
  const from = new Map<string, string | null>(entries.map((file) => [file, null]))
  const queue = [...entries]
  let skipped = 0
  while (queue.length) {
    const file = queue.shift()!
    if (!/\.tsx?$/.test(file)) continue
    const { statics, globs, dynamic } = read(file)
    skipped += dynamic
    const targets = [
      ...statics.map((specifier) => resolveFrom({ app, file, specifier })),
      ...globs.flatMap(({ patterns, base }) => {
        // Vite reads a base from the app's root when it starts with `/`, and from the importing file's folder otherwise.
        const at = base.startsWith('/') ? realpathSync(join(root, app, base)) : join(root, dirname(file), base)
        // A wildcard would walk nothing, so it is refused rather than passed.
        for (const pattern of patterns) assert.ok(!pattern.includes('*'), `${file} globs "${pattern}", and this walk reads a glob's patterns as file names`)
        return patterns.map((pattern) => relative(root, join(at, pattern)))
      }),
    ]
    for (const target of targets) {
      if (!target || from.has(target) || server(target)) continue
      from.set(target, file)
      if (!target.startsWith('node:')) queue.push(target)
    }
  }
  const chain = (file: string): string[] => (from.get(file) ? [...chain(from.get(file)!), file] : [file])
  return { reached: [...from.keys()], chain, skipped }
}

for (const app of apps) {
  test(`no module ${app} hands a browser reaches the language, the storage config, core's storage target or node:crypto`, () => {
    const { reached, chain, skipped } = walk({ app })
    assert.ok(reached.includes('templates/mithaq/src/ui/app-shell.tsx'), 'the glob of the screens\' files is walked')
    assert.ok(reached.includes('packages/mithaq/src/screen/client.ts'), 'mithaq/admin is walked')
    assert.ok(skipped > 0, 'the dynamic imports of the server functions are seen and left alone')
    const bad = reached.filter((path) => forbidden.some((one) => one(path)))
    assert.deepEqual(bad.map((one) => chain(one).join('\n  -> ')), [], 'a module the browser loads reaches server-only code')
  })
}

test('a route whose server handler sits beside a loader is the browser\'s, and a route that is a server handler alone is not', () => {
  const loaded = walk({ app: 'apps/asas-tanstack', from: [`${routes}/fixture-loader.tsx`] })
  assert.ok(loaded.reached.includes('templates/mithaq/src/mithaq.ts'), 'the loader runs in the browser, so its module\'s imports are walked')
  assert.deepEqual(walk({ app: 'apps/asas-tanstack', from: [`${routes}/fixture-server.tsx`] }).reached, [])
})
