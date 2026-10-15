// Ajv, not zod's `fromJSONSchema`, which Payload uses: the converter passes over `required` without
// `properties`, and every keyword of a schema that names no `type`, so a value it waves through would
// break the schema the project wrote. Ajv holds a value to the whole schema, and refuses one it
// cannot hold a value to (an unknown keyword or format, a reference it cannot resolve) when it compiles.
import { Ajv } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { ResolvedField } from '../mithaq/types.ts'

const draft07 = 'http://json-schema.org/draft-07/schema#'
// One compile per schema, though a schema target shapes each field more than once.
const compiled = new WeakMap<object, (value: unknown) => boolean>()

/**
 * Whether a value holds to a `json` field's `jsonSchema`. A schema that names draft-07, as Payload
 * writes one it fetched, is read as draft-07; any other as 2020-12. Throws, naming the field, where
 * the schema cannot be compiled, so a build refuses it rather than checking less than it says.
 */
export const jsonSchemaCheck = (field: ResolvedField): ((value: unknown) => boolean) => {
  const jsonSchema = field.jsonSchema!
  const held = compiled.get(jsonSchema)
  if (held) return held
  const { schema } = jsonSchema
  // `strictTypes` and `strictTuples` only ask a schema to say more than JSON Schema requires.
  const options = { strictTypes: false, strictTuples: false } as const
  const ajv = typeof schema === 'object' && schema.$schema === draft07 ? new Ajv(options) : new Ajv2020(options)
  addFormats.default(ajv)
  let validate: (value: unknown) => unknown
  try {
    validate = ajv.compile(schema)
  } catch (thrown) {
    throw new Error(`Kayan "${field.kayan}" field "${field.name}" jsonSchema cannot be checked: ${(thrown as Error).message}.`, { cause: thrown })
  }
  const check = (value: unknown) => validate(value) === true
  compiled.set(jsonSchema, check)
  return check
}
