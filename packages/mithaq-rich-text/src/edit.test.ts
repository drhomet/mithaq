import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { fromRuns, modelApply, toRuns } from './__fixtures__/model.ts'
import { applyEdit, type Edit } from './edit.ts'
import { validateRuns, type ParagraphKind, type Runs } from './runs.ts'

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

describe('a divider stays alone in its paragraph through every edit', () => {
  const U = '￼'
  const runs = (text: string, kinds: ParagraphKind[], marks: Runs['marks'] = []): Runs => ({
    text, marks, locked: [],
    paragraphs: text.split('\n').map((_, i, all) => ({ start: all.slice(0, i).join('\n').length + (i ? 1 : 0), kind: kinds[i]!, dir: 'auto' as const })),
  })
  // edit.ts and the independent model agree on each case, refusals included.
  const both = (before: Runs, edit: Edit): Runs | null => {
    const result = applyEdit(before, edit)
    const modeled = modelApply(fromRuns(before), edit)
    assert.equal(result.ok, modeled !== null, JSON.stringify(edit))
    if (!result.ok) return null
    assert.deepEqual(result.runs, toRuns(modeled!))
    return validateRuns(result.runs)
  }
  const shape = (r: Runs | null) => r && [r.text, r.paragraphs.map((p) => p.kind).join(' ')]
  const rule = runs(`Above\n${U}\nBelow`, ['p', 'divider', 'h2'])

  test('Backspace below a rule and Delete above it remove the rule as one unit; the paragraph below keeps its kind', () => {
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 7, end: 8, text: '' })), ['Above\nBelow', 'p h2'])
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 5, end: 6, text: '' })), ['Above\nBelow', 'p h2'])
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 5, end: 6, text: 'x' })), ['Abovex\nBelow', 'p h2'])
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 6, end: 7, text: '' })), ['Above\nBelow', 'p h2'])
  })

  test('cutting one of two rules, by either of its breaks or itself, keeps the unselected neighbour', () => {
    const two = runs(`A\n${U}\n${U}\nB`, ['p', 'divider', 'divider', 'h2'])
    for (const [start, end] of [[2, 3], [1, 2], [4, 5]] as const) {
      assert.deepEqual(shape(both(two, { type: 'replace', start, end, text: '' })), [`A\n${U}\nB`, 'p divider h2'], `${start}-${end}`)
    }
    // The break between two rules is beside both, so removing it removes both, as on Android.
    assert.deepEqual(shape(both(two, { type: 'replace', start: 3, end: 4, text: '' })), ['A\n\nB', 'p p h2'])
    const last = runs(`A\n${U}`, ['p', 'divider'])
    assert.deepEqual(shape(both(last, { type: 'replace', start: 2, end: 3, text: '' })), ['A', 'p'])
    assert.deepEqual(shape(both(runs(U, ['divider']), { type: 'replace', start: 0, end: 1, text: '' })), ['', 'p'])
  })

  test('nothing is typed beside a rule, but Enter opens a plain paragraph on either side of it', () => {
    for (const at of [6, 7]) assert.equal(both(rule, { type: 'replace', start: at, end: at, text: 'x' }), null, `typed at ${at}`)
    assert.deepEqual(shape(both(runs(U, ['divider']), { type: 'replace', start: 1, end: 1, text: '\n' })), [`${U}\n`, 'divider p'])
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 6, end: 6, text: '\n' })), [`Above\n\n${U}\nBelow`, 'p p divider h2'])
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 1, end: 1, text: `x${U}y` })), [`Axybove\n${U}\nBelow`, 'p divider h2'])
  })

  test('replacing a selection that starts on a rule takes the kind of the paragraph it ends in', () => {
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 6, end: 10, text: 'x\ny' })), ['Above\nx\nylow', 'p h2 h2'])
    assert.deepEqual(shape(both(rule, { type: 'replace', start: 6, end: 7, text: 'new' })), ['Above\nnew\nBelow', 'p p h2'])
  })

  test('formatting across a rule passes it by; formatting only the rule changes nothing', () => {
    const across = both(runs(`Above\n${U}\nBelow`, ['p', 'divider', 'p']), { type: 'toggle', start: 0, end: 13, format: 1 })
    assert.deepEqual(across?.marks, [{ start: 0, end: 5, format: 1 }, { start: 8, end: 13, format: 1 }])
    assert.deepEqual(both(across!, { type: 'toggle', start: 0, end: 13, format: 1 })?.marks, [])
    assert.deepEqual(both(rule, { type: 'toggle', start: 6, end: 7, format: 1 }), rule)
  })

  test('a kind or direction change across a rule leaves the rule as it is; no kind change makes one', () => {
    assert.deepEqual(shape(both(rule, { type: 'kind', from: 0, to: 2, kind: 'quote' })), [rule.text, 'quote divider quote'])
    assert.deepEqual(both(rule, { type: 'dir', from: 0, to: 2, dir: 'rtl' })?.paragraphs.map((p) => p.dir), ['rtl', 'auto', 'rtl'])
    assert.deepEqual(applyEdit(rule, { type: 'kind', from: 0, to: 0, kind: 'divider' }), { ok: false, reason: 'invalid-input' })
    assert.equal(modelApply(fromRuns(rule), { type: 'kind', from: 0, to: 0, kind: 'divider' }), null)
  })

  test('a rule beside a locked unit: removing the rule from either side keeps the unit, and the unit itself stays', () => {
    const beside: Runs = { ...runs(`${U}\n${U}\nB`, ['p', 'divider', 'p']), locked: [unit({ start: 0, id: 'u1', placement: 'paragraph' })] }
    for (const [start, end] of [[3, 4], [1, 2], [2, 3]] as const) {
      const after = both(beside, { type: 'replace', start, end, text: '' })
      assert.deepEqual(shape(after), [`${U}\nB`, 'p p'], `${start}-${end}`)
      assert.deepEqual(after!.locked, beside.locked)
    }
    assert.equal(both(beside, { type: 'replace', start: 0, end: 1, text: '' }), null)
  })
})

describe('an upload is edited as a divider is, and its reference moves with it', () => {
  const U = '￼'
  const file = (start: number, value: string) => ({ start, end: start + 1, relationTo: 'files', value, fields: { caption: 'Test caption', nested: { kept: null } }, id: '', format: 'center' as const })
  const doc: Runs = {
    text: `Above\n${U}\n${U}\nBelow`, marks: [], locked: [],
    paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }, { start: 6, kind: 'upload', dir: 'auto' }, { start: 8, kind: 'upload', dir: 'auto' }, { start: 10, kind: 'h2', dir: 'auto' }],
    uploads: [file(6, 'synthetic-file-1'), file(8, 'synthetic-file-2')],
  }
  const both = (before: Runs, edit: Edit): Runs | null => {
    const result = applyEdit(before, edit)
    const modeled = modelApply(fromRuns(before), edit)
    assert.equal(result.ok, modeled !== null, JSON.stringify(edit))
    if (!result.ok) return null
    assert.deepEqual(result.runs, toRuns(modeled!))
    return validateRuns(result.runs)
  }

  test('typing above shifts both references; deleting one upload takes it whole and keeps the other', () => {
    assert.deepEqual(both(doc, { type: 'replace', start: 0, end: 0, text: 'مرحبا ' })?.uploads, [file(12, 'synthetic-file-1'), file(14, 'synthetic-file-2')])
    for (const [start, end] of [[6, 7], [5, 6]] as const) {
      const after = both(doc, { type: 'replace', start, end, text: '' })
      assert.equal(after?.text, `Above\n${U}\nBelow`, `${start}-${end}`)
      assert.deepEqual(after?.uploads, [file(6, 'synthetic-file-2')])
    }
    const none = both(doc, { type: 'replace', start: 5, end: 10, text: '' })
    assert.deepEqual([none?.text, none?.uploads], ['AboveBelow', undefined])
  })

  test('nothing is typed on an upload, formatting passes it by, and no kind change makes or changes one', () => {
    for (const at of [6, 7]) assert.equal(both(doc, { type: 'replace', start: at, end: at, text: 'x' }), null, `typed at ${at}`)
    assert.deepEqual(both(doc, { type: 'toggle', start: 0, end: 15, format: 1 })?.marks, [{ start: 0, end: 5, format: 1 }, { start: 10, end: 15, format: 1 }])
    assert.deepEqual(both(doc, { type: 'kind', from: 0, to: 3, kind: 'quote' })?.paragraphs.map((p) => p.kind), ['quote', 'upload', 'upload', 'quote'])
    assert.deepEqual(applyEdit(doc, { type: 'kind', from: 0, to: 0, kind: 'upload' }), { ok: false, reason: 'invalid-input' })
  })
})
