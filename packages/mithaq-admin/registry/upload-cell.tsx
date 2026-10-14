import type { ReactNode } from 'react'
import { missingRow, type CellProps, type RelationshipTitles } from 'mithaq-admin/control-props.ts'
import type { Translate } from 'mithaq-admin/copy.ts'
import { FileThumb, FileValue, type sizes } from 'mithaq-admin/file-thumb.tsx'
import { noValue } from 'mithaq-admin/format.tsx'
import { idsOf } from 'mithaq-admin/relationship-control.tsx'
import { rowKey } from 'mithaq-admin/relationship-cell.tsx'

/** One held id as the map read it: its row, loading until the read answers, a dash where the read failed, and a row the viewer cannot see where it was refused or left out. Never the raw id. */
const heldFile = ({ titles, target, id, t, locale, size }: {
  titles: RelationshipTitles | undefined
  target: string
  id: string
  t: Translate
  locale: string
  size: keyof typeof sizes
}) => {
  const found = titles?.get(rowKey(target, id))
  if (found === null || found === undefined) return <span key={id}>{t('admin.loading', 'Loading…') ?? 'Loading…'}</span>
  if (found instanceof Error) return <span key={id}>—</span>
  if (found && typeof found === 'object') return size === 'lg' ? <FileValue key={id} row={found} t={t} locale={locale} /> : <FileThumb key={id} row={found} t={t} locale={locale} size={size} />
  return <span key={id} className="text-muted-foreground text-xs">{missingRow({ t, gone: found === true })}</span>
}

const totalToShow = 3

/**
 * The `upload` kind's cell: a small thumbnail for an image and the name for any other file; a set draws its first three
 * and counts the rest. On a record page, each file whole.
 */
export function UploadCell(props: CellProps): ReactNode {
  const { field, locale, t, titles, value, whole } = props
  if (whole) return <UploadValue {...props} />
  const ids = idsOf(value)
  if (!ids.length) return noValue
  const rest = ids.length - totalToShow
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      {ids.slice(0, totalToShow).map((id) => heldFile({ titles, target: field.relationTo ?? '', id, t, locale, size: 'xs' }))}
      {rest > 0 ? <span className="text-muted-foreground text-xs">{(t('admin.andMore', 'and {count} more') ?? 'and {count} more').replace('{count}', () => rest.toLocaleString(locale))}</span> : null}
    </span>
  )
}

/** A record page's read of an upload: each file whole, the image or its download link. */
export function UploadValue({ field, locale, t, titles, value }: CellProps): ReactNode {
  const ids = idsOf(value)
  return ids.length ? <span className="grid gap-2">{ids.map((id) => heldFile({ titles, target: field.relationTo ?? '', id, t, locale, size: 'lg' }))}</span> : null
}
