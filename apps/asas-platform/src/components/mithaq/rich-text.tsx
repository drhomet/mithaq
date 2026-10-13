import type { ReactElement, ReactNode } from 'react'
import { useDirection } from '@/components/ui/direction'
import { ariaRequired, changeOf, type Cell, type CellProps, type Control, type ControlProps } from './control-props.ts'
import { noValue } from './format.tsx'
import { RichTextEditor } from './rich-text-editor.tsx'
import { richTextLine } from './rich-text-line.ts'
import { blank } from './rich-text-value.ts'
import { RichTextValueView, RichTextViewer } from './rich-text-viewer.tsx'

// ponytail: what this file exported before its pieces were split out, kept for one version so a project's own file
// importing one from here still builds after recopying; drop it the next minor and import each from its piece.
export { RichTextEditor } from './rich-text-editor.tsx'
export { RichTextContext, defaultPicks, defaultViews, viewsOf, type RichTextPick } from './rich-text-picks.tsx'
export { unreadable, type RichTextDirection, type RichTextNode, type RichTextValue } from './rich-text-value.ts'
export { RichTextValueView, RichTextViewer } from './rich-text-viewer.tsx'

/** The `richText` kind's control: the editor, or the viewer where the field is read only. An editor holding nothing but empty paragraphs reports `null`. */
export function RichTextControl(props: ControlProps): ReactElement {
  const { describedBy, error, id, locale, placeholder, readOnly, t, value } = props
  const direction = useDirection() === 'rtl' ? 'rtl' : 'ltr'
  const change = changeOf(props)
  if (readOnly) return <RichTextViewer value={value} direction={direction} t={t} id={id} describedBy={describedBy} />
  return (
    <RichTextEditor
      value={value}
      onChange={(next) => change(blank(next) ? null : next)}
      direction={direction}
      t={t}
      locale={locale ?? 'en'}
      id={id}
      placeholder={placeholder}
      describedBy={describedBy}
      invalid={!!error}
      required={ariaRequired(props.field) === true}
      control={props}
    />
  )
}

/** The `richText` kind's cell: its first worded block on one line in a row, and the viewer on a record page. */
export function RichTextCell({ value, t, whole }: CellProps): ReactNode {
  if (whole) return <RichTextValueView value={value} t={t} />
  const line = richTextLine(value)
  // min-w-48 keeps a phone-width table from squeezing the words to one per line.
  return line ? <span dir="auto" className="line-clamp-2 min-w-48 whitespace-normal">{line}</span> : noValue
}

/** What a project whose language holds the `richText` kind spreads into its components map, beside `defaultComponents`. */
export const richTextComponents: { controls: { readonly richText: Control }; cells: { readonly richText: Cell } } = {
  controls: { richText: RichTextControl },
  cells: { richText: RichTextCell },
}
// mithaq-admin 12a77ad2d870c125421bf16c2e4e87200a870847 83342e8ac955fe048acf55f5cd1f3b048c12cb9f5af9d07b0503afec1f603317
