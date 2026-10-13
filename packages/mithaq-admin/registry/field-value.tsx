import { useId, type ReactElement } from 'react'
import type { ClientField, ClientKayan, LeafClient } from 'mithaq/admin'
import { cellFor, useComponents } from 'mithaq-admin/components.tsx'
import type { FindApi } from 'mithaq-admin/control-props.ts'
import { descriptionFor, labelFor, type Copy } from 'mithaq-admin/copy.ts'
import { useKayanField } from 'mithaq-admin/form-context.tsx'
import { LeafControl } from 'mithaq-admin/leaf-control.tsx'
import { refOf, type ScreenPage } from 'mithaq-admin/screen-refs.ts'
import { useRelationshipTitles } from 'mithaq-admin/relationship-cell.tsx'

/** One field of the form, bound to its value, change, blur and refusal. */
export function BoundField({
  api,
  copy,
  field,
  form,
  kayan,
  kayans,
  leaf,
  readOnly,
  screen,
  values,
  setValue,
}: {
  api?: FindApi
  copy: Copy
  field: ClientField
  /** The id of the form this field is saved by, wherever the page drew it. */
  form: string
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  /** What this page alone draws the field with, on a screen's page. */
  leaf?: LeafClient
  /** Whether the control takes no edit, which is the form's own answer and never this field's to decide. */
  readOnly: boolean
  screen?: ScreenPage
  values: Readonly<Record<string, unknown>>
  setValue: (name: string, value: unknown) => void
}): ReactElement {
  const bound = useKayanField(field.name)
  return (
    <LeafControl
      field={field}
      form={form}
      kayan={kayan}
      kayans={kayans}
      leaf={leaf}
      screen={screen}
      copy={copy}
      api={api}
      value={bound.value}
      values={values}
      setValue={setValue}
      onChange={bound.onChange}
      onBlur={bound.onBlur}
      readOnly={readOnly}
      error={bound.error}
      invalidLocales={bound.locales}
    />
  )
}

/**
 * One field of a row that is read and never edited: its label over the cell a list column draws it
 * with. A field the report hides is not in the projection, so nothing is drawn for it.
 */
export function FieldValue({
  api,
  copy,
  field,
  kayan,
  kayans,
  leaf,
  row,
  screen,
}: {
  api?: FindApi
  copy: Copy
  field: ClientField
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  leaf?: LeafClient
  row: Readonly<Record<string, unknown>> | null
  screen?: ScreenPage
}): ReactElement {
  const titles = useRelationshipTitles({ fields: [field], docs: row ? [row] : [], context: { api, client: kayans, locale: copy.locale } })
  const label = useId()
  const value = row?.[field.name]
  const Ref = refOf({ screen, place: 'cell', path: leaf?.cell ?? field.cell })
  const { cells } = useComponents()
  // The screen's own component draws first, so the map is asked only for what it does not.
  const Cell = Ref && screen ? undefined : cellFor({ cells, field, column: leaf?.cell })
  const description = leaf?.description?.[copy.locale] ?? descriptionFor({ kayan, field, copy })
  const width = leaf?.width ?? field.width
  return (
    <div role="group" aria-labelledby={label} data-field-value={field.name} className="grid gap-1.5" style={width ? { width } : undefined}>
      <span id={label} className="text-sm font-medium">{labelFor({ kayan, field, copy })}</span>
      <span className="text-sm">
        {!Cell
          ? Ref && <Ref field={field} value={value} row={row ?? {}} />
          : <Cell kayan={kayan} field={field} value={value} t={copy.t} locale={copy.locale} titles={titles} whole />}
      </span>
      {description ? <span className="text-muted-foreground text-sm">{description}</span> : null}
    </div>
  )
}
