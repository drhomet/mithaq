import { defaultRichTextFeatures } from 'mithaq/rich-text'

/** The worked project installs optional tools; create-mithaq writes the new project's selection here. */
export const richTextConfig = {
  features: [...defaultRichTextFeatures, 'tables', 'code', 'styling', 'markdown', 'counter'] as const,
  // add-on: rich-text-comments
  comments: { threads: 'richTextThreads' },
  // end add-on: rich-text-comments
  fonts: ['sans', 'serif', 'mono'] as const,
}
