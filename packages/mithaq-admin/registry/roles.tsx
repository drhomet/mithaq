import { useId } from 'react'
import type { Role } from 'mithaq-admin/member-types.ts'
import { Lock } from 'lucide-react'
import { useList, useLocale, useScreen } from 'mithaq/admin/react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** Counts are omitted when the caller cannot read membership and assignments. */
export function RolesTable({ roles, counts, failed }: { roles: readonly Role[]; counts?: Readonly<Record<string, number>>; failed?: boolean }) {
  const headers = useId()
  const { page, creates, href, newHref } = useList()
  const { path } = useScreen()
  const { locale, t } = useLocale()
  const rows = [...roles.filter((role) => role.fixed).map((role) => ({ ...role, id: role.name })), ...page.docs.map((row) => ({ id: String(row.id), name: typeof row.name === 'string' ? row.name : '', label: row.label as Record<string, string> | undefined, fixed: false, permissions: Array.isArray(row.permissions) ? row.permissions as string[] : undefined }))]
  return <div data-roles="" className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-muted-foreground">{t('dashboard.rolesAbout', "Fixed roles ship with the project and cannot be changed here. Custom roles are this organization's own.")}</p>
      {creates ? <Button size="sm" className="min-h-11 sm:min-h-0" nativeButton={false} render={<a href={newHref} />}>{t('dashboard.rolesNew', 'New role')}</Button> : null}
    </div>
    {failed ? <p role="status">{t('dashboard.rolesCountsFailed', 'Member counts could not be loaded.')}</p> : null}
    <div data-list-frame="" className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50"><TableRow>
          <TableHead id={`${headers}-name`} data-list-column-head="" scope="col">{t('roles.name', 'Name')}</TableHead>
          <TableHead id={`${headers}-kind`} data-list-column-head="" scope="col">{t('dashboard.rolesKind', 'Kind')}</TableHead>
          <TableHead id={`${headers}-members`} data-list-column-head="" scope="col">{t('dashboard.members', 'Members')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map((role) => <TableRow key={role.id} data-row={role.id} data-fixed={role.fixed} data-list-card="">
          <TableCell headers={`${headers}-name`} data-list-title="" className="whitespace-normal">
            <a data-list-stretched-link="" href={role.fixed ? `${path}/roles/fixed/${encodeURIComponent(role.name)}` : href(role.id)} className="inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4">
              {role.fixed ? <Lock data-lock="" className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" /> : null}
              {role.label?.[locale] ?? role.name}
            </a>
          </TableCell>
          <TableCell headers={`${headers}-kind`} data-list-detail=""><span aria-hidden="true" data-list-label="" className="sm:hidden">{t('dashboard.rolesKind', 'Kind')}:</span><div data-list-value="" className="sm:contents">{role.fixed ? t('dashboard.rolesFixed', 'Fixed') : t('dashboard.rolesCustom', 'Custom')}</div></TableCell>
          <TableCell headers={`${headers}-members`} data-member-count="" data-list-detail="" className="tabular-nums"><span aria-hidden="true" data-list-label="" className="sm:hidden">{t('dashboard.members', 'Members')}:</span><div data-list-value="" className="sm:contents">{counts && role.name ? new Intl.NumberFormat(locale).format(Object.hasOwn(counts, role.name) ? counts[role.name]! : 0) : '—'}</div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
  </div>
}
