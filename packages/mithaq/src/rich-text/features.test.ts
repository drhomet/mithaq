import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultNodes, defaultRichTextFeatures, richText } from './index.ts'

const document = (node: object) => ({ root: { type: 'root', children: [{ type: 'paragraph', children: [node] }] } })
const text = (format = 0) => ({ type: 'text', text: 'مرحبا Hello', format })
const schema = () => richText({ nodes: defaultNodes, features: ['bold', 'italic', 'link'] }).kinds.richText.targets.zod({ kind: 'richText', name: 'body', column: 'body', features: ['bold'] })

test('a field accepts only formats its project installed and the field selected', () => {
  assert.equal(schema().safeParse(document(text(1))).success, true)
  assert.equal(schema().safeParse(document(text(2))).success, false)
  assert.equal(schema().safeParse(document({ type: 'link', url: 'https://example.com', children: [text()] })).success, false)
  assert.throws(() => richText({ nodes: defaultNodes, features: ['bold'] }).kinds.richText.targets.zod({ kind: 'richText', name: 'body', column: 'body', features: ['tables'] }), /not installed/)
})

test('styles are fixed node choices, never CSS, and block overrides never belong on the root', () => {
  const kind = richText({ nodes: defaultNodes, features: ['styling', 'direction'], fonts: ['serif'] }).kinds.richText
  const check = kind.targets.zod()
  assert.equal(check.safeParse(document({ ...text(), $: { color: 'primary', size: 'large', font: 'serif' } })).success, true)
  for (const node of [
    { ...text(), style: 'color:red' }, { ...text(), textStyle: 'font-size:99px' },
    { ...text(), $: { color: 'red' } }, { ...text(), $: { font: 'sans' } },
    { ...text(), $: { size: '100px' } }, { ...text(), $: { css: 'background:url(https://example.com)' } },
  ]) assert.equal(check.safeParse(document(node)).success, false)
  const block = document(text())
  Object.assign(block.root.children[0]!, { $: { direction: 'rtl' } })
  assert.equal(check.safeParse(block).success, true)
  assert.equal(check.safeParse({ root: { ...block.root, $: { direction: 'rtl' } } }).success, false)
  assert.equal(check.safeParse(document({ ...text(), $: { direction: 'rtl' } })).success, false)
})

test('tables and code are installed per project and refused outside the selected field', () => {
  const table = { type: 'table', children: [{ type: 'tablerow', children: [{ type: 'tablecell', headerState: 1, children: [{ type: 'paragraph', children: [text()] }] }] }] }
  const code = { type: 'code', language: 'javascript', children: [text()] }
  const all = richText({ nodes: defaultNodes, features: ['tables', 'code'] }).kinds.richText.targets.zod()
  for (const node of [table, code]) {
    assert.equal(all.safeParse({ root: { type: 'root', children: [node] } }).success, true)
    assert.equal(schema().safeParse({ root: { type: 'root', children: [node] } }).success, false)
  }
})

test('0.3.4 serialized documents and converted Payload documents retain every byte when read', async () => {
  const { readFileSync } = await import('node:fs')
  const { convertPayloadToLexical } = await import('./index.ts')
  const old = JSON.parse(readFileSync(new URL('./__fixtures__/payload-product-description.json', import.meta.url), 'utf8'))
  const converted = convertPayloadToLexical({ data: old, nodes: defaultNodes })
  assert.ok('value' in converted)
  for (const value of [old, converted.value]) {
    const before = JSON.stringify(value)
    assert.equal(richText({ nodes: defaultNodes }).kinds.richText.targets.zod().safeParse(value).success, true)
    assert.equal(JSON.stringify(value), before)
  }
})

const installed = richText({ nodes: defaultNodes, features: ['bold', 'italic'] })
type LimitedField = import('../mithaq/types.ts').FieldOf<{ kinds: typeof installed.kinds; rules: {}; targets: {} }>
const valid: LimitedField = { kind: 'richText', features: ['bold'] }
// @ts-expect-error a field cannot enable an uninstalled project feature
const invalid: LimitedField = { kind: 'richText', features: ['tables'] }
void [valid, invalid]

test('new table and code values refuse CSS channels, unapproved languages and invalid structure', () => {
  const schema = richText({ nodes: defaultNodes, features: ['tables', 'code'] }).kinds.richText.targets.zod()
  const wrap = (node: object) => ({ root: { type: 'root', children: [node] } })
  const cell = { type: 'tablecell', children: [{ type: 'paragraph', children: [text()] }] }
  for (const node of [
    { type: 'table', children: [{ type: 'paragraph', children: [] }] },
    { type: 'table', colWidths: [300], children: [{ type: 'tablerow', children: [cell] }] },
    { type: 'table', children: [{ type: 'tablerow', children: [{ ...cell, backgroundColor: 'red' }] }] },
    { type: 'table', children: [{ type: 'tablerow', children: [{ ...cell, colSpan: 1000000 }] }] },
    { type: 'code', language: 'javascript:url(x)', children: [text()] },
  ]) assert.equal(schema.safeParse(wrap(node)).success, false)
})

test('a checklist is independently selectable and format numbers cannot wrap around the allowed bits', () => {
  const check = richText({ nodes: defaultNodes, features: ['checklist'] }).kinds.richText.targets.zod()
  const checklist = { root: { type: 'root', children: [{ type: 'list', listType: 'check', tag: 'ul', children: [{ type: 'listitem', checked: false, children: [text()] }] }] } }
  assert.equal(check.safeParse(checklist).success, true)
  assert.equal(schema().safeParse(document(text(4294967297))).success, false)
  const bad = document(text())
  Object.assign(bad.root.children[0]!, { textFormat: 1.5 })
  assert.equal(schema().safeParse(bad).success, false)
})

test('0.3.4 text format bits survive editing and Payload conversion under the default policy', async () => {
  const { readFileSync } = await import('node:fs')
  const legacy = JSON.parse(readFileSync(new URL('./__fixtures__/legacy-formatting-034.json', import.meta.url), 'utf8'))
  const check = richText({ nodes: defaultNodes }).kinds.richText.targets.zod()
  for (const value of [legacy.editorState, legacy.payloadConverted]) {
    assert.deepEqual(value.root.children.map((block: any) => block.children[0].format), [32, 64, 128, 256, 512, 1024, -1, 4096, 4294967297])
    assert.equal(check.safeParse(value).success, true)
  }
})

test('nested list items need lists, not the separate indentation feature', () => {
  const list = { type: 'list', listType: 'bullet', tag: 'ul', children: [{ type: 'listitem', indent: 0, children: [text(), { type: 'list', listType: 'bullet', tag: 'ul', children: [{ type: 'listitem', indent: 1, children: [text()] }] }] }] }
  assert.equal(richText({ nodes: defaultNodes, features: ['lists'] }).kinds.richText.targets.zod().safeParse({ root: { type: 'root', children: [list] } }).success, true)
})

test('code accepts no free theme string', () => {
  const check = richText({ nodes: defaultNodes, features: ['code'] }).kinds.richText.targets.zod()
  for (const theme of ['arbitrary-attribute', '', false]) assert.equal(check.safeParse({ root: { type: 'root', children: [{ type: 'code', language: 'javascript', theme, children: [text()] }] } }).success, false)
})

test('direction overrides belong to real blocks and never inline links', () => {
  const check = richText({ nodes: defaultNodes, features: ['link', 'direction'] }).kinds.richText.targets.zod()
  assert.equal(check.safeParse(document({ type: 'link', url: 'https://example.com', children: [text()], $: { direction: 'rtl' } })).success, false)
  assert.equal(check.safeParse(document({ ...text(), direction: 'rtl' })).success, false)
})

test('legacy direction metadata survives validation for every element, including custom elements', async () => {
  const { AutoLinkNode, CalloutNode } = await import('../../../mithaq-admin/test/callout-node.ts')
  const check = richText({ nodes: [...defaultNodes, AutoLinkNode, CalloutNode], features: [...defaultRichTextFeatures, 'tables', 'comments'], comments: { threads: 'richTextThreads' } }).kinds.richText.targets.zod()
  const element = (type: string, children: object[], extra = {}) => ({ type, children, direction: 'ltr', format: '', indent: 0, version: 1, ...extra })
  const paragraph = () => element('paragraph', [text()])
  // Lexical 0.20's ElementNode.exportJSON includes direction; every subclass spreading super inherits it.
  for (const node of [
    element('link', [text()], { url: 'https://example.com' }),
    element('autolink', [text()], { url: 'https://example.com' }),
    element('mark', [text()], { ids: ['00000000-0000-4000-8000-000000000001'] }),
    element('list', [element('listitem', [text()])], { listType: 'bullet', tag: 'ul' }),
    element('table', [element('tablerow', [element('tablecell', [paragraph()], { headerState: 0 })])]),
    element('quote', [text()]),
    element('callout', [paragraph()], { tone: 'info' }),
  ]) {
    const value = { root: element('root', [node]) }
    const before = JSON.stringify(value)
    const result = check.safeParse(value)
    assert.equal(result.success, true, result.success ? '' : result.error.message)
    assert.equal(JSON.stringify(value), before, `${node.type} retains its metadata`)
  }
})

test('an unrestricted default format policy retains other integers accepted by 0.3.4', () => {
  const check = richText({ nodes: defaultNodes }).kinds.richText.targets.zod()
  for (const format of [-1, 4096, 4294967297]) assert.equal(check.safeParse(document(text(format))).success, true)
})
