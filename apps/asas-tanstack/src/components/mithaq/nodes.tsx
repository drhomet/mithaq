import { Fragment, type Key, type ReactElement, type ReactNode } from 'react'
import { kindOf, regionsIn } from 'mithaq/admin'
import type { ButtonClient, RegionsClient, Translate } from 'mithaq/admin'
import { Card, CardContent } from '@/components/ui/card'
import { nodeFor, useComponents } from './components.tsx'
import { blank, inside, listOf, shown, type Draw, type Node, type NodeProps } from './node-tree.ts'
import { refOf, type ScreenPage } from './screen-refs.ts'

/** One node, drawn by its kind's entry in the components map. */
function DrawNode(props: NodeProps): ReactElement {
  const Drawn = nodeFor(useComponents().nodes, kindOf(props.node)!)
  return <Drawn {...props} />
}

/** One tree, one node at a time, each through its kind's entry in the components map. */
export const drawNodes = ({ nodes, draw, inRow = false }: { nodes: readonly Node[]; draw: Draw; inRow?: boolean }): ReactNode[] =>
  nodes.map((node, index) =>
    !shown(node, draw.scope) || blank(node, draw.kayan) ? null : <DrawNode key={`${kindOf(node)}-${index}`} node={node} draw={draw} index={index} inRow={inRow} />,
  )

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
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 6dd2600bcf002dadb0f1f7e934a1dc948a20e9235896a4b9d7760b2febf43082
