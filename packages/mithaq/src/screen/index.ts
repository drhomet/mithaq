import { existsSync, readFileSync } from 'node:fs'
import { builtInScreenKinds, choiceControls, packageName, registryCells, registryControls } from './client.ts'
import { unsortable, type Localized, type LocalesOf, type ResolvedField, type ResolvedKayan, type RuntimeField } from '../mithaq/types.ts'
import { defaultKinds } from '../base/kinds.ts'
import { assertFieldWhere } from '../asas/runner/write.ts'
import { type Where } from '../mithaq/where.ts'
import { bulkSeals, readSeals, sealOf, storeSeals } from '../asas/runner/steps.ts'
import { kindOf, type NodeKind } from './studio.ts'
import { implementationOf } from '../mithaq/rukn.ts'

/** What one kind is drawn by on a screen: its form control and its list cell, each a name or a `ui()` reference. */
export type ScreenKind = { readonly cell: string | Ui; readonly control: string | Ui }

/** What the shipped registry draws each shipped kind with. A screen's `controls` spreads it and adds or rewrites rows. */
export const screenKinds = {
  ...(Object.fromEntries(Object.keys(defaultKinds).map((kind) => [kind, { cell: kind, control: kind }])) as {
    [Name in keyof typeof defaultKinds]: { cell: Name; control: Name }
  }),
} as const

// A name the registry does not ship is no reference here, whoever names it.
type OwnScreenNames<Kinds> = {
  [Name in keyof Kinds]: Kinds[Name] extends { targets: { screen: { control: infer Control; cell: infer Cell } } }
    ? Extract<Control, (typeof registryControls)[number]> | Extract<Cell, (typeof registryCells)[number]>
    : never
}[keyof Kinds]

declare const uiBrand: unique symbol
/** One export of one file, as a URL whose hash is the export's name: `ui('dashboard.tsx#Dashboard')`. */
export type Ui<Path extends string = string> = URL & { readonly [uiBrand]: Path }

/**
 * The folder a project's screen files sit in, handed back as `ui`:
 * `const ui = folderOf(new URL('./ui-dashboard/', import.meta.url))`. A missing file or export fails the build.
 */
export const folderOf = (folder: URL) => {
  if (!(folder instanceof URL) || !folder.href.endsWith('/')) {
    throw new Error(`folderOf takes a folder URL ending in /, and was handed ${String(folder)}. Write folderOf(new URL('./folder/', import.meta.url)).`)
  }
  return <const Path extends `${string}#${string}`>(path: Path) => new URL(path, folder) as Ui<Path>
}

/** A component named where a screen draws one: a name the screen registered, a bare built-in the registry ships, or a `ui()` reference. */
export type ScreenRef<Registered extends string = string> = Registered | Ui

/** A page of the screen's own, which belongs to no kayan: one component drawing the whole page. */
export type ScreenOwnPage<Locale extends string = string, Ref extends string | Ui = string | Ui> = {
  readonly path: string
  readonly component: Ref
  /** A nav entry for this page, under this label. */
  readonly nav?: { readonly label: Localized<Locale> }
  /** The catalog key an actor needs for the nav to list this page. */
  readonly permission?: string
}

/** The screen as a target, `capability: 'screen'`. */
export type ScreenTarget<
  Controls extends Record<string, ScreenKind> = Record<string, ScreenKind>,
  Layouts extends Record<string, Ui> = Record<string, Ui>,
  Components extends Record<string, Ui> = Record<string, Ui>,
> = {
  readonly capability: 'screen'
  readonly type: 'screen'
  /** Where the screen mounts. */
  readonly path: string
  /** Every kayan the screen draws, by name. A kayan it does not list writes no `targets.<screen>`. */
  readonly kayan: readonly string[]
  /** One row per kind of the language: what draws its value in a form and in a list. */
  readonly controls: Controls
  /** Outermost first, each handed `{ children }`. */
  readonly providers: readonly ScreenRef<keyof Components & string>[]
  /** The pages that belong to no kayan, each drawn whole by one component. One of them is at `/`. */
  readonly pages: Readonly<Record<string, ScreenOwnPage<string, ScreenRef<keyof Components & string>>>>
  /** The shells and layouts a page tree names, by a short name. */
  readonly layouts: Layouts
  /** The components a page names, by a short name. */
  readonly components: Components
}

export const screenTarget = <
  const Controls extends Record<string, ScreenKind>,
  const Layouts extends Record<string, Ui>,
  const Components extends Record<string, Ui>,
>(target: Omit<ScreenTarget<Controls, Layouts, Components>, 'capability' | 'type'>): ScreenTarget<Controls, Layouts, Components> => ({
  capability: 'screen',
  type: 'screen',
  ...target,
})

/** What `targets.<screen>` on a field may say: how it is drawn, never what it holds. */
export type ScreenField<Ref extends string | Ui = string | Ui> = {
  readonly component?: Ref
  readonly cell?: Ref
  readonly width?: string
  readonly filter?: true
  readonly searchable?: true
  readonly sortable?: false
}

/** When a node is drawn: a `Where` over the form's values, the loaded row under `record.` and the access report under `$user.`. */
export type When = { readonly when?: Where }

/** A field on one page: its name, or its name with what this page alone draws it with. */
export type ScreenLeaf<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string> =
  | FieldName
  | ({
      readonly field: FieldName
      readonly component?: Ref
      readonly cell?: Ref
      readonly placeholder?: Localized<Locale>
      readonly description?: Localized<Locale>
      readonly readOnly?: boolean
      readonly width?: string
    } & When)

type ScreenGroup<Locale extends string, Ref extends string | Ui, FieldName extends string> = {
  readonly label: Localized<Locale>
  readonly description?: Localized<Locale>
  readonly fields: readonly ScreenNode<Locale, Ref, FieldName>[]
}

/** The regions of a shell or a layout, each a list of nodes, by the names its file exports. */
export interface ScreenRegions<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string> {
  readonly [region: string]: readonly ScreenNode<Locale, Ref, FieldName>[] | Ref | Where | undefined
}

/** A page's tree: a shell by name at its root, whose regions hold nodes. */
export interface ScreenFrame<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string>
  extends ScreenRegions<Locale, Ref, FieldName> {
  readonly shell: Ref
}

/** A layout nested in a region, with regions of its own. */
export interface ScreenLayout<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string>
  extends ScreenRegions<Locale, Ref, FieldName> {
  readonly layout: Ref
  readonly when?: Where
}

/**
 * One node of a page's region. A layout's regions are keys of its own, so a
 * walk rules out `layout` before it asks for any other key.
 */
export type ScreenNode<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string> =
  | ScreenLeaf<Locale, Ref, FieldName>
  | ({ readonly form: readonly ScreenNode<Locale, Ref, FieldName>[]; readonly component?: Ref } & When)
  | ({
      readonly list:
        | ScreenList<Locale, Ref, FieldName>
        | (ScreenList<Locale, Ref, string> & {
            /** Another kayan of the screen, whose rows this list draws, each column one of its fields. */
            readonly of: string
            /** `of`'s relationship holding this page's row, which scopes the list to the rows pointing here. */
            readonly where: string
          })
      readonly component?: Ref
    } & When)
  | ({ readonly component: Ref } & When)
  | ScreenLayout<Locale, Ref, FieldName>
  | ScreenButton<Locale, Ref>
  | ({ readonly title: Readonly<Record<string, never>> } & When)
  | ({ readonly nav: Readonly<Record<string, never>> } & When)
  /** The form's controls: where the row stands, the last save and the save buttons. */
  | ({ readonly controls: Readonly<Record<string, never>> } & When)
  | ({ readonly row: readonly ScreenNode<Locale, Ref, FieldName>[]; readonly resizable?: true } & When)
  | ({ readonly separator: true } & When)
  | ({
      readonly section: string
      readonly collapsed?: boolean
      readonly width?: number
      /** A CSS height the section's body scrolls within, shadcn's `scroll-area`. */
      readonly scroll?: string
    } & ScreenGroup<Locale, Ref, FieldName> & When)
  | ({ readonly tabs: readonly ({ readonly tab: string } & ScreenGroup<Locale, Ref, FieldName>)[] } & When)
  | ({ readonly accordion: readonly ({ readonly item: string } & ScreenGroup<Locale, Ref, FieldName>)[] } & When)

/** A list node's own keys: its columns, what it filters, searches and opens with, and its buttons. */
export type ScreenList<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string> = {
  readonly columns: readonly ScreenLeaf<Locale, Ref, FieldName>[]
  readonly filters?: readonly FieldName[]
  /** The fields a search box runs over: a field of this kayan, or one hop to a text field of a kayan it points at, `userId.email`. */
  readonly search?: readonly (FieldName | `${FieldName}.${string}`)[]
  readonly empty?: Ref
  /** What each row's menu offers after the list's own items: a component handed the row (`MenuProps`). */
  readonly menu?: Ref
  /** Buttons above the table, which run over no row. */
  readonly toolbar?: readonly ScreenButton<Locale, Ref>[]
  /** Buttons over the ticked rows, each an `updateMany` or a `deleteMany`. */
  readonly bulk?: readonly ScreenButton<Locale, Ref>[]
  /** Buttons on each row, each an `update` or a `remove` over that row, drawn where its `when` holds. */
  readonly row?: readonly ScreenButton<Locale, Ref>[]
  /** The order a list opens in, which the URL's own `sort` overrides. */
  readonly sort?: FieldName | `-${FieldName}`
  /** The page size a list opens with, which the URL's own `limit` overrides. */
  readonly limit?: number
}

/** A declared node of one kind; a leaf may be written as its bare field name. */
type Declared<Kind extends NodeKind> = Extract<ScreenNode, Record<Kind, unknown>> | (Kind extends 'field' ? string : never)

/** A button that runs one of the kayan's operations, wherever it sits: `button` names the operation. */
export type ScreenButton<Locale extends string = string, Ref extends string | Ui = string | Ui> = {
  readonly button: string
  readonly label: Localized<Locale>
  readonly fields?: readonly string[]
  readonly reload?: boolean
  readonly component?: Ref
  /** What the button asks before it runs. */
  readonly confirm?: { readonly title: Localized<Locale>; readonly body: Localized<Locale> }
  readonly when?: Where
}

/** One page: `list`, `create` and `edit` by name, any other name a custom page. Declared as one tree, or drawn whole by one component. */
export type ScreenPage<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string> =
  | {
      readonly path: string
      readonly page: ScreenFrame<Locale, Ref, FieldName>
      /** `create` and `edit` only: the record opens over the list, in one of shadcn's three. */
      readonly mode?: 'dialog' | 'drawer' | 'sheet'
      readonly component?: never
    }
  | { readonly path: string; readonly component: Ref; readonly page?: never; readonly mode?: never }

/** What `targets.<screen>` on a kayan says, complete for that screen. */
export type ScreenKayan<Locale extends string = string, Ref extends string | Ui = string | Ui, FieldName extends string = string> = {
  readonly useAsTitle?: FieldName
  readonly description?: Localized<Locale>
  /** The rows this screen lists of the kayan, ANDed with whatever a list asks. A list filter, not access: a row it leaves out is still read by its id. */
  readonly baseFilter?: Where
  readonly pages?: Readonly<Record<string, ScreenPage<Locale, Ref, FieldName>>>
}

/** The screen keys of a build's targets. */
export type ScreenKeys<Targets> = {
  [Name in keyof Targets]: Targets[Name] extends { capability: 'screen' } ? Name : never
}[keyof Targets] &
  string

/** Every reference a declaration may write on one screen of a build. */
export type RefOf<Target, Kinds = {}> = Target extends { layouts: infer Layouts; components: infer Components }
  ? ScreenRef<(keyof Layouts | keyof Components | keyof typeof builtInScreenKinds | keyof typeof defaultKinds | OwnScreenNames<Kinds>) & string>
  : string | Ui

type FieldData = {
  name: string
  kind: string
  // The label function is left off: the projection is built once per boot, so calling
  // it would freeze one locale into every request. The browser resolves `<kayan>.<field>`.
  label?: Localized
  // Data rules only: a project rule's value may be a closure. `defaultValue` is left
  // off, since it may name the actor's keys or carry a value for a field nobody may read.
  rules: Readonly<Record<string, unknown>>
  /** Relationship and join only: the name of the kayan this field points at. */
  relationTo?: string
  /** Join only: the child's relationship that holds this row's id. */
  on?: string
  /** Relationship only: whether this field holds a set of rows rather than one. */
  hasMany?: true
}

/** One field as a screen draws it: the data a browser needs, and this screen's drawing facts decided. */
export type ClientField = FieldData & {
  options?: readonly { value: string; label: Localized }[]
  placeholder?: Localized
  prefix?: Localized
  suffix?: Localized
  description?: Localized
  /** The control the form draws it with where a page names nothing else, resolved. */
  component: string
  /** The cell the list draws it with where a page names nothing else, resolved. */
  cell: string
} & Omit<ScreenField, 'component' | 'cell'>

/** A leaf as `screen.json` prints it: the field, and what this page decided it is drawn with. */
export type LeafClient = {
  field: string
  component?: string
  cell?: string
  /** Which level decided what this leaf draws: the `leaf`, the `field`'s own `targets.<screen>`, or the screen's `controls` `table`. */
  decided?: 'field' | 'leaf' | 'table'
  placeholder?: Localized
  description?: Localized
  readOnly?: boolean
  width?: string
  when?: Where
}
type GroupClient = { label: Localized; description?: Localized; fields: NodeClient[] }
/** A shell's or a layout's regions as `screen.json` prints them. */
export type RegionsClient = { [region: string]: NodeClient[] | string | Where | undefined }
/** A button node as `screen.json` prints it. */
export type ButtonClient = {
  button: string
  label: Localized
  fields?: string[]
  reload?: boolean
  component?: string
  confirm?: { title: Localized; body: Localized }
  when?: Where
}
/** A list node's own keys as `screen.json` prints them. */
export type ListClient = {
  columns: LeafClient[]
  filters?: string[]
  search?: string[]
  empty?: string
  menu?: string
  toolbar?: ButtonClient[]
  bulk?: ButtonClient[]
  row?: ButtonClient[]
  sort?: string
  limit?: number
  /** A list of another kayan: its name, and its relationship holding this page's row. */
  of?: string
  where?: string
}
/** A node as `screen.json` prints it, every reference resolved, and its `when` where it has one. */
export type NodeClient =
  | LeafClient
  | ButtonClient
  | ((
      | { form: NodeClient[]; component?: string }
      | { list: ListClient; component?: string }
      | { component: string }
      | ({ layout: string } & RegionsClient)
      | { title: Record<string, never> }
      | { nav: Record<string, never> }
      | { controls: Record<string, never> }
      | { row: NodeClient[]; resizable?: true }
      | { separator: true }
      | ({ section: string; collapsed?: boolean; width?: number; scroll?: string } & GroupClient)
      | { tabs: ({ tab: string } & GroupClient)[] }
      | { accordion: ({ item: string } & GroupClient)[] }
    ) & { when?: Where })

/** A page's tree as `screen.json` prints it: the shell at the root, and its regions. */
export type FrameClient = { shell: string } & RegionsClient

/** A kayan's page: its tree, or the one component drawing it whole. */
export type PageClient =
  | { path: string; page: FrameClient; mode?: 'dialog' | 'drawer' | 'sheet' }
  | { path: string; component: string }

/** A page of the screen's own, drawn whole by one component. */
export type ScreenPageClient = { path: string; component: string; nav?: { label: Localized }; permission?: string }

/** One entry of the screen's nav: a kayan's page or a page of the screen's own, and the catalog key an actor needs to see it. */
export type NavEntry = { path: string; page: string; kayan?: string; label?: Localized; permission?: string }

export type ClientKayan<Pages extends string = string> = {
  name: string
  single: boolean
  fields: ClientField[]
  operations: { name: string; effect: string; fields?: ClientField[]; updatesMany?: true }[]
  useAsTitle?: string
  description?: Localized
  /** The rows every list of this kayan on the screen is held to (`ScreenKayan` `baseFilter`). */
  baseFilter?: Where
  /** Whether the kayan keeps drafts, and its autosave interval where it does. */
  drafts?: { autosave?: { interval: number } }
  /** The types a kayan holding files takes and its largest file in bytes, so the upload control refuses a file before sending it. */
  storage?: { mimeTypes: readonly string[]; fileSize: number }
  pages: Record<Pages, PageClient>
}

/** What `asas.targets.<screen>.client` holds and `screen.json` prints, with every reference resolved. */
export type ScreenClient<Pages extends Record<string, string> = Record<string, string>> = {
  path: string
  providers: string[]
  pages: Record<string, ScreenPageClient>
  nav: NavEntry[]
  layouts: Record<string, string>
  components: Record<string, string>
  controls: Record<string, { control: string; cell: string }>
  kayan: { [Name in keyof Pages]: ClientKayan<Pages[Name]> }
  /** The most rows a served read answers, so a page paging through every row holds to the project's number. */
  maxLimit: number
}

// No server closures: this is what every screen hands a browser.
export const clientFieldOf = (name: string, field: RuntimeField & { target?: { name: string } }): FieldData => ({
  name,
  kind: field.kind,
  ...(typeof field.label === 'object' && { label: field.label }),
  rules: Object.fromEntries(
    Object.entries(field.rules ?? {}).filter(
      ([rule, value]) => rule !== 'defaultValue' && typeof value !== 'function',
    ),
  ),
  // A declared operation input field is resolved nowhere, so its target is read off the declaration.
  ...(field.target
    ? { relationTo: field.target.name }
    : typeof field.relationTo === 'string'
      ? { relationTo: field.relationTo }
      : typeof field.relationTo === 'function'
        ? { relationTo: field.relationTo().name }
        : {}),
  ...(field.hasMany === true && { hasMany: true as const }),
  ...(typeof field.on === 'string' && { on: field.on }),
})


const word = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u
const targetKeys = ['capability', 'type', 'path', 'kayan', 'controls', 'providers', 'pages', 'layouts', 'components']
const leafKeys = ['field', 'component', 'cell', 'placeholder', 'description', 'readOnly', 'width', 'when']
const buttonKeys = ['button', 'label', 'fields', 'reload', 'component', 'confirm', 'when']
const listKeys = ['columns', 'filters', 'search', 'empty', 'menu', 'toolbar', 'bulk', 'row', 'sort', 'limit', 'of', 'where']
const modes = ['dialog', 'sheet', 'drawer']
/** Every key of `value` is one `known` names, so nothing reaches `screen.json` unnamed. */
const named = (at: string, value: object, known: readonly string[], what: string) => {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) throw new Error(`${at} carries "${key}", which a ${what} does not take. A ${what} takes ${known.join(', ')}.`)
  }
}

// Every `export` line is cut into its identifiers, so no interpolated name reaches
// a regular expression.
const exports = (source: string, name: string) =>
  (source.match(/^\s*export\b.*$/gm) ?? []).some((line) => line.split(/[^\p{ID_Continue}$]+/u).includes(name))

// Read as the one line `export const regions = ['main', 'side'] as const`.
const regionsOf = (source: string) => {
  const list = /^\s*export\s+const\s+regions\s*=\s*\[([^\]]*)\]/m.exec(source)?.[1]
  return list === undefined ? undefined : [...list.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!)
}

/** The folder holding the nearest `package.json` above a file; references print relative to it, so `screen.json` names no absolute path. */
export const packageOf = (file: URL): URL | undefined => {
  for (let folder = new URL('./', file); ; folder = new URL('../', folder)) {
    if (existsSync(new URL('package.json', folder))) return folder
    // `file:///C:/` on Windows has a pathname that is never `/`.
    if (new URL('../', folder).href === folder.href) return undefined
  }
}

/** Every screen of a build, checked and projected in one walk. Each refusal names the screen, kayan, page and node. */
export const screensOf = (
  language: { kinds: Record<string, { targets?: Readonly<Record<string, unknown>> }>; locales?: readonly string[]; targets: Record<string, unknown> },
  resolved: readonly ResolvedKayan[],
): Record<string, ScreenClient> => {
  const locales = language.locales ?? []
  const { maxLimit } = Object.values(language.targets).find((target) => (target as { capability?: unknown } | undefined)?.capability === 'service') as { maxLimit: number }
  const byName = new Map(resolved.map((kayan) => [kayan.name, kayan]))
  const screens: Record<string, ScreenClient> = {}
  const copy = (at: string, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error(`${at} is no copy: write one string per locale.`)
    for (const locale of locales) {
      if (typeof (value as Record<string, unknown>)[locale] !== 'string') throw new Error(`${at} is short of locale "${locale}".`)
    }
    return value as Localized
  }
  const sources = new Map<string, string | undefined>()
  const sourceOf = (file: URL) => {
    if (!sources.has(file.href)) {
      let source: string | undefined
      try {
        source = readFileSync(file, 'utf8')
      } catch {
        source = undefined
      }
      sources.set(file.href, source)
    }
    return sources.get(file.href)
  }
  // Files of the package drawing the root page print bare; any other package's file
  // prints its name first, with a colon, which a package name never holds.
  let home: URL | undefined
  const nameOf = (root: URL) => {
    try {
      const { name } = JSON.parse(sourceOf(new URL('package.json', root)) ?? '{}') as { name?: unknown }
      return typeof name === 'string' && packageName.test(name) ? name : undefined
    } catch {
      return undefined
    }
  }
  const uiOf = (at: string, url: URL): string => {
    const name = decodeURIComponent(url.hash.slice(1))
    const file = new URL(url)
    file.hash = ''
    const root = packageOf(file)
    const shown = root ? `./${decodeURIComponent(file.pathname.slice(root.pathname.length))}` : file.pathname
    if (!word.test(name)) throw new Error(`${at} names ${shown}, and names no export: write ui('file.tsx#Export').`)
    const source = sourceOf(file)
    if (source === undefined) throw new Error(`${at} names ${shown}#${name}, and ${shown} is no file.`)
    if (!exports(source, name)) throw new Error(`${at} names ${shown}#${name}, and ${shown} does not export "${name}".`)
    if (!root) throw new Error(`${at} names ${shown}#${name}, which no package holds: no package.json sits above it.`)
    if (!home || root.href === home.href) return `${shown}#${name}`
    const named = nameOf(root)
    if (!named) throw new Error(`${at} names ${shown}#${name}, whose package, ${decodeURIComponent(new URL('package.json', root).pathname)}, names no npm package name, and a file outside the package drawing the screen's root page is printed by its package's name. Give that package.json one.`)
    return `${named}:${shown}#${name}`
  }
  // A registry name off these lists is shipped by no one, whoever names it.
  const shippedControls: Record<string, readonly string[]> = { ...builtInScreenKinds }
  const shippedCells: string[] = Object.keys(defaultKinds)
  const knownKinds = new Set(Object.keys(defaultKinds))
  for (const [name, one] of Object.entries(language.kinds)) {
    const own = one.targets?.screen as ScreenKind | undefined
    if (typeof own?.control === 'string' && (registryControls as readonly string[]).includes(own.control)) {
      if (!Object.hasOwn(builtInScreenKinds, own.control)) knownKinds.add(name)
      shippedControls[own.control] = [...(shippedControls[own.control] ?? []), name]
    }
    if (typeof own?.cell === 'string' && (registryCells as readonly string[]).includes(own.cell)) shippedCells.push(own.cell)
  }
  for (const [key, target] of Object.entries(language.targets) as [string, ScreenTarget][]) {
    if (target?.capability !== 'screen') continue
    const screen = `Screen "${key}"`
    // Refused by name rather than carried unread.
    named(screen, target, targetKeys, 'screen')
    const rootPage = Object.values(target.pages ?? {}).find((page) => page?.path === '/')?.component
    const rootUrl = rootPage instanceof URL ? rootPage : typeof rootPage === 'string' && Object.hasOwn(target.components ?? {}, rootPage) ? target.components?.[rootPage] : undefined
    home = rootUrl instanceof URL ? packageOf(rootUrl) : undefined
    const maps = { layouts: {} as Record<string, string>, components: {} as Record<string, string> }
    for (const map of ['layouts', 'components'] as const) {
      for (const [name, value] of Object.entries(target[map] ?? {})) {
        if (!(value instanceof URL)) throw new Error(`${screen} ${map} names "${name}" as ${JSON.stringify(value)}, which is no ui() reference. Write ui('file.tsx#Export') from folderOf.`)
        maps[map][name] = uiOf(`${screen} ${map} "${name}"`, value)
      }
    }
    // One function for every place a component is named, so the ways a reference can be wrong are said once.
    const ref = (at: string, place: 'cell' | 'component' | 'control' | 'layout', value: unknown, kind?: string): string => {
      if (value instanceof URL) return uiOf(at, value)
      if (typeof value !== 'string' || !word.test(value)) {
        throw new Error(`${at} names ${JSON.stringify(value)}, which is neither a name nor a ui() reference.`)
      }
      const map = place === 'layout' ? 'layouts' : 'components'
      if (Object.hasOwn(maps[map], value)) return maps[map][value]!
      // A kind no registry control draws names itself, and the project's components map draws it under that name.
      if (place === 'control' && value === kind && !Object.hasOwn(shippedControls, value)) return value
      const shipped: readonly string[] = place === 'control' ? Object.keys(shippedControls) : place === 'cell' ? shippedCells : []
      if (!shipped.includes(value)) {
        throw new Error(`${at} names "${value}", which is no name in this screen's ${map} and no ${place} the registry ships.`)
      }
      const draws: readonly string[] = place === 'control' ? shippedControls[value]! : []
      if (place === 'control' && kind && knownKinds.has(kind) && !draws.includes(kind)) {
        throw new Error(`${at} names built-in control "${value}", which draws ${draws.join(', ')} and not ${kind}.`)
      }
      return value
    }
    const controls: ScreenClient['controls'] = {}
    for (const kind of Object.keys(target.controls)) {
      if (!Object.hasOwn(language.kinds, kind)) throw new Error(`${screen} controls names kind "${kind}", which is not a kind of this language.`)
    }
    for (const kind of Object.keys(language.kinds)) {
      // The project's own row, then the kind's own, then the shipped table.
      const row = implementationOf<ScreenKind>({ table: target.controls, shipped: screenKinds, name: kind, own: language.kinds[kind]!.targets, type: 'screen' })
      if (!row) throw new Error(`${screen} controls has no row for kind "${kind}", and every kind of the language needs one.`)
      controls[kind] = {
        control: ref(`${screen} controls "${kind}" control`, 'control', row.control, kind),
        cell: ref(`${screen} controls "${kind}" cell`, 'cell', row.cell),
      }
    }
    for (const name of target.kayan) {
      if (!byName.has(name)) throw new Error(`${screen} kayan lists "${name}", which is no kayan of this build.`)
    }
    for (const kayan of resolved) {
      if (kayan.targets?.[key] !== undefined && !target.kayan.includes(kayan.name)) {
        throw new Error(`Kayan "${kayan.name}" writes targets.${key}, and ${screen.toLowerCase()} does not list it in kayan.`)
      }
    }
    const fieldOf = (where: string, name: string, field: RuntimeField & Pick<ResolvedField, 'sortable'>): ClientField => {
      const data = clientFieldOf(name, field)
      const own = (field.targets?.[key] ?? {}) as ScreenField
      const component = own.component ? ref(`${where} targets.${key}.component`, 'control', own.component, field.kind) : controls[field.kind]!.control
      needsOptions(where, component, field)
      return {
        ...data,
        ...(Array.isArray(field.options) && { options: field.options as ClientField['options'] }),
        ...(typeof field.placeholder === 'object' && { placeholder: field.placeholder }),
        ...(typeof field.prefix === 'object' && { prefix: field.prefix }),
        ...(typeof field.suffix === 'object' && { suffix: field.suffix }),
        ...(typeof field.description === 'object' && { description: field.description }),
        component,
        cell: own.cell ? ref(`${where} targets.${key}.cell`, 'cell', own.cell) : controls[field.kind]!.cell,
        ...(typeof own.width === 'string' && { width: own.width }),
        ...(own.filter === true && { filter: true as const }),
        ...(own.searchable === true && { searchable: true as const }),
        // So no list offers a sort the server refuses.
        ...((own.sortable === false || field.sortable === false) && { sortable: false as const }),
      }
    }
    const needsOptions = (where: string, component: string, field: RuntimeField) => {
      if (choiceControls.includes(component) && !field.options?.length) throw new Error(`${where} is drawn by "${component}", which needs options.`)
    }
    // So no two paths match one URL.
    const paths = new Map<string, string>()
    const route = (at: string, path: unknown, owner: string) => {
      if (typeof path !== 'string') throw new Error(`${at} has no path, and every page names one.`)
      const shape = path.replace(/:[^/]+/g, ':')
      const taken = paths.get(shape)
      if (taken) throw new Error(`${at} path "${path}" is the path ${taken} already takes on this screen.`)
      paths.set(shape, owner)
      return path
    }
    const pages: Record<string, ScreenPageClient> = {}
    for (const [name, declared] of Object.entries(target.pages ?? {})) {
      const at = `${screen} page "${name}"`
      named(at, declared, ['path', 'component', 'nav', 'permission'], 'screen page')
      const path = route(at, declared.path, `of page "${name}"`)
      if (declared.nav !== undefined) named(`${at} nav`, declared.nav, ['label'], 'nav')
      if (declared.permission !== undefined && typeof declared.permission !== 'string') throw new Error(`${at} permission is no catalog key.`)
      pages[name] = {
        path,
        component: ref(`${at} component`, 'component', declared.component),
        ...(declared.nav !== undefined && { nav: { label: copy(`${at} nav label`, declared.nav.label) } }),
        ...(declared.permission !== undefined && { permission: declared.permission }),
      }
    }
    if (!Object.values(pages).some((one) => one.path === '/')) throw new Error(`${screen} has no page at /, and a screen draws one at its own path.`)
    const client: ScreenClient = {
      path: target.path,
      providers: target.providers.map((one, at) => ref(`${screen} providers[${at}]`, 'component', one)),
      pages,
      nav: [],
      layouts: maps.layouts,
      components: maps.components,
      controls,
      kayan: {},
      maxLimit,
    }
    const scopeOf = (name: string) => {
      const kayan = byName.get(name)!
      const where = `${screen} kayan "${name}"`
      const fields = Object.fromEntries(Object.values(kayan.fields).map((field) => [field.name, fieldOf(`${where} field "${field.name}"`, field.name, field)]))
      const fieldNamed = (at: string, field: unknown) => {
        if (typeof field !== 'string' || !Object.hasOwn(fields, field)) throw new Error(`${at} names "${String(field)}", which is not a field of this kayan.`)
        return fields[field]!
      }
      const searchedPath = (at: string, path: unknown): string => {
        if (typeof path !== 'string' || !path.includes('.')) return fieldNamed(at, path).name
        const [own = '', far = '', ...rest] = path.split('.')
        const near = Object.hasOwn(kayan.fields, own) ? kayan.fields[own] : undefined
        const target = near?.kind === 'relationship' && !near.hasMany ? near.target : undefined
        const field = target && Object.hasOwn(target.fields, far) ? target.fields[far] : undefined
        if (rest.length || !field || !['text', 'email'].includes(field.kind) || field.rules?.localized) {
          throw new Error(`${at} names "${path}", and a search path crosses one relationship of this kayan to a text or email field of the kayan it points at.`)
        }
        return path
      }
      // A related row's field is refused: the browser holds its id, not the row.
      // A `stored` `where` runs over stored rows, so it names no `record.` or `$user.`.
      const whenOf = (said: string, when: unknown, stored = false): Where => {
        if (!when || typeof when !== 'object' || Array.isArray(when) || !Object.keys(when).length) throw new Error(`${said} is no Where: write { field: { operator: value } }.`)
        for (const [key, value] of Object.entries(when)) {
          if (key === 'and' || key === 'or') {
            if (!Array.isArray(value) || !value.length) throw new Error(`${said} "${key}" constraint must be a non-empty array.`)
            for (const one of value) whenOf(said, one, stored)
            continue
          }
          const [head, ...rest] = key.split('.')
          if (stored && (head === '$user' || head === 'record')) throw new Error(`${said} names "${key}", and a filter of stored rows names this kayan's own fields alone.`)
          let kind: string | undefined
          let operators: ResolvedField['operators']
          if (head === '$user') {
            const [collections, name, ...path] = rest
            // The host hands a page the report cut to the kayan its screen draws.
            const other = collections === 'collections' && target.kayan.includes(name!) ? byName.get(name!) : undefined
            const ok = other && (
              (path.length === 1 && ['create', 'read', 'update', 'delete'].includes(path[0]!))
              || (path.length === 2 && path[0] === 'operations' && Object.hasOwn(other.operations, path[1]!))
              || (path.length === 3 && path[0] === 'fields' && Object.hasOwn(other.fields, path[1]!) && ['create', 'read', 'update'].includes(path[2]!)))
            if (!ok) {
              throw new Error(`${said} names "${key}", and $user is the access report, which carries $user.collections.<kayan>.<create|read|update|delete>, .operations.<operation> and .fields.<field>.<create|read|update> of a kayan this screen draws.`)
            }
            kind = 'checkbox'
          } else {
            const [name, locale, ...more] = head === 'record' ? rest : [head!, ...rest]
            const field = name !== undefined && Object.hasOwn(kayan.fields, name) ? kayan.fields[name] : undefined
            if (!field || more.length || (locale !== undefined && !field.locales?.includes(locale))) throw new Error(`${said} names "${key}", which is no field of this kayan.`)
            kind = field.kind
            operators = field.operators
          }
          assertFieldWhere({ said, key, kind, operators, value })
        }
        return when as Where
      }
      return { kayan, fields, fieldNamed, searchedPath, whenOf }
    }
    const treeOf = ({ kayan, fieldNamed, searchedPath, whenOf }: ReturnType<typeof scopeOf>, page: string, drawsRow: boolean, held: { form: number; list: number }) => {
      let inForm = 0
      const leafOf = (node: string, leaf: ScreenLeaf, place: 'cell' | 'control') => {
        const name = typeof leaf === 'string' ? leaf : leaf.field
        const field = fieldNamed(node, name)
        // A join's rows are drawn as a list of that kayan scoped to this row, never as nested forms.
        if (place === 'control' && field.kind === 'join') {
          throw new Error(`${node} "${name}" names a join, and a page draws a join's rows as a list: write { list: { of: '${field.relationTo}', where: '${field.on}', columns: [...] } }.`)
        }
        const drawn = place === 'control' ? 'component' : 'cell'
        const decided =
          typeof leaf !== 'string' && leaf[drawn] ? ('leaf' as const)
          : ((kayan.fields[name]!.targets?.[key] ?? {}) as ScreenField)[drawn] ? ('field' as const)
          : ('table' as const)
        if (typeof leaf === 'string') return place === 'control' ? { field: name, component: field.component, decided } : { field: name, cell: field.cell, decided }
        named(`${node} "${name}"`, leaf, leafKeys, 'leaf')
        // A column is no node of the tree, so nothing would ever read its `when`.
        if (place === 'cell' && leaf.when !== undefined) throw new Error(`${node} "${name}" carries a when, and a list column is drawn on every row: put the when on a node.`)
        const { component, cell, placeholder, description, readOnly, width } = leaf
        const control = component ? ref(`${node} "${name}" component`, 'control', component, field.kind) : field.component
        if (place === 'control') needsOptions(`${node} "${name}"`, control, kayan.fields[name]!)
        return {
          field: name,
          ...(typeof readOnly === 'boolean' && { readOnly }),
          ...(typeof width === 'string' && { width }),
          ...(place === 'control' && { component: control }),
          ...((place === 'cell' || cell) && { cell: cell ? ref(`${node} "${name}" cell`, 'cell', cell) : field.cell }),
          ...(placeholder !== undefined && { placeholder: copy(`${node} "${name}" placeholder`, placeholder) }),
          ...(description !== undefined && { description: copy(`${node} "${name}" description`, description) }),
          decided,
        }
      }
      const groupOf = (node: string, name: string, group: ScreenGroup<string, string | Ui, string>) => ({
        label: copy(`${node} "${name}" label`, group.label),
        ...(group.description !== undefined && { description: copy(`${node} "${name}" description`, group.description) }),
        fields: group.fields.map((one) => nodeOf(`${node} "${name}"`, one)),
      })
      // Each region it fills must be one its file exports in `regions`.
      const frameOf = (node: string, frame: 'layout' | 'shell', declared: Record<string, unknown>) => {
        const reference = declared[frame]
        const printed = ref(`${node} ${frame}`, 'layout', reference)
        const url = reference instanceof URL ? reference : (target.layouts[reference as string] as URL)
        const file = new URL(url)
        file.hash = ''
        const exported = regionsOf(sourceOf(file) ?? '') ?? []
        const regions: RegionsClient = {}
        for (const [region, nodes] of Object.entries(declared)) {
          if (region === frame || (frame === 'layout' && region === 'when')) continue
          if (!exported.includes(region)) {
            throw new Error(`${node} fills region "${region}", which ${printed} does not export in its regions: ${exported.join(', ') || 'none'}.`)
          }
          if (!Array.isArray(nodes)) throw new Error(`${node} region "${region}" is no list of nodes.`)
          regions[region] = nodes.map((one: ScreenNode) => nodeOf(`${node} region "${region}"`, one))
        }
        return { [frame]: printed, ...regions }
      }
      // One entry per kind, so a kind with no entry is a type error.
      const drawnBy = (node: string, value: { component?: unknown }) =>
        value.component !== undefined && { component: ref(`${node} component`, 'component', value.component) }
      const kinds: { [Kind in NodeKind]: (node: string, one: Declared<Kind>) => NodeClient } = {
        layout: (node, one) => frameOf(`${node} layout`, 'layout', one) as NodeClient,
        field: (node, one) => leafOf(`${node} leaf`, one, 'control'),
        form: (node, one) => {
          named(`${node} form`, one, ['form', 'component', 'when'], 'form node')
          held.form++
          inForm++
          try {
            return { form: one.form.map((each) => nodeOf(`${node} form`, each)), ...drawnBy(node, one) }
          } finally {
            inForm--
          }
        },
        list: (node, one) => {
          named(`${node} list`, one, ['list', 'component', 'when'], 'list node')
          named(`${node} list`, one.list, listKeys, 'list')
          const { of, where, ...list } = one.list as ScreenList & { of?: unknown; where?: unknown }
          if (of !== undefined || where !== undefined) {
            if (of === undefined) throw new Error(`${node} list names where and no of, and where scopes a list of another kayan to this row.`)
            if (typeof of !== 'string' || !target.kayan.includes(of)) throw new Error(`${node} list of names "${String(of)}", which is no kayan of this screen.`)
            if (where === undefined) throw new Error(`${node} list names of and no where, and a list of another kayan names the relationship that scopes it to this row.`)
            const other = byName.get(of)!
            const back = typeof where === 'string' && Object.hasOwn(other.fields, where) ? other.fields[where] : undefined
            if (!back || back.kind !== 'relationship' || back.hasMany || back.target?.name !== kayan.name) {
              throw new Error(`${node} list where names "${String(where)}", which is no relationship of kayan "${of}" holding one row of kayan "${kayan.name}".`)
            }
            if (!drawsRow) throw new Error(`${node} list lists kayan "${of}" by the row this page draws, and page "${page}" draws no row.`)
            // A form inside the page's one `<form>` is no HTML.
            if (inForm) throw new Error(`${node} list lists kayan "${of}" inside a form node, and its rows save apart from this page's form: put it beside the form node.`)
            const drawn = treeOf(scopeOf(of), page, drawsRow, { form: 0, list: 0 }).nodeOf(node, { list, ...(one.component !== undefined && { component: one.component }) } as ScreenNode) as { list: ListClient; component?: string }
            return { ...drawn, list: { of, where: where as string, ...drawn.list } }
          }
          held.list++
          const { columns, filters, search, empty, menu, sort, limit } = one.list
          // Where a button sits decides which operations it may run: bulk over ticked rows,
          // row over its row, toolbar over none.
          const buttons = (region: 'toolbar' | 'bulk' | 'row') => {
            const declared = one.list[region]
            if (declared === undefined) return undefined
            if (!Array.isArray(declared)) throw new Error(`${node} list ${region} is no list of buttons.`)
            return declared.map((button) => {
              const at = `${node} list ${region}`
              if (kindOf(button) !== 'button') throw new Error(`${at} holds ${JSON.stringify(Object.keys(button))}, which is no button.`)
              const drawn = nodeOf(at, button) as ButtonClient
              const said = `${at} button "${drawn.button}"`
              const seal = kayan.operations[drawn.button]!.steps.map(sealOf).find((one) => one && [...bulkSeals, ...readSeals, ...storeSeals].includes(one))
              const writes = seal && bulkSeals.includes(seal) ? 'many' : seal === 'update' || seal === 'remove' ? 'one' : seal === 'insert' ? 'new' : 'none'
              const what = { many: 'writes many rows', one: 'writes one row', new: 'makes a new row', none: 'writes no row' }[writes]
              const wants = { bulk: ['many', 'a bulk button runs an updateMany or a deleteMany over the ticked rows'], row: ['one', 'a row button runs an update or a remove over its own row'], toolbar: ['', 'a toolbar button runs over no row'] }[region]
              if (region === 'toolbar' ? writes === 'many' || writes === 'one' : writes !== wants[0]) throw new Error(`${said} names an operation that ${what}, and ${wants[1]}.`)
              if (region === 'bulk') for (const field of drawn.fields ?? []) fieldNamed(`${said} fields`, field)
              return drawn
            })
          }
          const [toolbar, bulk, row] = [buttons('toolbar'), buttons('bulk'), buttons('row')]
          if (sort !== undefined) {
            const field = fieldNamed(`${node} list sort`, typeof sort === 'string' ? sort.replace(/^-/, '') : sort)
            if (unsortable(kayan.fields[field.name]!)) throw new Error(`${node} list sort names "${field.name}", which cannot order a page.`)
          }
          // The list's first page is a served read, so it is held to the project's maximum.
          if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= maxLimit)) {
            throw new Error(`${node} list limit is ${JSON.stringify(limit)}, and a limit is a whole number from 1 to ${maxLimit}.`)
          }
          return {
            list: {
              columns: columns.map((column) => leafOf(`${node} list column`, column, 'cell')),
              ...(filters && { filters: filters.map((field) => fieldNamed(`${node} list filter`, field).name) }),
              ...(search && { search: search.map((field) => searchedPath(`${node} list search`, field)) }),
              ...(empty !== undefined && { empty: ref(`${node} list empty`, 'component', empty) }),
              ...(menu !== undefined && { menu: ref(`${node} list menu`, 'component', menu) }),
              ...(toolbar && { toolbar }),
              ...(bulk && { bulk }),
              ...(row && { row }),
              ...(sort !== undefined && { sort }),
              ...(limit !== undefined && { limit }),
            },
            ...drawnBy(node, one),
          }
        },
        button: (node, one) => {
          const at = `${node} button "${one.button}"`
          named(at, one, buttonKeys, 'button')
          if (!Object.hasOwn(kayan.operations, one.button)) throw new Error(`${at} names operation "${one.button}", which this kayan does not declare.`)
          if (one.fields !== undefined && !(Array.isArray(one.fields) && one.fields.every((field) => typeof field === 'string'))) {
            throw new Error(`${at} fields is no list of names.`)
          }
          // A field name the operation never declared would ask for nothing and send the call short of it.
          const writesMany = kayan.operations[one.button]!.steps.some((step) => bulkSeals.includes(sealOf(step)!))
          const asks = ((kayan.operations[one.button]!.targets as Record<string, { fields?: Record<string, unknown> }> | undefined)?.[key])?.fields ?? {}
          for (const field of writesMany ? [] : (one.fields ?? [])) {
            if (!Object.hasOwn(asks, field)) throw new Error(`${at} fields names "${field}", which operation "${one.button}" does not ask for on screen "${key}".`)
          }
          // An operation that asks for fields is drawn by a button that names them, or by a component that sends its own input.
          if (!writesMany && !one.fields?.length && one.component === undefined && Object.keys(asks).length) {
            throw new Error(`${at} names no fields, and operation "${one.button}" asks for ${Object.keys(asks).map((name) => `"${name}"`).join(', ')} on screen "${key}": name the fields its dialog asks for, or a component that sends them.`)
          }
          if (one.confirm !== undefined) named(`${at} confirm`, one.confirm, ['title', 'body'], 'confirm')
          return {
            button: one.button,
            label: copy(`${at} label`, one.label),
            ...(one.fields !== undefined && { fields: [...one.fields] }),
            ...(typeof one.reload === 'boolean' && { reload: one.reload }),
            ...drawnBy(node, one),
            ...(one.confirm !== undefined && { confirm: { title: copy(`${at} confirm title`, one.confirm.title), body: copy(`${at} confirm body`, one.confirm.body) } }),
          }
        },
        title: (node, one) => {
          named(`${node} title`, one, ['title', 'when'], 'title node')
          return { title: {} }
        },
        nav: (node, one) => {
          named(`${node} nav`, one, ['nav', 'when'], 'nav node')
          return { nav: {} }
        },
        controls: (node, one) => {
          named(`${node} controls`, one, ['controls', 'when'], 'controls node')
          return { controls: {} }
        },
        component: (node, one) => {
          named(`${node} component`, one, ['component', 'when'], 'component node')
          return { component: ref(`${node} component`, 'component', one.component) }
        },
        row: (node, one) => ({ row: one.row.map((each) => nodeOf(`${node} row`, each)), ...(one.resizable === true && { resizable: true as const }) }),
        separator: () => ({ separator: true as const }),
        tabs: (node, one) => ({ tabs: one.tabs.map((tab) => ({ tab: tab.tab, ...groupOf(`${node} tab`, tab.tab, tab) })) }),
        accordion: (node, one) => ({ accordion: one.accordion.map((item) => ({ item: item.item, ...groupOf(`${node} item`, item.item, item) })) }),
        section: (node, one) => ({
          section: one.section,
          ...(typeof one.collapsed === 'boolean' && { collapsed: one.collapsed }),
          ...(typeof one.width === 'number' && { width: one.width }),
          ...(typeof one.scroll === 'string' && { scroll: one.scroll }),
          ...groupOf(`${node} section`, one.section, one),
        }),
      }
      const nodeOf = (node: string, one: ScreenNode): NodeClient => {
        const kind = kindOf(one)
        if (!kind) throw new Error(`${node} holds ${JSON.stringify(one && typeof one === 'object' ? Object.keys(one) : one)}, which is no node a page takes.`)
        const drawn = (kinds[kind] as (node: string, one: ScreenNode) => NodeClient)(node, one)
        const when = typeof one === 'object' ? one.when : undefined
        const at = `${node} ${kind === 'field' ? `leaf "${(one as { field: string }).field}"` : kind === 'button' ? `button "${(one as { button: string }).button}"` : kind}`
        return when === undefined ? drawn : { ...drawn, when: whenOf(`${at} when`, when) }
      }
      return { frameOf, nodeOf }
    }
    for (const name of target.kayan) {
      const scope = scopeOf(name)
      const { kayan, fields, fieldNamed } = scope
      const block = (kayan.targets?.[key] ?? {}) as ScreenKayan
      const where = `${screen} kayan "${name}"`
      if (block.useAsTitle !== undefined) fieldNamed(`${where} useAsTitle`, block.useAsTitle)
      const baseFilter = block.baseFilter === undefined ? undefined : scope.whenOf(`${where} baseFilter`, block.baseFilter, true)
      const kayanPages: Record<string, PageClient> = {}
      for (const [page, declared] of Object.entries(block.pages ?? {})) {
        const at = `${where} page "${page}"`
        const whole = 'component' in declared
        if (whole && 'page' in declared) {
          throw new Error(`${at} carries both page and component, and a page is either one tree or drawn whole by one component.`)
        }
        named(at, declared, whole ? ['path', 'component'] : ['path', 'page', 'mode'], whole ? 'page drawn whole' : 'page')
        const path = route(at, declared.path, `of kayan "${name}" page "${page}"`)
        const id = /(^|\/):id(\/|$)/.test(path)
        if (page === 'edit' && !id) throw new Error(`${at} path "${path}" carries no :id, and an edit page draws one row.`)
        if (page === 'list' && id) throw new Error(`${at} path "${path}" carries :id, and a list page draws every row.`)
        if (whole) {
          kayanPages[page] = { path, component: ref(`${at} component`, 'component', declared.component) }
          continue
        }
        if (declared.mode !== undefined) {
          if (!modes.includes(declared.mode)) throw new Error(`${at} opens as "${declared.mode}", and a page opens as dialog, sheet or drawer.`)
          if (page !== 'create' && page !== 'edit') throw new Error(`${at} opens as "${declared.mode}", and only create and edit open over the list.`)
        }
        if (!declared.page || typeof declared.page !== 'object' || !('shell' in declared.page)) {
          throw new Error(`${at} has no page with a shell at its root, and a page is one tree rooted at a shell or a component drawing it whole.`)
        }
        const held = { form: 0, list: 0 }
        const { frameOf } = treeOf(scope, page, id || kayan.single === true, held)
        const tree = frameOf(at, 'shell', declared.page as Record<string, unknown>) as FrameClient
        const needs = page === 'list' ? 'list' : page === 'create' || page === 'edit' ? 'form' : undefined
        if (needs && (held[needs] !== 1 || held[needs === 'list' ? 'form' : 'list'] !== 0)) {
          throw new Error(`${at} is a reserved page, and it holds exactly ${needs === 'list' ? 'one list node and no form' : 'one form node and no list'}.`)
        }
        kayanPages[page] = { path, page: tree, ...(declared.mode !== undefined && { mode: declared.mode }) }
      }
      client.kayan[name] = {
        name,
        single: kayan.single === true,
        fields: Object.values(fields),
        operations: Object.entries(kayan.operations).map(([operation, declared]) => {
          const input = ((declared.targets as Record<string, { fields?: Record<string, RuntimeField> }> | undefined)?.[key])?.fields
          return {
            name: operation,
            effect: declared.effect,
            ...(input && { fields: Object.entries(input).map(([field, one]) => fieldOf(`${where} operation "${operation}" field "${field}"`, field, one)) }),
            // A box left empty leaves each row's value as it is.
            ...(declared.steps.some((step) => sealOf(step) === 'updateMany') && { updatesMany: true }),
          }
        }),
        ...(block.useAsTitle !== undefined && { useAsTitle: block.useAsTitle }),
        ...(block.description !== undefined && { description: copy(`${where} description`, block.description) }),
        ...(baseFilter && { baseFilter }),
        ...(kayan.versions?.drafts && { drafts: kayan.versions.autosave ? { autosave: { interval: kayan.versions.autosave.interval } } : {} }),
        ...(kayan.storage && { storage: { mimeTypes: kayan.storage.mimeTypes, fileSize: kayan.storage.fileSize } }),
        pages: kayanPages,
      }
      const listed = kayanPages.list ? (['list', kayanPages.list] as const) : kayan.single === true ? Object.entries(kayanPages)[0] : undefined
      if (listed) client.nav.push({ path: listed[1].path, page: listed[0], kayan: name, permission: `${name}.${kayan.single === true ? 'findOne' : 'find'}` })
    }
    for (const [name, one] of Object.entries(pages)) {
      if (one.nav) client.nav.push({ path: one.path, page: name, label: one.nav.label, ...(one.permission !== undefined && { permission: one.permission }) })
    }
    // Data a browser receives, so only what survives the clone.
    screens[key] = structuredClone(client)
  }
  return screens
}

declare module '../mithaq/rukn.ts' {
  interface KayanConfigs<L, F, T> {
    screen: ScreenKayan<LocalesOf<L>, RefOf<T, L extends { kinds: infer Kinds } ? Kinds : {}>, keyof F & string>
  }
}
