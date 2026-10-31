import fc from 'fast-check'
import type { Edit } from '../edit.ts'
import { DIRECTIONS, FORMATS, PARAGRAPH_KINDS, PLACEHOLDER, type Runs } from '../runs.ts'

// Synthetic text only. Every writing system the phone types lives here, with the
// awkward cases for UTF-16 offsets: surrogate pairs, ZWJ sequences, flags,
// combining marks (Latin and Arabic harakat), a bidi mark, and RTL beside LTR.
const SNIPPETS = [
  'Problem one plan text', 'abc', ' ', 'Test Patient A', '12', ',.', 'x',
  'مرحبا', ' بالعالم', 'سلام', 'مَرْحَبًا', 'اختبار', 'ب',
  'abc مرحبا def', 'שלום',
  '😀', '👨‍👩‍👧', '🇸🇦', '🧑🏽‍⚕️',
  'é', 'Z͡a', 'ọ̈',
  '‏', '‎',
]

/** The seed every property test runs under; a failure prints it with the minimized case. */
export const SEED = 20261030

export const textArb = fc.array(fc.constantFrom(...SNIPPETS), { maxLength: 4 }).map((parts) => parts.join(''))
// Empty paragraphs are a quarter of all paragraphs.
const paragraphTextArb = fc.oneof({ weight: 1, arbitrary: fc.constant('') }, { weight: 3, arbitrary: textArb })

// A divider holds exactly its placeholder, with dir auto; a quote holds ordinary text.
export const paragraphsArb = fc.array(
  fc.record({ kind: fc.constantFrom(...PARAGRAPH_KINDS), dir: fc.constantFrom(...DIRECTIONS), text: paragraphTextArb })
    .map((row) => (row.kind === 'divider' ? { ...row, dir: 'auto' as const, text: PLACEHOLDER } : row)),
  { minLength: 1, maxLength: 5 },
)
// Only insertion makes a divider, so kind edits never ask for one.
const EDIT_KINDS = PARAGRAPH_KINDS.filter((kind) => kind !== 'divider')

export const runsFromParagraphs = (rows: { kind: Runs['paragraphs'][number]['kind']; dir: Runs['paragraphs'][number]['dir']; text: string }[]): Runs => {
  let at = 0
  const paragraphs = rows.map(({ kind, dir, text }) => {
    const p = { start: at, kind, dir }
    at += text.length + 1
    return p
  })
  return { text: rows.map((r) => r.text).join('\n'), marks: [], paragraphs, locked: [] }
}

/** An edit described by fractions, so shrinking keeps it meaningful on any document. */
export type RawEdit = { type: 'replace' | 'toggle' | 'kind' | 'dir'; a: number; b: number; anchor: number; text: string; bit: number; kind: number; dir: number }

const fraction = fc.double({ min: 0, max: 1, noNaN: true })
export const rawEditArb: fc.Arbitrary<RawEdit> = fc.record({
  type: fc.constantFrom('replace', 'replace', 'replace', 'toggle', 'toggle', 'kind', 'dir'),
  a: fraction,
  b: fraction,
  anchor: fraction,
  text: fc.oneof(
    { weight: 3, arbitrary: textArb },
    { weight: 1, arbitrary: fc.constant('') },
    { weight: 1, arbitrary: fc.constant('\n') },
    { weight: 1, arbitrary: fc.tuple(textArb, textArb).map(([x, y]) => `${x}\n${y}`) },
    { weight: 1, arbitrary: fc.constant('x\uFFFCy') },
  ),
  bit: fc.nat({ max: 4 }),
  kind: fc.nat({ max: EDIT_KINDS.length - 1 }),
  dir: fc.nat({ max: DIRECTIONS.length - 1 }),
}) as fc.Arbitrary<RawEdit>

const boundaries = (text: string) => {
  const out: number[] = []
  for (let i = 0; i <= text.length; i++) if (!(i > 0 && i < text.length && /[\uD800-\uDBFF]/.test(text[i - 1]!) && /[\uDC00-\uDFFF]/.test(text[i]!))) out.push(i)
  return out
}
const pick = <T>(list: T[], at: number): T => list[Math.min(list.length - 1, Math.floor(at * list.length))]!

/** Turns a raw edit into a concrete one for these runs. About 40% of the time it is anchored on a locked unit's or a divider's edge. */
export const resolveEdit = (runs: Runs, raw: RawEdit): Edit => {
  const spots = boundaries(runs.text)
  let start = pick(spots, raw.a)
  const anchors = [...runs.locked, ...runs.paragraphs.filter((p) => p.kind === 'divider').map((p) => ({ start: p.start, end: p.start + 1 }))]
  if (anchors.length && raw.anchor < 0.4) {
    const unit = pick(anchors, raw.a)
    start = raw.b < 0.5 ? unit.start : unit.end
  }
  // Ranges are short, as a person's selections are.
  const length = Math.floor(raw.b * raw.b * 12)
  const end = Math.max(...spots.filter((s) => s >= start && s - start <= length))
  if (raw.type === 'replace') return { type: 'replace', start, end, text: raw.text }
  if (raw.type === 'toggle') return { type: 'toggle', start, end, format: Object.values(FORMATS)[raw.bit]! }
  const from = Math.min(Math.floor(raw.a * runs.paragraphs.length), runs.paragraphs.length - 1)
  const to = Math.min(runs.paragraphs.length - 1, from + Math.floor(raw.b * 3))
  return raw.type === 'kind' ? { type: 'kind', from, to, kind: EDIT_KINDS[raw.kind]! } : { type: 'dir', from, to, dir: DIRECTIONS[raw.dir]! }
}
