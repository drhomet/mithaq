import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { $findMatchingParent, mergeRegister } from '@lexical/utils'
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_LOW, KEY_ESCAPE_COMMAND, SELECTION_CHANGE_COMMAND, type BaseSelection, type LexicalEditor } from 'lexical'
import { CheckIcon, PencilIcon, TrashIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Translate } from './copy.ts'
import { dropPlaceholders, getSelectedNode, newLink } from './rich-text-selection.ts'
import { safeUrl } from 'mithaq/rich-text'

// Held apart from the JSX, so `shadcn add` in a right-to-left project does not rewrite `left-0` to `start-0`: the bubble
// is placed by a translate measured from the physical left edge in either direction.
const bubble = 'absolute top-0 left-0 z-20 w-full max-w-sm rounded-md opacity-0 shadow-md'

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
    <div ref={editorRef} data-link-editor className={bubble}>
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
