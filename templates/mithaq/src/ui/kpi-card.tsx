// One figure on a card, which the dashboard's home and the portal's home both draw.
import type { ReactNode } from 'react'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * A figure on a card, marked with the figure it shows. On a phone, two to a row,
 * a card is about 136 pixels wide, so there the padding is a step smaller, and
 * below 220 pixels of card the figure is set in the body size, which holds a sum
 * such as "SAR 5,150.00" on one line in either locale; one longer still breaks at
 * the edge rather than being cut.
 */
export function KpiCard({ kpi, icon, title, value, footer }: { kpi: string; icon: ReactNode; title?: string; value: ReactNode; footer: ReactNode }) {
  return (
    <Card data-kpi={kpi} className="@container/card min-w-0">
      <CardHeader className="px-4 sm:px-6">
        <CardDescription className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground inline-flex">{icon}</span>
          <span>{title}</span>
        </CardDescription>
        <CardTitle className="min-w-0 text-base font-semibold tabular-nums wrap-break-word @[220px]/card:text-2xl @[250px]/card:text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardFooter className="text-muted-foreground pt-2 text-xs px-4 sm:px-6">{footer}</CardFooter>
    </Card>
  )
}
