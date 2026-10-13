import { useEffect, useRef } from 'react'
import { $isLinkNode } from '@lexical/link'
import { $isAtNodeEnd } from '@lexical/selection'
import { $dfs, $findMatchingParent } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  SELECTION_CHANGE_COMMAND,
  type BaseSelection,
  type EditorState,
  type ElementNode,
  type LexicalEditor,
  type RangeSelection,
  type TextNode,
} from 'lexical'

/** Runs `callback` on every selection change and once on mount. */
export function useSelectionChange(activeEditor: LexicalEditor, callback: (selection: BaseSelection) => void) {
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

export function getSelectedNode(selection: RangeSelection): TextNode | ElementNode {
  const anchorNode = selection.anchor.getNode()
  const focusNode = selection.focus.getNode()
  if (anchorNode === focusNode) return anchorNode
  return selection.isBackward()
    ? ($isAtNodeEnd(selection.focus) ? anchorNode : focusNode)
    : ($isAtNodeEnd(selection.anchor) ? anchorNode : focusNode)
}

/** The address a new link starts with: the link editor opens on it so it is typed over, and no save may hold it. */
export const newLink = 'https://'

/** Unwraps every link still holding the placeholder (except the selected one when `keepSelected`) back into its words, so a saved value holds none. */
export const dropPlaceholders = (editor: LexicalEditor, keepSelected: boolean) =>
  editor.update(() => {
    const selection = $getSelection()
    const kept = keepSelected && $isRangeSelection(selection) ? $findMatchingParent(getSelectedNode(selection), $isLinkNode) : null
    for (const { node } of $dfs()) {
      if (!$isLinkNode(node) || node.getURL() !== newLink || node.is(kept)) continue
      for (const child of node.getChildren()) node.insertBefore(child)
      node.remove()
    }
  })

export const holdsPlaceholder = (state: EditorState) => state.read(() => $dfs().some(({ node }) => $isLinkNode(node) && node.getURL() === newLink))

/** Whether the focus is in the link editor's own box, where a placeholder is being typed over. */
export const typingLink = () => document.activeElement?.classList.contains('link-input') === true
