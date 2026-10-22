// Adapted from shadcn-editor's mention picker and Lexical's playground, MIT; see LICENSES/.
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { HashtagPlugin } from '@lexical/react/LexicalHashtagPlugin'
import { HashtagNode } from '@lexical/hashtag'
import { $applyNodeReplacement, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $setSelection, TextNode, type EditorConfig } from 'lexical'
import { ScreenContext } from 'mithaq/admin/react'
import { defaultMentionSources } from 'mithaq/rich-text/client'
import { MentionNode, type Mention } from 'mithaq/rich-text/mention'
import { mentionHref } from 'mithaq-admin/rich-text-mention-access.ts'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export class MentionView extends MentionNode {
  createDOM(config: EditorConfig): HTMLElement {
    const text = super.createDOM(config)
    const anchor = document.createElement('a')
    anchor.className = `${text.className} break-words rounded bg-primary/10 px-1 text-primary`
    anchor.append(...text.childNodes)
    return anchor
  }
}
export const nodes = [MentionView, HashtagNode]
// ponytail: a small explicit palette; projects may extend it without shipping an emoji database.
export const defaultEmoji = { smile: '😀', heart: '❤️', thumbsup: '👍', check: '✅', tada: '🎉' } as const
class Option extends MenuOption {
  mention: Mention
  constructor(mention: Mention) { super(`${mention.kayan}:${mention.id}`); this.mention = mention }
}
export function Plugin({ policy, locale, t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const screen = use(ScreenContext)
  const [query, setQuery] = useState<string | null>(null)
  const [options, setOptions] = useState<Option[]>([])
  const [failed, setFailed] = useState(false)
  const sources = policy.mentionSources ?? defaultMentionSources
  const trigger = useBasicTypeaheadTriggerMatch('@', { minLength: 0 })
  useEffect(() => {
    if (query === null || !screen || !editor.isEditable()) return
    let current = true
    setOptions([]); setFailed(false)
    const timer = setTimeout(async () => {
      const found = await Promise.allSettled(sources.map(async (source): Promise<Mention[]> => {
        const titleField = screen.screen.kayan[source.kayan]?.fields.find((field) => field.name === source.title)
        const searchField = titleField?.rules.localized ? `${source.title}.${locale}` : source.title
        const page = await screen.client({ kayan: source.kayan, operation: 'find', input: { limit: 20, depth: 1, ...(query && { where: { [searchField]: { like: query } } }) } }) as { docs: Record<string, unknown>[] }
        return page.docs.flatMap((row) => {
          const title = source.title.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, row)
          const name = title && typeof title === 'object' ? (title as Record<string, unknown>)[locale] : title
          return (typeof name === 'string' && name || typeof name === 'number') ? [{ kayan: source.kayan, id: String(row.id), name: String(name) }] : []
        })
      }))
      if (!current) return
      setFailed(found.some((one) => one.status === 'rejected'))
      setOptions(found.flatMap((one) => one.status === 'fulfilled' ? one.value.map((mention) => new Option(mention)) : []))
    }, 150)
    return () => { current = false; clearTimeout(timer) }
  }, [query, screen, sources, locale, editor])
  useEffect(() => editor.registerNodeTransform(MentionView, (node) => {
    if (editor.isEditable() && !sources.some((source) => source.kayan === node.getMention().kayan)) node.replace($createTextNode(node.getTextContent()).setFormat(node.getFormat()))
  }), [editor, sources])
  useEffect(() => editor.registerNodeTransform(TextNode, (node) => {
    if (!editor.isEditable() || !node.isSimpleText() || node.hasFormat('code') || node.getParents().some((parent) => parent.getType() === 'code')) return
    const match = /:([a-z]+):/.exec(node.getTextContent())
    if (!match || !Object.hasOwn(defaultEmoji, match[1]!)) return
    const emoji = defaultEmoji[match[1] as keyof typeof defaultEmoji]
    const part = node.splitText(match.index, match.index + match[0].length)[match.index ? 1 : 0]
    part?.setTextContent(emoji)
  }), [editor])
  useEffect(() => {
    if (!screen) return
    let current = true
    const seen = new Set<string>()
    const refresh = () => editor.getEditorState().read(() => {
      for (const node of $getRoot().getAllTextNodes()) if (node instanceof MentionNode && !seen.has(node.getKey())) {
        seen.add(node.getKey())
        const key = node.getKey()
        mentionHref({ mention: node.getMention(), client: screen.client, screen: screen.screen, sources, access: screen.access }).then((href) => {
          if (!current || editor.isEditable()) return
          const element = editor.getElementByKey(key)
          if (href) element?.setAttribute('href', href)
          else element?.removeAttribute('href')
        })
      }
    })
    refresh()
    const off = editor.registerUpdateListener(refresh)
    return () => { current = false; off() }
  }, [editor, screen, sources])
  const select = useCallback((option: Option, text: TextNode | null, close: () => void) => {
    editor.update(() => {
      const mention = $applyNodeReplacement(new MentionView()).setMention(option.mention)
      if (text) text.replace(mention)
      else { const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertNodes([mention]) }
      mention.selectNext(); close()
    })
  }, [editor])
  return <><HashtagPlugin />{editor.isEditable() && <LexicalTypeaheadMenuPlugin<Option>
    onQueryChange={setQuery} onSelectOption={select} triggerFn={trigger} options={options}
    menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
      if (!anchor.current) return null
      // DOMRect coordinates are physical even when the document is RTL.
      const rect = anchor.current.getBoundingClientRect()
      return createPortal(<div id="typeahead-menu" role="listbox" aria-label={t('admin.richText.mentions', 'Mention a record')} className="bg-popover text-popover-foreground fixed z-[1000] max-h-64 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border p-1 shadow-lg" style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: Math.min(rect.bottom + 4, window.innerHeight - 260) }} dir={screen?.dir ?? (locale.startsWith('ar') ? 'rtl' : 'ltr')}>
        {options.map((option, index) => <button id={`typeahead-item-${index}`} key={option.key} ref={option.setRefElement} type="button" role="option" tabIndex={-1} aria-selected={selectedIndex === index} className={`min-h-11 w-full rounded px-3 py-2 text-start text-sm break-words ${selectedIndex === index ? 'bg-accent' : ''}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlightedIndex(index)} onClick={() => selectOptionAndCleanUp(option)}>{option.mention.name}</button>)}
        {!options.length && <p role="status" className="p-3 text-sm">{failed ? t('admin.richText.mentionsUnavailable', 'Some sources could not be read.') : t('admin.richText.noMentions', 'No matching records.')}</p>}
      </div>, document.body)
    }}
  />}</>
}
export function Buttons({ t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const held = useRef<import('lexical').RangeSelection | null>(null)
  const emoji = useMemo(() => Object.entries(defaultEmoji), [])
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" onMouseDown={() => editor.getEditorState().read(() => { const selection = $getSelection(); held.current = $isRangeSelection(selection) ? selection.clone() : null })} />}>{t('admin.richText.emoji', 'Emoji')}</PopoverTrigger>
    <PopoverContent align="end" className="flex w-auto p-1" aria-label={t('admin.richText.emoji', 'Emoji')}>
      {emoji.map(([name, value]) => <Button key={name} type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={t(`admin.richText.emoji.${name}`, name)} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        editor.update(() => { if (held.current) $setSelection(held.current); const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertText(value) }); setOpen(false)
      }}>{value}</Button>)}
    </PopoverContent>
  </Popover>
}
