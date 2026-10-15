// What `/portal` itself draws in a project without the courses example, whose
// portal draws its own home: a greeting, then the dashboard home's figure card
// for each list below, with how many rows of it the viewer may read and a link
// to it. A list the nav does not offer the viewer has no card, and a list whose
// count the viewer may not read, or whose count failed, shows a dash in place
// of the figure.
import type { ReactNode } from 'react'
import type { LoaderTools, PageProps } from 'mithaq/admin'
import { useLocale, useScreen, useUser } from 'mithaq/admin/react'
import { KpiCard } from '@asas/mithaq/ui/kpi-card.tsx'
import { ScreenNav, navLabel } from '@asas/mithaq/ui/screen-nav.tsx'
import { PortalTopShell } from '@asas/mithaq/ui/top-shell.tsx'

/** The lists the home counts, each with its card's icon and the rows its list is held to. */
// A list of the project's own goes here, as `['tags', <Tags className="size-4" />]`.
const figures: readonly [kayan: string, icon: ReactNode, where?: object][] = []

/**
 * How many rows of each list the viewer may count, read as the viewer, keyed
 * by its kayan. A kayan that keeps drafts is counted as its list reads it, the
 * latest draft of every row for a reader of `findVersions`, with `find` and a
 * page of one row, since `count` reads only the published ones.
 */
export const loader = async ({ client, access }: LoaderTools): Promise<Record<string, number | undefined>> =>
  Object.fromEntries(
    await Promise.all(
      figures.map(async ([kayan, , where]) => {
        const operations = access.collections?.[kayan]?.operations
        if (operations?.count !== true) return [kayan, undefined] as const
        const asked = operations.findVersions === true
          ? client({ kayan, operation: 'find', input: { limit: 1, depth: 0, ...(where && { where }) }, draft: true })
          : client({ kayan, operation: 'count', input: where ? { where } : {} })
        return [kayan, await (asked as Promise<{ totalDocs: number }>).then((found) => found.totalDocs).catch(() => undefined)] as const
      }),
    ),
  )

export function Home({ loaderData: counts }: PageProps<Record<string, number | undefined>>) {
  const { locale, t } = useLocale()
  const user = useUser()
  const screen = useScreen()
  // One sentence per locale, so the Arabic greeting takes the Arabic comma.
  const welcome = t('portal.welcome', 'Welcome, {name}')!.replace('{name}', () => user.name)
  return (
    <PortalTopShell
      regions={{
        header: <h1 title={welcome} className="truncate">{welcome}</h1>,
        nav: <ScreenNav />,
        main: (
          <section data-dashboard="portal" className="@container grid gap-4">
            <p className="text-muted-foreground">{t('portal.about', 'What you may open here, and how many of each you may read.')}</p>
            <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
              {figures.map(([kayan, icon]) => {
                const entry = screen.nav.find((one) => one.kayan === kayan)
                const counted = counts?.[kayan]
                return entry ? (
                  <KpiCard
                    key={kayan}
                    kpi={kayan}
                    icon={icon}
                    title={navLabel({ entry, screen, locale, t })}
                    value={counted === undefined ? '—' : new Intl.NumberFormat(locale).format(counted)}
                    footer={<a href={`${screen.path}${entry.path}`} className="text-foreground inline-flex items-center hover:underline max-sm:min-h-11">{t('portal.open', 'Open the list')}</a>}
                  />
                ) : null
              })}
            </div>
          </section>
        ),
      }}
    />
  )
}
