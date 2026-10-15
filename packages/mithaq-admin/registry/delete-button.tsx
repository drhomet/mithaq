import { useState, type ReactElement } from 'react'
import type { ClientKayan, Row } from 'mithaq/admin'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { Copy } from 'mithaq-admin/copy.ts'
import { formatDate, listed } from 'mithaq-admin/format.tsx'
import { rowWarning } from 'mithaq-admin/row-title.tsx'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'

/**
 * The delete, in two clicks. The dialog stays open until the delete lands, so a refusal is said inside it.
 * With `open` handed in, the dialog is controlled and draws no trigger, so a menu can open it.
 */
export function DeleteButton({
  busy,
  copy,
  kayan,
  label,
  onDelete,
  onOpenChange,
  open: given,
  row,
}: {
  busy: boolean
  copy: Copy
  kayan: ClientKayan
  label: string
  /** Runs the delete, handing a refusal to `refuse`, and answers whether it landed, which is what the dialog closes on. */
  onDelete: (refuse: (thrown: unknown) => void) => Promise<boolean>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The row it deletes, which the dialog names. */
  row?: Row
}): ReactElement {
  const { t } = copy
  const [held, setHeld] = useState(false)
  const [refused, setRefused] = useState<unknown>(undefined)
  const setOpen = (next: boolean) => {
    if (!next) setRefused(undefined)
    ;(onOpenChange ?? setHeld)(next)
  }
  return (
    <AlertDialog open={given ?? held} onOpenChange={setOpen}>
      {given === undefined ? (
        <AlertDialogTrigger
          render={
            <Button type="button" variant="destructive" className="max-sm:h-11" data-button="delete" disabled={busy}>
              {label}
            </Button>
          }
        />
      ) : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>
            {[row ? rowWarning({ kayan, row, operation: 'delete', copy }) : undefined, t('admin.deleteWarning', 'This cannot be undone.') ?? 'This cannot be undone.'].filter(Boolean).join(' ')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refused === undefined ? null : (
          <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
            {deleteRefusal({ refused, copy })}
          </p>
        )}
        <AlertDialogFooter className="max-sm:[&_button]:h-11">
          <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setRefused(undefined)
              if (await onDelete(setRefused)) setOpen(false)
            }}
          >
            {t(`${kayan.name}.delete.confirm`) ?? t('admin.deleteConfirm', 'Delete for good') ?? 'Delete for good'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const deleteRefusal = ({ refused, copy }: { refused: unknown; copy: Copy }): string => {
  const { t, locale } = copy
  const key = refusalKeyOf(refused)
  if (!key) return t('admin.deleteFailed', 'Something went wrong, so nothing was deleted. Try again.') ?? 'Something went wrong, so nothing was deleted. Try again.'
  const params = (refused as { data?: { params?: { by?: unknown; uses?: unknown } } }).data?.params
  // Each kayan whose rows still name this one: how many, and the titles of those the viewer reads,
  // a localized one in the viewer's locale.
  if (key === 'error.conflict.referenced' && Array.isArray(params?.uses) && params.uses.length) {
    const said = (params.uses as { by: string; count: number; titles: unknown[]; titleKind?: string }[]).map(({ by, count, titles, titleKind }) => {
      const kind = t(`${by}.${count === 1 ? 'singular' : 'plural'}`, by) ?? by
      // A moment arrives as its ISO string, drawn in the viewer's locale as a cell draws it.
      const named = (title: unknown) => titleKind === 'date' || titleKind === 'datetime'
        ? formatDate({ value: title, locale, day: titleKind === 'date' }) ?? ''
        : String(title !== null && typeof title === 'object' ? (title as Record<string, unknown>)[locale] ?? '' : title)
      const names = titles.map(named).filter(Boolean)
      const rest = count - names.length
      const listedNames = listed([...names, ...(names.length && rest > 0 ? [(t('error.conflict.usedMore', '{count} more') ?? '{count} more').replace('{count}', () => rest.toLocaleString(locale || undefined))] : [])], locale)
      const sentence = names.length ? (t('error.conflict.usedBy', 'Used by {count} {kind}: {titles}.') ?? 'Used by {count} {kind}: {titles}.') : (t('error.conflict.usedByUnnamed', 'Used by {count} {kind}.') ?? 'Used by {count} {kind}.')
      return sentence.replace('{count}', () => count.toLocaleString(locale || undefined)).replace('{kind}', () => kind).replace('{titles}', () => listedNames)
    })
    return [...said, t('error.conflict.usedHint', 'Take it out of them first.') ?? 'Take it out of them first.'].join(' ')
  }
  if (key === 'error.conflict.referenced' && typeof params?.by === 'string') {
    const kind = t(`${params.by}.plural`, params.by) ?? params.by
    return (t('error.conflict.referencedBy', '{kind} still use this, so it is not deleted.') ?? '{kind} still use this, so it is not deleted.').replace('{kind}', () => kind)
  }
  return t(key, key) ?? key
}
