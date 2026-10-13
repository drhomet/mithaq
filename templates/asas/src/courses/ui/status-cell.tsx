// The list reads each row's latest draft, so a published course whose newest version is a draft
// and a never-published course both arrive as `draft`. The plain read finds only courses with a
// published copy, which tells the two apart.
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CellProps, Row } from 'mithaq/admin'
import { ListContext, useClient, useLocale, useScreen } from 'mithaq/admin/react'
import { Badge } from '@/components/ui/badge'
import { noValue } from 'mithaq-admin/format.tsx'
import { coursesOf } from '../../enrollments/ui/session-cell.tsx'

const pills = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  changed: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}
const words = { draft: 'Draft', published: 'Published', changed: 'Changed' }

export function StatusCell({ value, row }: CellProps) {
  const client = useClient()
  const { t } = useLocale()
  const { maxLimit } = useScreen()
  // Sorted, so the same rows in another order are the same query.
  const ids = [...new Set((use(ListContext)?.page.docs ?? [row]).flatMap((one: Row) => (one._status === 'draft' ? [String(one.id)] : [])))].sort()
  const { data: published, isError } = useQuery({ queryKey: ['status-cell', ids], queryFn: () => coursesOf({ client, ids, maxLimit }), enabled: ids.length > 0, staleTime: 30_000 })
  if (value !== 'draft' && value !== 'published') return noValue
  // Loading until the read answers, and a draft where it failed, which is what the row itself holds.
  if (value === 'draft' && !published && !isError) return t('admin.loading', 'Loading…')
  const status = value === 'draft' && published?.has(String(row.id)) ? 'changed' : value
  return <Badge data-status={status} className={pills[status]}>{t(`version.${status}`, words[status])}</Badge>
}
