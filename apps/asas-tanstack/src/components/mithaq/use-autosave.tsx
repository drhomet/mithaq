import { useEffect, useRef, useState, type RefObject } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'
import type { ClientField } from 'mithaq/admin'
import { valuesOf } from './field-values.ts'
import { afterDraft, type FormClient } from './form-types.tsx'
import type { Seed, Seeding } from './use-form-seed.tsx'

export type AutosaveInput = {
  /** The stillness in ms after which a draft is saved, or nothing while no autosave may run. */
  interval?: number
  /** Whether a save is out, which holds the autosave. */
  busy: boolean
  client: FormClient
  id: string
  form: AnyFormApi
  values: Record<string, unknown>
  seed: Seed
  setSeed: (seed: Seed | ((held: Seed) => Seed)) => void
  seeded: (seeding: Seeding) => Seed
  /** The fields a write sends, those of them that changed, and whether the server owns one. */
  writable: () => ClientField[]
  changed: (field: ClientField) => boolean
  owned: (field: ClientField) => boolean
  /** The `expectedUpdatedAt` an update sends, where the kayan's update takes it. */
  readAt: () => Record<string, unknown>
  /** The values a save was last refused over, which no autosave sends again. */
  refusedOver: RefObject<string | undefined>
  refuse: (thrown: unknown) => void
  /** Saves landed since mount, which restarts the word that one landed. */
  saves: number
  noteSave: () => void
  /** The host learns of the row a create's autosave made, as it would of a save. */
  onMade: (id: string) => void
  onDone: (row: unknown, effect?: string) => void
}

/**
 * Autosaves a draft of what differs once the form has stayed still for the interval, and answers what the
 * autosave is doing: saving, saved for two seconds, or nothing.
 */
export const useAutosave = ({ busy, changed, client, form, id, interval, noteSave, onDone, onMade, owned, readAt, refuse, refusedOver, saves, seed, seeded, setSeed, values, writable }: AutosaveInput) => {
  const [autosaved, setAutosaved] = useState<'saving' | 'saved'>()
  /** Whether the form is still on screen, which an autosave that lands late asks before it moves the host. */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const json = JSON.stringify(values)
  useEffect(() => {
    if (!interval || busy || autosaved === 'saving' || refusedOver.current === json) return
    const fields = writable()
    if (!fields.some((field) => JSON.stringify(values[field.name]) !== JSON.stringify(seed.saved[field.name]))) return
    const timer = setTimeout(() => {
      const sent = valuesOf({ fields: fields.filter((field) => !id || changed(field)), values, owned })
      setAutosaved('saving')
      const words = { draft: true, autosave: true }
      ;(id ? client.update({ ...sent, ...readAt(), id }, words) : client.create(sent, words)).then(
        (written) => {
          setAutosaved('saved')
          // A refusal a save drew earlier is over: the row just saved fine, so a banner naming no field
          // would sit there with nothing left to say.
          refuse(undefined)
          refusedOver.current = undefined
          noteSave()
          // The instant the draft now stands at, which the next write sends.
          const updatedAt = (written as { updatedAt?: unknown } | null)?.updatedAt ?? seed.updatedAt
          if (JSON.stringify(form.state.values) === json) {
            form.reset(values)
            setSeed(seeded({ values, status: afterDraft(seed.status), updatedAt }))
          } else {
            setSeed((held) => ({ ...held, saved: { ...held.saved, ...sent }, status: afterDraft(held.status), updatedAt }))
          }
          const row = (written as { id?: unknown } | null)?.id
          if (!id && row !== undefined && alive.current) {
            onMade(String(row))
            onDone(written, 'create')
          }
        },
        (thrown: unknown) => {
          refusedOver.current = json
          setAutosaved(undefined)
          refuse(thrown)
        },
      )
    }, interval)
    return () => clearTimeout(timer)
  }, [interval, busy, autosaved, json, seed, id])
  useEffect(() => {
    if (autosaved !== 'saved') return
    const timer = setTimeout(() => setAutosaved(undefined), 2000)
    return () => clearTimeout(timer)
  }, [autosaved, saves])
  return autosaved
}
// mithaq-admin f355602d9b433b5ced670b49042fa08f689458b7 de8a440736e92869f28f5ad8f62a2fc1bd2af0573e0105360b5a06f48c5517c6
