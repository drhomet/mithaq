// What `/platform` itself draws: where staff start, inside the platform's
// shell, with the figure card the dashboard and the portal homes draw for each
// list the nav offers the viewer, with how many rows of it they may read across
// every organization and a link to it. A list whose count the viewer may not
// read, or whose count failed, shows a dash.
import { ArrowRight } from 'lucide-react'
import type { LoaderTools, PageProps } from 'mithaq/admin'
import { useLocale, useScreen } from 'mithaq/admin/react'
import { PlatformShell, iconOf } from '@asas/mithaq/ui/app-shell.tsx'
import { KpiCard } from '@asas/mithaq/ui/kpi-card.tsx'
import { navLabel } from '@asas/mithaq/ui/screen-nav.tsx'

/** How many rows of each kayan the viewer may count, read as the viewer, keyed by its kayan. */
export const loader = async ({ client, access }: LoaderTools): Promise<Record<string, number | undefined>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(access.collections ?? {})
        .filter(([, one]) => one?.operations?.count === true)
        .map(async ([kayan]) => [kayan, await (client({ kayan, operation: 'count', input: {} }) as Promise<{ totalDocs: number }>).then((found) => found.totalDocs).catch(() => undefined)] as const),
    ),
  )

export function Home({ loaderData: counts }: PageProps<Record<string, number | undefined>>) {
  const { locale, t } = useLocale()
  const screen = useScreen()
  return (
    <PlatformShell
      regions={{
        header: <h1>{t('platform.title', 'Platform')}</h1>,
        main: (
          <section data-dashboard="platform" className="@container grid gap-4">
            <p className="text-muted-foreground">{t('platform.about', 'Every organization and every person on the platform, for its staff.')}</p>
            {/* Cards as tall as their content, the figure and the link: the card's own padding and gap
                are the roomy ones of the platform's style, which a count and one link do not need. */}
            <div className="grid grid-cols-2 items-start gap-4 @2xl:grid-cols-3 @5xl:grid-cols-4 [&_[data-slot=card]]:[--card-spacing:--spacing(4)]">
              {screen.nav.flatMap((entry) => {
                if (!entry.kayan) return []
                const Icon = iconOf(entry.path)
                const counted = counts?.[entry.kayan]
                return [
                  <KpiCard
                    key={entry.kayan}
                    kpi={entry.kayan}
                    icon={<Icon className="size-4" />}
                    title={navLabel({ entry, screen, locale, t })}
                    value={counted === undefined ? '—' : new Intl.NumberFormat(locale).format(counted)}
                    // Underlined, with an arrow that follows the reading direction, so it reads as a link.
                    footer={
                      <a href={`${screen.path}${entry.path}`} className="text-foreground inline-flex items-center gap-1 underline underline-offset-4 max-sm:min-h-11">
                        {t('portal.open', 'Open the list')}
                        <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
                      </a>
                    }
                  />,
                ]
              })}
            </div>
          </section>
        ),
      }}
    />
  )
}
