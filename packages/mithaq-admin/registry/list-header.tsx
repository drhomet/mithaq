import type { ReactElement, ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { ClientKayan } from 'mithaq/admin'
import { Button } from '@/components/ui/button'
import { PageHeader } from 'mithaq-admin/page-header.tsx'
import type { Translate } from 'mithaq-admin/copy.ts'

/** The list's heading, its sentence, and its New button: a link to the create page, or one that adds a row in place. */
export function ListHeader({ about, create, of, t, title }: {
  /** The heading, which a title node on the screen's own list page draws instead. */
  title?: string
  /** Whether this is a list of another kayan on a page, which keeps a smaller heading under the page's own. */
  of: boolean
  about?: string
  /** Where New goes, or nothing where this actor may not create. */
  create?: { label?: string } & ({ href: string } | { onAdd: () => void })
  t: Translate
}): ReactElement {
  const Heading = of ? 'h2' : 'h1'
  return (
    // `flex-wrap`: on a phone the title and the button share 320 pixels.
    <header className="flex min-w-0 flex-wrap">
      <PageHeader
        t={t}
        title={<div className="grid min-w-0 gap-1">
          {title === undefined ? null : <Heading className={of ? 'text-lg font-semibold' : 'text-2xl font-bold tracking-tight'}>{title}</Heading>}
          {about ? <p className="text-muted-foreground text-sm">{about}</p> : null}
        </div>}
        primary={create === undefined ? null : 'onAdd' in create ? (
          // A list of another kayan adds a row in place, below the table.
          <Button type="button" className="min-h-11 sm:min-h-0" onClick={create.onAdd}>
            <Plus className="me-2 h-4 w-4" />{create.label}
          </Button>
        ) : (
          // `render` keeps the destination an anchor; base-ui must not treat it as a native button.
          <Button nativeButton={false} className="min-h-11 sm:min-h-0" render={<a href={create.href} />}>
            <Plus className="me-2 h-4 w-4" />{create.label}
          </Button>
        )}
      />
    </header>
  )
}

/**
 * What the table says in place of rows: that a filter matched none, with a way to clear it, the project's own empty
 * state, or that the viewer may read no column, and whom to ask. The table can be wider than a phone, so a sentence
 * in a cell spanning it would be cut off at the frame's edge.
 */
export function ListMessage({ count, empty, filtered, kayan, onClear, t, unreadable }: {
  /** How many rows the page holds. */
  count: number
  filtered: boolean
  onClear: () => void
  /** The project's own empty state, where its list node names one. */
  empty?: ReactNode
  kayan: ClientKayan
  t: Translate
  unreadable: boolean
}): ReactElement | null {
  const said = 'text-muted-foreground flex min-h-24 items-center justify-center p-4 text-center text-sm'
  if (count === 0) {
    return (
      <div data-list-message="" className={said}>
        {filtered ? (
          <span className="flex flex-col items-center gap-2">
            {t('admin.noMatches', 'No rows match this filter.') ?? 'No rows match this filter.'}
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" onClick={onClear}>
              {t('admin.clearFilters', 'Clear filters') ?? 'Clear filters'}
            </Button>
          </span>
        ) : (
          empty ?? (t(`${kayan.name}.none`) ?? t('admin.empty', 'Nothing here yet.') ?? 'Nothing here yet.')
        )}
      </div>
    )
  }
  // Rows with no column to draw would read as records with nothing in them.
  return unreadable ? <div data-list-message="" className={said}>{t('admin.noColumns', 'Your role can\'t see any column of this list. Ask an administrator of your organization for access.')}</div> : null
}
