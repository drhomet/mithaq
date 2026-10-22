import { holds, type AccessReport, type FetchClient, type ScreenClient } from 'mithaq/admin'
import { defaultMentionSources, type Mention, type MentionSource } from 'mithaq/rich-text/client'

/** A cached mention name is public document text; only a fresh authorized read may add a link. */
export const mentionHref = async ({ mention, client, screen, sources = defaultMentionSources, access }: { mention: Mention; client: FetchClient; screen: ScreenClient; sources?: readonly MentionSource[]; access?: AccessReport }): Promise<string | undefined> => {
  const source = sources.find((one) => one.kayan === mention.kayan)
  const target = screen.kayan[mention.kayan]
  const customPage = source?.page ? screen.pages?.[source.page] : undefined
  if (customPage?.permission && (!access || !holds(access, customPage.permission))) return undefined
  const page = source?.page ? customPage : target?.pages.edit
  if (!page) return undefined
  try {
    const row = await client({ kayan: mention.kayan, operation: 'findByID', input: { id: target?.fields?.find((field) => field.name === 'id')?.kind === 'number' ? Number(mention.id) : mention.id, depth: source?.members ? 1 : 0 } }) as Record<string, unknown> | null
    const memberUser = source?.members && row && typeof row.userId === 'object' && row.userId ? (row.userId as Record<string, unknown>).id : undefined
    const id = source?.members ? memberUser : row?.id
    return id !== undefined ? `${screen.path.replace(/\/$/, '')}${page.path}`.replace(':id', encodeURIComponent(String(id))) : undefined
  } catch { return undefined }
}
