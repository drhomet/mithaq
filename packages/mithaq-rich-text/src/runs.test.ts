import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { DIRECTIONS, FORMAT_MASK, PARAGRAPH_KINDS, PLACEMENTS, RUNS_VERSION, plainText, runsContract, validateRuns, type Direction, type ParagraphKind, type Placement, type Runs } from './runs.ts'

test('the runs constants are read from contract.json, runs version 2 with locked units and their error', () => {
  assert.deepEqual(runsContract, JSON.parse(readFileSync(new URL('./contract.json', import.meta.url), 'utf8')))
  assert.equal(RUNS_VERSION, 2)
  assert.equal(FORMAT_MASK, 2047)
  // `satisfies` holds each type to the file: a value the contract gains or drops fails here.
  assert.deepEqual(PARAGRAPH_KINDS, ['p', 'bullet', 'number', 'h2', 'h3', 'quote', 'divider'] satisfies ParagraphKind[])
  assert.ok('insertDivider' in runsContract.methods)
  assert.deepEqual(DIRECTIONS, ['auto', 'ltr', 'rtl'] satisfies Direction[])
  assert.deepEqual(PLACEMENTS, ['inline', 'paragraph'] satisfies Placement[])
  assert.ok(runsContract.errors.includes('locked-content'))
})

const ok: Runs = {
  text: 'one\ntwo',
  marks: [{ start: 0, end: 3, format: 1 }],
  paragraphs: [{ start: 0, kind: 'bullet', dir: 'auto' }, { start: 4, kind: 'p', dir: 'rtl' }],
  locked: [],
}
const bad = (change: (r: Runs) => Runs) => () => validateRuns(change(structuredClone(ok)))

describe('validateRuns refuses what the contract forbids', () => {
  test('a valid runs passes', () => assert.equal(validateRuns(ok), ok))
  test('unsorted paragraph starts', () =>
    assert.throws(bad((r) => ({ ...r, paragraphs: [r.paragraphs[1]!, r.paragraphs[0]!] })), /paragraph/i))
  test('a paragraph start that is not after a newline', () =>
    assert.throws(bad((r) => ({ ...r, paragraphs: [r.paragraphs[0]!, { ...r.paragraphs[1]!, start: 3 }] })), /paragraph/i))
  test('overlapping marks, even of different bits', () =>
    assert.throws(bad((r) => ({ ...r, marks: [{ start: 0, end: 3, format: 1 }, { start: 2, end: 3, format: 2 }] })), /overlap|sorted/i))
  test('touching marks that hold the same format', () =>
    assert.throws(bad((r) => ({ ...r, marks: [{ start: 0, end: 1, format: 1 }, { start: 1, end: 3, format: 1 }] })), /same format/i))
  test('a mark with a format outside the contract, or none', () => {
    assert.throws(bad((r) => ({ ...r, marks: [{ start: 0, end: 1, format: 2048 }] })), /format/i)
    assert.throws(bad((r) => ({ ...r, marks: [{ start: 0, end: 1, format: 0 }] })), /format/i)
  })
  test('a mark across a paragraph break', () =>
    assert.throws(bad((r) => ({ ...r, marks: [{ start: 2, end: 5, format: 1 }] })), /break|newline/i))
  test('a mark that splits a surrogate pair', () =>
    assert.throws(() => validateRuns({ text: 'a😀', marks: [{ start: 0, end: 2, format: 1 }], paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }], locked: [] }), /surrogate|boundary/i))
  test('an unknown kind or direction', () => {
    assert.throws(bad((r) => ({ ...r, paragraphs: [{ start: 0, kind: 'blockquote' as 'p', dir: 'auto' }, r.paragraphs[1]!] })), /kind/i)
    assert.throws(bad((r) => ({ ...r, paragraphs: [{ start: 0, kind: 'p', dir: 'up' as 'ltr' }, r.paragraphs[1]!] })), /dir/i)
  })
  test('a placeholder that is no locked unit', () =>
    assert.throws(bad((r) => ({ ...r, text: 'o￼e\ntwo' })), /placeholder/i))
})

describe('a divider paragraph holds one placeholder and nothing else', () => {
  const U = '\uFFFC'
  const runs = (text: string, kinds: ParagraphKind[], extra: Partial<Runs> = {}): Runs => ({
    text, marks: [], locked: [], ...extra,
    paragraphs: text.split('\n').map((_, i, all) => ({ start: all.slice(0, i).join('\n').length + (i ? 1 : 0), kind: kinds[i] ?? 'p', dir: 'auto' as const })),
  })
  test('quotes, dividers between paragraphs, alone, consecutive and last pass', () => {
    for (const value of [runs('Quoted words\nBody', ['quote', 'p']), runs(`Above\n${U}\nBelow`, ['p', 'divider', 'p']), runs(U, ['divider']), runs(`${U}\n${U}`, ['divider', 'divider']), runs(`A\n${U}`, ['p', 'divider'])]) {
      assert.equal(validateRuns(value), value)
    }
    assert.equal(plainText(runs(`Above\n${U}\nBelow`, ['p', 'divider', 'p'])), 'Above\n\nBelow')
  })
  test('a divider with text, an empty one, a U+FFFC outside one, a mark over one, a locked unit on one, or a direction is refused', () => {
    const unit = { start: 6, end: 7, id: 'unit-1', placement: 'paragraph', preview: 'Table' } as const
    for (const [what, value] of [
      ['a divider with text', runs(`Above\n${U}x\nBelow`, ['p', 'divider', 'p'])],
      ['an empty divider', runs('Above\n\nBelow', ['p', 'divider', 'p'])],
      ['a divider of text', runs('Above\n-\nBelow', ['p', 'divider', 'p'])],
      ['a U+FFFC in a plain paragraph', runs(`Above\n${U}\nBelow`, [])],
      ['a mark over a divider', runs(`Above\n${U}\nBelow`, ['p', 'divider', 'p'], { marks: [{ start: 6, end: 7, format: 1 }] })],
      ['a mark across a divider', runs(`Above\n${U}\nBelow`, ['p', 'divider', 'p'], { marks: [{ start: 4, end: 9, format: 1 }] })],
      ['a locked unit on a divider', runs(`Above\n${U}\nBelow`, ['p', 'divider', 'p'], { locked: [unit] })],
      ['a divider with a direction', { ...runs(U, ['divider']), paragraphs: [{ start: 0, kind: 'divider', dir: 'rtl' }] }],
    ] as [string, Runs][]) assert.throws(() => validateRuns(value), TypeError, what)
  })
  test('a malformed locked list is refused before checking dividers', () => {
    assert.throws(() => validateRuns({ ...runs(U, ['divider']), locked: {} as Runs['locked'] }), /locked must be a list/)
  })
})

test('plain text is the runs text with no list markers', () => {
  assert.equal(plainText(ok), 'one\ntwo')
  assert.doesNotMatch(plainText(ok), /[•◦▪‣]|^\s*[-*]\s|^\s*\d+[.)]\s/m)
})

describe('validateRuns checks the units it sent against the ones that come back', () => {
  const unit = (start: number, id: string) => ({ start, end: start + 1, id, placement: 'inline' as const, preview: id })
  const sent = ['u1', 'u2', 'u3']
  const back = (ids: string[]): Runs => ({
    text: ids.map(() => '￼').join('a'),
    marks: [],
    paragraphs: [{ start: 0, kind: 'p', dir: 'auto' }],
    locked: ids.map((id, i) => unit(i * 2, id)),
  })
  test('the same ids in the same order pass', () => assert.ok(validateRuns(back(sent), sent)))
  test('a missing, unknown, duplicated or reordered id is refused', () => {
    for (const ids of [['u1', 'u2'], ['u1', 'u2', 'u4'], ['u1', 'u2', 'u2'], ['u2', 'u1', 'u3'], ['u1', 'u2', 'u3', 'u3']]) {
      assert.throws(() => validateRuns(back(ids), sent), /units|ids/i, ids.join())
    }
  })
})
