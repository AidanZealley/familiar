'use client'

import { Stack } from 'gencn'
import { defineBlock } from 'gencn/react'
import { cn } from '@/lib/utils'

const spacing = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' } as const
const crossAxis = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} as const
const mainAxis = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const

export const stackBlock = defineBlock(Stack, ({ props, children }) => {
  const horizontal = props.direction === 'horizontal'
  return (
    <div
      className={cn(
        'flex',
        horizontal ? 'flex-row flex-wrap' : 'flex-col',
        spacing[props.gap ?? 'md'],
        crossAxis[props.align ?? (horizontal ? 'center' : 'stretch')],
        mainAxis[props.justify ?? 'start'],
      )}
    >
      {children}
    </div>
  )
})
