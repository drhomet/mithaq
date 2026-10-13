import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AccessReport, LoaderTools } from '../../../../packages/mithaq/src/screen/client.ts'
// The JSX loader `.tsx` files need under plain `node --test`.
import '../../../../packages/mithaq-admin/test/tsx.ts'

const { loader } = await import('./members.tsx')
const { grantable, isOwner, managesRoles } = await import('../roles/grants.ts')
const { tenantRoles } = await import('../roles/tenant-roles.ts')

type Listed = { userId: string; role?: string; createdAt: string; user: { name: string; email: string } }

const tools = (members: Listed[], access: AccessReport = {}, rows: Record<string, unknown[]> = {}): LoaderTools & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    client: async ({ kayan }) => {
      asked.push(kayan)
      return { docs: rows[kayan] ?? [] }
    },
    request: async () => Response.json({ members }),
    access,
  }
}

test("a member whose createdAt does not parse draws empty rather than throwing and failing the whole page", async () => {
  const { members } = await loader(
    tools([
      { userId: '1', createdAt: '2026-01-01T00:00:00.000Z', user: { name: 'Sana', email: 'sana@example.com' } },
      { userId: '2', createdAt: 'not-a-date', user: { name: 'Omar', email: 'omar@example.com' } },
    ]),
  )
  assert.equal(members[0]!.joined, '2026-01-01T00:00:00.000Z', 'a valid createdAt is kept as an ISO timestamp')
  assert.equal(members[1]!.joined, '', 'an invalid createdAt draws empty instead of throwing')
})

const fixed = Object.entries(tenantRoles).map(([name, role]) => ({ name, label: role.label, fixed: true, permissions: role.permissions === '*' ? ['*'] : role.permissions }))

test('the loader answers the roles the sheet offers: every fixed one from its code, then the organization\'s own with the keys each holds, when the report lets the viewer read roles', async () => {
  const given = tools([], { collections: { roles: { operations: { find: true } } } }, {
    roles: [
      { id: 'b', name: 'teacher', label: { en: 'Teacher', ar: 'معلم' }, permissions: ['sessions.find'] },
      { id: 'c', name: 'unread', label: null },
    ],
  })
  const { roles } = await loader(given)
  assert.deepEqual(roles, [
    ...fixed,
    { name: 'teacher', label: { en: 'Teacher', ar: 'معلم' }, fixed: false, permissions: ['sessions.find'] },
    { name: 'unread', fixed: false },
  ], 'each custom one with the label its row holds, and none where it holds none')
  assert.ok(roles.some((role) => role.name === 'administrator' && role.fixed && role.permissions?.[0] === '*'), 'the administrator among them, holding every key')
})

test('the loader asks for no row of roles when the report does not let the viewer read roles, and still offers the fixed ones', async () => {
  const given = tools([], { collections: { roles: { operations: { find: false } } } })
  const { roles } = await loader(given)
  assert.deepEqual(roles, fixed)
  assert.ok(!given.asked.includes('roles'), 'and the server is never asked a read it would refuse')
})

test('a role is grantable only by a viewer holding every key it holds, the way the server measures an assignment', () => {
  const role = (permissions?: string[]) => permissions
  assert.equal(grantable({ permissions: '*' }, role(['courses.find'])), true, 'a root granter grants any role')
  assert.equal(grantable({ permissions: '*' }, role(['*'])), true, 'the administrator role included')
  assert.equal(grantable({ permissions: ['courses.find', 'tags.find'] }, role(['courses.find'])), true, 'a role inside what the viewer holds')
  assert.equal(grantable({ permissions: ['courses.find'] }, role(['courses.find', 'tags.find'])), false, 'not one holding a key the viewer lacks')
  assert.equal(grantable({ permissions: ['courses.find'] }, role(['*'])), false, 'nor one holding every key')
  assert.equal(grantable({ permissions: ['courses.find'] }, role()), false, 'nor one whose keys the viewer may not read')
  assert.equal(grantable({ permissions: [] }, role([])), true, 'and a role holding nothing is anyone\'s to hand over, as the server measures it')
})

test('a role manages roles when it holds every key or any key that changes a role or an assignment', () => {
  assert.equal(managesRoles('*'), true)
  assert.equal(managesRoles(['*']), true, 'the administrator row, whose column holds the one key')
  for (const key of ['roles.create', 'roles.update', 'roles.delete', 'memberRoles.create', 'memberRoles.update', 'memberRoles.delete']) assert.equal(managesRoles([key]), true, key)
  assert.equal(managesRoles(['roles.find', 'memberRoles.find', 'courses.delete']), false, 'reading roles or writing anything else manages nothing')
})

test('the loader marks the organization\'s owner, matched exactly the way the provider matches its role column', async () => {
  const { members } = await loader(
    tools([
      { userId: '1', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z', user: { name: 'Sana', email: 'sana@example.com' } },
      { userId: '2', role: 'admin, owner', createdAt: '2026-01-01T00:00:00.000Z', user: { name: 'Omar', email: 'omar@example.com' } },
      { userId: '3', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z', user: { name: 'Huda', email: 'huda@example.com' } },
    ]),
  )
  assert.deepEqual(members.map((member) => member.owner), [true, false, false], 'a spaced name is no owner, as the provider matches it')
  for (const role of ['admin,owner', 'owner,member']) assert.equal(isOwner(role), true, role)
  for (const role of ['owners', 'owner ', ' owner', 'Owner', 'member, owner', undefined]) assert.equal(isOwner(role), false, String(role))
})

test('the loader lists the invitations still pending to a viewer who may invite, and asks none of a viewer who may not', async () => {
  const asked: string[] = []
  const invited = [
    { id: 'i1', email: 'a@example.com', status: 'pending', expiresAt: '2099-10-14T00:00:00.000Z' },
    { id: 'i2', email: 'b@example.com', status: 'accepted', expiresAt: '2099-10-14T00:00:00.000Z' },
    { id: 'i3', email: 'c@example.com', status: 'canceled', expiresAt: '2099-10-14T00:00:00.000Z' },
    { id: 'i4', email: 'd@example.com', status: 'pending', expiresAt: '2000-10-14T00:00:00.000Z' },
  ]
  const given = (access: AccessReport, role = 'admin'): LoaderTools => ({
    client: async () => ({ docs: [] }),
    request: async (path) => {
      asked.push(path)
      return Response.json(path.includes('list-invitations') ? invited : path.includes('get-active-member-role') ? { role } : { members: [] })
    },
    access,
    maxLimit: 100,
  })
  const { invites } = await loader(given({ permissions: ['invitation.create'] }))
  assert.deepEqual(invites, [{ id: 'i1', email: 'a@example.com', expiresAt: '2099-10-14T00:00:00.000Z' }], 'the pending one alone, and not one that has expired')
  assert.ok((await loader(given({ permissions: ['invitation.create'] }, 'member,owner'))).invites, 'an owner invites too')
  for (const [said, access, role] of [
    ['a viewer without the key', { permissions: ['memberRoles.find'] }, 'admin'],
    ['a governance member, whom the provider refuses whatever the key', { permissions: ['invitation.create'] }, 'member'],
  ] as const) {
    asked.length = 0
    assert.equal((await loader(given(access, role))).invites, undefined, `${said} is offered no invitation`)
    assert.equal(asked.some((path) => path.includes('list-invitations')), false, `and the provider is not asked for ${said}`)
  }
})
