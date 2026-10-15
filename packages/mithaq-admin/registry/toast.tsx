import { useEffect, useSyncExternalStore, type ReactElement } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'

/** One toast: what it says, and whether it reports a write that landed or one that failed. */
export type Toast = { id: number; message: string; type: 'success' | 'error' | 'default' }

// One store per page: `toast` is called from a handler in the browser, never during a server render.
let toasts: readonly Toast[] = []
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

// A failure stays twice as long as a success, so its reason can be read.
const durations = { success: 4000, default: 4000, error: 8000 }

function Item({ one }: { one: Toast }): ReactElement {
  useEffect(() => {
    const timer = setTimeout(() => toast.dismiss(one.id), durations[one.type])
    return () => clearTimeout(timer)
  }, [one])
  const Icon = one.type === 'error' ? CircleAlert : one.type === 'success' ? CircleCheck : undefined
  return (
    <li
      data-toast={one.type}
      // An error interrupts, a success waits its turn; each is read where it is drawn.
      role={one.type === 'error' ? 'alert' : 'status'}
      className={`bg-background pointer-events-auto flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg ${one.type === 'error' ? 'border-destructive/50 text-destructive' : one.type === 'success' ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400' : ''}`}
    >
      {Icon ? <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
      <span className="min-w-0 break-words">{one.message}</span>
    </li>
  )
}

/**
 * Where every toast is drawn, mounted once by the host. No close button, as in Sonner's default: a press outside
 * an open drawer closes the drawer, and the toast leaves on its own. A live region, which an open modal leaves alive.
 */
export function Toaster(): ReactElement {
  const shown = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
    () => [],
  )
  return (
    <ol aria-live="polite" data-toaster="" className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4 sm:w-96">
      {shown.map((one) => <Item key={one.id} one={one} />)}
    </ol>
  )
}
