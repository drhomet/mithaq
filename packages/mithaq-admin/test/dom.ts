// A DOM for the tests that dispatch events. `react-dom/server` never mounts, so
// nothing it renders has a handler attached.
import { after } from 'node:test'
import { Window } from 'happy-dom'

export const window = new Window({ url: 'http://localhost/' })

// happy-dom keeps timers and async tasks on the window; closing it lets the process exit.
after(async () => {
  await window.happyDOM.close()
})

for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue
  Reflect.set(globalThis, key, Reflect.get(window, key))
}
// Node defines its own Event, CustomEvent and EventTarget, and happy-dom's
// `dispatchEvent` rejects them, which makes every popover, select and dialog
// throw on mount.
for (const key of ['Event', 'CustomEvent', 'EventTarget']) {
  Reflect.set(globalThis, key, Reflect.get(window, key))
}
Reflect.set(globalThis, 'window', window)
Reflect.set(globalThis, 'document', window.document)
// Without this `act` reports the environment is not configured to support it.
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

/** A fresh element under the document's body, so one test's tree is never another's. */
export const mount = (): HTMLElement => {
  const host = window.document.createElement('div')
  window.document.body.append(host)
  return host as unknown as HTMLElement
}

/** One event as the browser raises it: bubbling, so React's root listener sees it. */
export const fire = (node: Element, type: string) =>
  // happy-dom's Event is structurally narrower than lib.dom's.
  node.dispatchEvent(new window.Event(type, { bubbles: true }) as unknown as Event)

/**
 * Text typed into a controlled input through the prototype's own setter: React
 * overrides the element's `value`, so a plain assignment updates its tracker
 * and the `input` event is dropped as an echo.
 */
export const type = (node: Element, text: string) => {
  const prototype = node instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement
  Object.getOwnPropertyDescriptor(prototype.prototype, 'value')!.set!.call(node, text)
  fire(node, 'input')
}

/**
 * A pointer press in the browser's order: pointerdown, mousedown, pointerup, mouseup, click. base-ui needs it:
 * a combobox opens on mousedown, and an item treats a mouseup without its own pointerdown as a drag-select.
 */
export const click = (node: Element) => {
  for (const type of ['pointerdown', 'pointerup']) {
    node.dispatchEvent(new window.PointerEvent(type, { bubbles: true, button: 0, isPrimary: true }) as unknown as Event)
    node.dispatchEvent(
      new window.MouseEvent(type === 'pointerdown' ? 'mousedown' : 'mouseup', { bubbles: true, button: 0, detail: 1 }) as unknown as Event,
    )
  }
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0, detail: 1 }) as unknown as Event)
}

/**
 * One keydown, bubbling so React's root listener and a listener on the document
 * both see it: a combobox handles arrows and Enter on its input, and Escape is
 * read off the document.
 */
export const press = (node: Element, key: string) =>
  node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }) as unknown as Event)
