import { useState, useSyncExternalStore, type ReactElement } from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import { ar, enUS } from 'react-day-picker/locale'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { useDirection } from '@/components/ui/direction'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ariaRequired, changeOf, type ControlProps } from './control-props.ts'
import { labelFor } from './copy.ts'
import { asMoment, formatDate } from './format.tsx'

const dayPickerLocales: Record<string, typeof enUS> = { ar, en: enUS }

const dayOf = (value: unknown): Date | undefined => {
  const [year, month, day] = typeof value === 'string' ? value.split('-').map(Number) : []
  return year && month && day ? new Date(year, month - 1, day) : undefined
}
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function DatePicker(props: ControlProps): ReactElement {
  const { describedBy, error, field, form, id, locale = '', placeholder, readOnly, t, value } = props
  const change = changeOf(props)
  const dir = useDirection()
  const [open, setOpen] = useState(false)
  const moment = field.kind === 'datetime'
  const clock = asMoment(value)
  const time = clock.slice(11)
  // A moment is held only when both its day and its time are set: a day picked before any time is typed stays here and writes nothing.
  const [picked, setPicked] = useState<Date | undefined>()
  // False only while hydrating, so the server and the first client render agree on a moment's day (UTC); the viewer's own day follows once mounted.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
  const held = moment ? (clock ? new Date(clock) : picked) : dayOf(value)
  const at = (day: Date, text: string) => {
    const [hours = 0, minutes = 0] = text.split(':').map(Number)
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
  }
  const label = labelFor({ kayan: props.kayan, field, copy: { t, locale } })
  const shown = held
    ? (moment && clock && !mounted ? formatDate({ value, locale, day: true }) : undefined) ?? new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'long' }).format(held)
    : placeholder ?? t('admin.pickDate', 'Pick a date')
  return (
    // Wraps, so a phone puts the time under the day.
    <div className="flex flex-wrap gap-2">
      <span id={`${id}-name`} className="sr-only">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          disabled={readOnly}
          // The label's `htmlFor` leaves out the day the button shows, so the name is built from both texts on the page.
          aria-labelledby={`${id}-name ${id}-day`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={ariaRequired(field)}
          render={<Button type="button" variant="outline" className="min-w-32 flex-1 justify-start font-normal max-sm:h-11" />}
        >
          <CalendarIcon aria-hidden="true" />
          <span id={`${id}-day`} className={held ? 'truncate' : 'text-muted-foreground truncate'}>{shown}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            autoFocus
            dir={dir}
            locale={dayPickerLocales[locale]}
            selected={held}
            defaultMonth={held}
            onSelect={(day: Date | undefined) => {
              setPicked(time ? undefined : day)
              if (!moment) change(day ? isoDay(day) : null)
              else if (!day) clock && change(null)
              else if (time) change(at(day, time))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {moment ? (
        <Input
          type="time"
          form={form}
          dir="ltr"
          className="w-28 shrink-0 max-sm:h-11"
          value={time}
          disabled={readOnly || !held}
          readOnly={readOnly}
          aria-label={`${label} ${t('admin.time', 'Time')}`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={ariaRequired(field)}
          onChange={(event) => {
            const text = event.target.value
            // A time no clock reads is reported as nothing to write, not as a value that would clear the column.
            if (text !== '' && !/^\d{2}:\d{2}/.test(text)) return change(undefined)
            // Clearing the time clears the value and never writes midnight; the day stays on the button.
            if (text === '' || !held) return (setPicked(held), change(null))
            setPicked(undefined)
            change(at(held, text))
          }}
        />
      ) : null}
    </div>
  )
}

export function CalendarControl(props: ControlProps): ReactElement {
  const held = dayOf(props.value)
  return <Calendar mode="single" locale={dayPickerLocales[props.locale ?? '']} selected={held} defaultMonth={held} disabled={props.readOnly} onSelect={(date: Date | undefined) => changeOf(props)(date ? isoDay(date) : null)} aria-describedby={props.describedBy} />
}
