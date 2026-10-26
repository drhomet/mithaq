import { assertNoOptions } from './runner/lifecycle.ts'
import { refusePlacement } from './placement.ts'
import { rowsOf } from '../mithaq/rows.ts'
import { accessReport, actor, actorPermissions, authActor, isAuthDeclaration, markAdminAnswer, type AssignedResolver, type AuthStrategy, type AuthStrategyResult, type KayanAuth, type LocalAuthPermissions } from './actor.ts'
import { betterAuthStrategy } from '../auth/better-auth/index.ts'
import { holdsVerificationSteps, isLocalAuthTarget, localAuthStrategy, type LocalAuthActor, type LocalAuthOptions, type ProtectedLocalField } from '../auth/local/index.ts'
import { bulkSeals, outputOf, sealOf, storeSeals, type AuditHandler, type DerivedShapes, type OperationEffect, type OperationScreen, type WriteStep, type RuntimeWriteTools as WriteTools } from './runner/steps.ts'
import { running } from './runner/runtime.ts'
import { tenancy } from './runner/tenant.ts'
import { assertWhere, defaultAccess, defaultAuthorize, projectReadableFields, referencingIds, restrictingPointers, type Authorize, type Pointer, type Globals, type ManagedAdmin, type Options, type Procedures, type Row, type Writes } from './runner/write.ts'
import { combineWhere } from '../mithaq/where.ts'
import type { ReaderMap } from './runner/read.ts'
import { bulk, read as readers, write, type ServiceTarget } from '../service/index.ts'
import { invalid } from './runner/errors.ts'
import { assertMaxBodyBytes, boundedBody } from './http/fetch.ts'
import { fieldlessOperation, keepOperationKeys } from '../rbac/steps.ts'
import { resolvedKayans, type ActorBoundAccess, type AdminAccess, type Kayan, type RuntimeField, type ResolvedKayan, type ServiceOf } from '../mithaq/types.ts'
import { accessTargetOf, isAccess, isScreen, isService, isStorage, isStore, isTenant, isVersions, serviceKeys, serviceTargetOf, type Language, type Store } from '../mithaq/language.ts'
import type { StandardSchemaV1 } from '../mithaq/standard-schema.ts'
import type { BuiltTables } from '../drizzle/index.ts'
import { screensOf, type ScreenClient } from '../screen/index.ts'
import { messagesOf, type MessageRegistry, type MessagesResolver } from '../mithaq/messages.ts'
import { resolve } from '../mithaq/resolve.ts'
import { defaultMentionSources } from '../rich-text/policy.ts'
import { commentService } from '../rich-text/comments-server.ts'
import { recordStorage, resolveStorage, storageRoutes } from '../storage/storage.ts'

type UniqueNames<List extends readonly Kayan[], Seen = never> = List extends readonly [
  infer Head extends Kayan,
  ...infer Tail extends readonly Kayan[],
]
  ? Head['name'] extends Seen
    ? false
    : UniqueNames<Tail, Seen | Head['name']>
  : true

type BetterAuthServer = Parameters<typeof betterAuthStrategy>[0]['server']

// `unknown`, not `never`, where no kayan carries a provider: a host may still hand
// its own actor to `kayan.<name>.create(data, { actor })`.
type ActorFor<L extends Language, KayanList extends readonly Kayan[]> = [Extract<AuthStrategies<L, KayanList>, AuthStrategy>] extends [never]
  ? unknown
  : Awaited<ReturnType<Extract<Extract<AuthStrategies<L, KayanList>, AuthStrategy>, AuthStrategy>['authenticate']>> extends AuthStrategyResult<infer Result>
    ? Result
    : never

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type FirstArg<Fn> = Fn extends (...args: infer Args) => unknown
  ? Args extends []
    ? never
    : Args[0]
  : never

type UserFromArg<Arg> = Arg extends { user: infer User } ? NonNullable<User> : unknown
type IdFromArg<Arg> = Arg extends { id?: infer Id } ? Id : unknown
type DataFromArg<Arg> = Arg extends { data?: infer Data } ? Data : unknown
type DocFromArg<Arg> = Arg extends { doc?: infer Doc } ? Doc : unknown

type CallbackRequirement<Fn> = [FirstArg<Fn>] extends [never]
  ? never
  : { actor: UserFromArg<FirstArg<Fn>>; data: DataFromArg<FirstArg<Fn>>; doc: DocFromArg<FirstArg<Fn>>; id: IdFromArg<FirstArg<Fn>> }

type AccessRequirement<K> = K extends { access?: infer Access }
  ? NonNullable<Access> extends infer A
    ? '__mithaqAccessActor' extends keyof A
      ? A extends ActorBoundAccess<infer Actor>
        ? { actor: Actor; data: unknown; doc: unknown; id: unknown }
          | CallbackRequirement<A extends { create?: infer Fn } ? NonNullable<Fn> : never>
          | CallbackRequirement<A extends { read?: infer Fn } ? NonNullable<Fn> : never>
          | CallbackRequirement<A extends { update?: infer Fn } ? NonNullable<Fn> : never>
          | CallbackRequirement<A extends { delete?: infer Fn } ? NonNullable<Fn> : never>
        : never
      : never
    : never
  : never

type FieldAccessRequirement<Fields> = Fields extends Record<string, RuntimeField>
  ? Fields[keyof Fields] extends infer Field
    ? Field extends { access?: infer Access }
      ? {} extends Pick<Field, 'access'>
        ? never
        : NonNullable<NonNullable<Access>[keyof NonNullable<Access>]> extends infer Fn
          ? '__mithaqAccessActor' extends keyof NonNullable<Fn>
            ? NonNullable<Fn> extends ActorBoundAccess<infer Actor>
              ? { actor: Actor; data: unknown; doc: unknown; id: unknown }
                | CallbackRequirement<NonNullable<Fn>>
                | ('__mithaqFieldData' extends keyof NonNullable<Fn>
                    ? NonNullable<Fn> extends { __mithaqFieldData: infer Data; __mithaqFieldId: infer Id }
                      ? { actor: Actor; data: unknown; doc: Data; id: Id }
                      : never
                    : never)
              : never
            : never
          : never
      : never
    : never
  : never

type BroadRecord = Record<string, unknown>
type IsUnknown<T> = Equal<T, unknown>
type IsBroadRecord<T> = Equal<T, BroadRecord>
type MatchesDoc<Expected, Actual> = IsUnknown<Expected> extends true
  ? true
  : IsBroadRecord<Expected> extends true
    ? true
    : Equal<Expected, Actual>
type MatchesData<Expected, Actual> = IsUnknown<Expected> extends true
  ? true
  : IsBroadRecord<Expected> extends true
    ? true
    : [Partial<Actual>] extends [Expected]
      ? true
      : false
type MatchesId<Expected, Actual> = IsUnknown<Expected> extends true
  ? true
  : Equal<Expected, Actual>

type MismatchName<One, Required, Actor, L extends Language, KayanList extends readonly Kayan[]> = Required extends { actor: infer Needed; data: infer Data; doc: infer Doc; id: infer Id }
  ? [Actor] extends [never]
    ? One extends { name: infer Name } ? Name : never
    : [Actor] extends [Needed]
      ? One extends Kayan
        ? MatchesDoc<Doc, Row<One['fields'], L, KayanList>> extends true
          ? MatchesData<Data, Row<One['fields'], L, KayanList>> extends true
            ? 'id' extends keyof Row<One['fields'], L, KayanList>
              ? MatchesId<Id, Row<One['fields'], L, KayanList>['id']> extends true
                ? never
                : One extends { name: infer Name } ? Name : never
              : One extends { name: infer Name } ? Name : never
            : One extends { name: infer Name } ? Name : never
          : One extends { name: infer Name } ? Name : never
        : never
      : One extends { name: infer Name } ? Name : never
  : never

type AccessActorMismatch<KayanList extends readonly Kayan[], L extends Language, Actor> = KayanList[number] extends infer One
  ? MismatchName<One, AccessRequirement<One> | (One extends { fields: infer Fields } ? FieldAccessRequirement<Fields> : never), Actor, L, KayanList>
  : never
type AdminAccessRequirement<Auth> = Auth extends { admin?: infer Admin }
  ? NonNullable<Admin> extends { access?: infer Fn }
    ? CallbackRequirement<NonNullable<Fn>>
    : never
  : never
type AdminAccessMismatch<Auth, Actor> = MismatchName<{ name: 'auth.admin.access' }, AdminAccessRequirement<Auth>, Actor, never, never>
type AdminAccessShapeMismatch<Auth> = Auth extends { admin?: infer Admin }
  ? NonNullable<Admin> extends { access: infer Fn }
    ? NonNullable<Fn> extends (...args: infer _Args) => infer Return
      ? Return extends boolean | Promise<boolean>
        ? never
        : 'auth.admin.access'
      : 'auth.admin.access'
    : never
  : never

/** The keys this project has, in the two shapes `buildAsas` publishes them in. */
export type Vocabulary = {
  catalog: readonly string[]
  statements: Readonly<Record<string, readonly string[]>>
  /**
   * How many rows, across every organization, still name the auth kayan's row `id` through a
   * relationship that restricts its delete. A provider route that deletes a person outside a
   * transaction asks it first, since the foreign key would fail only after other rows went.
   */
  referenced: (id: string) => Promise<number>
}

/** The build's auth: the admin kayan whose actor passes default access, and where failures are reported. */
export type AuthConfig = {
  /** The admin kayan: whose actor passes default access. */
  admin?: { kayan: Kayan; access?: unknown }
  /** Handed a strategy that threw and an access target that could not answer, each as an `Error` with the cause. Required where any kayan carries auth. */
  onError: (error: unknown) => void
  /** The largest body an auth route reads, answered 413 past it: `defaultMaxBodyBytes` or the project's own. Required where any kayan carries auth. */
  maxBodyBytes: number
}

type PublicLocalUser<K extends Kayan, L extends Language, KayanList extends readonly Kayan[]> = Omit<
  Row<K['fields'], L, KayanList>,
  ProtectedLocalField
>

/** One strategy per kayan carrying `auth`, typed by that provider's or that strategy's own actor. */
type AuthStrategies<L extends Language, KayanList extends readonly Kayan[]> = KayanList[number] extends infer One
  ? One extends Kayan
    ? One['auth'] extends infer Declared
      ? Declared extends { provider: 'local' }
        ? AuthStrategy<LocalAuthActor<One['name'], PublicLocalUser<One, L, KayanList>>>
        : Declared extends { provider: 'better-auth'; server: (...args: never[]) => infer Server }
          ? Server extends BetterAuthServer
            ? ReturnType<typeof betterAuthStrategy<Server, One['name']>>
            : never
          : Declared extends AuthStrategy
            ? Declared
            : never
      : never
    : never
  : never

/** One built operation in the flat table `buildAsas` publishes: one entry per operation of every kayan and global, in declared order. */
export type Operation = {
  /** The kayan or global the operation belongs to. */
  kayan: string
  /** The operation's own name, which is also the action an access row grants. */
  name: string
  effect: OperationEffect
  /** True for a global: its read takes no id and its update makes the row. */
  single: boolean
  /** What a caller may send. A global's update publishes its update shape without the id, so a first update short of a required field is refused by the runner. */
  input: StandardSchemaV1
  /** Runs the operation with the actor the request resolved and the context the plug's `context` function built. */
  call: (input: unknown, options: ServedOptions) => Promise<unknown>
}

type Called = (input: unknown, options?: ServedOptions) => Promise<unknown>

/** What a plug hands a served call beside its input. */
export type ServedOptions = {
  actor: unknown
  context?: Record<string, unknown>
  /** `?draft=true` on a kayan that keeps drafts. Nothing else a client sends reaches a call as an option. */
  draft?: boolean
  autosave?: boolean
  /** `?tenant=mine` or `?tenant=all` on a read. A write sent one is refused. */
  tenant?: string
}

/** The operation table: the flat array a plug iterates, and `procedures`, a type-only view keyed by kayan then operation. */
export interface OperationTable<View = unknown> extends ReadonlyArray<Operation> {
  /** Type only. There is no such property on the array at runtime. */
  readonly procedures?: View
}

/**
 * What an HTTP plug hands back: `router`, which a typed client is built from, and `handle`,
 * which answers `null` where no route of its own matched so the next plug is asked.
 */
export type HttpPlug = {
  /** The plug's own name, unique in the list. */
  name: string
  router: unknown
  /** `actor` is a thunk, so a request no route of this plug matches costs no session lookup. */
  handle: (request: Request, actor: () => Promise<unknown>) => Promise<Response | null>
}

const lowerCase = (value: unknown): unknown => typeof value === 'string' ? value.toLowerCase() : Array.isArray(value) ? value.map(lowerCase) : value
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
// The parse lower-cases a uuid, as Postgres answers one, but access and the steps before the
// transaction run ahead of it, so a JS comparison there must see the same spelling.
const lowerUuids = ({ kayan, input, bulk }: { kayan: ResolvedKayan; input: unknown; bulk: boolean }): unknown => {
  const fields = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([key, value]) =>
    [key, kayan.fields[key]?.kind === 'uuid' || kayan.fields[key]?.target?.fields.id?.kind === 'uuid' ? lowerCase(value) : value]))
  // A bulk write's own keys are its query; a row's columns are under `data`.
  return !isObject(input) ? input : bulk ? { ...input, ...(isObject(input.data) && { data: fields(input.data) }) } : fields(input)
}

// A symbol: no schema of something a browser can send takes it, so a schema that names
// the key answers with an issue at the key.
const probe = Symbol('mithaq.operation.input')

/** The service target's four numbers, each a positive integer the project names. */
const pageKeys = ['defaultLimit', 'maxLimit', 'joinLimit', 'bulkLimit'] as const

// An input field the schema names no key for would be dropped or refused at every click,
// so it fails the build. Asked through Standard Schema alone: a probe value at that key.
const refuseUndeclaredInput = (where: string, screens: Readonly<Record<string, OperationScreen | undefined>> | undefined, schema: StandardSchemaV1) => {
  const names = new Set(Object.values(screens ?? {}).flatMap((screen) => Object.keys(screen?.fields ?? {})))
  for (const name of names) {
    const answer = schema['~standard'].validate({ [name]: probe })
    if (answer instanceof Promise) {
      // A rejection nobody reads would kill the process after `buildAsas` returned.
      answer.catch(() => {})
      throw new Error(
        `${where} declares the button field "${name}", and this operation's own schema validates asynchronously, which a synchronous build cannot await, so whether the schema names that key cannot be read. Give this operation a synchronous schema, or drop the field.`,
      )
    }
    // A path segment is a key or an object carrying one.
    const named = answer.issues?.some((issue) => {
      const segment = issue.path?.[0]
      return segment !== undefined && String(typeof segment === 'object' ? segment.key : segment) === name
    })
    if (named) continue
    throw new Error(
      `${where} declares the button field "${name}", and this operation's own schema names no key of that name, so the dialog would draw a box over a value the parse drops. Name it in the operation's validate function, or drop the field.`,
    )
  }
}

// Every operation takes its input, which is exactly what a client may send, then the
// options, which are the server's alone.
const operations = <Actor>(
  kayan: ResolvedKayan,
  store: Store,
  schema: DerivedShapes,
  // A global's update publishes this; the runner never parses it.
  singleUpdate: StandardSchemaV1 | undefined,
  cap: number,
  read: ReaderMap<Actor>,
  kayans: (effect: OperationEffect) => unknown,
  of: (effect: OperationEffect) => WriteTools['of'],
  audit: AuditHandler<Actor> | undefined,
  admin: ManagedAdmin<Actor> | undefined,
  authorize: Authorize,
  catalog: readonly string[],
  /** True where the runner declares a context, which a served call must then carry. */
  contextDeclared: boolean,
  /** The most rows a served read of many may ask for, and one bulk write may match. */
  { maxLimit, bulkLimit }: Pick<ServiceTarget, 'maxLimit' | 'bulkLimit'>,
  tenant: { active: (actor: unknown) => string | undefined; seal: (writes: Omit<WriteTools['store'], 'hold'>) => WriteTools['store'] },
  /** The fields of every kayan that keep a row of this one while they name it. */
  pointers: readonly Pointer[],
) => {
  // Bound, so a step cannot reach `transaction` or the adapter's own client, and sealed, so no
  // step writes a tenant-owned row outside the active organization.
  const missing = (['upsert', 'sum'] as const).filter((word) => typeof store[word] !== 'function')
  if (missing.length) throw new Error(`The store is missing required words: ${missing.join(', ')}.`)
  const writes: WriteTools<unknown, Actor>['store'] = tenant.seal({
    find: store.find.bind(store),
    insert: store.insert.bind(store),
    remove: store.remove.bind(store),
    update: store.update.bind(store),
    upsert: store.upsert.bind(store),
    sum: store.sum.bind(store),
  })
  const table: Operation[] = []
  /** The bulk lists, held for the second pass: each needs a method the first builds. */
  const bulkLists: {
    operation: string
    declaration: ResolvedKayan['operations'][string]
    tools: WriteTools<unknown, Actor>
    input: StandardSchemaV1
  }[] = []
  // Options come from the plug alone, so nothing a client sends reaches a step as one.
  // On a runner that declares a context, a plug carrying none is refused before any step.
  const publish = <Method extends (...args: never[]) => Promise<unknown>>(
    name: string,
    effect: OperationEffect,
    input: StandardSchemaV1,
    method: Method,
    bounded = false,
  ) => {
    const bulk = kayan.operations[name]!.steps.some((step) => bulkSeals.includes(sealOf(step) as never))
    // The declared arity is what this widens across, which TypeScript asks two steps for.
    const normalized = ((given: unknown, options: unknown) => (method as unknown as Called)(lowerUuids({ kayan, input: given, bulk }), options as never)) as unknown as Method
    const called = normalized as unknown as Called
    table.push({
      kayan: kayan.name,
      name,
      effect,
      single: !!kayan.single,
      input,
      call: (given, { actor, context, draft, autosave, tenant }) => {
        if (contextDeclared && !context) {
          throw new Error(
            `Kayan "${kayan.name}" operation "${name}" was served with no context, and this build's runner declares one. Give every http plug a context function: fetchHttp({ context, maxBodyBytes: defaultMaxBodyBytes, onError: console.error }), or orpcHttp with the same options.`,
          )
        }
        if (bounded && given && typeof given === 'object' && 'limit' in given) {
          const limit = given.limit
          if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
            throw invalid({ message: `HTTP read option "limit" must be an integer from 1 to ${maxLimit}.`, key: 'error.invalid.read_option_range', params: { option: 'limit', minimum: 1, maximum: maxLimit } })
          }
        }
        return called(given, { actor, ...(context ? { context } : {}), ...(draft ? { draft } : {}), ...(autosave ? { autosave } : {}), ...(tenant !== undefined ? { tenant } : {}) })
      },
    })
    return normalized
  }
  const methods: Record<string, (...args: never[]) => Promise<unknown>> = Object.create(null)
  for (const [operation, declaration] of Object.entries(kayan.operations)) {
      const declared = declaration.input
      // Resolved once, so every later reader sees a schema.
      const publicOutput = outputOf(declaration)?.(schema as never) ?? declaration.output
      // A list that declares no shape takes the one its own work implies, which the schema target derives.
      if (declaration.effect === 'read') {
        // A version is addressed by its own id, and a list of them takes the page query.
        const shape = declared?.(schema as never) ?? (declaration.mode === 'one' ? schema.byID : declaration.mode === 'version' ? schema.id : schema.list)
        refuseUndeclaredInput(`Kayan "${kayan.name}" operation "${operation}"`, declaration.targets, shape)
        const run = read.operation({ name: operation, declaration: { ...declaration, output: publicOutput }, input: shape, output: schema.row, draftOutput: schema.draft })
        methods[operation] = publish(operation, declaration.effect, shape, run, declaration.mode === 'many' || declaration.mode === 'versions')
        continue
      }
      const list = declaration.steps
      // A restore is an update of the row its version belongs to, addressed by the version's own id.
      const acting = list
        .map(sealOf)
        .find((held) => held && (storeSeals.includes(held) || bulkSeals.includes(held) || held === 'restoreVersion'))
      const kind = (acting === 'restoreVersion' ? 'update' : acting) as WriteTools['kind']
      const shape =
        declared?.(schema as never)
        ?? (bulkSeals.includes(kind as never)
          // The list shape constrains no value: the runner checks the `where`, and each row's
          // single-row write checks `data`.
          ? schema.list
          : kind === 'insert' ? schema.create : kind === 'remove' ? schema.id : schema.update)
      // The runner writes the found row's id onto the data, so a caller sends none. Derived
      // by the schema target, since `.partial()` is a zod method another target lacks.
      refuseUndeclaredInput(`Kayan "${kayan.name}" operation "${operation}"`, declaration.targets, shape)
      const input = acting === 'restoreVersion' && !declared
        ? schema.id
        : !kayan.single || kind !== 'update' || declared ? shape : singleUpdate ?? shape
      const tools = {
        operation,
        effect: declaration.effect,
        kind,
        // A restore's own input is written over the id, so it is handed the update shape in the id's place.
        schema: acting === 'restoreVersion' && declared ? declared({ ...schema, id: schema.update } as never) : shape,
        // A global's update makes the row when there is none, so that branch parses the strict create
        // shape; a first update short of a required field passes the boundary and is refused here.
        ...((kayan.single || kayan.versions?.drafts) && kind === 'update' ? { insertSchema: schema.create } : {}),
        ...(schema.draft ? { draftSchema: schema.draft, draftWrite: schema.draftWrite ?? schema.draft } : {}),
        // A draft save through an operation's own input keeps that input's keys and checks kinds alone.
        ...(schema.draft && declared && (kind === 'insert' || operation === 'update' || acting === 'restoreVersion')
          ? { draftInput: declared({ ...schema, create: schema.draftWrite ?? schema.draft, update: schema.draftWrite ?? schema.draft, ...(acting === 'restoreVersion' && { id: schema.draftWrite ?? schema.draft }) } as never) }
          : {}),
        output: schema.row,
        publicOutput,
        store: writes,
        audit,
        catalog,
        of: of(declaration.effect),
        // Checked rather than asserted, so dropping a member fails to compile; the assertion carries `kayans` alone.
      } satisfies Omit<WriteTools<unknown, Actor>, 'kayans'> as WriteTools<unknown, Actor>
      Object.defineProperty(tools, 'kayans', {
        enumerable: true,
        get: () => kayans(declaration.effect),
      })
      // Built in the second pass, where every single-row write it delegates to exists.
      if (bulkSeals.includes(kind as never)) {
        bulkLists.push({ operation, declaration, tools, input })
        continue
      }
      const run = write<Actor>({ kayan, declaration, tools, store, cap, authorize, admin, tenantOf: tenant.active, pointers })
      methods[operation] = publish(operation, declaration.effect, input, run)
  }
  for (const { operation, declaration, tools, input } of bulkLists) {
    const single = declaration.each!
    const run = bulk<Actor>({
      kayan,
      declaration,
      tools,
      store,
      single: methods[single] as (data: Record<string, unknown>, options?: Options<Actor>) => Promise<unknown>,
      cap,
      bulkLimit,
      authorize,
      admin,
      tenantOf: tenant.active,
    })
    methods[operation] = publish(operation, declaration.effect, input, run)
  }
  return { methods, table: table as readonly Operation[] }
}

// `defineMithaq` merges without refusing, so the clashes are refused here, naming both sides.
const refuseArkan = (language: Language) => {
  const arkan = language.arkan ?? []
  for (const [key, noun] of [['kinds', 'kind'], ['rules', 'rule'], ['targets', 'target']] as const) {
    const by = new Map<string, string>()
    for (const rukn of arkan) {
      for (const name of Object.keys(rukn[key] ?? {})) {
        const other = by.get(name)
        if (other !== undefined) {
          throw new Error(`Rukn "${other}" and rukn "${rukn.name}" both bring ${noun} "${name}". One ${noun} is brought by one rukn: drop it from one of them.`)
        }
        by.set(name, rukn.name)
      }
    }
  }
  for (const rukn of arkan) {
    for (const [name, target] of Object.entries(rukn.targets ?? {})) {
      if (language.targets[name] !== target) {
        throw new Error(`The project lays down target "${name}", and rukn "${rukn.name}" builds one under that key. Rename the project's target or leave it to the rukn.`)
      }
    }
    for (const capability of rukn.needs ?? []) {
      if (!Object.values(language.targets).some((target) => target.capability === capability)) {
        throw new Error(`Rukn "${rukn.name}" needs a target of capability "${capability}", and this build lays down none. Add one to targets.`)
      }
    }
  }
}

/**
 * Every declared thing of one build, kayan and global alike, which is the
 * registry a relationship is resolved against.
 */
type Declared<KayanList extends readonly Kayan[], GlobalList extends readonly Kayan[]> =
  readonly (KayanList[number] | GlobalList[number])[]

export const buildAsas = <
  const L extends Language,
  const KayanList extends readonly Kayan[],
  const GlobalList extends readonly Kayan[] = readonly [],
  Auth extends AuthConfig = AuthConfig,
  Http extends HttpPlug = HttpPlug,
>(
  language: L,
  {
    kayan,
    global,
    auth,
    http,
    messages,
    statements: declaredStatements,
  }: {
    kayan: KayanList &
      (UniqueNames<KayanList> extends true ? unknown : { duplicateKayanNames: never }) &
      (AccessActorMismatch<KayanList, L, ActorFor<L, KayanList>> | AdminAccessMismatch<Auth, ActorFor<L, KayanList>> | AdminAccessShapeMismatch<Auth> extends never
        ? unknown
        : { authAccessActorMismatch: AccessActorMismatch<KayanList, L, ActorFor<L, KayanList>> | AdminAccessMismatch<Auth, ActorFor<L, KayanList>> | AdminAccessShapeMismatch<Auth> })
    /** The globals, each a kayan of one row. They share the kayan namespace. */
    global?: GlobalList
    auth?: Auth
    /**
     * The HTTP plugs, asked in order, so the order decides who owns a prefix two claim. Required:
     * `fetchHttp` takes no dependency; `orpcHttp` first gives `asas.router` its typed client. A
     * device asas, which nothing reaches over HTTP, names none: `http: []`.
     */
    http: readonly [] | readonly [
      (operations: OperationTable<Procedures<KayanList, GlobalList, Declared<KayanList, GlobalList>, L>>) => Http,
      ...((operations: OperationTable<Procedures<KayanList, GlobalList, Declared<KayanList, GlobalList>, L>>) => HttpPlug)[],
    ]
    /** The project's own copy for the labels mithaq ships, as one resolver whose return shape mithaq declares. */
    messages?: MessagesResolver<L>
    /** Keys no declaration derives, such as an auth provider's own actions, added to the vocabulary under the resources they name. */
    statements?: Readonly<Record<string, readonly string[]>>
  },
) => {
  type RuleName = Extract<keyof L['rules'], string>
  type One = Extract<AuthStrategies<L, KayanList>, AuthStrategy>
  type Actor = ActorFor<L, KayanList>
  /** Every declared thing, which is what a relationship is resolved against. */
  type All = Declared<KayanList, GlobalList>

  // Refused before any work: core picks no plug of its own, and `[]` is a build naming none.
  if (!Array.isArray(http)) {
    throw new Error(
      'buildAsas was handed no "http", and core picks no plug of its own. Name the plugs: http: [fetchHttp({ maxBodyBytes: defaultMaxBodyBytes, onError: console.error })], or orpcHttp with the same options first for the typed client.',
    )
  }
  const globals = (global ?? []) as readonly Kayan[]
  const globalNames = new Set(globals.map((one) => one.name))
  // One list, so a name declared twice is refused whichever list it is in.
  const declared = [...(kayan as readonly Kayan[]), ...globals]
  refusePlacement({ language, kayan: declared, http, runtime: 'server' })
  refuseArkan(language)
  // A kayan writing `targets.screen` would read as every screen and mean one.
  if (Object.hasOwn(language.targets, 'screen')) {
    throw new Error('A target is named "screen", which is the word for the capability. Name a screen for what it draws, such as "dashboard" or "portal".')
  }
  // A build with no runner publishes nothing, so none is refused. Asked before `resolve`,
  // which reads every key off the target.
  const noOperations = (where: string, holder: object) => {
    if (!Object.hasOwn(holder, 'operations')) return
    throw new Error(
      `${where} declares "operations", and a kayan's operations are its own: write them under targets: { service: { operations: { ...defaultOperations } } } on each kayan.`,
    )
  }
  noOperations('The language', language)
  const stray = serviceKeys.find((key) => Object.hasOwn(language, key))
  if (stray) {
    throw new Error(
      `"${stray}" is not a key of the language: it is a key of the service target. Move it into targets.service: serviceTarget({ ... }).`,
    )
  }
  const serviceTargets = Object.entries(language.targets).filter(([, target]) => isService(target))
  if (serviceTargets.length === 0) {
    throw new Error(
      'This build declares no target of capability "service", and a build with no runner publishes nothing. Add service: serviceTarget({ authorize, depth, defaultLimit, maxLimit, joinLimit, bulkLimit, store, schema }) to targets.',
    )
  }
  if (serviceTargets.length > 1) {
    throw new Error(
      `Targets "${serviceTargets.map(([name]) => name).join('" and "')}" both declare capability "service", and a build has exactly one service target. Drop one of them.`,
    )
  }
  if (serviceTargets[0]![0] !== 'service') {
    throw new Error(
      `Target "${serviceTargets[0]![0]}" declares capability "service" and has to be named "service" in targets, because one word names the runner everywhere.`,
    )
  }
  const service = serviceTargetOf(language)!
  // For a runner written as data, which no type reached. Core picks no cap, page size or
  // bulk ceiling of its own.
  noOperations('The service target', service)
  const absent = (['authorize', 'store', 'schema', 'depth', ...pageKeys] as const).find((key) => service[key] === undefined)
  if (absent) {
    throw new Error(`The service target declares no "${absent}", and every build's runner has one. Add it to serviceTarget({ ... }).`)
  }
  // Checked before `resolve` and the screens read `maxLimit`, so a bad one is refused in its own words.
  for (const key of pageKeys) {
    if (!Number.isInteger(service[key]) || service[key] < 1) throw new Error(`service.${key} must be a positive integer.`)
  }
  // A page the runner opens on its own may not be larger than the most a caller may ask for.
  for (const key of ['defaultLimit', 'joinLimit'] as const) {
    if (service[key] > service.maxLimit) throw new Error(`service.${key} is ${service[key]}, past service.maxLimit ${service.maxLimit}.`)
  }
  const transport = (['http', 'orpc'] as const).find((key) => Object.hasOwn(service, key))
  if (transport) {
    throw new Error(
      `The service target declares "${transport}", and transport is not the runner's: it is the list of plugs buildAsas takes under "http".`,
    )
  }
  const resolved = resolve(declared, language)
  // `tenant` is asked at a request, once the scope below is built.
  const stored = resolveStorage({ language, resolved, storeOf: (one) => buildTargets[one.store] as Store, active: (actor) => tenant.active(actor) })
  const storage = stored[0]?.storage.config
  // Set on every field before any schema is derived, for a value that points at a file from inside it.
  const filesIn = stored.map((one) => one.name)
  for (const field of resolved.flatMap((one) => Object.values(one.fields))) field.filesIn = filesIn
  // Checked once, so a bad screen is refused here rather than at the first page drawn.
  const screens = screensOf(language, resolved)
  const hasAudit = (list: readonly unknown[] | undefined) => list?.some((step) => sealOf(step as WriteStep) === 'audit') ?? false
  if (!service.audit) {
    if ([service.beforeSteps, service.afterSteps, service.afterCommit].some(hasAudit)) {
      throw new Error('The service target lists the "audit" step without an audit sink. Declare audit on the service target or drop the step.')
    }
    for (const kayan of resolved) {
      for (const [name, operation] of Object.entries(kayan.operations)) {
        if (hasAudit(operation.afterSteps)) {
          throw new Error(`Kayan "${kayan.name}" operation "${name}" lists the "audit" step without an audit sink. Declare audit on the service target or drop the step.`)
        }
      }
    }
  }
  // Derived once and never stored, so nothing drifts from the declarations. In Better Auth's
  // `Statements` shape, so `createAccessControl` takes it as written.
  const statements: Record<string, readonly string[]> = Object.fromEntries(
    resolved.map((one) => [
      one.name,
      [...Object.keys(one.operations), ...Object.keys(one.fields).map((field) => `fields.${field}`)],
    ]),
  )
  // One key per screen, which is all that decides who enters it. `resolve` reserves the kayan name `screen`.
  if (Object.keys(screens).length) statements.screen = Object.keys(screens)
  // Unioned, because a resource may be both a kayan and a provider's: dropping either
  // half would refuse a question one of them asks.
  for (const [resource, actions] of Object.entries(declaredStatements ?? {})) {
    statements[resource] = [...new Set([...(statements[resource] ?? []), ...actions])]
  }
  const catalog = Object.entries(statements).flatMap(([name, actions]) => actions.map((action) => `${name}.${action}`))
  // Frozen down to each action list: one array is `asas.catalog` and every `tools.catalog`,
  // so a push would widen what `grantedPermissions` measures against, project-wide.
  for (const actions of Object.values(statements)) Object.freeze(actions)
  Object.freeze(statements)
  Object.freeze(catalog)
  // A provider's own action is left out: a role may hold it for the provider alone.
  const operationKeys: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(resolved.flatMap((one) =>
    Object.keys(one.operations)
      .filter((action) => !(declaredStatements?.[one.name] ?? []).includes(action))
      .map((action) => [`${one.name}.${action}`, one.name]))))
  // Kept against the catalog, so `grantedPermissions` reads it without a member of its own.
  keepOperationKeys(catalog, operationKeys)
  // A key nothing can ask for is a typo that would otherwise show only as a denial in production.
  const known = new Set(catalog)
  for (const table of new Set(resolved.map((one) => rowsOf(one.access)?.rows).filter((one) => !!one))) {
    for (const [role, row] of Object.entries(table)) {
      if (row.permissions === undefined || row.permissions === '*') continue
      for (const key of row.permissions) {
        if (known.has(key)) continue
        throw new Error(
          `Access row "${role}" holds permission "${key}", which is not a key of this project's catalog. A key is "<kayan>.<operation>", "<kayan>.fields.<field>" or "screen.<screen>", and this project's are: ${catalog.join(', ')}.`,
        )
      }
    }
  }
  // Any other key the report never answers, so the entry would hide from everyone but `'*'`.
  for (const [name, screen] of Object.entries(screens)) {
    for (const [page, one] of Object.entries(screen.pages)) {
      if (one.permission === undefined) continue
      const dot = one.permission.indexOf('.')
      const [resource, action] = [one.permission.slice(0, dot), one.permission.slice(dot + 1)]
      const answered = resource === 'screen' ? Object.hasOwn(screens, action) : Object.hasOwn(resolved.find((kayan) => kayan.name === resource)?.operations ?? {}, action)
      if (!answered) {
        throw new Error(`Screen "${name}" page "${page}" permission "${one.permission}" is neither screen.<screen> of this build nor <kayan>.<operation> of a kayan it holds, and the nav could never show the page to anyone but '*'.`)
      }
    }
  }
  // Exactly one: a second would be a second answer to one question with no rule to pick
  // between them. A build with none keeps the access callbacks alone.
  const accessTargets = Object.entries(language.targets).filter(([, target]) => isAccess(target))
  if (accessTargets.length > 1) {
    throw new Error(
      `Targets "${accessTargets.map(([name]) => name).join('" and "')}" both declare capability "access", and a build has exactly one access target. Drop one of them.`,
    )
  }
  const accessTarget = accessTargetOf(language)
  // A typo in a system role's keys, or a field renamed under it, grants nothing and would
  // otherwise say nothing.
  for (const [role, { permissions }] of Object.entries(accessTarget?.roles ?? {})) {
    if (permissions === '*') continue
    for (const key of permissions) {
      if (known.has(key)) continue
      throw new Error(
        `System role "${role}" holds permission "${key}", which is not a key of this project's catalog. A key is "<kayan>.<operation>", "<kayan>.fields.<field>" or "screen.<screen>", and this project's are: ${catalog.join(', ')}.`,
      )
    }
    const fieldless = fieldlessOperation(permissions, operationKeys)
    if (fieldless) {
      throw new Error(
        `System role "${role}" holds operation key "${fieldless.key}" of kayan "${fieldless.kayan}" and no "${fieldless.kayan}.fields.<field>" key, so every read of it is refused for its fields. Grant the fields it reads, or drop the operation.`,
      )
    }
  }
  const registered = new Map(declared.map((one) => [one.name, one]))
  const resolvedByName = new Map(resolved.map((one) => [one.name, one]))
  for (const one of resolved) {
    for (const field of Object.values(one.fields)) {
      const policy = field.richTextPolicy
      if (policy && (field.features ?? policy.features).includes('mentions')) {
        for (const source of policy.mentionSources ?? defaultMentionSources) {
          if (!resolvedByName.has(source.kayan)) throw new Error(`Mention source "${source.kayan}" names no kayan of this build.`)
        }
      }
      if (!policy || !(field.features ?? policy.features).includes('comments')) continue
      if (!one.tenant) throw new Error('Comments require a tenant-owned record.')
      if (service.context !== undefined && !language.kinds[field.kind]?.richTextComments?.context) throw new Error('Comments require their request context function when the service declares context.')
      const threads = policy.comments && resolvedByName.get(policy.comments.threads)
      if (!threads?.tenant || threads.store !== one.store || Object.keys(threads.operations).length || !service.audit) throw new Error('Comments require a private tenant threads kayan in the record store and an audit sink.')
      for (const key of ['recordKayan', 'recordId', 'field', 'quote', 'resolved', 'comments', 'createdAt', 'updatedAt']) {
        if (!threads.fields[key]) throw new Error(`Comment threads declare no "${key}" field.`)
      }
      field.commentThreads = threads
    }
  }
  // Wired here, not inside one provider, so no provider is a second source of keys for
  // another. A target that throws takes the whole answer: half an answer is an unresolved grant.
  const buildTargets: Record<string, unknown> = { ...language.targets }
  const accessStore = () => buildTargets[service.store] as Store
  // The target reads role rows by table name with no soft-delete filter, so a kayan it reads
  // must exist here and carry no mark, or a deleted role would keep granting.
  for (const name of accessTarget?.reads ?? []) {
    const roleKayan = resolvedByName.get(name)
    if (!roleKayan) {
      throw new Error(
        `The access target reads kayan "${name}", which this build does not declare. Add it to the buildAsas kayan list, point the target at a kayan this build has, or drop the target.`,
      )
    }
    if (!roleKayan.softDelete) continue
    throw new Error(
      `The access target reads kayan "${roleKayan.name}", which carries the service target's soft-delete field "${roleKayan.softDelete}". A role row the delete marked would still grant its keys, because the target is handed a store and a table name and never a kayan. Drop the field from that kayan, or drop the target.`,
    )
  }
  const assigned = accessTarget
    ? (args: Parameters<AssignedResolver>[0]) => accessTarget.resolve({ store: accessStore(), ...args, ownership: (name) => resolvedByName.get(name)?.tenant })
    : undefined
  // A target that holds rows is a store, and each one is handed only the kayan
  // that name it. A target that just shapes a field has nothing to initialise.
  const stores = Object.entries(language.targets).filter(([, target]) => isStore(target)) as [
    string,
    Store,
  ][]
  // Every store's `init` runs in registration order, which holds while no `init` consumes another's output.
  for (const [at, [name, store]] of stores.entries()) {
    const own = store.init(resolved.filter((one) => one.store === name)) ?? store
    stores[at] = [name, own]
    buildTargets[name] = own
  }
  const cap = service.depth
  if (!Number.isInteger(cap) || cap < 1) throw new Error('service.depth must be a positive integer.')

  const registeredKayanName = (label: string, value: Kayan | undefined) => {
    if (!value) return undefined
    const original = registered.get(value.name)
    if (!original) {
      throw new Error(`${label} "${value.name}" is not in the buildAsas kayan list.`)
    }
    if (original !== value) {
      throw new Error(`${label} "${value.name}" is not the registered kayan object.`)
    }
    return value.name
  }
  const adminKayan = registeredKayanName('auth.admin.kayan', auth?.admin?.kayan)
  const admin = auth ? { access: auth.admin?.access as AdminAccess<Actor> | undefined, kayan: adminKayan } : undefined
  const adminAuth = adminKayan ? registered.get(adminKayan)?.auth : undefined
  // Nothing is manufactured: an admin kayan no provider authenticates can never produce an actor.
  if (adminKayan && !adminAuth) {
    throw new Error(`auth.admin names kayan "${adminKayan}", which carries no auth.`)
  }
  // Only the shipped declarations mark their actor; marking a hand-written strategy's actor
  // would vouch for its `strategy` and `role`, and so for the layer above every tenant.
  if (adminAuth && !isAuthDeclaration(adminAuth)) {
    throw new Error(
      `auth.admin names kayan "${adminKayan}", whose auth is a strategy this project wrote. A hand-written strategy cannot authenticate the admin kayan, because markAuthActor is not exported and it cannot mark the actor it returns as this kayan's. Give that kayan betterAuth({ server }) or local({ ... }).`,
    )
  }

  // The service target's `authorize` is held to `assertWhere` like any access callback;
  // a malformed result is the project's own 500, never the store reading it as a column.
  // A second instance's sessions would name organizations of a table the tenant field never points at.
  const betterAuthKayan = declared.filter((one) => one.auth && isAuthDeclaration(one.auth) && one.auth.provider === 'better-auth').map((one) => one.name)
  const owned = resolved.find((one) => one.tenant)
  if (owned && betterAuthKayan.length > 1) {
    throw new Error(
      `Kayan "${betterAuthKayan.join('" and "')}" each carry Better Auth, and kayan "${owned.name}" belongs to the organization a session names. A build with a tenant-owned kayan carries one Better Auth kayan.`,
    )
  }
  const tenant = tenancy({ language, assigned, onError: (error) => auth?.onError?.(error), collection: betterAuthKayan[0] })
  // A project of one organization that came to hold two would split its people and rows between them
  // without a word, so it does not start. Two rows are read, not counted, so every store can answer.
  const refuseExtraTenants = async () => {
    const target = language.targets.tenant
    if (!isTenant(target) || target.organizations === 'many') return
    const tenants = resolvedByName.get(target.relationTo)
    if (!tenants) return
    const found = await (buildTargets[tenants.store] as Store).find({ kayan: tenants.name, args: { limit: 2, page: 1, sort: { field: 'id', direction: 'asc' } } })
    if (found.docs.length < 2) return
    throw new Error(
      `The tenant target says organizations: '${target.organizations}', and the "${tenants.name}" table holds more than one. Set organizations to 'many' where the project sets it, or merge them into one first; a merge is a migration of the project's own.`,
    )
  }
  // The tenant scope goes under both authorizers, so replacing either cannot leave it out.
  const authorize: Authorize = tenant.scoped(service.authorize === defaultAuthorize
    ? defaultAuthorize
    : async (args) => {
        const own = await service.authorize(args)
        return combineWhere(await defaultAuthorize(args), own === undefined ? undefined : assertWhere(args.kayan, own))
      })

  let built!: Record<string, Record<string, unknown>>
  const boundCache = new Map<'read' | 'write', unknown>()
  const boundKayans = (mode: 'read' | 'write') => {
    const cached = boundCache.get(mode)
    if (cached) return cached
    // A global is not in the bound registry.
    const registry = Object.freeze(Object.fromEntries(resolved.filter((one) => !one.single).map((one) => {
      const publicKayan = built[one.name]!.operations as Record<string, unknown>
      const methods: Record<string, unknown> = Object.create(null)
      for (const [operation, declaration] of Object.entries(one.operations)) {
        if (mode === 'read' && declaration.effect !== 'read') continue
        const method = publicKayan[operation] as Called
        methods[operation] = (input: unknown, options?: unknown) => {
          assertNoOptions(options)
          return method(input)
        }
      }
      return [one.name, Object.freeze(methods)]
    })))
    boundCache.set(mode, registry)
    return registry
  }
  // The object handed in must be the one this build registered, so a declaration from
  // another build is refused by name.
  const boundOf = (mode: 'read' | 'write') => ((kayan: Kayan) => {
    const name = registeredKayanName('tools.of', kayan)
    if (!name) throw new Error('tools.of takes a kayan this build registered, and was handed none.')
    if (registered.get(name)!.single) throw new Error(`tools.of "${name}" is a global, which a step does not reach through its tools.`)
    return (boundKayans(mode) as Record<string, unknown>)[name]
  }) as never

  /** Every kayan carrying a provider, in the order the build lists them. */
  const authenticating = declared.filter((one): one is Kayan & { auth: KayanAuth } => one.auth !== undefined)
  for (const one of resolved) {
    const local = !!one.auth && isAuthDeclaration(one.auth) && one.auth.provider === 'local'
    if (!local && holdsVerificationSteps(one)) {
      throw new Error(
        `kayan "${one.name}" holds the verification steps of localAuthOperations and carries no auth: local(...). Carry local(...), or leave localAuthOperations out of its operations.`,
      )
    }
  }

  const operationTable: Operation[] = []
  built = Object.fromEntries(
    resolved.map((one) => {
      // The shapes are the schema target's own assembly; core validates them through `~standard`.
      const target = language.targets[one.schema] as { derive: (fields: ResolvedKayan['fields']) => DerivedShapes }
      const schemas = target.derive(one.fields)
      one.rowShape = schemas.row
      // And a versions read's own, over the columns of the versions table.
      if (one.versions) one.versions.kayan.rowShape = target.derive(one.versions.kayan.fields).row
      // Named here rather than at the first such read.
      if (!schemas.byID) {
        throw new Error(
          `Kayan "${one.name}" names schema target "${one.schema}", which derives no byID shape, which is what a read of one row parses. Derive "byID" beside "id": the id and an optional depth.`,
        )
      }
      // A draft is parsed and read back through a shape the target has to
      // derive, which is the kinds without the rules.
      if (one.versions?.drafts && !schemas.draft) {
        throw new Error(
          `Kayan "${one.name}" keeps drafts, and its schema target "${one.schema}" derives no draft shape, which is what a draft is parsed and read back through. Derive "draft" beside "row", or keep versions without drafts.`,
        )
      }
      // The id is left out because the runner writes it itself.
      const { id: _id, ...withoutId } = one.fields
      const singleUpdate = one.single ? target.derive(withoutId).update : undefined
      const store = buildTargets[one.store] as Store & { tables?: Record<string, unknown> }
      const read = readers<Actor>({
        kayan: one,
        store,
        cap,
        defaultLimit: service.defaultLimit,
        joinLimit: service.joinLimit,
        admin,
        authorize,
        openTenant: tenant.open,
        tenantOf: tenant.active,
        kayans: () => boundKayans('read'),
        of: boundOf('read'),
        audit: service.audit as AuditHandler<Actor> | undefined,
        catalog,
        pickers: Object.fromEntries(resolved.flatMap((other) => Object.values(other.fields)
          .filter((field) => field.kind !== 'join' && field.target?.name === one.name)
          .map((field) => [`${other.name}.${field.name}`, field]))),
      })
      const { methods, table } = operations(
        one,
        store,
        schemas,
        singleUpdate,
        cap,
        read,
        (effect) => boundKayans(effect === 'read' ? 'read' : 'write'),
        (effect) => boundOf(effect === 'read' ? 'read' : 'write'),
        service.audit as AuditHandler<Actor> | undefined,
        admin as ManagedAdmin,
        authorize,
        catalog,
        service.context !== undefined,
        service,
        { active: tenant.active, seal: (writes) => tenant.sealWrites({ writes, find: store.find.bind(store), kayanOf: (name) => resolvedByName.get(name) }) },
        restrictingPointers(resolved, one),
      )
      operationTable.push(...table)
      const bound = Object.freeze(methods)
      // Only what this kayan's own targets built for it; their configuration stays on `asas.targets`.
      const targets: Record<string, unknown> = {
        service: Object.freeze({ operations: bound }),
        [one.schema]: Object.freeze({ schemas }),
        ...(store.tables && Object.hasOwn(store.tables, one.name)
          ? { [one.store]: Object.freeze({ table: store.tables[one.name] }) }
          : {}),
      }
      // Written out, not spread, so no access callback, thunk or target configuration appears
      // under a runtime output's name. `fields` is frozen below, so its reach reads and never writes.
      return [one.name, Object.freeze({ name: one.name, fields: one.fields, operations: bound, targets: Object.freeze(targets) })]
    }),
  )
  // Built once, outside any provider: the route answers for whatever actor the loop resolved.
  const reportable: LocalAuthPermissions = {
    kayan: resolved,
    // Asked once per operation name, since `authorize` stands the permission layer aside with
    // no name, which would report an effect the runner refuses. Each name's answer is returned too.
    can: async ({ kayan: one, effect, actor: actorForAccess }) => {
      const named = operationTable
        .filter((operation) => operation.kayan === one.name && operation.effect === effect)
        .map((operation) => operation.name)
      const operations: Record<string, boolean> = {}
      // Backoffice staff in the backoffice app read a tenant-owned kayan across every organization,
      // so its read is reported as they make it; anyone else is answered in the active one.
      const reach = effect === 'read' && one.tenant && !one.single
        ? await tenant.open({ actor: actorForAccess, reach: 'all', kayan: one }).catch(() => undefined)
        : undefined
      const ask = (operation: string | undefined) => authorize({ admin: admin as ManagedAdmin, actor: actorForAccess, data: {}, effect, kayan: one, operation })
      for (const operation of named.length ? named : [undefined]) {
        try {
          await (reach ? running.run({ context: Object.freeze({ source: 'local', depth: 0, chain: [] }), user: actorForAccess, tenant: reach }, () => ask(operation)) : ask(operation))
          if (operation) operations[operation] = true
          else return { allowed: true, operations }
        } catch {
          // Each name is asked whatever an earlier one answered, because the report names them all.
          if (operation) operations[operation] = false
        }
      }
      return { allowed: Object.values(operations).some(Boolean), operations }
    },
    canAccessAdmin: async (actorForAccess) => markAdminAnswer(actorForAccess, !!(await defaultAccess(admin as ManagedAdmin, actorForAccess))),
    // Read off the trusted snapshot, so an actor with none enters nothing.
    screens: async (actorForAccess) => {
      const names = Object.keys(screens)
      if (!accessTarget) return (await defaultAccess(admin as ManagedAdmin, actorForAccess)) ? names : []
      const held = actorPermissions(actorForAccess)
      return held === true ? names : names.filter((name) => held?.has(`screen.${name}`) === true)
    },
  }

  // Precedence is the order the build lists its kayan: the loop takes the first non-null actor.
  if (authenticating.length && typeof auth?.onError !== 'function') {
    throw new Error(
      `buildAsas was handed no "auth.onError", and kayan "${authenticating[0]!.name}" carries auth. Core reports no failed strategy of its own: name the project's own, such as auth: { onError: console.error, maxBodyBytes: defaultMaxBodyBytes }.`,
    )
  }
  if (authenticating.length) assertMaxBodyBytes('auth', auth!.maxBodyBytes)
  const onError = (error: unknown) => auth!.onError(error)
  const strategies = (() => {
    const list: AuthStrategy[] = []
    // Without this freeze a `roles` function reassigning `v.catalog` would be seen by a
    // `server` factory, and the target and the provider would disagree.
    for (const one of authenticating) {
      const own = resolvedByName.get(one.name)!
      const pointers = restrictingPointers(resolved, own)
      const ownStore = buildTargets[own.store] as unknown as Store
      const vocabulary: Vocabulary = Object.freeze({
        catalog: catalog as readonly string[],
        statements,
        referenced: async (id: string) => [...(await referencingIds({ id, pointers, store: ownStore })).values()].reduce((sum, ids) => sum + ids.size, 0),
      })
      const declaration = one.auth
      if (!isAuthDeclaration(declaration)) {
        list.push(declaration)
        continue
      }
      if (declaration.provider === 'better-auth') {
        const { server } = declaration as unknown as { server: (targets: L['targets'], vocabulary: Vocabulary) => BetterAuthServer }
        if (typeof server !== 'function') throw new Error(`kayan "${one.name}" carries auth: betterAuth({ server }), and server must be a factory.`)
        list.push(betterAuthStrategy({ server: server(buildTargets as L['targets'], vocabulary), collection: one.name, assigned, onError }))
        continue
      }
      if (declaration.provider !== 'local') {
        throw new Error(
          `kayan "${one.name}" carries an auth that is neither a strategy, which is an object with an \`authenticate\`, nor one of the shipped declarations, betterAuth({ server }) and local({ ... }).`,
        )
      }
      const options = (declaration as unknown as { options: LocalAuthOptions }).options
      // First registration is served, so it needs the project's context function too.
      if (service.context !== undefined && typeof options.context !== 'function') {
        throw new Error(
          `kayan "${one.name}" carries auth: local(...) with no context function, and this build's runner declares a context, which first registration would hand its steps without. Give it local({ context }).`,
        )
      }
      const local = resolvedByName.get(one.name)!
      const store = buildTargets[local.store] as L['targets'][string]
      if (!isStore(store) || !isLocalAuthTarget(store)) {
        throw new Error(`kayan "${local.name}" carries auth: local(...) and must use a store declaring sql: "drizzle" with db and tables.`)
      }
      list.push(
        localAuthStrategy({
          options,
          kayan: local,
          target: store,
          writes: built as never,
          projectUser: (row, actor) => projectReadableFields({ kayan: local, row, actor }),
          permissions: reportable,
          assigned,
          onError,
        }),
      )
    }
    // Two strategies sharing a name would share a prefix, and the second's endpoints would
    // be unreachable with nothing said.
    const seen = new Set<string>()
    for (const strategy of list) {
      if (seen.has(strategy.name)) {
        throw new Error(`Two strategies of this build are named "${strategy.name}", and each would answer /api/auth/${strategy.name}/*. Rename one of them.`)
      }
      seen.add(strategy.name)
    }
    return list
  })()
  // The build's admin answer is recorded on the actor, so a field callback can read it.
  const resolveActor = async (headers: Headers): Promise<Actor | null> => {
    const found = await actor({ strategies: strategies as AuthStrategy<Actor>[], headers, onError })
    if (found) markAdminAnswer(found, !!(await defaultAccess(admin as ManagedAdmin, found)))
    return found
  }

  // Cast over the table's static view, which a plug reads from the type only.
  const plugs = (http as readonly ((operations: OperationTable) => HttpPlug)[]).map((make) =>
    make(operationTable),
  )
  // A name that answers for two plugs names neither.
  const plugNames = new Set<string>()
  for (const one of plugs) {
    if (plugNames.has(one.name)) {
      throw new Error(
        `Two http plugs are named "${one.name}". A plug's name is what a kayan names to opt out of it, so it names one plug of the list.`,
      )
    }
    plugNames.add(one.name)
  }

  /** Assembled on the first read of `messages`, and kept. */
  let registry: MessageRegistry | undefined
  // Read through the kayan's own `findByID`, so its access, tenant and soft-delete mark decide.
  const storageServe = storage && stored.length
    ? storageRoutes<Actor>({
        kayan: stored,
        config: storage,
        read: async ({ kayan: name, id, actor }) => {
          const findByID = (built[name]!.operations as Record<string, ((input: unknown, options: unknown) => Promise<unknown>) | undefined>).findByID
          return findByID ? ((await findByID({ id }, { actor })) as Record<string, unknown> | null) : null
        },
        authorize,
        admin: admin as ManagedAdmin<Actor> | undefined,
      })
    : undefined

  const comments = resolved.some((one) => Object.values(one.fields).some((field) => field.commentThreads)) ? commentService({
    kayans: resolvedByName,
    context: language.kinds.richText?.richTextComments?.context,
    trustedOrigin: async ({ request, actor }) => {
      const origin = request.headers.get('origin')
      if (!origin || origin === 'null') return false
      try { if (new URL(origin).origin !== origin) return false } catch { return false }
      const strategy = strategies.find((one) => one.name === authActor(actor)?.collection) ?? strategies[0]
      const provider = strategy as AuthStrategy & { server?: { $context?: Promise<{ isTrustedOrigin: (origin: string) => boolean }> } }
      const context = await provider?.server?.$context
      // Better Auth knows the public URL behind a TLS proxy; local strategies use the served origin.
      return context ? context.isTrustedOrigin(origin) : origin === new URL(request.url).origin
    },
    storeOf: (one) => buildTargets[one.store] as Store,
    read: async ({ kayan, id, actor }) => {
      const read = (built[kayan]?.operations as Record<string, ((input: unknown, options: unknown) => Promise<unknown>) | undefined>)?.findByID
      return read ? await read({ id, depth: 0 }, { actor }) as Record<string, unknown> | null : null
    },
    authorize, admin: admin as ManagedAdmin, tenantOf: tenant.active,
    audit: service.audit as AuditHandler,
    maxBodyBytes: 32 * 1024,
    onError,
  }) : undefined

  const asas = {
    /** Every permission key this project has: one `<kayan>.<operation>` per operation, one `<kayan>.fields.<field>` per field, one `screen.<screen>` per screen. */
    catalog: catalog as readonly string[],
    /** Every scope of copy this project has. A getter: only the CLI reads it, and it calls the project's own resolver. */
    get messages(): MessageRegistry {
      return (registry ??= messagesOf({ language, kayanList: resolved, resolver: messages as MessagesResolver | undefined }) as MessageRegistry)
    },
    /** The same catalog in Better Auth's shape, for `createAccessControl(asas.statements)`. */
    statements: statements as Readonly<Record<string, readonly string[]>>,
    /** Every built operation, flat. Its `procedures` view is a type, keyed by kayan then operation. */
    operations: operationTable as OperationTable<Procedures<KayanList, GlobalList, All, L>>,
    /** The router the first plug built, which a typed client is built from; `undefined` for `fetchHttp`. */
    router: plugs[0]?.router as Http['router'],
    /** Every target as the language passed it, so `asas.targets.drizzle.db` is drizzle. A screen also carries its projection under `client`. */
    targets: Object.fromEntries(
      Object.entries(buildTargets as L['targets']).map(([name, target]) => [name, isScreen(target) ? { ...target, client: screens[name] } : target]),
    ) as {
      [Name in keyof L['targets']]: L['targets'][Name] extends { tables: unknown; type: 'drizzle' }
        ? Omit<L['targets'][Name], 'tables'> & {
            tables: BuiltTables<All, Name, ServiceOf<L>['store'], L['kinds']>
          }
        : L['targets'][Name] extends { capability: 'screen' }
          ? L['targets'][Name] & { client: ScreenClient }
          : L['targets'][Name]
    },
    // Dynamic keys were checked during resolution; this is their one typed
    // construction boundary, after every operation gained a runtime row proof.
    kayan: Object.fromEntries(
      Object.entries(built).filter(([name]) => !globalNames.has(name)),
    ) as Writes<KayanList, All, L, Actor>,
    /** One row per global, under `findOne` and `update`. */
    global: Object.fromEntries(
      Object.entries(built).filter(([name]) => globalNames.has(name)),
    ) as Globals<GlobalList, All, L, Actor>,
    /** The strategies in the order the loop tries them, and the loop itself. */
    auth: {
      strategies: strategies as One[],
      actor: resolveActor,
    },
    handler: async (request: Request) => {
      const pathname = new URL(request.url).pathname
      for (const strategy of strategies) {
        if (!strategy.handler) continue
        const prefix = `/api/auth/${strategy.name}`
        if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
          // Read here first, so a client that goes away mid-body is answered 499 here rather than
          // logged by the provider as its own 500.
          if (!request.body) return strategy.handler(request)
          const body = await boundedBody(request, auth!.maxBodyBytes)
          if (body instanceof Response) return body
          return strategy.handler(new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal }))
        }
      }
      // The report is the handler's own route, so a build that drops a plug keeps it. One actor
      // thunk for the whole request: each strategy-loop run is a store read.
      let resolved: Promise<Actor | null> | undefined
      const who = () => (resolved ??= resolveActor(request.headers))
      if (pathname === '/api/access' && request.method === 'GET') {
        return Response.json(await accessReport(reportable, await who()), {
          headers: { 'content-type': 'application/json' },
        })
      }
      // The handler's own for the reason the report is.
      const commented = await comments?.handle(request, who)
      if (commented) return commented
      const filed = await storageServe?.(request, who)
      if (filed) return filed
      // The auth arm first, since `resolve` reserves `auth` under the same `/api`. A plug that
      // matched nothing answers `null` and the next is asked.
      for (const plug of plugs) {
        const answered = await plug.handle(request, who)
        if (answered) return answered
      }
      return new Response('Not found', { status: 404 })
    },
    connect: async ({ readOnly }: { readOnly?: boolean } = {}) => {
      // `readOnly` writes nothing: no push.
      for (const [, store] of stores) await store.connect({ readOnly })
      if (!readOnly) await refuseExtraTenants()
    },
    destroy: async () => {
      for (const [, store] of stores) await store.destroy()
    },
  }
  // Frozen deep once nothing of the build writes to it: the runner reads every record at call
  // time. Library objects are left alone, since freezing them breaks them.
  const shapers = Object.entries(language.targets).filter(([, target]) => !isAccess(target) && !isScreen(target) && !isService(target) && !isVersions(target) && !isStorage(target) && !isTenant(target))
  const library = new Set<unknown>(operationTable.map((one) => one.input))
  const foreign = (one: { targets?: unknown; custom?: unknown }) => {
    library.add(one.custom)
    for (const [name] of shapers) library.add((one.targets as Record<string, unknown> | undefined)?.[name])
  }
  for (const one of [...declared, ...resolved, ...Object.values(built)] as (Kayan & { operations?: Record<string, unknown> })[]) {
    foreign(one)
    library.add(one.auth)
    for (const field of Object.values(one.fields)) foreign(field)
    for (const operation of [...Object.values(one.operations ?? {}), ...Object.values(one.targets?.service?.operations ?? {})] as { targets?: Record<string, { fields?: Record<string, object> }>; output?: unknown }[]) {
      foreign(operation)
      library.add(operation.output)
      for (const block of Object.values(operation.targets ?? {})) for (const field of Object.values(block?.fields ?? {})) foreign(field)
    }
  }
  const seen = new WeakSet<object>()
  const freeze = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value) || library.has(value)) return
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return
    seen.add(value)
    Object.freeze(value)
    for (const nested of Object.values(value)) freeze(nested)
  }
  for (const record of [declared, resolved, built, asas.kayan, asas.global, operationTable, screens]) freeze(record)
  // Keyed by the build, off its public shape.
  resolvedKayans.set(asas, Object.freeze(Object.fromEntries(resolved.map((one) => [one.name, one]))))
  if (storage && stored.length) recordStorage(asas, { config: storage, kayan: stored, storeOf: (one) => buildTargets[one.store] as Store })
  // A strategy pushed onto the list, or a handler or target swapped in, would answer every later request.
  for (const record of [strategies, asas.auth, asas.targets, asas]) Object.freeze(record)
  return asas
}
