import { MarkNode } from '@lexical/mark'
import { HashtagNode } from '@lexical/hashtag'
import { MentionNode } from './mention-node.ts'
export { MentionNode, type Mention } from './mention-node.ts'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { CodeNode, CodeHighlightNode } from '@lexical/code-core'
import { jsonb } from 'drizzle-orm/pg-core'
import type { Klass, LexicalNode } from 'lexical'
import { z } from 'zod'
import { kind } from '../base/kinds.ts'
import { defineRukn } from '../mithaq/rukn.ts'
import type { StandardSchemaV1 } from '../mithaq/standard-schema.ts'
import type { ResolvedField } from '../mithaq/types.ts'
import { isRichText, richTextGuard, richTextReader, storedRichText, type RichTextRead, type RichTextValue } from './rich-text.ts'

export * from './rich-text.ts'
export * from './features.ts'
import { checkRichTextPolicy, defaultRichTextFeatures, defaultRichTextFonts, richTextFeatureGuard, type RichTextFeature, type RichTextFont, type RichTextPolicy, defaultMentionSources, type MentionSource, type RichTextCommentOptions } from './features.ts'

// An emptied editor still sends a root and one empty paragraph, so a blank text
// with no decorator is missing for `required`.
const refusalOf = ({ field, read, value }: { field: ResolvedField | undefined; read: (value: unknown) => RichTextRead; value: unknown }) => {
  const key = (rule: string) => (field?.kayan ? `${field.kayan}.${field.name}.${rule}` : undefined)
  const required = { message: key('required') ?? 'Required' }
  if (value === undefined && field?.rules?.required) return required
  const got = read(value)
  if ('refused' in got) return { message: key('invalid') ?? got.refused, ...(got.type && { params: { type: got.type } }) }
  if (field?.rules?.required && read !== storedRichText && got.text.trim() === '' && !got.holdsDecorator) return required
  return undefined
}

const readerOf = ({ field, nodes, policy }: { field: ResolvedField | undefined; nodes: readonly Klass<LexicalNode>[]; policy: RichTextPolicy }) => {
  const features = field?.features ?? policy.features
  checkRichTextPolicy({ ...policy, features })
  if (features.some((one) => !policy.features.includes(one))) throw new Error('A rich text field names a feature not installed by its project.')
  const selected = { ...policy, features }
  const read = field?.richText ?? richTextReader(nodes, field?.filesIn)
  if (read === storedRichText) return read
  return (value: unknown): RichTextRead => {
    const shape = richTextGuard(value)
    if (shape) return { refused: shape }
    const refused = richTextFeatureGuard({ node: (value as RichTextValue).root, policy: selected })
    return refused ? { refused } : read(value)
  }
}

const richTextKind = ({ nodes, policy }: { nodes: readonly Klass<LexicalNode>[]; policy: RichTextPolicy }) =>
  kind<RichTextValue>(isRichText)({
    label: { en: 'Rich text', ar: 'نص منسق' },
    message: { en: 'This is not rich text.', ar: 'هذا ليس نصا منسقا.' },
    rules: ['providedBy', 'required'],
    // The value is a tree, so the store searches its text and no other operator or order applies.
    operators: ['like', 'contains', 'exists'],
    sortable: false,
    targets: {
      drizzle: (field: ResolvedField) => jsonb(field.column),
      zod: (field?: ResolvedField) => {
        const read = readerOf({ field, nodes, policy })
        return z.custom<RichTextValue>().superRefine((value, ctx) => {
          const refused = refusalOf({ field, read, value })
          if (refused) ctx.addIssue({ code: 'custom', ...refused })
        })
      },
      standardSchema: (field: ResolvedField): StandardSchemaV1<unknown, RichTextValue> => {
        const read = readerOf({ field, nodes, policy })
        return {
          '~standard': {
            version: 1,
            vendor: 'mithaq',
            validate: (value) => {
              const refused = refusalOf({ field, read, value })
              return refused ? { issues: [refused] } : { value: value as RichTextValue }
            },
          },
        }
      },
      screen: { control: 'richText', cell: 'richText' },
    },
  })

/**
 * The rukn a project lays down for rich text, over its own node list:
 * `arkan: [base, richText({ nodes: richTextNodes })]`.
 */
export const richText = <const Features extends readonly RichTextFeature[] = typeof defaultRichTextFeatures>({ nodes, features = defaultRichTextFeatures as unknown as Features, fonts = defaultRichTextFonts, mentionSources = defaultMentionSources, comments }: { nodes: readonly Klass<LexicalNode>[]; features?: Features; fonts?: readonly RichTextFont[]; mentionSources?: readonly MentionSource[]; comments?: RichTextCommentOptions }) => {
  const policy = { features, fonts, ...(features.includes('mentions') && { mentionSources }), ...(features.includes('comments') && comments && { comments: { threads: comments.threads } }) }
  checkRichTextPolicy(policy)
  if (comments?.context !== undefined && typeof comments.context !== 'function') throw new Error('Comments context must be a function.')
  return defineRukn({ name: 'richText', kinds: { richText: { ...richTextKind({ nodes: [...nodes, ...(features.includes('mentions') ? [MentionNode, HashtagNode] : []), ...(features.includes('comments') ? [MarkNode] : []), ...(features.includes('tables') ? [TableNode, TableRowNode, TableCellNode] : []), ...(features.includes('code') ? [CodeNode, CodeHighlightNode] : [])], policy }), richTextPolicy: policy, ...(comments && { richTextComments: comments }) } } })
}
