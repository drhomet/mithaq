import type { AccessReport, ClientField, ClientKayan } from 'mithaq/admin'

/**
 * Whether a field is the server's to fill on this operation: a `uuid`, or a field that names a provider other than the client for it. Restates the server's `providerOf` rather than importing it, because this file is copied into a browser bundle that imports nothing from `mithaq` at runtime.
 */
export const readOnlyField = (field: ClientField, on: 'create' | 'update'): boolean =>
  field.kind === 'uuid'
  || ((field.rules?.providedBy as { create?: string; update?: string } | undefined)?.[on] ?? 'client') !== 'client'

/**
 * Whether the report lets this actor create a row of a kayan with something to write: the create, and at least one client-provided field they may set. A role that may set only server-filled fields meets no New.
 */
export const createsIn = ({ kayan, report }: { kayan: ClientKayan; report: NonNullable<AccessReport['collections']>[string] }): boolean =>
  report?.create === true && kayan.fields.some((field) => !readOnlyField(field, 'create') && report.fields?.[field.name]?.create === true)

/**
 * What a form starts holding: the row's values, one key per field, so a control is controlled from its first render. A field the row does not carry starts `undefined` and stays out of the write until something sets it.
 */
export const seedOf = (fields: readonly ClientField[], value?: Record<string, unknown> | null): Record<string, unknown> =>
  Object.fromEntries(
    fields.map((field) => [
      field.name,
      // On a create a checkbox starts `false` and a required text list `[]`, as drawn; an update leaves a missing key
      // unseeded, since it is a column this actor may not read and seeding it would overwrite the row.
      field.kind === 'datetime' && typeof value?.[field.name] === 'string' && !Number.isNaN(new Date(value[field.name] as string).getTime())
        ? new Date(value[field.name] as string)
        : value?.[field.name] ?? (value ? undefined : field.kind === 'checkbox' ? false : field.kind === 'textArray' && field.rules.required === true ? [] : undefined),
    ]),
  )

/**
 * Every field of `fields` the caller may write, as the object an operation takes. `owned` is the form's own answer for who provides a field, handed in so the fields drawn disabled and the fields left out of the write cannot drift apart.
 */
export const valuesOf = ({
  fields,
  values,
  owned,
}: {
  fields: readonly ClientField[]
  values: Record<string, unknown>
  owned: (field: ClientField) => boolean
}): Record<string, unknown> => {
  const written: Record<string, unknown> = {}
  for (const field of fields) {
    if (owned(field)) continue
    if (values[field.name] !== undefined) written[field.name] = values[field.name]
  }
  return written
}
