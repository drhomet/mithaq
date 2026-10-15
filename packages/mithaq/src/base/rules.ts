import { isRef, type Ref } from '../mithaq/user.ts'
import type { Localized } from '../mithaq/types.ts'
import type { OnDelete } from './kinds.ts'

export type Rule<Value = unknown> = {
  /** Compile-time value carried by a binding; never read at runtime. */
  value: Value
  /** Runtime check for dynamic declarations where TypeScript is absent. */
  accepts(value: unknown): value is Value
  /** What a person reads where this rule refuses a value. A rule that never refuses one carries none. */
  message?: Localized
  /** The rules a field may not declare beside this one, by name. */
  excludes?: readonly string[]
}

export type RuleValue<R> = R extends Rule<infer Value> ? Value : never

/** Defines a project rule from its runtime check. */
export const rule = <Value>({
  accepts,
  message,
  excludes,
}: {
  accepts: (value: unknown) => value is Value
  message?: Localized
  excludes?: readonly string[]
}): Rule<Value> => ({ value: undefined as Value, accepts, message, excludes })

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isNumber = (value: unknown): value is number => typeof value === 'number'
const boolean = rule<boolean>({ accepts: isBoolean })

const writeOperations: readonly string[] = ['create', 'update']
// `never` is not `application`: not "something else fills it" but "nobody does, for this operation".
const providers = ['client', 'application', 'never'] as const
export type Provider = (typeof providers)[number]
export type ProvidedBy = Readonly<{ create?: Provider; update?: Provider }>

/** Who supplies a field's value on one operation; a field that declares nothing is the client's. */
export const providerOf = (field: { rules?: Record<string, unknown> }, on: 'create' | 'update'): Provider =>
  (field.rules?.providedBy as ProvidedBy | undefined)?.[on] ?? 'client'

/** The shipped rules, which a project passes to `defineMithaq` and may add its own to. */
export const defaultRules = {
  required: rule<boolean>({ accepts: isBoolean, message: { en: 'This field is required.', ar: 'هذا الحقل مطلوب.' } }),
  unique: boolean,
  index: boolean,
  /** A literal, or `user.<key>` for the actor's value. Each row gets its own copy. */
  defaultValue: rule<Date | Ref | boolean | number | string | readonly unknown[]>({
    accepts: (value): value is Date | Ref | boolean | number | string | readonly unknown[] =>
      value instanceof Date || isRef(value) || Array.isArray(value) || ['boolean', 'number', 'string'].includes(typeof value),
    excludes: ['defaultNow'],
  }),
  /** The moment of the write, on create. */
  defaultNow: rule<boolean>({ accepts: isBoolean, excludes: ['defaultValue', 'localized'] }),
  /** The moment of the write, on every update, whatever the column is called. */
  nowOnUpdate: rule<boolean>({ accepts: isBoolean, excludes: ['localized'] }),
  /** Who supplies the value on create and on update. A field declaring nothing is the client's on both. */
  providedBy: rule<ProvidedBy>({
    accepts: (value): value is ProvidedBy =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([operation, supplier]) => writeOperations.includes(operation) && providers.includes(supplier as Provider),
      ),
  }),
  /** One value per locale the language declares: one column per locale, and an object keyed by locale in every shape. */
  localized: boolean,
  /** Length is a rule, not a kind: `text` with a maximum is `varchar(n)`. */
  maxLength: rule<number>({ accepts: isNumber, message: { en: 'The value is too long.', ar: 'القيمة طويلة جدًا.' } }),
  /** A decimal's size, `numeric(precision, scale)`: declare both or neither. A value with more digits is refused, not rounded. */
  precision: rule<number>({
    accepts: (value): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000,
    message: { en: 'The value has too many digits.', ar: 'القيمة فيها أرقام أكثر من المسموح.' },
  }),
  scale: rule<number>({
    accepts: (value): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000,
    message: { en: 'The value has too many decimal places.', ar: 'القيمة فيها منازل عشرية أكثر من المسموح.' },
  }),
  minLength: rule<number>({ accepts: isNumber, message: { en: 'The value is too short.', ar: 'القيمة أقصر من المسموح.' } }),
  pattern: rule<RegExp>({
    accepts: (value): value is RegExp => value instanceof RegExp,
    message: {
      en: 'The value is not in the shape this field takes.',
      ar: 'القيمة ليست بالشكل الذي يقبله هذا الحقل.',
    },
  }),
  /** A bound on an ordered value: a number for `number`, an ISO day for `date`. */
  min: rule<number | string>({
    accepts: (value): value is number | string => typeof value === 'number' || typeof value === 'string',
    message: { en: 'The value is too small.', ar: 'القيمة أصغر من المسموح.' },
  }),
  max: rule<number | string>({
    accepts: (value): value is number | string => typeof value === 'number' || typeof value === 'string',
    message: { en: 'The value is too large.', ar: 'القيمة أكبر من المسموح.' },
  }),
  /** How few and how many rows a list holds. A list that is not `required` may be left empty whatever its floor. */
  minRows: rule<number>({
    accepts: (value): value is number => Number.isInteger(value) && (value as number) >= 0,
    message: { en: 'This list has too few entries.', ar: 'هذه القائمة فيها عناصر أقل من المسموح.' },
  }),
  maxRows: rule<number>({
    accepts: (value): value is number => Number.isInteger(value) && (value as number) >= 0,
    message: { en: 'This list has too many entries.', ar: 'هذه القائمة فيها عناصر أكثر من المسموح.' },
  }),
  /** Rewrites the value's case before any check judges it; never refuses a value for its case. */
  uppercase: rule<boolean>({ accepts: isBoolean, excludes: ['lowercase'] }),
  lowercase: rule<boolean>({ accepts: isBoolean, excludes: ['uppercase'] }),
  trim: boolean,
  /** What happens to this row when the row it points at is deleted. Left out, a required field and a set restrict and any other takes its kind's default. */
  onDelete: rule<OnDelete>({
    accepts: (value): value is OnDelete =>
      typeof value === 'string' && ['cascade', 'restrict', 'set null'].includes(value),
  }),
}

/** The rule keys a field may carry, derived from the record the language names. */
export type Rules = { [Name in keyof typeof defaultRules]?: RuleValue<(typeof defaultRules)[Name]> }
