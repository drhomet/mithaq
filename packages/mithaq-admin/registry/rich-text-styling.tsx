import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $dfs } from '@lexical/utils'
import { $getSelection, $isRangeSelection, $isTextNode, $getState, $setState } from 'lexical'
import { richTextColors, richTextSizes, richTextFonts } from 'mithaq/rich-text'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuGroup } from '@/components/ui/dropdown-menu'
import { colorChoice, sizeChoice, fontChoice } from 'mithaq-admin/rich-text-choices.ts'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export function Plugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const draw = () => editor.getEditorState().read(() => {
      for (const { node } of $dfs()) {
        if (!$isTextNode(node)) continue
        const element = editor.getElementByKey(node.getKey())
        if (!element) continue
        element.style.color = richTextColors[$getState(node, colorChoice) as keyof typeof richTextColors] ?? ''
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
  const groups = [
    { label: t('admin.richText.color', 'Colour'), choices: Object.keys(richTextColors), state: colorChoice },
    { label: t('admin.richText.size', 'Size'), choices: Object.keys(richTextSizes), state: sizeChoice },
    { label: t('admin.richText.font', 'Font'), choices: policy.fonts, state: fontChoice },
  ]
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" />}>{t('admin.richText.styling', 'Text style')}</DropdownMenuTrigger>
    <DropdownMenuContent>{groups.map((group) => <DropdownMenuGroup key={group.label}>
      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
      {group.choices.map((value) => <DropdownMenuItem key={value} onClick={() => editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) for (const node of selection.extract()) if ($isTextNode(node)) $setState(node, group.state, value)
      })}>{t(`admin.richText.choice.${value}`, value)}</DropdownMenuItem>)}
    </DropdownMenuGroup>)}</DropdownMenuContent>
  </DropdownMenu>
}
