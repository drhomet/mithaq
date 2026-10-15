import * as React from 'react'

import { cn } from '@/lib/utils'

type DirectionalIconProps = {
  children: React.ReactNode
  className?: string
}

export function DirectionalIcon({
  children,
  className,
}: DirectionalIconProps) {
  return (
    <span className={cn('inline-flex shrink-0 rtl:-scale-x-100', className)}>
      {children}
    </span>
  )
}
// mithaq-admin b06d8d335d306c07556f8f2b81fba20ba7ded198 4fedc7b1d6b2b8d33522dc8ea4091ec01ec38321b660e29561820722e59a2086
