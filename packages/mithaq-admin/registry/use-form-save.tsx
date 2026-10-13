import { useRef, useState } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import { valuesOf } from './field-values.ts'
import { refusalOf } from './form-rules.tsx'
import { afterDraft, type DraftOptions, type DraftStatus, type FormProps } from './form-types.tsx'
import { leavesOf, type Node } from './nodes.tsx'
import type { Seed, Seeding } from './use-form-seed.tsx'

export type FormSaveInput = Pick<FormProps, 'client' | 'expectedUpdatedAt' | 'expectedUpdatedAtOn' | 'onDone' | 'operations'> & {
  kayan: ClientKayan
  /** The row's id, which is the row this form's own autosave made on a create once it has. */
  id: string
  /** The row this page's autosave made, by its id. */
  made?: string
  form: AnyFormApi
  values: Record<string, unknown>
  seed: Seed
  setSeed: (seed: Seed) => void
  seeded: (seeding: Seeding) => Seed
  /** The page's nodes, whose leaves are what the form writes; none for a form handed no page. */
  tree?: readonly Node[]
  /** Whether the server owns a field on this operation, which leaves it out of every write. */
  owned: (field: ClientField) => boolean
  /** Whether the kayan keeps drafts. */
  drafts: boolean
  status?: DraftStatus
  /** Where a refusal lands by default. */
  refuse: (thrown: unknown) => void
  /** What a landed write drops, such as the published copy read before it. */
  onWritten: () => void
}

/**
 * The form's writes: a save that sends only what changed, every other write the form runs, and the discard that
 * leaves without saving, deleting the untouched draft this page's autosave made.
 */
export const useFormSave = ({
  client,
  drafts,
  expectedUpdatedAt,
  expectedUpdatedAtOn,
  form,
  id,
  kayan,
  made,
  onDone,
  onWritten,
  operations,
  owned,
  refuse: setRefused,
  seed,
  seeded,
  setSeed,
  status,
  tree,
  values,
}: FormSaveInput) => {
  const [busy, setBusy] = useState(false)
  // Saves landed since mount (plain, draft, publish, autosave), for panels that keep their own history
  // of the row; a draft save never moves `record.updatedAt`.
  const [saves, setSaves] = useState(0)
  // When the last save landed, shown as the row's last update ahead of its own `updatedAt`.
  const [savedAt, setSavedAt] = useState<Date>()
  const noteSave = () => {
    setSaves((already) => already + 1)
    setSavedAt(new Date())
  }
  // Every field `setValue` changed, which a save counts as named.
  const named = useRef(new Set<string>())
  /** The values a save was last refused over, which the autosave never sends again. */
  const refusedOver = useRef<string | undefined>(undefined)
  /** The instant this form last read or wrote the row at, for a write whose operation takes it. */
  const readAt = (takes?: boolean) => (takes && seed.updatedAt !== undefined ? { expectedUpdatedAt: seed.updatedAt } : {})
  /** Whether a write of the person's own has landed here, which makes a row this page's autosave made theirs. */
  const kept = useRef(false)
  // `refuse` is where a refusal lands: the form's own box by default, or an operation dialog's boxes, which
  // stays open to hold them. Answers whether the write landed.
  const run = async (write: () => Promise<unknown>, effect?: string, refuse: (thrown: unknown) => void = setRefused, next?: DraftStatus): Promise<boolean> => {
    setRefused(undefined)
    setBusy(true)
    try {
      const written = await write()
      kept.current = true
      // What was just written is what the form now holds, so it holds no change: Save goes disabled and
      // the unload guard comes down.
      form.reset(values)
      // The instant the row now stands at, which the next update sends.
      setSeed(seeded({ values, status: next ?? seed.status, updatedAt: (written as { updatedAt?: unknown } | null)?.updatedAt ?? seed.updatedAt }))
      noteSave()
      onWritten()
      onDone(written, effect)
      return true
    } catch (thrown) {
      refusedOver.current = JSON.stringify(values)
      refuse(thrown)
      return false
    } finally {
      setBusy(false)
    }
  }

  // Differs from the seed or from what the server holds since; an update sends only these.
  const changed = (field: ClientField) =>
    form.getFieldMeta(field.name)?.isDefaultValue === false || JSON.stringify(values[field.name]) !== JSON.stringify(seed.saved[field.name])

  const writable = () => {
    // A page's form writes only what the page names and draws writable: sending a field it leaves out would
    // overwrite whatever was saved since. A field a control or panel set through `setValue` counts as named.
    const names = tree && new Set([...leavesOf(tree, (leaf) => !leaf.readOnly), ...named.current])
    return (names ? kayan.fields.filter((field) => names.has(field.name)) : kayan.fields).filter((field) => !owned(field))
  }

  // A draft save holds each value to its kind and none of its rules, so the rules are not checked here either.
  const save = (options?: DraftOptions) => {
    // An update sends only the fields that changed, so two people saving different fields of one row each
    // write their own and neither writes the other's back as it was opened.
    const fields = writable().filter((field) => !id || changed(field))
    const refusal = options?.draft ? undefined : refusalOf({ kayan: kayan.name, fields, values })
    if (refusal) return setRefused(refusal)
    const written = valuesOf({ fields, values, owned })
    const next = drafts ? (options?.draft ? afterDraft(seed.status) : 'published') : undefined
    void run(() => (id ? client.update({ ...written, ...readAt(expectedUpdatedAt), id }, options) : client.create(written, options)), id ? 'update' : 'create', undefined, next)
  }

  // The discard question is open, or a Discard is on its way out, deleting a draft first where it has one to delete.
  const [asking, setAsking] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // Leaving unsaved deletes the untouched draft this page's autosave made, so a cancelled new row leaves none.
  // A published row is kept (a plain read finds it), and so is a draft someone saved since (the delete gets a 409).
  const ownDraft = !!made && id === made && !kept.current && status === 'draft'
  const keepsDraft = ownDraft && operations?.delete !== true
  const out = useRef(false)
  const discard = async (leave: () => void) => {
    if (out.current) return
    out.current = true
    setLeaving(true)
    if (ownDraft && !keepsDraft && client.findByID) {
      const found = await client.findByID({ id }).then(
        (row) => (row ? 'published' : 'absent'),
        (thrown: unknown) => ((thrown as { status?: unknown } | null)?.status === 404 ? 'absent' : 'unknown'),
      )
      if (found === 'absent') await client.delete({ id, ...readAt(expectedUpdatedAtOn?.includes('delete')) }).catch((thrown: unknown) => console.error('The draft this page made could not be deleted:', thrown))
    }
    // The edit is thrown away before the navigation, so a slow navigation leaves no change for the autosave to save.
    form.reset(seed.saved)
    out.current = false
    setLeaving(false)
    setAsking(false)
    leave()
  }

  return { busy, saves, savedAt, noteSave, named, refusedOver, readAt, run, changed, writable, save, asking, setAsking, leaving, keepsDraft, discard }
}
