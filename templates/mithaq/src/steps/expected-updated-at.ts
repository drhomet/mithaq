// Refuses an update when the row changed after the caller read it. A kayan opts in by
// widening its update input and listing the step before the store step:
//
//   update: {
//     input: ({ update }) => update.extend({ expectedUpdatedAt: z.date() }),
//     steps: ({ steps }) => [expectedUpdatedAt, steps.update],
//   },
//
// Use `z.date()`: a string or `null` would not be a moment and would answer a misleading 409.
// Listing the step without widening the input protects nothing, since the strict update
// shape refuses the key by name.
//
// The compare is against `ctx.dataBefore`, loaded under the update's own row lock inside its
// transaction, so on a store that honours the lock a second writer waits and no write lands
// between the compare and the store step. A store that ignores the lock lets both through.
//
// updateMany runs this once per row with no instant per row: a kayan whose input requires the
// key refuses every updateMany, and one that leaves it optional runs the bulk unguarded.
//
// A kayan with no `updatedAt` field has nothing to compare, so listing the step on it throws.
//
// A project that copies this step adds the `error.conflict.stale` copy key in every locale.
import { conflict, type Ctx } from 'mithaq'

export const expectedUpdatedAt = (ctx: Ctx<{ expectedUpdatedAt?: Date | string }>): Ctx => {
  if (!('updatedAt' in ctx.kayan.fields)) {
    throw new Error(`Kayan "${ctx.kayan.name}" lists expectedUpdatedAt but has no updatedAt field, so the step cannot guard it. Add defaultTimestampFields or remove the step.`)
  }
  const { expectedUpdatedAt: expected } = ctx.data
  const held = ctx.dataBefore?.updatedAt
  if (expected === undefined || held === undefined) return ctx
  if (new Date(expected).getTime() !== new Date(held as Date).getTime()) {
    throw conflict({
      message: `Kayan "${ctx.kayan.name}" row changed after it was read, so it is not updated. Read it again and send the change on the row as it is.`,
      key: 'error.conflict.stale',
      params: { kayan: ctx.kayan.name },
    })
  }
  return ctx
}
// mithaq-admin 0.0.0 10cc4a57db299d48c4fd53314ed42e02fc04b0464a7fa8a0c512cefc7ccb2b82
