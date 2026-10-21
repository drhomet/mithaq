import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ClientField, ClientKayan, Row } from 'mithaq/admin'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cellFor, useComponents } from 'mithaq-admin/components.tsx'
import type { RelationshipTitles } from 'mithaq-admin/control-props.ts'
import { labelFor, type Copy } from 'mithaq-admin/copy.ts'
import { canSort } from 'mithaq-admin/list-query.ts'
import { SelectAll, SelectRow } from 'mithaq-admin/list-selection.tsx'
import { isUntitled } from 'mithaq-admin/row-title.tsx'
import { refOf, type ScreenPage } from 'mithaq-admin/screen-refs.ts'

// Pinned cells are opaque (the card's fill with the head's or hovered row's tint mixed in), because a translucent one
// shows the cells that scroll beneath it. A hovered row's tint is every cell's own, the opaque mix, so the pinned cells
// and the rest change together and never differ by the row's translucent fill or its transition.
const headFill = 'bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]'
const pinnedHead = `sticky z-10 ${headFill}`
const hovered = 'group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]'
const pinned = `sticky z-10 bg-card ${hovered}`
// A shadow on the row menu column's start edge while the table runs on under it. The head cell keeps its rule underneath
// (`[&_th]:shadow-[inset_0_-1px_0_var(--border)]` on the head row), so the head's own takes `!` and carries the rule too.
const edge = 'shadow-[-10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)] rtl:shadow-[10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)]'
const edgeHead = 'shadow-[inset_0_-1px_0_var(--border),-10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)]! rtl:shadow-[inset_0_-1px_0_var(--border),10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)]!'
// Exactly a touch target wide, so the first column pins right after it; on a phone as tall, so the box's 44 pixel layer
// stays inside its own row.
const selection = 'w-11 min-w-11 p-0 h-11 sm:h-auto [&>*]:mx-auto [&>[role=checkbox]]:translate-y-0'

const nextSort = (name: string, sort: string | undefined) =>
  sort === name ? `-${name}` : sort === `-${name}` ? undefined : name

export type ListTableProps = {
  kayan: ClientKayan
  copy: Copy
  screen?: ScreenPage
  /** The columns drawn, in order; the first carries the row's link. */
  shown: readonly ClientField[]
  docs: readonly Row[]
  titles: RelationshipTitles
  /** The cell each column of the list node names, by field. */
  cellOf: ReadonlyMap<string, string | undefined>
  /** The URL's sort, which a heading's click moves on from, and the list node's, which the rows were read in without one. */
  sort?: string
  defaultSort?: string
  onSort: (sort: string | undefined) => void
  /** The ticked rows, where the list offers a bulk button. */
  selection?: { ids: readonly string[]; selected: ReadonlySet<string>; onSelect: (selected: ReadonlySet<string>) => void }
  href: (id: string) => string
  /** The id of the sentence that says Enter opens a row. */
  openHint: string
  /** Opens a row by its own link. */
  openRow: (id: string) => void
  table: RefObject<HTMLTableElement | null>
  /** What a row's last cell holds: its own buttons and its menu. */
  actions: (row: Row) => ReactNode
  /** Whether no column the list opens with is one the viewer may read, which draws no table. */
  unreadable: boolean
  /** What is said under the table, inside its frame. */
  children?: ReactNode
}

export function ListTable({
  actions,
  cellOf,
  children,
  copy,
  defaultSort,
  docs,
  href,
  kayan,
  onSort,
  openHint,
  openRow,
  screen,
  selection: picked,
  shown,
  sort: urlSort,
  table,
  titles,
  unreadable,
}: ListTableProps): ReactElement {
  const { t, locale } = copy
  const { cells } = useComponents()
  const picks = picked !== undefined
  // The first shown cell carries the row's link, so a hidden or unreadable title leaves a row reachable.
  const linked = shown[0]
  const sortable = shown.filter(canSort)
  const sort = urlSort ?? defaultSort
  const sorted = sortable.find((field) => field.name === sort?.replace(/^-/, ''))
  const order = sort?.startsWith('-') ? (t('admin.descending', 'Descending') ?? 'Descending') : (t('admin.ascending', 'Ascending') ?? 'Ascending')
  // Whether the table runs past its frame's end, so the frame fades there. The value is the width of the row menu's pinned
  // column, which the fade sits before, and `false` where nothing runs past. `scrollLeft` is negative on a right-to-left page.
  const [more, setMore] = useState<number | false>(false)
  useEffect(() => {
    const grid = table.current
    const frame = grid?.parentElement
    if (!grid || !frame) return
    const check = () => setMore(frame.scrollWidth - frame.clientWidth - Math.abs(frame.scrollLeft) > 1 && (grid.querySelector('thead th:last-child')?.getBoundingClientRect().width ?? 0))
    check()
    frame.addEventListener('scroll', check, { passive: true })
    const resized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(check)
    resized?.observe(frame)
    resized?.observe(grid)
    return () => {
      frame.removeEventListener('scroll', check)
      resized?.disconnect()
    }
  }, [])
  return (
    <>
      {!unreadable && (sortable.length || picked) ? <div data-list-phone-controls="" className="flex items-center gap-2 sm:hidden">
        {picked ? <div className="flex size-11 shrink-0 items-center justify-center"><SelectAll ids={picked.ids} selected={picked.selected} onSelect={picked.onSelect} t={t} /></div> : null}
        {sortable.length ? (
          <div className="min-w-0 flex-1">
            <Select value={sort ?? null} onValueChange={(value) => onSort(value ?? undefined)}>
              <SelectTrigger aria-label={t('admin.sortBy', 'Sort by') ?? 'Sort by'} className="w-full">
                <SelectValue>{sorted ? `${labelFor({ kayan, field: sorted, copy })}: ${order}` : (t('admin.defaultOrder', 'Default order') ?? 'Default order')}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>{t('admin.defaultOrder', 'Default order') ?? 'Default order'}</SelectItem>
                {sortable.flatMap((field) => [
                  <SelectItem key={field.name} value={field.name}>{labelFor({ kayan, field, copy })}: {t('admin.ascending', 'Ascending') ?? 'Ascending'}</SelectItem>,
                  <SelectItem key={`-${field.name}`} value={`-${field.name}`}>{labelFor({ kayan, field, copy })}: {t('admin.descending', 'Descending') ?? 'Descending'}</SelectItem>,
                ])}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div> : null}
    {/* Held to the screen below the page's header so it scrolls both ways and the head row can stay (a printed page
        holds every row). It isolates, so pinned cells never paint over the page's sticky header or take its clicks. */}
    <div data-list-frame="" className="bg-card relative isolate min-w-0 max-w-full overflow-hidden rounded-lg border [&>div:first-child]:max-h-[calc(100dvh-var(--header-height,0px))] print:[&>div:first-child]:max-h-none">
      {unreadable ? null : (
        <Table ref={table}>
          {/* The head rule is each head cell's own inset shadow, since a collapsed border scrolls away from a sticky
              head; the row's own `border-b` is dropped so both do not draw. */}
          <TableHeader className={`sticky top-0 z-20 ${headFill} [&_tr]:border-b-0 [&_th]:shadow-[inset_0_-1px_0_var(--border)]`}>
            <TableRow>
              {picked ? (
                <TableHead aria-label={t('admin.selectAll', 'Select every row on this page') ?? 'Select every row on this page'} data-list-select-all="" scope="col" className={`${pinnedHead} start-0 ${selection}`}>
                  <SelectAll ids={picked.ids} selected={picked.selected} onSelect={picked.onSelect} t={t} />
                </TableHead>
              ) : null}
              {shown.map((field) => {
                // A heading is a button only where the read would take the sort: the server answers 400 for a
                // localized field, a set, a join and a screen's `sortable: false`.
                const sortable = canSort(field)
                // The URL's sort, else the list node's default, which is the order the page was read in.
                const sort = urlSort ?? defaultSort
                const direction = sort === field.name ? 'ascending' : sort === `-${field.name}` ? 'descending' : 'none'
                return (
                  <TableHead aria-label={labelFor({ kayan, field, copy })} data-list-column-head="" key={field.name} scope="col" aria-sort={sortable ? direction : undefined} className={field === linked ? `${pinnedHead} ${picks ? 'start-11' : 'start-0'}` : undefined}>
                    {sortable ? (
                      // One arrow, on the sorted column only. `aria-hidden` on the glyph and `aria-sort` on the
                      // cell keep the answer readable without it.
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ms-2 h-8 px-2 min-h-11 sm:min-h-0 min-w-11 sm:min-w-0"
                        onClick={() => onSort(nextSort(field.name, urlSort))}
                      >
                        {labelFor({ kayan, field, copy })}
                        {direction === 'ascending' ? (
                          <ArrowUp className="size-4" aria-hidden="true" />
                        ) : direction === 'descending' ? (
                          <ArrowDown className="size-4" aria-hidden="true" />
                        ) : null}
                      </Button>
                    ) : (
                      labelFor({ kayan, field, copy })
                    )}
                  </TableHead>
                )
              })}
              <TableHead data-list-actions-head="" scope="col" className={`${pinnedHead} end-0 w-0 ${more === false ? '' : edgeHead}`}>
                <span className="sr-only">{t('admin.actions', 'Actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((row, index) => {
              const id = String(row.id ?? '')
              // `#` is the host's word for a kayan with no page that draws a row, so such a row is no link and
              // no tab stop.
              const to = href(id)
              const opens = to !== '#'
              return (
                // The whole row opens the record, and so does Enter on the row. A click on anything inside that acts
                // on its own, or on the menu or a dialog it opened (React hands those up through its portal), opens nothing.
                <TableRow
                  key={String(row.id ?? index)}
                  tabIndex={opens ? 0 : undefined}
                  data-row={id}
                  data-list-card=""
                  data-list-picks={picks || undefined}
                  aria-describedby={opens ? openHint : undefined}
                  // The ring every focusable control draws, inset so the table's frame does not clip it.
                  className={opens ? 'group/row cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset' : 'group/row'}
                  onClick={(event: MouseEvent<HTMLTableRowElement>) => {
                    const target = event.target as Element
                    if (!opens || !event.currentTarget.contains(target) || target.closest('a, button, input, select, textarea, label, [role="checkbox"], [role="menuitem"]')) return
                    openRow(id)
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (!opens || event.key !== 'Enter' || event.target !== event.currentTarget) return
                    event.preventDefault()
                    openRow(id)
                  }}
                >
                  {picked ? (
                    <TableCell data-list-select-row="" className={`${pinned} start-0 ${selection}`}>
                      <SelectRow id={id} selected={picked.selected} onSelect={picked.onSelect} t={t} />
                    </TableCell>
                  ) : null}
                  {shown.map((field, column) => {
                    const Ref = refOf({ screen, place: 'cell', path: cellOf.get(field.name) ?? field.cell })
                    // An email cell is a mail link, and a link cannot sit in the row's link (`<a>` in `<a>` is a
                    // hydration error), so the linked column draws its text. Upload draws no anchor.
                    // The screen's own component draws first, so the map is asked only for what it does not.
                    const drawn = Ref && screen ? undefined : cellFor({ cells, field, column: cellOf.get(field.name) })
                    const Cell = drawn === cells.email && field === linked && opens ? cells.text : drawn
                    const untitled = field.name === kayan.useAsTitle && isUntitled({ kayan, row, locale })
                    const cell = untitled ? (
                      <span className="text-muted-foreground">{t('admin.untitled', 'Untitled') ?? 'Untitled'}</span>
                    ) : Cell ? (
                      <Cell kayan={kayan} field={field} value={row[field.name]} t={t} locale={locale} titles={titles} />
                    ) : (
                      Ref && <Ref field={field} value={row[field.name]} row={row} />
                    )
                    return (
                      <TableCell key={field.name} data-list-title={field === linked ? '' : undefined} data-list-detail={field !== linked ? '' : undefined} data-list-extra={column > 3 || undefined} className={field === linked ? `${pinned} ${picks ? 'start-11' : 'start-0'}` : hovered}>
                        {field !== linked ? <span aria-hidden="true" data-list-label="" className="sm:hidden">{labelFor({ kayan, field, copy })}:</span> : null}
                        {field === linked && opens ? (
                          // A real link, so it opens in a new tab and lists for a reader, but out of the tab
                          // order since the row is the stop. An untitled row's name holds the visible text.
                          <a href={to} data-row-link={id} tabIndex={-1} aria-label={untitled ? (t('admin.openUntitled', 'Untitled, open') ?? 'Untitled, open') : undefined} className="font-medium hover:underline">
                            {cell}
                          </a>
                        ) : (
                          field === linked ? cell : <div data-list-value="" className="sm:contents">{cell}</div>
                        )}
                      </TableCell>
                    )
                  })}
                  <TableCell data-list-actions="" className={`${pinned} end-0 w-0 ${more === false ? '' : edge}`}>
                    <div className="flex items-center justify-end gap-2">{actions(row)}</div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {children}
      {more === false ? null : <div data-scroll-cue="" aria-hidden className="hidden sm:block from-card pointer-events-none absolute inset-y-0 w-10 bg-linear-to-l to-transparent rtl:bg-linear-to-r" style={{ insetInlineEnd: more }} />}
    </div>
    </>
  )
}
