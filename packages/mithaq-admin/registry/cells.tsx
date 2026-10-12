import { useSyncExternalStore, type ReactNode } from 'react'
import type { ClientField } from 'mithaq/admin'
import type { Cells } from './components.tsx'
import { formatDate, listed, noValue } from './format.tsx'
import { RelationshipCell } from './relationship-cell.tsx'
import { UploadCell } from './upload.tsx'

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

/** The text a reader sees in a rich text value, a block to a line. Lives here, not beside the editor, so lists read it without loading Lexical. */
export const richTextPlainText = (node: unknown, depth = 64): string => {
  // A stored value nested past the bound ends in an ellipsis rather than overflowing the stack.
  if (depth <= 0) return '…'
  if (!node || typeof node !== 'object') return ''
  const held = node as { root?: unknown; type?: unknown; text?: unknown; children?: unknown }
  if (held.root) return richTextPlainText(held.root, depth - 1)
  if (held.type === 'linebreak') return '\n'
  const children: unknown[] = Array.isArray(held.children) ? held.children : []
  const inner = children.map((child) => richTextPlainText(child, depth - 1)).join(children.some((child) => typeof (child as { text?: unknown } | null)?.text === 'string') ? '' : '\n')
  return (typeof held.text === 'string' ? held.text : '') + inner
}

/** The blocks of a rich text value: its root's children, or the value itself where it holds none. */
export const blocksOf = (value: unknown): unknown[] => {
  const root = (value as { root?: unknown } | null)?.root ?? value
  return Array.isArray((root as { children?: unknown } | null)?.children) ? (root as { children: unknown[] }).children : [root]
}

const lineLength = 120

/** The words of a rich text value's first non-empty block on one line, cut at 120 characters with an ellipsis. */
export const richTextLine = (value: unknown): string => {
  const first = blocksOf(value).map((block) => richTextPlainText(block).replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
  const characters = Array.from(first)
  return characters.length > lineLength ? `${characters.slice(0, lineLength).join('').trimEnd()}…` : characters.join('')
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
  upload: UploadCell,
  // Nothing where the read carried no join: an absent key means the read did not ask, an empty array means no children, and a count of zero would say both.
  join: ({ value, locale }) => (Array.isArray(value) ? value.length.toLocaleString(locale) : ''),
  // min-w-48 keeps a phone-width table from squeezing the words to one per line.
  richText: ({ value }) => {
    const line = richTextLine(value)
    return line ? <span dir="auto" className="line-clamp-2 min-w-48 whitespace-normal">{line}</span> : noValue
  },
}
