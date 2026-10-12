// Imports types and `referencesIn` alone, so `mithaq/admin` can hand its node kinds to a browser.
import type { FrameClient, LeafClient, NodeClient, RegionsClient, ScreenClient } from './index.ts'
import { referencesIn } from './client.ts'

/** One line of the tree, and the lines under it. */
export type StudioNode = {
  label: string
  /** Which level decided what a leaf draws. */
  decided?: LeafClient['decided']
  children?: StudioNode[]
}

const named = (label: string, reference: string): StudioNode => ({ label: `${label} ${reference}` })
const group = (label: string, children: StudioNode[]): StudioNode => ({ label, ...(children.length && { children }) })

/**
 * Every kind of node a page's tree holds, in the order a walk asks for them. Every walk
 * goes through a map keyed by these, so TypeScript refuses one that leaves a kind out.
 */
export const nodeKinds = ['layout', 'field', 'form', 'list', 'button', 'title', 'nav', 'controls', 'component', 'row', 'separator', 'tabs', 'accordion', 'section'] as const
export type NodeKind = (typeof nodeKinds)[number]
/** The node of one kind. */
export type NodeOf<Kind extends NodeKind> = Extract<NodeClient, Record<Kind, unknown>>
/** Which kind a node is: the first kind whose key it holds. A bare name is a leaf. */
export const kindOf = (node: unknown): NodeKind | undefined =>
  typeof node === 'string' ? 'field' : node && typeof node === 'object' ? nodeKinds.find((kind) => kind in node) : undefined

/** The regions a shell or a layout fills, each with its nodes. */
export const regionsIn = (frame: RegionsClient): [string, NodeClient[]][] =>
  Object.entries(frame).filter((entry): entry is [string, NodeClient[]] => !['shell', 'layout', 'when'].includes(entry[0]))

const leafOf = (leaf: LeafClient): StudioNode => {
  const [place, reference] = leaf.component !== undefined ? ['control', leaf.component] : ['cell', leaf.cell ?? '']
  return { ...named(`${leaf.field}: ${place}`, reference), ...(leaf.decided && { decided: leaf.decided }) }
}

const frameOf = (label: string, reference: string, frame: RegionsClient): StudioNode => ({
  ...named(label, reference),
  children: regionsIn(frame).map(([region, nodes]) => group(`region ${region}`, nodes.map(nodeOf))),
})

const drawnBy = (node: { component?: string }) => (node.component !== undefined ? [named('component', node.component)] : [])

const studioOf: { [Kind in NodeKind]: (node: NodeOf<Kind>) => StudioNode } = {
  layout: (node) => frameOf('layout', node.layout, node),
  field: (node) => leafOf(node),
  form: (node) => group('form', [...drawnBy(node), ...node.form.map(nodeOf)]),
  list: (node) => {
    const { columns, filters, search, empty, menu, sort, limit, of, where } = node.list
    return group(of ? `list of ${of} where ${where}` : 'list', [
      ...drawnBy(node),
      ...columns.map(leafOf),
      ...(filters ? [{ label: `filters ${filters.join(', ')}` }] : []),
      ...(search ? [{ label: `search ${search.join(', ')}` }] : []),
      ...(empty !== undefined ? [named('empty', empty)] : []),
      ...(menu !== undefined ? [named('menu', menu)] : []),
      ...(sort !== undefined ? [{ label: `sort ${sort}` }] : []),
      ...(limit !== undefined ? [{ label: `limit ${limit}` }] : []),
      ...(['toolbar', 'bulk', 'row'] as const).flatMap((region) => (node.list[region] ? [group(`region ${region}`, node.list[region].map(nodeOf))] : [])),
    ])
  },
  button: (node) => group(`button operation ${node.button}${node.confirm ? ' (confirm)' : ''}`, drawnBy(node)),
  title: () => ({ label: 'title' }),
  nav: () => ({ label: 'nav' }),
  controls: () => ({ label: 'controls' }),
  component: (node) => named('component', node.component),
  row: (node) => group(node.resizable ? 'row resizable' : 'row', node.row.map(nodeOf)),
  separator: () => ({ label: 'separator' }),
  tabs: (node) => group('tabs', node.tabs.map((tab) => group(`tab ${tab.tab}`, tab.fields.map(nodeOf)))),
  accordion: (node) => group('accordion', node.accordion.map((item) => group(`item ${item.item}`, item.fields.map(nodeOf)))),
  section: (node) => group(`section ${node.section}`, node.fields.map(nodeOf)),
}

const nodeOf = (node: NodeClient): StudioNode => {
  const line = (studioOf[kindOf(node)!] as (node: NodeClient) => StudioNode)(node)
  return node.when ? { ...line, label: `${line.label} when ${JSON.stringify(node.when)}` } : line
}

const filesOf = (value: unknown) => new Set(referencesIn(value).map((reference) => reference.slice(0, reference.indexOf('#'))))

/** One screen as the tree `mithaq screens` prints. */
export const studioTree = (name: string, screen: ScreenClient): StudioNode => ({
  label: `screen ${name} ${screen.path}`,
  children: [
    group('providers', screen.providers.map((one) => named('provider', one))),
    group(
      'pages',
      Object.entries(screen.pages).map(([page, one]) => group(`page ${page} ${one.path}`, [named('component', one.component)])),
    ),
    group(
      'nav',
      screen.nav.map((entry) => ({ label: `${entry.kayan ?? 'screen'} ${entry.page} ${entry.path}${entry.permission ? ` (${entry.permission})` : ''}` })),
    ),
    group(
      'kayan',
      Object.values(screen.kayan).map((kayan) =>
        group(
          kayan.name,
          Object.entries(kayan.pages).map(([page, one]) =>
            group(
              `page ${page} ${one.path}${'mode' in one && one.mode ? ` (${one.mode})` : ''}`,
              'component' in one ? [named('component', one.component)] : [frameOf('shell', (one.page as FrameClient).shell, one.page)],
            ),
          ),
        ),
      ),
    ),
    group('files', [...filesOf(screen)].sort().map((file) => ({ label: file }))),
  ],
})

/** The tree as text, two spaces a level, which is what `mithaq screens` prints. */
export const studioText = (node: StudioNode, depth = 0): string =>
  [`${'  '.repeat(depth)}${node.label}${node.decided ? ` (${node.decided})` : ''}`, ...(node.children ?? []).map((child) => studioText(child, depth + 1))].join('\n')
