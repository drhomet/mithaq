import type { ReactElement } from 'react'
import { Slider } from '@/components/ui/slider'
import { useComponents } from './components.tsx'
import { changeOf, type ControlProps } from './control-props.ts'
import { labelFor } from './copy.ts'
import { typed } from './text-control.tsx'

// The write shape is `z.number()` with no coercion, so a reported string is a 400. `NaN` is reported as `undefined`,
// which `valuesOf` leaves out of the write, rather than as a value that would clear the column.
export const NumberControl = typed('number', (text) => {
  if (text === '') return null
  const parsed = Number(text)
  return Number.isNaN(parsed) ? undefined : parsed
})

/** Whatever the map draws a number with, so a project that replaces `number` replaces `integer` too. */
export function IntegerControl(props: ControlProps): ReactElement {
  const { number: Number } = useComponents().controls
  return <Number {...props} />
}

const sliderKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

export function SliderControl(props: ControlProps): ReactElement {
  const min = typeof props.field.rules.min === 'number' ? props.field.rules.min : 0
  const max = typeof props.field.rules.max === 'number' ? props.field.rules.max : 100
  // Unset is drawn with no thumb or fill, not as `min`. The slider reports no change for a value it already holds,
  // so the first press or key reports `min` itself, before the slider moves on.
  const held = typeof props.value === 'number'
  const change = changeOf(props)
  const first = held ? undefined : () => change(min)
  return <Slider
    value={held ? props.value as number : min}
    data-empty={held ? undefined : ''}
    className={held ? undefined : '**:data-[slot=slider-range]:opacity-0 **:data-[slot=slider-thumb]:not-has-focus-visible:opacity-0'}
    getAriaValueText={held ? undefined : () => props.t('admin.unset', 'unset') ?? 'unset'}
    onPointerDownCapture={first}
    onKeyDownCapture={first && ((event) => { if (sliderKeys.has(event.key)) first() })}
    min={min}
    max={max}
    onValueChange={change}
    disabled={props.readOnly}
    aria-label={labelFor({ kayan: props.kayan, field: props.field, copy: { t: props.t, locale: props.locale ?? '' } })}
    aria-describedby={props.describedBy}
  />
}
