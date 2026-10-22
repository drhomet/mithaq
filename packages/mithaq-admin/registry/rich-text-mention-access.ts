import { holds, type AccessReport, type FetchClient, type ScreenClient } from 'mithaq/admin'
import { defaultMentionSources, type Mention, type MentionSource } from 'mithaq/rich-text'

/** A cached mention name is public document text; only a fresh authorized read may add a link. */
export const defaultMentionRequest = (url: string) => fetch(url)
export const mentionHref = async ({ mention, client, screen, sources = defaultMentionSources, access, request }: { mention: Mention; client: FetchClient; screen: ScreenClient; sources?: readonly MentionSource[]; access?: AccessReport; request?: typeof defaultMentionRequest }): Promise<string | undefined> => {
  const source = sources.find((one) => one.kayan === mention.kayan)
  if (source?.members && source.page) {
    const page = screen.pages?.[source.page]
    if (!page || !request || page.permission && (!access || !holds(access, page.permission))) return undefined
    try {
      const query = new URLSearchParams({ limit: '1', filterField: 'id', filterValue: mention.id, filterOperator: 'eq' })
      const response = await request(`/api/auth/${encodeURIComponent(source.members)}/organization/list-members?${query}`)
      if (!response.ok) return undefined
      const found = await response.json() as { members?: { id: string; userId: string }[] }
      const member = found.members?.find((one) => one.id === mention.id)
      return member?.userId ? `${screen.path.replace(/\/$/, '')}${page.path}`.replace(':id', encodeURIComponent(member.userId)) : undefined
    } catch { return undefined }
  }
  const target = screen.kayan[mention.kayan]
  const page = target?.pages.edit
  if (!page) return undefined
  try {
    const row = await client({ kayan: mention.kayan, operation: 'findByID', input: { id: target?.fields?.find((field) => field.name === 'id')?.kind === 'number' ? Number(mention.id) : mention.id, depth: 0 } })
    return row ? `${screen.path.replace(/\/$/, '')}${page.path}`.replace(':id', encodeURIComponent(mention.id)) : undefined
  } catch { return undefined }
}
