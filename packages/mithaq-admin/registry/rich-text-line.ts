const lineLength = 120

/** The text a reader sees in a rich text value, a block to a line. Apart from the editor, so a page that reads the words loads no Lexical. */
export const richTextPlainText = (node: unknown, depth = 64): string => {
  // A stored value nested past the bound ends in an ellipsis rather than overflowing the stack.
  if (depth <= 0) return '…'
  if (!node || typeof node !== 'object') return ''
  const held = node as { root?: unknown; type?: unknown; text?: unknown; children?: unknown }
  if (held.root) return richTextPlainText(held.root, depth - 1)
  if (held.type === 'linebreak') return '\n'
  const children: unknown[] = Array.isArray(held.children) ? held.children : []
  const inner = children.map((child) => richTextPlainText(child, depth - 1)).join(children.some((child) => typeof (child as { text?: unknown } | null)?.text === 'string') ? '' : '\n')
  return (typeof held.text === 'string' ? held.text : '') + inner
}

/** The blocks of a rich text value: its root's children, or the value itself where it holds none. */
export const blocksOf = (value: unknown): unknown[] => {
  const root = (value as { root?: unknown } | null)?.root ?? value
  return Array.isArray((root as { children?: unknown } | null)?.children) ? (root as { children: unknown[] }).children : [root]
}

/** The words of a rich text value's first non-empty block on one line, cut at 120 characters with an ellipsis. */
export const richTextLine = (value: unknown): string => {
  const first = blocksOf(value).map((block) => richTextPlainText(block).replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
  const characters = Array.from(first)
  return characters.length > lineLength ? `${characters.slice(0, lineLength).join('').trimEnd()}…` : characters.join('')
}
