// Adapted from shadcn-editor and Lexical's markdown shortcuts, MIT. See LICENSES/shadcn-editor.txt and LICENSES/lexical.txt.
import { $createHorizontalRuleNode, HorizontalRuleNode } from '@lexical/extension'
import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { BOLD_STAR, BOLD_UNDERSCORE, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH, INLINE_CODE, HEADING, QUOTE, CHECK_LIST, ORDERED_LIST, UNORDERED_LIST, registerMarkdownShortcuts, type Transformer } from '@lexical/markdown'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

const divider: Transformer = { type: 'element', dependencies: [HorizontalRuleNode], regExp: /^(---|\*\*\*)\s$/, export: () => null, replace: (parent) => { parent.replace($createHorizontalRuleNode()) } }

export const markdownTransformers = ({ features }: FeatureProps['policy']): Transformer[] => [
  ...(features.includes('bold') ? [BOLD_STAR, BOLD_UNDERSCORE] : []),
  ...(features.includes('italic') ? [ITALIC_STAR, ITALIC_UNDERSCORE] : []),
  ...(features.includes('strikethrough') ? [STRIKETHROUGH] : []),
  ...(features.includes('inlineCode') ? [INLINE_CODE] : []),
  ...(features.includes('headings') ? [{ ...HEADING, regExp: /^(#{1,3})\s/ }] : []),
  ...(features.includes('divider') ? [divider] : []),
  ...(features.includes('quote') ? [QUOTE] : []),
  ...(features.includes('lists') ? [ORDERED_LIST, UNORDERED_LIST] : []),
  ...(features.includes('checklist') ? [CHECK_LIST] : []),
]

export function Plugin({ policy }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => registerMarkdownShortcuts(editor, markdownTransformers(policy)), [editor, policy])
  return null
}
