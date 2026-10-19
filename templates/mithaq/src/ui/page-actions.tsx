import type { ReactNode } from 'react'
import type { LayoutProps } from 'mithaq/admin'
import { useLocale } from 'mithaq/admin/react'
import { MoreActions as More } from 'mithaq-admin/page-header.tsx'

export const regions = ['main'] as const

export function MoreActions({ regions }: LayoutProps<readonly ['main'], ReactNode>) {
  return <More t={useLocale().t}>{regions.main}</More>
}
