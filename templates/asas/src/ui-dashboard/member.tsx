import type { LoaderTools, PageProps } from 'mithaq/admin'
import { MemberPage } from 'mithaq-admin/members.tsx'
import { readMembers } from './members-card.tsx'
import { membersOptions } from './members.tsx'

export const loader = async (tools: LoaderTools) => {
  const { members, roles } = await readMembers(tools)
  return { member: members.find((one) => one.userId === tools.params?.id), roles }
}

export function Member(props: PageProps<Awaited<ReturnType<typeof loader>>>) {
  return <MemberPage member={props.loaderData?.member} roles={props.loaderData?.roles ?? []} options={membersOptions} />
}
