import { useEffect, useRef, useSyncExternalStore, type ComponentProps } from 'react'
import { TabsList } from '@/components/ui/tabs'

const subscribe = (notify: () => void) => {
  window.addEventListener('hashchange', notify)
  window.addEventListener('popstate', notify)
  return () => {
    window.removeEventListener('hashchange', notify)
    window.removeEventListener('popstate', notify)
  }
}

/** The fragment leaves list queries and unsaved form values untouched when a record tab changes. */
export function useRecordTab({ name, keys }: { name: string; keys: readonly string[] }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  const selected = new URLSearchParams(hash.slice(1)).get(`tab.${name}`)
  return {
    value: selected && keys.includes(selected) ? selected : keys[0],
    choose: (value: string) => {
      const url = new URL(window.location.href)
      const fragment = new URLSearchParams(url.hash.slice(1))
      fragment.set(`tab.${name}`, value)
      url.hash = fragment.toString()
      window.history.replaceState(window.history.state, '', url)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    },
  }
}

/** Record and list tabs share one scroll boundary and keep the active tab in view. */
export function TabStrip({ value, variant = 'line', className, ...props }: ComponentProps<typeof TabsList> & { value?: string }) {
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = strip.current
    const active = list?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')
    if (!list || !active) return
    const bounds = list.getBoundingClientRect()
    const tab = active.getBoundingClientRect()
    // Moving only this strip leaves the document's vertical reading position alone, including in RTL.
    list.scrollLeft += tab.left < bounds.left ? tab.left - bounds.left : tab.right > bounds.right ? tab.right - bounds.right : 0
  }, [value])
  return (
    <TabsList
      {...props}
      ref={strip}
      variant={variant}
      data-tab-strip=""
      className={`max-w-full [&>[role=tab]]:flex-none ${className ?? ''}`}
    />
  )
}
