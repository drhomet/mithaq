// What `/dashboard` itself draws where the courses add-on, whose home counts
// its catalogue, is not there: a figure card for each list the nav offers the
// viewer, with how many rows of it they may read and a link to it, and with the
// roles add-on who works here and the roles they hold. A list
// whose count the viewer may not read, or whose count failed, shows a dash.
import type { LoaderTools, PageProps } from 'mithaq/admin'
import { useLocale, useScreen } from 'mithaq/admin/react'
import { AppShell, iconOf } from '@asas/mithaq/ui/app-shell.tsx'
import { KpiCard } from '@asas/mithaq/ui/kpi-card.tsx'
import { navLabel } from '@asas/mithaq/ui/screen-nav.tsx'
// add-on: roles
import { MembersCard, membersFigures } from './members-card.tsx'
// end add-on: roles

/** How many rows of each kayan the viewer may count, read as the viewer, keyed by its kayan. */
const countsOf = async ({ client, access }: LoaderTools): Promise<Record<string, number | undefined>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(access.collections ?? {})
        .filter(([, one]) => one?.operations?.count === true)
        .map(async ([kayan]) => [kayan, await (client({ kayan, operation: 'count', input: {} }) as Promise<{ totalDocs: number }>).then((found) => found.totalDocs).catch(() => undefined)] as const),
    ),
  )

export const loader = async (tools: LoaderTools) => ({
  counts: await countsOf(tools),
  // add-on: roles
  // Who works here, where the viewer may list members.
  members: await membersFigures(tools),
  // end add-on: roles
})

export function Home({ loaderData }: PageProps<Awaited<ReturnType<typeof loader>>>) {
  const counts = loaderData?.counts
  const { locale, t } = useLocale()
  const screen = useScreen()
  // add-on: roles
  const members = loaderData?.members ? <MembersCard figures={loaderData.members} href={`${screen.path}/members`} /> : null
  // end add-on: roles
  // without add-on: roles
  // const members = null
  // end without add-on: roles
  return (
    <AppShell
      regions={{ primary: null, more: null,
        header: <h1>{t('dashboard.dashboard', 'Dashboard')}</h1>,
        main: (
          <section data-dashboard="dashboard" className="@container grid gap-4">
            <p className="text-muted-foreground">{t('dashboard.dashboardAboutCatalogue', 'What this organization holds.')}</p>
            <div className="grid grid-cols-2 items-start gap-4 @2xl:grid-cols-4">
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
                    footer={<a href={`${screen.path}${entry.path}`} className="text-foreground inline-flex items-center hover:underline min-h-11 sm:min-h-0">{t('portal.open', 'Open the list')}</a>}
                  />,
                ]
              })}
              {members}
            </div>
          </section>
        ),
      }}
    />
  )
}
