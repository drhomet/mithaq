import type { ReactElement } from 'react'
import type { ClientField, ClientKayan } from 'mithaq/admin'
import type { Translate } from './copy.ts'

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

/** A control, as the components map holds it. */
export type Control = (props: ControlProps) => ReactElement

/**
 * What a control reports a change through: a read-only control reports none, which still holds where a control is not a native input.
 */
export const changeOf = ({ onChange, readOnly }: ControlProps) => (value: unknown) => {
  if (!readOnly) onChange(value)
}

/** Text emptied back to nothing is `null`, which lets a form empty an optional field. */
export const cleared = (text: string) => (text === '' ? null : text)

/**
 * `aria-required` where the field's rules hold `required`, for whatever element of a control takes focus. The browser's `required` is not used, because its bubble is replaced by the form's own check.
 */
export const ariaRequired = (field: Pick<ControlProps['field'], 'rules'>): true | undefined => (field.rules.required === true ? true : undefined)

/**
 * The input group classes that make a combobox's box and its addon buttons 44 pixels on a phone, because the shadcn primitive sizes them at 36 and 24.
 */
export const comboboxPhone = 'max-sm:h-11 max-sm:[&_[data-slot=input-group-addon]]:py-0 max-sm:[&_[data-slot=input-group-button]]:size-11 max-sm:[&_[data-slot=combobox-clear]]:size-11 max-sm:[&_[data-slot=input-group-control]]:h-11'

/**
 * The one size every checkbox of a screen is drawn at, so a box in a list, a form and the column picker match.
 */
export const checkboxSize = 'size-4'
