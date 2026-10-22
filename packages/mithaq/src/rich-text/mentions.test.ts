import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultNodes, richText } from './index.ts'

const document = (node: object) => ({ root: { type: 'root', children: [{ type: 'paragraph', children: [node] }] } })
const mention = { type: 'mention', kayan: 'tags', id: 'dummy-tag', name: 'وسم', text: '@وسم', version: 1 }

test('mentions accept declared sources only and cannot enable an uninstalled feature', () => {
  const kind = richText({ nodes: defaultNodes, features: ['mentions'], mentionSources: [{ kayan: 'tags', title: 'name' }] }).kinds.richText
  const schema = kind.targets.zod()
  assert.equal(schema.safeParse(document(mention)).success, true)
  assert.equal(schema.safeParse(document({ ...mention, kayan: 'user' })).success, false)
  assert.equal(schema.safeParse(document({ ...mention, id: '' })).success, false)
  assert.equal(schema.safeParse(document({ ...mention, name: '<script>', text: '@other' })).success, false)
  assert.equal(richText({ nodes: defaultNodes }).kinds.richText.targets.zod().safeParse(document(mention)).success, false)
  assert.equal(kind.targets.zod({ name: 'body', column: 'body', kind: 'richText', features: [] }).safeParse(document(mention)).success, false)
})

test('emoji stays ordinary text and hashtags carry only their tagged text', () => {
  const schema = richText({ nodes: defaultNodes, features: ['mentions'] }).kinds.richText.targets.zod()
  for (const node of [{ type: 'text', text: 'مرحبا 😀' }, { type: 'hashtag', text: '#مرحبا_بكم', version: 1 }]) {
    const value = document(node)
    assert.deepEqual(schema.parse(value), value)
  }
  assert.equal(schema.safeParse(document({ type: 'emoji', text: '😀' })).success, false)
  assert.equal(schema.safeParse(document({ type: 'hashtag', text: '#مرحبا بكم' })).success, false)
})

test('comment marks refuse embedded comments, unrelated metadata and multiple thread ids', () => {
  const schema = richText({ nodes: defaultNodes, features: ['comments'], comments: { threads: 'threads' } }).kinds.richText.targets.zod()
  const mark = { type: 'mark', ids: ['11111111-1111-4111-8111-111111111111'], children: [{ type: 'text', text: 'Selected text' }] }
  assert.equal(schema.safeParse(document(mark)).success, true)
  for (const node of [{ ...mark, comment: 'Embedded text' }, { ...mark, author: 'someone' }, { ...mark, ids: [...mark.ids, '22222222-2222-4222-8222-222222222222'] }, { ...mark, ids: ['arbitrary'] }]) assert.equal(schema.safeParse(document(node)).success, false)
  assert.equal(richText({ nodes: defaultNodes }).kinds.richText.targets.zod().safeParse(document(mark)).success, false)
})

test('a legacy custom mention without record identity stays unreadable instead of being rewritten', async () => {
  const { MentionNode, richTextReader } = await import('./index.ts')
  assert.ok('refused' in richTextReader([...defaultNodes, MentionNode])(document({ type: 'mention', name: 'Huda', text: 'Huda' })))
})


test('hashtags round trip the full-width hash, ZWNJ and Japanese iteration mark emitted by Lexical', () => {
  const schema = richText({ nodes: defaultNodes, features: ['mentions'] }).kinds.richText.targets.zod()
  for (const text of ['＃مرحبا', '#می\u200cخواهم', '#〃', '#۞', '＃日本語_123']) {
    const value = document({ type: 'hashtag', text, version: 1 })
    assert.deepEqual(schema.parse(value), value)
  }
  for (const text of ['#', '＃', '#two words', '#bad!', '#😀']) assert.equal(schema.safeParse(document({ type: 'hashtag', text })).success, false, text)
})
