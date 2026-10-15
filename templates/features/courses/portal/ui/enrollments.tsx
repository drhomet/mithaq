// The portal's enrollments, upcoming first. A student reads its own seats as cards: the course's title and cover,
// when the session meets, where and how, and, before it starts, the way to give the seat back. Whoever reads every
// seat, an instructor, reads them as a table with each seat's student, named only where the server lets it read
// that person.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { holds } from 'mithaq/admin'
import { useAccess, useClient, useLocale, useScreen } from 'mithaq/admin/react'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'
import { toast } from 'mithaq-admin/toast.tsx'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PortalShell, display } from './portal-shell.tsx'
import { CardsLoading, Cover, ReadFailed, usePlace } from './parts.tsx'
import { byWhen, startsIn, whenOf } from './portal.ts'
import { readSeats, type Seat } from './reads.ts'

export function Enrollments() {
  const { t } = useLocale()
  const client = useClient()
  const screen = useScreen()
  const access = useAccess()
  const others = holds(access, 'enrollments.others')
  // A student is never asked for people, whom it reads none of.
  const people = others && access.collections?.enrollments?.fields?.student?.read === true
  const read = useQuery({ queryKey: ['portal-enrollments', people], queryFn: () => readSeats({ client, maxLimit: screen.maxLimit, people }) })
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming')
  const now = Date.now()
  const split = read.data && byWhen(read.data, now)
  const shown = split?.[when] ?? []
  const title = others ? t('enrollments.plural', 'Enrollments') : t('portal.myEnrollments', 'My enrollments')
  const creates = others && holds(access, 'enrollments.create')
  return (
    <PortalShell
      regions={{
        header: (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className={`${display} text-3xl`}>{title}</h1>
            {creates ? <a href={`${screen.path}/enrollments/new`} className={buttonVariants({ className: 'h-11 rounded-full px-5' })}>{t('enrollments.new', 'New enrollment')}</a> : null}
          </div>
        ),
        main: (
          <div className="grid gap-5">
            <Tabs value={when} onValueChange={(value) => setWhen(value as 'upcoming' | 'past')}>
              <TabsList className="h-11 w-full max-w-sm">
                <TabsTrigger value="upcoming" className="h-9 flex-1">{t('portal.upcoming', 'Upcoming')}</TabsTrigger>
                <TabsTrigger value="past" className="h-9 flex-1">{t('portal.past', 'Past')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {read.isError ? <ReadFailed retry={() => void read.refetch()} /> : !split ? <CardsLoading count={2} /> : !shown.length ? (
              <p className="text-muted-foreground text-sm">{when === 'upcoming' ? t('portal.noneUpcoming', 'No session to come.') : t('portal.nonePast', 'No past session.')}</p>
            ) : others ? (
              <SeatTable seats={shown} people={people} />
            ) : (
              <ul className="grid gap-3.5">
                {shown.map((one, at) => <SeatCard key={String(one.seat.id)} seat={one} first={when === 'upcoming' && at === 0} now={now} canLeave={when === 'upcoming' && holds(access, 'enrollments.delete')} />)}
              </ul>
            )}
          </div>
        ),
      }}
    />
  )
}

/** One seat of the viewer's own as a card, the soonest one marked. */
function SeatCard({ seat, first, now, canLeave }: { seat: Seat; first: boolean; now: number; canLeave: boolean }) {
  const { locale, t } = useLocale()
  const screen = useScreen()
  const place = usePlace()
  const soon = startsIn({ value: seat.startsAt, now, locale })
  const where = place(seat.session)
  return (
    <li className="bg-card overflow-hidden rounded-2xl">
      <div className="flex gap-3.5 p-4">
        <Cover course={seat.course} cover={seat.cover} className="size-18 shrink-0 rounded-xl" />
        <div className="grid min-w-0 content-start gap-1">
          <h2 className="text-[17px] leading-snug font-semibold">{String(seat.course?.title ?? t('admin.notAvailable', 'Not available'))}</h2>
          <p className="text-sm">{whenOf({ value: seat.startsAt, locale })}</p>
          {where ? <p className="text-muted-foreground text-sm">{where}</p> : null}
        </div>
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${first ? 'bg-accent' : 'border-t'}`}>
        <span className={`text-sm ${first ? 'text-accent-foreground font-semibold' : 'text-muted-foreground'}`}>{soon ? t('portal.startsIn', 'Starts {when}')!.replace('{when}', () => soon) : null}</span>
        <div className="flex gap-2">
          {canLeave ? <Leave seat={seat} /> : null}
          {seat.course ? (
            <a href={`${screen.path}/courses/${encodeURIComponent(String(seat.course.id))}`} className={buttonVariants({ className: 'h-11 rounded-full px-4' })}>{t('portal.course', 'Course')}</a>
          ) : null}
        </div>
      </div>
    </li>
  )
}

/** Gives a seat back before its session starts, behind a question, since the seat goes to whoever takes it next. */
function Leave({ seat }: { seat: Seat }) {
  const { t } = useLocale()
  const client = useClient()
  const queries = useQueryClient()
  const [asking, setAsking] = useState(false)
  const leave = async () => {
    try {
      await client({ kayan: 'enrollments', operation: 'delete', input: { id: seat.seat.id } })
      toast.success(t('portal.left', 'Your enrollment is cancelled.')!)
    } catch (thrown) {
      const key = refusalKeyOf(thrown)
      toast.error((key && t(key)) || t('portal.leaveFailed', 'The enrollment was not cancelled. Please try again.')!)
    }
    await queries.invalidateQueries()
  }
  return (
    <>
      <Button type="button" variant="ghost" className="text-destructive h-11 rounded-full px-4" onClick={() => setAsking(true)}>{t('portal.leave', 'Cancel enrollment')}</Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('portal.leaveTitle', 'Cancel this enrollment?')}</AlertDialogTitle>
            <AlertDialogDescription>{t('portal.leaveBody', 'Your seat goes back to the session, and someone else may take it.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="max-sm:[&_button]:h-11">
            <AlertDialogCancel>{t('portal.keep', 'Keep it')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              setAsking(false)
              void leave()
            }}>{t('portal.leave', 'Cancel enrollment')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Every seat the viewer reads as a table, with each seat's student where the viewer reads people. */
function SeatTable({ seats, people }: { seats: readonly Seat[]; people: boolean }) {
  const { locale, t } = useLocale()
  const screen = useScreen()
  const place = usePlace()
  return (
    <div className="bg-card overflow-x-auto rounded-2xl">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('courses.singular', 'Course')}</TableHead>
            <TableHead>{t('sessions.singular', 'Session')}</TableHead>
            <TableHead>{t('portal.place', 'Venue and format')}</TableHead>
            {people ? <TableHead>{t('enrollments.student', 'Student')}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {seats.map((one) => (
            <TableRow key={String(one.seat.id)}>
              <TableCell>
                <a href={`${screen.path}/enrollments/${encodeURIComponent(String(one.seat.id))}`} className="flex items-center gap-2.5 font-medium underline-offset-4 hover:underline">
                  <Cover course={one.course} cover={one.cover} className="size-9 shrink-0 rounded-lg" />
                  {String(one.course?.title ?? t('admin.notAvailable', 'Not available'))}
                </a>
              </TableCell>
              <TableCell className="whitespace-nowrap">{whenOf({ value: one.startsAt, locale })}</TableCell>
              <TableCell>{place(one.session)}</TableCell>
              {people ? <TableCell>{typeof one.student?.name === 'string' ? one.student.name : t('admin.notAvailable', 'Not available')}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
