// The dashboard's one page that belongs to no kayan: who works in the viewer's organization, the roles each holds and
// the invitations not yet accepted, drawn on the list table every kayan's list is drawn on, and the one place a
// member's roles are changed.
// The `loader` reads as the viewer: members from the provider's `list-members` (the active organization only, gated by
// `member.find`, each one's last seen only under `member.fields.lastSeenAt`), assignments from `memberRoles`, and the
// roles the drawer offers: the fixed ones from their code and the organization's own from `roles`, never a backoffice role.
// Invitations, cancellations, removals and password links go through the provider's own routes and the auth template's,
// which gate them by `invitation.create`, `invitation.cancel`, `member.delete` and `member.create`. Every button here
// only reflects those gates: the server keeps each one whatever the page draws.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronDown, Lock, MoreHorizontal } from 'lucide-react'
import { holds, type AccessReport, type CellProps, type ClientField, type ClientKayan, type LoaderTools, type PageProps } from 'mithaq/admin'
import { useAccess, useClient, useLocale, useUser } from 'mithaq/admin/react'
import type { asas } from '../asas.ts'
import { authArm } from '@/api.ts'
import { refusalKey } from '@/copy.ts'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate, noValue } from 'mithaq-admin/format.tsx'
import { FieldShell, describedBy } from 'mithaq-admin/field-shell.tsx'
import { ListMessage } from 'mithaq-admin/list-header.tsx'
import { ListTable } from 'mithaq-admin/list-table.tsx'
import { Search } from 'mithaq-admin/list-toolbar.tsx'
import { DocumentDrawer } from 'mithaq-admin/record-frame.tsx'
import type { ScreenPage } from 'mithaq-admin/screen-refs.ts'
import { toast } from 'mithaq-admin/toast.tsx'
import { organizations } from '@asas/mithaq/auth/organizations'
import { grantable, managesRoles, OWNER_ROLE } from '@asas/mithaq/roles/grants.ts'
import { AppShell } from '@asas/mithaq/ui/app-shell.tsx'
import { PermissionBadges } from '@asas/roles/roles/ui/role-form.tsx'
import { isoOf, readMembers, type Member, type Role } from './members-card.tsx'

/** One invitation not yet accepted: its governance role, who sent it where they are still a member, and whether it ran out. */
export type Invite = { id: string; email: string; role: string; inviter?: string; expiresAt: string; expired: boolean }
/** `invites` is there only for a viewer who may invite, and lists what is pending, run out or not. */
export type MembersData = { members: Member[]; roles: Role[]; invites?: Invite[] }

/**
 * Whether a governance role lets its member invite: `owner` and `admin` hold `invitation.create`, and `member` holds nothing but reading the role list,
 * so the provider refuses a `member` the invitation whatever keys it holds.
 */
const invitesAsGovernance = (role: unknown) => typeof role === 'string' && role.split(',').some((name) => name === 'owner' || name === 'admin')

/** An invitation as the provider answers it and as the page holds it. */
const inviteOf = (one: { id: string; email: string; role?: string | null; expiresAt: string }, inviter?: string): Invite => ({
  id: one.id,
  email: one.email,
  role: one.role || 'member',
  ...(inviter !== undefined && { inviter }),
  expiresAt: isoOf(one.expiresAt),
  expired: !(new Date(one.expiresAt).getTime() > Date.now()),
})

export const loader = async (tools: LoaderTools): Promise<MembersData> => {
  const { access, request } = tools
  const [{ members, roles }, invited] = await Promise.all([
    readMembers(tools),
    // Asked only of a viewer who may invite: one holding the key, whose
    // governance role the provider lets invite.
    holds(access, 'invitation.create')
      ? request('/api/auth/user/organization/get-active-member-role')
          .then(async (response) => response.ok && invitesAsGovernance(((await response.json()) as { role?: unknown }).role))
          .then((invites) =>
            invites
              ? request('/api/auth/user/organization/list-invitations').then(async (response) => {
                  if (!response.ok) throw new Error(`list-invitations answered ${response.status}`)
                  return (await response.json()) as { id: string; email: string; role?: string | null; status: string; expiresAt: string; inviterId?: string }[]
                })
              : undefined,
          )
      : undefined,
  ])
  const names = new Map(members.map((member) => [member.userId, member.name]))
  return {
    members,
    roles,
    // Pending, run out or not: one run out is drawn greyed and sent again from its row. The provider accepts neither
    // an accepted, a rejected nor a cancelled one, so those are gone.
    ...(invited && { invites: invited.filter((one) => one.status === 'pending').map((one) => inviteOf(one, one.inviterId === undefined ? undefined : names.get(one.inviterId))) }),
  }
}

/**
 * Whether this is Vite's development server, which has no mailer, read so the
 * registry's own typecheck, which knows no Vite, reads it too.
 */
const development = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true

/** This app's sentence for a refusal of the provider, by its code, or for one of the template's own, whose code is a copy key. */
const refusedKey = (answered: { status: number; body: Record<string, unknown> | null }) => {
  const code = answered.body?.code
  return refusalKey(answered.status, code) ?? (typeof code === 'string' && code.startsWith('error.') ? code : undefined)
}

/**
 * "Add person", the Members page's first action with one organization: a name, an address and a role the viewer may
 * hand over, sent to the server's `add-person`, which makes the account, the membership and the role in one request and
 * mails the link that chooses the password. Someone who already has a proved account is invited instead. The page draws
 * the button that opens it.
 */
export function AddPerson({ sheet, roles, onInvited }: { sheet: RefObject<HTMLDialogElement | null>; roles: Role[]; onInvited: (invite: Invite) => void }) {
  const { locale, t } = useLocale()
  const nameId = useId()
  const emailId = useId()
  const roleId = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string>()
  // Answered only where no mailer is configured: the administrator hands it over.
  const [link, setLink] = useState<string>()
  const add = async () => {
    if (!name.trim() || !email.trim()) return setRefusal(t('auth.required', 'This field is required.'))
    setBusy(true)
    setRefusal(undefined)
    const answered = await authArm('organization/add-person', { name: name.trim(), email: email.trim(), ...(role && { role }) }).finally(() => setBusy(false))
    if (!answered.ok) {
      const key = refusedKey(answered)
      return setRefusal((key && t(key)) || t('dashboard.addPersonRefused', 'The server refused to add that person.'))
    }
    const body = answered.body as { added?: boolean; link?: string; invited?: boolean; invitation?: { id: string; email: string; role?: string; expiresAt: string } }
    if (body.invited && body.invitation) {
      onInvited(inviteOf(body.invitation))
      toast.success((t('dashboard.inviteSent', 'Invitation sent to {email}') ?? 'Invitation sent to {email}').replace('{email}', () => body.invitation!.email))
      return sheet.current?.close()
    }
    if (body.link) {
      toast.success((t('dashboard.personAddedLink', '{name} added. Hand them the link below.') ?? '{name} added. Hand them the link below.').replace('{name}', () => name.trim()))
      return setLink(body.link)
    }
    toast.success((t('dashboard.personAdded', '{name} added. A link to choose a password was sent to {email}.') ?? '{name} added. A link to choose a password was sent to {email}.').replace('{name}', () => name.trim()).replace('{email}', () => email.trim()))
    sheet.current?.close()
    // The new member and their role are read again in place, so the toast that says so stays.
    window.dispatchEvent(new Event('mithaq:refresh'))
  }
  return (
    <dialog
      ref={sheet}
      data-add-person-sheet=""
      aria-label={t('dashboard.addPersonTitle', 'Add a person')}
      className="bg-background text-foreground m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/80"
      onClose={() => {
        if (link) window.dispatchEvent(new Event('mithaq:refresh'))
        setName('')
        setEmail('')
        setRole('')
        setLink(undefined)
        setRefusal(undefined)
      }}
    >
      <form noValidate className="grid gap-4 p-6 text-sm" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <header className="grid gap-1.5">
          <h2 className="text-base font-medium">{t('dashboard.addPersonTitle', 'Add a person')}</h2>
          <p className="text-muted-foreground">{t('dashboard.addPersonAbout', 'They get an account here and a link by email to choose their password. Someone who already has an account is sent an invitation instead.')}</p>
        </header>
        {link ? (
          <HandedLink link={link} said={t('dashboard.addPersonLink', 'No mailer is configured. Hand this link to them alone: it chooses their password and lasts 48 hours.')} />
        ) : (
          <>
            <FieldShell id={nameId} label={t('dashboard.membersName', 'Name') ?? 'Name'}>
              <Input id={nameId} value={name} maxLength={100} autoComplete="off" disabled={busy} onChange={(event) => setName(event.target.value)} />
            </FieldShell>
            <FieldShell id={emailId} label={t('dashboard.membersEmail', 'Email') ?? 'Email'}>
              <Input id={emailId} type="email" dir="ltr" value={email} autoComplete="off" disabled={busy} onChange={(event) => setEmail(event.target.value)} />
            </FieldShell>
            <FieldShell id={roleId} label={t('dashboard.addPersonRole', 'Role') ?? 'Role'}>
              <select id={roleId} value={role} disabled={busy} className="border-input bg-background h-9 rounded-md border px-3 max-sm:h-11" onChange={(event) => setRole(event.target.value)}>
                <option value="">{t('dashboard.addPersonNoRole', 'No role yet')}</option>
                {roles.map((one) => <option key={one.name} value={one.name}>{one.label?.[locale] ?? one.name}</option>)}
              </select>
            </FieldShell>
          </>
        )}
        {refusal ? <p role="alert" className="text-destructive">{refusal}</p> : null}
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => sheet.current?.close()}>{link ? t('admin.close', 'Close') : t('admin.cancel', 'Cancel')}</Button>
          {link ? null : <Button type="submit" className="max-sm:h-11" disabled={busy}>{t('dashboard.addPersonSubmit', 'Add')}</Button>}
        </footer>
      </form>
    </dialog>
  )
}

/** A link answered where no mailer is configured, for the administrator to hand over, in a box that selects itself. */
function HandedLink({ link, said }: { link: string; said: ReactNode }) {
  const { t } = useLocale()
  return (
    <div data-handed-link="" className="grid gap-2">
      <p>{said}</p>
      <Input readOnly dir="ltr" value={link} aria-label={t('dashboard.link', 'Link')} onFocus={(event) => event.currentTarget.select()} />
      <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success(t('dashboard.inviteCopied', 'Link copied') ?? 'Link copied'))}>
        {t('dashboard.inviteCopy', 'Copy link')}
      </Button>
    </div>
  )
}

const sameRoles = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((name) => b.has(name))

/**
 * Whether the viewer may tick or untick `role` for `member`, and why not. Unticking removes an assignment and ticking adds
 * one, so each needs its own operation, and either needs a role the viewer may hand over. The server's guards decide
 * every write whatever this answers.
 */
const lockOf = ({ access, me, member, role }: { access: AccessReport; me: string | undefined; member: Member; role: Role }) => {
  const assignments = access.collections?.memberRoles
  const assigned = member.roles.some((row) => row.role === role.name)
  // The role that lets the viewer manage roles is not taken from themselves, which the server refuses too.
  const own = assigned && member.email === me && role.permissions !== undefined && managesRoles(role.permissions)
  // The owner holds administrator whatever the rows say, so the box is ticked and locked, and the server refuses
  // removing the row anyway.
  const owned = role.name === OWNER_ROLE && member.owner
  const locked = own || owned || !grantable(access, role.permissions) || (assigned ? assignments?.delete !== true : assignments?.create !== true)
  return { own, owned, locked }
}

/**
 * Edit roles: Payload's document drawer over the page, listing every role with what it grants, grouped by screen and
 * kayan, each with a box that gives or takes it. A box the viewer may not change is disabled, with the reason where
 * there is one. Saving writes `memberRoles` rows through that kayan's own operations, so its guards judge each one:
 * removals first, then additions, stopping at the first refusal, and whatever landed before it stays shown.
 */
function RolesDrawer({ member, roles, onClose, onHeld }: { member: Member; roles: Role[]; onClose: () => void; onHeld: (held: Member['roles']) => void }) {
  const { locale, t } = useLocale()
  const client = useClient<typeof asas.router>()
  const access = useAccess()
  const me = useUser().email
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(member.roles.map((one) => one.role)))
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string>()
  const changed = !sameRoles(chosen, new Set(member.roles.map((one) => one.role)))
  const save = async () => {
    setBusy(true)
    setRefusal(undefined)
    let held = member.roles
    try {
      for (const one of held.filter((row) => roles.some((role) => role.name === row.role) && !chosen.has(row.role))) {
        await client({ kayan: 'memberRoles', operation: 'delete', input: { id: one.id } })
        held = held.filter((row) => row !== one)
      }
      for (const role of [...chosen].filter((name) => !held.some((row) => row.role === name))) {
        const row = await client({ kayan: 'memberRoles', operation: 'create', input: { user: member.userId, role } })
        held = [...held, { id: String(row.id), role }]
      }
      toast.success((t('dashboard.rolesSaved', 'Roles saved for {name}') ?? 'Roles saved for {name}').replace('{name}', () => member.name))
      onHeld(held)
      onClose()
    } catch (thrown) {
      const key = (thrown as { data?: { key?: unknown } }).data?.key
      setRefusal((typeof key === 'string' && t(key)) || t('dashboard.membersRefused', 'The server refused that change.'))
      onHeld(held)
    } finally {
      setBusy(false)
    }
  }
  const choice = (role: Role) => {
    const { own, owned, locked } = lockOf({ access, me, member, role })
    const disabled = busy || locked
    return (
      // Only the box and the name are dimmed when the box is locked: the sentence saying why and what the role grants
      // stay at their own contrast.
      <div key={role.name} data-role={role.name} data-disabled={disabled} className="grid gap-2 rounded-md border p-3">
        <label className="flex items-start gap-3">
          <Checkbox
            className="mt-0.5"
            checked={owned || chosen.has(role.name)}
            disabled={disabled}
            onCheckedChange={(on) => setChosen((now) => (on ? new Set([...now, role.name]) : new Set([...now].filter((name) => name !== role.name))))}
          />
          <span className="grid gap-0.5">
            <span className={`flex items-center gap-1.5 font-medium${disabled ? ' opacity-50' : ''}`}>
              {role.fixed ? <Lock className="text-muted-foreground size-3.5" aria-hidden="true" /> : null}
              {role.label?.[locale] ?? role.name}
            </span>
            {owned ? (
              <span data-owner="" className="text-muted-foreground text-xs">{t('dashboard.membersOwnerRole', 'The owner of the organization always holds this role.')}</span>
            ) : own ? (
              <span data-own="" className="text-muted-foreground text-xs">{t('dashboard.membersOwnRole', 'This role lets you manage roles, so only another member who may manage roles takes it from you.')}</span>
            ) : grantable(access, role.permissions) ? null : (
              <span data-locked="" className="text-muted-foreground text-xs">{t('dashboard.membersNotGrantable', 'It grants keys you do not hold, so only someone who holds them gives or takes it.')}</span>
            )}
          </span>
        </label>
        {role.permissions ? <div className="ps-7"><PermissionBadges held={role.permissions} /></div> : null}
      </div>
    )
  }
  const group = (fixed: boolean, heading: string | undefined) => {
    const listed = roles.filter((role) => role.fixed === fixed)
    return listed.length ? (
      <section className="grid gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">{heading}</h3>
        {listed.map(choice)}
      </section>
    ) : null
  }
  return (
    <DocumentDrawer title={`${t('dashboard.membersEdit', 'Edit roles')}: ${member.name}`} edit={member.userId} closeLabel={t('admin.close', 'Close') ?? 'Close'} onClose={onClose}>
      <form
        data-member-sheet={member.userId}
        className="mx-auto grid w-full max-w-3xl gap-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <p className="text-muted-foreground"><bdi>{member.name}</bdi> · <bdi dir="ltr">{member.email}</bdi></p>
        {roles.length === 0 ? <p className="text-muted-foreground">{t('dashboard.membersNoRoles', 'There is no role you may read to assign.')}</p> : null}
        {group(true, t('dashboard.membersFixed', 'Fixed roles'))}
        {group(false, t('dashboard.membersCustom', 'Custom roles'))}
        {refusal ? <p role="alert" className="text-destructive">{refusal}</p> : null}
        <footer className="bg-background sticky bottom-0 flex justify-end gap-2 border-t py-3">
          <Button type="button" variant="outline" className="max-sm:h-11" onClick={onClose}>{t('admin.cancel', 'Cancel')}</Button>
          <Button type="submit" className="max-sm:h-11" disabled={busy || !changed}>{t('admin.save', 'Save')}</Button>
        </footer>
      </form>
    </DocumentDrawer>
  )
}

/** A member's name with their address under it, which the first column of the list draws. */
function PersonCell({ row }: CellProps) {
  return (
    <span className="grid">
      <span className="font-medium">{String(row.name ?? '')}</span>
      <bdi dir="ltr" className="text-muted-foreground text-xs">{String(row.email ?? '')}</bdi>
    </span>
  )
}

/** A member's roles, each by its label, as badges. */
function RolesCell({ value }: CellProps) {
  const labels = Array.isArray(value) ? (value as string[]) : []
  return labels.length ? <div className="flex flex-wrap gap-1">{labels.map((label) => <Badge key={label} variant="secondary">{label}</Badge>)}</div> : noValue
}

/** A day, in UTC so the server's render and the browser's agree on it, and a dash where there is none. */
function DayCell({ value }: CellProps) {
  const { locale } = useLocale()
  return (typeof value === 'string' && value && formatDate({ value, locale, day: true })) || noValue
}

/** One column of an invitation, greyed once it has run out. */
function InviteCell({ value, row }: CellProps) {
  const text = typeof value === 'string' && value ? value : undefined
  return <span className={row.expired ? 'text-muted-foreground' : undefined}>{text ?? noValue}</span>
}

/** When an invitation runs out, or that it has, greyed. */
function ExpiresCell({ value, row }: CellProps) {
  const { locale, t } = useLocale()
  const day = typeof value === 'string' && value ? formatDate({ value, locale, day: true }) : undefined
  return row.expired ? (
    <span data-expired="" className="text-muted-foreground">{t('dashboard.inviteExpired', 'Expired')}{day ? ` · ${day}` : ''}</span>
  ) : (day ?? noValue)
}

/** A column of one of the page's tables, drawn by one of the cells above or a shipped one, named in the viewer's locale. */
const columnOf = ({ name, label, cell, locale }: { name: string; label: string | undefined; cell: string; locale: string }): ClientField => ({
  name,
  kind: 'text',
  label: { [locale]: label ?? name },
  rules: {},
  component: 'text',
  cell,
  sortable: false,
})

/** The page's tables as the list table takes them: the cells by name, under a kayan of their own that no server knows. */
const tableOf = (name: string): ScreenPage => ({
  refs: { person: PersonCell, roles: RolesCell, day: DayCell, invite: InviteCell, expires: ExpiresCell } as ScreenPage['refs'],
  kayan: { name, single: false, fields: [], operations: [], pages: {} } as ClientKayan,
  page: { path: '', page: { shell: '' } },
})
const memberTable = tableOf('members')
const inviteTable = tableOf('invitations')

/** A row's menu, as every list draws one, named for the row. */
function RowActions({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-row-menu={id} aria-label={label} className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'max-sm:size-11' })}>
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Members({ loaderData }: PageProps<MembersData>) {
  const { locale, t } = useLocale()
  const client = useClient<typeof asas.router>()
  const access = useAccess()
  const me = useUser().email
  const assignments = access.collections?.memberRoles
  const roles = loaderData?.roles ?? []
  const [members, setMembers] = useState(loaderData?.members ?? [])
  const [pending, setPending] = useState(loaderData?.invites ?? [])
  // A page read again in place, after a person is added, hands the new lists.
  useEffect(() => setMembers(loaderData?.members ?? []), [loaderData?.members])
  useEffect(() => setPending(loaderData?.invites ?? []), [loaderData?.invites])
  const [tab, setTab] = useState('members')
  const [search, setSearch] = useState<string>()
  const [roleShown, setRoleShown] = useState('')
  const [editing, setEditing] = useState<Member>()
  const [removing, setRemoving] = useState<Member>()
  const [busy, setBusy] = useState(false)
  const [handed, setHanded] = useState<{ name: string; link: string }>()
  const handedSheet = useRef<HTMLDialogElement>(null)
  const addSheet = useRef<HTMLDialogElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const inviteTableRef = useRef<HTMLTableElement>(null)
  const openHint = useId()
  const roleFilter = useId()
  // A member's roles are changed where the report lets this actor add or remove an assignment; the guard on each
  // write still decides every role.
  const edits = assignments?.create === true || assignments?.delete === true
  // A member is removed, and an invitation cancelled, by whoever holds the key the auth template gates the provider's
  // route by; the provider's own governance role still decides, and its refusal is worded below.
  const removes = holds(access, 'member.delete')
  const cancels = holds(access, 'invitation.cancel')
  const invites = loaderData?.invites !== undefined
  // With one organization an administrator adds people directly, and sends one a new password link the same way.
  const adds = organizations === 'one' && holds(access, 'member.create')
  const seesLastSeen = holds(access, 'member.fields.lastSeenAt')
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  /** Whether the email box has been left or submitted, after which it says what is wrong with it. */
  const [emailLeft, setEmailLeft] = useState(false)
  const [inviteRefusal, setInviteRefusal] = useState<string>()
  const inviteSheet = useRef<HTMLDialogElement>(null)
  const emailBox = useRef<HTMLInputElement>(null)
  const inviteTitle = useId()
  const emailId = useId()
  const refused = (answered: { status: number; body: Record<string, unknown> | null }, fallback: string | undefined) => {
    const key = refusedKey(answered)
    return (key && t(key)) || fallback || ''
  }
  /**
   * What is wrong with the address typed, said once the box is left and on
   * every submit: nothing typed, or what the browser's own `type="email"`
   * refuses, so no second rule for an address is written here.
   */
  const emailError = !emailLeft
    ? undefined
    : !email.trim()
      ? t('auth.required', 'This field is required.')
      : emailBox.current?.validity.typeMismatch
        ? t('auth.invalidEmail', 'Invalid email')
        : undefined
  /** An invitation listed, or listed again in its place once sent again. */
  const listInvite = (made: Invite) => setPending((all) => [...all.filter((one) => one.id !== made.id), made])
  /**
   * One invitation, as a member: the role the provider gives on accepting, so
   * the roles of this page are given after, here, like any member's.
   */
  const invite = async () => {
    setEmailLeft(true)
    if (!email.trim() || emailBox.current?.validity.typeMismatch) return emailBox.current?.focus()
    setInviting(true)
    setInviteRefusal(undefined)
    const answered = await authArm('organization/invite-member', { email: email.trim(), role: 'member' }).finally(() => setInviting(false))
    // The provider's sentence is English alone, so the refusal is said in the viewer's locale, by its code.
    if (!answered.ok) return setInviteRefusal(refused(answered, t('dashboard.inviteRefused', 'The server refused that invitation.')))
    const made = answered.body as { id: string; email: string; role?: string; expiresAt: string }
    listInvite(inviteOf(made, members.find((one) => one.email === me)?.name))
    toast.success((t('dashboard.inviteSent', 'Invitation sent to {email}') ?? 'Invitation sent to {email}').replace('{email}', () => made.email))
    inviteSheet.current?.close()
    // Where its link is copied from.
    setTab('invitations')
  }
  /** One pending invitation mailed again with a new expiry, through the provider's own route. */
  const resend = async (one: Invite) => {
    const answered = await authArm('organization/invite-member', { email: one.email, role: one.role, resend: true })
    if (!answered.ok) return void toast.error(refused(answered, t('dashboard.inviteRefused', 'The server refused that invitation.')))
    // One run out may come back as a new invitation, which takes its place.
    const made = inviteOf(answered.body as { id: string; email: string; role?: string; expiresAt: string }, one.inviter)
    setPending((all) => [...all.filter((other) => other.id !== one.id && other.id !== made.id), made])
    toast.success((t('dashboard.inviteResent', 'Invitation sent again to {email}') ?? 'Invitation sent again to {email}').replace('{email}', () => one.email))
  }
  /** One pending invitation withdrawn, through the provider's own route. */
  const cancel = async (one: Invite) => {
    const answered = await authArm('organization/cancel-invitation', { invitationId: one.id })
    if (!answered.ok) return void toast.error(refused(answered, t('dashboard.inviteCancelRefused', 'The server refused to cancel that invitation.')))
    setPending((all) => all.filter((other) => other.id !== one.id))
    toast.success(t('dashboard.inviteCancelled', 'Invitation cancelled') ?? 'Invitation cancelled')
  }
  /** The link the invitee opens, for the inviter to hand over where the mail does not reach, in every environment. */
  const copyLink = async (one: Invite) => {
    await navigator.clipboard.writeText(new URL(`/auth/accept-invitation?id=${encodeURIComponent(one.id)}`, window.location.origin).href)
    toast.success(t('dashboard.inviteCopied', 'Link copied') ?? 'Link copied')
  }
  /** A new link to choose a password, mailed to the member, or answered to hand over where no mailer is configured. */
  const sendLink = async (member: Member) => {
    const answered = await authArm('organization/send-password-link', { userId: member.userId })
    if (!answered.ok) return void toast.error(refused(answered, t('dashboard.passwordLinkRefused', 'The server refused to send that link.')))
    const link = (answered.body as { link?: unknown } | null)?.link
    if (typeof link === 'string') {
      setHanded({ name: member.name, link })
      return handedSheet.current?.showModal()
    }
    toast.success((t('dashboard.passwordLinkSent', 'A link to choose a password was sent to {email}') ?? 'A link to choose a password was sent to {email}').replace('{email}', () => member.email))
  }
  // A link to one member's roles, `?member=<id>`, opens the drawer on them, as a role's delete links each member who still holds it.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('member')
    const member = members.find((one) => one.userId === asked)
    if (member && edits) setEditing(member)
  }, [])
  const labelOf = (name: string) => roles.find((role) => role.name === name)?.label?.[locale] ?? name
  /** What a removal or a save leaves the member holding, drawn in the table at once. */
  const hold = (member: Member, held: Member['roles']) => setMembers((all) => all.map((one) => (one.userId === member.userId ? { ...one, roles: held } : one)))
  /**
   * Whether the viewer may remove the member: one who may remove members, never themselves, and only where every role
   * the member holds is one they may take, the rule the server's guards keep on each of those deletes.
   */
  const removable = (member: Member) =>
    removes && member.email !== me && member.roles.every((row) => {
      const role = roles.find((one) => one.name === row.role)
      return role !== undefined && !lockOf({ access, me, member, role }).locked
    })
  /**
   * Takes the member out: each role they hold first, through the assignment kayan's own delete and so under its guards,
   * then the membership through the provider's route, which refuses a member still holding a role. A refused role
   * stops it, and the table shows what was taken before it.
   */
  const remove = async (member: Member) => {
    setBusy(true)
    let held = member.roles
    try {
      for (const one of held) {
        await client({ kayan: 'memberRoles', operation: 'delete', input: { id: one.id } })
        held = held.filter((row) => row !== one)
      }
    } catch (thrown) {
      const key = (thrown as { data?: { key?: unknown } }).data?.key
      hold(member, held)
      setBusy(false)
      return void toast.error((typeof key === 'string' && t(key)) || t('dashboard.removeRefused', 'The server refused to remove that member.') || '')
    }
    const answered = await authArm('organization/remove-member', { memberIdOrEmail: member.email }).finally(() => setBusy(false))
    if (!answered.ok) {
      hold(member, held)
      return void toast.error(refused(answered, t('dashboard.removeRefused', 'The server refused to remove that member.')))
    }
    setMembers((all) => all.filter((one) => one.userId !== member.userId))
    toast.success((t('dashboard.memberRemoved', '{name} removed') ?? '{name} removed').replace('{name}', () => member.name))
  }

  const term = search?.toLocaleLowerCase(locale)
  const shown = members.filter(
    (member) =>
      (!roleShown || member.roles.some((one) => one.role === roleShown) || (roleShown === OWNER_ROLE && member.owner)) &&
      (!term || `${member.name}\n${member.email}`.toLocaleLowerCase(locale).includes(term)),
  )
  const rowActionsLabel = (name: string) => (t('admin.rowActionsFor', 'Actions for {name}') ?? 'Actions for {name}').replace('{name}', () => `⁨${name}⁩`)
  const memberColumns = [
    columnOf({ name: 'person', label: t('dashboard.membersName', 'Name'), cell: 'person', locale }),
    columnOf({ name: 'roles', label: t('dashboard.membersRoles', 'Roles'), cell: 'roles', locale }),
    columnOf({ name: 'joined', label: t('dashboard.membersJoined', 'Joined'), cell: 'day', locale }),
    ...(seesLastSeen ? [columnOf({ name: 'lastSeen', label: t('member.lastSeenAt', 'Last seen'), cell: 'day', locale })] : []),
  ]
  const inviteColumns = [
    columnOf({ name: 'email', label: t('dashboard.membersEmail', 'Email'), cell: 'invite', locale }),
    columnOf({ name: 'role', label: t('dashboard.addPersonRole', 'Role'), cell: 'invite', locale }),
    columnOf({ name: 'inviter', label: t('dashboard.inviteSentBy', 'Sent by'), cell: 'invite', locale }),
    columnOf({ name: 'expiresAt', label: t('dashboard.inviteExpires', 'Expires'), cell: 'expires', locale }),
  ]
  const cellsOf = (columns: ClientField[]) => new Map(columns.map((column) => [column.name, column.cell]))
  const filtered = Boolean(term || roleShown)
  // Development has no mailer, so the page says how an invitation or a password link reaches anyone there.
  const noMailer = development && (invites || adds) ? (
    <p data-no-mailer="" role="note" className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
      {t('dashboard.inviteNoMailer', 'No mailer is configured, so no email is sent. In development the link is written to the server log, and each pending invitation has a link to copy.')}
    </p>
  ) : null
  const inviteButton = (primary: boolean) => (
    <Button type="button" size="sm" variant={primary ? 'default' : 'outline'} className="max-sm:h-11" data-invite="" onClick={() => inviteSheet.current?.showModal()}>
      {t('dashboard.invite', 'Invite')}
    </Button>
  )

  return (
    <AppShell
      regions={{
        header: (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <h1 className="truncate">
              {t('dashboard.members', 'Members')} <span className="text-muted-foreground">· {new Intl.NumberFormat(locale).format(members.length)}</span>
            </h1>
            {adds ? (
              // Add person first, and inviting by a link to copy beside it, for someone who already has an account
              // elsewhere or whom the mail does not reach.
              <ButtonGroup aria-label={t('dashboard.addPerson', 'Add person')}>
                <Button type="button" size="sm" className="max-sm:h-11" data-add-person="" onClick={() => addSheet.current?.showModal()}>
                  {t('dashboard.addPerson', 'Add person')}
                </Button>
                {invites ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger data-invite-menu="" aria-label={t('dashboard.inviteByLink', 'Invite by link')} className={buttonVariants({ size: 'sm', className: 'border-s border-s-primary-foreground/30 max-sm:h-11' })}>
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem data-invite="" className="max-sm:min-h-11" onClick={() => inviteSheet.current?.showModal()}>
                        {t('dashboard.inviteByLink', 'Invite by link')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </ButtonGroup>
            ) : invites ? inviteButton(true) : null}
          </div>
        ),
        main: (
          <section data-members="" className="flex w-full min-w-0 flex-1 flex-col gap-4">
            <p className="text-muted-foreground text-sm">{t('dashboard.membersAbout', 'Who works in this organization, and the role each holds.')}</p>
            {noMailer}
            <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
              {invites ? (
                <TabsList variant="line" className="max-sm:min-h-12">
                  <TabsTrigger value="members" data-members-tab="members" className="flex-none max-sm:min-h-11">{t('dashboard.members', 'Members')}</TabsTrigger>
                  <TabsTrigger value="invitations" data-members-tab="invitations" className="flex-none max-sm:min-h-11">
                    {(t('dashboard.invitationsTab', 'Invitations ({count})') ?? 'Invitations ({count})').replace('{count}', () => new Intl.NumberFormat(locale).format(pending.length))}
                  </TabsTrigger>
                </TabsList>
              ) : null}
              {/* Both stay in the first paint, so a server render carries every word and every row of either. */}
              <TabsContent value="members" keepMounted className="data-[hidden]:hidden">
                <Card>
                  <CardContent className="grid gap-4">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                      <Search value={search} fields={[t('dashboard.membersName', 'Name') ?? 'Name', t('dashboard.membersEmail', 'Email') ?? 'Email']} locale={locale} t={t} onSearch={setSearch} />
                      <label htmlFor={roleFilter} className="sr-only">{t('dashboard.membersRoleFilter', 'Role')}</label>
                      <select id={roleFilter} data-role-filter="" value={roleShown} className="border-input bg-background h-9 rounded-md border px-3 text-sm max-sm:h-11 lg:w-56" onChange={(event) => setRoleShown(event.target.value)}>
                        <option value="">{t('dashboard.membersEveryRole', 'Every role')}</option>
                        {roles.map((one) => <option key={one.name} value={one.name}>{one.label?.[locale] ?? one.name}</option>)}
                      </select>
                    </div>
                    <ListTable
                      kayan={memberTable.kayan}
                      screen={memberTable}
                      copy={{ t, locale }}
                      shown={memberColumns}
                      cellOf={cellsOf(memberColumns)}
                      titles={new Map()}
                      docs={shown.map((member) => ({ id: member.userId, name: member.name, email: member.email, person: member.name, roles: [...new Set([...member.roles.map((one) => labelOf(one.role)), ...(member.owner && !member.roles.some((one) => one.role === OWNER_ROLE) ? [labelOf(OWNER_ROLE)] : [])])], joined: member.joined, lastSeen: member.lastSeen }))}
                      onSort={() => {}}
                      href={() => '#'}
                      openHint={openHint}
                      openRow={() => {}}
                      table={table}
                      unreadable={false}
                      actions={(row) => {
                        const member = members.find((one) => one.userId === row.id)
                        if (!member) return null
                        const linkable = adds && member.email !== me
                        const takes = removable(member)
                        return edits || linkable || takes ? (
                          <RowActions id={member.userId} label={rowActionsLabel(member.name)}>
                            {edits ? <DropdownMenuItem data-row-action="edit-roles" className="max-sm:min-h-11" onClick={() => setEditing(member)}>{t('dashboard.membersEdit', 'Edit roles')}</DropdownMenuItem> : null}
                            {linkable ? <DropdownMenuItem data-row-action="password-link" className="max-sm:min-h-11" onClick={() => void sendLink(member)}>{t('dashboard.passwordLink', 'Send a new password link')}</DropdownMenuItem> : null}
                            {takes ? <DropdownMenuItem data-row-action="remove" variant="destructive" className="max-sm:min-h-11" disabled={busy} onClick={() => setRemoving(member)}>{t('dashboard.removeMember', 'Remove from organization')}</DropdownMenuItem> : null}
                          </RowActions>
                        ) : null
                      }}
                    >
                      <ListMessage
                        count={shown.length}
                        filtered={filtered}
                        kayan={memberTable.kayan}
                        empty={t('dashboard.membersNone', 'No one works in this organization yet.')}
                        onClear={() => {
                          setSearch(undefined)
                          setRoleShown('')
                        }}
                        t={t}
                        unreadable={false}
                      />
                    </ListTable>
                  </CardContent>
                </Card>
              </TabsContent>
              {invites ? (
                <TabsContent value="invitations" keepMounted className="data-[hidden]:hidden">
                  <Card>
                    <CardContent className="grid gap-4">
                      <p className="text-muted-foreground text-sm">{t('dashboard.inviteLinkOwn', 'A copied link lets whoever holds it join as the invited address: hand it to that person alone.')}</p>
                      <ListTable
                        kayan={inviteTable.kayan}
                        screen={inviteTable}
                        copy={{ t, locale }}
                        shown={inviteColumns}
                        cellOf={cellsOf(inviteColumns)}
                        titles={new Map()}
                        docs={pending.map((one) => ({ id: one.id, email: one.email, role: t(`backoffice.membership.${one.role}`) ?? one.role, inviter: one.inviter, expiresAt: one.expiresAt, expired: one.expired }))}
                        onSort={() => {}}
                        href={() => '#'}
                        openHint={openHint}
                        openRow={() => {}}
                        table={inviteTableRef}
                        unreadable={false}
                        actions={(row) => {
                          const one = pending.find((invited) => invited.id === row.id)
                          return one ? (
                            <RowActions id={one.id} label={rowActionsLabel(one.email)}>
                              {/* A link run out joins nobody, so it is sent again rather than copied. */}
                              {one.expired ? null : <DropdownMenuItem data-row-action="copy-link" className="max-sm:min-h-11" onClick={() => void copyLink(one)}>{t('dashboard.inviteCopy', 'Copy link')}</DropdownMenuItem>}
                              <DropdownMenuItem data-row-action="resend" className="max-sm:min-h-11" onClick={() => void resend(one)}>{t('dashboard.inviteResend', 'Resend')}</DropdownMenuItem>
                              {cancels ? <DropdownMenuItem data-row-action="cancel" variant="destructive" className="max-sm:min-h-11" onClick={() => void cancel(one)}>{t('dashboard.inviteCancel', 'Cancel invitation')}</DropdownMenuItem> : null}
                            </RowActions>
                          ) : null
                        }}
                      >
                        <ListMessage count={pending.length} filtered={false} kayan={inviteTable.kayan} empty={t('dashboard.invitesNone', 'No invitation is waiting to be accepted.')} onClear={() => {}} t={t} unreadable={false} />
                      </ListTable>
                    </CardContent>
                  </Card>
                </TabsContent>
              ) : null}
            </Tabs>
            <span id={openHint} hidden />
            {adds ? <AddPerson sheet={addSheet} roles={roles.filter((role) => assignments?.create === true && grantable(access, role.permissions))} onInvited={(made) => (listInvite(made), setTab('invitations'))} /> : null}
            {/* The invitation asks in a modal `<dialog>`: a closed dialog is in the first paint, which carries every
                word it shows. Closing it, however it is closed, empties it, so the next invitation starts from nothing. */}
            {invites ? (
              <dialog
                ref={inviteSheet}
                aria-labelledby={inviteTitle}
                data-invite-sheet=""
                className="bg-background text-foreground m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/80"
                onClose={() => {
                  setEmail('')
                  setEmailLeft(false)
                  setInviteRefusal(undefined)
                }}
              >
                <form
                  noValidate
                  className="grid gap-4 p-6 text-sm"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void invite()
                  }}
                >
                  <header className="grid gap-1.5">
                    <h2 id={inviteTitle} className="text-base font-medium">{t('dashboard.inviteTitle', 'Invite someone')}</h2>
                    <p className="text-muted-foreground">{t('dashboard.inviteAbout', 'They join this organization as a member once they accept. Give them roles here after that.')}</p>
                  </header>
                  {noMailer}
                  <FieldShell id={emailId} label={t('dashboard.membersEmail', 'Email') ?? 'Email'} error={emailError} onBlur={() => setEmailLeft(true)}>
                    <Input
                      ref={emailBox}
                      id={emailId}
                      name="email"
                      type="email"
                      dir="ltr"
                      autoComplete="off"
                      disabled={inviting}
                      value={email}
                      aria-required
                      aria-invalid={emailError ? true : undefined}
                      aria-describedby={describedBy({ id: emailId, error: emailError })}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </FieldShell>
                  {inviteRefusal ? <p role="alert" className="text-destructive">{inviteRefusal}</p> : null}
                  <footer className="flex justify-end gap-2">
                    <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => inviteSheet.current?.close()}>{t('admin.cancel', 'Cancel')}</Button>
                    <Button type="submit" className="max-sm:h-11" disabled={inviting}>{t('dashboard.inviteSend', 'Send invitation')}</Button>
                  </footer>
                </form>
              </dialog>
            ) : null}
            {adds ? (
              <dialog
                ref={handedSheet}
                data-password-link-sheet=""
                aria-label={t('dashboard.passwordLink', 'Send a new password link')}
                className="bg-background text-foreground m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/80"
                onClose={() => setHanded(undefined)}
              >
                <div className="grid gap-4 p-6 text-sm">
                  <h2 className="text-base font-medium">{t('dashboard.passwordLink', 'Send a new password link')}</h2>
                  {handed ? (
                    <HandedLink link={handed.link} said={(t('dashboard.passwordLinkHanded', 'No mailer is configured. Hand this link to {name} alone: it chooses their password and lasts 48 hours.') ?? '').replace('{name}', () => handed.name)} />
                  ) : null}
                  <footer className="flex justify-end">
                    <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => handedSheet.current?.close()}>{t('admin.close', 'Close')}</Button>
                  </footer>
                </div>
              </dialog>
            ) : null}
            {editing ? <RolesDrawer member={editing} roles={roles} onClose={() => setEditing(undefined)} onHeld={(held) => hold(editing, held)} /> : null}
            <AlertDialog open={removing !== undefined} onOpenChange={(open: boolean) => (open ? undefined : setRemoving(undefined))}>
              <AlertDialogContent data-remove-member="">
                <AlertDialogHeader>
                  <AlertDialogTitle>{(t('dashboard.removeTitle', 'Remove {name}?') ?? 'Remove {name}?').replace('{name}', () => removing?.name ?? '')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('dashboard.removeAbout', 'They lose access to this organization and every role they hold in it. Inviting them again does not give the roles back.')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="max-sm:[&_button]:h-11">
                  <AlertDialogCancel>{t('dashboard.removeKeep', 'Keep this member')}</AlertDialogCancel>
                  <AlertDialogAction
                    data-button="confirm-remove"
                    variant="destructive"
                    onClick={() => {
                      const member = removing
                      setRemoving(undefined)
                      if (member) void remove(member)
                    }}
                  >
                    {t('dashboard.removeConfirm', 'Remove for good')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        ),
      }}
    />
  )
}
