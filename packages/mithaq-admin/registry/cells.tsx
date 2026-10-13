import { useSyncExternalStore, type ReactNode } from 'react'
import type { ClientField } from 'mithaq/admin'
import type { Cells } from './components.tsx'
import { formatDate, listed } from './format.tsx'
import { RelationshipCell } from './relationship-cell.tsx'

// ponytail: what this file exported before rich text became an add-on, kept for one version so a project's own file
// importing one from here still builds after recopying; drop it the next minor and import each from rich-text-line.ts.
// It holds no Lexical, so the defaults stay free of the editor.
export { blocksOf, richTextLine, richTextPlainText } from './rich-text-line.ts'

// The server does not know the viewer's zone, so it and the hydrating render draw the day in UTC
// and the mounted client swaps in the moment; drawing both in a zone would be a hydration mismatch.
function Moment({ value, locale }: { value: unknown; locale: string }): ReactNode {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
  const text = formatDate({ value, locale, day: !mounted })
  return text === undefined ? plain(value) : <time dateTime={new Date(value as string).toISOString()} suppressHydrationWarning>{text}</time>
}

const plain = (value: unknown) => (value === null || value === undefined ? '' : String(value))

const worded = (field: ClientField, value: unknown, locale: string) => {
  const held = field.rules.localized === true && value && typeof value === 'object' ? (value as Record<string, unknown>)[locale] : value
  return field.options?.find((one) => one.value === held)?.label[locale] ?? plain(held)
}

/** One cell per name the registry ships, keyed by the kind's own name, which `defaultComponents.cells` holds. */
export const cells: Cells = {
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
  // The glyph is aria-hidden, so the sr-only word is what a screen reader gets. The words are keyed per field because `true` means different things on `archived` and `published`.
  checkbox: ({ kayan, field, value, t }) => (
    <>
      <span aria-hidden className="tabular-nums">
        {value === true ? '✓' : value === false ? '✗' : '—'}
      </span>
      <span className="sr-only">
        {value === true
          ? (t(`${kayan.name}.${field.name}.true`) ?? t('admin.yes', 'Yes') ?? 'Yes')
          : (t(`${kayan.name}.${field.name}.false`) ?? t('admin.no', 'No') ?? 'No')}
      </span>
    </>
  ),
  datetime: ({ value, locale }) => <Moment value={value} locale={locale} />,
  date: ({ value, locale }) => formatDate({ value, locale, day: true }) ?? plain(value),
  textArray: ({ field, value, locale }) => (Array.isArray(value) ? listed(value.map((one) => worded(field, one, locale)), locale) : plain(value)),
  uuid: ({ value }) => <span className="font-mono text-xs">{plain(value)}</span>,
  relationship: RelationshipCell,
  // Nothing where the read carried no join: an absent key means the read did not ask, an empty array means no children, and a count of zero would say both.
  join: ({ value, locale }) => (Array.isArray(value) ? value.length.toLocaleString(locale) : ''),
}
