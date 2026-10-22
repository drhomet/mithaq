// Inspired by shadcn-editor's find-replace extension, MIT; see LICENSES/.
import { $createRangeSelection, $getRoot, $isElementNode, $isTextNode, $setSelection, type LexicalNode, type NodeKey, type TextNode } from 'lexical'

export type FindOptions = { query: string; matchCase: boolean; wholeWord: boolean; locale: string }
export type TextMatch = { anchor: { key: NodeKey; offset: number }; focus: { key: NodeKey; offset: number } }

/** Offsets are UTF-16, matching Lexical; Unicode segmentation keeps Arabic word boundaries. */
export const $findMatches = ({ query, matchCase, wholeWord, locale }: FindOptions): TextMatch[] => {
  if (!query) return []
  const groups: { block: NodeKey; nodes: TextNode[] }[] = []
  const visit = (node: LexicalNode) => {
    if ($isTextNode(node)) {
      const block = node.getParents().find((parent) => $isElementNode(parent) && !parent.isInline())?.getKey() ?? ''
      // Record mentions are atomic identities, and replacing a piece would corrupt their stored name.
      if (node.isTextEntity() || node.isToken()) { groups.push({ block: '', nodes: [] }); return }
      let group = groups.at(-1)
      if (!group || group.block !== block) { group = { block, nodes: [] }; groups.push(group) }
      group.nodes.push(node)
    } else if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child)
      if (!node.isInline()) groups.push({ block: '', nodes: [] })
    } else groups.push({ block: '', nodes: [] })
  }
  visit($getRoot())
  const matches: TextMatch[] = []
  for (const { nodes } of groups) {
    const text = nodes.map((node) => node.getTextContent()).join('')
    const boundaries = wholeWord ? new Set([...new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)].flatMap((one) => one.isWordLike ? [one.index, one.index + one.segment.length] : [])) : undefined
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu')
    const point = (offset: number, end: boolean) => {
      let at = 0
      for (const node of nodes) {
        const size = node.getTextContentSize()
        if (offset < at + size || end && offset === at + size) return { key: node.getKey(), offset: offset - at }
        at += size
      }
      return { key: nodes.at(-1)!.getKey(), offset: nodes.at(-1)!.getTextContentSize() }
    }
    for (const match of text.matchAll(pattern)) {
      const end = match.index + match[0].length
      if (boundaries && (!boundaries.has(match.index) || !boundaries.has(end))) continue
      matches.push({ anchor: point(match.index, false), focus: point(end, true) })
    }
  }
  return matches
}

export const $selectMatch = (match: TextMatch) => {
  const selection = $createRangeSelection()
  selection.anchor.set(match.anchor.key, match.anchor.offset, 'text')
  selection.focus.set(match.focus.key, match.focus.offset, 'text')
  $setSelection(selection)
  return selection
}

/** Reverse order leaves earlier keys and offsets intact; replacements are literal, never regex templates. */
export const $replaceMatches = (options: FindOptions & { replacement: string; all: boolean; index: number }): number => {
  const matches = $findMatches(options)
  const selected = options.all ? matches : matches[options.index] ? [matches[options.index]!] : []
  for (const match of selected.toReversed()) $selectMatch(match).insertText(options.replacement)
  return selected.length
}
