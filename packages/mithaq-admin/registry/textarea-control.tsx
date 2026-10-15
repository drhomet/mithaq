import { useState, type ReactElement } from 'react'
import { same } from 'mithaq/admin'
import { Textarea } from '@/components/ui/textarea'
import { ariaRequired, changeOf, cleared, type ControlProps } from 'mithaq-admin/control-props.ts'
import { asText } from 'mithaq-admin/format.tsx'

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

const unparsable = Symbol('unparsable')
const parsed = (text: string): unknown => {
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return unparsable
  }
}
const jsonText = (value: unknown) => (value === undefined || value === null || typeof value === 'symbol' ? '' : JSON.stringify(value, null, 2))

/**
 * A json field's box: the value as JSON text, left to right in any page. Text that is no JSON is reported as a
 * symbol, which no JSON holds, so the form refuses to save it and a draft's `JSON.stringify` sends no key, where
 * a string would be saved as one and a function would be read by the form as an updater.
 */
export function JsonControl(props: ControlProps): ReactElement {
  const { describedBy, error, field, id, placeholder, readOnly, value } = props
  const change = changeOf(props)
  const [text, setText] = useState(() => jsonText(value))
  // A value from outside, a seed or a reset, replaces the text; one this box reported keeps the text as typed.
  if (value !== unparsable && !same(parsed(text), value)) setText(jsonText(value))
  return (
    <Textarea
      id={id}
      name={field.name}
      rows={8}
      dir="ltr"
      spellCheck={false}
      autoCapitalize="off"
      className="font-mono text-xs"
      value={text}
      onChange={(event) => {
        const typed = event.target.value
        setText(typed)
        change(parsed(typed))
      }}
      disabled={readOnly}
      readOnly={readOnly}
      placeholder={placeholder}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={ariaRequired(field)}
    />
  )
}
