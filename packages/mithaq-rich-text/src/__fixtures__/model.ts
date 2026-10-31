// An edit model that shares no code with edit.ts: the Block as one flat list of
// characters and paragraph breaks, edited by splicing. The property tests hold
// applyEdit to it.
import type { Edit } from '../edit.ts'
import type { Direction, LockedRange, ParagraphKind, Runs } from '../runs.ts'

type Unit = Pick<LockedRange, 'id' | 'placement' | 'preview'>
// A divider is its own cell, apart from any locked payload.
type Cell = { type: 'char'; ch: string; fmt: number; unit?: Unit; divider?: true }
// A break carries the kind and direction of the paragraph that follows it.
type Break = { type: 'break'; kind: ParagraphKind; dir: Direction }
export type Doc = { first: { kind: ParagraphKind; dir: Direction }; items: (Cell | Break)[] }

export const fromRuns = (runs: Runs): Doc => {
  const fmtAt = (i: number) => runs.marks.find((m) => m.start <= i && i < m.end)?.format ?? 0
  const items: (Cell | Break)[] = []
  for (let i = 0; i < runs.text.length; i++) {
    const para = runs.paragraphs.find((p) => p.start === i + 1 && runs.text[i] === '\n')
    if (runs.text[i] === '\n') items.push({ type: 'break', kind: para!.kind, dir: para!.dir })
    else {
      const unit = runs.locked.find((u) => u.start === i)
      const divider = runs.paragraphs.some((p) => p.start === i && p.kind === 'divider')
      items.push({ type: 'char', ch: runs.text[i]!, fmt: fmtAt(i), ...(unit && { unit: { id: unit.id, placement: unit.placement, preview: unit.preview } }), ...(divider && { divider: true as const }) })
    }
  }
  return { first: { kind: runs.paragraphs[0]!.kind, dir: runs.paragraphs[0]!.dir }, items }
}

export const toRuns = ({ first, items }: Doc): Runs => {
  let text = ''
  const runs: Runs = { text: '', marks: [], paragraphs: [{ start: 0, ...first }], locked: [] }
  items.forEach((item, i) => {
    if (item.type === 'break') {
      text += '\n'
      runs.paragraphs.push({ start: i + 1, kind: item.kind, dir: item.dir })
      return
    }
    text += item.ch
    if (item.unit) runs.locked.push({ start: i, end: i + 1, ...item.unit })
    const last = runs.marks.at(-1)
    if (!item.fmt) return
    if (last && last.end === i && last.format === item.fmt) last.end = i + 1
    else runs.marks.push({ start: i, end: i + 1, format: item.fmt })
  })
  runs.text = text
  return runs
}

/** The paragraphs of a doc as lists of cells, with their kind and direction. */
const paragraphsOf = ({ first, items }: Doc) => {
  const out = [{ ...first, cells: [] as Cell[] }]
  for (const item of items) {
    if (item.type === 'break') out.push({ kind: item.kind, dir: item.dir, cells: [] })
    else out.at(-1)!.cells.push(item)
  }
  return out
}

/** Null when the doc breaks the rule that a paragraph unit is alone in a p/auto paragraph, or a divider alone in its own. */
const checked = (doc: Doc): Doc | null =>
  paragraphsOf(doc).every((p) => (!p.cells.some((c) => c.unit?.placement === 'paragraph') || (p.cells.length === 1 && p.kind === 'p' && p.dir === 'auto'))
    && (!p.cells.some((c) => c.divider) || p.cells.length === 1)) ? doc : null

const isDivider = (item: Cell | Break | undefined) => item?.type === 'char' && item.divider === true

/** The kind of a paragraph follows its cells: one holding a divider is a divider, one that lost its divider is plain. */
const settleKinds = (doc: Doc) => {
  const heads = [{ head: doc.first, divider: false }]
  for (const item of doc.items) {
    if (item.type === 'break') heads.push({ head: item, divider: false })
    else if (item.divider) heads.at(-1)!.divider = true
  }
  for (const { head, divider } of heads) {
    if (divider) Object.assign(head, { kind: 'divider', dir: 'auto' })
    else if (head.kind === 'divider') Object.assign(head, { kind: 'p', dir: 'auto' })
  }
}

/** The new doc, or null where the edit must be refused. */
export const modelApply = (doc: Doc, edit: Edit): Doc | null => {
  const copy: Doc = structuredClone(doc)
  if (edit.type === 'replace') {
    const text = edit.text.replaceAll('\uFFFC', '')
    // Deleting beside a divider takes it along with its break; deleting a divider alone takes a break too.
    let start = edit.start
    let end = edit.end
    copy.items.forEach((item, i) => {
      if (!isDivider(item)) return
      if (edit.start === i + 1 && edit.end > edit.start) start = Math.min(start, i)
      else if (edit.end === i && edit.end > edit.start) end = Math.max(end, i + 1)
      if (edit.start === i && edit.end === i + 1 && !text) {
        if (i + 1 < copy.items.length) end = Math.max(end, i + 2)
        else if (i > 0) start = Math.min(start, i - 1)
      }
    })
    const slice = copy.items.slice(start, end)
    if (slice.some((i) => i.type === 'char' && i.unit)) return null
    const before = copy.items[start - 1]
    const typing = before?.type === 'char' ? before.fmt : 0
    // The paragraph the edit starts in lends its kind and direction to every paragraph the text opens.
    const headOf = (at: number) => copy.items.slice(0, at).filter((i): i is Break => i.type === 'break').at(-1) ?? copy.first
    const owner = headOf(start)
    // Unless it is a divider the edit removes: then the paragraph the edit ends in keeps its own.
    if (isDivider(copy.items[start]) && start < end && (start === 0 || copy.items[start - 1]!.type === 'break')) {
      const last = headOf(end)
      Object.assign(owner, last === owner ? { kind: 'p', dir: 'auto' } : { kind: last.kind, dir: last.dir })
    }
    const added = text.split('').map((ch): Cell | Break => (ch === '\n' ? { type: 'break', kind: owner.kind, dir: owner.dir } : { type: 'char', ch, fmt: typing }))
    copy.items.splice(start, end - start, ...added)
    settleKinds(copy)
    // A paragraph unit keeps its own paragraph when an empty neighbour disappears.
    copy.items.forEach((item, i) => {
      if (item.type !== 'char' || item.unit?.placement !== 'paragraph') return
      const before = copy.items[i - 1]
      if (i === 0) copy.first = { kind: 'p', dir: 'auto' }
      else if (before?.type === 'break') { before.kind = 'p'; before.dir = 'auto' }
    })
    return checked(copy)
  }
  if (edit.type === 'toggle') {
    const cells = copy.items.slice(edit.start, edit.end)
    if (cells.some((i) => i.type === 'char' && i.unit)) return null
    const chars = cells.filter((i): i is Cell => i.type === 'char' && !i.divider)
    const clear = chars.length > 0 && chars.every((c) => c.fmt & edit.format)
    for (const c of chars) c.fmt = clear ? c.fmt & ~edit.format : c.fmt | edit.format
    return copy
  }
  if (edit.type === 'kind' && edit.kind === 'divider') return null
  const paras = paragraphsOf(copy)
  const hit = paras.slice(edit.from, edit.to + 1)
  if (hit.some((p) => p.cells.some((c) => c.unit?.placement === 'paragraph'))) return null
  let n = -1
  const set = (a: { kind: ParagraphKind; dir: Direction }) => {
    n++
    if (n < edit.from || n > edit.to || a.kind === 'divider') return
    if (edit.type === 'kind') a.kind = edit.kind
    else a.dir = edit.dir
  }
  set(copy.first)
  for (const item of copy.items) if (item.type === 'break') set(item)
  return copy
}
