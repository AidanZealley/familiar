'use client'

import { Grid } from 'gencn'
import { defineBlock } from 'gencn/react'
import { cn } from '@/lib/utils'

// Whole class names, so Tailwind finds them when it scans this file.
const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
} as const
const spacing = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' } as const

export const gridBlock = defineBlock(Grid, ({ props, children }) => (
  <div
    className={cn(
      'grid',
      columnClasses[props.columns ?? 2],
      spacing[props.gap ?? 'md'],
    )}
  >
    {children}
  </div>
))
