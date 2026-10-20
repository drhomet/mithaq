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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { Translate } from 'mithaq-admin/copy.ts'

/**
 * What a changed row says above its form: that the published copy is read only, or that a draft is being edited,
 * with a link to the published copy and the restore that throws the draft away.
 */
export function DraftBanner({
  busy,
  onRestore,
  onViewPublished,
  t,
  viewing,
}: {
  /** Whether a write or an autosave is out, which holds the restore. */
  busy: boolean
  /** Restores the published copy, where the actor may. */
  onRestore?: () => void
  /** Shows the published copy, where the host can read it. */
  onViewPublished?: () => void
  t: Translate
  viewing: boolean
}): ReactElement {
  return viewing ? (
    <p data-draft-banner="published" className="bg-muted text-muted-foreground rounded-md border px-3 py-1.5 text-sm">
      {t('version.readOnlyPublished', 'Read only. This is the published version.')}
    </p>
  ) : (
    <div data-draft-banner="draft" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-900 dark:text-amber-200">
      <span className="me-auto">{t('version.editingDraft', 'You are editing a draft. The published version is different.')}</span>
      {onViewPublished ? (
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onViewPublished}>
          {t('version.viewPublished', 'View published')}
        </Button>
      ) : null}
      {/* Restores the row's own published copy, which needs both keys a restore needs. */}
      {onRestore ? (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button type="button" variant="link" size="sm" className="text-destructive h-auto min-h-11 p-0 sm:min-h-0" disabled={busy}>
                {t('admin.discard', 'Discard changes')}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('version.confirmRevertToSaved', 'Confirm revert to saved')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('version.aboutToRevertToPublished', 'You are about to revert this document\'s changes to its published state. Are you sure?')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="[&_button]:min-h-11 sm:[&_button]:min-h-0">
              <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" data-button="confirm-discard-draft" disabled={busy} onClick={onRestore}>
                {t('admin.discard', 'Discard changes')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
