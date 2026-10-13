import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'

/**
 * A sheet's or a dialog's close button, an icon named in the viewer's language. The sheet or dialog
 * that draws it passes `showCloseButton={false}`, so the primitive's English one is not drawn beside it.
 */
export function CloseButton({ Close, label }: { Close: typeof SheetClose | typeof DialogClose; label: string }): ReactElement {
  return (
    <Close render={<Button variant="ghost" size="icon-sm" className="absolute top-4 end-4 max-sm:top-2 max-sm:end-2 max-sm:size-11" />}>
      <XIcon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Close>
  )
}

/**
 * The open popups of shadcn's four modals. The sidebar's mobile sheet is a sheet whose popup the
 * sidebar renames `data-slot="sidebar"`; the desktop sidebar has the same slot and is never `data-open`.
 */
const openModal = '[data-slot=dialog-content][data-open],[data-slot=alert-dialog-content][data-open],[data-slot=sheet-content][data-open],[data-slot=sidebar][data-open],[data-slot=drawer-popup][data-open]'

/**
 * Makes everything outside the open modal `inert`, as `showModal()` does, so Tab never reaches the page behind it:
 * Base UI's focus guards act only on focus events, which an unfocused document never receives.
 */
export const holdFocus = (body: HTMLElement): (() => void) => {
  /** Everything this made inert given back, which is all it ever clears. */
  const release = () => {
    for (const one of body.querySelectorAll('[data-mithaq-inert]')) {
      one.removeAttribute('inert')
      one.removeAttribute('data-mithaq-inert')
    }
  }
  // A live region, such as a list's count of ticked rows, keeps speaking while a modal is open: an
  // element holding one is walked into rather than made inert whole.
  const shut = (node: Element) => {
    if (node.matches('[aria-live], script') || node.hasAttribute('inert')) return
    if (node.querySelector('[aria-live]')) {
      for (const child of node.children) shut(child)
      return
    }
    node.setAttribute('inert', '')
    node.setAttribute('data-mithaq-inert', '')
  }
  const sync = () => {
    release()
    const open = [...body.querySelectorAll(openModal)].at(-1)
    if (!open) return
    for (const child of body.children) if (child.hasAttribute('data-base-ui-inert') && !child.contains(open)) shut(child)
  }
  const observer = new MutationObserver(sync)
  observer.observe(body, { childList: true, subtree: true, attributeFilter: ['data-open', 'data-base-ui-inert'] })
  sync()
  // The cleanup gives the page back whole even when the frame unmounts under an open modal.
  return () => {
    observer.disconnect()
    release()
  }
}

/**
 * Focus on open: the first form field, or the popup itself on a touch so the phone's keyboard stays down.
 * A route-opened frame gets no interaction type, so on a coarse pointer anything but the keyboard counts as touch.
 */
export const initialFocusIn = (popup: RefObject<HTMLElement | null>) => (type: string) =>
  type === 'touch' || (type !== 'keyboard' && globalThis.matchMedia?.('(pointer: coarse)').matches)
    ? popup.current
    : popup.current?.querySelector<HTMLElement>('form :is(input:not([type=hidden]), textarea, select, [contenteditable=true], [role=combobox]):not(:disabled, [aria-hidden=true], [tabindex="-1"])') ?? true

/**
 * Where a create or an edit opens over the list, when its page names a mode:
 * shadcn's dialog, sheet or drawer, open while it is drawn, and closing it is
 * the host's navigation back to the list.
 */
export function RecordFrame({
  mode,
  title,
  closeLabel,
  onClose,
  children,
}: {
  mode: 'dialog' | 'drawer' | 'sheet'
  title: string
  /** What a screen reader names the close button by, in the viewer's language. */
  closeLabel: string
  onClose: () => void
  children?: ReactNode
}): ReactElement {
  const change = (open: boolean) => {
    if (!open) onClose()
  }
  const popup = useRef<HTMLDivElement>(null)
  const frame =
    // The title is for a screen reader alone, as the page draws its own title node inside. The close
    // button is this file's own, as the primitive's is named in English.
    mode === 'sheet' ? <Sheet open onOpenChange={change}><SheetContent ref={popup} showCloseButton={false} initialFocus={initialFocusIn(popup)} className="gap-4 overflow-y-auto p-4 data-[side=left]:max-sm:w-full data-[side=right]:max-sm:w-full"><SheetTitle className="sr-only">{title}</SheetTitle>{children}<CloseButton Close={SheetClose} label={closeLabel} /></SheetContent></Sheet>
    : mode === 'drawer' ? <Drawer open onOpenChange={change}><DrawerContent><DrawerTitle className="sr-only">{title}</DrawerTitle><div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">{children}</div></DrawerContent></Drawer>
    : <Dialog open onOpenChange={change}><DialogContent ref={popup} showCloseButton={false} initialFocus={initialFocusIn(popup)}><DialogTitle className="sr-only">{title}</DialogTitle>{children}<CloseButton Close={DialogClose} label={closeLabel} /></DialogContent></Dialog>
  // A server render draws nothing of the popup, which is a portal, so the mode is said here.
  return (
    <>
      <span hidden data-record-mode={mode} />
      {frame}
    </>
  )
}
