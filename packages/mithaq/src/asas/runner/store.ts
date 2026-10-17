import type { RawStepStore, StepStore } from '../../mithaq/language.ts'
import type { RuntimeWriteTools, WriteTools } from './steps.ts'
import { invalid } from './errors.ts'

// Audit sinks still implement the adapter contract; no raw handle is a property a step can reach.
const raw = new WeakMap<StepStore, RawStepStore>()
const declaredStore = (store: RawStepStore): StepStore => {
  const wrapped = Object.freeze(Object.fromEntries(Object.entries(store).map(([word, call]) => [word, (args: { kayan?: unknown }) => {
    const kayan = args.kayan as { name?: unknown; fields?: unknown } | null
    if (!kayan || typeof kayan !== 'object' || typeof kayan.name !== 'string' || !kayan.fields || typeof kayan.fields !== 'object') {
      throw invalid({ message: 'A step store call names its kayan by its declaration, not a string.', key: 'error.invalid.value' })
    }
    return (call as (args: object) => Promise<unknown>)({ ...args, kayan: kayan.name })
  }]))) as unknown as StepStore
  raw.set(wrapped, store)
  return wrapped
}

export const rawStepStore = (store: StepStore): RawStepStore => {
  const held = raw.get(store)
  if (!held) throw new Error('The audit step needs the store handed to it by the runner.')
  return held
}

export const stepTools = (tools: RuntimeWriteTools): WriteTools => Object.freeze({ ...tools, store: declaredStore(tools.store) })
