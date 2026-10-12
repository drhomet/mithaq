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
