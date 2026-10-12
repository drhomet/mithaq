import { useEffect, useState, type ReactElement } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DirectionalIcon } from '@/components/ui/directional-icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Translate } from './controls.tsx'
import { useScreen } from 'mithaq/admin/react'
import { limitsUpTo } from './list-query.ts'

/** As much of one page as the pager reads. */
export type PageInfo = {
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
  nextPage: number | null
  page: number
  prevPage: number | null
  totalDocs: number
  totalPages: number
}

export type PaginationProps = {
  page: PageInfo
  onPage: (page: number) => void
  /** A new page size. The host resets the page to one, as it does for a filter. */
  onLimit: (limit: number) => void
  t: Translate
  locale: string
}

// The trigger is a button, not a native select, so the label points at it by id; one pager renders per screen.
const perPageId = 'mithaq-per-page'

export function Pagination({ locale, onLimit, onPage, page, t }: PaginationProps): ReactElement {
  const [typed, setTyped] = useState(String(page.page))
  useEffect(() => setTyped(String(page.page)), [page.page])
  const { maxLimit } = useScreen()

  const clamp = () => {
    const parsed = Number.parseInt(typed, 10)
    const within = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), Math.max(page.totalPages, 1)) : page.page
    setTyped(String(within))
    if (within !== page.page) onPage(within)
  }

  const from = page.totalDocs === 0 ? 0 : (page.page - 1) * page.limit + 1
  const to = Math.min(page.page * page.limit, page.totalDocs)

  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-2">
      <span className="text-muted-foreground flex flex-1 text-sm whitespace-nowrap" data-mithaq-range={`${from}-${to}/${page.totalDocs}`}>
        {from.toLocaleString(locale)}–{to.toLocaleString(locale)} {t('admin.of', 'of') ?? 'of'} {page.totalDocs.toLocaleString(locale)}
      </span>
      {/* `contents` on a phone, so the size box joins the range's line and the rest wraps. */}
      <div className="ms-auto flex items-center gap-8 max-sm:contents">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium" htmlFor={perPageId}>
            {t('admin.perPage', 'Per page') ?? 'Per page'}
          </Label>
          {/* The size is the trigger's own child: the item list mounts only while open, so a server render would show an empty trigger. */}
          <Select value={String(page.limit)} onValueChange={(next: string | null) => next && onLimit(Number(next))}>
            <SelectTrigger id={perPageId} size="sm" className="h-8 w-[70px] max-sm:data-[size=sm]:h-11">
              <SelectValue>{page.limit}</SelectValue>
            </SelectTrigger>
            <SelectContent side="top">
              {limitsUpTo(maxLimit).map((one) => (
                <SelectItem key={one} value={String(one)}>
                  {one}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-fit items-center justify-center gap-2 text-sm font-medium">
          <Input
            className="h-8 w-16 text-center max-sm:h-11"
            type="number"
            min={1}
            max={Math.max(page.totalPages, 1)}
            value={typed}
            aria-label={t('admin.page', 'Page') ?? 'Page'}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={clamp}
            onKeyDown={(event) => {
              if (event.key === 'Enter') clamp()
              if (event.key === 'Escape') setTyped(String(page.page))
            }}
          />
          <span className="text-muted-foreground">
            {t('admin.of', 'of') ?? 'of'} {Math.max(page.totalPages, 1).toLocaleString(locale)}
          </span>
        </div>
        <div className="ms-auto flex items-center gap-2 sm:ms-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden size-8 sm:flex"
            disabled={!page.hasPrevPage}
            onClick={() => onPage(1)}
          >
            <span className="sr-only">{t('admin.first', 'First') ?? 'First'}</span>
            <DirectionalIcon>
              <ChevronsLeft />
            </DirectionalIcon>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 max-sm:size-11"
            disabled={!page.hasPrevPage}
            onClick={() => onPage(page.prevPage ?? 1)}
          >
            <span className="sr-only">{t('admin.previous', 'Previous') ?? 'Previous'}</span>
            <DirectionalIcon>
              <ChevronLeft />
            </DirectionalIcon>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 max-sm:size-11"
            disabled={!page.hasNextPage}
            onClick={() => onPage(page.nextPage ?? page.page)}
          >
            <span className="sr-only">{t('admin.next', 'Next') ?? 'Next'}</span>
            <DirectionalIcon>
              <ChevronRight />
            </DirectionalIcon>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden size-8 sm:flex"
            disabled={!page.hasNextPage}
            onClick={() => onPage(Math.max(page.totalPages, 1))}
          >
            <span className="sr-only">{t('admin.last', 'Last') ?? 'Last'}</span>
            <DirectionalIcon>
              <ChevronsRight />
            </DirectionalIcon>
          </Button>
        </div>
      </div>
    </footer>
  )
}
