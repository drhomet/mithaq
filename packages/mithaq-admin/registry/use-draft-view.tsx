import { useState } from 'react'
import type { ClientKayan } from 'mithaq/admin'
import { seedOf } from './field-values.ts'
import type { DraftStatus, FormClient } from './form-types.tsx'

/**
 * Which copy a changed row shows: the draft, or the published copy, read once when first chosen and drawn
 * read-only with no save or autosave.
 */
export const useDraftView = ({ client, id, kayan, refuse, status, values }: {
  client: FormClient
  id: string
  kayan: ClientKayan
  /** Where a failed read of the published copy lands. */
  refuse: (thrown: unknown) => void
  status?: DraftStatus
  /** What the form holds, shown while the draft is. */
  values: Record<string, unknown>
}) => {
  const [view, setView] = useState<'draft' | 'published'>('draft')
  const [published, setPublished] = useState<Record<string, unknown> | null>()
  const viewing = status === 'changed' && view === 'published' && !!published
  const showing = viewing ? seedOf(kayan.fields, published) : values
  const choose = async (next: string) => {
    if (next === 'published' && published === undefined) {
      try {
        setPublished((await client.findByID!({ id })) as Record<string, unknown> | null)
      } catch (thrown) {
        return refuse(thrown)
      }
    }
    setView(next === 'published' ? 'published' : 'draft')
  }
  // A write may change the published copy, which View published reads again.
  const forget = () => {
    setPublished(undefined)
    setView('draft')
  }
  return { viewing, showing, choose, forget }
}
