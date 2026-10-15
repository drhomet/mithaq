// What `/portal` itself draws for the courses example, in the portal's own look: a greeting, the viewer's next
// session, and a few courses on offer it holds no seat in yet. It is the asas's own, since a screen's root page is
// drawn from the project, and draws with the courses feature's portal pieces.
import { useSyncExternalStore } from 'react'
import { CalendarDays, MapPin } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useClient, useLocale, useScreen, useUser } from 'mithaq/admin/react'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PortalShell, display } from '@asas/courses/portal/ui/portal-shell.tsx'
import { CardsLoading, Cover, CourseCard, ReadFailed, usePlace } from '@asas/courses/portal/ui/parts.tsx'
import { byWhen, partOfDay, startsIn, whenOf } from '@asas/courses/portal/ui/portal.ts'
import { catalogueOf, readSeats } from '@asas/courses/portal/ui/reads.ts'

/** How many courses the home offers before its link to the rest. */
const offered = 3

/** The hour on the viewer's own clock, and none on the server, which knows neither the clock nor the zone. */
const useHour = () => useSyncExternalStore(() => () => {}, () => new Date().getHours(), () => undefined)

export function Home() {
  const { locale, t } = useLocale()
  const client = useClient()
  const screen = useScreen()
  const user = useUser()
  const place = usePlace()
  const hour = useHour()
  const now = Date.now()
  // The viewer's own seats, whoever it is: an instructor reads every seat, and its next session is still its own.
  const mine = useQuery({
    queryKey: ['portal-mine', user.id],
    queryFn: () => readSeats({ client, maxLimit: screen.maxLimit, where: { student: { equals: user.id } } }),
    enabled: !!user.id,
  })
  const catalogue = useQuery({ queryKey: ['portal-catalogue'], queryFn: () => catalogueOf({ client, maxLimit: screen.maxLimit, now }), staleTime: 30_000 })
  const next = mine.data && byWhen(mine.data, now).upcoming[0]
  const held = new Set(mine.data?.map((one) => String(one.course?.id)))
  // A course the student may enroll itself in, with a session to come, and no seat of its own in it yet.
  const open = catalogue.data?.courses.filter((course) => course.selfEnroll === true && !held.has(String(course.id)) && catalogue.data.next.has(String(course.id))).slice(0, offered)
  // One sentence per locale, so each says the name where its grammar puts it.
  const greeting = (hour === undefined ? t('portal.welcome', 'Welcome, {name}') : t(`portal.greeting.${partOfDay(hour)}`, 'Hello, {name}'))!.replace('{name}', () => user.name)
  return (
    <PortalShell
      regions={{
        header: <h1 className={`${display} text-3xl leading-tight sm:text-4xl`}>{greeting}</h1>,
        main: (
          <div data-dashboard="portal" className="grid gap-8">
            {mine.isPending && user.id ? <Skeleton className="h-52 rounded-3xl" /> : next ? (
              <section aria-labelledby="next" className="bg-primary text-primary-foreground grid overflow-hidden rounded-3xl md:grid-cols-[3fr_2fr]">
                <div className="grid content-start gap-3.5 p-5 sm:p-8">
                  <h2 id="next" className="text-sm opacity-85">{t('portal.yourNext', 'Your next session')}</h2>
                  <p className={`${display} text-2xl leading-tight sm:text-3xl`}>{String(next.course?.title ?? '')}</p>
                  <div className="grid gap-1.5 text-[15px]">
                    <span className="flex items-center gap-2"><CalendarDays aria-hidden className="size-4.5 shrink-0" />{whenOf({ value: next.startsAt, locale })}</span>
                    {place(next.session) ? <span className="flex items-center gap-2"><MapPin aria-hidden className="size-4.5 shrink-0" />{place(next.session)}</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <span className="text-sm opacity-85">{t('portal.startsIn', 'Starts {when}')!.replace('{when}', () => startsIn({ value: next.startsAt, now, locale }) ?? '')}</span>
                    {next.course ? (
                      <a href={`${screen.path}/courses/${encodeURIComponent(String(next.course.id))}`} className={buttonVariants({ variant: 'secondary', className: 'bg-card text-primary h-11 rounded-full px-5 font-semibold' })}>
                        {t('portal.viewCourse', 'View course')}
                      </a>
                    ) : null}
                  </div>
                </div>
                <Cover course={next.course} cover={next.cover} className="hidden h-full min-h-60 w-full md:block" />
              </section>
            ) : null}
            <section aria-labelledby="join" className="grid gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="join" className={`${display} text-xl sm:text-2xl`}>{t('portal.canJoin', 'Courses you can join')}</h2>
                <a href={`${screen.path}/courses`} className="text-primary text-[15px] font-medium underline-offset-4 hover:underline">{t('portal.seeAll', 'See all courses')}</a>
              </div>
              {catalogue.isError ? <ReadFailed retry={() => void catalogue.refetch()} /> : !open ? <CardsLoading /> : open.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-5">
                  {open.map((course) => (
                    <CourseCard
                      key={String(course.id)}
                      course={course}
                      cover={catalogue.data!.covers.get(String(course.cover))}
                      next={catalogue.data!.next.get(String(course.id))}
                      tags={catalogue.data!.tags}
                      href={`${screen.path}/courses/${encodeURIComponent(String(course.id))}`}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">{t('portal.noneToJoin', 'No course has a session coming up just now.')}</p>
              )}
            </section>
          </div>
        ),
      }}
    />
  )
}
