// What every screen's rich text editor and viewer draw with: this project's
// own node list, the one its server parses every write with, each class swapped
// for its React subclass where one extends it, and the `/` menu's picks. A
// provider each screen names, so no control, read view or panel can take
// another list.
import type { ReactNode } from 'react'
import type { ProviderProps } from 'mithaq/admin'
import { RichTextContext, defaultPicks, defaultViews, viewsOf } from 'mithaq-admin/rich-text-picks.tsx'
// add-on: uploads
import { UploadPlugin, UploadView, imagePick } from 'mithaq-admin/upload-node.tsx'
// end add-on: uploads
import { richTextNodes } from '../mithaq/rich-text-nodes.ts'

const value = {
  featureModules: {
    // add-on: rich-text-mentions
    mentions: () => import('mithaq-admin/rich-text-mentions.tsx'),
    // end add-on: rich-text-mentions
    // add-on: rich-text-find-replace
    findReplace: () => import('mithaq-admin/rich-text-find-replace.tsx'),
    // end add-on: rich-text-find-replace
    // add-on: rich-text-comments
    comments: () => import('mithaq-admin/rich-text-comments.tsx'),
    // end add-on: rich-text-comments
  },
  nodes: viewsOf(richTextNodes, [
    ...defaultViews,
    // add-on: uploads
    UploadView,
    // end add-on: uploads
  ]),
  picks: [
    ...defaultPicks,
    // add-on: uploads
    // The upload node's `/` entry "Image" opens its dialog in every editor.
    imagePick,
    // end add-on: uploads
  ],
  // add-on: uploads
  Plugin: UploadPlugin,
  // end add-on: uploads
}

export const RichTextNodes = ({ children }: ProviderProps<ReactNode>) => <RichTextContext value={value}>{children}</RichTextContext>
