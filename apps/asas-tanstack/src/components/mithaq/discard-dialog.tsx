import type { ReactElement } from 'react'
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
import type { Translate } from './copy.ts'

/**
 * The question asked before an unsaved edit is thrown away, used by the form's Cancel and by a
 * navigation the host's router blocked. It stays mounted with the form, so an autosave landing while
 * it asks cannot unmount it.
 */
export function DiscardDialog({
  busy,
  note,
  onDiscard,
  onOpenChange,
  open,
  t,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  /** What discarding means, which is leaving: the Cancel's navigation, or the one the router blocked. */
  onDiscard: () => void
  /** A sentence after the question, such as that a draft already saved is kept. */
  note?: string
  busy?: boolean
  t: Translate
}): ReactElement {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.discard', 'Discard changes') ?? 'Discard changes'}</AlertDialogTitle>
          <AlertDialogDescription>
            {[t('admin.discardWarning', 'You have unsaved changes. Leave without saving?') ?? 'You have unsaved changes. Leave without saving?', note].filter(Boolean).join(' ')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="max-sm:[&_button]:h-11">
          <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onDiscard}>
            {t('admin.discard', 'Discard changes') ?? 'Discard changes'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
// mithaq-admin 7fc64834f9ec8682c4c34f35d23a21736cf89a50 d261055709a335a002cc3dd55e654d1ab253565f296396030b75707b7480551b
