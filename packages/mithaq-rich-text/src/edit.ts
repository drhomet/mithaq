// The JS mirror of the native edit rules for one Block (design section 4):
// every edit is a pure function of the runs. A refused edit changes nothing, so
// the caller keeps the runs it had. Native applies the same rules at the platform
// edit boundary; these are what the property tests hold both to.
import { FORMAT_MASK, PLACEHOLDER, validateRuns, type Direction, type Mark, type ParagraphKind, type Runs } from './runs.ts'

export type Edit =
  /** Insert (start = end), delete (text ''), paste over, replace. */
  | { type: 'replace'; start: number; end: number; text: string }
  /** Set the bit on the selection, or clear it when every character already holds it. */
  | { type: 'toggle'; start: number; end: number; format: number }
  /** Paragraphs `from` through `to`, inclusive. The native view maps a selection to these. */
  | { type: 'kind'; from: number; to: number; kind: ParagraphKind }
  | { type: 'dir'; from: number; to: number; dir: Direction }

export type EditResult =
  | { ok: true; runs: Runs }
  // locked-content: the edit would cut, split, replace, format or move a locked unit, or put text in a paragraph unit.
  | { ok: false; reason: 'locked-content' | 'invalid-input' }

type Piece = { start: number; end: number; format: number }

/** Every non-newline character in a piece, cut at paragraph breaks and mark edges. */
const toPieces = ({ text, marks }: Runs): Piece[] => {
  const out: Piece[] = []
  let at = 0
  const push = (to: number, format: number) => {
    if (to > at) out.push({ start: at, end: to, format })
    at = to
  }
  const upTo = (to: number) => {
    for (let nl = text.indexOf('\n', at); nl !== -1 && nl < to; nl = text.indexOf('\n', at)) {
      push(nl, 0)
      at = nl + 1
    }
    push(to, 0)
  }
  for (const mark of marks) {
    upTo(mark.start)
    push(mark.end, mark.format)
  }
  upTo(text.length)
  return out
}

const cutAt = (pieces: Piece[], at: number): Piece[] =>
  pieces.flatMap((p) => (p.start < at && at < p.end ? [{ ...p, end: at }, { ...p, start: at }] : [p]))

const toMarks = (pieces: Piece[]): Mark[] => {
  const marks: Mark[] = []
  for (const p of [...pieces].sort((a, b) => a.start - b.start)) {
    if (!p.format || p.end <= p.start) continue
    const last = marks.at(-1)
    if (last && last.end === p.start && last.format === p.format) last.end = p.end
    else marks.push({ start: p.start, end: p.end, format: p.format })
  }
  return marks
}

const isBoundary = (text: string, at: number) =>
  Number.isInteger(at) && at >= 0 && at <= text.length && !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!))

const refuse = (reason: 'locked-content' | 'invalid-input'): EditResult => ({ ok: false, reason })

const settle = (runs: Runs): EditResult => {
  try {
    return { ok: true, runs: validateRuns(runs) }
  } catch {
    // The only rule a well-formed edit can break is a paragraph unit holding more than its placeholder.
    return refuse('locked-content')
  }
}

const replace = ({ runs, start, end, raw }: { runs: Runs; start: number; end: number; raw: string }): EditResult => {
  const { text } = runs
  if (!isBoundary(text, start) || !isBoundary(text, end) || end < start) return refuse('invalid-input')
  // A literal U+FFFC typed or pasted by a person is never a unit.
  const ins = raw.replaceAll(PLACEHOLDER, '')
  if (runs.locked.some((u) => u.start >= start && u.start < end)) return refuse('locked-content')
  const delta = ins.length - (end - start)

  const pieces = cutAt(cutAt(toPieces(runs), start), end)
  // Typed text continues the format of the character before it in the same paragraph.
  const typing = pieces.find((p) => p.end === start)?.format ?? 0
  const kept = pieces.flatMap((p): Piece[] => {
    if (p.end <= start) return [p]
    if (p.start >= end) return [{ ...p, start: p.start + delta, end: p.end + delta }]
    return []
  })
  let at = start
  for (const line of ins.split('\n')) {
    kept.push({ start: at, end: at + line.length, format: typing })
    at += line.length + 1
  }

  const inherit = runs.paragraphs.findLast((p) => p.start <= start)!
  const paragraphs = [
    ...runs.paragraphs.filter((p) => p.start <= start).map((p) => ({ ...p })),
    ...[...ins.matchAll(/\n/g)].map((m) => ({ ...inherit, start: start + m.index + 1 })),
    ...runs.paragraphs.filter((p) => p.start > end).map((p) => ({ ...p, start: p.start + delta })),
  ]
  const locked = [
    ...runs.locked.filter((u) => u.start < start),
    ...runs.locked.filter((u) => u.start >= end).map((u) => ({ ...u, start: u.start + delta, end: u.end + delta })),
  ]
  // Removing an empty neighbour must not lend its list kind or direction to a unit.
  for (const p of paragraphs) {
    if (locked.some((u) => u.placement === 'paragraph' && u.start === p.start)) {
      p.kind = 'p'
      p.dir = 'auto'
    }
  }
  return settle({
    text: text.slice(0, start) + ins + text.slice(end),
    marks: toMarks(kept),
    paragraphs,
    locked,
  })
}

const toggle = ({ runs, start, end, format }: { runs: Runs; start: number; end: number; format: number }): EditResult => {
  if (!isBoundary(runs.text, start) || !isBoundary(runs.text, end) || end < start || !format || format & ~FORMAT_MASK || format & (format - 1)) return refuse('invalid-input')
  if (runs.locked.some((u) => u.start >= start && u.start < end)) return refuse('locked-content')
  const pieces = cutAt(cutAt(toPieces(runs), start), end)
  const inside = pieces.filter((p) => p.start >= start && p.end <= end)
  const all = inside.length > 0 && inside.every((p) => p.format & format)
  for (const p of inside) p.format = all ? p.format & ~format : p.format | format
  // Characters inside the range that no piece covers are impossible: pieces cover every non-newline character.
  return { ok: true, runs: { ...runs, marks: toMarks(pieces) } }
}

const paragraphs = ({ runs, from, to, change }: { runs: Runs; from: number; to: number; change: Partial<Runs['paragraphs'][number]> }): EditResult => {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= runs.paragraphs.length) return refuse('invalid-input')
  const target = runs.paragraphs.slice(from, to + 1)
  if (runs.locked.some((u) => u.placement === 'paragraph' && target.some((p) => p.start === u.start))) return refuse('locked-content')
  return { ok: true, runs: { ...runs, paragraphs: runs.paragraphs.map((p, i) => (i >= from && i <= to ? { ...p, ...change } : p)) } }
}

export const applyEdit = (runs: Runs, edit: Edit): EditResult => {
  switch (edit.type) {
    case 'replace': return replace({ runs, start: edit.start, end: edit.end, raw: edit.text })
    case 'toggle': return toggle({ runs, start: edit.start, end: edit.end, format: edit.format })
    case 'kind': return paragraphs({ runs, from: edit.from, to: edit.to, change: { kind: edit.kind } })
    case 'dir': return paragraphs({ runs, from: edit.from, to: edit.to, change: { dir: edit.dir } })
  }
}
