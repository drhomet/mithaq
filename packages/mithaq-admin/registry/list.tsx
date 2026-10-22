import { useId, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import type { ButtonClient, Row } from 'mithaq/admin'
import { listTitle } from 'mithaq/admin'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsTrigger } from '@/components/ui/tabs'
import { TabStrip } from 'mithaq-admin/tab-strip.tsx'
import { descriptionOf, newTitleOf, titleOf, type Copy } from 'mithaq-admin/copy.ts'
import { filterPathsOf } from 'mithaq-admin/filter-operators.ts'
import { DrawerForm } from 'mithaq-admin/form.tsx'
import { counted } from 'mithaq-admin/format.tsx'
import { ListButton } from 'mithaq-admin/list-button.tsx'
import { Columns, columnsOf, withColumns } from 'mithaq-admin/list-columns.tsx'
import { RowDialogs } from 'mithaq-admin/list-dialogs.tsx'
import { ListHeader, ListMessage } from 'mithaq-admin/list-header.tsx'
import { Pagination } from 'mithaq-admin/list-pagination.tsx'
import { searchableFields } from 'mithaq-admin/list-query.ts'
import { RowMenu } from 'mithaq-admin/list-row-menu.tsx'
import { writableFields } from 'mithaq-admin/list-selection.tsx'
import { ListTable } from 'mithaq-admin/list-table.tsx'
import { BulkBar, ListToolbar } from 'mithaq-admin/list-toolbar.tsx'
import type { ListProps } from 'mithaq-admin/list-types.tsx'
import { doneWords } from 'mithaq-admin/form-rules.tsx'
import { pageButtonOf, type PageButton } from 'mithaq-admin/node-buttons.tsx'
import { toast } from 'mithaq-admin/toast.tsx'
import { drawsKind, listOf, nodesOf, scopeOf, shown as holds } from 'mithaq-admin/node-tree.ts'
import { useRelationshipTitles } from 'mithaq-admin/relationship-cell.tsx'
import { rowTitle, rowWarning } from 'mithaq-admin/row-title.tsx'
import { refOf } from 'mithaq-admin/screen-refs.ts'
import { useListState } from 'mithaq-admin/use-list-state.tsx'

/** The host routes each row's own link, so opening a row needs no router import. */
export const openRow = (table: RefObject<HTMLTableElement | null>, id: string) =>
  [...(table.current?.querySelectorAll<HTMLAnchorElement>('a[data-row-link]') ?? [])].find((one) => one.dataset.rowLink === id)?.click()

export function List(props: ListProps): ReactElement {
  const { access, api, client, edit, href, kayan, locale, onQuery, operations, page, query, reads, run, screen, t } = props
  const copy: Copy = { t, locale }
  const node = props.node ?? listOf(screen)
  const { refine, running, refused, runOnRow, selected, setSelected, rowIds, ticked, done, setDone } = useListState({ copy, docs: page.docs, kayan, onQuery, query, run })
  /** The row being edited in place, `null` for a row being added, and nothing while no form is open. */
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)
  const edits = edit && node
    ? { ...edit, client: { ...edit.client, create: (input: Record<string, unknown>) => edit.client.create({ ...input, ...edit.prefill }) } }
    : undefined
  /** The project's items in each row's menu, and the dialog one of them opened, which outlives the menu. */
  const Menu = refOf({ screen, place: 'menu', path: node?.menu })
  const [over, setOver] = useState<ReactNode>(null)
  const columns = columnsOf({ kayan, cols: query.cols, reads, opens: node?.columns.map((column) => column.field) })
  const active = columns.flatMap((column) => kayan.fields.find((field) => field.name === column.name && column.active) ?? [])
  const titled = listTitle({ columns: active, useAsTitle: kayan.useAsTitle })
  const shown = titled ? [titled, ...active.filter((field) => field !== titled)] : active
  // One read per target for the whole page, so a relationship column is not one read per cell. Over the shown columns
  // alone, so a relationship the viewer has switched off costs no read.
  const titles = useRelationshipTitles({ fields: shown.filter((field) => node?.columns.find((column) => column.field === field.name)?.cell !== 'count'), docs: page.docs, context: { api, client, locale } })
  /** The kayan's plural, which the bulk dialog and its result name the ticked rows by. */
  const plural = titleOf({ kayan, copy, many: true })

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
  // A bulk button's boxes are the row's fields it names, cut to those this actor could write; its call is the ticked
  // rows' `where` around them.
  const bulkButtons = allowed(node?.bulk).filter((one) => holds(one.node, scope)).map((one) => ({
    ...one,
    operation: { ...one.operation, fields: writableFields(kayan, props.writes).filter((field) => one.node.fields?.includes(field.name)) },
  }))
  const rowButtons = allowed(node?.row)
  const editsRows = edits !== undefined && operations?.update === true
  const deletes = run !== undefined && operations?.delete === true && kayan.operations.some((one) => one.name === 'delete')
  const [deleting, setDeleting] = useState<Row | undefined>(undefined)
  const [asking, setAsking] = useState<{ row: Row; operation: PageButton } | undefined>(undefined)
  const table = useRef<HTMLTableElement>(null)
  /**
   * The name of a row's menu button, naming the row by its title so a reader going down the column hears each row's own; a row with no title, or with the title column hidden, keeps the shared name.
   */
  const rowActionsLabel = (row: Row) => {
    const name = titled?.name === kayan.useAsTitle && rowTitle({ kayan, row, locale })
    // Bidi-isolated, so a name in the other direction does not reorder the sentence.
    return name ? (t('admin.rowActionsFor', 'Actions for {name}') ?? 'Actions for {name}').replace('{name}', () => `\u2068${name}\u2069`) : (t('admin.rowActions', 'Row actions') ?? 'Row actions')
  }
  const openHint = useId()
  /**
   * Whether no column the list opens with is one the viewer may read, which the projection says by leaving the field out. Such a list draws no rows, nor anything that acts on them.
   */
  const unreadable = !(node?.columns.map((column) => column.field) ?? kayan.fields.map((field) => field.name)).some((name) => kayan.fields.some((field) => field.name === name))
  const picks = bulkButtons.length > 0 && !unreadable
  const button = (one: PageButton, inputOf: (values: Record<string, unknown>) => Record<string, unknown>, key: string, extra: { description?: string; disabled?: boolean; onRan?: (written: unknown) => void } = {}) => (
    <ListButton key={key} operation={one} kayan={kayan} client={client} api={api} copy={copy} screen={screen} run={run!} inputOf={inputOf} onRefused={refused} {...extra} />
  )
  /** A counted sentence about the ticked rows, capitalised though the kayan's plural may be lower case. */
  const aboutTicked = (key: string, count: number, fallback: string) => {
    const said = counted({ t, locale, key, count, fallback }).replace('{plural}', () => plural)
    return said.charAt(0).toLocaleUpperCase(locale) + said.slice(1)
  }
  const Empty = refOf({ screen, place: 'empty', path: node?.empty })
  const label = t(`${kayan.name}.new`, t('admin.new', 'New'))

  return (
    // `min-w-0` lets the list shrink inside the grid or flex row that holds it, whose items otherwise keep the width of their widest row.
    <section className={`flex w-full min-w-0 flex-1 flex-col gap-4 ${ticked.length || done ? 'pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0' : ''}`}>
      <ListHeader
        // A title node on the screen's own list page is the page's one h1, so the list keeps only its sentence; a list
        // of another kayan keeps its heading.
        title={screen && !node?.of && drawsKind({ nodes: nodesOf(screen.page), kind: 'title', scope }) ? undefined : plural}
        of={!!node?.of}
        about={descriptionOf(kayan, copy)}
        create={props.creates === false ? undefined : edits ? { label, onAdd: () => setEditing(null) } : { label, href: props.newHref }}
        t={t}
      />
      {node?.tabs?.length ? (
        // The list's tabs, each a `where` the list holds every page to, the first where the URL names none.
        <Tabs className="min-w-0 max-w-full" value={query.tab ?? node.tabs[0]!.tab} onValueChange={(tab) => refine({ tab: String(tab) })}>
          <TabStrip value={query.tab ?? node.tabs[0]!.tab} className="w-full max-w-full overflow-x-auto overflow-y-hidden justify-start pb-2 min-h-12 sm:min-h-0">
            {node.tabs.map((one) => (
              <TabsTrigger key={one.tab} value={one.tab} data-list-tab={one.tab} className="flex-none min-h-11 sm:min-h-0">
                {one.label[locale] ?? one.tab}
              </TabsTrigger>
            ))}
          </TabStrip>
        </Tabs>
      ) : null}
      <Card>
        <CardContent>
          <div className="w-full space-y-4">
            <ListToolbar
              {...{ api, client, copy, kayan }}
              search={query.search}
              searched={searchableFields({ kayan, search: node?.search, client })}
              onSearch={(search) => refine({ search })}
              paths={filterPathsOf(kayan, { client, locales: props.locales, reads, ...(node?.filters && { filters: node.filters }) })}
              where={query.where}
              onWhere={(where) => refine({ where })}
              columns={unreadable ? null : <Columns kayan={kayan} columns={columns} t={t} locale={locale} onChange={(next) => onQuery(withColumns(query, next))} />}
            >
              {allowed(node?.toolbar).filter((one) => holds(one.node, scope)).map((one, at) => button(one.operation, (values) => values, `toolbar-${at}`, { onRan: () => toast.success(doneWords({ kayan, copy, operation: one.operation })) }))}
              {picks ? (
                <BulkBar
                  ticked={ticked.length}
                  done={done}
                  t={t}
                  said={ticked.length ? (t('admin.selected', '{count} selected') ?? '{count} selected').replace('{count}', String(ticked.length)) : done ? aboutTicked('admin.bulkDone', done.count, '{plural} done: {count}.') : ''}
                >
                  {bulkButtons.map((one, at) =>
                    // Only the ticked rows still on the page, with the boxes' values as the data written over each.
                    button(one.operation, (values) => ({ where: { id: { in: ticked } }, ...(one.operation.fields.length > 0 && { data: values }) }), `bulk-${at}`, {
                      // A where of no id is a call nobody ticked, which a dialog left open over rows that left the
                      // page would confirm, so it is disabled.
                      disabled: ticked.length === 0,
                      description: aboutTicked('admin.bulkWarning', ticked.length, '{plural} you ticked: {count}. This applies to each of them.'),
                      // The ticked ids name rows the host's re-read is about to drop, so the selection is cleared
                      // and what the bulk did is said, less the rows it named as left.
                      onRan: (written) => {
                        const count = ticked.length - ((written as { errors?: readonly unknown[] } | null)?.errors?.length ?? 0)
                        setDone({ count })
                        toast.success(aboutTicked('admin.bulkDone', count, '{plural} done: {count}.'))
                        setSelected(new Set())
                      },
                    }),
                  )}
                </BulkBar>
              ) : null}
            </ListToolbar>

            <ListTable
              {...{ cellOf: new Map(node?.columns.map((column) => [column.field, column.cell])), copy, href, kayan, openHint, screen, shown, table, titles, unreadable }}
              openRow={(id) => openRow(table, id)}
              docs={page.docs} counts={page.counts}
              sort={query.sort}
              card={node?.card}
              phone={node?.phone}
              defaultSort={node?.sort}
              onSort={(sort) => refine({ sort })}
              selection={picks ? { ids: rowIds, selected, onSelect: setSelected } : undefined}
              actions={(row) => {
                const id = String(row.id ?? '')
                // The list node's row buttons whose `when` holds over this row. One a project draws with its own
                // component stays in the cell, since a menu item cannot be one.
                const offered = rowButtons.filter((one) => holds(one.node, scopeOf({ values: row, record: row, access, kayan })))
                const own = offered.filter((one) => refOf({ screen, place: 'button', path: one.operation.component }))
                const menu = offered.filter((one) => !own.includes(one))
                // A row with no page that draws it offers neither Edit nor View, and View where the report lets this
                // actor update no row of the kayan, since the row's page is then only read.
                const opens = editsRows || href(id) !== '#'
                const views = operations && operations.update !== true
                return (
                  <>
                    {own.map((one, at) => button(one.operation, (values) => ({ ...values, id: row.id }), `row-${at}`, { description: rowWarning({ kayan, row, operation: one.operation.name, copy }), onRan: () => toast.success(doneWords({ kayan, copy, operation: one.operation })) }))}
                    {opens || menu.length || deletes || Menu ? (
                      <RowMenu
                        {...{ copy, kayan, Menu, row, running }}
                        label={rowActionsLabel(row)}
                        opens={opens ? (views ? 'view' : 'edit') : undefined}
                        onOpen={() => (!views && editsRows ? setEditing(row) : openRow(table, id))}
                        menu={menu.map((one) => one.operation)}
                        // A button that asks for values or carries a confirm opens its dialog over the row; any other runs.
                        onRun={(operation) => (operation.fields?.length || operation.confirm ? setAsking({ row, operation }) : void runOnRow({ operation: operation.name, input: { id: row.id } }))}
                        open={setOver}
                        onDelete={deletes ? () => setDeleting(row) : undefined}
                      />
                    ) : null}
                  </>
                )
              }}
            >
              <ListMessage count={page.docs.length} empty={Empty && screen ? <Empty page={screen.page} /> : undefined} filtered={Boolean(query.where || query.search || (query.tab && query.tab !== node?.tabs?.[0]?.tab))} kayan={kayan} onClear={() => refine({ search: undefined, where: undefined, tab: undefined })} t={t} unreadable={unreadable} />
            </ListTable>

            <span id={openHint} hidden>
              {t('admin.openRow', 'Press Enter to open this row.') ?? 'Press Enter to open this row.'}
            </span>
            <RowDialogs {...{ api, asking, copy, deleting, deletes, kayan, running }} kayans={client} onAsked={() => setAsking(undefined)} onDeleted={() => setDeleting(undefined)} run={runOnRow} />
            {over}

            {unreadable ? null : <Pagination page={page} t={t} locale={locale} onPage={(next) => onQuery({ ...query, page: next })} onLimit={(limit) => refine({ limit })} />}

            {/* A row of another kayan is made or changed in Payload's document drawer over the page, which closes once
                the write lands; the host's re-read draws the row behind it. */}
            {edits && editing !== undefined ? (
              <DrawerForm
                {...{ api, kayan, locale, t }}
                edit={editing ? String(editing.id ?? '') : 'new'}
                title={editing ? rowTitle({ kayan, row: editing, locale }) || titleOf({ kayan, copy }) : newTitleOf({ kayan, copy })}
                screen={screen && { ...screen, kayan }}
                nodes={node!.columns}
                client={edits.client}
                writes={edits.writes}
                value={editing}
                locales={props.locales}
                kayans={client}
                onDone={() => setEditing(undefined)}
                onClose={() => setEditing(undefined)}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
