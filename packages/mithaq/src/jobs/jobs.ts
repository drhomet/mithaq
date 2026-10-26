import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import type { JobTasks } from './config.ts'
import type { JobsTarget } from './driver.ts'

export const buildJobs = ({ target, tasks, asas }: { target: JobsTarget; tasks: JobTasks | undefined; asas: () => object }) => {
  const entries = Object.entries(tasks ?? {})
  const queues = [...new Set(entries.map(([, task]) => task.queue))]
  const driver = target.driver
  const checkWork = (work: readonly string[]) => {
    for (const queue of work) if (!queues.includes(queue)) throw new Error(`No task uses work queue "${queue}".`)
  }
  const schedule = async ({ queue, now = new Date() }: { queue: string; now?: Date }) => {
    checkWork([queue])
    let scheduled = 0
    for (const [name, task] of entries) {
      if (task.queue !== queue) continue
      const cron = new Cron(task.cron, { paused: true, timezone: 'UTC' })
      const fire = cron.match(now) ? new Date(Math.floor(now.getTime() / 1000) * 1000) : cron.previousRuns(1, now)[0]
      cron.stop()
      if (fire && await driver.record({ task: name, scheduledFor: fire, queue, tenant: null })) scheduled++
    }
    return { scheduled }
  }
  const timers: Cron[] = []
  const ticks = new Set<Promise<{ completed: number; failures: number }>>()
  let stopped = false
  const run = ({ queue }: { queue: string }) => {
    checkWork([queue])
    if (stopped) return Promise.resolve({ completed: 0, failures: 0 })
    const tick = (async () => {
      let completed = 0
      let failures = 0
      let passFailed = false
      try {
        await schedule({ queue })
        const expired = await driver.expire()
        failures += expired
        if (expired) console.error({ failures: expired })
        const token = randomUUID()
        // One job at a time keeps every claimed lease under its heartbeat, even in a large backlog.
        for (;;) {
          const [job] = await driver.claim({ queue, tasks: entries.filter(([, task]) => task.queue === queue).map(([name]) => name), limit: 1, lease: target.lease, token })
          if (!job) break
          const controller = new AbortController()
          let heartbeat: Promise<void> | undefined
          let lost = false
          const renew = async () => {
            try {
              if (!(await driver.renew({ ids: [job.id], token, lease: target.lease })).includes(job.id)) lost = true
            } catch { lost = true }
            if (lost) controller.abort()
          }
          const timer = setInterval(() => {
            if (!heartbeat) heartbeat = renew().finally(() => { heartbeat = undefined })
          }, Math.max(1, Math.floor(target.lease / 3)))
          timer.unref()
          try {
            const task = entries.find(([name]) => name === job.task)?.[1]
            if (!task || task.queue !== queue || job.tenant !== null) throw new Error('This worker cannot run the claimed task.')
            const output = await task.run({ asas: asas(), input: job.input, signal: controller.signal })
            if (!output || typeof output !== 'object' || Array.isArray(output) || Object.values(output).some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Job output must contain counts alone.')
            await heartbeat
            await renew()
            if (lost) throw new Error('Job lease could not be renewed.')
            await driver.finish({ id: job.id, token, output })
            completed++
            console.info({ task: job.task, completed: 1, failures: 0 })
          } catch (error) {
            await driver.finish({ id: job.id, token, error: { message: error instanceof Error ? error.message : 'Job failed.' } })
            failures++
            console.error({ task: job.task, failures: 1 })
          } finally {
            clearInterval(timer)
            await heartbeat
          }
        }
      } catch {
        passFailed = true
        failures++
        console.error({ failures: 1 })
      } finally {
        try {
          const pruned = await driver.prune(target.retain)
          if (pruned) console.info({ pruned })
        } catch { if (!passFailed) { failures++; console.error({ failures: 1 }) } }
      }
      return { completed, failures }
    })()
    ticks.add(tick)
    void tick.finally(() => ticks.delete(tick))
    return tick
  }
  return {
    api: { schedule, run, queues },
    checkWork,
    start: (work: readonly string[]) => {
      if (timers.length || stopped) return
      checkWork(work)
      // ponytail: cron polling wakes work only at task fires; add driver wake-ups when queued work needs lower latency.
      for (const [, task] of entries) if (work.includes(task.queue)) timers.push(new Cron(task.cron, {
        timezone: 'UTC', protect: true, unref: true,
        catch: () => { console.error({ failures: 1 }) },
      }, async () => { await run({ queue: task.queue }) }))
    },
    stop: async () => {
      stopped = true
      for (const timer of timers) timer.stop()
      await Promise.all(ticks)
    },
  }
}
