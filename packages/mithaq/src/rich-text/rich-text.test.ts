import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CalloutNode } from '../../../mithaq-admin/test/callout-node.ts'
import * as richText from '@drhomet/mithaq-rich-text/rich-text'

const { defaultNodes, richTextReader } = richText

// A real stored product description from Payload's lexical editor.
const fixture: unknown = JSON.parse(readFileSync(new URL('./__fixtures__/payload-product-description.json', import.meta.url), 'utf8'))

const text = (value: string, extra: object = {}) => ({ type: 'text', text: value, detail: 0, format: 0, mode: 'normal', style: '', version: 1, ...extra })
const paragraph = (...children: object[]) => ({ type: 'paragraph', children, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', version: 1 })
const state = (...children: object[]) => ({ root: { type: 'root', children, direction: null, format: '', indent: 0, version: 1 } })
/** What Lexical 0.52 itself writes for a text node and a link, as `toJSON` does. */
const lexicalText = (value: string) => ({ detail: 0, format: 0, mode: 'normal', style: '', text: value, type: 'text', version: 1 })
const lexicalLink = (url: string, target: string | null, ...children: object[]) => ({ children, direction: null, format: '', indent: 0, rel: target === '_blank' ? 'noopener' : null, target, title: null, type: 'link', url, version: 1 })

/** The value a conversion returned, failing the test with the refusal where there was one. */
const converted = (result: richText.RichTextConverted) => {
  if ('refused' in result) assert.fail(`refused: ${result.refused}`)
  return result
}
const where = (result: richText.RichTextConverted) => converted(result).dropped.map(({ path, type }) => ({ path, type }))
const read = (value: unknown, nodes = defaultNodes) => richTextReader(nodes)(value)
const children = (value: unknown, ...at: number[]) => at.reduce((node: any, index) => node.children[index], (value as { root: unknown }).root) as { type: string; children: unknown[]; [key: string]: unknown }

test('187z. the converters take the project\'s nodes and pick none of their own: a call without them is a type error and a refusal naming the key', () => {
  for (const result of [
    // @ts-expect-error nodes is required
    richText.convertPayloadToLexical({ data: state(paragraph(text('a'))) }),
    // @ts-expect-error nodes is required
    richText.convertPlaintextToLexical({ text: 'a' }),
  ]) {
    assert.deepEqual(result, { refused: 'The converters were handed no "nodes", and pick none of their own. Pass the project\'s list: nodes: [...defaultNodes, ...].' })
  }
})

test('187a. A stored Payload description converts with nothing dropped, passes the reader and reads as the same text', () => {
  const result = converted(richText.convertPayloadToLexical({ data: fixture, nodes: defaultNodes }))
  assert.deepEqual(result.dropped, [])
  const before = read(fixture)
  const after = read(result.value)
  assert.ok('text' in before && 'text' in after, 'both read')
  assert.equal(after.text, before.text)
  assert.match(after.text, /This is Heading 1/)
})

test('187b. a Payload custom link takes its url from fields.url, and newTab as target with rel noopener, and loses fields and id', () => {
  const link = { type: 'link', id: '65f0c0ffee', fields: { url: 'https://example.com/a', newTab: true, linkType: 'custom' }, children: [text('Example')], direction: null, format: '', indent: 0, version: 3 }
  const result = converted(richText.convertPayloadToLexical({ data: state(paragraph(link)), nodes: defaultNodes }))
  assert.deepEqual(result.dropped, [])
  assert.deepEqual(children(result.value, 0, 0), lexicalLink('https://example.com/a', '_blank', lexicalText('Example')))
})

test('187c. an autolink becomes a link, and one its writer unlinked becomes its text, reported', () => {
  const autolink = { type: 'autolink', fields: { url: 'https://x.com', newTab: false, linkType: 'custom' }, children: [text('x.com')], direction: null, format: '', indent: 0, version: 2 }
  const result = converted(richText.convertPayloadToLexical({ data: state(paragraph(autolink)), nodes: defaultNodes }))
  assert.deepEqual(result.dropped, [])
  assert.deepEqual(children(result.value, 0, 0), lexicalLink('https://x.com', null, lexicalText('x.com')))
  const unlinked = richText.convertPayloadToLexical({ data: state(paragraph({ ...autolink, isUnlinked: true })), nodes: defaultNodes })
  assert.deepEqual(where(unlinked), [{ path: 'root.children[0].children[0]', type: 'autolink' }])
  assert.deepEqual(children(converted(unlinked).value, 0).children, [lexicalText('x.com')])
})

test('187d. an internal link is unwrapped to its text and reported with its path', () => {
  const internal = { type: 'link', id: 'abc', fields: { linkType: 'internal', newTab: false, doc: { relationTo: 'pages', value: 'p1' } }, children: [text('About us')], direction: null, format: '', indent: 0, version: 3 }
  const result = richText.convertPayloadToLexical({ data: state(paragraph(text('See '), internal)), nodes: defaultNodes })
  assert.deepEqual(where(result), [{ path: 'root.children[0].children[1]', type: 'link' }])
  assert.deepEqual(children(converted(result).value, 0).children, [lexicalText('See '), lexicalText('About us')])
})

test('187e. a link to javascript:, a bare https:// or sms: is unwrapped and reported, and www.x.com becomes https://www.x.com', () => {
  const link = (url: string, words: string) => ({ type: 'link', fields: { url, newTab: false, linkType: 'custom' }, children: [text(words)], format: '', indent: 0, version: 3 })
  const result = richText.convertPayloadToLexical({ data: state(paragraph(link('javascript:alert(1)', 'run'), link('https://', 'blank'), link('sms:+15550100', 'text me'), link('www.x.com', 'x'))), nodes: defaultNodes })
  assert.deepEqual(where(result), [0, 1, 2].map((index) => ({ path: `root.children[0].children[${index}]`, type: 'link' })))
  assert.deepEqual(children(converted(result).value, 0).children, [lexicalText('run'), lexicalText('blank'), lexicalText('text me'), lexicalLink('https://www.x.com', null, lexicalText('x'))])
})

test('187f. upload, relationship, block and inlineBlock are dropped and reported, and a type the node list registers passes through', () => {
  const data = state(
    { type: 'upload', id: 'u1', relationTo: 'media', value: '1', fields: null, format: '', version: 3 },
    { type: 'relationship', relationTo: 'products', value: '2', format: '', version: 2 },
    { type: 'block', fields: { id: 'b1', blockName: '', blockType: 'cta' }, format: '', version: 2 },
    paragraph(text('Before '), { type: 'inlineBlock', fields: { id: 'c1', blockType: 'chip' }, version: 1 }),
    { type: 'callout', tone: 'warning', children: [paragraph(text('Mind the step'))], direction: null, format: '', indent: 0, version: 1 },
  )
  const nodes = [...defaultNodes, CalloutNode]
  const result = richText.convertPayloadToLexical({ data, nodes })
  assert.deepEqual(where(result), [
    { path: 'root.children[0]', type: 'upload' },
    { path: 'root.children[1]', type: 'relationship' },
    { path: 'root.children[2]', type: 'block' },
    { path: 'root.children[3].children[1]', type: 'inlineBlock' },
  ])
  const { value } = converted(result)
  assert.deepEqual(value.root.children.map((node) => node.type), ['paragraph', 'callout'])
  assert.equal(children(value, 1).tone, 'warning')
  const after = read(value, nodes)
  assert.ok('text' in after && after.text.includes('Mind the step'))
})

test('187g. a non-empty style or textStyle is cleared and reported, and one that is no string is said to be none without being read', () => {
  let deep: object = {}
  for (let level = 0; level < 100_000; level++) deep = { deep }
  const data = state({ ...paragraph(text('Red', { style: 'color: red' }), text('Deep', { style: deep })), textStyle: 'font-size: 20px' })
  const result = richText.convertPayloadToLexical({ data, nodes: defaultNodes })
  assert.deepEqual(where(result), [
    { path: 'root.children[0]', type: 'paragraph' },
    { path: 'root.children[0].children[0]', type: 'text' },
    { path: 'root.children[0].children[1]', type: 'text' },
  ])
  assert.match(converted(result).dropped[2]!.reason, /a value that is not a string/)
  const node = children(converted(result).value, 0)
  assert.equal((node as { textStyle?: unknown }).textStyle, '')
  assert.deepEqual(node.children, [lexicalText('Red'), lexicalText('Deep')])
})

test('187k. a link whose address is no string is replaced by its text and reported without its address being read', () => {
  let deep: object = {}
  for (let level = 0; level < 100_000; level++) deep = { deep }
  const link = (url: unknown, words: string) => ({ type: 'link', fields: { url, newTab: false, linkType: 'custom' }, children: [text(words)], format: '', indent: 0, version: 3 })
  const result = richText.convertPayloadToLexical({ data: state(paragraph(link(42, 'number'), link(deep, 'deep'))), nodes: defaultNodes })
  assert.deepEqual(where(result), [0, 1].map((index) => ({ path: `root.children[0].children[${index}]`, type: 'link' })))
  for (const { reason } of converted(result).dropped) assert.match(reason, /a value that is not a string/)
  assert.deepEqual(children(converted(result).value, 0).children, [lexicalText('number'), lexicalText('deep')])
})

test('187h. converting a converted value again gives the same value and reports nothing', () => {
  const messy = state(
    ...(fixture as { root: { children: object[] } }).root.children,
    paragraph(
      { type: 'autolink', fields: { url: 'www.x.com', newTab: true, linkType: 'custom' }, children: [text('x')], format: '', indent: 0, version: 2 },
      { type: 'link', fields: { url: 'javascript:void 0', newTab: false, linkType: 'custom' }, children: [text('bad', { style: 'color: red' })], format: '', indent: 0, version: 3 },
      { type: 'upload', relationTo: 'media', value: '1', version: 3 },
    ),
  )
  for (const first of [richText.convertPayloadToLexical({ data: messy, nodes: defaultNodes }), richText.convertPlaintextToLexical({ text: 'a\tb\nc\n\nمرحبا', nodes: defaultNodes })]) {
    const once = converted(first)
    const twice = converted(richText.convertPayloadToLexical({ data: once.value, nodes: defaultNodes }))
    assert.deepEqual(twice.dropped, [])
    assert.deepEqual(twice.value, once.value)
  }
})

test('187i. a value past 512 KiB, nested past 64 levels or holding one node in two places is refused, before or after conversion, and no input throws or runs out of stack', () => {
  const refused = (result: richText.RichTextConverted, reason: RegExp) => {
    assert.ok('refused' in result, 'refused')
    assert.match(result.refused, reason)
  }
  refused(richText.convertPayloadToLexical({ data: state(paragraph(text('a'.repeat(600 * 1024)))), nodes: defaultNodes }), /larger than 524288 bytes/)
  refused(richText.convertPlaintextToLexical({ text: 'a'.repeat(600 * 1024), nodes: defaultNodes }), /larger than 524288 bytes/)
  for (const depth of [40, 100_000]) {
    let node: object = text('deep')
    for (let level = 0; level < depth; level++) node = { type: 'quote', children: [node] }
    refused(richText.convertPayloadToLexical({ data: state(node), nodes: defaultNodes }), /deeper than 64 levels/)
  }
  for (const data of [null, 'text', [], { root: null }, state(text('x', { detail: 1n })), { get root() { throw new Error('a getter that throws') } }]) {
    assert.ok('refused' in richText.convertPayloadToLexical({ data, nodes: defaultNodes }))
  }
  assert.ok('refused' in richText.convertPlaintextToLexical({ text: undefined as unknown as string, nodes: defaultNodes }))
  // Under the bound as handed in and over it once Lexical writes every default key.
  const long = Array.from({ length: 3000 }, () => 'a'.repeat(110)).join('\n\n')
  assert.ok(long.length < richText.richTextBounds.bytes)
  const grown = richText.convertPlaintextToLexical({ text: long, nodes: defaultNodes })
  refused(grown, /larger than 524288 bytes/)
  // One node in two places, a cycle among them, is refused rather than
  // walked once for each way to reach it.
  const shared = text('twice')
  refused(richText.convertPayloadToLexical({ data: state(paragraph(shared, shared)), nodes: defaultNodes }), /two places/)
  const cyclic: any = { type: 'paragraph', children: [] }
  cyclic.children.push(cyclic)
  refused(richText.convertPayloadToLexical({ data: state(cyclic), nodes: defaultNodes }), /two places/)
  let dag: object = text('leaf')
  for (let level = 0; level < 60; level++) dag = { type: 'quote', children: [dag, dag] }
  refused(richText.convertPayloadToLexical({ data: state(dag), nodes: defaultNodes }), /two places/)
  // Each case is shallow enough that the depth check alone would let it through.
  const readRefused = (value: unknown) => {
    const result = read(value)
    assert.ok('refused' in result, 'refused')
    assert.match(result.refused, /^The value holds one object in two places\.$/)
  }
  readRefused(state(paragraph(shared, shared)))
  let shallow: object = text('leaf')
  for (let level = 0; level < 20; level++) shallow = { type: 'quote', children: [shallow, shallow] }
  readRefused(state(shallow))
  readRefused(state(cyclic))
  // A value too deep is refused for its depth, and only that.
  let chain: object = text('bottom')
  for (let level = 0; level < 100; level++) chain = { type: 'quote', children: [chain] }
  const deep = read(state(chain))
  assert.ok('refused' in deep, 'refused')
  assert.match(deep.refused, /deeper than 64 levels/)
  assert.doesNotMatch(deep.refused, /two places/)
})

test('187j. plain text: empty is one empty paragraph, one newline a linebreak, a blank line a new paragraph, a tab a tab, and Arabic reads back the same', () => {
  const plain = (value: string) => converted(richText.convertPlaintextToLexical({ text: value, nodes: defaultNodes }))
  assert.deepEqual(plain(''), { value: { root: { children: [{ children: [], direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', type: 'paragraph', version: 1 }], direction: null, format: '', indent: 0, type: 'root', version: 1 } }, dropped: [] })
  assert.deepEqual(children(plain('a\nb').value, 0).children, [lexicalText('a'), { type: 'linebreak', version: 1 }, lexicalText('b')])
  const two = plain('a\n\nb').value
  assert.deepEqual(two.root.children.map((node) => node.children), [[lexicalText('a')], [lexicalText('b')]])
  const arabic = 'مرحبا\tبالعالم\n\nسطر ثان'
  const value = plain(arabic).value
  assert.deepEqual(children(value, 0).children.map((node) => (node as { type: string }).type), ['text', 'tab', 'text'])
  const back = read(value)
  assert.ok('text' in back)
  assert.equal(back.text, arabic)
})

/** An upload node as Payload's lexical editor writes it, v3. */
const uploadNode = (extra: object = {}) => ({ type: 'upload', version: 3, format: '', id: '65f1c0ffee0000000000abcd', relationTo: 'media', value: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', fields: null, ...extra })

test('186r. an upload node reads where its relationTo is a kayan of the build that holds files, and is refused for another kayan, a missing one, a value that is no id string or fields that are no object', () => {
  const nodes = [...defaultNodes, richText.UploadNode]
  const reader = richTextReader(nodes, ['media'])
  assert.deepEqual(reader(state(uploadNode())), { text: '', holdsDecorator: true })
  assert.deepEqual(reader(state(uploadNode({ format: 'center', fields: { caption: 'x' } }))), { text: '', holdsDecorator: true })
  assert.deepEqual(reader(state(uploadNode({ fields: undefined }))), { text: '', holdsDecorator: true })
  // Fields are refused rather than nulled, as rich-input refuses them, so no write loses them.
  for (const bad of [{ relationTo: 'courses' }, { relationTo: undefined }, { value: 7 }, { value: '' }, { value: undefined }, { value: { id: 'x' } }, { fields: [{ caption: 'x' }] }, { fields: 'caption' }]) {
    const result = reader(state(uploadNode(bad)))
    assert.ok('refused' in result, `refused: ${JSON.stringify(bad)}`)
  }
  // A build holding no files takes no upload at all.
  assert.ok('refused' in richTextReader(nodes, [])(state(uploadNode())))
  assert.deepEqual(read(state(uploadNode())), {
    refused: 'No node of this editor is of type "upload". Add its class to the nodes passed to richText({ nodes }), or convert or remove the node before writing.',
    type: 'upload',
  })
})

test('186s. a Payload upload node passes through conversion where the list registers UploadNode, in the v3 shape Payload writes', () => {
  const nodes = [...defaultNodes, richText.UploadNode]
  const { value, dropped } = converted(richText.convertPayloadToLexical({ data: state(uploadNode({ format: 'center' }), paragraph(text('after'))), nodes }))
  assert.deepEqual(dropped, [])
  assert.deepEqual(children(value, 0), uploadNode({ format: 'center' }))
  assert.deepEqual(converted(richText.convertPayloadToLexical({ data: value, nodes })).value, value)
})

test('186ae. a Payload upload node naming its row by a number, as Payload\'s postgres adapter can write it, converts with the id as a string', () => {
  const nodes = [...defaultNodes, richText.UploadNode]
  const { value, dropped } = converted(richText.convertPayloadToLexical({ data: state(uploadNode({ value: 42 })), nodes }))
  assert.deepEqual(dropped, [])
  assert.equal(children(value, 0).value, '42')
  // A number that is no id stays as it was, and the reader refuses it.
  assert.ok('refused' in richText.convertPayloadToLexical({ data: state(uploadNode({ value: Number.NaN })), nodes }))
})

test('187m. a node of a known type is read only at a JSON version its class reads, so a newer one is refused by name and never parsed, while an older or unnumbered one still reads', () => {
  const nodes = [...defaultNodes, richText.UploadNode]
  for (const value of [state(paragraph(text('a'))), state({ ...paragraph(text('a')), version: undefined }), state({ type: 'upload', relationTo: 'media', value: '1', version: 3 })]) {
    assert.ok('text' in read(value, nodes), `reads ${JSON.stringify(value)}`)
  }
  for (const [value, type] of [[state({ ...paragraph(text('a')), version: 2 }), 'paragraph'], [state(paragraph(text('a', { version: 9 }))), 'text'], [state({ type: 'upload', relationTo: 'media', value: '1', version: 4 }), 'upload'], [state({ ...paragraph(text('a')), version: '1' }), 'paragraph']] as const) {
    const answer = read(value, nodes)
    assert.ok('refused' in answer, `refuses ${JSON.stringify(value)}`)
    assert.equal(answer.type, type)
    assert.match(answer.refused, new RegExp(`newer "${type}" node`))
  }
  assert.deepEqual(richText.storedRichText(state({ ...paragraph(text('a')), version: 2 })), { text: '' }, 'a stored value still reads back for display')
})

test('a node needing constructor arguments is refused unless its class declares a supported JSON version', async () => {
  const { TextNode } = await import('lexical')
  class RequiredText extends TextNode {
    static getType() { return 'required-text' }
    static clone(node: RequiredText) { return new RequiredText(node.getTextContent()) }
    constructor(words?: string) {
      if (words === undefined) throw new Error('Words are required.')
      super(words)
    }
    static importJSON(json: import('lexical').SerializedTextNode) { return new RequiredText(json.text).updateFromJSON(json) }
    exportJSON() { return { ...super.exportJSON(), type: 'required-text', version: 1 } }
  }
  class DeclaredText extends RequiredText {
    static supportedVersion = 1
    static getType() { return 'declared-text' }
    static clone(node: DeclaredText) { return new DeclaredText(node.getTextContent()) }
    static importJSON(json: import('lexical').SerializedTextNode) { return new DeclaredText(json.text).updateFromJSON(json) }
    exportJSON() { return { ...super.exportJSON(), type: 'declared-text' } }
  }
  for (const version of [undefined, 0, 1, 2]) {
    const result = read(state(paragraph(text('Keep', { type: 'required-text', version }))), [...defaultNodes, RequiredText])
    assert.ok('refused' in result, `an undeclared class refuses version ${version}`)
  }
  const nodes = [...defaultNodes, DeclaredText]
  assert.equal('refused' in read(state(paragraph(text('Keep', { type: 'declared-text', version: 1 }))), nodes), false)
  assert.equal('refused' in read(state(paragraph(text('Keep', { type: 'declared-text', version: 2 }))), nodes), true)
})

test('Payload block and relationship versions convert to the versions their registered classes write', () => {
  class Block extends CalloutNode {
    $config() { return this.config('block', { extends: CalloutNode }) }
  }
  class Relationship extends CalloutNode {
    $config() { return this.config('relationship', { extends: CalloutNode }) }
  }
  const nodes = [...defaultNodes, Block, Relationship]
  const data = state(...['block', 'relationship'].map((type) => ({ type, version: 2, tone: 'warning', children: [paragraph(text(type))], direction: null, format: '', indent: 0 })))
  const result = converted(richText.convertPayloadToLexical({ data, nodes }))
  assert.deepEqual(result.dropped, [])
  assert.deepEqual(result.value.root.children.map(({ type, version, tone }) => ({ type, version, tone })), [
    { type: 'block', version: 1, tone: 'warning' },
    { type: 'relationship', version: 1, tone: 'warning' },
  ])
  assert.deepEqual(read(result.value, nodes), { text: 'block\n\nrelationship', holdsDecorator: false })
})
