// The frame of one record: the form in `main`, what sits beside it in `side`, and the buttons a
// person should not reach by accident in `danger`. A page fills only the regions this file exports,
// which the build checks.
import type { ReactNode } from 'react'
import type { LayoutProps } from 'mithaq/admin'
import { useKayan, useLocale, useRecord } from 'mithaq/admin/react'

export const regions = ['main', 'side', 'danger'] as const

export function RecordPage({ regions, page }: LayoutProps<readonly ['main', 'side', 'danger'], ReactNode>) {
  const { t } = useLocale()
  const record = useRecord()
  return (
    // main, side, danger in document order is how a phone stacks them: the danger zone last. From lg up
    // the grid puts the side beside both and the danger zone back under the form; the second row's `1fr`
    // takes whatever height the side adds, so the danger zone sits right under the form. A page with
    // nothing beside its form gives the form the whole width. A side marked `data-lead`, such as an
    // image beside its description, comes before the form on a phone instead.
    <div data-layout="record" data-page={page.path} data-record={record ? 'row' : 'none'} className={regions.side ? 'grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] lg:grid-rows-[auto_1fr]' : 'grid gap-4'}>
      <div data-region="main" className="grid min-w-0 gap-4 lg:col-start-1">
        {regions.main}
      </div>
      {regions.side ? <aside data-region="side" className="grid h-fit gap-4 max-lg:has-[[data-lead]]:order-first lg:col-start-2 lg:row-span-2 lg:row-start-1">{regions.side}</aside> : null}
      {/* The danger zone, fenced by the destructive border, under the form rather than in its row. */}
      {regions.danger ? (
        <section data-region="danger" className="grid h-fit min-w-0 gap-2 rounded-lg border border-destructive/50 p-4 lg:col-start-1">
          <h2 className="text-base font-medium text-destructive">{t('admin.dangerZone', 'Danger zone')}</h2>
          <DangerWarning />
          <div className="flex flex-wrap items-center gap-2">{regions.danger}</div>
        </section>
      ) : null}
    </div>
  )
}

/**
 * What the danger zone says under its heading: the kayan's own sentence, or the shared one with the
 * kind put in. Its own component, since only a kayan's page has a danger zone and `useKayan` refuses
 * any other.
 */
function DangerWarning() {
  const { t, locale } = useLocale()
  const kayan = useKayan()
  return (
    <p className="text-muted-foreground text-sm">
      {t(`${kayan.name}.dangerZoneWarning`)
        ?? (t('admin.dangerZoneWarning', 'These actions change this {kind} for everyone.') ?? '').replace('{kind}', () => (t(`${kayan.name}.singular`) ?? kayan.name).toLocaleLowerCase(locale))}
    </p>
  )
}
