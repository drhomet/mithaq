// What the Members page and the dashboard's Members card both read: the members of the viewer's organization with their
// roles, and the roles a member may hold, read as the viewer. Its own module, so the dashboard's home carries the card
// and not the page.
import { Users } from 'lucide-react'
import { holds, type LoaderTools } from 'mithaq/admin'
import { useLocale } from 'mithaq/admin/react'
import { isOwner, OWNER_ROLE } from '@asas/mithaq/roles/grants.ts'
import { tenantRoles } from '@asas/mithaq/roles/tenant-roles.ts'
import { KpiCard } from '@asas/mithaq/ui/kpi-card.tsx'

/**
 * One member as the page draws it: each role assignment by its row, whether they own the organization, which holds
 * `administrator` whatever the rows say, and when they were last seen, where the viewer may read it.
 */
export type Member = { userId: string; name: string; email: string; joined: string; lastSeen?: string; owner: boolean; roles: { id: string; role: string }[] }
/**
 * One role the drawer offers: its label in every locale, whether this project ships it, and its keys, which a fixed role's
 * code always says and a custom role's row says where the viewer may read them.
 */
export type Role = { name: string; label?: Readonly<Record<string, string>>; fixed: boolean; permissions?: readonly string[] }
/** An ISO timestamp, or `''` for a value that does not parse: `toISOString()` throws on an invalid date, and a row with no readable date is still worth drawing. */
export const isoOf = (value: unknown): string => {
  const when = new Date(value as string)
  return value === null || value === undefined || Number.isNaN(when.getTime()) ? '' : when.toISOString()
}

/**
 * Every row of a read that answers a page at a time, read until the total is reached: an organization outgrows any one
 * page, and a page that drew the first hundred would leave the rest out without a word.
 *
 * The pages are offsets, so a row added or removed between two reads shifts the next page: a row then comes back twice,
 * and is kept once by `key`, or is missed until the page loads again.
 */
// ponytail: every member is read and drawn at once, by offset; page the table itself, by a cursor, once an organization's size makes the page slow.
export const everyPage = async <Row,>({ read, key }: { read: (offset: number) => Promise<{ rows: Row[]; total: number }>; key: (row: Row) => string }): Promise<Row[]> => {
  const rows = new Map<string, Row>()
  for (let offset = 0; ; ) {
    const page = await read(offset)
    for (const row of page.rows) if (!rows.has(key(row))) rows.set(key(row), row)
    offset += page.rows.length
    if (!page.rows.length || offset >= page.total) return [...rows.values()]
  }
}

/** The members with their roles, and the roles a member may hold: what the page and the dashboard's card both read. */
export const readMembers = async ({ access, client, request, maxLimit }: LoaderTools): Promise<{ members: Member[]; roles: Role[] }> => {
  const [members, assignments, roles] = await Promise.all([
    everyPage({
      key: (member) => member.userId,
      read: async (offset: number) => {
        // In id order, which no change to a member's other columns reorders.
        const response = await request(`/api/auth/user/organization/list-members?limit=${maxLimit}&offset=${offset}&sortBy=id`)
        if (!response.ok) throw new Error(`list-members answered ${response.status}`)
        const page = (await response.json()) as { members: { userId: string; role: string; createdAt: string; lastSeenAt?: string | null; user: { name: string; email: string } }[]; total: number }
        return { rows: page.members, total: page.total }
      },
    }),
    // The page is served on `member.find`, so a viewer may list the members
    // and not read who holds which role.
    holds(access, 'memberRoles.find')
      ? everyPage({
          key: (row) => row.id,
          read: async (offset: number) => {
            const page = (await client({ kayan: 'memberRoles', operation: 'find', input: { limit: maxLimit, page: Math.ceil(offset / maxLimit) + 1, depth: 0 } })) as { docs: { id: string; user: string; role: string }[]; totalDocs: number }
            return { rows: page.docs, total: page.totalDocs }
          },
        })
      : [],
    // Asked only of a viewer the report lets read roles, so the page still
    // draws for one who may read the assignments and not the roles.
    holds(access, 'roles.find')
      ? (client({ kayan: 'roles', operation: 'find', input: { limit: maxLimit, depth: 0, sort: 'name' } }) as Promise<{ docs: { name: string; label?: Record<string, string> | null; permissions?: unknown }[] }>)
      : { docs: [] },
  ])
  return {
    members: [...members].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      joined: isoOf(member.createdAt),
      // Answered only to a viewer holding the column's key; the server leaves it out for anyone else.
      ...(member.lastSeenAt && { lastSeen: isoOf(member.lastSeenAt) }),
      owner: isOwner(member.role),
      roles: assignments.filter((row) => row.user === member.userId).map((row) => ({ id: String(row.id), role: row.role })),
    })),
    roles: [
      ...Object.entries(tenantRoles).map(([name, role]): Role => ({ name, label: role.label, fixed: true, permissions: role.permissions === '*' ? ['*'] : role.permissions })),
      ...roles.docs.map((row): Role => ({
        name: row.name,
        ...(row.label && { label: row.label }),
        fixed: false,
        ...(Array.isArray(row.permissions) && { permissions: row.permissions as string[] }),
      })),
    ],
  }
}

/** The dashboard's Members card: how many work here and, to a reader of the assignments, how many hold each role. */
export type MembersFigures = { total: number; held?: { role: string; label?: Readonly<Record<string, string>>; count: number }[] }

/**
 * The card's figures, read as the viewer, and nothing for a viewer who may not list the members or whose read failed,
 * so the home still draws. An owner holds `administrator` whatever the rows say, as the server reads them.
 */
export const membersFigures = async (tools: LoaderTools): Promise<MembersFigures | undefined> => {
  if (!holds(tools.access, 'member.find')) return undefined
  const read = await readMembers(tools).catch(() => undefined)
  if (!read) return undefined
  if (!holds(tools.access, 'memberRoles.find')) return { total: read.members.length }
  const counts = new Map<string, number>()
  for (const member of read.members) {
    for (const role of new Set([...member.roles.map((one) => one.role), ...(member.owner ? [OWNER_ROLE] : [])])) counts.set(role, (counts.get(role) ?? 0) + 1)
  }
  const order = read.roles.map((role) => role.name)
  return {
    total: read.members.length,
    held: [...counts]
      .sort(([a], [b]) => (order.indexOf(a) >>> 0) - (order.indexOf(b) >>> 0))
      .map(([role, count]) => {
        const label = read.roles.find((one) => one.name === role)?.label
        return { role, ...(label && { label }), count }
      }),
  }
}

export function MembersCard({ figures, href }: { figures: MembersFigures; href: string }) {
  const { locale, t } = useLocale()
  const number = new Intl.NumberFormat(locale)
  return (
    <KpiCard
      kpi="members"
      icon={<Users className="size-4" />}
      title={t('dashboard.members', 'Members')}
      value={number.format(figures.total)}
      footer={
        <span className="grid gap-1">
          {figures.held?.length ? (
            <span data-members-held="">
              {figures.held.map((one) => `${number.format(one.count)} ${one.label?.[locale] ?? one.role}`).join(' · ')}
            </span>
          ) : null}
          <a href={href} className="text-foreground inline-flex items-center hover:underline max-sm:min-h-11">{t('portal.open', 'Open the list')}</a>
        </span>
      }
    />
  )
}
