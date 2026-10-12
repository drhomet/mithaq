// The portal's one frame: a single column, `main`, drawn as a div because the
// shell around it already holds the page's one main landmark. Its one track may
// shrink below its widest child, so nothing wide stretches the portal past a phone.
import type { ReactNode } from 'react'
import type { LayoutProps } from 'mithaq/admin'

export const regions = ['main'] as const

export const Page = ({ regions, page }: LayoutProps<readonly ['main'], ReactNode>) => (
  <div data-layout="page" data-page={page.path} className="grid grid-cols-[minmax(0,1fr)] gap-4">{regions.main}</div>
)
