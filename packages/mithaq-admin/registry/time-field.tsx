// Adapted from openstatusHQ/time-picker (MIT, Copyright (c) 2024 OpenStatus): one shadcn Input per segment, digits
// typed two to a segment and arrows that step it. Its notice is in mithaq's LICENSES/openstatus-time-picker.txt.
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Translate } from 'mithaq-admin/copy.ts'

type Segment = 'hours' | 'minutes'
type Period = 'AM' | 'PM'

/** Whether a locale reads the time of day on a 12-hour clock, as `en` and `ar` do. */
const twelveHour = (locale: string) => ['h11', 'h12'].includes(new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric' }).resolvedOptions().hourCycle ?? '')

/**
 * A segment's digits in the locale's own numerals, `09` or `٠٩`. Arabic is asked for its Arabic-Indic digits by name,
 * since recent CLDR answers Latin ones for a bare `ar`.
 */
const shown = (value: string, locale: string) =>
  value === '' ? '' : new Intl.NumberFormat(locale || undefined, { minimumIntegerDigits: 2, useGrouping: false, ...(locale.split('-')[0] === 'ar' && { numberingSystem: 'arab' }) }).format(Number(value))

/** The locale's word for the morning or the evening: `AM` and `PM`, `ص` and `م`. */
const periodWord = (period: Period, locale: string) =>
  new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric', hourCycle: 'h12' }).formatToParts(new Date(2000, 0, 1, period === 'AM' ? 1 : 13)).find((part) => part.type === 'dayPeriod')?.value ?? period

/** Latin digits out of whatever was typed, Arabic-Indic and Persian included. */
const digitsOf = (text: string) => text.replace(/[٠-٩]/g, (one) => String(one.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (one) => String(one.charCodeAt(0) - 0x6f0)).replace(/\D/g, '')

/** A segment held to its range, as openstatus's `getValidNumber`: past the top is the top, under the floor the floor. */
const clamp = (value: number, { min, max }: { min: number; max: number }) => String(Math.min(max, Math.max(min, value))).padStart(2, '0')

/** One step of an arrow, wrapping round the segment's range, as openstatus's `getValidArrowNumber`. */
const stepped = (value: string, step: number, { min, max }: { min: number; max: number }) => {
  const next = value === '' ? (step > 0 ? min : max) : Number(value) + step
  return String(next > max ? min : next < min ? max : next).padStart(2, '0')
}

/** `HH:MM` on the 24-hour clock, the value a moment's time is written in, out of the segments. */
const toClock = ({ hours, minutes, period, twelve }: { hours: string; minutes: string; period: Period; twelve: boolean }) => {
  const hour = Number(hours)
  const day = twelve ? (hour % 12) + (period === 'PM' ? 12 : 0) : hour
  return `${String(day).padStart(2, '0')}:${minutes}`
}

/** The segments a `HH:MM` value is drawn in. */
const fromClock = (value: string, twelve: boolean): { hours: string; minutes: string; period: Period } => {
  const [hour = 0, minute = 0] = value.split(':').map(Number)
  return {
    hours: String(twelve ? hour % 12 || 12 : hour).padStart(2, '0'),
    minutes: String(minute).padStart(2, '0'),
    period: hour >= 12 ? 'PM' : 'AM',
  }
}

/**
 * The time of day of a moment, drawn the same in every browser in place of the native `<input type="time">`, which
 * Safari hands back empty: hours, minutes and, on a 12-hour clock, AM or PM, in the locale's numerals and words. It
 * reports `HH:MM` on the 24-hour clock once both segments hold a value, and `''` when a complete time is cleared;
 * a time half typed reports nothing.
 */
export function TimeField({ describedBy, disabled, error, form, id, label, locale, onChange, required, t, value }: {
  id: string
  /** `HH:MM` on the 24-hour clock, or `''`. */
  value: string
  onChange: (value: string) => void
  /** The field's label, which names each segment for a screen reader. */
  label: string
  locale: string
  t: Translate
  disabled?: boolean
  error?: boolean
  required?: boolean
  describedBy?: string
  form?: string
}): ReactElement {
  const twelve = twelveHour(locale)
  const [held, setHeld] = useState(() => (value ? fromClock(value, twelve) : { hours: '', minutes: '', period: 'AM' as Period }))
  // The value this field last reported, so one the form hands back is not drawn over what is being typed.
  const reported = useRef(value)
  useEffect(() => {
    if (value === reported.current) return
    reported.current = value
    setHeld(value ? fromClock(value, twelve) : { hours: '', minutes: '', period: held.period })
  }, [value, twelve])
  // The first digit of a box, waiting two seconds for its second, as openstatus's `flag` does.
  const pending = useRef<{ segment: Segment; at: number; first: string } | undefined>(undefined)
  const boxes = { hours: useRef<HTMLInputElement>(null), minutes: useRef<HTMLInputElement>(null), period: useRef<HTMLButtonElement>(null) }
  const ranges = { hours: twelve ? { min: 1, max: 12 } : { min: 0, max: 23 }, minutes: { min: 0, max: 59 } }
  // The time of day is the viewer's own clock, and a locale left empty is the runtime's, neither of which the server
  // knows, so it is drawn once mounted and the server's render and the first client render agree.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
  const drawn = mounted ? held : { hours: '', minutes: '', period: 'AM' as Period }

  const write = (next: typeof held) => {
    setHeld(next)
    const complete = next.hours !== '' && next.minutes !== ''
    const said = complete ? toClock({ ...next, twelve }) : ''
    // Half a time reports nothing, unless it was whole a moment ago: clearing a complete time clears the moment.
    if (said === reported.current || (!complete && reported.current === '')) return
    reported.current = said
    onChange(said)
  }
  const set = (segment: Segment, text: string) => write({ ...held, [segment]: text })
  const next = (segment: Segment | 'period') => (segment === 'hours' ? boxes.minutes : segment === 'minutes' ? boxes.period : undefined)?.current?.focus()
  const previous = (segment: Segment | 'period') => (segment === 'minutes' ? boxes.hours : segment === 'period' ? boxes.minutes : undefined)?.current?.focus()

  /**
   * A whole time pasted into the hours, `930`, `2130` or `9:30 PM`, fills both boxes: an hour past 12 is the evening on a
   * 12-hour clock, and a period it names wins.
   */
  const pasted = (text: string, digits: string) => {
    const at = digits.length - 2
    const hour = Number(digits.slice(0, at))
    const named = (['AM', 'PM'] as const).find((one) => text.toLowerCase().includes(one.toLowerCase()) || text.includes(periodWord(one, locale)))
    const period: Period = named ?? (hour === 0 ? 'AM' : hour >= 12 ? 'PM' : held.period)
    pending.current = undefined
    write({ period, hours: clamp(twelve ? hour % 12 || 12 : hour, ranges.hours), minutes: clamp(Number(digits.slice(at, at + 2)), ranges.minutes) })
    next('minutes')
  }

  /** Two digits fill a box and move on; one waits for a second, read as `0d` until it comes. */
  const typed = (segment: Segment, digits: string) => {
    if (!digits) return
    const waiting = pending.current?.segment === segment && Date.now() - pending.current.at < 2000 ? pending.current.first : undefined
    const pair = digits.length >= 2 ? digits.slice(-2) : waiting !== undefined ? waiting + digits : `0${digits}`
    // A digit no second can follow, 2 to 9 of a 12-hour clock's hour or 6 to 9 of the minutes, is the box whole,
    // as a native time box reads it; openstatus waits for a second there.
    const whole = digits.length >= 2 || waiting !== undefined || Number(digits) * 10 > ranges[segment].max
    pending.current = whole ? undefined : { segment, at: Date.now(), first: digits }
    // A twelve-hour clock has no hour 00: a lone 0 waits for the digit that makes it 01 to 09, and leaves the time as it was.
    if (!(segment === 'hours' && twelve && pair === '00' && !whole)) set(segment, clamp(Number(pair), ranges[segment]))
    if (whole) next(segment)
  }

  const keyed = (segment: Segment) => (event: KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowUp: 1, ArrowDown: -1 }[event.key]
    if (step) {
      event.preventDefault()
      pending.current = undefined
      return set(segment, stepped(held[segment], step, ranges[segment]))
    }
    // The boxes read left to right in every language, as a clock does, so the arrows follow the screen.
    if (event.key === 'ArrowRight') return (event.preventDefault(), next(segment))
    if (event.key === 'ArrowLeft') return (event.preventDefault(), previous(segment))
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      pending.current = undefined
      return set(segment, '')
    }
    const digit = digitsOf(event.key)
    if (event.key.length === 1 && digit) {
      event.preventDefault()
      typed(segment, digit)
    }
  }

  const aria = { 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required ? true : undefined }
  const box = (segment: Segment) => (
    <Input
      ref={boxes[segment]}
      id={segment === 'hours' ? id : `${id}-${segment}`}
      // A spin button a reader hears the value and range of; text, so the numerals typed may be Arabic.
      type="text"
      inputMode="numeric"
      role="spinbutton"
      aria-valuemin={ranges[segment].min}
      aria-valuemax={ranges[segment].max}
      aria-valuenow={drawn[segment] === '' ? undefined : Number(drawn[segment])}
      autoComplete="off"
      form={form}
      data-segment={segment}
      disabled={disabled}
      value={shown(drawn[segment], locale)}
      placeholder="--"
      aria-label={`${label} ${segment === 'hours' ? t('admin.hours', 'Hours') : t('admin.minutes', 'Minutes')}`}
      {...aria}
      className="w-12 text-center tabular-nums caret-transparent max-sm:h-11"
      onKeyDown={keyed(segment)}
      // What a keyboard that names no key types, as Android's does, and a paste arrive here.
      onChange={(event) => {
        const text = event.target.value
        const all = digitsOf(text)
        if (segment === 'hours' && all.length >= 3) return pasted(text, all)
        // A digit added after the box's own is typed on; anything else, a paste over it, is read whole.
        const own = digitsOf(shown(held[segment], locale))
        typed(segment, own && all.startsWith(own) ? all.slice(own.length) : all)
      }}
    />
  )
  const flip = () => write({ ...held, period: held.period === 'AM' ? 'PM' : 'AM' })
  return (
    <div role="group" data-time-field="" data-value={drawn.hours !== '' && drawn.minutes !== '' ? toClock({ ...drawn, twelve }) : ''} aria-label={`${label} ${t('admin.time', 'Time')}`} className="flex shrink-0 items-center gap-1">
      {/* The clock's own order, hours, minutes and AM or PM, in either direction of the page. */}
      <span dir="ltr" className="flex items-center gap-1">
        {box('hours')}
        <span aria-hidden="true">:</span>
        {box('minutes')}
        {twelve && mounted ? (
          <Button
            ref={boxes.period}
            type="button"
            variant="outline"
            data-segment="period"
            data-period={held.period}
            disabled={disabled}
            aria-label={`${label} ${t('admin.period', 'AM or PM')}: ${periodWord(held.period, locale)}`}
            {...aria}
            className="min-w-12 max-sm:h-11"
            onClick={flip}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') return (event.preventDefault(), flip())
              if (event.key === 'ArrowLeft') return (event.preventDefault(), previous('period'))
              const asked = (['AM', 'PM'] as const).find((one) => [one[0]!.toLowerCase(), periodWord(one, locale)[0]].includes(event.key.toLowerCase()))
              if (asked && asked !== held.period) write({ ...held, period: asked })
            }}
          >
            {periodWord(held.period, locale)}
          </Button>
        ) : null}
      </span>
    </div>
  )
}
