import type { EmptyProps } from 'mithaq/admin'
import { useKayan, useLocale } from 'mithaq/admin/react'

export function NoCourses({ page }: EmptyProps) {
  const { t } = useLocale()
  return (
    <p data-empty={`${useKayan().name}${page.path}`} className="text-muted-foreground text-sm">
      {t('courses.noneOnOffer', 'No courses on offer yet.')}
    </p>
  )
}
