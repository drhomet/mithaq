import { createContext, type ComponentType } from 'react'
import { HorizontalRuleNode as HorizontalRuleView, INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list'
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { $createParagraphNode, $getSelection, $isRangeSelection, type Klass, type LexicalEditor, type LexicalNode } from 'lexical'
import { Heading1Icon, Heading2Icon, Heading3Icon, ListIcon, ListOrderedIcon, ListTodoIcon, MinusIcon, QuoteIcon, TextIcon } from 'lucide-react'
import type { ControlProps } from './control-props.ts'
import { defaultNodes } from './rich-text-nodes.ts'

/** What a toolbar or a slash entry runs with: the editor, and whether the entry is the block the selection is in. */
type Selected = { editor: LexicalEditor; isActive: boolean }

/**
 * One entry of the `/` menu, and of the block menu where `block: true`: the block type it makes,
 * its words in each locale, its icon, and what it does. A project's own node brings its own pick beside `defaultPicks`.
 */
export type RichTextPick = {
  key: string
  label: Readonly<Record<string, string>>
  Icon: ComponentType<{ className?: string }>
  keywords?: readonly string[]
  block?: true
  onSelect: (selected: Selected) => void
}

export const pickLabel = (pick: RichTextPick, locale: string) => pick.label[locale] ?? pick.label.en ?? pick.key

const toParagraph = (editor: LexicalEditor) =>
  editor.update(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createParagraphNode())
  })

const toHeading = (editor: LexicalEditor, tag: HeadingTagType) =>
  editor.update(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createHeadingNode(tag))
  })

const listOf = (command: typeof INSERT_UNORDERED_LIST_COMMAND) => ({ editor, isActive }: Selected) =>
  isActive ? toParagraph(editor) : editor.dispatchCommand(command, undefined)

const headingPick = (tag: HeadingTagType, Icon: RichTextPick['Icon'], level: string): RichTextPick => ({
  key: tag, label: { en: `Heading ${level}`, ar: `عنوان ${level}` }, Icon, keywords: ['heading', 'header', tag], block: true, onSelect: ({ editor }) => toHeading(editor, tag),
})
export const defaultPicks: readonly RichTextPick[] = [
  { key: 'paragraph', label: { en: 'Paragraph', ar: 'فقرة' }, Icon: TextIcon, keywords: ['normal', 'paragraph', 'p', 'text'], block: true, onSelect: ({ editor }) => toParagraph(editor) },
  headingPick('h1', Heading1Icon, '1'),
  headingPick('h2', Heading2Icon, '2'),
  headingPick('h3', Heading3Icon, '3'),
  { key: 'number', label: { en: 'Numbered list', ar: 'قائمة مرقمة' }, Icon: ListOrderedIcon, keywords: ['numbered list', 'ordered list', 'ol'], block: true, onSelect: listOf(INSERT_ORDERED_LIST_COMMAND) },
  { key: 'bullet', label: { en: 'Bulleted list', ar: 'قائمة نقطية' }, Icon: ListIcon, keywords: ['bulleted list', 'unordered list', 'ul'], block: true, onSelect: listOf(INSERT_UNORDERED_LIST_COMMAND) },
  { key: 'check', label: { en: 'Check list', ar: 'قائمة مهام' }, Icon: ListTodoIcon, keywords: ['check list', 'todo list'], block: true, onSelect: listOf(INSERT_CHECK_LIST_COMMAND) },
  {
    key: 'quote',
    label: { en: 'Quote', ar: 'اقتباس' },
    Icon: QuoteIcon,
    keywords: ['block quote'],
    block: true,
    onSelect: ({ editor, isActive }) => (isActive ? undefined : editor.update(() => $setBlocksType($getSelection(), () => $createQuoteNode()))),
  },
  { key: 'horizontalRule', label: { en: 'Divider', ar: 'خط فاصل' }, Icon: MinusIcon, keywords: ['horizontal rule', 'divider', 'hr'], onSelect: ({ editor }) => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined) },
]

/** The React subclasses of nodes that draw React, each of the same type as the DOM-free class in the node list and extending it. */
export const defaultViews: readonly Klass<LexicalNode>[] = [HorizontalRuleView]

/** A node list as the browser draws it: each class swapped for its React subclass where one extends it. */
export const viewsOf = (nodes: readonly Klass<LexicalNode>[], views: readonly Klass<LexicalNode>[] = defaultViews) =>
  nodes.map((node) => views.find((view) => view.prototype instanceof node) ?? node)

/**
 * The nodes and picks every editor and viewer under it draws with, provided once by a screen from
 * the project's own list so the editor, viewer and server read the same nodes. The registry's own where none is provided.
 */
export const RichTextContext = createContext<{
  nodes: readonly Klass<LexicalNode>[]
  picks: readonly RichTextPick[]
  /** What a project's own node mounts inside every editor beside its nodes, handed the field's control props (for example the upload node's dialog). */
  Plugin?: ComponentType<ControlProps>
}>({ nodes: viewsOf(defaultNodes), picks: defaultPicks })
