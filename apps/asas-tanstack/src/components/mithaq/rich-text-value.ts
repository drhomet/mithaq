import { createEditor, type Klass, type LexicalNode } from 'lexical'
import { typesOf, unknownType } from 'mithaq/rich-text'

/** One node of Lexical's serialized editor state. */
export type RichTextNode = { type: string; children?: RichTextNode[]; text?: string; [key: string]: unknown }
/** What a `richText` field holds. */
export type RichTextValue = { root: RichTextNode & { type: 'root'; children: RichTextNode[] }; [key: string]: unknown }
export type RichTextDirection = 'ltr' | 'rtl'

/** One empty paragraph, with no direction of its own so the block takes the one its first letter gives it. */
const emptyValue = (): RichTextValue => ({
  root: {
    children: [{ children: [], direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', type: 'paragraph', version: 1 }],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
})

export const valueOf = (value: unknown): RichTextValue => {
  const held = value && typeof value === 'object' && (value as RichTextValue).root ? (value as RichTextValue) : undefined
  return held?.root.children?.length ? held : emptyValue()
}

/** Whether the editor holds nothing at all: only empty paragraphs, which the control reports as `null`. */
export const blank = (value: RichTextValue) => value.root.children.every((node) => node.type === 'paragraph' && !node.children?.length)

const theme = {
  paragraph: 'mb-2',
  heading: {
    h1: 'mb-3 text-2xl font-semibold',
    h2: 'mb-3 text-xl font-semibold',
    h3: 'mb-2 text-lg font-semibold',
  },
  list: {
    nested: { listitem: 'list-none before:hidden after:hidden' },
    ol: 'ms-6 list-decimal',
    ul: 'ms-6 list-disc',
    checklist: 'ms-2 list-none',
    listitem: 'mb-1',
    listitemChecked:
      'relative mb-1 list-none px-7 line-through opacity-70 before:absolute before:start-1 before:top-1 before:size-4 before:rounded before:border before:border-primary before:bg-primary after:absolute after:start-[9px] after:top-[5px] after:block after:h-2 after:w-1 after:rotate-45 after:border-b-2 after:border-e-2 after:border-white after:content-[""]',
    listitemUnchecked:
      'relative mb-1 list-none px-7 before:absolute before:start-1 before:top-1 before:size-4 before:rounded before:border before:border-primary before:content-[""]',
  },
  quote: 'mb-2 border-s-2 ps-3 text-muted-foreground',
  link: 'text-primary underline underline-offset-4',
  hr: 'my-3 border-t',
  text: {
    bold: 'font-semibold',
    italic: 'italic',
    underline: 'underline underline-offset-2',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
    code: 'rounded bg-muted px-1 font-mono text-[0.9em]',
  },
}

export const configOf = ({ namespace, nodes, value, editable }: { namespace: string; nodes: readonly Klass<LexicalNode>[]; value: RichTextValue; editable: boolean }) => ({
  namespace,
  editable,
  editorState: JSON.stringify(value),
  nodes: [...nodes],
  onError(error: Error) {
    throw error
  },
  theme,
})

/**
 * What stops these nodes drawing a stored value, or nothing: the first node type the value holds
 * that no class of the list registers, or `''` where it nests past the server's bound or Lexical's own parse refuses it.
 */
export const unreadable = (value: RichTextValue, nodes: readonly Klass<LexicalNode>[]): string | undefined => {
  const type = unknownType({ node: value.root, types: typesOf(nodes) })
  if (type !== undefined) return type
  try {
    createEditor({ nodes: [...nodes], onError: (error) => { throw error } }).parseEditorState(JSON.stringify(value))
    return undefined
  } catch {
    return ''
  }
}
// mithaq-admin 12a77ad2d870c125421bf16c2e4e87200a870847 f6a4525933d216803d0baba7f7efa974dddf9d6a00bc1d1064c24a3e0df6a3b7
