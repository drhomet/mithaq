import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $dfs } from '@lexical/utils'
import { $isLinkNode } from '@lexical/link'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $isElementNode, $isTextNode, $getState, $setState, $isRootNode, RootNode } from 'lexical'
import { richTextFormatMask, allRichTextFormats, richTextNodeFeature, richTextBlockTypes, richTextColors, richTextSizes, type RichTextPolicy } from 'mithaq/rich-text/client'
import { colorChoice, sizeChoice, fontChoice, directionChoice } from 'mithaq-admin/rich-text-choices.ts'
import { newLink } from 'mithaq-admin/rich-text-selection.ts'
import { safeUrl } from 'mithaq/rich-text/client'

/**
 * Toolbar commands are not the only writer: pasted and new content need the same policy before save.
 * A stored value past the policy never reaches it: the editor shows that value read-only, so nothing loaded is cleaned away.
 */
export function PolicyPlugin({ policy }: { policy: RichTextPolicy }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const clean = () => {
      const mask = richTextFormatMask(policy)
      const formatOf = (format: number) => mask === allRichTextFormats ? format : format & mask
      for (const { node } of $dfs()) {
        if (!node.isAttached()) continue
        const json = node.exportJSON()
        const feature = richTextNodeFeature(json)
        const unsupported = feature && !policy.features.includes(feature) && !(node.getType() === 'listitem' && policy.features.includes('checklist'))
        if (unsupported || ($isLinkNode(node) && node.getURL() !== newLink && !safeUrl(node.getURL()))) {
          if ($isElementNode(node) && node.isInline()) {
            for (const child of node.getChildren()) node.insertBefore(child)
            node.remove()
          } else if ($isElementNode(node)) {
            // Replacing a block drops its child keys, including any selection that pointed inside it.
            const selection = $getSelection()
            const selected = $isRangeSelection(selection) && [selection.anchor.getNode(), selection.focus.getNode()].some((point) => node.is(point) || node.isParentOf(point))
            const paragraph = $createParagraphNode().append($createTextNode(node.getTextContent()))
            node.replace(paragraph)
            if (selected) paragraph.selectEnd()
          }
          else node.remove()
          continue
        }
        if ($isTextNode(node)) {
          if (node.getFormat() !== formatOf(node.getFormat())) node.setFormat(formatOf(node.getFormat()))
          if (node.getStyle()) node.setStyle('')
          for (const [choice, allowed] of [[colorChoice, Object.keys(richTextColors)], [sizeChoice, Object.keys(richTextSizes)], [fontChoice, policy.fonts]] as const) {
            const value = $getState(node, choice)
            if (value && (!policy.features.includes('styling') || !(allowed as readonly string[]).includes(value))) $setState(node, choice, '')
          }
        }
        if ($isElementNode(node)) {
          if (node.getTextStyle()) node.setTextStyle('')
          if (node.getTextFormat() !== formatOf(node.getTextFormat())) node.setTextFormat(formatOf(node.getTextFormat()))
          if (node.getFormatType() && !policy.features.includes('alignment')) node.setFormat('')
          if (node.getIndent() && node.getType() !== 'listitem' && !policy.features.includes('indent')) node.setIndent(0)
          // Older Lexical writes a root direction; the server keeps it as metadata, and so does the editor.
          if ($isRootNode(node)) continue
          const block = richTextBlockTypes.includes(node.getType()) && !node.isInline()
          if ((!block || !policy.features.includes('direction')) && $getState(node, directionChoice) !== 'auto') $setState(node, directionChoice, 'auto')
          // Non-block elements keep legacy direction metadata without becoming toolbar choices.
          if (!block) continue
          const choice = block && policy.features.includes('direction') ? $getState(node, directionChoice) : 'auto'
          const direction = choice === 'auto' ? null : choice
          if (node.getDirection() !== direction) node.setDirection(direction)
        }
      }
    }
    const unregister = editor.registerNodeTransform(RootNode, clean)
    editor.update(clean)
    return unregister
  }, [editor, policy])
  return null
}
