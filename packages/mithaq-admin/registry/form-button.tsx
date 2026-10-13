import type { ReactElement } from 'react'
import type { ClientKayan } from 'mithaq/admin'
import type { FindApi } from 'mithaq-admin/control-props.ts'
import { operationLabelFor, type Copy } from 'mithaq-admin/copy.ts'
import { DeleteButton } from 'mithaq-admin/delete-button.tsx'
import { NodeButton, OwnButton, type PageButton } from 'mithaq-admin/node-buttons.tsx'
import { rowWarning } from 'mithaq-admin/row-title.tsx'
import { refOf, type ScreenPage } from 'mithaq-admin/screen-refs.ts'
import { OperationButton } from 'mithaq-admin/operation-button.tsx'

export type FormButtonProps = {
  operation: PageButton
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  api?: FindApi
  copy: Copy
  screen?: ScreenPage
  busy: boolean
  /** The row the button runs on, which its dialog names. */
  value?: Record<string, unknown> | null
  id: string
  /** Runs the operation through the form's own writer, handing a refusal to `refuse`, and answers whether it landed. */
  run: (input: Record<string, unknown>, refuse: (thrown: unknown) => void) => Promise<boolean>
  /** Where a refusal of a button that opens no dialog lands. */
  refuse: (thrown: unknown) => void
  /** Runs the row's delete, as `run` does. */
  onDelete: (refuse: (thrown: unknown) => void) => Promise<boolean>
}

/** A page's button on a row's form: the project's own component, the two-step delete, a confirm, or the dialog that asks its values. */
export function FormButton({ api, busy, copy, id, kayan, kayans, onDelete, operation, refuse, run, screen, value }: FormButtonProps): ReactElement {
  const Ref = refOf({ screen, place: 'button', path: operation.component })
  if (Ref && screen) {
    return (
      <OwnButton
        Own={Ref}
        operation={operation}
        busy={busy}
        copy={copy}
        call={async (input) => {
          await run({ ...input, id }, refuse)
        }}
      />
    )
  }
  // A delete is the one write nothing brings back, so its button is always the two-step dialog, whatever the node carries.
  if (operation.effect === 'delete') {
    return <DeleteButton busy={busy} copy={copy} kayan={kayan} label={operationLabelFor({ kayan, operation, copy })} row={value ?? undefined} onDelete={onDelete} />
  }
  // A button that asks for no values and carries a confirm asks it in the app's own dialog; any other opens the
  // registry's dialog, which asks the confirm in its heading. Each names the row it runs on.
  const description = value ? rowWarning({ kayan, row: value, operation: operation.name, copy }) : undefined
  if (operation.confirm && !operation.fields?.length) {
    return <NodeButton node={operation} copy={copy} busy={busy} description={description} run={() => void run({ id }, refuse)} />
  }
  return (
    <OperationButton
      api={api}
      busy={busy}
      copy={copy}
      description={description}
      inputOf={(values) => ({ id, ...values })}
      kayan={kayan}
      kayans={kayans}
      operation={operation}
      run={run}
    />
  )
}
