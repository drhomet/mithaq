// The shell owns the breadcrumb, so both hosts share the record layout.
import type { ReactNode } from 'react'
import type { LayoutProps } from 'mithaq/admin'
import { RecordPage } from '@asas/mithaq/ui/record-page.tsx'

export const regions = ['main', 'side', 'danger'] as const
export const BackofficeRecordPage = (props: LayoutProps<typeof regions, ReactNode>) => <RecordPage {...props} />
