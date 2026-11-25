'use client'

import { Text } from 'gencn'
import { defineBlock } from 'gencn/react'

export const textBlock = defineBlock(Text, ({ props }) => (
  <p
    className={
      props.tone === 'muted' ? 'text-sm text-muted-foreground' : 'text-sm'
    }
  >
    {props.text}
  </p>
))
