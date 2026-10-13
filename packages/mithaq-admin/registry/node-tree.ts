import type { ReactNode } from 'react'
import { kindOf, matchesWhere, regionsIn } from 'mithaq/admin'
import type { ButtonClient, ClientKayan, LeafClient, NodeClient, NodeKind, NodeOf, Row } from 'mithaq/admin'
import type { Copy } from './copy.ts'
import type { TreePage } from './screen-refs.ts'

/** One node of a screen's page. */
export type Node = NodeClient
export type ListNode = NodeOf<'list'>['list']

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

/** What a node of one kind is handed where it is drawn; `inRow` when it sits in a row, where a section takes its width. */
export type NodeProps<Kind extends NodeKind = NodeKind> = { node: NodeKind extends Kind ? NodeClient : NodeOf<Kind>; draw: Draw; index: number; inRow: boolean }

const none = () => []
/**
 * What each kind of node holds, which every walk of a tree descends into. TypeScript refuses it with a kind left out.
 * It is the projection's shape and not a drawing, so a node replaced in the components map holds what the shipped one did.
 */
const children: { [Kind in NodeKind]: (node: NodeOf<Kind>) => readonly NodeClient[] } = {
  layout: (node) => regionsIn(node).flatMap(([, nodes]) => nodes),
  field: none,
  form: (node) => node.form,
  list: none,
  button: none,
  title: none,
  nav: none,
  controls: none,
  component: none,
  row: (node) => node.row,
  separator: none,
  tabs: (node) => node.tabs.flatMap((tab) => tab.fields),
  accordion: (node) => node.accordion.flatMap((item) => item.fields),
  section: (node) => node.fields,
}

/** A node of the kind it is, once `kindOf` has said which. */
const ofKind = <Kind extends NodeKind,>(node: NodeClient, kind: Kind) => (kindOf(node) === kind ? (node as NodeOf<Kind>) : undefined)
/** What a node holds. */
export const inside = (node: NodeClient): readonly NodeClient[] => (children[kindOf(node)!] as (node: NodeClient) => readonly NodeClient[])(node)
/** The first node some nodes hold at any depth that `is` picks. */
const first = <Found,>(nodes: readonly NodeClient[], is: (node: NodeClient) => Found | undefined): Found | undefined => {
  for (const node of nodes) {
    const found = is(node) ?? first(inside(node), is)
    if (found !== undefined) return found
  }
  return undefined
}
/** Every kind some nodes are of, at any depth. */
export const kindsIn = (nodes: readonly NodeClient[]): NodeKind[] => nodes.flatMap((node) => [kindOf(node)!, ...kindsIn(inside(node))])
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

/** Every field name a tree mentions, at any depth, of the leaves `keep` keeps. */
export const leavesOf = (nodes: readonly Node[], keep: (leaf: LeafClient) => boolean = () => true): readonly string[] =>
  nodes.flatMap((node): readonly string[] => {
    const leaf = ofKind(node, 'field')
    return leaf ? (keep(leaf) ? [leaf.field] : []) : leavesOf(inside(node), keep)
  })

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
 * Whether a node would draw nothing but empty frames: a leaf naming a field the projection does not
 * hold, which is a field the viewer may not read, or a row, section, tab strip or accordion holding
 * only such leaves. Such a group is not drawn, rather than drawn as an empty card.
 */
export const blank = (node: Node, kayan: ClientKayan): boolean => {
  const kind = kindOf(node)
  if (kind === 'field') return !kayan.fields.some((field) => field.name === (typeof node === 'string' ? node : (node as LeafClient).field))
  return ['row', 'section', 'tabs', 'accordion'].includes(kind!) && inside(node).every((one) => blank(one, kayan))
}
