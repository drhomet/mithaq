import type { Context, Ctx, WriteStep, RuntimeWriteTools } from './steps.ts'
import { AfterCommitError, invalid, retryConflict } from './errors.ts'

// One that throws does not silence the rest, since each stands for a committed write;
// the first error is the one reported.
export const drain = async (queue: readonly (() => Promise<void>)[]) => {
  // A wrapper, so a thunk that threw a falsy value is still raised.
  let failure: { cause: unknown } | undefined
  for (const queued of queue) {
    try {
      await queued()
    } catch (cause) {
      failure ??= { cause }
    }
  }
  if (failure) throw failure.cause
}

/** Every runner commits before draining hooks, and a failed hook never silences another committed write. */
export const commitWrite = async <T>({ transaction, run, lifetime, queue, nested }: {
  transaction: (work: (tx: unknown) => Promise<T>) => Promise<T>
  run: (tx: unknown) => Promise<T>
  lifetime: { settled?: boolean }
  queue: () => readonly (() => Promise<void>)[]
  nested: boolean
}): Promise<T> => {
  let result: T
  try {
    result = await transaction(run)
  } catch (thrown) {
    throw retryConflict(thrown)
  } finally {
    lifetime.settled = true
  }
  try {
    await drain(queue())
  } catch (cause) {
    if (nested) throw cause
    throw new AfterCommitError(result, cause)
  }
  return result
}

export const operationContext = ({ kayan, operation, cap, outer, given, effect }: {
  kayan: string
  operation: string
  cap: number
  outer?: Context
  given?: Record<string, unknown>
  effect: 'read' | 'write'
}): Context => {
  const chain = [...(outer?.chain ?? []), `${kayan}.${operation}`]
  const depth = (outer?.depth ?? 0) + 1
  if (depth > cap) throw invalid({ message: `${effect === 'read' ? 'Read' : 'Write'} depth ${depth} is past the cap of ${cap}: ${chain.join(' -> ')}.`, key: 'error.invalid.depth' })
  return Object.freeze({ source: 'local', ...(outer ?? given), depth, chain })
}

export const assertTransaction = ({ settled, crossStore, operation, outer }: {
  settled?: boolean
  crossStore: boolean
  operation: string
  outer?: string
}) => {
  if (crossStore) throw invalid({ message: `Operation "${operation}" cannot write to another store while transaction "${outer}" is open.`, key: 'error.invalid.cross_store' })
  if (settled) throw invalid({ message: `Operation "${operation}" joined the transaction "${outer}" opened, which has already settled, so the write that started this one was not awaited. Await every write a step begins.`, key: 'error.invalid.settled_transaction' })
}

export const assertNoOptions = (value: unknown) => {
  if (value === undefined) return
  if (value && typeof value === 'object' && ('actor' in value || 'context' in value)) {
    throw invalid({ message: 'Bound kayan tools inherit the current user and context; do not pass actor or context options.', key: 'error.invalid.bound_options' })
  }
  throw invalid({ message: 'Bound kayan tools do not accept operation options.', key: 'error.invalid.bound_options' })
}

// A write from outside the transaction would not roll back with it, or would land after
// the commit; a step there calls a managed operation, which opens its own.
export const outsideStore = ({ kayan, operation, slot }: { kayan: string; operation: string; slot: string }): RuntimeWriteTools['store'] => {
  const refuse = () => {
    throw invalid({ message: `Kayan "${kayan}" operation "${operation}" reached the store from "${slot}", which runs outside the operation's transaction, so the write would not be in it. Write through tools.kayans, which opens its own, or move the step into "steps".`, key: 'error.invalid.outside_transaction' })
  }
  return Object.freeze({ find: refuse, hold: refuse, upsert: refuse, sum: refuse, insert: refuse, remove: refuse, update: refuse })
}

export const runSlot = async ({ kayan, operation, slot, list, start, tools }: {
  kayan: string
  operation: string
  slot: 'beforeTransaction' | 'afterCommit'
  list: readonly WriteStep[]
  start: Ctx
  tools: Parameters<WriteStep>[1]
}): Promise<Ctx> => {
  const { tenant } = start
  let ctx = start
  try {
    for (const step of list) ctx = { ...(await step(ctx, tools)), tenant }
  } catch (cause) {
    if (slot === 'beforeTransaction') throw cause
    throw new Error(`Kayan "${kayan}" operation "${operation}" threw in afterCommit, which runs after the commit, so the write stands.`, { cause })
  }
  return ctx
}
