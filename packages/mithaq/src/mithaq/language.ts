import { rows, type CheckedTable, type RowTable, type Rows, type RowsOptions } from './rows.ts'
import { actorPermissions } from '../asas/actor.ts'
import { user, type UserRefs } from './user.ts'
import type { AccessTarget, CommandActor, SystemRoles } from '../rbac/index.ts'
import type { ServiceTarget } from '../service/index.ts'
import type { ScreenTarget } from '../screen/index.ts'
import type { VersionsTarget } from '../versions/index.ts'
import type { StorageTarget } from '../storage/storage.ts'
import { buildAsas, type HttpPlug } from '../asas/build.ts'
import type { AuthConfig } from '../asas/build.ts'
import type { AuditHandler, Derives, DerivedShapes } from '../asas/runner/steps.ts'
import type { Where } from './where.ts'
import { defineGlobal, defineKayan } from './define.ts'
import type { Kayan, ResolvedField, ResolvedKayan } from './types.ts'
import type { Kind } from '../base/kinds.ts'
import type { Rule, RuleValue } from '../base/rules.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import { composeArkan, type ArkanOf, type ArkanRefusals, type Rukn } from './rukn.ts'

// The thing built is under the target's own word for it: `shape` or `column`.
type RuleHandler<Rules, Name extends keyof Rules, Built, Key extends string> = (
  args: { [K in Key]: Built } & { value: RuleValue<Rules[Name]>; field: ResolvedField },
) => Built

/** What a target's command receives: the built project, and the words after the command, `--check` among them. */
export type CommandInput = { asas: { destroy(): Promise<void> }; flags: readonly string[] }

/** What a command answers: the exit code the bin exits with, 0 for nothing to say. */
export type Command = (input: CommandInput) => Promise<number>

export type Target<
  Kinds extends Record<string, Kind> = Record<string, Kind>,
  Rules extends Record<string, Rule> = Record<string, Rule>,
  Built = unknown,
  Key extends string = 'shape',
> = {
  readonly capability?: 'schema'
  /** What this target is, by the constructor that made it: `'drizzle'`, `'zod'`, `'screen'`. Kinds' own implementations are keyed by it. */
  readonly type?: string
  /** The commands this target answers, run as `mithaq <target> <name>` and swept with `--check` by `mithaq generate --check`. */
  readonly commands?: Record<string, Command>
  /** The kinds this target builds an id of, so a fourth fails the build rather than the pushed schema. */
  readonly idKinds?: readonly (keyof Kinds & string)[]
  kinds: { [Name in keyof Kinds]: (field: ResolvedField, ...rest: never[]) => Built }
  rules: { [Name in keyof Rules]: RuleHandler<Rules, Name, Built, Key> }
}

/** A target that shapes a field, and assembles the shapes a kayan's fields derive, so core never composes a schema itself. */
export type SchemaTarget<
  Kinds extends Record<string, Kind> = Record<string, Kind>,
  Rules extends Record<string, Rule> = Record<string, Rule>,
  Built = unknown,
  Schema extends StandardSchemaV1 = StandardSchemaV1,
> = Target<Kinds, Rules, Built> & {
  /** Declared, never sniffed, the same way a store declares its own. */
  readonly capability: 'schema'
  /** The create, update, row and other shapes a kayan's fields derive. */
  derive<F extends Record<string, ResolvedField>>(fields: F): DerivedShapes<Schema>
  /** The same mapping written as a type, because a conditional type cannot read `derive`'s generic signature for one kayan. Never set at runtime. */
  readonly derives?: Derives
}

type RuntimeSchema = {
  readonly capability?: 'schema'
  readonly type?: string
  readonly derives?: Derives
  readonly commands?: Record<string, Command>
  readonly idKinds?: readonly string[]
  kinds: Record<string, (field: ResolvedField, ...rest: never[]) => unknown>
  rules: Record<string, (...args: never[]) => unknown>
  derive(fields: Record<string, ResolvedField>): DerivedShapes
}

type RuntimeStore = Omit<Store, 'kinds' | 'rules'> & {
  kinds: RuntimeSchema['kinds']
  rules: RuntimeSchema['rules']
}

type RuntimeAccess = Omit<AccessTarget, 'access' | 'roles' | 'rolesOf'> & {
  access: RowTable
  roles: SystemRoles
  rolesOf?: (user: never) => readonly string[]
}

type RuntimeService = ServiceTarget

export type RuntimeTarget = RuntimeAccess | RuntimeSchema | RuntimeScreen | RuntimeService | RuntimeStore | StorageTarget | TenantTarget | VersionsTarget

/** The field a tenant-owned kayan places: one row of `RelationTo`, written by the application on create and never after. */
export type TenantField<RelationTo extends string = string> = {
  readonly kind: 'relationship'
  readonly relationTo: RelationTo
  readonly rules: {
    readonly required: true
    readonly index: true
    readonly providedBy: { readonly create: 'application'; readonly update: 'never' }
    readonly onDelete: 'restrict'
  }
  readonly targets: { readonly tenant: true }
}

/**
 * Which kayan a row's tenant is, and the field a tenant-owned kayan places. A kayan carrying
 * a field bound through `targets.tenant` is tenant-owned; one carrying none is shared.
 */
export type TenantTarget<RelationTo extends string = string> = {
  readonly capability: 'tenant'
  readonly relationTo: RelationTo
  readonly onDelete: 'restrict'
  /** How many organizations the project holds; in `'one'` a `connect()` over more refuses to start. */
  readonly organizations: 'one' | 'many'
  readonly field: TenantField<RelationTo>
  /**
   * Whether this actor is backoffice staff in the trusted backoffice app, who may read every
   * tenant's rows with `tenant: 'all'` and never write through it. Absent, no one may.
   */
  readonly backoffice?: (args: { user: unknown }) => boolean | Promise<boolean>
}

type RuntimeScreen = ScreenTarget

/** A target that shapes a field: a store or a schema target. */
export type FieldTarget = RuntimeSchema | RuntimeStore

/** The runtime shape of the one target that says who may do what. */
export type AccessCapability = RuntimeAccess

/**
 * A target that also holds the rows: a database adapter, or anything else a write can land in.
 * The writes take the transaction, so everything one write does commits or rolls back together.
 */
export type Store<
  Kinds extends Record<string, Kind> = Record<string, Kind>,
  Rules extends Record<string, Rule> = Record<string, Rule>,
  Built = unknown,
  Tx = unknown,
  Row extends Record<string, unknown> = Record<string, unknown>,
> = Omit<Target<Kinds, Rules, Built, 'column'>, 'capability'> & {
  /** Declared, never sniffed: a target says which of the two things it is. */
  readonly capability: 'store'
  /** `'drizzle'` where this store's `db` and `tables` are drizzle's, which local auth reads its kayan through. */
  readonly sql?: 'drizzle'
  /** Builds what this store needs for one build, answering the store that build uses from then on. */
  init(kayan: ResolvedKayan[]): void | Store<Kinds, Rules, Built, Tx, Row>
  /** Reaches the database and, unless `readOnly`, prepares it. `readOnly` writes nothing. */
  connect(args?: { readOnly?: boolean }): Promise<void>
  /** Run `fn` in one transaction. What it returns is what the write returns. */
  transaction<Result>(fn: (tx: Tx) => Promise<Result>): Promise<Result>
  insert(args: { tx: Tx; kayan: string; data: Record<string, unknown> }): Promise<Row>
  update(args: { tx: Tx; kayan: string; id: unknown; data: Record<string, unknown>; where?: Where }): Promise<Row>
  remove(args: { tx: Tx; kayan: string; id: unknown; where?: Where }): Promise<Row>
  /** Required, so no store can exist that the managed reads cannot use. */
  find(args: {
    kayan: string
    args: {
      limit: number
      /**
       * A store must hold the rows it returns until the transaction ends: a step that compares a row, such as
       * `expectedUpdatedAt`, relies on it. `'update'` holds them against every other writer; `'keyShare'` against
       * a delete or a change of their key alone, as a Postgres foreign key holds the row it names.
       */
      lock?: 'update' | 'keyShare'
      page: number
      sort: { field: string; direction: 'asc' | 'desc' }
      where?: Where
    }
    tx?: Tx
  }): Promise<{ docs: Row[]; totalDocs: number }>
  /** Counts matching rows without loading them. Without it, `find` with a limit of `0` is asked. */
  count?(args: { kayan: string; args: { where?: Where }; tx?: Tx }): Promise<number>
  destroy(): Promise<void>
}

/** A target that holds rows. Takes `undefined`, so a caller can name the bad target in its own throw. */
export const isStore = (target: RuntimeTarget | undefined): target is RuntimeStore => target?.capability === 'store'

/** A target that says who may do what. */
export const isAccess = (target: RuntimeTarget | undefined): target is RuntimeAccess =>
  target?.capability === 'access'

/** A place a build draws its kayan. */
export const isScreen = (target: RuntimeTarget | undefined): target is RuntimeScreen =>
  target?.capability === 'screen'

/** The runner. */
export const isService = (target: RuntimeTarget | undefined): target is RuntimeService =>
  target?.capability === 'service'

/** A kayan's versions. */
export const isVersions = (target: RuntimeTarget | undefined): target is VersionsTarget =>
  target?.capability === 'versions'

/** The target that says which kayan a row's tenant is. */
export const isTenant = (target: RuntimeTarget | undefined): target is TenantTarget =>
  target?.capability === 'tenant'

/**
 * A field bound through `targets.tenant`, with the tenant target's own field under it, so one
 * written by hand takes every key and rule it leaves out. Any other field is handed back as it is.
 */
export const tenantDefaults = <F extends { targets?: Record<string, unknown>; rules?: Record<string, unknown> }>(language: Language, field: F): F => {
  const target = language.targets.tenant
  if (field.targets?.tenant === undefined || !isTenant(target)) return field
  return { ...target.field, ...field, rules: { ...target.field?.rules, ...field.rules } }
}

/** Where a kayan's files are kept. */
export const isStorage = (target: RuntimeTarget | undefined): target is StorageTarget =>
  target?.capability === 'storage'

// The one service target of a build; `buildAsas` refuses a build without one.
export const serviceTargetOf = (language: Language): RuntimeService | undefined =>
  Object.values(language.targets).find((target) => isService(target)) as RuntimeService | undefined

/** The compiled rows of the language's access target, kept off the public shape. */
const LANGUAGE_ROWS = Symbol('mithaq.language.rows')

// The one access target of a build, or nothing; `buildAsas` refuses two.
export const accessTargetOf = (language: Language): RuntimeAccess | undefined =>
  Object.values(language.targets).find((target) => isAccess(target)) as RuntimeAccess | undefined

// Compiled once by `defineMithaq`; every kayan that keeps the tenant field inherits it.
export const languageRows = (language: Language): Rows | undefined =>
  (language as Record<symbol, Rows | undefined>)[LANGUAGE_ROWS]

/** The language: the arkan, the locales and one entry per target. */
export type Language = {
  kinds: Record<string, Kind>
  rules: Record<string, Rule>
  targets: Record<string, RuntimeTarget>
  /** The arkan the kinds, rules and some targets came from. */
  arkan?: readonly Rukn[]
  /**
   * The locales every piece of copy is written in. Every label then needs one string per locale,
   * so a half-translated project fails to compile. mithaq resolves no locale.
   */
  locales?: readonly string[]
}

// Keys of the service target, refused on the root by name.
export const serviceKeys = ['beforeSteps', 'afterSteps', 'afterCommit', 'authorize', 'softDelete', 'store', 'schema', 'audit', 'depth'] as const

// Intersected with the language rather than replacing it, so a target reaches the
// app whole: the drizzle target's `db` and `tables` are read off `asas.targets`.
type StoreKeys<Targets> = {
  [Name in keyof Targets]: Targets[Name] extends { capability: 'store' } ? Name : never
}[keyof Targets] & string
type SchemaKeys<Targets> = {
  [Name in keyof Targets]: Targets[Name] extends { capability: 'access' | 'screen' | 'service' | 'storage' | 'store' | 'tenant' | 'versions' } ? never : Name
}[keyof Targets] & string

// A kind carrying its own implementation for this target's type need not be in its map.
type Owned<Kinds, Name extends keyof Kinds, K, T> = Name extends keyof K
  ? Name
  : T extends { readonly type: infer Type extends string }
    ? Kinds[Name] extends { readonly targets: { readonly [P in Type]: unknown } }
      ? never
      : Name
    : Name

type CheckedTarget<Kinds extends Record<string, Kind>, Rules extends Record<string, Rule>, Targets, T> =
  // These build no field, so there are no maps to check.
  T extends { capability: 'access' | 'storage' | 'tenant' | 'versions' }
    ? T
    : // Transport is its own category, so `http` and `orpc` are refused on the runner by name.
      T extends { capability: 'service' }
    ? T & Omit<ServiceTarget, 'store' | 'schema'> & {
        store: StoreKeys<Targets>
        schema: SchemaKeys<Targets>
        /** The audit sink, which takes every actor the runner hands it: the request's and `mithaq rbac assign`'s. */
        audit?: AuditHandler<ActorOf<{ targets: Targets }> | CommandActor>
        http?: never
        orpc?: never
      }
    : // A screen declares `controls` and no `rules`, so it is graded on `controls` alone.
      T extends { capability: 'screen'; controls: infer K }
    ? T & {
        controls: {
          [Name in keyof Kinds as string extends keyof K ? never : Owned<Kinds, Name, K, T>]: Name extends keyof K
            ? K[Name]
            : never
        } & {
          [Name in string extends keyof K ? never : Exclude<keyof K, keyof Kinds>]: never
        }
      }
    : T extends { kinds: infer K; rules: infer R }
    ? T & {
        kinds: {
          [Name in keyof Kinds as string extends keyof K ? never : Owned<Kinds, Name, K, T>]: Name extends keyof K
            ? K[Name]
            : never
        } & {
          [Name in string extends keyof K ? never : Exclude<keyof K, keyof Kinds>]: never
        }
        rules: {
          [Name in keyof Rules as string extends keyof R ? never : Name]: Name extends keyof R
            ? R[Name] extends (args: infer Args) => infer Built
              ? (args: Omit<Args, 'value' | 'field'> & { value: RuleValue<Rules[Name]>; field: ResolvedField }) => Built
              : never
            : never
        }
      } & (T extends { idKinds: readonly unknown[] }
        ? {
            // Only reaches a target written as a literal: a factory's return declares `idKinds?`,
            // which this conditional does not match.
            idKinds: readonly (keyof Kinds & string)[]
          }
        : unknown)
    : never

// Only the project's own targets are graded here; a rukn's target is checked at `buildAsas`.
type CheckedLanguage<L> = L extends {
  arkan: infer A extends readonly Rukn[]
  targets: infer Targets extends Record<string, RuntimeTarget>
}
  ? [ArkanOf<A, 'kinds'>, ArkanOf<A, 'rules'>] extends [infer Kinds extends Record<string, Kind>, infer Rules extends Record<string, Rule>]
    ? L & {
          kinds?: never
          rules?: never
          targets: Targets & {
            [Name in keyof Targets]: CheckedTarget<Kinds, Rules, Targets & ArkanOf<A, 'targets'>, Targets[Name]>
          }
        } & { [Key in Extract<keyof L, (typeof serviceKeys)[number] | 'operations'>]: never }
        & {
          [Stray in {
            [Name in keyof Kinds]: `kind "${Name & string}" accepts rule "${Exclude<Kinds[Name]['rules'][number], keyof Rules> & string}", which no rukn brings`
          }[keyof Kinds]]: never
        }
        & ArkanRefusals<A, Targets>
        & {
          // A field binds to the tenant target through `targets.tenant`, so the target answers to that key alone.
          [Misnamed in {
            // A target cast to `never` extends every capability, so it is left to `buildAsas`.
            [Name in keyof Targets]: [Targets[Name]] extends [never] ? never
              : Targets[Name] extends { capability: 'tenant' }
                ? Name extends 'tenant' ? never : `target "${Name & string}" declares capability "tenant" and is named "tenant" in targets`
                : never
          }[keyof Targets]]: never
        }
    : never
  : never

/** The language the arkan make: their kinds and rules, and their targets beside the project's. */
type Composed<L> = L extends { arkan: infer A extends readonly Rukn[]; targets: infer Targets }
  ? L & { kinds: ArkanOf<A, 'kinds'>; rules: ArkanOf<A, 'rules'>; targets: Targets & ArkanOf<A, 'targets'> }
  : never

/** The access target a language declared, or nothing where it declared none. */
type AccessOf<L> = L extends { targets: infer Targets }
  ? Extract<Targets[keyof Targets], { capability: 'access' }>
  : never

// The system roles and `'*'`; with no access target a role key is any string.
type RolesOf<L> = [AccessOf<L>] extends [never]
  ? string
  : AccessOf<L> extends { roles: infer Roles }
    ? '*' | (keyof Roles & string)
    : string

// A language with no access target has no actor, so `user` carries no keys.
type ActorOf<L> = NonNullable<AccessOf<L> extends { rolesOf?: infer Reader } ? Reader : never> extends (
  user: infer Actor,
) => unknown
  ? Actor
  : Record<string, never>

type Defined<L extends Language> = L & {
  defineKayan: ReturnType<typeof defineKayan<L>>
  /** `defineKayan` with the operations pinned: a kayan of one row. */
  defineGlobal: ReturnType<typeof defineGlobal<L>>
  buildAsas: <
    const KayanList extends readonly Kayan[],
    const GlobalList extends readonly Kayan[] = readonly [],
    Auth extends AuthConfig = AuthConfig,
    Http extends HttpPlug = HttpPlug,
  >(
    args: Parameters<typeof buildAsas<L, KayanList, GlobalList, Auth, Http>>[1]
  ) => ReturnType<typeof buildAsas<L, KayanList, GlobalList, Auth, Http>>
  /** `rows`, with its role keys checked against the language's `roles`. */
  rows: <const Table extends RowTable>(
    table: Table & CheckedTable<Table, RolesOf<L>>,
    options?: RowsOptions<ActorOf<L>>,
  ) => Rows<Table>
  /** `user`, with its keys checked against the actor this language's `rolesOf` takes. */
  user: UserRefs<ActorOf<L>>
}

// Keyed on the returned `defineKayan`, which every project exports, so `mithaq lock`
// reads the language without the language carrying a key for it.
const received = new WeakMap<object, unknown>()

/** The object `defineMithaq` received, given the `defineKayan` it returned, or nothing. */
export const receivedLanguage = (define: unknown): unknown =>
  typeof define === 'function' ? received.get(define) : undefined

export function defineMithaq<const L>(language: L & CheckedLanguage<L>): Defined<Extract<Composed<L>, Language>>
export function defineMithaq(declared: Omit<Language, 'kinds' | 'rules'>): Defined<Language> {
  // Refused rather than merged: kinds and rules come from the arkan alone.
  const root = (['kinds', 'rules'] as const).find((key) => Object.hasOwn(declared, key))
  if (root) {
    throw new Error(
      `The language declares "${root}" at its root, and kinds and rules come from its arkan alone: lay down arkan: [base], and bring your own in a rukn of your own, defineRukn({ name, ${root} }).`,
    )
  }
  const language = { ...declared, ...composeArkan(declared) } as Language
  // `holds` is passed whether or not the language declares an access target: an actor
  // carries keys only where a target resolved them.
  const target = accessTargetOf(language as Language)
  const options: RowsOptions = {
    holds: actorPermissions as RowsOptions['holds'],
    ...(target?.rolesOf ? { roles: target.rolesOf as RowsOptions['roles'] } : {}),
  }
  const compiled = {
    ...language,
    ...(target && Object.keys(target.access).length ? { [LANGUAGE_ROWS]: rows(target.access, options) } : {}),
  } as Language
  const build = (<
    const KayanList extends readonly Kayan[],
    const GlobalList extends readonly Kayan[] = readonly [],
    Auth extends AuthConfig = AuthConfig,
    Http extends HttpPlug = HttpPlug,
  >(
    args: Parameters<typeof buildAsas<Language, KayanList, GlobalList, Auth, Http>>[1],
  ) => buildAsas<Language, KayanList, GlobalList, Auth, Http>(compiled, args)) as Defined<Language>['buildAsas']
  const define = defineKayan(compiled)
  received.set(define, declared)
  return {
    ...compiled,
    defineKayan: define,
    defineGlobal: defineGlobal(compiled),
    buildAsas: build,
    // A call that names no reader keeps the language's.
    rows: ((table: RowTable, own?: RowsOptions) => rows(table, { ...options, ...own })) as Defined<Language>['rows'],
    user: user as Defined<Language>['user'],
  }
}
