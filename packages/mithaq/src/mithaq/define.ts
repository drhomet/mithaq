import { applyRows, rowFields, rowsOf, type FieldList, type RowFieldWhere } from './rows.ts'
import { languageRows, serviceTargetOf, tenantDefaults } from './language.ts'
import type { Ref } from './user.ts'
import { resolveOperations, type ContextOf, type DefaultLists, type OperationDeclaration, type Operations, type SchemasOf } from '../asas/runner/steps.ts'
import type { DerivedInput, OperationParsed } from '../asas/runner/write.ts'
import type { Language } from './language.ts'
import type { ActorBoundAccess, Access, Field, FieldOf, Indexes, KayanService, KindValue, LocalesOf, MessageTree, RuntimeField, ServiceOf } from './types.ts'
import type { AuthStrategy } from '../asas/actor.ts'
import type { KayanConfigOf } from './rukn.ts'

// The Better Auth declaration's `server` is checked against this language's targets,
// or a factory reading a target the language lacks would fail only at boot.
type KayanAuthOf<Targets> =
  | AuthStrategy
  | { provider: 'local'; options: unknown }
  | { provider: 'better-auth'; server: (targets: Targets, vocabulary: { catalog: readonly string[]; statements: Readonly<Record<string, readonly string[]>> }) => unknown }

// A generic constraint check does no excess-property checking, so a stray locale
// would otherwise ride out on the built kayan's type.
type StrayLocales<Copy, Locale extends string> = { [Stray in Exclude<keyof Copy, Locale>]: never }

// The same refusal at whatever depth a message is nested.
type StrayMessages<Copy, Locale extends string> = Copy extends Readonly<Record<string, string>>
  ? StrayLocales<Copy, Locale>
  : { [Key in keyof Copy]: StrayMessages<Copy[Key], Locale> }

// A member of its own: `Fields` is inferred from the declaration, so the target
// type already holds the stray key and excess-property checking finds nothing.
type StrayDescription<F, Locale extends string> = F extends { description: infer Copy }
  ? { description: StrayLocales<Copy, Locale> }
  : unknown

// A member of its own for the reason `StrayDescription` needs one.
type StrayPlaceholder<F, Locale extends string> = F extends { placeholder: infer Copy }
  ? { placeholder: StrayLocales<Copy, Locale> }
  : unknown

// One entry per target of the build, typed by that target's `type` through `KayanConfigs`. A kayan
// writes nothing under the tenant target: its field decides.
type KayanTargetsOf<
  L extends Language,
  Fields extends Record<string, unknown>,
  Service extends { service?: unknown } = { service?: KayanService },
> = {
  [Name in Exclude<keyof L['targets'], 'service'>]?: L['targets'][Name] extends { capability: 'tenant' } ? never : KayanConfigOf<L, Fields, L['targets'][Name]>
} & Service

/** The language's tenant target, which is under the key `tenant` alone, or `never`. */
type TenantOf<L extends Language> = L['targets'] extends { tenant: infer T extends { capability: 'tenant'; relationTo: string; field: { rules: object } } } ? T : never

// A field bound through `targets.tenant` may change its copy and add `unique`, and nothing it
// would loosen: one row of the tenant kayan, required, indexed, filled once by the application.
type TenantBinding<L extends Language, F> = F extends { targets: { tenant: unknown } }
  ? [TenantOf<L>] extends [never]
    ? { targets: { tenant: never } }
    : {
        kind: 'relationship'
        relationTo: TenantOf<L>['relationTo'] | (() => { name: TenantOf<L>['relationTo'] })
        hasMany?: never
        rules?: {
          required?: true
          index?: true
          providedBy?: { readonly create: 'application'; readonly update: 'never' }
          onDelete?: 'restrict'
          defaultValue?: never
        }
        // A store's or schema target's entry would replace the column the rules build.
        targets: { tenant: true } & { [Name in StoreKeys<L['targets']> | SchemaKeys<L['targets']>]?: never }
      }
  : unknown

type TenantKey<Fields> = { [N in keyof Fields]: Fields[N] extends { targets: { tenant: true } } ? N : never }[keyof Fields] & string

// A field bound by hand carries the target's rules on its type, as `defineKayan` puts them on its value.
type TenantDefaulted<L extends Language, Fields> = true extends { [N in keyof Fields]: Fields[N] extends { targets: { tenant: true } } ? true : never }[keyof Fields]
  ? { [N in keyof Fields]: Fields[N] extends { targets: { tenant: true } } ? Fields[N] & { rules: TenantOf<L>['field']['rules'] } : Fields[N] }
  : Fields

// `never` where the build declares no service target: there is no runner to run an operation.
type OperationOf<
  L extends Language,
  Fields extends Record<string, RuntimeField>,
  Data extends Record<string, unknown> = Record<string, unknown>,
> = [ServiceOf<L>] extends [never]
  ? never
  : OperationDeclaration<DefaultLists, SchemasOf<L, Fields>, LocalesOf<L>, FieldOf<L>, Data, ContextOf<ServiceOf<L>>>

// The shape `input` returns where the operation declares one, else what its store or
// managed read step implies. Relationships are `unknown`: no registry here.
type DataOf<L extends Language, Fields extends Record<string, RuntimeField>, Operation> =
  OperationParsed<Operation, DerivedInput<Operation, Fields, L, []>> extends infer Data
    ? Data extends Record<string, unknown>
      ? Data
      : Record<string, unknown>
    : Record<string, unknown>
type StoreKeys<Targets> = {
  [Name in keyof Targets]: Targets[Name] extends { capability: 'store' } ? Name : never
}[keyof Targets] & string
type SchemaKeys<Targets> = {
  [Name in keyof Targets]: Targets[Name] extends { capability: 'screen' | 'service' | 'storage' | 'store' | 'tenant' | 'versions' } ? never : Name
}[keyof Targets] & string
type NamedStore<Name> = [Name] extends [undefined] ? { store?: undefined } : { store: Name }
type NamedSchema<Name> = [Name] extends [undefined] ? { schema?: undefined } : { schema: Name }

type Paths<Fields> = Extract<keyof Fields, string> | {
  [Name in Extract<keyof Fields, string>]: Fields[Name] extends { relationTo: () => { fields: infer Target } }
    ? `${Name}.${Extract<keyof Target, string>}`
    : Fields[Name] extends { relationTo: string }
      ? `${Name}.${string}`
      : never
}[Extract<keyof Fields, string>]

type FieldValue<F, L extends Language> = F extends { kind: infer Name extends keyof L['kinds'] }
  ? L['kinds'][Name] extends { pointsAtRow: true }
    ? unknown
    : KindValue<L['kinds'][Name]>
  : unknown

// A reference to the actor carries the value's type, so an operator takes it only
// where it would take that value: a list for `in` and `not_in`.
type CheckedOperand<Operator, Operand, Value> = Operand extends Ref
  ? Operand extends (Operator extends 'in' | 'not_in' ? Ref<readonly Value[]> : Ref<Value>)
    ? Operand
    : never
  : Operand

/** Every key of a row's `Where` is a path of this kayan, or it is `never`. */
type CheckedWhere<W, Path extends string, Fields, L extends Language> = {
  [Key in keyof W]: Key extends 'and' | 'or'
    ? W[Key] extends infer List extends readonly unknown[]
      ? { [At in keyof List]: CheckedWhere<List[At], Path, Fields, L> }
      : never
    : Key extends Path
      ? W[Key] extends RowFieldWhere
        ? {
            [Operator in keyof W[Key]]: CheckedOperand<
              Operator,
              W[Key][Operator],
              Key extends keyof Fields ? FieldValue<Fields[Key], L> : unknown
            >
          }
        : never
      : never
}
type CheckedAnswer<Answer, Path extends string, Fields, L extends Language> = Answer extends boolean
  ? Answer
  : CheckedWhere<Answer, Path, Fields, L>
type CheckedRow<Row, Path extends string, Name extends string, Fields, L extends Language> = {
  [Key in keyof Row]: Key extends 'fields'
    ? Row[Key] extends readonly FieldList<Name>[]
      ? Row[Key]
      : never
    : Key extends 'permissions'
      ? // The keys a role holds are checked against the catalog at `buildAsas`,
        // which is the only place every kayan of the project is known; here they
        // are the strings the row wrote.
        Row[Key] extends '*' | readonly string[]
        ? Row[Key]
        : never
      : Key extends 'create' | 'delete' | 'read' | 'update'
        ? CheckedAnswer<Row[Key], Path, Fields, L>
        : never
}

// A misspelled field in a filter or a field list is `never`, not a filter that never matches.
type CheckedRows<AccessDef, Fields, L extends Language> = AccessDef extends { rows: infer Table }
  ? {
      rows: {
        [Role in keyof Table]: CheckedRow<Table[Role], Paths<Fields>, Extract<keyof Fields, string>, Fields, L>
      }
    }
  : unknown

/** Bound to one language, so a kayan is checked against that language's kinds. */
export const defineKayan =
  <const L extends Language>(language: L) =>
  <
    const Name extends string,
    const Fields extends Record<string, FieldOf<L>>,
    const Messages extends MessageTree<LocalesOf<L>> = Record<never, never>,
    // `never`, the widest data a step can be asked for, since the parameter is
    // contravariant: the open record would refuse every narrower step.
    const O extends Record<string, OperationOf<L, Fields, never>> = Record<never, never>,
    const AccessDef extends ({ create?: Access; read?: Access; update?: Access; delete?: Access; tenant?: false } | (ActorBoundAccess<unknown> & { create?: unknown; read?: unknown; update?: unknown; delete?: unknown })) = { create?: Access; read?: Access; update?: Access; delete?: Access },
    const StoreName extends StoreKeys<L['targets']> | undefined = undefined,
    const SchemaName extends SchemaKeys<L['targets']> | undefined = undefined,
    const Auth extends KayanAuthOf<L['targets']> | undefined = undefined,
    const DbName extends string | undefined = undefined,
  >(kayan: {
    name: Name
    /** The provider that authenticates this kayan: `betterAuth({ server })`, `local({ secret })`, or a strategy. */
    auth?: Auth
    /** Every key on a field is one the language named: a stray one is `never`. */
    fields: Fields & {
      [N in keyof Fields]: {
        [Key in Exclude<keyof Fields[N], keyof Field<string, L['rules']>>]: never
      } & StrayLocales<Fields[N]['label'], LocalesOf<L>> & StrayDescription<Fields[N], LocalesOf<L>>
        & StrayPlaceholder<Fields[N], LocalesOf<L>> & TenantBinding<L, Fields[N]>
    }
    /** This kayan's own copy, nested by the parts of each key. A key a field's own `label` also claims is a collision. */
    messages?: Messages & { [Key in keyof Messages]: StrayMessages<Messages[Key], LocalesOf<L>> }
    /** Where `mithaq generate messages` writes this kayan's file, if not the default. */
    out?: string
    /** What each target of this build says about this kayan, by the target's name: `{ drizzle: pgTable(...) }`, `targets.<screen>`, `targets.service`. */
    targets?: KayanTargetsOf<L, Fields, { service?: {
      /** Every operation this kayan answers, and nothing else: `{ ...defaultOperations, archive }`. */
      operations?: O
        & NoInfer<Record<string, OperationOf<L, Fields, never>>>
        & NoInfer<{ [Name in keyof O]: OperationOf<L, Fields, DataOf<L, Fields, O[Name]>> }>
      /** The store this kayan is written through. One of the language's targets. */
      store?: StoreName
      /** The target a write is validated against. One of the language's targets. */
      schema?: SchemaName
    } }>
    /** This kayan's own open bag, for the project's own code. Nothing in mithaq reads it, and it stays on the server. */
    custom?: Record<string, unknown>
    access?: AccessDef & CheckedRows<AccessDef, Fields, L>
    /** The table name. Defaults to the name. */
    dbName?: DbName
    /** The Postgres schema this kayan's tables are built in. No key, or `'public'`, is `public`. */
    schemaName?: string
    /**
     * Indexes over this kayan's own columns, each over the fields it names, in order, and unique where it says so.
     * A list is built beside the defaults; `({ defaults }) => [...]` answers the whole list. A group,
     * `{ within: 'organization', unique: ['code'] }`, is indexes led by the tenant field.
     */
    indexes?: Indexes<NoInfer<keyof Fields & string>, NoInfer<TenantKey<Fields>>>
  }) => {
    // The key order is the column order: nothing is merged in and nothing is moved.
    const fields: Record<string, Field> = Object.fromEntries(
      Object.entries(kayan.fields as Record<string, Field>).map(([name, field]) => [name, tenantDefaults(language, field)]),
    )
    // A tenant-owned kayan inherits the language's rows; one opts out on its access.
    const declared = kayan.access as Record<string, unknown> | undefined
    const owned = Object.values(fields).some((field) => (field as RuntimeField).targets?.tenant !== undefined)
    const inherited = declared?.tenant === false || !owned ? undefined : languageRows(language)
    const compiled = rowsOf(declared) ?? inherited
    if (compiled) {
      for (const [name, field] of Object.entries(fields)) {
        // ANDed with the row's answer, so it narrows and never widens. The kayan's name goes
        // with it, since one compiled table is shared by every kayan that inherits it.
        fields[name] = {
          ...field,
          access: rowFields({ compiled, name, declared: (field as RuntimeField).access, kayan: kayan.name }),
        } as Field
      }
    }
    // A steps function runs once, here, so the kayan carries data a tool reads without calling anything.
    const own = kayan.targets?.service as KayanService | undefined
    const operations = resolveOperations(own?.operations as Operations, serviceTargetOf(language))
    return {
      ...kayan,
      ...(compiled ? { access: applyRows(compiled, declared) } : {}),
      fields,
      targets: { ...kayan.targets, service: { ...own, operations } },
    } as unknown as {
      name: Name
      auth?: Auth
      access?: AccessDef
      dbName?: DbName
      schemaName?: string
      indexes?: Indexes<keyof Fields & string, TenantKey<Fields>>
      messages?: Messages
      out?: string
      // `NoInfer`: inline in `buildAsas({ kayan: [...] })`, `O` would otherwise come from
      // that call's context and shadow the kayan's typed lists.
      targets: KayanTargetsOf<L, Fields, { service: { operations: NoInfer<O> } & NamedStore<StoreName> & NamedSchema<SchemaName> }>
      custom?: Record<string, unknown>
      fields: TenantDefaulted<L, Fields>
      /** The language this kayan was declared in, on the type alone, so `tools.of(kayan)` types a call from it. */
      readonly '~language'?: L
    }
  }

/** The language a kayan's `'~language'` brand names, and the open language on one that carries none. */
export type LanguageOf<K> = K extends { readonly '~language'?: infer L extends Language } ? L : Language

/** A global's access: read and update, and no more. */
type GlobalAccess = { read?: Access; update?: Access }

/**
 * Declares a global, a kayan of one row. It spreads `defaultGlobalFields` and runs
 * `defaultGlobalOperations`; a tenant field makes it one row per tenant.
 */
export const defineGlobal = <const L extends Language>(language: L) => {
  const kayan = defineKayan(language)
  return <
    const Name extends string,
    const Fields extends Record<string, FieldOf<L>>,
    const Messages extends MessageTree<LocalesOf<L>> = Record<never, never>,
    const O extends Record<string, OperationOf<L, Fields, never>> = Record<never, never>,
    const AccessDef extends GlobalAccess = Record<never, never>,
    const StoreName extends StoreKeys<L['targets']> | undefined = undefined,
    const SchemaName extends SchemaKeys<L['targets']> | undefined = undefined,
    const DbName extends string | undefined = undefined,
  >(global: {
    name: Name
    /** Every key on a field is one the language named: a stray one is `never`. */
    fields: Fields & {
      [N in keyof Fields]: {
        [Key in Exclude<keyof Fields[N], keyof Field<string, L['rules']>>]: never
      } & StrayLocales<Fields[N]['label'], LocalesOf<L>> & StrayDescription<Fields[N], LocalesOf<L>>
        & StrayPlaceholder<Fields[N], LocalesOf<L>> & TenantBinding<L, Fields[N]>
    }
    /** This global's own copy, nested by the parts of each key, as on any kayan. */
    messages?: Messages & { [Key in keyof Messages]: StrayMessages<Messages[Key], LocalesOf<L>> }
    /** Where `mithaq generate messages` writes this global's file, if not the default. */
    out?: string
    /** What each target says about this global, exactly as on any kayan. */
    targets?: KayanTargetsOf<L, Fields, { service?: {
      /** The two operations a global runs, `defaultGlobalOperations` or a list of the same names. */
      operations?: O
      /** The store this global is written through. One of the language's targets. */
      store?: StoreName
      /** The target a write is validated against. One of the language's targets. */
      schema?: SchemaName
    } }>
    /** This global's own open bag, for the project's own code. Nothing in mithaq reads it, and it stays on the server. */
    custom?: Record<string, unknown>
    /** Read and update only: a create or delete key is refused by the type. */
    access?: AccessDef & { [Key in Exclude<keyof AccessDef, 'read' | 'update'>]: never }
    /** The table name. Defaults to the name. */
    dbName?: DbName
    /** The Postgres schema this global's tables are built in. No key, or `'public'`, is `public`. */
    schemaName?: string
  }) =>
    // `defineKayan`'s own access object, untouched: a rebuilt one would drop the rows
    // marker, and the permission check would stand aside for every global operation.
    ({ ...(kayan(global as never) as object), single: true }) as unknown as {
      name: Name
      access?: AccessDef
      dbName?: DbName
      schemaName?: string
      single: true
      messages?: Messages
      out?: string
      targets: KayanTargetsOf<L, Fields, { service: { operations: NoInfer<O> } & NamedStore<StoreName> & NamedSchema<SchemaName> }>
      custom?: Record<string, unknown>
      fields: TenantDefaulted<L, Fields>
    }
}
