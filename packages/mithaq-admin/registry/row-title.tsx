import type { ClientKayan, Row } from 'mithaq/admin'
import type { Copy } from 'mithaq-admin/copy.ts'
import { nameOfRow } from 'mithaq-admin/relationship-control.tsx'

/**
 * What one row is called by its kayan's own title field, in the viewer's
 * locale, or nothing where the kayan declares none, the row holds none, or
 * the title is a relationship that has to be read first; never the row's id.
 */
export const rowTitle = ({ kayan, row, locale }: { kayan: ClientKayan; row: Row; locale: string }): string | undefined => {
  const field = kayan.fields.find((one) => one.name === kayan.useAsTitle && one.name !== 'id')
  const held = field ? row[field.name] : undefined
  if (!field || field.kind === 'relationship' || held === null || held === undefined || held === '') return undefined
  const name = nameOfRow({ row, title: field.name, locale, kind: field.kind })
  return name && name !== String(row.id ?? '') ? name : undefined
}

/**
 * Whether a row's title is empty: the kayan is titled by a field the reader may read, and its value (in the viewer's
 * locale if localized) is nothing or blank. A draft may hold no title, and a snapshot of one may lack the key.
 */
export const isUntitled = ({ kayan, row, locale }: { kayan: ClientKayan; row: Row; locale: string }): boolean => {
  const field = kayan.fields.find((one) => one.name === kayan.useAsTitle && one.name !== 'id')
  if (!field || field.kind === 'relationship') return false
  const held = row[field.name]
  const text = held !== null && typeof held === 'object' && !(held instanceof Date) ? (held as Row)[locale] : held
  return text === null || text === undefined || (typeof text === 'string' && text.trim() === '')
}

/**
 * What a button's dialog says it runs on: the row's title (or "this row"), in the operation's `.warning` sentence.
 * The title is isolated with U+2068/U+2069 so an email or digits in an Arabic sentence keep their order.
 */
export const rowWarning = ({ kayan, row, operation, copy: { t, locale } }: { kayan: ClientKayan; row: Row; operation?: string; copy: Copy }): string => {
  const name = rowTitle({ kayan, row, locale })
  if (!name) return t('admin.rowWarning', 'This applies to this row.') ?? 'This applies to this row.'
  const sentence = (operation && t(`${kayan.name}.operations.${operation}.warning`)) || (t('admin.rowNamedWarning', 'This applies to {name}.') ?? 'This applies to {name}.')
  return sentence.replace('{name}', () => `\u2068${name}\u2069`)
}
