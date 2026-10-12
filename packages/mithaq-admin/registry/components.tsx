import { createContext, use, type ReactElement, type ReactNode } from 'react'
import type { builtInScreenKinds, ClientField, registryControls } from 'mithaq/admin'
import type { Control } from './control-props.ts'

type Shipped = (typeof registryControls)[number]
// `join` among them: no form draws a join, so it needs no control.
type Drawn = Shipped | keyof typeof builtInScreenKinds

/** One control per name the registry ships, which `defaultComponents` holds. */
export type Controls = { readonly [Name in Shipped]: Control }

type KindsOf<L> = L extends { kinds: infer Kinds } ? Kinds : {}
type ScreensOf<L> = L extends { targets: infer Targets } ? Extract<Targets[keyof Targets], { capability: 'screen' }> : never
// What a screen draws a kind with, in the order the build resolves it: the screen's own row, the kind's own, then the shipped table, whose row is the kind's name.
type ControlOf<Screen, Kinds, Kind extends keyof Kinds> = Screen extends { controls: infer Table }
  ? Kind extends keyof Table
    ? Table[Kind] extends { control: infer Named } ? Named : never
    : Kinds[Kind] extends { targets: { screen: { control: infer Named } } } ? Named : Kind
  : never
/** The kinds of a language that some screen draws with no control the registry ships: the project's map draws each by the kind's name. */
export type OwnKinds<L> = {
  [Kind in keyof KindsOf<L>]: ControlOf<ScreensOf<L>, KindsOf<L>, Kind> extends Drawn ? never : Kind
}[keyof KindsOf<L>] & string

/** One control per shipped name and per kind of this language that no shipped control draws, so leaving one out is a type error. */
export type ControlsOf<L> = Controls & { readonly [Kind in OwnKinds<L>]: Control }

/** Every piece of the admin a project may replace or add to, each a map of named defaults it spreads. */
export type ComponentsOf<L> = {
  controls: ControlsOf<L>
}

/** The map of a language that adds no kind of its own, which `defaultComponents` is. */
export type Components = ComponentsOf<unknown>

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
 * The control for a field: the one its screen decided, else the kind's own. A name the map does not carry falls through to the kind, and a kind it does not carry is an error, so a map that leaves a kind out says so instead of drawing something else.
 */
export const controlFor = (controls: Controls, field: ClientField): Control => {
  const found = namedControl(controls, field.component) ?? namedControl(controls, field.kind)
  if (!found) throw new Error(`components.controls has no control for "${field.kind}", the kind of field "${field.name}". Spread defaultComponents.controls into the map and add one under that name.`)
  return found
}

/**
 * Whether a control's label sits beside it rather than above: a checkbox or a switch reads as attached to its words.
 */
export const besideLabel = (controls: Controls, Control: unknown) => Control === controls.checkbox || Control === controls.switch
