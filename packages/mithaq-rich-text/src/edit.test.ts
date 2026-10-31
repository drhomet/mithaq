import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { fromRuns, modelApply, toRuns } from './__fixtures__/model.ts'
import { applyEdit, type Edit } from './edit.ts'
import { validateRuns, type Runs } from './runs.ts'

const unit = ({ start, id, placement = 'inline' }: { start: number; id: string; placement?: 'inline' | 'paragraph' }) => ({ start, end: start + 1, id, placement, preview: `Locked ${id}` })

describe('edits around and across locked units', () => {
  // "ab" + unit + "cd", then a paragraph unit, then a bullet.
  const base: Runs = {
    text: 'ab￼cd\n￼\nlast',
    marks: [{ start: 0, end: 2, format: 1 }],
    paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }, { start: 6, kind: 'p', dir: 'auto' }, { start: 8, kind: 'bullet', dir: 'rtl' }],
    locked: [unit({ start: 2, id: 'u1' }), unit({ start: 6, id: 'u2', placement: 'paragraph' })],
  }
  const refused = (edit: Edit) => {
    const before = structuredClone(base)
    assert.deepEqual(applyEdit(base, edit), { ok: false, reason: 'locked-content' })
    assert.deepEqual(base, before)
  }
  const ok = (edit: Edit) => {
    const result = applyEdit(base, edit)
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(edit)}`)
    assert.equal(validateRuns(result.runs), result.runs)
    assert.deepEqual(result.runs.locked.map((u) => u.id), ['u1', 'u2'])
    return result.runs
  }

  test('backspace and delete next to a unit, cut across it, and select-all replacement are refused', () => {
    refused({ type: 'replace', start: 2, end: 3, text: '' })
    refused({ type: 'replace', start: 1, end: 4, text: '' })
    refused({ type: 'replace', start: 0, end: base.text.length, text: 'new' })
    refused({ type: 'replace', start: 6, end: 8, text: '' })
  })

  test('pasting over a unit, and replacing one, are refused; a pasted U+FFFC is stripped, never a unit', () => {
    refused({ type: 'replace', start: 2, end: 3, text: 'pasted' })
    const typed = ok({ type: 'replace', start: 1, end: 1, text: 'x￼y' })
    assert.equal(typed.text, 'axyb￼cd\n￼\nlast')
  })

  test('formatting a selection that crosses a unit is refused, and formatting beside it is not', () => {
    refused({ type: 'toggle', start: 1, end: 4, format: 2 })
    refused({ type: 'toggle', start: 2, end: 3, format: 2 })
    assert.deepEqual(ok({ type: 'toggle', start: 3, end: 5, format: 2 }).marks, [{ start: 0, end: 2, format: 1 }, { start: 3, end: 5, format: 2 }])
  })

  test('paragraph kind and direction commands on a paragraph unit are refused, on its neighbours not', () => {
    refused({ type: 'kind', from: 1, to: 1, kind: 'bullet' })
    refused({ type: 'dir', from: 0, to: 2, dir: 'ltr' })
    assert.equal(ok({ type: 'kind', from: 0, to: 0, kind: 'h2' }).paragraphs[0]!.kind, 'h2')
  })

  test('typing at an inline boundary lands outside the unit and shifts it', () => {
    const before = ok({ type: 'replace', start: 2, end: 2, text: 'XY' })
    assert.equal(before.text.slice(0, 5), 'abXY￼')
    assert.equal(before.locked[0]!.start, 4)
    const after = ok({ type: 'replace', start: 3, end: 3, text: 'Z' })
    assert.equal(after.locked[0]!.start, 2)
    assert.ok(after.text.startsWith('ab￼Zcd'))
  })

  test('a paragraph unit takes no text, but a new paragraph can open before or after it', () => {
    refused({ type: 'replace', start: 6, end: 6, text: 'typed' })
    refused({ type: 'replace', start: 7, end: 7, text: 'typed' })
    const opened = ok({ type: 'replace', start: 6, end: 6, text: '\n' })
    assert.deepEqual(opened.paragraphs.map((p) => p.start), [0, 6, 7, 9])
    assert.deepEqual(opened.locked[1], unit({ start: 7, id: 'u2', placement: 'paragraph' }))
    const after = ok({ type: 'replace', start: 7, end: 7, text: '\ntext' })
    assert.equal(after.text, 'ab￼cd\n￼\ntext\nlast')
  })

  test('joining paragraphs around a unit succeeds when the unit stays alone, and is refused when it would not', () => {
    const joined = applyEdit({ ...base, text: 'ab￼cd\n\n￼\nlast', paragraphs: [base.paragraphs[0]!, { start: 6, kind: 'p', dir: 'auto' }, { start: 7, kind: 'p', dir: 'auto' }, { start: 9, kind: 'bullet', dir: 'rtl' }], locked: [unit({ start: 2, id: 'u1' }), unit({ start: 7, id: 'u2', placement: 'paragraph' })] }, { type: 'replace', start: 6, end: 7, text: '' })
    assert.ok(joined.ok)
    assert.equal(joined.runs.text, 'ab￼cd\n￼\nlast')
    refused({ type: 'replace', start: 5, end: 6, text: '' }) // cd + unit paragraph
    refused({ type: 'replace', start: 7, end: 8, text: '' }) // unit paragraph + bullet
  })
})

for (const kind of ['bullet', 'number', 'h2', 'h3', 'p'] as const) {
  test(`deleting an empty ${kind} before a paragraph unit keeps the unit’s own paragraph`, () => {
    const runs: Runs = {
      text: '\n￼', marks: [],
      paragraphs: [{ start: 0, kind, dir: 'rtl' }, { start: 1, kind: 'p', dir: 'auto' }],
      locked: [unit({ start: 1, id: 'u1', placement: 'paragraph' })],
    }
    const edit: Edit = { type: 'replace', start: 0, end: 1, text: '' }
    const expected: Runs = { text: '￼', marks: [], paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }], locked: [unit({ start: 0, id: 'u1', placement: 'paragraph' })] }
    assert.deepEqual(applyEdit(runs, edit), { ok: true, runs: expected })
    const modeled = modelApply(fromRuns(runs), edit)
    assert.ok(modeled)
    assert.deepEqual(toRuns(modeled), expected)
  })
}
