// The edit page's header pill for an archived course, beside the title and the
// draft status, so a course out of the catalogue says so on every tab.
import { useLocale } from 'mithaq/admin/react'
import { Badge } from '@/components/ui/badge'

export function ArchivedBadge() {
  const { t } = useLocale()
  return <Badge data-status="archived" className="bg-destructive/10 text-destructive">{t('version.archived', 'Archived')}</Badge>
}
