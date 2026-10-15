import { z } from 'zod'
import type { Ctx } from 'mithaq'

/** The box an archive's or an unarchive's dialog asks for on every screen that draws its button. */
export const reason = {
  kind: 'text',
  label: { en: 'Reason', ar: 'السبب' },
  rules: { required: true, maxLength: 200 },
} as const

/**
 * What `archive` and `unarchive` parse: the row and why. The error messages are
 * the kayan's own copy keys, which the form resolves; without them it draws
 * what zod wrote, in English.
 */
export const reasonInput = (key: `${string}.operations.${'archive' | 'unarchive'}`) => z.object({
  id: z.guid(),
  reason: z
    .string({ error: `${key}.reason.required` })
    .max(200, { error: `${key}.reason.maxLength` }),
})

/**
 * The one step each adds: it turns the operation's `reason` into the two
 * columns the kayan has, so `reason` never has to be a field. `ctx.data` is
 * spread to keep what the runner filled before it, such as `updatedAt`, and
 * `reason` reaches no column: the store step writes the kayan's own fields alone.
 * An empty reason, which a bulk archive sends, keeps none.
 */
export const marks = (archived: boolean) => (ctx: Ctx<{ reason: string }>): Ctx => ({ ...ctx, data: { ...ctx.data, archived, archiveReason: ctx.data.reason || null } })

/** Over a row not archived yet, where an archive button is drawn. Both arms, since a row from before the column holds `null`. */
export const unarchived = { or: [{ 'record.archived': { exists: false } }, { 'record.archived': { equals: false } }] } as const

/** Over an archived row, where an unarchive button and the Archived badge are drawn. */
export const archivedRow = { 'record.archived': { equals: true } } as const

/** A list's tabs over the same column: what is running, what was archived, and everything. */
export const notArchived = { or: [{ archived: { exists: false } }, { archived: { equals: false } }] } as const
