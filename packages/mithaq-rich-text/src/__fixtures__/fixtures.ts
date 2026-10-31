// Block JSON for the locked-unit tests. Supported paragraphs come from the codec,
// so their shape is whatever Lexical writes; the unsupported pieces are written by
// hand, because they are the shapes no class of ours may normalize.
import type { SerializedLexicalNode } from 'lexical'
import { createRunsEditor, runsToNodes } from '../codec.ts'
import type { Runs } from '../runs.ts'

export type Json = SerializedLexicalNode & Record<string, unknown>

export const jsonOf = (runs: Runs): Json[] => {
  const editor = createRunsEditor()
  runsToNodes(editor, runs)
  // Stored JSON, as a database returns it: keys Lexical leaves undefined are absent.
  return JSON.parse(JSON.stringify(editor.getEditorState().toJSON().root.children)) as Json[]
}

export const plain = (text: string, extra: Partial<Runs['paragraphs'][number]> = {}): Json[] =>
  jsonOf({ text, marks: [], paragraphs: [{ start: 0, kind: 'p', dir: 'auto', ...extra }], locked: [] })

const text = ({ value, format = 0, extra = {} }: { value: string; format?: number; extra?: object }) => ({ type: 'text', version: 1, detail: 0, format, mode: 'normal', style: '', text: value, ...extra })
const para = (children: object[], extra: object = {}) => ({
  type: 'paragraph', version: 1, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', children, ...extra,
})

// Inline units, to sit inside a paragraph.
export const inline = {
  link: { type: 'link', version: 1, url: 'https://example.invalid/test', rel: null, target: null, title: null, direction: null, format: '', indent: 0, children: [text({ value: 'Test link' })] },
  unknown: { type: 'future-mention', version: 4, userId: 'test-user-a', extra: { nested: [1, 2, 3] } },
  lineBreak: { type: 'linebreak', version: 1 },
  // Stored text that would read as a placeholder or a paragraph break in runs.
  placeholderText: text({ value: 'has \uFFFC inside' }),
  newlineText: text({ value: 'two\nlines' }),
}

// Paragraph units: whole top-level nodes the phone cannot edit.
export const block = {
  table: { type: 'table', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'tablerow', version: 1, children: [{ type: 'tablecell', version: 1, children: [para([text({ value: 'Cell A' })])] }] }] },
  quote: { type: 'quote', version: 1, direction: null, format: '', indent: 0, children: [text({ value: 'Quoted plan text' })] },
  rule: { type: 'horizontalrule', version: 1 },
  unknown: { type: 'callout', version: 2, tone: 'note', children: [para([text({ value: 'Inside the callout' })])] },
  unknownVersion: para([text({ value: 'Version nine' })], { version: 9 }),
  unknownMetadata: para([text({ value: 'Has metadata' })], { clinicLabel: 'test', format: 'center', indent: 2 }),
  unknownFormat: para([text({ value: 'mono', format: 2048 })]),
  styledText: para([text({ value: 'styled', format: 0, extra: { style: 'color: red' } })]),
  nestedList: {
    type: 'list', version: 1, listType: 'bullet', start: 1, tag: 'ul', direction: null, format: '', indent: 0,
    children: [
      { type: 'listitem', version: 1, value: 1, direction: null, format: '', indent: 0, children: [text({ value: 'outer' })] },
      { type: 'listitem', version: 1, value: 2, direction: null, format: '', indent: 0, children: [{ type: 'list', version: 1, listType: 'bullet', start: 1, tag: 'ul', direction: null, format: '', indent: 0, children: [{ type: 'listitem', version: 1, value: 1, direction: null, format: '', indent: 0, children: [text({ value: 'inner' })] }] }] },
    ],
  },
  checkList: { type: 'list', version: 1, listType: 'check', start: 1, tag: 'ul', direction: null, format: '', indent: 0, children: [{ type: 'listitem', version: 1, value: 1, checked: false, direction: null, format: '', indent: 0, children: [text({ value: 'todo' })] }] },
  headingFour: { type: 'heading', version: 1, tag: 'h4', direction: null, format: '', indent: 0, children: [text({ value: 'Too deep' })] },
} as Record<string, Json>

export const withInline = ({ before, units, after }: { before: string; units: object[]; after: string }): Json => {
  const [paragraph] = plain('x') as [Json]
  return { ...paragraph, children: [...(before ? [text({ value: before })] : []), ...units, ...(after ? [text({ value: after })] : [])] } as Json
}
