import { use, useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, UploadIcon, XIcon } from 'lucide-react'
import { ScreenContext } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'
import { changeOf, type ControlProps } from 'mithaq-admin/control-props.ts'
import { createsIn } from 'mithaq-admin/field-values.ts'
import { FileThumb, urlOf, type sizes } from 'mithaq-admin/file-thumb.tsx'
import { isForbidden } from 'mithaq-admin/refusal.ts'
import { RelationshipControl, findByIds, idsOf } from 'mithaq-admin/relationship-control.tsx'
import type { Row } from 'mithaq-admin/upload-api.ts'
import { UploadDialog } from 'mithaq-admin/upload-dialog.tsx'

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
