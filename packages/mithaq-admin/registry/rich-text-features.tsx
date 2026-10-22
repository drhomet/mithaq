import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import type { Klass, LexicalNode } from 'lexical'
import type { RichTextPolicy } from 'mithaq/rich-text'
import type { ControlProps } from 'mithaq-admin/control-props.ts'
import type { Translate } from 'mithaq-admin/copy.ts'

export type FeatureProps = { policy: RichTextPolicy; locale: string; t: Translate; control?: ControlProps; field?: string }
export type RichTextFeatureModule = { nodes?: readonly Klass<LexicalNode>[]; Plugin?: ComponentType<FeatureProps>; Buttons?: ComponentType<FeatureProps>; ReadButtons?: ComponentType<FeatureProps>; SelectionButtons?: ComponentType<FeatureProps> }

/** Rich-text projects install all peers; feature code loads only for fields that select it. */
export const loadRichTextFeatures = (policy: RichTextPolicy): Promise<RichTextFeatureModule[]> => Promise.all([
  ...(policy.features.includes('comments') ? [import('mithaq-admin/rich-text-comments.tsx')] : []),
  ...(policy.features.includes('mentions') ? [import('mithaq-admin/rich-text-mentions.tsx')] : []),
  ...(policy.features.includes('findReplace') ? [import('mithaq-admin/rich-text-find-replace.tsx')] : []),
  ...(policy.features.includes('tables') ? [import('mithaq-admin/rich-text-tables.tsx')] : []),
  ...(policy.features.includes('code') ? [import('mithaq-admin/rich-text-code.tsx')] : []),
  ...(policy.features.includes('markdown') ? [import('mithaq-admin/rich-text-markdown.tsx')] : []),
  ...(policy.features.includes('counter') ? [import('mithaq-admin/rich-text-counter.tsx')] : []),
  ...(policy.features.includes('styling') ? [import('mithaq-admin/rich-text-styling.tsx')] : []),
])

export function FeatureNodes({ policy, children, loading }: { policy: RichTextPolicy; loading?: ReactNode; children: (modules: readonly RichTextFeatureModule[]) => ReactNode }) {
  const key = JSON.stringify(policy)
  const needed = policy.features.some((one) => ['tables', 'code', 'markdown', 'counter', 'styling', 'mentions', 'findReplace', 'comments'].includes(one))
  const [loaded, setLoaded] = useState<{ key: string; modules: RichTextFeatureModule[] }>()
  const [error, setError] = useState<Error>()
  useEffect(() => {
    if (!needed) return
    let current = true
    loadRichTextFeatures(policy).then((modules) => { if (current) setLoaded({ key, modules }) }, (cause) => { if (current) setError(cause) })
    return () => { current = false }
  }, [key, needed])
  if (error) throw error
  return !needed ? children([]) : loaded?.key === key ? children(loaded.modules) : loading ?? <div role="status" aria-busy="true" className="min-h-40" />
}

/** Stable classes keep a new nodes array from remounting an uncontrolled editor on every keystroke. */
export function useFeatureNodes({ nodes, modules }: { nodes: readonly Klass<LexicalNode>[]; modules: readonly RichTextFeatureModule[] }) {
  const extra = modules.flatMap((one) => one.nodes ?? [])
  return useMemo(() => [...nodes, ...extra.filter((one) => !nodes.some((held) => held.getType() === one.getType()))], [nodes, ...extra])
}
