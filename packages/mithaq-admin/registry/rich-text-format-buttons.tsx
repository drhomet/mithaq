// Adapted from shadcn-editor and Lexical's playground, MIT. See LICENSES/shadcn-editor.txt and LICENSES/lexical.txt.
import { useCallback, useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isListNode, ListNode } from '@lexical/list'
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text'
import { $findMatchingParent, $getNearestBlockElementAncestorOrThrow, $getNearestNodeOfType, mergeRegister } from '@lexical/utils'
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setState,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type TextFormatType,
} from 'lexical'
import { BoldIcon, ChevronDownIcon, CodeIcon, EraserIcon, ItalicIcon, RedoIcon, StrikethroughIcon, UnderlineIcon, UndoIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { ReactElement } from 'react'
import type { RichTextPolicy } from 'mithaq/rich-text'
import type { Translate } from 'mithaq-admin/copy.ts'
import { pickLabel, type RichTextPick } from 'mithaq-admin/rich-text-picks.tsx'
import { colorChoice, sizeChoice, fontChoice } from 'mithaq-admin/rich-text-choices.ts'
import { useSelectionChange } from 'mithaq-admin/rich-text-selection.ts'

export function ToolbarTip({ name, children }: { name: string; children: ReactElement }) {
  return <Tooltip><TooltipTrigger render={children} /><TooltipContent>{name}</TooltipContent></Tooltip>
}

export type Toolbar = { activeEditor: LexicalEditor; blockType: string; setBlockType: (blockType: string) => void }

export function HistoryButtons({ activeEditor, t }: { activeEditor: LexicalEditor; t: Translate }) {
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
      <Button type="button" variant="outline" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" title={undo} aria-label={undo} disabled={!canUndo} onClick={() => activeEditor.dispatchCommand(UNDO_COMMAND, undefined)}>
        <UndoIcon className="size-4 rtl:-scale-x-100" />
      </Button>
      <Button type="button" variant="outline" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" title={redo} aria-label={redo} disabled={!canRedo} onClick={() => activeEditor.dispatchCommand(REDO_COMMAND, undefined)}>
        <RedoIcon className="size-4 rtl:-scale-x-100" />
      </Button>
    </ButtonGroup>
  )
}

const nearestBlock = (anchorNode: LexicalNode) =>
  $isElementNode(anchorNode) && !anchorNode.isInline() ? anchorNode : $findMatchingParent(anchorNode, (node) => $isElementNode(node) && !node.isInline())

export function BlockDropdown({ toolbar, t, locale, picks }: { toolbar: Toolbar; t: Translate; locale: string; picks: readonly RichTextPick[] }) {
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
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="gap-1 px-2 min-h-11 sm:min-h-0" title={name} aria-label={name} />}>
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
export function FormatButtons({ t, policy }: { t: Translate; policy: RichTextPolicy }) {
  const [editor] = useLexicalComposerContext()
  const [active, setActive] = useState<readonly string[]>([])
  useSelectionChange(editor, (selection) => {
    if ($isRangeSelection(selection)) setActive(formats.filter(({ format }) => selection.hasFormat(format)).map(({ format }) => format))
  })
  return (
    <ButtonGroup>
      {formats.filter(({ format }) => policy.features.includes(format === 'code' ? 'inlineCode' : format)).map(({ format, Icon, label }) => {
        const name = label(t) ?? format
        return (
          <ToolbarTip key={format} name={name}><Toggle variant="outline" size="sm" className="min-h-11 sm:min-h-0 min-w-11 sm:min-w-0" title={name} aria-label={name} pressed={active.includes(format)} onPressedChange={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format as TextFormatType)}>
            <Icon className="size-4" />
          </Toggle></ToolbarTip>
        )
      })}
    </ButtonGroup>
  )
}

export function ClearFormatting({ t }: { t: Translate }) {
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
          $setState(textNode, colorChoice, 'default')
          $setState(textNode, sizeChoice, 'normal')
          $setState(textNode, fontChoice, 'sans')
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
    <Button type="button" variant="outline" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" title={name} aria-label={name} onClick={clear}>
      <EraserIcon className="size-4" />
    </Button>
  )
}
