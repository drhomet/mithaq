import { MarkNode } from '@lexical/mark'
import { HashtagNode } from '@lexical/hashtag'
import { MentionNode } from './mention-node.ts'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { CodeNode, CodeHighlightNode } from '@lexical/code-core'
import type { Klass, LexicalNode } from 'lexical'
import type { RichTextFeature } from './policy.ts'

/** Keep the registry's version fixtures on the same selected class list as the server. */
export const richTextFeatureNodes = (features: readonly RichTextFeature[]): readonly Klass<LexicalNode>[] => [
  ...(features.includes('mentions') ? [MentionNode, HashtagNode] : []),
  ...(features.includes('comments') ? [MarkNode] : []),
  ...(features.includes('tables') ? [TableNode, TableRowNode, TableCellNode] : []),
  ...(features.includes('code') ? [CodeNode, CodeHighlightNode] : []),
]

