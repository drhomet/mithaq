import './dom.ts'
import './tsx.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRoot } from 'react-dom/client'
import { mount, window, click, press, type } from './dom.ts'
import type { RichTextPolicy, RichTextValue } from 'mithaq/rich-text'

const { RichTextEditor } = await import('../registry/rich-text-editor.tsx')
const { defaultNodes, richText, richTextFeatureGuard } = await import('mithaq/rich-text')
const { RichTextContext, viewsOf, defaultPicks } = await import('../registry/rich-text-picks.tsx')
const installed = { nodes: viewsOf(defaultNodes), picks: defaultPicks, featureModules: { mentions: () => import('../registry/rich-text-mentions.tsx'), comments: () => import('../registry/rich-text-comments.tsx'), findReplace: () => import('../registry/rich-text-find-replace.tsx') } }
const { ScreenContext } = await import('mithaq/admin/react')
const { $getRoot, $createTextNode } = await import('lexical')
const { $generateNodesFromDOM } = await import('@lexical/html')
const t = (_key: string, fallback?: string) => fallback
const legacy = JSON.parse(readFileSync(new URL('../../mithaq/src/rich-text/__fixtures__/legacy-formatting-034.json', import.meta.url), 'utf8'))

async function withEditor({ value, policy, screen, locale = 'en', run }: { value?: unknown; policy?: RichTextPolicy; screen?: any; locale?: string; run: (args: { editor: import('lexical').LexicalEditor; host: HTMLElement; changes: RichTextValue[] }) => Promise<void> }) {
  const host = mount()
  const root = createRoot(host)
  const changes: RichTextValue[] = []
  try {
    await act(async () => root.render(createElement(RichTextContext, { value: installed }, createElement(ScreenContext, { value: screen }, createElement(RichTextEditor, { value, policy, onChange: (value) => changes.push(value), direction: 'ltr', t, locale, id: 'policy-editor' })))))
    await act(async () => sleep(100))
    const editor = (host.querySelector('#policy-editor') as unknown as { __lexicalEditor: import('lexical').LexicalEditor }).__lexicalEditor
    assert.ok(editor, 'the editor loaded')
    await run({ editor, host, changes })
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}

test('editing 0.3.4 and Payload-converted documents keeps every legacy text format', async () => {
  for (const value of [legacy.editorState, legacy.payloadConverted]) await withEditor({ value, run: async ({ editor, changes }) => {
    await act(async () => editor.update(() => { $getRoot().getAllTextNodes()[0]!.spliceText(0, 0, 'edited ') }))
    const saved = changes.at(-1)!
    assert.deepEqual(saved.root.children.map((block) => block.children![0]!.format), [32, 64, 128, 256, 512, 1024, -1, 4096, 4294967297])
    const parsed = richText({ nodes: defaultNodes }).kinds.richText.targets.zod().safeParse(saved)
    assert.equal(parsed.success, true, parsed.success ? '' : parsed.error.message)
  } })
})

test('every emitted paste value satisfies the same field policy and retains its words', async () => {
  const htmlCases = [
    '<p><sub>paste</sub><sup>paste</sup><mark>paste</mark><b>paste</b></p>',
    '<h2 style="text-align:center">paste</h2><blockquote>paste</blockquote>',
    '<p style="text-indent:40px;color:red;font-size:30px"><a href="https://example.com">paste</a></p>',
    '<p><a href="javascript:alert(1)">paste</a></p><ul><li>paste<ul><li>paste</li></ul></li></ul>',
    '<table style="width:500px"><colgroup><col width="250"><col width="250"></colgroup><tbody><tr style="height:40px"><td style="width:250px;background-color:red">paste</td><td>paste</td></tr></tbody></table>',
    '<pre data-language="bash" data-theme="free-string">paste command</pre>',
  ]
  for (const features of [[], ['bold', 'lists', 'link'], ['tables'], ['code']] as const) {
    const policy: RichTextPolicy = { features, fonts: ['sans'] }
    for (const html of htmlCases) await withEditor({ policy, run: async ({ editor, changes }) => {
      await act(async () => editor.update(() => {
        $getRoot().clear()
        const dom = new window.DOMParser().parseFromString(html, 'text/html')
        const nodes = $generateNodesFromDOM(editor, dom as unknown as Document)
        $getRoot().select().insertNodes(nodes)
      }))
      await act(async () => sleep(20))
      const held = JSON.parse(JSON.stringify(editor.getEditorState().toJSON())) as RichTextValue
      assert.equal(richTextFeatureGuard({ node: held.root, policy }), undefined, `held state: ${features.join(',')} ${html}`)
      assert.ok(changes.length, `paste emitted an editable value: ${features.join(',')} ${html}`)
      for (const value of changes) assert.equal(richTextFeatureGuard({ node: value.root, policy }), undefined, `features ${features.join(',')}, paste ${html}`)
      assert.match(JSON.stringify(changes.at(-1)), /paste/i, 'the pasted words survive')
    } })
  }
})

test('unset styling leaves code tokens to their monospace and syntax CSS', async () => {
  const value = { root: { type: 'root', children: [{ type: 'code', language: 'javascript', children: [{ type: 'text', text: 'const paste = "value";', format: 0 }] }] } }
  await withEditor({ value, policy: { features: ['code', 'styling'], fonts: ['sans'] }, run: async ({ host }) => {
    const spans = [...host.querySelectorAll('code span')]
    assert.ok(spans.length, 'highlighted code rendered')
    for (const span of spans) {
      assert.equal((span as HTMLElement).style.fontFamily, '')
      assert.equal((span as HTMLElement).style.color, '')
      assert.equal((span as HTMLElement).style.fontSize, '')
    }
  } })
})

test('read views ignore direction overrides on inline links', async () => {
  const { RichTextViewer } = await import('../registry/rich-text-viewer.tsx')
  const host = mount()
  const root = createRoot(host)
  try {
    const value = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'link', url: 'https://example.com', direction: 'rtl', $: { direction: 'rtl' }, children: [{ type: 'text', text: 'English link' }] }] }] } }
    await act(async () => root.render(createElement(RichTextViewer, { value, direction: 'ltr', t })))
    assert.notEqual(host.querySelector('a')?.getAttribute('dir'), 'rtl')
  } finally { await act(async () => root.unmount()); host.remove() }
})

test('style and direction menus expose their current choice as checked radio items', async () => {
  const { $setState } = await import('lexical')
  const { colorChoice, directionChoice } = await import('../registry/rich-text-choices.ts')
  const value = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'selected words', format: 0 }] }] } }
  await withEditor({ value, policy: { features: ['styling', 'direction'], fonts: ['sans'] }, run: async ({ editor, host }) => {
    await act(async () => editor.update(() => {
      const text = $getRoot().getAllTextNodes()[0]!
      text.select(0, 8)
      $setState(text, colorChoice, 'primary')
      $setState(text.getParent()!, directionChoice, 'rtl')
    }))
    const button = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Text style')!
    await act(async () => click(button))
    assert.ok([...window.document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].some((one) => one.textContent?.includes('primary')))
    await act(async () => press(window.document.activeElement as unknown as Element, 'Escape'))
    await act(async () => click(host.querySelector('button[aria-label^="Block direction"]')!))
    assert.ok([...window.document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].some((one) => one.textContent?.includes('rtl')))
  } })
})

test('opening an allowed 0.3.4 document does not emit a replacement value', async () => {
  await withEditor({ value: legacy.editorState, run: async ({ changes }) => { assert.equal(changes.length, 0) } })
})

test('an oversized edit reaches the field so the server can report its refusal', async () => {
  await withEditor({ value: legacy.editorState, run: async ({ editor, changes }) => {
    assert.equal(changes.length, 0, 'opening a stored document sends nothing')
    const text = 'x'.repeat(600 * 1024)
    await act(async () => editor.update(() => { $getRoot().getAllTextNodes()[0]!.setTextContent(text) }))
    assert.equal(changes.length, 1, 'the field receives the edit instead of keeping its last good value')
    assert.equal(changes[0]!.root.children[0]!.children![0]!.text, text)
    const parsed = richText({ nodes: defaultNodes }).kinds.richText.targets.zod().safeParse(changes[0])
    assert.equal(parsed.success, false, 'the server refuses the oversized value')
    if (!parsed.success) assert.match(parsed.error.message, /larger than 524288 bytes/)
  } })
})

test('the mounted link popover follows a scrolling ancestor', async () => {
  const value = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'link', url: 'https://example.com', children: [{ type: 'text', text: 'linked words' }] }] }] } }
  await withEditor({ value, run: async ({ editor, host }) => {
    const link = host.querySelector('a')!
    host.style.overflow = 'auto'
    // happy-dom has no layout; supply the link geometry a browser gives after ancestor scrolling.
    link.getBoundingClientRect = () => new window.DOMRect(40, 200 - host.scrollTop, 90, 20) as unknown as DOMRect
    await act(async () => editor.update(() => { $getRoot().getAllTextNodes()[0]!.select(0, 6) }))
    const anchor = host.querySelector<HTMLElement>('[data-slot="popover-trigger"]')!
    assert.ok(window.document.querySelector('[data-link-editor]'), 'the link popover is mounted')
    assert.equal(anchor.style.top, '200px')
    await act(async () => {
      host.scrollTop = 70
      host.dispatchEvent(new window.Event('scroll', { bubbles: false }) as unknown as Event)
    })
    assert.equal(anchor.style.top, '130px', 'the popover anchor follows the link by the scroll distance')
    assert.equal(anchor.style.left, '40px')
  } })
})

test('the mentions add-on writes emoji as text and Arabic hashtags as hashtag nodes', async () => {
  await withEditor({ policy: { features: ['mentions'], fonts: ['sans'] }, run: async ({ editor, changes }) => {
    await act(async () => editor.update(() => {
      const paragraph = $getRoot().getFirstChildOrThrow() as import('lexical').ParagraphNode
      paragraph.append($createTextNode('مرحبا :smile: بكم').setFormat('bold'))
      paragraph.selectEnd()
    }))
    const saved = JSON.stringify(changes.at(-1))
    assert.ok(saved.includes('😀'))
    assert.ok(!saved.includes('"type":"emoji"'))
    await act(async () => editor.update(() => {
      const text = $getRoot().getAllTextNodes().at(-1)!
      text.spliceText(text.getTextContentSize(), 0, ' #العربية')
    }))
    assert.ok(JSON.stringify(changes.at(-1)).includes('"type":"hashtag"'))
  } })
})

test('a mention viewer removes its link when a fresh record read is refused', async () => {
  const { ScreenContext } = await import('mithaq/admin/react')
  const { RichTextViewer } = await import('../registry/rich-text-viewer.tsx')
  const host = mount(), root = createRoot(host)
  const value = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'mention', kayan: 'tags', id: 'dummy-tag', name: 'Snapshot', text: '@Snapshot', version: 1 }] }] } }
  const state = (allowed: boolean) => ({ dir: 'ltr', screen: { path: '/dashboard', kayan: { tags: { fields: [], pages: { edit: { path: '/tags/:id' } } } } }, client: async () => { if (!allowed) throw new Error('Forbidden'); return { id: 'dummy-tag' } } }) as any
  const render = (allowed: boolean) => root.render(createElement(RichTextContext, { value: installed }, createElement(ScreenContext, { value: state(allowed) }, createElement(RichTextViewer, { value, direction: 'ltr', t }))))
  try {
    await act(async () => { render(true); await sleep(100) })
    await act(async () => sleep(100))
    assert.equal(host.querySelector('a')?.getAttribute('href'), '/dashboard/tags/dummy-tag')
    await act(async () => { render(false); await sleep(100) })
    assert.equal(host.querySelector('a')?.getAttribute('href'), null)
    assert.ok(host.textContent?.includes('@Snapshot'))
  } finally { await act(async () => root.unmount()); host.remove() }
})

test('find and replace updates hashtag words and unwraps a tag replaced with ordinary text', async () => {
  const { $replaceMatches } = await import('../registry/rich-text-find.ts')
  await withEditor({ policy: { features: ['mentions', 'findReplace'], fonts: ['sans'] }, run: async ({ editor, changes }) => {
    await act(async () => editor.update(() => { ($getRoot().getFirstChildOrThrow() as import('lexical').ParagraphNode).append($createTextNode('#old #old')) }))
    await act(async () => editor.update(() => { assert.equal($replaceMatches({ query: 'old', replacement: 'new', all: true, index: 0, locale: 'en', matchCase: false, wholeWord: true }), 2) }))
    assert.equal(editor.getEditorState().read(() => $getRoot().getTextContent()), '#new #new')
    await act(async () => editor.update(() => { assert.equal($replaceMatches({ query: '#new', replacement: 'plain', all: true, index: 0, locale: 'en', matchCase: false, wholeWord: false }), 2) }))
    assert.equal(editor.getEditorState().read(() => $getRoot().getTextContent()), 'plain plain')
    assert.ok(!JSON.stringify(changes.at(-1)).includes('"type":"hashtag"'))
  } })
})


test('the default member picker searches managed reads and never reveals a masked name', async () => {
  const calls: any[] = []
  let providerCalls = 0
  const fetchBefore = globalThis.fetch
  globalThis.fetch = (async () => { providerCalls++; return Response.json({ members: [{ id: 'hidden', user: { name: 'Masked name', email: 'private@example.test' } }], total: 1 }) }) as typeof fetch
  const screen = { dir: 'ltr', screen: { kayan: { user: { fields: [] } } }, client: async (call: any) => { calls.push(call); return { docs: [{ id: 'hidden' }, { id: 'visible', name: 'Allowed name' }] } } }
  try {
    await withEditor({ policy: { features: ['mentions'], fonts: ['sans'] }, screen, run: async ({ editor }) => {
      await act(async () => editor.update(() => { $getRoot().selectEnd().insertText('@name') }))
      await act(async () => sleep(250))
      await act(async () => sleep(20))
      assert.equal(providerCalls, 0, 'the provider roster bypasses managed row and field gates')
      assert.deepEqual(calls, [{ kayan: 'user', operation: 'find', input: { limit: 20, depth: 1, where: { name: { like: 'name' } } } }])
      const menu = window.document.querySelector('[role="listbox"][aria-label="Mention a record"]')!
      assert.ok(menu.textContent?.includes('Allowed name'), menu.outerHTML)
      assert.equal(menu.id, 'typeahead-menu')
      assert.equal(menu.querySelector('[role="option"]')?.id, 'typeahead-item-0')
      assert.equal(window.document.getElementById('policy-editor')?.getAttribute('aria-controls'), menu.id)
      assert.ok(!menu.textContent?.includes('Masked name'))
    } })
  } finally { globalThis.fetch = fetchBefore }
})


test('mention searches use the current locale column of a localized title', async () => {
  const calls: any[] = []
  const screen = { dir: 'rtl', screen: { kayan: { tags: { fields: [{ name: 'name', kind: 'text', rules: { localized: true } }] } } }, client: async (call: any) => { calls.push(call); return { docs: [{ id: 'tag', name: { ar: 'وسم', en: 'Tag' } }] } } }
  await withEditor({ policy: { features: ['mentions'], fonts: ['sans'], mentionSources: [{ kayan: 'tags', title: 'name' }] }, screen, locale: 'ar', run: async ({ editor }) => {
    await act(async () => editor.update(() => { $getRoot().selectEnd().insertText('@وسم') }))
    await act(async () => sleep(250))
      await act(async () => sleep(20))
    assert.deepEqual(calls, [{ kayan: 'tags', operation: 'find', input: { limit: 20, depth: 1, where: { 'name.ar': { like: 'وسم' } } } }])
    assert.ok(window.document.querySelector('[role="listbox"][aria-label="Mention a record"]')?.textContent?.includes('وسم'))
  } })
})


test('find action buttons keep native Enter activation while inputs navigate matches', async () => {
  const value = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'old old' }] }] } }
  await withEditor({ value, policy: { features: ['findReplace'], fonts: ['sans'] }, run: async ({ editor, host }) => {
    await act(async () => click([...host.querySelectorAll('button')].find((button) => button.textContent === 'Find and replace')!))
    const panel = host.querySelector('[role="region"]')!
    const [find, replace] = panel.querySelectorAll('input')
    await act(async () => { type(find!, 'old'); type(replace!, 'new') })
    for (const label of ['Replace', 'Replace all', 'Close']) {
      const button = [...panel.querySelectorAll('button')].find((one) => one.textContent === label)!
      const key = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      await act(async () => button.dispatchEvent(key as unknown as Event))
      assert.equal(key.defaultPrevented, false, `${label} can activate from Enter`)
    }
    const navigate = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await act(async () => find!.dispatchEvent(navigate as unknown as Event))
    assert.equal(navigate.defaultPrevented, true)
    await act(async () => click([...panel.querySelectorAll('button')].find((one) => one.textContent === 'Replace all')!))
    assert.equal(editor.getEditorState().read(() => $getRoot().getTextContent()), 'new new')
  } })
})


test('pasting strips foreign comment marks and disallowed mentions while retaining their words', async () => {
  const { PASTE_COMMAND } = await import('lexical')
  const own = '11111111-1111-4111-8111-111111111111'
  const foreign = '22222222-2222-4222-8222-222222222222'
  const text = (text: string) => ({ type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '' })
  const mark = (id: string, words: string) => ({ type: 'mark', version: 1, ids: [id], children: [text(words)], format: '', indent: 0, direction: null })
  const value = { root: { type: 'root', children: [{ type: 'paragraph', children: [mark(own, 'Existing')] }] } }
  const policy: RichTextPolicy = { features: ['comments', 'mentions'], fonts: ['sans'], comments: { threads: 'threads' }, mentionSources: [{ kayan: 'tags', title: 'name' }] }
  await withEditor({ value, policy, run: async ({ editor, changes }) => {
    const transfer = new window.DataTransfer()
    transfer.setData('application/x-lexical-editor', JSON.stringify({ namespace: 'MithaqRichText', nodes: [{ type: 'paragraph', version: 1, format: '', indent: 0, direction: null, children: [mark(foreign, 'Foreign words'), mark(own, 'Own words'), { ...text('@Person'), type: 'mention', kayan: 'user', id: 'person', name: 'Person' }, { ...text('@Tag'), type: 'mention', kayan: 'tags', id: 'tag', name: 'Tag' }] }] }))
    await act(async () => editor.update(() => { $getRoot().selectEnd(); editor.dispatchCommand(PASTE_COMMAND, new window.ClipboardEvent('paste', { clipboardData: transfer }) as unknown as ClipboardEvent) }))
    const saved = changes.at(-1)!
    const json = JSON.stringify(saved)
    assert.ok(!json.includes(foreign), 'a foreign record or field thread cannot enter this document')
    assert.ok(json.includes(own), 'pasting within this field keeps its existing thread')
    assert.ok(!json.includes('"kayan":"user"'), 'a mention outside this field sources becomes text')
    assert.ok(json.includes('"kayan":"tags"'))
    assert.equal(richTextFeatureGuard({ node: saved.root, policy }), undefined)
    assert.match(editor.getEditorState().read(() => $getRoot().getTextContent()), /Foreign wordsOwn words@Person@Tag/)
  } })
})


test('Lexical full-width, Persian and Japanese hashtags satisfy the server policy', async () => {
  const policy: RichTextPolicy = { features: ['mentions'], fonts: ['sans'] }
  await withEditor({ policy, run: async ({ editor, changes }) => {
    await act(async () => editor.update(() => { $getRoot().selectEnd().insertText('＃مرحبا #می\u200cخواهم #〃 #۞') }))
    const saved = changes.at(-1)!
    assert.deepEqual(saved.root.children[0]!.children!.filter((node) => node.type === 'hashtag').map((node) => node.text), ['＃مرحبا', '#می\u200cخواهم', '#〃', '#۞'])
    assert.equal(richTextFeatureGuard({ node: saved.root, policy }), undefined)
  } })
})


test('stored content past a narrowed policy is drawn read-only and never sent, even where the editor registers its node, while a pasted table is still cleaned', async () => {
  const { TableNode, TableRowNode, TableCellNode } = await import('@lexical/table')
  const text = (words: string, format = 0) => ({ type: 'text', version: 1, text: words, format, detail: 0, mode: 'normal', style: '' })
  const block = (type: string, children: object[], extra = {}) => ({ type, version: 1, direction: null, format: '', indent: 0, children, ...extra })
  const cell = (words: string) => block('tablecell', [block('paragraph', [text(words)])], { headerState: 0, colSpan: 1, rowSpan: 1 })
  const stored = (...children: object[]) => ({ root: block('root', children) })
  const withTables = [...installed.nodes, TableNode, TableRowNode, TableCellNode]
  const cases = [
    ['a table', stored(block('table', [block('tablerow', [cell('kept'), cell('whole')])])), withTables],
    ['a quote', stored(block('quote', [text('kept whole')])), installed.nodes],
    ['an italic run', stored(block('paragraph', [text('kept whole', 2)])), installed.nodes],
    ['a centered paragraph', stored(block('paragraph', [text('kept whole')], { format: 'center' })), installed.nodes],
    ['a styled run, which no policy allows', stored(block('paragraph', [{ ...text('kept whole'), style: 'color: red' }])), installed.nodes],
  ] as const
  for (const [what, value, nodes] of cases) {
    const host = mount()
    const root = createRoot(host)
    const changes: unknown[] = []
    try {
      await act(async () => root.render(createElement(RichTextContext, { value: installed }, createElement(RichTextEditor, { value: structuredClone(value), nodes, policy: { features: ['bold'], fonts: ['sans'] }, onChange: (next) => changes.push(next), direction: 'ltr', t, locale: 'en', id: 'narrowed' }))))
      await act(async () => sleep(100))
      assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /no longer allows/, `${what}: the field says why it cannot be changed`)
      assert.equal(host.querySelectorAll('[contenteditable]').length, 0, `${what}: no editor is mounted over it`)
      assert.ok(host.textContent?.includes('kept') && host.textContent.includes('whole'), `${what}: its words are shown`)
      assert.equal(changes.length, 0, `${what}: nothing is sent, so a save leaves it as it is`)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
  // The paste case above covers cleaning; this one pastes the same table into the same narrowed field.
  await withEditor({ policy: { features: ['bold'], fonts: ['sans'] }, run: async ({ editor, changes }) => {
    await act(async () => editor.update(() => {
      const dom = new window.DOMParser().parseFromString('<table><tr><td>pasted</td></tr></table>', 'text/html')
      $getRoot().select().insertNodes($generateNodesFromDOM(editor, dom as unknown as Document))
    }))
    await act(async () => sleep(20))
    assert.ok(changes.length, 'the paste is sent')
    assert.ok(!JSON.stringify(changes.at(-1)).includes('"table"'), 'as cleaned text')
    assert.match(JSON.stringify(changes.at(-1)), /pasted/)
  } })
})


test('a stored node at a newer JSON version than its class reads is drawn read-only, said by name, and never sent', async () => {
  const { RichTextViewer } = await import('../registry/rich-text-viewer.tsx')
  const value = { root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'heading', tag: 'h2', version: 2, direction: null, format: '', indent: 0, addedLater: 'kept', children: [{ type: 'text', version: 1, text: 'Newer heading', format: 0, detail: 0, mode: 'normal', style: '' }] }] } }
  for (const element of [
    (changes: unknown[]) => createElement(RichTextEditor, { value: structuredClone(value), onChange: (next) => changes.push(next), direction: 'ltr', t, locale: 'en', id: 'newer' }),
    () => createElement(RichTextViewer, { value: structuredClone(value), direction: 'ltr', t, id: 'newer' }),
  ]) {
    const host = mount()
    const root = createRoot(host)
    const changes: unknown[] = []
    try {
      await act(async () => root.render(createElement(RichTextContext, { value: installed }, element(changes))))
      await act(async () => sleep(100))
      assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /newer "heading" node/)
      assert.equal(host.querySelectorAll('[contenteditable]').length, 0, 'no editor is mounted over it')
      assert.ok(host.textContent?.includes('Newer heading'), 'its words are shown')
      assert.equal(changes.length, 0, 'and nothing is sent')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
})

test('stored merged table cells survive opening, editing another paragraph and saving', async () => {
  const text = (words: string) => ({ type: 'text', version: 1, text: words, format: 0, detail: 0, mode: 'normal', style: '' })
  const block = (type: string, children: object[], extra = {}) => ({ type, version: 1, direction: null, format: '', indent: 0, children, ...extra })
  const cell = (words: string, extra = {}) => block('tablecell', [block('paragraph', [text(words)])], { headerState: 0, colSpan: 1, rowSpan: 1, ...extra })
  const table = block('table', [block('tablerow', [cell('Across', { colSpan: 2 }), cell('Down', { rowSpan: 2 })]), block('tablerow', [cell('One'), cell('Two')])])
  const value = { root: block('root', [block('paragraph', [text('Elsewhere')]), table]) }
  const { nodes } = await import('../registry/rich-text-tables.tsx')
  const { createEditor } = await import('lexical')
  const expected = JSON.parse(JSON.stringify(createEditor({ nodes }).parseEditorState(JSON.stringify(value)).toJSON())).root.children[1]
  await withEditor({ value, policy: { features: ['tables'], fonts: ['sans'] }, run: async ({ editor, changes }) => {
    await act(async () => editor.update(() => { $getRoot().getAllTextNodes()[0]!.spliceText(0, 0, 'Edited ') }))
    const saved = changes.at(-1)!
    assert.deepEqual(saved.root.children[1], expected)
    assert.equal(richText({ nodes: [...defaultNodes, ...nodes], features: ['tables'] }).kinds.richText.targets.zod().safeParse(saved).success, true)
  } })
})
