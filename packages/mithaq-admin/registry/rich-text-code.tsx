import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createCodeNode, CodeNode, CodeHighlightNode, $isCodeNode } from '@lexical/code-core'
import { registerCodeHighlighting } from '@lexical/code-prism'
import { $setBlocksType } from '@lexical/selection'
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export const nodes = [CodeNode, CodeHighlightNode]
export function Plugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => registerCodeHighlighting(editor), [editor])
  return null
}
export function Buttons({ t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" />}>{t('admin.richText.codeBlock', 'Code block')}</DropdownMenuTrigger>
    <DropdownMenuContent>{['javascript', 'typescript', 'json', 'css', 'markup', 'python'].map((language) => <DropdownMenuItem key={language} onClick={() => editor.update(() => {
      if (!$getSelection()) {
          const paragraph = $createParagraphNode()
          $getRoot().append(paragraph)
          paragraph.select()
        }
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const node = selection.anchor.getNode().getTopLevelElement()
      if ($isCodeNode(node)) node.setLanguage(language)
      else $setBlocksType(selection, () => $createCodeNode(language))
    })}>{language}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>
}
