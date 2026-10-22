// Uses Lexical's playground mark-selection pattern, MIT; see LICENSES/lexical.txt.
import { use, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { MarkNode, $wrapSelectionInMarkNode } from '@lexical/mark'
import { $getNodeByKey, $getRoot, $isElementNode, $getSelection, $isRangeSelection, $setSelection, COMMAND_PRIORITY_EDITOR, COMMAND_PRIORITY_HIGH, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, createCommand, type LexicalNode, type RangeSelection } from 'lexical'
import { ScreenContext } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

export const nodes = [MarkNode]
const OPEN_COMMENTS = createCommand<void>('MITHAQ_COMMENTS')
type Comment = { id: string; author: string; text: string; createdAt: string; editedAt?: string }
type Thread = { id: string; quote: string; comments: Comment[]; resolved: boolean; orphaned: boolean }
export function Buttons({ t }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  return <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11 sm:min-h-0" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(OPEN_COMMENTS, undefined)}>{t('admin.richText.comments', 'Comments')}</Button>
}
export const ReadButtons = Buttons
export const SelectionButtons = Buttons
export function Plugin({ t, control, field: fieldName }: FeatureProps) {
  const [editor] = useLexicalComposerContext()
  const screen = use(ScreenContext)
  const recordId = control?.values.id ?? screen?.record?.id
  const kayan = control?.kayan.name ?? screen?.kayan?.name
  const field = control?.field.name ?? fieldName
  const endpoint = recordId != null && recordId !== '' && kayan && field ? `/api/rich-text/comments/${[kayan, String(recordId), field].map(encodeURIComponent).join('/')}` : undefined
  const [open, setOpen] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])
  const [marks, setMarks] = useState<Set<string>>(new Set())
  const [resolved, setResolved] = useState(false)
  const [text, setText] = useState('')
  const [quote, setQuote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<{ thread: string; comment?: string }>()
  const selection = useRef<RangeSelection | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const say = (key: string, fallback: string) => t(`admin.richText.${key}`, fallback)
  const writable = editor.isEditable() && !control?.readOnly
  const capture = () => {
    const held = $getSelection()
    const marked = $isRangeSelection(held) && held.getNodes().some((node) => node instanceof MarkNode || node.getParents().some((parent) => parent instanceof MarkNode))
    selection.current = $isRangeSelection(held) && !held.isCollapsed() && !marked ? held.clone() : null
    const words = selection.current?.getTextContent() ?? ''
    if (words.length > 4000) { selection.current = null; setQuote(''); setError(t('admin.richText.selectionTooLong', 'Select at most 4000 characters.') ?? ''); return }
    if (selection.current) { setTarget(undefined); setText(''); setError('') }
    setQuote(words)
  }
  useEffect(() => editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, ({ nodes }) => {
    const own = new Set<string>()
    const collect = (node: LexicalNode) => {
      if (node instanceof MarkNode) for (const id of node.getIDs()) own.add(id.toLowerCase())
      if ($isElementNode(node)) node.getChildren().forEach(collect)
    }
    collect($getRoot())
    // Clipboard annotations are untrusted; only threads already belonging to this field survive.
    const clean = (nodes: LexicalNode[]): LexicalNode[] => nodes.flatMap((node) => {
      if ($isElementNode(node)) { const children = clean(node.getChildren()); node.clear().append(...children) }
      return node instanceof MarkNode && node.getIDs().some((id) => !own.has(id.toLowerCase())) ? node.getChildren() : [node]
    })
    nodes.splice(0, nodes.length, ...clean(nodes))
    return false
  }, COMMAND_PRIORITY_HIGH), [editor])
  useEffect(() => editor.registerCommand(OPEN_COMMENTS, () => { capture(); setOpen(true); return true }, COMMAND_PRIORITY_EDITOR), [editor, t])
  useEffect(() => {
    const refresh = () => editor.getEditorState().read(() => {
      const next = new Set<string>()
      const walk = (node: import('lexical').LexicalNode) => {
        if (node instanceof MarkNode) for (const id of node.getIDs()) if (typeof id === 'string') next.add(id.toLowerCase())
        if ('getChildren' in node) for (const child of (node as import('lexical').ElementNode).getChildren()) walk(child)
      }
      walk($getRoot()); setMarks(next)
    })
    refresh()
    return editor.registerUpdateListener(refresh)
  }, [editor])
  useEffect(() => {
    if (!open || !endpoint) return
    let current = true
    setBusy(true); setError('')
    fetch(`${endpoint}?page=${page}`).then(async (response) => {
      if (!response.ok) throw new Error('Comments unavailable')
      const found = await response.json() as { docs: Thread[]; totalDocs: number }
      if (current) { setThreads((held) => page === 1 ? found.docs : [...held, ...found.docs]); setMore(page * 100 < found.totalDocs) }
    }).catch(() => { if (current) setError(say('commentsFailed', 'Comments could not be loaded.') ?? '') }).finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [open, endpoint, page])
  const write = async (action: string, values: object = {}) => {
    if (!endpoint || busy || !writable) return
    setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...values }) })
      if (!response.ok) throw new Error('Comment refused')
      const thread = await response.json() as Thread
      setThreads((held) => action === 'create' ? [...held, thread] : held.map((one) => one.id === thread.id ? thread : one))
      if (action === 'create' && selection.current) {
        const held = selection.current
        editor.update(() => {
          if (!$getNodeByKey(held.anchor.key)?.isAttached() || !$getNodeByKey(held.focus.key)?.isAttached() || held.getTextContent() !== quote) return
          $setSelection(held); $wrapSelectionInMarkNode(held, held.isBackward(), thread.id)
        })
      }
      setText(''); setTarget(undefined); setQuote(''); selection.current = null
    } catch { setError(say('commentRefused', 'The comment could not be saved. Check that you may still update this record.') ?? '') }
    finally { setBusy(false) }
  }
  if (!open) return null
  return <section role="region" aria-label={say('comments', 'Comments')} className="grid gap-3 border-t p-3" aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={!resolved ? 'secondary' : 'ghost'} className="min-h-11 min-w-11" aria-pressed={!resolved} onClick={() => setResolved(false)}>{say('openComments', 'Open')}</Button>
      <Button type="button" variant={resolved ? 'secondary' : 'ghost'} className="min-h-11 min-w-11" aria-pressed={resolved} onClick={() => setResolved(true)}>{say('resolvedComments', 'Resolved')}</Button>
      <Button type="button" variant="ghost" className="ms-auto min-h-11 min-w-11" onClick={() => { setOpen(false); editor.focus() }}>{t('admin.close', 'Close')}</Button>
    </div>
    {!endpoint && <p role="status" className="text-sm">{say('saveBeforeComment', 'Save this record before adding comments.')}</p>}
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    <div className="grid max-h-96 gap-3 overflow-y-auto">
      {threads.filter((thread) => thread.resolved === resolved).map((thread) => <article key={thread.id} className="grid gap-2 rounded border p-3">
        <blockquote dir="auto" className="border-s-2 ps-2 text-sm">{thread.quote}</blockquote>
        {!marks.has(thread.id) && <p className="text-muted-foreground text-xs">{say('orphanComment', 'The marked text has been removed.')}</p>}
        {thread.comments.map((comment) => <div key={comment.id} className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs">{comment.author === screen?.user.id ? say('you', 'You') : say('anotherAuthor', 'Another author')}</span>
          <p dir="auto" className="whitespace-pre-wrap break-words">{comment.text}</p>
          {writable && comment.author === screen?.user.id && <div className="flex gap-2">
            <Button type="button" variant="ghost" className="min-h-11 min-w-11" disabled={busy} onClick={() => { setTarget({ thread: thread.id, comment: comment.id }); setText(comment.text); input.current?.focus() }}>{say('editComment', 'Edit')}</Button>
            <Button type="button" variant="ghost" className="text-destructive min-h-11 min-w-11" disabled={busy} onClick={() => write('delete', { thread: thread.id, comment: comment.id })}>{say('deleteComment', 'Delete')}</Button>
          </div>}
        </div>)}
        {writable && <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={busy} onClick={() => { setTarget({ thread: thread.id }); setText(''); input.current?.focus() }}>{say('replyComment', 'Reply')}</Button>
          <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={busy} onClick={() => write(thread.resolved ? 'reopen' : 'resolve', { thread: thread.id })}>{thread.resolved ? say('reopenComment', 'Reopen') : say('resolveComment', 'Resolve')}</Button>
        </div>}
      </article>)}
      {!threads.some((thread) => thread.resolved === resolved) && !busy && <p role="status" className="text-muted-foreground text-sm">{say('noComments', 'No comments in this view.')}</p>}
    </div>
    {more && <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={busy} onClick={() => setPage(page + 1)}>{say('moreComments', 'Load more')}</Button>}
    {writable && endpoint && <div className="grid gap-2">
      {quote && !target && <blockquote dir="auto" className="border-s-2 ps-2 text-sm">{quote}</blockquote>}
      {!quote && !target && <p className="text-muted-foreground text-sm">{say('selectToComment', 'Select unmarked text and open Comments to start a thread.')}</p>}
      <label className="grid gap-1 text-sm">{say('commentText', 'Comment')}<Textarea ref={input} value={text} maxLength={4000} dir="auto" disabled={busy} onChange={(event) => setText(event.target.value)} /></label>
      <Button type="button" className="min-h-11 min-w-11 justify-self-start" disabled={busy || !text.trim() || !target && !quote} onClick={() => write(target?.comment ? 'edit' : target ? 'reply' : 'create', { ...(target ?? { quote }), text })}>{target?.comment ? say('saveComment', 'Save comment') : target ? say('replyComment', 'Reply') : say('addComment', 'Add comment')}</Button>
      {target && <Button type="button" variant="ghost" className="min-h-11 min-w-11 justify-self-start" onClick={() => { setTarget(undefined); setText('') }}>{t('admin.cancel', 'Cancel')}</Button>}
    </div>}
  </section>
}
