import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isLinkNode } from '@lexical/link'
import { $dfs, $findMatchingParent, mergeRegister } from '@lexical/utils'
import { $getSelection, $isLineBreakNode, $isNodeSelection, $isRangeSelection, BLUR_COMMAND, COMMAND_PRIORITY_CRITICAL, COMMAND_PRIORITY_LOW, SELECTION_CHANGE_COMMAND, type EditorState } from 'lexical'
import type { Translate } from './copy.ts'
import { FloatingLinkEditor } from './rich-text-link-editor.tsx'
import { dropPlaceholders, getSelectedNode, newLink, typingLink } from './rich-text-selection.ts'

/** Draws the link editor over the anchor while the selection sits in one link. */
export function FloatingLinkEditorPlugin({ anchorElem, isLinkEditMode, setIsLinkEditMode, t }: {
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
