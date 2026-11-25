'use client'

import { Badge } from 'gencn'
import { defineBlock } from 'gencn/react'
import { Badge as Label } from '@/components/ui/badge'

export const badgeBlock = defineBlock(Badge, ({ props }) => (
  <Label variant={props.variant ?? 'default'}>{props.text}</Label>
))
