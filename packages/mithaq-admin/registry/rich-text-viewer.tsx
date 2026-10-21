import { use, useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { $getRoot, $isElementNode, $getState, RootNode, HISTORY_MERGE_TAG, type Klass, type LexicalNode } from 'lexical'
import { useDirection } from '@/components/ui/direction'
import { cn } from '@/lib/utils'
import type { Translate } from 'mithaq-admin/copy.ts'
import { richTextBounds, defaultRichTextFonts, safeUrl, typesOf, type RichTextPolicy } from 'mithaq/rich-text'
import { $dfs } from '@lexical/utils'
import { directionChoice } from 'mithaq-admin/rich-text-choices.ts'
import { FeatureNodes, useFeatureNodes, type RichTextFeatureModule } from 'mithaq-admin/rich-text-features.tsx'
import { RichTextContext } from 'mithaq-admin/rich-text-picks.tsx'
import { configOf, unreadable, valueOf, type RichTextDirection, type RichTextNode, type RichTextValue } from 'mithaq-admin/rich-text-value.ts'

/**
 * Clears the direction of the root and every block, so Lexical writes `dir="auto"` per block and
 * each follows its first strong letter. Written as a history merge, so it is no change the form would save.
 */
export function DirectionPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const update = () => {
      const root = $getRoot()
      if (root.getDirection() !== null) root.setDirection(null)
      for (const { node: block } of $dfs()) if ($isElementNode(block) && block !== root) {
        const choice = $getState(block, directionChoice)
        const next = choice === 'auto' ? null : choice
        if (block.getDirection() !== next) block.setDirection(next)
      }
    }
    editor.update(update, { tag: HISTORY_MERGE_TAG })
    return editor.registerNodeTransform(RootNode, update)
  }, [editor])
  return null
}

/**
 * One node of a value no editor here can mount, drawn as its words; a node no class registers is
 * marked by its type. Stops at the server's depth bound with an ellipsis rather than overflowing the stack.
 */
function Walked({ node, types, inline, depth = richTextBounds.depth }: { node: RichTextNode; types: ReadonlySet<string>; inline: boolean; depth?: number }): ReactNode {
  if (depth <= 0) return '…'
  if (!node || typeof node !== 'object') return null
  if (node.type === 'linebreak') return <br />
  if (typeof node.text === 'string' && types.has(node.type)) return node.text
  const children = Array.isArray(node.children) ? node.children : []
  const runs = children.some((child) => typeof child?.text === 'string')
  const drawn = children.map((child, at) => <Walked key={at} node={child} types={types} inline={runs} depth={depth - 1} />)
  if (!types.has(node.type)) {
    return (
      <span data-unknown-node={node.type} className="border-destructive text-destructive rounded border border-dashed px-1">
        {node.type}{typeof node.text === 'string' ? `: ${node.text}` : null}{drawn.length ? <> {drawn}</> : null}
      </span>
    )
  }
  return inline ? <span>{drawn}</span> : <div className="mb-2">{drawn}</div>
}

/** A stored value this editor cannot mount, drawn read-only by `Walked`. It reports no change, so the field stays out of every save and nothing it holds is lost. */
export function Unreadable({ value, nodes, problem, direction, t, id, describedBy }: {
  value: RichTextValue
  nodes: readonly Klass<LexicalNode>[]
  problem: string
  direction: RichTextDirection
  t: Translate
  id?: string
  describedBy?: string
}): ReactElement {
  const said = problem
    ? (t('admin.richText.unknownNode', 'This text holds a "{type}" node this editor cannot draw, so it is shown as its words and cannot be changed here.') ?? '').replace('{type}', () => problem)
    : (t('admin.richText.unreadable', 'This editor cannot read this text, so it is shown as its words and cannot be changed here.') ?? '')
  return (
    <div dir={direction} data-rich-text-view={id ?? ''} data-rich-text-unreadable={problem} className="grid gap-2">
      <p role="alert" className="text-destructive text-sm">{said}</p>
      <div id={id} aria-describedby={describedBy} className="text-sm leading-5">
        {(Array.isArray(value.root.children) ? value.root.children : []).map((node, at) => <Walked key={at} node={node} types={typesOf(nodes)} inline={false} />)}
      </div>
    </div>
  )
}

/**
 * The read view: the same nodes, never editable, remounted when the value changes. A link is drawn
 * through Lexical's `sanitizeUrl`, which answers `about:blank` for unsupported schemes, so a
 * `javascript:` or `data:` address that reached a column past the server's check is never followed.
 */
type ViewerProps = {
  value: unknown
  direction: RichTextDirection
  t: Translate
  className?: string
  id?: string
  describedBy?: string
  nodes?: readonly Klass<LexicalNode>[]
}
export function RichTextViewer(props: ViewerProps): ReactElement {
  const policy: RichTextPolicy = { features: [], fonts: defaultRichTextFonts }
  let remaining = richTextBounds.nodes
  const walk = (node: RichTextNode, depth = richTextBounds.depth) => {
    if (!node || depth <= 0 || remaining-- <= 0) return
    if (node.type === 'table' && !policy.features.includes('tables')) policy.features = [...policy.features, 'tables']
    if (node.type === 'code' && !policy.features.includes('code')) policy.features = [...policy.features, 'code']
    if (node.$ && typeof node.$ === 'object' && ['color', 'size', 'font'].some((key) => Object.hasOwn(node.$ as object, key)) && !policy.features.includes('styling')) policy.features = [...policy.features, 'styling']
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child, depth - 1)
  }
  walk(valueOf(props.value).root)
  return <FeatureNodes policy={policy}>{(modules) => <Viewer {...props} modules={modules} policy={policy} />}</FeatureNodes>
}
function Viewer({ value, direction, t, className, id, describedBy, nodes , modules, policy }: ViewerProps & { modules: readonly RichTextFeatureModule[]; policy: RichTextPolicy }): ReactElement {
  const provided = use(RichTextContext)
  const drawn = useFeatureNodes({ nodes: nodes ?? provided.nodes, modules })
  const held = useMemo(() => valueOf(value), [value])
  // Asked before serializing, so a value nested past the bound never reaches `JSON.stringify` or Lexical.
  const problem = useMemo(() => unreadable(held, drawn), [held, drawn])
  if (problem !== undefined) return <Unreadable value={held} nodes={drawn} problem={problem} direction={direction} t={t} id={id} describedBy={describedBy} />
  const serialized = JSON.stringify(held)
  return (
    <div dir={direction} data-rich-text-view={id ?? ''}>
      <LexicalComposer key={serialized} initialConfig={configOf({ namespace: 'MithaqRichTextViewer', nodes: drawn, value: held, editable: false })}>
        <RichTextPlugin
          contentEditable={<ContentEditable id={id} aria-describedby={describedBy} className={cn('text-sm leading-5 outline-none [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_p:last-child]:mb-0', className)} />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin validateUrl={safeUrl} />
        <DirectionPlugin />
        {modules.map(({ Plugin }, index) => Plugin ? <Plugin key={index} policy={policy} locale="en" t={t} /> : null)}
      </LexicalComposer>
    </div>
  )
}

/** A rich text value as a record page reads it: the viewer, over the page's direction, and nothing where it holds none. */
export function RichTextValueView({ value, t }: { value: unknown; t: Translate }): ReactNode {
  const direction = useDirection() === 'rtl' ? 'rtl' : 'ltr'
  return value ? <RichTextViewer value={value} direction={direction} t={t} /> : null
}
