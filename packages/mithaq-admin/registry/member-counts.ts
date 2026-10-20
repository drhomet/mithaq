import type { LoaderTools } from 'mithaq/admin'

/** Provider membership is the authority, so stale assignments and implicit owners count correctly. */
export const memberCounts = async ({ client, request, maxLimit, ownerRole }: Pick<LoaderTools, 'client' | 'request' | 'maxLimit'> & { ownerRole: string }): Promise<Record<string, number>> => {
  const members = new Map<string, Set<string>>()
  for (let offset = 0; ; ) {
    const response = await request(`/api/auth/user/organization/list-members?limit=${maxLimit}&offset=${offset}&sortBy=id`)
    if (!response.ok) throw new Error(`list-members answered ${response.status}`)
    const found = await response.json() as { members: { userId: string; role: string }[]; total: number }
    for (const member of found.members) members.set(member.userId, new Set(member.role.split(',').includes('owner') ? [ownerRole] : []))
    offset += found.members.length
    if (!found.members.length || offset >= found.total) break
  }
  for (let page = 1; ; page++) {
    const found = await client({ kayan: 'memberRoles', operation: 'find', input: { limit: maxLimit, page, depth: 0 } }) as { docs: { user: string; role: string }[]; totalDocs: number }
    for (const row of found.docs) {
      if (typeof row.user !== 'string' || typeof row.role !== 'string') throw new Error('unreadable assignment')
      members.get(row.user)?.add(row.role)
    }
    if (!found.docs.length || page * maxLimit >= found.totalDocs) break
  }
  const counts: Record<string, number> = Object.create(null)
  for (const roles of members.values()) for (const role of roles) counts[role] = (counts[role] ?? 0) + 1
  return counts
}
