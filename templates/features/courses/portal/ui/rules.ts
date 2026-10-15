// What the portal's pages decide, apart from what they draw, so a test reads it under plain `node`.
import { holds, type AccessReport, type Row, type Translate } from 'mithaq/admin'

/** Which part of the day a greeting names, by the hour on the viewer's own clock. */
export const partOfDay = (hour: number) => (hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening')

const timeOf = (value: unknown) => (value instanceof Date || typeof value === 'string' ? new Date(value).getTime() : Number.NaN)

/** The first session of each course still to start, by the course's id. An archived session takes no seat, so it is never next. */
export const nextByCourse = (sessions: readonly Row[], now: number): Map<string, Row> => {
  const next = new Map<string, Row>()
  for (const one of sessions) {
    const at = timeOf(one.startsAt)
    if (one.archived === true || !(at > now) || typeof one.course !== 'string') continue
    const held = next.get(one.course)
    if (!held || at < timeOf(held.startsAt)) next.set(one.course, one)
  }
  return next
}

/**
 * Seats split by when their session meets: those to come, soonest first, and those past, latest first. A seat
 * whose session the viewer cannot read has no start and is in neither.
 */
export const byWhen = <Seat extends { startsAt?: unknown }>(seats: readonly Seat[], now: number) => {
  const timed = seats.filter((one) => !Number.isNaN(timeOf(one.startsAt)))
  const upcoming = timed.filter((one) => timeOf(one.startsAt) > now).sort((a, b) => timeOf(a.startsAt) - timeOf(b.startsAt))
  const past = timed.filter((one) => timeOf(one.startsAt) <= now).sort((a, b) => timeOf(b.startsAt) - timeOf(a.startsAt))
  return { upcoming, past }
}

/** A fee in its own currency, a fee of nought as free, and nothing for a course that names none. */
export const feeOf = ({ fee, currency, locale, t }: { fee: unknown; currency: unknown; locale: string; t: Translate }): string | undefined => {
  if (typeof fee !== 'number') return undefined
  if (fee === 0) return t('portal.free', 'Free')
  try {
    if (typeof currency === 'string' && currency) return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(fee)
  } catch {
    // A code Intl refuses throws a RangeError; the number alone is still true.
  }
  return fee.toLocaleString(locale)
}

/** What a session says of its seats: nothing where it holds any number, Full, or how many are left. */
export const seatsOf = ({ seatsLeft, locale, t }: { seatsLeft: unknown; locale: string; t: Translate }): string | undefined => {
  if (typeof seatsLeft !== 'number') return undefined
  if (seatsLeft <= 0) return t('portal.full', 'Full')
  // The plural form the locale takes for the count, as the admin's `counted` reads it, which lives in a `.tsx` file.
  const form = t(`portal.seatsLeft_${new Intl.PluralRules(locale).select(seatsLeft)}`) ?? t('portal.seatsLeft_other', '{count} seats left')!
  return form.replace('{count}', () => seatsLeft.toLocaleString(locale))
}

const hour = 60 * 60 * 1000

/** How soon a moment comes, in the viewer's words: in hours under a day, in days past one. */
export const startsIn = ({ value, now, locale }: { value: unknown; now: number; locale: string }): string | undefined => {
  const at = timeOf(value)
  if (Number.isNaN(at)) return undefined
  const words = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const hours = Math.round((at - now) / hour)
  return Math.abs(hours) < 24 ? words.format(hours, 'hour') : words.format(Math.round(hours / 24), 'day')
}

/** A moment as a student reads it on a card: the day of the week, the date and the time, in the viewer's locale. */
export const whenOf = ({ value, locale }: { value: unknown; locale: string }): string | undefined => {
  const at = timeOf(value)
  if (Number.isNaN(at)) return undefined
  const date = new Date(at)
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric' }).format(date)
  return `${day} · ${new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date)}`
}

/**
 * Whether maintenance closes the portal to this viewer. It closes it to a student alone: whoever enters the
 * dashboard runs the school, and whoever reads every seat teaches, so both keep working through it.
 */
export const closedTo = ({ maintenance, access }: { maintenance: unknown; access: AccessReport }) =>
  maintenance === true && !holds(access, 'screen.dashboard') && !holds(access, 'enrollments.others')

/** A localized value, such as a tag's name, in the viewer's locale, else any locale it holds. */
export const inLocale = (value: unknown, locale: string): string | undefined => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const held = value as Record<string, unknown>
  const own = held[locale]
  return typeof own === 'string' && own ? own : Object.values(held).find((one): one is string => typeof one === 'string' && !!one)
}
