import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import type { ButtonClient, ClientKayan, Row } from 'mithaq/admin'
import { useScreen } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { FindApi } from './control-props.ts'
import { descriptionOf, labelFor, titleOf, type Copy, type Translate } from './copy.ts'
import { DeleteButton } from './delete-button.tsx'
import { filterPathsOf } from './filter-operators.ts'
import { Form, type FormProps } from './form.tsx'
import { counted } from './format.tsx'
import { ListButton } from './list-button.tsx'
import { Columns, columnsOf, withColumns } from './list-columns.tsx'
import { Filters } from './list-filters.tsx'
import { Pagination } from './list-pagination.tsx'
import { refined, remember, remembered, searchableFields, type FilterWhere, type ListQuery } from './list-query.ts'
import { RowMenu } from './list-row-menu.tsx'
import { writableFields } from './list-selection.tsx'
import { ListTable } from './list-table.tsx'
import { BulkBar, Search } from './list-toolbar.tsx'
import { drawsKind, listOf, nodesOf, pageButtonOf, refOf, rowTitle, rowWarning, scopeOf, shown as holds, type ListNode, type PageButton, type ScreenPage } from './nodes.tsx'
import { OperationButton } from './operation-button.tsx'
import { refusalKeyOf } from './refusal.ts'
import { useRelationshipTitles } from './relationship-cell.tsx'

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
                {picks ? (
                  <BulkBar
                    ticked={ticked.length}
                    done={done}
                    t={t}
                    said={ticked.length
                      ? (t('admin.selected', '{count} selected') ?? '{count} selected').replace('{count}', String(ticked.length))
                      : done ? aboutTicked('admin.bulkDone', done.count, '{plural} done: {count}.') : ''}
                  >
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
                  </BulkBar>
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

            <ListTable
              kayan={kayan}
              copy={copy}
              screen={screen}
              shown={shown}
              docs={page.docs}
              titles={titles}
              cellOf={cellOf}
              sort={query.sort}
              defaultSort={node?.sort}
              onSort={(sort) => refine({ sort })}
              selection={picks ? { ids: rowIds, selected, onSelect: setSelected } : undefined}
              href={href}
              openHint={openHint}
              openRow={openRow}
              table={table}
              unreadable={unreadable}
              actions={(row) => {
                const id = String(row.id ?? '')
                // The list node's row buttons whose `when` holds over this row. One a project draws with its own
                // component stays in the cell, since a menu item cannot be one.
                const offered = rowButtons.filter((one) => holds(one.node, scopeOf({ values: row, record: row, access, kayan })))
                const own = offered.filter((one) => refOf({ screen, place: 'button', path: one.operation.component }))
                const menu = offered.filter((one) => !own.includes(one))
                // A row with no page that draws it offers neither Edit nor View, and View where the report lets this
                // actor update no row of the kayan, since the row's page is then only read.
                const edits = editsRows || href(id) !== '#'
                const views = operations && operations.update !== true
                return (
                  <>
                    {own.map((one, at) => button(one.operation, (values) => ({ ...values, id: row.id }), `row-${at}`, { description: rowWarning({ kayan, row, operation: one.operation.name, copy }) }))}
                    {edits || menu.length || deletes || Menu ? (
                      <RowMenu
                        kayan={kayan}
                        copy={copy}
                        row={row}
                        label={rowActionsLabel(row)}
                        opens={edits ? (views ? 'view' : 'edit') : undefined}
                        onOpen={() => (!views && editsRows ? setEditing(row) : openRow(id))}
                        menu={menu.map((one) => one.operation)}
                        running={running}
                        onRun={(operation) => {
                          // A button that asks for values or carries a confirm opens its dialog over the
                          // row; any other runs.
                          if (operation.fields?.length || operation.confirm) return setAsking({ row, operation })
                          void runOnRow(operation.name, { id: row.id })
                        }}
                        Menu={Menu}
                        open={setOver}
                        onDelete={deletes ? () => setDeleting(row) : undefined}
                      />
                    ) : null}
                  </>
                )
              }}
            >
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
            </ListTable>

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
