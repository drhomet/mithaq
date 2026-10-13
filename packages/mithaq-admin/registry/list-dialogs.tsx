import type { ReactElement } from 'react'
import type { ClientKayan, Row } from 'mithaq/admin'
import type { FindApi } from 'mithaq-admin/control-props.ts'
import type { Copy } from 'mithaq-admin/copy.ts'
import { DeleteButton } from 'mithaq-admin/delete-button.tsx'
import type { PageButton } from 'mithaq-admin/node-buttons.tsx'
import { rowWarning } from 'mithaq-admin/row-title.tsx'
import { OperationButton } from 'mithaq-admin/operation-button.tsx'

/**
 * The delete and the operation dialog a row's menu opens. They are drawn once below the table rather than inside
 * the menu, which closes as its item is pressed and would take a dialog inside it along.
 */
export function RowDialogs({ api, asking, copy, deleting, deletes, kayan, kayans, onAsked, onDeleted, run, running }: {
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  api?: FindApi
  copy: Copy
  /** Whether a run is out, which holds both. */
  running: boolean
  /** Whether this actor may delete a row, and the row whose delete is being asked. */
  deletes: boolean
  deleting?: Row
  onDeleted: () => void
  /** The row and the operation whose values are being asked. */
  asking?: { row: Row; operation: PageButton }
  onAsked: () => void
  /** Runs one operation on a row, handing a refusal to `refuse`, and answers whether it landed. */
  run: (call: { operation: string; input: Record<string, unknown>; refuse: (thrown: unknown) => void }) => Promise<boolean>
}): ReactElement {
  const { t } = copy
  return (
    <>
      {deletes ? (
        <DeleteButton
          busy={running}
          copy={copy}
          kayan={kayan}
          label={t('admin.delete', 'Delete') ?? 'Delete'}
          open={deleting !== undefined}
          onOpenChange={(open) => (open ? undefined : onDeleted())}
          row={deleting}
          onDelete={(refuse) => run({ operation: 'delete', input: { id: deleting?.id }, refuse })}
        />
      ) : null}
      {asking ? (
        <OperationButton
          api={api}
          busy={running}
          copy={copy}
          description={rowWarning({ kayan, row: asking.row, operation: asking.operation.name, copy })}
          inputOf={(values) => ({ ...values, id: asking.row.id })}
          kayan={kayan}
          kayans={kayans}
          operation={asking.operation}
          open
          onOpenChange={(open) => (open ? undefined : onAsked())}
          run={(input, refuse) => run({ operation: asking.operation.name, input, refuse })}
        />
      ) : null}
    </>
  )
}
