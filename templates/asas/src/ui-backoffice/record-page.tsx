// The backoffice's record page: the shared one under a link back to the list the
// record belongs to, so a person's page, an organization's and a role's are never
// a dead end. The link is named as the nav names the list, which is already the
// viewer's own word for it.
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { LayoutProps } from 'mithaq/admin'
import { useKayan, useLocale, useScreen } from 'mithaq/admin/react'
import { RecordPage } from '@asas/mithaq/ui/record-page.tsx'
import { navLabel } from '@asas/mithaq/ui/screen-nav.tsx'

export const regions = ['main', 'side', 'danger'] as const

export function BackofficeRecordPage(props: LayoutProps<readonly ['main', 'side', 'danger'], ReactNode>) {
  const { locale, t } = useLocale()
  const screen = useScreen()
  const kayan = useKayan()
  const list = screen.nav.find((entry) => entry.kayan === kayan.name)
  return (
    <div className="grid gap-4">
      {list ? (
        <a href={`${screen.path}${list.path}`} data-back="" className="inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4 max-sm:min-h-11">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          <span>{navLabel({ entry: list, screen, locale, t })}</span>
        </a>
      ) : null}
      <RecordPage {...props} />
    </div>
  )
}
