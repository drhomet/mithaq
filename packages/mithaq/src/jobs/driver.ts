import type { Store } from '../mithaq/language.ts'

export type JobStore = Pick<Store, 'type' | 'sql' | 'transaction'>

export type Job = { id: string; task: string; input: unknown; queue: string; tenant: string | null }
export type JobRetention = { completed: number; failed: number }
export type JobPolicy = { lease: number; retain: JobRetention }
export type JobFinish = { id: string; token: string } & ({ output: Record<string, number> } | { error: { message: string } })

/** Persistence only: drivers own atomicity and share the service store's transactions. */
export type JobsDriver = {
  readonly store: string
  /** Refuse a store whose transactions this driver cannot join. */
  fits(store: JobStore): boolean
  /** Bind a fresh driver to this build's initialized store. */
  init(store: JobStore): JobsDriver
  /** Record only occurrences newer than the task watermark; equal racers insert at most one row, even after pruning. */
  record(args: { task: string; scheduledFor: Date; queue: string; tenant: string | null }): Promise<boolean>
  /** Join the caller's transaction: a rollback must leave no queued job. */
  enqueue(args: { task: string; input: unknown; queue: string; tenant: string | null; runAt: Date; tx: unknown }): Promise<void>
  /** Using the driver clock, exclusively claim up to limit due, unclaimed, never-attempted jobs whose task is known to this worker; tenant work is reserved for a later phase. */
  claim(args: { queue: string; tasks: readonly string[]; limit: number; lease: number; token: string }): Promise<Job[]>
  /** Renew only unexpired leases still owned by token, returning only the ids still held. */
  renew(args: { ids: readonly string[]; token: string; lease: number }): Promise<string[]>
  /** Finish only an unexpired lease owned by token; a stale token changes nothing. */
  finish(args: JobFinish): Promise<void>
  /** Using the driver clock, fail expired held jobs without making them runnable again. Return the number expired. */
  expire(): Promise<number>
  /** Remove terminal jobs past their cutoffs except each task’s newest scheduled row, its durable watermark. Return the count. */
  prune(args: { completedBefore: Date; failedBefore: Date }): Promise<number>
}

export type JobsTarget = JobPolicy & { readonly capability: 'jobs'; readonly type: string; readonly driver: JobsDriver }
