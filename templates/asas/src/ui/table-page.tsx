// The layout of a page that lists rows: one region, `main`.
import type { ReactNode } from 'react'
import type { LayoutProps } from 'mithaq/admin'

export const regions = ['main'] as const

export const TablePage = ({ regions, page }: LayoutProps<readonly ['main'], ReactNode>) => (
  <div data-layout="table" data-page={page.path} className="grid gap-4">{regions.main}</div>
)
