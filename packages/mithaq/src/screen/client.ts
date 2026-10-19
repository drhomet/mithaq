// Every runtime import of this entry imports nothing but types, so a browser
// receives no server code and no framework.

export { flattenMessageFile } from '../mithaq/message-file.ts'
export { afterCommitHeader } from '../asas/runner/errors.ts'
export { allowedType } from '../storage/allowed-type.ts'
export { compareDecimals, decimalDigits, isDecimal } from '../base/decimal.ts'
export { isJson } from '../base/kinds.ts'
// What a screen hands a browser, `screen.json`'s own shape.
export type {
  ButtonClient,
  ClientField,
  ClientKayan,
  FrameClient,
  LeafClient,
  NavEntry,
  NodeClient,
  PageClient,
  RegionsClient,
  ScreenClient,
  ScreenPageClient,
  ScreenNav,
} from './index.ts'
import type { ClientField, NavEntry, PageClient, ScreenClient } from './index.ts'

export { compareValues, matchesWhere, same } from '../mithaq/where.ts'

// What each place a screen names a component receives. No framework: `Node` is
// what a framework renders, `ReactNode` for the shipped registry.

/** How copy is resolved: a key, and what to show when nothing answers it. */
export type Translate = (key: string, fallback?: string) => string | undefined
/** What `GET /api/access` answers for the actor. */
export type AccessReport = {
  /** The screens this actor may enter, by name, and no other. */
  readonly screens?: readonly string[]
  /** Every catalog key the actor holds, `'*'` for all, absent where no access target grades. */
  readonly permissions?: '*' | readonly string[]
  readonly collections?: Readonly<
    Record<
      string,
      | {
          readonly read?: boolean
          readonly create?: boolean
          readonly update?: boolean
          readonly delete?: boolean
          readonly operations?: Readonly<Record<string, boolean>>
          readonly fields?: Readonly<Record<string, { readonly create?: boolean; readonly read?: boolean; readonly update?: boolean }>>
        }
      | undefined
    >
  >
}
/**
 * A router no type was given: every kayan and every operation a name held in a
 * string, which is what registry code that learns its kayan at runtime holds.
 */
export type AnyRouter = Readonly<Record<string, Readonly<Record<string, unknown>>>>
// Read structurally, because this entry imports nothing of oRPC.
type SchemaOf<Procedure, Side extends 'inputSchema' | 'outputSchema', Otherwise> = Procedure extends {
  readonly '~orpc': Readonly<Partial<Record<Side, infer Schema>>>
}
  ? Schema extends { readonly '~standard': { readonly types?: infer Types } }
    ? Types extends Record<Side extends 'inputSchema' ? 'input' : 'output', infer Value>
      ? Value
      : Otherwise
    : Otherwise
  : Otherwise
/**
 * Posts one operation of one kayan to `POST /api/<kayan>/<operation>`, typed by the built router:
 * `FetchClient<typeof asas.router>`. A `Date` in the answer arrives as its ISO string.
 */
export type FetchClient<R = AnyRouter> = <K extends keyof R & string, O extends keyof R[K] & string>(call: {
  kayan: K
  operation: O
  input: SchemaOf<R[K][O], 'inputSchema', Record<string, unknown>>
  draft?: boolean
  autosave?: boolean
}) => Promise<SchemaOf<R[K][O], 'outputSchema', unknown>>
/** One stored row, as a read answers it. */
export type Row = Record<string, unknown>

/** Whether the access report lets its actor hold one catalog key: a screen's, an operation's, or any other key. */
export const holds = (report: AccessReport, key: string) => {
  const dot = key.indexOf('.')
  const [resource, action] = [key.slice(0, dot), key.slice(dot + 1)]
  if (resource === 'screen') return report.screens?.includes(action) === true
  const operations = report.collections?.[resource]?.operations
  if (operations && Object.hasOwn(operations, action)) return operations[action] === true
  return report.permissions === '*' || report.permissions?.includes(key) === true
}

// `mithaq generate screens` looks a reference's package up as `node_modules/<name>/`,
// so no path up, absolute path or space may cross.
const npmName = '(?:@[a-z0-9~-][a-z0-9._~-]*/)?[a-z0-9~-][a-z0-9._~-]*'
export const packageName = new RegExp(`^${npmName}$`, 'i')
const reference = new RegExp(`^(?:${npmName}:)?\\./[^#]+#[\\p{ID_Start}$_][\\p{ID_Continue}$]*$`, 'iu')

/** Every `ui()` reference a projection prints, `./src/file.tsx#Export` or `<package>:./src/file.tsx#Export`. */
export const referencesIn = (value: unknown): string[] =>
  typeof value === 'string'
    ? reference.test(value) ? [value] : []
    : value && typeof value === 'object' ? Object.values(value).flatMap(referencesIn) : []

/** The screen's nav as one actor sees it: every entry whose key the actor holds, and every entry that names none. */
export const navOf = (screen: Pick<ScreenClient, 'nav'>, report: AccessReport): NavEntry[] =>
  [...Map.groupBy(
    screen.nav.filter((entry) => entry.permission === undefined || holds(report, entry.permission)),
    (entry) => entry.group?.name ?? '',
  ).values()]
    .sort((a, b) => Number(a[0]!.group?.position === 'bottom') - Number(b[0]!.group?.position === 'bottom') || (a[0]!.group?.order ?? 0) - (b[0]!.group?.order ?? 0))
    .flatMap((entries) => entries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))

export type ProviderProps<Node = unknown> = { children: Node }
/** A shell, at the root of a page's tree: its regions drawn. The nav is `mithaq/admin/react` `useNav()`. */
export type ShellProps<Regions extends readonly string[] = readonly string[], Node = unknown> = { regions: Record<Regions[number], Node> }
/** A page of the screen's own, drawn whole: what its file's `loader` answered, if it exports one. */
export type PageProps<Data = unknown> = { loaderData?: Data }
/**
 * What a page's `loader` reads with, as the actor of the request: `client`, `request` and the
 * access report. It reads the same rows on the server and in the browser.
 */
export type LoaderTools = {
  client: FetchClient
  request: (path: string, init?: RequestInit) => Promise<Response>
  access: AccessReport
  maxLimit: number
}
/** A layout nested in a region: its regions drawn, and the page it frames. */
export type LayoutProps<Regions extends readonly string[] = readonly string[], Node = unknown> = {
  regions: Record<Regions[number], Node>
  page: PageClient
}
/** A component node, and a kayan page drawn whole: the page it sits on. */
export type ComponentProps = { page: PageClient }
/** A field's control: the field, its value and the one way to change it. */
export type ControlProps = {
  /** The input id its visible label names, and the ids of its description and refusal. */
  id?: string
  describedBy?: string
  form?: string
  field: ClientField
  value: unknown
  onChange: (value: unknown) => void
  readOnly: boolean
  issue: string | null
}
/** A list's cell: the field, its value, and the row it sits in. */
export type CellProps = { field: ClientField; value: unknown; row: Row }
/** What an empty list draws: the page the list sits on. */
export type EmptyProps = { page: PageClient }
/** What a list's `menu` draws inside one row's menu: the row, and `open`, which draws a node beside the list until `null`. */
export type MenuProps<Node = unknown> = { row: Row; open: (node: Node | null) => void }
/** A button that names a component: its operation, the run that asks the confirm first, and whether the form is busy. */
export type ButtonProps = {
  operation: string
  run: (input: Row) => Promise<void>
  busy: boolean
}

export { regionsIn, studioText, studioTree, type StudioNode } from './studio.ts'
export { kindOf, nodeKinds, type NodeKind, type NodeOf } from './studio.ts'

/** The controls the copied registry supplies, each with the kinds whose value it reports. */
export const builtInScreenKinds = {
  text: ['text', 'email', 'date', 'datetime', 'decimal'],
  email: ['email'],
  number: ['number', 'integer'],
  integer: ['integer'],
  decimal: ['decimal'],
  checkbox: ['checkbox'],
  datetime: ['datetime'],
  date: ['date'],
  textArray: ['textArray'],
  uuid: ['uuid'],
  json: ['json'],
  // A file is a row of a storage kayan, so the picker of rows draws it too.
  relationship: ['relationship', 'upload'],
  join: ['join'],
  switch: ['checkbox'],
  radio: ['text'],
  toggleGroup: ['text'],
  select: ['text'],
  nativeSelect: ['text'],
  slider: ['number'],
  otp: ['text'],
  combobox: ['text'],
  textarea: ['text'],
  toggle: ['checkbox'],
  buttonGroup: ['text'],
  checkboxGroup: ['textArray'],
  calendar: ['date'],
} as const satisfies Record<string, readonly string[]>

/** Every control and cell the copied registry ships, by the name it looks each up by. */
export const registryControls = [
  ...(Object.keys(builtInScreenKinds).filter((name) => name !== 'join') as Exclude<keyof typeof builtInScreenKinds, 'join'>[]),
  'richText',
  'upload',
] as const
export const registryCells = ['text', 'email', 'number', 'integer', 'decimal', 'checkbox', 'datetime', 'date', 'textArray', 'uuid', 'json', 'relationship', 'join', 'richText', 'upload'] as const

/** The built-in controls that draw a field's `options`; the build refuses one over a field that declares none. */
export const choiceControls = ['radio', 'toggleGroup', 'select', 'nativeSelect', 'combobox', 'buttonGroup', 'checkboxGroup']
