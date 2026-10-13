import type { ReactElement, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ClientKayan } from 'mithaq/admin'
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Copy } from './copy.ts'
import { leavesOf, shown, type NodeProps } from './node-tree.ts'
import { carded, drawNodes } from './nodes.tsx'

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

export function TabsNode({ node, draw }: NodeProps<'tabs'>): ReactElement {
  return (
    <TabGroup
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
  )
}

export function AccordionNode({ node, draw }: NodeProps<'accordion'>): ReactElement {
  return (
    <Accordion data-layout-accordion="true" data-node="accordion" defaultValue={node.accordion[0] ? [node.accordion[0].item] : []} keepMounted className="overflow-hidden rounded-lg border">
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
  )
}

export function SectionNode({ node, draw, inRow }: NodeProps<'section'>): ReactElement {
  const { label, description } = groupCopy({ kayan: draw.kayan, name: node.section, group: node, copy: draw.copy })
  const body = <CardContent className="flex flex-col gap-4">{drawNodes({ nodes: node.fields, draw: { ...draw, inCard: true } })}</CardContent>
  // A section is a card that opens and closes. `keepMounted` on the panel so a field inside a closed
  // section still renders and a refusal naming it is counted.
  return (
    <Collapsible data-node="section" defaultOpen={node.collapsed !== true} style={inRow ? { flexGrow: node.width ?? 1, flexBasis: 0 } : undefined}>
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
}
// mithaq-admin 18e80532b8fb462dbba313622bcd6ee8762c2c92 10ce1ee21c7cd7713d3e1cd30cc9061d23febd9251c89442b8aae7b1bd6cbb55
