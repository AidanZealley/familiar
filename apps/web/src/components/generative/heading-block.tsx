'use client'

import { Heading } from 'gencn'
import { defineBlock } from 'gencn/react'

// A view sits inside a page, so its largest heading is an h2.
const levels = {
  1: { Tag: 'h2', size: 'text-lg' },
  2: { Tag: 'h3', size: 'text-base' },
  3: { Tag: 'h4', size: 'text-sm' },
} as const

export const headingBlock = defineBlock(Heading, ({ props }) => {
  const { Tag, size } = levels[props.level ?? 2]
  return (
    <Tag className={`font-heading font-semibold ${size}`}>{props.text}</Tag>
  )
})
