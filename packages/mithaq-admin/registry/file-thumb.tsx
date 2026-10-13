import { useState, type ReactElement } from 'react'
import { FileIcon, ImageOffIcon } from 'lucide-react'
import type { Translate } from './copy.ts'
import type { Row } from './upload-api.ts'

/** A file row's words for a screen reader: its alternative text in the viewer's locale, else its name. */
const altOf = (row: Row, locale: string) => {
  const alt = row.alt && typeof row.alt === 'object' ? (row.alt as Record<string, unknown>)[locale] : row.alt
  return typeof alt === 'string' && alt ? alt : String(row.filename ?? '')
}

/** The file's own address, computed by the server on every read and never stored. */
export const urlOf = (row: Row, key: 'url' | 'thumbnailURL') => (typeof row[key] === 'string' ? (row[key] as string) : undefined)

// A small thumbnail takes `max-w-none` and `shrink-0`: the preflight's `max-width: 100%` makes an image count as no width when a table sizes its column.
export const sizes = { xs: 'size-8 shrink-0 max-w-none', sm: 'size-16 shrink-0 max-w-none', lg: 'max-h-64 w-auto max-w-full' } as const
/** The pixels a thumbnail is drawn at, so the browser lays it out before the file arrives. */
const pixels = { xs: 32, sm: 64 } as const

/** What stands where an image cannot be drawn: the reader may not read it, or the file is gone. */
export function Missing({ t, size }: { t: Translate; size: keyof typeof sizes }): ReactElement {
  const words = t('admin.upload.missing', 'This file cannot be shown.') ?? 'This file cannot be shown.'
  return (
    <span data-upload-missing="" title={words} className={`bg-muted text-muted-foreground inline-flex items-center justify-center gap-2 rounded-md border ${size === 'lg' ? 'p-4 text-sm' : sizes[size]}`}>
      <ImageOffIcon className="size-4 shrink-0" aria-hidden />
      <span className={size === 'lg' ? undefined : 'sr-only'}>{words}</span>
    </span>
  )
}

/** One file drawn: its thumbnail where it is an image, else its name and type. The image goes through the file route off the row's computed `thumbnailURL`, so the row's own access decides who sees it. */
export function FileThumb({ row, t, locale, size = 'sm' }: { row: Row; t: Translate; locale: string; size?: keyof typeof sizes }): ReactElement {
  const [failed, setFailed] = useState(false)
  const thumbnail = urlOf(row, 'thumbnailURL')
  if (thumbnail && !failed) {
    return <img src={thumbnail} alt={altOf(row, locale)} loading="lazy" decoding="async" {...(size !== 'lg' && { width: pixels[size], height: pixels[size] })} onError={() => setFailed(true)} data-upload-thumbnail="" className={`rounded-md border object-cover ${sizes[size]}`} />
  }
  if (thumbnail) return <Missing t={t} size={size} />
  return (
    <span data-upload-file="" className="inline-flex min-w-0 items-center gap-2">
      <FileIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate" dir="auto">{String(row.filename ?? row.id ?? '')}</span>
      {size === 'xs' ? null : <span className="text-muted-foreground shrink-0 text-xs" dir="ltr">{String(row.mimeType ?? '')}</span>}
    </span>
  )
}

/**
 * A file read on a record page: the image, opening the file itself, or a
 * link that downloads it, both through the access-gated file route.
 */
export function FileValue({ row, t, locale }: { row: Row; t: Translate; locale: string }): ReactElement {
  const url = urlOf(row, 'url')
  if (urlOf(row, 'thumbnailURL')) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block max-w-full">
        <FileThumb row={row} t={t} locale={locale} size="lg" />
      </a>
    )
  }
  return (
    <a href={url} download={typeof row.filename === 'string' ? row.filename : ''} data-upload-download="" className="inline-flex max-w-full underline underline-offset-2">
      <FileThumb row={row} t={t} locale={locale} />
    </a>
  )
}
