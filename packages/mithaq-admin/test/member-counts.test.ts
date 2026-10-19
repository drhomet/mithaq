import assert from 'node:assert/strict'
import { test } from 'node:test'
import { memberCounts } from '../registry/member-counts.ts'

test('role counts page both authorized reads, deduplicate assignments and include implicit owners', async () => {
  const asked: string[] = []
  const counts = await memberCounts({
    maxLimit: 1,
    ownerRole: 'administrator',
    request: async (path) => {
      asked.push(path)
      const offset = Number(new URL(path, 'http://test').searchParams.get('offset'))
      return Response.json({ members: [[{ userId: 'owner', role: 'owner' }], [{ userId: 'person', role: 'member' }]][offset] ?? [], total: 2 })
    },
    client: async ({ kayan, input }) => {
      assert.equal(kayan, 'memberRoles', 'no shared-user lookup')
      const rows = [{ user: 'owner', role: 'administrator' }, { user: 'person', role: 'teacher' }, { user: 'person', role: 'teacher' }, { user: 'outsider', role: 'teacher' }]
      return { docs: rows.slice(Number(input?.page) - 1, Number(input?.page)), totalDocs: rows.length }
    },
  })
  assert.deepEqual({ ...counts }, { administrator: 1, teacher: 1 })
  assert.equal(asked.length, 2)
})

test('a refused provider read leaves role counts unavailable rather than reporting zero', async () => {
  await assert.rejects(memberCounts({ maxLimit: 10, ownerRole: 'administrator', request: async () => new Response(null, { status: 403 }), client: async () => { throw new Error('must not read assignments') } }), /list-members answered 403/)
})

for (const field of ['user', 'role']) test(`a masked assignment ${field} leaves role counts unavailable`, async () => {
  const row: Record<string, string> = { user: 'person', role: 'teacher' }
  delete row[field]
  await assert.rejects(memberCounts({
    maxLimit: 10, ownerRole: 'administrator',
    request: async () => Response.json({ members: [{ userId: 'person', role: 'member' }], total: 1 }),
    client: async () => ({ docs: [row], totalDocs: 1 }),
  }), /unreadable assignment/)
})
