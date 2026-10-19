import type { ComponentProps } from 'mithaq/admin'
import { useAccess } from 'mithaq/admin/react'
import { RoleForm as SharedRoleForm, Permissions, type PermissionOptions } from 'mithaq-admin/role-form.tsx'
import type { ComponentProps as Props } from 'react'
import { grantable } from '@asas/mithaq/roles/grants.ts'
import { projectStatements } from '@asas/mithaq/roles/statements.ts'

export { Grants } from 'mithaq-admin/role-form.tsx'
const useOptions = (): PermissionOptions => {
  const access = useAccess()
  return { statements: projectStatements, canGrant: (keys) => grantable(access, keys) }
}

export function PermissionBadges(props: Omit<Props<typeof Permissions>, 'options'>) {
  return <Permissions {...props} options={useOptions()} />
}

export function RoleForm(_: ComponentProps) {
  return <SharedRoleForm options={useOptions()} />
}
