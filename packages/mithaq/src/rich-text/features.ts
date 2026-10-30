export { richTextFormatBits, richTextChoiceFeatures, nodeFeatures } from './feature-data.ts'
import { richTextFormatBits, nodeFeatures } from './feature-data.ts'
import { HashtagExtension } from '@lexical/hashtag'
import type { RichTextNode } from './value.ts'

export * from './policy.ts'
import { defaultMentionSources, richTextColors, richTextSizes, type RichTextFeature, type RichTextFont, type RichTextPolicy } from './policy.ts'

export const allRichTextFormats = Object.values(richTextFormatBits).reduce((mask, bit) => mask | bit, 0)
export const richTextFormatMask = (policy: RichTextPolicy) => Object.entries(richTextFormatBits).reduce((bits, [name, bit]) => bits | (policy.features.includes(name as RichTextFeature) ? bit : 0), 0)

export const richTextCodeLanguages = ['javascript', 'typescript', 'json', 'css', 'markup', 'python'] as const
export const richTextBlockTypes: readonly string[] = ['paragraph', 'heading', 'quote', 'list', 'listitem', 'table', 'tablerow', 'tablecell', 'code']
export const richTextNodeFeature = (node: RichTextNode): RichTextFeature | undefined => node.type === 'list' && node.listType === 'check' ? 'checklist' : nodeFeatures[node.type]

/** Policy runs over the original JSON so Lexical cannot silently drop an unsupported value. */
export const richTextFeatureGuard = ({ node, policy }: { node: RichTextNode; policy: RichTextPolicy }): string | undefined => {
  const { features, fonts } = policy
  const has = (feature: RichTextFeature) => features.includes(feature)
  const needed = richTextNodeFeature(node)
  if (needed && !has(needed) && !(node.type === 'listitem' && has('checklist'))) return `The field does not allow the ${needed} feature.`
  if (node.type === 'mention') {
    const sources = policy.mentionSources ?? defaultMentionSources
    if (!sources.some((source) => source.kayan === node.kayan)) return 'A mention must name a declared source.'
    if (typeof node.id !== 'string' || !node.id || node.id.length > 255 || typeof node.name !== 'string' || !node.name || node.text !== `@${node.name}`) return 'A mention carries its record id and its original name.'
    if (Object.keys(node).some((key) => !['type', 'version', 'text', 'format', 'style', 'mode', 'detail', '$', 'kayan', 'id', 'name'].includes(key))) return 'A mention stores no link or other metadata.'
  }
  if (node.type === 'hashtag') {
    const match = typeof node.text === 'string' ? HashtagExtension.config?.getHashtagMatch(node.text) : null
    if (!match || match.start !== 0 || match.end !== node.text?.length) return 'A hashtag holds its text beginning with #.'
  }
  if (node.type === 'mark' && Object.keys(node).some((key) => !['type', 'version', 'ids', 'children', 'format', 'direction', 'indent', 'textFormat', 'textStyle'].includes(key))) return 'A comment mark stores only a thread id and its marked text.'
  if (node.type === 'mark' && (!Array.isArray(node.ids) || node.ids.length !== 1 || typeof node.ids[0] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.ids[0]))) return 'A comment mark carries exactly one thread id.'
  if (node.type === 'heading' && !['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(String(node.tag))) return 'A heading must be h1 through h6.'
  if (node.type === 'list' && (!['number', 'bullet', 'check'].includes(String(node.listType)) || (node.listType === 'check' && !has('checklist')))) return 'The field does not allow this list type.'
  if (typeof node.text === 'string') {
    const allowed = richTextFormatMask(policy)
    // A complete format set stays unrestricted, as 0.3.4 accepted ignored integer bits too.
    if (typeof node.format === 'number' && allowed !== allRichTextFormats && (node.format < 0 || node.format > allowed || (node.format & ~allowed) !== 0)) return 'The field does not allow this text format.'
    if (node.mode !== undefined && !['normal', 'token', 'segmented'].includes(String(node.mode))) return 'The field does not allow this text mode.'
  } else if (node.format) {
    if (!['left', 'start', 'center', 'right', 'end', 'justify'].includes(String(node.format))) return 'This block alignment is not allowed.'
    if (!has('alignment')) return 'The field does not allow alignment.'
  }
  if (node.textFormat !== undefined && !Number.isInteger(node.textFormat)) return 'A block text format must be a whole number.'
  if (typeof node.textFormat === 'number') {
    const refused = richTextFeatureGuard({ node: { type: 'text', text: '', format: node.textFormat }, policy })
    if (refused) return refused
  }
  if (node.type === 'code' && node.language != null && !(richTextCodeLanguages as readonly string[]).includes(String(node.language))) return 'This code language is not allowed.'
  if (node.indent && node.type !== 'listitem' && !has('indent')) return 'The field does not allow indentation.'
  if (node.direction !== undefined && node.direction !== null && !['rtl', 'ltr'].includes(String(node.direction))) return 'A block direction must be rtl, ltr or null.'
  if (node.direction != null && !Array.isArray(node.children)) return 'Only elements carry direction.'
  // Older Lexical writes direction on every element, including inline and custom elements. Keep that metadata.
  // New overrides are NodeState choices and never belong to the root.
  if (node.type === 'root' && node.$ != null) return 'Direction and styling belong to blocks, never the root.'
  const state = node.$
  if (state !== undefined) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return 'Node choices must be an object.'
    const choices = state as Record<string, unknown>
    for (const [key, value] of Object.entries(choices)) {
      if (typeof value !== 'string') return 'Rich text choices are names, never CSS or objects.'
      if (key === 'direction') {
        if (!has('direction') || !richTextBlockTypes.includes(node.type) || !Array.isArray(node.children) || !['rtl', 'ltr', 'auto'].includes(String(value))) return 'The field does not allow this block direction.'
      } else {
        if (!has('styling') || typeof node.text !== 'string') return 'The field does not allow styling here.'
        if (key === 'color' ? !Object.hasOwn(richTextColors, String(value)) : key === 'size' ? !Object.hasOwn(richTextSizes, String(value)) : key === 'font' ? !fonts.includes(value as RichTextFont) : true) return 'Styling must use the project\'s fixed choices.'
      }
    }
  }
  if (node.type === 'table' && (!node.children?.length || node.children.length > 100 || node.children.some((one) => one.type !== 'tablerow'))) return 'A table holds 1 to 100 rows.'
  if (node.type === 'tablerow' && (!node.children?.length || node.children.length > 100 || node.children.some((one) => one.type !== 'tablecell'))) return 'A table row holds 1 to 100 cells.'
  if (node.type === 'tablecell') {
    for (const key of ['colSpan', 'rowSpan']) if (node[key] !== undefined && (!Number.isInteger(node[key]) || Number(node[key]) < 1 || Number(node[key]) > 100)) return 'A table span is 1 to 100.'
    if (node.headerState !== undefined && (!Number.isInteger(node.headerState) || ![0, 1, 2, 3].includes(node.headerState as number))) return 'A table header state is 0 to 3.'
  }
  if (node.type === 'code' && node.theme != null) return 'Rich text stores no code theme.'
  // Tables have structural CSS fields in Lexical. None is an author-supplied style channel.
  for (const key of ['backgroundColor', 'width', 'height', 'colWidths']) if (node[key] != null && node[key] !== '') return `Rich text stores no ${key}.`
  for (const child of node.children ?? []) {
    const refused = richTextFeatureGuard({ node: child, policy })
    if (refused) return refused
  }
  return undefined
}
