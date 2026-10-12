// The dashboard's one page that belongs to no kayan: who works in the viewer's organization and the roles each holds, and the one place a member's roles are changed.
// The `loader` reads as the viewer: members from the provider's `list-members` (the active organization only), assignments from `memberRoles`, and the roles the sheet offers: the fixed ones from their code and the organization's own from `roles`, never a platform role.
// Invitations, cancellations and removals go through the provider's own routes, which the auth template gates by `invitation.create`, `invitation.cancel` and `member.delete`.
import { useEffect, useId, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { holds, type LoaderTools, type PageProps } from 'mithaq/admin'
import { useAccess, useClient, useLocale, useUser } from 'mithaq/admin/react'
import type { asas } from '../asas.ts'
import { authArm } from '@/api.ts'
import { refusalKey } from '@/copy.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate } from '@/components/mithaq/controls.tsx'
import { FieldShell, describedBy } from '@/components/mithaq/field-shell.tsx'
import { grantable, isOwner, managesRoles, OWNER_ROLE } from '../roles/grants.ts'
import { tenantRoles } from '../tenant-roles.ts'
import { AppShell } from '../ui/app-shell.tsx'

/**
 * One member as the page draws it: each role assignment by its row, and whether they own the organization, which holds `administrator` whatever the rows say.
 */
export type Member = { userId: string; name: string; email: string; joined: string; owner: boolean; roles: { id: string; role: string }[] }
/**
 * One role the sheet offers: its label in every locale, whether this project ships it, and its keys, which a fixed role's
 * code always says and a custom role's row says where the viewer may read them.
 */
export type Role = { name: string; label?: Readonly<Record<string, string>>; fixed: boolean; permissions?: readonly string[] }
export type Invite = { id: string; email: string; expiresAt: string }
/** `invites` is there only for a viewer who may invite, and lists what is pending. */
export type MembersData = { members: Member[]; roles: Role[]; invites?: Invite[] }

/**
 * Whether a governance role lets its member invite: `owner` and `admin` hold `invitation.create`, and `member` holds nothing but reading the role list,
 * so the provider refuses a `member` the invitation whatever keys it holds.
 */
const invitesAsGovernance = (role: unknown) => typeof role === 'string' && role.split(',').some((name) => name === 'owner' || name === 'admin')

/** An ISO timestamp, or `''` for a value that does not parse: `toISOString()` throws on an invalid date, and a row with no readable date is still worth drawing. */
const isoOf = (value: string): string => {
  const when = new Date(value)
  return Number.isNaN(when.getTime()) ? '' : when.toISOString()
}

export const loader = async ({ access, client, request, maxLimit }: LoaderTools): Promise<MembersData> => {
  const [listed, assigned, roles, invited] = await Promise.all([
    request('/api/auth/user/organization/list-members?limit=100').then(async (response) => {
      if (!response.ok) throw new Error(`list-members answered ${response.status}`)
      return (await response.json()) as { members: { userId: string; role: string; createdAt: string; user: { name: string; email: string } }[] }
    }),
    client({ kayan: 'memberRoles', operation: 'find', input: { limit: maxLimit, depth: 0 } }) as Promise<{ docs: { id: string; user: string; role: string }[] }>,
    // Asked only of a viewer the report lets read roles, so the page still
    // draws for one who may read the assignments and not the roles.
    holds(access, 'roles.find')
      ? (client({ kayan: 'roles', operation: 'find', input: { limit: maxLimit, depth: 0, sort: 'name' } }) as Promise<{ docs: { name: string; label?: Record<string, string> | null; permissions?: unknown }[] }>)
      : { docs: [] },
    // Asked only of a viewer who may invite: one holding the key, whose
    // governance role the provider lets invite.
    holds(access, 'invitation.create')
      ? request('/api/auth/user/organization/get-active-member-role')
          .then(async (response) => response.ok && invitesAsGovernance(((await response.json()) as { role?: unknown }).role))
          .then((invites) =>
            invites
              ? request('/api/auth/user/organization/list-invitations').then(async (response) => {
                  if (!response.ok) throw new Error(`list-invitations answered ${response.status}`)
                  return (await response.json()) as { id: string; email: string; status: string; expiresAt: string }[]
                })
              : undefined,
          )
      : undefined,
  ])
  return {
    members: listed.members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      joined: isoOf(member.createdAt),
      owner: isOwner(member.role),
      roles: assigned.docs.filter((row) => row.user === member.userId).map((row) => ({ id: String(row.id), role: row.role })),
    })),
    roles: [
      ...Object.entries(tenantRoles).map(([name, role]): Role => ({ name, label: role.label, fixed: true, permissions: role.permissions === '*' ? ['*'] : role.permissions })),
      ...roles.docs.map((row): Role => ({
        name: row.name,
        ...(row.label && { label: row.label }),
        fixed: false,
        ...(Array.isArray(row.permissions) && { permissions: row.permissions as string[] }),
      })),
    ],
    // Pending and not expired: the provider accepts neither of the others.
    ...(invited && { invites: invited.filter((one) => one.status === 'pending' && new Date(one.expiresAt).getTime() > Date.now()).map((one) => ({ id: one.id, email: one.email, expiresAt: isoOf(one.expiresAt) })) }),
  }
}

/**
 * Whether this is Vite's development server, which has no mailer, read so the
 * registry's own typecheck, which knows no Vite, reads it too.
 */
const development = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true

const sameRoles = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((name) => b.has(name))

export function Members({ loaderData }: PageProps<MembersData>) {
  const { locale, t } = useLocale()
  const client = useClient<typeof asas.router>()
  const access = useAccess()
  const me = useUser().email
  const assignments = access.collections?.memberRoles
  const roles = loaderData?.roles ?? []
  const [members, setMembers] = useState(loaderData?.members ?? [])
  const [editing, setEditing] = useState<Member>()
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string>()
  /** Whether the sheet asks to remove the member it shows, the second of the two presses a removal takes. */
  const [confirming, setConfirming] = useState(false)
  const sheet = useRef<HTMLDialogElement>(null)
  const title = useId()
  // A member's roles are changed where the report lets this actor add or
  // remove an assignment; the guard on each write still decides every role.
  const edits = assignments?.create === true || assignments?.delete === true
  // A member is removed, and an invitation cancelled, by whoever holds the
  // key the auth template gates the provider's route by; the provider's own
  // governance role still decides, and its refusal is worded below.
  const removes = holds(access, 'member.delete')
  const cancels = holds(access, 'invitation.cancel')
  const opens = edits || removes
  const invites = loaderData?.invites !== undefined
  const [pending, setPending] = useState(loaderData?.invites ?? [])
  const [pendingRefusal, setPendingRefusal] = useState<string>()
  const [copied, setCopied] = useState<string>()
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  /** Whether the email box has been left or submitted, after which it says what is wrong with it. */
  const [emailLeft, setEmailLeft] = useState(false)
  const [inviteRefusal, setInviteRefusal] = useState<string>()
  const inviteSheet = useRef<HTMLDialogElement>(null)
  const emailBox = useRef<HTMLInputElement>(null)
  const inviteTitle = useId()
  const emailId = useId()
  /**
   * This app's sentence for a refusal of the provider, by its code, or for one of the template's own, whose code is a copy key, or `fallback`.
   */
  const refused = (answered: { status: number; body: Record<string, unknown> | null }, fallback: string | undefined) => {
    const code = answered.body?.code
    const key = refusalKey(answered.status, code) ?? (typeof code === 'string' && code.startsWith('error.') ? code : undefined)
    return (key && t(key)) || fallback
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
    const made = answered.body as { id: string; email: string; expiresAt: string }
    setPending((all) => [...all.filter((one) => one.id !== made.id), { id: made.id, email: made.email, expiresAt: isoOf(made.expiresAt) }])
    inviteSheet.current?.close()
  }
  /** One pending invitation withdrawn, through the provider's own route. */
  const cancel = async (one: Invite) => {
    setPendingRefusal(undefined)
    const answered = await authArm('organization/cancel-invitation', { invitationId: one.id })
    if (!answered.ok) return setPendingRefusal(refused(answered, t('dashboard.inviteCancelRefused', 'The server refused to cancel that invitation.')))
    setPending((all) => all.filter((other) => other.id !== one.id))
  }
  /** The link the invitee opens, which development hands over by hand since no mail goes out. */
  const copyLink = async (one: Invite) => {
    await navigator.clipboard.writeText(new URL(`/auth/accept-invitation?id=${encodeURIComponent(one.id)}`, window.location.origin).href)
    setCopied(one.id)
  }

  const open = (member: Member) => {
    setEditing(member)
    setChosen(new Set(member.roles.map((one) => one.role)))
    setRefusal(undefined)
    setConfirming(false)
    sheet.current?.showModal()
  }
  // A link to one member's roles, `?member=<id>`, opens the sheet on them, as a role's delete links each member who still holds it.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('member')
    const member = members.find((one) => one.userId === asked)
    if (member && opens) open(member)
  }, [])
  const labelOf = (name: string) => roles.find((role) => role.name === name)?.label?.[locale] ?? name
  const changed = editing !== undefined && !sameRoles(chosen, new Set(editing.roles.map((one) => one.role)))

  /**
   * Writes the ticked roles as `memberRoles` rows through that kayan's own operations, so its guards judge each one: removals first, then additions, stopping at the first refusal.
   * Whatever landed before it stays shown, and only the roles the sheet lists are touched.
   */
  const save = async () => {
    if (!editing) return
    setBusy(true)
    setRefusal(undefined)
    let held = editing.roles
    try {
      for (const one of held.filter((row) => roles.some((role) => role.name === row.role) && !chosen.has(row.role))) {
        await client({ kayan: 'memberRoles', operation: 'delete', input: { id: one.id } })
        held = held.filter((row) => row !== one)
      }
      for (const role of [...chosen].filter((name) => !held.some((row) => row.role === name))) {
        const row = await client({ kayan: 'memberRoles', operation: 'create', input: { user: editing.userId, role } })
        held = [...held, { id: String(row.id), role }]
      }
      sheet.current?.close()
    } catch (thrown) {
      const key = (thrown as { data?: { key?: unknown } }).data?.key
      setRefusal((typeof key === 'string' && t(key)) || t('dashboard.membersRefused', 'The server refused that change.'))
    } finally {
      setMembers((all) => all.map((one) => (one.userId === editing.userId ? { ...one, roles: held } : one)))
      setEditing((one) => one && { ...one, roles: held })
      setBusy(false)
    }
  }
  /**
   * Takes the member out: each role they hold first, through the assignment kayan's own delete and so under its guards, then the membership through the provider's route, which refuses a member still holding a role.
   * A refused role stops it, and the sheet shows what was taken before it.
   */
  const remove = async () => {
    if (!editing) return
    /**
     * What a removal that stopped leaves the member holding, drawn in the
     * table, the sheet and its boxes alike, so the boxes tick only what is
     * still held and Save writes nothing taken back.
     */
    const kept = (held: Member['roles']) => {
      setMembers((all) => all.map((one) => (one.userId === editing.userId ? { ...one, roles: held } : one)))
      setEditing((one) => one && { ...one, roles: held })
      setChosen(new Set(held.map((row) => row.role)))
    }
    setBusy(true)
    setRefusal(undefined)
    setConfirming(false)
    let held = editing.roles
    try {
      for (const one of held) {
        await client({ kayan: 'memberRoles', operation: 'delete', input: { id: one.id } })
        held = held.filter((row) => row !== one)
      }
    } catch (thrown) {
      const key = (thrown as { data?: { key?: unknown } }).data?.key
      kept(held)
      setRefusal((typeof key === 'string' && t(key)) || t('dashboard.removeRefused', 'The server refused to remove that member.'))
      return setBusy(false)
    }
    const answered = await authArm('organization/remove-member', { memberIdOrEmail: editing.email }).finally(() => setBusy(false))
    if (!answered.ok) {
      kept(held)
      return setRefusal(refused(answered, t('dashboard.removeRefused', 'The server refused to remove that member.')))
    }
    setMembers((all) => all.filter((one) => one.userId !== editing.userId))
    sheet.current?.close()
  }

  const lockOf = (role: Role, member: Member | undefined) => {
    const assigned = member?.roles.some((row) => row.role === role.name) === true
    // The role that lets the viewer manage roles is not taken from themselves, which the server refuses too.
    const own = assigned && member?.email === me && role.permissions !== undefined && managesRoles(role.permissions)
    // The owner holds administrator whatever the rows say, so the box is
    // ticked and locked, and the server refuses removing the row anyway.
    const owned = role.name === OWNER_ROLE && member?.owner === true
    // Unticking removes an assignment and ticking adds one, so each needs its
    // own operation, and either needs a role the viewer may hand over.
    const locked = own || owned || !grantable(access, role.permissions) || (assigned ? assignments?.delete !== true : assignments?.create !== true)
    return { assigned, own, owned, locked }
  }
  /**
   * Whether the viewer may remove the member shown: one who may remove members, never themselves, and only where every role the member holds is one the sheet lets them take,
   * the rule the server's guards keep on each of those deletes.
   */
  const removable =
    removes && editing !== undefined && editing.email !== me && editing.roles.every((row) => {
      const role = roles.find((one) => one.name === row.role)
      return role !== undefined && !lockOf(role, editing).locked
    })

  const choice = (role: Role) => {
    const { own, owned, locked } = lockOf(role, editing)
    const disabled = busy || locked
    const keys = role.permissions
    return (
      // Only the box and the name are dimmed when the box is locked: the
      // sentence saying why stays at the muted text's own contrast.
      <label key={role.name} data-role={role.name} data-disabled={disabled} className="hover:bg-muted/70 flex items-start gap-3 rounded-md px-2 py-2">
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
          ) : null}
          {keys ? (
            <span className="text-muted-foreground text-xs">
              {keys.includes('*')
                ? t('dashboard.everyPermission', 'Every permission')
                : (t('dashboard.membersPermissions', '{count} permissions') ?? '').replace('{count}', String(keys.length))}
            </span>
          ) : null}
        </span>
      </label>
    )
  }
  const group = (fixed: boolean, heading: string | undefined) => {
    const listed = roles.filter((role) => role.fixed === fixed)
    return listed.length ? (
      <section className="grid gap-1">
        <h3 className="text-muted-foreground px-2 text-xs font-medium">{heading}</h3>
        {listed.map(choice)}
      </section>
    ) : null
  }
  // Development has no mailer, so the dialog and the pending list say how an
  // invitation reaches anyone there.
  const noMailer = development ? (
    <p data-no-mailer="" className="text-muted-foreground rounded-md border px-3 py-2">
      {t('dashboard.inviteNoMailer', 'No mailer is configured, so no email is sent. In development the link is written to the server log, and each pending invitation has a link to copy.')}
    </p>
  ) : null

  return (
    <AppShell
      regions={{
        header: (
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <h1>{t('dashboard.members', 'Members')}</h1>
            {invites ? (
              <Button type="button" size="sm" className="max-sm:h-11" data-invite="" onClick={() => inviteSheet.current?.showModal()}>
                {t('dashboard.invite', 'Invite')}
              </Button>
            ) : null}
          </div>
        ),
        main: (
          <div data-members="" className="grid gap-4">
            <p className="text-muted-foreground">{t('dashboard.membersAbout', 'Who works in this organization, and the role each holds.')}</p>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead scope="col">{t('dashboard.membersName', 'Name')}</TableHead>
                    <TableHead scope="col" className="max-sm:hidden">{t('dashboard.membersEmail', 'Email')}</TableHead>
                    <TableHead scope="col">{t('dashboard.membersRoles', 'Roles')}</TableHead>
                    <TableHead scope="col" className="max-lg:hidden">{t('dashboard.membersJoined', 'Joined')}</TableHead>
                    {opens ? (
                      <TableHead scope="col" className="max-lg:hidden">
                        <span className="sr-only">{t('dashboard.membersActions', 'Actions')}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={opens ? 5 : 4} className="h-24 text-center text-muted-foreground">
                        {t('dashboard.membersNone', 'No one works in this organization yet.')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    members.map((member) => (
                      // The whole row opens the sheet; the button is the same for the
                      // keyboard. Below a laptop's width the email folds under the name and the
                      // day joined and the button drop, so the row fits a tablet's width as well
                      // as a phone's, and the name is the button.
                      <TableRow key={member.userId} data-member={member.userId} className={opens ? 'cursor-pointer' : undefined} onClick={opens ? () => open(member) : undefined}>
                        <TableCell className="font-medium">
                          {opens ? (
                            <>
                              <span className="max-lg:hidden">{member.name}</span>
                              <button type="button" data-open-member={member.userId} aria-label={`${t('dashboard.membersEdit', 'Edit roles')}: ${member.name}`} className="min-h-11 min-w-11 text-start underline underline-offset-4 lg:hidden" onClick={(event) => {
                                event.stopPropagation()
                                open(member)
                              }}>
                                {member.name}
                              </button>
                            </>
                          ) : member.name}
                          <span className="text-muted-foreground block text-xs font-normal sm:hidden">{member.email}</span>
                        </TableCell>
                        <TableCell className="max-sm:hidden">{member.email}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {member.roles.map((one) => (
                              <Badge key={one.id} variant="secondary">
                                {labelOf(one.role)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        {/* The day in UTC, so the server's render and the browser's agree on it. */}
                        <TableCell className="whitespace-nowrap max-lg:hidden">{member.joined ? formatDate({ value: member.joined, locale, day: true }) : null}</TableCell>
                        {opens ? (
                          <TableCell className="text-end max-lg:hidden">
                            {/* Named for its member, as the phone's button is, so five rows are not five buttons of one name. */}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              data-edit-roles={member.userId}
                              aria-label={`${t('dashboard.membersEdit', 'Edit roles')}: ${member.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                open(member)
                              }}
                            >
                              {t('dashboard.membersEdit', 'Edit roles')}
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {invites && pending.length ? (
              <section data-pending="" className="grid gap-2">
                <h2 className="text-base font-medium">{t('dashboard.invitesPending', 'Invitations not yet accepted')}</h2>
                {noMailer}
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead scope="col">{t('dashboard.membersEmail', 'Email')}</TableHead>
                        <TableHead scope="col">{t('dashboard.inviteExpires', 'Expires')}</TableHead>
                        {cancels || development ? (
                          <TableHead scope="col">
                            <span className="sr-only">{t('dashboard.membersActions', 'Actions')}</span>
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pending.map((one) => (
                        <TableRow key={one.id} data-invite-row={one.email}>
                          <TableCell className="break-all">{one.email}</TableCell>
                          <TableCell className="whitespace-nowrap">{one.expiresAt ? formatDate({ value: one.expiresAt, locale, day: true }) : null}</TableCell>
                          {cancels || development ? (
                            <TableCell>
                              <div className="flex flex-wrap justify-end gap-2">
                                {development ? (
                                  <Button type="button" size="sm" variant="outline" className="max-sm:h-11" data-copy-invite={one.id} aria-label={`${t('dashboard.inviteCopy', 'Copy link')}: ${one.email}`} onClick={() => void copyLink(one)}>
                                    {copied === one.id ? t('dashboard.inviteCopied', 'Link copied') : t('dashboard.inviteCopy', 'Copy link')}
                                  </Button>
                                ) : null}
                                {cancels ? (
                                  <Button type="button" size="sm" variant="outline" className="max-sm:h-11" data-cancel-invite={one.id} aria-label={`${t('dashboard.inviteCancel', 'Cancel invitation')}: ${one.email}`} onClick={() => void cancel(one)}>
                                    {t('dashboard.inviteCancel', 'Cancel invitation')}
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {pendingRefusal ? (
                  <p role="alert" className="text-destructive text-sm">
                    {pendingRefusal}
                  </p>
                ) : null}
              </section>
            ) : null}
            {/* The invitation asks in a modal `<dialog>` for the reason the
                roles sheet below gives. Closing it, however it is closed,
                empties it, so the next invitation starts from nothing. */}
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
                  {inviteRefusal ? (
                    <p role="alert" className="text-destructive">
                      {inviteRefusal}
                    </p>
                  ) : null}
                  <footer className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => inviteSheet.current?.close()}>
                      {t('admin.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={inviting}>
                      {t('dashboard.inviteSend', 'Send invitation')}
                    </Button>
                  </footer>
                </form>
              </dialog>
            ) : null}
            {/* The side sheet is the platform's own modal `<dialog>` rather
                than shadcn's sheet, whose popup is a portal a server render
                draws nothing of: a closed dialog is in the
                document and hidden, so the first paint carries every word
                the sheet shows, which the boot's Arabic walk reads. It traps
                focus and closes on Escape by itself. A removal asks inside it
                rather than in a dialog of its own, which would open under the
                sheet's top layer. */}
            {opens ? (
              <dialog
                ref={sheet}
                aria-labelledby={title}
                data-member-sheet={editing?.userId ?? ''}
                className="bg-background text-foreground m-0 ms-auto h-dvh max-h-dvh w-3/4 max-w-sm border-s p-0 shadow-lg backdrop:bg-black/80"
              >
                <form
                  className="flex h-full flex-col text-sm"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void save()
                  }}
                >
                  <header className="grid gap-1.5 p-6">
                    <h2 id={title} className="text-base font-medium">
                      {t('dashboard.membersEdit', 'Edit roles')}
                    </h2>
                    <p className="text-muted-foreground">{editing ? `${editing.name} · ${editing.email}` : null}</p>
                  </header>
                  <div className="grid flex-1 content-start gap-4 overflow-y-auto px-6">
                    {roles.length === 0 ? <p className="text-muted-foreground">{t('dashboard.membersNoRoles', 'There is no role you may read to assign.')}</p> : null}
                    {group(true, t('dashboard.membersFixed', 'Fixed roles'))}
                    {group(false, t('dashboard.membersCustom', 'Custom roles'))}
                    {refusal ? (
                      <p role="alert" className="text-destructive">
                        {refusal}
                      </p>
                    ) : null}
                    {removable ? (
                      <section data-remove-member="" className="grid gap-2 border-t pt-4">
                        {confirming ? (
                          <>
                            <p>{t('dashboard.removeAbout', 'They lose access to this organization and every role they hold in it. Inviting them again does not give the roles back.')}</p>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="destructive" data-button="confirm-remove" disabled={busy} onClick={() => void remove()}>
                                {t('dashboard.removeConfirm', 'Remove for good')}
                              </Button>
                              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                                {t('dashboard.removeKeep', 'Keep this member')}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Button type="button" variant="outline" className="text-destructive justify-self-start" data-button="remove-member" disabled={busy} onClick={() => setConfirming(true)}>
                            {t('dashboard.removeMember', 'Remove from organization')}
                          </Button>
                        )}
                      </section>
                    ) : null}
                  </div>
                  <footer className="flex justify-end gap-2 p-6">
                    <Button type="button" variant="outline" onClick={() => sheet.current?.close()}>
                      {t('admin.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={busy || !changed}>
                      {t('admin.save', 'Save')}
                    </Button>
                  </footer>
                </form>
              </dialog>
            ) : null}
          </div>
        ),
      }}
    />
  )
}
