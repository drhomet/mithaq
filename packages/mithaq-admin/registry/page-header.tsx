import type { ReactNode } from 'react'
import { ArrowLeft, Ellipsis } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Translate } from 'mithaq-admin/copy.ts'

/** Secondary actions stay beside the primary action and retain their own confirmations. */
export function MoreActions({ children, t }: { children?: ReactNode; t: Translate }) {
  if (!children) return null
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className="max-sm:min-h-11" aria-label={t('admin.moreActions', 'More actions')} />}>
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
export function PageHeader({ breadcrumb, children, more, primary, status, t, title }: {
  breadcrumb?: { href: string; label: string }
  title?: ReactNode
  status?: ReactNode
  primary?: ReactNode
  more?: ReactNode
  children?: ReactNode
  t: Translate
}) {
  return (
    <div data-page-header="" className="flex min-w-0 flex-1 flex-col gap-2">
      {breadcrumb ? (
        <a href={breadcrumb.href} data-back="" className="text-muted-foreground flex w-fit items-center gap-1.5 text-sm hover:text-foreground max-sm:min-h-11">
          <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          <span>{breadcrumb.label}</span>
        </a>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {title}
        {status ? <span data-header-status="" className="rounded-md bg-muted px-2 py-0.5 text-xs">{status}</span> : null}
        {children}
        {primary || more ? <div className="ms-auto flex flex-wrap items-center gap-2">{primary}<MoreActions t={t}>{more}</MoreActions></div> : null}
      </div>
    </div>
  )
}
