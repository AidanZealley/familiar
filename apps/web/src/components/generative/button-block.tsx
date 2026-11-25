'use client'

import { Button } from 'gencn'
import { defineBlock } from 'gencn/react'
import { Button as Pressable } from '@/components/ui/button'

export const buttonBlock = defineBlock(Button, ({ props, emit }) => (
  <Pressable
    type="button"
    variant={props.variant ?? 'default'}
    disabled={props.disabled}
    onClick={() => emit('press')}
  >
    {props.label}
  </Pressable>
))
