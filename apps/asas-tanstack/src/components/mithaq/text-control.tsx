import type { ChangeEvent, ReactElement } from 'react'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { ariaRequired, changeOf, cleared, type Control, type ControlProps } from './control-props.ts'
import { asText } from './format.tsx'

const affix = 'bg-muted border-input self-stretch px-3'

export const typed = (type: string, parse: (text: string) => unknown = cleared): Control =>
  function TypedControl(props: ControlProps): ReactElement {
    const { describedBy, error, field, form, id, locale, placeholder, readOnly, value } = props
    const change = changeOf(props)
    const input = {
      id,
      form,
      name: field.name,
      type,
      className: 'max-sm:h-11',
      dir: type === 'text' && field.kind !== 'decimal' ? 'auto' : 'ltr',
      step: field.kind === 'integer' ? '1' : undefined,
      inputMode: field.kind === 'decimal' ? ('decimal' as const) : undefined,
      value: asText(value),
      onChange: (event: ChangeEvent<HTMLInputElement>) => change(parse(event.target.value)),
      disabled: readOnly,
      readOnly,
      placeholder,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      'aria-required': ariaRequired(field),
    }
    const prefix = locale ? field.prefix?.[locale] : undefined
    const suffix = locale ? field.suffix?.[locale] : undefined
    if (prefix === undefined && suffix === undefined) return <Input {...input} />
    return (
      <InputGroup className="max-sm:h-11">
        {prefix !== undefined ? <InputGroupAddon data-affix="prefix" className={`${affix} rounded-s-[inherit] border-e`}><InputGroupText className="text-foreground">{prefix}</InputGroupText></InputGroupAddon> : null}
        <InputGroupInput {...input} />
        {suffix !== undefined ? <InputGroupAddon data-affix="suffix" align="inline-end" className={`${affix} rounded-e-[inherit] border-s`}><InputGroupText className="text-foreground">{suffix}</InputGroupText></InputGroupAddon> : null}
      </InputGroup>
    )
  }

export const TextControl = typed('text')
export const EmailControl = typed('email')
// A text box keeps every digit; a number box reads through a JS double and cannot edit exact money.
export const DecimalControl = typed('text')

export function OtpControl(props: ControlProps): ReactElement {
  const length = typeof props.field.rules.maxLength === 'number' ? props.field.rules.maxLength : 6
  return <InputOTP id={props.id} value={asText(props.value)} onChange={changeOf(props)} maxLength={length} pattern={REGEXP_ONLY_DIGITS} disabled={props.readOnly} aria-describedby={props.describedBy}>
    <InputOTPGroup>{Array.from({ length }, (_, index) => <InputOTPSlot key={index} index={index} />)}</InputOTPGroup>
  </InputOTP>
}

/**
 * A `uuid` is always the store's to make, so this reports no change whatever `readOnly` says.
 */
export function ReadOnlyControl({ describedBy, field, id, value }: ControlProps): ReactElement {
  return (
    <Input
      id={id}
      name={field.name}
      type="text"
      value={asText(value)}
      readOnly
      disabled
      aria-describedby={describedBy}
    />
  )
}
// mithaq-admin 98077394ab68bdf56d5bf3e255c233120e7a13c1 2d15eac6b4e38f68edf245c9ecdaf0882c3a5bb37ba21eddea9937bc4c97b986
