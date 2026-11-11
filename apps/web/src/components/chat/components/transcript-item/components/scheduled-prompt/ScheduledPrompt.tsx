import { AlarmClockIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { nameOf, useFamiliars } from '@/lib/workspace'
import type { ScheduledPromptProps } from './types'

/** A Familiar's own earlier prompt, not the owner's words: a quiet line, clamped until tapped. */
export const ScheduledPrompt = ({ item }: ScheduledPromptProps) => {
  const [expanded, setExpanded] = useState(false)
  const familiars = useFamiliars()

  return (
    <Marker className="items-start text-xs">
      <MarkerIcon className="mt-0.5">
        <AlarmClockIcon />
      </MarkerIcon>
      <MarkerContent className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="block w-full text-left"
        >
          {/* Clamped inside: the button's own `block` would override it. */}
          <span className={cn(!expanded && 'line-clamp-2')}>
            {nameOf(familiars, item.familiar)}’s schedule · {item.prompt}
          </span>
        </button>
      </MarkerContent>
    </Marker>
  )
}
