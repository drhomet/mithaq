import type { ClientField, ClientKayan } from 'mithaq/admin'

/** The operators a `Where` may name, which is the server's own list. */
export type OperatorName =
  | 'contains'
  | 'equals'
  | 'exists'
  | 'greater_than'
  | 'greater_than_equal'
  | 'in'
  | 'less_than'
  | 'less_than_equal'
  | 'like'
  | 'not_equals'
  | 'not_in'

const equality = ['equals', 'not_equals'] as const
const membership = ['in', 'not_in'] as const
const comparisons = ['greater_than', 'greater_than_equal', 'less_than', 'less_than_equal'] as const

/**
 * One row per shipped kind, each the subset the server's `assertWhere` admits for it. A kind with
 * no row offers no operator, so a project kind gets a row here to reach the panel.
 */
export const operatorsByKind: Readonly<Record<string, readonly OperatorName[]>> = {
  text: [...equality, 'contains', 'like', ...membership, 'exists'],
  email: [...equality, 'contains', 'like', ...membership, 'exists'],
  number: [...equality, ...comparisons, ...membership, 'exists'],
  integer: [...equality, ...comparisons, ...membership, 'exists'],
  decimal: [...equality, ...comparisons, ...membership, 'exists'],
  datetime: [...equality, ...comparisons, ...membership, 'exists'],
  date: [...equality, ...comparisons, ...membership, 'exists'],
  checkbox: [...equality, 'exists'],
  uuid: [...equality, ...membership, 'exists'],
  relationship: [...equality, ...membership, 'exists'],
  textArray: ['exists'],
}

/** What an operator's value is: a boolean for `exists`, a list for `in` and `not_in`, one value of the field's kind otherwise. */
export type ValueShape = 'boolean' | 'list' | 'scalar'

export const valueShapeOf = (operator: string): ValueShape =>
  operator === 'exists' ? 'boolean' : operator === 'in' || operator === 'not_in' ? 'list' : 'scalar'

/** One path the panel may offer: what to write on the wire, and what kind it is. */
export type FilterPath = {
  /** The key a `Where` carries, at most two segments. */
  path: string
  /** The kind whose operators and whose input control this path takes. */
  kind: string
  /** The kayan the field belongs to, for the label's copy key. */
  kayan: ClientKayan
  /** The field itself, for its label. */
  field: ClientField
  /** A locale of a localized field, or the target's own name for a hop. */
  through?: string
}

/** What `filterPathsOf` needs beyond the kayan: the locales, and what may be read. */
export type FilterContext = {
  /** Which locales exist, from the app; the projection carries no list of them. */
  locales?: readonly string[]
  /** Every kayan of the build, so a relationship's target can be looked up. */
  client?: readonly ClientKayan[]
  /** Whether this actor may read one field. Chrome only: the read refuses a filter on a denied field whatever this says. */
  reads?: (kayan: string, field: string) => boolean
  /** The fields a page's list node offers the filter panel; wins over each field's own `filter`. */
  filters?: readonly string[]
}

/**
 * Every path one kayan offers the filter panel for the fields that opt in. A localized field offers its
 * locale paths only (the bare one is refused); a relationship adds one hop, since a path has two segments at most.
 */
export const filterPathsOf = (kayan: ClientKayan, context: FilterContext = {}): readonly FilterPath[] => {
  const { client, filters, locales, reads } = context
  const allowed = (owner: ClientKayan, field: ClientField) => !reads || reads(owner.name, field.name)
  // A hop's field answers for itself, since the page's list names only this kayan's fields.
  const filterable = (field: ClientField, own = true) => (own && filters ? filters.includes(field.name) : field.filter === true)
  const paths: FilterPath[] = []
  for (const field of kayan.fields) {
    if (!filterable(field) || !allowed(kayan, field)) continue
    if (field.rules.localized === true) {
      for (const locale of locales ?? []) paths.push({ path: `${field.name}.${locale}`, kind: field.kind, kayan, field, through: locale })
      continue
    }
    paths.push({ path: field.name, kind: field.kind, kayan, field })
    if (field.kind !== 'relationship' || !field.relationTo) continue
    const target = client?.find((one) => one.name === field.relationTo)
    if (!target) continue
    for (const hop of target.fields) {
      if (hop.kind === 'relationship' || hop.rules.localized === true) continue
      if (!filterable(hop, false) || !allowed(target, hop)) continue
      paths.push({ path: `${field.name}.${hop.name}`, kind: hop.kind, kayan: target, field: hop, through: field.name })
    }
  }
  return paths
}

/**
 * Whether a path and an operator are ones this kayan offers. Everything parsed off the URL is
 * re-derived through it, so a hostile link naming a field the viewer may not read renders no row.
 */
export const offers = ({ paths, path, operator }: { paths: readonly FilterPath[]; path: string; operator: string }): FilterPath | undefined => {
  const found = paths.find((one) => one.path === path)
  return found && (operatorsByKind[found.kind] ?? []).includes(operator as OperatorName) ? found : undefined
}
