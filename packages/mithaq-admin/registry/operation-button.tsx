import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { ClientKayan } from 'mithaq/admin'
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
import { Button } from '@/components/ui/button'
import { besideLabel, controlFor, useComponents } from 'mithaq-admin/components.tsx'
import type { FindApi } from 'mithaq-admin/control-props.ts'
import { operationFieldLabelFor, operationLabelFor, type Copy } from 'mithaq-admin/copy.ts'
import { seedOf } from 'mithaq-admin/field-values.ts'
import { FieldShell, describedBy } from 'mithaq-admin/field-shell.tsx'
import { issuesOf, refusalWords } from 'mithaq-admin/form-rules.tsx'
import { BulkChoice, type PageButton } from 'mithaq-admin/node-buttons.tsx'
import { initialFocusIn } from 'mithaq-admin/record-frame.tsx'
import { refusalKeyOf } from 'mithaq-admin/refusal.ts'

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
  const { controls } = useComponents()
  const [held, setHeld] = useState(false)
  const open = controlled.open ?? held
  const setOpen = (next: boolean) => (controlled.onOpenChange ?? setHeld)(next)
  const fields = operation.fields ?? []
  const initial = () => operation.effect === 'create' ? seedOf(fields) : {}
  const [values, setValues] = useState<Record<string, unknown>>(initial)
  const [refused, setRefused] = useState<unknown>(undefined)
  const setValue = (name: string, next: unknown) => {
    if (!busy && fields.some((field) => field.name === name)) setValues((already) => ({ ...already, [name]: next }))
  }
  // Closing drops the refusal and the typed values, so the next opening starts empty.
  const close = () => {
    setOpen(false)
    setRefused(undefined)
    setValues(initial())
  }
  const label = operationLabelFor({ kayan, operation, copy })
  const shown = refusalKeyOf(refused)
  const issues = issuesOf(refused)
  // A bulk update whose boxes are row data: a box left empty leaves each row's value as it is, and
  // with every box empty there is nothing to write, which the server refuses too.
  const writesData = operation.updatesMany === true && fields.length > 0
  const popup = useRef<HTMLDivElement>(null)
  const about = [description, operation.confirm?.body[copy.locale], writesData && t('admin.bulkFilledOnly', 'Only the fields you fill in change.')].filter(Boolean).join(' ')

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
      <AlertDialogContent ref={popup} initialFocus={initialFocusIn(popup)} className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
        <AlertDialogHeader>
          <AlertDialogTitle>{operation.confirm?.title[copy.locale] ?? label}</AlertDialogTitle>
          {about ? <AlertDialogDescription>{about}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {shown ? (
          <p role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
            {refusalWords({ kayan: kayan.name, shown, params: (refused as { data?: { params?: Record<string, unknown> } }).data?.params, fallback: (refused as { fallback?: string }).fallback, labels: fields.filter((field) => issues[field.name] !== undefined).map((field) => operationFieldLabelFor({ kayan, operation, field, copy })), copy })}
          </p>
        ) : null}
        {/* A form and not a div, so Enter in a one-box dialog submits. */}
        <form className="flex min-h-0 flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <div data-operation-fields="" className="-m-1 grid min-h-0 gap-4 overflow-y-auto p-1">
          {fields.map((field) => {
            const Control = controlFor(controls, field)
            const inputId = `${kayan.name}-${operation.name}-${field.name}`
            const issue = issues[field.name]
            const failed = issue === undefined ? undefined : (t(issue, issue) ?? issue)
            const choice = writesData && besideLabel(controls, Control)
            return (
              <FieldShell
                key={field.name}
                id={inputId}
                label={operationFieldLabelFor({ kayan, operation, field, copy })}
                error={failed}
                beside={!choice && besideLabel(controls, Control)}
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
                  field={writesData ? { ...field, rules: { ...field.rules, required: false } } : field}
                  kayan={kayan}
                  client={kayans}
                  api={api}
                  t={writesData ? (key, fallback) => key === 'admin.clear' ? t('admin.leaveAsIs', 'Leave as is') : t(key, fallback) : t}
                  locale={copy.locale}
                  id={inputId}
                  value={values[field.name]}
                  values={values}
                  setValue={setValue}
                  onChange={(next) => setValue(field.name, writesData && next === null ? undefined : next)}
                  readOnly={busy}
                  error={failed}
                  describedBy={describedBy({ id: inputId, description: undefined, error: failed })}
                />}
              </FieldShell>
            )
          })}
          </div>
          <AlertDialogFooter className="shrink-0 max-sm:[&_button]:h-11">
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
