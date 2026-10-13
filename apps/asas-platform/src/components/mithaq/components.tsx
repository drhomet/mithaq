import { createContext, use, type ReactElement, type ReactNode } from 'react'
import type { builtInScreenKinds, ClientField, ClientKayan, registryCells, registryControls } from 'mithaq/admin'
import type { Cell, Control } from './control-props.ts'

type Shipped = (typeof registryControls)[number]
// `join` among them: no form draws a join, so it needs no control.
type Drawn = Shipped | keyof typeof builtInScreenKinds
type ShippedCell = (typeof registryCells)[number]

/** One control per name the registry ships, which `defaultComponents` holds. */
export type Controls = { readonly [Name in Shipped]: Control }
/** One cell per name the registry ships, which `defaultComponents` holds. */
export type Cells = { readonly [Name in ShippedCell]: Cell }

type KindsOf<L> = L extends { kinds: infer Kinds } ? Kinds : {}
type ScreensOf<L> = L extends { targets: infer Targets } ? Extract<Targets[keyof Targets], { capability: 'screen' }> : never
// What a screen draws a kind with in one place, in the order the build resolves it: the screen's own row, the kind's own, then the shipped table, whose row is the kind's name.
type DrawnWith<Screen, Kinds, Kind extends keyof Kinds, Place extends 'control' | 'cell'> = Screen extends { controls: infer Table }
  ? Kind extends keyof Table
    ? Table[Kind] extends Record<Place, infer Named> ? Named : never
    : Kinds[Kind] extends { targets: { screen: Record<Place, infer Named> } } ? Named : Kind
  : never
type Own<L, Place extends 'control' | 'cell', Ships> = {
  [Kind in keyof KindsOf<L>]: DrawnWith<ScreensOf<L>, KindsOf<L>, Kind, Place> extends Ships ? never : Kind
}[keyof KindsOf<L>] & string
/** The kinds of a language that some screen draws with no control the registry ships: the project's map draws each by the kind's name. */
export type OwnKinds<L> = Own<L, 'control', Drawn>
/** The kinds of a language that some screen draws with no cell the registry ships. */
export type OwnCellKinds<L> = Own<L, 'cell', ShippedCell>

/** One control per shipped name and per kind of this language that no shipped control draws, so leaving one out is a type error. */
export type ControlsOf<L> = Controls & { readonly [Kind in OwnKinds<L>]: Control }
/** One cell per shipped name and per kind of this language that no shipped cell draws. */
export type CellsOf<L> = Cells & { readonly [Kind in OwnCellKinds<L>]: Cell }

/** Every piece of the admin a project may replace or add to, each a map of named defaults it spreads. */
export type ComponentsOf<L> = {
  controls: ControlsOf<L>
  cells: CellsOf<L>
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

// Own keys only: a field's `component` or `cell` is a string off the projection, and a map spread into a plain object
// would answer `constructor` or `toString` with a function that is not a control or a cell.
const named = <Drawn,>(map: object, name: string | undefined): Drawn | undefined =>
  name !== undefined && Object.hasOwn(map, name) ? (map as Readonly<Record<string, Drawn>>)[name] : undefined
export const namedControl = (controls: Controls, name: string | undefined) => named<Control>(controls, name)
export const namedCell = (cells: Cells, name: string | undefined) => named<Cell>(cells, name)
// A `ui()` reference is drawn by the screen and never by the map, and only a reference holds a `#`.
const drawnByMap = (name: string) => !name.includes('#')

/**
 * The control for a field: the one its screen decided, else the kind's own. A name the map does not carry falls through to the kind, and a kind it does not carry is an error, so a map that leaves a kind out says so instead of drawing something else.
 */
export const controlFor = (controls: Controls, field: ClientField): Control => {
  const found = namedControl(controls, field.component) ?? namedControl(controls, field.kind)
  if (!found) throw new Error(`components.controls has no control for "${field.kind}", the kind of field "${field.name}". Spread defaultComponents.controls into the map and add one under that name.`)
  return found
}

/**
 * The cell for a field: the one a list column or a leaf names, else the field's own, else the kind's. A cell a column
 * or a leaf names is drawn or is an error, never something else in its place; the field's own falls through to the
 * kind, and a kind the map does not carry is an error, as for a control. A column's `ui()` reference is the screen's
 * to draw, so where the screen does not, the field's own cell stands.
 */
export const cellFor = ({ cells, field, column }: { cells: Cells; field: ClientField; column?: string }): Cell => {
  if (column !== undefined && drawnByMap(column)) {
    const named = namedCell(cells, column)
    if (!named) throw new Error(`components.cells has no cell "${column}", which field "${field.name}" is drawn with. Spread defaultComponents.cells into the map and add one under that name.`)
    return named
  }
  const found = namedCell(cells, field.cell) ?? namedCell(cells, field.kind)
  if (!found) throw new Error(`components.cells has no cell for "${field.kind}", the kind of field "${field.name}". Spread defaultComponents.cells into the map and add one under that name.`)
  return found
}

// Every cell a list column or a leaf of a page names, with where it names it.
const namedCells = (node: unknown, at: string): { cell: string; at: string }[] => {
  if (Array.isArray(node)) return node.flatMap((one) => namedCells(one, at))
  if (!node || typeof node !== 'object') return []
  const held = node as Record<string, unknown>
  const own = typeof held.field === 'string' && typeof held.cell === 'string' && drawnByMap(held.cell) ? [{ cell: held.cell, at: `${at} "${held.field}"` }] : []
  return [...own, ...Object.entries(held).flatMap(([key, value]) => namedCells(value, key === 'columns' ? at.replace(/ leaf$/, ' list column') : at))]
}

/**
 * Every field a screen draws, and every cell its pages name, checked against the map once, so an app that calls this as it starts fails there, naming each kind and field, and not on the page that first draws one. A join is drawn by no form, so it needs no control; an operation's box is drawn by no list, so it needs no cell.
 */
export const checkComponents = ({ client, components }: { client: { path?: string; kayan: Readonly<Record<string, Pick<ClientKayan, 'name' | 'fields' | 'operations' | 'pages'>>> }; components: Components }): void => {
  const { cells, controls } = components
  const missing = Object.values(client.kayan).flatMap((kayan) => [
    ...Object.entries(kayan.pages ?? {}).flatMap(([page, drawn]) => namedCells(drawn, `screen ${client.path} ${kayan.name} page "${page}" leaf`))
      .filter(({ cell }) => !namedCell(cells, cell))
      .map(({ cell, at }) => `components.cells has no cell "${cell}", which ${at} names.`),
    ...[...kayan.fields, ...kayan.operations.flatMap((operation) => operation.fields ?? [])]
      .filter((field) => field.kind !== 'join' && !namedControl(controls, field.component) && !namedControl(controls, field.kind))
      .map((field) => `components.controls has no control for kind "${field.kind}", which ${kayan.name}.${field.name} is drawn with.`),
    ...kayan.fields
      .filter((field) => !namedCell(cells, field.cell) && !namedCell(cells, field.kind))
      .map((field) => `components.cells has no cell for kind "${field.kind}", which ${kayan.name}.${field.name} is drawn with.`),
  ])
  if (missing.length) throw new Error(`${[...new Set(missing)].join('\n')}\nSpread defaultComponents.controls and defaultComponents.cells into the map and add one under each kind's name.`)
}

/** What a route that threw draws in place of its page, inside the shell above it: the error's own words, which name what to fix. */
export function RouteError({ error }: { error: unknown }): ReactElement {
  return (
    <div role="alert" data-route-error="" className="m-4 rounded-md border border-destructive/50 px-3 py-2 text-sm whitespace-pre-line text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </div>
  )
}

/**
 * Whether a control's label sits beside it rather than above: a checkbox or a switch reads as attached to its words.
 */
export const besideLabel = (controls: Controls, Control: unknown) => Control === controls.checkbox || Control === controls.switch
// mithaq-admin a5b0579ead0ea90a1c1f8e4f767641c7e178a7af a9eed57ae531cca2b297c13bd065552c0cfa6e2ca8fbe0e64aabfa575dbe0069
