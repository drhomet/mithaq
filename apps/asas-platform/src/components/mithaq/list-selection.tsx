import type { ReactElement } from 'react'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import { Checkbox } from '@/components/ui/checkbox'
import { checkboxSize, readOnlyField, type Translate } from './controls.tsx'

/**
 * The list's checkbox size, with the invisible hit layer grown to 44 pixels below `sm`. Only for
 * the list: a checkbox group's options sit 28 pixels apart, so a 44 pixel layer there would tick the option above.
 */
export const selectBox = `${checkboxSize} after:-inset-x-3.5 max-sm:after:-inset-y-3.5`

/** Which fields a bulk update may offer: the ones a person could edit on a row of this kayan. Chrome only: the runner refuses whatever the list draws. */
export const writableFields = (
  kayan: ClientKayan,
  writes?: (field: string) => boolean,
): readonly ClientField[] =>
  kayan.fields.filter(
    (field) =>
      !readOnlyField(field, 'update')
      && (writes ? writes(field.name) : true),
  )

/** The head checkbox of the selection column; reports `aria-checked="mixed"` while some of the page is ticked. */
export function SelectAll({
  ids,
  selected,
  onSelect,
  t,
}: {
  ids: readonly string[]
  selected: ReadonlySet<string>
  onSelect: (ids: ReadonlySet<string>) => void
  t: Translate
}): ReactElement {
  const ticked = ids.filter((one) => selected.has(one)).length
  const all = ids.length > 0 && ticked === ids.length
  return (
    <Checkbox
      className={selectBox}
      checked={all}
      aria-checked={ticked > 0 && !all ? 'mixed' : all}
      aria-label={t('admin.selectAll', 'Select every row on this page') ?? 'Select every row on this page'}
      onCheckedChange={(checked: boolean | 'indeterminate') => onSelect(checked === true ? new Set(ids) : new Set())}
    />
  )
}

/** One row's checkbox. */
export function SelectRow({
  id,
  selected,
  onSelect,
  t,
}: {
  id: string
  selected: ReadonlySet<string>
  onSelect: (ids: ReadonlySet<string>) => void
  t: Translate
}): ReactElement {
  return (
    <Checkbox
      className={selectBox}
      checked={selected.has(id)}
      aria-label={t('admin.selectRow', 'Select this row') ?? 'Select this row'}
      onCheckedChange={(checked: boolean | 'indeterminate') => {
        const next = new Set(selected)
        if (checked === true) next.add(id)
        else next.delete(id)
        onSelect(next)
      }}
    />
  )
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 576cedc3611379cc2dcbda75ac13cbf42a5f1d6fbdd43ed6e56fd9d621f3e821
