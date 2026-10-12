import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ClientKayan } from 'mithaq/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { controls, labelFor, type FindApi, type Translate } from './controls.tsx'
import { RelationshipControl } from './relationship-control.tsx'
import { operatorsByKind, valueShapeOf, type FilterPath } from './filter-operators.ts'
import { instantOf, type Condition, type FilterWhere } from './list-query.ts'

export type FiltersProps = {
  /** Every path this kayan offers, already narrowed by the access report. */
  paths: readonly FilterPath[]
  value?: FilterWhere
  /** Where a committed panel goes. `undefined` is "no filter at all". */
  onChange: (where: FilterWhere | undefined) => void
  t: Translate
  locale: string
  /** Every kayan of the build, so a relationship row's picker can find its target. */
  client?: readonly ClientKayan[]
  /** The typed client's reads, for that picker's own paging. */
  api?: FindApi
}

type Row = { path: string; operator: string; value: unknown }

const rowOf = (condition: Condition): Row => {
  const [path = '', operators = {}] = Object.entries(condition)[0] ?? []
  const [operator = 'equals', value] = Object.entries(operators)[0] ?? []
  return { path, operator, value }
}

const conditionOf = (row: Row): Condition => ({ [row.path]: { [row.operator]: row.value } })

/**
 * The rows the panel holds: the `or` of `and`s a `FilterWhere` carries. Held as state, not derived
 * from `value`, because a row with no value yet does not survive the round trip through the URL.
 */
export type Conditions = readonly { and: Condition[] }[]

/** What a set of rows commits: the filled rows, and no group that keeps none. */
export const committedOf = (conditions: Conditions): FilterWhere | undefined => {
  const kept = conditions
    .map((group) => ({ and: group.and.filter((one) => !isEmptyConditionValue(rowOf(one).value)) }))
    .filter((group) => group.and.length > 0)
  return kept.length ? { or: kept } : undefined
}

/** One more row, in a group of its own; `and` is reached by adding and then switching the join. */
export const addCondition = (conditions: Conditions, condition: Condition): Conditions => [
  ...conditions,
  { and: [condition] },
]

/** One row gone, and the group it emptied gone with it. */
export const removeCondition = ({ conditions, orIndex, andIndex }: { conditions: Conditions; orIndex: number; andIndex: number }): Conditions =>
  conditions
    .map((group, o) => (o === orIndex ? { and: group.and.filter((_, a) => a !== andIndex) } : group))
    .filter((group) => group.and.length > 0)

/** One row rewritten in place. */
export const updateCondition = ({
  conditions,
  orIndex,
  andIndex,
  condition,
}: {
  conditions: Conditions
  orIndex: number
  andIndex: number
  condition: Condition
}): Conditions =>
  conditions.map((group, o) => (o === orIndex ? { and: group.and.map((one, a) => (a === andIndex ? condition : one)) } : group))

/** Moves one row between `and` and `or` by flattening the groups to one list and rebuilding them from each row's join. */
export const updateJoin = ({
  conditions,
  orIndex,
  andIndex,
  join,
}: {
  conditions: Conditions
  orIndex: number
  andIndex: number
  join: 'and' | 'or'
}): Conditions => {
  const flattened: { condition: Condition; join: 'and' | 'or' | null }[] = []
  conditions.forEach((group, o) => {
    group.and.forEach((condition, a) => {
      const isTarget = o === orIndex && a === andIndex
      const current = flattened.length === 0 ? null : a === 0 ? 'or' : 'and'
      flattened.push({ condition, join: isTarget ? join : current })
    })
  })
  const rebuilt: { and: Condition[] }[] = []
  flattened.forEach(({ condition, join: itemJoin }, index) => {
    if (index === 0 || itemJoin === 'or') rebuilt.push({ and: [condition] })
    else rebuilt[rebuilt.length - 1]!.and.push(condition)
  })
  return rebuilt
}

const isEmptyConditionValue = (value: unknown): boolean => value === undefined || value === null || value === ''

/**
 * An empty row reports `undefined` as soon as it mounts, and committing that stores
 * `{ [operator]: undefined }`, a row gone on the next parse. Only a value edit can be a no-op.
 */
const isNoOpConditionValueUpdate = (stored: unknown, incoming: unknown): boolean =>
  isEmptyConditionValue(stored) && isEmptyConditionValue(incoming)

// A select item's value may not be '' (the primitive reserves it for nothing chosen), so an unanswered row is carried under this name and mapped back to ''.
const unanswered = 'unanswered'

// `like` needs telling apart from `contains`: the drizzle store runs one `ilike` per whitespace-separated word. Labels go through `t` under `operator.<name>`.
const operatorFallbacks: Readonly<Record<string, string>> = {
  contains: 'contains',
  equals: 'is',
  exists: 'exists',
  greater_than: 'is after',
  greater_than_equal: 'is at least',
  in: 'is one of',
  less_than: 'is before',
  less_than_equal: 'is at most',
  like: 'matches every word',
  not_equals: 'is not',
  not_in: 'is none of',
}

const asText = (value: unknown) =>
  value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value)

// A moment typed with no zone becomes the instant it names on the viewer's clock; a moment with its own zone, and text no clock reads, are sent as typed for the server to judge.
const valueFrom = (kind: string, operator: string, text: string): unknown => {
  const shape = valueShapeOf(operator)
  if (shape === 'boolean') return text === '' ? undefined : text === 'true'
  if (shape === 'list') {
    const tokens = text.split(',').map((one) => one.trim()).filter(Boolean)
    return tokens.length ? (kind === 'number' || kind === 'integer' ? tokens.map(Number) : kind === 'datetime' ? tokens.map(instantOf) : tokens) : undefined
  }
  if (text === '') return undefined
  if (kind === 'checkbox') return text === 'true'
  return kind === 'number' || kind === 'integer' ? Number(text) : kind === 'datetime' ? instantOf(text) : text
}

function ValueInput({ id, locale, operator, onCommit, path, t, value }: { id: string; locale: string; operator: string; path: FilterPath; t: Translate; value: unknown; onCommit: (value: unknown) => void }): ReactElement {
  const { kind } = path
  const [text, setText] = useState(asText(value))
  // `sent` is the last commit read back as text; it differs from the typed text where the commit converts it.
  const reported = useRef(asText(value))
  const sent = useRef(asText(value))
  useEffect(() => {
    // Re-seeding from this input's own commit coming back would drop keystrokes typed since, or swap the moment typed for its instant.
    const incoming = asText(value)
    if (incoming !== sent.current) {
      reported.current = sent.current = incoming
      setText(incoming)
    }
  }, [value])
  useEffect(() => {
    if (text === reported.current) return
    const timer = setTimeout(() => {
      const next = valueFrom(kind, operator, text)
      reported.current = text
      sent.current = asText(next)
      onCommit(next)
    }, 300)
    return () => clearTimeout(timer)
  }, [kind, onCommit, operator, text])

  const shape = valueShapeOf(operator)
  if (shape === 'boolean' || kind === 'checkbox') {
    return (
      <Select value={text === '' ? unanswered : text} onValueChange={(next) => setText(next === null || next === unanswered ? '' : next)}>
        {/* The word is the trigger's own child: the item list mounts only while open, so a server render would show an empty trigger. */}
        <SelectTrigger aria-label="value" size="sm">
          <SelectValue>{text === '' ? '—' : text}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={unanswered}>—</SelectItem>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  // A moment is sent as its ISO instant, so 09:30 picked at UTC+3 asks for 06:30Z and the picker draws it back on the reader's clock. `in` and `not_in` keep the token list.
  if ((kind === 'date' || kind === 'datetime') && shape !== 'list') {
    const Picker = controls[kind]!
    return (
      <Picker
        field={path.field}
        kayan={path.kayan}
        values={{}}
        setValue={() => {}}
        t={t}
        locale={locale}
        id={id}
        value={text}
        readOnly={false}
        onChange={(next) => setText(next instanceof Date ? next.toISOString() : asText(next))}
      />
    )
  }
  // A relationship reaches this arm only for `in` and `not_in`, a list of ids; its scalar operators get the picker.
  const type = shape === 'list' ? 'text' : kind === 'number' || kind === 'integer' ? 'number' : kind === 'email' ? 'email' : 'text'
  return (
    <Input
      aria-label="value"
      className="w-auto"
      type={type}
      step={kind === 'integer' && shape !== 'list' ? '1' : undefined}
      inputMode={kind === 'decimal' ? 'decimal' : undefined}
      dir="auto"
      value={text}
      placeholder={shape === 'list' ? 'a, b, c' : undefined}
      onChange={(event) => setText(event.target.value)}
    />
  )
}

export function Filters({ api, client, locale, onChange, paths, t, value }: FiltersProps): ReactElement | null {
  const [conditions, setConditions] = useState<Conditions>(() => value?.or ?? [])
  // What this panel commits comes back through the URL with the unfilled rows gone; re-seeding from that would drop the row being written. A `value` it did not report is an outside change and does re-seed.
  const reported = useRef(JSON.stringify(value ?? null))
  useEffect(() => {
    const incoming = JSON.stringify(value ?? null)
    if (incoming === reported.current) return
    reported.current = incoming
    setConditions(value?.or ?? [])
  }, [value])

  // No panel for a kayan with no filterable field; after the hooks, which must run on every render.
  if (!paths.length) return null
  const first = paths[0]!
  const flat = conditions.flatMap((group, orIndex) => group.and.map((condition, andIndex) => ({ andIndex, condition, orIndex })))
  const blank = (): Condition => ({ [first.path]: { [(operatorsByKind[first.kind] ?? ['equals'])[0]!]: undefined } })

  const commit = (next: Conditions) => {
    setConditions(next)
    const where = committedOf(next)
    const encoded = JSON.stringify(where ?? null)
    reported.current = encoded
    // Nothing goes up when the commit equals the filter the host holds: a host resets to page one on any `onChange`, so Add filter on page three would lose the page.
    if (encoded !== JSON.stringify(value ?? null)) onChange(where)
  }

  const replace = (orIndex: number, andIndex: number, row: Row) =>
    commit(updateCondition({ conditions, orIndex, andIndex, condition: conditionOf(row) }))

  // With nothing committed the panel shows the virtual row below, so the click makes it real and appends beside it.
  const add = () => commit(flat.length ? addCondition(conditions, blank()) : [{ and: [blank()] }, { and: [blank()] }])

  const labelOf = (path: FilterPath) => {
    const own = labelFor({ kayan: path.kayan, field: path.field, copy: { t, locale } })
    return path.through && path.through !== path.field.name ? `${path.through} > ${own}` : own
  }

  // The virtual first row commits on the first real edit rather than on mount, so an untouched panel writes no URL.
  const rows = flat.length ? flat : [{ andIndex: 0, condition: blank(), orIndex: 0 }]

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-mithaq-filters={rows.length}>
      {rows.map(({ andIndex, condition, orIndex }, index) => {
        const row = rowOf(condition)
        const path = paths.find((one) => one.path === row.path) ?? first
        const operators = operatorsByKind[path.kind] ?? []
        const operator = operators.includes(row.operator as never) ? row.operator : (operators[0] ?? 'equals')
        const virtual = flat.length === 0
        const write = (next: Row) => (virtual ? commit([{ and: [conditionOf(next)] }]) : replace(orIndex, andIndex, next))
        return (
          <div key={`${orIndex}.${andIndex}`} className="flex flex-wrap items-center gap-2">
            {index === 0 ? (
              <span className="text-sm text-muted-foreground">{t('filter.where', 'Where') ?? 'Where'}</span>
            ) : (
              <Select
                value={andIndex === 0 ? 'or' : 'and'}
                onValueChange={(next) => commit(updateJoin({ conditions, orIndex, andIndex, join: next === 'or' ? 'or' : 'and' }))}
              >
                <SelectTrigger aria-label={t('filter.join', 'Join') ?? 'Join'} size="sm">
                  <SelectValue>
                    {andIndex === 0 ? (t('filter.or', 'or') ?? 'or') : (t('filter.and', 'and') ?? 'and')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">{t('filter.and', 'and') ?? 'and'}</SelectItem>
                  <SelectItem value="or">{t('filter.or', 'or') ?? 'or'}</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select
              value={path.path}
              onValueChange={(chosen) => {
                const next = paths.find((one) => one.path === chosen) ?? first
                const kept = (operatorsByKind[next.kind] ?? []).includes(operator as never) ? operator : (operatorsByKind[next.kind] ?? ['equals'])[0]!
                write({ path: next.path, operator: kept, value: undefined })
              }}
            >
              <SelectTrigger aria-label={t('filter.field', 'Field') ?? 'Field'} size="sm">
                <SelectValue>{labelOf(path)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {paths.map((one) => (
                  <SelectItem key={one.path} value={one.path}>
                    {labelOf(one)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={operator} onValueChange={(chosen) => chosen && write({ path: path.path, operator: chosen, value: undefined })}>
              <SelectTrigger aria-label={t('filter.operator', 'Operator') ?? 'Operator'} size="sm">
                <SelectValue>{t(`operator.${operator}`, operatorFallbacks[operator]) ?? operator}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {operators.map((one) => (
                  <SelectItem key={one} value={one}>
                    {t(`operator.${one}`, operatorFallbacks[one]) ?? one}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {path.kind === 'relationship' && valueShapeOf(operator) === 'scalar' ? (
              // The form's picker rather than a box for typing a uuid; `in` and `not_in` keep the token list because the picker settles on one id.
              <RelationshipControl
                field={path.field}
                values={{}}
                setValue={() => {}}
                kayan={path.kayan}
                client={client}
                api={api}
                t={t}
                id={`filter-${orIndex}-${andIndex}`}
                value={row.value}
                readOnly={false}
                onChange={(next) => {
                  if (isNoOpConditionValueUpdate(row.value, next)) return
                  write({ path: path.path, operator, value: next })
                }}
              />
            ) : (
              <ValueInput
                id={`filter-${orIndex}-${andIndex}`}
                locale={locale}
                path={path}
                t={t}
                operator={operator}
                value={row.value}
                onCommit={(next) => {
                  if (isNoOpConditionValueUpdate(row.value, next)) return
                  write({ path: path.path, operator, value: next })
                }}
              />
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => commit(virtual ? [] : removeCondition({ conditions, orIndex, andIndex }))}>
              {t('filter.remove', 'Remove') ?? 'Remove'}
            </Button>
          </div>
        )
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          {t('filter.add', 'Add filter') ?? 'Add filter'}
        </Button>
      </div>
    </div>
  )
}
