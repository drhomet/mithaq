// Adapted from shadcn-editor and Lexical's playground, MIT. See LICENSES/shadcn-editor.txt and LICENSES/lexical.txt.
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { $findMatchingParent, mergeRegister } from '@lexical/utils'
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_LOW, KEY_ESCAPE_COMMAND, SELECTION_CHANGE_COMMAND, type BaseSelection, type LexicalEditor } from 'lexical'
import { CheckIcon, PencilIcon, TrashIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import type { Translate } from 'mithaq-admin/copy.ts'
import { dropPlaceholders, getSelectedNode, newLink } from 'mithaq-admin/rich-text-selection.ts'
import { safeUrl } from 'mithaq/rich-text'

export function FloatingLinkEditor({ editor, isLink, setIsLink, anchorElem, isLinkEditMode, setIsLinkEditMode, t }: {
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
  const [rect, setRect] = useState<DOMRect>()
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
    const rootElement = editor.getRootElement()
    if (selection !== null && nativeSelection !== null && rootElement !== null && rootElement.contains(nativeSelection.anchorNode) && editor.isEditable()) {
      const domRect: DOMRect | undefined = nativeSelection.focusNode?.parentElement?.getBoundingClientRect()
      if (domRect) {
        setRect(domRect)
      }
      setLastSelection(selection)
    } else if (!isLinkEditMode && (!activeElement || !activeElement.classList.contains('link-input'))) {
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
    <Popover open={isLink && !!rect} onOpenChange={(open) => { if (!open) cancel() }}>
      <PopoverTrigger tabIndex={-1} aria-hidden style={{ position: 'fixed', top: rect?.top ?? 0, left: rect?.left ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0, pointerEvents: 'none', opacity: 0 }} />
      <PopoverContent ref={editorRef} data-link-editor initialFocus={false} finalFocus={false} className="w-sm max-w-[calc(100vw-2rem)] p-0" align="start">
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
          <Button type="button" size="icon" variant="ghost" title={cancelling} aria-label={cancelling} onClick={cancel} className="min-h-11 min-w-11 shrink-0 sm:min-h-0 sm:min-w-0">
            <XIcon className="size-4" />
          </Button>
          <Button type="button" size="icon" disabled={!allowed} title={saving} aria-label={saving} onClick={handleLinkSubmission} className="min-h-11 min-w-11 shrink-0 sm:min-h-0 sm:min-w-0">
            <CheckIcon className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="bg-popover flex items-center justify-between gap-2 rounded-md border p-1 ps-2">
          <a href={safeUrl(linkUrl) ? linkUrl : undefined} target="_blank" rel="noopener noreferrer" dir="ltr" className="overflow-hidden text-sm text-ellipsis whitespace-nowrap">
            {linkUrl}
          </a>
          <div className="flex">
            <Button type="button" size="icon" variant="ghost" title={editing} aria-label={editing} className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" onClick={() => (setEditedLinkUrl(linkUrl), setIsLinkEditMode(true))}>
              <PencilIcon className="size-4" />
            </Button>
            <Button type="button" size="icon" variant="destructive" title={removing} aria-label={removing} className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" onClick={() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)}>
              <TrashIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
      </PopoverContent>
    </Popover>
  )
}
