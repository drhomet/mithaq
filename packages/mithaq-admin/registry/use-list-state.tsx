import { useEffect, useState } from 'react'
import type { ClientKayan } from 'mithaq/admin'
import { useScreen } from 'mithaq/admin/react'
import { refined, remember, remembered, type ListQuery } from 'mithaq-admin/list-query.ts'
import type { Copy } from 'mithaq-admin/copy.ts'
import { doneWords } from 'mithaq-admin/form-rules.tsx'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'
import { toast } from 'mithaq-admin/toast.tsx'

/**
 * A list's own state: the query it asks next, its runs and the refusal the last answered with, the ticked rows and
 * what the last bulk did, and the limit and columns remembered for this viewer.
 */
export const useListState = ({ copy, docs, kayan, onQuery, query, run }: {
  copy: Copy
  kayan: ClientKayan
  query: ListQuery
  onQuery: (query: ListQuery) => void
  docs: readonly Record<string, unknown>[]
  run?: (operation: string, input: Record<string, unknown>) => Promise<unknown>
}) => {
  const { maxLimit } = useScreen()
  const refine = (next: Partial<ListQuery>) => onQuery(refined(query, next))
  const [running, setRunning] = useState(false)
  /**
   * The refusal the last run answered with, drawn above the table, so a refused button that closed does not leave the page reading as changed.
   */
  const [refused, setRefused] = useState<unknown>(undefined)
  const runOnRow = async ({ operation, input, refuse = setRefused }: { operation: string; input: Record<string, unknown>; refuse?: (thrown: unknown) => void }) => {
    setRunning(true)
    setRefused(undefined)
    try {
      await run!(operation, input)
      const declared = kayan.operations.find((one) => one.name === operation)
      toast.success(declared?.effect === 'delete' ? doneWords({ kayan, copy, effect: 'delete' }) : doneWords({ kayan, copy, operation: { name: operation } }))
      return true
    } catch (thrown) {
      refuse(thrown)
      return false
    } finally {
      setRunning(false)
    }
  }
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * How many rows the last bulk changed, announced in the count's live region after the ticks drop. A new object per bulk restarts its six seconds; it clears after them or when a row is ticked again.
   */
  const [done, setDone] = useState<{ count: number } | undefined>(undefined)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(undefined), 6000)
    return () => clearTimeout(timer)
  }, [done])
  const rowIds = docs.map((row) => String(row.id ?? ''))
  /**
   * The ticked rows still on the page. A page that moved under the selection leaves ids that are no longer on screen, and a delete of rows nobody can see is the one thing this must not send.
   */
  const ticked = rowIds.filter((one) => one && selected.has(one))
  useEffect(() => {
    if (ticked.length) setDone(undefined)
  }, [ticked.length])

  // Per-viewer limit and columns are remembered in `localStorage`, read once and only where the URL named neither.
  // Read in an effect: it does not exist on the server, and reading it during render would mismatch hydration.
  useEffect(() => {
    if (query.limit !== undefined || query.cols !== undefined) return
    const held = remembered(kayan.name, maxLimit)
    if (held.limit === undefined && held.cols === undefined) return
    onQuery({ ...query, ...held })
    // The kayan alone: running again on the query would undo a viewer's own change back to what was remembered.
  }, [kayan.name])
  useEffect(() => {
    if (query.limit === undefined && query.cols === undefined) return
    remember(kayan.name, { ...(query.limit !== undefined && { limit: query.limit }), ...(query.cols !== undefined && { cols: query.cols }) })
  }, [kayan.name, query.cols, query.limit])

  return { refine, running, refusal: refusalKeyOf(refused), setRefused, runOnRow, selected, setSelected, rowIds, ticked, done, setDone }
}
