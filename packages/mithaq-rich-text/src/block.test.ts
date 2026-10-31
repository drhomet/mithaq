import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { block, editable, inline, jsonOf, plain, withInline, type Json } from './__fixtures__/fixtures.ts'
import { LockedTable, loadBlock, saveBlock } from './block.ts'
import { createRunsEditor, nodesToPlainText, runsToNodes } from './codec.ts'
import { applyEdit } from './edit.ts'
import { defaultNodeRegistry, runsCodecTypes } from './registry.ts'
import { plainText } from './runs.ts'

const open = (children: Json[]) => {
  const editor = createRunsEditor()
  const table = new LockedTable()
  const runs = loadBlock({ editor, children, table })
  return { editor, table, runs }
}

describe('a Block of stored JSON opens as runs and saves back unchanged', () => {
  test('supported nodes open with no locked unit and save deep-equal', () => {
    const children = [...plain('Problem one plan text'), ...plain('مرحبا', { dir: 'rtl' })]
    const { editor, table, runs } = open(children)
    assert.deepEqual(runs.locked, [])
    assert.equal(runs.text, 'Problem one plan text\nمرحبا')
    assert.deepEqual(saveBlock(editor, table), children)
  })

  test('a stored quote and a horizontal rule between paragraphs open editable, with no locked entry, and save deep-equal', () => {
    const children = [...plain('Above'), editable.quote!, editable.rule!, editable.rule!, ...plain('Below'), editable.rule!]
    const { editor, table, runs } = open(children)
    assert.deepEqual(runs.locked, [])
    assert.equal(runs.text, 'Above\nQuoted plan text مرحبا\n\uFFFC\n\uFFFC\nBelow\n\uFFFC')
    assert.deepEqual(runs.paragraphs.map((p) => [p.kind, p.dir]), [['p', 'auto'], ['quote', 'rtl'], ['divider', 'auto'], ['divider', 'auto'], ['p', 'auto'], ['divider', 'auto']])
    assert.deepEqual(runs.marks, [{ start: 22, end: 28, format: 1 }])
    assert.equal(plainText(runs), 'Above\nQuoted plan text مرحبا\n\n\nBelow\n')
    assert.equal(nodesToPlainText(editor), plainText(runs))
    assert.deepEqual(saveBlock(editor, table), children)
  })

  test('a link inside a quote is an inline unit and the quote stays editable', () => {
    const quote = { ...editable.quote!, children: [...(editable.quote!.children as Json[]), inline.link] } as Json
    const { editor, table, runs } = open([quote])
    assert.deepEqual(runs.locked.map((u) => u.placement), ['inline'])
    assert.deepEqual(runs.paragraphs.map((p) => p.kind), ['quote'])
    assert.deepEqual(saveBlock(editor, table), [quote])
  })

  test('an inline link amid editable text is one inline unit, and saves as the original link', () => {
    const children = [withInline({ before: 'see ', units: [inline.link], after: ' now' })]
    const { editor, table, runs } = open(children)
    assert.equal(runs.text, 'see \uFFFC now')
    assert.deepEqual(runs.locked, [{ start: 4, end: 5, id: 'u1', placement: 'inline', preview: 'Test link' }])
    assert.deepEqual(saveBlock(editor, table), children)
  })
})

describe('what the phone cannot edit is locked whole and comes back untouched', () => {
  for (const name of Object.keys(block)) test(`${name} is one paragraph unit between editable paragraphs`, () => {
    const children = [...plain('Test Patient A'), block[name]!, ...plain('Problem one plan text')]
    const { editor, table, runs } = open(children)
    assert.equal(runs.text, `Test Patient A\n\uFFFC\nProblem one plan text`)
    assert.deepEqual(runs.locked.map(({ start, end, placement }) => ({ start, end, placement })), [{ start: 15, end: 16, placement: 'paragraph' }])
    assert.equal(runs.paragraphs.length, 3)
    assert.deepEqual(saveBlock(editor, table), children)
  })

  test('a unit nested inside an unsupported container is represented by the outermost one', () => {
    const { runs, table } = open([block.nestedList!, block.table!])
    assert.deepEqual(runs.locked.map((u) => u.id), ['u1', 'u2'])
    assert.equal(table.units.size, 2)
  })

  test('unknown inline types, links and line breaks are inline units; adjacent ones keep their order with text on both sides', () => {
    const children = [withInline({ before: 'left ', units: [inline.link, inline.unknown, inline.lineBreak], after: ' right' })]
    const { editor, table, runs } = open(children)
    assert.equal(runs.text, 'left \uFFFC\uFFFC\uFFFC right')
    assert.deepEqual(runs.locked.map((u) => [u.id, u.start, u.placement]), [['u1', 5, 'inline'], ['u2', 6, 'inline'], ['u3', 7, 'inline']])
    assert.deepEqual(saveBlock(editor, table), children)
  })

  test('stored text holding U+FFFC or a newline is an inline unit, so no raw placeholder or break reaches the runs', () => {
    const children = [withInline({ before: 'a ', units: [inline.placeholderText, inline.newlineText], after: ' b' })]
    const { editor, table, runs } = open(children)
    assert.equal(runs.text, 'a \uFFFC\uFFFC b')
    assert.equal(runs.paragraphs.length, 1)
    assert.deepEqual(saveBlock(editor, table), children)
  })

  test('a unit in a list item stays inside its item', () => {
    const [list] = plain('x', { kind: 'bullet' }) as [Json]
    const item = (list.children as Json[])[0] as Json
    item.children = [{ type: 'text', version: 1, detail: 0, format: 0, mode: 'normal', style: '', text: 'item ' } as Json, inline.link as unknown as Json]
    const { editor, table, runs } = open([list])
    assert.equal(runs.text, 'item \uFFFC')
    assert.deepEqual(runs.paragraphs.map((p) => p.kind), ['bullet'])
    assert.deepEqual(runs.locked.map((u) => u.placement), ['inline'])
    assert.deepEqual(saveBlock(editor, table), [list])
  })

  test('a table inside a list item is an inline unit: the item stays editable and the table saves intact', () => {
    const [list] = plain('x', { kind: 'bullet' }) as [Json]
    const item = (list.children as Json[])[0] as Json
    item.children = [...(item.children as Json[]), block.table!]
    const { editor, table, runs } = open([list])
    assert.equal(runs.text, 'x\uFFFC')
    assert.deepEqual(runs.locked.map((u) => u.placement), ['inline'])
    assert.deepEqual(saveBlock(editor, table), [list])
  })

  test('two touching lists of one kind do not merge: the later one is locked', () => {
    const children = [...plain('a', { kind: 'bullet' }), ...plain('b', { kind: 'bullet' })]
    const { editor, table, runs } = open(children)
    assert.deepEqual(runs.locked.map((u) => u.placement), ['paragraph'])
    assert.deepEqual(saveBlock(editor, table), children)
  })

  test('the Block envelope is the caller’s: its fields come back with the children', () => {
    const envelope = { type: 'problem', version: 1, problemId: 'test-problem-1', carriedFrom: null, reviewed: true, children: [...plain('Problem one plan text'), block.table!] }
    const { editor, table } = open(envelope.children)
    assert.deepEqual({ ...envelope, children: saveBlock(editor, table) }, envelope)
  })
})

// A host's textFormat and textStyle are Lexical's memory of the caret's typing format, not content,
// and Lexical 0.52 writes them only on empty elements. Runs cannot carry them, so a host the phone
// did not touch gets its stored keys back; a host it edited saves them as Lexical rebuilds them.
test('opening and saving with no edit changes nothing, typing state on hosts with text included', () => {
  const [paragraph] = plain('Problem one plan text') as [Json]
  const [heading] = plain('Plan', { kind: 'h2' }) as [Json]
  const [list] = jsonOf({ text: 'one\ntwo', marks: [], paragraphs: [{ start: 0, kind: 'bullet', dir: 'auto' }, { start: 4, kind: 'bullet', dir: 'auto' }], locked: [] }) as [Json]
  const items = list.children as Json[]
  const children = [
    { ...paragraph, textFormat: 1, textStyle: 'color: red' },
    { ...heading, textFormat: 2, textStyle: 'color: blue' },
    { ...list, children: [{ ...items[0]!, textFormat: 1, textStyle: 'color: red' }, { ...items[1]!, textFormat: 8 }] },
  ]
  const { editor, table, runs } = open(children)
  assert.deepEqual(runs.locked, [])
  assert.deepEqual(saveBlock(editor, table), children)
  runsToNodes(editor, runs)
  assert.deepEqual(saveBlock(editor, table), children, 'rebuilding unchanged runs touches no host')
  const edited = applyEdit(runs, { type: 'replace', start: 0, end: 0, text: 'New ' })
  assert.ok(edited.ok)
  runsToNodes(editor, edited.runs)
  const [first, ...rest] = saveBlock(editor, table)
  assert.deepEqual(first, { ...paragraph, textFormat: 0, textStyle: '', children: [{ ...(paragraph.children as Json[])[0]!, text: 'New Problem one plan text' }] })
  assert.deepEqual(rest, children.slice(1), 'hosts the edit did not touch keep their typing state')
})

for (const field of ['textStyle', 'textFormat']) test(`unknown ${field} on a TextNode locks its paragraph and survives save`, () => {
  const [paragraph] = plain('Problem one plan text') as [Json]
  const [text] = paragraph.children as Json[]
  const children = [{ ...paragraph, children: [{ ...text, [field]: 'future-metadata' }] }]
  const { editor, table, runs } = open(children)
  assert.deepEqual(runs.locked.map((u) => u.placement), ['paragraph'])
  assert.deepEqual(saveBlock(editor, table), children)
})

test('a stored locked-unit is unknown payload and cannot reuse a session id', () => {
  const children = [{ type: 'locked-unit', version: 1, id: 'u1', placement: 'paragraph' } as Json, block.table!]
  const { editor, table, runs } = open(children)
  assert.deepEqual(runs.locked.map((u) => u.id), ['u1', 'u2'])
  assert.equal(table.units.size, 2)
  assert.deepEqual(saveBlock(editor, table), children)
})

test('loadBlock takes its editor, document and table in one object', () => {
  const editor = createRunsEditor()
  const table = new LockedTable()
  const children = plain('Problem one plan text')
  const runs = loadBlock({ editor, children, table })
  assert.equal(runs.text, 'Problem one plan text')
  assert.deepEqual(saveBlock(editor, table), children)
})


test('web linebreaks and tabs preview as whitespace and remain locked', () => {
  const children = [withInline({ before: 'one', units: [inline.lineBreak, { type: 'tab', version: 1 }], after: 'two' })]
  const { editor, table, runs } = open(children)
  assert.deepEqual(runs.locked.map((u) => u.preview), ['\n', ' '])
  assert.equal(plainText(runs), 'one\n two')
  assert.equal(nodesToPlainText(editor), 'one\n two')
  assert.deepEqual(applyEdit(runs, { type: 'replace', start: 3, end: 5, text: '' }), { ok: false, reason: 'locked-content' })
  assert.deepEqual(saveBlock(editor, table), children)
})

test('adjacent normal text with identical formatting joins without locking', () => {
  const [paragraph] = plain('onetwo') as [Json]
  const [text] = paragraph.children as Json[]
  const merged = { ...text, format: 1, text: 'onetwo' }
  const children = [{ ...paragraph, textFormat: 1, children: [{ ...merged, text: 'one' }, { ...merged, text: 'two' }] }]
  const { editor, table, runs } = open(children)
  assert.deepEqual(runs.locked, [])
  assert.equal(runs.text, 'onetwo')
  assert.deepEqual(runs.marks, [{ start: 0, end: 6, format: 1 }])
  assert.deepEqual(saveBlock(editor, table), [{ ...paragraph, textFormat: 1, children: [merged] }])
})

// Lexical 0.52 also keeps the caret's typing state on a heading and a list item, so pressing bold in
// an empty web bullet must not make its list read-only on the phone.
for (const kind of ['h2', 'bullet'] as const) test(`a ${kind}’s caret typing state does not lock it, and is rebuilt once the phone edits it`, () => {
  const [node] = plain('', { kind }) as [Json]
  const typed = structuredClone(node)
  Object.assign((kind === 'bullet' ? (typed.children as Json[])[0] : typed) as Json, { textFormat: 1, textStyle: 'color: red' })
  const { editor, table, runs } = open([typed])
  assert.deepEqual(runs.locked, [])
  assert.deepEqual(saveBlock(editor, table), [typed], 'opening alone changes nothing')
  const edited = applyEdit(runs, { type: 'replace', start: 0, end: 0, text: 'x' })
  assert.ok(edited.ok)
  runsToNodes(editor, edited.runs)
  assert.deepEqual(saveBlock(editor, table), plain('x', { kind }))
})

test('loadBlock hands native only runs that pass validateRuns, whatever its editor parsed', () => {
  const editor = createRunsEditor()
  const parse = editor.parseEditorState.bind(editor)
  // Stands in for a class that normalizes a unit into text: the placeholder survives, the unit does not.
  editor.parseEditorState = ((json: unknown) => parse(JSON.stringify(json).replace(/\{"type":"locked-unit"[^}]*\}/, '{"type":"text","version":1,"detail":0,"format":0,"mode":"normal","style":"","text":"\\uFFFC"}'))) as typeof editor.parseEditorState
  const children = [withInline({ before: 'see ', units: [inline.link], after: ' now' })]
  assert.throws(() => loadBlock({ editor, children, table: new LockedTable() }), /Invalid runs: a placeholder that is no locked unit/)
})

test('the codec carries exactly the registry’s runsCodecTypes, and every other registered type opens locked and saves unchanged', () => {
  const rows = ['p', 'h2', 'h3', 'bullet', 'number', 'quote'] as const
  const children = [...rows.flatMap((kind) => plain('Problem one plan text', { kind })), editable.rule!]
  const { editor, table, runs } = open(children)
  assert.deepEqual(runs.locked, [])
  const types = new Set(['root'])
  const walk = (node: Json) => { types.add(node.type); (node.children as Json[] | undefined)?.forEach(walk) }
  saveBlock(editor, table).forEach(walk)
  assert.deepEqual([...types].sort(), [...runsCodecTypes].sort())
  for (const { type } of defaultNodeRegistry.filter(({ type }) => !runsCodecTypes.includes(type))) {
    const node = { type, version: 1, children: [] } as Json
    const opened = open([node])
    assert.deepEqual(opened.runs.locked.map((u) => u.placement), ['paragraph'], type)
    assert.deepEqual(saveBlock(opened.editor, opened.table), [node], type)
  }
})
