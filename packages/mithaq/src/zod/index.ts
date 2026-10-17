import { z } from 'zod'
import { storedRichText } from '../rich-text/value.ts'
import type { ResolvedField, RuntimeField } from '../mithaq/types.ts'
import type { Derives, FieldsOf } from '../asas/runner/steps.ts'
import type { SchemaTarget } from '../mithaq/language.ts'
import type { CreateOf, IdOf, RowOf, UpdateOf } from '../asas/runner/write.ts'
import { defaultKinds } from '../base/kinds.ts'
import { defaultRules, providerOf } from '../base/rules.ts'
import { idKinds as zodIdKinds, kinds as zodKinds } from './kinds.ts'
import { implementationOf } from '../mithaq/rukn.ts'
import { rules as zodRules } from './rules.ts'

type ZodWithDef = z.ZodType & { _def?: Record<string, unknown> }

export type ZodShape = (field: ResolvedField) => z.ZodType
export type ZodRule<Value = never> = (args: { shape: z.ZodType; value: Value; field: ResolvedField }) => z.ZodType

// Every rule is applied here and nowhere else. A field's `targets.zod` is its
// whole shape, rules skipped.
const fieldShapes = (
  fields: Record<string, ResolvedField>,
  shapes: Record<string, ZodShape>,
  rules: Record<string, ZodRule>,
): Record<string, z.ZodType> =>
  Object.fromEntries(
    Object.values(fields).map((field) => {
      const override = (field.schemaTarget && field.targets?.[field.schemaTarget]) as z.ZodType | undefined
      if (override) return [field.name, override]
      // The project's own entry, then the kind's own, then the shipped table.
      let shape = implementationOf<ZodShape>({ table: shapes, shipped: zodKinds, name: field.kind, own: field.kindTargets, type: 'zod' })!(field)
      const fieldRules = field.rules ?? {}
      for (const rule of Object.keys(rules)) {
        if (rule in fieldRules) {
          shape = (rules[rule] as ZodRule<unknown>)({ shape, value: fieldRules[rule], field })
        }
      }
      // An id is filled by the database or by whoever owns the table, so a write never has to carry one.
      return [field.name, field.name === 'id' ? shape.optional() : shape]
    }),
  )

// Strict, so an unknown key is refused at the boundary rather than stripped.
const kayanSchema = (built: Record<string, z.ZodType>) => z.strictObject(built)

// A field the client does not supply is absent, not optional, so the strict
// object refuses a caller that sends it rather than discarding the value.
const supplied = (
  built: Record<string, z.ZodType>,
  fields: Record<string, ResolvedField>,
  on: 'create' | 'update',
) =>
  Object.fromEntries(
    Object.values(fields)
      .filter((field) => field.name === 'id' || providerOf(field, on) === 'client')
      .map((field) => [field.name, built[field.name]!]),
  )

const outputShape = (shape: z.ZodType): z.ZodType => {
  const hasTransform = (value: unknown, seen = new WeakSet<object>()): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    if (value instanceof z.ZodType) {
      const definition = (value as ZodWithDef)._def
      if (definition?.type === 'transform') return true
      return hasTransform(definition, seen)
    }
    if (Array.isArray(value)) return value.some((one) => hasTransform(one, seen))
    return Object.values(value).some((one) => hasTransform(one, seen))
  }

  const definition = (shape as ZodWithDef)._def
  if (definition?.type === 'optional' && definition.innerType) return outputShape(definition.innerType as z.ZodType)
  if (definition?.type === 'nullable' && definition.innerType) {
    return outputShape(definition.innerType as z.ZodType).nullable()
  }
  if (['catch', 'default'].includes(String(definition?.type)) && definition?.innerType) {
    return outputShape(definition.innerType as z.ZodType)
  }
  if (definition?.type === 'pipe' && definition.out) return outputShape(definition.out as z.ZodType)
  if (hasTransform(shape)) {
    throw new Error('A zod transform override needs an output schema: use `.pipe(schema)`.')
  }
  return shape
}

// A `join` is optional rather than nullable: a read with no depth hands back no
// value for it, and a nullable key would demand an explicit `null`.
const rowSchema = (schema: z.ZodObject, fields: Record<string, ResolvedField>) =>
  z.object(
    Object.fromEntries(
      Object.entries(schema.shape).map(([name, shape]) => [
        name,
        (() => {
          const required = outputShape(shape)
          if (fields[name]?.kind === 'join') return required.optional()
          return name === 'id' || fields[name]?.rules?.required ? required : required.nullable()
        })(),
      ]),
    ),
  )

type ZodTyped<Value> = z.ZodType<Value, Value>
type ZodColumn<Value> = undefined extends Value
  ? z.ZodOptional<ZodTyped<Exclude<Value, undefined>>>
  : ZodTyped<Value>
type ZodDerived<Shape, Config extends z.core.$ZodObjectConfig> = z.ZodObject<
  { [Key in keyof Shape]-?: ZodColumn<Shape[Key]> },
  Config
>
// Strict for writes and addressed reads; the row comes from the store and is stripped.
type ZodShapes<F extends Record<string, RuntimeField>> = {
  create: ZodDerived<CreateOf<F, 'zod'>, z.core.$strict>
  update: ZodDerived<UpdateOf<F, 'zod'>, z.core.$strict>
  id: ZodDerived<IdOf<F, 'zod'>, z.core.$strict>
  byID: z.ZodObject<ZodDerived<IdOf<F, 'zod'>, z.core.$strict>['shape'] & { depth: z.ZodOptional<z.ZodUnknown> }, z.core.$strict>
  row: ZodDerived<RowOf<F, 'zod'>, z.core.$strip>
  list: typeof listShape
  draft: z.ZodObject<{ [Key in keyof RowOf<F, 'zod'>]-?: z.ZodOptional<z.ZodNullable<ZodTyped<RowOf<F, 'zod'>[Key]>>> }, z.core.$strip>
  draftWrite: z.ZodObject<{ [Key in keyof RowOf<F, 'zod'>]-?: z.ZodOptional<z.ZodNullable<ZodTyped<RowOf<F, 'zod'>[Key]>>> }, z.core.$strip>
}

// Strict: a misspelled `wher` stripped would answer every row unfiltered.
const listShape = z.strictObject({
  data: z.unknown().optional(),
  depth: z.unknown().optional(),
  for: z.unknown().optional(),
  limit: z.unknown().optional(),
  page: z.unknown().optional(),
  sort: z.unknown().optional(),
  where: z.unknown().optional(),
})

interface ZodDerives extends Derives {
  readonly shapes: ZodShapes<FieldsOf<this>>
}

// The cast puts the mapped return type on: nothing inside can prove what `ZodDerives` states.
const target = {
  capability: 'schema',
  type: 'zod',
  idKinds: zodIdKinds,
  kinds: zodKinds,
  rules: zodRules,
  derive<F extends Record<string, ResolvedField>>(
    this: { kinds: Record<string, ZodShape>; rules: Record<string, ZodRule> },
    fields: F,
  ): ZodShapes<F> {
    const built = fieldShapes(fields, this.kinds, this.rules)
    // A stored row is read against its kinds alone, with no rule, `options`, `jsonSchema` or `maxBytes`,
    // so one added after rows were stored refuses their next save, never their read.
    const kinds = Object.fromEntries(Object.entries(fields).map(([name, field]) => [
      name,
      { ...field, options: undefined, jsonSchema: undefined, maxBytes: undefined, ...(field.kind === 'richText' && { richText: storedRichText }) },
    ]))
    const stored = fieldShapes(kinds, this.kinds, { localized: this.rules.localized! })
    const drafted = fieldShapes(
      Object.fromEntries(Object.entries(kinds).map(([name, field]) =>
        [name, field.kind === 'richText' ? { ...field, richText: fields[name]!.richText, rules: { ...field.rules, required: false } } : field])),
      this.kinds,
      { localized: this.rules.localized! },
    )
    const create = kayanSchema(supplied(built, fields, 'create'))
    const changeable = kayanSchema(supplied(built, fields, 'update'))
    const update = 'id' in fields ? changeable.partial().required({ id: true }) : changeable.partial()
    // `pick` keeps the strict object strict, so every other key is refused.
    const id = 'id' in fields ? update.pick({ id: true }) : z.strictObject({})
    return {
      create,
      update,
      id,
      byID: id.extend({ depth: z.unknown().optional() }),
      // Built from every field: a row is what the store holds, not what a caller may send.
      row: rowSchema(kayanSchema(stored), fields),
      list: listShape,
      // Stripped rather than strict: the runner has already refused unknown keys, and
      // a version stored before a field was dropped still reads.
      draft: z.object(Object.fromEntries(Object.entries(stored).map(([name, shape]) => [name, shape.nullable().optional()]))),
      // A draft may leave out what `required` asks for, but its rich text is still checked.
      draftWrite: z.object(Object.fromEntries(Object.entries(drafted).map(([name, shape]) => [name, shape.nullable().optional()]))),
    } as unknown as ZodShapes<F>
  },
} as const satisfies SchemaTarget<typeof defaultKinds, typeof defaultRules, z.ZodType, z.ZodType<Record<string, unknown>>>

/** The zod schema target. */
export const zodTarget = <
  const Kinds extends Record<string, ZodShape>,
  const Rules extends Record<string, ZodRule>,
  const IdKinds extends readonly string[],
>({ kinds, rules, idKinds }: { kinds: Kinds; rules: Rules; idKinds: IdKinds }): Omit<typeof target, 'kinds' | 'rules' | 'idKinds'> & { kinds: Kinds; rules: Rules; idKinds: IdKinds; readonly derives?: ZodDerives } =>
  ({ ...target, kinds, rules, idKinds })
