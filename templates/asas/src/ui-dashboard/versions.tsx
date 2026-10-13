// The versions are read in the browser, as the viewer, from the kayan's own
// `findVersions`, which answers only the versions of rows the viewer reads, each
// cut to the columns it reads. The page draws this only for an actor holding that
// key, and the restore only for one holding `restoreVersion`; the server refuses
// either to anyone else whatever the page drew.
import { useContext, useEffect, useMemo, useState } from 'react'
import { same, type ClientField, type ComponentProps, type Row } from 'mithaq/admin'
import { FormContext, useAccess, useClient, useKayan, useLocale, useRecord, useScreen } from 'mithaq/admin/react'
import { empty } from '@asas/mithaq/mithaq/audit-sink.ts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { blocksOf, richTextPlainText } from 'mithaq-admin/rich-text-line.ts'
import { cellFor, useComponents } from 'mithaq-admin/components.tsx'
import type { FindApi, FoundPage } from 'mithaq-admin/control-props.ts'
import { labelFor, titleOf } from 'mithaq-admin/copy.ts'
import { formatDate } from 'mithaq-admin/format.tsx'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'
import { endonym } from 'mithaq-admin/locale-menu.ts'
import { CloseButton } from 'mithaq-admin/record-frame.tsx'
import { useRelationshipTitles } from 'mithaq-admin/relationship-cell.tsx'

/** One version as `findVersions` answers it. */
export type Version = {
  id: string
  latest: boolean
  autosave: boolean
  updatedAt: string | Date
  version: Row
}

/** How many versions one read asks for, and how many more each "Show older" adds. */
const page = 10

/** The four status labels, each under its `version` key with the English it falls back to. */
const labels = {
  currentDraft: 'Current draft',
  draft: 'Draft',
  currentlyPublished: 'Currently published',
  previouslyPublished: 'Previously published',
} as const

/**
 * Which of the four labels a version wears, over the row's versions newest first.
 * A draft is the current draft when it is the latest version, since then no
 * published version is newer than it. A published version is the currently
 * published one when it is the newest published version: the row always holds the
 * last published copy and nothing unpublishes it. The newest page is always read
 * first, so that version is on it whenever any published version is.
 */
const labelOf = (version: Version, versions: readonly Version[]): keyof typeof labels | undefined =>
  // A reader without the `_status` column gets it cut from every version, and
  // a status nobody can read is no status to draw.
  !('_status' in version.version)
    ? undefined
    : version.version._status === 'draft'
      ? version.latest ? 'currentDraft' : 'draft'
      : version.id === versions.find((one) => one.version._status !== 'draft')?.id ? 'currentlyPublished' : 'previouslyPublished'

/** The columns every kayan of this project carries and no person edits, and the status the pill already says. */
const technical = new Set(['id', 'organization', 'createdAt', 'updatedAt', '_status'])

/**
 * The words of each block of `side`, and whether `other` holds no block of the
 * same value, as a block is the unit a person reads a rich text change by. A block
 * is held by its whole value, so one whose format or link changed is marked though
 * its words did not.
 */
const changedBlocks = ({ side, other }: { side: unknown; other: unknown }) => {
  const left = new Map<string, number>()
  for (const block of blocksOf(other)) {
    const key = JSON.stringify(block)
    left.set(key, (left.get(key) ?? 0) + 1)
  }
  return blocksOf(side).flatMap((block) => {
    const key = JSON.stringify(block)
    const held = left.get(key) ?? 0
    if (held) left.set(key, held - 1)
    const text = richTextPlainText(block).trim()
    return text ? [{ text, changed: held === 0 }] : []
  })
}

const entriesOf = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [])

/**
 * The panel an edit page names as a component node. It reads the row the page
 * draws and its kayan off the screen, so one file serves every kayan that keeps
 * drafts.
 */
export function Versions(_: ComponentProps) {
  const { t, locale } = useLocale()
  const kayan = useKayan()
  const record = useRecord()
  const client = useClient()
  const id = record?.id === undefined ? undefined : String(record.id)
  // How many saves have landed on the form this panel sits in, an autosave
  // included. A draft save never moves the row's own `updatedAt`, so this is what
  // tells a panel that stayed mounted through one that its list is stale.
  const saves = useContext(FormContext)?.saves ?? 0
  // The row as this page last drew it: a save moves its `updatedAt` or bumps
  // `saves`, and the panel reads its versions again.
  const seen = `${id}@${String(record?.updatedAt ?? '')}@${saves}`
  const [limit, setLimit] = useState(page)
  const [read, setRead] = useState<{ seen: string; docs: Version[]; more: boolean } | { seen: string; failed: true }>()
  const [opened, setOpened] = useState<Version>()

  // The client is left out of the dependencies: the host makes a new one on every
  // render, so following it would read the same page again on every render.
  useEffect(() => {
    if (!id) return
    let live = true
    ;(client({ kayan: kayan.name, operation: 'findVersions', input: { where: { parent: { equals: id } }, sort: '-updatedAt', limit } }) as Promise<{ docs: Version[]; hasNextPage: boolean }>).then(
      (found) => live && setRead({ seen, docs: found.docs, more: found.hasNextPage }),
      () => live && setRead({ seen, failed: true }),
    )
    return () => {
      live = false
    }
  }, [kayan.name, seen, limit])

  const shown = read?.seen === seen ? read : undefined
  const when = (at: string | Date) => formatDate({ value: at, locale }) ?? String(at)
  return (
    <div data-panel="versions" className="grid gap-4">
      {shown === undefined ? (
        <p className="text-muted-foreground text-sm">{t('version.loading', 'Loading versions…')}</p>
      ) : 'failed' in shown ? (
        <p role="alert" className="text-destructive text-sm">{t('version.failed', 'The versions could not be read.')}</p>
      ) : !shown.docs.length ? (
        <p className="text-muted-foreground text-sm">{t('version.none', 'No versions yet.')}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('version.updatedAt', 'Updated at')}</TableHead>
                <TableHead>{t('version.status', 'Status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.docs.map((version) => (
                <TableRow key={version.id} data-version={version.id}>
                  <TableCell>
                    {/* Underlined and in the link colour at rest, since a phone has
                        no hover to show that the date opens the comparison, and
                        44 pixels tall. */}
                    <button type="button" data-button="open-version" className="text-primary inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4" onClick={() => setOpened(version)}>
                      <time dateTime={new Date(version.updatedAt).toISOString()}>{when(version.updatedAt)}</time>
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {version.autosave ? <Badge variant="outline">{t('version.autosave', 'Autosave')}</Badge> : null}
                      <Pill version={version} versions={shown.docs} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {shown.more ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setLimit(limit + page)}>
              {t('version.more', 'Show older')}
            </Button>
          ) : null}
          {opened && id ? <Compare key={opened.id} version={opened} versions={shown.docs} parent={id} onClose={() => setOpened(undefined)} /> : null}
        </>
      )}
    </div>
  )
}

/** A version's status pill, the currently published one standing out. */
function Pill({ version, versions }: { version: Version; versions: readonly Version[] }) {
  const { t } = useLocale()
  const label = labelOf(version, versions)
  return label ? <Badge variant={label === 'currentlyPublished' ? 'default' : 'outline'}>{t(`version.${label}`, labels[label])}</Badge> : null
}

/**
 * The sheet over the list: the version, and the one it is compared against, by
 * default the newest one older than it, field by field, each value drawn by the
 * field's own cell and a localized field one row per locale, modified fields only
 * until the viewer asks for all. A column the viewer may not read is in neither
 * snapshot, so it draws no row.
 */
function Compare({ version, versions, parent, onClose }: { version: Version; versions: readonly Version[]; parent: string; onClose: () => void }) {
  const { t, locale, dir } = useLocale()
  const kayan = useKayan()
  const client = useClient()
  const screen = useScreen()
  const restores = useAccess().collections?.[kayan.name]?.operations?.restoreVersion === true
  /** Whether the kayan's restore takes `expectedUpdatedAt`, as the form this panel sits in says. */
  const takes = useContext(FormContext)?.expectedUpdatedAtOn?.includes('restoreVersion') === true
  /** The version compared against, or `''` for the one before. */
  const [against, setAgainst] = useState('')
  const [modifiedOnly, setModifiedOnly] = useState(true)
  /** The version before this one, read once: the list holds every other version a person may pick. */
  const [prior, setPrior] = useState<{ version: Version | null } | { failed: true }>()
  /** The restore waiting on its confirm, and whether it restores as a draft. */
  const [confirming, setConfirming] = useState<{ draft: boolean }>()
  const [restoring, setRestoring] = useState(false)
  /** A restore the server refused, drawn in the sheet, which stays open. */
  const [restoreFailed, setRestoreFailed] = useState<unknown>(undefined)

  useEffect(() => {
    let live = true
    const older = { and: [{ parent: { equals: parent } }, { updatedAt: { less_than: new Date(version.updatedAt).toISOString() } }] }
    ;(client({ kayan: kayan.name, operation: 'findVersions', input: { where: older, sort: '-updatedAt', limit: 1 } }) as Promise<{ docs: Version[] }>).then(
      (found) => live && setPrior({ version: found.docs[0] ?? null }),
      () => live && setPrior({ failed: true }),
    )
    return () => {
      live = false
    }
  }, [version.id])

  const previous = prior && 'version' in prior ? prior.version : null
  const from = against ? versions.find((one) => one.id === against) ?? null : previous
  const rows = kayan.fields
    .filter((field) => field.kind !== 'join' && !technical.has(field.name) && (field.name in version.version || (!!from && field.name in from.version)))
    .flatMap((field): { key: string; field: ClientField; before: unknown; after: unknown; code?: string }[] => {
      const before = from?.version[field.name]
      const after = version.version[field.name]
      if (field.rules.localized !== true) return [{ key: field.name, field, before, after }]
      // Each locale's value alone, drawn by the field's cell as a plain value.
      const plain: ClientField = { ...field, rules: { ...field.rules, localized: false } }
      const codes = [...new Set([...entriesOf(before), ...entriesOf(after)])]
      return codes.map((code) => ({
        key: `${field.name}.${code}`,
        field: plain,
        before: (before as Record<string, unknown> | undefined)?.[code],
        after: (after as Record<string, unknown> | undefined)?.[code],
        code,
      }))
    })
    // Whether the two sides differ, once per row, which both the filter and the row's mark read.
    .map((row) => ({ ...row, changed: !(same(row.before, row.after) || (empty(row.before) && empty(row.after))) }))
    .filter((row) => !modifiedOnly || row.changed)

  // Every kayan this screen crosses, so a relationship's value is named the way
  // the list names it.
  const kayans = useMemo(() => Object.values(screen.kayan), [screen])
  const api = useMemo<FindApi>(
    () => Object.fromEntries(kayans.map((one) => [one.name, { find: (input: Row) => client({ kayan: one.name, operation: 'find', input }) as Promise<FoundPage> }])),
    [kayans],
  )
  const titles = useRelationshipTitles({ fields: kayan.fields, docs: [version.version, from?.version ?? {}], context: { api, client: kayans, locale } })
  const { cells } = useComponents()
  const copy = { t, locale }
  // A rich text value whole, a block to a line, where its list cell draws the
  // first block alone: a change further down would read as no change. A block the
  // other side does not hold is marked, as removed (`del`) on the side compared
  // against and as added (`ins`) on the side viewed: struck through and underlined
  // as well as tinted, so the mark does not rest on colour alone.
  const drawn = (field: ClientField, value: unknown, other: unknown, mark: 'del' | 'ins') => {
    if (empty(value)) return '—'
    if (field.kind !== 'richText') return cellFor({ cells, field })({ kayan, field, value, t, locale, titles })
    const blocks = changedBlocks({ side: value, other })
    // A value of images or empty blocks alone has no words, and reads as empty.
    if (!blocks.length) return '—'
    return blocks.map(({ text, changed }, at) => {
      const Mark = mark
      return <p key={at} dir="auto" className="whitespace-pre-line">{changed ? <Mark data-block-changed="" className={mark === 'del' ? 'bg-destructive/15 line-through' : 'bg-primary/15 underline'}>{text}</Mark> : text}</p>
    })
  }
  const when = (at: string | Date) => formatDate({ value: at, locale }) ?? String(at)
  const named = (one: Version) => {
    const label = labelOf(one, versions)
    return label ? `${when(one.updatedAt)} · ${t(`version.${label}`, labels[label])}` : when(one.updatedAt)
  }
  const options = [
    // With its date, so the select says which version it compares against.
    { value: '', label: previous ? `${t('version.previousVersion', 'Previous version')} · ${when(previous.updatedAt)}` : (t('version.previousVersion', 'Previous version') ?? '') },
    // The version before is offered once, as "Previous version".
    ...versions.filter((one) => one.id !== version.id && one.id !== previous?.id).map((one) => ({ value: one.id, label: named(one) })),
  ]

  /**
   * Puts the version back, onto the row or as a new draft, and draws the page
   * again from the server, so the form reads what the restore wrote. A refused or
   * failed restore keeps the sheet open and draws its own sentence and the
   * server's (`refusalKeyOf`, which the form's own banner reads the same way).
   */
  const restore = async (draft: boolean) => {
    setRestoring(true)
    setRestoreFailed(undefined)
    try {
      // The instant of the latest version this panel read, where the kayan's
      // restore takes it, so a restore over a newer draft another person saved
      // since is refused 409 rather than burying it.
      const read = takes ? versions.find((one) => one.latest)?.version.updatedAt : undefined
      await client({ kayan: kayan.name, operation: 'restoreVersion', input: { id: version.id, ...(read !== undefined && { expectedUpdatedAt: read }) }, draft })
      window.location.reload()
    } catch (thrown) {
      setRestoring(false)
      setConfirming(undefined)
      setRestoreFailed(thrown)
    }
  }
  const restoreFailedKey = restoreFailed === undefined ? undefined : refusalKeyOf(restoreFailed)

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {/* The primitive's `data-[side=*]:w-3/4` is outranked by naming the same
          side, so the sheet is the phone's whole width. */}
      <SheetContent showCloseButton={false} side={dir === 'rtl' ? 'left' : 'right'} className="w-full overflow-y-auto data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-2xl data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t('version.compareVersions', 'Compare versions')}</SheetTitle>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="text-muted-foreground text-xs">{t('version.comparingAgainst', 'Comparing against')}</span>
              <Select value={against} disabled={prior === undefined} onValueChange={(value) => setAgainst(String(value ?? ''))}>
                <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue>{options.find((one) => one.value === against)?.label}</SelectValue></SelectTrigger>
                <SelectContent>
                  {options.map((one) => (
                    <SelectItem key={one.value} value={one.value}>{one.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <span className="text-muted-foreground text-xs">{t('version.currentlyViewing', 'Currently viewing')}</span>
              <div className="flex flex-wrap items-center gap-1 text-sm">
                <time dateTime={new Date(version.updatedAt).toISOString()}>{when(version.updatedAt)}</time>
                {version.autosave ? <Badge variant="outline">{t('version.autosave', 'Autosave')}</Badge> : null}
                <Pill version={version} versions={versions} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`${version.id}-modified-only`} data-modified-only checked={modifiedOnly} onCheckedChange={(checked) => setModifiedOnly(checked === true)} />
            <Label htmlFor={`${version.id}-modified-only`}>{t('version.modifiedOnly', 'Modified only')}</Label>
          </div>
          {prior === undefined ? (
            <p className="text-muted-foreground text-sm">{t('version.loading', 'Loading versions…')}</p>
          ) : 'failed' in prior && !against ? (
            <p role="alert" className="text-destructive text-sm">{t('version.failed', 'The versions could not be read.')}</p>
          ) : !rows.length ? (
            <p className="text-muted-foreground text-sm">{t('auditLog.none', 'No field you may read changed.')}</p>
          ) : (
            <ul className="grid gap-3 text-sm">
              {/* Which side is which, over the two columns, since on a phone
                  the two labels above stack in one. */}
              <li aria-hidden="true" className="text-muted-foreground grid grid-cols-2 gap-2 text-xs">
                <span>{t('version.comparingAgainst', 'Comparing against')}</span>
                <span>{t('version.currentlyViewing', 'Currently viewing')}</span>
              </li>
              {rows.map((row) => {
                // What the "Modified only" filter keeps, so with every field shown
                // the rows that differ say so in words and in a rule at their start.
                const { changed } = row
                return (
                  <li key={row.key} data-diff={row.key} data-changed={changed ? '' : undefined} className={changed ? 'border-primary grid gap-1 border-s-2 ps-2' : 'grid gap-1'}>
                    <span className="flex items-center gap-1.5 font-medium">
                      {labelFor({ kayan, field: row.field, copy })}
                      {row.code ? <Badge variant="outline">{endonym(row.code)}</Badge> : null}
                      {changed && !modifiedOnly ? <Badge data-badge="changed">{t('version.fieldChanged', 'Changed')}</Badge> : null}
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div data-before className="bg-muted/50 min-w-0 rounded-md px-2 py-1 break-words">{drawn(row.field, row.before, row.after, 'del')}</div>
                      <div data-after className="bg-muted min-w-0 rounded-md px-2 py-1 break-words">{drawn(row.field, row.after, row.before, 'ins')}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {restoreFailed !== undefined ? (
            <>
              <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
                {t('version.problemRestoringVersion', 'There was a problem restoring this version')}
              </p>
              {restoreFailedKey ? (
                <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
                  {t(restoreFailedKey, restoreFailedKey)}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {restores && labelOf(version, versions) !== 'currentlyPublished' ? (
          // Not offered for the version the row already holds, where a restore would add a version and an
          // activity line and change nothing. Sticky at the popup's foot, so Restore stays in reach however long the diff is.
          <SheetFooter className="bg-inherit sticky bottom-0 flex-row flex-wrap justify-end border-t">
            {'_status' in version.version && version.version._status !== 'draft' ? (
              <Button type="button" variant="outline" className="max-sm:h-11" data-button="restore-as-draft" disabled={restoring} onClick={() => setConfirming({ draft: true })}>
                {t('version.restoreAsDraft', 'Restore as draft')}
              </Button>
            ) : null}
            <Button type="button" className="max-sm:h-11" data-button="restore" disabled={restoring} onClick={() => setConfirming({ draft: false })}>
              {t('version.restoreThisVersion', 'Restore this version')}
            </Button>
          </SheetFooter>
        ) : null}
        <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(undefined)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('version.confirmVersionRestoration', 'Confirm version restoration')}</AlertDialogTitle>
              <AlertDialogDescription>
                {(t('version.aboutToRestore', 'You are about to restore this {label} to the state it was in on {versionDate}.') ?? '')
                  .replace('{label}', titleOf({ kayan, copy }))
                  .replace('{versionDate}', when(version.updatedAt))}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="max-sm:[&_button]:h-11">
              <AlertDialogCancel>{t('admin.cancel', 'Cancel')}</AlertDialogCancel>
              <AlertDialogAction data-button="confirm-restore" disabled={restoring} onClick={() => confirming && void restore(confirming.draft)}>
                {confirming?.draft ? t('version.restoreAsDraft', 'Restore as draft') : t('version.restore', 'Restore')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* The registry's close, named in the page's language, in place of the
            primitive's English one. */}
        <CloseButton Close={SheetClose} label={t('admin.close', 'Close') ?? 'Close'} />
      </SheetContent>
    </Sheet>
  )
}
