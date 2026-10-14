// What an enrollment's session column draws: the session's course by its title, then when it starts, which tells two sessions of one course apart.
// A session is titled by its start and a title is one field, so the course is a second read.
//
// The list's own `useRelationshipTitles` keeps only each session's title, the start as text, and not the course it points at, so this cell reads them again:
// one read of every session the page's rows point at and one of their courses, shared by every cell of the page through the query client rather than two per cell,
// and read again once it is as old as the list's own pages. A read that failed is not kept, so the next one tries again.
// Each read is the viewer's own, so a session or a course the viewer may not read is left out, and its cell keeps what it can say.
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CellProps, FetchClient, Row } from 'mithaq/admin'
import { ListContext, useClient, useLocale, useScreen } from 'mithaq/admin/react'
import type { FoundPage } from 'mithaq-admin/control-props.ts'
import { formatDate, noValue } from 'mithaq-admin/format.tsx'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'
import { findByIds, nameOfRow, titleFieldOf } from 'mithaq-admin/relationship-control.tsx'

/** A refusal is the viewer's access answering, so it reads as no rows; anything else is a failure, and throws for the query to try again. */
const unread = (thrown: unknown): never[] => {
  if (refusalKeyOf(thrown)) return []
  throw thrown
}

const of = (client: FetchClient, kayan: string) => ({ find: (input: Record<string, unknown>) => client({ kayan, operation: 'find', input }) as Promise<FoundPage> })

/** Some courses by id, as the viewer reads them, which the session picker's label reads too. */
export const coursesOf = async ({ client, ids, maxLimit }: { client: FetchClient; ids: readonly string[]; maxLimit: number }): Promise<ReadonlyMap<string, Row>> => {
  const courses = ids.length ? await findByIds({ reads: of(client, 'courses'), ids, maxLimit }).catch(unread) : []
  return new Map(courses.map((one) => [String(one.id), one]))
}

const sessionsOf = async ({ client, ids, maxLimit }: { client: FetchClient; ids: readonly string[]; maxLimit: number }): Promise<ReadonlyMap<string, Row>> => {
  const sessions = await findByIds({ reads: of(client, 'sessions'), ids, maxLimit }).catch(unread)
  const courseIds = [...new Set(sessions.flatMap((one) => (typeof one.course === 'string' ? [one.course] : [])))]
  const course = await coursesOf({ client, ids: courseIds, maxLimit })
  return new Map(sessions.map((one) => [String(one.id), { ...one, course: course.get(String(one.course)) }]))
}

export function SessionCell({ field, value, row }: CellProps) {
  const client = useClient()
  const { locale, t } = useLocale()
  const { kayan: { courses }, maxLimit } = useScreen()
  // A list's page, or the one row a record page draws.
  // Sorted, so the same rows in another order are the same query.
  const ids = [...new Set((use(ListContext)?.page.docs ?? [row]).flatMap((one: Row) => (typeof one[field.name] === 'string' ? [one[field.name] as string] : [])))].sort()
  const { data: sessions, isError } = useQuery({ queryKey: ['session-cell', ids], queryFn: () => sessionsOf({ client, ids, maxLimit }), staleTime: 30_000 })
  if (typeof value !== 'string') return noValue
  const session = sessions?.get(value)
  const when = formatDate({ value: session?.startsAt, locale })
  const course = session?.course ? nameOfRow({ row: session.course as Row, title: titleFieldOf(courses), locale }) : undefined
  // Never the id the column holds, as the relationship cell draws none:
  // loading until the read answers, the server's render among it, a dash
  // where it failed, and not available for a session it may not read or one
  // of which it may read neither the course nor the start.
  if (!when && !course) {
    if (sessions) return t('admin.notAvailable', 'Not available')
    return isError ? '—' : t('admin.loading', 'Loading…')
  }
  // Two lines, the course over its start, so a narrow column wraps each
  // whole rather than one into the other.
  return (
    <span className="grid">
      {course ? <span className="font-medium">{course}</span> : null}
      {/* One unbroken run, so a narrow column breaks between the course and the date and never inside the date. */}
      {when ? <span className="text-muted-foreground text-xs"><bdi className="whitespace-nowrap">{when}</bdi></span> : null}
    </span>
  )
}
