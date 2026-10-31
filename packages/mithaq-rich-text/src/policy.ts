/** The existing editor's choices, named so a project can spread or narrow them. */
export const defaultRichTextFeatures = ['bold', 'italic', 'underline', 'strikethrough', 'inlineCode', 'subscript', 'superscript', 'highlight', 'lowercase', 'uppercase', 'capitalize', 'headings', 'lists', 'checklist', 'quote', 'divider', 'link', 'alignment', 'indent', 'upload', 'direction'] as const
export const richTextFeatures = [...defaultRichTextFeatures, 'tables', 'code', 'styling', 'markdown', 'counter', 'mentions', 'findReplace', 'comments'] as const
export type RichTextFeature = typeof richTextFeatures[number]
export const richTextColors = { default: 'inherit', primary: 'var(--primary)', muted: 'var(--muted-foreground)', destructive: 'var(--destructive)' } as const
export const richTextSizes = { small: '0.875em', normal: '1em', large: '1.25em' } as const
export const richTextFonts = { sans: 'var(--font-sans, sans-serif)', serif: 'var(--font-serif, serif)', mono: 'var(--font-mono, monospace)' } as const
export type RichTextFont = keyof typeof richTextFonts
export const defaultRichTextFonts = ['sans', 'serif', 'mono'] as const
export type MentionSource = { readonly kayan: string; readonly title: string; readonly members?: string; readonly page?: string }
export const defaultMentionSources = [{ kayan: 'user', title: 'name', page: 'member' }] as const
export type RichTextCommentOptions = { readonly threads: string; readonly context?: (args: { request: Request; actor: unknown }) => Record<string, unknown> | Promise<Record<string, unknown>> }
export type RichTextPolicy = { features: readonly RichTextFeature[]; fonts: readonly RichTextFont[]; mentionSources?: readonly MentionSource[]; comments?: { readonly threads: string } }

/** Reject policy typos before generation or a first write, even in untyped config. */
export const checkRichTextPolicy = ({ features, fonts, mentionSources, comments }: RichTextPolicy) => {
  if (mentionSources && (!Array.isArray(mentionSources) || !mentionSources.length || mentionSources.some((source) => !source || typeof source.kayan !== 'string' || !source.kayan || source.kayan.length > 100 || typeof source.title !== 'string' || !source.title || source.title.length > 255) || new Set(mentionSources.map((source) => source.kayan)).size !== mentionSources.length)) throw new Error('Mention sources name distinct kayan and their title fields.')
  if (features.includes('comments') && (!comments || typeof comments.threads !== 'string' || !comments.threads)) throw new Error('Comments require a declared threads kayan.')
  if (!Array.isArray(features) || features.some((one) => !richTextFeatures.includes(one)) || new Set(features).size !== features.length) throw new Error('Rich text features must be distinct installed feature names.')
  if (!Array.isArray(fonts) || !fonts.length || fonts.some((one) => !Object.hasOwn(richTextFonts, one)) || new Set(fonts).size !== fonts.length) throw new Error('Rich text fonts must be distinct names from sans, serif and mono.')
}
