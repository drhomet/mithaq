// What the courses list draws when it holds no row, and what the board page
// draws by path: the same file under a registered name and an inline path.
import type { EmptyProps } from 'mithaq/admin'
import { useKayan, useLocale } from 'mithaq/admin/react'

export function NoCourses({ page }: EmptyProps) {
  const { t } = useLocale()
  return (
    <p data-empty={`${useKayan().name}${page.path}`} className="text-muted-foreground text-sm">
      {t('courses.none', 'No courses yet.')}
    </p>
  )
}
