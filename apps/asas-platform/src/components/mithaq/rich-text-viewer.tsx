import { use, useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { $getRoot, $isElementNode, HISTORY_MERGE_TAG, type Klass, type LexicalNode } from 'lexical'
import { useDirection } from '@/components/ui/direction'
import { cn } from '@/lib/utils'
import type { Translate } from './copy.ts'
import { richTextBounds, safeUrl, typesOf } from 'mithaq/rich-text'
import { RichTextContext } from './rich-text-picks.tsx'
import { configOf, unreadable, valueOf, type RichTextDirection, type RichTextNode, type RichTextValue } from './rich-text-value.ts'

/**
 * Clears the direction of the root and every block, so Lexical writes `dir="auto"` per block and
 * each follows its first strong letter. Written as a history merge, so it is no change the form would save.
 */
export function DirectionPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.update(() => {
      const root = $getRoot()
      root.setDirection(null)
      for (const block of root.getChildren()) if ($isElementNode(block) && block.getDirection() !== null) block.setDirection(null)
    }, { tag: HISTORY_MERGE_TAG })
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
export function RichTextViewer({ value, direction, t, className, id, describedBy, nodes }: {
  value: unknown
  direction: RichTextDirection
  t: Translate
  className?: string
  id?: string
  describedBy?: string
  nodes?: readonly Klass<LexicalNode>[]
}): ReactElement {
  const drawn = nodes ?? use(RichTextContext).nodes
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
      </LexicalComposer>
    </div>
  )
}

/** A rich text value as a record page reads it: the viewer, over the page's direction, and nothing where it holds none. */
export function RichTextValueView({ value, t }: { value: unknown; t: Translate }): ReactNode {
  const direction = useDirection() === 'rtl' ? 'rtl' : 'ltr'
  return value ? <RichTextViewer value={value} direction={direction} t={t} /> : null
}
// mithaq-admin 12a77ad2d870c125421bf16c2e4e87200a870847 b5e9356d9bc009d5bd79430651e9f580c17eb6001d509bed1ace6f1c24f058ca
