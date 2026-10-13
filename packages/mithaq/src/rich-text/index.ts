import { jsonb } from 'drizzle-orm/pg-core'
import type { Klass, LexicalNode } from 'lexical'
import { z } from 'zod'
import { kind } from '../base/kinds.ts'
import { defineRukn } from '../mithaq/rukn.ts'
import type { StandardSchemaV1 } from '../mithaq/standard-schema.ts'
import type { ResolvedField } from '../mithaq/types.ts'
import { isRichText, richTextReader, storedRichText, type RichTextRead, type RichTextValue } from './rich-text.ts'

export * from './rich-text.ts'

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

const readerOf = ({ field, nodes }: { field: ResolvedField | undefined; nodes: readonly Klass<LexicalNode>[] }) =>
  field?.richText ?? richTextReader(nodes, field?.filesIn)

const richTextKind = ({ nodes }: { nodes: readonly Klass<LexicalNode>[] }) =>
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
        const read = readerOf({ field, nodes })
        return z.custom<RichTextValue>().superRefine((value, ctx) => {
          const refused = refusalOf({ field, read, value })
          if (refused) ctx.addIssue({ code: 'custom', ...refused })
        })
      },
      standardSchema: (field: ResolvedField): StandardSchemaV1<unknown, RichTextValue> => {
        const read = readerOf({ field, nodes })
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
export const richText = ({ nodes }: { nodes: readonly Klass<LexicalNode>[] }) =>
  defineRukn({ name: 'richText', kinds: { richText: richTextKind({ nodes }) } })
