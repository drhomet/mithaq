// The runs contract: one native Block as flat text plus ranges, the shape that
// crosses the rich-input bridge. `contract.json` beside this file is the single
// source of truth for native behaviour; rich-input generates its Java, Swift and
// JS constants from it, and this file reads its constants from it too.
//
// Rules (`validateRuns` enforces every one):
//
// 1. Offsets are UTF-16 code units, the unit Lexical, EditText and the bridge
//    share. No offset falls between the two halves of a surrogate pair. A
//    combining mark or a ZWJ may sit on either side of an offset.
// 2. `paragraphs` has one entry per paragraph, `start` sorted and equal to the
//    offset after each "\n" in `text` (the first is 0). Paragraph breaks are the
//    only "\n". An empty paragraph is a paragraph with no text.
// 3. List markers are drawn natively. They are never in `text`, and the
//    codec never adds one.
// 4. `marks` are sorted and never overlap, so no two marks hold the same bit
//    over the same character. That is stricter than "no overlapping marks of
//    the same bit" and it is what makes runs canonical: every character has one
//    mark or none, and two touching marks never hold the same `format`, because
//    they would be one. A mark has a non-zero `format` made only of the
//    contract's format bits, and never holds "\n" or a placeholder.
// 5. `locked` ranges (runs version 2) are one U+FFFC at `[start, start + 1)`
//    each, sorted, with a unique `id`. U+FFFC appears nowhere else in `text`. A
//    `paragraph` unit is a paragraph whose only text is its placeholder, with
//    kind `p` and dir `auto`. No mark overlaps a placeholder.
// 6. A `divider` paragraph (Lexical's HorizontalRuleNode) holds one U+FFFC and
//    nothing else, with dir `auto`. It is never a locked unit, and no mark covers it.
//
// Projection limits:
// - After supported inline leaves become units, any container that still cannot
//   round-trip locks as a whole top-level node: one odd list item locks its list.
// - Only the typing state (textFormat/textStyle) of a paragraph, heading or list
//   item is rebuilt on save; unknown metadata elsewhere locks the containing node.
//   Identical adjacent normal TextNodes may join without changing their text or formatting.
// - Typed or pasted U+FFFC is dropped before editing. This remains a limitation
//   relative to rejecting or escaping that input; it never creates a unit.
// - Web linebreak/tab nodes stay undeletable inline units, previewed as "\n"/" ".
//   They cannot be edited as the native paragraph breaks represented by "\n".
//
// Task links and Smart Phrases are not part of the codec; they join the runs
// when their nodes and contract ranges exist.
import contract from './contract.json' with { type: 'json' }

export { contract as runsContract }

export type ParagraphKind = 'p' | 'bullet' | 'number' | 'h2' | 'h3' | 'quote' | 'divider'
export type Direction = 'auto' | 'ltr' | 'rtl'
export type Placement = 'inline' | 'paragraph'

export const RUNS_VERSION: number = contract.runsVersion
/** Lexical's TextNode format bits for the formats the phone edits. */
export const FORMATS = contract.formats
export const FORMAT_MASK: number = Object.values(contract.formats).reduce((mask, bit) => mask | bit, 0)
// JSON imports widen to string[]; the contract test holds these unions to the file.
export const PARAGRAPH_KINDS = contract.paragraphs as readonly ParagraphKind[]
export const DIRECTIONS = contract.directions as readonly Direction[]
export const PLACEMENTS = contract.placements as readonly Placement[]
export const PLACEHOLDER = '￼'

export type Mark = { start: number; end: number; format: number }
export type Paragraph = { start: number; kind: ParagraphKind; dir: Direction }
/** A section the phone cannot edit, kept as its original JSON in a JS side table. */
export type LockedRange = { start: number; end: number; id: string; placement: Placement; preview: string }
export type Runs = { text: string; marks: Mark[]; paragraphs: Paragraph[]; locked: LockedRange[] }

const err = (message: string): never => { throw new TypeError(`Invalid runs: ${message}`) }

/**
 * Throws a TypeError naming the first rule broken; returns `runs` so calls chain.
 * With `expectedIds`, the units sent to native must come back exactly once each and
 * in order: a missing, unknown, duplicated or reordered id is a rejected event.
 */
export const validateRuns = (runs: Runs, expectedIds?: readonly string[]): Runs => {
  const { text } = runs
  const boundary = (at: number) => {
    if (!Number.isInteger(at) || at < 0 || at > text.length) err(`offset ${at} out of range`)
    if (at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!)) err(`offset ${at} splits a surrogate pair`)
  }
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  if (runs.paragraphs.length !== starts.length) err('paragraphs must match the newlines in text')
  runs.paragraphs.forEach((p, i) => {
    if (p.start !== starts[i]) err(`paragraph ${i} starts at ${p.start}, expected ${starts[i]}`)
    if (!PARAGRAPH_KINDS.includes(p.kind)) err(`paragraph kind ${p.kind}`)
    if (!DIRECTIONS.includes(p.dir)) err(`paragraph dir ${p.dir}`)
  })
  let end = 0
  let previous: Mark | undefined
  for (const mark of runs.marks) {
    boundary(mark.start)
    boundary(mark.end)
    if (mark.start < end || mark.end <= mark.start) err('marks must be sorted and must not overlap')
    if (!Number.isInteger(mark.format) || mark.format === 0 || mark.format & ~FORMAT_MASK) err(`mark format ${mark.format}`)
    if (/[\n￼]/.test(text.slice(mark.start, mark.end))) err('a mark must not cross a paragraph break, a placeholder or a divider')
    if (previous && previous.end === mark.start && previous.format === mark.format) err('touching marks hold the same format')
    previous = mark
    end = mark.end
  }
  if (!Array.isArray(runs.locked)) err('locked must be a list')
  const dividers = runs.paragraphs.filter((p) => p.kind === 'divider').map((p) => p.start)
  for (const at of dividers) {
    const p = runs.paragraphs.find((q) => q.start === at)!
    if (text[at] !== PLACEHOLDER || (at + 1 < text.length && text[at + 1] !== '\n') || p.dir !== 'auto' || runs.locked.some((u) => u.start === at)) err('a divider is an auto paragraph holding only its placeholder')
  }
  const placeholders = [...text.matchAll(/￼/g)].map((m) => m.index).filter((at) => !dividers.includes(at))
  if (placeholders.length !== runs.locked.length) err('a placeholder that is no locked unit or divider')
  const ids = new Set<string>()
  runs.locked.forEach((unit, i) => {
    if (unit.start !== placeholders[i] || unit.end !== unit.start + 1) err('a locked unit is one placeholder')
    if (!unit.id || ids.has(unit.id)) err('locked unit ids are unique and non-empty')
    ids.add(unit.id)
    if (unit.placement === 'paragraph') {
      const p = runs.paragraphs.find((q) => q.start === unit.start)
      const next = runs.paragraphs.find((q) => q.start > unit.start)
      if (!p || p.kind !== 'p' || p.dir !== 'auto' || (next ? next.start !== unit.end + 1 : text.length !== unit.end)) err('a paragraph unit is a p/auto paragraph holding only its placeholder')
    } else if (unit.placement !== 'inline') err(`placement ${unit.placement}`)
  })
  if (expectedIds && runs.locked.map((u) => u.id).join('\n') !== expectedIds.join('\n')) err('locked unit ids differ from the ones sent')
  return runs
}

/** What a person reads or a preview shows: placeholders become their previews, a divider nothing, paragraph breaks stay, list markers never appear. */
export const plainText = (runs: Runs): string => {
  const previews = new Map(runs.locked.map((unit) => [unit.start, unit.preview]))
  return runs.text.replace(/￼/g, (_, at: number) => previews.get(at) ?? '')
}
