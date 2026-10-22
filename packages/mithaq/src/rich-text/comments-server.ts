import { isStorableText } from '../base/kinds.ts'
import { randomUUID } from 'node:crypto'
import type { Store } from '../mithaq/language.ts'
import type { FieldAccess, ResolvedKayan } from '../mithaq/types.ts'
import { combineWhere, type Where } from '../mithaq/where.ts'
import type { Authorize, ManagedAdmin } from '../asas/runner/write.ts'
import type { RichTextCommentOptions } from './policy.ts'
import type { AuditHandler, Context } from '../asas/runner/steps.ts'
import { running } from '../asas/runner/runtime.ts'
import { AsasError, codes, denied, invalid, missing } from '../asas/runner/errors.ts'
import { boundedBody } from '../asas/http/fetch.ts'
import { richTextBounds } from './value.ts'

export type Comment = { id: string; author: string; text: string; createdAt: string; editedAt?: string }
export type CommentThread = { id: string; resolved: boolean; quote: string; comments: Comment[] }
export type CommentInput = { action: 'create' | 'reply' | 'edit' | 'delete' | 'resolve' | 'reopen'; thread?: string; comment?: string; text?: string; quote?: string }
const bad = (message: string) => invalid({ message, key: 'error.invalid.comment' })
const refusal = (error: AsasError) => Response.json({ code: codes[error.status], message: error.message, key: error.key, params: error.params }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } })
const absent = () => missing({ message: 'No readable record or thread.', key: 'error.not_found.row' })
const textOf = (text: unknown): string => {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000 || !isStorableText(text)) throw bad('A comment contains 1 to 4000 characters.')
  return text.trim()
}
const commentOf = ({ author, text }: { author: string; text: unknown }): Comment => ({ id: randomUUID(), author, text: textOf(text), createdAt: new Date().toISOString() })

/** The author comes from the authenticated actor, never a supplied comment object. */
export const nextCommentThread = ({ thread, input, author }: { thread: CommentThread; input: CommentInput; author: string }): CommentThread => {
  const next = { ...thread, comments: thread.comments.map((comment) => ({ ...comment })) }
  if (input.action === 'reply') next.comments.push(commentOf({ author, text: input.text }))
  else if (input.action === 'resolve' || input.action === 'reopen') next.resolved = input.action === 'resolve'
  else if (input.action === 'edit' || input.action === 'delete') {
    const comment = next.comments.find((one) => one.id === input.comment)
    if (!comment || comment.author !== author) throw denied({ message: 'An author may change only their own comments.', key: 'error.forbidden.comment_author' })
    if (input.action === 'edit') { comment.text = textOf(input.text); comment.editedAt = new Date().toISOString() }
    else next.comments = next.comments.filter((one) => one.id !== input.comment)
  } else throw bad('Unknown comment action.')
  if (next.comments.length > 1000) throw bad('A thread holds at most 1000 comments.')
  return next
}

/** Only mark ids are read; removing the final mark leaves the separately stored thread intact. */
export const commentMarks = (value: unknown): Set<string> => {
  const ids = new Set<string>()
  let remaining = richTextBounds.nodes
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth <= 0 || remaining-- <= 0) return
    const node = value as { type?: string; ids?: unknown; children?: unknown[] }
    if (node.type === 'mark' && Array.isArray(node.ids)) for (const id of node.ids) if (typeof id === 'string') ids.add(id.toLowerCase())
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child, depth - 1)
  }
  walk((value as { root?: unknown } | null)?.root, richTextBounds.depth)
  return ids
}

export type CommentRuntime = {
  kayans: ReadonlyMap<string, ResolvedKayan>
  storeOf: (kayan: ResolvedKayan) => Store
  read: (args: { kayan: string; id: string | number; actor: unknown }) => Promise<Record<string, unknown> | null>
  authorize: Authorize
  admin?: ManagedAdmin
  tenantOf: (actor: unknown) => string | undefined
  audit: AuditHandler
  maxBodyBytes: number
  onError: (error: unknown) => void
  trustedOrigin: (args: { request: Request; actor: unknown }) => Promise<boolean>
  context?: RichTextCommentOptions['context']
}

/** A core sidecar uses the record's normal read and update gates, including the field gate. */
export const commentService = (runtime: CommentRuntime) => {
  const call = async ({ kayan: name, id, field: fieldName, actor, input, page = 1 }: { kayan: string; id: string; field: string; actor: unknown; input?: CommentInput; page?: number }) => {
    const context: Context = running.getStore()?.context ?? { source: 'local', depth: 0, chain: [] }
    const kayan = runtime.kayans.get(name)
    const field = kayan?.fields[fieldName]
    const policy = field?.richTextPolicy
    const tenant = runtime.tenantOf(actor)
    if (!kayan || !field || !policy?.comments || !(field.features ?? policy.features).includes('comments') || !tenant) throw absent()
    const threads = runtime.kayans.get(policy.comments.threads)
    if (!threads?.tenant || threads.store !== kayan.store) throw new Error('Comment threads need the record store and a tenant field.')
    const recordId = kayan.fields.id?.kind === 'number' ? Number(id) : id
    const visible = await runtime.read({ kayan: name, id: recordId, actor })
    if (!visible || !Object.hasOwn(visible, fieldName)) throw absent()
    const store = runtime.storeOf(kayan)
    const where: Where = { and: [{ [threads.tenant]: { equals: tenant } }, { recordKayan: { equals: name } }, { recordId: { equals: String(visible.id) } }, { field: { equals: fieldName } }] }
    if (!input) {
      if (!Number.isSafeInteger(page) || page < 1 || page > Math.floor(Number.MAX_SAFE_INTEGER / 100)) throw bad('Invalid comments page.')
      const found = await store.find({ kayan: threads.name, args: { limit: 100, page, sort: { field: 'createdAt', direction: 'asc' }, where } })
      const marks = commentMarks(visible[fieldName])
      return { ...found, docs: found.docs.map((thread) => ({ ...thread, orphaned: !marks.has(String(thread.id)) })) }
    }
    const author = actor && typeof actor === 'object' && 'id' in actor && typeof actor.id === 'string' ? actor.id : undefined
    if (!author) throw denied({ message: 'A signed-in author is required.', key: 'error.forbidden.comment_author' })
    const access = await runtime.authorize({ admin: runtime.admin, actor, data: { id: visible.id, [fieldName]: visible[fieldName] }, effect: 'update', kind: 'update', kayan, operation: 'update' })
    return store.transaction(async (tx) => {
      // The record lock serializes comments with record deletion and access-changing updates.
      const record = (await store.find({ tx, kayan: name, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock: 'share', where: combineWhere({ id: { equals: visible.id as string } }, access) } })).docs[0]
      if (!record) throw absent()
      const fresh = await running.run({ user: actor, context, transactions: new Map([[store, { tx, operation: 'comments' }]]) }, () => runtime.read({ kayan: name, id: recordId, actor }))
      if (!fresh || !Object.hasOwn(fresh, fieldName)) throw absent()
      const writeField = field.access?.update
      if (writeField && !await (writeField as FieldAccess)({ user: actor, id: record.id, doc: record, data: { [fieldName]: record[fieldName] }, siblingData: record })) throw denied({ message: 'This field cannot be commented on.', key: 'error.forbidden.field_write' })
      let before: Record<string, unknown> | undefined
      let data: Record<string, unknown>
      const now = new Date()
      if (input.action === 'create') {
        if (typeof input.quote !== 'string' || !input.quote || input.quote.length > 4000 || !isStorableText(input.quote)) throw bad('Select 1 to 4000 characters to comment on.')
        data = { id: randomUUID(), [threads.tenant!]: tenant, recordKayan: name, recordId: String(record.id), field: fieldName, quote: input.quote, resolved: false, comments: [commentOf({ author, text: input.text })], createdAt: now, updatedAt: now }
      } else {
        before = (await store.find({ tx, kayan: threads.name, args: { limit: 1, page: 1, lock: 'update', sort: { field: 'id', direction: 'asc' }, where: combineWhere(where, { id: { equals: input.thread ?? '' } }) } })).docs[0]
        if (!before) throw absent()
        const next = nextCommentThread({ thread: before as unknown as CommentThread, input, author })
        if (before.resolved === next.resolved && JSON.stringify(before.comments) === JSON.stringify(next.comments)) return before
        data = { comments: next.comments, resolved: next.resolved, updatedAt: now }
      }
      if (Buffer.byteLength(JSON.stringify(data.comments), 'utf8') > Number(threads.fields.comments?.maxBytes)) throw bad('This thread has reached its declared storage limit.')
      const after = before ? await store.update({ tx, kayan: threads.name, id: before.id, data, where }) : await store.insert({ tx, kayan: threads.name, data })
      // The configured sink shares the write transaction; an audit failure rolls the comment back.
      await runtime.audit({ effect: before ? 'update' : 'create', kayan: threads, operation: input.action, dataBefore: before, dataAfter: after, store, tx, user: actor, context: { ...context, depth: context.depth + 1, chain: [...context.chain, `${threads.name}.${input.action}`] } })
      return after
    })
  }
  return {
    call,
    handle: async (request: Request, who: () => Promise<unknown>): Promise<Response | null> => {
      const url = new URL(request.url)
      if (!url.pathname.startsWith('/api/rich-text/comments/')) return null
      try {
        const parts = url.pathname.slice('/api/rich-text/comments/'.length).split('/').map(decodeURIComponent)
        if (parts.length !== 3 || parts.some((part) => !part || part.length > 255)) throw bad('A comment names a record and field.')
        if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405 })
        const actor = await who()
        let input: CommentInput | undefined
        if (request.method === 'POST') {
          if (!await runtime.trustedOrigin({ request, actor })) throw denied({ message: 'The request origin is not this host.', key: 'error.forbidden.origin' })
          const body = await boundedBody(request, runtime.maxBodyBytes)
          if (body instanceof Response) return body
          const value: unknown = JSON.parse(await body.text())
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['action', 'thread', 'comment', 'text', 'quote'].includes(key))) throw bad('Invalid comment input.')
          input = value as CommentInput
          if (!['create', 'reply', 'edit', 'delete', 'resolve', 'reopen'].includes(input.action) || input.action !== 'create' && input.thread === undefined || [input.thread, input.comment].some((id) => id !== undefined && (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) throw bad('Invalid comment action or id.')
        }
        const extra = await runtime.context?.({ request, actor })
        const answer = await running.run({ user: actor, context: { source: 'local', ...extra, depth: 0, chain: [] } }, () => call({ kayan: parts[0]!, id: parts[1]!, field: parts[2]!, actor, input, page: Number(url.searchParams.get('page') ?? 1) }))
        return Response.json(answer, { headers: { 'Cache-Control': 'private, no-store' } })
      } catch (error) {
        if (error instanceof AsasError) return refusal(error)
        if (error instanceof SyntaxError || error instanceof URIError) return refusal(bad('Invalid comment input.'))
        runtime.onError(error)
        return Response.json({ message: 'Internal server error' }, { status: 500 })
      }
    },
  }
}
