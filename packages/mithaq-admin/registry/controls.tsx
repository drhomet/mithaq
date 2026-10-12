import { useState, useSyncExternalStore, type ChangeEvent, type ReactElement } from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import type { AccessReport, ClientField, ClientKayan } from 'mithaq/admin'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDirection } from '@/components/ui/direction'
import { ar, enUS } from 'react-day-picker/locale'
import { RelationshipControl } from './relationship-control.tsx'
import { RichTextControl } from './rich-text.tsx'
import { UploadControl } from './upload.tsx'

/**
 * How a string of copy is resolved. A project passes one function over its own committed copy files, whose keys are the flat `<scope>.<key>` space `mithaq generate messages` writes. A missing key degrades to `fallback`.
 */
export type Translate = (key: string, fallback?: string) => string | undefined

/** What every screen is handed to resolve copy with. */
export type Copy = {
  t: Translate
  locale: string
  /** Every locale the host reads in, which a localized field draws one box for. */
  locales?: readonly string[]
}

/**
 * A field's label: the record's string for the locale, else the project's copy under `<kayan>.<field>`, else the field name. A label written as a function crosses the projection as nothing, so the key is rebuilt from the two names.
 */
export const labelFor = ({ kayan, field, copy: { t, locale } }: { kayan: ClientKayan; field: ClientField; copy: Copy }): string =>
  (typeof field.label === 'object' ? field.label[locale] : undefined)
  ?? t(`${kayan.name}.${field.name}`, field.name)
  ?? field.name

/** The same chain for a field's description, which is optional everywhere. */
export const descriptionFor = ({ kayan, field, copy: { t, locale } }: { kayan: ClientKayan; field: ClientField; copy: Copy }): string | undefined =>
  (typeof field.description === 'object' ? field.description[locale] : undefined)
  ?? t(`${kayan.name}.${field.name}.description`)

/**
 * The same chain for a field's placeholder, the hint a text-like control shows while empty. A kind whose control has nowhere to draw a hint ignores it.
 */
export const placeholderFor = ({ kayan, field, copy: { t, locale } }: { kayan: ClientKayan; field: ClientField; copy: Copy }): string | undefined =>
  (typeof field.placeholder === 'object' ? field.placeholder[locale] : undefined)
  ?? t(`${kayan.name}.${field.name}.placeholder`)

/**
 * What a kayan is for, in one sentence, resolved like a field's description. `undefined` when the kayan declares none, so a heading is never repeated as its own subtitle.
 */
export const descriptionOf = (kayan: ClientKayan, { t, locale }: Copy): string | undefined =>
  (typeof kayan.description === 'object' ? kayan.description[locale] : undefined)
  ?? t(`${kayan.name}.description`)

/**
 * The words on a page's button for a kayan's operation: the page's label for the locale, else the project's copy under `<kayan>.operations.<name>`, else the operation's name.
 */
export const operationLabelFor = ({
  kayan,
  operation,
  copy: { t, locale },
}: {
  kayan: ClientKayan
  operation: { name: string; label?: Readonly<Record<string, string>> }
  copy: Copy
}): string =>
  (typeof operation.label === 'object' ? operation.label[locale] : undefined)
  ?? t(`${kayan.name}.operations.${operation.name}`, operation.name)
  ?? operation.name

/**
 * The words on one box of an operation's dialog, under `<kayan>.operations.<name>.<field>`, so an operation's field and a kayan's field can share a name and never a key.
 */
export const operationFieldLabelFor = ({
  kayan,
  operation,
  field,
  copy: { t, locale },
}: {
  kayan: ClientKayan
  operation: { name: string }
  field: ClientField
  copy: Copy
}): string =>
  (typeof field.label === 'object' ? field.label[locale] : undefined)
  ?? t(`${kayan.name}.operations.${operation.name}.${field.name}`, field.name)
  ?? field.name

/**
 * What a kayan is called: the `singular` or `plural` key of its copy scope, else its name. Takes the name alone, so a shell that hands its browser only a kayan's name can still name it.
 */
export const titleOf = ({ kayan, copy: { t }, many = false }: { kayan: Pick<ClientKayan, 'name'>; copy: Copy; many?: boolean }): string =>
  t(`${kayan.name}.${many ? 'plural' : 'singular'}`, kayan.name) ?? kayan.name

/**
 * What a create page is titled: the kayan's `new` key, else "Create {kind}" with its singular.
 */
export const newTitleOf = ({ kayan, copy }: { kayan: Pick<ClientKayan, 'name'>; copy: Copy }): string =>
  copy.t(`${kayan.name}.new`) ?? (copy.t('admin.createTitle', 'Create {kind}') ?? 'Create {kind}').replace('{kind}', () => titleOf({ kayan, copy }))

/**
 * Several values as one phrase in the viewer's own language, by `Intl.ListFormat`. The type is `unit`, so English joins with commas alone and Arabic with its own conjunction.
 */
export const listed = (values: readonly string[], locale: string) => new Intl.ListFormat(locale, { type: 'unit' }).format(values)

/**
 * What a cell draws for a value nobody set: a dash hidden from screen readers, since a cell read as nothing says the same.
 */
export const noValue = <span aria-hidden="true">—</span>

/**
 * A sentence that counts, in the plural form the locale takes for that count: `key` plus `_one`, `_two`, `_few`, `_many` or `_other` as `Intl.PluralRules` names it, falling back to `_other`. `{count}` is the number in the locale's digits.
 */
export const counted = ({ t, locale, key, count, fallback }: { t: Translate; locale: string; key: string; count: number; fallback: string }): string =>
  (t(`${key}_${new Intl.PluralRules(locale || undefined).select(count)}`) ?? t(`${key}_other`, fallback) ?? fallback).replace('{count}', () => count.toLocaleString(locale || undefined))

/**
 * A moment, or a calendar day where `day` is set, in the one format every cell draws it in for this locale; `undefined` for anything that is not a date. A day is drawn in UTC, so a `yyyy-mm-dd` string never reads as the day before west of Greenwich. The time of day is on the 24-hour clock.
 */
export const formatDate = ({ value, locale, day = false }: { value: unknown; locale: string; day?: boolean }): string | undefined => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined
  if (!date || Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(locale || undefined, day ? { dateStyle: 'long', timeZone: 'UTC' } : { dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23' }).format(date)
}

/**
 * The key a refusal carries, as `data: { key, params }`, which a client resolves against its own copy. Anything that is not a refusal carries no key.
 */
export const refusalKeyOf = (error: unknown): string | undefined => {
  const key = (error as { data?: { key?: unknown } } | null | undefined)?.data?.key
  return typeof key === 'string' ? key : undefined
}

/**
 * Which locales of each localized field a refusal names, off the issue paths: `title.ar` names the Arabic box of `title`. A path of one segment names no locale.
 */
export const localesOf = (error: unknown): Readonly<Record<string, readonly string[]>> => {
  const issues = (error as { data?: { params?: { issues?: unknown } } } | null | undefined)?.data?.params?.issues
  const byField: Record<string, string[]> = Object.create(null)
  if (!Array.isArray(issues)) return byField
  for (const issue of issues as readonly { path?: unknown }[]) {
    const [name, locale] = typeof issue?.path === 'string' ? issue.path.split('.') : []
    if (name && locale) (byField[name] ??= []).push(locale)
  }
  return byField
}

/**
 * One page, as much of the managed reader's answer as a control reads. Every list `Page` is assignable to it.
 */
export type FoundPage = {
  docs: readonly Record<string, unknown>[]
  hasNextPage: boolean
  nextPage: number | null
}

/**
 * The typed client, as much of it as a control reads: one kayan's `find`, looked up by the kayan's name. An app hands an adapter over its own client, because a control builds its argument as a record and no typing survives that boundary.
 */
export type FindApi = Readonly<
  Record<
    string,
    | {
        find: (input: Record<string, unknown>) => Promise<FoundPage>
      }
    | undefined
  >
>

/**
 * What every control is handed. A control is controlled over one value and holds no form state; the shell draws its label, description and refusal. It gets no `path`, `validate` or `locale`: the server validates, a field's name is its path, and `t` closes over the locale.
 */
export type ControlProps = {
  value: unknown
  /** Current values of the form that owns this control. */
  values: Readonly<Record<string, unknown>>
  /** Write another field through the same form, subject to its write access. */
  setValue: (name: string, value: unknown) => void
  /**
   * What the control reports a change through. A value cleared back to nothing is `null`, not left out, which lets a form empty an optional field.
   */
  onChange: (value: unknown) => void
  field: ClientField
  kayan: ClientKayan
  /** Every kayan of the build, so a relationship control can find its target by `field.relationTo`. */
  client?: readonly ClientKayan[]
  readOnly: boolean
  /** A refusal for this field, already resolved through the project's copy. */
  error?: string
  /**
   * The hint an empty control shows, already resolved through the project's copy. A control drawn for something other than a row of this kayan, such as the filter panel's value box, gets none.
   */
  placeholder?: string
  t: Translate
  /** The `id` the label points at, unique within the form. */
  id: string
  /**
   * The id of the `<form>` this control saves through, named as a native box's `form` attribute: a leaf outside the form element saves on Enter only through it. A control drawn for no row gets none.
   */
  form?: string
  /** The typed client, for a control that reads a second kayan. */
  api?: FindApi
  /**
   * The ids of the field's description and refusal, for the control's own `aria-describedby`, which belongs on the focusable element the control renders.
   */
  describedBy?: string
  /**
   * The viewer's locale, for the words a control reads off the projection rather than through `t`: an option's label and a relationship's title.
   */
  locale?: string
  /**
   * Every locale the host reads in, for a control that asks a localized field of its own, one box per locale.
   */
  locales?: readonly string[]
}



/**
 * What a control reports a change through: a read-only control reports none, which still holds where a control is not a native input.
 */
export const changeOf = ({ onChange, readOnly }: ControlProps) => (value: unknown) => {
  if (!readOnly) onChange(value)
}

const sliderKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/**
 * A value as an input's text; a missing value is empty. A `Date` is its ISO string, because the fetch plug does not read `String(date)` back as a date. An invalid `Date`, which has no ISO string, is drawn as `String` does.
 */
export const asText = (value: unknown) =>
  value === null || value === undefined ? '' : value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : String(value)

const cleared = (text: string) => (text === '' ? null : text)

/**
 * A moment as the `yyyy-mm-ddThh:mm` of the reader's own wall clock. It is shifted by the reader's offset before it is sliced, because `toISOString` alone would draw a London evening as the next morning in Riyadh.
 */
export const asMoment = (value: unknown) => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : undefined
  if (!date || Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const typed = (
  type: string,
  format: (value: unknown) => string = asText,
  parse: (text: string) => unknown = cleared,
) =>
  function TypedControl(props: ControlProps): ReactElement {
    const { describedBy, error, field, form, id, locale, placeholder, readOnly, value } = props
    const change = changeOf(props)
    const input = {
      id,
      form,
      name: field.name,
      type,
      className: 'max-sm:h-11',
      dir: type === 'text' && field.kind !== 'decimal' ? 'auto' : 'ltr',
      step: field.kind === 'integer' ? '1' : undefined,
      inputMode: field.kind === 'decimal' ? ('decimal' as const) : undefined,
      value: format(value),
      onChange: (event: ChangeEvent<HTMLInputElement>) => change(parse(event.target.value)),
      disabled: readOnly,
      readOnly,
      placeholder,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      'aria-required': ariaRequired(field),
    }
    const prefix = locale ? field.prefix?.[locale] : undefined
    const suffix = locale ? field.suffix?.[locale] : undefined
    if (prefix === undefined && suffix === undefined) return <Input {...input} />
    return (
      <InputGroup className="max-sm:h-11">
        {prefix !== undefined ? <InputGroupAddon data-affix="prefix" className={`${affix} rounded-s-[inherit] border-e`}><InputGroupText className="text-foreground">{prefix}</InputGroupText></InputGroupAddon> : null}
        <InputGroupInput {...input} />
        {suffix !== undefined ? <InputGroupAddon data-affix="suffix" align="inline-end" className={`${affix} rounded-e-[inherit] border-s`}><InputGroupText className="text-foreground">{suffix}</InputGroupText></InputGroupAddon> : null}
      </InputGroup>
    )
  }

/**
 * The input group classes that make a combobox's box and its addon buttons 44 pixels on a phone, because the shadcn primitive sizes them at 36 and 24.
 */
export const comboboxPhone = 'max-sm:h-11 max-sm:[&_[data-slot=input-group-addon]]:py-0 max-sm:[&_[data-slot=input-group-button]]:size-11 max-sm:[&_[data-slot=combobox-clear]]:size-11 max-sm:[&_[data-slot=input-group-control]]:h-11'

/**
 * The one size every checkbox of a screen is drawn at, so a box in a list, a form and the column picker match.
 */
export const checkboxSize = 'size-4'

const affix = 'bg-muted border-input self-stretch px-3'

/**
 * A `uuid` is always the store's to make, so this reports no change whatever `readOnly` says.
 */
function ReadOnlyControl({ describedBy, field, id, value }: ControlProps): ReactElement {
  return (
    <Input
      id={id}
      name={field.name}
      type="text"
      value={asText(value)}
      readOnly
      disabled
      aria-describedby={describedBy}
    />
  )
}

const dayPickerLocales: Record<string, typeof enUS> = { ar, en: enUS }

/**
 * `aria-required` where the field's rules hold `required`, for whatever element of a control takes focus. The browser's `required` is not used, because its bubble is replaced by the form's own check.
 */
export const ariaRequired = (field: Pick<ControlProps['field'], 'rules'>): true | undefined => (field.rules.required === true ? true : undefined)

function SelectControl(props: ControlProps): ReactElement {
  const options = props.field.options ?? []
  return <Select value={typeof props.value === 'string' ? props.value : null} onValueChange={changeOf(props)} disabled={props.readOnly}>
    <SelectTrigger id={props.id} className="w-full max-sm:data-[size=default]:h-11" aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)}><SelectValue>{options.find((one) => one.value === props.value)?.label[props.locale ?? ''] ?? props.placeholder ?? ''}</SelectValue></SelectTrigger>
    <SelectContent>{options.map((one) => <SelectItem key={one.value} value={one.value}>{one.label[props.locale ?? ''] ?? one.value}</SelectItem>)}</SelectContent>
  </Select>
}

const dayOf = (value: unknown): Date | undefined => {
  const [year, month, day] = typeof value === 'string' ? value.split('-').map(Number) : []
  return year && month && day ? new Date(year, month - 1, day) : undefined
}
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function DatePicker(props: ControlProps): ReactElement {
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

/** One control per shipped kind, keyed by the kind's own name. */
export const controls: Record<string, (props: ControlProps) => ReactElement> = {
  combobox: function ComboboxControl(props: ControlProps): ReactElement {
    const options = props.field.options ?? []
    const label = (value: string) => options.find((one) => one.value === value)?.label[props.locale ?? ''] ?? value
    return <Combobox items={options.map((one) => one.value)} value={typeof props.value === 'string' ? props.value : null} onValueChange={changeOf(props)} itemToStringLabel={label} disabled={props.readOnly}>
      <ComboboxInput id={props.id} className={comboboxPhone} placeholder={props.placeholder} clearLabel={props.t('admin.clear', 'Clear')} triggerLabel={props.t('admin.open', 'Open')} aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)} />
      <ComboboxContent><ComboboxList>{options.map((one) => <ComboboxItem key={one.value} value={one.value}>{label(one.value)}</ComboboxItem>)}</ComboboxList></ComboboxContent>
    </Combobox>
  },
  otp: function OtpControl(props: ControlProps): ReactElement {
    const length = typeof props.field.rules.maxLength === 'number' ? props.field.rules.maxLength : 6
    return <InputOTP id={props.id} value={asText(props.value)} onChange={changeOf(props)} maxLength={length} pattern={REGEXP_ONLY_DIGITS} disabled={props.readOnly} aria-describedby={props.describedBy}>
      <InputOTPGroup>{Array.from({ length }, (_, index) => <InputOTPSlot key={index} index={index} />)}</InputOTPGroup>
    </InputOTP>
  },
  slider: function SliderControl(props: ControlProps): ReactElement {
    const min = typeof props.field.rules.min === 'number' ? props.field.rules.min : 0
    const max = typeof props.field.rules.max === 'number' ? props.field.rules.max : 100
    // Unset is drawn with no thumb or fill, not as `min`. The slider reports no change for a value it already holds,
    // so the first press or key reports `min` itself, before the slider moves on.
    const held = typeof props.value === 'number'
    const change = changeOf(props)
    const first = held ? undefined : () => change(min)
    return <Slider
      value={held ? props.value as number : min}
      data-empty={held ? undefined : ''}
      className={held ? undefined : '**:data-[slot=slider-range]:opacity-0 **:data-[slot=slider-thumb]:not-has-focus-visible:opacity-0'}
      getAriaValueText={held ? undefined : () => props.t('admin.unset', 'unset') ?? 'unset'}
      onPointerDownCapture={first}
      onKeyDownCapture={first && ((event) => { if (sliderKeys.has(event.key)) first() })}
      min={min}
      max={max}
      onValueChange={change}
      disabled={props.readOnly}
      aria-label={labelFor({ kayan: props.kayan, field: props.field, copy: { t: props.t, locale: props.locale ?? '' } })}
      aria-describedby={props.describedBy}
    />
  },
  // `nativeSelect` draws the same shadcn select, so two boxes over one kind of choice never differ in their border.
  nativeSelect: SelectControl,
  select: SelectControl,
  toggleGroup: function ToggleGroupControl(props: ControlProps): ReactElement {
    return <ToggleGroup value={typeof props.value === 'string' ? [props.value] : []} onValueChange={(next) => changeOf(props)(next[0] ?? null)} disabled={props.readOnly} aria-describedby={props.describedBy} className="flex gap-1">
      {props.field.options?.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label[props.locale ?? ''] ?? option.value}</ToggleGroupItem>)}
    </ToggleGroup>
  },
  radio: function RadioControl(props: ControlProps): ReactElement {
    return <RadioGroup name={props.field.name} value={typeof props.value === 'string' ? props.value : ''} onValueChange={changeOf(props)} disabled={props.readOnly} aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)} className="grid gap-2">
      {props.field.options?.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm">
        <RadioGroupItem value={option.value} />{option.label[props.locale ?? ''] ?? option.value}
      </label>)}
    </RadioGroup>
  },
  switch: function SwitchControl(props: ControlProps): ReactElement {
    return <Switch id={props.id} name={props.field.name} checked={props.value === true} onCheckedChange={changeOf(props)} disabled={props.readOnly} aria-describedby={props.describedBy} aria-required={ariaRequired(props.field)} />
  },
  text: typed('text'),
  email: typed('email'),
  // The write shape is `z.number()` with no coercion, so a reported string is a 400. `NaN` is reported as `undefined`,
  // which `valuesOf` leaves out of the write, rather than as a value that would clear the column.
  number: typed('number', asText, (text) => {
    if (text === '') return null
    const parsed = Number(text)
    return Number.isNaN(parsed) ? undefined : parsed
  }),
  integer: (props) => controls.number!(props),
  // A text box keeps every digit; a number box reads through a JS double and cannot edit exact money.
  decimal: typed('text'),
  datetime: DatePicker,
  // A calendar day reports the `yyyy-mm-dd` the column holds and never goes through a moment, which would move the day.
  date: DatePicker,
  checkbox: function CheckboxControl(props: ControlProps): ReactElement {
    const { describedBy, field, id, readOnly, value } = props
    const change = changeOf(props)
    // `=== true` because the checked state is `boolean | 'indeterminate'` and only a boolean is a value this column takes.
    return (
      <Checkbox
        id={id}
        name={field.name}
        checked={value === true}
        onCheckedChange={(next) => change(next === true)}
        className={checkboxSize}
        disabled={readOnly}
        aria-describedby={describedBy}
        aria-required={ariaRequired(field)}
      />
    )
  },
  textArray: function TextArrayControl(props: ControlProps): ReactElement {
    const { describedBy, error, field, id, placeholder, readOnly, value } = props
    const change = changeOf(props)
    return (
      <Textarea
        id={id}
        name={field.name}
        rows={3}
        placeholder={placeholder}
        dir="auto"
        value={Array.isArray(value) ? value.map(asText).join('\n') : asText(value)}
        onChange={(event) => {
          const lines = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean)
          change(lines.length ? lines : null)
        }}
        disabled={readOnly}
        readOnly={readOnly}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-required={ariaRequired(field)}
      />
    )
  },
  uuid: ReadOnlyControl,
  relationship: RelationshipControl,
  upload: UploadControl,
  richText: RichTextControl,
  textarea: function TextareaControl(props: ControlProps): ReactElement {
    const { describedBy, error, field, id, placeholder, readOnly, value } = props
    const change = changeOf(props)
    return <Textarea id={id} name={field.name} rows={4} dir="auto" value={asText(value)} onChange={(event) => change(cleared(event.target.value))} disabled={readOnly} readOnly={readOnly} placeholder={placeholder} aria-describedby={describedBy} aria-invalid={error ? true : undefined} aria-required={ariaRequired(field)} />
  },
  toggle: function ToggleControl(props: ControlProps): ReactElement {
    return <Toggle id={props.id} variant="outline" pressed={props.value === true} onPressedChange={(pressed) => changeOf(props)(pressed)} disabled={props.readOnly} aria-describedby={props.describedBy}>
      {labelFor({ kayan: props.kayan, field: props.field, copy: { t: props.t, locale: props.locale ?? '' } })}
    </Toggle>
  },
  buttonGroup: function ButtonGroupControl(props: ControlProps): ReactElement {
    return <ButtonGroup aria-describedby={props.describedBy}>
      {props.field.options?.map((option) => <Button key={option.value} type="button" variant={props.value === option.value ? 'default' : 'outline'} aria-pressed={props.value === option.value} disabled={props.readOnly} onClick={() => changeOf(props)(option.value)}>
        {option.label[props.locale ?? ''] ?? option.value}
      </Button>)}
    </ButtonGroup>
  },
  checkboxGroup: function CheckboxGroupControl(props: ControlProps): ReactElement {
    const options = props.field.options ?? []
    const held = new Set(Array.isArray(props.value) ? props.value.map(String) : [])
    const change = changeOf(props)
    return <div role="group" id={props.id} aria-describedby={props.describedBy} className="grid gap-2">
      {options.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm">
        <Checkbox className={checkboxSize} checked={held.has(option.value)} disabled={props.readOnly} onCheckedChange={(on) => {
          const next = options.map((one) => one.value).filter((value) => (value === option.value ? on === true : held.has(value)))
          change(next.length ? next : null)
        }} />
        {option.label[props.locale ?? ''] ?? option.value}
      </label>)}
    </div>
  },
  calendar: function CalendarControl(props: ControlProps): ReactElement {
    const held = dayOf(props.value)
    return <Calendar mode="single" locale={dayPickerLocales[props.locale ?? '']} selected={held} defaultMonth={held} disabled={props.readOnly} onSelect={(date: Date | undefined) => changeOf(props)(date ? isoDay(date) : null)} aria-describedby={props.describedBy} />
  },
}
// No prototype: a field's `component` is a string off the projection, and a plain object would answer `constructor` or
// `toString` with a function that is not a control.
Object.setPrototypeOf(controls, null)

/**
 * Whether a control's label sits beside it rather than above: a checkbox or a switch reads as attached to its words.
 */
export const besideLabel = (Control: unknown) => Control === controls.checkbox || Control === controls.switch

/**
 * The control for a field: the one its screen decided, else the kind's own, else a read-only fallback. A name the registry does not carry falls through to the next step.
 */
export const controlFor = (field: ClientField): ((props: ControlProps) => ReactElement) =>
  controls[field.component] ?? controls[field.kind] ?? ReadOnlyControl

/**
 * Whether a field is the server's to fill on this operation: a `uuid`, or a field that names a provider other than the client for it. Restates the server's `providerOf` rather than importing it, because this file is copied into a browser bundle that imports nothing from `mithaq` at runtime.
 */
export const readOnlyField = (field: ClientField, on: 'create' | 'update'): boolean =>
  field.kind === 'uuid'
  || ((field.rules?.providedBy as { create?: string; update?: string } | undefined)?.[on] ?? 'client') !== 'client'

/**
 * Whether the report lets this actor create a row of a kayan with something to write: the create, and at least one client-provided field they may set. A role that may set only server-filled fields meets no New.
 */
export const createsIn = ({ kayan, report }: { kayan: ClientKayan; report: NonNullable<AccessReport['collections']>[string] }): boolean =>
  report?.create === true && kayan.fields.some((field) => !readOnlyField(field, 'create') && report.fields?.[field.name]?.create === true)

/**
 * Whether a read was refused by the viewer's access (a 403) rather than failed, so a cell says the viewer cannot see a row for the first and never for a 500 or a network failure.
 */
export const isForbidden = (thrown: unknown): boolean =>
  (thrown as { status?: unknown } | null | undefined)?.status === 403 || refusalKeyOf(thrown)?.startsWith('error.forbidden') === true

/**
 * What a form starts holding: the row's values, one key per field, so a control is controlled from its first render. A field the row does not carry starts `undefined` and stays out of the write until something sets it.
 */
export const seedOf = (fields: readonly ClientField[], value?: Record<string, unknown> | null): Record<string, unknown> =>
  Object.fromEntries(
    fields.map((field) => [
      field.name,
      // On a create a checkbox starts `false` and a required text list `[]`, as drawn; an update leaves a missing key
      // unseeded, since it is a column this actor may not read and seeding it would overwrite the row.
      field.kind === 'datetime' && typeof value?.[field.name] === 'string' && !Number.isNaN(new Date(value[field.name] as string).getTime())
        ? new Date(value[field.name] as string)
        : value?.[field.name] ?? (value ? undefined : field.kind === 'checkbox' ? false : field.kind === 'textArray' && field.rules.required === true ? [] : undefined),
    ]),
  )

/**
 * Every field of `fields` the caller may write, as the object an operation takes. `owned` is the form's own answer for who provides a field, handed in so the fields drawn disabled and the fields left out of the write cannot drift apart.
 */
export const valuesOf = ({
  fields,
  values,
  owned,
}: {
  fields: readonly ClientField[]
  values: Record<string, unknown>
  owned: (field: ClientField) => boolean
}): Record<string, unknown> => {
  const written: Record<string, unknown> = {}
  for (const field of fields) {
    if (owned(field)) continue
    if (values[field.name] !== undefined) written[field.name] = values[field.name]
  }
  return written
}
