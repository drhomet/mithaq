import { defaultRichTextFeatures } from 'mithaq/rich-text'

/** The worked project installs optional tools; create-mithaq writes the new project's selection here. */
export const richTextConfig = {
  features: [...defaultRichTextFeatures, 'tables', 'code', 'styling', 'markdown', 'counter'] as const,
  fonts: ['sans', 'serif', 'mono'] as const,
}
