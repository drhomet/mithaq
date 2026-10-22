import './dom.ts'
import './tsx.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRoot } from 'react-dom/client'
import { mount, window, click, press } from './dom.ts'
import type { RichTextPolicy, RichTextValue } from 'mithaq/rich-text'

const { RichTextEditor } = await import('../registry/rich-text-editor.tsx')
const { defaultNodes, richText, richTextFeatureGuard } = await import('mithaq/rich-text')
const { $getRoot } = await import('lexical')
const { $generateNodesFromDOM } = await import('@lexical/html')
const t = (_key: string, fallback?: string) => fallback
const legacy = JSON.parse(readFileSync(new URL('../../mithaq/src/rich-text/__fixtures__/legacy-formatting-034.json', import.meta.url), 'utf8'))

async function withEditor({ value, policy, run }: { value?: unknown; policy?: RichTextPolicy; run: (args: { editor: import('lexical').LexicalEditor; host: HTMLElement; changes: RichTextValue[] }) => Promise<void> }) {
  const host = mount()
  const root = createRoot(host)
  const changes: RichTextValue[] = []
  try {
    await act(async () => root.render(createElement(RichTextEditor, { value, policy, onChange: (value) => changes.push(value), direction: 'ltr', t, locale: 'en', id: 'policy-editor' })))
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
