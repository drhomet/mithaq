import type { LoaderTools, PageProps } from 'mithaq/admin'
import { useLocale, useScreen } from 'mithaq/admin/react'
import { tenantRoles } from '@asas/mithaq/roles/tenant-roles.ts'
import { AppShell } from '@asas/mithaq/ui/app-shell.tsx'
import { PermissionBadges } from '@asas/roles/roles/ui/role-form.tsx'

export const loader = async ({ params }: LoaderTools) => {
  const name = params?.name ?? ''
  const role = Object.hasOwn(tenantRoles, name) ? tenantRoles[name as keyof typeof tenantRoles] : undefined
  return { name, role }
}

export function FixedRole({ loaderData }: PageProps<Awaited<ReturnType<typeof loader>>>) {
  const { locale, t } = useLocale()
  const role = loaderData?.role
  return <AppShell breadcrumb={{ href: `${useScreen().path}/roles`, label: t('roles.plural', 'Roles') ?? 'Roles' }} regions={{ primary: null, more: null,
    header: <h1>{role?.label[locale as keyof typeof role.label] ?? t('admin.notFoundTitle', 'Page not found')}</h1>,
    main: role ? <section data-fixed-role="" className="mx-auto grid w-full max-w-3xl gap-4">
      <p>{t('dashboard.rolesFixedAbout', 'This role ships with the project. What it holds is code, so it cannot be edited or deleted here.')}</p>
      <PermissionBadges held={role.permissions === '*' ? ['*'] : role.permissions} />
    </section> : <p>{t('admin.notFound', 'That page does not exist.')}</p>,
  }} />
}
