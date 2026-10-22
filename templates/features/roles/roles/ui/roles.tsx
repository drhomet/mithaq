// A fixed role is one this project ships, whose keys are code and never a row, so nothing here
// writes one.
import { useEffect, useState } from 'react'
import { holds, type ButtonProps, type CellProps, type Row } from 'mithaq/admin'
import { useAccess } from 'mithaq/admin/react'
import { RolesTable as SharedRolesTable } from 'mithaq-admin/roles.tsx'
import { solidDestructive } from 'mithaq-admin/delete-button.tsx'
import { memberCounts } from 'mithaq-admin/member-counts.ts'
import { useClient, useLocale, useRecord, useScreen } from 'mithaq/admin/react'
import { OWNER_ROLE } from '@asas/mithaq/roles/grants.ts'
import { tenantRoles } from '@asas/mithaq/roles/tenant-roles.ts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { PermissionBadges } from './role-form.tsx'

/** A role's label in the viewer's locale, and its slug only where a row carries none. */
export const labelOf = (row: Row | null | undefined, locale: string) => {
  const label = row?.label as Record<string, string> | null | undefined
  return label?.[locale] ?? String(row?.name ?? '')
}

/** Counts use the provider directory, including the owner's implicit administrator role. */
export function RolesTable() {
  const access = useAccess()
  const client = useClient()
  const { maxLimit } = useScreen()
  const [counts, setCounts] = useState<Record<string, number>>()
  const [failed, setFailed] = useState(false)
  const readsMembers = holds(access, 'member.find')
  const readsAssignments = holds(access, 'memberRoles.find')
  useEffect(() => {
    let active = true
    setCounts(undefined)
    setFailed(false)
    if (!readsMembers || !readsAssignments) return
    void memberCounts({ client, request: fetch, maxLimit, ownerRole: OWNER_ROLE }).then((figures) => {
      if (!active) return
      setCounts(figures)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => { active = false }
  }, [readsMembers, readsAssignments])
  const roles = Object.entries(tenantRoles).map(([name, role]) => ({ name, label: role.label, fixed: true, permissions: role.permissions === '*' ? ['*'] : role.permissions }))
  return <SharedRolesTable roles={roles} counts={counts} failed={failed} />
}

/**
 * A role's keys where a page reads them as a value: grouped and named as a fixed role's page draws
 * them, never a run of slugs.
 */
export function Permissions({ value }: Pick<CellProps, 'value'>) {
  return <PermissionBadges held={Array.isArray(value) ? (value as string[]) : []} />
}

/** A page of rows as the client answers it, read untyped since a feature never imports the asas it is built into. */
type Found = { docs?: Record<string, unknown>[] } | undefined

/**
 * A custom role's delete, the danger zone's button. A role any member holds is not deleted, so the
 * button reads who holds it first: while anyone does, the dialog names them, each linking to their
 * roles on the Members page, and offers no delete. A holder list the viewer may not read asks as any
 * delete does, and the server refuses it there.
 */
export function DeleteRole({ run, busy }: ButtonProps) {
  const record = useRecord()
  const client = useClient()
  // Read at the build's most rows one served read answers, since a page past
  // it is a 400 the catch below would read as no holders at all.
  const { path, maxLimit } = useScreen()
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [holders, setHolders] = useState<{ id: string; name: string }[]>([])
  const ask = async () => {
    const held = await client({ kayan: 'memberRoles', operation: 'find', input: { where: { role: { equals: record?.name as string } }, limit: maxLimit, depth: 0 } }).catch(() => undefined) as Found
    const ids = held?.docs?.map((row) => String(row.user)) ?? []
    const named = ids.length ? await client({ kayan: 'user', operation: 'find', input: { where: { id: { in: ids } }, limit: maxLimit, depth: 0 } }).catch(() => undefined) as Found : undefined
    // A holder whose name the viewer may not read is "a member", never a raw id, and the link still
    // opens their roles.
    setHolders(ids.map((id) => ({ id, name: (named?.docs?.find((one) => one.id === id)?.name as string | undefined) ?? t('dashboard.rolesHolderUnnamed', 'A member') ?? '' })))
    setOpen(true)
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="destructive" className={`min-h-11 sm:min-h-0 ${solidDestructive}`} data-button="delete" disabled={busy} onClick={() => void ask()}>
        {t('admin.delete', 'Delete')}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{holders.length ? t('dashboard.rolesHeldTitle', 'Members hold this role') : t('dashboard.rolesDeleteTitle', 'Delete this role?')}</AlertDialogTitle>
          <AlertDialogDescription data-held={holders.length}>
            {holders.length
              ? t('dashboard.rolesHeld', 'A role a member holds is not deleted. Take it from each of them on the Members page first.')
              : t('admin.deleteWarning', 'This cannot be undone.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {holders.length ? (
          <ul data-holders="" className="grid gap-1 text-sm">
            {holders.map((one) => (
              <li key={one.id}>
                <a href={`${path}/members/${encodeURIComponent(one.id)}`} className="underline underline-offset-4">
                  {one.name}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter className="[&_button]:min-h-11 sm:[&_button]:min-h-0">
          <AlertDialogCancel>{t('admin.cancel', 'Cancel')}</AlertDialogCancel>
          {holders.length ? null : (
            <AlertDialogAction variant="destructive" className={solidDestructive} disabled={busy} onClick={() => void run({})}>
              {t('roles.delete.confirm', 'Delete for good')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
