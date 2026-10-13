import { useState, type ReactElement } from 'react'
import type { ClientKayan, Row } from 'mithaq/admin'
import type { FindApi } from './control-props.ts'
import type { Copy } from './copy.ts'
import { NodeButton, OwnButton, type PageButton } from './node-buttons.tsx'
import { refOf, type ScreenPage } from './screen-refs.ts'
import { OperationButton } from './operation-button.tsx'

/** One of the list node's buttons: the project's own component, a plain button, or the dialog that asks its values. */
export function ListButton({
  api,
  client,
  copy,
  description,
  disabled,
  inputOf,
  kayan,
  onRan,
  onRefused,
  operation,
  run,
  screen,
}: {
  api?: FindApi
  client?: readonly ClientKayan[]
  copy: Copy
  description?: string
  disabled?: boolean
  inputOf: (values: Record<string, unknown>) => Record<string, unknown>
  kayan: ClientKayan
  onRan?: (written: unknown) => void
  onRefused: (thrown: unknown) => void
  operation: PageButton
  run: (operation: string, input: Record<string, unknown>) => Promise<unknown>
  screen?: ScreenPage
}): ReactElement {
  const [busy, setBusy] = useState(false)
  const call = async (input: Record<string, unknown>, refuse: (thrown: unknown) => void = onRefused) => {
    // Every path ends here, so a button that ignores `busy` sends nothing too.
    if (disabled) return false
    setBusy(true)
    onRefused(undefined)
    try {
      onRan?.(await run(operation.name, input))
      return true
    } catch (thrown) {
      refuse(thrown)
      return false
    } finally {
      setBusy(false)
    }
  }
  const Own = refOf({ screen, place: 'button', path: operation.component })
  if (Own && screen) {
    return <OwnButton Own={Own} operation={operation} busy={busy || disabled === true} copy={copy} call={async (input: Row) => void (await call(inputOf(input)))} />
  }
  if (!operation.fields?.length) return <NodeButton node={operation} copy={copy} busy={busy || disabled === true} description={description} run={() => void call(inputOf({}))} />
  return (
    <OperationButton
      api={api}
      busy={busy || disabled === true}
      copy={copy}
      description={description}
      inputOf={inputOf}
      kayan={kayan}
      kayans={client}
      operation={operation}
      run={call}
    />
  )
}
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 bff9693ac1e5e1be72a0246bdf2c1cba5d26b471eea6e1d9cb31d569d7a3c8f1
