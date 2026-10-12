import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { useField, useForm, useStore, type AnyFormApi } from '@tanstack/react-form'
import { Check } from 'lucide-react'
import { compareDecimals, decimalDigits, isDecimal, type ClientField, type ClientKayan, type LeafClient, type Row } from 'mithaq/admin'
import { FormContext, ScreenContext } from 'mithaq/admin/react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cellFor } from './cells.tsx'
import { RichTextValueView } from './rich-text.tsx'
import { UploadValue } from './upload.tsx'
import { useRelationshipTitles } from './relationship-cell.tsx'
import {
  besideLabel,
  controlFor,
  counted,
  descriptionFor,
  descriptionOf,
  labelFor,
  listed,
  localesOf,
  operationFieldLabelFor,
  operationLabelFor,
  placeholderFor,
  readOnlyField,
  refusalKeyOf,
  seedOf,
  titleOf,
  valuesOf,
  type Copy,
  type FindApi,
  type Translate,
} from './controls.tsx'
import { FieldShell, describedBy } from './field-shell.tsx'
import { BulkChoice, LeafControl, NavLinks, NodeButton, OwnButton, initialFocusIn, rowWarning, drawNodes, drawsKind, frameOf, leavesOf, nodesOf, pageButtonOf, pageOf, refOf, scopeOf, type Draw, type Node, type PageButton, type ScreenPage } from './nodes.tsx'

/**
 * The three operations this screen drives, typed structurally so a typed oRPC client, an in-process
 * router client or a plain object fits.
 */
export type FormClient = {
  create: (input: Record<string, unknown>, options?: DraftOptions) => Promise<unknown>
  update: (input: Record<string, unknown>, options?: DraftOptions) => Promise<unknown>
  delete: (input: Record<string, unknown>) => Promise<unknown>
  /** A kayan's own operation, by name, for a page button that asks for one. A host that hands none draws no such button. */
  run?: (operation: string, input: Record<string, unknown>) => Promise<unknown>
  /** The plain read of one row; on a kayan that keeps drafts, the published copy. A host that hands none draws no draft switch. */
  findByID?: (input: Record<string, unknown>) => Promise<unknown>
}

/** What a write asks beside its input on a kayan that keeps drafts: a draft save, and an autosave beside it. */
export type DraftOptions = { readonly draft?: boolean; readonly autosave?: boolean }

/** Where a row of a kayan that keeps drafts stands: never published, published, or published with a newer draft pending. */
export type DraftStatus = 'draft' | 'published' | 'changed'

const afterDraft = (status?: DraftStatus): DraftStatus => (status === 'published' || status === 'changed' ? 'changed' : 'draft')

const pills: Record<DraftStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  changed: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

const publishColour = 'bg-emerald-700 text-white hover:bg-emerald-700/90 focus-visible:border-emerald-600 focus-visible:ring-emerald-600/40 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-500/90 dark:focus-visible:ring-emerald-500/40'
const draftColour = 'border-transparent bg-amber-500 text-amber-950 hover:bg-amber-500/90 hover:text-amber-950 focus-visible:border-amber-600 focus-visible:ring-amber-500/50 dark:bg-amber-400 dark:hover:bg-amber-400/90'

export type FormProps = {
  kayan: ClientKayan
  client: FormClient
  /** The row being edited, or nothing for a row being written. */
  value?: Record<string, unknown> | null
  t: Translate
  locale: string
  /** Which locales exist, from the host: a localized field draws one box for each. */
  locales?: readonly string[]
  /**
   * What the host does once a write lands. The second argument is the effect that ran (`create`,
   * `update` or `delete`), which decides where the host lands.
   */
  onDone: (row: unknown, effect?: string) => void
  /** Where Cancel goes. A host that hands none gets no Cancel button. */
  onCancel?: () => void
  /** A refusal the host already caught, for a host that writes on its own path too. */
  error?: unknown
  /** Every kayan of the build, so a relationship control can find its target. */
  kayans?: readonly ClientKayan[]
  /** The typed client's reads, for a control that pages a second kayan. */
  api?: FindApi
  /**
   * Whether this actor may write one field on the operation being rendered. Chrome only: the server
   * authorizes the write whatever this says. Undeclared is allowed.
   */
  writes?: (field: string, on: 'create' | 'update') => boolean
  /**
   * This actor's answer per operation name. A button for a kayan's own operation reads its own name
   * here, never its effect's. Chrome only; an absent key is denied.
   */
  operations?: Readonly<Record<string, boolean>>
  /**
   * Whether this form holds a change nobody saved, reported each time the answer changes, so the
   * host's router can block a navigation away.
   */
  onDirty?: (dirty: boolean) => void
  /**
   * A navigation the host's router held back while this form reported a change. The form asks the
   * discard question itself so the autosave is held while it asks: `proceed` lets the navigation go,
   * `reset` keeps the person here.
   */
  blocked?: { proceed: () => void; reset: () => void }
  /** A screen's page, where this form draws one: its regions go to the page's layout and nothing the page does not name is drawn. */
  screen?: ScreenPage
  /** What the host draws a list node on this page with. A host that hands none draws no list. */
  related?: Draw['list']
  /** The nodes this form draws in place of a page, as one form node and no shell. They win over `screen`'s page. */
  nodes?: readonly Node[]
  /**
   * The kayan keeps drafts and this actor holds its `findVersions`: the form offers Save draft and
   * Publish changes in place of Save, and autosaves a draft after `autosave` ms of stillness.
   * A host that hands none keeps the plain Save.
   */
  drafts?: { status?: DraftStatus; autosave?: number }
  /**
   * The kayan's update takes `expectedUpdatedAt`: an update sends the `updatedAt` this form last read
   * or wrote, so a save over a newer one from another tab is refused 409. On a kayan that keeps
   * drafts it is the latest version's, and an autosave sends it too.
   */
  expectedUpdatedAt?: boolean
  /**
   * The kayan's other operations that take `expectedUpdatedAt`, of `delete` and `restoreVersion`, so
   * a newer draft another person saved is kept.
   */
  expectedUpdatedAtOn?: readonly string[]
}

/**
 * Which fields a schema refusal names, and what it says about each, keyed by the first segment of
 * the issue's path (the field the form drew a control for).
 */
export const issuesOf = (error: unknown): Readonly<Record<string, string>> => {
  const issues = (error as { data?: { params?: { issues?: unknown } } } | null | undefined)?.data?.params?.issues
  // No prototype, so a field named `toString` has no issue it was never given.
  const byField: Record<string, string> = Object.create(null)
  if (!Array.isArray(issues)) return byField
  for (const issue of issues as readonly { path?: unknown; message?: unknown }[]) {
    const path = typeof issue?.path === 'string' ? issue.path.split('.')[0] : ''
    if (!path || typeof issue.message !== 'string' || byField[path] !== undefined) continue
    byField[path] = issue.message
  }
  return byField
}

/** An email address, by the pattern the server's `email` kind runs, copied so the browser loads no zod. */
const emailShape = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/

/** Whether a value is nothing a person wrote. An empty list is a value, so a required list may be saved empty; `minRows` asks for rows. */
const empty = (value: unknown) => value === undefined || value === null || value === ''

/**
 * The first rule of the projection this value breaks, as the last segment of the server's copy key,
 * in the server's order, or nothing. An empty box passes every rule but `required`; a value outside
 * `options` is `invalid`.
 */
const brokenRule = (field: ClientField, held: unknown): string | undefined => {
  const { rules } = field
  if (rules.localized === true && held && typeof held === 'object') {
    return Object.values(held).map((one) => brokenRule({ ...field, rules: { ...rules, localized: false } }, one)).find(Boolean)
  }
  // The server trims and cases before it judges, so judge the rewritten value.
  const text = typeof held === 'string' && rules.trim === true ? held.trim() : held
  const value = typeof text !== 'string' ? text : rules.uppercase === true ? text.toUpperCase() : rules.lowercase === true ? text.toLowerCase() : text
  if (Array.isArray(value) && (value.length || rules.required === true)) {
    if (typeof rules.minRows === 'number' && value.length < rules.minRows) return 'minRows'
    if (typeof rules.maxRows === 'number' && value.length > rules.maxRows) return 'maxRows'
  }
  if (empty(value)) return rules.required === true ? 'required' : undefined
  if (field.kind === 'integer' && !(Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647)) return 'invalid'
  if (field.kind === 'decimal') {
    if (!isDecimal(value)) return 'invalid'
    const { whole, fraction } = decimalDigits(value)
    if (typeof rules.precision === 'number' && (whole + fraction > rules.precision || whole > rules.precision - Number(rules.scale))) return 'precision'
    if (typeof rules.scale === 'number' && fraction > rules.scale) return 'scale'
    if (typeof rules.min === 'string' && compareDecimals(value, rules.min) < 0) return 'min'
    if (typeof rules.max === 'string' && compareDecimals(value, rules.max) > 0) return 'max'
    return undefined
  }
  if (field.kind === 'email' && typeof value === 'string' && !emailShape.test(value)) return 'invalid'
  const size = typeof value === 'string' || Array.isArray(value) ? value.length : undefined
  if (size !== undefined && typeof rules.minLength === 'number' && size < rules.minLength) return 'minLength'
  if (size !== undefined && typeof rules.maxLength === 'number' && size > rules.maxLength) return 'maxLength'
  if (typeof value === 'string' && rules.pattern instanceof RegExp && !new RegExp(rules.pattern).test(value)) return 'pattern'
  const { min, max } = rules
  if (typeof min === 'number' ? typeof value === 'number' && value < min : typeof min === 'string' && String(value) < min) return 'min'
  if (typeof max === 'number' ? typeof value === 'number' && value > max : typeof max === 'string' && String(value) > max) return 'max'
  if (field.options && [value].flat().some((one) => !field.options!.some((option) => option.value === one))) return 'invalid'
  return undefined
}

/**
 * The refusal the server would send for these values, in its wire shape, or nothing when every rule
 * holds. The rules are checked here because the derived zod shape does not cross `structuredClone`
 * into the browser; the server stays the authority.
 */
export const refusalOf = ({
  kayan,
  fields,
  values,
}: {
  kayan: string
  fields: readonly ClientField[]
  values: Readonly<Record<string, unknown>>
}) => {
  const issues = fields.flatMap((field) => {
    const rule = brokenRule(field, values[field.name])
    return rule ? [{ path: field.name, message: `${kayan}.${field.name}.${rule}` }] : []
  })
  return issues.length ? { data: { key: 'error.invalid.value', params: { issues } } } : undefined
}

/** The sentence over a refused save: a schema refusal that names fields lists them by label; any other is its own key's sentence, or `fallback`. */
export const refusalWords = ({ shown, labels, fallback, copy: { t, locale } }: { shown: string; labels: readonly string[]; fallback?: string; copy: Copy }): string =>
  shown === 'error.invalid.value' && labels.length
    ? counted({ t, locale, key: 'error.invalid.fields', count: labels.length, fallback: 'The following fields are invalid: {fields}' }).replace('{fields}', () => listed(labels, locale))
    : (t(shown, fallback ?? shown) ?? shown)

const KayanForm = createContext<
  | {
      form: AnyFormApi
      issues: Readonly<Record<string, string>>
      locales: Readonly<Record<string, readonly string[]>>
      writes?: (field: string, on: 'create' | 'update') => boolean
      on: 'create' | 'update'
      check: (name: string, value: unknown) => string | undefined
      forget: (name: string) => void
    }
  | undefined
>(undefined)

export const useValues = <Values extends object = Record<string, unknown>>(): Values => {
  const held = useContext(KayanForm)
  if (!held) throw new Error('useValues is called inside the form this registry draws, and nowhere else')
  return useStore(held.form.store, (state) => state.values as Values)
}

type KayanField = {
  value: unknown
  onChange: (value: unknown) => void
  onBlur: () => void
  /** Whether this field is the client's to write on this operation, off the access report. */
  writable: boolean
  /** Whether a person has left this box, or the server has refused it. */
  touched: boolean
  /** This field's refusal, in the words a person reads, or nothing. */
  error?: string
  /** The locales of a localized field the server's refusal named, whose boxes alone are marked. */
  locales?: readonly string[]
}
/**
 * One field's value, change, blur, write access and error, read from the form this field is inside.
 * The error shows once the box is left or the server has refused it, and falls back to the form's
 * refusal record because a remount or a server render has no error map.
 */
export function useKayanField<Values extends object, Name extends keyof Values & string>(name: Name): Omit<KayanField, 'value'> & { value: Values[Name] }
export function useKayanField(name: string): KayanField
export function useKayanField(name: string): KayanField {
  const held = useContext(KayanForm)
  if (!held) throw new Error('useKayanField is called inside the form this registry draws, and nowhere else')
  const { check, forget, form, issues, locales, on, writes } = held
  const field = useField({
    form,
    name,
    // Validated on blur, then on every change; a change also drops the refusal a save left on this box.
    validators: { onBlur: ({ value }) => check(name, value) },
    listeners: {
      onChange: ({ fieldApi }) => {
        forget(name)
        if (fieldApi.state.meta.isBlurred) fieldApi.validate('blur')
      },
    },
  })
  const meta = field.state.meta
  const refused = (meta.errorMap.onServer as string | undefined) ?? issues[name]
  const touched = meta.isTouched || refused !== undefined
  const invalid = !meta.isValid || refused !== undefined
  const first = meta.errors.find((one) => one !== undefined && one !== null)
  return {
    value: field.state.value,
    onChange: (next: unknown) => field.handleChange(next),
    onBlur: field.handleBlur,
    writable: writes ? writes(name, on) : true,
    touched,
    error: touched && invalid ? (refused ?? (typeof first === 'string' ? first : undefined)) : undefined,
    locales: locales[name],
  }
}

/**
 * The delete, in two clicks. The dialog stays open until the delete lands, so a refusal is said inside it.
 * With `open` handed in, the dialog is controlled and draws no trigger, so a menu can open it.
 */
export function DeleteButton({
  busy,
  copy,
  kayan,
  label,
  onDelete,
  onOpenChange,
  open: given,
  row,
}: {
  busy: boolean
  copy: Copy
  kayan: ClientKayan
  label: string
  /** Runs the delete, handing a refusal to `refuse`, and answers whether it landed, which is what the dialog closes on. */
  onDelete: (refuse: (thrown: unknown) => void) => Promise<boolean>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The row it deletes, which the dialog names. */
  row?: Row
}): ReactElement {
  const { t } = copy
  const [held, setHeld] = useState(false)
  const [refused, setRefused] = useState<unknown>(undefined)
  const setOpen = (next: boolean) => {
    if (!next) setRefused(undefined)
    ;(onOpenChange ?? setHeld)(next)
  }
  return (
    <AlertDialog open={given ?? held} onOpenChange={setOpen}>
      {given === undefined ? (
        <AlertDialogTrigger
          render={
            <Button type="button" variant="destructive" className="max-sm:h-11" data-button="delete" disabled={busy}>
              {label}
            </Button>
          }
        />
      ) : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>
            {[row ? rowWarning({ kayan, row, operation: 'delete', copy }) : undefined, t('admin.deleteWarning', 'This cannot be undone.') ?? 'This cannot be undone.'].filter(Boolean).join(' ')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refused === undefined ? null : (
          <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
            {deleteRefusal({ refused, t })}
          </p>
        )}
        <AlertDialogFooter className="max-sm:[&_button]:h-11">
          <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setRefused(undefined)
              if (await onDelete(setRefused)) setOpen(false)
            }}
          >
            {t(`${kayan.name}.delete.confirm`) ?? t('admin.deleteConfirm', 'Delete for good') ?? 'Delete for good'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const deleteRefusal = ({ refused, t }: { refused: unknown; t: Translate }): string => {
  const key = refusalKeyOf(refused)
  if (!key) return t('admin.deleteFailed', 'Something went wrong, so nothing was deleted. Try again.') ?? 'Something went wrong, so nothing was deleted. Try again.'
  const by = (refused as { data?: { params?: { by?: unknown } } }).data?.params?.by
  if (key === 'error.conflict.referenced' && typeof by === 'string') {
    const kind = t(`${by}.plural`, by) ?? by
    return (t('error.conflict.referencedBy', '{kind} still use this, so it is not deleted.') ?? '{kind} still use this, so it is not deleted.').replace('{kind}', () => kind)
  }
  return t(key, key) ?? key
}

/**
 * The question asked before an unsaved edit is thrown away, used by the form's Cancel and by a
 * navigation the host's router blocked. It stays mounted with the form, so an autosave landing while
 * it asks cannot unmount it.
 */
export function DiscardDialog({
  busy,
  note,
  onDiscard,
  onOpenChange,
  open,
  t,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  /** What discarding means, which is leaving: the Cancel's navigation, or the one the router blocked. */
  onDiscard: () => void
  /** A sentence after the question, such as that a draft already saved is kept. */
  note?: string
  busy?: boolean
  t: Translate
}): ReactElement {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.discard', 'Discard changes') ?? 'Discard changes'}</AlertDialogTitle>
          <AlertDialogDescription>
            {[t('admin.discardWarning', 'You have unsaved changes. Leave without saving?') ?? 'You have unsaved changes. Leave without saving?', note].filter(Boolean).join(' ')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="max-sm:[&_button]:h-11">
          <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onDiscard}>
            {t('admin.discard', 'Discard changes') ?? 'Discard changes'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * One of a kayan's own operations, as a button and the dialog behind it. The dialog is controlled so a
 * refusal keeps it open over the boxes it names; a list's own buttons open this same dialog.
 */
export function OperationButton({
  api,
  busy,
  copy,
  description,
  inputOf,
  kayan,
  kayans,
  operation,
  run,
  ...controlled
}: {
  api?: FindApi
  busy: boolean
  copy: Copy
  /** Handed in by a caller that opens the dialog from elsewhere, such as a list row's menu, in which case no trigger is drawn. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** What the dialog says it runs on, the row being edited unless the caller says otherwise. */
  description?: string
  /** The call's input from what the boxes hold: the row's id beside them on a form or list row, the ticked rows' `where` around them on a bulk. */
  inputOf: (values: Record<string, unknown>) => Record<string, unknown>
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  operation: PageButton
  /** The form's own writer, which lands the call and hands a refusal back here. */
  run: (input: Record<string, unknown>, refuse: (thrown: unknown) => void) => Promise<boolean>
}): ReactElement {
  const { t } = copy
  const [held, setHeld] = useState(false)
  const open = controlled.open ?? held
  const setOpen = (next: boolean) => (controlled.onOpenChange ?? setHeld)(next)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [refused, setRefused] = useState<unknown>(undefined)
  const fields = operation.fields ?? []
  const setValue = (name: string, next: unknown) => {
    if (!busy && fields.some((field) => field.name === name)) setValues((already) => ({ ...already, [name]: next }))
  }
  // Closing drops the refusal and the typed values, so the next opening starts empty.
  const close = () => {
    setOpen(false)
    setRefused(undefined)
    setValues({})
  }
  const label = operationLabelFor({ kayan, operation, copy })
  const shown = refusalKeyOf(refused)
  const issues = issuesOf(refused)
  // A bulk update whose boxes are row data: a box left empty leaves each row's value as it is, and
  // with every box empty there is nothing to write, which the server refuses too.
  const writesData = operation.updatesMany === true && fields.length > 0
  const popup = useRef<HTMLDivElement>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // React events from a portaled dialog still reach the screen's form through the React tree;
    // without this one click would run the operation and save the row.
    event.stopPropagation()
    if (busy) return
    // An untouched box is left out rather than sent as `undefined`, so a schema default for it still applies.
    const typed: Record<string, unknown> = {}
    for (const field of fields) {
      if (values[field.name] !== undefined) typed[field.name] = values[field.name]
    }
    if (writesData && !Object.keys(typed).length) return setRefused({ data: { key: 'admin.bulkNothingFilled' }, fallback: 'Fill in at least one field.' })
    if (await run(inputOf(typed), setRefused)) close()
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next: boolean) => (next ? setOpen(true) : close())}
    >
      {controlled.open === undefined ? (
        <AlertDialogTrigger
          render={
            <Button type="button" variant="outline" className="max-sm:h-11" disabled={busy}>
              {label}
            </Button>
          }
        />
      ) : null}
      {/* On a phone the dialog takes focus, not its first box, so the keyboard stays down. */}
      <AlertDialogContent ref={popup} initialFocus={initialFocusIn(popup)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{operation.confirm?.title[copy.locale] ?? label}</AlertDialogTitle>
          <AlertDialogDescription>
            {[description, operation.confirm?.body[copy.locale], writesData && t('admin.bulkFilledOnly', 'Only the fields you fill in change.')].filter(Boolean).join(' ')
              || (t('admin.operationWarning', 'This runs on the row you are editing.') ?? 'This runs on the row you are editing.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {shown ? (
          <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
            {refusalWords({ shown, fallback: (refused as { fallback?: string }).fallback, labels: fields.filter((field) => issues[field.name] !== undefined).map((field) => operationFieldLabelFor({ kayan, operation, field, copy })), copy })}
          </p>
        ) : null}
        {/* A form and not a div, so Enter in a one-box dialog submits. */}
        <form className="grid gap-4" noValidate onSubmit={(event) => void submit(event)}>
          {fields.map((field) => {
            const Control = controlFor(field)
            const inputId = `${kayan.name}-${operation.name}-${field.name}`
            const issue = issues[field.name]
            const failed = issue === undefined ? undefined : (t(issue, issue) ?? issue)
            const choice = writesData && besideLabel(Control)
            return (
              <FieldShell
                key={field.name}
                id={inputId}
                label={operationFieldLabelFor({ kayan, operation, field, copy })}
                error={failed}
                beside={!choice && besideLabel(Control)}
                width={field.width}
              >
                {choice ? (
                  <BulkChoice
                    copy={copy}
                    describedBy={describedBy({ id: inputId, description: undefined, error: failed })}
                    error={failed}
                    field={field}
                    id={inputId}
                    kayan={kayan}
                    onChange={(next) => setValue(field.name, next)}
                    readOnly={busy}
                    value={values[field.name]}
                  />
                ) : <Control
                  field={field}
                  kayan={kayan}
                  client={kayans}
                  api={api}
                  t={t}
                  id={inputId}
                  value={values[field.name]}
                  values={values}
                  setValue={setValue}
                  onChange={(next) => setValue(field.name, next)}
                  readOnly={busy}
                  error={failed}
                  describedBy={describedBy({ id: inputId, description: undefined, error: failed })}
                />}
              </FieldShell>
            )
          })}
          <AlertDialogFooter className="max-sm:[&_button]:h-11">
            <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={busy}>
              {label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}


function BoundField({
  api,
  copy,
  field,
  form,
  kayan,
  kayans,
  leaf,
  readOnly,
  screen,
  values,
  setValue,
}: {
  api?: FindApi
  copy: Copy
  field: ClientField
  /** The id of the form this field is saved by, wherever the page drew it. */
  form: string
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  /** What this page alone draws the field with, on a screen's page. */
  leaf?: LeafClient
  /** Whether the control takes no edit, which is the form's own answer and never this field's to decide. */
  readOnly: boolean
  screen?: ScreenPage
  values: Readonly<Record<string, unknown>>
  setValue: (name: string, value: unknown) => void
}): ReactElement {
  const bound = useKayanField(field.name)
  return (
    <LeafControl
      field={field}
      form={form}
      kayan={kayan}
      kayans={kayans}
      leaf={leaf}
      screen={screen}
      copy={copy}
      api={api}
      value={bound.value}
      values={values}
      setValue={setValue}
      onChange={bound.onChange}
      onBlur={bound.onBlur}
      readOnly={readOnly}
      error={bound.error}
      invalidLocales={bound.locales}
    />
  )
}

/**
 * One field of a row that is read and never edited: its label over the cell a list column draws it
 * with. A field the report hides is not in the projection, so nothing is drawn for it.
 */
export function FieldValue({
  api,
  copy,
  field,
  kayan,
  kayans,
  leaf,
  row,
  screen,
}: {
  api?: FindApi
  copy: Copy
  field: ClientField
  kayan: ClientKayan
  kayans?: readonly ClientKayan[]
  leaf?: LeafClient
  row: Readonly<Record<string, unknown>> | null
  screen?: ScreenPage
}): ReactElement {
  const titles = useRelationshipTitles({ fields: [field], docs: row ? [row] : [], context: { api, client: kayans, locale: copy.locale } })
  const label = useId()
  const value = row?.[field.name]
  const Ref = refOf({ screen, place: 'cell', path: leaf?.cell ?? field.cell })
  const Cell = cellFor(field, leaf?.cell)
  const description = leaf?.description?.[copy.locale] ?? descriptionFor({ kayan, field, copy })
  const width = leaf?.width ?? field.width
  return (
    <div role="group" aria-labelledby={label} data-field-value={field.name} className="grid gap-1.5" style={width ? { width } : undefined}>
      <span id={label} className="text-sm font-medium">{labelFor({ kayan, field, copy })}</span>
      <span className="text-sm">
        {Ref && screen
          ? <Ref field={field} value={value} row={row ?? {}} />
          : (leaf?.cell ?? field.cell) === 'richText'
            ? <RichTextValueView value={value} t={copy.t} />
            : (leaf?.cell ?? field.cell) === 'upload'
              ? <UploadValue kayan={kayan} field={field} value={value} t={copy.t} locale={copy.locale} titles={titles} />
              : <Cell kayan={kayan} field={field} value={value} t={copy.t} locale={copy.locale} titles={titles} />}
      </span>
      {description ? <span className="text-muted-foreground text-sm">{description}</span> : null}
    </div>
  )
}

const units = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]] as const

/** How long ago a moment was, in the viewer's language via `Intl.RelativeTimeFormat`: "2 hours ago", and "now" for the moment just passed or a moment ahead of this clock. */
export const timeAgo = ({ at, now, locale }: { at: Date; now: number; locale: string }) => {
  const seconds = Math.min(0, (at.getTime() - now) / 1000)
  const [unit, size] = units.find(([, size]) => -seconds >= size) ?? units.at(-1)!
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit)
}

function UpdatedAgo({ at, t, locale }: { at: Date; t: Translate; locale: string }): ReactElement {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])
  return <>{(t('version.updatedAgo', 'Updated {time}') ?? 'Updated {time}').replace('{time}', timeAgo({ at, now, locale }))}</>
}

/**
 * The form screen over one kayan's `create`, `update` and `delete`, holding its values in TanStack Form.
 * It is mounted under a key of the kayan and the row's id, so a host that hands another row gets a form
 * seeded from that row, and a refusal in hand goes with it.
 */
export function Form(props: FormProps): ReactElement {
  const id = String(props.value?.id ?? '')
  // Exception: the row this form's own autosave made on a create. The host's move to its edit page
  // hands that row and the form stays mounted, so nothing typed since is lost.
  const [held, setHeld] = useState<{ id: string; mount: number; made?: string }>({ id, mount: 0 })
  // The made row's id is kept across that move alone, which is how the page knows the row is its own autosave's.
  if (held.id !== id) setHeld(held.id === '' && held.made === id ? { ...held, id } : { id, mount: held.mount + 1 })
  return <FormScreen key={`${props.kayan.name}:${held.mount}`} {...props} made={held.made} onMade={(made) => setHeld((before) => ({ ...before, made }))} />
}

function FormScreen({
  api,
  blocked,
  client,
  drafts,
  error,
  expectedUpdatedAt,
  expectedUpdatedAtOn,
  kayan,
  kayans,
  locale,
  locales,
  made,
  nodes,
  onCancel,
  onDirty,
  onDone,
  onMade,
  operations,
  related,
  t,
  screen,
  value,
  writes,
}: FormProps & { made?: string; onMade: (id: string) => void }): ReactElement {
  const copy = { t, locale, locales }
  const [refused, setRefused] = useState<unknown>(undefined)
  const [busy, setBusy] = useState(false)
  // Bumped to remount every control and panel, so a panel reads what it shows afresh.
  const [revision, setRevision] = useState(0)
  const reload = () => setRevision((already) => already + 1)
  // Saves landed since mount (plain, draft, publish, autosave), for panels that keep their own history
  // of the row; a draft save never moves `record.updatedAt`.
  const [saves, setSaves] = useState(0)
  // When the last save landed, shown as the row's last update ahead of its own `updatedAt`.
  const [savedAt, setSavedAt] = useState<Date>()
  const noteSave = () => {
    setSaves((already) => already + 1)
    setSavedAt(new Date())
  }
  // The seed is held in state, not read off `value`: a save makes what it wrote the seed before the host
  // reads the row again. `saved` is what the server holds, kept apart because an autosave leaves the seed alone.
  const seeded = (values: Record<string, unknown>, status = drafts?.status, updatedAt = value?.updatedAt) => ({ row: value, values, saved: values, status, updatedAt })
  const [seed, setSeed] = useState(() => seeded(seedOf(kayan.fields, value)))
  // The focused box and its caret when the host handed another row, put back once the new page has
  // drawn it: an autosaved create moves to an edit page whose tree is new.
  const focused = useRef<{ id: string; start: number | null; end: number | null }>(undefined)
  if (seed.row !== value) {
    const box = typeof document === 'undefined' ? null : (document.activeElement as HTMLInputElement | null)
    focused.current = box?.id ? { id: box.id, start: box.selectionStart ?? null, end: box.selectionEnd ?? null } : undefined
    setSeed(seeded(seedOf(kayan.fields, value)))
  }
  useLayoutEffect(() => {
    const was = focused.current
    focused.current = undefined
    if (!was || document.activeElement?.id === was.id) return
    const box = document.getElementById(was.id) as HTMLInputElement | null
    box?.focus()
    if (was.start !== null) box?.setSelectionRange(was.start, was.end)
  }, [seed])
  const form = useForm({ defaultValues: seed.values })
  const values = useStore(form.store, (state) => state.values as Record<string, unknown>)
  // The access report a node's `when` reads as `$user`; none outside a screen.
  const access = useContext(ScreenContext)?.access
  const held = refused === undefined ? error : refused
  const shown = refusalKeyOf(held)
  const issues = issuesOf(held)
  // The wire message is itself a copy key; a key nothing answers is drawn as it arrived, which is what
  // a custom shape that writes none of our keys sends.
  const sentences: Record<string, string> = Object.create(null)
  for (const [name, issue] of Object.entries(issues)) sentences[name] = t(issue, issue) ?? issue
  const byName = new Map(kayan.fields.map((field) => [field.name, field]))
  const banner = shown ? refusalWords({ shown, labels: Object.keys(issues).flatMap((name) => (byName.has(name) ? [labelFor({ kayan, field: byName.get(name)!, copy })] : [])), copy }) : undefined
  // A create that has autosaved its row edits that row from then on, before
  // the host has handed it.
  const id = String(value?.id ?? made ?? '')
  // A row with an id is being changed, one without is being made; a field may be the client's on one operation and the server's on the other.
  const on = id ? 'update' : 'create'

  // Put the refusal where TanStack keeps a server's answer (`onServer`), so a project's own control reading
  // `field.state.meta.errors` sees the same sentence the shell draws.
  useEffect(() => {
    // The slot is typed off an `onServer` validator, which this form declares none of; TanStack
    // writes the key anyway, so the cast only bridges the types.
    form.setErrorMap({ onServer: { form: undefined, fields: sentences } } as Parameters<AnyFormApi['setErrorMap']>[0])
  }, [form, JSON.stringify(sentences)])

  // TanStack's per-field `isDefaultValue` over the whole form, so a value typed back to its seed is no change.
  const dirty = useStore(form.store, (state) => !state.isDefaultValue)

  // Guards a half-written row against a closed tab or a typed URL. The browser shows its own sentence;
  // cleared on unmount so a form left behind does not hold the guard for the next screen.
  useEffect(() => {
    window.onbeforeunload = dirty ? () => '' : null
    return () => {
      window.onbeforeunload = null
    }
  }, [dirty])

  // The same fact to the host, for navigations the browser's guard cannot see; cleared on unmount so a
  // form left behind does not hold the host's blocker.
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])

  // Whether the server owns this field on this operation (read-only, `uuid`, a non-client provider, or
  // access denied); it decides both the disabled control and whether the field is in the write.
  const owned = (field: ClientField) => readOnlyField(field, on) || (writes ? !writes(field.name, on) : false)
  // Every field `setValue` changed, which a save counts as named.
  const set = useRef(new Set<string>())
  const setValue = (name: string, next: unknown) => {
    const field = byName.get(name)
    if (!busy && !viewing && field && !owned(field)) {
      set.current.add(name)
      form.setFieldValue(name, next)
    }
  }
  // A field the server provides is not the person's to fix, so it is not checked, as the save does not check it.
  const check = (name: string, next: unknown) => {
    const field = byName.get(name)
    const rule = field && !owned(field) ? brokenRule(field, next) : undefined
    if (!rule) return undefined
    const key = `${kayan.name}.${name}.${rule}`
    return t(key, key) ?? key
  }
  // Once the refusal names no field it is `null`, not `undefined`, so the host's own refusal does not come back.
  const forget = (name: string) => {
    if (issues[name] === undefined) return
    const { data } = held as { data: { params: { issues: { path?: unknown }[] } } }
    const rest = data.params.issues.filter((issue) => String(issue.path).split('.')[0] !== name)
    setRefused(rest.length ? { ...(held as object), data: { ...data, params: { ...data.params, issues: rest } } } : null)
  }
  const readOnly = (field: ClientField) => busy || owned(field)

  // A leaf in another region is outside the page's one <form>, so its box names the form by this id
  // (the platform's `form` attribute) and Enter in it still saves.
  const formId = useId()
  const control = (leaf: string | LeafClient) => {
    const field = byName.get(typeof leaf === 'string' ? leaf : leaf.field)
    // A leaf naming a field the kayan lacks is refused at `buildAsas`, so this fires only for a hand-built
    // layout. A field the page names is drawn whoever provides it.
    if (!field) return null
    // The published copy is drawn read-only; the draft's boxes are not drawn, but what was typed stays in the form's values.
    if (viewing) {
      return (
        <LeafControl
          key={`${field.name}-published`}
          field={field}
          form={formId}
          kayan={kayan}
          kayans={kayans}
          leaf={typeof leaf === 'string' ? undefined : leaf}
          screen={screen}
          copy={copy}
          api={api}
          value={showing[field.name]}
          values={showing}
          setValue={() => {}}
          onChange={() => {}}
          readOnly
        />
      )
    }
    // A leaf the page marks read-only is read as text with its cell's formatter. A field the server
    // provides keeps its control, which the side card draws.
    if (typeof leaf !== 'string' && leaf.readOnly === true) {
      return <FieldValue key={`${field.name}-${revision}`} api={api} copy={copy} field={field} kayan={kayan} kayans={kayans} leaf={leaf} row={values} screen={screen} />
    }
    return (
      <BoundField
        key={`${field.name}-${revision}`}
        api={api}
        copy={copy}
        field={field}
        form={formId}
        kayan={kayan}
        kayans={kayans}
        leaf={typeof leaf === 'string' ? undefined : leaf}
        readOnly={readOnly(field)}
        screen={screen}
        values={values}
        setValue={setValue}
      />
    )
  }

  const draw: Draw = {
    kayan,
    copy,
    issues,
    scope: scopeOf({ values, record: value, access, kayan }),
    control,
    // A component has no field behind it; inside a form it reads and writes the form's values through
    // `useForm()`. A reference with no registered component is said, not drawn blank.
    component: (path, index) => {
      const Ref = refOf({ screen, place: 'component', path })
      if (Ref && screen) return <Ref key={`component-${index}-${revision}`} page={screen.page} />
      return (
        <p key={`component-${index}`} data-missing-component={path} className="text-muted-foreground text-sm">
          {(t('admin.missingComponent', 'No component is registered for "{component}".')
            ?? 'No component is registered for "{component}".'
          ).replace('{component}', path)}
        </p>
      )
    },
    layout: ({ path, regions, index }) => screen && frameOf({ screen, t, path, regions, key: index }),
    list: related,
    nav: () => screen && <NavLinks />,
    button: (node) => {
      const button = id && client.run && !viewing ? pageButtonOf({ kayan, node, allowed: operations }) : undefined
      return button ? buttonOf(button) : null
    },
    // The page's one <form>, so a list of another kayan beside it, with forms of its own, is never inside it;
    // a leaf elsewhere on the page is still this form's value. A page with a controls node draws the actions there.
    // `noValidate` so the browser's own bubble never stands in for the field's refusal in the page's language.
    form: (children) => (
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        {chrome}
        <div className={headed ? 'flex flex-col gap-4 border-t pt-6' : 'flex flex-col gap-4'}>
          {children}
          {controlled ? null : (
            <Card>
              <CardContent>{actionsOf(false)}</CardContent>
            </Card>
          )}
        </div>
      </form>
    ),
    // Only while the page draws the form: a role page that draws a fixed role in place of its form offers no save.
    controls: () => (tree && drawsKind({ nodes: tree, kind: 'form', scope: draw.scope }) ? actionsOf(true) : null),
  }
  const walk = (nodes: readonly Node[]) => drawNodes({ nodes, draw })
  // A screen's page names every field it draws; a form handed no page draws every field in declared
  // order, and no join, whose rows are another kayan's.
  const tree = nodes ?? (screen && nodesOf(screen.page))
  const controlled = !!tree && drawsKind({ nodes: tree, kind: 'controls', scope: draw.scope })
  const unnamed = tree ? [] : kayan.fields.filter((field) => field.kind !== 'join')
  const provided = unnamed.filter(owned)
  const rest = unnamed.filter((field) => !owned(field))
  // Titles of the rows the side card points at, read once for this row. With no `api` each id settles as
  // a row the viewer cannot see; the cell never shows the id it holds.
  const titles = useRelationshipTitles({ fields: provided, docs: value ? [value] : [], context: { api, client: kayans, locale } })
  // A page that draws a row draws no kayan description, except a global's one row, whose page is the
  // only place it is drawn.
  const about = screen && value?.id !== undefined && !kayan.single ? undefined : descriptionOf(kayan, copy)
  const headed = !screen || !!about

  const runOperation =
    (operation: PageButton) =>
    async (input: Record<string, unknown>, refuse: (thrown: unknown) => void) => {
      const landed = await run(() => client.run!(operation.name, input), operation.effect, refuse)
      // A kayan's own operation can change anything the row touches, children included, so reload the panels.
      if (landed) reload()
      return landed
    }

  // A relationship is drawn by the list's cell, not a picker: a disabled picker over a row the viewer
  // may not choose shows the raw id, where the cell reads the target's title.
  const sideEntry = (field: ClientField) => {
    if (field.kind !== 'relationship') return control(field.name)
    const Cell = cellFor(field)
    return (
      <div key={field.name} className="grid gap-1.5">
        <span className="text-sm font-medium">{labelFor({ kayan, field, copy })}</span>
        <span className="text-muted-foreground text-sm">
          <Cell kayan={kayan} field={field} value={values[field.name]} t={t} locale={locale} titles={titles} />
        </span>
      </div>
    )
  }

  /** The instant this form last read or wrote the row at, for a write whose operation takes it. */
  const readAt = (takes?: boolean) => (takes && seed.updatedAt !== undefined ? { expectedUpdatedAt: seed.updatedAt } : {})
  /** Whether a write of the person's own has landed here, which makes a row this page's autosave made theirs. */
  const kept = useRef(false)
  // `refuse` is where a refusal lands: the form's own box by default, or an operation dialog's boxes, which
  // stays open to hold them. Answers whether the write landed.
  const run = async (write: () => Promise<unknown>, effect?: string, refuse: (thrown: unknown) => void = setRefused, status?: DraftStatus): Promise<boolean> => {
    setRefused(undefined)
    setBusy(true)
    try {
      const written = await write()
      kept.current = true
      // What was just written is what the form now holds, so it holds no change: Save goes disabled and
      // the unload guard comes down.
      form.reset(values)
      // The instant the row now stands at, which the next update sends.
      setSeed(seeded(values, status ?? seed.status, (written as { updatedAt?: unknown } | null)?.updatedAt ?? seed.updatedAt))
      noteSave()
      // A write may change the published copy, which View published reads again.
      setPublished(undefined)
      setView('draft')
      onDone(written, effect)
      return true
    } catch (thrown) {
      refusedOver.current = JSON.stringify(values)
      refuse(thrown)
      return false
    } finally {
      setBusy(false)
    }
  }

  // Differs from the seed or from what the server holds since; an update sends only these.
  const changed = (field: ClientField) =>
    form.getFieldMeta(field.name)?.isDefaultValue === false || JSON.stringify(values[field.name]) !== JSON.stringify(seed.saved[field.name])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save()
  }

  // A draft save holds each value to its kind and none of its rules, so the rules are not checked here either.
  const save = (options?: DraftOptions) => {
    // An update sends only the fields that changed, so two people saving different fields of one row each
    // write their own and neither writes the other's back as it was opened.
    const fields = writable().filter((field) => !id || changed(field))
    const refusal = options?.draft ? undefined : refusalOf({ kayan: kayan.name, fields, values })
    if (refusal) return setRefused(refusal)
    const written = valuesOf({ fields, values, owned })
    const status = drafts && (options?.draft ? afterDraft(seed.status) : 'published')
    void run(() => (id ? client.update({ ...written, ...readAt(expectedUpdatedAt), id }, options) : client.create(written, options)), on, undefined, status)
  }

  const writable = () => {
    // A page's form writes only what the page names and draws writable: sending a field it leaves out would
    // overwrite whatever was saved since. A field a control or panel set through `setValue` counts as named.
    const named = tree && new Set([...leavesOf(tree, (leaf) => !leaf.readOnly), ...set.current])
    return (named ? kayan.fields.filter((field) => named.has(field.name)) : kayan.fields).filter((field) => !owned(field))
  }

  const status = drafts && seed.status
  // Which copy a changed row shows: the draft, or the published copy, read once when first chosen and drawn read-only with no save or autosave.
  const [view, setView] = useState<'draft' | 'published'>('draft')
  const [published, setPublished] = useState<Record<string, unknown> | null>()
  const viewing = status === 'changed' && view === 'published' && !!published
  const showing = viewing ? seedOf(kayan.fields, published) : values
  const choose = async (next: string) => {
    if (next === 'published' && published === undefined) {
      try {
        setPublished((await client.findByID!({ id })) as Record<string, unknown> | null)
      } catch (thrown) {
        return setRefused(thrown)
      }
    }
    setView(next === 'published' ? 'published' : 'draft')
  }
  /** The values a save was last refused over, which the autosave below never sends again. */
  const refusedOver = useRef<string | undefined>(undefined)
  const [autosaved, setAutosaved] = useState<'saving' | 'saved'>()
  /** Whether the form is still on screen, which an autosave that lands late asks before it moves the host. */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const json = JSON.stringify(values)
  // Autosave a draft of what differs once the form has stayed still for the interval. Never while a save is out,
  // over values a save was refused over, or while a discard question is open: that question says the change is unsaved.
  const [asking, setAsking] = useState(false)
  /** Whether a Discard is on its way out, deleting a draft first where it has one to delete. */
  const [leaving, setLeaving] = useState(false)
  // Nor once a write was refused because the row changed since this form read it: every autosave after it
  // would be refused the same way, so it stops and the refusal stays to say why.
  const stale = shown === 'error.conflict.stale'
  const interval = viewing || asking || blocked || leaving || stale ? undefined : drafts?.autosave
  useEffect(() => {
    if (!interval || busy || autosaved === 'saving' || refusedOver.current === json) return
    const fields = writable()
    if (!fields.some((field) => JSON.stringify(values[field.name]) !== JSON.stringify(seed.saved[field.name]))) return
    const timer = setTimeout(() => {
      const sent = valuesOf({ fields: fields.filter((field) => !id || changed(field)), values, owned })
      setAutosaved('saving')
      const words = { draft: true, autosave: true }
      ;(id ? client.update({ ...sent, ...readAt(expectedUpdatedAt), id }, words) : client.create(sent, words)).then(
        (written) => {
          setAutosaved('saved')
          // A refusal a save drew earlier is over: the row just saved fine, so a banner naming no field
          // would sit there with nothing left to say.
          setRefused(undefined)
          refusedOver.current = undefined
          noteSave()
          // The instant the draft now stands at, which the next write sends.
          const updatedAt = (written as { updatedAt?: unknown } | null)?.updatedAt ?? seed.updatedAt
          if (JSON.stringify(form.state.values) === json) {
            form.reset(values)
            setSeed(seeded(values, afterDraft(seed.status), updatedAt))
          } else {
            setSeed((held) => ({ ...held, saved: { ...held.saved, ...sent }, status: afterDraft(held.status), updatedAt }))
          }
          const row = (written as { id?: unknown } | null)?.id
          if (!id && row !== undefined && alive.current) {
            onMade(String(row))
            onDone(written, 'create')
          }
        },
        (thrown: unknown) => {
          refusedOver.current = json
          setAutosaved(undefined)
          setRefused(thrown)
        },
      )
    }, interval)
    return () => clearTimeout(timer)
  }, [interval, busy, autosaved, json, seed, id])
  // Leaving unsaved deletes the untouched draft this page's autosave made, so a cancelled new row leaves none.
  // A published row is kept (a plain read finds it), and so is a draft someone saved since (the delete gets a 409).
  const ownDraft = !!made && id === made && !kept.current && status === 'draft'
  const keepsDraft = ownDraft && operations?.delete !== true
  const out = useRef(false)
  const discard = async (leave: () => void) => {
    if (out.current) return
    out.current = true
    setLeaving(true)
    if (ownDraft && !keepsDraft && client.findByID) {
      const found = await client.findByID({ id }).then(
        (row) => (row ? 'published' : 'absent'),
        (thrown: unknown) => ((thrown as { status?: unknown } | null)?.status === 404 ? 'absent' : 'unknown'),
      )
      if (found === 'absent') await client.delete({ id, ...readAt(expectedUpdatedAtOn?.includes('delete')) }).catch((thrown: unknown) => console.error('The draft this page made could not be deleted:', thrown))
    }
    // The edit is thrown away before the navigation, so a slow navigation leaves no change for the autosave to save.
    form.reset(seed.saved)
    out.current = false
    setLeaving(false)
    setAsking(false)
    leave()
  }
  useEffect(() => {
    if (autosaved !== 'saved') return
    const timer = setTimeout(() => setAutosaved(undefined), 2000)
    return () => clearTimeout(timer)
  }, [autosaved, saves])

  const buttonOf = (operation: PageButton) => {
    const Ref = refOf({ screen, place: 'button', path: operation.component })
    if (Ref && screen) {
      return (
        <OwnButton
          key={operation.name}
          Own={Ref}
          operation={operation}
          busy={busy}
          copy={copy}
          call={async (input) => {
            await runOperation(operation)({ ...input, id }, setRefused)
          }}
        />
      )
    }
    // A delete is the one write nothing brings back, so its button is always the two-step dialog, whatever the node carries.
    if (operation.effect === 'delete') {
      return (
        <DeleteButton
          key={operation.name}
          busy={busy}
          copy={copy}
          kayan={kayan}
          label={operationLabelFor({ kayan, operation, copy })}
          row={value ?? undefined}
          onDelete={(refuse) => run(() => client.delete({ id }), 'delete', refuse)}
        />
      )
    }
    // A button that asks for no values and carries a confirm asks it in the app's own dialog; any other opens the
    // registry's dialog, which asks the confirm in its heading. Each names the row it runs on.
    const description = value ? rowWarning({ kayan, row: value, operation: operation.name, copy }) : undefined
    if (operation.confirm && !operation.fields?.length) {
      return <NodeButton key={operation.name} node={operation} copy={copy} busy={busy} description={description} run={() => void runOperation(operation)({ id }, setRefused)} />
    }
    return (
      <OperationButton
        key={operation.name}
        api={api}
        busy={busy}
        copy={copy}
        description={description}
        inputOf={(values) => ({ id, ...values })}
        kayan={kayan}
        kayans={kayans}
        operation={operation}
        run={runOperation(operation)}
      />
    )
  }
  // Below sm the action bar is fixed, so the document keeps its height free as padding and scroll padding
  // (the document is what scrolls), and a field reached with Tab is never under the bar.
  const measureBar = useCallback((bar: HTMLElement | null) => {
    // Inside a sheet or a dialog the bar is the popup's own, so the document keeps no room for it.
    if (!bar || bar.closest('[role=dialog]')) return
    const root = document.documentElement.style
    // `--action-bar-height` too, which a list's own bar on a phone stands on rather than covering this one.
    const keep = (height: number) => {
      for (const property of ['padding-bottom', 'scroll-padding-bottom', '--action-bar-height']) {
        if (height) root.setProperty(property, `${height}px`)
        else root.removeProperty(property)
      }
    }
    // `borderBoxSize` is missing before Safari 15.4 and one box rather than a
    // list before Firefox 92, so the bar's own `offsetHeight` stands in there.
    const observer = new ResizeObserver(([entry]) => keep(entry ? (entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight) : 0))
    observer.observe(bar)
    return () => {
      observer.disconnect()
      keep(0)
    }
  }, [])
  const updated = id ? (savedAt ?? (value?.updatedAt ? new Date(value.updatedAt as string | Date) : undefined)) : undefined
  // The draft or the published copy, on a changed row only. Beside the actions from xl up; below xl a row at
  // the top of the form (`chrome`), so it is never in the phone's fixed bar.
  const viewSwitch = (className: string, phone = false) =>
    status === 'changed' && client.findByID ? (
      <ToggleGroup
        data-view-switch=""
        value={[viewing ? 'published' : 'draft']}
        onValueChange={(next) => next[0] && void choose(next[0])}
        aria-label={t('version.shownCopy', 'Version shown')}
        className={`bg-muted flex shrink-0 rounded-md p-0.5 ${className}`}
      >
        {(['draft', 'published'] as const).map((one) => (
          <ToggleGroupItem key={one} value={one} className={`data-pressed:bg-background border-0 px-2 py-0.5 text-xs data-pressed:shadow-sm${phone ? ' min-h-11 flex-1' : ''}`}>
            {t(`version.${one}`, { draft: 'Draft', published: 'Published' }[one])}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    ) : null
  // A submit button in a controls node sits outside the <form>, so every submit names it by its id. The spacing is
  // logical, so the row mirrors in Arabic.
  const actionsOf = (header: boolean) => {
    const size = header ? 'sm' : 'default'
    const tall = header ? 'max-sm:h-11' : ''
    const actions = (
    <>
      {/* A refusal naming no field, drawn here and not in the form: the form sits in the Details panel, and a
          Publish pressed from another tab would be refused where nobody is looking. */}
      {header && shown ? (
        <p role="alert" className="text-destructive line-clamp-2 min-w-24 flex-1 text-sm max-sm:basis-full sm:-order-1">
          {banner}
        </p>
      ) : null}
      {status && !header ? (
        <span data-status={status} className={`me-auto rounded-md px-2 py-0.5 text-sm ${pills[status]}`}>
          {t('version.status', 'Status')}: {t(`version.${status}`, { draft: 'Draft', published: 'Published', changed: 'Changed' }[status])}
        </span>
      ) : null}
      {/* Below xl it leaves the header for the top of the form (`chrome`). */}
      {viewSwitch(header ? 'max-xl:hidden' : '')}
      {autosaved ? (
        <span
          role="status"
          data-autosave={autosaved}
          className={autosaved === 'saved'
            ? 'animate-out fade-out fill-mode-forwards delay-1500 animation-duration-500 flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400'
            : 'text-muted-foreground text-sm'}
        >
          {autosaved === 'saved' ? <Check aria-hidden className="size-4" /> : null}
          {autosaved === 'saving' ? t('version.saving', 'Saving…') : t('version.saved', 'Saved')}
        </span>
      ) : null}
      {/* Read off the browser's clock, so it can differ from the server's render. */}
      {header && updated && !Number.isNaN(updated.getTime()) ? (
        <span data-updated="" className="text-muted-foreground text-sm max-xl:hidden" suppressHydrationWarning>
          <UpdatedAgo at={updated} t={t} locale={locale} />
        </span>
      ) : null}
      {/* A dirty form asks before Cancel: the router's navigation raises no `beforeunload`, so the browser's
          guard does not see it. A clean form's Cancel is a plain button. */}
      {onCancel ? (
        <Button
          type="button"
          variant="outline"
          size={size}
          className={tall}
          disabled={busy}
          aria-haspopup={dirty ? 'dialog' : undefined}
          onClick={dirty ? () => setAsking(true) : onCancel}
        >
          {t('admin.cancel', 'Cancel') ?? 'Cancel'}
        </Button>
      ) : null}
      {viewing ? null : drafts ? (
        <>
          {/* Save draft waits for a change on an update and is always offered beside the autosave. Publish is
              offered while anything is unpublished, with no change of its own. */}
          <Button type="button" size={size} className={`${draftColour} ${tall}`} data-button="save-draft" disabled={busy || autosaved === 'saving' || (!!id && !dirty)} onClick={() => save({ draft: true })}>
            {t('version.saveDraft', 'Save draft')}
          </Button>
          <Button type="submit" form={formId} size={size} className={`${publishColour} ${tall}`} data-button="publish" disabled={busy || autosaved === 'saving' || (!dirty && status === 'published')}>
            {busy ? <Spinner /> : null}
            {t('version.publishChanges', 'Publish changes')}
          </Button>
        </>
      ) : (
        // Waits for a change on an update alone: a create is pressed to be checked.
        <Button type="submit" form={formId} size={size} className={tall} disabled={busy || (on === 'update' && !dirty)}>
          {busy ? <Spinner /> : null}
          {t('admin.save', 'Save')}
        </Button>
      )}
    </>
    )
    // `flex-wrap`: a row that cannot wrap is as wide as all its buttons together, which widens every grid
    // and flex box above it past a phone's width.
    if (!header) return <div className="flex flex-wrap items-center justify-end gap-2 rtl:justify-start">{actions}</div>
    // Below sm the header keeps the trigger, title and pill, and the rest moves to a bar fixed to the bottom of the
    // screen; from sm up the bar is `contents`. Inside a sheet or dialog the row sticks to the popup's foot instead.
    return (
      <div className="ms-auto flex min-w-min items-center justify-end gap-2 sm:flex-wrap max-sm:in-[[role=dialog]]:bg-background max-sm:in-[[role=dialog]]:sticky max-sm:in-[[role=dialog]]:bottom-0 max-sm:in-[[role=dialog]]:z-20 max-sm:in-[[role=dialog]]:order-last max-sm:in-[[role=dialog]]:w-full max-sm:in-[[role=dialog]]:border-t">
        {/* Coloured by status and always carrying its word, never the colour alone. The row shrinks no further
            than the narrowest it can be drawn, so the title beside it wraps rather than sitting under it. */}
        {status ? (
          <Badge data-status={status} className={pills[status]} title={t('version.status', 'Status')}>
            {t(`version.${status}`, { draft: 'Draft', published: 'Published', changed: 'Changed' }[status])}
          </Badge>
        ) : null}
        <div
          data-action-bar=""
          ref={measureBar}
          className="max-sm:bg-background max-sm:fixed max-sm:in-[[role=dialog]]:static max-sm:in-[[role=dialog]]:flex-1 max-sm:in-[[role=dialog]]:border-t-0 max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:justify-end max-sm:gap-2 max-sm:border-t max-sm:px-4 max-sm:pt-2 max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:contents"
        >
          {actions}
        </div>
      </div>
    )
  }
  // On a screen's page the title is the page's own `title` node, so the form keeps only the sentence under it.
  const chrome = (
    <>
    {/* On a screen's page a kayan with no sentence draws no header and no rule under it. */}
    {headed ? (
      <header className="max-w-3xl">
        {screen ? null : <h1 className="text-2xl font-bold tracking-tight">{titleOf({ kayan, copy })}</h1>}
        {about ? <p className="text-muted-foreground mt-1 text-sm">{about}</p> : null}
      </header>
    ) : null}
    {shown && !controlled ? (
      <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
        {banner}
      </p>
    ) : null}
    {controlled ? viewSwitch('xl:hidden', true) : null}
    {status === 'changed' && viewing ? (
      <p data-draft-banner="published" className="bg-muted text-muted-foreground rounded-md border px-3 py-1.5 text-sm">
        {t('version.readOnlyPublished', 'Read only. This is the published version.')}
      </p>
    ) : status === 'changed' ? (
      <div data-draft-banner="draft" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-900 dark:text-amber-200">
        <span className="me-auto">{t('version.editingDraft', 'You are editing a draft. The published version is different.')}</span>
        {client.findByID ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void choose('published')}>
            {t('version.viewPublished', 'View published')}
          </Button>
        ) : null}
        {/* Restores the row's own published copy, which needs both keys a restore needs. */}
        {operations?.restoreVersion === true && client.run ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="link" size="sm" className="text-destructive h-auto p-0" disabled={busy || autosaved === 'saving'}>
                  {t('admin.discard', 'Discard changes')}
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('version.confirmRevertToSaved', 'Confirm revert to saved')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('version.aboutToRevertToPublished', 'You are about to revert this document\'s changes to its published state. Are you sure?')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="max-sm:[&_button]:h-11">
                <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" data-button="confirm-discard-draft" disabled={busy || autosaved === 'saving'} onClick={() => void run(() => client.run!('restoreVersion', { id, ...readAt(expectedUpdatedAtOn?.includes('restoreVersion')) }), 'update', undefined, 'published')}>
                  {t('admin.discard', 'Discard changes')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    ) : null}
    </>
  )
  return (
    // The provider is around the whole screen, not just the column of inputs, so a panel the project
    // registered binds a field of this form through `useKayanField` wherever the layout put it.
    <KayanForm.Provider value={{ check, forget, form, issues: sentences, locales: localesOf(held), on, writes }}>
      <FormContext value={{ getData: () => showing, setValue, disabled: busy || viewing, saves, expectedUpdatedAtOn }}>
      {/* One question for both ways out, Cancel and a blocked navigation,
          kept mounted so nothing but an answer closes it. */}
      <DiscardDialog
        t={t}
        busy={busy || autosaved === 'saving' || leaving}
        open={asking || !!blocked}
        note={keepsDraft ? (t('admin.discardKeepsDraft', 'The draft saved so far is kept.') ?? 'The draft saved so far is kept.') : undefined}
        onOpenChange={(open) => {
          if (open || leaving) return
          setAsking(false)
          blocked?.reset()
        }}
        onDiscard={() => void discard(blocked ? blocked.proceed : onCancel ?? (() => {}))}
      />
      {nodes || screen ? (
      <div className="flex flex-1 flex-col gap-6">{nodes ? walk([{ form: [...nodes] }]) : pageOf(screen!, draw)}</div>
      ) : (
      <form id={formId} noValidate onSubmit={submit} className="flex flex-1 flex-col gap-6">
      {chrome}
      <div className="border-t pt-6">
        <div className={provided.length ? 'grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]' : 'max-w-3xl'}>
          {/* A div and not a `main`: the page's shell already holds the one main landmark. */}
          <div data-fields="" className="grid min-w-0 gap-4">
            <Card className="overflow-visible">
              <CardContent className="flex flex-col gap-4">
                {rest.length ? <div className="flex flex-col gap-4">{rest.map((field) => control(field.name))}</div> : null}
                {actionsOf(false)}
              </CardContent>
            </Card>
          </div>
          {provided.length ? (
            <aside className="grid h-fit gap-4 lg:sticky lg:top-20">
              <Card className="overflow-visible rounded-lg">
                <CardHeader>
                  <CardTitle>
                    <h2 className="text-base font-medium">{t('admin.record', 'Record') ?? 'Record'}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">{provided.map(sideEntry)}</CardContent>
              </Card>
            </aside>
          ) : null}
        </div>
      </div>
      </form>
      )}
      </FormContext>
    </KayanForm.Provider>
  )
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 6a3950dbcb0d13b0f3d3943056ec08b120e52ccaf71877c2bf0e29a7823bbbdc
