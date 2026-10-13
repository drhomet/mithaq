import { useEffect, useId, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { ChevronDown, Search as SearchIcon, X } from 'lucide-react'
import type { ClientKayan } from 'mithaq/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FindApi } from './control-props.ts'
import { labelFor, type Copy, type Translate } from './copy.ts'
import { Filters } from './list-filters.tsx'
import type { FilterWhere } from './list-query.ts'

/** The search box, which asks after 300 ms of stillness and names the fields it runs over. */
export function Search({
  fields,
  locale,
  onSearch,
  t,
  value,
}: {
  value: string | undefined
  /** The labels of the fields a search runs over, which is empty for a kayan with none. */
  fields: readonly string[]
  locale: string
  onSearch: (term: string | undefined) => void
  t: Translate
}): ReactElement | null {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  useEffect(() => {
    if (text === (value ?? '')) return
    const timer = setTimeout(() => onSearch(text.trim() === '' ? undefined : text), 300)
    return () => clearTimeout(timer)
  }, [onSearch, text, value])
  // No searchable field, no box. After the hooks, which must run on every render or on none.
  if (!fields.length) return null
  const label = t('admin.search', 'Search') ?? 'Search'
  const placeholder = new Intl.ListFormat(locale, { type: 'disjunction' }).format(fields)
  return (
    <span className="flex w-full items-center gap-1 lg:max-w-sm">
      <span className="relative w-full">
        <SearchIcon className="text-muted-foreground absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden="true" />
        <Input
          type="search"
          className="ps-9 max-sm:h-11"
          placeholder={placeholder}
          aria-label={label}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </span>
      {text ? (
        <Button type="button" variant="outline" size="icon-sm" className="max-sm:size-11" onClick={() => setText('')} aria-label={t('admin.clearSearch', 'Clear search') ?? 'Clear search'}>
          <X />
        </Button>
      ) : null}
    </span>
  )
}

/**
 * The count of ticked rows and the bulk buttons. Both stay mounted, the buttons hidden until a row is ticked: a live
 * region must exist before its first change to be announced, and a dialog a button opened must outlive a read that
 * took the ticked rows off the page.
 */
export function BulkBar({ children, done, said, t, ticked }: {
  /** The bulk buttons. */
  children: ReactNode
  /** How many rows the last bulk changed, said once the ticks drop. */
  done?: { count: number }
  /** What the live region says. */
  said: string
  t: Translate
  /** How many rows on the page are ticked. */
  ticked: number
}): ReactElement {
  return (
    // On a phone the count and bulk buttons are a bar fixed to the bottom while a row is ticked, so ticking
    // does not push the table down under the finger. It stands on the form's own bar where a record page draws one.
    <div
      data-mithaq-bulk-bar=""
      role="region"
      aria-label={t('admin.bulkBar', 'Ticked rows') ?? 'Ticked rows'}
      className={ticked || done ? 'contents max-sm:bg-background max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[var(--action-bar-height,0px)] max-sm:z-30 max-sm:flex max-sm:flex-nowrap max-sm:items-center max-sm:gap-2 max-sm:overflow-x-auto max-sm:border-t max-sm:p-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&_button]:shrink-0 max-sm:[&>span]:shrink-0' : 'contents'}
    >
      {/* `aria-live`: the count changes as boxes are ticked and nothing else announces it. */}
      <span className={ticked || done ? 'text-muted-foreground text-sm' : 'sr-only'} aria-live="polite" data-mithaq-selected={ticked || undefined} data-mithaq-done={!ticked && done ? done.count : undefined}>
        {said}
      </span>
      <span hidden={ticked === 0} className={ticked ? 'contents' : undefined}>
        {children}
      </span>
    </div>
  )
}

/**
 * The row above the table: the search box, the refusal the last run answered with, the list's own buttons, the
 * filter panel's button and the column picker, and the filter panel under it.
 */
export function ListToolbar({ api, children, client, columns, copy, kayan, onSearch, onWhere, paths, refusal, search, searched, where }: {
  kayan: ClientKayan
  /** Every kayan of the build, so a search across a relationship names its far field. */
  client?: readonly ClientKayan[]
  api?: FindApi
  copy: Copy
  search?: string
  /** The paths a search runs over. */
  searched: readonly string[]
  onSearch: (search: string | undefined) => void
  /** The refusal the last run answered with, so a refused button that closed does not leave the page reading as changed. */
  refusal?: string
  /** The paths the filter panel offers, and the filter the URL holds. */
  paths: ComponentProps<typeof Filters>['paths']
  where?: FilterWhere
  onWhere: (where: FilterWhere | undefined) => void
  /** The list's own buttons and the bulk bar. */
  children?: ReactNode
  columns?: ReactNode
}): ReactElement {
  const { t, locale } = copy
  /**
   * Whether the person has opened or closed the filter panel, and nothing until they do. Until then it is open on a list whose URL filters, read on every render so a `where` that arrives after mount opens it.
   */
  const [filtering, setFiltering] = useState<boolean | undefined>(undefined)
  const open = filtering ?? Boolean(where)
  const filtersId = useId()
  return (
    <>
      <div className="flex flex-col justify-between gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-col gap-2 lg:flex-row lg:items-center">
          <Search
            value={search}
            fields={searched.flatMap((path) => {
              // A path across a relationship is named by both labels ("Course Title"), so the far field is not
              // mistaken for the list's own, in the locale's order.
              const [own, far] = path.split('.')
              const near = kayan.fields.find((one) => one.name === own)
              const there = far === undefined ? kayan : client?.find((one) => one.name === near?.relationTo)
              const field = there?.fields.find((one) => one.name === (far ?? own))
              if (!there || !field) return []
              const label = labelFor({ kayan: there, field, copy })
              if (far === undefined || !near) return [label]
              return [(t('admin.searchThrough', '{relation} {field}') ?? '{relation} {field}').replace('{relation}', () => labelFor({ kayan, field: near, copy })).replace('{field}', () => label)]
            })}
            locale={locale}
            t={t}
            onSearch={onSearch}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {refusal ? (
            <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
              {t(refusal, refusal)}
            </p>
          ) : null}
          {children}
          {paths.length ? (
            <Button
              type="button"
              variant={open || where ? 'secondary' : 'outline'}
              className="max-sm:h-11"
              aria-controls={open ? filtersId : undefined}
              aria-expanded={open}
              onClick={() => setFiltering(!open)}
            >
              {t('admin.filters', 'Filters') ?? 'Filters'}
              <ChevronDown className={open ? 'rotate-180' : undefined} aria-hidden="true" />
            </Button>
          ) : null}
          {columns}
        </div>
      </div>
      {open ? (
        <div id={filtersId}>
          <Filters
            paths={paths}
            value={where}
            t={t}
            locale={locale}
            client={client}
            api={api}
            onChange={(next: FilterWhere | undefined) => {
              // The person is at work in the panel, so it stays, even where the last filter goes.
              setFiltering(true)
              onWhere(next)
            }}
          />
        </div>
      ) : null}
    </>
  )
}
