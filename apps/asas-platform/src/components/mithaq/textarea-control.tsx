import type { ReactElement } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { ariaRequired, changeOf, cleared, type ControlProps } from './control-props.ts'
import { asText } from './format.tsx'

export function TextareaControl(props: ControlProps): ReactElement {
  const { describedBy, error, field, id, placeholder, readOnly, value } = props
  const change = changeOf(props)
  return <Textarea id={id} name={field.name} rows={4} dir="auto" value={asText(value)} onChange={(event) => change(cleared(event.target.value))} disabled={readOnly} readOnly={readOnly} placeholder={placeholder} aria-describedby={describedBy} aria-invalid={error ? true : undefined} aria-required={ariaRequired(field)} />
}

export function TextArrayControl(props: ControlProps): ReactElement {
  const { describedBy, error, field, id, placeholder, readOnly, value } = props
  const change = changeOf(props)
  return (
    <Textarea
      id={id}
      name={field.name}
      rows={3}
      placeholder={placeholder}
      dir="auto"
      value={Array.isArray(value) ? value.map(asText).join('\n') : asText(value)}
      onChange={(event) => {
        const lines = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean)
        change(lines.length ? lines : null)
      }}
      disabled={readOnly}
      readOnly={readOnly}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={ariaRequired(field)}
    />
  )
}
// mithaq-admin 98077394ab68bdf56d5bf3e255c233120e7a13c1 a397b73f0b0768e7a3147cbef47c5d6160dcb00c3c3523104db5ad1b42791ea3
