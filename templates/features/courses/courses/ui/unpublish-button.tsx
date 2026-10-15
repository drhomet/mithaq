// The danger zone's Unpublish: one click, behind the page's confirm, sending the
// draft status `unpublish` takes, as Payload's Unpublish does. The course stays
// as it is, read by draft readers alone, until it is published again.
import type { ButtonProps } from 'mithaq/admin'
import { useLocale } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'

export function UnpublishButton({ busy, operation, run }: ButtonProps) {
  const { t } = useLocale()
  return (
    <Button type="button" variant="outline" data-button={operation} disabled={busy} onClick={() => void run({ _status: 'draft' })}>
      {t('courses.operations.unpublish', 'Unpublish')}
    </Button>
  )
}
