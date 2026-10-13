import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ariaRequired, changeOf, checkboxSize, comboboxPhone, type ControlProps } from 'mithaq-admin/control-props.ts'

export function SelectControl(props: ControlProps): ReactElement {
  const options = props.field.options ?? []
  return <Select value={typeof props.value === 'string' ? props.value : null} onValueChange={changeOf(props)} disabled={props.readOnly}>
    <SelectTrigger id={props.id} className="w-full max-sm:data-[size=default]:h-11" aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)}><SelectValue>{options.find((one) => one.value === props.value)?.label[props.locale ?? ''] ?? props.placeholder ?? ''}</SelectValue></SelectTrigger>
    <SelectContent>{options.map((one) => <SelectItem key={one.value} value={one.value}>{one.label[props.locale ?? ''] ?? one.value}</SelectItem>)}</SelectContent>
  </Select>
}

export function ComboboxControl(props: ControlProps): ReactElement {
  const options = props.field.options ?? []
  const label = (value: string) => options.find((one) => one.value === value)?.label[props.locale ?? ''] ?? value
  return <Combobox items={options.map((one) => one.value)} value={typeof props.value === 'string' ? props.value : null} onValueChange={changeOf(props)} itemToStringLabel={label} disabled={props.readOnly}>
    <ComboboxInput id={props.id} className={comboboxPhone} placeholder={props.placeholder} clearLabel={props.t('admin.clear', 'Clear')} triggerLabel={props.t('admin.open', 'Open')} aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)} />
    <ComboboxContent><ComboboxList>{options.map((one) => <ComboboxItem key={one.value} value={one.value}>{label(one.value)}</ComboboxItem>)}</ComboboxList></ComboboxContent>
  </Combobox>
}

export function ToggleGroupControl(props: ControlProps): ReactElement {
  return <ToggleGroup value={typeof props.value === 'string' ? [props.value] : []} onValueChange={(next) => changeOf(props)(next[0] ?? null)} disabled={props.readOnly} aria-describedby={props.describedBy} className="flex gap-1">
    {props.field.options?.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label[props.locale ?? ''] ?? option.value}</ToggleGroupItem>)}
  </ToggleGroup>
}

export function RadioControl(props: ControlProps): ReactElement {
  return <RadioGroup name={props.field.name} value={typeof props.value === 'string' ? props.value : ''} onValueChange={changeOf(props)} disabled={props.readOnly} aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)} className="grid gap-2">
    {props.field.options?.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm">
      <RadioGroupItem value={option.value} />{option.label[props.locale ?? ''] ?? option.value}
    </label>)}
  </RadioGroup>
}

export function ButtonGroupControl(props: ControlProps): ReactElement {
  return <ButtonGroup aria-describedby={props.describedBy}>
    {props.field.options?.map((option) => <Button key={option.value} type="button" variant={props.value === option.value ? 'default' : 'outline'} aria-pressed={props.value === option.value} disabled={props.readOnly} onClick={() => changeOf(props)(option.value)}>
      {option.label[props.locale ?? ''] ?? option.value}
    </Button>)}
  </ButtonGroup>
}

export function CheckboxGroupControl(props: ControlProps): ReactElement {
  const options = props.field.options ?? []
  const held = new Set(Array.isArray(props.value) ? props.value.map(String) : [])
  const change = changeOf(props)
  return <div role="group" id={props.id} aria-describedby={props.describedBy} className="grid gap-2">
    {options.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm">
      <Checkbox className={checkboxSize} checked={held.has(option.value)} disabled={props.readOnly} onCheckedChange={(on) => {
        const next = options.map((one) => one.value).filter((value) => (value === option.value ? on === true : held.has(value)))
        change(next.length ? next : null)
      }} />
      {option.label[props.locale ?? ''] ?? option.value}
    </label>)}
  </div>
}
