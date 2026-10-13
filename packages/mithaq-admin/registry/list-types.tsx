import type { ClientKayan } from 'mithaq/admin'
import type { FindApi } from 'mithaq-admin/control-props.ts'
import type { Translate } from 'mithaq-admin/copy.ts'
import type { FormProps } from 'mithaq-admin/form-types.tsx'
import type { ListQuery } from 'mithaq-admin/list-query.ts'
import type { ListNode } from 'mithaq-admin/node-tree.ts'
import type { ScreenPage } from 'mithaq-admin/screen-refs.ts'

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
