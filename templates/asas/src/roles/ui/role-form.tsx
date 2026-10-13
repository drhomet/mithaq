// Draws a custom role's slug, its label in every locale and its keys as badges
// in place of the form's leaves. The form still holds, checks and saves the
// values; this reads and writes them through `useForm()`, and reads each box's
// refusal through `useKayanField`, so a box says it is required, says what is
// wrong under itself once left or refused, and marks itself invalid.
import type { ReactNode } from 'react'
import type { ComponentProps } from 'mithaq/admin'
import { useAccess, useForm, useKayan, useLocale, useScreen } from 'mithaq/admin/react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ariaRequired } from 'mithaq-admin/control-props.ts'
import { FieldShell, describedBy } from 'mithaq-admin/field-shell.tsx'
import { useKayanField } from 'mithaq-admin/form-context.tsx'
import { grantable } from '../grants.ts'
import { projectStatements } from '../../statements.ts'

/** The key a tenant's role may never hold, which the role kayan refuses by name, so no badge offers it. */
const PLATFORM_KEY = 'screen.platform'

type Key = { key: string; label: string }
type Group = { name: string; label: string; operations: Key[]; fields: Key[] }

/**
 * The keys a badge may offer, grouped: the screens the viewer enters, then each
 * kayan of this screen, its operations and then its fields, each named in the
 * viewer's locale. The screen's own projection is the catalog here, and the
 * server checks each key against `asas.catalog` and the granter anyway.
 */
const useGroups = (): Group[] => {
  const screen = useScreen()
  const access = useAccess()
  const { locale, t } = useLocale()
  const screens = (access.screens ?? []).map((name) => `screen.${name}`).filter((key) => key !== PLATFORM_KEY)
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
      operations: [...kayan.operations.map((one) => one.name), ...(Object.hasOwn(projectStatements, kayan.name) ? projectStatements[kayan.name as keyof typeof projectStatements] : [])].map((name) => ({
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
 * The keys a role holds as badges, grouped by screen and kayan. With `onChange`
 * each badge is a toggle, a key the viewer may not hand over disabled; without it
 * only the keys held are drawn. A key no group names stays, under "Other", so a
 * save never drops one.
 */
export function PermissionBadges({ held, onChange, busy }: { held: readonly string[]; onChange?: (keys: string[]) => void; busy?: boolean }) {
  const access = useAccess()
  const { t } = useLocale()
  // Read only, every screen the role enters is named, whichever the viewer
  // enters: the platform reads a tenant's role, which holds `screen.dashboard`.
  const groups = useGroups().map((group) =>
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
    const [kayan, second, field] = key.split('.')
    return (second === 'fields' && field ? t(`${kayan}.${field}`) : second ? (t(`${kayan}.operations.${second}`) ?? t(`permissions.${second}`)) : undefined) ?? key
  }
  const toggle = (key: string) => onChange?.(held.includes(key) ? held.filter((one) => one !== key) : [...held, key])
  const badges = (keys: Key[]) => {
    const shown = onChange ? keys : keys.filter((one) => held.includes(one.key))
    return shown.length ? (
      // On a phone each chip is a 44 pixel target, with room between them, so
      // a thumb does not take the key beside the one it meant.
      <div className="flex flex-wrap gap-1.5 max-sm:gap-2">
        {shown.map(({ key, label }) => {
          const on = held.includes(key)
          if (!onChange) return <Badge key={key} variant="outline" data-key={key}>{label}</Badge>
          const disabled = busy === true || !grantable(access, [key])
          return (
            <Badge
              key={key}
              variant={on ? 'default' : 'outline'}
              data-key={key}
              data-selected={on}
              data-disabled={disabled}
              className="cursor-pointer data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 max-sm:h-11 max-sm:min-w-11 max-sm:px-3"
              render={<button type="button" aria-pressed={on} disabled={disabled} onClick={() => toggle(key)} />}
            >
              {label}
            </Badge>
          )
        })}
      </div>
    ) : null
  }
  if (held.includes('*')) return <Badge variant="outline">{t('dashboard.everyPermission', 'Every permission')}</Badge>
  return (
    <div data-permissions="" className="grid gap-4">
      {groups.map((group) => {
        const operations = badges(group.operations)
        const fields = badges(group.fields)
        return operations || fields ? (
          <section key={group.name} data-group={group.name} className="grid gap-1.5">
            <h3 className="text-muted-foreground text-xs font-medium">{group.label}</h3>
            {operations}
            {fields ? (
              <>
                <p className="text-muted-foreground text-xs">{t('dashboard.permissionsFields', 'Fields')}</p>
                {fields}
              </>
            ) : null}
          </section>
        ) : null
      })}
      {other.length ? (
        <section data-group="" className="grid gap-1.5">
          <h3 className="text-muted-foreground text-xs font-medium">{t('dashboard.permissionsOther', 'Other')}</h3>
          {badges(other.map((key) => ({ key, label: otherLabel(key) })))}
        </section>
      ) : null}
    </div>
  )
}

export function RoleForm(_: ComponentProps) {
  const { disabled: readOnly, getData, setValue } = useForm()
  const { t } = useLocale()
  const fields = useKayan().fields
  const labelField = fields.find((field) => field.name === 'label')
  const values = getData()
  const label = (values.label ?? {}) as Record<string, string>
  const permissions = Array.isArray(values.permissions) ? (values.permissions as string[]) : []
  const named = { name: useKayanField('name'), label: useKayanField('label'), permissions: useKayanField('permissions') }
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
          {/* One group for the badges, named by its section and pointing at its
              refusal, so it marks itself as a box does. A group takes no
              `aria-required`, so its name says it is required instead. */}
          <div
            role="group"
            aria-label={t('dashboard.permissionsRequired', 'Permissions, required')}
            aria-invalid={named.permissions.error ? true : undefined}
            aria-describedby={named.permissions.error ? 'roles-permissions-error' : undefined}
          >
            <PermissionBadges held={permissions} busy={readOnly} onChange={(keys) => setValue('permissions', keys)} />
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
