// A fixed role is one this project ships, whose keys are code and never a row, so nothing here
// writes one.
import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { ButtonProps, CellProps, Row } from 'mithaq/admin'
import { useClient, useList, useLocale, useRecord, useScreen } from 'mithaq/admin/react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PermissionBadges } from './role-form.tsx'

/** A role's label in the viewer's locale, and its slug only where a row carries none. */
export const labelOf = (row: Row | null | undefined, locale: string) => {
  const label = row?.label as Record<string, string> | null | undefined
  return label?.[locale] ?? String(row?.name ?? '')
}

/**
 * The list node's component: the fixed roles first, from their code, each with a lock and its keys
 * one click away, then the organization's own, each opening its page. It draws no row menu; a custom
 * role's delete is its page's.
 */
export function RolesTable() {
  const { page, creates, href, newHref } = useList()
  const { locale, t } = useLocale()
  return (
    <div data-roles="" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">{t('dashboard.rolesAbout', 'Fixed roles ship with the project and cannot be changed here. Custom roles are this organization\'s own.')}</p>
        {creates ? (
          <Button size="sm" className="max-sm:h-11" nativeButton={false} render={<a href={newHref} />}>
            {t('dashboard.rolesNew', 'New role')}
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead scope="col">{t('roles.name', 'Name')}</TableHead>
              <TableHead scope="col">{t('dashboard.rolesKind', 'Kind')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(tenantRoles).map(([name, role]) => (
              <TableRow key={name} data-row={name} data-fixed="true">
                <TableCell>
                  <details data-fixed-role="">
                    <summary className="flex cursor-pointer items-center gap-1.5 font-medium max-sm:min-h-11">
                      <Lock data-lock="" className="text-muted-foreground size-3.5" aria-hidden="true" />
                      <span>{(role.label as Readonly<Record<string, string>>)[locale] ?? name}</span>
                    </summary>
                    <div className="grid gap-2 pt-2">
                      <p className="text-muted-foreground text-sm">{t('dashboard.rolesFixedAbout', 'This role ships with the project. What it holds is code, so it cannot be edited or deleted here.')}</p>
                      <PermissionBadges held={role.permissions === '*' ? ['*'] : role.permissions} />
                    </div>
                  </details>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{t('dashboard.rolesFixed', 'Fixed')}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {page.docs.map((row) => {
              const id = String(row.id)
              return (
                <TableRow key={id} data-row={id} data-fixed="false">
                  <TableCell>
                    <a href={href(id)} className="flex items-center gap-1.5 font-medium underline-offset-4 hover:underline max-sm:min-h-11">
                      <span>{labelOf(row, locale)}</span>
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t('dashboard.rolesCustom', 'Custom')}</Badge>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
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
      <Button type="button" variant="destructive" data-button="delete" disabled={busy} onClick={() => void ask()}>
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
                <a href={`${path}/members?member=${encodeURIComponent(one.id)}`} className="underline underline-offset-4">
                  {one.name}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('admin.cancel', 'Cancel')}</AlertDialogCancel>
          {holders.length ? null : (
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void run({})}>
              {t('roles.delete.confirm', 'Delete for good')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
