import { isDecimal, type ClientField, type ClientKayan } from 'mithaq/admin'
import { filterPathsOf, offers, valueShapeOf, type FilterContext, type FilterPath } from './filter-operators.ts'

// The reader is a trust boundary: any bad key, field, operator or value refuses the whole URL (`QueryRefused`),
// and a link naming a field the viewer may not read is refused, never read as a smaller filter.

/** One row of the panel: a path, an operator and its value. */
export type Condition = Record<string, Record<string, unknown>>

/** The panel's state, two levels deep and never deeper: a disjunction of conjunctions, the shape of a `where` the server takes. */
export type FilterWhere = { or: { and: Condition[] }[] }

/** What the screen drives `find` with, and what the URL carries. */
export type ListQuery = {
  where?: FilterWhere
  search?: string
  sort?: string
  page?: number
  limit?: number
  /** The column accessor, prefixed `-` when the column is hidden. */
  cols?: readonly string[]
}

/** One column as the popup holds it, which is what the `-` prefix encodes. */
export type ColumnChoice = { name: string; active: boolean }

/** The URL's column list read back into choices; a `-` prefix marks a hidden column. */
export const columnsFrom = (cols: readonly string[] | undefined): ColumnChoice[] =>
  (cols ?? []).map((one) => (one.startsWith('-') ? { name: one.slice(1), active: false } : { name: one, active: true }))

/** The choices written back as the URL's column list. */
export const columnsTo = (columns: readonly ColumnChoice[]): string[] =>
  columns.map((one) => (one.active ? one.name : `-${one.name}`))

/** The page sizes the screen offers. The first is the one a list opens with. */
export const limits = [10, 25, 50, 100] as const

/**
 * The page sizes a build whose served read answers at most `maxLimit` rows
 * offers: the ones up to it, since a larger one is a 400, or the maximum alone
 * where none of them fits.
 */
export const limitsUpTo = (maxLimit: number): readonly number[] => {
  const fit = limits.filter((one) => one <= maxLimit)
  return fit.length ? fit : [maxLimit]
}

const whole = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** Why a URL was refused, which the host shows in place of the rows it never asked for. */
export class QueryRefused extends Error {
  override name = 'QueryRefused'
}
function refuse(sentence: string): never {
  throw new QueryRefused(`This link ${sentence}`)
}

/** Whether a field can order a page: the same questions the read answers before it takes a sort. */
export const canSort = (field: ClientField) =>
  field.rules.localized !== true && field.hasMany !== true && field.kind !== 'join' && field.sortable !== false

/** The fields a list may be sorted by. */
export const sortableOf = (kayan: { fields: readonly ClientField[] }) => kayan.fields.filter(canSort).map((field) => field.name)

/**
 * What a URL is read against: the paths the list filters by, the fields it
 * sorts by, and the list node's own page size, which is one the URL may name
 * whether or not the pager offers it.
 */
export type ListRules = { paths: readonly FilterPath[]; sortable: readonly string[]; limit?: number; maxLimit: number }

/** What a list node says about its query: what it filters and searches by, and the sort and limit it opens with. */
export type ListDefaults = { filters?: readonly string[]; search?: readonly string[]; sort?: string; limit?: number }

/** The rules one list node reads its URL by. */
export const rulesOf = ({ kayan, node, maxLimit, context = {} }: { kayan: ClientKayan; node: ListDefaults | undefined; maxLimit: number; context?: FilterContext }): ListRules => ({
  paths: filterPathsOf(kayan, { ...context, ...(node?.filters && { filters: node.filters }) }),
  sortable: sortableOf(kayan),
  maxLimit,
  ...(node?.limit !== undefined && { limit: node.limit }),
})

/** A `where` in `qs`'s bracket form: `where[or][0][and][0][title][like]`. */
const bracketed = /^where((?:\[[^[\]]*\])+)$/
/** `where[or][0][and][0][path][operator][index]`: seven segments and never more. */
const depth = 7
/** A `where` is at most this many values, which is far past what the panel writes. */
const most = 64
/** The three keys that reach an object's prototype, which a `where` never names. */
const unsafe = ['__proto__', 'constructor', 'prototype']

/** The `where` pairs of a URL built into the object they spell; anything `qs` would silently repair is refused. */
const treeOf = (pairs: readonly [string, string][]): unknown => {
  if (pairs.length > most) refuse(`carries more than ${most} where values.`)
  const tree: Record<string, unknown> = {}
  for (const [key, value] of pairs) {
    const segments = [...(bracketed.exec(key)?.[1] ?? refuse('carries a where that is not written in brackets.')).matchAll(/\[([^[\]]*)\]/g)].map((one) => one[1]!)
    if (segments.length > depth) refuse('is nested deeper than a where goes.')
    let at: Record<string, unknown> | unknown[] = tree
    segments.forEach((segment, index) => {
      if (unsafe.includes(segment)) refuse(`names "${segment}", which no where may name.`)
      const numbered = /^\d{1,2}$/.test(segment)
      if (numbered !== Array.isArray(at) || segment === '') refuse(`mixes a list and an object at "${segment}".`)
      const slot = at as Record<string, unknown>
      if (index === segments.length - 1) {
        if (slot[segment] !== undefined) refuse(`says "${key}" twice.`)
        slot[segment] = value
        return
      }
      slot[segment] ??= /^\d{1,2}$/.test(segments[index + 1]!) ? [] : {}
      if (typeof slot[segment] !== 'object') refuse(`says "${key}" twice.`)
      at = slot[segment] as Record<string, unknown> | unknown[]
    })
  }
  const gapless = (value: unknown): boolean =>
    !value || typeof value !== 'object' || ((!Array.isArray(value) || [...value].every((one) => one !== undefined)) && Object.values(value).every(gapless))
  if (!gapless(tree)) refuse('holds a gap in its list.')
  return tree
}

/**
 * A `where` hoisted into the panel's two levels: an `or` whose entries hold no
 * `and` gets one, a bare `and` is one group, and top-level siblings are one
 * group of their own.
 */
const hoisted = (where: Record<string, unknown>) => {
  const or = where.or as Record<string, unknown>[] | undefined
  const and = where.and as unknown[] | undefined
  // `where[or][title]` builds an object where a list belongs, which the read would refuse.
  if (or !== undefined && !Array.isArray(or)) refuse('holds an or that is no list.')
  if (and !== undefined && !Array.isArray(and)) refuse('holds an and that is no list.')
  if (or && and) refuse('holds or and and at the root of one where.')
  if (or) return or.map((group) => (Array.isArray(group.and) ? group.and : [group]))
  if (and) return [and]
  return [[where]]
}

/**
 * A moment with no zone, `2026-10-07T09:30`, as the ISO instant on the reader's own clock.
 * Anything else (a moment with its zone, text no clock reads) is handed back for the server to judge.
 */
export const instantOf = (text: string): string => {
  if (!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(text)) return text
  const local = new Date(text.replace(' ', 'T'))
  return Number.isNaN(local.getTime()) ? text : local.toISOString()
}

/** One value in the kind of its field: the URL carries strings, and the read takes typed values. */
const valueOf = (path: FilterPath, operator: string, value: unknown): unknown => {
  if (typeof value !== 'string') refuse(`asks field "${path.path}" for "${operator}" with a value that is no single value.`)
  if (path.kind === 'number' || path.kind === 'integer') {
    const number = Number(value)
    const integer = path.kind === 'integer'
    const held = value.trim() !== '' && (integer ? Number.isInteger(number) && number >= -2147483648 && number <= 2147483647 : Number.isFinite(number))
    return held ? number : refuse(`asks field "${path.path}" to equal "${value}", which is not ${integer ? 'a 32-bit integer' : 'a number'}.`)
  }
  // A decimal stays the text it is, which is the form its row holds.
  if (path.kind === 'decimal') return isDecimal(value) ? value : refuse(`asks field "${path.path}" to equal "${value}", which is not a decimal.`)
  if (path.kind === 'checkbox') return value === 'true' ? true : value === 'false' ? false : refuse(`asks field "${path.path}" to equal "${value}", which is not true or false.`)
  // A moment with no zone is read on the reader's own clock, not handed on for the store to read as UTC.
  if (path.kind === 'datetime') return instantOf(value)
  return value
}

/** A `where` off the URL, every condition checked the way the read checks one, so nothing is asked of the server that it would refuse. */
const whereOf = (paths: readonly FilterPath[], tree: unknown): FilterWhere | undefined => {
  const where = tree as Record<string, unknown>
  if (!Object.keys(where).length) return undefined
  const groups = hoisted(where).map((conditions) => ({
    and: conditions.flatMap((condition) =>
      Object.entries(condition as Record<string, unknown>).flatMap(([name, operators]) => {
        const path = paths.find((one) => one.path === name) ?? refuse(`names field "${name}", which this list does not filter by.`)
        if (!operators || typeof operators !== 'object' || Array.isArray(operators)) refuse(`names field "${name}" with no operator.`)
        return Object.entries(operators as Record<string, unknown>).map(([operator, value]): Condition => {
          if (!offers({ paths, path: name, operator })) refuse(`asks field "${name}" for "${operator}", which it does not take.`)
          const shape = valueShapeOf(operator)
          if (shape === 'list' && !Array.isArray(value)) refuse(`asks field "${name}" for "${operator}" with one value, and "${operator}" takes a list.`)
          const typed =
            shape === 'boolean' ? valueOf({ ...path, kind: 'checkbox' }, operator, value)
            : shape === 'list' ? (value as unknown[]).map((one) => valueOf(path, operator, one))
            : valueOf(path, operator, value)
          return { [name]: { [operator]: typed } }
        })
      }),
    ),
  }))
  return { or: groups }
}

/** What a reader is handed: the URL's own search params, or the router's record of them. */
export type QuerySource = URLSearchParams | Readonly<Record<string, unknown>>

/**
 * The URL's list keys as the strings it carries: every `where[…]` pair,
 * `search`, `sort`, `page`, `limit` and `cols`. A route validates its search
 * into this before any kayan is in hand; `readQuery` reads it against the list.
 */
export type RawQuery = Readonly<Record<string, string>>

/** A key with a list-of-another-kayan prefix taken off (`sessions.course.page` is `page`), so two lists on one page never read each other's. */
const baseOf = (key: string) => key.replace(/^[^.[\]]+\.[^.[\]]+\./, '')
const listKey = (key: string) => {
  const base = baseOf(key)
  return base.startsWith('where') || ['search', 'sort', 'page', 'limit', 'cols'].includes(base)
}

/** The prefix one list node's keys carry in the URL: none for a page's own list, `<of>.<where>.` for a list of another kayan. */
export const prefixOf = (node: { of?: string; where?: string } | undefined) => (node?.of ? `${node.of}.${node.where}.` : '')

const ownKey = (key: string, prefix: string) => key.startsWith(prefix) && baseOf(key) === key.slice(prefix.length)

/** One list's own keys off the URL's, its prefix taken off, which is what `readQuery` reads. */
export const listRaw = (raw: RawQuery, prefix: string): RawQuery =>
  Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => (ownKey(key, prefix) ? [[key.slice(prefix.length), value]] : [])))

/** The URL's keys with one list's replaced by what it now asks, every other list's kept. */
export const withList = ({ raw, prefix, written }: { raw: RawQuery; prefix: string; written: Readonly<Record<string, string>> }): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(raw).filter(([key]) => !ownKey(key, prefix))),
  ...Object.fromEntries(Object.entries(written).map(([key, value]) => [`${prefix}${key}`, value])),
})

export const readRaw = (source: QuerySource): RawQuery =>
  Object.fromEntries(
    (source instanceof URLSearchParams ? [...source] : Object.entries(source)).filter(
      (pair): pair is [string, string] => listKey(pair[0]) && typeof pair[1] === 'string',
    ),
  )

/**
 * The whole query, read against the list it is for, or `QueryRefused` for a
 * URL that asks for what the list does not offer.
 */
export const readQuery = (source: QuerySource, rules: ListRules): ListQuery => {
  const raw = readRaw(source)
  const where = whereOf(rules.paths, treeOf(Object.entries(raw).filter(([key]) => key.startsWith('where'))))
  const { search, sort, cols } = raw
  if (sort && !rules.sortable.includes(sort.replace(/^-/, ''))) refuse(`sorts by "${sort.replace(/^-/, '')}", which this list does not sort by.`)
  const page = whole(raw.page)
  const limit = whole(raw.limit)
  const list = (cols ?? '').split(',').map((one) => one.trim()).filter(Boolean)
  return {
    ...(where && { where }),
    ...(search && { search }),
    ...(sort && { sort }),
    ...(page && { page }),
    ...(limit && (limitsUpTo(rules.maxLimit).includes(limit) || limit === rules.limit) && { limit }),
    ...(list.length > 0 && { cols: list }),
  }
}

/** A value's pairs in bracket form: `where[or][0][and][0][title][like]`. */
const pairsOf = (prefix: string, value: unknown): [string, string][] =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, one]) => pairsOf(`${prefix}[${key}]`, one))
    : value === undefined ? [] : [[prefix, String(value)]]

/**
 * The same query as a URL would carry it, one string per key and no key for a
 * value that is not there. Handed to `new URLSearchParams(...)` or to a
 * router's own `search`, which is why it is a record rather than a string.
 */
export const writeQuery = (query: ListQuery): Record<string, string> => ({
  ...Object.fromEntries(pairsOf('where', query.where)),
  ...(query.search && { search: query.search }),
  ...(query.sort && { sort: query.sort }),
  ...(query.page && query.page > 1 && { page: String(query.page) }),
  ...(query.limit && { limit: String(query.limit) }),
  ...(query.cols?.length && { cols: query.cols.join(',') }),
})

/**
 * The same query with one part changed and the page back at one: each of
 * filter, search, sort and limit changes which rows are on which page, and a
 * page number that outlived its result is a blank table.
 */
export const refined = (query: ListQuery, next: Partial<ListQuery>): ListQuery => ({ ...query, ...next, page: 1 })

/**
 * The per-viewer state the URL does not carry: page size and columns, in one `localStorage` key per kayan.
 * Access is in a try/catch: `localStorage` throws in a private window and is absent in a server render.
 */
export type Remembered = { limit?: number; cols?: readonly string[] }

const keyFor = (kayan: string) => `mithaq.list.${kayan}`

export const remembered = (kayan: string, maxLimit: number): Remembered => {
  try {
    const held = globalThis.localStorage?.getItem(keyFor(kayan))
    const value = held ? (JSON.parse(held) as unknown) : undefined
    if (!value || typeof value !== 'object') return {}
    const { cols, limit } = value as Remembered
    return {
      ...(typeof limit === 'number' && limitsUpTo(maxLimit).includes(limit) && { limit }),
      ...(Array.isArray(cols) && cols.every((one) => typeof one === 'string') && { cols }),
    }
  } catch {
    return {}
  }
}

export const remember = (kayan: string, value: Remembered): void => {
  try {
    globalThis.localStorage?.setItem(keyFor(kayan), JSON.stringify(value))
  } catch {
    // A viewer whose storage is full or blocked keeps the URL's answer, which
    // is the whole of what the screen needs to render.
  }
}

/** The half of a kayan a search reads: the two admin keys, the kinds, and where a relationship points. */
export type Searchable = {
  name?: string
  useAsTitle?: string
  /** The rows every list of the kayan on its screen is held to. */
  baseFilter?: unknown
  fields?: readonly { name: string; kind: string; searchable?: true; relationTo?: string; rules?: { localized?: unknown } }[]
}

/**
 * Whether the viewer may read what a search path names, in this kayan or across one relationship.
 * A projection holds only readable fields; a path it lacks would 403 and the search box would refuse every word.
 */
const reads = (kayan: Searchable, path: string, client: readonly Searchable[] = []) => {
  const [own, far] = path.split('.')
  const near = kayan.fields?.find((field) => field.name === own)
  if (!near || far === undefined) return near !== undefined
  return client.some((one) => one.name === near.relationTo && one.fields?.some((field) => field.name === far))
}

/**
 * The fields a search runs over: the node's `search`, else those declared `searchable`, else `useAsTitle`, else `id`.
 * Only the fallbacks need a text or email kind, as the read takes `like` on those alone; a uuid `id` has no search.
 */
export const searchableFields = ({ kayan, search, client }: { kayan: Searchable; search?: readonly string[]; client?: readonly Searchable[] }): readonly string[] => {
  const declared = search ?? (kayan.fields ?? []).filter((field) => field.searchable).map((field) => field.name)
  if (declared.length) return declared.filter((path) => reads(kayan, path, client))
  const name = kayan.useAsTitle ?? 'id'
  const kind = kayan.fields?.find((field) => field.name === name)?.kind
  return kind === 'text' || kind === 'email' ? [name] : []
}

/**
 * A search term as a `where`: one `like` per searchable field, ORed. `like` rather than `contains` because
 * the drizzle store splits it on whitespace and runs one `ilike` per word.
 */
export const searchWhere = ({
  kayan,
  search,
  fields = searchableFields({ kayan }),
  locales = [],
}: {
  kayan: Searchable
  search: string | undefined
  fields?: readonly string[]
  locales?: readonly string[]
}): FilterWhere | undefined => {
  const term = search?.trim()
  // A localized field is one column per locale and a `like` names one of them,
  // `name.ar`, so it is searched in every locale the host reads in.
  const paths = fields.flatMap((field) =>
    kayan.fields?.find((one) => one.name === field)?.rules?.localized === true ? locales.map((locale) => `${field}.${locale}`) : [field],
  )
  // A kayan with no searchable field is no filter at all, not a `where` of no
  // groups, which the server refuses as an empty disjunction.
  return term && paths.length ? { or: paths.map((field) => ({ and: [{ [field]: { like: term } }] })) } : undefined
}

/**
 * What one render hands `find`: the panel's `where`, the search's and the
 * screen's `baseFilter` for the kayan, ANDed in that order. One alone is passed
 * through rather than wrapped.
 */
export const findWhere = ({
  kayan,
  query,
  search,
  locales,
  client,
}: {
  kayan: Searchable
  query: ListQuery
  search?: readonly string[]
  locales?: readonly string[]
  client?: readonly Searchable[]
}): unknown => {
  const searched = searchWhere({ kayan, search: query.search, fields: searchableFields({ kayan, search, client }), locales })
  const parts = [query.where, searched, kayan.baseFilter].filter((one) => one !== undefined)
  return parts.length > 1 ? { and: parts } : parts[0]
}

/**
 * What one page asks `find`: the panel's and the search's `where`, and the URL's sort and limit over the node's defaults.
 * Server and browser both use it, so the first page and every later one share one query and cache key.
 */
export const findOf = ({
  kayan,
  query,
  node,
  locales,
  client,
}: {
  kayan: Searchable
  query: ListQuery
  node?: ListDefaults
  locales?: readonly string[]
  client?: readonly Searchable[]
}) => {
  const where = findWhere({ kayan, query, search: node?.search, locales, client })
  const sort = query.sort ?? node?.sort
  return {
    ...(where !== undefined && { where }),
    ...(sort && { sort }),
    ...(query.page && { page: query.page }),
    // None where neither names one, so the server's own `defaultLimit`
    // answers, which the build holds to its `maxLimit`.
    ...((query.limit ?? node?.limit) !== undefined && { limit: query.limit ?? node?.limit }),
  }
}

/**
 * A page's input held to the rows a list of another kayan draws: those whose
 * relationship holds the page's row, ANDed with whatever the URL asked. It is
 * part of the one input and the one cache key.
 */
export const scopedTo = (input: Readonly<Record<string, unknown>>, where: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  ...input,
  where: input.where === undefined ? where : { and: [where, input.where] },
})
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 41bf95fa8c90940a8942f07ab193a03ad1381581c59b96c0ab92b784091895bd
