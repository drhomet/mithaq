import type { ReactElement } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { ariaRequired, changeOf, checkboxSize, labelledBy, type ControlProps } from 'mithaq-admin/control-props.ts'
import { labelFor } from 'mithaq-admin/copy.ts'

export function CheckboxControl(props: ControlProps): ReactElement {
  const { describedBy, field, id, readOnly, value } = props
  const change = changeOf(props)
  // `=== true` because the checked state is `boolean | 'indeterminate'` and only a boolean is a value this column takes.
  return (
    <Checkbox
      id={id}
      name={field.name}
      checked={value === true}
      onCheckedChange={(next) => change(next === true)}
      className={checkboxSize}
      disabled={readOnly}
      aria-labelledby={labelledBy(props)}
      aria-describedby={describedBy}
      aria-required={ariaRequired(field)}
    />
  )
}

export function SwitchControl(props: ControlProps): ReactElement {
  return <Switch id={props.id} name={props.field.name} checked={props.value === true} onCheckedChange={changeOf(props)} disabled={props.readOnly} aria-labelledby={labelledBy(props)} aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)} />
}

export function ToggleControl(props: ControlProps): ReactElement {
  return <Toggle className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" id={props.id} variant="outline" pressed={props.value === true} onPressedChange={(pressed) => changeOf(props)(pressed)} disabled={props.readOnly} aria-describedby={props.describedBy}>
    {labelFor({ kayan: props.kayan, field: props.field, copy: { t: props.t, locale: props.locale ?? '' } })}
  </Toggle>
}
