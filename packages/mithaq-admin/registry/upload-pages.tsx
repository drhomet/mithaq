// What an upload kayan draws of its own files, whichever kayan it is: the list's file and size cells, the page a new
// file is made on, and the file beside its edit form. Each reads the kayan off the page it is drawn on and the row's
// computed `url` and `thumbnailURL`, so a file is fetched through the file route and the row's own access decides who
// sees it. A new file is made in the upload dialog, which sends the bytes before the row is made, signed for the
// active organization.
import { useRef, useState, type ReactElement } from 'react'
import { DownloadIcon, UploadIcon } from 'lucide-react'
import type { CellProps, Row } from 'mithaq/admin'
import { useAccess, useClient, useKayan, useLocale, useRecord, useScreen } from 'mithaq/admin/react'
import { Button, buttonVariants } from '@/components/ui/button'
import { FileThumb, FileValue } from 'mithaq-admin/file-thumb.tsx'
import { sizeOf } from 'mithaq-admin/upload-api.ts'
import { UploadDialog } from 'mithaq-admin/upload-dialog.tsx'

/** A list column of a file's size: the size as a person reads it, never the raw bytes, in the upload dialog's own units. */
export function FileSizeCell({ value }: CellProps): ReactElement | null {
  const { locale } = useLocale()
  return typeof value === 'number' ? <span className="whitespace-nowrap">{sizeOf(value, locale)}</span> : null
}

/**
 * A list column of a file's name: its thumbnail before the name where it is an image. The name keeps at least seven
 * rem and wraps onto a second line before it is cut, so on a phone the table gives the column room for it rather than
 * squeezing it beside the thumbnail.
 */
export function FileCell({ value, row }: CellProps): ReactElement {
  const { t, locale } = useLocale()
  const name = String(value ?? '')
  // A file that is no image is drawn by its icon and name already, so the name is not drawn twice.
  if (!row.thumbnailURL) return <FileThumb row={row} t={t} locale={locale} size="xs" />
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <FileThumb row={row} t={t} locale={locale} size="xs" />
      <span className="line-clamp-2 min-w-28 [overflow-wrap:anywhere]" dir="auto" title={name}>{name}</span>
    </span>
  )
}

/** The upload dialog over the page's kayan, which opens the new row's page once it is made, else its list. */
function NewFileDialog({ open, onOpenChange, locales }: { open: boolean; onOpenChange: (open: boolean) => void; locales: readonly string[] }) {
  const { t, locale } = useLocale()
  const screen = useScreen()
  const kayan = useKayan()
  const client = useClient()
  // The dialog closes itself once the row is made, and that close is no Cancel: the new row's page is already opening.
  const done = useRef(false)
  return (
    <UploadDialog
      open={open}
      onOpenChange={(next) => done.current || onOpenChange(next)}
      target={kayan}
      client={client}
      t={t}
      locale={locale}
      locales={locales}
      onDone={(row: Row) => {
        done.current = true
        const edit = kayan.pages.edit?.path.replace(':id', encodeURIComponent(String(row.id)))
        window.location.assign(`${screen.path}${edit ?? kayan.pages.list?.path ?? ''}`)
      }}
    />
  )
}

/**
 * The file beside its edit form, and above it on a phone, where the record layout puts a side marked `data-lead`
 * first: the file itself, its size, a link that downloads it, and Replace file. A file never changes once it is made,
 * so Replace file uploads a new one and opens it, and this one stays, with whatever points at it, until it is deleted.
 */
export function FileDetails({ locales }: { locales: readonly string[] }): ReactElement | null {
  const { t, locale } = useLocale()
  const kayan = useKayan()
  const access = useAccess()
  const row = useRecord()
  const [replacing, setReplacing] = useState(false)
  if (!row) return null
  const creates = access.collections?.[kayan.name]?.create === true
  const url = typeof row.url === 'string' ? row.url : undefined
  return (
    <div data-file-details="" data-lead="" className="grid justify-items-start gap-3">
      <FileValue row={row} t={t} locale={locale} />
      {typeof row.filesize === 'number' ? <p className="text-muted-foreground text-sm">{sizeOf(row.filesize, locale)}</p> : null}
      <div className="flex flex-wrap gap-2">
        {url ? (
          <a href={url} download={typeof row.filename === 'string' ? row.filename : ''} data-file-download="" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-11 sm:min-h-0' })}>
            <DownloadIcon className="size-4" aria-hidden />
            {t('admin.upload.download', 'Download')}
          </a>
        ) : null}
        {creates ? (
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" data-file-replace="" onClick={() => setReplacing(true)}>
            <UploadIcon className="size-4" aria-hidden />
            {t('admin.upload.replace', 'Replace file')}
          </Button>
        ) : null}
      </div>
      {creates ? <p className="text-muted-foreground text-xs">{t('admin.upload.replaceAbout', 'Replace file uploads a new file and opens it. This one stays until you delete it.')}</p> : null}
      <NewFileDialog open={replacing} onOpenChange={setReplacing} locales={locales} />
    </div>
  )
}

/**
 * What a New page of an upload kayan draws in its shell: the upload dialog, open at once, over a button that opens it
 * again. Closing it goes back to the list.
 */
export function NewUpload({ locales }: { locales: readonly string[] }): ReactElement {
  const { t } = useLocale()
  const screen = useScreen()
  const kayan = useKayan()
  const [open, setOpen] = useState(true)
  return (
    <div data-upload-new-page="" className="grid justify-items-start gap-4">
      <p className="text-muted-foreground">{t('admin.upload.newAbout', 'Choose a file and fill in its details. It is uploaded before it is saved.')}</p>
      <Button type="button" className="min-h-11 sm:min-h-0" onClick={() => setOpen(true)}>
        <UploadIcon className="size-4" aria-hidden />
        {t('admin.upload.new', 'Upload new')}
      </Button>
      <NewFileDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) window.location.assign(`${screen.path}${kayan.pages.list?.path ?? ''}`)
        }}
        locales={locales}
      />
    </div>
  )
}
