// The entries are read in the browser, as the viewer, from the log's own `find`,
// which answers only this tenant's entries of kayan the viewer lists and only the
// changes of columns it reads, and narrows every search of a change to the kayan
// the viewer may be told of. The page holds only the fields this viewer reads as
// well, so a change the server let through for a column the page left out is not
// drawn either.
import { useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { ClientField, ClientKayan, ComponentProps, Row } from 'mithaq/admin'
import { FormContext, useAccess, useClient, useKayan, useLocale, useRecord, useScreen, useUser } from 'mithaq/admin/react'
import { empty, type Change } from '../mithaq/audit-sink.ts'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cellFor, useComponents } from 'mithaq-admin/components.tsx'
import { DatePicker } from 'mithaq-admin/date-control.tsx'
import { missingRow, type FindApi, type FoundPage, type RelationshipTitles } from 'mithaq-admin/control-props.ts'
import { labelFor, operationLabelFor, titleOf, type Translate } from 'mithaq-admin/copy.ts'
import { formatDate } from 'mithaq-admin/format.tsx'
import { Pagination, type PageInfo } from 'mithaq-admin/list-pagination.tsx'
import { Search } from 'mithaq-admin/list-toolbar.tsx'
import { rowKey, useRelationshipTitles } from 'mithaq-admin/relationship-cell.tsx'
import { RelationshipControl } from 'mithaq-admin/relationship-control.tsx'
import { rowTitle } from 'mithaq-admin/row-title.tsx'

/** One entry as the log's `find` answers it. */
export type Entry = {
  id: string
  createdAt: string | Date
  kayan?: string
  record?: string
  operation: string
  actor?: string | null
  impersonatedBy?: string | null
  changes: string
}

/** How many entries the record page's side column draws: the last few, the rest on the Activity page. */
const latest = 5

/** The columns every kayan of this project carries and no person edits, which the panel leaves out. */
const technical = new Set(['id', 'organization', 'createdAt', 'updatedAt'])

/**
 * Who a write ran as, as a relationship to the provider's people, so the panel
 * names them through the same read a relationship cell does: the active
 * organization's members by their name, and anyone that read does not answer as
 * someone.
 */
const actorField = { name: 'actor', kind: 'relationship', relationTo: 'user', label: {}, rules: {}, component: 'relationship', cell: 'relationship' } as unknown as ClientField

/** A record of one kayan, as a relationship to it, which titles the record each entry of the Activity page names. */
const recordField = (kayan: string) => ({ name: `record:${kayan}`, kind: 'relationship', relationTo: kayan, label: {}, rules: {} }) as unknown as ClientField

/**
 * What the sink writes for a command: the command, then the operating-system user
 * in parentheses. A user's id holds no space, so no person is read as one.
 */
const commandOf = /^(.+?) \((.+)\)$/

const changesOf = (entry: Entry): [string, Change][] => {
  try {
    return Object.entries(JSON.parse(entry.changes) as Record<string, Change>)
  } catch {
    return []
  }
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]]

/** How long ago, in the viewer's own locale, in the largest unit that is at least one. */
export const relative = ({ at, locale, now = Date.now() }: { at: Date; locale: string; now?: number }) => {
  const seconds = Math.round((at.getTime() - now) / 1000)
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units.at(-1)!
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit)
}

type EntriesProps = {
  entries: readonly Entry[]
  /** The viewer's own id, whom an entry that names them calls "You", without a read of the people. */
  viewer?: string
  /** Whether the viewer reads the provider's people, which is what lets a command's operating-system user be named. */
  people?: boolean
  /** The kayan every entry is of, where one record's entries are drawn. */
  kayan?: ClientKayan
  /** Every kayan the screen draws, which an entry of any kayan is drawn by where no one kayan is given. */
  kayans?: Readonly<Record<string, ClientKayan | undefined>>
  /** What names the record an entry is of, on a page of many records' entries. */
  record?: (entry: Entry, kayan: ClientKayan | undefined) => ReactNode
  titles?: RelationshipTitles
  t: Translate
  locale: string
}

/** The entries drawn, with nothing read: what the panel shows once a page has come back. */
export function ActivityEntries({ entries, kayan: one, kayans, record, titles, t, locale, viewer, people }: EntriesProps) {
  const copy = { t, locale }
  const { cells } = useComponents()
  // A person the title read did not name, one the reader may not read among
  // them, is someone, never the raw id.
  const named = (id: string | null | undefined) => {
    if (!id) return t('auditLog.system', 'The system') ?? 'The system'
    if (id === viewer) return t('auditLog.you', 'You') ?? 'You'
    // A command's actor, which the sink writes as one string, and which no
    // people read names: said in the viewer's locale to a reader of the
    // people, with each part isolated so the Arabic sentence keeps the
    // command's own direction.
    const command = people ? commandOf.exec(id) : null
    if (command) return (t('auditLog.command', 'the command {command} ({user})') ?? '').replace('{command}', () => `⁨${command[1]}⁩`).replace('{user}', () => `⁨${command[2]}⁩`)
    const title = titles?.get(`user:${id}`)
    return typeof title === 'string' ? title : (t('auditLog.someone', 'Someone') ?? 'Someone')
  }
  return (
    <ol className="grid gap-4 text-sm">
      {entries.map((entry) => {
        const kayan = one ?? kayans?.[entry.kayan ?? '']
        // A cut change holds JSON text, which no cell of the field's kind reads.
        const drawn = (field: ClientField, value: unknown, change: Change): ReactNode =>
          empty(value) ? '—' : change.truncated
            ? <code dir="ltr" className="break-all font-mono">{String(value)}</code>
            : cellFor({ cells, field })({ kayan: kayan!, field, value, t, locale, titles })
        const at = new Date(entry.createdAt)
        // Every operation has its words in the log's own scope, in the past
        // tense the sentence reads in, and one a project adds before it
        // writes them falls back to the operation's own label.
        const action = t(`auditLog.action.${entry.operation}`, kayan ? operationLabelFor({ kayan, operation: { name: entry.operation }, copy }) : entry.operation) ?? entry.operation
        // Staff writing inside a member's session is named first, as the member.
        const actor = entry.impersonatedBy
          ? (t('auditLog.impersonated', '{staff} as {member}') ?? '{staff} as {member}').replace('{staff}', () => named(entry.impersonatedBy)).replace('{member}', () => named(entry.actor))
          : named(entry.actor)
        // A create says what the person set: a field left empty, or a box left off, is nothing they did.
        const made = entry.operation === 'create'
        const shown = changesOf(entry).flatMap(([name, change]) => {
          const field = technical.has(name) ? undefined : kayan?.fields.find((field) => field.name === name)
          return field && !(made && (empty(change.to) || change.to === false)) ? [{ field, change }] : []
        })
        return (
          <li key={entry.id} data-entry={entry.operation} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
            <Avatar className="mt-0.5 size-8">
              <AvatarFallback>{(named(entry.impersonatedBy ?? entry.actor).trim()[0] ?? '?').toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p data-event className="font-medium">
                  {(viewer && entry.actor === viewer && !entry.impersonatedBy ? (t('auditLog.eventYou', '{action} by You') ?? '{action} by You') : (t('auditLog.event', '{action} by {actor}') ?? '{action} by {actor}')).replace('{action}', () => action).replace('{actor}', () => actor)}
                </p>
                <time dateTime={at.toISOString()} className="text-muted-foreground shrink-0 text-xs">
                  {relative({ at, locale })}
                </time>
              </div>
              {record ? <p data-record className="text-xs">{record(entry, kayan)}</p> : null}
              <p className="text-muted-foreground text-xs">
                {formatDate({ value: at, locale })}
              </p>
              {shown.length ? (
                <ul className="text-muted-foreground mt-1.5 grid gap-1">
                  {shown.map(({ field, change }) => (
                    <li key={field.name} data-change={field.name} className="break-words">
                      <span className="text-foreground">{labelFor({ kayan: kayan!, field, copy })}</span>
                      {': '}
                      {made ? null : (
                        <>
                          <span data-from>{drawn(field, change.from, change)}</span>
                          <span aria-hidden className="mx-1 inline-block rtl:rotate-180">→</span>
                        </>
                      )}
                      <span data-to>{drawn(field, change.to, change)}</span>
                      {change.truncated ? <span data-truncated className="block">{t('auditLog.truncated', 'Too long to keep whole; its start is shown.')}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground mt-1.5">{t('auditLog.none', 'No field you may read changed.')}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** The five actions the Activity filters by, each the `where` it reads the log by. */
export const actionWheres = {
  created: { operation: { equals: 'create' } },
  updated: { operation: { in: ['update', 'updateMany'] } },
  deleted: { operation: { in: ['delete', 'deleteMany'] } },
  published: { operation: { equals: 'publish' } },
  restored: { operation: { equals: 'restoreVersion' } },
} as const
export type ActionName = keyof typeof actionWheres

/** What the Activity is filtered by, every key a string a link can carry. */
export type ActivityFilters = {
  kayan?: string
  record?: string
  /** Text any changed value holds. */
  search?: string
  /** The person who wrote. */
  actor?: string
  /** The column that changed. */
  field?: string
  action?: string
  /** The first and last day, as a date box writes them, each read in the viewer's own time zone. */
  from?: string
  to?: string
}
export type ActivityQuery = ActivityFilters & { page: number; limit: number }

const filterKeys = ['kayan', 'record', 'search', 'actor', 'field', 'action', 'from', 'to'] as const

/** The start of a day in the viewer's own time zone, and of the day after it. */
const dayStart = (day: string, after = 0) => {
  const at = new Date(`${day}T00:00:00`)
  at.setDate(at.getDate() + after)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

/** The log's `where` for these filters, or nothing where none is set. */
export const whereOf = (filters: ActivityFilters) => {
  const from = filters.from ? dayStart(filters.from) : undefined
  const to = filters.to ? dayStart(filters.to, 1) : undefined
  const parts = [
    filters.kayan && { kayan: { equals: filters.kayan } },
    filters.record && { record: { equals: filters.record } },
    filters.search?.trim() && { changes: { contains: filters.search.trim() } },
    filters.actor && { actor: { equals: filters.actor } },
    filters.field && { changed: { contains: ` ${filters.field} ` } },
    filters.action && Object.hasOwn(actionWheres, filters.action) && actionWheres[filters.action as ActionName],
    from && { createdAt: { greater_than_equal: from } },
    to && { createdAt: { less_than: to } },
  ].filter((part) => !!part)
  return parts.length ? { and: parts } : undefined
}

/**
 * The filters a link carries, each the key it is named by, and anything else left out. A person
 * is left out for a reader of no people, whose read of the log refuses any filter by one.
 */
export const filtersOf = ({ search, people }: { search: string; people: boolean }): ActivityQuery => {
  const params = new URLSearchParams(search)
  if (!people) params.delete('actor')
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const limit = Number.parseInt(params.get('limit') ?? '', 10)
  return {
    ...Object.fromEntries(filterKeys.flatMap((key) => (params.get(key) ? [[key, params.get(key)!]] : []))),
    page: page > 0 ? page : 1,
    limit: limit > 0 ? limit : 10,
  }
}

/** Every kayan this screen draws, keyed by name, and the typed client's read of each for the titles. */
const useReads = () => {
  const screen = useScreen()
  const client = useClient()
  const kayans = useMemo(() => Object.values(screen.kayan), [screen])
  // The client is left out of the dependencies: the host makes a new one on
  // every render of the page, and each posts to the same route.
  const api = useMemo<FindApi>(
    () => Object.fromEntries(kayans.map((one) => [one.name, { find: (input: Row) => client({ kayan: one.name, operation: 'find', input }) as Promise<FoundPage> }])),
    [kayans],
  )
  return { kayans, api }
}

/** Every person and value an entry names, as rows the title read groups by the kayan each points at. */
const namedIn = (entries: readonly Entry[]) =>
  entries.flatMap((entry) => [
    { actor: [entry.actor, entry.impersonatedBy].filter(Boolean) },
    ...changesOf(entry).flatMap(([name, change]) => [{ [name]: change.from }, { [name]: change.to }]),
  ])

/**
 * The panel a page names as a component node: a record's last few entries. It
 * reads the row the page draws and the kayan it belongs to off the screen, so
 * one file serves every kayan's edit page, and links the rest on the Activity
 * page, filtered to this record.
 */
export function Activity(_: ComponentProps) {
  const { t, locale } = useLocale()
  const kayan = useKayan()
  const record = useRecord()
  const client = useClient()
  const screen = useScreen()
  const viewer = useUser().id
  const people = useAccess().collections?.user?.read === true
  const id = record?.id === undefined ? undefined : String(record.id)
  // The row as this page last drew it, and every save the form beside it
  // landed: a save, a draft, a publish or an autosave writes an entry, and the
  // panel reads its entries again. A draft save moves no `updatedAt` of the row
  // the page holds, so the count is what says it landed.
  const saves = useContext(FormContext)?.saves ?? 0
  const seen = `${id}@${String(record?.updatedAt ?? '')}@${saves}`
  const [read, setRead] = useState<{ seen: string; docs: Entry[]; more: boolean } | { seen: string; failed: true }>()

  useEffect(() => {
    if (!id) return
    let live = true
    const where = { and: [{ kayan: { equals: kayan.name } }, { record: { equals: id } }] }
    ;(client({ kayan: 'auditLog', operation: 'find', input: { where, sort: '-createdAt', limit: latest, page: 1, depth: 0 } }) as Promise<FoundPage>).then(
      (found) => live && setRead({ seen, docs: found.docs as Entry[], more: found.hasNextPage }),
      () => live && setRead({ seen, failed: true }),
    )
    return () => {
      live = false
    }
  }, [kayan.name, seen])

  const { kayans, api } = useReads()
  const shown = read?.seen === seen ? read : undefined
  const entries = shown && 'docs' in shown ? shown.docs : []
  const titles = useRelationshipTitles({ fields: [...kayan.fields, actorField], docs: namedIn(entries), context: { api, client: kayans, locale } })
  // The Activity page, where the screen has one, which the rest of this record's entries are on.
  const page = screen.pages.activity?.path
  const all = page && id ? `${screen.path}${page}?${new URLSearchParams({ kayan: kayan.name, record: id })}` : undefined

  return (
    <Card data-panel="activity">
      <CardHeader>
        <CardTitle>{t('auditLog.activity', 'Activity')}</CardTitle>
      </CardHeader>
      <CardContent>
        {shown === undefined ? (
          <p className="text-muted-foreground text-sm">{t('auditLog.loading', 'Loading activity…')}</p>
        ) : 'failed' in shown ? (
          <p className="text-destructive text-sm">{t('auditLog.failed', 'The activity could not be read.')}</p>
        ) : !entries.length ? (
          <p className="text-muted-foreground text-sm">{t('auditLog.empty', 'Nothing has changed here yet.')}</p>
        ) : (
          <div className="grid gap-4">
            <ActivityEntries entries={entries} kayan={kayan} titles={titles} t={t} locale={locale} viewer={viewer} people={people} />
            {shown.more && all ? (
              <a data-all-activity href={all} className="text-foreground text-sm underline underline-offset-4 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">
                {t('auditLog.all', 'All activity')}
              </a>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** One filter's label above its box, the label naming the box for a screen reader. */
function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

/** A choice among `options`, or none: shadcn's select, its trigger naming what is chosen in words. */
function Choice({ id, value, options, any, onChange }: { id: string; value: string | undefined; options: readonly { value: string; label: string }[]; any: string; onChange: (value: string | undefined) => void }) {
  return (
    <Select value={value ?? ''} onValueChange={(next: string | null) => onChange(next || undefined)}>
      <SelectTrigger id={id} className="w-full max-sm:data-[size=default]:h-11">
        <SelectValue>{options.find((one) => one.value === value)?.label ?? any}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{any}</SelectItem>
        {options.map((one) => (
          <SelectItem key={one.value} value={one.value}>{one.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The Activity: entries newest first, searched, filtered and paged on the
 * server. On one record (`kayan` and `record` given) it filters by person,
 * column, action and day; across the organization by the kayan too, and each
 * entry names its record with a link to it. It is read-only: nothing here
 * writes, and the log declares no write a caller could run.
 */
export function ActivityLog({ kayan: fixed, record, query, onQuery, refresh = 0 }: {
  kayan?: ClientKayan
  record?: string
  query: ActivityQuery
  onQuery: (query: ActivityQuery) => void
  /** A count that reads the page again when it moves, such as the saves of the form beside it. */
  refresh?: number
}) {
  const { t, locale } = useLocale()
  const client = useClient()
  const screen = useScreen()
  const viewer = useUser().id
  const access = useAccess()
  const people = access.collections?.user?.read === true
  const copy = { t, locale }
  const { kayans, api } = useReads()
  const ids = { person: useId(), kayan: useId(), field: useId(), action: useId(), from: useId(), to: useId() }
  const filters = fixed ? { ...query, kayan: fixed.name, record } : query
  const asked = JSON.stringify([whereOf(filters), query.page, query.limit, refresh])
  const [read, setRead] = useState<{ asked: string; page: FoundPage & PageInfo } | { asked: string; failed: true }>()
  useEffect(() => {
    let live = true
    ;(client({ kayan: 'auditLog', operation: 'find', input: { where: whereOf(filters), sort: '-createdAt', limit: query.limit, page: query.page, depth: 0 } }) as Promise<FoundPage & PageInfo>).then(
      (page) => live && setRead({ asked, page }),
      () => live && setRead({ asked, failed: true }),
    )
    return () => {
      live = false
    }
  }, [asked])

  const shown = read?.asked === asked ? read : undefined
  const entries = shown && 'page' in shown ? (shown.page.docs as Entry[]) : []
  // A filter changed reads from the first page again, as a list's does.
  const refine = (next: ActivityFilters) => onQuery({ ...query, ...next, page: 1 })
  const any = t('auditLog.any', 'Any') ?? 'Any'
  const kayan = fixed ?? screen.kayan[query.kayan ?? '']
  // The kayan the viewer lists, which are the kayan whose entries it reads.
  const listed = screen.nav.flatMap((entry) => (entry.kayan && screen.kayan[entry.kayan] ? [screen.kayan[entry.kayan]!] : []))
  const fields = kayan ? kayan.fields.filter((field) => !technical.has(field.name) && field.kind !== 'join') : []
  const filtered = filterKeys.some((key) => key !== 'kayan' && key !== 'record' ? query[key] : !fixed && query[key])
  // Each record an entry names, titled by its own kayan's read.
  const recordFields = [...new Set(entries.map((entry) => entry.kayan ?? ''))].filter((name) => screen.kayan[name]).map(recordField)
  const titles = useRelationshipTitles({
    fields: [...(kayan?.fields ?? []), ...(fixed ? [] : Object.values(screen.kayan).flatMap((one) => one?.fields ?? [])), actorField, ...recordFields],
    docs: [...namedIn(entries), ...(fixed ? [] : entries.map((entry) => ({ [`record:${entry.kayan}`]: entry.record })))],
    context: { api, client: kayans, locale },
  })
  const recordOf = (entry: Entry, of: ClientKayan | undefined) => {
    if (!of || !entry.record) return null
    const row = titles.get(rowKey(of.name, entry.record))
    const name = row && typeof row === 'object' && !(row instanceof Error) ? rowTitle({ kayan: of, row: row as Row, locale }) ?? titleOf({ kayan: of, copy }) : row === true ? missingRow({ t, gone: true }) : titleOf({ kayan: of, copy })
    const edit = of.pages.edit?.path
    const said = `${titleOf({ kayan: of, copy })}: ${name}`
    // A record gone, or one with no page to open, is named and not linked.
    return edit && row !== true ? <a href={`${screen.path}${edit.replace(':id', encodeURIComponent(entry.record))}`} className="text-foreground underline underline-offset-4">{said}</a> : <span className="text-foreground">{said}</span>
  }

  return (
    <section data-activity-log className="grid min-w-0 gap-4">
      <div role="group" aria-label={t('auditLog.filters', 'Filter the activity') ?? 'Filter the activity'} className="grid gap-3">
        <Search value={query.search} fields={[t('auditLog.searchChanges', 'changed values') ?? 'changed values']} locale={locale} t={t} onSearch={(search) => refine({ search })} />
        {/* The server searches a change's text only in the kayan whose every column the reader reads,
            and a reader graded column by column may read some kayan in part: the page holds no list of
            the columns it does not read, so it says so rather than guessing which. */}
        {Array.isArray(access.permissions) ? <p data-search-limited className="text-muted-foreground text-xs">{t('auditLog.searchLimited', 'The search covers the records whose every field you may read.')}</p> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people && screen.kayan.auditLog ? (
            <Labelled id={ids.person} label={t('auditLog.person', 'Person') ?? 'Person'}>
              <RelationshipControl
                id={ids.person}
                field={actorField}
                kayan={screen.kayan.auditLog}
                client={kayans}
                api={api}
                value={query.actor ?? null}
                values={{}}
                setValue={() => {}}
                onChange={(actor) => refine({ actor: typeof actor === 'string' ? actor : undefined })}
                readOnly={false}
                t={t}
                locale={locale}
              />
            </Labelled>
          ) : null}
          {fixed ? null : (
            <Labelled id={ids.kayan} label={t('auditLog.type', 'Record type') ?? 'Record type'}>
              <Choice id={ids.kayan} value={query.kayan} any={any} options={listed.map((one) => ({ value: one.name, label: titleOf({ kayan: one, copy, many: true }) }))} onChange={(next) => refine({ kayan: next, field: undefined, record: undefined })} />
            </Labelled>
          )}
          <Labelled id={ids.field} label={t('auditLog.field', 'Field') ?? 'Field'}>
            <Choice id={ids.field} value={query.field} any={any} options={fields.map((field) => ({ value: field.name, label: labelFor({ kayan: kayan!, field, copy }) }))} onChange={(field) => refine({ field })} />
          </Labelled>
          <Labelled id={ids.action} label={t('auditLog.actionFilter', 'Action') ?? 'Action'}>
            <Choice id={ids.action} value={query.action} any={any} options={Object.keys(actionWheres).map((name) => ({ value: name, label: t(`auditLog.filter.${name}`, name) ?? name }))} onChange={(action) => refine({ action })} />
          </Labelled>
          {(['from', 'to'] as const).map((edge) => (
            <Labelled key={edge} id={ids[edge]} label={t(`auditLog.${edge}`, edge) ?? edge}>
              <DatePicker
                id={ids[edge]}
                field={{ name: edge, kind: 'date', label: { [locale]: t(`auditLog.${edge}`, edge) ?? edge }, rules: {} } as unknown as ClientField}
                kayan={screen.kayan.auditLog!}
                value={query[edge] ?? null}
                values={{}}
                setValue={() => {}}
                onChange={(day) => refine({ [edge]: typeof day === 'string' ? day : undefined })}
                readOnly={false}
                t={t}
                locale={locale}
              />
            </Labelled>
          ))}
        </div>
        {filtered ? (
          <div className="flex flex-wrap items-center gap-2">
            {!fixed && query.record ? <p className="text-muted-foreground text-sm">{t('auditLog.oneRecord', 'One record\'s activity.')}</p> : null}
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => onQuery({ page: 1, limit: query.limit })}>
              {t('auditLog.clear', 'Clear filters')}
            </Button>
          </div>
        ) : null}
      </div>
      {/* One short line a screen reader hears as a read lands, never the whole list. */}
      <p aria-live="polite" className={`text-sm ${shown && 'failed' in shown ? 'text-destructive' : 'text-muted-foreground'}`}>
        {shown === undefined
          ? t('auditLog.loading', 'Loading activity…')
          : 'failed' in shown
            ? t('auditLog.failed', 'The activity could not be read.')
            : !entries.length
              ? filtered ? t('auditLog.nothing', 'No activity matches these filters.') : t('auditLog.empty', 'Nothing has changed here yet.')
              : (t('auditLog.found', 'Entries found: {count}') ?? 'Entries found: {count}').replace('{count}', () => shown.page.totalDocs.toLocaleString(locale))}
      </p>
      {entries.length ? <ActivityEntries entries={entries} kayan={fixed} kayans={screen.kayan} record={fixed ? undefined : recordOf} titles={titles} t={t} locale={locale} viewer={viewer} people={people} /> : null}
      {shown && 'page' in shown && shown.page.totalDocs > 0 ? (
        <Pagination page={shown.page} t={t} locale={locale} onPage={(page) => onQuery({ ...query, page })} onLimit={(limit) => onQuery({ ...query, limit, page: 1 })} />
      ) : null}
    </section>
  )
}

/** The Activity tab of a record's edit page: the record's whole history, beside its Versions. */
export function ActivityTab(_: ComponentProps) {
  const kayan = useKayan()
  const record = useRecord()
  const saves = useContext(FormContext)?.saves ?? 0
  const [query, setQuery] = useState<ActivityQuery>({ page: 1, limit: 10 })
  return record?.id === undefined ? null : (
    <Card>
      <CardContent>
        <ActivityLog kayan={kayan} record={String(record.id)} query={query} onQuery={setQuery} refresh={saves} />
      </CardContent>
    </Card>
  )
}
