// The figures are read by the page's own `loader`, which the screen host runs
// where the page is loaded, as the viewer: on the server for a page load, so the
// numbers and the series are in the first HTML, and in the browser for a client
// navigation. A figure over a kayan the report does not let the actor read is not
// requested and not drawn.
import { useEffect, useState } from 'react'
import { Banknote, BookOpen, ClipboardList, TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { LoaderTools, PageProps, Row } from 'mithaq/admin'
import { useLocale, useScreen } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { counted, formatDate } from '@/components/mithaq/controls.tsx'
import { AppShell } from '../ui/app-shell.tsx'
import { KpiCard } from '../ui/kpi-card.tsx'

const ranges = [7, 30, 90] as const
type Range = (typeof ranges)[number]

/** The range `?range=` names, and 30 for anything else, since the URL is the reader's to write. */
const rangeOf = (search: string): Range => {
  const asked = Number(new URLSearchParams(search).get('range'))
  return ranges.find((one) => one === asked) ?? 30
}

const day = 24 * 60 * 60 * 1000

/** The `range` UTC days ending today, oldest first, as `YYYY-MM-DD`. */
const daysOf = (range: Range) => Array.from({ length: range }, (_, at) => new Date(Date.now() - (range - 1 - at) * day).toISOString().slice(0, 10))

/** Every row a read matches, page by page, since a served read answers at most the build's `maxLimit` at once. */
const readAll = async ({ tools: { client, maxLimit }, kayan, where, draft }: { tools: LoaderTools; kayan: string; where?: Row; draft?: boolean }) => {
  const rows: Row[] = []
  for (let page = 1, pages = 1; page <= pages; page++) {
    const found = (await client({ kayan, operation: 'find', input: { limit: maxLimit, page, depth: 0, ...(where && { where }) }, ...(draft && { draft }) })) as { docs: Row[]; totalPages: number }
    rows.push(...found.docs)
    pages = found.totalPages
  }
  return rows
}

/** What the page draws: the counts, the fees per currency, and the enrollments of each of the widest range's days. */
export type Figures = {
  courses: number
  open: number
  /** One sum per currency, where the actor reads both a course's fee and its currency. */
  fees?: [currency: string, sum: number][]
  enrollments?: number
  perDay?: Record<string, number>
  /** The next sessions to start, each beside its course's title, where the actor reads sessions. */
  upcoming?: { id: string; course: string; startsAt: string; venue?: string; capacity?: number }[]
}

/** How many sessions the home's table lists, which is a card's worth. */
const upcomingLimit = 8

/**
 * The figures, read as the viewer. The two totals are the store's `count`.
 * The enrollments of the widest range are read once, so choosing a narrower
 * one asks the server nothing.
 */
export const loader = async (tools: LoaderTools): Promise<Figures> => {
  const { client, access } = tools
  const reads = access.collections?.enrollments?.read === true
  // The table filters and orders on a session's start and names its course,
  // so it is read only where the report lets the actor read both fields: a
  // role holding `sessions.find` and neither field is refused the filter.
  const sessionFields = access.collections?.sessions?.fields
  const readsSessions = access.collections?.sessions?.read === true && sessionFields?.startsAt?.read === true && sessionFields.course?.read === true
  // A fee is summed only beside its currency: a reader of the fee alone would
  // be handed riyals and dollars added into one number.
  const courseFields = access.collections?.courses?.fields
  const readsFees = courseFields?.fee?.read === true && courseFields.currency?.read === true
  const since = `${daysOf(90)[0]}T00:00:00.000Z`
  // The courses the way the Courses list reads them: the latest draft of every
  // row where the actor holds `findVersions`, so the card and the list count one
  // set, a course nobody has published yet among it.
  const draft = access.collections?.courses?.operations?.findVersions === true
  const [rows, enrollments, recent, next] = await Promise.all([
    readAll({ tools, kayan: 'courses', draft }),
    reads ? (client({ kayan: 'enrollments', operation: 'count', input: {} }) as Promise<{ totalDocs: number }>) : undefined,
    reads ? readAll({ tools, kayan: 'enrollments', where: { createdAt: { greater_than_equal: since } } }) : undefined,
    readsSessions
      ? (client({
        kayan: 'sessions',
        operation: 'find',
        input: { where: { startsAt: { greater_than_equal: new Date().toISOString() } }, sort: 'startsAt', limit: Math.min(upcomingLimit, tools.maxLimit), depth: 0 },
      }) as Promise<{ docs: Row[] }>)
      : undefined,
  ])
  const titles = new Map(rows.map((course) => [String(course.id), String(course.title ?? course.id)]))
  const fees: Record<string, number> = {}
  // One sum per currency, because a riyal and a dollar do not add up, and
  // none for a fee with no currency, which is no amount of any of them.
  // Of the courses not archived, the ones the card's second line counts.
  const open = rows.filter((course) => !course.archived)
  for (const course of open) if (course.currency) fees[String(course.currency)] = (fees[String(course.currency)] ?? 0) + Number(course.fee ?? 0)
  const perDay: Record<string, number> = {}
  for (const row of recent ?? []) {
    // A `Date` in process on the server, an ISO string over HTTP in the browser.
    const key = new Date(row.createdAt as string | Date).toISOString().slice(0, 10)
    perDay[key] = (perDay[key] ?? 0) + 1
  }
  return {
    courses: rows.length,
    open: open.length,
    ...(readsFees && { fees: Object.entries(fees) }),
    ...(reads && { enrollments: enrollments?.totalDocs, perDay }),
    ...(next && {
      upcoming: next.docs.map((session) => ({
        id: String(session.id),
        course: titles.get(String(session.course)) ?? String(session.course ?? ''),
        startsAt: new Date(session.startsAt as string | Date).toISOString(),
        ...(typeof session.venue === 'string' && { venue: session.venue }),
        ...(typeof session.capacity === 'number' && { capacity: session.capacity }),
      })),
    }),
  }
}

export function Dashboard({ loaderData: figures }: PageProps<Figures>) {
  const { dir, locale, t } = useLocale()
  const screen = useScreen()
  const reads = figures?.perDay !== undefined
  const sessions = screen.kayan.sessions
  const sessionHref = (id: string) => `${screen.path}${sessions?.pages.edit?.path.replace(':id', encodeURIComponent(id)) ?? ''}`
  const venueOf = (value: string) => sessions?.fields.find((field) => field.name === 'venue')?.options?.find((one) => one.value === value)?.label[locale] ?? value
  const [range, setRange] = useState<Range>(30)

  // The range is in the URL, so a reload or a link keeps it. The server has no
  // location, so the first paint draws the default and this reads the URL once
  // the page is in the browser.
  useEffect(() => setRange(rangeOf(window.location.search)), [])
  const choose = (next: Range) => {
    const url = new URL(window.location.href)
    url.searchParams.set('range', String(next))
    window.history.replaceState(window.history.state, '', url)
    setRange(next)
  }

  const count = (value: number | undefined) => (value === undefined ? '…' : new Intl.NumberFormat(locale).format(value))
  const money = (value: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
    } catch {
      return `${count(value)} ${currency}`
    }
  }
  const days = daysOf(range)
  const points = days.map((key) => ({
    day: new Date(key).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    enrollments: figures?.perDay?.[key] ?? 0,
  }))
  const chartConfig = { enrollments: { label: t('dashboard.kpiEnrollments', 'Enrollments'), color: 'var(--chart-1)' } } satisfies ChartConfig
  // Counted in each locale's own plural forms, so Arabic says "7 أيام" and "30 يومًا".
  const inRange = counted({ t, locale, key: 'dashboard.kpiInRange', count: range, fallback: 'In the last {count} days' })

  return (
    <AppShell
      regions={{
        header: <h1>{t('dashboard.dashboard', 'Dashboard')}</h1>,
        main: (
          <section data-dashboard="dashboard" className="@container flex flex-col gap-4 md:gap-6">
            {/* Says enrollments only to a reader of them, who is drawn their figures. */}
            <p className="text-muted-foreground">
              {reads ? t('dashboard.dashboardAbout', 'What this organization holds, and how many have enrolled lately.') : t('dashboard.dashboardAboutCatalogue', 'What this organization holds.')}
            </p>
            {/* Two to a row on a phone, so four figures fit on one screen. Four to a
                row once the section itself is 672 pixels wide, which is what the
                main area holds beside the sidebar at `lg`, so a narrower frame
                keeps two and cuts no figure. */}
            <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
              <KpiCard
                kpi="courses"
                icon={<BookOpen className="size-4" />}
                title={t('dashboard.kpiCourses', 'Courses')}
                value={count(figures?.courses)}
                footer={t('dashboard.kpiCoursesOpen', '{count} not archived')!.replace('{count}', count(figures?.open))}
              />
              {/* One sum per line, each a left-to-right isolate, so Arabic
                  neither reorders "US$" into "$US" nor strands a separator at
                  a line's end. */}
              {!figures || figures.fees ? (
                <KpiCard
                  kpi="fees"
                  icon={<Banknote className="size-4" />}
                  title={t('dashboard.kpiFees', 'Total fees')}
                  // The placeholder every card draws until the figures arrive, so the grid does not shift.
                  value={!figures?.fees ? '…' : figures.fees.length ? figures.fees.map(([currency, sum]) => <bdi key={currency} dir="ltr" className="block w-fit">{money(sum, currency)}</bdi>) : '—'}
                  footer={t('dashboard.kpiFeesFooter', 'The fee of every course not archived, summed per currency')!}
                />
              ) : null}
              {reads ? (
                <>
                  <KpiCard
                    kpi="enrollments"
                    icon={<ClipboardList className="size-4" />}
                    title={t('dashboard.kpiEnrollments', 'Enrollments')}
                    value={count(figures?.enrollments)}
                    footer={t('dashboard.kpiAllTime', 'Since the first one')!}
                  />
                  <KpiCard
                    kpi="recent"
                    icon={<TrendingUp className="size-4" />}
                    title={t('dashboard.kpiRecent', 'New enrollments')}
                    value={count(figures && points.reduce((sum, point) => sum + point.enrollments, 0))}
                    footer={inRange}
                  />
                </>
              ) : null}
            </div>
            {reads ? (
              <Card data-chart-card="enrollments">
                <CardHeader>
                  <CardTitle>{t('dashboard.chartEnrollments', 'Enrollments per day')}</CardTitle>
                  <CardDescription>{inRange}</CardDescription>
                  <div className="flex items-center gap-1 pt-2">
                    {ranges.map((one) => (
                      <Button key={one} size="sm" variant={one === range ? 'secondary' : 'ghost'} className="max-sm:h-11" aria-pressed={one === range} onClick={() => choose(one)}>
                        {counted({ t, locale, key: 'dashboard.chartDays', count: one, fallback: '{count} days' })}
                      </Button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
                    <AreaChart data={points}>
                      <CartesianGrid vertical={false} />
                      {/* Time runs from the edge the text starts at: in Arabic
                          the oldest day is on the right and the figures too. */}
                      <XAxis dataKey="day" reversed={dir === 'rtl'} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                      <YAxis orientation={dir === 'rtl' ? 'right' : 'left'} allowDecimals={false} tickLine={false} axisLine={false} width={40} tickFormatter={(value: number) => count(value)} />
                      <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                      <Area dataKey="enrollments" type="monotone" fill="var(--color-enrollments)" fillOpacity={0.4} stroke="var(--color-enrollments)" />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            ) : null}
            {figures?.upcoming ? (
              <Card data-home-table="sessions">
                <CardHeader>
                  <CardTitle>{t('dashboard.upcoming', 'Upcoming sessions')}</CardTitle>
                  <CardDescription>{t('dashboard.upcomingAbout', 'The next sessions to start, soonest first.')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {figures.upcoming.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t('dashboard.upcomingNone', 'No session is about to start.')}</p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead>{t('sessions.course', 'Course')}</TableHead>
                            <TableHead>{t('sessions.startsAt', 'Starts at')}</TableHead>
                            <TableHead className="max-sm:hidden">{t('sessions.venue', 'Venue')}</TableHead>
                            <TableHead className="text-end max-sm:hidden">{t('sessions.capacity', 'Capacity')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {figures.upcoming.map((session) => (
                            <TableRow key={session.id}>
                              <TableCell className="font-medium">
                                <a href={sessionHref(session.id)} className="hover:underline">{session.course}</a>
                                {/* Below `sm` the venue and the capacity fold under the course's name, so the table
                                    fits a phone's width with no column cut at its edge. */}
                                {session.venue || session.capacity !== undefined ? (
                                  <span className="text-muted-foreground block text-xs font-normal sm:hidden">
                                    {[...(session.venue ? [venueOf(session.venue)] : []), ...(session.capacity === undefined ? [] : [`${t('sessions.capacity', 'Capacity')}: ${count(session.capacity)}`])].join(' · ')}
                                  </span>
                                ) : null}
                              </TableCell>
                              {/* The viewer's own clock, which the server's may not be, so the browser's reading replaces the server's without a warning.
                                  One line, so a phone does not break the date and the time over five. */}
                              <TableCell className="whitespace-nowrap tabular-nums" suppressHydrationWarning>{formatDate({ value: session.startsAt, locale })}</TableCell>
                              <TableCell className="max-sm:hidden">{session.venue ? venueOf(session.venue) : '—'}</TableCell>
                              <TableCell className="text-end tabular-nums max-sm:hidden">{session.capacity === undefined ? '—' : count(session.capacity)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </section>
        ),
      }}
    />
  )
}
