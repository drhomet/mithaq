import { Fragment, use, useMemo, useRef, useState, type ComponentType, type Key, type ReactElement, type ReactNode, type RefObject } from 'react'
import { ChevronDown, XIcon } from 'lucide-react'
import { kindOf, matchesWhere, regionsIn } from 'mithaq/admin'
import { ScreenContext, useLocale, useScreen } from 'mithaq/admin/react'
import type {
  ButtonClient,
  ButtonProps,
  CellProps as ScreenCellProps,
  ClientField,
  ClientKayan,
  ComponentProps,
  ControlProps as ScreenControlProps,
  EmptyProps,
  MenuProps,
  FrameClient,
  LayoutProps,
  LeafClient,
  NodeClient,
  NodeKind,
  NodeOf,
  PageClient,
  PageProps,
  ProviderProps,
  Row,
  RegionsClient,
  ShellProps,
  Translate,
} from 'mithaq/admin'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  besideLabel,
  controlFor,
  controls,
  descriptionFor,
  labelFor,
  newTitleOf,
  placeholderFor,
  titleOf,
  type ControlProps,
  type Copy,
  type FindApi,
  type FoundPage,
} from './controls.tsx'
import { FieldShell, describedBy } from './field-shell.tsx'
import { idsOf, nameOfRow } from './relationship-control.tsx'
import { titleKey, useRelationshipTitles } from './relationship-cell.tsx'

/**
 * What each place a screen names a component hands it, from `mithaq/admin`, with a React node where
 * the props carry one. Everything else a component reads through the hooks `mithaq/admin/react`
 * exports.
 */
export type Places = {
  provider: ComponentType<ProviderProps<ReactNode>>
  shell: ComponentType<ShellProps<readonly string[], ReactNode>>
  page: ComponentType<PageProps>
  layout: ComponentType<LayoutProps<readonly string[], ReactNode>>
  component: ComponentType<ComponentProps>
  control: ComponentType<ScreenControlProps>
  cell: ComponentType<ScreenCellProps>
  empty: ComponentType<EmptyProps>
  menu: ComponentType<MenuProps<ReactNode>>
  button: ComponentType<ButtonProps>
}

/** The components a screen names by path, keyed by the path `screen.json` prints. */
export type Refs = Readonly<Record<string, ComponentType<never>>>

/** A kayan's page declared as one tree, rather than drawn whole by one component. */
export type TreePage = Extract<PageClient, { page: FrameClient }>

/** What a form or a list draws a screen's page with, beside the adapted kayan. */
export type ScreenPage = {
  refs: Refs
  /** The screen's own kayan, which is what a component named by path is handed. */
  kayan: ClientKayan
  page: TreePage
}

/** A component the page names by path, typed for the place it sits in. */
export const refOf = <Place extends keyof Places>({
  screen,
  place: _place,
  path,
}: {
  screen: Pick<ScreenPage, 'refs'> | undefined
  place: Place
  path: string | undefined
}) =>
  (screen && path && Object.hasOwn(screen.refs, path) ? screen.refs[path] : undefined) as Places[Place] | undefined

export type ListNode = NodeOf<'list'>['list']
/** A node of the kind it is, once `kindOf` has said which. */
const ofKind = <Kind extends NodeKind,>(node: NodeClient, kind: Kind) => (kindOf(node) === kind ? (node as NodeOf<Kind>) : undefined)
/** What a node holds, off its kind's entry in the one map. */
const inside = (node: NodeClient): readonly NodeClient[] => (nodeMap[kindOf(node)!].children as (node: NodeClient) => readonly NodeClient[])(node)
/** The first node some nodes hold at any depth that `is` picks. */
const first = <Found,>(nodes: readonly NodeClient[], is: (node: NodeClient) => Found | undefined): Found | undefined => {
  for (const node of nodes) {
    const found = is(node) ?? first(inside(node), is)
    if (found !== undefined) return found
  }
  return undefined
}
/** The first list node of some nodes, wherever it sits, that lists the page's own kayan. */
export const listIn = (nodes: readonly NodeClient[]): ListNode | undefined =>
  first(nodes, (node) => {
    const list = ofKind(node, 'list')?.list
    return list && !list.of ? list : undefined
  })
/** Every list node some nodes hold that lists another kayan scoped to the page's row, wherever each sits. */
export const relatedIn = (nodes: readonly NodeClient[], scope?: Row): ListNode[] =>
  nodes.flatMap((node) => {
    // A node its `when` hides is not drawn, so nothing under it is read either: the read would only be
    // refused. A tab that hides every node it holds is the tab strip's to leave out, and its nodes are
    // each hidden here.
    if (scope && !shown(node, scope)) return []
    const list = ofKind(node, 'list')?.list
    return list ? (list.of ? [list] : []) : relatedIn(inside(node), scope)
  })
/** The first form node, wherever it sits: a page that holds one is drawn by a form. */
const formNodeIn = (nodes: readonly NodeClient[]): NodeOf<'form'> | undefined => first(nodes, (node) => ofKind(node, 'form'))
/** The first form node's nodes, wherever it sits. */
export const formIn = (nodes: readonly NodeClient[]): NodeClient[] | undefined => formNodeIn(nodes)?.form
/**
 * Whether a page is drawn as the row's values rather than a form: it holds no form, or the viewer may update the row
 * nowhere, where boxes refusing every keystroke would only pretend. A project component's form decides itself.
 */
export const readsAsValues = ({
  page,
  value,
  operations,
}: {
  page: TreePage
  value: Row | null | undefined
  operations: Readonly<Record<string, boolean>>
}): boolean => {
  const form = formNodeIn(nodesOf(page))
  return !form || (!!value && operations.update !== true && !form.component)
}
/** Whether some nodes draw a node of this kind over the scope: the node and every node holding it must be shown. */
export const drawsKind = ({ nodes, kind, scope }: { nodes: readonly NodeClient[]; kind: NodeKind; scope: Row }): boolean =>
  nodes.some((node) => shown(node, scope) && (kindOf(node) === kind || drawsKind({ nodes: inside(node), kind, scope })))
/** Every node of a page's tree, region by region, from its shell down. */
export const nodesOf = (page: TreePage): NodeClient[] => regionsIn(page.page).flatMap(([, nodes]) => nodes)
/** The list node a screen's page draws, which is what a list page holds exactly one of. */
export const listOf = (screen: { page: TreePage } | undefined): ListNode | undefined => screen && listIn(nodesOf(screen.page))

/**
 * Whether a nav entry is the page the viewer is on: its kayan is the page's own, on every page of that
 * kayan. Known on the server, so the first paint marks it.
 */
export const currentOf = (entry: { kayan?: string }, kayan: string | undefined): 'page' | undefined =>
  entry.kayan !== undefined && entry.kayan === kayan ? 'page' : undefined

/**
 * What one row is called by its kayan's own title field, in the viewer's
 * locale, or nothing where the kayan declares none, the row holds none, or
 * the title is a relationship that has to be read first; never the row's id.
 */
export const rowTitle = ({ kayan, row, locale }: { kayan: ClientKayan; row: Row; locale: string }): string | undefined => {
  const field = kayan.fields.find((one) => one.name === kayan.useAsTitle && one.name !== 'id')
  const held = field ? row[field.name] : undefined
  if (!field || field.kind === 'relationship' || held === null || held === undefined || held === '') return undefined
  const name = nameOfRow({ row, title: field.name, locale, kind: field.kind })
  return name && name !== String(row.id ?? '') ? name : undefined
}

/**
 * Whether a row's title is empty: the kayan is titled by a field the reader may read, and its value (in the viewer's
 * locale if localized) is nothing or blank. A draft may hold no title, and a snapshot of one may lack the key.
 */
export const isUntitled = ({ kayan, row, locale }: { kayan: ClientKayan; row: Row; locale: string }): boolean => {
  const field = kayan.fields.find((one) => one.name === kayan.useAsTitle && one.name !== 'id')
  if (!field || field.kind === 'relationship') return false
  const held = row[field.name]
  const text = held !== null && typeof held === 'object' && !(held instanceof Date) ? (held as Row)[locale] : held
  return text === null || text === undefined || (typeof text === 'string' && text.trim() === '')
}

/**
 * What a button's dialog says it runs on: the row's title (or "this row"), in the operation's `.warning` sentence.
 * The title is isolated with U+2068/U+2069 so an email or digits in an Arabic sentence keep their order.
 */
export const rowWarning = ({ kayan, row, operation, copy: { t, locale } }: { kayan: ClientKayan; row: Row; operation?: string; copy: Copy }): string => {
  const name = rowTitle({ kayan, row, locale })
  if (!name) return t('admin.rowWarning', 'This applies to this row.') ?? 'This applies to this row.'
  const sentence = (operation && t(`${kayan.name}.operations.${operation}.warning`)) || (t('admin.rowNamedWarning', 'This applies to {name}.') ?? 'This applies to {name}.')
  return sentence.replace('{name}', () => `\u2068${name}\u2069`)
}

/**
 * A page's title read across its titling relationship: the related row's title, or the kind's name until it answers,
 * on every server render, and for a row the viewer may not read.
 */
function RelatedTitle({ Heading, field, row, locale, fallback }: { Heading: 'h1' | 'h2'; field: ClientField; row: Row; locale: string; fallback: string }): ReactElement {
  const state = use(ScreenContext)
  const target = field.relationTo ?? ''
  const api = useMemo<FindApi | undefined>(() => (state ? { [target]: { find: (input) => state.client({ kayan: target, operation: 'find', input }) as Promise<FoundPage> } } : undefined), [state?.client, target])
  const titles = useRelationshipTitles({ fields: [field], docs: [row], context: { api, client: Object.values(state?.screen.kayan ?? {}), locale } })
  const id = idsOf(row[field.name])[0]
  const name = id === undefined ? undefined : titles.get(titleKey(target, id))
  const title = typeof name === 'string' && name !== id ? name : fallback
  return <Heading data-node="title" title={title} className="text-2xl font-bold tracking-tight">{title}</Heading>
}

/** The screen's nav as the host provides it: one link per entry under the screen's path. */
export function NavLinks(): ReactElement {
  const screen = useScreen()
  const copy = useLocale()
  const current = use(ScreenContext)?.kayan?.name
  return (
    <ul className="flex flex-col gap-1">
      {screen.nav.map((entry) => (
        <li key={`${entry.page}${entry.path}`}>
          <a href={`${screen.path}${entry.path}`} aria-current={currentOf(entry, current)} className="text-sm">
            {entry.label?.[copy.locale] ?? titleOf({ kayan: { name: entry.kayan ?? entry.page }, copy, many: !screen.kayan[entry.kayan ?? '']?.single })}
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * A button's `confirm`, asked in the app's own alert dialog in the page's locale rather than the
 * browser's. `ask` answers whether the person said yes, at once for a button that carries no
 * confirm, and `dialog` is the question, drawn beside the button that asks it.
 */
export const useConfirm = ({
  confirm,
  confirmLabel,
  description,
  copy: { t, locale },
}: {
  confirm: ButtonClient['confirm']
  confirmLabel: string
  /** What the caller says the button runs on, such as a bulk's count of ticked rows, before the confirm's own body. */
  description?: string
  copy: Copy
}) => {
  const [answer, setAnswer] = useState<(yes: boolean) => void>()
  const settle = (yes: boolean) => {
    answer?.(yes)
    setAnswer(undefined)
  }
  const heading = confirm?.title[locale]
  const body = [description, confirm?.body[locale]].filter(Boolean).join(' ')
  const onConfirm = () => settle(true)
  const onCancel = () => settle(false)
  const ask = () => (confirm ? new Promise<boolean>((resolve) => setAnswer(() => resolve)) : Promise.resolve(true))
  const dialog = confirm ? (
    <AlertDialog open={answer !== undefined} onOpenChange={(open: boolean) => (open ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{heading}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="max-sm:[&_button]:h-11">
          <AlertDialogCancel>{t('admin.cancel', 'Cancel') ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction data-button="confirm-operation" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null
  return { ask, dialog }
}

/**
 * A project's own button component, handed a run that asks the button's
 * confirm first, so no component can run an operation past its question.
 */
export function OwnButton({
  Own,
  busy,
  call,
  copy,
  operation,
}: {
  Own: Places['button']
  busy: boolean
  call: (input: Row) => Promise<void>
  copy: Copy
  operation: Pick<PageButton, 'name' | 'label' | 'confirm'>
}): ReactElement {
  const { ask, dialog } = useConfirm({ confirm: operation.confirm, confirmLabel: operation.label[copy.locale] ?? operation.name, copy })
  return (
    <>
      <Own operation={operation.name} busy={busy} run={async (input: Row) => void ((await ask()) && (await call(input)))} />
      {dialog}
    </>
  )
}

/**
 * A button that runs its operation where its node sits, after its confirm.
 * It is what a node draws when it asks for no values: a form draws a dialog
 * for an operation that does.
 */
export function NodeButton({ node, copy, busy, run, description }: { node: Pick<ButtonClient, 'label' | 'confirm'>; copy: Copy; busy: boolean; run: () => void; description?: string }): ReactElement {
  const label = node.label[copy.locale]
  const { ask, dialog } = useConfirm({ confirm: node.confirm, confirmLabel: label ?? '', description, copy })
  return (
    <>
      <Button type="button" variant="outline" className="max-sm:h-11" disabled={busy} onClick={() => void ask().then((yes) => yes && run())}>
        {label}
      </Button>
      {dialog}
    </>
  )
}

/**
 * A bulk update's box for a yes-or-no field, which has three answers where a checkbox has two: leave
 * each row's value as it is, set it, or clear it. The two values read in the field's own words, and
 * leaving it as it is sends nothing.
 */
export function BulkChoice({
  copy: { t },
  describedBy,
  error,
  field,
  id,
  kayan,
  onChange,
  readOnly,
  value,
}: {
  copy: Copy
  describedBy?: string
  /** A refusal of this box, which marks the trigger invalid as every control marks itself. */
  error?: string
  field: ClientField
  id: string
  kayan: ClientKayan
  onChange: (value: boolean | undefined) => void
  readOnly: boolean
  value: unknown
}): ReactElement {
  const word = (held: boolean) => t(`${kayan.name}.${field.name}.${held}`) ?? (held ? t('admin.yes', 'Yes') : t('admin.no', 'No')) ?? String(held)
  const keep = t('admin.leaveAsIs', 'Leave as is') ?? 'Leave as is'
  const current = typeof value === 'boolean' ? String(value) : 'keep'
  return (
    <Select value={current} onValueChange={(next: string | null) => onChange(next === 'true' ? true : next === 'false' ? false : undefined)} disabled={readOnly}>
      <SelectTrigger id={id} className="w-full" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
        <SelectValue>{current === 'keep' ? keep : word(current === 'true')}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="keep">{keep}</SelectItem>
        <SelectItem value="true">{word(true)}</SelectItem>
        <SelectItem value="false">{word(false)}</SelectItem>
      </SelectContent>
    </Select>
  )
}

/** One button a page draws where its node sits: the operation, and what the node says about it. */
export type PageButton = ClientKayan['operations'][number] & Pick<ButtonClient, 'label' | 'component' | 'confirm'>

/**
 * The button a node draws for this actor, when the kayan declares its
 * operation and the report allows it by its own name, with the fields its
 * dialog asks for cut to the ones the node names.
 */
export const pageButtonOf = ({
  kayan,
  node,
  allowed,
}: {
  kayan: ClientKayan
  node: ButtonClient
  allowed: Readonly<Record<string, boolean>> | undefined
}): PageButton | undefined => {
  const operation = kayan.operations.find((one) => one.name === node.button)
  if (!operation || allowed?.[operation.name] !== true) return undefined
  const fields = operation.fields?.filter((one) => !node.fields || node.fields.includes(one.name))
  return { ...operation, ...(fields && { fields }), label: node.label, ...(node.component && { component: node.component }), ...(node.confirm && { confirm: node.confirm }) }
}

/** A named group's label and description, resolved the way a field's are. */
export const groupCopy = ({
  kayan,
  name,
  group,
  copy: { t, locale },
}: {
  kayan: ClientKayan
  name: string
  group: { label?: Readonly<Record<string, string>>; description?: Readonly<Record<string, string>> }
  copy: Copy
}) => ({
  label: (typeof group.label === 'object' ? group.label[locale] : undefined) ?? t(`${kayan.name}.layout.${name}`, name) ?? name,
  description:
    (typeof group.description === 'object' ? group.description[locale] : undefined)
    ?? t(`${kayan.name}.layout.${name}.description`),
})

/** One node of a screen's page. */
export type Node = NodeClient

/** Every field name a tree mentions, at any depth, of the leaves `keep` keeps. */
export const leavesOf = (nodes: readonly Node[], keep: (leaf: LeafClient) => boolean = () => true): readonly string[] =>
  nodes.flatMap((node): readonly string[] => {
    const leaf = ofKind(node, 'field')
    return leaf ? (keep(leaf) ? [leaf.field] : []) : leavesOf(inside(node), keep)
  })

/**
 * One tab strip. `keepMounted` renders every panel, hiding the inactive ones, so a field on a tab nobody opened
 * still holds its value; base-ui unmounts a hidden panel otherwise.
 */
function TabGroup({
  line,
  tabs,
}: {
  line: boolean
  tabs: readonly { key: string; label: string; description?: string; invalid: number; invalidLabel: string; body: ReactNode }[]
}): ReactElement {
  return (
    <Tabs defaultValue={tabs[0]?.key} data-node="tabs" className={line ? 'gap-4' : 'overflow-hidden rounded-lg border'}>
      <TabsList variant={line ? 'line' : 'default'} className={line ? 'w-full justify-start max-sm:min-h-12' : 'm-1 max-sm:min-h-12'}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key} className={line ? 'flex-none max-sm:min-h-11' : 'max-sm:min-h-11'}>
            {tab.label}
            {/* How many of this tab's fields the refusal named, so a save refused over a field on a tab
                nobody opened says so on the tab. */}
            {tab.invalid > 0 ? (
              <Badge variant="destructive" aria-label={tab.invalidLabel} title={tab.invalidLabel} data-mithaq-invalid={tab.invalid}>
                {tab.invalid}
              </Badge>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key} keepMounted className={line ? 'flex flex-col gap-4' : 'flex flex-col gap-4 p-4'}>
          {tab.description ? <p className="text-sm text-muted-foreground">{tab.description}</p> : null}
          {tab.body}
        </TabsContent>
      ))}
    </Tabs>
  )
}

/** What a tree is drawn with: the form's own answer for each leaf and component, and the frame each layout is. */
export type Draw = {
  kayan: ClientKayan
  copy: Copy
  /** The refusal per field, which a tab counts over the fields it holds. */
  issues: Readonly<Record<string, string>>
  control: (leaf: string | LeafClient) => ReactNode
  component: (path: string, index: number) => ReactNode
  /** A layout nested in a region, handed its own regions drawn. */
  layout: (args: { path: string; regions: Record<string, ReactNode>; index: number }) => ReactNode
  /** A list node, the page's own or one of another kayan, and the component that draws it in place of the registry's list. */
  list?: (args: { node: ListNode; index: number; component?: string }) => ReactNode
  /** A button node, which only what holds a row to run it over draws. */
  button?: (node: ButtonClient, index: number) => ReactNode
  /** The derived nav, which the host holds. */
  nav?: () => ReactNode
  /** What a form node draws around what it holds. */
  form?: (children: ReactNode) => ReactNode
  /** The form's controls, which only a form draws: where the row stands, its last save and its buttons. */
  controls?: () => ReactNode
  /**
   * What a node's `when` reads: the form's values by field name, the row the
   * page draws as `record` and the access report as `$user`, which `scopeOf`
   * puts together.
   */
  scope: Row
  /**
   * Whether the nodes drawn sit inside a card: a section, an accordion, a pill
   * tab strip, or the card a run of loose fields is drawn on. A tab strip reads
   * it to pick the pill strip or the line bar.
   */
  inCard?: boolean
  /**
   * Whether the page lists the kayan's own rows, where its title names the kayan by its plural:
   * "Courses" over the list, "Course" over one of them. A list of another kayan on a record page
   * leaves it the singular.
   */
  many?: boolean
  /**
   * Whether the page opens over its list in a dialog, a sheet or a drawer, where its title is an h2
   * so the list's h1 behind it stays the page's one.
   */
  framed?: boolean
}

/**
 * What a `when` reads, from the values a form holds, the row the page draws and the actor's access
 * report, and the kind of each field of the kayan, which a decimal is compared by. No `when` can name
 * `$kinds`: the build refuses a key that is no field and not `$user`.
 */
export const scopeOf = ({ values, record, access, kayan }: { values: Row; record: Row | null | undefined; access: unknown; kayan: ClientKayan }): Row =>
  ({ ...values, record: record ?? null, $user: access ?? null, $kinds: Object.fromEntries(kayan.fields.map((field) => [field.name, field.kind])) })

/**
 * Whether a node is drawn: it carries no `when`, or its `when` holds over the scope, a dotted key
 * read one segment at a time. It decides what is shown and nothing else: the server still refuses
 * what the actor may not do.
 */
export const shown = (node: NodeClient, scope: Row) =>
  typeof node !== 'object' || !node.when
  || matchesWhere({
    where: node.when,
    valueOf: (key) => key.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as Row)[part] : undefined), scope),
    // A field is named alone, as `record.<field>`, or with a locale after it.
    kindOf: (key) => {
      const [head, next] = key.split('.')
      return (scope.$kinds as Record<string, string> | undefined)?.[head === 'record' ? next! : head!]
    },
  })

/**
 * Every kind of node, how it draws and what it holds: the one map every walk of a tree goes through.
 * TypeScript refuses it with a kind left out. The set is closed: a project draws its own thing with a
 * `component` node, and changes how a kind draws by editing its copy of this map.
 */
export type NodeMap = {
  [Kind in NodeKind]: {
    /** The node drawn; `inRow` when it sits in a row, where a section takes its width. */
    draw: (args: { node: NodeOf<Kind>; draw: Draw; index: number; inRow: boolean }) => ReactNode
    /** The nodes it holds, which a walk descends into. */
    children: (node: NodeOf<Kind>) => readonly NodeClient[]
  }
}

const none = () => []

/**
 * How each node kind is drawn. A list is drawn by the host that holds its rows, and by nothing where no host hands one.
 * Every node carries its kind as `data-node`, so a served page says what it drew.
 */
export const nodeMap: NodeMap = {
  layout: {
    draw: ({ node, draw, index }) => <div key={`layout-${index}`} data-node="layout" className="contents">{draw.layout({ path: node.layout, regions: regionsOf(node, draw), index })}</div>,
    children: (node) => regionsIn(node).flatMap(([, nodes]) => nodes),
  },
  field: { draw: ({ node, draw }) => draw.control(node), children: none },
  form: {
    draw: ({ node, draw, index }) => {
      // A form node that names a component is drawn by it in place of its leaves, and the form still
      // holds, checks and saves the values.
      const held = node.component ? draw.component(node.component, index) : carded(node.form, draw)
      return <div key={`form-${index}`} data-node="form" className="flex flex-col gap-4">{draw.form ? draw.form(held) : held}</div>
    },
    children: (node) => node.form,
  },
  list: {
    draw: ({ node, draw, index }) => <div key={`list-${index}`} data-node="list" className="contents">{draw.list?.({ node: node.list, index, component: node.component })}</div>,
    children: none,
  },
  button: { draw: ({ node, draw, index }) => <div key={`button-${index}`} data-node="button" className="contents">{draw.button?.(node, index)}</div>, children: none },
  title: {
    // The whole title is its tooltip too, as a header may cut it short on a phone. The title is the row
    // as read, not the value being typed, so it changes once a save lands.
    draw: ({ draw: { kayan, copy, many, framed, form, scope }, index }) => {
      const Heading = framed ? 'h2' : 'h1'
      const record = scope.record as Row | null | undefined
      const field = kayan.fields.find((one) => one.name === kayan.useAsTitle && one.name !== 'id')
      // A global with no saved row yet is still its one page, so it keeps its name.
      const fallback = !many && form && !record && !kayan.single ? newTitleOf({ kayan, copy }) : titleOf({ kayan, copy, many })
      if (!many && record && field?.kind === 'relationship') return <RelatedTitle key={`title-${index}`} Heading={Heading} field={field} row={record} locale={copy.locale} fallback={fallback} />
      const untitled = !many && !!record && isUntitled({ kayan, row: record, locale: copy.locale })
      const title = untitled ? (copy.t('admin.untitled', 'Untitled') ?? 'Untitled') : (!many && record ? rowTitle({ kayan, row: record, locale: copy.locale }) : undefined) ?? fallback
      return <Heading key={`title-${index}`} data-node="title" title={title} className="text-2xl font-bold tracking-tight">{untitled ? <span className="text-muted-foreground">{title}</span> : title}</Heading>
    },
    children: none,
  },
  nav: {
    // Nothing in a frame: the list's own shell behind it already draws the nav.
    draw: ({ draw, index }) => !draw.framed && <nav key={`nav-${index}`} data-node="nav" aria-label={draw.copy.t('admin.navigation', 'Navigation')}>{draw.nav?.()}</nav>,
    children: none,
  },
  // Drawn only by a form, which hands its controls; off a form page the node draws nothing.
  controls: {
    draw: ({ draw, index }) => draw.controls && <div key={`controls-${index}`} data-node="controls" className="contents">{draw.controls()}</div>,
    children: none,
  },
  component: {
    draw: ({ node, draw, index }) => <div key={`component-${index}`} data-node="component" className="contents">{draw.component(node.component, index)}</div>,
    children: none,
  },
  row: {
    draw: ({ node, draw, index }) =>
      node.resizable ? (
        <ResizablePanelGroup key={`row-${index}`} data-node="row" orientation="horizontal" className="rounded-lg border">
          {drawNodes({ nodes: node.row, draw }).flatMap((child, at) => [
            ...(at ? [<ResizableHandle key={`handle-${at}`} withHandle />] : []),
            <ResizablePanel key={`panel-${at}`} className="p-2">{child}</ResizablePanel>,
          ])}
        </ResizablePanelGroup>
      ) : (
        // `min-w-40` on a field alone so it wraps to its own line on a phone before it is too narrow to
        // show its value: `flex-1` alone starts every field at no width, so the row never wraps. A button
        // or a short select beside it is not forced to 160 pixels.
        <div key={`row-${index}`} data-node="row" className="flex flex-wrap items-start gap-4 [&>[data-control]]:min-w-40 [&>[data-field-value]]:min-w-40 [&>*]:flex-1">
          {drawNodes({ nodes: node.row, draw, inRow: true })}
        </div>
      ),
    children: (node) => node.row,
  },
  separator: { draw: ({ index }) => <Separator key={`separator-${index}`} data-node="separator" />, children: none },
  tabs: {
    draw: ({ node, draw, index }) => (
      <TabGroup
        key={`tabs-${index}`}
        line={!draw.inCard}
        // A tab whose every node its `when` hides is left out, so no actor opens a tab that holds
        // nothing it may see.
        tabs={node.tabs.filter((tab) => tab.fields.some((one) => shown(one, draw.scope))).map((tab) => {
          // Counted over the fields this tab holds at any depth, so a
          // refused field inside a row inside a tab is counted on the tab.
          const invalid = leavesOf(tab.fields).filter((name) => draw.issues[name] !== undefined).length
          return {
            key: tab.tab,
            ...groupCopy({ kayan: draw.kayan, name: tab.tab, group: tab, copy: draw.copy }),
            invalid,
            invalidLabel: (
              draw.copy.t('admin.invalidFields', 'Fields needing attention: {count}') ?? 'Fields needing attention: {count}'
            ).replace('{count}', String(invalid)),
            body: <div className="flex flex-col gap-4">{carded(tab.fields, draw)}</div>,
          }
        })}
      />
    ),
    children: (node) => node.tabs.flatMap((tab) => tab.fields),
  },
  accordion: {
    draw: ({ node, draw, index }) => (
      <Accordion data-layout-accordion="true" data-node="accordion" key={`accordion-${index}`} defaultValue={node.accordion[0] ? [node.accordion[0].item] : []} keepMounted className="overflow-hidden rounded-lg border">
        {node.accordion.map((item) => {
          const { label, description } = groupCopy({ kayan: draw.kayan, name: item.item, group: item, copy: draw.copy })
          return <AccordionItem key={item.item} value={item.item} className="border-b last:border-b-0">
            <AccordionHeader><AccordionTrigger>{label}<ChevronDown aria-hidden="true" className="size-4" /></AccordionTrigger></AccordionHeader>
            <AccordionPanel className="flex flex-col gap-4 p-4">
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
              {drawNodes({ nodes: item.fields, draw: { ...draw, inCard: true } })}
            </AccordionPanel>
          </AccordionItem>
        })}
      </Accordion>
    ),
    children: (node) => node.accordion.flatMap((item) => item.fields),
  },
  section: {
    draw: ({ node, draw, inRow }) => {
      const { label, description } = groupCopy({ kayan: draw.kayan, name: node.section, group: node, copy: draw.copy })
      const body = <CardContent className="flex flex-col gap-4">{drawNodes({ nodes: node.fields, draw: { ...draw, inCard: true } })}</CardContent>
      // A section is a card that opens and closes. `keepMounted` on the panel so a field inside a closed
      // section still renders and a refusal naming it is counted.
      return (
        <Collapsible key={node.section} data-node="section" defaultOpen={node.collapsed !== true} style={inRow ? { flexGrow: node.width ?? 1, flexBasis: 0 } : undefined}>
          <Card className="overflow-visible rounded-lg">
            <CardHeader>
              <CardTitle>
                <h2 className="text-base font-medium">
                  <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-2 text-start max-sm:min-h-11">
                    {label}
                    <ChevronDown
                      aria-hidden="true"
                      className="text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180"
                    />
                  </CollapsibleTrigger>
                </h2>
              </CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </CardHeader>
            <CollapsibleContent keepMounted>
              {node.scroll ? <ScrollArea style={{ height: node.scroll }}>{body}</ScrollArea> : body}
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )
    },
    children: (node) => node.fields,
  },
}

/**
 * A form's nodes, with each run of fields that sits in no section drawn on a card, so a dark page
 * reads as cards over the inset and not as boxes on black. A section, tabs and a component are drawn
 * as they are.
 */
const loose = new Set(['field', 'row', 'separator'])
export const carded = (nodes: readonly Node[], draw: Draw): ReactNode[] => {
  const drawn: ReactNode[] = []
  let run: Node[] = []
  const flush = () => {
    const held = run.filter((one) => shown(one, draw.scope) && !blank(one, draw.kayan))
    // A separator divides what a card holds, so a card holding nothing else is not drawn.
    if (held.some((one) => kindOf(one) !== 'separator')) {
      drawn.push(
        <Card key={`card-${drawn.length}`} className="overflow-visible rounded-lg">
          <CardContent className="flex flex-col gap-4">{drawNodes({ nodes: held, draw: { ...draw, inCard: true } })}</CardContent>
        </Card>,
      )
    }
    run = []
  }
  for (const one of nodes) {
    if (loose.has(kindOf(one)!)) {
      run.push(one)
      continue
    }
    flush()
    drawn.push(<Fragment key={`node-${drawn.length}`}>{drawNodes({ nodes: [one], draw })}</Fragment>)
  }
  flush()
  return drawn
}

/**
 * Whether a node would draw nothing but empty frames: a leaf naming a field the projection does not
 * hold, which is a field the viewer may not read, or a row, section, tab strip or accordion holding
 * only such leaves. Such a group is not drawn, rather than drawn as an empty card.
 */
const blank = (node: Node, kayan: ClientKayan): boolean => {
  const kind = kindOf(node)
  if (kind === 'field') return !kayan.fields.some((field) => field.name === (typeof node === 'string' ? node : (node as LeafClient).field))
  return ['row', 'section', 'tabs', 'accordion'].includes(kind!) && inside(node).every((one) => blank(one, kayan))
}

/** One tree, one node at a time, each through its kind's entry in the one map. */
export const drawNodes = ({ nodes, draw, inRow = false }: { nodes: readonly Node[]; draw: Draw; inRow?: boolean }): ReactNode[] =>
  nodes.map((node, index) =>
    !shown(node, draw.scope) || blank(node, draw.kayan)
      ? null
      : (nodeMap[kindOf(node)!].draw as (args: { node: Node; draw: Draw; index: number; inRow: boolean }) => ReactNode)({ node, draw, index, inRow }),
  )

/**
 * Whether a node draws anything: shown, not blank, a button its page draws (an operation the report
 * allows), and a group holding at least one such node. A danger zone of buttons the viewer may not
 * run is no card at all.
 */
const draws = (node: Node, draw: Draw): boolean => {
  if (!shown(node, draw.scope) || blank(node, draw.kayan)) return false
  const kind = kindOf(node)
  if (kind === 'button') return (draw.button?.(node as ButtonClient, 0) ?? null) !== null
  return !['row', 'section', 'tabs', 'accordion'].includes(kind!) || inside(node).some((one) => draws(one, draw))
}

/**
 * A shell's or a layout's regions, each drawn from its nodes, which is what its
 * file is handed. A region none of whose nodes is drawn is handed as nothing,
 * so a layout leaves out its frame, a danger zone's heading among them.
 */
export const regionsOf = (frame: RegionsClient, draw: Draw): Record<string, ReactNode> =>
  Object.fromEntries(regionsIn(frame).map(([region, nodes]) => [region, nodes.some((node) => draws(node, draw)) ? drawNodes({ nodes, draw }) : undefined]))

/**
 * The shell or the layout a page names, handed its regions drawn and the page
 * it frames. A name this app has no component for is said where the frame
 * would have been rather than drawn as a blank.
 */
export const frameOf = ({
  screen,
  t,
  path,
  regions,
  key,
}: {
  screen: ScreenPage
  t: Translate
  path: string
  regions: Record<string, ReactNode>
  key?: Key
}): ReactNode => {
  const Frame = refOf({ screen, place: 'layout', path })
  if (Frame) return <Frame key={key} regions={regions} page={screen.page} />
  const missing = t('admin.missingLayout', 'No component is registered for layout "{layout}".') ?? 'No component is registered for layout "{layout}".'
  return <p key={key} data-missing-layout={path} className="text-muted-foreground text-sm">{missing.replace('{layout}', path)}</p>
}

/**
 * A page's whole tree: its shell handed each region drawn, or, where the page
 * opens over the list and so inside the list's own shell, its regions alone.
 */
export const pageOf = (screen: ScreenPage, draw: Draw): ReactNode => {
  const drawn = { ...draw, many: listOf(screen) !== undefined }
  if (!screen.page.mode) return frameOf({ screen, t: draw.copy.t, path: screen.page.page.shell, regions: regionsOf(screen.page.page, drawn) })
  // Over the list the page draws only itself, and a nav node at any depth draws nothing there.
  return regionsIn(screen.page.page).map(([region, nodes]) => <Fragment key={region}>{drawNodes({ nodes, draw: { ...drawn, framed: true } })}</Fragment>)
}

/**
 * One field's control in its shell, as the form draws a leaf. The leaf's copy, width and read-only win over the field's;
 * a component named by path gets the props its place hands it, any other name is a registry control.
 */
export function LeafControl({
  field,
  kayan,
  leaf,
  screen,
  copy,
  error,
  invalidLocales,
  onBlur,
  ...rest
}: Omit<ControlProps, 'id' | 't' | 'locale' | 'placeholder' | 'describedBy' | 'client'> & {
  leaf?: LeafClient
  screen?: ScreenPage
  copy: Copy
  /** The locales of a localized field a refusal named by its path, `title.ar`, whose boxes alone are marked. */
  invalidLocales?: readonly string[]
  onBlur?: () => void
  kayans?: readonly ClientKayan[]
  api?: FindApi
}): ReactElement {
  const { kayans, ...props } = rest
  const { locale } = copy
  const chosen = leaf?.component ?? field.component
  const Ref = refOf({ screen, place: 'control', path: chosen })
  const Control = (leaf?.component && controls[leaf.component]) || controlFor(field)
  const inputId = `${kayan.name}-${field.name}`
  const description = leaf?.description?.[locale] ?? descriptionFor({ kayan, field, copy })
  const readOnly = props.readOnly || leaf?.readOnly === true
  const placeholder = leaf?.placeholder?.[locale] ?? placeholderFor({ kayan, field, copy })
  // A localized field is one box per locale under one label, the viewer's own first and carrying the
  // field's id; a change to one box writes the whole object, which is how the store takes it.
  if (field.rules.localized === true && !Ref) {
    const held = (props.value && typeof props.value === 'object' ? props.value : {}) as Record<string, unknown>
    const names = new Intl.DisplayNames([locale], { type: 'language' })
    const order = [locale, ...(copy.locales ?? []).filter((one) => one !== locale)]
    // Marks the locales a refusal's paths name; before any save, the empty boxes of a required field;
    // any other refusal marks every box.
    const blank = (one: string) => held[one] === undefined || held[one] === null || held[one] === ''
    const marked = (one: string) =>
      !error ? false
      : invalidLocales?.length ? invalidLocales.includes(one)
      : field.rules.required === true && order.some(blank) ? blank(one)
      : true
    const label = labelFor({ kayan, field, copy })
    return (
      <FieldShell id={inputId} label={label} description={description} error={error} onBlur={onBlur} control={chosen} width={leaf?.width ?? field.width}>
        <div className="grid gap-2">
          {order.map((one) => (
            <div key={one} className="grid gap-1">
              {/* The viewer's own box is named by the field's label, every other box by the label and its locale. */}
              {one === locale ? (
                <span id={`${inputId}-${one}-locale`} className="text-muted-foreground text-xs">{names.of(one)}</span>
              ) : (
                <label id={`${inputId}-${one}-locale`} htmlFor={`${inputId}-${one}`} className="text-muted-foreground text-xs">
                  <span className="sr-only">{label} </span>
                  {names.of(one)}
                </label>
              )}
              <Control
                {...props}
                field={field}
                kayan={kayan}
                client={kayans}
                t={copy.t}
                locale={locale}
                locales={copy.locales}
                id={one === locale ? inputId : `${inputId}-${one}`}
                value={held[one]}
                onChange={(next) => props.onChange({ ...held, [one]: next })}
                readOnly={readOnly}
                error={marked(one) ? error : undefined}
                placeholder={placeholder}
                describedBy={[`${inputId}-${one}-locale`, describedBy({ id: inputId, description, error })].filter(Boolean).join(' ')}
              />
            </div>
          ))}
        </div>
      </FieldShell>
    )
  }
  return (
    <FieldShell
      id={inputId}
      label={labelFor({ kayan, field, copy })}
      description={description}
      error={error}
      onBlur={onBlur}
      beside={!Ref && besideLabel(Control)}
      control={chosen}
      width={leaf?.width ?? field.width}
    >
      {Ref && screen ? (
        <Ref field={field} value={props.value} onChange={props.onChange} readOnly={readOnly} issue={error ?? null} />
      ) : (
        <Control
          {...props}
          field={field}
          kayan={kayan}
          client={kayans}
          t={copy.t}
          locale={locale}
          locales={copy.locales}
          id={inputId}
          readOnly={readOnly}
          error={error}
          placeholder={placeholder}
          describedBy={describedBy({ id: inputId, description, error })}
        />
      )}
    </FieldShell>
  )
}

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
