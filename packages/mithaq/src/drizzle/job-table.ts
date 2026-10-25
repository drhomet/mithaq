import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/** Core's table, kept out of the kayan registry and the managed store. */
export const jobTable = () => {
  const time = (name: string) => timestamp(name, { precision: 3, withTimezone: true, mode: 'date' })
  return pgTable('mithaq_jobs', {
    id: uuid('id').defaultRandom().primaryKey(),
    task: text('task').notNull(),
    input: jsonb('input'),
    queue: text('queue').notNull(),
    tenant: text('tenant'),
    scheduledFor: time('scheduled_for'),
    waitUntil: time('wait_until'),
    processingUntil: time('processing_until'),
    processingToken: uuid('processing_token'),
    attempts: integer('attempts').notNull().default(0),
    completedAt: time('completed_at'),
    hasError: boolean('has_error').notNull().default(false),
    error: jsonb('error'),
    output: jsonb('output'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  }, (table) => [
    uniqueIndex('mithaq_jobs_task_scheduled_for_unique').on(table.task, table.scheduledFor).where(sql`${table.scheduledFor} is not null`),
    index('mithaq_jobs_claim').on(table.queue, table.waitUntil, table.createdAt).where(sql`${table.completedAt} is null and not ${table.hasError}`),
  ])
}

// ponytail: identity rows grow with scheduled work; compact behind durable per-task watermarks if frequent schedules need it.
/** Occurrence identity outlives history, so retention never makes an old cron fire runnable again. */
export const jobOccurrencesTable = () => pgTable('mithaq_job_occurrences', {
  task: text('task').notNull(),
  scheduledFor: timestamp('scheduled_for', { precision: 3, withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [primaryKey({ columns: [table.task, table.scheduledFor] })])
