'use client'

import { Stat } from 'gencn'
import { defineBlock } from 'gencn/react'

export const statBlock = defineBlock(Stat, ({ props }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground">{props.label}</span>
    <span className="text-2xl font-semibold tabular-nums">
      {props.value}
      {props.unit && (
        <span className="ml-0.5 text-base font-normal text-muted-foreground">
          {props.unit}
        </span>
      )}
    </span>
    {props.caption && (
      <span className="text-xs text-muted-foreground">{props.caption}</span>
    )}
  </div>
))
