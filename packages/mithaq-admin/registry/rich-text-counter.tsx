import { useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export const countRichText = ({ text, locale }: { text: string; locale: string }) => ({
  words: [...new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)].filter((part) => part.isWordLike).length,
  characters: [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)].length,
})

export function Plugin({ locale, t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const [counts, setCounts] = useState({ words: 0, characters: 0 })
  useEffect(() => {
    const update = () => editor.getEditorState().read(() => setCounts(countRichText({ text: $getRoot().getTextContent(), locale })))
    update()
    return editor.registerUpdateListener(update)
  }, [editor, locale])
  const number = new Intl.NumberFormat(locale)
  return <div className="text-muted-foreground border-t px-4 py-2 text-xs" data-rich-text-counter>{number.format(counts.words)} {t('admin.richText.words', 'words')} · {number.format(counts.characters)} {t('admin.richText.characters', 'characters')}</div>
}
