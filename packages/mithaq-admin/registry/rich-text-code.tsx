import { richTextCodeLanguages } from 'mithaq/rich-text'
import { mergeRegister } from '@lexical/utils'
import { useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createCodeNode, CodeNode, CodeHighlightNode, $isCodeNode } from '@lexical/code-core'
import { registerCodeHighlighting } from '@lexical/code-prism'
import { $setBlocksType } from '@lexical/selection'
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSelectionChange } from 'mithaq-admin/rich-text-selection.ts'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export const nodes = [CodeNode, CodeHighlightNode]
export function Plugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => mergeRegister(
    editor.registerNodeTransform(CodeNode, (node) => {
      const language = node.getLanguage()
      if (language != null && !(richTextCodeLanguages as readonly string[]).includes(language)) node.setLanguage(richTextCodeLanguages[0])
      if (node.getTheme() !== undefined) node.setTheme(undefined)
    }),
    registerCodeHighlighting(editor),
  ), [editor])
  return null
}
export function Buttons({ t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const [current, setCurrent] = useState('')
  useSelectionChange(editor, (selection) => {
    const node = $isRangeSelection(selection) ? selection.anchor.getNode().getTopLevelElement() : null
    setCurrent($isCodeNode(node) ? node.getLanguage() ?? richTextCodeLanguages[0] : '')
  })
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" />}>{t('admin.richText.codeBlock', 'Code block')}</DropdownMenuTrigger>
    <DropdownMenuContent><DropdownMenuRadioGroup value={current} onValueChange={(language) => editor.update(() => {
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
    })}>{richTextCodeLanguages.map((language) => <DropdownMenuRadioItem key={language} value={language}>{language}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
  </DropdownMenu>
}
