// Draws a custom role's slug, its label in every locale and its keys as grouped checkboxes
// in place of the form's leaves. The form still holds, checks and saves the
// values; this reads and writes them through `useForm()`, and reads each box's
// refusal through `useKayanField`, so a box says it is required, says what is
// wrong under itself once left or refused, and marks itself invalid.
import { type ComponentProps as ElementProps, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAccess, useForm, useKayan, useLocale, useScreen } from 'mithaq/admin/react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { ariaRequired } from 'mithaq-admin/control-props.ts'
import { FieldValue } from 'mithaq-admin/field-value.tsx'
import { FieldShell, describedBy } from 'mithaq-admin/field-shell.tsx'
import { useKayanField } from 'mithaq-admin/form-context.tsx'
export type PermissionOptions = { statements: Readonly<Record<string, readonly string[]>>; canGrant: (keys: readonly string[]) => boolean }

/** The key a tenant's role may never hold, which the role kayan refuses by name, so no control offers it. */
const BACKOFFICE_KEY = 'screen.backoffice'

type Key = { key: string; label: string }
type Group = { name: string; label: string; operations: Key[]; fields: Key[] }

/**
 * The keys the editor may offer, grouped: the screens the viewer enters, then each
 * kayan of this screen, its operations and then its fields, each named in the
 * viewer's locale. The screen's own projection is the catalog here, and the
 * server checks each key against `asas.catalog` and the granter anyway.
 */
const useGroups = (projectStatements: PermissionOptions['statements']): Group[] => {
  const screen = useScreen()
  const access = useAccess()
  const { locale, t } = useLocale()
  const screens = (access.screens ?? []).map((name) => `screen.${name}`).filter((key) => key !== BACKOFFICE_KEY)
  return [
    {
      name: 'screen',
      label: t('dashboard.permissionsScreens', 'Screens') ?? 'Screens',
      operations: screens.map((key) => ({ key, label: t(`screens.${key.slice('screen.'.length)}`) ?? key })),
      fields: [],
    },
    ...Object.values(screen.kayan).map((kayan) => ({
      name: kayan.name,
      label: t(`${kayan.name}.plural`) ?? kayan.name,
      operations: [...kayan.operations.map((one) => one.name), ...(Object.hasOwn(projectStatements, kayan.name) ? (projectStatements[kayan.name] ?? []) : [])].map((name) => ({
        key: `${kayan.name}.${name}`,
        label: t(`${kayan.name}.operations.${name}`) ?? t(`permissions.${name}`) ?? name,
      })),
      // A generated auth kayan's fields carry no label of their own, and the
      // project's copy names them.
      fields: kayan.fields.map((field) => ({ key: `${kayan.name}.fields.${field.name}`, label: field.label?.[locale] ?? t(`${kayan.name}.${field.name}`) ?? field.name })),
    })),
  ]
}

/**
 * A role's or a group's keys behind a row that names them and counts what they grant, closed at
 * first so a page of roles reads as a list of names; `defaultOpen` where the keys are the page's
 * work. A closed panel is `hidden="until-found"` once the page runs, so it is in the first paint
 * and a find on the page opens it. `named` names a row that draws no label of its own, so a reader
 * of the screen hears whose keys it opens. Every permission has nothing to open, so it is said.
 */
export function Grants({ label, named, held, heading, defaultOpen, children, ...root }: { label?: ReactNode; named?: string; held: readonly string[]; heading?: boolean; defaultOpen?: boolean; children: ReactNode } & ElementProps<'div'>) {
  const { locale, t } = useLocale()
  const count = held.length === 1
    ? t('dashboard.permissionsCountOne', '1 permission')
    : (t('dashboard.permissionsCount', '{count} permissions') ?? '{count} permissions').replace('{count}', () => new Intl.NumberFormat(locale).format(held.length))
  if (held.includes('*')) {
    return (
      <div {...root} className="flex items-center gap-2">
        {/* Where a chevron stands on every other row, so the names line up. */}
        <span aria-hidden="true" className="size-4 shrink-0" />
        {label}
        <span className="text-muted-foreground text-xs">{t('dashboard.everyPermission', 'Every permission')}</span>
      </div>
    )
  }
  const trigger = (
    <CollapsibleTrigger aria-label={named && `${named}: ${count}`} className="group flex w-full cursor-pointer items-center gap-2 text-start min-h-11 sm:min-h-0">
      <ChevronDown aria-hidden="true" className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180" />
      {label}
      <span className="text-muted-foreground text-xs font-normal">{count}</span>
    </CollapsibleTrigger>
  )
  return (
    <Collapsible {...root} defaultOpen={defaultOpen}>
      {heading ? <h3 className="text-sm font-medium">{trigger}</h3> : trigger}
      <CollapsibleContent hiddenUntilFound className="ps-6 pt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** Unknown held keys stay visible so editing a screen's projected catalog never silently drops them. */
export function Permissions({ held, onChange, busy, options }: { held: readonly string[]; onChange?: (keys: string[]) => void; busy?: boolean; options: PermissionOptions }) {
  const { t } = useLocale()
  const readOnly = !onChange
  // Read only, every screen the role enters is named, whichever the viewer
  // enters: the backoffice reads a tenant's role, which holds `screen.dashboard`.
  const groups = useGroups(options.statements).map((group) =>
    group.name === 'screen' && !onChange
      ? { ...group, operations: held.filter((key) => key.startsWith('screen.')).map((key) => ({ key, label: t(`screens.${key.slice('screen.'.length)}`) ?? key })) }
      : group,
  )
  const named = new Set(groups.flatMap((group) => [...group.operations, ...group.fields].map((one) => one.key)))
  const other = held.filter((key) => !named.has(key))
  /**
   * A key no group names, which is a kayan this screen does not draw or a
   * column the viewer may not read, still by its words where the copy has
   * them, `<kayan>.<field>` or the operation's, and by the key only where it
   * has none.
   */
  const otherLabel = (key: string) => {
    if (key === '*') return t('dashboard.everyPermission', 'Every permission') ?? 'Every permission'
    const [kayan, second, field] = key.split('.')
    return (second === 'fields' && field ? t(`${kayan}.${field}`) : second ? (t(`${kayan}.operations.${second}`) ?? t(`permissions.${second}`)) : undefined) ?? key
  }
  const toggle = (key: string) => onChange?.(held.includes(key) ? held.filter((one) => one !== key) : [...held, key])
  const choices = (keys: Key[]) => {
    const shown = keys.filter((one) => onChange || held.includes(one.key))
    if (readOnly) return shown.length ? <div className="flex flex-wrap gap-2 sm:gap-1.5">
      {shown.map(({ key, label }) => <Badge key={key} variant="outline" data-key={key}>{label}</Badge>)}
    </div> : null
    return shown.length ? (
      <ul className="grid gap-1 sm:grid-cols-2">
        {shown.map(({ key, label }) => {
          const on = held.includes(key)
          if (!onChange) return <li key={key} data-key={key} className="text-sm">{label}</li>
          const disabled = busy === true || !options.canGrant([key])
          return <li key={key} data-key={key} data-selected={on} data-disabled={disabled}>
            <label className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm">
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(key)} className="accent-primary size-4 shrink-0" />
              <span className={disabled ? 'text-muted-foreground' : undefined}>{label}</span>
            </label>
          </li>
        })}
      </ul>
    ) : null
  }
  if (held.includes('*') && !onChange) return <Badge variant="outline">{t('dashboard.everyPermission', 'Every permission')}</Badge>
  return (
    <div data-permissions="" className={readOnly ? 'grid gap-2' : 'grid gap-4'}>
      {groups.map((group) => {
        const operations = choices(group.operations)
        const fields = choices(group.fields)
        const keys = [...group.operations, ...group.fields].map((one) => one.key)
        return operations || fields ? (
          <Grants key={group.name} data-group={group.name} heading defaultOpen={!readOnly} label={<span>{group.label}</span>} held={held.filter((key) => keys.includes(key))}>
            <div className="grid gap-1.5">
              {operations}
              {fields && readOnly ? <>
                <p className="text-muted-foreground text-xs">{t('dashboard.permissionsFields', 'Fields')}</p>
                {fields}
              </> : fields ? (
                <details data-field-access={group.name} className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm min-h-11 sm:min-h-0">{t('dashboard.permissionsFields', 'Fields')}</summary>
                  <div className="pt-2">{fields}</div>
                </details>
              ) : null}
            </div>
          </Grants>
        ) : null
      })}
      {other.length && onChange ? <section data-group="" className="grid gap-2"><h3 className="text-sm font-medium">{t('dashboard.permissionsOther', 'Other')}</h3>{choices(other.map((key) => ({ key, label: otherLabel(key) })))}</section> : other.length ? (
        <Grants data-group="" heading defaultOpen={!readOnly} label={<span>{t('dashboard.permissionsOther', 'Other')}</span>} held={other}>
          {choices(other.map((key) => ({ key, label: otherLabel(key) })))}
        </Grants>
      ) : null}
    </div>
  )
}

export function RoleForm({ options }: { options: PermissionOptions }) {
  const { disabled: readOnly, getData, setValue } = useForm()
  const { t, locale } = useLocale()
  const kayan = useKayan()
  const fields = kayan.fields
  const access = useAccess()
  const labelField = fields.find((field) => field.name === 'label')
  const values = getData()
  const label = (values.label ?? {}) as Record<string, string>
  const permissions = Array.isArray(values.permissions) ? (values.permissions as string[]) : []
  const named = { name: useKayanField('name'), label: useKayanField('label'), permissions: useKayanField('permissions') }
  if (values.id && access.collections?.[kayan.name]?.operations?.update === false) {
    return (
      <div className="grid gap-6">
        {fields.filter((field) => field.name === 'name' || field.name === 'label').map((field) => (
          <FieldValue key={field.name} field={field} kayan={kayan} row={values} copy={{ t, locale }} />
        ))}
        <dl data-field-value="permissions" className="grid gap-2">
          <dt className="text-sm font-medium">{t('roles.permissions', 'Permissions')}</dt>
          <dd><Permissions options={options} held={permissions} /></dd>
        </dl>
      </div>
    )
  }
  const required = (name: string) => ariaRequired(fields.find((field) => field.name === name) ?? { rules: {} })
  /** Whether one locale's label box is the one refused: those the refusal names, or every one where it names none. */
  const labelWrong = (locale: string) => (named.label.error && (named.label.locales?.includes(locale) ?? true) ? named.label.error : undefined)
  const nameDescription = t('roles.name.description', 'The role\'s slug, which every assignment of it names, such as course-editor. People read the role by its label below.')
  // Two cards, as a page's sections are drawn, so a role's page reads as the
  // course pages do: the role's names, then its keys.
  const section = (heading: string, body: ReactNode) => (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-medium">{heading}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{body}</CardContent>
    </Card>
  )
  return (
    <div data-role-form="" className="grid gap-4">
      {section(t('roles.singular', 'Role') ?? 'Role', (
        <>
          {/* The name is a slug, so the box says so and reads left to right. */}
          <FieldShell id="roles-name" label={t('roles.name', 'Name') ?? 'Name'} description={nameDescription} error={named.name.error} onBlur={named.name.onBlur}>
            <Input
              id="roles-name"
              dir="ltr"
              aria-describedby={describedBy({ id: 'roles-name', description: nameDescription, error: named.name.error })}
              aria-invalid={named.name.error ? true : undefined}
              aria-required={required('name')}
              value={String(values.name ?? '')}
              readOnly={readOnly}
              onChange={(event) => setValue('name', event.target.value)}
            />
          </FieldShell>
          {Object.keys(labelField?.label ?? {}).map((locale) => {
            const id = `roles-label-${locale}`
            const error = labelWrong(locale)
            return (
              <FieldShell key={locale} id={id} label={`${t('roles.label', 'Label')} (${t(`locale.${locale}`) ?? locale})`} error={error} onBlur={named.label.onBlur}>
                <Input
                  id={id}
                  lang={locale}
                  dir="auto"
                  aria-describedby={describedBy({ id, error })}
                  aria-invalid={error ? true : undefined}
                  aria-required={required('label')}
                  value={label[locale] ?? ''}
                  readOnly={readOnly}
                  onChange={(event) => setValue('label', { ...label, [locale]: event.target.value })}
                />
              </FieldShell>
            )
          })}
        </>
      ))}
      {section(t('roles.permissions', 'Permissions') ?? 'Permissions', (
        <>
          {/* One group for the permissions, named by its section and pointing at its
              refusal, so it marks itself as a box does. A group takes no
              `aria-required`, so its name says it is required instead. */}
          <div
            role="group"
            aria-label={t('dashboard.permissionsRequired', 'Permissions, required')}
            aria-invalid={named.permissions.error ? true : undefined}
            aria-describedby={named.permissions.error ? 'roles-permissions-error' : undefined}
          >
            <Permissions options={options} held={permissions} busy={readOnly} onChange={(keys) => setValue('permissions', keys)} />
          </div>
          {named.permissions.error ? (
            <p id="roles-permissions-error" role="alert" className="text-destructive text-sm">
              {named.permissions.error}
            </p>
          ) : null}
        </>
      ))}
    </div>
  )
}
