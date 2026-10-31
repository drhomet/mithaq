import assert from 'node:assert/strict'
import { test } from 'node:test'

test('the existing rich text imports expose the shared package classes by identity', async () => {
  const shared = await import('@drhomet/mithaq-rich-text')
  const old = await import('mithaq/rich-text')
  const client = await import('mithaq/rich-text/client')
  const mention = await import('mithaq/rich-text/mention')
  const registry = await import('mithaq/rich-text/registry')
  for (const [name, value] of Object.entries(client)) assert.equal(shared[name as keyof typeof shared], value, name)
  assert.equal(old.UploadNode, shared.UploadNode)
  assert.equal(old.defaultNodes, shared.defaultNodes)
  assert.equal(old.richTextFeatureNodes, shared.richTextFeatureNodes)
  assert.equal(old.MentionNode, shared.MentionNode)
  assert.equal(mention.MentionNode, shared.MentionNode)
  assert.equal(registry.defaultNodeRegistry, shared.defaultNodeRegistry)
})

test('the shared library bundles below 1 MB and reads JSON with no server or DOM runtime', async (t) => {
  const { build } = await import('esbuild')
  const { runInNewContext } = await import('node:vm')
  const { parse } = await import('@babel/parser')
  const own = await build({ entryPoints: ['packages/mithaq-rich-text/src/index.ts'], bundle: true, packages: 'external', platform: 'neutral', format: 'esm', write: false })
  // Lexical owns DOM adapters; our JSON readers and node classes must stay usable on phones even inside uncalled functions.
  for (const token of parse(own.outputFiles[0]!.text, { sourceType: 'module', tokens: true }).tokens!) {
    if (token.type.label === 'name') assert.ok(!['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(token.value), `shared code uses DOM identifier ${token.value}`)
    // PrimJS lacks isWellFormed (lynx-packages-autolink#61); structuredClone is a web API, and ES2023 array search is unproven there.
    if (token.type.label === 'name') assert.ok(!['isWellFormed', 'toWellFormed', 'structuredClone', 'findLast', 'findLastIndex'].includes(token.value), `shared code calls ${token.value}, which PrimJS may lack`)
  }
  const result = await build({ entryPoints: ['packages/mithaq-rich-text/src/index.ts'], bundle: true, minify: true, platform: 'neutral', format: 'iife', globalName: 'richText', define: { 'process.env.NODE_ENV': '"production"' }, write: false, metafile: true })
  for (const path of Object.keys(result.metafile!.inputs)) {
    assert.ok(/^packages\/mithaq-rich-text\/src\/(?!check\.ts$)/.test(path) || /\/node_modules\/(?:lexical|@lexical\/[^/]+|@preact\/signals-core)\//.test(path), `only shared library and Lexical dependencies: ${path}`)
  }
  for (const output of Object.values(result.metafile!.outputs)) assert.deepEqual(output.imports, [], 'no Node builtins or external runtime imports')
  const bundle = result.outputFiles[0]!
  t.diagnostic(`Shared rich text and Lexical: ${bundle.contents.byteLength} bytes minified`)
  assert.ok(bundle.contents.byteLength < 1_000_000, 'the library and its Lexical dependencies fit the phone budget')
  const context: { richText?: typeof import('@drhomet/mithaq-rich-text') } = {}
  // A bare context has no structuredClone already; removing isWellFormed makes it PrimJS's String too.
  runInNewContext('delete String.prototype.isWellFormed; delete String.prototype.toWellFormed', context)
  runInNewContext(bundle.text, context)
  // URL and TextEncoder are platform APIs, not DOM objects; no window, document, React or Node is supplied.
  Object.assign(context, { URL, TextEncoder })
  const shared = context.richText!
  assert.equal(shared.defaultNodeRegistry.length, 21)
  const value = shared.convertPlaintextToLexical({ text: 'Hello مرحبا', nodes: shared.defaultNodes })
  assert.ok(!('refused' in value), JSON.stringify(value))
  if ('value' in value) {
    const read = shared.richTextReader(shared.defaultNodes)(value.value)
    assert.ok(!('refused' in read))
    assert.equal(read.text, 'Hello مرحبا')
  }
  assert.equal(shared.versionsOf([shared.UploadNode, shared.MentionNode]).get('upload'), 3)
  // The runs codec opens a Block with a table it cannot edit, takes an edit beside it and saves the table back untouched.
  const table = { type: 'table', version: 1, direction: null, format: '', indent: 0, children: [] }
  const paragraph = (text: string) => ({ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', children: [{ type: 'text', version: 1, detail: 0, format: 0, mode: 'normal', style: '', text }] })
  const editor = shared.createRunsEditor()
  const units = new shared.LockedTable()
  const runs = shared.loadBlock({ editor, children: [paragraph('مرحبا'), table], table: units })
  assert.equal(runs.text, 'مرحبا\n\uFFFC')
  const edited = shared.applyEdit(runs, { type: 'replace', start: 5, end: 5, text: ' world' })
  assert.ok(edited.ok)
  assert.equal(shared.applyEdit(runs, { type: 'replace', start: 5, end: 7, text: '' }).ok, false)
  shared.runsToNodes(editor, shared.validateRuns(edited.runs, ['u1']))
  assert.deepEqual(JSON.parse(JSON.stringify(shared.saveBlock(editor, units))), [paragraph('مرحبا world'), table])
})

test('core and admin resolve one shared package and one Lexical', async () => {
  const { createRequire } = await import('node:module')
  const { realpathSync, readFileSync } = await import('node:fs')
  const core = createRequire(new URL('../../package.json', import.meta.url))
  const admin = createRequire(new URL('../../../mithaq-admin/package.json', import.meta.url))
  const shared = createRequire(core.resolve('@drhomet/mithaq-rich-text'))
  const { peerDependencies } = JSON.parse(readFileSync(new URL('../../../mithaq-rich-text/package.json', import.meta.url), 'utf8')) as { peerDependencies: Record<string, string> }
  for (const name of ['@drhomet/mithaq-rich-text', ...Object.keys(peerDependencies)]) {
    const expected = realpathSync(core.resolve(name))
    for (const resolve of [admin, shared]) assert.equal(realpathSync(resolve.resolve(name)), expected, name)
  }
})

test('the shared CLI subpath is explicitly a bin entry', () => {
  assert.equal(import.meta.resolve('@drhomet/mithaq-rich-text/bin/check'), new URL('../../../mithaq-rich-text/src/check.ts', import.meta.url).href)
})
