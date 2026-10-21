import { useState, type FormEvent, type ReactElement } from 'react'
import { UploadIcon } from 'lucide-react'
import type { ClientField, ClientKayan, FetchClient } from 'mithaq/admin'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldShell, describedBy } from 'mithaq-admin/field-shell.tsx'
import { controlFor, useComponents } from 'mithaq-admin/components.tsx'
import { labelFor, type Translate } from 'mithaq-admin/copy.ts'
import { readOnlyField } from 'mithaq-admin/field-values.ts'
import { listed } from 'mithaq-admin/format.tsx'
import { localesOf } from 'mithaq-admin/refusal.ts'
import { doneWords } from 'mithaq-admin/form-rules.tsx'
import { toast } from 'mithaq-admin/toast.tsx'
import { refusalOf, refusedFile, sizeOf, typeNames, uploadFile, type Row } from 'mithaq-admin/upload-api.ts'

const blank = (value: unknown) => value === undefined || value === null || value === ''

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
  const { controls } = useComponents()
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
      toast.success(doneWords({ kayan: target, copy: { t, locale: '' }, effect: 'create' }))
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
        <form method="post" className="grid min-w-0 gap-4" noValidate onSubmit={submit}>
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
            const Control = controlFor(controls, field)
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
