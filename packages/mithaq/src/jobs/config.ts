import { Cron } from 'croner'
import type { JobsTarget } from './driver.ts'

export type JobTask = {
  cron: string
  queue: string
  run: (args: { asas: object; input: unknown; signal: AbortSignal }) => Promise<Record<string, number>>
}
export type JobTasks = Readonly<Record<string, JobTask>>

/** Thirty seconds, renewed while a task runs. */
export const defaultJobLease = 30000
/** Keep completed work for seven days and failed work for thirty days. */
export const defaultJobRetention = { completed: 7 * 86400000, failed: 30 * 86400000 } as const

export const checkJobs = ({ target, tasks }: { target: JobsTarget; tasks: JobTasks | undefined }) => {
  if (!Number.isSafeInteger(target.lease) || target.lease < 3) throw new Error('jobs.lease must name a positive integer of at least 3 ms.')
  for (const key of ['completed', 'failed'] as const) {
    if (!Number.isSafeInteger(target.retain?.[key]) || target.retain[key] < 1) throw new Error(`jobs.retain.${key} must name a positive integer in ms.`)
  }
  if (tasks === undefined) return
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) throw new Error('tasks must be an object keyed by task name.')
  for (const [name, task] of Object.entries(tasks)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('A task name takes letters, numbers, underscores and hyphens alone.')
    if (typeof task?.queue !== 'string' || !task.queue.trim()) throw new Error(`Task "${name}" must name queue.`)
    if (typeof task.run !== 'function') throw new Error(`Task "${name}" must name run.`)
    try {
      if (typeof task.cron !== 'string') throw new Error()
      new Cron(task.cron, { paused: true, timezone: 'UTC' }).stop()
    } catch { throw new Error(`Task "${name}" must name a valid cron pattern.`) }
  }
}
