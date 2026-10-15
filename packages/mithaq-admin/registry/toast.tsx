import { useEffect, useSyncExternalStore, type ReactElement } from 'react'
import { CircleAlert, CircleCheck, XIcon } from 'lucide-react'

/** One toast: what it says, and whether it reports a write that landed or one that failed. */
export type Toast = { id: number; message: string; type: 'success' | 'error' | 'default' }

// One store per page: `toast` is called from a handler in the browser, never during a server render.
let toasts: readonly Toast[] = []
const none: readonly Toast[] = []
const listeners = new Set<() => void>()
let next = 0
const set = (held: readonly Toast[]) => {
  toasts = held
  for (const listener of listeners) listener()
}
const add = (type: Toast['type']) => (message: string) => {
  const id = ++next
  // Three at most, as Sonner shows: a fourth pushes the oldest out.
  set([...toasts, { id, message, type }].slice(-3))
  return id
}

/**
 * Sonner's call, `toast.success('Course published')` and `toast.error(reason)`, without the dependency:
 * one module-level list the host's one `<Toaster />` draws.
 */
export const toast = Object.assign(add('default'), {
  success: add('success'),
  error: add('error'),
  dismiss: (id?: number) => set(id === undefined ? [] : toasts.filter((one) => one.id !== id)),
})

/** A success leaves on its own; a failure stays until it is closed, so no reason is gone before it is read (WCAG 2.2.1). */
function Item({ one, closeLabel }: { one: Toast; closeLabel: string }): ReactElement {
  useEffect(() => {
    if (one.type === 'error') return
    const timer = setTimeout(() => toast.dismiss(one.id), 4000)
    return () => clearTimeout(timer)
  }, [one])
  const Icon = one.type === 'error' ? CircleAlert : one.type === 'success' ? CircleCheck : undefined
  return (
    <li
      data-toast={one.type}
      className={`bg-background pointer-events-auto flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg ${one.type === 'error' ? 'border-destructive/50 text-destructive' : one.type === 'success' ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400' : ''}`}
    >
      {Icon ? <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
      <span className="min-w-0 flex-1 break-words">{one.message}</span>
      {one.type === 'error' ? (
        <button type="button" data-toast-close={one.id} aria-label={closeLabel} className="text-muted-foreground hover:text-foreground -me-1 shrink-0 rounded-sm p-0.5">
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  )
}

/**
 * Where every toast is drawn, mounted once by the host, as one polite live region, which an open modal leaves alive.
 * A press on a toast is caught on the window, before an open drawer's own listener on the document reads it as a press
 * outside the drawer and closes it; its close button is handled there too.
 */
export function Toaster({ closeLabel }: { closeLabel: string }): ReactElement {
  const shown = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
    () => none,
  )
  useEffect(() => {
    const pressed = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-toaster]')) return
      event.stopPropagation()
      const close = target.closest('[data-toast-close]')
      if (close && event.type === 'click') toast.dismiss(Number(close.getAttribute('data-toast-close')))
    }
    const types = ['pointerdown', 'mousedown', 'click']
    for (const type of types) window.addEventListener(type, pressed, true)
    return () => {
      for (const type of types) window.removeEventListener(type, pressed, true)
    }
  }, [])
  return (
    <ol aria-live="polite" data-toaster="" className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4 sm:w-96">
      {shown.map((one) => <Item key={one.id} one={one} closeLabel={closeLabel} />)}
    </ol>
  )
}
