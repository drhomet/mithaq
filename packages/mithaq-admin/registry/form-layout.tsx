import type { FormEvent, ReactElement, ReactNode } from 'react'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cellFor, useComponents } from 'mithaq-admin/components.tsx'
import type { FindApi } from 'mithaq-admin/control-props.ts'
import { labelFor, type Copy } from 'mithaq-admin/copy.ts'
import { useRelationshipTitles } from 'mithaq-admin/relationship-cell.tsx'

/**
 * A form handed no page: every field in declared order on one card with the actions under them, and the fields
 * the server provides in a Record card beside it.
 */
export function FormLayout({ actions, api, chrome, control, copy, formId, kayan, kayans, onSubmit, provided, rest, row, values }: {
  formId: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  /** What is drawn above the fields. */
  chrome: ReactNode
  actions: ReactNode
  /** The fields the person writes, and those the server provides. */
  rest: readonly ClientField[]
  provided: readonly ClientField[]
  /** One field's control, by its name. */
  control: (name: string) => ReactNode
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  api?: FindApi
  copy: Copy
  /** The row the host handed, whose relationships the side card names. */
  row?: Record<string, unknown> | null
  values: Readonly<Record<string, unknown>>
}): ReactElement {
  const { t, locale } = copy
  const { cells } = useComponents()
  // Titles of the rows the side card points at, read once for this row. With no `api` each id settles as
  // a row the viewer cannot see; the cell never shows the id it holds.
  const titles = useRelationshipTitles({ fields: provided, docs: row ? [row] : [], context: { api, client: kayans, locale } })
  // A relationship is drawn by the list's cell, not a picker: a disabled picker over a row the viewer
  // may not choose shows the raw id, where the cell reads the target's title.
  const sideEntry = (field: ClientField) => {
    if (field.kind !== 'relationship') return control(field.name)
    const Cell = cellFor({ cells, field })
    return (
      <div key={field.name} className="grid gap-1.5">
        <span className="text-sm font-medium">{labelFor({ kayan, field, copy })}</span>
        <span className="text-muted-foreground text-sm">
          <Cell kayan={kayan} field={field} value={values[field.name]} t={t} locale={locale} titles={titles} />
        </span>
      </div>
    )
  }
  return (
    <form id={formId} method="post" noValidate onSubmit={onSubmit} className="flex flex-1 flex-col gap-6">
      {chrome}
      <div className="border-t pt-6">
        <div className={provided.length ? 'grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]' : 'max-w-3xl'}>
          {/* A div and not a `main`: the page's shell already holds the one main landmark. */}
          <div data-fields="" className="grid min-w-0 gap-4">
            <Card className="overflow-visible">
              <CardContent className="flex flex-col gap-4">
                {rest.length ? <div className="flex flex-col gap-4">{rest.map((field) => control(field.name))}</div> : null}
                {actions}
              </CardContent>
            </Card>
          </div>
          {provided.length ? (
            <aside className="grid h-fit gap-4 lg:sticky lg:top-20">
              <Card className="overflow-visible rounded-lg">
                <CardHeader>
                  <CardTitle>
                    <h2 className="text-base font-medium">{t('admin.record', 'Record') ?? 'Record'}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">{provided.map(sideEntry)}</CardContent>
              </Card>
            </aside>
          ) : null}
        </div>
      </div>
    </form>
  )
}
