import { useState, type ReactElement } from 'react'
import { ChevronDown, Columns as LayoutColumns } from 'lucide-react'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { checkboxSize } from './control-props.ts'
import { labelFor, type Translate } from './copy.ts'
import type { ColumnChoice } from './list-query.ts'

export type ColumnsProps = {
  kayan: ClientKayan
  /** Every column, in order, with whether it is shown. */
  columns: readonly ColumnChoice[]
  onChange: (columns: readonly ColumnChoice[]) => void
  t: Translate
  locale: string
}

/** Which fields the popup may offer: the ones this actor may read. Chrome only: the read masks a denied column whatever the popup shows. */
export const columnCandidates = (
  kayan: ClientKayan,
  reads?: (kayan: string, field: string) => boolean,
): readonly ClientField[] =>
  kayan.fields.filter(
    (field) => !reads || reads(kayan.name, field.name),
  )

/** The next column in the same section, or -1 at its end. The popup draws one list twice, so a neighbour never crosses into the other section. */
export const neighbour = ({ columns, at, by }: { columns: readonly ColumnChoice[]; at: number; by: -1 | 1 }): number => {
  for (let index = at + by; index >= 0 && index < columns.length; index += by) {
    if (columns[index]!.active === columns[at]!.active) return index
  }
  return -1
}

/** One column swapped with its neighbour in the same section; at a section's end the same list comes back. */
export const move = ({ columns, at, by }: { columns: readonly ColumnChoice[]; at: number; by: -1 | 1 }): readonly ColumnChoice[] => {
  const to = neighbour({ columns, at, by })
  if (to < 0) return columns
  const next = [...columns]
  next[at] = columns[to]!
  next[to] = columns[at]!
  return next
}

export function Columns({ columns, kayan, locale, onChange, t }: ColumnsProps): ReactElement {
  const [open, setOpen] = useState(false)
  const byName = new Map(kayan.fields.map((field) => [field.name, field]))
  const nameOf = (name: string) => {
    const field = byName.get(name)
    return field ? labelFor({ kayan, field, copy: { t, locale } }) : name
  }
  const toggle = (name: string) =>
    onChange(columns.map((one) => (one.name === name ? { ...one, active: !one.active } : one)))
  // The box is a `role="checkbox"` button, so the label points at it by id; the kayan name keeps ids unique when two lists share a screen.
  const boxId = (name: string) => `mithaq-column-${kayan.name}-${name}`
  const section = (active: boolean) => (
    <ul className="flex flex-col gap-1">
      {columns.map((column, at) =>
        column.active !== active ? null : (
          <li key={column.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Checkbox className={checkboxSize} id={boxId(column.name)} checked={column.active} onCheckedChange={() => toggle(column.name)} />
              <Label htmlFor={boxId(column.name)} className="font-normal">
                {nameOf(column.name)}
              </Label>
            </span>
            <span className="flex gap-1">
              <Button type="button" variant="outline" size="icon-xs" className="max-sm:size-11" disabled={neighbour({ columns, at, by: -1 }) < 0} onClick={() => onChange(move({ columns, at, by: -1 }))} aria-label={`${t('columns.up', 'Move up') ?? 'Move up'}: ${nameOf(column.name)}`}>
                ↑
              </Button>
              <Button type="button" variant="outline" size="icon-xs" className="max-sm:size-11" disabled={neighbour({ columns, at, by: 1 }) < 0} onClick={() => onChange(move({ columns, at, by: 1 }))} aria-label={`${t('columns.down', 'Move down') ?? 'Move down'}: ${nameOf(column.name)}`}>
                ↓
              </Button>
            </span>
          </li>
        ),
      )}
    </ul>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="max-sm:h-11">
            <LayoutColumns />
            <span className="hidden lg:inline">{t('columns.customize', 'Customize Columns') ?? 'Customize Columns'}</span>
            <span className="lg:hidden">{t('columns.title', 'Columns') ?? 'Columns'}</span>
            <ChevronDown />
          </Button>
        }
      />
      <PopoverContent align="end" className="flex max-h-[min(var(--available-height),28rem)] w-56 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">{t('columns.shown', 'Shown') ?? 'Shown'}</p>
          {section(true)}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">{t('columns.hidden', 'Not shown') ?? 'Not shown'}</p>
          {section(false)}
        </div>
      </PopoverContent>
    </Popover>
  )
}
