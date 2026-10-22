import type { Localized } from '../mithaq/types.ts'
import { isDecimal } from './decimal.ts'
import type { Operator } from '../mithaq/where.ts'

/** A kind of field value: its label, its runtime check, the rules it accepts and what each target makes of it. */
export type Kind<Value = unknown, RuleName extends string = string> = {
  /** The name of the kind, shown wherever a kind is named to a person. */
  label: Localized
  /** What a person reads where a value is not of this kind. */
  message: Localized
  /** Compile-time value carried by fields of this kind; never read at runtime. */
  value: Value
  /** Runtime check for dynamic field/default input where TypeScript is absent. */
  accepts(value: unknown): value is Value
  /** Makes the write's moment, for a field that declares `defaultNow` or `nowOnUpdate`. */
  now?: () => Value
  /** Rules fields of this kind may bind. Target order still decides application order. */
  rules: readonly RuleName[]
  /** What this kind is in each target, keyed by the target's `type`: a column, a shape, a control and a cell. */
  targets?: Readonly<Record<string, unknown>>
  /** The `Where` operators a field of this kind takes; any other is refused. */
  operators?: readonly Operator[]
  /** `false` where a value of this kind cannot order a page. */
  sortable?: false
  /** The installed tools a rich-text field may narrow. */
  richTextComments?: import('../rich-text/features.ts').RichTextCommentOptions
  richTextPolicy?: import('../rich-text/features.ts').RichTextPolicy
  /** `true` where a value of this kind is the id of another row, named by `relationTo`. */
  pointsAtRow?: true
  /** What a field of this kind does when the row it points at is deleted, unless it names its own `onDelete`. */
  onDelete?: OnDelete
}

/** Defines a project kind from its runtime check. */
export const kind = <Value>(accepts: (value: unknown) => value is Value) =>
  <const RuleName extends string, const Targets extends Readonly<Record<string, unknown>> = {}, const PointsAtRow extends true | undefined = undefined>(
    definition: Omit<Kind<Value, RuleName>, 'accepts' | 'value' | 'targets' | 'pointsAtRow'> & { targets?: Targets; pointsAtRow?: PointsAtRow },
  ) =>
    ({ ...definition, value: undefined as Value, accepts }) as Kind<Value, RuleName>
      & ({} extends Targets ? unknown : { targets: Targets })
      & (PointsAtRow extends true ? { pointsAtRow: true } : unknown)

/** A value `JSON.parse` could hand back. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/**
 * The most UTF-8 bytes of JSON text a json field holds, which a field names as its `maxBytes`, so one write
 * never stores a value every read of the row then carries.
 */
export const defaultJsonMaxBytes = 1_000_000

/** How deep a json value nests: past it every reader that walks it, this check first, would run out of stack. */
export const jsonDepth = 64

/** Text Postgres holds: no NUL, which no `text` or `jsonb` takes, and no half of a surrogate pair. */
export const isStorableText = (text: string) => !text.includes('\u0000') && text.isWellFormed()

/**
 * Plain JSON, nested at most `jsonDepth` deep: no `undefined`, no number that is
 * not finite, no `Date`, class instance or function, no cycle, and no string or key
 * Postgres cannot store. A store would otherwise drop, rewrite or refuse it on the
 * way in, and read back something else.
 */
export const isJson = (value: unknown, open: object[] = []): value is Json => {
  if (typeof value === 'string') return isStorableText(value)
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || open.length >= jsonDepth || open.includes(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false
  open.push(value)
  // `Object.values` skips a hole, which `JSON.stringify` would write as `null`, so the length is checked too.
  const plain = (Array.isArray(value) ? Object.keys(value).length === value.length : Object.keys(value).every(isStorableText))
    && Object.values(value).every((one) => isJson(one, open))
  open.pop()
  return plain
}

/** What the database does to this row when the row it points at is deleted. */
export type OnDelete = 'cascade' | 'restrict' | 'set null'

export const defaultKinds = {
  text: kind<string>((value): value is string => typeof value === 'string')({
    label: { en: 'Text', ar: 'نص' },
    message: { en: 'This is not text.', ar: 'هذا ليس نصا.' },
    rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue', 'localized', 'maxLength', 'minLength', 'pattern', 'uppercase', 'lowercase', 'trim'],
  }),
  email: kind<string>((value): value is string => typeof value === 'string')({
    label: { en: 'Email', ar: 'بريد إلكتروني' },
    message: { en: 'This is not an email address.', ar: 'هذا ليس بريدا إلكترونيا.' },
    rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue', 'localized', 'maxLength', 'minLength', 'pattern', 'uppercase', 'lowercase', 'trim'],
  }),
  number: kind<number>((value): value is number => typeof value === 'number')({
    label: { en: 'Number', ar: 'رقم' },
    message: { en: 'This is not a number.', ar: 'هذا ليس رقما.' },
    rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue', 'localized', 'min', 'max'],
  }),
  // Held to int4's range, because the column is a Postgres `integer`.
  integer: kind<number>((value): value is number => Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647)({
    label: { en: 'Integer', ar: 'عدد صحيح' },
    message: { en: 'This is not a 32-bit integer.', ar: 'هذا ليس عددا صحيحا من 32 بت.' },
    rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue', 'localized', 'min', 'max'],
  }),
  // Carried as text, because a JS number would round money past 15 significant digits.
  decimal: kind<string>(isDecimal)({
    label: { en: 'Decimal', ar: 'عدد عشري' },
    message: { en: 'This is not a decimal number.', ar: 'هذا ليس عددا عشريا.' },
    rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue', 'localized', 'min', 'max', 'precision', 'scale'],
  }),
  checkbox: kind<boolean>((value): value is boolean => typeof value === 'boolean')({
    label: { en: 'Checkbox', ar: 'خانة اختيار' },
    message: { en: 'This is answered yes or no.', ar: 'يجاب على هذا بنعم أو لا.' },
    rules: ['providedBy', 'required', 'index', 'defaultValue'],
  }),
  datetime: kind<Date>((value): value is Date => value instanceof Date)({
    label: { en: 'Date and time', ar: 'التاريخ والوقت' },
    message: { en: 'This is not a date and time.', ar: 'هذا ليس تاريخا ووقتا.' },
    now: () => new Date(),
    rules: ['providedBy', 'required', 'index', 'defaultValue', 'defaultNow', 'nowOnUpdate', 'localized'],
  }),
  // A string, not a `Date`: a day read in another zone as a moment is the day before.
  // `Date.parse('2026-02-30')` rolls over to March 2, so a day must come back as itself.
  date: kind<string>(
    (value): value is string =>
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      new Date(value).toJSON()?.startsWith(value) === true,
  )({
    label: { en: 'Date', ar: 'التاريخ' },
    message: { en: 'This is not a date.', ar: 'هذا ليس تاريخا.' },
    rules: ['providedBy', 'required', 'index', 'defaultValue', 'localized', 'min', 'max'],
  }),
  textArray: kind<string[]>(
    (value): value is string[] => Array.isArray(value) && value.every((one) => typeof one === 'string'),
  )({
    label: { en: 'Text list', ar: 'قائمة نصوص' },
    message: { en: 'This is not a list of text.', ar: 'هذه ليست قائمة نصوص.' },
    rules: ['providedBy', 'required', 'defaultValue', 'minRows', 'maxRows'],
  }),
  // Named rather than `text` because a foreign key takes the type of the id it
  // points at, and Postgres refuses a text reference to a uuid key.
  uuid: kind<string>((value): value is string => typeof value === 'string')({
    label: { en: 'UUID', ar: 'معرف فريد' },
    message: { en: 'This is not a unique identifier.', ar: 'هذا ليس معرفا فريدا.' },
    rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue'],
  }),
  relationship: kind<number | string>(
    (value): value is number | string => typeof value === 'number' || typeof value === 'string',
  )({
    label: { en: 'Relationship', ar: 'علاقة' },
    message: { en: 'Pick one of the listed entries.', ar: 'اختر عنصرًا من القائمة.' },
    rules: ['providedBy', 'required', 'unique', 'index', 'defaultValue', 'onDelete'],
    pointsAtRow: true,
    // A row another still names is never deleted from under it, its drafts included; a field says
    // `set null` or `cascade` to let it go.
    onDelete: 'restrict',
  }),
  // Payload's `json` field, unwrapped, so each reads a row the other wrote. Nothing orders by one:
  // jsonb's order is no order a person reads.
  json: kind<Json>(isJson)({
    label: { en: 'JSON', ar: 'JSON' },
    message: { en: 'This is not JSON this field takes.', ar: 'هذه ليست بيانات JSON يقبلها هذا الحقل.' },
    rules: ['providedBy', 'required', 'defaultValue'],
    operators: ['equals', 'not_equals', 'in', 'not_in', 'exists', 'like', 'contains'],
    sortable: false,
  }),
  // The rows of another kayan whose `on` relationship points at this one. It builds
  // no column: the id lives on the child, and a read populates it through the child's access.
  join: kind<unknown[]>((value): value is unknown[] => Array.isArray(value))({
    label: { en: 'Related rows', ar: 'صفوف مرتبطة' },
    message: { en: 'This is not a list of related entries.', ar: 'هذه ليست قائمة عناصر مرتبطة.' },
    rules: ['providedBy', 'required'],
  }),
} satisfies Record<string, Kind>
