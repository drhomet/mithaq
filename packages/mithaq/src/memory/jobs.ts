import { randomUUID } from 'node:crypto'
import type { Job, JobPolicy, JobsDriver, JobsTarget, JobStore } from '../jobs/driver.ts'

/** A memory store uses these transaction hooks so queued work commits only with its caller. */
export const memoryTransactions = () => {
  const pending = new WeakMap<object, (() => void)[]>()
  return {
    type: 'memory' as const,
    transaction: async <Result>(run: (tx: unknown) => Promise<Result>) => {
      const tx = {}
      const commits: (() => void)[] = []
      pending.set(tx, commits)
      try {
        const result = await run(tx)
        for (const commit of commits) commit()
        return result
      } finally { pending.delete(tx) }
    },
    afterCommit: ({ tx, run }: { tx: unknown; run: () => void }) => {
      const commits = tx && typeof tx === 'object' ? pending.get(tx) : undefined
      if (!commits) throw new Error('memoryJobs.enqueue needs a transaction from its own memory store.')
      commits.push(run)
    },
  }
}

type MemoryStore = JobStore & ReturnType<typeof memoryTransactions>
type HeldJob = Job & { scheduledFor: Date | null; runAt: Date; token: string | null; until: number; attempts: number; completed: number | null; failed: number | null; output?: Record<string, number>; error?: { message: string } }

const storage = new WeakMap<MemoryStore['afterCommit'], { rows: HeldJob[]; occurrences: Set<string> }>()
const driver = (store?: MemoryStore): JobsDriver => {
  const state = (store && storage.get(store.afterCommit)) || { rows: [], occurrences: new Set<string>() }
  if (store) storage.set(store.afterCommit, state)
  const { rows, occurrences } = state
  const add = (args: { task: string; input: unknown; queue: string; tenant: string | null; runAt: Date; scheduledFor: Date | null }) => {
    rows.push({ ...structuredClone(args), id: randomUUID(), token: null, until: 0, attempts: 0, completed: null, failed: null })
  }
  return {
    store: 'memory',
    fits: (store) => store.type === 'memory' && 'afterCommit' in store && typeof store.afterCommit === 'function',
    init: (store) => driver(store as MemoryStore),
    record: async (args) => {
      const key = JSON.stringify([args.task, args.scheduledFor.getTime()])
      if (occurrences.has(key)) return false
      occurrences.add(key)
      add({ ...args, input: {}, runAt: args.scheduledFor })
      return true
    },
    claim: async ({ queue, limit, lease, token, now }) => {
      const due = rows.filter((row) => row.queue === queue && row.tenant === null && row.completed === null && row.failed === null && row.attempts === 0 && row.token === null && row.runAt <= now).slice(0, limit)
      for (const row of due) { row.token = token; row.until = now.getTime() + lease; row.attempts++ }
      return due.map(({ id, task, input, queue, tenant }) => ({ id, task, input: structuredClone(input), queue, tenant }))
    },
    enqueue: async ({ tx, ...args }) => {
      if (!store) throw new Error('Initialize memoryJobs with its store before enqueue.')
      const job = structuredClone(args)
      store.afterCommit({ tx, run: () => add({ ...job, scheduledFor: null }) })
    },
    renew: async ({ ids, token, lease }) => {
      const held = rows.filter((row) => ids.includes(row.id) && row.token === token && row.until > Date.now())
      for (const row of held) row.until = Date.now() + lease
      return held.map((row) => row.id)
    },
    finish: async (args) => {
      const row = rows.find((row) => row.id === args.id && row.token === args.token && row.until > Date.now())
      if (!row) return
      if ('error' in args) { row.failed = Date.now(); row.error = structuredClone(args.error) }
      else { row.completed = Date.now(); row.output = structuredClone(args.output) }
      row.token = null
      row.until = 0
    },
    expire: async ({ now }) => {
      const expired = rows.filter((row) => row.token !== null && row.until <= now.getTime())
      for (const row of expired) { row.failed = now.getTime(); row.error = { message: 'Job interrupted after its lease expired.' }; row.token = null; row.until = 0 }
      return expired.length
    },
    prune: async ({ completedBefore, failedBefore }) => {
      const old = rows.filter((row) => (row.completed !== null && row.completed < completedBefore.getTime()) || (row.failed !== null && row.failed < failedBefore.getTime()))
      for (const row of old) rows.splice(rows.indexOf(row), 1)
      return old.length
    },
  }
}

/** In-process jobs for a memory store using memoryTransactions. */
export const memoryJobs = (policy: JobPolicy): JobsTarget => ({ capability: 'jobs', type: 'memoryJobs', driver: driver(), ...policy })
