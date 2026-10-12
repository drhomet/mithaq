import { createContext, use, type ReactElement, type ReactNode } from 'react'
import { registryControls, type ClientField } from 'mithaq/admin'
import type { Control } from './control-props.ts'

/**
 * One control per name the registry ships. The names are closed: a screen refuses a control name the registry does not ship, so a project draws its own control through the screen's `components` and a `ui()` reference, and swaps a shipped one here.
 */
export type Controls = { readonly [Name in (typeof registryControls)[number]]: Control }

/** Every piece of the admin a project may replace, each a map of named defaults it spreads. */
export type Components = {
  controls: Controls
}

const ComponentsContext = createContext<Components | null>(null)

/** Where a project hands the admin its components, `defaultComponents` or its own spread of it. */
export function ComponentsProvider({ components, children }: { components: Components; children?: ReactNode }): ReactElement {
  return <ComponentsContext value={components}>{children}</ComponentsContext>
}

export const useComponents = (): Components => {
  const components = use(ComponentsContext)
  // No fallback: a project sees and owns the map it draws with.
  if (!components) throw new Error('The admin draws its controls from the components map: mount the screens under <ComponentsProvider components={defaultComponents}>.')
  return components
}

// Own keys only: a field's `component` is a string off the projection, and a map spread into a plain object would
// answer `constructor` or `toString` with a function that is not a control.
export const namedControl = (controls: Controls, name: string | undefined): Control | undefined =>
  name !== undefined && Object.hasOwn(controls, name) ? (controls as Readonly<Record<string, Control>>)[name] : undefined

/**
 * The control for a field: the one its screen decided, else the kind's own. A name the map does not carry falls through to the kind. A shipped kind the map leaves out is an error, so a map built without a spread of the defaults says so instead of drawing something else. A kind of the project's own that no registry ships is drawn by the map's read-only `uuid` control: it shows its value and takes no edit.
 */
export const controlFor = (controls: Controls, field: ClientField): Control => {
  const found = namedControl(controls, field.component) ?? namedControl(controls, field.kind)
  if (found) return found
  if (!(registryControls as readonly string[]).includes(field.kind)) return controls.uuid
  throw new Error(`components.controls has no control for "${field.kind}", the kind of field "${field.name}". Spread defaultComponents.controls into the map and replace a control by its name.`)
}

/**
 * Whether a control's label sits beside it rather than above: a checkbox or a switch reads as attached to its words.
 */
export const besideLabel = (controls: Controls, Control: unknown) => Control === controls.checkbox || Control === controls.switch
