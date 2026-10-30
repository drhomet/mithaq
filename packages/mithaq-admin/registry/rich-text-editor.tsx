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
import type { ControlProps } from 'mithaq-admin/control-props.ts'
import type { Translate } from 'mithaq-admin/copy.ts'
import { defaultRichTextFeatures, defaultRichTextFonts, type RichTextPolicy, richTextBlockTypes, richTextChoiceFeatures, richTextFeatureGuard, richTextGuard, safeUrl } from 'mithaq/rich-text/client'
import { FloatingLinkEditorPlugin } from 'mithaq-admin/rich-text-link-plugin.tsx'
import { RichTextContext, type RichTextPick } from 'mithaq-admin/rich-text-picks.tsx'
import { holdsPlaceholder } from 'mithaq-admin/rich-text-selection.ts'
import { SlashMenu } from 'mithaq-admin/rich-text-slash-menu.tsx'
import { ToolbarRow } from 'mithaq-admin/rich-text-toolbar.tsx'
import { configOf, unreadable, valueOf, type RichTextDirection, type RichTextNode, type RichTextValue } from 'mithaq-admin/rich-text-value.ts'
import { FloatingToolbar } from 'mithaq-admin/rich-text-floating-toolbar.tsx'
import { FeatureNodes, useFeatureNodes, type RichTextFeatureModule } from 'mithaq-admin/rich-text-features.tsx'
import { PolicyPlugin } from 'mithaq-admin/rich-text-policy.tsx'
import { Unreadable } from 'mithaq-admin/rich-text-viewer.tsx'

const defaultPolicy: RichTextPolicy = { features: defaultRichTextFeatures, fonts: defaultRichTextFonts }

export function RichTextEditor(props: EditorProps & { policy?: RichTextPolicy }): ReactElement {
  const policy = props.policy ?? props.control?.field.richTextPolicy ?? defaultPolicy
  return <FeatureNodes policy={policy} loading={<div id={props.id} role="textbox" aria-labelledby={props.id ? `${props.id}-label` : undefined} aria-describedby={props.describedBy} aria-readonly="true" aria-busy="true" className="min-h-40 rounded-lg border" />}>{(modules) => <Editor {...props} modules={modules} policy={policy} />}</FeatureNodes>
}

/**
 * The editor, over the screen's nodes and picks (`RichTextContext`) unless handed its own.
 * Uncontrolled past its first value, as Lexical is. A stored value it cannot mount is drawn by `Unreadable` and reports nothing.
 */
type EditorProps = {
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
}

// The policy derives a block's direction from NodeState; a legacy direction without that choice would be cleared.
// Other elements keep older Lexical's direction as metadata, without a block choice.
const losesDirection = (node: RichTextNode): boolean =>
  (richTextBlockTypes.includes(node.type) && node.direction != null && node.direction !== (node.$ as { direction?: unknown } | undefined)?.direction)
  || (node.children ?? []).some(losesDirection)
// A copy, so the form's own value is never changed: a legacy block direction becomes the choice the toolbar shows.
const chosen = (node: RichTextNode): RichTextNode => ({
  ...node,
  ...(node.type !== 'root' && (node.direction === 'rtl' || node.direction === 'ltr') && (node.$ as { direction?: unknown } | undefined)?.direction === undefined && richTextBlockTypes.includes(node.type) && Array.isArray(node.children)
    ? { $: { ...(node.$ as object | undefined), direction: node.direction } }
    : {}),
  ...(node.children ? { children: node.children.map(chosen) } : {}),
})
// The admin has no merge command and splits or stretches merged cells on paste and on row or column inserts, so it never edits them.
const merges = (node: RichTextNode): boolean =>
  Number(node.colSpan ?? 1) > 1 || Number(node.rowSpan ?? 1) > 1 || (node.children ?? []).some(merges)

function Editor({ value, onChange, direction, t, locale, id, placeholder, describedBy, invalid, required, nodes, picks, control , modules, policy }: EditorProps & { modules: readonly RichTextFeatureModule[]; policy: RichTextPolicy }): ReactElement {
  const provided = use(RichTextContext)
  const { Plugin } = provided
  const drawn = useFeatureNodes({ nodes: nodes ?? provided.nodes, modules })
  const allowedPicks = (picks ?? provided.picks).filter((pick) => !richTextChoiceFeatures[pick.key] || policy.features.includes(richTextChoiceFeatures[pick.key]!))
  const [loaded] = useState(() => valueOf(value))
  const [problem] = useState(() => unreadable(loaded, drawn))
  // Mapped only once `unreadable` has bounded the value's depth.
  const [held] = useState(() => (problem === undefined && policy.features.includes('direction') ? { ...loaded, root: chosen(loaded.root) as RichTextValue['root'] } : loaded))
  // Shown, never cleaned: `PolicyPlugin` would rewrite what the server no longer takes for this field, and the next save would keep the loss.
  const [beyond] = useState(() => problem === undefined && ((richTextGuard(held) ?? richTextFeatureGuard({ node: held.root, policy })) !== undefined || losesDirection(held.root)))
  // Built only over a value these nodes read, so a value nested past the bound never reaches `JSON.stringify` or Lexical.
  const [merged] = useState(() => problem === undefined && !beyond && merges(held.root))
  const [initial] = useState(() => (problem === undefined && !beyond && !merged ? configOf({ namespace: 'MithaqRichText', nodes: drawn, value: held, editable: true }) : undefined))
  const [isLinkEditMode, setIsLinkEditMode] = useState(false)
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  if (beyond) return <Unreadable value={held} nodes={drawn} problem="" said={t('admin.richText.beyondPolicy', 'This text holds content this field no longer allows, so it is shown as its words and cannot be changed here.') ?? ''} direction={direction} t={t} id={id} describedBy={describedBy} />
  if (merged) return <Unreadable value={held} nodes={drawn} problem="" said={t('admin.richText.mergedCells', 'This text holds merged table cells, which this editor cannot change, so it is shown as its words and cannot be changed here.') ?? ''} direction={direction} t={t} id={id} describedBy={describedBy} />
  if (problem !== undefined || !initial) return <Unreadable value={held} nodes={drawn} problem={problem ?? ''} direction={direction} t={t} id={id} describedBy={describedBy} />
  return (
    <div className="border-input bg-background overflow-clip rounded-lg border shadow-xs" dir={direction} data-rich-text={id}>
      <LexicalComposer initialConfig={initial}>
        <ToolbarRow t={t} locale={locale} picks={allowedPicks} setLinkEditMode={setIsLinkEditMode} direction={direction} policy={policy} extras={modules.map(({ Buttons }, index) => Buttons ? <Buttons key={index} policy={policy} locale={locale} t={t} control={control} /> : null)} />
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
        <OnChangePlugin ignoreSelectionChange onChange={(state) => {
          if (holdsPlaceholder(state)) return
          // Lexical exports optional keys as undefined; the value crossing the server boundary is JSON.
          const next = JSON.parse(JSON.stringify(state.toJSON())) as RichTextValue
          // The field must receive refused edits too, so saving reports the server's error instead of the last good value.
          onChange(next)
        }} />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        {policy.features.includes('link') && <LinkPlugin validateUrl={safeUrl} />}
        <FloatingLinkEditorPlugin anchorElem={anchor} isLinkEditMode={isLinkEditMode} setIsLinkEditMode={setIsLinkEditMode} t={t} />
        <HorizontalRulePlugin />
        <SlashMenu locale={locale} picks={allowedPicks} />
        <FloatingToolbar extras={modules.map(({ SelectionButtons }, index) => SelectionButtons ? <SelectionButtons key={index} policy={policy} locale={locale} t={t} control={control} /> : null)} policy={policy} locale={locale} t={t} control={control} setLinkEditMode={setIsLinkEditMode} />
        <PolicyPlugin policy={policy} />
        {modules.map(({ Plugin }, index) => Plugin ? <Plugin key={index} policy={policy} locale={locale} t={t} control={control} /> : null)}
        {Plugin && control ? <Plugin {...control} /> : null}
      </LexicalComposer>
    </div>
  )
}
