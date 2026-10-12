import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, MoreHorizontal, Plus, Search as SearchIcon, X } from 'lucide-react'
import type { ButtonClient, ClientField, ClientKayan, Row } from 'mithaq/admin'
import { useScreen } from 'mithaq/admin/react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { NodeButton, OwnButton, drawsKind, isUntitled, listOf, nodesOf, pageButtonOf, refOf, rowTitle, rowWarning, scopeOf, shown as holds, type ListNode, type PageButton, type ScreenPage } from './nodes.tsx'
import { cellFor, cells } from './cells.tsx'
import { counted, descriptionOf, labelFor, operationLabelFor, refusalKeyOf, titleOf, type Copy, type FindApi, type Translate } from './controls.tsx'
import { DeleteButton, Form, OperationButton, type FormProps } from './form.tsx'
import { useRelationshipTitles } from './relationship-cell.tsx'
import { filterPathsOf } from './filter-operators.ts'
import { Filters } from './list-filters.tsx'
import { Columns, columnCandidates } from './list-columns.tsx'
import { Pagination } from './list-pagination.tsx'
import { SelectAll, SelectRow, writableFields } from './list-selection.tsx'
import {
  canSort,
  columnsFrom,
  columnsTo,
  refined,
  remember,
  remembered,
  searchableFields,
  type ColumnChoice,
  type FilterWhere,
  type ListQuery,
} from './list-query.ts'

/** One page, as the managed reader answers it. */
export type Page = {
  docs: readonly Record<string, unknown>[]
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
  nextPage: number | null
  page: number
  prevPage: number | null
  totalDocs: number
  totalPages: number
}

/** The six options this screen drives `find` and the URL with. */
export type Query = ListQuery

export type ListProps = {
  kayan: ClientKayan
  page: Page
  query: Query
  t: Translate
  locale: string
  /**
   * Which locales exist, from the app: a localized field is offered to the filter panel as its locale paths.
   */
  locales?: readonly string[]
  /** Every kayan of the build, so a relationship's hop can name the target's fields. */
  client?: readonly ClientKayan[]
  /**
   * The typed client's reads. A relationship column names the rows it points at with one read per target for the whole page, and the filter panel's relationship value input pages its target with it.
   */
  api?: FindApi
  /**
   * Whether this actor may read one field, off `GET /api/access`. Chrome only: the read masks a denied column and refuses a denied filter whatever this says.
   */
  reads?: (kayan: string, field: string) => boolean
  /**
   * Whether this actor may create a row of this kayan, off the same report. Chrome only: the create is authorized server-side. Undeclared is allowed.
   */
  creates?: boolean
  /**
   * This actor's answer per operation name, off the same report. A button in the list node's `toolbar`, `bulk` or `row` is drawn where it allows that operation, and the selection column where it allows a bulk button. Chrome only; an absent key is denied.
   */
  operations?: Readonly<Record<string, boolean>>
  /** Whether this actor may write one field on an update, for a bulk update's boxes. */
  writes?: (field: string) => boolean
  /**
   * The access report a list button's `when` reads as `$user`, cut to the screen's kayan.
   */
  access?: unknown
  /**
   * What running one of the list's buttons costs the host: the call and the re-read after it. With none, no button is drawn, as there would be nothing for it to do.
   */
  run?: (operation: string, input: Record<string, unknown>) => Promise<unknown>
  /** Where the next query goes. Navigation, as a callback. */
  onQuery: (query: Query) => void
  /** Where one row goes. Navigation, as a prop, so no router is imported. */
  href: (id: string) => string
  /** Where a new row is written. */
  newHref: string
  /**
   * A screen's list page, where this list draws one: its list node names the columns, filters and search, and the components it names by path are drawn from here.
   */
  screen?: ScreenPage
  /** The list node this list draws, where it is not the page's own: a list of another kayan. */
  node?: ListNode
  /**
   * How a list of another kayan edits its rows in place, below the table: one row at a time, in the row's own form over the list's columns, a create being the same form with the page's row already in its relationship. Every write is the listed kayan's own and saves apart from the page's form. A row still opens its own page through `href`.
   */
  edit?: Pick<FormProps, 'client' | 'writes'> & {
    /** What every row it adds holds whatever the form sends: the relationship to the page's row. */
    prefill?: Readonly<Record<string, unknown>>
  }
}

/**
 * Which columns a list shows, in order: the URL's list when it carries one, else the list node's `columns`, else every field. Never a field this actor may not read.
 */
export const columnsOf = ({
  kayan,
  cols,
  reads,
  opens,
}: {
  kayan: ClientKayan
  cols?: readonly string[]
  reads?: (kayan: string, field: string) => boolean
  /** The columns a page's list node opens with, which is every field where there is no node. */
  opens?: readonly string[]
}): readonly ColumnChoice[] => {
  const isDefault = (_kayan: ClientKayan, field: ClientField) => !opens || opens.includes(field.name)
  const candidates = columnCandidates(kayan, reads)
  const offered = new Set(candidates.map((field) => field.name))
  const fromUrl = columnsFrom(cols).filter((one) => offered.has(one.name))
  const named = new Set(fromUrl.map((one) => one.name))
  const rest = candidates.filter((field) => !named.has(field.name))
  if (fromUrl.length) {
    // A column the URL did not name keeps the declaration's answer, so a field added to a kayan is not hidden from old links.
    return [...fromUrl, ...rest.map((field) => ({ name: field.name, active: isDefault(kayan, field) }))]
  }
  return candidates.map((field) => ({ name: field.name, active: isDefault(kayan, field) }))
}

/**
 * The query a column change asks for. It keeps the page it is on, since it changes what a row shows and never which rows match.
 */
export const withColumns = (query: Query, columns: readonly ColumnChoice[]): Query => ({
  ...query,
  cols: columnsTo(columns),
})

// Pinned cells are opaque (the card's fill with the head's or hovered row's tint mixed in), because a translucent one
// shows the cells that scroll beneath it.
const headFill = 'bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]'
const pinnedHead = `sticky z-10 ${headFill}`
const pinned = 'sticky z-10 bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]'
// A shadow on the row menu column's start edge while the table runs on under it. The head cell keeps its rule underneath
// (`[&_th]:shadow-[inset_0_-1px_0_var(--border)]` on the head row), so the head's own takes `!` and carries the rule too.
const edge = 'shadow-[-10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)] rtl:shadow-[10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)]'
const edgeHead = 'shadow-[inset_0_-1px_0_var(--border),-10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)]! rtl:shadow-[inset_0_-1px_0_var(--border),10px_0_10px_-6px_color-mix(in_oklab,var(--foreground)_35%,transparent)]!'
// Exactly a touch target wide, so the first column pins right after it; on a phone as tall, so the box's 44 pixel layer
// stays inside its own row.
const selection = 'w-11 min-w-11 p-0 max-sm:h-11 [&>*]:mx-auto [&>[role=checkbox]]:translate-y-0'

const nextSort = (name: string, sort: string | undefined) =>
  sort === name ? `-${name}` : sort === `-${name}` ? undefined : name

function Search({
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

export function List({
  access,
  api,
  client,
  creates,
  edit,
  href,
  kayan,
  locale,
  locales,
  newHref,
  onQuery,
  operations,
  page,
  query,
  reads,
  run,
  screen,
  t,
  writes,
  ...props
}: ListProps): ReactElement {
  const copy: Copy = { t, locale }
  const { maxLimit } = useScreen()
  const node = props.node ?? listOf(screen)
  /** The row being edited in place, `null` for a row being added, and nothing while no form is open. */
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)
  const edits = edit && node
    ? { ...edit, client: { ...edit.client, create: (input: Record<string, unknown>) => edit.client.create({ ...input, ...edit.prefill }) } }
    : undefined
  const Heading = node?.of ? 'h2' : 'h1'
  const Empty = refOf({ screen, place: 'empty', path: node?.empty })
  /** The project's items in each row's menu, and the dialog one of them opened, which outlives the menu. */
  const Menu = refOf({ screen, place: 'menu', path: node?.menu })
  const [over, setOver] = useState<ReactNode>(null)
  const cellOf = new Map(node?.columns.map((column) => [column.field, column.cell]))
  const searched = searchableFields({ kayan, search: node?.search, client })
  const columns = columnsOf({ kayan, cols: query.cols, reads, opens: node?.columns.map((column) => column.field) })
  const active = columns.flatMap((column) => kayan.fields.find((field) => field.name === column.name && column.active) ?? [])
  const titled = active.find((field) => field.name === kayan.useAsTitle)
  const shown = titled ? [titled, ...active.filter((field) => field !== titled)] : active
  // One read per target for the whole page, so a relationship column is not one read per cell. Over the shown columns
  // alone, so a relationship the viewer has switched off costs no read.
  const titles = useRelationshipTitles({ fields: shown, docs: page.docs, context: { api, client, locale } })
  const paths = filterPathsOf(kayan, { client, locales, reads, ...(node?.filters && { filters: node.filters }) })
  // The first shown cell carries the row's link, so a hidden or unreadable title leaves a row reachable.
  const linked = shown[0]
  const refine = (next: Partial<Query>) => onQuery(refined(query, next))
  const filtered = Boolean(query.where || query.search)
  /**
   * Whether the person has opened or closed the filter panel, and nothing until they do. Until then it is open on a list whose URL filters, read on every render so a `where` that arrives after mount opens it.
   */
  const [filtering, setFiltering] = useState<boolean | undefined>(undefined)
  const open = filtering ?? Boolean(query.where)
  const filtersId = useId()
  /** The kayan's plural, which the bulk dialog and its result name the ticked rows by. */
  const plural = titleOf({ kayan, copy, many: true })
  const about = descriptionOf(kayan, copy)

  /**
   * The list node's buttons this actor may run, drawn only where the host said what running one costs and the report allows its operation by name.
   */
  const allowed = (declared: readonly ButtonClient[] | undefined) =>
    run ? (declared ?? []).flatMap((node) => {
      const operation = pageButtonOf({ kayan, node, allowed: operations })
      return operation ? [{ node, operation }] : []
    }) : []
  /** What a toolbar or bulk button's `when` reads: no values and no row, and the report as `$user`. */
  const scope = scopeOf({ values: {}, record: null, access, kayan })
  const toolbar = allowed(node?.toolbar).filter((one) => holds(one.node, scope))
  // A bulk button's boxes are the row's fields it names, cut to those this actor could write; its call is the ticked
  // rows' `where` around them.
  const bulkButtons = allowed(node?.bulk).filter((one) => holds(one.node, scope)).map((one) => ({
    ...one,
    operation: { ...one.operation, fields: writableFields(kayan, writes).filter((field) => one.node.fields?.includes(field.name)) },
  }))
  const rowButtons = allowed(node?.row)
  const editsRows = edits !== undefined && operations?.update === true
  const deletes = run !== undefined && operations?.delete === true && kayan.operations.some((one) => one.name === 'delete')
  const [deleting, setDeleting] = useState<Row | undefined>(undefined)
  const [asking, setAsking] = useState<{ row: Row; operation: PageButton } | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const table = useRef<HTMLTableElement>(null)
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
  /**
   * The name of a row's menu button, naming the row by its title so a reader going down the column hears each row's own; a row with no title, or with the title column hidden, keeps the shared name.
   */
  const rowActionsLabel = (row: Row) => {
    const name = titled && rowTitle({ kayan, row, locale })
    // Bidi-isolated, so a name in the other direction does not reorder the sentence.
    return name ? (t('admin.rowActionsFor', 'Actions for {name}') ?? 'Actions for {name}').replace('{name}', () => `\u2068${name}\u2069`) : (t('admin.rowActions', 'Row actions') ?? 'Row actions')
  }
  const openHint = useId()
  /**
   * Opens a row by clicking its own link, so the host routes it as it routes every other link and the list imports no router.
   */
  const openRow = (id: string) =>
    [...(table.current?.querySelectorAll<HTMLAnchorElement>('a[data-row-link]') ?? [])].find((one) => one.dataset.rowLink === id)?.click()
  const runOnRow = async (operation: string, input: Record<string, unknown>, refuse: (thrown: unknown) => void = setRefused) => {
    setRunning(true)
    setRefused(undefined)
    try {
      await run!(operation, input)
      return true
    } catch (thrown) {
      refuse(thrown)
      return false
    } finally {
      setRunning(false)
    }
  }
  /**
   * Whether no column the list opens with is one the viewer may read, which the projection says by leaving the field out. Such a list draws no rows, nor anything that acts on them.
   */
  const unreadable = !(node?.columns.map((column) => column.field) ?? kayan.fields.map((field) => field.name)).some((name) => kayan.fields.some((field) => field.name === name))
  const picks = bulkButtons.length > 0 && !unreadable
  /**
   * The refusal the last run answered with, drawn above the table, so a refused button that closed does not leave the page reading as changed.
   */
  const [refused, setRefused] = useState<unknown>(undefined)
  const refusal = refusalKeyOf(refused)
  const button = (one: PageButton, inputOf: (values: Record<string, unknown>) => Record<string, unknown>, key: string, extra: { description?: string; disabled?: boolean; onRan?: (written: unknown) => void } = {}) => (
    <ListButton key={key} operation={one} kayan={kayan} client={client} api={api} copy={copy} screen={screen} run={run!} inputOf={inputOf} onRefused={setRefused} {...extra} />
  )
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * How many rows the last bulk changed, announced in the count's live region after the ticks drop. A new object per bulk restarts its six seconds; it clears after them or when a row is ticked again.
   */
  const [done, setDone] = useState<{ count: number } | undefined>(undefined)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(undefined), 6000)
    return () => clearTimeout(timer)
  }, [done])
  const rowIds = page.docs.map((row) => String(row.id ?? ''))
  /**
   * The ticked rows still on the page. A page that moved under the selection leaves ids that are no longer on screen, and a delete of rows nobody can see is the one thing this must not send.
   */
  const ticked = rowIds.filter((one) => one && selected.has(one))
  useEffect(() => {
    if (ticked.length) setDone(undefined)
  }, [ticked.length])
  /** A counted sentence about the ticked rows, capitalised though the kayan's plural may be lower case. */
  const aboutTicked = (key: string, count: number, fallback: string) => {
    const said = counted({ t, locale, key, count, fallback }).replace('{plural}', () => plural)
    return said.charAt(0).toLocaleUpperCase(locale) + said.slice(1)
  }

  // Per-viewer limit and columns are remembered in `localStorage`, read once and only where the URL named neither.
  // Read in an effect: it does not exist on the server, and reading it during render would mismatch hydration.
  useEffect(() => {
    if (query.limit !== undefined || query.cols !== undefined) return
    const held = remembered(kayan.name, maxLimit)
    if (held.limit === undefined && held.cols === undefined) return
    onQuery({ ...query, ...held })
    // The kayan alone: running again on the query would undo a viewer's own change back to what was remembered.
  }, [kayan.name])
  useEffect(() => {
    if (query.limit === undefined && query.cols === undefined) return
    remember(kayan.name, { ...(query.limit !== undefined && { limit: query.limit }), ...(query.cols !== undefined && { cols: query.cols }) })
  }, [kayan.name, query.cols, query.limit])

  return (
    <section className={`flex w-full min-w-0 flex-1 flex-col gap-4 ${ticked.length || done ? 'max-sm:pb-[calc(5rem+env(safe-area-inset-bottom))]' : ''}`}>
      {/* `flex-wrap`: on a phone the title and the button share 320 pixels. `min-w-0` on the section lets the list shrink
          inside the grid or flex row that holds it, whose items otherwise keep the width of their widest row. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          {/* A title node on the screen's own list page is the page's one h1, so the list keeps only its sentence; a list
              of another kayan keeps its heading. */}
          {screen && !node?.of && drawsKind({ nodes: nodesOf(screen.page), kind: 'title', scope }) ? null : <Heading className={node?.of ? 'text-lg font-semibold' : 'text-2xl font-bold tracking-tight'}>{titleOf({ kayan, copy, many: true })}</Heading>}
          {about ? <p className="text-muted-foreground text-sm">{about}</p> : null}
        </div>
        {creates === false ? null : edits ? (
          // A list of another kayan adds a row in place, below the table.
          <Button type="button" className="max-sm:h-11" onClick={() => setEditing(null)}>
            <Plus className="me-2 h-4 w-4" />
            {t(`${kayan.name}.new`, t('admin.new', 'New'))}
          </Button>
        ) : (
          // `render` keeps the destination an anchor; `nativeButton={false}` tells base-ui the rendered element is not
          // a button.
          <Button nativeButton={false} className="max-sm:h-11" render={<a href={newHref} />}>
            <Plus className="me-2 h-4 w-4" />
            {t(`${kayan.name}.new`, t('admin.new', 'New'))}
          </Button>
        )}
      </header>

      <Card>
        <CardContent>
          <div className="w-full space-y-4">
            <div className="flex flex-col justify-between gap-2 lg:flex-row lg:items-center">
              <div className="flex flex-1 flex-col gap-2 lg:flex-row lg:items-center">
                <Search
                  value={query.search}
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
                  onSearch={(search) => refine({ search })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {refusal ? (
                  <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
                    {t(refusal, refusal)}
                  </p>
                ) : null}
                {toolbar.map((one, at) => button(one.operation, (values) => values, `toolbar-${at}`, { description: t('admin.toolbarWarning', 'This runs on no row of the list.') ?? 'This runs on no row of the list.' }))}
                {/* Both stay mounted, the buttons hidden until a row is ticked: a live region must exist before its first change
                    to be announced, and a dialog a button opened must outlive a read that took the ticked rows off the page. */}
                {picks ? (
                  // On a phone the count and bulk buttons are a bar fixed to the bottom while a row is ticked, so ticking
                  // does not push the table down under the finger. It stands on the form's own bar where a record page draws one.
                  <div
                    data-mithaq-bulk-bar=""
                    role="region"
                    aria-label={t('admin.bulkBar', 'Ticked rows') ?? 'Ticked rows'}
                    className={ticked.length || done ? 'contents max-sm:bg-background max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[var(--action-bar-height,0px)] max-sm:z-30 max-sm:flex max-sm:flex-nowrap max-sm:items-center max-sm:gap-2 max-sm:overflow-x-auto max-sm:border-t max-sm:p-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&_button]:shrink-0 max-sm:[&>span]:shrink-0' : 'contents'}
                  >
                    {/* `aria-live`: the count changes as boxes are ticked and nothing else announces it. */}
                    <span className={ticked.length || done ? 'text-muted-foreground text-sm' : 'sr-only'} aria-live="polite" data-mithaq-selected={ticked.length || undefined} data-mithaq-done={!ticked.length && done ? done.count : undefined}>
                      {ticked.length
                        ? (t('admin.selected', '{count} selected') ?? '{count} selected').replace('{count}', String(ticked.length))
                        : done ? aboutTicked('admin.bulkDone', done.count, '{plural} done: {count}.') : ''}
                    </span>
                    <span hidden={ticked.length === 0} className={ticked.length ? 'contents' : undefined}>
                      {bulkButtons.map((one, at) =>
                        button(
                          one.operation,
                          // Only the ticked rows still on the page, with the boxes' values as the data written over each.
                          (values) => ({ where: { id: { in: ticked } }, ...(one.operation.fields.length > 0 && { data: values }) }),
                          `bulk-${at}`,
                          {
                            // A where of no id is a call nobody ticked, which a dialog left open over rows that left the
                            // page would confirm, so it is disabled.
                            disabled: ticked.length === 0,
                            description: aboutTicked('admin.bulkWarning', ticked.length, '{plural} you ticked: {count}. This applies to each of them.'),
                            // The ticked ids name rows the host's re-read is about to drop, so the selection is cleared
                            // and what the bulk did is said, less the rows it named as left.
                            onRan: (written) => {
                              setDone({ count: ticked.length - ((written as { errors?: readonly unknown[] } | null)?.errors?.length ?? 0) })
                              setSelected(new Set())
                            },
                          },
                        ),
                      )}
                    </span>
                  </div>
                ) : null}
                {paths.length ? (
                  <Button
                    type="button"
                    variant={open || query.where ? 'secondary' : 'outline'}
                    className="max-sm:h-11"
                    aria-controls={open ? filtersId : undefined}
                    aria-expanded={open}
                    onClick={() => setFiltering(!open)}
                  >
                    {t('admin.filters', 'Filters') ?? 'Filters'}
                    <ChevronDown className={open ? 'rotate-180' : undefined} aria-hidden="true" />
                  </Button>
                ) : null}
                {unreadable ? null : (
                  <Columns
                    kayan={kayan}
                    columns={columns}
                    t={t}
                    locale={locale}
                    onChange={(next) => onQuery(withColumns(query, next))}
                  />
                )}
              </div>
            </div>

            {open ? (
              <div id={filtersId}>
                <Filters
                  paths={paths}
                  value={query.where}
                  t={t}
                  locale={locale}
                  client={client}
                  api={api}
                  onChange={(where: FilterWhere | undefined) => {
                    // The person is at work in the panel, so it stays, even where the last filter goes.
                    setFiltering(true)
                    refine({ where })
                  }}
                />
              </div>
            ) : null}

            {/* Held to the screen below the page's header so it scrolls both ways and the head row can stay (a printed page
                holds every row). It isolates, so pinned cells never paint over the page's sticky header or take its clicks. */}
            <div className="bg-card relative isolate overflow-hidden rounded-lg border [&>div:first-child]:max-h-[calc(100dvh-var(--header-height,0px))] print:[&>div:first-child]:max-h-none">
              {unreadable ? null : (
              <Table ref={table}>
                  {/* The head rule is each head cell's own inset shadow, since a collapsed border scrolls away from a sticky
                      head; the row's own `border-b` is dropped so both do not draw. */}
                  <TableHeader className={`sticky top-0 z-20 ${headFill} [&_tr]:border-b-0 [&_th]:shadow-[inset_0_-1px_0_var(--border)]`}>
                    <TableRow>
                      {picks ? (
                        <TableHead scope="col" className={`${pinnedHead} start-0 ${selection}`}>
                          <SelectAll ids={rowIds} selected={selected} onSelect={setSelected} t={t} />
                        </TableHead>
                      ) : null}
                      {shown.map((field) => {
                        // A heading is a button only where the read would take the sort: the server answers 400 for a
                        // localized field, a set, a join and a screen's `sortable: false`.
                        const sortable = canSort(field)
                        // The URL's sort, else the list node's default, which is the order the page was read in.
                        const sort = query.sort ?? node?.sort
                        const direction = sort === field.name ? 'ascending' : sort === `-${field.name}` ? 'descending' : 'none'
                        return (
                          <TableHead key={field.name} scope="col" aria-sort={sortable ? direction : undefined} className={field === linked ? `${pinnedHead} ${picks ? 'start-11' : 'start-0'}` : undefined}>
                            {sortable ? (
                              // One arrow, on the sorted column only. `aria-hidden` on the glyph and `aria-sort` on the
                              // cell keep the answer readable without it.
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="-ms-2 h-8 px-2 max-sm:h-11 max-sm:min-w-11"
                                onClick={() => refine({ sort: nextSort(field.name, query.sort) })}
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
                      <TableHead scope="col" className={`${pinnedHead} end-0 w-0 ${more === false ? '' : edgeHead}`}>
                        <span className="sr-only">{t('admin.actions', 'Actions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {page.docs.map((row, index) => {
                      const id = String(row.id ?? '')
                      // The list node's row buttons whose `when` holds over this row. One a project draws with its own
                      // component stays in the cell, since a menu item cannot be one.
                      const offered = rowButtons.filter((one) => holds(one.node, scopeOf({ values: row, record: row, access, kayan })))
                      const own = offered.filter((one) => refOf({ screen, place: 'button', path: one.operation.component }))
                      const menu = offered.filter((one) => !own.includes(one))
                      // `#` is the host's word for a kayan with no page that draws a row, so such a row is no link and
                      // no tab stop, and its menu offers neither Edit nor View.
                      const to = href(id)
                      const opens = to !== '#'
                      const edits = editsRows || opens
                      return (
                        // The whole row opens the record, and so does Enter on the row. A click on anything inside that acts
                        // on its own, or on the menu or a dialog it opened (React hands those up through its portal), opens nothing.
                        <TableRow
                          key={String(row.id ?? index)}
                          tabIndex={opens ? 0 : undefined}
                          data-row={id}
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
                          {picks ? (
                            <TableCell className={`${pinned} start-0 ${selection}`}>
                              <SelectRow id={id} selected={selected} onSelect={setSelected} t={t} />
                            </TableCell>
                          ) : null}
                          {shown.map((field) => {
                            const Ref = refOf({ screen, place: 'cell', path: cellOf.get(field.name) ?? field.cell })
                            // An email cell is a mail link, and a link cannot sit in the row's link (`<a>` in `<a>` is a
                            // hydration error), so the linked column draws its text. Upload draws no anchor.
                            const drawn = cellFor(field, cellOf.get(field.name))
                            const Cell = drawn === cells.email && field === linked && opens ? cells.text! : drawn
                            const untitled = field.name === kayan.useAsTitle && isUntitled({ kayan, row, locale })
                            const cell = untitled ? (
                              <span className="text-muted-foreground">{t('admin.untitled', 'Untitled') ?? 'Untitled'}</span>
                            ) : Ref && screen ? (
                              <Ref field={field} value={row[field.name]} row={row} />
                            ) : (
                              <Cell kayan={kayan} field={field} value={row[field.name]} t={t} locale={locale} titles={titles} />
                            )
                            return (
                              <TableCell key={field.name} className={field === linked ? `${pinned} ${picks ? 'start-11' : 'start-0'}` : undefined}>
                                {field === linked && opens ? (
                                  // A real link, so it opens in a new tab and lists for a reader, but out of the tab
                                  // order since the row is the stop. An untitled row's name holds the visible text.
                                  <a href={to} data-row-link={id} tabIndex={-1} aria-label={untitled ? (t('admin.openUntitled', 'Untitled, open') ?? 'Untitled, open') : undefined} className="font-medium hover:underline">
                                    {cell}
                                  </a>
                                ) : (
                                  cell
                                )}
                              </TableCell>
                            )
                          })}
                          <TableCell className={`${pinned} end-0 w-0 ${more === false ? '' : edge}`}>
                            <div className="flex items-center justify-end gap-2">
                              {own.map((one, at) => button(one.operation, (values) => ({ ...values, id: row.id }), `row-${at}`, { description: rowWarning({ kayan, row, operation: one.operation.name, copy }) }))}
                              {edits || menu.length || deletes || Menu ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  data-row-menu={id}
                                  aria-label={rowActionsLabel(row)}
                                  className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'max-sm:size-11' })}
                                >
                                  <MoreHorizontal className="size-4" aria-hidden="true" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  {/* View where the report lets this actor update no row of the kayan, since the row's
                                      page is then only read. */}
                                  {edits ? (
                                    operations && operations.update !== true ? (
                                      <DropdownMenuItem data-row-action="view" className="max-sm:min-h-11" onClick={() => openRow(id)}>
                                        {t('admin.view', 'View') ?? 'View'}
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem data-row-action="edit" className="max-sm:min-h-11" onClick={() => (editsRows ? setEditing(row) : openRow(id))}>
                                        {t('admin.edit', 'Edit') ?? 'Edit'}
                                      </DropdownMenuItem>
                                    )
                                  ) : null}
                                  {menu.map((one) => (
                                    <DropdownMenuItem
                                      key={one.operation.name}
                                      data-row-action={one.operation.name}
                                      className="max-sm:min-h-11"
                                      disabled={running}
                                      onClick={() => {
                                        // A button that asks for values or carries a confirm opens its dialog over the
                                        // row; any other runs.
                                        if (one.operation.fields?.length || one.operation.confirm) return setAsking({ row, operation: one.operation })
                                        void runOnRow(one.operation.name, { id: row.id })
                                      }}
                                    >
                                      {operationLabelFor({ kayan, operation: one.operation, copy })}
                                    </DropdownMenuItem>
                                  ))}
                                  {Menu ? <Menu row={row} open={setOver} /> : null}
                                  {deletes ? (
                                    <DropdownMenuItem data-row-action="delete" variant="destructive" className="max-sm:min-h-11" disabled={running} onClick={() => setDeleting(row)}>
                                      {t('admin.delete', 'Delete') ?? 'Delete'}
                                    </DropdownMenuItem>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
              )}
              {/* The table can be wider than a phone, so a sentence in a cell spanning it would be cut off at the frame's
                  edge. */}
              {page.docs.length === 0 ? (
                <div data-list-message="" className="text-muted-foreground flex min-h-24 items-center justify-center p-4 text-center text-sm">
                  {filtered ? (
                    <span className="flex flex-col items-center gap-2">
                      {t('admin.noMatches', 'No rows match this filter.') ?? 'No rows match this filter.'}
                      <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => refine({ search: undefined, where: undefined })}>
                        {t('admin.clearFilters', 'Clear filters') ?? 'Clear filters'}
                      </Button>
                    </span>
                  ) : Empty && screen ? (
                    <Empty page={screen.page} />
                  ) : (
                    (t(`${kayan.name}.none`) ?? t('admin.empty', 'Nothing here yet.') ?? 'Nothing here yet.')
                  )}
                </div>
              ) : unreadable ? (
                // Rows with no column to draw would read as records with nothing in them, so the list says what it
                // cannot show, and whom to ask
                <div data-list-message="" className="text-muted-foreground flex min-h-24 items-center justify-center p-4 text-center text-sm">
                  {t('admin.noColumns', 'Your role can\'t see any column of this list. Ask an administrator of your organization for access.')}
                </div>
              ) : null}
              {more === false ? null : <div data-scroll-cue="" aria-hidden className="from-card pointer-events-none absolute inset-y-0 w-10 bg-linear-to-l to-transparent rtl:bg-linear-to-r" style={{ insetInlineEnd: more }} />}
            </div>

            <span id={openHint} hidden>
              {t('admin.openRow', 'Press Enter to open this row.') ?? 'Press Enter to open this row.'}
            </span>

            {/* Drawn once below the table rather than inside the menu, which closes as its item is pressed and would
                take a dialog inside it along. */}
            {deletes ? (
              <DeleteButton
                busy={running}
                copy={copy}
                kayan={kayan}
                label={t('admin.delete', 'Delete') ?? 'Delete'}
                open={deleting !== undefined}
                onOpenChange={(open) => (open ? undefined : setDeleting(undefined))}
                row={deleting}
                onDelete={(refuse) => runOnRow('delete', { id: deleting?.id }, refuse)}
              />
            ) : null}
            {asking ? (
              <OperationButton
                api={api}
                busy={running}
                copy={copy}
                description={rowWarning({ kayan, row: asking.row, operation: asking.operation.name, copy })}
                inputOf={(values) => ({ ...values, id: asking.row.id })}
                kayan={kayan}
                kayans={client}
                operation={asking.operation}
                open
                onOpenChange={(open) => (open ? undefined : setAsking(undefined))}
                run={(input, refuse) => runOnRow(asking.operation.name, input, refuse)}
              />
            ) : null}
            {over}

            {unreadable ? null : (
              <Pagination
                page={page}
                t={t}
                locale={locale}
                onPage={(next) => onQuery({ ...query, page: next })}
                onLimit={(limit) => refine({ limit })}
              />
            )}

            {edits && editing !== undefined ? (
              <div data-mithaq-inline-edit={editing ? String(editing.id ?? '') : 'new'} className="bg-muted/30 rounded-md border p-3">
                <Form
                  kayan={kayan}
                  screen={screen && { ...screen, kayan }}
                  nodes={node!.columns}
                  client={edits.client}
                  writes={edits.writes}
                  value={editing}
                  t={t}
                  locale={locale}
                  locales={locales}
                  kayans={client}
                  api={api}
                  onDone={() => setEditing(undefined)}
                  onCancel={() => setEditing(undefined)}
                />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function ListButton({
  api,
  client,
  copy,
  description,
  disabled,
  inputOf,
  kayan,
  onRan,
  onRefused,
  operation,
  run,
  screen,
}: {
  api?: FindApi
  client?: readonly ClientKayan[]
  copy: Copy
  description?: string
  disabled?: boolean
  inputOf: (values: Record<string, unknown>) => Record<string, unknown>
  kayan: ClientKayan
  onRan?: (written: unknown) => void
  onRefused: (thrown: unknown) => void
  operation: PageButton
  run: (operation: string, input: Record<string, unknown>) => Promise<unknown>
  screen?: ScreenPage
}): ReactElement {
  const [busy, setBusy] = useState(false)
  const call = async (input: Record<string, unknown>, refuse: (thrown: unknown) => void = onRefused) => {
    // Every path ends here, so a button that ignores `busy` sends nothing too.
    if (disabled) return false
    setBusy(true)
    onRefused(undefined)
    try {
      onRan?.(await run(operation.name, input))
      return true
    } catch (thrown) {
      refuse(thrown)
      return false
    } finally {
      setBusy(false)
    }
  }
  const Own = refOf({ screen, place: 'button', path: operation.component })
  if (Own && screen) {
    return <OwnButton Own={Own} operation={operation} busy={busy || disabled === true} copy={copy} call={async (input: Row) => void (await call(inputOf(input)))} />
  }
  if (!operation.fields?.length) return <NodeButton node={operation} copy={copy} busy={busy || disabled === true} description={description} run={() => void call(inputOf({}))} />
  return (
    <OperationButton
      api={api}
      busy={busy || disabled === true}
      copy={copy}
      description={description}
      inputOf={inputOf}
      kayan={kayan}
      kayans={client}
      operation={operation}
      run={call}
    />
  )
}
