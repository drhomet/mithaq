import type { ReactElement } from 'react'
import type { ClientKayan, Row } from 'mithaq/admin'
import type { FindApi } from './control-props.ts'
import type { Copy } from './copy.ts'
import { DeleteButton } from './delete-button.tsx'
import { rowWarning, type PageButton } from './nodes.tsx'
import { OperationButton } from './operation-button.tsx'

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
// mithaq-admin f355602d9b433b5ced670b49042fa08f689458b7 c522ad11577c311885c4bd11e4af5def60bdf12ad5c39f4fb85fa50efbba6078
