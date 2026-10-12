import { AsyncLocalStorage } from 'node:async_hooks'
import type { Store } from '../../mithaq/language.ts'
import type { Context } from './steps.ts'
import type { TenantScope } from './tenant.ts'

export type Open = {
  tx: unknown
  operation: string
  settled?: true
  // Run once the outer transaction commits: a nested write that ran its own inside
  // it would send an email for a write the outer one then rolled back.
  afterCommit?: (() => Promise<void>)[]
}

export type Running<Actor = unknown> = {
  context: Context
  // Absent where the write around this one runs outside its transaction, so a
  // write started there opens its own rather than joining one that is gone.
  transactions?: Map<Store, Open>
  user: Actor | null
  // The tenants a read reaches past the active one, set by the outermost read and kept by every one under it.
  tenant?: TenantScope
}

export const running = new AsyncLocalStorage<Running>()

// Transactions local auth's first-register opened after reading its table empty
// under an exclusive lock; the one create inside skips `create` access.
export const firstRegisters = new WeakSet<Open>()

export const snapshot = (row: unknown) =>
  row && typeof row === 'object' && !Array.isArray(row)
    ? Object.freeze({ ...(row as Record<string, unknown>) })
    : undefined
