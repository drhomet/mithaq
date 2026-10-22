// Adapted from shadcn-editor's floating toolbar, MIT. See LICENSES/shadcn-editor.txt.
import { useEffect, useState, type ReactNode } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { FormatButtons } from 'mithaq-admin/rich-text-format-buttons.tsx'
import { LinkButton } from 'mithaq-admin/rich-text-toolbar.tsx'
import type { FeatureProps } from 'mithaq-admin/rich-text-features.tsx'

/** Pointer users get the selection tools; touch and keyboard users keep the reachable top toolbar. */
export function FloatingToolbar({ policy, t, setLinkEditMode, extras }: FeatureProps & { setLinkEditMode: (value: boolean) => void; extras?: ReactNode }) {
  const [editor] = useLexicalComposerContext()
  const [rect, setRect] = useState<DOMRect>()
  useEffect(() => {
    const media = matchMedia('(min-width: 640px) and (pointer: fine)')
    const update = () => {
      const selection = window.getSelection()
      const root = editor.getRootElement()
      setRect(media.matches && selection && !selection.isCollapsed && selection.rangeCount && root?.contains(selection.anchorNode) && root.contains(selection.focusNode) ? selection.getRangeAt(0).getBoundingClientRect() : undefined)
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('scroll', update, true)
    media.addEventListener('change', update)
    return () => { document.removeEventListener('selectionchange', update); document.removeEventListener('scroll', update, true); media.removeEventListener('change', update) }
  }, [editor])
  return <Popover open={!!rect}>
    <PopoverTrigger tabIndex={-1} aria-hidden style={{ position: 'fixed', top: rect?.top ?? 0, left: rect?.left ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0, pointerEvents: 'none', opacity: 0 }} />
    <PopoverContent role="toolbar" aria-label={t('admin.richText.selectionToolbar', 'Selection formatting')} initialFocus={false} finalFocus={false} side="top" className="flex w-auto gap-1 p-1" onMouseDown={(event) => event.preventDefault()}>
      <FormatButtons t={t} policy={policy} />
      {policy.features.includes('link') && <LinkButton t={t} setLinkEditMode={setLinkEditMode} />}
      {extras}
    </PopoverContent>
  </Popover>
}
