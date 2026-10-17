// One transaction for every row: a row that cannot be written rolls the whole call
// back, because a bulk that half happened is a state no client can undo.
import { stepTools } from './store.ts'
import { AfterCommitError, AsasError, invalid } from './errors.ts'
import { assertReadableWhere, checkedWhere } from './read.ts'
import { running } from './runtime.ts'
import { refuseTenantOption, writeTenant } from './tenant.ts'
import { atEffect, parse, validated, type BulkResult, type Ctx, type ResolvedOperation, type WriteStep, type RuntimeWriteTools as WriteTools } from './steps.ts'
import { aliveWhere, beginWrite, drain, ontoRow, projectReadableFields, publishedWhere, rowLock, runOutside, type Authorize, type ManagedAdmin, type Options } from './write.ts'
import { combineWhere, type Where } from '../../mithaq/where.ts'
import type { ResolvedKayan } from '../../mithaq/types.ts'
import type { Store } from '../../mithaq/language.ts'

export type SingleWrite<Actor> = (
  data: Record<string, unknown>,
  options?: Options<Actor>,
) => Promise<unknown>

// The bulk's own key is asked once, then each row goes through the single-row
// write, which asks its own key and field access: no key grants more through a bulk.
export const bulk = <Actor = unknown>({
  kayan,
  declaration,
  tools,
  store,
  single,
  cap,
  bulkLimit: ceiling,
  authorize,
  admin,
  tenantOf,
}: {
  kayan: ResolvedKayan
  declaration: ResolvedOperation
  tools: WriteTools<unknown, Actor>
  store: Store
  single: SingleWrite<Actor>
  cap: number
  /**
   * The most rows one call may match, the service target's `bulkLimit`.
   */
  bulkLimit: number
  authorize: Authorize
  admin?: ManagedAdmin<Actor>
  tenantOf: (actor: unknown) => string | undefined
}) =>
  async (given: Record<string, unknown>, options?: Options<Actor>): Promise<Record<string, unknown>> => {
    const list = atEffect<WriteStep>(declaration.steps)
    // Each row lands on the row as it is, so `{ draft: true }` is refused rather than published.
    if (kayan.versions?.drafts && options?.draft) {
      throw invalid({
        message: `Kayan "${kayan.name}" operation "${tools.operation}" writes each row as it is, so it saves no draft. Call it without draft.`,
        key: 'error.invalid.draft_operation',
        params: { kayan: kayan.name, operation: tools.operation },
      })
    }
    const { actor, context, entry, open } = beginWrite<Actor>({ kayan, operation: tools.operation, store, cap, options })
    refuseTenantOption({ kayan, operation: tools.operation, options })
    const owner = writeTenant({ kayan, active: tenantOf(actor), effect: tools.effect, data: given?.data })
    // Asked once, before `beforeTransaction`, so a refused actor runs no outside step.
    const accessWhere = await authorize({
      admin,
      actor,
      data: {},
      effect: tools.effect,
      kayan,
      kind: tools.kind,
      operation: tools.operation,
    })
    // Checked before the transaction opens, so a value a column refuses is a 400 no store was asked for.
    if (given?.where !== undefined) await checkedWhere(kayan, given.where)
    let values = given
    if (declaration.beforeTransaction.length) {
      const before = await runOutside({
        kayan,
        tools,
        slot: 'beforeTransaction',
        list: atEffect<WriteStep>(declaration.beforeTransaction),
        start: { kayan, data: { ...given }, actor, user: actor, tx: undefined, context, tenant: owner },
        around: { context, user: actor },
      })
      values = before.data as Record<string, unknown>
    }
    let committed: Ctx | undefined
    const many = async (data: Record<string, unknown>, tx: unknown): Promise<BulkResult> => {
      const callerWhere = await assertReadableWhere({ kayan, where: data.where as Where | undefined, actor, authorize, admin })
      // Required here: a bulk with no `where` would be every row the access admits.
      if (!callerWhere) {
        throw invalid({
          message: `Kayan "${kayan.name}" operation "${tools.operation}" needs a "where", because a bulk write with none would change every row the access admits.`,
          key: 'error.invalid.bulk_where',
          params: { kayan: kayan.name, operation: tools.operation },
        })
      }
      // An update naming no column would move each row's `updatedAt` and keep a version
      // for no edit. Asked after the steps, since a step may fill `data`.
      if (tools.kind === 'updateMany' && !Object.keys((data.data ?? {}) as object).length) {
        throw invalid({
          message: `Kayan "${kayan.name}" operation "${tools.operation}" was handed no "data", so there is nothing to change.`,
          key: 'error.invalid.empty_update',
          params: { kayan: kayan.name, operation: tools.operation },
        })
      }
      // The rows a plain read shows, so a bulk never reaches a draft that was never published.
      const where = combineWhere(combineWhere(callerWhere, accessWhere), publishedWhere(kayan))
      const values = (data.data ?? {}) as Record<string, unknown>
      // Holds every matched row until commit, as each row's own write then holds it; the limit is the
      // ceiling, and `totalDocs` counts the whole matched set without reading it.
      const found = await store.find({
        kayan: kayan.name,
        args: { limit: ceiling, page: 1, lock: rowLock({ kayan, kind: tools.kind, data: values }), sort: { field: 'id', direction: 'asc' }, where },
        tx,
      })
      // Refused rather than written in part: a caller could not tell which rows a partial
      // bulk wrote. The caller narrows its `where` instead.
      if (found.totalDocs > ceiling) {
        throw invalid({
          message: `Kayan "${kayan.name}" operation "${tools.operation}" matched ${found.totalDocs} rows, and a bulk write holds at most ${ceiling} in one transaction. Narrow the "where" and run it again.`,
          key: 'error.invalid.bulk_limit',
          params: { kayan: kayan.name, operation: tools.operation, matched: found.totalDocs, ceiling },
        })
      }
      const docs: Record<string, unknown>[] = []
      // In order, not in parallel: each write joins this transaction, which is one connection.
      for (const row of found.docs) {
        // Onto the row as it is, never its pending draft.
        docs.push((await single({ ...values, id: row.id }, { actor: actor ?? undefined, [ontoRow]: true })) as Record<string, unknown>)
      }
      // Unpublished rows the `where` names are left alone and reported under `errors`, so a
      // person who ticked one is told; only to an actor who may read drafts, and only rows its answer admits.
      const admits = kayan.versions?.drafts
        ? await authorize({ admin, actor, data: {}, effect: 'read', kayan, operation: 'findVersions' }).then((where) => ({ where }), (thrown: unknown) => {
          if (thrown instanceof AsasError && thrown.status === 403) return undefined
          throw thrown
        })
        : undefined
      const unpublished = admits
        ? (await store.find({
            kayan: kayan.name,
            args: { limit: ceiling, page: 1, sort: { field: 'id', direction: 'asc' }, where: combineWhere(combineWhere(callerWhere, accessWhere), combineWhere(aliveWhere(kayan), combineWhere({ _status: { not_equals: 'published' } }, admits.where))) },
            tx,
          })).docs
        : []
      return {
        docs,
        errors: unpublished.map((row) => ({ id: row.id, message: `Kayan "${kayan.name}" row is not published, so operation "${tools.operation}" left it as it is. Publish it first.` })),
      }
    }
    const run = (tx: unknown) => {
      entry.tx = tx
      return running.run({ context, transactions: new Map(open).set(store, entry), user: actor }, async () => {
        const runTools = Object.freeze({ ...tools, many: (data: Record<string, unknown>) => many(data, tx) })
        const publicTools = stepTools(runTools as WriteTools)
        let ctx: Ctx = { kayan, data: { ...values }, actor, user: actor, tx, context, tenant: owner }
        // No defaults here: each row's single-row write fills its own.
        ctx = await parse({ schema: runTools.schema, ctx, tools: publicTools })
        for (const step of atEffect<WriteStep>([
          ...declaration.beforeSteps,
          ...list,
          ...declaration.afterSteps,
        ])) ctx = { ...(await step(ctx, publicTools)), tenant: owner }
        committed = ctx
        // Each document already passed its single-row output and read mask.
        // The bulk contract validates the envelope after the steps have run.
        if (!tools.publicOutput) return ctx.data as BulkResult
        const parsed = await validated(tools.publicOutput, ctx.data)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(`Kayan "${kayan.name}" custom bulk output must return an object.`)
        }
        const result = parsed as Record<string, unknown>
        if ('docs' in result) {
          if (!Array.isArray(result.docs)) throw new Error(`Kayan "${kayan.name}" custom bulk output must return docs as an array.`)
          for (const doc of result.docs) {
            if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`Kayan "${kayan.name}" custom bulk output must return row objects.`)
            const visible = await projectReadableFields({ kayan, row: doc as Record<string, unknown>, actor })
            const protectedField = Object.keys(doc).find((key) => !(key in visible))
            if (protectedField) throw new Error(`Kayan "${kayan.name}" custom bulk output returned protected field "${protectedField}" after read projection.`)
          }
        }
        return result
      })
    }
    const afterCommit = async () => {
      if (!declaration.afterCommit.length || !committed) return
      await runOutside({
        kayan,
        tools,
        slot: 'afterCommit',
        list: atEffect<WriteStep>(declaration.afterCommit),
        start: { ...committed, tx: undefined },
        around: { context, user: actor },
      })
    }
    const joined = open.get(store)
    if (joined) {
      const result = await run(joined.tx)
      if (declaration.afterCommit.length) joined.afterCommit = [...(joined.afterCommit ?? []), afterCommit]
      return result
    }
    let result: Record<string, unknown>
    try {
      result = await store.transaction(run)
    } finally {
      entry.settled = true
    }
    try {
      await drain([...(entry.afterCommit ?? []), afterCommit])
    } catch (cause) {
      // Only the outermost operation answers with what it committed; under an outer one
      // the failure climbs as a plain `Error`.
      if (running.getStore()) throw cause
      throw new AfterCommitError(result, cause)
    }
    return result
  }
