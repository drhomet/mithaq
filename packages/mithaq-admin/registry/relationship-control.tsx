import { createContext, use, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { ClientKayan } from 'mithaq/admin'
import { ScreenContext } from 'mithaq/admin/react'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ariaRequired, changeOf, missingRow, type ControlProps, type FindApi } from 'mithaq-admin/control-props.ts'
import { titleOf } from 'mithaq-admin/copy.ts'
import { createsIn } from 'mithaq-admin/field-values.ts'
import { KayanForm } from 'mithaq-admin/form-context.tsx'
import { formatDate } from 'mithaq-admin/format.tsx'
import { isForbidden } from 'mithaq-admin/refusal.ts'

/**
 * A chip's remove button is 24 pixels and a phone's finger needs 44: its hit area is widened by an
 * inset over the chip, which the box around it keeps at 22 pixels.
 */
const chipRemovePhone = '[&_[data-slot=combobox-chip-remove]]:relative [&_[data-slot=combobox-chip-remove]]:after:absolute [&_[data-slot=combobox-chip-remove]]:after:-inset-[11px] sm:[&_[data-slot=combobox-chip-remove]]:static sm:[&_[data-slot=combobox-chip-remove]]:after:content-none'

/**
 * What a row of the target is shown as, and what a search runs over. `??` rather than `||` because
 * `useAsTitle` is either a field's name or absent, and `buildAsas` refuses a name that is not a field
 * of the kayan.
 */
export const titleFieldOf = (target?: ClientKayan): string => target?.useAsTitle ?? 'id'

/**
 * Every row of `ids` the target answers for, `maxLimit` ids at a time, so a set past the cap is answered in full.
 * `maxLimit` is the build's own, as the server refuses a limit past it rather than clamping.
 */
export const findByIds = async ({ reads, ids, maxLimit }: { reads: NonNullable<FindApi[string]>; ids: readonly string[]; maxLimit: number }) => {
  const docs: Record<string, unknown>[] = []
  for (let at = 0; at < ids.length; at += maxLimit) {
    const piece = ids.slice(at, at + maxLimit)
    docs.push(...(await reads.find({ where: { id: { in: piece } }, limit: piece.length })).docs)
  }
  return docs
}

/**
 * Whether a term typed here can be turned into a condition at all: `like` takes text and email and
 * nothing else, so a target whose title is its `id`, a uuid, offers a list to scroll and no search.
 * Without this the first keystroke on such a picker is a 400.
 */
export const searchableTitle = (target: ClientKayan | undefined, title: string): boolean => {
  const kind = target?.fields.find((field) => field.name === title)?.kind
  return kind === 'text' || kind === 'email'
}

/**
 * Whether the title is a localized field: one value per locale, which no sort can name and a `like`
 * names by one locale, `name.ar`.
 */
export const localizedTitle = (target: ClientKayan | undefined, title: string): boolean =>
  target?.fields.find((field) => field.name === title)?.rules.localized === true

/**
 * What one row of the target reads as: the title field's value, and the row's own id where the target
 * declares no title or the read masked the column.
 */
export const nameOfRow = ({ row, title, locale, kind }: { row: Record<string, unknown>; title: string; locale?: string; kind?: string }): string => {
  const held = row[title]
  // A localized title is read in the viewer's locale and in no other: a row short of that locale shows
  // its id, never another locale's words. A date is drawn in the format its column draws it in rather
  // than as the wire's ISO string.
  const shown = held !== null && typeof held === 'object' && !(held instanceof Date) ? (held as Record<string, unknown>)[locale ?? ''] : held
  if (shown === null || shown === undefined || shown === '') return String(row.id ?? '')
  const date = kind === 'datetime' || kind === 'date' ? formatDate({ value: shown, locale: locale ?? '', day: kind === 'date' }) : undefined
  return date ?? String(shown)
}

/**
 * How a project names a picker's rows beyond their title: a hook, given the target kayan's name and the rows held,
 * that returns a namer or `undefined` to keep the title. A hook because the name may need a read of its own.
 */
export type UseRowLabel = (target: string, rows: readonly Record<string, unknown>[]) => ((row: Record<string, unknown>) => string | undefined) | undefined
export const RowLabelContext = createContext<UseRowLabel>(() => undefined)

/** How many rows one page of the picker holds. */
const perPage = 10

/**
 * The ids one value holds: none, the one a many-to-one field carries, or the set a `hasMany` field
 * carries, in the order the store answered with.
 */
export const idsOf = (value: unknown): readonly string[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value.map(String) : [String(value)]

/** One row of the target as the combobox's own item: base-ui reads a label off the shape `{ value, label }` without being told how. */
type Option = { value: string; label: string }

/**
 * The picker, and what each row of its list is drawn as beside its title where the caller draws more
 * than the title, such as the upload control's thumbnail.
 */
export function RelationshipControl(props: ControlProps & { drawRow?: (row: Record<string, unknown>, label: string) => ReactNode }): ReactElement {
  const { api, client, describedBy, drawRow, error, field, id, kayan, locale, placeholder, readOnly, t, value } = props
  const change = changeOf(props)
  const target = client?.find((one) => one.name === field.relationTo)
  const title = titleFieldOf(target)
  const searchable = searchableTitle(target, title)
  const localized = localizedTitle(target, title)
  const reads = target && api ? api[target.name] : undefined
  // The most rows one read asks for: the build's `maxLimit`, off the screen. A form drawn with no
  // screen has no such number, so it holds to the picker's own page of ten.
  const screenState = use(ScreenContext)
  const most = screenState?.screen.maxLimit ?? perPage
  // Payload's add-new beside a relationship: a row of a form, never a filter's box or an operation's, for a viewer the
  // report lets create a row of the target. The server still decides the create.
  const add = use(KayanForm)?.add
  // An upload's picker has its own Upload new, so only a relationship draws the +.
  const adds = field.kind === 'relationship' && field.allowCreate !== false && !!add && !!target && !readOnly && props.form !== undefined && createsIn({ kayan: target, report: screenState?.access.collections?.[target.name] })
  /** Every id this field is holding, which is at most one unless the field said otherwise. */
  const held = idsOf(value)
  const many = field.hasMany === true

  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  /** The term a query has been run for, which is the typed one 300 ms later. */
  const [searched, setSearched] = useState('')
  const [rows, setRows] = useState<readonly Record<string, unknown>[]>([])
  /** The page a scroll to the bottom loads next, off the answer's own `nextPage`. */
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * Whether the last page read came back refused rather than empty, so the list does not say "no rows
   * match this filter" for a target this actor may not read at all.
   */
  const [refused, setRefused] = useState(false)
  /**
   * The chosen rows by id: one picked off a page needs no read, one the field was seeded with is read once.
   * A map, since a `hasMany` field holds a set and a many-to-one field a set of one.
   */
  const [chosen, setChosen] = useState<ReadonlyMap<string, Record<string, unknown>>>(() => new Map())

  /**
   * What the popup is anchored on where the box is a chip list: the list itself and not the input
   * inside it, which shrinks to the width the typed term needs, so a listbox that followed it would
   * hang off the middle of the field.
   */
  const chipsRef = useRef<HTMLDivElement | null>(null)

  /**
   * Held ids the read settled without a row: `gone` when the read answered without it, `unseen` when it was refused
   * (as is every id of a target the screen does not cross), `failed` on a 500 or lost network, which says nothing
   * about access.
   */
  const [settled, setSettled] = useState<ReadonlyMap<string, 'unseen' | 'gone' | 'failed'>>(() => new Map())

  const titleKind = target?.fields.find((one) => one.name === title)?.kind
  const named = use(RowLabelContext)(field.relationTo ?? '', [...rows, ...chosen.values()])
  const nameOf = (row: Record<string, unknown>) => named?.(row) ?? nameOfRow({ row, title, locale, kind: titleKind })
  const rowOf = (held: string) => chosen.get(held) ?? rows.find((one) => String(one.id ?? '') === held)
  const stateOf = (held: string) => (reads ? settled.get(held) : 'unseen')
  /**
   * What one held id reads as: the row's own title where something named it, deleted or not available
   * where the read settled without it, a dash where the read failed, and loading until then. Never
   * the raw id, which reads as data and is none of the viewer's.
   */
  const labelOf = (held: string) => {
    const row = rowOf(held)
    if (row) return nameOf(row)
    const state = stateOf(held)
    if (state === 'failed') return '—'
    return state ? missingRow({ t, gone: state === 'gone' }) : (t('admin.loading', 'Loading…') ?? 'Loading…')
  }
  /**
   * A set whose every row the viewer cannot see says so once, in place of one chip for each. The chips
   * are not drawn but are still the field's value, so `pick` refuses a shorter set while this holds:
   * a row can be added, never taken off.
   */
  const allRefused = many && held.length > 0 && held.every((one) => !rowOf(one) && stateOf(one) === 'unseen')

  /**
   * One page of the target, which is the whole query. The `not_in` keeps every chosen row out of the
   * list; an empty list of ids is no special case, because the store writes `not_in []` as `true`.
   */
  const queryFor = (page: number, search: string) => ({
    limit: Math.min(perPage, most),
    page,
    // The server holds the page to what the field's `filterOptions` offers this viewer.
    ...(field.filterOptions && kayan && { for: `${kayan.name}.${field.name}` }),
    ...(!localized && { sort: title }),
    where: {
      id: { not_in: held },
      ...(searchable && search ? { [localized ? `${title}.${locale}` : title]: { like: search } } : {}),
    },
  })
  /**
   * The ids the query above is keyed on, as one string: `held` is rebuilt on every render, so an effect
   * watching the array would read every page again on every keystroke.
   */
  const excluded = held.join(',')

  useEffect(() => {
    if (term === searched) return
    const timer = setTimeout(() => setSearched(term), 300)
    return () => clearTimeout(timer)
  }, [searched, term])

  // Page one, on open and on every term the debounce settles.
  useEffect(() => {
    if (!open || !reads) return
    let live = true
    setLoading(true)
    void reads
      .find(queryFor(1, searched))
      .then((found) => {
        if (!live) return
        setRefused(false)
        setRows(found.docs)
        setNext(found.hasNextPage ? found.nextPage : null)
      })
      // A read the server refuses leaves the list as it was rather than rejecting into nothing, and
      // the list says it was refused rather than that nothing matched.
      .catch(() => {
        if (live) setRefused(true)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [excluded, locale, open, reads, searched, title])

  /**
   * The chosen rows, for every id the option list does not already hold: one read, in pieces the read
   * cap admits (`findByIds`). A row picked off a page is never asked for, as picking it puts the row
   * in `chosen`.
   */
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (!reads) return
    // Once per id, whatever the answer: an id the target does not answer for would otherwise be asked
    // for again on every page the list loads, as the loaded rows are watched.
    const missing = held.filter(
      (one) => !chosen.has(one) && !rows.some((row) => String(row.id ?? '') === one) && !asked.current.has(one),
    )
    if (!missing.length) return
    for (const one of missing) asked.current.add(one)
    // No cleanup drops the answer: each id is asked for once, so an answer dropped because the effect
    // ran again would never be asked for again, and the box would show the id for good.
    void findByIds({ reads, ids: missing, maxLimit: most })
      .then((docs) => {
        const found = new Set(docs.map((row) => String(row.id ?? '')))
        setSettled((already) => new Map([...already, ...missing.filter((one) => !found.has(one)).map((one) => [one, 'gone'] as const)]))
        if (!docs.length) return
        setChosen((already) => new Map([...already, ...docs.map((row) => [String(row.id ?? ''), row] as const)]))
      })
      // A refusal is the same answer as a row not returned: the viewer cannot see it. A failure says
      // only that the read did not answer.
      .catch((thrown: unknown) => {
        const state = isForbidden(thrown) ? 'unseen' : 'failed'
        setSettled((already) => new Map([...already, ...missing.map((one) => [one, state] as const)]))
      })
  }, [chosen, excluded, reads, rows])

  const selected = held.map((one) => ({ value: one, label: labelOf(one) }))
  const searchLabel = t('admin.search', 'Search') ?? 'Search'
  const options: Option[] = rows.map((row) => ({ value: String(row.id ?? ''), label: nameOf(row) }))

  /**
   * What a pick reports. Picked rows are remembered, so hydration does not re-ask for names the list showed.
   * A `hasMany` field reports an array, never `null`: a `[]` seed against `null` would read as a change forever.
   */
  const pick = (next: readonly Option[]) => {
    // A set drawn as one note cannot be shortened: Backspace in the empty box takes the last chip off,
    // and it would drop an id nobody sees.
    if (allRefused && next.length < held.length) return
    const picked = next.flatMap((one) => {
      const row = rows.find((each) => String(each.id ?? '') === one.value)
      return row ? [[one.value, row] as const] : []
    })
    if (picked.length) setChosen((already) => new Map([...already, ...picked]))
    setTerm('')
    const ids = next.map((one) => one.value)
    change(many ? ids : (ids[0] ?? null))
  }

  /**
   * Everything both boxes hand the root, written once. `filter={null}` because the filtering is the
   * target kayan's `find` and not a pass over the page; `items` is the page as it arrived.
   */
  const root = {
    items: options,
    filter: null,
    // The first row is highlighted as the list opens, so Enter picks a row rather than nothing. The
    // cast: base-ui's root types `autoHighlight` as a boolean while the combobox behind it reads
    // `'always'`, and `true` alone highlights nothing until a term is typed.
    autoHighlight: 'always' as unknown as boolean,
    open,
    onOpenChange: setOpen,
    disabled: readOnly,
    // The items are objects, so equal ids in two objects have to be told to match: the default is `Object.is`.
    isItemEqualToValue: (one: Option, other: Option) => one.value === other.value,
    // The typed term alone. base-ui writes the selected row's label into the input when the selection
    // changes and when the list opens, and each of those calls this too; taking them as a search term
    // would read the target for a name it is already showing.
    onInputValueChange: (next: string, details: { reason: string }) =>
      details.reason === 'input-change' && setTerm(next),
  }

  /** The listbox, which is the same page of rows whichever box is above it. */
  const list = (
    <ComboboxContent anchor={many ? chipsRef : undefined}>
      <ComboboxList
        onScroll={(event) => {
          const list = event.currentTarget
          if (loading || next === null || !reads) return
          if (list.scrollTop + list.clientHeight < list.scrollHeight - 8) return
          const page = next
          setLoading(true)
          void reads
            .find(queryFor(page, searched))
            .then((found) => {
              setRows((already) => [...already, ...found.docs])
              setNext(found.hasNextPage ? found.nextPage : null)
            })
            .catch(() => {})
            .finally(() => setLoading(false))
        }}
      >
        {options.map((option) => {
          const row = drawRow && rows.find((one) => String(one.id ?? '') === option.value)
          return (
            <ComboboxItem key={option.value} value={option}>
              {row ? drawRow(row, option.label) : option.label}
            </ComboboxItem>
          )
        })}
      </ComboboxList>
      {loading ? (
        <p className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
          <Spinner />
          {t('admin.loading', 'Loading…') ?? 'Loading…'}
        </p>
      ) : null}
      {!loading && rows.length === 0 ? (
        <p className="px-3 py-1.5 text-sm text-muted-foreground">
          {refused
            ? (t('admin.refused', 'That list could not be read.') ?? 'That list could not be read.')
            : (t('admin.noMatches', 'No rows match this filter.') ?? 'No rows match this filter.')}
        </p>
      ) : null}
    </ComboboxContent>
  )

  /** Picks a row the drawer just made, beside whatever the field already holds. */
  const made = (row: Record<string, unknown>) => {
    // A create whose answer names no id it may read has nothing to pick.
    if (row?.id === undefined || row.id === null) return
    const one = String(row.id)
    setChosen((already) => new Map([...already, [one, row]]))
    change(many ? [...held, one] : one)
  }
  const plus = adds ? (
    <Button type="button" variant="outline" size="icon" data-add-new="" className="shrink-0 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" aria-label={(t('admin.addNew', 'Add new {kind}') ?? 'Add new {kind}').replace('{kind}', () => titleOf({ kayan: target!, copy: { t, locale: locale ?? '' } }))} onClick={() => add!(target!, made)}>
      <Plus aria-hidden="true" />
    </Button>
  ) : null
  const beside = (picker: ReactElement) => (plus ? <div className="flex items-start gap-2"><div className="min-w-0 flex-1">{picker}</div>{plus}</div> : picker)

  // A set: one chip per chosen row, rendered in the order `value` holds because base-ui removes a
  // chip by its position among them.
  if (many) {
    return beside(
      <Combobox {...root} multiple value={selected} onValueChange={pick}>
        <ComboboxChips className="py-0 sm:py-1.5" ref={chipsRef} aria-invalid={error ? true : undefined}>
          {allRefused ? (
            <span className="text-muted-foreground px-1 text-sm">{selected[0]!.label}</span>
          ) : selected.map((one) => (
            <ComboboxChip key={one.value} className={chipRemovePhone} removeLabel={t('admin.remove', 'Remove')} showRemove={!readOnly}>
              {one.label}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput
            className="min-h-11 sm:min-h-0"
            id={id}
            // A hint is for an empty box: beside a chip it reads as a value nobody chose, so the box keeps
            // its name in `aria-label` and says nothing once a row is held.
            placeholder={selected.length ? undefined : (placeholder ?? searchLabel)}
            disabled={readOnly}
            readOnly={!searchable}
            aria-label={searchLabel}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            aria-required={ariaRequired(field)}
          />
        </ComboboxChips>
        {list}
      </Combobox>,
    )
  }

  return beside(
    // The keyboard model (roles, aria wiring, arrows, Enter, Escape) is base-ui's, so none is here.
    <Combobox {...root} value={selected[0] ?? null} onValueChange={(next) => pick(next ? [next] : [])}>
      <ComboboxInput
        id={id}
        placeholder={placeholder ?? searchLabel}
        disabled={readOnly}
        // A target whose title cannot take `like` offers a list and no search, so the box takes no term
        // and still takes the focus, the arrows and Enter.
        readOnly={!searchable}
        aria-label={searchLabel}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-required={ariaRequired(field)}
        // The two icon-only buttons of the addon are named here because base-ui names neither.
        clearLabel={t('admin.clear', 'Clear')}
        triggerLabel={t('admin.showOptions', 'Show options')}
        showClear={held.length > 0 && !readOnly}
      />
      {list}
    </Combobox>,
  )
}
