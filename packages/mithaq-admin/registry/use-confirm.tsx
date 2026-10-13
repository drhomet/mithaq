import { useState } from 'react'
import type { ButtonClient } from 'mithaq/admin'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { Copy } from 'mithaq-admin/copy.ts'

/**
 * A button's `confirm`, asked in the app's own alert dialog in the page's locale rather than the
 * browser's. `ask` answers whether the person said yes, at once for a button that carries no
 * confirm, and `dialog` is the question, drawn beside the button that asks it.
 */
export const useConfirm = ({
  confirm,
  confirmLabel,
  description,
  copy: { t, locale },
}: {
  confirm: ButtonClient['confirm']
  confirmLabel: string
  /** What the caller says the button runs on, such as a bulk's count of ticked rows, before the confirm's own body. */
  description?: string
  copy: Copy
}) => {
  const [answer, setAnswer] = useState<(yes: boolean) => void>()
  const settle = (yes: boolean) => {
    answer?.(yes)
    setAnswer(undefined)
  }
  const heading = confirm?.title[locale]
  const body = [description, confirm?.body[locale]].filter(Boolean).join(' ')
  const onConfirm = () => settle(true)
  const onCancel = () => settle(false)
  const ask = () => (confirm ? new Promise<boolean>((resolve) => setAnswer(() => resolve)) : Promise.resolve(true))
  const dialog = confirm ? (
    <AlertDialog open={answer !== undefined} onOpenChange={(open: boolean) => (open ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{heading}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="max-sm:[&_button]:h-11">
          <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction data-button="confirm-operation" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null
  return { ask, dialog }
}
