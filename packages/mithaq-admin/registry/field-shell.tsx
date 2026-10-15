import type { FocusEvent, ReactElement, ReactNode } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'

/** The ids a control points `aria-describedby` at: its description, its error, both, or none. The shell derives the same ids from the same `id`. */
export const describedBy = ({ id, description, error }: { id: string; description?: string; error?: string }): string | undefined =>
  [description ? `${id}-description` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined

export type FieldShellProps = {
  /** The control's own id, which the label points at and the two ids below are derived from. */
  id: string
  label: string
  description?: string
  /** A refusal for this field, already resolved through the project's copy. */
  error?: string
  /** Whether the label goes beside the control rather than above it, as for a checkbox. */
  beside?: boolean
  /** The control, which owns `id` and `aria-describedby`. */
  children: ReactNode
  /** What the declaration asked this field's column to be, as a CSS width. */
  width?: string
  /** The control this field is drawn with, as the page decided it, written on the shell as `data-control`. */
  control?: string
  /** Called when the person leaves this field. React's `onBlur` bubbles, so one handler on the region serves any control. */
  onBlur?: () => void
}

/** The popups a control opens, which a portal draws outside its field: focus moving into one is not leaving the field. */
const popups = '[data-slot=popover-content],[data-slot=select-content],[data-slot=combobox-content],[data-slot=dropdown-menu-content]'

/**
 * Whether focus left the field for good: not to another box of the same field (a moment's day and time), nor into a
 * popup it opened. Focus going nowhere, as a test's or a closed window's, counts as leaving.
 */
const left = (event: FocusEvent<HTMLElement>) => {
  const to = event.relatedTarget
  return !(to instanceof Element) || (!event.currentTarget.contains(to) && !to.closest(popups))
}

export function FieldShell({ beside, children, control, description, error, id, label, onBlur, width }: FieldShellProps): ReactElement {
  const words = (
    <>
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      {/* `FieldError` is a `role="alert"`, so a refusal that appears after a save is announced. */}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </>
  )
  return (
    <Field data-control={control} onBlur={onBlur && ((event) => left(event) && onBlur())} orientation={beside ? 'horizontal' : 'vertical'} style={width ? { width } : undefined}>
      {beside ? (
        <>
          {children}
          {/* 44 pixels tall on a phone: the label is the tap target for a switch or box smaller than that. */}
          <FieldLabel htmlFor={id} id={`${id}-label`} className="max-sm:min-h-11 max-sm:items-center">{label}</FieldLabel>
        </>
      ) : (
        <>
          <FieldLabel htmlFor={id} id={`${id}-label`}>{label}</FieldLabel>
          {children}
        </>
      )}
      {words}
    </Field>
  )
}
