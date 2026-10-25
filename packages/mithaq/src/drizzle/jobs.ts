import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Job, JobPolicy, JobsDriver, JobsTarget, JobStore } from '../jobs/driver.ts'

type Database = Pick<NodePgDatabase, 'execute'>
const driver = (store?: JobStore): JobsDriver => {
  const db = () => {
    if (!store || !('db' in store)) throw new Error('Initialize drizzleJobs with its drizzle store before running work.')
    return store.db as Database
  }
  return {
    store: 'drizzle',
    fits: (store) => store.sql === 'drizzle' && 'db' in store,
    init: (store) => {
      if (!('tables' in store) || !store.tables || !Object.hasOwn(store.tables, 'mithaq_jobs')) throw new Error('The drizzleJobs store must forward init options to build mithaq_jobs.')
      return driver(store)
    },
    record: async ({ task, scheduledFor, queue, tenant }) => {
      const result = await db().execute(sql`insert into mithaq_jobs (task, input, queue, tenant, scheduled_for)
        select ${task}, '{}'::jsonb, ${queue}, ${tenant}, ${scheduledFor}::timestamptz
        where not exists (select 1 from mithaq_jobs where task = ${task} and scheduled_for >= ${scheduledFor})
        on conflict (task, scheduled_for) where scheduled_for is not null do nothing returning id`)
      return result.rows.length === 1
    },
    enqueue: async ({ task, input, queue, tenant, runAt, tx }) => {
      await (tx as Database).execute(sql`insert into mithaq_jobs (task, input, queue, tenant, wait_until)
        values (${task}, ${JSON.stringify(input)}::jsonb, ${queue}, ${tenant}, ${runAt})`)
    },
    claim: async ({ queue, tasks, limit, lease, token }) => {
      if (!tasks.length) return []
      const { rows } = await db().execute(sql`with due as (
        select id from mithaq_jobs where queue = ${queue} and task in (${sql.join(tasks.map((task) => sql`${task}`), sql`, `)}) and tenant is null
          and completed_at is null and not has_error and (wait_until is null or wait_until <= clock_timestamp())
          and processing_token is null and attempts = 0
        order by created_at, id limit ${limit} for update skip locked
      ) update mithaq_jobs as job set processing_token = ${token}::uuid,
          processing_until = clock_timestamp() + ${lease} * interval '1 millisecond',
          attempts = attempts + 1, updated_at = clock_timestamp()
        from due where job.id = due.id returning job.id, job.task, job.input, job.queue, job.tenant`)
      return rows as Job[]
    },
    renew: async ({ ids, token, lease }) => {
      if (!ids.length) return []
      const { rows } = await db().execute(sql`update mithaq_jobs set processing_until = clock_timestamp() + ${lease} * interval '1 millisecond',
        updated_at = clock_timestamp() where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        and processing_token = ${token}::uuid and processing_until > clock_timestamp()
        and completed_at is null and not has_error returning id`)
      return rows.map((row) => String(row.id))
    },
    finish: async (args) => {
      const values = 'error' in args
        ? sql`has_error = true, error = ${JSON.stringify(args.error)}::jsonb`
        : sql`completed_at = clock_timestamp(), output = ${JSON.stringify(args.output)}::jsonb`
      await db().execute(sql`update mithaq_jobs set ${values}, processing_token = null, processing_until = null,
        updated_at = clock_timestamp() where id = ${args.id}::uuid and processing_token = ${args.token}::uuid
        and processing_until > clock_timestamp() and completed_at is null and not has_error`)
    },
    expire: async () => {
      const { rows } = await db().execute(sql`update mithaq_jobs set has_error = true,
        error = '{"message":"Job interrupted after its lease expired."}'::jsonb,
        processing_token = null, processing_until = null, updated_at = clock_timestamp()
        where tenant is null and completed_at is null and not has_error and processing_until <= clock_timestamp()
          and processing_token is not null and attempts > 0 returning id`)
      return rows.length
    },
    prune: async ({ completed, failed }) => {
      const { rows } = await db().execute(sql`delete from mithaq_jobs as job where
        ((completed_at < clock_timestamp() - ${completed} * interval '1 millisecond') or (has_error and updated_at < clock_timestamp() - ${failed} * interval '1 millisecond'))
        and (scheduled_for is null or exists (
          select 1 from mithaq_jobs as newer where newer.task = job.task and newer.scheduled_for > job.scheduled_for
        )) returning id`)
      return rows.length
    },
  }
}

/** Postgres jobs sharing the service store's transactions and generated migrations. */
export const drizzleJobs = (policy: JobPolicy): JobsTarget => ({ capability: 'jobs', type: 'drizzleJobs', driver: driver(), ...policy })
