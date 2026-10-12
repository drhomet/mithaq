import { use, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, ImageIcon, ImageOffIcon, UploadIcon, XIcon } from 'lucide-react'
import { $create, COMMAND_PRIORITY_EDITOR, createCommand } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import { allowedType, type ClientField, type ClientKayan, type FetchClient } from 'mithaq/admin'
import { ScreenContext } from 'mithaq/admin/react'
import { UploadNode } from 'mithaq/rich-text'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldShell, describedBy } from './field-shell.tsx'
import { changeOf, controlFor, createsIn, isForbidden, labelFor, listed, localesOf, noValue, readOnlyField, refusalKeyOf, type ControlProps, type FindApi, type FoundPage, type Translate } from './controls.tsx'
import type { CellProps } from './cells.tsx'
import { RelationshipControl, findByIds, idsOf } from './relationship-control.tsx'
import { rowKey, type RelationshipTitles } from './relationship-cell.tsx'
import type { RichTextPick } from './rich-text.tsx'

type Row = Record<string, unknown>

type UploadRequest = { method: 'PUT' | 'POST'; url: string; headers?: Record<string, string> }
type UploadInstructions = { request: UploadRequest; file: { uploadReference: unknown } }

/** The copy key of the refusal the server would answer for a file of this type and size, or nothing. The server checks both again, and reads the bytes besides. */
export const refusedFile = (file: { type: string; size: number }, storage?: { mimeTypes: readonly string[]; fileSize: number }): string | undefined => {
  if (!storage) return undefined
  if (!allowedType(file.type, storage.mimeTypes)) return 'error.invalid.upload_type'
  if (file.size > storage.fileSize) return 'error.invalid.upload_size'
  return file.size < 1 ? 'error.invalid.upload_request' : undefined
}

/** The refusals about the file itself, which sending it again meets again, so no retry is offered. A failed send, a 412 or a 5xx may pass a second time. */
const final = new Set(['error.invalid.upload_type', 'error.invalid.upload_size', 'error.invalid.upload_verify'])

const vendorNames: Readonly<Record<string, string>> = {
  'vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'vnd.ms-excel': 'XLS',
  'msword': 'DOC',
}

/**
 * A file type as a person names it, the subtype in capitals (`image/png` is PNG), since the raw
 * type reads as a path and breaks at its slash in an Arabic sentence. A vendor type is named by
 * its extension where well known, else by the last part of its name. A wildcard such as `image/*` is kept whole.
 */
export const typeName = (mimeType: string): string => {
  const [type = '', subtype = ''] = mimeType.split('/')
  if (!subtype || subtype === '*') return type ? `${type}/*` : mimeType
  const bare = subtype.split('+')[0]!
  return Object.hasOwn(vendorNames, bare) ? vendorNames[bare]! : bare.replace(/^(x-|vnd\.)/, '').split('.').at(-1)!.toUpperCase()
}

/** The types a kayan takes, each named once, in the order the kayan lists them. */
export const typeNames = (mimeTypes: readonly string[]): string[] => [...new Set(mimeTypes.map(typeName))]

/** A size in bytes as a person reads it: bytes, kilobytes or megabytes (1024 each), every unit written out because the platform's short forms mix words with abbreviations. */
export const sizeOf = (bytes: number, locale: string): string => {
  const [value, unit] = bytes < 1024 ? [bytes, 'byte'] : bytes < 1024 * 1024 ? [bytes / 1024, 'kilobyte'] : [bytes / (1024 * 1024), 'megabyte']
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 1 }).format(value)
}

const blank = (value: unknown) => value === undefined || value === null || value === ''

/** The words of a refusal: the project's copy under the key the server sent, and the server's own sentence where the copy holds none. */
const refusalOf = (thrown: unknown, t: Translate) => {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  const key = refusalKeyOf(thrown)
  return { words: (key && t(key, message)) || message, retry: !final.has(key ?? '') }
}

/** Headers a browser sets itself and refuses from a script, which the S3 adapter signs and the browser sends anyway. */
const forbidden = new Set(['content-length', 'host'])

/** The bytes sent where the instructions say, with progress as a fraction. Over `XMLHttpRequest` because `fetch` reports no upload progress. */
export const put = ({ request, file, progress }: { request: UploadRequest; file: Blob; progress: (fraction: number) => void }) =>
  new Promise<void>((resolve, reject) => {
    const sending = new XMLHttpRequest()
    sending.open(request.method, request.url)
    for (const [name, value] of Object.entries(request.headers ?? {})) if (!forbidden.has(name.toLowerCase())) sending.setRequestHeader(name, value)
    sending.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(event.loaded / event.total)
    }
    sending.onload = () => {
      if (sending.status >= 200 && sending.status < 300) return resolve()
      let message = `HTTP ${sending.status}`
      try {
        const said = (JSON.parse(sending.responseText) as { message?: unknown }).message
        if (typeof said === 'string') message = said
      } catch {
        // A store's own refusal is often XML; the status is what is left to say.
      }
      reject(Object.assign(new Error(message), { status: sending.status }))
    }
    sending.onerror = () => reject(new Error('The file could not be sent.'))
    sending.send(file)
  })

/** The whole upload in the three steps the server asks for: the instructions, the bytes, then the create carrying the signed reference beside the row's own fields. Answers the row the create made. */
export const uploadFile = async ({ client, kayan, file, data, progress, send = put }: {
  client: FetchClient
  kayan: string
  file: File
  data: Row
  progress: (fraction: number) => void
  send?: typeof put
}): Promise<Row> => {
  const instructions = (await client({ kayan, operation: 'uploadInstructions', input: { filename: file.name, filesize: file.size, mimeType: file.type } })) as UploadInstructions
  await send({ request: instructions.request, file, progress })
  progress(1)
  return (await client({ kayan, operation: 'create', input: { ...data, uploadReference: instructions.file.uploadReference } })) as Row
}

/** A file row's words for a screen reader: its alternative text in the viewer's locale, else its name. */
const altOf = (row: Row, locale: string) => {
  const alt = row.alt && typeof row.alt === 'object' ? (row.alt as Record<string, unknown>)[locale] : row.alt
  return typeof alt === 'string' && alt ? alt : String(row.filename ?? '')
}

/** The file's own address, computed by the server on every read and never stored. */
const urlOf = (row: Row, key: 'url' | 'thumbnailURL') => (typeof row[key] === 'string' ? (row[key] as string) : undefined)

// A small thumbnail takes `max-w-none` and `shrink-0`: the preflight's `max-width: 100%` makes an image count as no width when a table sizes its column.
const sizes = { xs: 'size-8 shrink-0 max-w-none', sm: 'size-16 shrink-0 max-w-none', lg: 'max-h-64 w-auto max-w-full' } as const
/** The pixels a thumbnail is drawn at, so the browser lays it out before the file arrives. */
const pixels = { xs: 32, sm: 64 } as const

/** What stands where an image cannot be drawn: the reader may not read it, or the file is gone. */
function Missing({ t, size }: { t: Translate; size: keyof typeof sizes }): ReactElement {
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
  return <span key={id} className="text-muted-foreground text-xs">{t('admin.cannotSee', 'You can\'t see this') ?? 'You can\'t see this'}</span>
}

const totalToShow = 3

/** The `upload` kind's cell: a small thumbnail for an image and the name for any other file; a set draws its first three and counts the rest. */
export function UploadCell({ field, locale, t, titles, value }: CellProps): ReactNode {
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

/**
 * What the upload dialog asks beside the file: every field of the kayan a
 * create must be sent and the caller writes, its alternative text among
 * them. The file's own columns are the runner's and never asked.
 */
export const askedFields = (target: ClientKayan): ClientField[] =>
  target.fields.filter((field) => field.rules.required === true && !readOnlyField(field, 'create') && field.kind !== 'join')

/**
 * The dialog a new file is made in: the file, the fields the create asks,
 * the send with its progress, and the server's refusal with a retry. It
 * answers the row the create made.
 */
export function UploadDialog({ open, onOpenChange, target, client, t, locale, locales, onDone }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ClientKayan
  client: FetchClient
  t: Translate
  locale: string
  locales: readonly string[]
  onDone: (row: Row) => void
}): ReactElement {
  const [file, setFile] = useState<File | null>(null)
  const [values, setValues] = useState<Row>({})
  const [progress, setProgress] = useState<number | null>(null)
  const [refused, setRefused] = useState<{ words: string; retry: boolean }>()
  const [noFile, setNoFile] = useState(false)
  const [wrong, setWrong] = useState<{ words: Record<string, string>; locales: Readonly<Record<string, readonly string[]>> }>({ words: {}, locales: {} })
  const fields = askedFields(target)
  const busy = progress !== null
  const inputId = `upload-${target.name}-file`
  const close = () => {
    if (busy) return
    setFile(null)
    setValues({})
    setRefused(undefined)
    setNoFile(false)
    setWrong({ words: {}, locales: {} })
    onOpenChange(false)
  }
  const send = async () => {
    if (busy) return
    if (!file) return setNoFile(true)
    const early = refusedFile(file, target.storage)
    if (early) return setRefused({ words: t(early, early) ?? early, retry: false })
    const missing = { words: {} as Record<string, string>, locales: {} as Record<string, readonly string[]> }
    for (const field of fields) {
      const held = values[field.name]
      const empty = field.rules.localized === true ? locales.filter((one) => blank((held as Row | undefined)?.[one])) : blank(held) ? [''] : []
      if (!empty.length) continue
      const key = `${target.name}.${field.name}.required`
      missing.words[field.name] = t(key, key) ?? key
      if (field.rules.localized === true) missing.locales[field.name] = empty
    }
    setWrong(missing)
    setRefused(undefined)
    if (Object.keys(missing.words).length) return
    setProgress(0)
    try {
      const row = await uploadFile({ client, kayan: target.name, file, data: values, progress: setProgress })
      setProgress(null)
      setFile(null)
      setValues({})
      onDone(row)
      onOpenChange(false)
    } catch (thrown) {
      setProgress(null)
      // A schema refusal is drawn under each field it names, keyed by the path's first segment.
      const issues = (thrown as { data?: { params?: { issues?: unknown } } } | null)?.data?.params?.issues
      const words: Record<string, string> = {}
      for (const issue of Array.isArray(issues) ? (issues as { path?: unknown; message?: unknown }[]) : []) {
        const name = typeof issue?.path === 'string' ? issue.path.split('.')[0]! : ''
        if (fields.some((field) => field.name === name) && typeof issue.message === 'string') words[name] ??= t(issue.message, issue.message) ?? issue.message
      }
      if (Object.keys(words).length) return setWrong({ words, locales: localesOf(thrown) })
      setRefused(refusalOf(thrown, t))
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    // The dialog is portaled out of the document, and React still carries its
    // submit up to the page's own form, which would save the row.
    event.preventDefault()
    event.stopPropagation()
    void send()
  }
  const percent = Math.round((progress ?? 0) * 100)
  const title = t('admin.upload.new', 'Upload new') ?? 'Upload new'
  return (
    <Dialog open={open} onOpenChange={(next: boolean) => (next ? onOpenChange(true) : close())}>
      <DialogContent showCloseButton={false} data-upload-dialog={target.name}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {(t('admin.upload.takes', 'Files of these types, {size} at most: {types}.') ?? '')
              .replace('{size}', () => sizeOf(target.storage?.fileSize ?? 0, locale))
              .replace('{types}', () => listed(typeNames(target.storage?.mimeTypes ?? []), locale))}
          </DialogDescription>
        </DialogHeader>
        <form className="grid min-w-0 gap-4" noValidate onSubmit={submit}>
          <FieldShell id={inputId} label={t('admin.upload.file', 'File') ?? 'File'} error={noFile ? (t('admin.upload.required', 'Choose a file first.') ?? 'Choose a file first.') : undefined}>
            {/* The browser's own file box draws its button in the browser's language, so the box is kept for the keyboard and the picker and the button is drawn in the page's. */}
            <div className="flex min-w-0 items-center gap-3">
              <input
                id={inputId}
                type="file"
                className="peer sr-only"
                accept={target.storage?.mimeTypes.join(',')}
                disabled={busy}
                aria-required
                aria-invalid={noFile || undefined}
                aria-describedby={describedBy({ id: inputId, error: noFile ? 'error' : undefined })}
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null
                  setFile(chosen)
                  if (chosen) setNoFile(false)
                  const early = chosen ? refusedFile(chosen, target.storage) : undefined
                  setRefused(early ? { words: t(early, early) ?? early, retry: false } : undefined)
                }}
              />
              <label htmlFor={inputId} aria-hidden="true" className={buttonVariants({ variant: 'outline', className: 'shrink-0 cursor-pointer peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:opacity-50' })}>
                {t('admin.upload.choose', 'Choose a file') ?? 'Choose a file'}
              </label>
              <span data-upload-chosen="" dir="auto" className="text-muted-foreground min-w-0 truncate text-sm">
                {file?.name ?? t('admin.upload.noFile', 'No file chosen')}
              </span>
            </div>
          </FieldShell>
          {fields.map((field) => {
            const Control = controlFor(field)
            const id = `upload-${target.name}-${field.name}`
            const localized = field.rules.localized === true
            const held = (values[field.name] && typeof values[field.name] === 'object' ? values[field.name] : {}) as Row
            const names = new Intl.DisplayNames([locale], { type: 'language' })
            const error = wrong.words[field.name]
            const marked = (one: string | undefined) => error !== undefined && (!one || !wrong.locales[field.name]?.length || wrong.locales[field.name]!.includes(one))
            const set = (next: unknown) => {
              setValues((already) => ({ ...already, [field.name]: next }))
              setWrong(({ words: { [field.name]: _said, ...words }, locales }) => ({ words, locales }))
            }
            const control = (one: string | undefined) => (
              <Control
                key={one ?? ''}
                field={field}
                kayan={target}
                t={t}
                locale={locale}
                id={one && one !== locale ? `${id}-${one}` : id}
                value={one ? held[one] : values[field.name]}
                values={values}
                setValue={() => {}}
                onChange={(next) => set(one ? { ...held, [one]: next } : next)}
                readOnly={busy}
                error={marked(one) ? error : undefined}
                describedBy={[one ? `${id}-${one}-locale` : '', describedBy({ id, error }) ?? ''].filter(Boolean).join(' ') || undefined}
              />
            )
            const label = labelFor({ kayan: target, field, copy: { t, locale } })
            return (
              <FieldShell key={field.name} id={id} label={label} error={error}>
                {localized ? (
                  // One box per locale, the viewer's own first. The viewer's box is named by the field's label, the others by label and locale, so none is unnamed.
                  <div className="grid gap-2">
                    {[locale, ...locales.filter((one) => one !== locale)].map((one) => (
                      <div key={one} className="grid gap-1">
                        {one === locale ? (
                          <span id={`${id}-${one}-locale`} className="text-muted-foreground text-xs">{names.of(one)}</span>
                        ) : (
                          <label id={`${id}-${one}-locale`} htmlFor={`${id}-${one}`} className="text-muted-foreground text-xs">
                            <span className="sr-only">{label} </span>
                            {names.of(one)}
                          </label>
                        )}
                        {control(one)}
                      </div>
                    ))}
                  </div>
                ) : control(undefined)}
              </FieldShell>
            )
          })}
          {busy ? (
            <div role="status" className="grid gap-1 text-sm">
              <span>{(t('admin.upload.sending', 'Uploading… {percent}%') ?? '').replace('{percent}', () => percent.toLocaleString(locale))}</span>
              <progress value={progress ?? 0} max={1} aria-label={title} className="h-2 w-full" />
            </div>
          ) : null}
          {refused ? (
            <div role="alert" data-upload-refused="" className="border-destructive/50 text-destructive grid gap-2 rounded-md border px-3 py-2 text-sm">
              <p dir="auto">{refused.words}</p>
              {file && refused.retry ? (
                <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => void send()}>
                  {t('admin.upload.retry', 'Try again') ?? 'Try again'}
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</Button>
            <Button type="submit" disabled={busy}>
              <UploadIcon className="size-4" aria-hidden />
              {t('admin.upload.send', 'Upload') ?? 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The `upload` kind's control: one file as its thumbnail (or name and type) over a picker and "Upload new".
 * A set is a grid, each file removed or moved by a keyboard-reachable button; read-only shows the files alone.
 */
export function UploadControl(props: ControlProps): ReactElement {
  const { api, client, field, id, locale = 'en', locales, readOnly, t, value } = props
  const change = changeOf(props)
  const screen = use(ScreenContext)
  const target = client?.find((one) => one.name === field.relationTo)
  const reads = target && api ? api[target.name] : undefined
  const held = idsOf(value)
  const many = field.hasMany === true
  const [rows, setRows] = useState<ReadonlyMap<string, Row>>(() => new Map())
  const [uploading, setUploading] = useState(false)
  const [focus, setFocus] = useState<string>()
  const asked = useRef(new Set<string>())
  const [settled, setSettled] = useState<ReadonlyMap<string, 'unseen' | 'failed'>>(() => new Map())

  const excluded = held.join(',')
  useEffect(() => {
    if (!reads || !screen) return
    const missing = held.filter((one) => !rows.has(one) && !asked.current.has(one))
    if (!missing.length) return
    for (const one of missing) asked.current.add(one)
    void findByIds({ reads, ids: missing, maxLimit: screen.screen.maxLimit })
      .then((docs) => {
        const found = new Set(docs.map((row) => String(row.id ?? '')))
        setSettled((already) => new Map([...already, ...missing.filter((one) => !found.has(one)).map((one) => [one, 'unseen'] as const)]))
        setRows((already) => new Map([...already, ...docs.map((row) => [String(row.id ?? ''), row] as const)]))
      })
      .catch((thrown: unknown) => {
        const state = isForbidden(thrown) ? 'unseen' : 'failed'
        setSettled((already) => new Map([...already, ...missing.map((one) => [one, state] as const)]))
      })
  }, [excluded, reads])

  useEffect(() => {
    if (!focus) return
    document.getElementById(focus)?.focus()
    setFocus(undefined)
  }, [focus])

  /** One held file: its thumbnail, or what the read settled, and never its raw id. */
  const drawn = (one: string, size: keyof typeof sizes) => {
    const row = rows.get(one)
    if (row) return <FileThumb row={row} t={t} locale={locale} size={size} />
    const state = reads && screen ? settled.get(one) : 'unseen'
    if (state === 'failed') return <span>—</span>
    return <span className="text-muted-foreground text-xs">{state === 'unseen' ? (t('admin.cannotSee', 'You can\'t see this') ?? 'You can\'t see this') : (t('admin.loading', 'Loading…') ?? 'Loading…')}</span>
  }
  // Offered only where the access report lets this actor create a file.
  const creates = target !== undefined && createsIn({ kayan: target, report: screen?.access.collections?.[target.name] })
  const upload = !readOnly && target?.storage && screen && creates ? (
    <>
      <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => setUploading(true)} data-upload-new="">
        <UploadIcon className="size-4" aria-hidden />
        {t('admin.upload.new', 'Upload new') ?? 'Upload new'}
      </Button>
      <UploadDialog
        open={uploading}
        onOpenChange={setUploading}
        target={target}
        client={screen.client}
        t={t}
        locale={locale}
        locales={locales ?? [locale]}
        onDone={(row) => {
          const made = String(row.id ?? '')
          asked.current.add(made)
          setRows((already) => new Map(already).set(made, row))
          change(many ? [...held, made] : made)
        }}
      />
    </>
  ) : null
  const picker = (single: boolean) => (
    <div className="min-w-0 flex-1 basis-48">
      <RelationshipControl
        {...props}
        field={{ ...field, hasMany: undefined }}
        value={single ? value : null}
        onChange={(next) => {
          if (single) return change(next)
          if (typeof next === 'string' && !held.includes(next)) change([...held, next])
        }}
        placeholder={single ? (t('admin.upload.choose', 'Choose a file') ?? 'Choose a file') : (t('admin.upload.add', 'Add a file') ?? 'Add a file')}
        drawRow={(row, label) => (
          <span className="flex min-w-0 items-center gap-2">
            {urlOf(row, 'thumbnailURL') ? <FileThumb row={row} t={t} locale={locale} size="xs" /> : <FileIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />}
            <span className="min-w-0 truncate" dir="auto">{label}</span>
          </span>
        )}
      />
    </div>
  )

  if (!many) {
    return (
      <div className="grid min-w-0 gap-2" data-upload-control={field.name}>
        {held[0] ? drawn(held[0], readOnly ? 'lg' : 'sm') : null}
        {readOnly ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {picker(true)}
            {upload}
          </div>
        )}
      </div>
    )
  }

  // The keyboard stays where the person was: on the button that moved the file (its tile's other move once it reaches an end), or on a neighbour's remove after a removal, else the picker.
  const buttonOf = (one: string, which: 'earlier' | 'later' | 'remove') => `${id}-${one}-${which}`
  const move = (from: number, by: -1 | 1) => {
    const next = [...held]
    const [one] = next.splice(from, 1)
    next.splice(from + by, 0, one!)
    change(next)
    const end = by === -1 ? from + by === 0 : from + by === next.length - 1
    setFocus(buttonOf(one!, by === -1 ? (end ? 'later' : 'earlier') : end ? 'earlier' : 'later'))
  }
  const remove = (at: number) => {
    const next = held.filter((_, each) => each !== at)
    change(next)
    const neighbour = held[at + 1] ?? held[at - 1]
    setFocus(neighbour ? buttonOf(neighbour, 'remove') : id)
  }
  const words = (key: string, fallback: string, name: string) => (t(key, fallback) ?? fallback).replace('{name}', () => name)
  return (
    <div className="grid min-w-0 gap-2" data-upload-control={field.name}>
      {held.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
          {held.map((one, at) => {
            const name = String(rows.get(one)?.filename ?? one)
            const earlier = words('admin.upload.moveEarlier', 'Move {name} earlier', name)
            const later = words('admin.upload.moveLater', 'Move {name} later', name)
            const removeLabel = words('admin.upload.remove', 'Remove {name}', name)
            return (
              <li key={one} data-upload-tile={one} className="grid min-w-0 justify-items-center gap-1 rounded-md border p-1">
                {drawn(one, 'sm')}
                {readOnly ? null : (
                  <div className="flex">
                    <Button id={buttonOf(one, 'earlier')} type="button" variant="ghost" size="icon-sm" disabled={at === 0} title={earlier} aria-label={earlier} onClick={() => move(at, -1)}>
                      <ChevronLeftIcon className="size-4 rtl:-scale-x-100" aria-hidden />
                    </Button>
                    <Button id={buttonOf(one, 'remove')} type="button" variant="ghost" size="icon-sm" title={removeLabel} aria-label={removeLabel} onClick={() => remove(at)}>
                      <XIcon className="size-4" aria-hidden />
                    </Button>
                    <Button id={buttonOf(one, 'later')} type="button" variant="ghost" size="icon-sm" disabled={at === held.length - 1} title={later} aria-label={later} onClick={() => move(at, 1)}>
                      <ChevronRightIcon className="size-4 rtl:-scale-x-100" aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      {readOnly ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {picker(false)}
          {upload}
        </div>
      )}
    </div>
  )
}

// The rich text node is opt-in: a project lists `UploadNode` from `mithaq/rich-text` among its nodes,
// `UploadView` among its views, `imagePick` among its picks and `UploadPlugin` as the editor's plugin.

/** What the `/` menu's "Image" asks the editor for, which `UploadPlugin` answers with its dialog. */
export const INSERT_UPLOAD_COMMAND = createCommand<void>('INSERT_UPLOAD_COMMAND')

/** The `/` menu's "Image", in each locale's own words. */
export const imagePick: RichTextPick = {
  key: 'upload',
  label: { en: 'Image', ar: 'صورة' },
  Icon: ImageIcon,
  keywords: ['image', 'upload', 'picture', 'photo', 'صورة'],
  onSelect: ({ editor }) => editor.dispatchCommand(INSERT_UPLOAD_COMMAND, undefined),
}

/**
 * A file inside the text, read by its id through the screen's client so the row's own access
 * decides, and drawn off the row's computed `url`. A file the viewer may not read, or of a kayan this screen holds no files of, draws the placeholder.
 */
function UploadImage({ relationTo, value, format }: { relationTo: string; value: string; format: string }): ReactElement {
  const screen = use(ScreenContext)
  const t: Translate = screen?.t ?? ((_key, fallback) => fallback)
  const locale = screen?.locale ?? 'en'
  const readable = !!screen?.screen.kayan[relationTo]?.storage
  const [row, setRow] = useState<Row | null | false>(readable ? null : false)
  useEffect(() => {
    if (!screen || !readable) return setRow(false)
    let live = true
    screen.client({ kayan: relationTo, operation: 'find', input: { where: { id: { equals: value } }, limit: 1 } })
      .then((found) => live && setRow((found as FoundPage).docs[0] ?? false), () => live && setRow(false))
    return () => {
      live = false
    }
  }, [relationTo, value, readable, screen?.client])
  const align = format === 'center' ? 'justify-center' : format === 'right' || format === 'end' ? 'justify-end' : 'justify-start'
  return (
    <div data-upload-node={value} className={`my-2 flex ${align}`}>
      {row === null ? <span className="bg-muted size-24 animate-pulse rounded-md" /> : row ? <FileValue row={row} t={t} locale={locale} /> : <Missing t={t} size="lg" />}
    </div>
  )
}

/** The node's React half: `UploadNode`'s type and data, drawn by `UploadImage`. */
export class UploadView extends UploadNode {
  $config() {
    return this.config('upload', { extends: UploadNode })
  }

  decorate(): ReactElement {
    return <UploadImage relationTo={this.getRelationTo()} value={this.getValue()} format={this.getFormat()} />
  }
}

/**
 * The editor's half of "Image": a dialog holding the upload control over the screen's first kayan that holds files,
 * so a file is chosen or uploaded as a field's is; the node goes in its own block where the selection was.
 */
export function UploadPlugin(props: ControlProps): ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const screen = use(ScreenContext)
  const [open, setOpen] = useState(false)
  useEffect(() => editor.registerCommand(INSERT_UPLOAD_COMMAND, () => (setOpen(true), true), COMMAND_PRIORITY_EDITOR), [editor])
  const target = Object.values(screen?.screen.kayan ?? {}).find((one) => one.storage)
  if (!screen || !target) return null
  const { t } = props
  const api: FindApi = { [target.name]: { find: (input) => screen.client({ kayan: target.name, operation: 'find', input }) as Promise<FoundPage> } }
  const field: ClientField = { name: 'upload', kind: 'upload', relationTo: target.name, rules: {}, component: 'upload', cell: 'upload', label: { [props.locale ?? 'en']: t('admin.upload.image', 'Image') ?? 'Image' } }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} data-upload-insert="">
        <DialogHeader>
          <DialogTitle>{t('admin.upload.insert', 'Insert an image') ?? 'Insert an image'}</DialogTitle>
          <DialogDescription>{t('admin.upload.insertHint', 'Choose a file already here, or upload a new one.') ?? ''}</DialogDescription>
        </DialogHeader>
        <UploadControl
          {...props}
          id={`${props.id}-upload`}
          field={field}
          kayan={target}
          client={[target, ...(props.client ?? [])]}
          api={api}
          value={null}
          readOnly={false}
          onChange={(next) => {
            if (typeof next !== 'string') return
            editor.update(() => void $insertNodeToNearestRoot($create(UploadView).setUpload(target.name, next)))
            setOpen(false)
          }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 a7c10956534bbee3e398be2e6b514112d36145157e1fb4ad9ea439c5853a3854
