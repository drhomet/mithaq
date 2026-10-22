import { useSyncExternalStore, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ClientField } from 'mithaq/admin'
import { booleanWord } from 'mithaq-admin/copy.ts'
import type { Cells } from 'mithaq-admin/components.tsx'
import { emptyValue, formatDate, isEmptyValue, listed } from 'mithaq-admin/format.tsx'
import { RelationshipCell } from 'mithaq-admin/relationship-cell.tsx'

// ponytail: what this file exported before rich text became an add-on, kept for one version so a project's own file
// importing one from here still builds after recopying; drop it the next minor and import each from rich-text-line.ts.
// It holds no Lexical, so the defaults stay free of the editor.
export { blocksOf, richTextLine, richTextPlainText } from 'mithaq-admin/rich-text-line.ts'

// The server does not know the viewer's zone, so it and the hydrating render draw the day in UTC
// and the mounted client swaps in the moment; drawing both in a zone would be a hydration mismatch.
function Moment({ value, locale }: { value: unknown; locale: string }): ReactNode {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
  const text = formatDate({ value, locale, day: !mounted })
  return text === undefined ? plain(value) : <time dateTime={new Date(value as string).toISOString()} suppressHydrationWarning>{text}</time>
}

// About a column's width in a row.
const previewLength = 60

const plain = (value: unknown) => (value === null || value === undefined ? '' : String(value))

const worded = (field: ClientField, value: unknown, locale: string) => {
  const held = field.rules.localized === true && value && typeof value === 'object' ? (value as Record<string, unknown>)[locale] : value
  return field.options?.find((one) => one.value === held)?.label[locale] ?? plain(held)
}

/** The shipped value cells and the opt-in count cell, held by `defaultComponents.cells`. */
const defaultCells: Cells = {
  count: ({ value, locale }) => typeof value === 'number' ? value.toLocaleString(locale) : '',
  text: ({ field, value, locale }) => worded(field, value, locale),
  email: ({ value }) =>
    value ? (
      <a href={`mailto:${String(value)}`} className="underline underline-offset-2">
        {String(value)}
      </a>
    ) : (
      ''
    ),
  number: ({ value, locale }) => (typeof value === 'number' ? value.toLocaleString(locale) : plain(value)),
  integer: (props) => cells.number(props),
  // Exact text: a JS double would lose digits.
  decimal: ({ field, value, locale }) => worded(field, value, locale),
  checkbox: ({ kayan, field, value, t }) => booleanWord({ kayan, field, value: value === true, t }),
  datetime: (props) => props.field.name === 'archivedAt' && !props.whole && props.value !== undefined
    ? <Badge variant="secondary" className={props.value ? 'text-muted-foreground' : 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200'}>{props.value
      ? (props.t('admin.archived', 'Archived') ?? ('Archived'))
      : (props.t('admin.active', 'Active') ?? ('Active'))}</Badge>
    : <Moment value={props.value} locale={props.locale} />,
  date: ({ value, locale }) => formatDate({ value, locale, day: true }) ?? plain(value),
  textArray: ({ field, value, locale }) => (Array.isArray(value) ? listed(value.map((one) => worded(field, one, locale)), locale) : plain(value)),
  uuid: ({ value }) => <span className="font-mono text-xs">{plain(value)}</span>,
  // Left to right in an Arabic page too, since JSON's syntax reads that way.
  json: ({ value, whole }) => {
    if (value === null || value === undefined) return ''
    if (whole) return <pre dir="ltr" className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    // By code point, so the cut never leaves half of a character a surrogate pair holds.
    const points = [...JSON.stringify(value)]
    return <code dir="ltr" className="font-mono text-xs">{points.length > previewLength ? `${points.slice(0, previewLength).join('')}…` : points.join('')}</code>
  },
  relationship: RelationshipCell,
  // An absent join was not requested, so it must not invent a count of zero.
  join: ({ value, locale }) => (Array.isArray(value) ? value.length.toLocaleString(locale) : ''),
}

export const cells: Cells = Object.fromEntries(Object.entries(defaultCells).map(([name, cell]) => [name, (props: import('mithaq-admin/control-props.ts').CellProps) => {
  const value = props.field.rules.localized === true && props.value && typeof props.value === 'object'
    ? (props.value as Record<string, unknown>)[props.locale] : props.value
  return isEmptyValue(value) && !(name === 'datetime' && props.field.name === 'archivedAt' && !props.whole && props.value !== undefined) ? emptyValue(props) : cell(props)
}])) as Cells
