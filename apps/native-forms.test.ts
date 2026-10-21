import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse, type parseExpression } from '@babel/parser'

type Opening = Extract<ReturnType<typeof parseExpression>, { type: 'JSXElement' }>['openingElement']
type Method = { file: string; start: number; end: number; post: boolean }
type Form = { file: string; line: number; shared: boolean; method?: Method; from?: string }
const root = new URL('../', import.meta.url)
const files = execFileSync('git', ['ls-files', '-z', 'apps/**/*.tsx', 'packages/mithaq-admin/registry/*.tsx', 'packages/mithaq-admin/registry/**/*.tsx', 'templates/**/*.tsx'], { cwd: fileURLToPath(root), encoding: 'utf8' }).split('\0').filter(Boolean)
const sources = new Map(await Promise.all(files.map(async (file) => [file, await readFile(new URL(file, root), 'utf8')] as const)))

const inventory = (texts: ReadonlyMap<string, string>) => {
  const native: Form[] = []
  const callers: Form[] = []
  for (const [file, source] of texts) {
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const imports = new Map<string, string>()
    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration' || !node.source.value.endsWith('/auth-frame.tsx')) continue
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' && specifier.imported.name === 'AuthForm') imports.set(specifier.local.name, posix.normalize(posix.join(posix.dirname(file), node.source.value)))
      }
    }
    const visit = (value: unknown, shared = false) => {
      if (!value || typeof value !== 'object') return
      const node = value as { type?: string; id?: { name?: string } }
      const inShared = shared || (node.type === 'FunctionDeclaration' && node.id?.name === 'AuthForm')
      if (node.type === 'JSXOpeningElement') {
        const opening = value as Opening
        const tag = opening.name.type === 'JSXIdentifier' ? opening.name.name : ''
        const form = { file, line: opening.loc!.start.line, shared: inShared }
        if (tag === 'form') {
          const index = opening.attributes.findLastIndex((attribute) => attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier' && attribute.name.name === 'method')
          const attribute = opening.attributes[index]
          const methodValue = attribute?.type === 'JSXAttribute' ? attribute.value : null
          const literal = methodValue?.type === 'JSXExpressionContainer' ? methodValue.expression : methodValue
          const post = literal?.type === 'StringLiteral' && literal.value === 'post' && !opening.attributes.slice(index + 1).some((attribute) => attribute.type === 'JSXSpreadAttribute')
          native.push({ ...form, method: attribute ? { file, start: attribute.start!, end: attribute.end!, post } : undefined })
        } else if (tag === 'AuthForm' || imports.has(tag)) callers.push({ ...form, from: imports.get(tag) })
      }
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach((entry) => visit(entry, inShared))
        else visit(child, inShared)
      }
    }
    visit(ast.program)
  }
  const wrappers = native.filter((form) => form.shared)
  for (const caller of callers) caller.method = wrappers.find((wrapper) => wrapper.file === caller.from)?.method
  // AuthForm callers are product forms; its three source/held implementations supply their native method, not extra flows.
  return { forms: [...native.filter((form) => !form.shared), ...callers], native, wrappers }
}

const assertPosted = (texts: ReadonlyMap<string, string>) => {
  const found = inventory(texts)
  assert.equal(found.forms.length, 16, 'the inventory must cover all 16 shipped product forms')
  const unsafe = [...found.forms, ...found.wrappers].filter((form) => !form.method?.post).map((form) => `${form.file}:${form.line}`)
  assert.deepEqual(unsafe, [], 'every shipped native form and AuthForm implementation must enforce POST')
  return found
}

test('all 16 shipped product forms keep personal values in POST bodies before JavaScript runs', () => {
  assert.ok(files.includes('packages/mithaq-admin/registry/form.tsx'))
  assertPosted(sources)
})

test('the guard rejects removal of POST from each of the 16 forms and all shared implementations', async (t) => {
  const found = assertPosted(sources)
  for (const form of [...found.forms, ...found.wrappers]) {
    await t.test(`${form.file}:${form.line}${form.shared ? ' shared implementation' : ''}`, () => {
      const method = form.method!
      const source = sources.get(method.file)!
      const mutated = new Map(sources).set(method.file, source.slice(0, method.start) + source.slice(method.end))
      assert.throws(() => assertPosted(mutated), /must enforce POST/)
    })
  }
})

test('JSX comments and strings cannot add forms or hide a missing native method', () => {
  const source = 'export const Page = () => <div>{/* <form method="post"> */}{"<form method=post>"}<form onSubmit={() => {}} method={"post"} /></div>'
  const file = 'apps/example/src/page.tsx'
  assert.equal(inventory(new Map([[file, source]])).forms.length, 1)
  assert.equal(inventory(new Map([[file, source]])).native[0]!.method?.post, true)
  assert.equal(inventory(new Map([[file, source.replace(' method={"post"}', '')]])).native[0]!.method, undefined)
})
