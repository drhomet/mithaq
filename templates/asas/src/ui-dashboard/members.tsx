import type { LoaderTools, PageProps } from 'mithaq/admin'
import { Members as Directory, AddPerson as SharedAddPerson, inviteOf, type MembersData, type MembersOptions } from 'mithaq-admin/members.tsx'
import { holds } from 'mithaq/admin'
import { authArm } from '@/api.ts'
import { refusalKey } from '@/copy.ts'
import { organizations } from '@asas/mithaq/auth/organizations'
import { grantable, managesRoles, OWNER_ROLE } from '@asas/mithaq/roles/grants.ts'
import { AppShell } from '@asas/mithaq/ui/app-shell.tsx'
import { PermissionBadges } from '@asas/roles/roles/ui/role-form.tsx'
import { readMembers } from './members-card.tsx'
import type { ComponentProps } from 'react'

export type { Invite, MembersData } from 'mithaq-admin/members.tsx'
export const membersOptions: MembersOptions = { shell: AppShell, organizations, ownerRole: OWNER_ROLE, grantable, managesRoles, permissions: PermissionBadges, authArm, refusalKey }

/**
 * Whether a governance role lets its member invite: `owner` and `admin` hold `invitation.create`, and `member` holds nothing but reading the role list,
 * so the provider refuses a `member` the invitation whatever keys it holds.
 */
const invitesAsGovernance = (role: unknown) => typeof role === 'string' && role.split(',').some((name) => name === 'owner' || name === 'admin')

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

export function Members(props: PageProps<MembersData>) {
  return <Directory {...props} options={membersOptions} />
}

export function AddPerson(props: Omit<ComponentProps<typeof SharedAddPerson>, 'options'>) {
  return <SharedAddPerson {...props} options={membersOptions} />
}
