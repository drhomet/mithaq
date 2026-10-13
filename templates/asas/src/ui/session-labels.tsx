// How a session reads wherever a picker lists or holds one: its course by the
// course's title, then when it starts, since a session's own title, the start
// alone, makes two sessions on one day read alike.
//
// A session holds its course as an id, and a read populates no relationship, so
// the courses are a second read: one of every course the picker's rows point at,
// shared through the query client. Each read is the viewer's, so a course the
// viewer may not read leaves the session's title, its start, as it was.
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ProviderProps, Row } from 'mithaq/admin'
import { useClient, useLocale, useScreen } from 'mithaq/admin/react'
import { formatDate } from 'mithaq-admin/format.tsx'
import { nameOfRow, RowLabelContext, titleFieldOf, type UseRowLabel } from 'mithaq-admin/relationship-control.tsx'
import { coursesOf } from '../features/courses/enrollments/ui/session-cell.tsx'

/** The session's course and its start, or nothing for any other kayan and for a session whose course is not read yet. */
export const useSessionLabel: UseRowLabel = (target, rows) => {
  const client = useClient()
  const { locale } = useLocale()
  const { kayan, maxLimit } = useScreen()
  const sessions = target === 'sessions'
  // Sorted, so the same courses in another order are the same query.
  const ids = sessions ? [...new Set(rows.flatMap((one) => (typeof one.course === 'string' ? [one.course] : [])))].sort() : []
  const { data: courses } = useQuery({ queryKey: ['session-courses', ids], queryFn: () => coursesOf({ client, ids, maxLimit }), enabled: ids.length > 0, staleTime: 30_000 })
  if (!sessions) return undefined
  return (row: Row) => {
    const course = courses?.get(String(row.course))
    const when = formatDate({ value: row.startsAt, locale })
    // The date's own spaces are no-break ones, so a box too narrow for the whole label breaks between the course
    // and the date and never inside the date.
    return course && when ? `${nameOfRow({ row: course, title: titleFieldOf(kayan.courses), locale })} · ${when.replaceAll(' ', '\u00a0')}` : undefined
  }
}

export const SessionLabels = ({ children }: ProviderProps<ReactNode>) => <RowLabelContext value={useSessionLabel}>{children}</RowLabelContext>
