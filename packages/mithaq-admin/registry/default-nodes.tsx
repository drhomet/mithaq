import { use, useMemo, type ReactElement } from 'react'
import type { ClientField, Row } from 'mithaq/admin'
import { ScreenContext } from 'mithaq/admin/react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import type { Nodes } from 'mithaq-admin/components.tsx'
import type { FindApi, FoundPage } from 'mithaq-admin/control-props.ts'
import { newTitleOf, titleOf } from 'mithaq-admin/copy.ts'
import { AccordionNode, SectionNode, TabsNode } from 'mithaq-admin/node-groups.tsx'
import type { NodeProps } from 'mithaq-admin/node-tree.ts'
import { carded, drawNodes, regionsOf } from 'mithaq-admin/nodes.tsx'
import { titleKey, useRelationshipTitles } from 'mithaq-admin/relationship-cell.tsx'
import { idsOf } from 'mithaq-admin/relationship-control.tsx'
import { isUntitled, rowTitle } from 'mithaq-admin/row-title.tsx'

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

// The whole title is its tooltip too, as a header may cut it short on a phone. The title is the row
// as read, not the value being typed, so it changes once a save lands.
function TitleNode({ draw: { kayan, copy, many, framed, form, scope } }: NodeProps<'title'>): ReactElement {
  const Heading = framed ? 'h2' : 'h1'
  const record = scope.record as Row | null | undefined
  const field = kayan.fields.find((one) => one.name === kayan.useAsTitle && one.name !== 'id')
  // A global with no saved row yet is still its one page, so it keeps its name.
  const fallback = !many && form && !record && !kayan.single ? newTitleOf({ kayan, copy }) : titleOf({ kayan, copy, many })
  if (!many && record && field?.kind === 'relationship') return <RelatedTitle Heading={Heading} field={field} row={record} locale={copy.locale} fallback={fallback} />
  const untitled = !many && !!record && isUntitled({ kayan, row: record, locale: copy.locale })
  const title = untitled ? (copy.t('admin.untitled', 'Untitled') ?? 'Untitled') : (!many && record ? rowTitle({ kayan, row: record, locale: copy.locale }) : undefined) ?? fallback
  return <Heading data-node="title" title={title} className="text-2xl font-bold tracking-tight">{untitled ? <span className="text-muted-foreground">{title}</span> : title}</Heading>
}

/**
 * How each node kind is drawn, one component per kind, which `defaultComponents.nodes` holds. A list is drawn by the
 * host that holds its rows, and by nothing where no host hands one. Every node carries its kind as `data-node`, so a
 * served page says what it drew.
 */
export const defaultNodes: Nodes = {
  layout: ({ node, draw, index }) => <div data-node="layout" className="contents">{draw.layout({ path: node.layout, regions: regionsOf(node, draw), index })}</div>,
  field: ({ node, draw }) => draw.control(node),
  form: ({ node, draw, index }) => {
    // A form node that names a component is drawn by it in place of its leaves, and the form still
    // holds, checks and saves the values.
    const held = node.component ? draw.component(node.component, index) : carded(node.form, draw)
    return <div data-node="form" className="flex flex-col gap-4">{draw.form ? draw.form(held) : held}</div>
  },
  list: ({ node, draw, index }) => <div data-node="list" className="contents">{draw.list?.({ node: node.list, index, component: node.component })}</div>,
  button: ({ node, draw, index }) => <div data-node="button" className="contents">{draw.button?.(node, index)}</div>,
  title: TitleNode,
  // Nothing in a frame: the list's own shell behind it already draws the nav.
  nav: ({ draw }) => !draw.framed && <nav data-node="nav" aria-label={draw.copy.t('admin.navigation', 'Navigation')}>{draw.nav?.()}</nav>,
  // Drawn only by a form, which hands its controls; off a form page the node draws nothing.
  controls: ({ draw }) => draw.controls && <div data-node="controls" className="contents">{draw.controls()}</div>,
  component: ({ node, draw, index }) => <div data-node="component" className="contents">{draw.component(node.component, index)}</div>,
  row: ({ node, draw }) =>
    node.resizable ? (
      <ResizablePanelGroup data-node="row" orientation="horizontal" className="rounded-lg border">
        {drawNodes({ nodes: node.row, draw }).flatMap((child, at) => [
          ...(at ? [<ResizableHandle key={`handle-${at}`} withHandle />] : []),
          <ResizablePanel key={`panel-${at}`} className="p-2">{child}</ResizablePanel>,
        ])}
      </ResizablePanelGroup>
    ) : (
      // `min-w-40` on a field alone so it wraps to its own line on a phone before it is too narrow to
      // show its value: `flex-1` alone starts every field at no width, so the row never wraps. A button
      // or a short select beside it is not forced to 160 pixels.
      <div data-node="row" className="flex flex-wrap items-start gap-4 [&>[data-control]]:min-w-40 [&>[data-field-value]]:min-w-40 [&>*]:flex-1">
        {drawNodes({ nodes: node.row, draw, inRow: true })}
      </div>
    ),
  separator: () => <Separator data-node="separator" />,
  tabs: TabsNode,
  accordion: AccordionNode,
  section: SectionNode,
}
