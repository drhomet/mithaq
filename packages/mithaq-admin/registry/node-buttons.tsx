import type { ReactElement } from 'react'
import type { ButtonClient, ClientField, ClientKayan, Row } from 'mithaq/admin'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Copy } from 'mithaq-admin/copy.ts'
import type { Places } from 'mithaq-admin/screen-refs.ts'
import { useConfirm } from 'mithaq-admin/use-confirm.tsx'

/** One button a page draws where its node sits: the operation, and what the node says about it. */
export type PageButton = ClientKayan['operations'][number] & Pick<ButtonClient, 'label' | 'component' | 'confirm'>

/**
 * The button a node draws for this actor, when the kayan declares its
 * operation and the report allows it by its own name, with the fields its
 * dialog asks for cut to the ones the node names.
 */
export const pageButtonOf = ({
  kayan,
  node,
  allowed,
}: {
  kayan: ClientKayan
  node: ButtonClient
  allowed: Readonly<Record<string, boolean>> | undefined
}): PageButton | undefined => {
  const operation = kayan.operations.find((one) => one.name === node.button)
  if (!operation || allowed?.[operation.name] !== true) return undefined
  const fields = operation.fields?.filter((one) => !node.fields || node.fields.includes(one.name))
  return { ...operation, ...(fields && { fields }), label: node.label, ...(node.component && { component: node.component }), ...(node.confirm && { confirm: node.confirm }) }
}

/**
 * A project's own button component, handed a run that asks the button's
 * confirm first, so no component can run an operation past its question.
 */
export function OwnButton({
  Own,
  busy,
  call,
  copy,
  operation,
}: {
  Own: Places['button']
  busy: boolean
  call: (input: Row) => Promise<void>
  copy: Copy
  operation: Pick<PageButton, 'name' | 'label' | 'confirm'>
}): ReactElement {
  const { ask, dialog } = useConfirm({ confirm: operation.confirm, confirmLabel: operation.label[copy.locale] ?? operation.name, copy })
  return (
    <>
      <Own operation={operation.name} busy={busy} run={async (input: Row) => void ((await ask()) && (await call(input)))} />
      {dialog}
    </>
  )
}

/**
 * A button that runs its operation where its node sits, after its confirm.
 * It is what a node draws when it asks for no values: a form draws a dialog
 * for an operation that does.
 */
export function NodeButton({ node, copy, busy, run, description }: { node: Pick<ButtonClient, 'label' | 'confirm'>; copy: Copy; busy: boolean; run: () => void; description?: string }): ReactElement {
  const label = node.label[copy.locale]
  const { ask, dialog } = useConfirm({ confirm: node.confirm, confirmLabel: label ?? '', description, copy })
  return (
    <>
      <Button type="button" variant="outline" className="max-sm:h-11" disabled={busy} onClick={() => void ask().then((yes) => yes && run())}>
        {label}
      </Button>
      {dialog}
    </>
  )
}

/**
 * A bulk update's box for a yes-or-no field, which has three answers where a checkbox has two: leave
 * each row's value as it is, set it, or clear it. The two values read in the field's own words, and
 * leaving it as it is sends nothing.
 */
export function BulkChoice({
  copy: { t },
  describedBy,
  error,
  field,
  id,
  kayan,
  onChange,
  readOnly,
  value,
}: {
  copy: Copy
  describedBy?: string
  /** A refusal of this box, which marks the trigger invalid as every control marks itself. */
  error?: string
  field: ClientField
  id: string
  kayan: ClientKayan
  onChange: (value: boolean | undefined) => void
  readOnly: boolean
  value: unknown
}): ReactElement {
  const word = (held: boolean) => t(`${kayan.name}.${field.name}.${held}`) ?? (held ? t('admin.yes', 'Yes') : t('admin.no', 'No')) ?? String(held)
  const keep = t('admin.leaveAsIs', 'Leave as is') ?? 'Leave as is'
  const current = typeof value === 'boolean' ? String(value) : 'keep'
  return (
    <Select value={current} onValueChange={(next: string | null) => onChange(next === 'true' ? true : next === 'false' ? false : undefined)} disabled={readOnly}>
      <SelectTrigger id={id} className="w-full" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
        <SelectValue>{current === 'keep' ? keep : word(current === 'true')}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="keep">{keep}</SelectItem>
        <SelectItem value="true">{word(true)}</SelectItem>
        <SelectItem value="false">{word(false)}</SelectItem>
      </SelectContent>
    </Select>
  )
}
