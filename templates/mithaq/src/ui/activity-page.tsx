// The dashboard's Activity page: every change in the organization, read as the
// viewer from the log's `find`, which answers this tenant's entries alone, of
// the kayan the viewer lists. A file of its own beside `activity.tsx`, since the
// shell it draws in holds the app's own pieces.
import { useEffect, useState } from 'react'
import { useAccess, useLocale } from 'mithaq/admin/react'
import { ActivityLog, filtersOf, type ActivityQuery } from './activity.tsx'
import { AppShell } from './app-shell.tsx'

/**
 * The page, filtered at first by what its link names, such as one record's
 * entries from that record's panel. The link is read once the page is in the
 * browser, since the server renders no location.
 */
export function ActivityPage() {
  const { t } = useLocale()
  const people = useAccess().collections?.user?.read === true
  const [query, setQuery] = useState<ActivityQuery>()
  useEffect(() => setQuery(filtersOf({ search: window.location.search, people })), [])
  return (
    <AppShell
      regions={{ primary: null, more: null,
        header: <h1>{t('auditLog.activity', 'Activity')}</h1>,
        main: (
          <section data-dashboard="activity" className="grid gap-4">
            <p className="text-muted-foreground">{t('auditLog.about', 'Every change in this organization, newest first.')}</p>
            {query ? <ActivityLog query={query} onQuery={setQuery} /> : <p className="text-muted-foreground text-sm">{t('auditLog.loading', 'Loading activity…')}</p>}
          </section>
        ),
      }}
    />
  )
}
