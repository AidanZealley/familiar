'use client'

import { Image } from 'gencn'
import { defineBlock } from 'gencn/react'
import { cn } from '@/lib/utils'

const ratios = { auto: '', square: 'aspect-square', video: 'aspect-video' }

export const imageBlock = defineBlock(Image, ({ props }) => (
  <img
    src={props.src}
    alt={props.alt}
    loading="lazy"
    className={cn(
      'w-full bg-muted object-cover',
      ratios[props.aspect ?? 'auto'],
    )}
  />
))
