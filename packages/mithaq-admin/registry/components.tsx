import { createContext, use, type ComponentType, type ReactElement, type ReactNode } from 'react'
import type { builtInScreenKinds, ClientField, ClientKayan, NavEntry, NodeKind, registryCells, registryControls } from 'mithaq/admin'
import type { Cell, Control } from 'mithaq-admin/control-props.ts'
import { kindsIn, nodesOf, type NodeProps } from 'mithaq-admin/node-tree.ts'
import type { TreePage } from 'mithaq-admin/screen-refs.ts'

type Shipped = (typeof registryControls)[number]
// `join` among them: no form draws a join, so it needs no control.
type Drawn = Shipped | keyof typeof builtInScreenKinds
type ShippedCell = (typeof registryCells)[number]

// Each ships in a map of its own, which a project spreads only where its language draws with it, so a language
// without rich text or files never loads the editor or the upload code.
type AddOn = 'richText' | 'upload'

/** One control per name the registry ships but the add-ons, which `defaultComponents` holds. */
export type Controls = { readonly [Name in Exclude<Shipped, AddOn>]: Control }
/** One cell per name the registry ships but the add-ons, which `defaultComponents` holds. */
export type Cells = { readonly [Name in Exclude<ShippedCell, AddOn>]: Cell }

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
/** The add-ons some screen of a language draws a kind with, whose map the project spreads: `richTextComponents`, `uploadComponents`. */
export type AddOnsOf<L, Place extends 'control' | 'cell' = 'control' | 'cell'> = { [Kind in keyof KindsOf<L>]: DrawnWith<ScreensOf<L>, KindsOf<L>, Kind, Place> }[keyof KindsOf<L>] & AddOn

/** One control per shipped name, per add-on the language draws with and per kind of it that no shipped control draws, so leaving one out is a type error. */
export type ControlsOf<L> = Controls & { readonly [Name in AddOnsOf<L, 'control'> | OwnKinds<L>]: Control }
/** One cell per shipped name, per add-on the language draws with and per kind of it that no shipped cell draws. */
export type CellsOf<L> = Cells & { readonly [Name in AddOnsOf<L, 'cell'> | OwnCellKinds<L>]: Cell }

/**
 * One component per kind of node a page may hold, which `defaultComponents` holds. A project replaces one and adds
 * none: a screen's build refuses any kind mithaq/admin does not declare, so no page could name it, and a project
 * draws its own thing with a `component` node.
 */
export type Nodes = { readonly [Kind in NodeKind]: ComponentType<NodeProps<Kind>> }

export type NavIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
export type Icons = Readonly<Record<string, NavIcon>>

/** Every piece of the admin a project may replace or add to, each a map of named defaults it spreads. */
export type ComponentsOf<L> = {
  controls: ControlsOf<L>
  cells: CellsOf<L>
  nodes: Nodes
  /** Only the icons this app uses, imported by name so the rest are never bundled. */
  icons?: Icons
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

/** A declared name never silently falls back to a different icon. */
export const navIconFor = ({ icons, name, at }: { icons?: Icons; name: string; at: string }): NavIcon => {
  const found = icons && named<NavIcon>(icons, name)
  if (!found) throw new Error(`components.icons has no icon "${name}", which ${at} names. Import that icon and register it in components.icons.`)
  return found
}

/** An undeclared entry keeps its shell's fallback even outside a components provider. */
export function NavigationIcon({ name, fallback, at }: { name?: string; fallback: NavIcon; at: string }): ReactElement {
  const components = use(ComponentsContext)
  const Icon = name === undefined ? fallback : navIconFor({ icons: components?.icons, name, at })
  return <Icon aria-hidden />
}

const addOnMaps: Readonly<Record<AddOn, string>> = { richText: 'richTextComponents', upload: 'uploadComponents' }
/** What a missing name of an add-on adds to its error: the map that installs it. */
const installHint = (...names: (string | undefined)[]) => {
  const addOn = names.find((name): name is AddOn => name !== undefined && Object.hasOwn(addOnMaps, name))
  return addOn ? ` The kind is not installed: spread ${addOnMaps[addOn]} into the map.` : ''
}

/** The component a node of this kind is drawn by; a kind the map does not carry is an error, never drawn as nothing. */
export const nodeFor = (nodes: Nodes, kind: string): ComponentType<NodeProps> => {
  // A map written before it carried nodes has none, which reads as every kind missing rather than a bare TypeError.
  const found = nodes && named<ComponentType<NodeProps>>(nodes, kind)
  if (!found) throw new Error(`components.nodes has no node "${kind}". Spread defaultComponents.nodes into the map and add one under that name.`)
  return found
}
// A `ui()` reference is drawn by the screen and never by the map, and only a reference holds a `#`.
const drawnByMap = (name: string) => !name.includes('#')

/**
 * The control for a field: the one its screen decided, else the kind's own. A name the map does not carry falls through to the kind, and a kind it does not carry is an error, so a map that leaves a kind out says so instead of drawing something else.
 */
export const controlFor = (controls: Controls, field: ClientField): Control => {
  const found = namedControl(controls, field.component) ?? namedControl(controls, field.kind)
  if (!found) throw new Error(`components.controls has no control for "${field.kind}", the kind of field "${field.name}".${installHint(field.component, field.kind) || ' Spread defaultComponents.controls into the map and add one under that name.'}`)
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
    if (!named) throw new Error(`components.cells has no cell "${column}", which field "${field.name}" is drawn with.${installHint(column) || ' Spread defaultComponents.cells into the map and add one under that name.'}`)
    return named
  }
  const found = namedCell(cells, field.cell) ?? namedCell(cells, field.kind)
  if (!found) throw new Error(`components.cells has no cell for "${field.kind}", the kind of field "${field.name}".${installHint(field.cell, field.kind) || ' Spread defaultComponents.cells into the map and add one under that name.'}`)
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
 * Every field a screen draws, every cell its pages name and every kind of node they hold, checked against the map once, so an app that calls this as it starts fails there, naming each kind and field, and not on the page that first draws one. A join is drawn by no form, so it needs no control; an operation's box is drawn by no list, so it needs no cell.
 */
export const checkComponents = ({ client, components }: { client: { path?: string; nav?: readonly NavEntry[]; kayan: Readonly<Record<string, Pick<ClientKayan, 'name' | 'fields' | 'operations' | 'pages'>>> }; components: Components }): void => {
  const { cells, controls, nodes } = components
  const missing = Object.values(client.kayan).flatMap((kayan) => [
    ...Object.entries(kayan.pages ?? {}).flatMap(([page, drawn]) => ('page' in drawn && drawn.page ? kindsIn(nodesOf(drawn as TreePage)) : [])
      .filter((kind) => !nodes || !Object.hasOwn(nodes, kind))
      .map((kind) => `components.nodes has no node "${kind}", which screen ${client.path} ${kayan.name} page "${page}" draws.`)),
    ...Object.entries(kayan.pages ?? {}).flatMap(([page, drawn]) => namedCells(drawn, `screen ${client.path} ${kayan.name} page "${page}" leaf`))
      .filter(({ cell }) => !namedCell(cells, cell))
      .map(({ cell, at }) => `components.cells has no cell "${cell}", which ${at} names.${installHint(cell)}`),
    ...[...kayan.fields, ...kayan.operations.flatMap((operation) => operation.fields ?? [])]
      .filter((field) => field.kind !== 'join' && !namedControl(controls, field.component) && !namedControl(controls, field.kind))
      .map((field) => `components.controls has no control for kind "${field.kind}", which ${kayan.name}.${field.name} is drawn with.${installHint(field.component, field.kind)}`),
    ...kayan.fields
      .filter((field) => !namedCell(cells, field.cell) && !namedCell(cells, field.kind))
      .map((field) => `components.cells has no cell for kind "${field.kind}", which ${kayan.name}.${field.name} is drawn with.${installHint(field.cell, field.kind)}`),
  ])
  for (const entry of client.nav ?? []) {
    if (entry.icon !== undefined) {
      try { navIconFor({ icons: components.icons, name: entry.icon, at: `screen ${client.path} nav "${entry.path}"` }) }
      catch (error) { missing.push((error as Error).message) }
    }
  }
  if (missing.length) throw new Error(`${[...new Set(missing)].join('\n')}\nSpread defaultComponents.controls, defaultComponents.cells and defaultComponents.nodes into the map and add one under each name.`)
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
