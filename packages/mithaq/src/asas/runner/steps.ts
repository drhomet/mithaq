import { isRef } from '../../mithaq/user.ts'
import { declaredFieldAccess } from '../../mithaq/rows.ts'
import type { InferInput, InferOutput, StandardSchemaIssue, StandardSchemaV1 } from '../../mithaq/standard-schema.ts'
import type { BoundOf } from './write.ts'
import type { Where } from '../../mithaq/where.ts'
import type { LabelFunction, Localized, ResolvedField, ResolvedKayan, RuntimeField, ServiceOf } from '../../mithaq/types.ts'
import type { RawStepStore, StepStore, Store } from '../../mithaq/language.ts'
import { providerOf } from '../../base/rules.ts'
import { invalid } from './errors.ts'
import { snapshot } from './runtime.ts'
import { rawStepStore } from './store.ts'

/**
 * What the caller passed, plus the three keys the runner keeps. `Extra` is the service target's
 * `context`, so a project reads its own keys typed. Held in an `AsyncLocalStorage`, so nested writes are counted.
 */
export type Context<Extra extends Record<string, unknown> = Record<string, unknown>> = {
  /** How many writes deep this one is. The runner raises it by one. */
  depth: number
  /** What started the write. A call in the app is `local`. */
  source: string
  /** `${kayan}.${operation}` per write, so one past the cap can name its way in. */
  chain: string[]
} & Extra

/** What a step is handed. No `db`: a step writes through `ctx.tx`, so it cannot land outside the list's transaction. */
export type Ctx<
  Data = Record<string, unknown>,
  Actor = unknown,
  Tx = unknown,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = {
  kayan: ResolvedKayan
  /** The write's values, and after the store step the row that was written. */
  data: Data
  /** Whoever the write was given, or null. */
  actor: Actor
  /** Same user as `actor`, named like access callbacks. */
  user: Actor
  /** The row loaded before an update or delete; `undefined` in `beforeTransaction`, which runs before the load. */
  dataBefore?: Readonly<Record<string, unknown>>
  /** The persisted row currently known to the runner. */
  dataAfter?: Readonly<Record<string, unknown>>
  /** The store's transaction. Every write in the list goes through it. */
  tx: Tx
  context: Context<Extra>
  /**
   * The active organization the operation is scoped to, for a step that keeps something per
   * organization. `undefined` on a shared kayan, under a read's `tenant` option, which reaches
   * past one organization, and where the language has no tenant target. Only a copy: the runner
   * puts it back after every step and scopes from the session, so rewriting it moves nothing.
   */
  readonly tenant?: string
}

/** The keys the project put on the service target's `context`, or the open record where it put none. */
export type ContextOf<Service> = Service extends { context: infer Extra extends Record<string, unknown> }
  ? Extra
  : Record<string, unknown>

/** What a step of this project is handed: `Ctx` with the project's context filled in. */
export type CtxOf<Service, Data = Record<string, unknown>, Actor = unknown, Tx = unknown> =
  Ctx<Data, Actor, Tx, ContextOf<Service>>

/** The audit sink the `audit` step calls before commit. */
export type AuditHandler<Actor = unknown, Tx = unknown> = (entry: {
  context: Context
  effect: OperationEffect
  kayan: ResolvedKayan
  operation: string
  dataBefore?: Readonly<Record<string, unknown>>
  dataAfter: unknown
  store?: Pick<Store, 'insert' | 'remove' | 'update'>
  tx?: Tx
  user: Actor | null
}) => void | Promise<void>

export type CommonTools<Kayans = unknown, Actor = unknown, Tx = unknown> = {
  /** The key this list sits under in the `operations` record. */
  operation: string
  /** The shape this operation parses against: its validate function's, or the derived one. */
  schema: StandardSchemaV1
  /** Final row boundary, applied after every step so public row types are proved. */
  output: StandardSchemaV1
  /** Custom output schemas are public contracts and run after masking. */
  publicOutput?: StandardSchemaV1
  /** Managed nested calls bound to the runner's current user, context and transaction. */
  kayans: Kayans
  /** Optional audit sink configured on the service target. */
  audit?: AuditHandler<Actor, Tx>
  /** Every permission key this project has, as `asas.catalog` publishes it; empty where none was handed over, which refuses every key. */
  catalog: readonly string[]
}

/** What a read step can do: run the managed read fetcher. No write store exists. */
export type ReadTools<Kayans = unknown, Actor = unknown, Tx = unknown> = CommonTools<Kayans, Actor, Tx> & {
  /** The public access callback this operation uses. */
  effect: 'read'
  /** What the list's managed read step does: one row, or a page of them. */
  kind: ReadMode
  /** Managed read fetcher, present only for read steps. */
  read: (data: unknown) => Promise<unknown>
  /** One kayan's read operations out of `kayans`, found by the declaration rather than by its name. */
  of: BoundOf<'read'>
}

/** What a write step can do: call the protected writes already bound to a transaction. */
export type WriteTools<Kayans = unknown, Actor = unknown, Tx = unknown> = CommonTools<Kayans, Actor, Tx> & {
  /** The public access callback this operation uses. */
  effect: Exclude<OperationEffect, 'read'>
  /** What the list's store step does. A bulk word means `bulk` runs the list. */
  kind: 'deleteMany' | 'insert' | 'remove' | 'update' | 'updateMany'
  /** One kayan's bound operations, found and typed by the declaration handed in, so a step imports the kayan it calls. */
  of: BoundOf<'write'>
  /** Bound store calls, sealed to the active organization; no adapter or client is exposed. */
  store: StepStore
  /** Access constraint already granted for this operation, if access returned one. */
  where?: Where
  /** The keys the caller's own object carried, read before any step ran, so validation can tell the runner's values from the caller's. */
  sent?: readonly string[]
  /** The shape a global's update parses against when there is no row yet, and a publish of a never-published row. */
  insertSchema?: StandardSchemaV1
  /** The shape a draft save parses against and a draft is read back through: every field's kind, nullable and optional, no rules. */
  draftSchema?: StandardSchemaV1
  /** The draft save's shape where it differs from `draftSchema`: a kind may check a written value harder than a stored one. */
  draftWrite?: StandardSchemaV1
  /** What a draft save of an insert with its own `input` parses against: that input over the draft shape. */
  draftInput?: StandardSchemaV1
  /** Runs the single-row write once per row the `where` matched, in this transaction; present only for a bulk list. */
  many?: (data: Record<string, unknown>) => Promise<BulkResult>
}

/**
 * What a bulk operation answers. All or nothing in one transaction, so no row is in `errors` because
 * its write failed; `errors` lists the unpublished rows the `where` names, for an actor who may read drafts.
 */
export type BulkResult<Doc = Record<string, unknown>> = {
  docs: Doc[]
  errors: { id: unknown; message: string }[]
}

/** The runner keeps string names on its side of the step boundary; adapters never receive declarations. */
export type RuntimeWriteTools<Kayans = unknown, Actor = unknown, Tx = unknown> = Omit<WriteTools<Kayans, Actor, Tx>, 'store'> & { store: RawStepStore }

export type Tools = ReadTools | WriteTools

/** The positions `resolve` checks: the store and read steps, each named after the `Store` method it calls. */
export type Seal =
  | 'audit'
  | 'count'
  | 'defaults'
  | 'deleteMany'
  | 'find'
  | 'findOne'
  | 'insert'
  | 'remove'
  | 'update'
  | 'updateMany'
  | 'validate'
  | 'findVersions'
  | 'findVersionByID'
  | 'restoreVersion'

// A phantom, never set or read at runtime, so a list says its effect in the type.
type Holds<Name extends Seal> = { readonly __seal: Name }

// A step returns the context it was given, so the output is read at the open record.
type AnyStep<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Output extends Record<string, unknown> = Input,
  Actor = unknown,
  Tx = unknown,
  GivenTools = Tools,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = {
  (ctx: Ctx<Input, Actor, Tx, Extra>, tools: GivenTools): Ctx<Output, Actor, Tx> | Promise<Ctx<Output, Actor, Tx>>
}
export type CommonStep<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Output extends Record<string, unknown> = Input,
  Actor = unknown,
  Tx = unknown,
  Kayans = unknown,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = AnyStep<Input, Output, Actor, Tx, ReadTools<Kayans, Actor, Tx> | WriteTools<Kayans, Actor, Tx>, Extra>
export type ReadStep<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Output extends Record<string, unknown> = Input,
  Actor = unknown,
  Tx = unknown,
  Kayans = unknown,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = AnyStep<Input, Output, Actor, Tx, ReadTools<Kayans, Actor, Tx>, Extra>
export type WriteStep<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Output extends Record<string, unknown> = Input,
  Actor = unknown,
  Tx = unknown,
  Kayans = unknown,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = AnyStep<Input, Output, Actor, Tx, WriteTools<Kayans, Actor, Tx>, Extra>
export type Step<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Output extends Record<string, unknown> = Input,
  Actor = unknown,
  Tx = unknown,
  Kayans = unknown,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = CommonStep<Input, Output, Actor, Tx, Kayans, Extra>
/** Any of the three, at one context. `never` is the bound a resolved list is stored at, which every project's list fits. */
export type OperationStep<Extra extends Record<string, unknown> = Record<string, unknown>> =
  | Step<Record<string, unknown>, Record<string, unknown>, unknown, unknown, unknown, Extra>
  | ReadStep<Record<string, unknown>, Record<string, unknown>, unknown, unknown, unknown, Extra>
  | WriteStep<Record<string, unknown>, Record<string, unknown>, unknown, unknown, unknown, Extra>

/** The six shapes a schema target derives from a kayan's fields, each a Standard Schema. */
export type DerivedShapes<Schema extends StandardSchemaV1 = StandardSchemaV1> = {
  /** Every field, with the id optional: what a list that makes the row parses. */
  create: Schema
  /** The same shape partial, with the id required: what a list that finds it parses. */
  update: Schema
  /** The id alone and no other key: what `delete` parses, and what a version is addressed by. */
  id: Schema
  /** The `id` shape with an optional `depth`: what `findByID` parses. */
  byID: Schema
  /** The row that comes back, every column present. */
  row: Schema
  /** What a list read or a bulk with no schema of its own parses: the page query and a bulk's `data`. */
  list: Schema
  /** What a draft save parses and a draft is read back through: every field's kind alone, nullable and optional. */
  draft?: Schema
  /** What a draft save parses where it differs from `draft`: each kind checks a written value as a write does. */
  draftWrite?: Schema
}

/**
 * One schema target's derivation as a type: a target extends this with `shapes` reading `FieldsOf<this>`.
 * Needed because a conditional type cannot instantiate `derive`'s generic signature.
 */
export interface Derives {
  /** One kayan's fields, `unknown` so filling it in replaces rather than narrows it. */
  readonly fields: unknown
  /** The six shapes that target derives from them. */
  readonly shapes: DerivedShapes
}

/** The fields a target reads off itself, at the constraint every field record has. */
export type FieldsOf<Of extends Derives> = Extract<Of['fields'], Record<string, RuntimeField>>

/** The shapes one schema target returns for one kayan's fields, typed by that target. */
export type DerivedSchemas<
  Schema = unknown,
  Fields extends Record<string, RuntimeField> = Record<string, RuntimeField>,
> = Schema extends { derives?: infer Of extends Derives }
  ? (Of & { readonly fields: Fields })['shapes']
  : DerivedShapes

/** The shapes the language's own schema target derives. */
export type SchemasOf<L, Fields extends Record<string, RuntimeField> = Record<string, RuntimeField>> =
  L extends { targets: infer Targets }
    ? ServiceOf<L> extends { schema: infer Name }
      ? Name extends keyof Targets
        ? DerivedSchemas<Targets[Name], Fields>
        : DerivedShapes
      : DerivedShapes
    : DerivedShapes

export type OperationEffect = 'create' | 'read' | 'update' | 'delete'
/** What a managed read returns: one row, a page, `{ totalDocs }`, or one version or a page of them. */
export type ReadMode = 'count' | 'many' | 'one' | 'version' | 'versions'
type RowOutput = StandardSchemaV1<unknown, Record<string, unknown>>

/** A list of all read steps or all write steps; a mixed one is refused where it is written. */
export type OperationSteps<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> =
  | readonly ReadStep<Data, Record<string, unknown>, unknown, unknown, unknown, Extra>[]
  | readonly WriteStep<Data, Record<string, unknown>, unknown, unknown, unknown, Extra>[]

// The assertion checks the list stays inside `OperationStep<never>`, not the direction it names.
export const atEffect = <Held extends OperationStep<never>>(list: readonly OperationStep<never>[]): readonly Held[] =>
  list as readonly Held[]

/** The lists a steps function is handed, one per operation the language has. */
export type Lists = Record<string, OperationSteps>

/** The steps of one declaration, whether it was written as a list or as a function. */
export type StepsOf<Declaration> = Declaration extends { steps: infer Given }
  ? Given extends (...args: never[]) => infer Returned
    ? Returned
    : Given
  : never

/**
 * What a steps or operations function is handed: the shipped lists by operation name, the sealed steps
 * by `Store` method, and the service target's three slots: `afterSteps: ({ afterSteps }) => [...afterSteps, notify]`.
 */
export type OperationDefaults<Given = Lists> = {
  operations: Given
  steps: Sealed
  beforeSteps: readonly CommonStep[]
  afterSteps: readonly CommonStep[]
  afterCommit: readonly CommonStep[]
}

/** One of the three lists an operation may write beside `steps`, at the project's context. */
export type SlotSteps<Given = Lists, Extra extends Record<string, unknown> = Record<string, unknown>> =
  | OperationSteps<Record<string, unknown>, Extra>
  | ((defaults: OperationDefaults<Given>) => OperationSteps<Record<string, unknown>, Extra>)

/** An operation: data, or a function of the defaults that returns data, run once where it is declared. */
export type OperationDeclaration<
  Given = Lists,
  Schemas = DerivedShapes,
  Locale extends string = string,
  Input = never,
  /** What this operation parses, which is `ctx.data` in every step. */
  Data extends Record<string, unknown> = Record<string, unknown>,
  /** The keys the project declared on its runner's `context`. */
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** The shape this operation parses, once, before the first step. Without it, the shape its store or read step implies. */
  input?: (schemas: Schemas) => StandardSchemaV1
  /** The list: exactly one store or managed read step and whatever surrounds it. `defaults`, `validate` and `audit` here are refused. */
  steps: OperationSteps<Data, Extra> | ((defaults: OperationDefaults<Given>) => OperationSteps<Data, Extra>)
  /** Outside the transaction, before it opens: no lock is held and `ctx.dataBefore` is `undefined`. Not on a read. */
  beforeTransaction?: SlotSteps<Given, Extra>
  /** Inside the transaction after the list, where `audit` runs. Replaces the service target's for this operation. */
  afterSteps?: SlotSteps<Given, Extra>
  /** Outside the transaction, after the commit, where a webhook or an email belongs. A throw leaves the write standing and answers `AfterCommitError`. */
  afterCommit?: SlotSteps<Given, Extra>
  /** A public output contract, parsed after field masking. */
  output?: RowOutput | ((schemas: Schemas) => RowOutput)
  /** On a bulk operation, the kayan's single-row operation it runs on each matched row, handed `data` and the row's id. Without it, `update` or `delete`. */
  each?: string
  /** One entry per target with something to say about this operation, by the target's name: `targets.<screen>` is what that screen's button asks for. */
  targets?: Readonly<Record<string, OperationScreen<Input> | undefined>>
}

/** What a screen's button over one of a kayan's own operations asks for. */
export type OperationScreen<Input = RuntimeField> = {
  /**
   * What the button's dialog asks for beyond the row's id, as fields. Chrome, not the contract:
   * `input` stays the shape; a field it names no key for fails the build.
   */
  readonly fields?: Readonly<Record<string, Input>>
}

/** A declaration whatever lists its steps function was typed against. */
export type AnyOperation = {
  input?: (schemas: never) => StandardSchemaV1
  // `never` is the widest a step's `ctx.data` and `ctx.context` can be asked for, since
  // the parameter is contravariant, so every narrower list fits.
  steps: OperationSteps<never, never> | ((defaults: never) => OperationSteps<never, never>)
  /** The three slots at the same bound `steps` above is held at, and for the same reason. */
  beforeTransaction?: OperationSteps<never, never> | ((defaults: never) => OperationSteps<never, never>)
  afterSteps?: OperationSteps<never, never> | ((defaults: never) => OperationSteps<never, never>)
  afterCommit?: OperationSteps<never, never> | ((defaults: never) => OperationSteps<never, never>)
  output?: RowOutput | ((schemas: never) => RowOutput)
  each?: string
  targets?: Readonly<Record<string, OperationScreen | undefined>>
}

export type Operations<Given = Lists, Schemas = DerivedShapes, Locale extends string = string, Input = never> = {
  [operation: string]: OperationDeclaration<Given, Schemas, Locale, Input> | undefined
}

/** An operation after `resolve` has run its steps function and read its effect. */
export type ResolvedOperation = {
  /** The shape function this operation named, held until `build` has the derived shapes. */
  input?: (schemas: never) => StandardSchemaV1
  /** The lists, at the context bound every project's own is inside. */
  steps: readonly OperationStep<never>[]
  /** The four lists around the steps, each already merged with the language's. */
  beforeTransaction: readonly OperationStep<never>[]
  beforeSteps: readonly OperationStep<never>[]
  afterSteps: readonly OperationStep<never>[]
  afterCommit: readonly OperationStep<never>[]
  effect: OperationEffect
  mode?: ReadMode
  /** Always a schema: an `output` written as a function is resolved at build. */
  output?: RowOutput
  /** On a bulk operation, the single-row operation it runs per row. */
  each?: string
  /** What each target says about this operation, as the declaration wrote it. */
  targets?: Readonly<Record<string, OperationScreen | undefined>>
}

// A map only this module writes: a tag on the function would let any function buy
// the position that skips parsing.
const seals = new WeakMap<OperationStep<never>, Seal>()
// The derived shapes exist only after `resolve`, so the function waits for `build`.
const outputs = new WeakMap<ResolvedOperation, (schemas: never) => RowOutput>()

/** A step is compared by the seal it carries, so a validate function's step is one too. */
const seal = <S extends OperationStep<never>>(name: Seal, step: S) => {
  seals.set(step, name)
  return step
}

/** What position this step holds, or nothing at all for a step of the app's own. */
export const sealOf = (step: OperationStep<never>): Seal | undefined => seals.get(step)

// Each copy of mithaq in the process lists its seals here, so a step a second install sealed is
// named rather than miscounted. Anything can write this map, so its answer only ever refuses.
const copies: Map<string, (step: unknown) => unknown> = ((globalThis as Record<symbol, unknown>)[Symbol.for('mithaq.copies')] ??= new Map()) as never
copies.set(import.meta.url, (step) => seals.get(step as OperationStep<never>))

/** Where the other copy of mithaq that sealed this step was loaded from, if one did. */
export const foreignCopyOf = (step: OperationStep<never>): string | undefined =>
  [...copies].find(([url, of]) => url !== import.meta.url && of(step))?.[0]

/** Hold an operation's `output` function until `build` has the derived shapes. */
export const holdOutput = (operation: ResolvedOperation, of: (schemas: never) => RowOutput) => {
  outputs.set(operation, of)
}

/** The schema function this operation's `output` carries, or nothing for a bare schema. */
export const outputOf = (operation: ResolvedOperation) => outputs.get(operation)

/** The list's store step, the one that makes, changes or removes the row. */
export const storeSeals: readonly Seal[] = ['insert', 'remove', 'update']
export const readSeals: readonly Seal[] = ['count', 'find', 'findOne']
// Apart from `storeSeals`: `write` reads that list to place its single-row guards, which
// a bulk list never reaches.
export const bulkSeals: readonly Seal[] = ['deleteMany', 'updateMany']
// Each its own acting step, so each is its own permission key.
export const versionSeals: readonly Seal[] = ['findVersions', 'findVersionByID', 'restoreVersion']

/** The read no actor holds, which a secret column carries. One function, so a column is known by it. */
export const neverRead = () => false

// An audit row outlives the column and is read by whoever reads the log, so no secret goes in it.
const withoutSecrets = <Data>(kayan: ResolvedKayan, data: Data): Data =>
  data && typeof data === 'object'
    ? Object.freeze(Object.fromEntries(
      Object.entries(data).filter(([name]) => declaredFieldAccess(kayan.fields[name]?.access?.read) !== neverRead),
    )) as Data
    : data

/**
 * The audit step a project lists in the service target's `afterSteps`. A step after the store
 * that changes persistence must return the persisted row in `ctx.data`. Listing it without a sink fails the build.
 */
export const audit = seal('audit', async (ctx: Ctx, tools?: Tools) => {
  if (!tools) return ctx
  await tools.audit?.({
    context: ctx.context,
    effect: tools.effect,
    kayan: ctx.kayan,
    operation: tools.operation,
    dataBefore: withoutSecrets(ctx.kayan, ctx.dataBefore),
    dataAfter: withoutSecrets(ctx.kayan, ctx.dataAfter ?? snapshot(ctx.data) ?? ctx.data),
    store: 'store' in tools ? rawStepStore(tools.store) : undefined,
    tx: ctx.tx,
    user: ctx.user,
  })
  return ctx
}) as CommonStep & Holds<'audit'>

// A row's filter and a default read the same reference off the same actor, so they agree.
const defaultOf = (field: ResolvedField, ctx: Ctx, tools: Pick<WriteTools, 'kind' | 'operation'>) => {
  const value = field.rules?.defaultValue
  // Copied whole, so a step changing one row's list or object never changes the next row's default.
  if (!isRef(value)) return typeof value === 'object' && value !== null ? structuredClone(value) : value
  if (!ctx.user) {
    throw new Error(
      `Kayan "${ctx.kayan.name}" operation "${tools.operation}" field "${field.name}" defaults to "user.${value.$user}", and this write was given no actor. Pass one: create(data, { actor }).`,
    )
  }
  // An own key only: a JSON reference could name `__proto__`.
  const actor = ctx.user as Record<string, unknown>
  const found = Object.hasOwn(actor, value.$user) ? actor[value.$user] : undefined
  // A key the actor does not carry would otherwise be written as null while the row filter
  // naming it refuses to run.
  if (found === null || found === undefined) {
    throw new Error(
      `Kayan "${ctx.kayan.name}" operation "${tools.operation}" field "${field.name}" defaults to "user.${value.$user}", and the actor carries nothing there.`,
    )
  }
  return found
}

/**
 * Fills what the write left out. On a list that only changes a row only `nowOnUpdate` fields
 * are filled, or `createdAt` would take the edit's moment. The runner runs it; a list naming it is refused.
 */
export const defaults = seal('defaults', (ctx: Ctx, tools: WriteTools): Ctx => {
  const data = { ...ctx.data }
  const insert = tools.kind === 'insert'
  for (const field of Object.values(ctx.kayan.fields)) {
    if (data[field.name] !== undefined) continue
    if (field.rules?.[insert ? 'defaultNow' : 'nowOnUpdate'] === true) data[field.name] = field.now!()
    else if (insert) {
      const value = defaultOf(field, ctx, tools)
      if (value !== undefined) data[field.name] = value
    }
  }
  return { ...ctx, data }
}) as WriteStep & Holds<'defaults'>

// The refusal's params carry each path and rule, so a client need not parse the English message.
const issuesOf = (issues: readonly StandardSchemaIssue[]) =>
  issues.map((issue) => ({
    path: (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.'),
    message: issue.message,
    // What a schema said beside its message, such as the node type a rich
    // text value holds that its editor does not.
    ...((issue as { params?: unknown }).params ? { params: (issue as { params?: unknown }).params } : {}),
  }))

/** Every issue as one message, each prefixed by the path it happened at. */
const issueMessage = (issues: readonly StandardSchemaIssue[]) =>
  issuesOf(issues)
    .map(({ message, path }) => (path ? `${path}: ${message}` : message))
    .join('; ')

/** The refusal a list of Standard Schema issues becomes, shared by the parse and the oRPC boundary so every 400 has one shape. */
export const issueRefusal = (issues: readonly StandardSchemaIssue[], vendor = 'unknown') =>
  invalid({
    message: issueMessage(issues) || `The "${vendor}" schema refused the value and reported no issues.`,
    key: 'error.invalid.value',
    params: { issues: issuesOf(issues) },
  })

/** A plain object copied without a prototype, because zod reads an unsent key off the prototype. */
export const withoutPrototype = (value: unknown) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    ? Object.assign(Object.create(null), value)
    : value

/** Validates through Standard Schema's own `validate`, sync or async, never one library's `parse`. */
export const validated = async (schema: StandardSchemaV1, value: unknown) => {
  const result = await schema['~standard'].validate(withoutPrototype(value))
  if (result.issues) throw issueRefusal(result.issues, schema['~standard'].vendor)
  return result.value
}

/**
 * The runner's parse. A field the client does not supply is absent from the wire shape, so a value the
 * runner put there is set aside, the rest parsed, and the set-aside values put back. `id` is never set aside.
 */
export const parse = async ({ schema, ctx, tools }: { schema: StandardSchemaV1; ctx: Ctx; tools: ParseTools }): Promise<Ctx> => {
  const on = tools.kind === 'insert' ? 'create' : tools.kind === 'update' ? 'update' : undefined
  if (!on) return { ...ctx, data: (await validated(schema, ctx.data)) as Record<string, unknown> }
  const sent = tools.sent ?? []
  const server: Record<string, unknown> = Object.create(null)
  const client: Record<string, unknown> = Object.create(null)
  for (const [name, value] of Object.entries(ctx.data)) {
    const field = Object.hasOwn(ctx.kayan.fields, name) ? ctx.kayan.fields[name] : undefined
    const mine = !!field && name !== 'id' && !sent.includes(name) && providerOf(field, on) !== 'client'
    ;(mine ? server : client)[name] = value
  }
  return { ...ctx, data: { ...((await validated(schema, client)) as Record<string, unknown>), ...server } }
}

export type ParseTools = Pick<CommonTools, 'schema'> &
  Partial<Pick<WriteTools, 'sent'>> & { kind?: ReadMode | WriteTools['kind'] }

/** A marker, refused by name in a list: the parse is the runner's own. The shape it carried is the operation's `input`. */
export const validate = seal('validate', ((): unknown => validate) as unknown as CommonStep) as CommonStep &
  Holds<'validate'> &
  ((of?: unknown) => CommonStep)

// The derived shapes are strict, so no undeclared key reaches the store.
const columns = (ctx: Ctx) =>
  Object.fromEntries(Object.entries(ctx.data).filter(([name]) => name in ctx.kayan.fields))

/** Make the row, and what came back is what the rest of the list sees. */
export const insert = seal('insert', async (ctx: Ctx, tools: WriteTools) => {
  const row = await tools.store.insert({ tx: ctx.tx, kayan: ctx.kayan, data: columns(ctx) })
  return { ...ctx, data: { ...ctx.data, ...row }, dataAfter: snapshot(row) }
}) as WriteStep & Holds<'insert'>

/** Change the one row the id names; everything else in `data` is the change. An id alone is refused with a 400. */
export const update = seal('update', async (ctx: Ctx, tools: WriteTools) => {
  // The runner sets `kind` to `insert` for a global's first update, so `defaults` fills create-time defaults too.
  if (tools.kind === 'insert') return insert(ctx, tools)
  const values = columns(ctx)
  delete values.id
  if (!Object.keys(values).length) {
    throw invalid({
      message: `Kayan "${ctx.kayan.name}" operation "${tools.operation}" reached the update step with nothing but an id, so there is nothing to change.`,
      key: 'error.invalid.empty_update',
      params: { kayan: ctx.kayan.name, operation: tools.operation },
    })
  }
  const row = await tools.store.update({ tx: ctx.tx, kayan: ctx.kayan, id: ctx.data.id, data: values, where: tools.where })
  return { ...ctx, data: { ...ctx.data, ...row }, dataAfter: snapshot(row) }
}) as WriteStep & Holds<'update'>

/** Remove the one row the id names, and hand back what was removed. */
export const remove = seal('remove', async (ctx: Ctx<Record<string, unknown>>, tools: WriteTools) => {
  const data = await tools.store.remove({ tx: ctx.tx, kayan: ctx.kayan, id: ctx.data.id, where: tools.where })
  return { ...ctx, data, dataAfter: snapshot(data) }
}) as WriteStep & Holds<'remove'>

// The seal and nothing else: `bulk` supplies `tools.many`.
const manyStep = async (ctx: Ctx, tools: WriteTools): Promise<Ctx> => {
  if (!tools.many) {
    throw new Error(
      `Kayan "${ctx.kayan.name}" operation "${tools.operation}" has a bulk step and no bulk runner, so nothing would be written.`,
    )
  }
  return { ...ctx, data: (await tools.many(ctx.data)) as unknown as Record<string, unknown> }
}

/**
 * Change every row the `where` matches. A wrapper of its own, because a seal is keyed on
 * the step object and two seals on one object would answer for both.
 */
export const updateMany = seal('updateMany', (ctx: Ctx, tools: WriteTools) => manyStep(ctx, tools)) as WriteStep &
  Holds<'updateMany'>
/** Remove every row the `where` matches, or mark it where the language names a soft delete. */
export const deleteMany = seal('deleteMany', (ctx: Ctx, tools: WriteTools) => manyStep(ctx, tools)) as WriteStep &
  Holds<'deleteMany'>

const managedRead = async (ctx: Ctx, tools: ReadTools): Promise<Ctx<Record<string, unknown>>> => {
  const data = await tools.read(ctx.data) as Record<string, unknown>
  return { ...ctx, data, dataAfter: snapshot(data) }
}

/** One row, the way `Store.find` with a limit of one answers for it. */
export const findOne = seal('findOne', (ctx: Ctx, tools: ReadTools) => managedRead(ctx, tools)) as ReadStep &
  Holds<'findOne'>
/** A paginated page of rows. */
export const find = seal('find', (ctx: Ctx, tools: ReadTools) => managedRead(ctx, tools)) as ReadStep &
  Holds<'find'>
/** How many rows the `where` matches, as `{ totalDocs }`, through the store's own `count` where it has one. */
export const count = seal('count', (ctx: Ctx, tools: ReadTools) => managedRead(ctx, tools)) as ReadStep &
  Holds<'count'>

/** A page of one kayan's versions, read through the row's own read access. */
export const findVersions = seal('findVersions', (ctx: Ctx, tools: ReadTools) => managedRead(ctx, tools)) as ReadStep &
  Holds<'findVersions'>
/** One version by its own id. */
export const findVersionByID = seal('findVersionByID', (ctx: Ctx, tools: ReadTools) => managedRead(ctx, tools)) as ReadStep &
  Holds<'findVersionByID'>
/** Write one version back to its row; the runner turns it into the row's own update before anything is asked. */
export const restoreVersion = seal('restoreVersion', (ctx: Ctx, tools: WriteTools) => update(ctx, tools)) as WriteStep &
  Holds<'restoreVersion'>

const sealedSteps = { audit, count, defaults, deleteMany, find, findOne, findVersionByID, findVersions, insert, remove, restoreVersion, update, updateMany, validate }
export type Sealed = Omit<typeof sealedSteps, 'audit' | 'defaults' | 'validate'>

/** The shipped lists a kayan spreads into its own `targets.service.operations`: `operations: { ...defaultOperations, archive }`. */
export const defaultOperations = {
  create: { steps: [insert] },
  update: { steps: [update] },
  delete: { steps: [remove] },
  find: { steps: [find] },
  findByID: { steps: [findOne] },
  // A list like any other, so a kayan overrides it or leaves it out.
  count: { steps: [count] },
  // No default is filled for a bulk: each row's single-row write fills its own.
  updateMany: { steps: [updateMany] },
  deleteMany: { steps: [deleteMany] },
} satisfies Operations

// A global is found by being the only row, so its read takes a depth alone.
const globalRead: StandardSchemaV1<{ depth?: number }> = {
  '~standard': {
    version: 1,
    vendor: 'mithaq',
    validate: (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { issues: [{ message: 'Invalid input: expected object' }] }
      const stray = Object.keys(value).filter((key) => key !== 'depth')
      if (stray.length) return { issues: stray.map((key) => ({ message: `Unrecognized key: "${key}"` })) }
      return { value: 'depth' in value ? { depth: value.depth as number } : {} }
    },
  },
}

/** The two lists a global spreads into its own `targets.service.operations`: `findOne` and `update`. */
export const defaultGlobalOperations = {
  // `update` first, the order a global's two are published in.
  update: { steps: [update] },
  findOne: { input: () => globalRead, steps: [findOne] },
} satisfies Operations

/** The lists the shipped record carries, as a steps function is handed them. */
export type DefaultLists = { [Name in keyof typeof defaultOperations]: StepsOf<(typeof defaultOperations)[Name]> }

/** Any operations record, whatever lists its steps functions were typed against. */
type DeclaredOperations = Record<string, AnyOperation | undefined>

/** The shipped lists by name, which is what a steps function is handed as `operations`. */
const defaultLists: Lists = Object.fromEntries(Object.entries(defaultOperations).map(([name, { steps }]) => [name, steps as OperationSteps]))

/** The four keys an operation writes a list under, which is where a function may sit. */
const listKeys = ['steps', 'beforeTransaction', 'afterSteps', 'afterCommit'] as const

/** A step of the runner's own three lists. `serviceTarget` narrows it to the context the same target declares. */
export type ProjectStep = Step<Record<string, unknown>, Record<string, unknown>, unknown, unknown, unknown, never>

/** The language's own three lists, as an operation's function of one is handed them. */
export type LanguageSlots = {
  beforeSteps?: readonly ProjectStep[]
  afterSteps?: readonly ProjectStep[]
  afterCommit?: readonly ProjectStep[]
}

// Every steps function runs once, here, so what `resolve` seals is data.
export const resolveOperations = (
  declared: DeclaredOperations | undefined,
  slots: LanguageSlots = {},
): Record<string, AnyOperation> => {
  const given = {
    operations: defaultLists,
    steps: sealedSteps,
    beforeSteps: slots.beforeSteps ?? [],
    afterSteps: slots.afterSteps ?? [],
    afterCommit: slots.afterCommit ?? [],
  } as never
  if (!declared) return {}
  const resolved: Record<string, AnyOperation> = Object.create(null)
  for (const [name, declaration] of Object.entries(declared)) {
    if (declaration === undefined) continue
    const held = declaration as Record<string, unknown>
    const ran = Object.fromEntries(
      listKeys
        .filter((key) => typeof held[key] === 'function')
        .map((key) => [key, (held[key] as (defaults: never) => OperationSteps)(given)]),
    )
    resolved[name] = Object.keys(ran).length ? { ...declaration, ...ran } : declaration
  }
  return resolved
}
