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
  const result = await build({ entryPoints: ['packages/mithaq-rich-text/src/index.ts'], bundle: true, minify: true, platform: 'neutral', format: 'iife', globalName: 'richText', define: { 'process.env.NODE_ENV': '"production"' }, write: false, metafile: true })
  for (const path of Object.keys(result.metafile!.inputs)) {
    assert.ok(/^packages\/mithaq-rich-text\/src\/(?!check\.ts$)/.test(path) || /\/node_modules\/(?:lexical|@lexical\/[^/]+|@preact\/signals-core)\//.test(path), `only shared library and Lexical dependencies: ${path}`)
  }
  for (const output of Object.values(result.metafile!.outputs)) assert.deepEqual(output.imports, [], 'no Node builtins or external runtime imports')
  const bundle = result.outputFiles[0]!
  t.diagnostic(`Shared rich text and Lexical: ${bundle.contents.byteLength} bytes minified`)
  assert.ok(bundle.contents.byteLength < 1_000_000, 'the library and its Lexical dependencies fit the phone budget')
  const context: { richText?: typeof import('@drhomet/mithaq-rich-text') } = {}
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
})

test('core and admin resolve one shared package and one Lexical', async () => {
  const { createRequire } = await import('node:module')
  const { realpathSync } = await import('node:fs')
  const core = createRequire(new URL('../../package.json', import.meta.url))
  const admin = createRequire(new URL('../../../mithaq-admin/package.json', import.meta.url))
  const shared = createRequire(core.resolve('@drhomet/mithaq-rich-text'))
  for (const name of ['lexical', '@drhomet/mithaq-rich-text']) {
    const expected = realpathSync(core.resolve(name))
    for (const resolve of [admin, shared]) assert.equal(realpathSync(resolve.resolve(name)), expected, name)
  }
})
