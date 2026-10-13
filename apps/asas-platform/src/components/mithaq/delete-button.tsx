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
import type { Copy, Translate } from './copy.ts'
import { rowWarning } from './row-title.tsx'
import { refusalKeyOf } from './refusal.ts'

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
            {deleteRefusal({ refused, t })}
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

const deleteRefusal = ({ refused, t }: { refused: unknown; t: Translate }): string => {
  const key = refusalKeyOf(refused)
  if (!key) return t('admin.deleteFailed', 'Something went wrong, so nothing was deleted. Try again.') ?? 'Something went wrong, so nothing was deleted. Try again.'
  const by = (refused as { data?: { params?: { by?: unknown } } }).data?.params?.by
  if (key === 'error.conflict.referenced' && typeof by === 'string') {
    const kind = t(`${by}.plural`, by) ?? by
    return (t('error.conflict.referencedBy', '{kind} still use this, so it is not deleted.') ?? '{kind} still use this, so it is not deleted.').replace('{kind}', () => kind)
  }
  return t(key, key) ?? key
}
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 120d06b7bebe9b52459e68a6f2134767db9caa444965e7ab390d2f788e7ab33a
