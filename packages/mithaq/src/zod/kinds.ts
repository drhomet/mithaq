import { z } from 'zod'
import type { ResolvedField } from '../mithaq/types.ts'
import { defaultKinds, isJson, type Json } from '../base/kinds.ts'
import { isDecimal } from '../base/decimal.ts'
import { jsonSchemaCheck } from '../base/json-schema.ts'
import type { ZodShape } from './index.ts'

// A missing key, or a `null` on a required field, is the `required` rule refusing;
// anything else is the kind refusing the value. A field with no kayan keeps zod's text.
export const errorOf = (field?: ResolvedField, element = false) =>
  field?.kayan
    ? (issue: { input: unknown }) =>
        issue.input === undefined || (issue.input === null && !element && field.rules?.required === true)
          ? `${field.kayan}.${field.name}.required`
          : `${field.kayan}.${field.name}.invalid`
    : undefined

type KindError = ReturnType<typeof errorOf>
const idShapes = {
  // A number id is an int4 `serial`, so a fraction or a value past its range is a 400, not a Postgres 500.
  number: (error?: KindError) => z.int32({ error }),
  text: (error?: KindError) => z.string({ error }),
  // `guid`, not `uuid`: `z.uuid()` also demands an RFC version and variant, which Postgres does not.
  uuid: (error?: KindError) => z.guid({ error }),
}

/** The kinds this target shapes an id of, the same three the store's columns are. */
export const idKinds = Object.keys(idShapes) as (keyof typeof idShapes)[]

const idShape = (kind: string, error?: KindError) => idShapes[kind as keyof typeof idShapes]!(error)

// Narrowed to the field's `options` on the server, not only in the browser.
const textShape = (field?: ResolvedField, element = false) => {
  const values = field?.options?.map((option) => option.value)
  return values?.length ? z.enum(values as [string, ...string[]], { error: errorOf(field, element) }) : z.string({ error: errorOf(field, element) })
}

/** One shape per kind, the same record shape as the adapter's kinds. */
export const kinds = {
  text: textShape,
  email: (field?: ResolvedField) => z.email({ error: errorOf(field) }),
  // The id is the `serial` column `idShapes` says it is; any other number is a
  // `numeric` column, which takes every finite number.
  number: (field?: ResolvedField) => (field?.name === 'id' ? idShape('number', errorOf(field)) : z.number({ error: errorOf(field) })),
  // A Postgres `integer`, the same int4 a number id is.
  integer: (field?: ResolvedField) => z.int32({ error: errorOf(field) }),
  // A JS number is refused: it may already have lost a digit. `abort`, so no
  // rule after it reads text that is no decimal.
  decimal: (field?: ResolvedField) => z.string({ error: errorOf(field) }).refine(isDecimal, { error: errorOf(field), abort: true }),
  checkbox: (field?: ResolvedField) => z.boolean({ error: errorOf(field) }),
  datetime: (field?: ResolvedField) => z.date({ error: errorOf(field) }),
  // A string, so a `Date` is refused rather than truncated to whichever day its zone makes of it.
  date: (field?: ResolvedField) => z.iso.date({ error: errorOf(field) }),
  // The same error on each element, so a bad element reads as the field's own sentence.
  textArray: (field?: ResolvedField) => z.array(textShape(field, true), { error: errorOf(field) }),
  uuid: (field?: ResolvedField) => z.guid({ error: errorOf(field) }),
  relationship: (field: ResolvedField) =>
    field.hasMany
      ? z.array(idShape(field.target!.fields.id!.kind, errorOf(field, true)), { error: errorOf(field) })
      : idShape(field.target!.fields.id!.kind, errorOf(field)),
  // Only what JSON can say, so a value reads back as it was written; `z.json()` lets a cycle through.
  // A `jsonSchema` only judges: what is stored is the value as sent.
  json: (field?: ResolvedField) => {
    const shape = z.custom<Json>((value) => isJson(value), { error: errorOf(field) })
    return field?.jsonSchema ? shape.refine(jsonSchemaCheck(field), { error: errorOf(field) }) : shape
  },
  // Left loose: the child's row shape may not be derived yet, and the child's own read already parsed the rows.
  join: (field?: ResolvedField) => z.array(z.record(z.string(), z.unknown()), { error: errorOf(field) }),
} satisfies Record<keyof typeof defaultKinds, ZodShape>
