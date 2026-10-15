// The portal's catalogue: the courses on offer as cards, searched by title and summary and narrowed by tag, each
// card opening the course's page.
import { useState } from 'react'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useClient, useLocale, useScreen } from 'mithaq/admin/react'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { PortalShell, display } from './shell.tsx'
import { CardsLoading, CourseCard, ReadFailed } from './parts.tsx'
import { inLocale } from './rules.ts'
import { catalogueOf } from './reads.ts'

/** Drawn whole as the courses' list page, so it reads the list itself. */
export function Catalogue() {
  const { locale, t } = useLocale()
  const client = useClient()
  const screen = useScreen()
  const read = useQuery({ queryKey: ['portal-catalogue'], queryFn: () => catalogueOf({ client, maxLimit: screen.maxLimit, now: Date.now() }), staleTime: 30_000 })
  const [term, setTerm] = useState('')
  const [tag, setTag] = useState<string>()
  const found = read.data
  const asked = term.trim().toLocaleLowerCase(locale)
  const shown = found?.courses.filter((course) =>
    (!tag || (Array.isArray(course.tags) && course.tags.includes(tag)))
    && (!asked || [course.title, course.summary].some((one) => typeof one === 'string' && one.toLocaleLowerCase(locale).includes(asked))))
  const title = t('courses.plural', 'Courses')
  return (
    <PortalShell
      regions={{
        header: <h1 className={`${display} text-3xl`}>{title}</h1>,
        main: (
          <div className="grid gap-5">
            <div className="grid gap-3">
              <label className="border-input bg-card focus-within:ring-ring flex h-12 items-center gap-2.5 rounded-full border px-4 focus-within:ring-2">
                <Search aria-hidden className="text-muted-foreground size-4.5 shrink-0" />
                <span className="sr-only">{t('portal.search', 'Search courses')}</span>
                <Input
                  type="search"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={t('portal.search', 'Search courses')}
                  className="h-auto border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
              </label>
              {found?.tags.size ? (
                <div role="group" aria-label={t('portal.byTag', 'Filter by tag')} className="flex flex-wrap gap-2">
                  <Toggle variant="outline" pressed={!tag} onPressedChange={() => setTag(undefined)} className="aria-pressed:bg-foreground aria-pressed:text-background h-11 rounded-full px-4">
                    {t('portal.allTags', 'All')}
                  </Toggle>
                  {[...found.tags.values()].map((one) => (
                    <Toggle
                      key={String(one.id)}
                      variant="outline"
                      pressed={tag === one.id}
                      onPressedChange={(pressed) => setTag(pressed ? String(one.id) : undefined)}
                      className="aria-pressed:bg-foreground aria-pressed:text-background h-11 rounded-full px-4"
                    >
                      {inLocale(one.name, locale)}
                    </Toggle>
                  ))}
                </div>
              ) : null}
            </div>
            {read.isError ? <ReadFailed retry={() => void read.refetch()} /> : !found || !shown ? <CardsLoading /> : shown.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-5">
                {shown.map((course) => (
                  <CourseCard
                    key={String(course.id)}
                    course={course}
                    cover={found.covers.get(String(course.cover))}
                    next={found.next.get(String(course.id))}
                    tags={found.tags}
                    href={`${screen.path}/courses/${encodeURIComponent(String(course.id))}`}
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{found.courses.length ? t('portal.noMatch', 'No course matches.') : t('courses.noneOnOffer', 'No courses on offer yet.')}</p>
            )}
          </div>
        ),
      }}
    />
  )
}
