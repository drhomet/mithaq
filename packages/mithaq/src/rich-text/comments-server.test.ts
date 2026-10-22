import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextCommentThread } from './comments-server.ts'

const actor = 'dummy-author'
const base = { id: 'dummy-thread', resolved: false, quote: 'مرحبا', comments: [{ id: 'dummy-comment', author: actor, text: 'Original', createdAt: '2026-10-22T00:00:00.000Z' }] }

test('authors alone edit or delete their own comments, while record writers reply and resolve', () => {
  assert.throws(() => nextCommentThread({ thread: base, input: { action: 'edit', comment: 'dummy-comment', text: 'Changed' }, author: 'other' }), /own comments/)
  assert.throws(() => nextCommentThread({ thread: base, input: { action: 'delete', comment: 'dummy-comment' }, author: 'other' }), /own comments/)
  const reply = nextCommentThread({ thread: base, input: { action: 'reply', text: 'رد' }, author: 'other' })
  assert.equal(reply.comments.length, 2)
  assert.equal(reply.comments[1]!.author, 'other')
  assert.equal(nextCommentThread({ thread: base, input: { action: 'resolve' }, author: 'other' }).resolved, true)
  assert.equal(nextCommentThread({ thread: { ...base, resolved: true }, input: { action: 'reopen' }, author: 'other' }).resolved, false)
  assert.equal(nextCommentThread({ thread: base, input: { action: 'edit', comment: 'dummy-comment', text: 'Changed' }, author: actor }).comments[0]!.text, 'Changed')
  assert.equal(nextCommentThread({ thread: base, input: { action: 'delete', comment: 'dummy-comment' }, author: actor }).comments.length, 0)
  assert.equal(base.comments[0]!.text, 'Original')
})
