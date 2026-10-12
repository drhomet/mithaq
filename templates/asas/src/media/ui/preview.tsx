// What the `media` kayan draws of its own files: the image beside its edit
// form, the list's thumbnail and size cells, and the page a new image is made
// on. Each reads the row's computed `url` and `thumbnailURL`, so a file is
// fetched through the file route and the row's access decides. A new file is
// made in the registry's upload dialog, which sends the bytes before the row
// is made.
import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import type { CellProps, ComponentProps, Row } from 'mithaq/admin'
import { useAccess, useClient, useLocale, useRecord, useScreen } from 'mithaq/admin/react'
import { locales } from '@/copy.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { FileThumb, FileValue, UploadDialog, sizeOf } from '@/components/mithaq/upload.tsx'
import { AppShell } from '../../ui/app-shell.tsx'

/** The `filesize` column: the size as a person reads it, never the raw bytes, in the upload dialog's own units. */
export function FileSize({ value }: CellProps) {
  const { locale } = useLocale()
  return typeof value === 'number' ? <span className="whitespace-nowrap">{sizeOf(value, locale)}</span> : null
}

/**
 * The `filename` column: the image's thumbnail before its name. The name
 * keeps at least seven rem and wraps onto a second line before it is cut,
 * between words where it has them and anywhere only where it must, so
 * on a phone the table gives the column room for it rather than squeezing it
 * to "co…" beside the thumbnail.
 */
export function FileName({ value, row }: CellProps) {
  const { t, locale } = useLocale()
  const name = String(value ?? '')
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <FileThumb row={row} t={t} locale={locale} size="xs" />
      <span className="line-clamp-2 min-w-28 [overflow-wrap:anywhere]" dir="auto" title={name}>{name}</span>
    </span>
  )
}

const useEditHref = () => {
  const { path, kayan } = useScreen()
  return (id: unknown) => `${path}${kayan.media?.pages.edit?.path.replace(':id', encodeURIComponent(String(id)))}`
}

/** The upload dialog over this kayan, which opens the new image's page once it is made. */
function NewImageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useLocale()
  const { kayan } = useScreen()
  const client = useClient()
  const editHref = useEditHref()
  // The dialog closes itself once the row is made, and that close is no
  // Cancel: the new image's page is already opening.
  const done = useRef(false)
  return kayan.media ? (
    <UploadDialog
      open={open}
      onOpenChange={(next) => done.current || onOpenChange(next)}
      target={kayan.media}
      client={client}
      t={t}
      locale={locale}
      locales={locales}
      onDone={(row: Row) => {
        done.current = true
        window.location.assign(editHref(row.id))
      }}
    />
  ) : null
}

/**
 * The image beside its edit form, and above it on a phone, where the record
 * layout puts a side marked `data-lead` first: the image itself, its size, a
 * link that downloads it, and Replace file. A file never changes once it is
 * made, so Replace file uploads a new image and opens it, and this one stays,
 * with whatever points at it, until it is deleted.
 */
export function MediaPreview() {
  const { t, locale } = useLocale()
  const access = useAccess()
  const row = useRecord()
  const [replacing, setReplacing] = useState(false)
  if (!row) return null
  const creates = access.collections?.media?.create === true
  const url = typeof row.url === 'string' ? row.url : undefined
  return (
    <div data-media-preview="" data-lead="" className="grid justify-items-start gap-3">
      <FileValue row={row} t={t} locale={locale} />
      {typeof row.filesize === 'number' ? <p className="text-muted-foreground text-sm">{sizeOf(row.filesize, locale)}</p> : null}
      <div className="flex flex-wrap gap-2">
        {url ? (
          <a href={url} download={typeof row.filename === 'string' ? row.filename : ''} data-media-download="" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Download className="size-4" aria-hidden />
            {t('media.download', 'Download')}
          </a>
        ) : null}
        {creates ? (
          <Button type="button" variant="outline" size="sm" data-media-replace="" onClick={() => setReplacing(true)}>
            <Upload className="size-4" aria-hidden />
            {t('media.replace', 'Replace file')}
          </Button>
        ) : null}
      </div>
      {creates ? <p className="text-muted-foreground text-xs">{t('media.replaceAbout', 'Replace file uploads a new image and opens it. This one stays until you delete it.')}</p> : null}
      <NewImageDialog open={replacing} onOpenChange={setReplacing} />
    </div>
  )
}

/**
 * The New page, `/media/new`, which the list's New button opens: the upload
 * dialog, open at once, and the page under it, which opens it again. Closing
 * it goes back to the list.
 */
export function NewImage(_props: ComponentProps) {
  const { t } = useLocale()
  const { path, kayan } = useScreen()
  const [open, setOpen] = useState(true)
  const list = `${path}${kayan.media?.pages.list?.path ?? ''}`
  return (
    <AppShell
      regions={{
        header: <h1>{t('media.new', 'New image')}</h1>,
        main: (
          <div data-media-new="" className="grid justify-items-start gap-4">
            <p className="text-muted-foreground">{t('media.newAbout', 'Choose an image and describe it. It is uploaded before it is saved.')}</p>
            <Button type="button" onClick={() => setOpen(true)}>
              <Upload className="size-4" aria-hidden />
              {t('admin.upload.new', 'Upload new')}
            </Button>
            <NewImageDialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next)
                if (!next) window.location.assign(list)
              }}
            />
          </div>
        ),
      }}
    />
  )
}
