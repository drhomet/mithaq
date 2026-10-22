import { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND, createCommand } from 'lexical'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { $findMatches, $replaceMatches, $selectMatch } from 'mithaq-admin/rich-text-find.ts'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

const OPEN_FIND = createCommand<void>('MITHAQ_FIND')
export function Buttons({ t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  return <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" onClick={() => editor.dispatchCommand(OPEN_FIND, undefined)}>{t('admin.richText.findReplace', 'Find and replace')}</Button>
}
export function Plugin({ t, locale }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const options = { query, matchCase, wholeWord, locale }
  useEffect(() => editor.registerCommand(OPEN_FIND, () => { setOpen(true); queueMicrotask(() => input.current?.focus()); return true }, COMMAND_PRIORITY_HIGH), [editor])
  useEffect(() => editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f' && editor.isEditable()) {
      event.preventDefault(); editor.dispatchCommand(OPEN_FIND, undefined); return true
    }
    return false
  }, COMMAND_PRIORITY_HIGH), [editor])
  useEffect(() => {
    if (!open) return
    const refresh = () => editor.getEditorState().read(() => setCount($findMatches(options).length))
    refresh()
    return editor.registerUpdateListener(refresh)
  }, [editor, open, query, matchCase, wholeWord, locale])
  useEffect(() => { setIndex(-1) }, [query, matchCase, wholeWord])
  if (!open || !editor.isEditable()) return null
  const move = (delta: number) => editor.update(() => {
    const matches = $findMatches(options)
    if (!matches.length) return
    const next = index < 0 ? delta > 0 ? 0 : matches.length - 1 : (index + delta + matches.length) % matches.length
    setIndex(next); $selectMatch(matches[next]!)
  })
  const close = () => { setOpen(false); editor.focus() }
  const label = (key: string, fallback: string) => t(`admin.richText.${key}`, fallback)
  return <section role="region" aria-label={label('findReplace', 'Find and replace')} className="grid gap-2 border-t p-3" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'text') { event.preventDefault(); move(event.shiftKey ? -1 : 1) } }}>
    <label className="grid gap-1 text-sm">{label('find', 'Find')}<Input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} dir="auto" className="min-h-11" /></label>
    <label className="grid gap-1 text-sm">{label('replaceWith', 'Replace with')}<Input value={replacement} onChange={(event) => setReplacement(event.target.value)} dir="auto" className="min-h-11" /></label>
    <div className="flex flex-wrap gap-2 text-sm">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />{label('matchCase', 'Match case')}</label>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} />{label('wholeWord', 'Whole word')}</label>
      <span role="status" className="flex min-h-11 items-center">{new Intl.NumberFormat(locale).format(count)} {label('matches', 'matches')}</span>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-11" disabled={!count} onClick={() => move(-1)}>{label('previous', 'Previous')}</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={!count} onClick={() => move(1)}>{label('next', 'Next')}</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={!count} onClick={() => editor.update(() => { $replaceMatches({ ...options, replacement, all: false, index: Math.max(0, Math.min(index, count - 1)) }) })}>{label('replace', 'Replace')}</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={!count} onClick={() => editor.update(() => { $replaceMatches({ ...options, replacement, all: true, index: 0 }) })}>{label('replaceAll', 'Replace all')}</Button>
      <Button type="button" variant="ghost" className="min-h-11" onClick={close}>{t('admin.close', 'Close')}</Button>
    </div>
  </section>
}
