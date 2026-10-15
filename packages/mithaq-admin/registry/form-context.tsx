import { createContext, useContext } from 'react'
import { useField, useStore, type AnyFormApi } from '@tanstack/react-form'
import type { ClientKayan } from 'mithaq/admin'

/** The form a bound field reads and writes, which `Form` provides around its whole screen. */
export const KayanForm = createContext<
  | {
      form: AnyFormApi
      issues: Readonly<Record<string, string>>
      locales: Readonly<Record<string, readonly string[]>>
      writes?: (field: string, on: 'create' | 'update') => boolean
      on: 'create' | 'update'
      check: (name: string, value: unknown) => string | undefined
      forget: (name: string) => void
      /** Opens a drawer that makes a row of `target` over this form, handing the row it made to `made`; only on a screen. */
      add?: (target: ClientKayan, made: (row: Record<string, unknown>) => void) => void
    }
  | undefined
>(undefined)

export const useValues = <Values extends object = Record<string, unknown>>(): Values => {
  const held = useContext(KayanForm)
  if (!held) throw new Error('useValues is called inside the form this registry draws, and nowhere else')
  return useStore(held.form.store, (state) => state.values as Values)
}

type KayanField = {
  value: unknown
  onChange: (value: unknown) => void
  onBlur: () => void
  /** Whether this field is the client's to write on this operation, off the access report. */
  writable: boolean
  /** Whether a person has left this box, or the server has refused it. */
  touched: boolean
  /** This field's refusal, in the words a person reads, or nothing. */
  error?: string
  /** The locales of a localized field the server's refusal named, whose boxes alone are marked. */
  locales?: readonly string[]
}
/**
 * One field's value, change, blur, write access and error, read from the form this field is inside.
 * The error shows once the box is left or the server has refused it, and falls back to the form's
 * refusal record because a remount or a server render has no error map.
 */
export function useKayanField<Values extends object, Name extends keyof Values & string>(name: Name): Omit<KayanField, 'value'> & { value: Values[Name] }
export function useKayanField(name: string): KayanField
export function useKayanField(name: string): KayanField {
  const held = useContext(KayanForm)
  if (!held) throw new Error('useKayanField is called inside the form this registry draws, and nowhere else')
  const { check, forget, form, issues, locales, on, writes } = held
  const field = useField({
    form,
    name,
    // Validated on blur, then on every change; a change also drops the refusal a save left on this box.
    validators: { onBlur: ({ value }) => check(name, value) },
    listeners: {
      onChange: ({ fieldApi }) => {
        forget(name)
        if (fieldApi.state.meta.isBlurred) fieldApi.validate('blur')
      },
    },
  })
  const meta = field.state.meta
  const refused = (meta.errorMap.onServer as string | undefined) ?? issues[name]
  const touched = meta.isTouched || refused !== undefined
  const invalid = !meta.isValid || refused !== undefined
  const first = meta.errors.find((one) => one !== undefined && one !== null)
  return {
    value: field.state.value,
    onChange: (next: unknown) => field.handleChange(next),
    onBlur: field.handleBlur,
    writable: writes ? writes(name, on) : true,
    touched,
    error: touched && invalid ? (refused ?? (typeof first === 'string' ? first : undefined)) : undefined,
    locales: locales[name],
  }
}
