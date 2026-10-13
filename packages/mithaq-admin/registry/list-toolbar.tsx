import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Search as SearchIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Translate } from './copy.ts'

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
