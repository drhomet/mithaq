import { use, useState, type ReactElement } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import type { Klass, LexicalNode } from 'lexical'
import type { ControlProps } from './control-props.ts'
import type { Translate } from './copy.ts'
import { safeUrl } from 'mithaq/rich-text'
import { FloatingLinkEditorPlugin } from './rich-text-link-plugin.tsx'
import { RichTextContext, type RichTextPick } from './rich-text-picks.tsx'
import { holdsPlaceholder } from './rich-text-selection.ts'
import { SlashMenu } from './rich-text-slash-menu.tsx'
import { ToolbarRow } from './rich-text-toolbar.tsx'
import { configOf, unreadable, valueOf, type RichTextDirection, type RichTextValue } from './rich-text-value.ts'
import { DirectionPlugin, Unreadable } from './rich-text-viewer.tsx'

/**
 * The editor, over the screen's nodes and picks (`RichTextContext`) unless handed its own.
 * Uncontrolled past its first value, as Lexical is. A stored value it cannot mount is drawn by `Unreadable` and reports nothing.
 */
export function RichTextEditor({ value, onChange, direction, t, locale, id, placeholder, describedBy, invalid, required, nodes, picks, control }: {
  value: unknown
  onChange: (value: RichTextValue) => void
  direction: RichTextDirection
  t: Translate
  locale: string
  id?: string
  placeholder?: string
  describedBy?: string
  invalid?: boolean
  required?: boolean
  nodes?: readonly Klass<LexicalNode>[]
  picks?: readonly RichTextPick[]
  /** The field's control props, which the screen's `Plugin` is handed. */
  control?: ControlProps
}): ReactElement {
  const provided = use(RichTextContext)
  const { Plugin } = provided
  const drawn = nodes ?? provided.nodes
  const [held] = useState(() => valueOf(value))
  const [problem] = useState(() => unreadable(held, drawn))
  // Built only over a value these nodes read, so a value nested past the bound never reaches `JSON.stringify` or Lexical.
  const [initial] = useState(() => (problem === undefined ? configOf({ namespace: 'MithaqRichText', nodes: drawn, value: held, editable: true }) : undefined))
  const [isLinkEditMode, setIsLinkEditMode] = useState(false)
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  if (problem !== undefined || !initial) return <Unreadable value={held} nodes={drawn} problem={problem ?? ''} direction={direction} t={t} id={id} describedBy={describedBy} />
  return (
    <div className="border-input bg-background overflow-clip rounded-lg border shadow-xs" dir={direction} data-rich-text={id}>
      <LexicalComposer initialConfig={initial}>
        <ToolbarRow t={t} locale={locale} picks={picks ?? provided.picks} setLinkEditMode={setIsLinkEditMode} direction={direction} />
        <div className="relative" ref={setAnchor}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={id}
                // Named by the field's label, since a `for` cannot reach a div.
                aria-labelledby={id ? `${id}-label` : undefined}
                aria-describedby={describedBy}
                aria-invalid={invalid ? true : undefined}
                aria-required={required ? true : undefined}
                aria-placeholder={placeholder ?? ''}
                className="min-h-40 px-4 py-3 text-sm leading-6 outline-none"
                placeholder={<div className="text-muted-foreground pointer-events-none absolute start-0 top-0 overflow-hidden px-4 py-3 text-sm text-ellipsis select-none">{placeholder ?? ''}</div>}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        {/* A value holding an unconfirmed link is never handed on, so an autosave while the link editor is open sends no placeholder the server refuses. */}
        <OnChangePlugin ignoreSelectionChange onChange={(state) => holdsPlaceholder(state) || onChange(state.toJSON() as unknown as RichTextValue)} />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin validateUrl={safeUrl} />
        <FloatingLinkEditorPlugin anchorElem={anchor} isLinkEditMode={isLinkEditMode} setIsLinkEditMode={setIsLinkEditMode} t={t} />
        <HorizontalRulePlugin />
        <SlashMenu locale={locale} picks={picks ?? provided.picks} />
        <DirectionPlugin />
        {Plugin && control ? <Plugin {...control} /> : null}
      </LexicalComposer>
    </div>
  )
}
