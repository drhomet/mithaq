import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useDirection } from '@/components/ui/direction'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'

/**
 * A sheet's or a dialog's close button, an icon named in the viewer's language. The sheet or dialog
 * that draws it passes `showCloseButton={false}`, so the primitive's English one is not drawn beside it.
 */
export function CloseButton({ Close, label }: { Close: typeof SheetClose | typeof DialogClose; label: string }): ReactElement {
  return (
    <Close render={<Button variant="ghost" size="icon-sm" className="absolute top-2 end-2 sm:top-4 sm:end-4 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" />}>
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
 * Payload's document drawer: a record that covers the page it opened over from the inline end, leaving a strip of the
 * page showing under it, with its title and close button in a bar of its own. Esc, the close button or a press on that
 * strip closes it; the page underneath keeps its place. A page that draws its own title passes `titled={false}`, which
 * keeps the drawer's for a screen reader alone.
 */
export function DocumentDrawer({ children, closeLabel, edit, onClose, title, titled = true }: {
  title: string
  titled?: boolean
  closeLabel: string
  onClose: () => void
  /** The row the drawer edits, `new` for one it makes, which a test or a project's style can find it by. */
  edit?: string
  children?: ReactNode
}): ReactElement {
  const popup = useRef<HTMLDivElement>(null)
  // Sheet's sides are physical, so the inline end is the left in Arabic.
  const side = useDirection() === 'rtl' ? 'left' : 'right'
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        ref={popup}
        side={side}
        showCloseButton={false}
        initialFocus={initialFocusIn(popup)}
        data-document-drawer=""
        data-mithaq-inline-edit={edit}
        className="w-full gap-0 data-[side=left]:w-full data-[side=right]:w-full sm:w-[calc(100%-2rem)] sm:data-[side=left]:w-[calc(100%-2rem)] sm:data-[side=right]:w-[calc(100%-2rem)] sm:data-[side=left]:max-w-none sm:data-[side=right]:max-w-none"
      >
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <SheetClose render={<Button variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" />}>
            <XIcon aria-hidden="true" />
            <span className="sr-only">{closeLabel}</span>
          </SheetClose>
          <SheetTitle className={titled ? 'min-w-0 truncate text-base font-medium' : 'sr-only'}>{title}</SheetTitle>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Where a create or an edit opens over the list, when its page names a mode:
 * shadcn's dialog or sheet, or the full-page document drawer above, open while
 * it is drawn, and closing it is the host's navigation back to the list.
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
    mode === 'sheet' ? <Sheet open onOpenChange={change}><SheetContent ref={popup} showCloseButton={false} initialFocus={initialFocusIn(popup)} className="gap-4 overflow-y-auto p-4 data-[side=left]:w-full data-[side=right]:w-full sm:data-[side=left]:w-3/4 sm:data-[side=right]:w-3/4"><SheetTitle className="sr-only">{title}</SheetTitle>{children}<CloseButton Close={SheetClose} label={closeLabel} /></SheetContent></Sheet>
    : mode === 'drawer' ? <DocumentDrawer title={title} titled={false} closeLabel={closeLabel} onClose={onClose}>{children}</DocumentDrawer>
    : <Dialog open onOpenChange={change}><DialogContent ref={popup} showCloseButton={false} initialFocus={initialFocusIn(popup)}><DialogTitle className="sr-only">{title}</DialogTitle>{children}<CloseButton Close={DialogClose} label={closeLabel} /></DialogContent></Dialog>
  // A server render draws nothing of the popup, which is a portal, so the mode is said here.
  return (
    <>
      <span hidden data-record-mode={mode} />
      {frame}
    </>
  )
}
