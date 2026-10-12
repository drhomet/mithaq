import type { ReactElement } from 'react'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import { Checkbox } from '@/components/ui/checkbox'
import { checkboxSize } from './control-props.ts'
import type { Translate } from './copy.ts'
import { readOnlyField } from './field-values.ts'

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
// mithaq-admin 98077394ab68bdf56d5bf3e255c233120e7a13c1 242266ea6d2ffea64875c36203f02826d5e59effce3df0e79a33f2a841cc5388
