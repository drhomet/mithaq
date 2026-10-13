import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import type { ClientKayan } from 'mithaq/admin'
import { seedOf } from './field-values.ts'
import type { DraftStatus, FormProps } from './form-types.tsx'

/** What a form was seeded from: the row the host handed, the values it opened with, what the server holds, the draft status and the instant the row stands at. */
export type Seed = {
  row: FormProps['value']
  values: Record<string, unknown>
  saved: Record<string, unknown>
  status?: DraftStatus
  updatedAt: unknown
}

/** What a write seeds the form with: the values it wrote, and the status and instant the row now stands at where they moved. */
export type Seeding = { values: Record<string, unknown>; status?: DraftStatus; updatedAt?: unknown }

/**
 * The form's values in TanStack Form, seeded from the row the host handed and seeded again when it hands another,
 * with the focused box put back, and whether they hold a change, which guards the tab and tells the host.
 */
export const useFormSeed = ({ kayan, onDirty, status: opened, value }: {
  kayan: ClientKayan
  value: FormProps['value']
  /** The draft status the host read the row at. */
  status?: DraftStatus
  onDirty?: (dirty: boolean) => void
}) => {
  // The seed is held in state, not read off `value`: a save makes what it wrote the seed before the host
  // reads the row again. `saved` is what the server holds, kept apart because an autosave leaves the seed alone.
  const seeded = ({ values, status = opened, updatedAt = value?.updatedAt }: Seeding): Seed => ({ row: value, values, saved: values, status, updatedAt })
  const [seed, setSeed] = useState(() => seeded({ values: seedOf(kayan.fields, value) }))
  // The focused box and its caret when the host handed another row, put back once the new page has
  // drawn it: an autosaved create moves to an edit page whose tree is new.
  const focused = useRef<{ id: string; start: number | null; end: number | null }>(undefined)
  if (seed.row !== value) {
    const box = typeof document === 'undefined' ? null : (document.activeElement as HTMLInputElement | null)
    focused.current = box?.id ? { id: box.id, start: box.selectionStart ?? null, end: box.selectionEnd ?? null } : undefined
    setSeed(seeded({ values: seedOf(kayan.fields, value) }))
  }
  useLayoutEffect(() => {
    const was = focused.current
    focused.current = undefined
    if (!was || document.activeElement?.id === was.id) return
    const box = document.getElementById(was.id) as HTMLInputElement | null
    box?.focus()
    if (was.start !== null) box?.setSelectionRange(was.start, was.end)
  }, [seed])
  const form = useForm({ defaultValues: seed.values })
  const values = useStore(form.store, (state) => state.values as Record<string, unknown>)

  // TanStack's per-field `isDefaultValue` over the whole form, so a value typed back to its seed is no change.
  const dirty = useStore(form.store, (state) => !state.isDefaultValue)

  // Guards a half-written row against a closed tab or a typed URL. The browser shows its own sentence;
  // cleared on unmount so a form left behind does not hold the guard for the next screen.
  useEffect(() => {
    window.onbeforeunload = dirty ? () => '' : null
    return () => {
      window.onbeforeunload = null
    }
  }, [dirty])

  // The same fact to the host, for navigations the browser's guard cannot see; cleared on unmount so a
  // form left behind does not hold the host's blocker.
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])

  return { seed, setSeed, seeded, form, values, dirty }
}
