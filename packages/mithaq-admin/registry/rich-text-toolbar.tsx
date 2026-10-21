// Adapted from shadcn-editor and Lexical's playground, MIT. See LICENSES/shadcn-editor.txt and LICENSES/lexical.txt.
import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isLinkNode, $toggleLink, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { $findMatchingParent } from '@lexical/utils'
import {
  $isElementNode,
  $getSelection,
  $getState,
  $setState,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  FORMAT_ELEMENT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type ElementFormatType,
} from 'lexical'
import { AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon, IndentDecreaseIcon, IndentIncreaseIcon, LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Toggle } from '@/components/ui/toggle'
import type { Translate } from 'mithaq-admin/copy.ts'
import { BlockDropdown, ClearFormatting, FormatButtons, HistoryButtons, ToolbarTip } from 'mithaq-admin/rich-text-format-buttons.tsx'
import type { RichTextPick } from 'mithaq-admin/rich-text-picks.tsx'
import { getSelectedNode, newLink, useSelectionChange } from 'mithaq-admin/rich-text-selection.ts'
import type { RichTextPolicy } from 'mithaq/rich-text'
import { directionChoice } from 'mithaq-admin/rich-text-choices.ts'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { RichTextDirection } from 'mithaq-admin/rich-text-value.ts'

export function LinkButton({ t, setLinkEditMode }: { t: Translate; setLinkEditMode: (editing: boolean) => void }) {
  const [editor] = useLexicalComposerContext()
  const [isLink, setIsLink] = useState(false)
  useSelectionChange(editor, (selection) => {
    if (!$isRangeSelection(selection)) return
    const node = getSelectedNode(selection)
    setIsLink($isLinkNode(node.getParent()) || $isLinkNode(node))
  })
  const name = isLink ? (t('admin.richText.removeLink', 'Remove link') ?? 'Remove link') : (t('admin.richText.addLink', 'Add link') ?? 'Add link')
  return (
    <Toggle variant="outline" size="sm" className="min-h-11 sm:min-h-0 min-w-11 sm:min-w-0" title={name} aria-label={name} pressed={isLink} onPressedChange={() => {
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
function AlignButtons({ t, policy }: { t: Translate; policy: RichTextPolicy }) {
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
      {policy.features.includes('alignment') && <ButtonGroup>
        {alignments.map(({ format, Icon, label }) => {
          const name = label(t) ?? format
          return (
            <Toggle key={format} variant="outline" size="sm" className="min-h-11 sm:min-h-0 min-w-11 sm:min-w-0" title={name} aria-label={name} pressed={current === format} onPressedChange={() => (setCurrent(format), editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, format))}>
              <Icon className="size-4" />
            </Toggle>
          )
        })}
      </ButtonGroup>}
      {policy.features.includes('indent') && <ButtonGroup>
        <Button type="button" variant="outline" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" title={outdent} aria-label={outdent} onClick={() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)}>
          <IndentDecreaseIcon className="size-4 rtl:-scale-x-100" />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" title={indent} aria-label={indent} onClick={() => editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)}>
          <IndentIncreaseIcon className="size-4 rtl:-scale-x-100" />
        </Button>
      </ButtonGroup>}
    </>
  )
}

export function ToolbarRow({ t, locale, picks, setLinkEditMode, direction, policy, extras }: { t: Translate; locale: string; picks: readonly RichTextPick[]; setLinkEditMode: (editing: boolean) => void; direction: RichTextDirection; policy: RichTextPolicy; extras?: ReactNode }) {
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
    <div ref={bar} role="toolbar" aria-label={t('admin.richText.toolbar', 'Formatting')} aria-orientation="horizontal" onKeyDown={move} className="border-border bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))] sticky top-[var(--header-bar-height,var(--header-height,0px))] z-9 flex flex-nowrap items-center gap-1.5 [scrollbar-width:none] hover:[scrollbar-width:thin] overflow-x-auto contain-inline-size border-b px-2 py-2 [&>*]:shrink-0 sm:flex-wrap sm:overflow-x-visible sm:contain-none sm:[&>*]:shrink">
      <HistoryButtons activeEditor={activeEditor} t={t} />
      <BlockDropdown toolbar={{ activeEditor, blockType, setBlockType }} t={t} locale={locale} picks={picks} />
      <FormatButtons t={t} policy={policy} />
      {policy.features.includes('link') && <LinkButton t={t} setLinkEditMode={setLinkEditMode} />}
      <ClearFormatting t={t} />
      <AlignButtons t={t} policy={policy} />
      {policy.features.includes('direction') && <DirectionButton t={t} />}
      {extras}
    </div>
  )
}

function DirectionButton({ t }: { t: Translate }) {
  const [editor] = useLexicalComposerContext()
  const [current, setCurrent] = useState('auto')
  useSelectionChange(editor, (selection) => {
    if (!$isRangeSelection(selection)) return
    const node = selection.anchor.getNode()
    const block = $isElementNode(node) && !node.isInline() ? node : $findMatchingParent(node, (one) => $isElementNode(one) && !one.isInline())
    if (block) setCurrent($getState(block, directionChoice))
  })
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" />} aria-label={`${t('admin.richText.direction', 'Block direction')}: ${t(`admin.richText.${current}`, current)}`}>{t('admin.richText.direction', 'Block direction')}: {t(`admin.richText.${current}`, current)}</DropdownMenuTrigger>
    <DropdownMenuContent>{['auto', 'rtl', 'ltr'].map((value) => <DropdownMenuItem key={value} onClick={() => editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const blocks = new Set(selection.getNodes().map((node) => $isElementNode(node) && !node.isInline() ? node : $findMatchingParent(node, (one) => $isElementNode(one) && !one.isInline())))
      for (const block of blocks) if ($isElementNode(block) && block.getType() !== 'root') { $setState(block, directionChoice, value === 'rtl' || value === 'ltr' ? value : 'auto'); block.setDirection(value === 'rtl' || value === 'ltr' ? value : null) }
    })}>{t(`admin.richText.${value}`, value)}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>
}
