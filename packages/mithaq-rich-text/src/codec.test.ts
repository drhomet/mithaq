import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createRunsEditor, nodesToPlainText, nodesToRuns, runsToNodes } from './codec.ts'
import { plainText, type Runs } from './runs.ts'

const roundTrip = (runs: Runs) => {
  const editor = createRunsEditor()
  runsToNodes(editor, runs)
  return nodesToRuns(editor)
}

test('one plain paragraph survives runs → nodes → runs', () => {
  const runs: Runs = { text: 'Problem one plan text', marks: [], paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }], locked: [] }
  assert.deepEqual(roundTrip(runs), runs)
})

test('each of the eleven formats and their mixes survive, with marks that never cross a paragraph break', () => {
  const runs: Runs = {
    text: 'bold italic both\nstrike under mark\ncode H2O x2 low UP word',
    marks: [
      { start: 0, end: 4, format: 1 },
      { start: 5, end: 11, format: 2 },
      { start: 11, end: 16, format: 1 | 2 },
      { start: 17, end: 23, format: 4 },
      { start: 24, end: 29, format: 8 | 128 },
      { start: 35, end: 39, format: 16 },
      { start: 41, end: 42, format: 32 },
      { start: 45, end: 46, format: 64 },
      { start: 47, end: 50, format: 256 },
      { start: 51, end: 53, format: 512 | 1 },
      { start: 54, end: 58, format: 1024 },
    ],
    paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }, { start: 17, kind: 'p', dir: 'auto' }, { start: 35, kind: 'p', dir: 'auto' }],
    locked: [],
  }
  assert.deepEqual(roundTrip(runs), runs)
})

// Builds runs from paragraphs so the test never counts offsets by hand.
const build = (rows: [Runs['paragraphs'][number]['kind'], Runs['paragraphs'][number]['dir'], string][], marks: Runs['marks'] = []): Runs => {
  let at = 0
  const paragraphs = rows.map(([kind, dir, text]) => {
    const p = { start: at, kind, dir }
    at += text.length + 1
    return p
  })
  return { text: rows.map((r) => r[2]).join('\n'), marks, paragraphs, locked: [] }
}

test('paragraph kinds and directions survive, lists group by kind, and empty paragraphs stay', () => {
  const runs = build(
    [
      ['h2', 'ltr', 'Heading'],
      ['p', 'auto', ''],
      ['p', 'rtl', 'مرحبا بالعالم'],
      ['bullet', 'auto', 'first'],
      ['bullet', 'ltr', 'second'],
      ['bullet', 'auto', ''],
      ['number', 'auto', 'step one'],
      ['number', 'rtl', 'step two'],
      ['h3', 'auto', 'sub'],
      ['p', 'auto', 'plain'],
    ],
    [{ start: 9, end: 14, format: 1 }],
  )
  assert.deepEqual(roundTrip(runs), runs)
})

test('two bullet lists with another kind between them stay two lists', () => {
  const runs: Runs = {
    text: 'a\nb\nc',
    marks: [],
    paragraphs: [{ start: 0, kind: 'bullet', dir: 'auto' }, { start: 2, kind: 'number', dir: 'auto' }, { start: 4, kind: 'bullet', dir: 'auto' }],
    locked: [],
  }
  const editor = createRunsEditor()
  runsToNodes(editor, runs)
  assert.deepEqual(editor.getEditorState().toJSON().root.children.map((c) => c.type), ['list', 'list', 'list'])
  assert.deepEqual(nodesToRuns(editor), runs)
})

test('plain text from the nodes equals the runs’ plain text: paragraphs joined by one newline, previews for units, no markers', () => {
  const runs: Runs = {
    text: 'one ￼ two\nمرحبا\n￼\n\nlast',
    marks: [],
    paragraphs: [{ start: 0, kind: 'bullet', dir: 'auto' }, { start: 10, kind: 'bullet', dir: 'rtl' }, { start: 16, kind: 'p', dir: 'auto' }, { start: 18, kind: 'number', dir: 'auto' }, { start: 19, kind: 'number', dir: 'auto' }],
    locked: [
      { start: 4, end: 5, id: 'u1', placement: 'inline', preview: 'Test link' },
      { start: 16, end: 17, id: 'u2', placement: 'paragraph', preview: 'Test table' },
    ],
  }
  const editor = createRunsEditor()
  runsToNodes(editor, runs)
  assert.equal(nodesToPlainText(editor), 'one Test link two\nمرحبا\nTest table\n\nlast')
  assert.equal(nodesToPlainText(editor), plainText(runs))
})

const unit = ({ start, id, placement = 'inline' }: { start: number; id: string; placement?: 'inline' | 'paragraph' }) => ({ start, end: start + 1, id, placement, preview: `Locked ${id}` })

describe('locked units in runs', () => {
  test('inline units between editable text, adjacent to each other, survive runs → nodes → runs', () => {
    const runs: Runs = {
      text: 'before ￼￼ after\nمرحبا ￼',
      marks: [{ start: 0, end: 6, format: 1 }, { start: 10, end: 15, format: 2 }],
      paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }, { start: 16, kind: 'bullet', dir: 'rtl' }],
      locked: [unit({ start: 7, id: 'u1' }), unit({ start: 8, id: 'u2' }), unit({ start: 22, id: 'u3' })],
    }
    assert.deepEqual(roundTrip(runs), runs)
  })

  test('a paragraph unit sits between lists and stays a paragraph of its own', () => {
    const runs: Runs = {
      text: 'one\n￼\ntwo',
      marks: [],
      paragraphs: [{ start: 0, kind: 'bullet', dir: 'auto' }, { start: 4, kind: 'p', dir: 'auto' }, { start: 6, kind: 'bullet', dir: 'auto' }],
      locked: [unit({ start: 4, id: 'u1', placement: 'paragraph' })],
    }
    const editor = createRunsEditor()
    runsToNodes(editor, runs)
    assert.deepEqual(editor.getEditorState().toJSON().root.children.map((c) => c.type), ['list', 'locked-unit', 'list'])
    assert.deepEqual(nodesToRuns(editor), runs)
  })

  test('runs holding a placeholder that is no locked unit are refused', () => {
    const editor = createRunsEditor()
    assert.throws(() => runsToNodes(editor, { text: 'a￼b', marks: [], paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }], locked: [] }), /placeholder/i)
  })
})

describe('quotes and dividers', () => {
  const U = '￼'
  test('quote text with marks and direction, consecutive dividers, a divider beside locked units and a final one survive', () => {
    const runs: Runs = {
      text: `قول مقتبس\n${U}\n${U}\n${U}\n${U}\nquoted ${U}\n${U}`,
      marks: [{ start: 0, end: 3, format: 1 }],
      paragraphs: [
        { start: 0, kind: 'quote', dir: 'rtl' }, { start: 10, kind: 'divider', dir: 'auto' }, { start: 12, kind: 'divider', dir: 'auto' },
        { start: 14, kind: 'p', dir: 'auto' }, { start: 16, kind: 'divider', dir: 'auto' }, { start: 18, kind: 'quote', dir: 'ltr' }, { start: 27, kind: 'divider', dir: 'auto' },
      ],
      locked: [unit({ start: 14, id: 'u1', placement: 'paragraph' }), unit({ start: 25, id: 'u2' })],
    }
    const editor = createRunsEditor()
    runsToNodes(editor, runs)
    assert.deepEqual(editor.getEditorState().toJSON().root.children.map((c) => c.type), ['quote', 'horizontalrule', 'horizontalrule', 'locked-unit', 'horizontalrule', 'quote', 'horizontalrule'])
    assert.deepEqual(nodesToRuns(editor), runs)
    assert.equal(nodesToPlainText(editor), 'قول مقتبس\n\n\nLocked u1\n\nquoted Locked u2\n')
    assert.equal(nodesToPlainText(editor), plainText(runs))
  })
})
