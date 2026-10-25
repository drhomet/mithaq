import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Store } from '../mithaq/language.ts'
import type { JobsConfig } from './config.ts'

export const buildJobs = ({ config, store, asas }: { config: JobsConfig; store: Store; asas: () => object }) => {
  if (store.sql !== 'drizzle' || !('db' in store)) throw new Error('Jobs phase 1 requires a Postgres drizzle service store.')
  if (!('tables' in store) || !store.tables || typeof store.tables !== 'object' || !Object.hasOwn(store.tables, 'mithaq_jobs')) throw new Error('The jobs store must forward init options to build mithaq_jobs.')
  const db = store.db as NodePgDatabase
  const handleSchedules = async ({ queue, now = new Date() }: { queue: string; now?: Date }) => {
    let scheduled = 0
    for (const task of config.tasks) for (const schedule of task.schedule) {
      if (schedule.queue !== queue) continue
      const cron = new Cron(schedule.cron, { paused: true, timezone: 'UTC' })
      const fire = cron.match(now) ? new Date(Math.floor(now.getTime() / 1000) * 1000) : cron.previousRuns(1, now)[0]
      cron.stop()
      if (!fire) continue
      const result = await db.execute(sql`insert into mithaq_jobs (task, input, queue, tenant, scheduled_for, wait_until)
        values (${task.slug}, '{}'::jsonb, ${queue}, null, ${fire}, ${fire})
        on conflict (task, scheduled_for) where scheduled_for is not null do nothing returning id`)
      scheduled += result.rows.length
    }
    return { scheduled }
  }
  const runJobs = async ({ queue, limit }: { queue: string; limit: number }) => {
    if (!queue || !Number.isSafeInteger(limit) || limit < 1) throw new Error('runJobs requires queue and a positive integer limit.')
    if (!config.tasks.length) return { completed: 0, failures: 0 }
    const token = randomUUID()
    const tasks = sql.join(config.tasks.map((task) => sql`${task.slug}`), sql`, `)
    const interrupted = await db.execute(sql`update mithaq_jobs set has_error = true,
      error = '{"message":"Job interrupted after its lease expired."}'::jsonb,
      processing_token = null, processing_until = null, updated_at = clock_timestamp()
      where queue = ${queue} and tenant is null and task in (${tasks}) and completed_at is null and not has_error
        and processing_until <= clock_timestamp() and attempts > 0 returning task`)
    for (const row of interrupted.rows) console.error({ task: row.task, failures: 1 })
    const { rows } = await db.execute(sql`with due as (
      select id from mithaq_jobs where queue = ${queue} and tenant is null and task in (${tasks})
        and completed_at is null and not has_error and (wait_until is null or wait_until <= clock_timestamp())
        and (processing_until is null or processing_until <= clock_timestamp()) and attempts = 0
      order by created_at, id limit ${limit} for update skip locked
    ) update mithaq_jobs as job set processing_token = ${token}::uuid,
        processing_until = clock_timestamp() + ${config.lease} * interval '1 millisecond',
        attempts = attempts + 1, updated_at = clock_timestamp()
      from due where job.id = due.id returning job.id, job.task, job.input`)
    let completed = 0
    let failures = interrupted.rows.length
    const settled = await Promise.allSettled(rows.map(async (row) => {
      const controller = new AbortController()
      let heartbeat: Promise<void> | undefined
      let lost = false
      const timer = setInterval(() => {
        if (heartbeat) return
        heartbeat = db.execute(sql`update mithaq_jobs set processing_until = clock_timestamp() + ${config.lease} * interval '1 millisecond',
          updated_at = clock_timestamp() where id = ${row.id}::uuid and processing_token = ${token}::uuid and not has_error returning id`)
          .then((result) => { if (!result.rows.length) { lost = true; controller.abort() } })
          .catch(() => { lost = true; controller.abort() })
          .finally(() => { heartbeat = undefined })
      }, Math.max(1, Math.floor(config.lease / 3)))
      timer.unref()

      const task = config.tasks.find((task) => task.slug === row.task)!
      try {
        const output = await task.handler({ asas: asas(), input: row.input, signal: controller.signal })
        if (lost) throw new Error('Job lease could not be renewed.')
        if (!output || typeof output !== 'object' || Array.isArray(output) || Object.values(output).some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Job output must contain counts alone.')
        const result = await db.execute(sql`update mithaq_jobs set completed_at = clock_timestamp(), output = ${JSON.stringify(output)}::jsonb,
          processing_token = null, processing_until = null, updated_at = clock_timestamp()
          where id = ${row.id}::uuid and processing_token = ${token}::uuid and not has_error returning id`)
        completed += result.rows.length
        console.info({ task: task.slug, completed: result.rows.length, failures: 0 })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Job failed.'
        await db.execute(sql`update mithaq_jobs set has_error = true, error = ${JSON.stringify({ message })}::jsonb,
          processing_token = null, processing_until = null, updated_at = clock_timestamp()
          where id = ${row.id}::uuid and processing_token = ${token}::uuid`)
        failures++
        console.error({ task: task.slug, failures: 1 })
      } finally {
        clearInterval(timer)
        await heartbeat
      }
    }))
    const rejected = settled.find((result) => result.status === 'rejected')
    if (rejected?.status === 'rejected') throw rejected.reason
    return { completed, failures }
  }
  const timers: Cron[] = []
  const ticks = new Set<Promise<{ completed: number; failures: number }>>()
  let stopped = false
  const run = (entry: { queue: string; limit: number }) => {
    if (stopped) return Promise.resolve({ completed: 0, failures: 0 })
    const tick = (async () => {
      try {
        await handleSchedules({ queue: entry.queue })
        return await runJobs(entry)
      } catch {
        console.error({ failures: 1 })
        return { completed: 0, failures: 1 }
      }
    })()
    ticks.add(tick)
    void tick.finally(() => ticks.delete(tick))
    return tick
  }
  return {
    api: { handleSchedules, runJobs, run, autoRun: config.autoRun },
    start: () => {
      if (timers.length || stopped) return
      for (const entry of config.autoRun) timers.push(new Cron(entry.cron, {
        timezone: 'UTC', protect: true, unref: true,
        catch: () => { console.error({ failures: 1 }) },
      }, async () => { await run(entry) }))
    },
    stop: async () => {
      stopped = true
      for (const timer of timers) timer.stop()
      await Promise.all(ticks)
    },
  }
}
