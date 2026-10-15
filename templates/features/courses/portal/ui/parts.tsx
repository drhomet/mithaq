// What the portal's pages draw alike: a course's cover, its tags, its card, and a session's place.
import type { ReactNode } from 'react'
import type { Row } from 'mithaq/admin'
import { useLocale, useScreen } from 'mithaq/admin/react'
import { Skeleton } from '@/components/ui/skeleton'
import { display } from './shell.tsx'
import { feeOf, inLocale, whenOf } from './rules.ts'

/** A text field's option in the viewer's words, as a choice reads it on every screen, and the stored value where none is declared. */
export const useOption = () => {
  const { locale } = useLocale()
  const screen = useScreen()
  return (kayan: string, field: string, value: unknown) => {
    if (typeof value !== 'string' || !value) return undefined
    const option = screen.kayan[kayan]?.fields.find((one) => one.name === field)?.options?.find((one) => one.value === value)
    return inLocale(option?.label, locale) ?? value
  }
}

/** Where and how a session meets, each part the viewer reads: "Campus · Workshop". */
export const usePlace = () => {
  const option = useOption()
  return (session?: Row) => [option('sessions', 'venue', session?.venue), option('sessions', 'format', session?.format)].filter(Boolean).join(' · ')
}

/** Each cover that has no image is one of the portal's own colors, the same one for a course every time. */
const grounds = ['bg-primary', 'bg-[var(--portal-amber)]', 'bg-[#9CC9C5] dark:bg-[#2F5654]']

/**
 * A course's cover: its image through the file route, which the image's own access guards, or a ground of the
 * portal's colors. It says nothing a screen reader needs, since the course's title is beside it.
 */
export function Cover({ course, cover, className }: { course?: Row; cover?: Row; className: string }) {
  const url = typeof cover?.url === 'string' ? cover.url : undefined
  if (url) return <img src={url} alt="" loading="lazy" decoding="async" className={`object-cover ${className}`} />
  const at = [...String(course?.id ?? '')].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % grounds.length
  return <div aria-hidden className={`${grounds[at]} ${className}`} />
}

/** A course's tags, each by its name in the viewer's locale; a tag it may not read is left out. */
export function Tags({ course, tags }: { course: Row; tags: ReadonlyMap<string, Row> }) {
  const { locale } = useLocale()
  const names = (Array.isArray(course.tags) ? course.tags : []).flatMap((id) => {
    const name = inLocale(tags.get(String(id))?.name, locale)
    return name ? [name] : []
  })
  if (!names.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {names.map((name) => <li key={name} className="bg-accent text-accent-foreground rounded-full px-2.5 py-0.5 text-xs">{name}</li>)}
    </ul>
  )
}

/** One course on offer: its cover, tags, title, summary, next session and fee, all one link to its page. */
export function CourseCard({ course, cover, next, tags, href }: { course: Row; cover?: Row; next?: Row; tags: ReadonlyMap<string, Row>; href: string }) {
  const { locale, t } = useLocale()
  const fee = feeOf({ fee: course.fee, currency: course.currency, locale, t })
  const when = whenOf({ value: next?.startsAt, locale })
  return (
    <a href={href} className="bg-card text-card-foreground focus-visible:ring-ring flex flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none">
      <Cover course={course} cover={cover} className="h-36 w-full" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Tags course={course} tags={tags} />
        <h2 className={`${display} text-lg leading-snug`}>{String(course.title ?? '')}</h2>
        {typeof course.summary === 'string' && course.summary ? <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">{course.summary}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-1 text-sm">
          <span className="text-muted-foreground">{when ? `${t('portal.next', 'Next session')} · ${when}` : t('portal.noSession', 'No session scheduled yet')}</span>
          {fee ? <span className="text-primary shrink-0 font-semibold"><bdi>{fee}</bdi></span> : null}
        </div>
      </div>
    </a>
  )
}

/** What stands where cards are still being read, the same shape so nothing jumps when they arrive. */
export function CardsLoading({ count = 3 }: { count?: number }) {
  const { t } = useLocale()
  return (
    <div role="status" aria-label={t('admin.loading', 'Loading…')} className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-5">
      {Array.from({ length: count }, (_, at) => <Skeleton key={at} className="h-72 rounded-2xl" />)}
    </div>
  )
}

/** A failed read, said once, with the way to try again. */
export function ReadFailed({ retry }: { retry: () => void }): ReactNode {
  const { t } = useLocale()
  return (
    <p role="alert" className="text-muted-foreground text-sm">
      {t('portal.failed', 'This could not be read just now.')}{' '}
      <button type="button" onClick={retry} className="text-primary font-medium underline-offset-4 hover:underline">{t('portal.retry', 'Try again')}</button>
    </p>
  )
}
