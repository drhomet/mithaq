import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import { HorizontalRuleNode as HorizontalRuleView, INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $isLinkNode, $toggleLink, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { Input } from '@/components/ui/input'
import { $isListNode, INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListNode } from '@lexical/list'
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $isAtNodeEnd, $setBlocksType } from '@lexical/selection'
import { $dfs, $findMatchingParent, $getNearestBlockElementAncestorOrThrow, $getNearestNodeOfType, mergeRegister } from '@lexical/utils'
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  BLUR_COMMAND,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  HISTORY_MERGE_TAG,
  INDENT_CONTENT_COMMAND,
  KEY_ESCAPE_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type BaseSelection,
  type ElementFormatType,
  type EditorState,
  type ElementNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  type TextFormatType,
  type TextNode,
} from 'lexical'
import {
  CheckIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  ChevronDownIcon,
  CodeIcon,
  EraserIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  QuoteIcon,
  RedoIcon,
  StrikethroughIcon,
  TextIcon,
  UnderlineIcon,
  UndoIcon,
} from 'lucide-react'
import { useDirection } from '@/components/ui/direction'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { ariaRequired, changeOf, type ControlProps } from './control-props.ts'
import type { Translate } from './copy.ts'
import { richTextBounds, safeUrl, typesOf, unknownType } from 'mithaq/rich-text'
import { defaultNodes } from './rich-text-nodes.ts'

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

const valueOf = (value: unknown): RichTextValue => {
  const held = value && typeof value === 'object' && (value as RichTextValue).root ? (value as RichTextValue) : undefined
  return held?.root.children?.length ? held : emptyValue()
}

/** Whether the editor holds nothing at all: only empty paragraphs, which the control reports as `null`. */
const blank = (value: RichTextValue) => value.root.children.every((node) => node.type === 'paragraph' && !node.children?.length)

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

const pickLabel = (pick: RichTextPick, locale: string) => pick.label[locale] ?? pick.label.en ?? pick.key

type Toolbar = { activeEditor: LexicalEditor; blockType: string; setBlockType: (blockType: string) => void }

/** Runs `callback` on every selection change and once on mount. */
function useSelectionChange(activeEditor: LexicalEditor, callback: (selection: BaseSelection) => void) {
  const latest = useRef(callback)
  latest.current = callback
  useEffect(
    () =>
      activeEditor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          const selection = $getSelection()
          if (selection) latest.current(selection)
          return false
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [activeEditor],
  )
  useEffect(() => {
    activeEditor.getEditorState().read(() => {
      const selection = $getSelection()
      if (selection) latest.current(selection)
    })
  }, [activeEditor])
}

function getSelectedNode(selection: RangeSelection): TextNode | ElementNode {
  const anchorNode = selection.anchor.getNode()
  const focusNode = selection.focus.getNode()
  if (anchorNode === focusNode) return anchorNode
  return selection.isBackward()
    ? ($isAtNodeEnd(selection.focus) ? anchorNode : focusNode)
    : ($isAtNodeEnd(selection.anchor) ? anchorNode : focusNode)
}

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

function HistoryButtons({ activeEditor, t }: { activeEditor: LexicalEditor; t: Translate }) {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  useEffect(
    () =>
      mergeRegister(
        activeEditor.registerCommand<boolean>(CAN_UNDO_COMMAND, (payload) => (setCanUndo(payload), false), COMMAND_PRIORITY_CRITICAL),
        activeEditor.registerCommand<boolean>(CAN_REDO_COMMAND, (payload) => (setCanRedo(payload), false), COMMAND_PRIORITY_CRITICAL),
      ),
    [activeEditor],
  )
  const undo = t('admin.richText.undo', 'Undo') ?? 'Undo'
  const redo = t('admin.richText.redo', 'Redo') ?? 'Redo'
  return (
    <ButtonGroup>
      <Button type="button" variant="outline" size="icon-sm" className="max-sm:size-11" title={undo} aria-label={undo} disabled={!canUndo} onClick={() => activeEditor.dispatchCommand(UNDO_COMMAND, undefined)}>
        <UndoIcon className="size-4 rtl:-scale-x-100" />
      </Button>
      <Button type="button" variant="outline" size="icon-sm" className="max-sm:size-11" title={redo} aria-label={redo} disabled={!canRedo} onClick={() => activeEditor.dispatchCommand(REDO_COMMAND, undefined)}>
        <RedoIcon className="size-4 rtl:-scale-x-100" />
      </Button>
    </ButtonGroup>
  )
}

const nearestBlock = (anchorNode: LexicalNode) =>
  $isElementNode(anchorNode) && !anchorNode.isInline() ? anchorNode : $findMatchingParent(anchorNode, (node) => $isElementNode(node) && !node.isInline())

function BlockDropdown({ toolbar, t, locale, picks }: { toolbar: Toolbar; t: Translate; locale: string; picks: readonly RichTextPick[] }) {
  const { activeEditor, blockType, setBlockType } = toolbar
  useSelectionChange(activeEditor, (selection) => {
    if (!$isRangeSelection(selection)) return
    const anchorNode = selection.anchor.getNode()
    const element = nearestBlock(anchorNode) ?? anchorNode.getTopLevelElementOrThrow()
    if (activeEditor.getElementByKey(element.getKey()) === null) return
    if ($isListNode(element)) {
      const parent = $getNearestNodeOfType<ListNode>(anchorNode, ListNode)
      setBlockType((parent ?? element).getListType())
    } else {
      setBlockType($isHeadingNode(element) ? element.getTag() : element.getType())
    }
  })
  const blocks = picks.filter((pick) => pick.block)
  const current = blocks.find((entry) => entry.key === blockType) ?? blocks[0]
  if (!current) return null
  // The accessible name contains the visible words, so a voice control can say them to press the button.
  const name = (t('admin.richText.blockFormatCurrent', 'Block format: {block}') ?? 'Block format: {block}').replace('{block}', () => pickLabel(current, locale))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="gap-1 px-2 max-sm:h-11" title={name} aria-label={name} />}>
        <current.Icon className="size-4" />
        <span className="text-sm">{pickLabel(current, locale)}</span>
        <ChevronDownIcon className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {blocks.map((pick) => (
          <DropdownMenuItem key={pick.key} onClick={() => pick.onSelect({ editor: activeEditor, isActive: pick.key === blockType })}>
            <div className="flex items-center gap-1 font-normal">
              <pick.Icon className="size-4" />
              {pickLabel(pick, locale)}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const formats = [
  { format: 'bold', Icon: BoldIcon, label: (t: Translate) => t('admin.richText.bold', 'Bold') },
  { format: 'italic', Icon: ItalicIcon, label: (t: Translate) => t('admin.richText.italic', 'Italic') },
  { format: 'underline', Icon: UnderlineIcon, label: (t: Translate) => t('admin.richText.underline', 'Underline') },
  { format: 'strikethrough', Icon: StrikethroughIcon, label: (t: Translate) => t('admin.richText.strikethrough', 'Strikethrough') },
  { format: 'code', Icon: CodeIcon, label: (t: Translate) => t('admin.richText.code', 'Code') },
] as const
function FormatButtons({ t }: { t: Translate }) {
  const [editor] = useLexicalComposerContext()
  const [active, setActive] = useState<readonly string[]>([])
  useSelectionChange(editor, (selection) => {
    if ($isRangeSelection(selection)) setActive(formats.filter(({ format }) => selection.hasFormat(format)).map(({ format }) => format))
  })
  return (
    <ButtonGroup>
      {formats.map(({ format, Icon, label }) => {
        const name = label(t) ?? format
        return (
          <Toggle key={format} variant="outline" size="sm" className="max-sm:h-11 max-sm:min-w-11" title={name} aria-label={name} pressed={active.includes(format)} onPressedChange={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format as TextFormatType)}>
            <Icon className="size-4" />
          </Toggle>
        )
      })}
    </ButtonGroup>
  )
}

function ClearFormatting({ t }: { t: Translate }) {
  const [editor] = useLexicalComposerContext()
  const clear = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const { anchor, focus } = selection
      const nodes = selection.getNodes()
      const extractedNodes = selection.extract()
      if (anchor.key === focus.key && anchor.offset === focus.offset) return
      nodes.forEach((node, idx) => {
        // The first and last node are split by the selection, so text outside
        // it keeps its format.
        if ($isTextNode(node)) {
          let textNode = node
          if (idx === 0 && anchor.offset !== 0) textNode = textNode.splitText(anchor.offset)[1] || textNode
          if (idx === nodes.length - 1) textNode = textNode.splitText(focus.offset)[0] || textNode
          const extractedTextNode = extractedNodes[0]
          if (nodes.length === 1 && $isTextNode(extractedTextNode)) textNode = extractedTextNode
          if (textNode.__style !== '') textNode.setStyle('')
          if (textNode.__format !== 0) {
            textNode.setFormat(0)
            $getNearestBlockElementAncestorOrThrow(textNode).setFormat('')
          }
        } else if ($isHeadingNode(node) || $isQuoteNode(node)) {
          node.replace($createParagraphNode(), true)
        }
      })
    })
  }, [editor])
  const name = t('admin.richText.clearFormatting', 'Clear formatting') ?? 'Clear formatting'
  return (
    <Button type="button" variant="outline" size="icon-sm" className="max-sm:size-11" title={name} aria-label={name} onClick={clear}>
      <EraserIcon className="size-4" />
    </Button>
  )
}

function LinkButton({ t, setLinkEditMode }: { t: Translate; setLinkEditMode: (editing: boolean) => void }) {
  const [editor] = useLexicalComposerContext()
  const [isLink, setIsLink] = useState(false)
  useSelectionChange(editor, (selection) => {
    if (!$isRangeSelection(selection)) return
    const node = getSelectedNode(selection)
    setIsLink($isLinkNode(node.getParent()) || $isLinkNode(node))
  })
  const name = isLink ? (t('admin.richText.removeLink', 'Remove link') ?? 'Remove link') : (t('admin.richText.addLink', 'Add link') ?? 'Add link')
  return (
    <Toggle variant="outline" size="sm" className="max-sm:h-11 max-sm:min-w-11" title={name} aria-label={name} pressed={isLink} onPressedChange={() => {
      setLinkEditMode(!isLink)
      // `LinkPlugin`'s own check refuses the placeholder, so it is made past it; `dropPlaceholders` removes it once the link editor is no longer open on it.
      if (isLink) editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
      else editor.update(() => $toggleLink(newLink))
    }}>
      <LinkIcon className="size-4" />
    </Toggle>
  )
}

const alignments = [
  { format: 'left', Icon: AlignLeftIcon, label: (t: Translate) => t('admin.richText.alignLeft', 'Align left') },
  { format: 'center', Icon: AlignCenterIcon, label: (t: Translate) => t('admin.richText.alignCenter', 'Align center') },
  { format: 'right', Icon: AlignRightIcon, label: (t: Translate) => t('admin.richText.alignRight', 'Align right') },
  { format: 'justify', Icon: AlignJustifyIcon, label: (t: Translate) => t('admin.richText.justify', 'Justify') },
] as const
function AlignButtons({ t }: { t: Translate }) {
  const [editor] = useLexicalComposerContext()
  const [current, setCurrent] = useState<ElementFormatType>('')
  useSelectionChange(editor, (selection) => {
    if (!$isRangeSelection(selection)) return
    const node = getSelectedNode(selection)
    const parent = node.getParent()
    // A link is inline, so a link's alignment is its paragraph's.
    const block = $isLinkNode(parent) ? $findMatchingParent(node, (one) => $isElementNode(one) && !one.isInline()) : undefined
    setCurrent($isElementNode(block) ? block.getFormatType() : $isElementNode(node) ? node.getFormatType() : (parent?.getFormatType() ?? ''))
  })
  const outdent = t('admin.richText.outdent', 'Outdent') ?? 'Outdent'
  const indent = t('admin.richText.indent', 'Indent') ?? 'Indent'
  return (
    <>
      <ButtonGroup>
        {alignments.map(({ format, Icon, label }) => {
          const name = label(t) ?? format
          return (
            <Toggle key={format} variant="outline" size="sm" className="max-sm:h-11 max-sm:min-w-11" title={name} aria-label={name} pressed={current === format} onPressedChange={() => (setCurrent(format), editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, format))}>
              <Icon className="size-4" />
            </Toggle>
          )
        })}
      </ButtonGroup>
      <ButtonGroup>
        <Button type="button" variant="outline" size="icon-sm" className="max-sm:size-11" title={outdent} aria-label={outdent} onClick={() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)}>
          <IndentDecreaseIcon className="size-4 rtl:-scale-x-100" />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" className="max-sm:size-11" title={indent} aria-label={indent} onClick={() => editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)}>
          <IndentIncreaseIcon className="size-4 rtl:-scale-x-100" />
        </Button>
      </ButtonGroup>
    </>
  )
}

/** The address a new link starts with: the link editor opens on it so it is typed over, and no save may hold it. */
const newLink = 'https://'

/** Unwraps every link still holding the placeholder (except the selected one when `keepSelected`) back into its words, so a saved value holds none. */
const dropPlaceholders = (editor: LexicalEditor, keepSelected: boolean) =>
  editor.update(() => {
    const selection = $getSelection()
    const kept = keepSelected && $isRangeSelection(selection) ? $findMatchingParent(getSelectedNode(selection), $isLinkNode) : null
    for (const { node } of $dfs()) {
      if (!$isLinkNode(node) || node.getURL() !== newLink || node.is(kept)) continue
      for (const child of node.getChildren()) node.insertBefore(child)
      node.remove()
    }
  })

const holdsPlaceholder = (state: EditorState) => state.read(() => $dfs().some(({ node }) => $isLinkNode(node) && node.getURL() === newLink))

/** Whether the focus is in the link editor's own box, where a placeholder is being typed over. */
const typingLink = () => document.activeElement?.classList.contains('link-input') === true

const VERTICAL_GAP = 10
const HORIZONTAL_OFFSET = 5

function setFloatingElemPositionForLinkEditor(targetRect: DOMRect | null, floatingElem: HTMLElement, anchorElem: HTMLElement): void {
  const scrollerElem = anchorElem.parentElement
  if (targetRect === null || !scrollerElem) {
    floatingElem.style.opacity = '0'
    floatingElem.style.transform = 'translate(-10000px, -10000px)'
    return
  }
  const floatingElemRect = floatingElem.getBoundingClientRect()
  const anchorElementRect = anchorElem.getBoundingClientRect()
  const editorScrollerRect = scrollerElem.getBoundingClientRect()
  let top = targetRect.top - VERTICAL_GAP
  let left = targetRect.left - HORIZONTAL_OFFSET
  if (top < editorScrollerRect.top) top += floatingElemRect.height + targetRect.height + VERTICAL_GAP * 2
  if (left + floatingElemRect.width > editorScrollerRect.right) left = editorScrollerRect.right - floatingElemRect.width - HORIZONTAL_OFFSET
  // A right-to-left page puts the bubble's start on the right, which the
  // physical offset above would push off the edge.
  if (left < editorScrollerRect.left) left = editorScrollerRect.left
  top -= anchorElementRect.top
  left -= anchorElementRect.left
  floatingElem.style.opacity = '1'
  floatingElem.style.transform = `translate(${left}px, ${top}px)`
}

function FloatingLinkEditor({ editor, isLink, setIsLink, anchorElem, isLinkEditMode, setIsLinkEditMode, t }: {
  editor: LexicalEditor
  isLink: boolean
  setIsLink: (isLink: boolean) => void
  anchorElem: HTMLElement
  isLinkEditMode: boolean
  setIsLinkEditMode: (editing: boolean) => void
  t: Translate
}): JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [editedLinkUrl, setEditedLinkUrl] = useState(newLink)
  // False until the address is edited, so the placeholder it opens on is not flagged invalid.
  const [edited, setEdited] = useState(false)
  const [lastSelection, setLastSelection] = useState<BaseSelection | null>(null)

  const $updateLinkEditor = useCallback(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      const node = getSelectedNode(selection)
      const linkParent = $findMatchingParent(node, $isLinkNode)
      if (linkParent) setLinkUrl(linkParent.getURL())
      else if ($isLinkNode(node)) setLinkUrl(node.getURL())
      else setLinkUrl('')
      if (isLinkEditMode) setEditedLinkUrl(linkUrl)
    }
    const editorElem = editorRef.current
    const nativeSelection = window.getSelection()
    const activeElement = document.activeElement
    if (editorElem === null) return
    const rootElement = editor.getRootElement()
    if (selection !== null && nativeSelection !== null && rootElement !== null && rootElement.contains(nativeSelection.anchorNode) && editor.isEditable()) {
      const domRect: DOMRect | undefined = nativeSelection.focusNode?.parentElement?.getBoundingClientRect()
      if (domRect) {
        domRect.y += 40
        setFloatingElemPositionForLinkEditor(domRect, editorElem, anchorElem)
      }
      setLastSelection(selection)
    } else if (!activeElement || !activeElement.classList.contains('link-input')) {
      if (rootElement !== null) setFloatingElemPositionForLinkEditor(null, editorElem, anchorElem)
      setLastSelection(null)
      setIsLinkEditMode(false)
      setLinkUrl('')
    }
    return true
  }, [anchorElem, editor, setIsLinkEditMode, isLinkEditMode, linkUrl])

  useEffect(() => {
    const scrollerElem = anchorElem.parentElement
    const update = () => editor.getEditorState().read(() => void $updateLinkEditor())
    window.addEventListener('resize', update)
    scrollerElem?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', update)
      scrollerElem?.removeEventListener('scroll', update)
    }
  }, [anchorElem.parentElement, editor, $updateLinkEditor])

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => editorState.read(() => void $updateLinkEditor())),
        editor.registerCommand(SELECTION_CHANGE_COMMAND, () => ($updateLinkEditor(), true), COMMAND_PRIORITY_LOW),
        editor.registerCommand(KEY_ESCAPE_COMMAND, () => (isLink ? (setIsLink(false), true) : false), COMMAND_PRIORITY_HIGH),
      ),
    [editor, $updateLinkEditor, setIsLink, isLink],
  )

  useEffect(() => {
    editor.getEditorState().read(() => void $updateLinkEditor())
  }, [editor, $updateLinkEditor])

  useEffect(() => {
    if (isLinkEditMode && inputRef.current) {
      inputRef.current.focus()
      setIsLink(true)
    }
  }, [isLinkEditMode, isLink])

  useEffect(() => setEdited(false), [isLinkEditMode])
  // Every address written passes `safeUrl`, the check the server makes of a write.
  const allowed = safeUrl(editedLinkUrl) && editedLinkUrl.trim() !== newLink
  const handleLinkSubmission = () => {
    if (lastSelection === null || !allowed) return
    if (linkUrl !== '') editor.dispatchCommand(TOGGLE_LINK_COMMAND, editedLinkUrl.trim())
    setEditedLinkUrl(newLink)
    setIsLinkEditMode(false)
  }
  const cancel = () => {
    if (linkUrl === newLink) editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    setIsLinkEditMode(false)
    setIsLink(false)
  }
  const address = t('admin.richText.linkAddress', 'Link address') ?? 'Link address'
  const cancelling = t('admin.richText.cancelLink', 'Cancel') ?? 'Cancel'
  const saving = t('admin.richText.saveLink', 'Save link') ?? 'Save link'
  const editing = t('admin.richText.editLink', 'Edit link') ?? 'Edit link'
  const removing = t('admin.richText.removeLink', 'Remove link') ?? 'Remove link'
  return (
    <div ref={editorRef} data-link-editor className="absolute top-0 left-0 z-20 w-full max-w-sm rounded-md opacity-0 shadow-md">
      {!isLink ? null : isLinkEditMode ? (
        <div className="bg-popover flex items-center gap-2 rounded-md border p-1 ps-2">
          <Input
            ref={inputRef}
            dir="ltr"
            type="url"
            aria-label={address}
            aria-invalid={edited && !allowed ? true : undefined}
            value={editedLinkUrl}
            onChange={(event) => (setEdited(true), setEditedLinkUrl(event.target.value))}
            onBlur={() => setTimeout(() => {
              if (editor.getRootElement()?.contains(document.activeElement) || editorRef.current?.contains(document.activeElement)) return
              dropPlaceholders(editor, false)
              setIsLinkEditMode(false)
            })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleLinkSubmission()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
            }}
            className="link-input flex-grow"
          />
          <Button type="button" size="icon" variant="ghost" title={cancelling} aria-label={cancelling} onClick={cancel} className="shrink-0">
            <XIcon className="size-4" />
          </Button>
          <Button type="button" size="icon" disabled={!allowed} title={saving} aria-label={saving} onClick={handleLinkSubmission} className="shrink-0">
            <CheckIcon className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="bg-popover flex items-center justify-between gap-2 rounded-md border p-1 ps-2">
          <a href={safeUrl(linkUrl) ? linkUrl : undefined} target="_blank" rel="noopener noreferrer" dir="ltr" className="overflow-hidden text-sm text-ellipsis whitespace-nowrap">
            {linkUrl}
          </a>
          <div className="flex">
            <Button type="button" size="icon" variant="ghost" title={editing} aria-label={editing} onClick={() => (setEditedLinkUrl(linkUrl), setIsLinkEditMode(true))}>
              <PencilIcon className="size-4" />
            </Button>
            <Button type="button" size="icon" variant="destructive" title={removing} aria-label={removing} onClick={() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)}>
              <TrashIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Draws the link editor over the anchor while the selection sits in one link. */
function FloatingLinkEditorPlugin({ anchorElem, isLinkEditMode, setIsLinkEditMode, t }: {
  anchorElem: HTMLDivElement | null
  isLinkEditMode: boolean
  setIsLinkEditMode: (editing: boolean) => void
  t: Translate
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [activeEditor, setActiveEditor] = useState(editor)
  const [isLink, setIsLink] = useState(false)
  useEffect(() => {
    const $updateToolbar = () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        const focusLinkNode = $findMatchingParent(getSelectedNode(selection), $isLinkNode)
        if (!focusLinkNode) {
          setIsLink(false)
          return
        }
        const badNode = selection.getNodes().filter((node) => !$isLineBreakNode(node)).find((node) => {
          const linkNode = $findMatchingParent(node, $isLinkNode)
          return !focusLinkNode.is(linkNode) || (linkNode && !linkNode.is(focusLinkNode))
        })
        setIsLink(!badNode)
      } else if ($isNodeSelection(selection)) {
        const node = selection.getNodes()[0]
        setIsLink(!!node && ($isLinkNode(node.getParent()) || $isLinkNode(node)))
      }
    }
    // A placeholder is dropped once the link editor is no longer open on it, so a click elsewhere or a save never stores one.
    const stale = (editorState: EditorState) =>
      editorState.read(() => {
        const selection = $getSelection()
        const inside = $isRangeSelection(selection) ? $findMatchingParent(getSelectedNode(selection), $isLinkNode) : null
        return $dfs().some(({ node }) => $isLinkNode(node) && node.getURL() === newLink && !node.is(inside))
      })
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => $updateToolbar())
        if (stale(editorState)) dropPlaceholders(editor, true)
      }),
      editor.registerCommand(SELECTION_CHANGE_COMMAND, (_payload, newEditor) => ($updateToolbar(), setActiveEditor(newEditor), false), COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(BLUR_COMMAND, () => (setTimeout(() => typingLink() || dropPlaceholders(editor, false)), false), COMMAND_PRIORITY_LOW),
    )
  }, [editor])
  if (!anchorElem) return null
  return createPortal(
    <FloatingLinkEditor editor={activeEditor} isLink={isLink} anchorElem={anchorElem} setIsLink={setIsLink} isLinkEditMode={isLinkEditMode} setIsLinkEditMode={setIsLinkEditMode} t={t} />,
    anchorElem,
  )
}

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

class PickerOption extends MenuOption {
  item: RichTextPick
  title: string
  constructor(item: RichTextPick, title: string) {
    super(item.key)
    this.item = item
    this.title = title
  }
}

function PickerMenu({ options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }: {
  options: PickerOption[]
  selectedIndex: number | null
  selectOptionAndCleanUp: (option: PickerOption) => void
  setHighlightedIndex: (index: number) => void
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    if (selectedIndex !== null) itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [selectedIndex])
  return (
    <div className="border-border bg-popover text-popover-foreground h-min min-w-48 overflow-hidden rounded-lg border p-1 shadow-xl" role="listbox">
      {options.map((option, index) => {
        const { Icon } = option.item
        return (
          <button
            key={option.key}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            type="button"
            role="option"
            aria-selected={selectedIndex === index}
            className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm outline-none', selectedIndex === index ? 'bg-accent' : 'hover:bg-muted')}
            onClick={() => selectOptionAndCleanUp(option)}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(index)}
          >
            <span className="text-muted-foreground flex size-5 items-center justify-center"><Icon className="size-4" /></span>
            <span className="flex-1">{option.title}</span>
          </button>
        )
      })}
    </div>
  )
}

function SlashMenu({ locale, picks }: { locale: string; picks: readonly RichTextPick[] }): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', { minLength: 0 })
  const options = useMemo(() => {
    const all = picks.map((item) => new PickerOption(item, pickLabel(item, locale)))
    if (!queryString) return all
    // The typed word is compared as text, never as a pattern: a lone bracket would throw in a RegExp.
    const word = queryString.toLowerCase()
    return all.filter((option) => option.title.toLowerCase().includes(word) || (option.item.keywords ?? []).some((keyword) => keyword.includes(word)))
  }, [queryString, locale, picks])
  const onSelectOption = useCallback(
    (selected: PickerOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        nodeToRemove?.remove()
        selected.item.onSelect({ editor, isActive: false })
        closeMenu()
      })
    },
    [editor],
  )
  return (
    <LexicalTypeaheadMenuPlugin<PickerOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (!anchorElementRef.current || !options.length) return null
        const anchorRect = anchorElementRef.current.getBoundingClientRect()
        return createPortal(
          <div className="fixed z-[1000]" style={{ left: anchorRect.left, top: anchorRect.bottom + 4 }}>
            <PickerMenu options={options} selectedIndex={selectedIndex} selectOptionAndCleanUp={selectOptionAndCleanUp} setHighlightedIndex={setHighlightedIndex} />
          </div>,
          document.body,
        )
      }}
    />
  )
}

/**
 * Clears the direction of the root and every block, so Lexical writes `dir="auto"` per block and
 * each follows its first strong letter. Written as a history merge, so it is no change the form would save.
 */
function DirectionPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.update(() => {
      const root = $getRoot()
      root.setDirection(null)
      for (const block of root.getChildren()) if ($isElementNode(block) && block.getDirection() !== null) block.setDirection(null)
    }, { tag: HISTORY_MERGE_TAG })
  }, [editor])
  return null
}

function ToolbarRow({ t, locale, picks, setLinkEditMode, direction }: { t: Translate; locale: string; picks: readonly RichTextPick[]; setLinkEditMode: (editing: boolean) => void; direction: RichTextDirection }) {
  const [editor] = useLexicalComposerContext()
  const bar = useRef<HTMLDivElement>(null)
  const [blockType, setBlockType] = useState('paragraph')
  const [activeEditor, setActiveEditor] = useState(editor)
  useEffect(
    () => activeEditor.registerCommand(SELECTION_CHANGE_COMMAND, (_payload, next) => (setActiveEditor(next), false), COMMAND_PRIORITY_CRITICAL),
    [activeEditor],
  )
  // One tab stop for the whole toolbar: the button that last held focus, or the first enabled one, is tabbable. A button that changes state hands the stop on, so it never lands on a disabled one.
  useEffect(() => {
    const row = bar.current!
    let last: Element | null = null
    const enabled = () => [...row.querySelectorAll('button:not(:disabled)')] as HTMLElement[]
    const sync = () => {
      const all = [...row.querySelectorAll('button')] as HTMLElement[]
      // A button disabled under focus (Undo, once nothing is left to undo) drops focus to the page: hand it to the nearest button that still takes it.
      if (last instanceof HTMLButtonElement && last.disabled && (document.activeElement === last || document.activeElement === document.body)) {
        const at = all.indexOf(last)
        all.slice(at + 1).concat(all.slice(0, at).reverse()).find((one) => !(one as HTMLButtonElement).disabled)?.focus()
      }
      const keep = enabled().find((one) => one === last) ?? enabled()[0]
      for (const one of all) one.tabIndex = one === keep ? 0 : -1
    }
    const focused = (event: FocusEvent) => ((last = event.target as Element), sync())
    // Focus leaving the row forgets the button, so a later change cannot pull focus back in; a button disabled under focus is left to the hand-off above.
    const left = (event: FocusEvent) => {
      if (!row.contains(event.relatedTarget as Node | null) && !(event.target as HTMLButtonElement).disabled) last = null
    }
    sync()
    const watch = new MutationObserver(sync)
    watch.observe(row, { subtree: true, childList: true, attributeFilter: ['disabled'] })
    row.addEventListener('focusin', focused)
    row.addEventListener('focusout', left)
    return () => (watch.disconnect(), row.removeEventListener('focusin', focused), row.removeEventListener('focusout', left))
  }, [])
  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Alt+Left, Cmd+Arrow and Ctrl+Home are the browser's own, not the toolbar's.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const items = [...event.currentTarget.querySelectorAll('button:not(:disabled)')] as HTMLElement[]
    const at = items.indexOf(document.activeElement as HTMLElement)
    // A menu's own items sit in a portal, outside this row, so only a button of the row moves focus.
    if (at < 0) return
    const step = { ArrowRight: direction === 'rtl' ? -1 : 1, ArrowLeft: direction === 'rtl' ? 1 : -1 }[event.key]
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : step === undefined ? undefined : (at + step + items.length) % items.length
    if (to === undefined) return
    event.preventDefault()
    items[to]!.focus()
  }
  return (
    // Sticky under the page's header, so no ancestor may scroll or clip (the editor box uses overflow-clip). The tint is opaque so scrolling text never shows through.
    // On a phone it is one sideways-scrolling line, with contained width so it does not widen the page.
    <div ref={bar} role="toolbar" aria-label={t('admin.richText.toolbar', 'Formatting')} aria-orientation="horizontal" onKeyDown={move} className="border-border bg-[color-mix(in_oklab,var(--muted)_20%,var(--background))] sticky top-[var(--header-bar-height,var(--header-height,0px))] z-9 flex flex-wrap items-center gap-1.5 border-b px-2 py-2 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:contain-inline-size max-sm:[&>*]:shrink-0">
      <HistoryButtons activeEditor={activeEditor} t={t} />
      <BlockDropdown toolbar={{ activeEditor, blockType, setBlockType }} t={t} locale={locale} picks={picks} />
      <FormatButtons t={t} />
      <LinkButton t={t} setLinkEditMode={setLinkEditMode} />
      <ClearFormatting t={t} />
      <AlignButtons t={t} />
    </div>
  )
}

const configOf = (namespace: string, nodes: readonly Klass<LexicalNode>[], value: RichTextValue, editable: boolean) => ({
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

/**
 * One node of a value no editor here can mount, drawn as its words; a node no class registers is
 * marked by its type. Stops at the server's depth bound with an ellipsis rather than overflowing the stack.
 */
function Walked({ node, types, inline, depth = richTextBounds.depth }: { node: RichTextNode; types: ReadonlySet<string>; inline: boolean; depth?: number }): ReactNode {
  if (depth <= 0) return '…'
  if (!node || typeof node !== 'object') return null
  if (node.type === 'linebreak') return <br />
  if (typeof node.text === 'string' && types.has(node.type)) return node.text
  const children = Array.isArray(node.children) ? node.children : []
  const runs = children.some((child) => typeof child?.text === 'string')
  const drawn = children.map((child, at) => <Walked key={at} node={child} types={types} inline={runs} depth={depth - 1} />)
  if (!types.has(node.type)) {
    return (
      <span data-unknown-node={node.type} className="border-destructive text-destructive rounded border border-dashed px-1">
        {node.type}{typeof node.text === 'string' ? `: ${node.text}` : null}{drawn.length ? <> {drawn}</> : null}
      </span>
    )
  }
  return inline ? <span>{drawn}</span> : <div className="mb-2">{drawn}</div>
}

/** A stored value this editor cannot mount, drawn read-only by `Walked`. It reports no change, so the field stays out of every save and nothing it holds is lost. */
function Unreadable({ value, nodes, problem, direction, t, id, describedBy }: {
  value: RichTextValue
  nodes: readonly Klass<LexicalNode>[]
  problem: string
  direction: RichTextDirection
  t: Translate
  id?: string
  describedBy?: string
}): ReactElement {
  const said = problem
    ? (t('admin.richText.unknownNode', 'This text holds a "{type}" node this editor cannot draw, so it is shown as its words and cannot be changed here.') ?? '').replace('{type}', () => problem)
    : (t('admin.richText.unreadable', 'This editor cannot read this text, so it is shown as its words and cannot be changed here.') ?? '')
  return (
    <div dir={direction} data-rich-text-view={id ?? ''} data-rich-text-unreadable={problem} className="grid gap-2">
      <p role="alert" className="text-destructive text-sm">{said}</p>
      <div id={id} aria-describedby={describedBy} className="text-sm leading-5">
        {(Array.isArray(value.root.children) ? value.root.children : []).map((node, at) => <Walked key={at} node={node} types={typesOf(nodes)} inline={false} />)}
      </div>
    </div>
  )
}

/**
 * The editor, over the screen's nodes and picks (`RichTextContext`) unless handed its own.
 * Uncontrolled past its first value, as Lexical is. A stored value it cannot mount is drawn by `Unreadable` and reports nothing.
 */
export function RichTextEditor({ value, onChange, direction, t, locale, id, placeholder, describedBy, invalid, required, nodes, picks, control }: {
  value: unknown
  onChange: (value: RichTextValue) => void
  direction: RichTextDirection
  t: Translate
  locale: string
  id?: string
  placeholder?: string
  describedBy?: string
  invalid?: boolean
  required?: boolean
  nodes?: readonly Klass<LexicalNode>[]
  picks?: readonly RichTextPick[]
  /** The field's control props, which the screen's `Plugin` is handed. */
  control?: ControlProps
}): ReactElement {
  const provided = use(RichTextContext)
  const { Plugin } = provided
  const drawn = nodes ?? provided.nodes
  const [held] = useState(() => valueOf(value))
  const [problem] = useState(() => unreadable(held, drawn))
  // Built only over a value these nodes read, so a value nested past the bound never reaches `JSON.stringify` or Lexical.
  const [initial] = useState(() => (problem === undefined ? configOf('MithaqRichText', drawn, held, true) : undefined))
  const [isLinkEditMode, setIsLinkEditMode] = useState(false)
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  if (problem !== undefined || !initial) return <Unreadable value={held} nodes={drawn} problem={problem ?? ''} direction={direction} t={t} id={id} describedBy={describedBy} />
  return (
    <div className="border-input bg-background overflow-clip rounded-lg border shadow-xs" dir={direction} data-rich-text={id}>
      <LexicalComposer initialConfig={initial}>
        <ToolbarRow t={t} locale={locale} picks={picks ?? provided.picks} setLinkEditMode={setIsLinkEditMode} direction={direction} />
        <div className="relative" ref={setAnchor}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={id}
                // Named by the field's label, since a `for` cannot reach a div.
                aria-labelledby={id ? `${id}-label` : undefined}
                aria-describedby={describedBy}
                aria-invalid={invalid ? true : undefined}
                aria-required={required ? true : undefined}
                aria-placeholder={placeholder ?? ''}
                className="min-h-40 px-4 py-3 text-sm leading-6 outline-none"
                placeholder={<div className="text-muted-foreground pointer-events-none absolute start-0 top-0 overflow-hidden px-4 py-3 text-sm text-ellipsis select-none">{placeholder ?? ''}</div>}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        {/* A value holding an unconfirmed link is never handed on, so an autosave while the link editor is open sends no placeholder the server refuses. */}
        <OnChangePlugin ignoreSelectionChange onChange={(state) => holdsPlaceholder(state) || onChange(state.toJSON() as unknown as RichTextValue)} />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin validateUrl={safeUrl} />
        <FloatingLinkEditorPlugin anchorElem={anchor} isLinkEditMode={isLinkEditMode} setIsLinkEditMode={setIsLinkEditMode} t={t} />
        <HorizontalRulePlugin />
        <SlashMenu locale={locale} picks={picks ?? provided.picks} />
        <DirectionPlugin />
        {Plugin && control ? <Plugin {...control} /> : null}
      </LexicalComposer>
    </div>
  )
}

/**
 * The read view: the same nodes, never editable, remounted when the value changes. A link is drawn
 * through Lexical's `sanitizeUrl`, which answers `about:blank` for unsupported schemes, so a
 * `javascript:` or `data:` address that reached a column past the server's check is never followed.
 */
export function RichTextViewer({ value, direction, t, className, id, describedBy, nodes }: {
  value: unknown
  direction: RichTextDirection
  t: Translate
  className?: string
  id?: string
  describedBy?: string
  nodes?: readonly Klass<LexicalNode>[]
}): ReactElement {
  const drawn = nodes ?? use(RichTextContext).nodes
  const held = useMemo(() => valueOf(value), [value])
  // Asked before serializing, so a value nested past the bound never reaches `JSON.stringify` or Lexical.
  const problem = useMemo(() => unreadable(held, drawn), [held, drawn])
  if (problem !== undefined) return <Unreadable value={held} nodes={drawn} problem={problem} direction={direction} t={t} id={id} describedBy={describedBy} />
  const serialized = JSON.stringify(held)
  return (
    <div dir={direction} data-rich-text-view={id ?? ''}>
      <LexicalComposer key={serialized} initialConfig={configOf('MithaqRichTextViewer', drawn, held, false)}>
        <RichTextPlugin
          contentEditable={<ContentEditable id={id} aria-describedby={describedBy} className={cn('text-sm leading-5 outline-none [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_p:last-child]:mb-0', className)} />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin validateUrl={safeUrl} />
        <DirectionPlugin />
      </LexicalComposer>
    </div>
  )
}

/** The `richText` kind's control: the editor, or the viewer where the field is read only. An editor holding nothing but empty paragraphs reports `null`. */
export function RichTextControl(props: ControlProps): ReactElement {
  const { describedBy, error, id, locale, placeholder, readOnly, t, value } = props
  const direction = useDirection() === 'rtl' ? 'rtl' : 'ltr'
  const change = changeOf(props)
  if (readOnly) return <RichTextViewer value={value} direction={direction} t={t} id={id} describedBy={describedBy} />
  return (
    <RichTextEditor
      value={value}
      onChange={(next) => change(blank(next) ? null : next)}
      direction={direction}
      t={t}
      locale={locale ?? 'en'}
      id={id}
      placeholder={placeholder}
      describedBy={describedBy}
      invalid={!!error}
      required={ariaRequired(props.field) === true}
      control={props}
    />
  )
}

/** A rich text value as a record page reads it: the viewer, over the page's direction, and nothing where it holds none. */
export function RichTextValueView({ value, t }: { value: unknown; t: Translate }): ReactNode {
  const direction = useDirection() === 'rtl' ? 'rtl' : 'ltr'
  return value ? <RichTextViewer value={value} direction={direction} t={t} /> : null
}
