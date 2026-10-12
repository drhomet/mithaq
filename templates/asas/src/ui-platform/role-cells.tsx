// The two role columns the platform lists, each named in the viewer's locale
// where the column holds a slug, so an Arabic page reads no English word and
// no slug for them.
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CellProps, Row } from 'mithaq/admin'
import { ListContext, useClient, useLocale, useScreen } from 'mithaq/admin/react'
import type { asas } from '../asas.ts'
import { listed, refusalKeyOf } from '@/components/mithaq/controls.tsx'
import { systemRoles } from '../roles.ts'

/**
 * A membership's role, which is the provider's own governance role, `owner`,
 * `admin` or `member`, several of them comma-joined, each by the project's word for it.
 */
export function MembershipRole({ value }: CellProps) {
  const { locale, t } = useLocale()
  if (typeof value !== 'string' || !value) return null
  return listed(value.split(',').map((one) => t(`platform.membership.${one.trim()}`) ?? one.trim()), locale)
}

/**
 * A business role an assignment names by its slug, by its label: a fixed
 * role's from its code, and a custom role's from its row of the assignment's own tenant, one read for
 * every custom slug the page's rows name, shared through the query client as
 * the session column shares its own. A role the viewer may not read keeps its
 * slug, the one thing the column holds.
 */
export function RoleName({ value, row }: CellProps) {
  const client = useClient<typeof asas.router>()
  const { locale } = useLocale()
  const { maxLimit } = useScreen()
  const slugs = [...new Set((use(ListContext)?.page.docs ?? [row]).flatMap((one: Row) => (typeof one.role === 'string' && !Object.hasOwn(systemRoles, one.role) ? [one.role] : [])))].sort()
  const { data: custom } = useQuery({
    queryKey: ['role-name', slugs],
    queryFn: () =>
      client({ kayan: 'roles', operation: 'find', input: { where: { name: { in: slugs } }, limit: maxLimit } }).then(
        (found) => found.docs,
        (thrown: unknown) => {
          if (refusalKeyOf(thrown)) return []
          throw thrown
        },
      ),
    enabled: slugs.length > 0,
    staleTime: 30_000,
  })
  if (typeof value !== 'string') return null
  const label: Record<string, string> | undefined = Object.hasOwn(systemRoles, value)
    ? systemRoles[value as keyof typeof systemRoles].label
    : (custom?.find((one) => one.name === value && one.organization === row.organization)?.label as Record<string, string> | undefined)
  return label?.[locale] ?? value
}
