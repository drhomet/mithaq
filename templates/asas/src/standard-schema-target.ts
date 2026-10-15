// A schema target with no validation library behind it: every shape is a
// hand-written `~standard` object.
import {
  defaultKinds,
  defaultRules,
  isJson,
  jsonSchemaCheck,
  providerOf,
  type CreateOf,
  type Derives,
  type FieldsOf,
  type IdOf,
  type ResolvedField,
  type RowOf,
  type RuleValue,
  type RuntimeField,
  type SchemaTarget,
  type StandardSchemaV1,
  type UpdateOf,
} from 'mithaq'
import { compareDecimals, decimalDigits } from 'mithaq/admin'
import { storedRichText } from 'mithaq/rich-text'

type Shape<Output = unknown> = StandardSchemaV1<unknown, Output>
type Check = (value: unknown) => string | undefined

const shape = <Output>(check: Check): Shape<Output> => ({
  '~standard': {
    version: 1,
    vendor: 'plain',
    validate: (value) => {
      const message = check(value)
      return message ? { issues: [{ message }] } : { value: value as Output }
    },
  },
})

/**
 * A shape keeps the rewritten value of a transform, not the input, so every
 * wrapper below forwards this rather than its own input.
 */
const judged = (inner: Shape, value: unknown) =>
  inner['~standard'].validate(value) as { issues?: readonly { message: string }[]; value?: unknown }
const said = (inner: Shape, value: unknown) => judged(inner, value).issues?.[0]?.message
const also = (inner: Shape, check: Check): Shape => shape((value) => said(inner, value) ?? check(value))
const rewrap = (inner: Shape, validate: Shape['~standard']['validate']): Shape => ({
  '~standard': { ...inner['~standard'], validate },
})
/**
 * A transform rather than a check: the value is rewritten first and everything
 * this shape already says is said about the rewritten one, which becomes the
 * output.
 */
const piped = (inner: Shape, change: (value: string) => string): Shape =>
  rewrap(inner, (value) => inner['~standard'].validate(typeof value === 'string' ? change(value) : value))
const nullish = (inner: Shape): Shape =>
  rewrap(inner, (value) => (value === null || value === undefined ? { value } : inner['~standard'].validate(value)))
/** An id a write may leave out, which the store fills, but may never send as null. */
const optional = (inner: Shape): Shape =>
  rewrap(inner, (value) => (value === undefined ? { value } : inner['~standard'].validate(value)))

const received = (value: unknown) => (value === null ? 'null' : typeof value)
const listKeys = ['data', 'depth', 'for', 'limit', 'page', 'sort', 'where']
const notAnObject = (value: unknown) =>
  !value || typeof value !== 'object' || Array.isArray(value)
    ? `Invalid input: expected object, received ${received(value)}`
    : undefined
const typed = (name: string, is: (value: unknown) => boolean) =>
  shape((value) => (is(value) ? undefined : `Invalid input: expected ${name}, received ${received(value)}`))
const string = () => typed('string', (value) => typeof value === 'string')
const number = () => typed('number', (value) => typeof value === 'number' && Number.isFinite(value))
/**
 * What a postgres `uuid` column takes: eight-four-four-four-twelve hex, with no
 * RFC version or variant demanded, the pattern `z.guid()` carries.
 */
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => also(string(), (value) => (uuidPattern.test(String(value)) ? undefined : 'Invalid GUID'))
/**
 * What an id of that kind is, which is what a foreign key holding one is too. A
 * value the `uuid` column would refuse is refused at the boundary instead of
 * reaching the driver.
 */
const idShapes = { number, text: string, uuid }

/**
 * The kinds this target shapes an id of, because a primary key is also what
 * every foreign key pointing at it holds. Declared even though the template's
 * store declares none: without the list the build dies on a `TypeError` once a
 * relationship points at an id kind with no entry in `idShapes`, instead of the
 * sentence `resolve` writes.
 */
export const idKinds = Object.keys(idShapes) as (keyof typeof idShapes)[]

const idShape = (kind: string) => idShapes[kind as keyof typeof idShapes]()

/**
 * The copy key a value outside a field's `options` refuses under, the same key
 * the zod target writes for a value its kind refuses and the browser already
 * checks. A field with no kayan carries no key to write.
 */
const optionsInvalid = (field: ResolvedField) =>
  field.kayan ? `${field.kayan}.${field.name}.invalid` : 'Invalid input: not one of the field\'s declared options'

const textShape = (field: ResolvedField) => {
  const values = field.options?.map((option) => option.value)
  return values?.length ? also(string(), (value) => (values.includes(String(value)) ? undefined : optionsInvalid(field))) : string()
}
const textArrayType = () =>
  typed('string array', (value) => Array.isArray(value) && value.every((one) => typeof one === 'string'))
const textArrayShape = (field: ResolvedField) => {
  const values = field.options?.map((option) => option.value)
  return values?.length
    ? also(textArrayType(), (value) => ((value as string[]).every((one) => values.includes(one)) ? undefined : optionsInvalid(field)))
    : textArrayType()
}

/** One shape per kind, the same record shape every target's kinds map has. */
export const kinds = {
  text: textShape,
  email: () =>
    also(string(), (value) => (/^[^@\s]+@[^@\s]+$/.test(String(value)) ? undefined : 'Invalid email address')),
  number,
  integer: () => typed('32-bit integer', defaultKinds.integer.accepts),
  decimal: () => typed('decimal string', defaultKinds.decimal.accepts),
  checkbox: () => typed('boolean', (value) => typeof value === 'boolean'),
  datetime: () => typed('datetime', (value) => value instanceof Date && Number.isFinite(value.getTime())),
  date: () => typed('date', (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
  textArray: textArrayShape,
  uuid,
  relationship: (field: ResolvedField) => idShape(field.target!.fields.id!.kind),
  // Held to its `jsonSchema` by core's own check, the one the zod target calls.
  json: (field: ResolvedField) => {
    const check = field.jsonSchema ? jsonSchemaCheck(field) : () => true
    return also(typed('JSON', (value) => isJson(value)), (value) => (check(value) ? undefined : optionsInvalid(field)))
  },
  // The child's rows, checked as a list and no further: the child kayan's own
  // shape covers what they hold, whichever order the build derives the two.
  join: () => typed('list of rows', (value) => Array.isArray(value)),
} satisfies Record<keyof typeof defaultKinds, (field: ResolvedField) => Shape>

/** What `required` says of null and of an absent key, and nothing of an empty value, which is all a stored row is read against. */
const nullable = ({ shape: given, value: on, field }: { shape: Shape; value: boolean; field: ResolvedField }) =>
  on || field.name === 'id' ? given : nullish(given)

/** One entry per rule, in the order they are applied, with `required`, `defaultValue` and `defaultNow` last. */
export const rules = {
  unique: ({ shape: given }) => given,
  index: ({ shape: given }) => given,
  onDelete: ({ shape: given }) => given,
  /**
   * Not a narrowing of one value but a decision about which keys an object
   * holds, so the shape is unchanged: `derive` reads it and leaves a field the
   * client does not supply out of that operation's object.
   */
  providedBy: ({ shape: given }) => given,
  minLength: ({ shape: given, value: length }) =>
    also(given, (value) =>
      String(value).length < length ? `Too small: expected string to have >=${length} characters` : undefined),
  maxLength: ({ shape: given, value: length }) =>
    also(given, (value) =>
      String(value).length > length ? `Too big: expected string to have <=${length} characters` : undefined),
  pattern: ({ shape: given, value: expression }) =>
    also(given, (value) => (expression.test(String(value)) ? undefined : 'Invalid string: does not match pattern')),
  precision: ({ shape: given, value: precision, field }) =>
    also(given, (value) => {
      const { whole, fraction } = decimalDigits(String(value))
      return whole + fraction <= precision && whole <= precision - Number(field.rules?.scale) ? undefined : 'The value has too many digits.'
    }),
  scale: ({ shape: given, value: scale }) =>
    also(given, (value) => (decimalDigits(String(value)).fraction <= scale ? undefined : 'The value has too many decimal places.')),
  // A number's bound is compared as a number, an ISO day's as a string (the
  // same order for that format), and a decimal's as its exact value.
  min: ({ shape: given, value: least, field }) =>
    also(given, (value) =>
      (field.kind === 'decimal' ? compareDecimals(String(value), String(least)) < 0 : typeof least === 'number' ? Number(value) < least : String(value) < least)
        ? `Too small: expected value to be >=${least}`
        : undefined),
  max: ({ shape: given, value: most, field }) =>
    also(given, (value) =>
      (field.kind === 'decimal' ? compareDecimals(String(value), String(most)) > 0 : typeof most === 'number' ? Number(value) > most : String(value) > most)
        ? `Too big: expected value to be <=${most}`
        : undefined),
  // A list's two bounds, an empty list passing the floor unless the field is
  // required.
  minRows: ({ shape: given, value: rows, field }) =>
    also(given, (value) => {
      const held = (value as unknown[]).length
      return held < rows && (field.rules?.required || held) ? `Too small: expected array to have >=${rows} items` : undefined
    }),
  maxRows: ({ shape: given, value: rows }) =>
    also(given, (value) => ((value as unknown[]).length > rows ? `Too big: expected array to have <=${rows} items` : undefined)),
  // The three transforms run after every narrowing rule so each is handed the
  // value the store will hold, and before `localized` so the rewrite is each
  // locale's own value rather than the object holding them.
  trim: ({ shape: given, value: on }) => (on ? piped(given, (value) => value.trim()) : given),
  uppercase: ({ shape: given, value: on }) => (on ? piped(given, (value) => value.toUpperCase()) : given),
  lowercase: ({ shape: given, value: on }) => (on ? piped(given, (value) => value.toLowerCase()) : given),
  /**
   * One object keyed by locale, refusing a locale the language never declared.
   * It runs before `required`, so every narrowing rule is each locale's own and
   * the field's nullability sits outside the object.
   */
  localized: ({ shape: given, value: on, field }) =>
    on
      ? rewrap(given, (value) => {
          const wrongType = notAnObject(value)
          if (wrongType) return { issues: [{ message: wrongType }] }
          const held = value as Record<string, unknown>
          const stray = Object.keys(held).find((locale) => !field.locales!.includes(locale))
          if (stray) return { issues: [{ message: `Unrecognized key: "${stray}"` }] }
          // Each locale's own value, as the field's shape made it, so a
          // transform's rewrite is what this object carries out.
          const kept: Record<string, unknown> = {}
          for (const locale of field.locales!) {
            const result = judged(given, held[locale])
            if (result.issues) return { issues: [{ message: `${result.issues[0]!.message}, at "${locale}"` }] }
            kept[locale] = result.value
          }
          return { value: kept }
        })
      : given,
  // A required text refuses the empty value as well. A stored row is read
  // through `nullable` alone. The empty check reads the value the shape keeps, so
  // a `trim` that empties a value of spaces is refused here.
  required: (args) => {
    const given = nullable(args)
    if (!args.value || args.field.name === 'id' || args.field.kind !== 'text') return given
    return rewrap(given, (value) => {
      const result = judged(given, value)
      if (result.issues) return result as ReturnType<Shape['~standard']['validate']>
      const empty = (args.field.rules?.localized ? Object.values(result.value as object) : [result.value]).includes('')
      return empty
        ? { issues: [{ message: args.field.kayan ? `${args.field.kayan}.${args.field.name}.required` : 'Invalid input: a required value is empty' }] }
        : { value: result.value }
    })
  },
  /**
   * A column something else fills, so the key may be left out. `resolve`
   * requires the `defaults` step before the store step, whichever order a list
   * puts `defaults` and `validate` in.
   */
  defaultValue: ({ shape: given }) => optional(given),
  defaultNow: ({ shape: given, value: on }) => (on ? optional(given) : given),
  nowOnUpdate: ({ shape: given }) => given,
} satisfies { [Name in keyof typeof defaultRules]: (args: { shape: Shape; value: RuleValue<(typeof defaultRules)[Name]>; field: ResolvedField }) => Shape }

const shapeOf = (
  field: ResolvedField,
  fieldKinds: Record<string, (field: ResolvedField) => Shape>,
  fieldRules: Record<string, (args: { shape: Shape; value: never; field: ResolvedField }) => Shape>,
) => {
  // Under the name this target has in the build, which `resolve` puts on the field.
  const override = (field.schemaTarget && field.targets?.[field.schemaTarget]) as Shape | undefined
  if (override) return override
  // The target's own entry, then the kind's own for a Standard Schema target.
  let built = (fieldKinds[field.kind] ?? (field.kindTargets?.standardSchema as (field: ResolvedField) => Shape))(field)
  const declared = field.rules ?? {}
  for (const rule of Object.keys(fieldRules)) {
    if (rule in declared) built = fieldRules[rule]!({ shape: built, value: declared[rule] as never, field })
  }
  return built
}

type Mode = 'create' | 'row' | 'update'

/**
 * The object one of the derived shapes is: the declared keys only, an unknown
 * key refused on a write. `update` validates the keys the write carries and
 * requires the id; `row` requires every column; `create` requires everything
 * the rules did not make optional.
 */
const object = (
  shapes: Record<string, Shape>,
  mode: Mode,
  /**
   * The keys a row may leave out: a `join`, which is no column, so the store
   * hands back no value for it and a read that named no depth populates none.
   */
  absent: readonly string[] = [],
): StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> => ({
  '~standard': {
    version: 1,
    vendor: 'plain',
    validate: (value) => {
      const wrongType = notAnObject(value)
      if (wrongType) return { issues: [{ message: wrongType }] }
      const given = value as Record<string, unknown>
      const issues: { message: string; path?: [string]; params?: unknown }[] = []
      if (mode !== 'row') {
        for (const key of Object.keys(given)) {
          if (!(key in shapes)) issues.push({ message: `Unrecognized key: "${key}"` })
        }
      }
      // Only the declared keys come back, so a value a step attached never
      // leaves through the row boundary.
      const kept: Record<string, unknown> = {}
      for (const [name, one] of Object.entries(shapes)) {
        const held = name in given
        if (mode === 'update' && !held && name !== 'id') continue
        if (mode === 'row' && !held && absent.includes(name)) continue
        if (mode === 'row' && !held) {
          issues.push({ message: 'Invalid input: expected value, received undefined', path: [name] })
          continue
        }
        const result = judged(mode === 'create' && name === 'id' ? optional(one) : one, given[name])
        if (result.issues) issues.push({ ...result.issues[0]!, path: [name] })
        else if (held) kept[name] = result.value
      }
      return issues.length ? { issues } : { value: kept }
    },
  },
})

/**
 * The shapes this target derives, with the kayan's own column types on them;
 * `plain` is the name a field writes an override for this target under.
 */
type PlainShapes<F extends Record<string, RuntimeField>> = {
  create: StandardSchemaV1<CreateOf<F, 'plain'>, CreateOf<F, 'plain'>>
  update: StandardSchemaV1<UpdateOf<F, 'plain'>, UpdateOf<F, 'plain'>>
  id: StandardSchemaV1<IdOf<F, 'plain'>, IdOf<F, 'plain'>>
  byID: StandardSchemaV1<IdOf<F, 'plain'> & { depth?: unknown }, IdOf<F, 'plain'> & { depth?: unknown }>
  row: StandardSchemaV1<RowOf<F, 'plain'>, RowOf<F, 'plain'>>
  list: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>
}

/** The same mapping written as a type, which is what the `derives` member on the target carries. */
interface PlainDerives extends Derives {
  readonly shapes: PlainShapes<FieldsOf<this>>
}

/**
 * The target as one object. The shapes are built from the runtime field record,
 * whose keys and rules are values here, so the types above are put on with a
 * cast.
 */
const target = {
  capability: 'schema',
  // What a kind carries its own shape for this target under: a kind from a
  // rukn ships one for any target written against the specification.
  type: 'standardSchema',
  idKinds,
  kinds,
  rules,
  derive<F extends Record<string, ResolvedField>>(
    this: { kinds: typeof kinds; rules: typeof rules },
    fields: F,
  ): PlainShapes<F> {
    const shapes = Object.fromEntries(
      Object.values(fields).map((field) => [field.name, shapeOf(field, this.kinds, this.rules)]),
    )
    // A stored row is read against each field's kind, one per locale where it is
    // localized and nullable where it is not required, and none of the rules that
    // judge a value. A field's `options` are left off too, so a value an option
    // removed since still reads.
    const stored = Object.fromEntries(
      Object.values(fields).map((field) => [field.name, shapeOf({ ...field, options: undefined, jsonSchema: undefined, ...(field.kind === 'richText' && { richText: storedRichText }) }, this.kinds, { localized: this.rules.localized, required: nullable })]),
    )
    /**
     * One operation's object: the fields the client supplies for it, and the id,
     * which addresses the row rather than carrying a value. A field left out
     * here is refused by name on that operation.
     */
    const supplied = (on: 'create' | 'update') =>
      Object.fromEntries(
        Object.entries(shapes).filter(([name]) => name === 'id' || providerOf(fields[name]!, on) === 'client'),
      )
    return {
      create: object(supplied('create'), 'create'),
      update: object(supplied('update'), 'update'),
      // The same object over the id alone: `update` requires the id and
      // validates only the keys the value carries, so one key in that mode is
      // the id required and every other key refused.
      id: object('id' in shapes ? { id: shapes.id! } : {}, 'update'),
      // The same with a `depth` beside the id, for a read of one row. The runner
      // checks its value.
      byID: object({ ...('id' in shapes && { id: shapes.id! }), depth: shape(() => undefined) }, 'update'),
      row: object(stored, 'row', Object.values(fields).filter((field) => field.kind === 'join').map((field) => field.name)),
      // A list read carries its page query and a bulk its `data`, and the runner
      // checks each value itself, so none is constrained here. Any other key is
      // refused. A value that is not an object is refused too, because the reader
      // would otherwise read `where` off a string and silently find nothing.
      list: rewrap(shape(notAnObject), (value) => {
        const wrongType = notAnObject(value)
        if (wrongType) return { issues: [{ message: wrongType }] }
        const stray = Object.keys(value as object).filter((key) => !listKeys.includes(key))
        return stray.length ? { issues: stray.map((key) => ({ message: `Unrecognized key: "${key}"` })) } : { value: value as Record<string, unknown> }
      }),
    } as unknown as PlainShapes<F>
  },
} as const satisfies SchemaTarget<typeof defaultKinds, typeof defaultRules, Shape, Shape<Record<string, unknown>>>

/**
 * The target, with the type-only `derives` member put on here rather than
 * written into the literal, so nothing is added to the object at runtime.
 */
export const plainTarget: typeof target & { readonly derives?: PlainDerives } = target
