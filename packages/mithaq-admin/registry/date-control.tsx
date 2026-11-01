import { useState, useSyncExternalStore, type ReactElement } from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import { ar, enUS } from 'react-day-picker/locale'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { useDirection } from '@/components/ui/direction'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ariaRequired, changeOf, type ControlProps } from 'mithaq-admin/control-props.ts'
import { labelFor } from 'mithaq-admin/copy.ts'
import { asMoment } from 'mithaq-admin/format.tsx'
import { TimeField } from 'mithaq-admin/time-field.tsx'

const dayPickerLocales: Record<string, typeof enUS> = { ar, en: enUS }
// Arabic short names can exceed the 32px desktop columns; initials keep them apart.
const arabicWeekdays = { formatWeekdayName: (date: Date) => ar.localize.day(date.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6, { width: 'narrow' }) }

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
  // ICU punctuation differs across runtimes even in UTC; only the mounted viewer formats the date.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
  const held = moment ? (clock ? new Date(clock) : picked) : dayOf(value)
  const at = (day: Date, text: string) => {
    const [hours = 0, minutes = 0] = text.split(':').map(Number)
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
  }
  const label = labelFor({ kayan: props.kayan, field, copy: { t, locale } })
  const shown = held
    ? !mounted ? <span aria-hidden="true" className="inline-block h-[1lh] w-40" />
      : new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'long' }).format(held)
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
          render={<Button type="button" variant="outline" className="min-w-32 flex-1 justify-start font-normal min-h-11 sm:min-h-0" />}
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
            formatters={locale === 'ar' ? arabicWeekdays : undefined}
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
        <TimeField
          id={`${id}-time`}
          form={form}
          value={time}
          label={label}
          locale={locale}
          t={t}
          disabled={readOnly || !held}
          describedBy={describedBy}
          error={!!error}
          required={ariaRequired(field)}
          onChange={(text) => {
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
  return <Calendar mode="single" locale={dayPickerLocales[props.locale ?? '']} formatters={props.locale === 'ar' ? arabicWeekdays : undefined} selected={held} defaultMonth={held} disabled={props.readOnly} onSelect={(date: Date | undefined) => changeOf(props)(date ? isoDay(date) : null)} aria-describedby={props.describedBy} />
}
