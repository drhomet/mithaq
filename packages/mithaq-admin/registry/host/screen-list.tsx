import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { ListContext, useScreen } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'
import { List } from './components/mithaq/list.tsx'
import type { ListProps, Page } from './components/mithaq/list-types.tsx'
import { QueryRefused, findOf, readQuery, readRaw, rulesOf, scopedTo, writeQuery, type ListQuery, type RawQuery } from './components/mithaq/list-query.ts'
import { counted } from './components/mithaq/format.tsx'
import { listOf } from './components/mithaq/nodes.tsx'

/**
 * The list's search as the router carries it: the URL's pairs as strings, each
 * `where[…]` pair a key of its own. The router's default would JSON-quote a
 * page number, so an app hands these two to `createRouter`.
 */
export const flatSearch = {
  parseSearch: (search: string) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search: Record<string, unknown>) => {
    const written = new URLSearchParams(Object.entries(search).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]]))).toString()
    return written ? `?${written}` : ''
  },
}

/** A page route's search: the list's own keys, each the string the URL carries, read against the list once the loader has the kayan. */
export const askedFor = (search: Record<string, unknown>): RawQuery => readRaw(search)

/** Every page of one kayan's list the browser holds, which a write to that kayan invalidates. */
export const rowsKey = (kayan: string) => ['mithaq', kayan] as const

/**
 * Whether a list of this kayan reads with `draft: true`: the kayan keeps drafts
 * and this actor holds `findVersions`. Then never-published rows are listed,
 * each shown as its latest draft, and the total is counted the same way.
 */
export const readsDrafts = (kayan: Pick<ListProps['kayan'], 'drafts'>, operations?: Readonly<Record<string, boolean>>) =>
  !!kayan.drafts && operations?.findVersions === true

/**
 * Whether this actor edits one row's drafts: it holds `findVersions`, and this row is within any limit on it.
 * A row left out gets a plain Save and no autosave, since the server answers a draft save on it 404.
 */
export const rowReadsDrafts = async ({ kayan, operations, id, findVersions }: {
  kayan: Pick<ListProps['kayan'], 'drafts'>
  operations?: Readonly<Record<string, boolean>>
  id?: string
  findVersions: (input: { where: { parent: { equals: string } }; limit: 1 }) => Promise<{ docs: readonly unknown[] } | null>
}) => readsDrafts(kayan, operations) && (id === undefined || !!(await findVersions({ where: { parent: { equals: id } }, limit: 1 }))?.docs.length)

/** A query the URL asks for, or the sentence it was refused with, which asks nothing of the server. */
export const queryOf = (props: Pick<ListProps, 'kayan' | 'client' | 'locales' | 'screen' | 'node'> & { maxLimit: number }, raw: RawQuery): { query: ListQuery } | { refused: string } => {
  try {
    return { query: readQuery(raw, rulesOf({ kayan: props.kayan, node: props.node ?? listOf(props.screen), maxLimit: props.maxLimit, context: { client: props.client, locales: props.locales } })) }
  } catch (thrown) {
    if (thrown instanceof QueryRefused) return { refused: thrown.message }
    throw thrown
  }
}

/**
 * One screen's list, over the URL and TanStack Query. The URL is the list's one
 * state; the server-rendered first page seeds the cache. A URL the list does
 * not offer is refused before any request.
 */
export function ScreenList({
  find,
  first,
  onQuery,
  own,
  props,
  raw,
  run,
  scope,
}: {
  props: Omit<ListProps, 'page' | 'query' | 'onQuery' | 'run'>
  /** The URL's search, as the route validated it. */
  raw: RawQuery
  onQuery: (search: Record<string, string>) => void
  /** The page the loader read, and the input it read it with, which seeds the cache where it is the page this URL asks for. */
  first?: { input: unknown; rows: Page }
  find: (input: Record<string, unknown>, options?: { draft?: boolean }) => Promise<Page>
  run: (operation: string, input: Record<string, unknown>) => Promise<unknown>
  /** What a list node's own component draws in place of the registry's list, reading the same props through `useList()`. */
  own?: ReactElement
  /** The rows a list of another kayan is held to: its relationship holding the page's row. */
  scope?: Readonly<Record<string, unknown>>
}): ReactElement | null {
  const queries = useQueryClient()
  // Rows the last bulk left alone: never-published drafts, which the list shows and a bulk does not write.
  const [left, setLeft] = useState(0)
  const asked = queryOf({ ...props, maxLimit: useScreen().maxLimit }, raw)
  const query = 'query' in asked ? asked.query : {}
  const found = findOf({ kayan: props.kayan, query, node: props.node ?? listOf(props.screen), locales: props.locales, client: props.client })
  const input = scope ? scopedTo(found, scope) : found
  const seeded = first && JSON.stringify(first.input) === JSON.stringify(input) ? first.rows : undefined
  const { data } = useQuery({
    queryKey: [...rowsKey(props.kayan.name), 'find', input],
    queryFn: () => find(input, readsDrafts(props.kayan, props.operations) ? { draft: true } : undefined),
    enabled: 'query' in asked,
    initialData: seeded,
    placeholderData: (previous) => previous ?? first?.rows,
    // Keeps the page the server just rendered from being read again as it
    // hydrates. An organization or actor switch that does not reload the
    // document must clear this cache, or the next actor sees the last one's pages.
    staleTime: 30_000,
  })
  if ('refused' in asked) {
    return (
      <div role="alert" data-mithaq-refused={asked.refused} className="flex flex-col items-start gap-2 rounded-md border border-destructive/50 px-3 py-2 text-sm">
        {props.t('admin.queryRefused', 'This link asks the list for something it does not offer, so nothing was read.')}
        <Button type="button" variant="outline" size="sm" onClick={() => onQuery({})}>
          {props.t('admin.clearFilters', 'Clear filters')}
        </Button>
      </div>
    )
  }
  if (!data) return null
  const list: ListProps = {
    ...props,
    page: data,
    query,
    onQuery: (next) => onQuery(writeQuery(next)),
    run: async (operation, input) => {
      const written = await run(operation, input)
      setLeft((written as { errors?: readonly unknown[] } | null)?.errors?.length ?? 0)
      await queries.invalidateQueries({ queryKey: rowsKey(props.kayan.name) })
      return written
    },
  }
  return (
    <ListContext value={list}>
      {left ? (
        <p role="status" data-mithaq-left={left} className="rounded-md border px-3 py-2 text-sm">
          {counted({ t: props.t, locale: props.locale, key: 'admin.bulkLeft', count: left, fallback: '{count} of the ticked rows were left as they are, because they have never been published.' })}
        </p>
      ) : null}
      {own ?? <List {...list} />}
    </ListContext>
  )
}
