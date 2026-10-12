import { use, useEffect, useState, type ReactNode } from 'react'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import { ScreenContext } from 'mithaq/admin/react'
import type { CellProps } from './cells.tsx'
import type { FindApi } from './control-props.ts'
import { listed } from './format.tsx'
import { isForbidden } from './refusal.ts'
import { findByIds, idsOf, nameOfRow, titleFieldOf } from './relationship-control.tsx'

/**
 * What the table knows about the rows its relationship columns point at, keyed by target and id.
 * `null` is loading, a string is the row's title, `false` is a row the read did not answer for
 * (the access answer), an `Error` is a failed read, and an absent key was never asked for.
 */
export type RelationshipTitles = ReadonlyMap<string, string | Record<string, unknown> | null | false | Error>

export const titleKey = (target: string, id: string): string => `${target}:${id}`

/** Where the same map holds the row itself, for a cell that draws more than a title. */
export const rowKey = (target: string, id: string): string => `row:${target}:${id}`

/** Every id one page points at, grouped by the kayan it points into and counted once each, so a page costs one read per target. */
export const relationshipIdsOf = (
  fields: readonly ClientField[],
  docs: readonly Record<string, unknown>[],
): ReadonlyMap<string, readonly string[]> => {
  const byTarget = new Map<string, Set<string>>()
  for (const field of fields) {
    if ((field.kind !== 'relationship' && field.kind !== 'upload') || !field.relationTo) continue
    const held = byTarget.get(field.relationTo) ?? new Set<string>()
    for (const row of docs) for (const id of idsOf(row[field.name])) held.add(id)
    if (held.size) byTarget.set(field.relationTo, held)
  }
  return new Map([...byTarget].map(([target, ids]) => [target, [...ids]]))
}

/**
 * One read per target per page, keyed on the grouped ids so an unchanged page asks for nothing.
 * Cells read as loading until the browser's effect answers; with no `api` or screen, ids settle
 * as rows the viewer cannot see. No cell renders the raw id.
 */
export const useRelationshipTitles = ({
  fields,
  docs,
  context = {},
}: {
  fields: readonly ClientField[]
  docs: readonly Record<string, unknown>[]
  context?: { api?: FindApi; client?: readonly ClientKayan[]; locale?: string }
}): RelationshipTitles => {
  const { api, client, locale } = context
  const maxLimit = use(ScreenContext)?.screen.maxLimit
  const groups = relationshipIdsOf(fields, docs)
  const asked = JSON.stringify([...groups])
  const [titles, setTitles] = useState<RelationshipTitles>(() => new Map())

  useEffect(() => {
    let live = true
    const answers = new Map<string, string | Record<string, unknown> | null | false | Error>()
    // A target with no reader or no known read cap settles as `false` now, rather than loading on a read that is never made.
    for (const [target, ids] of groups) {
      for (const id of ids) {
        const asks = api?.[target] && maxLimit !== undefined ? null : false
        answers.set(titleKey(target, id), asks)
        answers.set(rowKey(target, id), asks)
      }
    }
    if (!answers.size) return
    setTitles(new Map(answers))
    void Promise.all(
      [...groups].map(async ([target, ids]) => {
        const reads = api?.[target]
        if (!reads || maxLimit === undefined) return
        const kayan = client?.find((one) => one.name === target)
        const title = titleFieldOf(kayan)
        const kind = kayan?.fields.find((one) => one.name === title)?.kind
        // A forbidden read is the same answer as a missing row; any other failure is held as its Error. Neither may reject: that would leave every cell loading.
        const found = await findByIds({ reads, ids, maxLimit }).catch((thrown: unknown) => (isForbidden(thrown) ? [] : thrown instanceof Error ? thrown : new Error(String(thrown))))
        if (found instanceof Error) {
          for (const id of ids) {
            answers.set(titleKey(target, id), found)
            answers.set(rowKey(target, id), found)
          }
          return
        }
        const byId = new Map(found.map((row) => [String(row.id ?? ''), row]))
        // An id the answer lacks is a row this actor may not read, so `false`, never left `null`.
        for (const id of ids) {
          const row = byId.get(id)
          answers.set(titleKey(target, id), row ? nameOfRow({ row, title, locale, kind }) : false)
          answers.set(rowKey(target, id), row ?? false)
        }
      }),
    ).then(() => {
      if (live) setTitles(new Map(answers))
    })
    return () => {
      live = false
    }
    // `groups` is rebuilt every render; `asked` is its content.
  }, [api, asked, locale])

  return titles
}

const totalToShow = 3

export function RelationshipCell({ field, locale, t, titles, value }: CellProps): ReactNode {
  const target = field.relationTo ?? ''
  const ids = idsOf(value)
  if (!ids.length) return ''
  const names = ids.slice(0, totalToShow).map((id) => {
    const found = titles?.get(titleKey(target, id))
    if (found === null || found === undefined) return t('admin.loading', 'Loading…') ?? 'Loading…'
    if (found instanceof Error) return '—'
    // A row not answered for reads as unseeable, never as the raw id the column holds.
    return typeof found === 'string' ? found : (t('admin.cannotSee', 'You can\'t see this') ?? 'You can\'t see this')
  })
  const rest = ids.length - names.length
  return (
    <span>
      {listed(names, locale)}
      {rest > 0
        ? ` ${(t('admin.andMore', 'and {count} more') ?? 'and {count} more').replace('{count}', String(rest))}`
        : ''}
    </span>
  )
}
// mithaq-admin 98077394ab68bdf56d5bf3e255c233120e7a13c1 9c05e3885308f9d3d7378963c5d5177f12cd62ddd537e454336efa814c0eb466
