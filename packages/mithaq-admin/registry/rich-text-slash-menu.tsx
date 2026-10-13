import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { TextNode } from 'lexical'
import { cn } from '@/lib/utils'
import { pickLabel, type RichTextPick } from './rich-text-picks.tsx'

class PickerOption extends MenuOption {
  item: RichTextPick
  title: string
  constructor(item: RichTextPick, title: string) {
    super(item.key)
    this.item = item
    this.title = title
  }
}

function PickerMenu({ options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }: {
  options: PickerOption[]
  selectedIndex: number | null
  selectOptionAndCleanUp: (option: PickerOption) => void
  setHighlightedIndex: (index: number) => void
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    if (selectedIndex !== null) itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [selectedIndex])
  return (
    <div className="border-border bg-popover text-popover-foreground h-min min-w-48 overflow-hidden rounded-lg border p-1 shadow-xl" role="listbox">
      {options.map((option, index) => {
        const { Icon } = option.item
        return (
          <button
            key={option.key}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            type="button"
            role="option"
            aria-selected={selectedIndex === index}
            className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm outline-none', selectedIndex === index ? 'bg-accent' : 'hover:bg-muted')}
            onClick={() => selectOptionAndCleanUp(option)}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(index)}
          >
            <span className="text-muted-foreground flex size-5 items-center justify-center"><Icon className="size-4" /></span>
            <span className="flex-1">{option.title}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SlashMenu({ locale, picks }: { locale: string; picks: readonly RichTextPick[] }): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', { minLength: 0 })
  const options = useMemo(() => {
    const all = picks.map((item) => new PickerOption(item, pickLabel(item, locale)))
    if (!queryString) return all
    // The typed word is compared as text, never as a pattern: a lone bracket would throw in a RegExp.
    const word = queryString.toLowerCase()
    return all.filter((option) => option.title.toLowerCase().includes(word) || (option.item.keywords ?? []).some((keyword) => keyword.includes(word)))
  }, [queryString, locale, picks])
  const onSelectOption = useCallback(
    (selected: PickerOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        nodeToRemove?.remove()
        selected.item.onSelect({ editor, isActive: false })
        closeMenu()
      })
    },
    [editor],
  )
  return (
    <LexicalTypeaheadMenuPlugin<PickerOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (!anchorElementRef.current || !options.length) return null
        const anchorRect = anchorElementRef.current.getBoundingClientRect()
        return createPortal(
          <div className="fixed z-[1000]" style={{ left: anchorRect.left, top: anchorRect.bottom + 4 }}>
            <PickerMenu options={options} selectedIndex={selectedIndex} selectOptionAndCleanUp={selectOptionAndCleanUp} setHighlightedIndex={setHighlightedIndex} />
          </div>,
          document.body,
        )
      }}
    />
  )
}
