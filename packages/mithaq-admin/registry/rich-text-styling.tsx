import { useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $dfs } from '@lexical/utils'
import { $getSelection, $isRangeSelection, $isTextNode, $getState, $setState } from 'lexical'
import { richTextColors, richTextSizes, richTextFonts } from 'mithaq/rich-text/client'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioItem, DropdownMenuRadioGroup, DropdownMenuTrigger, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { colorChoice, sizeChoice, fontChoice } from 'mithaq-admin/rich-text-choices.ts'
import { useSelectionChange } from 'mithaq-admin/rich-text-selection.ts'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export function Plugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const draw = () => editor.getEditorState().read(() => {
      for (const { node } of $dfs()) {
        if (!$isTextNode(node)) continue
        const element = editor.getElementByKey(node.getKey())
        if (!element) continue
        element.style.color = ($getState(node, colorChoice) === 'default' ? '' : richTextColors[$getState(node, colorChoice) as keyof typeof richTextColors]) ?? ''
        element.style.fontSize = richTextSizes[$getState(node, sizeChoice) as keyof typeof richTextSizes] ?? ''
        element.style.fontFamily = richTextFonts[$getState(node, fontChoice) as keyof typeof richTextFonts] ?? ''
      }
    })
    draw()
    return editor.registerUpdateListener(draw)
  }, [editor])
  return null
}
export function Buttons({ policy, t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const [current, setCurrent] = useState({ color: '', size: '', font: '' })
  useSelectionChange(editor, (selection) => {
    if (!$isRangeSelection(selection)) return
    const node = selection.getNodes().find($isTextNode)
    if (node) setCurrent({ color: $getState(node, colorChoice), size: $getState(node, sizeChoice), font: $getState(node, fontChoice) })
  })
  const groups = [
    { key: 'color', label: t('admin.richText.color', 'Colour'), choices: Object.keys(richTextColors), state: colorChoice },
    { key: 'size', label: t('admin.richText.size', 'Size'), choices: ['', ...Object.keys(richTextSizes)], state: sizeChoice },
    { key: 'font', label: t('admin.richText.font', 'Font'), choices: ['', ...policy.fonts], state: fontChoice },
  ] as const
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" />}>{t('admin.richText.styling', 'Text style')}</DropdownMenuTrigger>
    <DropdownMenuContent>{groups.map((group) => <DropdownMenuRadioGroup key={group.key} value={current[group.key] || (group.key === 'color' ? 'default' : '')} onValueChange={(value) => editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) for (const node of selection.extract()) if ($isTextNode(node)) $setState(node, group.state, value)
    })}>
      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
      {group.choices.map((value) => <DropdownMenuRadioItem key={value} value={value}>{t(`admin.richText.choice.${value || 'inherit'}`, value || 'Inherit')}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>)}</DropdownMenuContent>
  </DropdownMenu>
}
