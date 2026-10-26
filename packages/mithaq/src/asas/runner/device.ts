import { assertReferences } from './references.ts'
import { isStore, isService, isTenant, isStorage, isVersions, isScreen, isAccess, serviceTargetOf, type Language, type Store } from '../../mithaq/language-core.ts'
import { resolve } from '../../mithaq/resolve.ts'
import { resolvedKayans, type FieldAccess, type Kayan, type ResolvedKayan } from '../../mithaq/types.ts'
import { combineWhere, type Scalar, type Where } from '../../mithaq/where.ts'
import { refusePlacement } from '../placement.ts'
import { defaults, parse, sealOf, validated, outputOf, type Context, type Ctx, type DerivedShapes, type OperationStep, type ResolvedOperation, type RuntimeWriteTools, type ReadTools } from './steps.ts'
import { stepTools } from './store.ts'
import { projectReadableFields } from './access.ts'
import { assertReadableWhere, protectedField } from './query-access.ts'
import { assertWhere, assertStoreWhere } from './query.ts'
import { AfterCommitError, denied, invalid, missing } from './errors.ts'
import { snapshot } from './snapshot.ts'
import { providerOf } from '../../base/rules.ts'
import type { Writes, Globals } from './write.ts'
import type { StandardSchemaV1 } from '../../mithaq/standard-schema.ts'

type Row = Record<string, unknown>
type Options = { actor?: unknown; context?: Record<string, unknown>; tenant?: unknown; draft?: boolean; autosave?: boolean }
type Scope = { actor: unknown; context: Context; store?: Store; tx?: unknown; afterCommit: (() => Promise<void>)[]; lifetime?: { settled: boolean } }
type Call = (data?: Row, options?: Options) => Promise<any>

export type DeviceAsas<L extends Language, K extends readonly Kayan[], G extends readonly Kayan[]> = {
  targets: L['targets']
  catalog: readonly string[]
  kayan: Writes<K, readonly [...K, ...G], L, unknown>
  global: Globals<G, readonly [...K, ...G], L, unknown>
  connect(): Promise<void>
  destroy(): Promise<void>
}

/** Every nested call closes over its own scope; simultaneous calls share no ambient state. */
export function buildDeviceAsas<const L extends Language, const K extends readonly Kayan[], const G extends readonly Kayan[] = readonly []>(language: L, args: { kayan: K; global?: G; http: readonly [] }): DeviceAsas<L, K, G>
export function buildDeviceAsas(language: Language, { kayan, global = [], http }: { kayan: readonly Kayan[]; global?: readonly Kayan[]; http: readonly unknown[] }): any {
  if (!Array.isArray(http) || http.length) throw new Error('A device asas requires http: []; HTTP targets are unsupported.')
  const declared = [...kayan, ...global]
  refusePlacement({ language, kayan: declared, http, runtime: 'device' })
  const services = Object.values(language.targets).filter(isService)
  if (services.length !== 1 || !isService(language.targets.service)) throw new Error('A device asas needs exactly one service target named service.')
  const service = serviceTargetOf(language)!
  for (const key of ['authorize', 'store', 'schema', 'depth', 'defaultLimit', 'maxLimit', 'joinLimit', 'bulkLimit'] as const) {
    if (service[key] === undefined) throw new Error(`The service target declares no "${key}".`)
  }
  for (const key of ['depth', 'defaultLimit', 'maxLimit', 'joinLimit', 'bulkLimit'] as const) {
    if (!Number.isInteger(service[key]) || service[key] < 1) throw new Error(`service.${key} must be a positive integer.`)
  }
  if (service.defaultLimit > service.maxLimit || service.joinLimit > service.maxLimit) throw new Error('Device page defaults must fit service.maxLimit.')
  for (const target of Object.values(language.targets)) {
    if (isTenant(target) || isStorage(target) || isVersions(target) || isScreen(target) || isAccess(target)) throw new Error('A device asas supports store, schema and service targets only.')
  }
  for (const one of declared) if (one.auth) throw new Error(`Kayan "${one.name}" needs authentication; supply the actor to device operations instead.`)
  const resolved = resolve(declared, language)
  const byName = new Map(resolved.map((one) => [one.name, one]))
  const registered = new Map(declared.map((one) => [one.name, one]))
  const stores = new Map<string, Store>()
  const targets = { ...language.targets }
  for (const [name, target] of Object.entries(targets)) if (isStore(target)) {
    if (target.placement !== 'device') throw new Error(`Store "${name}" is not a device store.`)
    const built = target.init(resolved.filter((one) => one.store === name)) ?? target
    stores.set(name, built as Store)
    targets[name] = built as never
  }
  const shapes = new Map(resolved.map((one) => {
    const target = targets[one.schema]
    if (!target || !('derive' in target)) throw new Error(`Kayan "${one.name}" needs a schema target.`)
    return [one.name, target.derive(one.fields)] as [string, DerivedShapes]
  }))
  const catalog = resolved.flatMap((one) => Object.keys(one.operations).map((name) => `${one.name}.${name}`))
  const noRow = (one: ResolvedKayan) => missing({ message: `No "${one.name}" row found.`, key: 'error.not_found.row', params: { kayan: one.name } })
  const alive = (one: ResolvedKayan) => one.softDelete ? { [one.softDelete]: { exists: false } } as Where : undefined
  const constrain = ({ one, data, where }: { one: ResolvedKayan; data: Row; where?: Where }) => combineWhere(combineWhere(where, one.single ? undefined : { id: { equals: data.id as Scalar } }), alive(one))
  const bound = (scope?: Scope, readOnly = false) => Object.fromEntries(resolved.map((one) => [one.name, Object.fromEntries(Object.entries(one.operations)
    .filter(([, operation]) => !readOnly || operation.effect === 'read')
    .map(([name, operation]) => [name, ((data, options) => invoke({ one, name, operation, data: data ?? {}, options, outer: scope })) as Call]))])) as Record<string, Record<string, Call>>
  const of = (scope: Scope, readOnly: boolean) => (one: Kayan) => {
    if (registered.get(one.name) !== one) throw new Error(`Kayan "${one.name}" is not the registered declaration.`)
    return bound(scope, readOnly)[one.name]
  }
  const project = async ({ one, row, scope, output }: { one: ResolvedKayan; row: Row; scope: Scope; output?: StandardSchemaV1 }) => {
    const proved = await validated(shapes.get(one.name)!.row, row) as Row
    const visible = await projectReadableFields({ kayan: one, row: { ...row, ...proved }, actor: scope.actor })
    return output ? validated(output, visible) : visible
  }
  const integer = (value: unknown, name: string, minimum: number) => {
    if (!Number.isSafeInteger(value) || Number(value) < minimum) throw invalid({ message: `${name} must be an integer >= ${minimum}.`, key: 'error.invalid.value' })
    return Number(value)
  }
  const invoke = async ({ one, name, operation, data, options, outer }: { one: ResolvedKayan; name: string; operation: ResolvedOperation; data: Row; options?: Options; outer?: Scope }): Promise<any> => {
    if (options?.tenant !== undefined) throw invalid({ message: 'A device operation accepts no tenant option.', key: 'error.invalid.value' })
    if (options?.draft || options?.autosave) throw invalid({ message: 'A device operation keeps no versions.', key: 'error.invalid.value' })
    if (outer?.lifetime?.settled) throw new Error('The parent operation has settled. Await every nested operation.')
    const depth = (outer?.context.depth ?? 0) + 1
    if (depth > service.depth) throw new Error(`Operation depth ${depth} is past the cap of ${service.depth}.`)
    if (!outer && service.context !== undefined && !options?.context) throw new Error('The device operation requires the service context.')
    const scope: Scope = { actor: outer ? outer.actor : options?.actor ?? null, context: Object.freeze({ ...(outer?.context ?? options?.context), source: 'local', depth, chain: [...(outer?.context.chain ?? []), `${one.name}.${name}`] }), store: outer?.store, tx: outer?.tx, afterCommit: [], lifetime: outer?.lifetime }
    const store = stores.get(one.store)!
    if (outer?.store && outer.store !== store) throw new Error('A nested device operation cannot cross stores inside a transaction.')
    const shape = shapes.get(one.name)!
    let kind = operation.steps.map(sealOf).find((seal) => seal && ['insert', 'update', 'remove', 'find', 'findOne', 'count', 'updateMany', 'deleteMany'].includes(seal))!
    let schema = operation.input ? operation.input(shape as never) : kind === 'insert' ? shape.create : kind === 'update' ? shape.update : kind === 'remove' ? shape.id : kind === 'findOne' ? shape.byID : shape.list
    if (!schema) throw new Error(`Kayan "${one.name}" has no ${kind} input shape.`)
    const output = operation.output ?? outputOf(operation)?.(shape as never)
    const where = await service.authorize({ actor: scope.actor, data, effect: operation.effect, kayan: one, operation: name, kind: kind as never })
    const run = async (tx?: unknown) => {
      if (tx !== undefined) scope.lifetime ??= { settled: false }
      scope.tx = tx
      scope.store = tx === undefined ? undefined : store
      let ctx: Ctx = { kayan: one, data: { ...data }, actor: scope.actor, user: scope.actor, tx, context: scope.context }
      if (operation.effect !== 'read' && kind !== 'insert' && kind !== 'updateMany' && kind !== 'deleteMany') {
        if (!one.single) await validated(shape.id, { id: data.id })
        const found = await store.find({ kayan: one.name, args: { limit: 1, page: 1, lock: 'update', sort: { field: 'id', direction: 'asc' }, where: constrain({ one, data, where }) }, tx })
        const existing = found.docs[0]
        if (!existing && !one.single) throw noRow(one)
        if (!existing && one.single && kind === 'update') {
          kind = 'insert'
          if (!operation.input) schema = shape.create
        } else if (one.single && !operation.input) {
          const { id: _id, ...withoutId } = one.fields
          schema = (targets[one.schema] as { derive: (fields: typeof withoutId) => DerivedShapes }).derive(withoutId).update
        }
        ctx.dataBefore = snapshot(existing)
      }
      const raw = Object.fromEntries(['insert', 'update', 'remove', 'upsert', 'sum', 'find', 'hold'].map((word) => [word, async (args: { kayan: string; data?: Row; where?: Where; [key: string]: unknown }) => {
        const target = byName.get(args.kayan)
        if (!target || stores.get(target.store) !== store) throw new Error('A device step store call must name a kayan in its own store.')
        if (tx === undefined) throw new Error('A step store call requires the operation transaction.')
        if (word === 'find') {
          const query = args.args as Parameters<Store['find']>[0]['args']
          if (query.where) assertStoreWhere(target, query.where)
          return store.find({ kayan: target.name, args: query, tx })
        }
        if (word === 'hold') {
          const { ids, mode } = args as unknown as { ids: Scalar[]; mode: 'update' | 'noKeyUpdate' | 'share' | 'keyShare' }
          if (!['update', 'noKeyUpdate', 'share', 'keyShare'].includes(mode)) throw invalid({ message: 'Holding rows requires a valid lock mode.', key: 'error.invalid.value' })
          for (const id of new Set(ids)) {
            const found = await store.find({ kayan: target.name, args: { limit: 1, page: 1, sort: { field: 'id', direction: 'asc' }, lock: mode, where: { id: { equals: id } } }, tx })
            if (!found.docs.length) throw noRow(target)
          }
          return
        }
        if (args.where) assertStoreWhere(target, args.where)
        return (store[word as 'insert'] as (args: object) => Promise<unknown>)({ ...args, tx })
      }])) as unknown as RuntimeWriteTools['store']
      const common = { operation: name, schema, output: shape.row, publicOutput: output, catalog, kayans: bound(scope, operation.effect === 'read'), of: of(scope, operation.effect === 'read'), audit: service.audit }
      const fetch = async (input: unknown) => {
        const query = input as Row
        const page = integer(query.page ?? 1, 'page', 1)
        const limit = integer(query.limit ?? service.defaultLimit, 'limit', 0)
        if (query.depth !== undefined) integer(query.depth, 'depth', 0)
        const sort = typeof query.sort === 'string' ? query.sort : 'id'
        const field = sort.replace(/^-/, '')
        if (!Object.hasOwn(one.fields, field) || one.fields[field]?.sortable === false) throw invalid({ message: `Unknown or unsortable field "${field}".`, key: 'error.invalid.value' })
        await protectedField({ kayan: one, field, actor: scope.actor, authorize: service.authorize, what: 'sort' })
        const filter = combineWhere(combineWhere(where, await assertReadableWhere({ kayan: one, where: query.where as Where | undefined, actor: scope.actor, authorize: service.authorize })), alive(one))
        const matched = kind === 'findOne' ? constrain({ one, data: query, where }) : filter
        if (kind === 'count' && store.count) return { totalDocs: await store.count({ kayan: one.name, args: { where: matched }, tx }) }
        const found = await store.find({ kayan: one.name, args: { limit: kind === 'findOne' ? 1 : limit, page, sort: { field, direction: sort.startsWith('-') ? 'desc' : 'asc' }, where: matched }, tx })
        const docs = await Promise.all(found.docs.map((row) => project({ one, row, scope })))
        if (kind === 'findOne') {
          if (!docs[0]) throw noRow(one)
          return docs[0]
        }
        if (kind === 'count') return { totalDocs: found.totalDocs }
        const totalPages = limit ? Math.max(1, Math.ceil(found.totalDocs / limit)) : 1
        return { docs, totalDocs: found.totalDocs, limit, page, totalPages, pagingCounter: (page - 1) * limit + 1, hasPrevPage: page > 1, hasNextPage: page < totalPages, prevPage: page > 1 ? page - 1 : null, nextPage: page < totalPages ? page + 1 : null }
      }
      const many = async (input: Row) => {
        if (input.where === undefined) throw invalid({ message: 'A bulk operation requires a where constraint.', key: 'error.invalid.bulk_where' })
        const matched = combineWhere(combineWhere(where, await assertReadableWhere({ kayan: one, where: input.where as Where, actor: scope.actor, authorize: service.authorize })), alive(one))
        const found = await store.find({ kayan: one.name, args: { limit: service.bulkLimit + 1, page: 1, lock: 'update', sort: { field: 'id', direction: 'asc' }, where: matched }, tx })
        if (found.docs.length > service.bulkLimit) throw invalid({ message: 'The device bulk limit was exceeded.', key: 'error.invalid.value' })
        const each = operation.each!
        const single = one.operations[each]
        if (!single) throw new Error(`Device bulk operation ${name} must name its single-row operation with each.`)
        const docs: Row[] = []
        for (const row of found.docs) docs.push(await invoke({ one, name: each, operation: single, data: { ...(kind === 'updateMany' ? input.data as Row : {}), id: row.id }, outer: scope }))
        return { docs, errors: [] }
      }
      const tools = operation.effect === 'read' ? { ...common, effect: 'read', kind, read: fetch } as ReadTools : stepTools({ ...common, effect: operation.effect, kind, store: raw, many, where, sent: Object.keys(data), insertSchema: shape.create } as RuntimeWriteTools)
      if (operation.effect !== 'read') {
        const filtered = { ...ctx.data }
        for (const field of Object.values(one.fields)) {
          if (!(field.name in filtered) || field.name === 'id') continue
          const provider = providerOf(field, operation.effect === 'create' ? 'create' : 'update')
          if (provider !== 'client') throw invalid({ message: `Field "${field.name}" is provided by the application.`, key: 'error.invalid.value' })
          const access = field.access?.[operation.effect === 'create' ? 'create' : 'update'] as FieldAccess | undefined
          if (access && !await access({ data, doc: ctx.dataBefore, siblingData: filtered, id: data.id, user: scope.actor })) delete filtered[field.name]
        }
        ctx.data = filtered
        if (kind === 'insert' || kind === 'update') ctx = await defaults(ctx, tools as never)
      }
      if (one.single && kind === 'insert') ctx.data.globalType = one.name
      ctx = await parse({ schema, ctx, tools })
      if (one.single && ctx.dataBefore) ctx.data.id = ctx.dataBefore.id
      for (const step of [...operation.beforeSteps, ...operation.steps, ...operation.afterSteps]) {
        if (operation.effect !== 'read' && ['insert', 'update'].includes(String(sealOf(step)))) {
          await assertReferences({ kayan: one, store, data: ctx.data, tenant: undefined, tx, access: (target) => service.authorize({ actor: scope.actor, data: {}, effect: 'read', kayan: target }), offered: async (field) => {
            const answer = await field.filterOptions?.({ user: scope.actor, tx })
            return answer === undefined || answer === true ? undefined : answer === false ? { id: { in: [] } } : assertWhere(field.target!, answer)
          } })
        }
        if (sealOf(step) === 'remove' && one.softDelete) {
          const data = Object.fromEntries(Object.values(one.fields).filter((field) => field.name === one.softDelete || field.rules?.nowOnUpdate === true).map((field) => [field.name, field.now!()]))
          const row = await store.update({ tx, kayan: one.name, id: ctx.data.id, data, where })
          ctx = { ...ctx, data: row, dataAfter: snapshot(row) }
        } else ctx = await (step as OperationStep)(ctx, tools as never)
      }
      if (operation.effect !== 'read') {
        const final = kind === 'updateMany' || kind === 'deleteMany' ? ctx.data : await project({ one, row: ctx.data, scope, output })
        if (operation.afterCommit.length) {
          const committed = { ...ctx }
          scope.afterCommit.push(async () => {
            const next = { ...scope, tx: undefined, store: undefined, afterCommit: [], lifetime: undefined }
            const after = { ...tools, kayans: bound(next), of: of(next, false), store: undefined }
            for (const step of operation.afterCommit) await (step as OperationStep)(committed, after as never)
          })
        }
        return final
      }
      const mask = (row: Row) => projectReadableFields({ kayan: one, row, actor: scope.actor })
      const visible = kind === 'findOne' ? await mask(ctx.data) : kind === 'find' ? { ...ctx.data, docs: await Promise.all((ctx.data.docs as Row[]).map(mask)) } : ctx.data
      return output ? validated(output, visible) : visible
    }
    if (operation.effect === 'read') {
      const result = await run(scope.tx)
      if (outer?.tx !== undefined) outer.afterCommit.push(...scope.afterCommit)
      return result
    }
    if (operation.beforeTransaction.length) {
      const outside = { ...scope, store: undefined, tx: undefined, afterCommit: [], lifetime: undefined }
      let ctx: Ctx = { kayan: one, data, actor: scope.actor, user: scope.actor, context: scope.context, tx: undefined }
      const tools = { operation: name, schema, output: shape.row, kind, effect: operation.effect, kayans: bound(outside), of: of(outside, false), catalog }
      for (const step of operation.beforeTransaction) ctx = await (step as OperationStep)(ctx, tools as never)
      data = ctx.data
    }
    if (outer?.tx !== undefined) {
      const result = await run(outer.tx)
      outer.afterCommit.push(...scope.afterCommit)
      return result
    }
    let result: unknown
    try { result = await store.transaction(run) } finally { if (scope.lifetime) scope.lifetime.settled = true }
    for (const after of scope.afterCommit) {
      try { await after() } catch (cause) { throw new AfterCommitError(result, cause) }
    }
    return result
  }
  const calls = bound()
  const built = Object.fromEntries(resolved.map((one) => [one.name, { name: one.name, fields: one.fields, operations: calls[one.name]!, targets: { service: { operations: calls[one.name] }, [one.schema]: { schemas: shapes.get(one.name) }, [one.store]: { table: (stores.get(one.store) as Store & { tables: Record<string, unknown> }).tables[one.name] } } }]))
  const globalNames = new Set(global.map((one) => one.name))
  const asas = {
    targets, catalog,
    kayan: Object.fromEntries(Object.entries(built).filter(([name]) => !globalNames.has(name))),
    global: Object.fromEntries(Object.entries(built).filter(([name]) => globalNames.has(name))),
    connect: async () => { for (const store of stores.values()) await store.connect() },
    destroy: async () => { for (const store of stores.values()) await store.destroy() },
  }
  resolvedKayans.set(asas, Object.fromEntries(resolved.map((one) => [one.name, one])))
  return asas
}
