// `bun run lint:args [files]`: fails an exported function, constructor or method with three or more positional parameters,
// and a function an exported hook (`use…`) returns from a `return { … }` in its body.
// It does not see `export default` of an expression, re-exports, functions in an exported object literal or behind a cast,
// arrow class properties, a function typed by a name from another module, or what a hook returns as its arrow's expression body.
import { globSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { SyntaxKind, type Node } from 'typescript/unstable/ast'
import { API } from 'typescript/unstable/sync'

const root = resolve(import.meta.dirname, '..')
// Keyed `path name`, valued with the reason it keeps its parameters.
const allowed: Record<string, string> = {
  'packages/mithaq/src/asas/runner/errors.ts AsasError.constructor':
    'Core builds it in four places and a project never does: a project refuses through denied, invalid, missing and conflict, which take one object.',
}

const files = process.argv.length > 2 ? process.argv.slice(2).map((file) => resolve(file)) : [
  'packages/mithaq/src/**/*.{ts,tsx}', 'packages/mithaq-admin/registry/**/*.{ts,tsx}', 'templates/asas/src/**/*.{ts,tsx}',
].flatMap((pattern) => globSync(pattern, { cwd: root, exclude: (file) => /\.(test|probe|smoke|support)\.tsx?$|^packages\/mithaq-admin\/registry\/(ui|hooks|lib)\//.test(file) }))
  .map((file) => resolve(root, file))

const config = resolve(root, 'lint-args.tsconfig.json')
const api = new API({ cwd: root, fs: { readFile: (name) => (name === config ? JSON.stringify({ files, compilerOptions: { noResolve: true, jsx: 'preserve', allowImportingTsExtensions: true, noEmit: true } }) : undefined) } })
const program = api.updateSnapshot({ openProjects: [config] }).getProject(config)!.program
const functions = new Set([SyntaxKind.FunctionDeclaration, SyntaxKind.ArrowFunction, SyntaxKind.FunctionExpression, SyntaxKind.FunctionType, SyntaxKind.MethodSignature, SyntaxKind.CallSignature])
const offences: string[] = []
const check = (file: string, name: string, node: Node) => {
  const count = (node as unknown as { parameters: { name: Node }[] }).parameters.filter((one) => one.name.getText() !== 'this').length
  if (count >= 3 && !(`${file} ${name}` in allowed)) offences.push(`${file} ${name} (${count} parameters)`)
}
const inType = (file: string, name: string, node: Node): void => {
  if (functions.has(node.kind)) check(file, node.kind === SyntaxKind.MethodSignature ? `${name}.${(node as unknown as { name: Node }).name.getText()}` : name, node)
  if (node.kind === SyntaxKind.PropertySignature) return void node.forEachChild((child) => inType(file, `${name}.${(node as unknown as { name: Node }).name.getText()}`, child))
  node.forEachChild((child) => inType(file, name, child))
}
// What a hook hands its caller is called like an exported function, so each function in the object it returns is
// checked: one written in place, or a local `const` the object names.
const checkReturned = (file: string, name: string, node: Node) => {
  const statements = (node as unknown as { body?: { statements?: Node[] } }).body?.statements ?? []
  const locals = new Map(statements.flatMap((statement) => statement.kind === SyntaxKind.VariableStatement
    ? (statement as unknown as { declarationList: { declarations: { name: Node; initializer?: Node }[] } }).declarationList.declarations
      .flatMap((declaration) => (declaration.initializer && functions.has(declaration.initializer.kind) ? [[declaration.name.getText(), declaration.initializer] as const] : []))
    : []))
  for (const statement of statements) {
    const returned = statement.kind === SyntaxKind.ReturnStatement ? (statement as unknown as { expression?: Node }).expression : undefined
    if (returned?.kind !== SyntaxKind.ObjectLiteralExpression) continue
    for (const property of (returned as unknown as { properties: { kind: SyntaxKind; name: Node; initializer?: Node }[] }).properties) {
      const value = property.kind === SyntaxKind.ShorthandPropertyAssignment ? locals.get(property.name.getText())
        : property.initializer && functions.has(property.initializer.kind) ? property.initializer
        : property.initializer ? locals.get(property.initializer.getText()) : undefined
      if (value) check(file, `${name}.${property.name.getText()}`, value)
    }
  }
}
const checkFunction = (file: string, name: string, node: Node) => {
  check(file, name, node)
  for (const parameter of (node as unknown as { parameters: { type?: Node }[] }).parameters) if (parameter.type) inType(file, name, parameter.type)
  if (/^use[A-Z]/.test(name)) checkReturned(file, name, node)
}
for (const path of files) {
  const source = program.getSourceFile(path)!
  const file = relative(root, path)
  const listed = new Set(source.statements.flatMap((statement) => statement.kind === SyntaxKind.ExportDeclaration && !(statement as unknown as { moduleSpecifier?: Node }).moduleSpecifier
    ? ((statement as unknown as { exportClause?: { elements?: { propertyName?: Node; name: Node }[] } }).exportClause?.elements ?? []).map((one) => (one.propertyName ?? one.name).getText())
    : []))
  for (const statement of source.statements) {
    const named = statement as unknown as { name?: Node; modifiers?: { kind: SyntaxKind }[]; members?: Node[] }
    const exported = named.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword)
    if (statement.kind === SyntaxKind.FunctionDeclaration) {
      if (exported || listed.has(named.name?.getText() ?? '')) checkFunction(file, named.name?.getText() ?? 'default', statement)
    } else if (statement.kind === SyntaxKind.ClassDeclaration) {
      const name = named.name?.getText() ?? 'default'
      if (!exported && !listed.has(name)) continue
      for (const member of named.members ?? []) {
        const own = member as unknown as { name?: Node; modifiers?: { kind: SyntaxKind }[] }
        if (own.modifiers?.some((modifier) => modifier.kind === SyntaxKind.PrivateKeyword)) continue
        if (member.kind === SyntaxKind.Constructor) checkFunction(file, `${name}.constructor`, member)
        else if (member.kind === SyntaxKind.MethodDeclaration) checkFunction(file, `${name}.${own.name!.getText()}`, member)
      }
    } else if (statement.kind === SyntaxKind.TypeAliasDeclaration || statement.kind === SyntaxKind.InterfaceDeclaration) {
      if (exported || listed.has(named.name!.getText())) statement.forEachChild((child) => inType(file, named.name!.getText(), child))
    } else if (statement.kind === SyntaxKind.VariableStatement) {
      for (const declaration of (statement as unknown as { declarationList: { declarations: { name: Node; initializer?: Node }[] } }).declarationList.declarations) {
        if ((exported || listed.has(declaration.name.getText())) && declaration.initializer && functions.has(declaration.initializer.kind)) checkFunction(file, declaration.name.getText(), declaration.initializer)
      }
    }
  }
}
api.close()
for (const offence of offences) console.log(offence)
process.exitCode = offences.length ? 1 : 0
