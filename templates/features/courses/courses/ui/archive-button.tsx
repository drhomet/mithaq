// The portal's own button for `archive`, drawn in the edit page's danger zone
// as the registry draws its buttons: one click, behind the page's confirm,
// with the reason written for the viewer in the viewer's locale, where the
// dashboard asks for one in a dialog.
import type { ButtonProps } from 'mithaq/admin'
import { useLocale, useRecord, useUser } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'

export function ArchiveButton({ busy, operation, run }: ButtonProps) {
  const { t } = useLocale()
  const record = useRecord()
  const user = useUser()
  return (
    <Button
      type="button"
      variant="outline"
      data-archive-button={operation}
      data-row={String(record?.id ?? '')}
      disabled={busy || !record}
      onClick={() => void run({ reason: t('courses.operations.archive.portalReason', 'Archived from the portal by {name}')!.replace('{name}', () => user.name) })}
    >
      {t('courses.operations.archive', 'Archive')}
    </Button>
  )
}
