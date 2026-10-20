import { createContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Ellipsis } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Translate } from 'mithaq-admin/copy.ts'

/** A breadcrumb already supplies the exit an autosaving form would otherwise draw. */
export const PageBreadcrumb = createContext(false)

/** A form supplies its responsive bar so secondary actions follow its Save and Publish buttons. */
export const PageActionTarget = createContext<((element: HTMLSpanElement | null) => void) | undefined>(undefined)

/** Secondary actions stay beside the primary action and retain their own confirmations. */
export function MoreActions({ children, t }: { children?: ReactNode; t: Translate }) {
  if (!children) return null
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" aria-label={t('admin.moreActions', 'More actions')} />}>
        <Ellipsis aria-hidden="true" />
        {t('admin.more', 'More')}
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t('admin.moreActions', 'More actions')} className="flex w-64 flex-col items-stretch gap-2 p-2 [&_button]:w-full [&_button]:justify-start">
        {children}
      </PopoverContent>
    </Popover>
  )
}

/** One header contract for a list or record, with status above the page's tabs. */
export function PageHeader({ breadcrumb, children, more, primary, t, title }: {
  breadcrumb?: { href: string; label: string }
  title?: ReactNode
  primary?: ReactNode
  more?: ReactNode
  children?: ReactNode
  t: Translate
}) {
  const [actionTarget, setActionTarget] = useState<HTMLSpanElement | null>(null)
  const secondary = <MoreActions t={t}>{more}</MoreActions>
  return (
    <PageActionTarget value={setActionTarget}>
      <PageBreadcrumb value={!!breadcrumb}>
        <div data-page-header="" className="flex min-w-0 flex-1 flex-col gap-2">
          {breadcrumb ? (
            <a href={breadcrumb.href} data-back="" className="text-muted-foreground flex w-fit items-center gap-1.5 text-sm hover:text-foreground min-h-11 sm:min-h-0">
              <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              <span>{breadcrumb.label}</span>
            </a>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {title}
            {children}
            {primary || more ? <div data-header-actions="" className="ms-auto flex items-center gap-2">{primary}{actionTarget ? createPortal(secondary, actionTarget) : secondary}</div> : null}
          </div>
        </div>
      </PageBreadcrumb>
    </PageActionTarget>
  )
}
