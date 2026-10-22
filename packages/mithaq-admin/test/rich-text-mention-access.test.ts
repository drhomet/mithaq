import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mentionHref } from '../registry/rich-text-mention-access.ts'

test('a mention links only after the reader opens that record through its managed operation', async () => {
  const screen = { path: '/dashboard', kayan: { tags: { pages: { edit: { path: '/tags/:id' } } } } } as any
  const mention = { kayan: 'tags', id: 'dummy/tag', name: 'اسم قديم' }
  const client = async (args: unknown) => { assert.deepEqual(args, { kayan: 'tags', operation: 'findByID', input: { id: 'dummy/tag', depth: 0 } }); return { id: mention.id } }
  assert.equal(await mentionHref({ mention, screen, client: client as any }), '/dashboard/tags/dummy%2Ftag')
  assert.equal(await mentionHref({ mention, screen, client: (async () => { throw new Error('Forbidden') }) as any }), undefined)
  assert.equal(await mentionHref({ mention, screen, client: (async () => null) as any }), undefined)
})

test('a numeric record id is read in the source kayan id kind', async () => {
  const screen = { path: '/dashboard', kayan: { tags: { fields: [{ name: 'id', kind: 'number' }], pages: { edit: { path: '/tags/:id' } } } } } as any
  const client = async (args: any) => { assert.equal(args.input.id, 12); return { id: 12 } }
  assert.equal(await mentionHref({ mention: { kayan: 'tags', id: '12', name: 'Twelve' }, screen, client: client as any }), '/dashboard/tags/12')
})

test('organization member links require a fresh managed read and their member page permission', async () => {
  const screen = { path: '/dashboard', kayan: {}, pages: { member: { path: '/members/:id', permission: 'member.find' } } } as any
  const mention = { kayan: 'member', id: 'dummy-member', name: 'Original name' }
  const sources = [{ kayan: 'member', title: 'userId.name', members: 'user', page: 'member' }]
  let managed = 0
  const client = async (args: unknown) => {
    managed++
    assert.deepEqual(args, { kayan: 'member', operation: 'findByID', input: { id: 'dummy-member', depth: 1 } })
    return { id: 'dummy-member', userId: { id: 'dummy/user', name: 'Readable name' } }
  }
  const fetchBefore = globalThis.fetch
  globalThis.fetch = (async () => Response.json({ members: [{ id: 'dummy-member', userId: 'dummy/user' }] })) as typeof fetch
  const options = { mention, screen, sources, client: client as any, access: { permissions: ['member.find'] } }
  try {
    assert.equal(await mentionHref(options), '/dashboard/members/dummy%2Fuser')
    assert.equal(managed, 1)
    assert.equal(await mentionHref({ ...options, access: { permissions: [] } }), undefined)
    assert.equal(await mentionHref({ ...options, client: (async () => { throw new Error('Managed row denied') }) as any }), undefined)
    assert.equal(await mentionHref({ ...options, client: (async () => ({ id: 'dummy-member' })) as any }), undefined)
  } finally { globalThis.fetch = fetchBefore }
})
