import { Cron } from 'croner'

export type JobTask = {
  slug: string
  handler: (args: { asas: object; input: unknown; signal?: AbortSignal }) => Promise<Record<string, number>>
  schedule: readonly { cron: string; queue: string }[]
  retries: 0
}
export type JobRunner = { cron: string; queue: string; limit: number }
export type JobsConfig = { tasks: readonly JobTask[]; autoRun: readonly JobRunner[]; lease: number }

/** The lease the project names, renewed while a handler runs: thirty seconds. */
export const defaultJobLease = 30000

export const checkJobs = (config: JobsConfig) => {
  if (!config || !Number.isSafeInteger(config.lease) || config.lease < 3) throw new Error('jobs.lease must name a positive integer of at least 3 ms.')
  if (!Array.isArray(config.tasks) || !Array.isArray(config.autoRun)) throw new Error('jobs must name tasks and autoRun lists.')
  const slugs = new Set<string>()
  for (const task of config.tasks) {
    if (!/^[a-zA-Z0-9_-]+$/.test(task.slug)) throw new Error('A job task slug takes letters, numbers, underscores and hyphens alone.')
    if (slugs.has(task.slug)) throw new Error(`Duplicate jobs task "${task.slug}".`)
    slugs.add(task.slug)
    if (task.retries !== 0) throw new Error('Jobs phase 1 requires retries: 0 on every task.')
    if (typeof task.handler !== 'function' || !Array.isArray(task.schedule)) throw new Error(`Job task "${task.slug}" must name handler and schedule.`)
  }
  for (const entry of [...config.tasks.flatMap((task) => task.schedule), ...config.autoRun]) {
    if (typeof entry.queue !== 'string' || !entry.queue.trim()) throw new Error('Every jobs schedule and autoRun entry must name queue.')
    try {
      if (typeof entry.cron !== 'string') throw new Error()
      new Cron(entry.cron, { paused: true, timezone: 'UTC' }).stop()
    } catch { throw new Error('Every jobs schedule and autoRun entry must name a valid cron pattern.') }
  }
  for (const entry of config.autoRun) if (!Number.isSafeInteger(entry.limit) || entry.limit < 1) throw new Error('jobs.autoRun.limit must be a positive integer.')
}
