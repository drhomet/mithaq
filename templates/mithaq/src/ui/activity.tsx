// The entries are read in the browser, as the viewer, from the log's own `find`,
// which answers only this tenant's entries of kayan the viewer lists and only the
// changes of columns it reads. The page holds only the fields this viewer reads
// as well, so a change the server let through for a column the page left out is
// not drawn either.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ClientField, ClientKayan, ComponentProps, Row } from 'mithaq/admin'
import { useAccess, useClient, useKayan, useLocale, useRecord, useScreen, useUser } from 'mithaq/admin/react'
import { empty } from '@asas/mithaq/mithaq/audit-sink.ts'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cellFor, useComponents } from 'mithaq-admin/components.tsx'
import type { FindApi, FoundPage, RelationshipTitles } from 'mithaq-admin/control-props.ts'
import { labelFor, operationLabelFor, type Translate } from 'mithaq-admin/copy.ts'
import { formatDate } from 'mithaq-admin/format.tsx'
import { useRelationshipTitles } from 'mithaq-admin/relationship-cell.tsx'

/** One entry as the log's `find` answers it. */
export type Entry = {
  id: string
  createdAt: string | Date
  operation: string
  actor?: string | null
  impersonatedBy?: string | null
  changes: string
}

const limit = 10

/** The columns every kayan of this project carries and no person edits, which the panel leaves out. */
const technical = new Set(['id', 'organization', 'createdAt', 'updatedAt'])

/**
 * Who a write ran as, as a relationship to the provider's people, so the panel
 * names them through the same read a relationship cell does: the active
 * organization's members by their name, and anyone that read does not answer as
 * someone.
 */
const actorField = { name: 'actor', kind: 'relationship', relationTo: 'user', label: {}, rules: {}, component: 'relationship', cell: 'relationship' } as unknown as ClientField

/**
 * What the sink writes for a command: the command, then the operating-system user
 * in parentheses. A user's id holds no space, so no person is read as one.
 */
const commandOf = /^(.+?) \((.+)\)$/

const changesOf = (entry: Entry): [string, { from: unknown; to: unknown }][] => {
  try {
    return Object.entries(JSON.parse(entry.changes) as Record<string, { from: unknown; to: unknown }>)
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
  kayan: ClientKayan
  titles?: RelationshipTitles
  t: Translate
  locale: string
}

/** The entries drawn, with nothing read: what the panel shows once a page has come back. */
export function ActivityEntries({ entries, kayan, titles, t, locale, viewer, people }: EntriesProps) {
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
    if (command) return (t('auditLog.command', 'the command {command} ({user})') ?? '').replace('{command}', () => `\u2068${command[1]}\u2069`).replace('{user}', () => `\u2068${command[2]}\u2069`)
    const title = titles?.get(`user:${id}`)
    return typeof title === 'string' ? title : (t('auditLog.someone', 'Someone') ?? 'Someone')
  }
  const drawn = (field: ClientField, value: unknown): ReactNode =>
    empty(value) ? '—' : cellFor({ cells, field })({ kayan, field, value, t, locale, titles })
  return (
    <ol className="grid gap-4 text-sm">
      {entries.map((entry) => {
        const at = new Date(entry.createdAt)
        // Every operation has its words in the log's own scope, in the past
        // tense the sentence reads in, and one a project adds before it
        // writes them falls back to the operation's own label.
        const action = t(`auditLog.action.${entry.operation}`, operationLabelFor({ kayan, operation: { name: entry.operation }, copy })) ?? entry.operation
        // Staff writing inside a member's session is named first, as the member.
        const actor = entry.impersonatedBy
          ? (t('auditLog.impersonated', '{staff} as {member}') ?? '{staff} as {member}').replace('{staff}', () => named(entry.impersonatedBy)).replace('{member}', () => named(entry.actor))
          : named(entry.actor)
        const shown = changesOf(entry).flatMap(([name, change]) => {
          const field = technical.has(name) ? undefined : kayan.fields.find((one) => one.name === name)
          return field ? [{ field, change }] : []
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
              <p className="text-muted-foreground text-xs">
                {formatDate({ value: at, locale })}
              </p>
              {shown.length ? (
                <ul className="text-muted-foreground mt-1.5 grid gap-1">
                  {shown.map(({ field, change }) => (
                    <li key={field.name} data-change={field.name} className="break-words">
                      <span className="text-foreground">{labelFor({ kayan, field, copy })}</span>
                      {': '}
                      <span data-from>{drawn(field, change.from)}</span>
                      <span aria-hidden className="mx-1 inline-block rtl:rotate-180">→</span>
                      <span data-to>{drawn(field, change.to)}</span>
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

/**
 * The panel a page names as a component node. It reads the row the page
 * draws and the kayan it belongs to off the screen, so one file serves every
 * kayan's edit page.
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
  // The row as this page last drew it: a save moves its `updatedAt`, and the
  // panel reads its entries again from the first page, the new one on top.
  const seen = `${id}@${String(record?.updatedAt ?? '')}`
  // What has been read, and how many pages were asked for, each held with the
  // row it is for, so a page that moves to another row, or the same row
  // saved, starts at its first page rather than drawing the last one's.
  const [read, setRead] = useState<{ seen: string; docs: Entry[]; more: boolean } | { seen: string; failed: true }>()
  const [asked, setAsked] = useState({ seen, page: 1 })
  const page = asked.seen === seen ? asked.page : 1

  // The client is left out of the dependencies: the host makes a new one on
  // every render of the page, and each posts to the same route, so following it
  // would read the same page again on every render.
  useEffect(() => {
    if (!id) return
    let live = true
    const where = { and: [{ kayan: { equals: kayan.name } }, { record: { equals: id } }] }
    ;(client({ kayan: 'auditLog', operation: 'find', input: { where, sort: '-createdAt', limit, page, depth: 0 } }) as Promise<FoundPage>).then(
      (found) => {
        if (!live) return
        // The pages before this one, as far as they go, and this one after
        // them, less any entry already drawn: a write that lands between two
        // pages moves every older entry down one, so the next page opens on
        // the one the last page ended with.
        setRead((held) => {
          const before = held?.seen === seen && 'docs' in held ? held.docs.slice(0, (page - 1) * limit) : []
          const drawn = new Set(before.map((entry) => entry.id))
          return { seen, docs: [...before, ...(found.docs as Entry[]).filter((entry) => !drawn.has(entry.id))], more: found.hasNextPage }
        })
      },
      () => live && setRead({ seen, failed: true }),
    )
    return () => {
      live = false
    }
  }, [kayan.name, seen, page])

  // Every kayan this screen crosses, read through the screen's own client, so
  // a relationship's value and the actor are named the way a list names them.
  const kayans = useMemo(() => Object.values(screen.kayan), [screen])
  const api = useMemo<FindApi>(
    () => Object.fromEntries(kayans.map((one) => [one.name, { find: (input: Row) => client({ kayan: one.name, operation: 'find', input }) as Promise<FoundPage> }])),
    [kayans],
  )
  const shown = read?.seen === seen ? read : undefined
  const entries = shown && 'docs' in shown ? shown.docs : []
  // Each entry's actor, both people of an impersonation, and every value a
  // change holds, as rows the title read groups by the kayan each points at.
  const docs = entries.flatMap((entry) => [
    { actor: [entry.actor, entry.impersonatedBy].filter(Boolean) },
    ...changesOf(entry).flatMap(([name, change]) => [{ [name]: change.from }, { [name]: change.to }]),
  ])
  const titles = useRelationshipTitles({ fields: [...kayan.fields, actorField], docs, context: { api, client: kayans, locale } })

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
            {shown.more ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setAsked({ seen, page: page + 1 })}>
                {t('auditLog.more', 'Show older')}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
