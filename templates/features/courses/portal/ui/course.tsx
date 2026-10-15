// A course's page in the portal: its cover, what it is and costs, what it covers, and its sessions still to come.
// Where the course lets its students enroll themselves, a student picks a session with a seat left and takes it;
// where it does not, the page says the school enrolls them. Who may take a seat, and whether one is left, the
// server decides: this page only offers what it would admit.
import { useState } from 'react'
import { ArrowLeft, CalendarDays, MapPin } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Row } from 'mithaq/admin'
import { holds } from 'mithaq/admin'
import { useAccess, useClient, useLocale, useRecord, useScreen, useUser } from 'mithaq/admin/react'
import { RichTextValueView } from 'mithaq-admin/rich-text-viewer.tsx'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'
import { toast } from 'mithaq-admin/toast.tsx'
import { Button } from '@/components/ui/button'
import { DirectionalIcon } from '@/components/ui/directional-icon'
import { Skeleton } from '@/components/ui/skeleton'
import { PortalShell, display } from './shell.tsx'
import { Cover, Tags, useOption, usePlace } from './parts.tsx'
import { feeOf, seatsOf, whenOf } from './rules.ts'
import { byIds, readSeats } from './reads.ts'

type Session = Row & { seatsLeft?: number | null }

export function Course() {
  const { locale, t } = useLocale()
  const client = useClient()
  const screen = useScreen()
  const access = useAccess()
  const user = useUser()
  const record = useRecord()
  const option = useOption()
  const place = usePlace()
  const queries = useQueryClient()
  const id = String(record?.id ?? '')
  // The course with its sessions and the seats each has left, which a student, who reads its own seats alone,
  // could not count; then its cover and tags, and the viewer's own seats in it.
  const read = useQuery({
    queryKey: ['portal-course', id],
    queryFn: async () => {
      const course = (await client({ kayan: 'courses', operation: 'findWithSessions', input: { id } })) as Row & { sessions: Session[] }
      const [covers, tags, mine] = await Promise.all([
        byIds({ client, maxLimit: screen.maxLimit, kayan: 'media', ids: typeof course.cover === 'string' ? [course.cover] : [] }),
        byIds({ client, maxLimit: screen.maxLimit, kayan: 'tags', ids: Array.isArray(course.tags) ? course.tags.map(String) : [] }),
        user.id && course.sessions.length ? readSeats({ client, maxLimit: screen.maxLimit, where: { and: [{ student: { equals: user.id } }, { session: { in: course.sessions.map((one) => one.id) } }] } }) : [],
      ])
      return { course, cover: covers.get(String(course.cover)), tags, mine }
    },
    enabled: !!id,
  })
  const [picked, setPicked] = useState<string>()
  const [busy, setBusy] = useState(false)
  const course = read.data?.course ?? record ?? {}
  const now = Date.now()
  // A session still to come and open; one archived takes no seat, so it is not offered.
  const sessions = (course.archived === true ? [] : read.data?.course.sessions ?? [])
    .filter((one) => one.archived !== true && new Date(one.startsAt as string).getTime() > now)
    .sort((a, b) => new Date(a.startsAt as string).getTime() - new Date(b.startsAt as string).getTime())
  // The viewer's own seat in a session of this course still to come, which it already holds.
  const held = read.data?.mine.find((one) => new Date(one.startsAt as string).getTime() > now)
  // A student takes its own seat; whoever reads every seat enrolls others from the enrollments' own page.
  const self = holds(access, 'enrollments.create') && !holds(access, 'enrollments.others')
  // Whoever runs the catalogue reads an archived course too; the portal offers none of its seats.
  const open = course.selfEnroll === true && course.archived !== true
  const chosen = sessions.find((one) => one.id === picked && one.seatsLeft !== 0)
  const fee = feeOf({ fee: course.fee, currency: course.currency, locale, t })
  const enroll = async () => {
    if (!chosen) return
    setBusy(true)
    try {
      await client({ kayan: 'enrollments', operation: 'create', input: { session: chosen.id } })
      toast.success(t('portal.enrolled', 'You are enrolled.')!)
      await queries.invalidateQueries()
    } catch (thrown) {
      const key = refusalKeyOf(thrown)
      toast.error((key && t(key)) || t('portal.enrollFailed', 'The seat was not taken. Please try again.')!)
      await queries.invalidateQueries({ queryKey: ['portal-course', id] })
    } finally {
      setBusy(false)
    }
  }
  const list = `${screen.path}/courses`
  return (
    <PortalShell
      regions={{
        header: (
          <div className="grid gap-5">
            <div className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-3xl">
              <Cover course={course} cover={read.data?.cover} className="h-56 w-full sm:h-72" />
              <a href={list} aria-label={t('portal.back', 'Back to courses')} className="bg-card text-foreground focus-visible:ring-ring absolute start-4 top-4 grid size-11 place-items-center rounded-full shadow focus-visible:ring-2 focus-visible:outline-none">
                <DirectionalIcon><ArrowLeft aria-hidden className="size-5" /></DirectionalIcon>
              </a>
            </div>
            <div className="grid gap-2.5">
              {read.data ? <Tags course={course} tags={read.data.tags} /> : null}
              <h1 className={`${display} text-3xl leading-tight`}>{String(course.title ?? '')}</h1>
              <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {fee ? <span><bdi>{fee}</bdi> {course.fee ? t('portal.perSeat', 'per seat') : null}</span> : null}
                {option('courses', 'delivery', course.delivery) ? <span>{option('courses', 'delivery', course.delivery)}</span> : null}
              </p>
            </div>
          </div>
        ),
        main: (
          <div className="grid gap-8 pb-24 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:pb-0">
            <section aria-labelledby="about" className="grid content-start gap-3">
              <h2 id="about" className="text-lg font-semibold">{t('portal.aboutCourse', 'About this course')}</h2>
              {typeof course.summary === 'string' && course.summary ? <p className="leading-relaxed">{course.summary}</p> : null}
              {course.details ? <RichTextValueView value={course.details} t={t} /> : null}
            </section>
            <section aria-labelledby="sessions" className="grid content-start gap-3">
              <h2 id="sessions" className="text-lg font-semibold">{self && open && !held ? t('portal.choose', 'Choose a session') : t('sessions.plural', 'Sessions')}</h2>
              {!read.data && !read.isError ? <Skeleton className="h-20 rounded-2xl" /> : null}
              {read.data && !sessions.length ? <p className="text-muted-foreground text-sm">{t('portal.noSession', 'No session scheduled yet')}</p> : null}
              {self && open && !held ? (
                <div role="radiogroup" aria-labelledby="sessions" className="grid gap-2.5">
                  {sessions.map((one) => {
                    const full = one.seatsLeft === 0
                    return (
                      <label key={String(one.id)} className={`bg-card flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 ${picked === one.id ? 'border-primary' : 'border-transparent'} ${full ? 'opacity-60' : 'cursor-pointer'}`}>
                        <input type="radio" name="session" value={String(one.id)} disabled={full} checked={picked === one.id} onChange={() => setPicked(String(one.id))} className="accent-primary size-5" />
                        <SessionLine session={one} place={place(one)} />
                        <span className={`shrink-0 text-sm ${full ? 'text-muted-foreground' : 'text-primary'}`}>{seatsOf({ seatsLeft: one.seatsLeft, locale, t })}</span>
                      </label>
                    )
                  })}
                </div>
              ) : (
                <ul className="grid gap-2.5">
                  {sessions.map((one) => (
                    <li key={String(one.id)} className="bg-card flex items-center gap-3 rounded-2xl px-4 py-3.5">
                      <SessionLine session={one} place={place(one)} />
                      <span className="text-muted-foreground shrink-0 text-sm">{seatsOf({ seatsLeft: one.seatsLeft, locale, t })}</span>
                    </li>
                  ))}
                </ul>
              )}
              {self && open && !held && sessions.length ? (
                // At the foot of a phone, over the tab bar, so the button stays in reach; in the flow from md up.
                <div className="bg-card fixed inset-x-0 bottom-[calc(4.25rem+max(env(safe-area-inset-bottom),0.75rem))] z-10 flex items-center gap-3 border-t px-4 py-3 md:static md:rounded-2xl md:border">
                  {fee ? (
                    <span className="grid shrink-0">
                      <span className="text-muted-foreground text-xs">{t('portal.total', 'Total')}</span>
                      <span className="text-lg font-semibold"><bdi>{fee}</bdi></span>
                    </span>
                  ) : null}
                  <Button type="button" size="lg" className="h-12 flex-1 rounded-full text-base" disabled={!chosen || busy} onClick={() => void enroll()}>
                    {chosen ? t('portal.enrollIn', 'Enroll on {when}')!.replace('{when}', () => whenOf({ value: chosen.startsAt, locale }) ?? '') : t('portal.pick', 'Pick a session')}
                  </Button>
                </div>
              ) : null}
              {held ? (
                <p className="bg-accent text-accent-foreground rounded-2xl px-4 py-3 text-sm">
                  {t('portal.holding', 'You hold a seat on {when}.')!.replace('{when}', () => whenOf({ value: held.startsAt, locale }) ?? '')}{' '}
                  <a href={`${screen.path}/enrollments`} className="font-semibold underline-offset-4 hover:underline">{t('portal.myEnrollments', 'My enrollments')}</a>
                </p>
              ) : self && !open && read.data ? (
                <p className="bg-accent text-accent-foreground rounded-2xl px-4 py-3 text-sm">{t('portal.askSchool', 'Ask your school to enroll you.')}</p>
              ) : null}
            </section>
          </div>
        ),
      }}
    />
  )
}

/** A session as a line: when it meets, and where and how. */
function SessionLine({ session, place }: { session: Row; place: string }) {
  const { locale } = useLocale()
  return (
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="flex items-center gap-1.5 font-semibold"><CalendarDays aria-hidden className="size-4 shrink-0" /><span>{whenOf({ value: session.startsAt, locale })}</span></span>
      {place ? <span className="text-muted-foreground flex items-center gap-1.5 text-sm"><MapPin aria-hidden className="size-4 shrink-0" />{place}</span> : null}
    </span>
  )
}
