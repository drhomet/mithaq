import type { KayanAuth } from '../asas/actor.ts'
import type { Ref } from './user.ts'
import type { AnyOperation, ResolvedOperation } from '../asas/runner/steps.ts'
import type { Operator, Where } from './where.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import type { Rules } from '../base/rules.ts'
import type { Rule, RuleValue } from '../base/rules.ts'
import type { Kind, defaultKinds } from '../base/kinds.ts'
import type { RichTextRead } from '../rich-text/value.ts'
import type { ResolvedStorage } from '../storage/storage.ts'
import type { RefOf, ScreenField, ScreenKeys } from '../screen/index.ts'

/** What a field access callback is handed. */
export type FieldAccessArgs<
  User = unknown,
  Doc extends Record<string, unknown> = Record<string, unknown>,
  Id = unknown,
  Data extends Record<string, unknown> = Partial<Doc>,
> = {
  data?: Data
  doc?: Doc
  id?: Id
  req?: unknown
  siblingData?: Record<string, unknown>
  user: User | null
}
export type FieldAccess<
  User = unknown,
  Doc extends Record<string, unknown> = Record<string, unknown>,
  Id = unknown,
  Data extends Record<string, unknown> = Partial<Doc>,
> = (args: FieldAccessArgs<User, Doc, Id, Data>) => boolean | Promise<boolean>

type StoredFieldAccess = FieldAccess | (ActorBoundAccess<unknown> & { readonly __mithaqFieldData: unknown; readonly __mithaqFieldId: unknown })
type StoredAccess = { create?: Access; read?: Access; update?: Access; delete?: Access } | (ActorBoundAccess<unknown> & { create?: unknown; read?: unknown; update?: unknown; delete?: unknown })

/** Copy in every locale a project declares, one string each. */
export type Localized<Locale extends string = string> = Readonly<Record<Locale, string>>

/** A label a project resolves itself, such as a compiled paraglide message: `label: m.course_title`. It takes nothing. */
export type LabelFunction = () => string

/** A scope's own copy, keyed flat: one entry per key, each a record per locale or a function. */
export type MessageMap<Locale extends string = string> = Readonly<Record<string, Localized<Locale> | LabelFunction>>

/** A scope's copy as a declaration writes it, nested by the parts of the key, so a field's name is written once. */
export interface MessageTree<Locale extends string = string> {
  readonly [key: string]: Localized<Locale> | LabelFunction | MessageTree<Locale>
}

/** The locales a language declared, or any string when it declared none. */
export type LocalesOf<L> = L extends { locales: readonly (infer Locale extends string)[] } ? Locale : string

/** The service target a language declares, found by its capability. */
export type ServiceOf<L> = L extends { targets: infer Targets }
  ? Extract<Targets[keyof Targets], { capability: 'service' }>
  : never

type Named<Locale extends string = string> = {
  access?: { create?: StoredFieldAccess; read?: StoredFieldAccess; update?: StoredFieldAccess }
  /** One string per locale the language declares, every one required. */
  label?: Localized<Locale> | LabelFunction
  /** What the field is, in a sentence, and the hint its empty control shows. */
  description?: Localized<Locale> | LabelFunction
  placeholder?: Localized<Locale> | LabelFunction
  /** What a text or number field's input group draws before and after its value. */
  prefix?: Localized<Locale>
  suffix?: Localized<Locale>
  /** The closed list a text field's value is one of. */
  options?: readonly { readonly value: string; readonly label: Localized<Locale> }[]
  /** The column name. A relationship without one gets `<snake_case name>_id`. */
  dbName?: string
  /**
   * One entry per target that has something to say about this field, by the target's name. A store's or
   * a schema target's entry is the whole built thing, used as-is with the rules skipped; a screen's says how it draws the field.
   */
  targets?: Record<string, unknown>
  /** An open bag the project's own code reads; nothing in mithaq does, and it stays on the server. */
  custom?: Record<string, unknown>
}

// A key only one target reads goes under `targets.<name>`, replacing that target's derived value and rules.
type FieldKind<KindName extends string> = KindName extends 'join'
  ? {
      kind: KindName
      /** The kayan whose rows this field holds, as a thunk or a name. */
      relationTo: string | (() => Kayan)
      /** The child's own relationship field that holds this row's id. */
      on: string
      /** How many of the child's rows one populated read carries, over the service target's `joinLimit`. */
      defaultLimit?: number
      /** The order the child's rows come back in: one field of the child, `-` for descending. */
      defaultSort?: string
      hasMany?: never
    }
  : // An unbound field has no language, so only base's relationship is known
    // to point at a row here. A field bound to a language reads its kind's own
    // `pointsAtRow` (`BoundField` below).
    KindName extends 'relationship'
  ? {
        kind: KindName
        /** The kayan this field points at, as a thunk, so two kayan may point at each other, or as a name. */
        relationTo: string | (() => Kayan)
        /** Whether this field holds a set of rows rather than one, kept in a join table and read back as an array of ids. */
        hasMany?: true
        on?: never
        defaultLimit?: never
        defaultSort?: never
      }
  : { kind: KindName; relationTo?: never; hasMany?: never; on?: never; defaultLimit?: never; defaultSort?: never }

/** A field, open over locales: a project's own declaration goes through `FieldOf<L>`, which narrows them. */
export type Field<KindName extends string = string, RuleValues = Rules> = KindName extends unknown
  ? Named & { rules?: Partial<RuleValues> } & FieldKind<KindName>
  : never

/** A field as it is after a build, open over locales for `Field`'s reason. */
export type RuntimeField = Named & {
  kind: string
  rules?: Record<string, unknown>
  relationTo?: string | (() => Kayan)
  hasMany?: true
  /** A `join` field only: the child's relationship that points back at this kayan. */
  on?: string
  /** A `join` field only: how many of the child's rows one populated read carries. */
  defaultLimit?: number
  /** A `join` field only: the order the child's rows come back in. */
  defaultSort?: string
}

export type LanguageShape = {
  kinds: Record<string, Kind>
  rules: Record<string, Rule>
  targets: Record<string, unknown>
  locales?: readonly string[]
}

type RuleNames<K> = K extends Kind<unknown, infer Name> ? Name : never
export type KindValue<K> = K extends Kind<infer Value, string> ? Value : never

type BoundRules<L extends LanguageShape, K extends keyof L['kinds']> = {
  [Name in Extract<RuleNames<L['kinds'][K]>, keyof L['rules']>]?: RuleValue<L['rules'][Name]>
} &
  ('defaultValue' extends RuleNames<L['kinds'][K]>
    ? {
        defaultValue?: KindValue<L['kinds'][K]> | Ref<KindValue<L['kinds'][K]>>
      }
    : {})

// What a field bound to one language may write under `targets.<screen>`.
type BoundField<L extends LanguageShape, K extends keyof L['kinds'] & string> = Named<LocalesOf<L>> &
  {
    kind: K
    rules?: BoundRules<L, K>
    targets?: Record<string, unknown> & { [Screen in ScreenKeys<L['targets']>]?: ScreenField<RefOf<L['targets'][Screen], L['kinds']>> }
  } &
  (K extends 'join'
    ? { relationTo: string | (() => Kayan); on: string; defaultLimit?: number; defaultSort?: string; hasMany?: never }
    : // A kind that points at a row says so, and a field of it names the kayan it points at.
      L['kinds'][K] extends { pointsAtRow: true }
      ? { relationTo: string | (() => Kayan); hasMany?: true; on?: never; defaultLimit?: never; defaultSort?: never }
      : { relationTo?: never; hasMany?: never; on?: never; defaultLimit?: never; defaultSort?: never })

/** Field union derived once from a concrete language's kind and rule registries. */
export type FieldOf<L extends LanguageShape> = {
  [K in keyof L['kinds'] & string]: BoundField<L, K>
}[keyof L['kinds'] & string]

/** What a kayan writes under `targets.service`: its operations, and the store and schema target it runs them through. */
export type KayanService = {
  /** Every operation this kayan answers; one that declares none answers none. */
  operations?: Record<string, AnyOperation>
  /** The store this kayan is written through. Defaults to the service target's. */
  store?: string
  /** The target a write is validated against. Defaults to the service target's. */
  schema?: string
}

/** The three keys a kayan's `targets.service` may carry, in one place. */
export const kayanServiceKeys = ['operations', 'schema', 'store'] as const

/**
 * One index over the columns its fields name, in that order; `unique` is `false` when left out.
 * `nullsNotDistinct`, on a unique index, makes rows whose columns are null collide.
 */
export type CompoundIndex<Field extends string = string> = { fields: Field[] } & (
  | { unique?: boolean; nullsNotDistinct?: never }
  | { unique: true; nullsNotDistinct?: boolean }
)

type GroupEntry<Field extends string> = Field | [Field, ...Field[]]
type GroupEntries<Field extends string> = [GroupEntry<Field>, ...GroupEntry<Field>[]]

/**
 * Indexes within a tenant-owned kayan's tenant field, each led by it: `{ within: 'organization',
 * unique: ['title', ['code', 'term']], index: ['startsAt'] }` is unique `(organization, title)`,
 * unique `(organization, code, term)` and plain `(organization, startsAt)`.
 */
export type IndexGroup<Field extends string = string, Within extends string = string> = { within: Within } & (
  | { unique: GroupEntries<Field>; index?: GroupEntry<Field>[] }
  | { unique?: GroupEntry<Field>[]; index: GroupEntries<Field> }
)

/**
 * A kayan's indexes: a list built beside the defaults, or a function of the defaults that answers the whole list.
 * The defaults are one unique index per `unique` field, over the field alone on a shared kayan and over the
 * ownership field and the field on a tenant-owned one. A plain entry is over exactly its fields.
 */
export type Indexes<Field extends string = string, Within extends string = string> =
  | (CompoundIndex<Field> | IndexGroup<Field, Within>)[]
  | ((args: { defaults: CompoundIndex<Field>[] }) => (CompoundIndex<Field> | IndexGroup<Field, Within>)[])

export type Kayan = {
  name: string
  fields: Record<string, RuntimeField>
  access?: StoredAccess
  /** The provider that authenticates this kayan: `betterAuth({ server })`, `local({ secret })`, or a strategy the project wrote. */
  auth?: KayanAuth
  /** The table name. Defaults to the name. */
  dbName?: string
  /** The Postgres schema this kayan's tables are built in. No key, or `'public'`, is `public`. */
  schemaName?: string
  /** Indexes over this kayan's own columns; each field named must be one column of its own table. */
  indexes?: (CompoundIndex | IndexGroup)[] | ((args: { defaults: never }) => (CompoundIndex | IndexGroup)[])
  /** One entry per target with something to say about this kayan: `{ drizzle: pgTable(...) }`, `targets.<screen>`, `targets.service`. */
  targets?: Record<string, unknown> & { service?: KayanService }
  /** This kayan's own copy, beside the labels its fields carry, nested by the parts of each key. */
  messages?: MessageTree
  /** Where `mithaq generate messages` writes this kayan's file, if not the default. */
  out?: string
  /** An open bag the project's own code reads; nothing in mithaq does, and it stays on the server. */
  custom?: Record<string, unknown>
  /** A kayan of one row, which `defineGlobal` sets: it runs `findOne` and `update`, finds its row without an id and makes it when none. */
  single?: true
}

export type AccessArgs<
  User = unknown,
  Data extends Record<string, unknown> = Record<string, unknown>,
  Id = unknown,
> = {
  data?: Data
  id?: Id
  req?: unknown
  slug: string
  user: User | null
}
export type AccessResult = boolean | Where
export type Access<User = unknown, Data extends Record<string, unknown> = Record<string, unknown>, Id = unknown> = (args: AccessArgs<User, Data, Id>) => AccessResult | Promise<AccessResult>
export type AdminAccessArgs<User = unknown> = { req?: unknown; user: User }
export type AdminAccess<User = unknown> = (args: AdminAccessArgs<User>) => boolean | Promise<boolean>

export type ActorBoundAccess<Actor> = { readonly __mithaqAccessActor: Actor }
export type ActorBoundFieldAccess<Actor, Doc extends Record<string, unknown>, Id> = FieldAccess<Actor, Doc, Id> & ActorBoundAccess<Actor> & {
  readonly __mithaqFieldData: Doc
  readonly __mithaqFieldId: Id
}
export const fieldAccessFor = <Actor>() =>
  <Doc extends Record<string, unknown>, Id, Fn extends FieldAccess<Actor, Doc, Id> = FieldAccess<Actor, Doc, Id>>(access: Fn): Fn & ActorBoundFieldAccess<Actor, Doc, Id> =>
    access as Fn & ActorBoundFieldAccess<Actor, Doc, Id>

type AccessReturnCheck<Map> = {
  [Key in keyof Map]: Map[Key] extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return extends AccessResult | Promise<AccessResult> ? Return : never
    : never
}
export const accessFor = <Actor>() =>
  <AccessMap extends { create?: unknown; read?: unknown; update?: unknown; delete?: unknown }>(
    access: AccessMap & AccessReturnCheck<AccessMap>,
  ): AccessMap & ActorBoundAccess<Actor> => access as AccessMap & ActorBoundAccess<Actor>

/** A field after `buildAsas` has filled in what the kayan left implicit. */
export type ResolvedField<F extends RuntimeField = RuntimeField> = F & {
  name: string
  /** The SQL column name. */
  column: string
  /** The name of the kayan this field belongs to, which the copy key a refusal carries names. */
  kayan?: string
  /** The key this build gives the schema target of the field's kayan. */
  schemaTarget?: string
  /** The language's locales in declared order, on a `localized` field only, so a target can build one thing per locale. */
  locales?: readonly string[]
  /** How this field's kind makes the write's moment, where it declares one. */
  now?: () => unknown
  /** This field's kind's own implementations, keyed by target type. */
  kindTargets?: Readonly<Record<string, unknown>>
  /** The `Where` operators this field's kind takes, where it names them. */
  operators?: readonly Operator[]
  /** `false` where this field's kind cannot order a page. */
  sortable?: false
  /** The kayan of this build that hold files, which a value may point at from inside it. */
  filesIn?: readonly string[]
  /** How a schema target reads back a stored `richText` value: with its shape alone. */
  richText?: (value: unknown) => RichTextRead
  /** Relationship only: the kayan this field points at. */
  target?: ResolvedKayan
}

export type ResolvedKayan<K extends Kayan = Kayan> = Omit<K, 'indexes' | 'messages' | 'operations'> & {
  /** Every index the store builds: the declared list and the defaults, or what the kayan's function answered. */
  indexes: CompoundIndex[]
  /** The table name: the kayan's `dbName`, or its name. */
  table: string
  /** The kayan's own copy, flattened by `resolve` to the keys a generated file carries. */
  messages?: MessageMap
  /** The store and the schema target, the kayan's own or the service target's. */
  store: string
  schema: string
  fields: { [Name in keyof K['fields']]: ResolvedField<K['fields'][Name]> }
  /** Every operation this kayan declared, and nothing merged in. */
  operations: Record<string, ResolvedOperation>
  /** The name of the field that marks a row deleted, on a kayan that carries it. */
  softDelete?: string
  /** The name of the field bound through `targets.tenant`, on a tenant-owned kayan. */
  tenant?: string
  /** What this kayan keeps of its past, on a kayan that writes the versions target. */
  versions?: ResolvedVersions
  /** The files this kayan holds and the storage they go through, on a kayan that writes the storage target. */
  storage?: ResolvedStorage
  /** The schema target's `row` shape, so a caller's `where` is checked against each column's kind before any store is asked. */
  rowShape?: StandardSchemaV1
}

/** One kayan's versions, as `resolve` reads them off its own `targets.<versions>` and the target. */
export type ResolvedVersions = {
  /** The versions table, `_<table>_versions`. */
  table: string
  /** That table as a kayan: `parent` a relationship back to this kayan. The `version` column is no field: nothing filters by what a version holds. */
  kayan: ResolvedKayan
  /** Whether a write with `{ draft: true }` saves a version alone. */
  drafts: boolean
  /**
   * Whether a draft save with `{ autosave: true }` may overwrite the latest
   * autosave in place, and the interval in milliseconds a screen autosaves at.
   */
  autosave: false | { interval: number }
  /** How many versions of one row are kept; `0` keeps every one. */
  max: number
}

// A WeakMap rather than a key on the build, so a browser projection, a JSON
// serialization and a caller enumerating the namespace all miss it.
export const resolvedKayans = new WeakMap<object, Readonly<Record<string, ResolvedKayan>>>()

// One function for the default sort and the copy scan's page, so the rule cannot drift between them.
export const sortableFields = (kayan: ResolvedKayan): string[] =>
  Object.keys(kayan.fields).filter((name) => !unsortable(kayan.fields[name]!))

/**
 * Whether one field cannot order a page: a localized field or a set, a join,
 * a field whose kind says it cannot, or one a screen took out of sorting.
 */
export const unsortable = (field: ResolvedField): boolean =>
  !!field.rules?.localized || !!field.hasMany || field.kind === 'join' || field.sortable === false
  || Object.values(field.targets ?? {}).some((one) => (one as { sortable?: unknown } | undefined)?.sortable === false)
