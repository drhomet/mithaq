import type { ReactElement } from 'react'
import type { ClientKayan, LeafClient } from 'mithaq/admin'
import { besideLabel, controlFor, namedControl, useComponents } from 'mithaq-admin/components.tsx'
import type { ControlProps, FindApi } from 'mithaq-admin/control-props.ts'
import { descriptionFor, labelFor, placeholderFor, type Copy } from 'mithaq-admin/copy.ts'
import { FieldShell, describedBy } from 'mithaq-admin/field-shell.tsx'
import { refOf, type ScreenPage } from 'mithaq-admin/screen-refs.ts'

/**
 * One field's control in its shell, as the form draws a leaf. The leaf's copy, width and read-only win over the field's;
 * a component named by path gets the props its place hands it, any other name is a registry control.
 */
export function LeafControl({
  field,
  kayan,
  leaf,
  screen,
  copy,
  error,
  invalidLocales,
  onBlur,
  ...rest
}: Omit<ControlProps, 'id' | 't' | 'locale' | 'placeholder' | 'describedBy' | 'client'> & {
  leaf?: LeafClient
  screen?: ScreenPage
  copy: Copy
  /** The locales of a localized field a refusal named by its path, `title.ar`, whose boxes alone are marked. */
  invalidLocales?: readonly string[]
  onBlur?: () => void
  kayans?: readonly ClientKayan[]
  api?: FindApi
}): ReactElement {
  const { kayans, ...props } = rest
  const { locale } = copy
  const chosen = leaf?.component ?? field.component
  const Ref = refOf({ screen, place: 'control', path: chosen })
  const { controls } = useComponents()
  const Control = namedControl(controls, leaf?.component) ?? controlFor(controls, field)
  const inputId = `${kayan.name}-${field.name}`
  const description = leaf?.description?.[locale] ?? descriptionFor({ kayan, field, copy })
  const readOnly = props.readOnly || leaf?.readOnly === true
  const placeholder = leaf?.placeholder?.[locale] ?? placeholderFor({ kayan, field, copy })
  // A localized field is one box per locale under one label, the viewer's own first and carrying the
  // field's id; a change to one box writes the whole object, which is how the store takes it.
  if (field.rules.localized === true && !Ref) {
    const held = (props.value && typeof props.value === 'object' ? props.value : {}) as Record<string, unknown>
    const names = new Intl.DisplayNames([locale], { type: 'language' })
    const order = [locale, ...(copy.locales ?? []).filter((one) => one !== locale)]
    // Marks the locales a refusal's paths name; before any save, the empty boxes of a required field;
    // any other refusal marks every box.
    const blank = (one: string) => held[one] === undefined || held[one] === null || held[one] === ''
    const marked = (one: string) =>
      !error ? false
      : invalidLocales?.length ? invalidLocales.includes(one)
      : field.rules.required === true && order.some(blank) ? blank(one)
      : true
    const label = labelFor({ kayan, field, copy })
    return (
      <FieldShell id={inputId} label={label} description={description} error={error} onBlur={onBlur} control={chosen} width={leaf?.width ?? field.width}>
        <div className="grid gap-2">
          {order.map((one) => (
            <div key={one} className="grid gap-1">
              {/* The viewer's own box is named by the field's label, every other box by the label and its locale. */}
              {one === locale ? (
                <span id={`${inputId}-${one}-locale`} className="text-muted-foreground text-xs">{names.of(one)}</span>
              ) : (
                <label id={`${inputId}-${one}-locale`} htmlFor={`${inputId}-${one}`} className="text-muted-foreground text-xs">
                  <span className="sr-only">{label} </span>
                  {names.of(one)}
                </label>
              )}
              <Control
                {...props}
                field={field}
                kayan={kayan}
                client={kayans}
                t={copy.t}
                locale={locale}
                locales={copy.locales}
                id={one === locale ? inputId : `${inputId}-${one}`}
                value={held[one]}
                onChange={(next) => props.onChange({ ...held, [one]: next })}
                readOnly={readOnly}
                error={marked(one) ? error : undefined}
                placeholder={placeholder}
                describedBy={[`${inputId}-${one}-locale`, describedBy({ id: inputId, description, error })].filter(Boolean).join(' ')}
              />
            </div>
          ))}
        </div>
      </FieldShell>
    )
  }
  return (
    <FieldShell
      id={inputId}
      label={labelFor({ kayan, field, copy })}
      description={description}
      error={error}
      onBlur={onBlur}
      beside={!Ref && besideLabel(controls, Control)}
      control={chosen}
      width={leaf?.width ?? field.width}
    >
      {Ref && screen ? (
        <Ref id={inputId} describedBy={describedBy({ id: inputId, description, error })} form={props.form} field={field} value={props.value} onChange={props.onChange} readOnly={readOnly} issue={error ?? null} />
      ) : (
        <Control
          {...props}
          field={field}
          kayan={kayan}
          client={kayans}
          t={copy.t}
          locale={locale}
          locales={copy.locales}
          id={inputId}
          readOnly={readOnly}
          error={error}
          placeholder={placeholder}
          describedBy={describedBy({ id: inputId, description, error })}
        />
      )}
    </FieldShell>
  )
}
