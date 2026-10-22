// A store that keeps its rows in memory, so a test can watch what a write did without a database.
// Every kind builds the column name, every rule is an identity, and the transaction is the callback
// run straight through, since nothing here can be rolled back.
import { randomUUID } from 'node:crypto'
import { conflict, invalid, missing, defaultKinds, defaultRules, type ResolvedField, type ResolvedKayan, type Where } from 'mithaq'
import { compareValues as compare, matchesWhere } from 'mithaq/admin'

const each = <Value>(names: string[], value: Value): Record<string, Value> =>
  Object.fromEntries(names.map((name) => [name, value]))

/**
 * The sentence this store throws when a dotted key's near field names no relationship. Tests build
 * their expected message from it.
 */
export const noRelationship = ({ kayan, field, path }: { kayan: string; field: string; path: string }): string =>
  `Kayan "${kayan}" field "${field}" names no relationship, so the path "${path}" reaches no second table.`

export const memoryStore = () => {
  const rows = new Map<string, Record<string, unknown>[]>()
  const kayanByName = new Map<string, ResolvedKayan>()
  const calls = { connect: 0, destroy: 0, transaction: 0 }
  const of = (name: string) => {
    const kept = rows.get(name) ?? []
    rows.set(name, kept)
    return kept
  }
  const at = (name: string, id: unknown) => {
    const index = of(name).findIndex((row) => row.id === id)
    if (index < 0) throw new Error(`No "${name}" row with id ${String(id)}.`)
    return index
  }
  const fieldValue = (name: string, row: Record<string, unknown>, field: string) => {
    const [ownField, relatedField] = field.split('.')
    if (!relatedField) return row[field]
    const own = kayanByName.get(name)!.fields[ownField!]
    // A versions table's snapshot, which a delete's reference check asks about.
    if (!own && ownField === 'version') return (row.version as Record<string, unknown> | undefined)?.[relatedField]
    // A second segment the field's own locales name is a locale rather than a hop. This store keeps a
    // localized field as the one object it is written as, so the locale is read off that object, and a
    // field nobody wrote reads as null.
    if (own?.locales?.includes(relatedField)) {
      return (row[ownField!] as Record<string, unknown> | null | undefined)?.[relatedField] ?? null
    }
    // A near field that names no relationship, or a first segment the kayan never declared, is refused
    // here: reading `target.name` off either would be a `TypeError` naming nothing. A managed read
    // refuses the path before the store is asked.
    if (!own?.target) {
      throw new Error(noRelationship({ kayan: name, field: ownField!, path: field }))
    }
    const related = of(own.target.name).find((one) => one.id === row[ownField!])
    return related?.[relatedField]
  }
  const matches = (name: string, row: Record<string, unknown>, where: Where) => matchesWhere({ where, valueOf: (field) => fieldValue(name, row, field) })
  const constrained = (name: string, id: unknown, where?: Where) => {
    const index = at(name, id)
    if (where && !matches(name, of(name)[index]!, where)) throw new Error(`No "${name}" row with id ${String(id)}.`)
    return index
  }
  // The kayan's unique indexes, held as Postgres holds them: a null is distinct from every
  // other unless the index says otherwise, and the refusal names the kayan and no value.
  const held = (name: string, row: Record<string, unknown>) => {
    const taken = kayanByName.get(name)?.indexes.some(({ fields, unique, nullsNotDistinct }) =>
      unique && (nullsNotDistinct || fields.every((field) => row[field] != null))
      && of(name).some((other) => other.id !== row.id && fields.every((field) => (other[field] ?? null) === (row[field] ?? null))))
    if (taken) throw conflict({ message: `A "${name}" row already holds one of the unique values this write carries.`, key: 'error.conflict.unique', params: { kayan: name } })
    return row
  }
  const increments = (name: string, values: Record<string, unknown>, row?: Record<string, unknown>) => Object.fromEntries(Object.entries(values).map(([field, value]) => {
    if (kayanByName.get(name)?.fields[field]?.kind === 'json' || !value || typeof value !== 'object' || !('$inc' in value)) return [field, value]
    if (kayanByName.get(name)?.fields[field]?.kind !== 'integer' || !Number.isSafeInteger(value.$inc) || Object.keys(value).length !== 1) throw invalid({ message: 'An increment needs an integer field and a safe integer.', key: 'error.invalid.value' })
    return [field, row ? Number(row[field]) + Number(value.$inc) : value.$inc]
  }))
  return {
    capability: 'store' as const,
    rows,
    calls,
    // A store written by hand reads no kind's own column, so it names the rich text and storage kinds
    // beside base's.
    kinds: each([...Object.keys(defaultKinds), 'richText', 'upload'], (field: ResolvedField) => field.column),
    // `primary` is the store's own rule for the id column and is never in
    // `defaultRules`, so a store names it beside the rules the language has.
    rules: each([...Object.keys(defaultRules), 'primary'], (built: unknown) => built),
    init: (kayanList: ResolvedKayan[]) => {
      for (const kayan of kayanList) {
        kayanByName.set(kayan.name, kayan)
        // A version read reaches its row through the versions table's `parent`.
        if (kayan.versions) kayanByName.set(kayan.versions.table, kayan.versions.kayan)
      }
    },
    connect: async () => {
      calls.connect += 1
    },
    transaction: async <Result>(run: (tx: unknown) => Promise<Result>) => {
      calls.transaction += 1
      return run({ memory: true })
    },
    insert: async ({ kayan: name, data: values }: { tx: unknown; kayan: string; data: Record<string, unknown> }) => {
      // A row that names no id gets one, as a uuid column's default gives drizzle's: a versions row is
      // written with none, and the latest flip finds it again by id.
      const row = held(name, { ...values, id: values.id ?? randomUUID() })
      of(name).push(row)
      return row
    },
    upsert: async ({ kayan: name, on, data: values, where }: { tx: unknown; kayan: string; on: readonly string[]; data: Record<string, unknown>; where?: Where }) => {
      const row = of(name).find((row) => on.every((field) => row[field] === values[field]))
      if (row && where && !matches(name, row, where)) throw missing({ message: `No "${name}" row found.`, key: 'error.not_found.row' })
      const made = held(name, { ...row, ...increments(name, values, row), id: row?.id ?? values.id ?? randomUUID() })
      if (row) Object.assign(row, made)
      else of(name).push(made)
      return made
    },
    update: async ({ kayan: name, id, data: values, where }: { tx: unknown; kayan: string; id: unknown; data: Record<string, unknown>; where?: Where }) => {
      const row = of(name)[constrained(name, id, where)]!
      return Object.assign(row, held(name, { ...row, ...increments(name, values, row) }))
    },
    remove: async ({ kayan: name, id, where }: { tx: unknown; kayan: string; id: unknown; where?: Where }) =>
      of(name).splice(constrained(name, id, where), 1)[0]!,
    find: async ({ kayan: name, args: { limit, page, sort, where } }: { tx?: unknown; kayan: string; args: { limit: number; page: number; sort: { field: string; direction: 'asc' | 'desc' }; where?: Where } }) => {
      const sorted = of(name)
        .filter((row) => !where || matches(name, row, where))
        .toSorted((left, right) => {
          const primary = compare({ left: left[sort.field], right: right[sort.field], direction: sort.direction })
          if (primary || sort.field === 'id') return primary
          return compare({ left: left.id, right: right.id, direction: sort.direction })
        })
      const offset = limit > 0 ? (page - 1) * limit : 0
      const docs = limit > 0 ? sorted.slice(offset, offset + limit) : sorted
      return { docs: docs, totalDocs: sorted.length }
    },
    sum: async ({ kayan: name, field, where }: { tx?: unknown; kayan: string; field: string; where?: Where }) => {
      if (!['integer', 'number', 'decimal'].includes(kayanByName.get(name)?.fields[field]?.kind ?? '')) throw invalid({ message: 'Only numeric fields can be summed.', key: 'error.invalid.value' })
      const values = of(name).filter((row) => !where || matches(name, row, where)).map((row) => String(row[field] ?? 0))
      const scale = Math.max(0, ...values.map((value) => value.split('.')[1]?.length ?? 0))
      const total = values.reduce((sum, value) => sum + BigInt(value.replace('.', '') + '0'.repeat(scale - (value.split('.')[1]?.length ?? 0))), 0n)
      if (!scale) return String(total)
      const digits = String(total < 0n ? -total : total).padStart(scale + 1, '0')
      return `${total < 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
    },
    count: async ({ kayan: name, args: { where } }: { tx?: unknown; kayan: string; args: { where?: Where } }) =>
      of(name).filter((row) => !where || matches(name, row, where)).length,
    destroy: async () => {
      calls.destroy += 1
    },
  }
}
