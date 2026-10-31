// Runs ↔ Lexical nodes for one Block, on Lexical's headless core with the shared node classes.
import { $createListItemNode, $createListNode, $isListNode } from '@lexical/list'
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text'
import { $createParagraphNode, $createTextNode, $getRoot, $isParagraphNode, $isTextNode, createEditor, type ElementNode, type LexicalEditor } from 'lexical'
import { $createLockedNode, $isLockedNode, LockedNode } from './locked-node.ts'
import { defaultNodes } from './rich-text.ts'
import { FORMAT_MASK, PLACEHOLDER, validateRuns, type Direction, type Mark, type ParagraphKind, type Runs } from './runs.ts'

/** A headless editor for one Block: the shared default nodes plus the locked stand-in. */
export const createRunsEditor = (): LexicalEditor =>
  createEditor({ nodes: [...defaultNodes, LockedNode], onError: (error) => { throw error } })

/** The format of the mark covering [start, end), cut at the paragraph's bounds. */
const segments = ({ text, start, end, marks }: { text: string; start: number; end: number; marks: Mark[] }) => {
  const out: { text: string; format: number }[] = []
  let at = start
  for (const mark of marks) {
    const from = Math.max(mark.start, start)
    const to = Math.min(mark.end, end)
    if (to <= from) continue
    if (from > at) out.push({ text: text.slice(at, from), format: 0 })
    out.push({ text: text.slice(from, to), format: mark.format })
    at = to
  }
  if (at < end) out.push({ text: text.slice(at, end), format: 0 })
  return out
}

const toLexicalDir = (dir: Direction) => (dir === 'auto' ? null : dir)
const fromLexicalDir = (dir: 'ltr' | 'rtl' | null): Direction => dir ?? 'auto'

export const runsToNodes = (editor: LexicalEditor, runs: Runs): void => {
  validateRuns(runs)
  editor.update(() => {
    const root = $getRoot().clear()
    runs.paragraphs.forEach((p, i) => {
      const end = i + 1 < runs.paragraphs.length ? runs.paragraphs[i + 1]!.start - 1 : runs.text.length
      const units = runs.locked.filter((u) => u.start >= p.start && u.start < end)
      if (units[0]?.placement === 'paragraph') return void root.append($createLockedNode(units[0]))
      const paragraph =
        p.kind === 'p' ? $createParagraphNode()
        : p.kind === 'h2' || p.kind === 'h3' ? $createHeadingNode(p.kind)
        : $createListItemNode()
      paragraph.setDirection(toLexicalDir(p.dir))
      let at = p.start
      for (const unit of units) {
        for (const seg of segments({ text: runs.text, start: at, end: unit.start, marks: runs.marks })) paragraph.append($createTextNode(seg.text).setFormat(seg.format))
        paragraph.append($createLockedNode(unit))
        at = unit.end
      }
      for (const seg of segments({ text: runs.text, start: at, end, marks: runs.marks })) paragraph.append($createTextNode(seg.text).setFormat(seg.format))
      if (p.kind !== 'bullet' && p.kind !== 'number') return void root.append(paragraph)
      // Consecutive paragraphs of one list kind are one ListNode, as Lexical's own lists are.
      const last = root.getLastChild()
      const list = $isListNode(last) && last.getListType() === p.kind && runs.paragraphs[i - 1]?.kind === p.kind ? last : root.append($createListNode(p.kind)).getLastChild()
      if (!$isListNode(list)) throw new TypeError('list expected')
      list.append(paragraph)
    })
  }, { discrete: true })
}

/** The Block's paragraphs in order, lists flattened to their items. */
const $rows = (): { node: ElementNode | LockedNode; kind: ParagraphKind }[] => {
  const rows: { node: ElementNode | LockedNode; kind: ParagraphKind }[] = []
  for (const block of $getRoot().getChildren()) {
    if ($isListNode(block)) {
      const kind = block.getListType()
      if (kind !== 'bullet' && kind !== 'number') throw new TypeError(`Not representable as runs: ${kind} list`)
      for (const item of block.getChildren()) rows.push({ node: item as ElementNode, kind })
    } else if ($isHeadingNode(block)) {
      const tag = block.getTag()
      if (tag !== 'h2' && tag !== 'h3') throw new TypeError(`Not representable as runs: ${tag}`)
      rows.push({ node: block, kind: tag })
    } else if ($isParagraphNode(block)) rows.push({ node: block, kind: 'p' })
    else if ($isLockedNode(block) && !block.isInline()) rows.push({ node: block, kind: 'p' })
    else throw new TypeError(`Not representable as runs: ${block.getType()}`)
  }
  return rows
}

/** What a person reads or a preview shows, read from the nodes alone: units show their preview, paragraphs join by "\n", no list markers. */
export const nodesToPlainText = (editor: LexicalEditor): string =>
  editor.getEditorState().read(() => $rows().map(({ node }) => node.getTextContent()).join('\n'))

export const nodesToRuns = (editor: LexicalEditor): Runs =>
  editor.getEditorState().read(() => {
    let text = ''
    const marks: Mark[] = []
    const paragraphs: Runs['paragraphs'] = []
    const locked: Runs['locked'] = []
    const lock = (node: LockedNode) => {
      locked.push({ start: text.length, end: text.length + 1, id: node.__id, placement: node.__placement, preview: node.__preview })
      text += PLACEHOLDER
    }
    $rows().forEach(({ node: paragraph, kind }, i) => {
      if (i > 0) text += '\n'
      paragraphs.push({ start: text.length, kind, dir: $isLockedNode(paragraph) ? 'auto' : fromLexicalDir(paragraph.getDirection()) })
      if ($isLockedNode(paragraph)) return lock(paragraph)
      for (const child of paragraph.getChildren()) {
        if ($isLockedNode(child)) { lock(child); continue }
        if (!$isTextNode(child)) throw new TypeError(`Not representable as runs: ${child.getType()}`)
        const format = child.getFormat()
        if (format & ~FORMAT_MASK) throw new TypeError('Not representable as runs: text format outside the contract')
        const last = marks.at(-1)
        if (format) {
          if (last && last.end === text.length && last.format === format) last.end += child.getTextContentSize()
          else marks.push({ start: text.length, end: text.length + child.getTextContentSize(), format })
        }
        text += child.getTextContent()
      }
    })
    return { text, marks, paragraphs, locked }
  })
