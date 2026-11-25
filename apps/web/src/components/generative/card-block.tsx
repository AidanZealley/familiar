'use client'

import { Card } from 'gencn'
import { defineBlock } from 'gencn/react'
import {
  Card as CardSurface,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const cardBlock = defineBlock(Card, ({ props, children }) => {
  const { title, description } = props
  return (
    <CardSurface>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </CardSurface>
  )
})
