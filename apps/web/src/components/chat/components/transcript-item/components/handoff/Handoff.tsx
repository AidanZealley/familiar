import { ArrowRightIcon } from 'lucide-react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { FamiliarLink } from '@/components/familiar-link'
import type { HandoffProps } from './types'

/** One Familiar asking another to take a turn, with its note; the reply follows. */
export const Handoff = ({ handoff }: HandoffProps) => (
  <div className="flex flex-col gap-1 pl-10.5 text-xs">
    <Marker>
      <MarkerIcon>
        <ArrowRightIcon />
      </MarkerIcon>
      <MarkerContent>
        <FamiliarLink id={handoff.from} /> asked{' '}
        <FamiliarLink id={handoff.to} />
      </MarkerContent>
    </Marker>
    <p className="ml-5.5 border-l-2 pl-2.5 text-muted-foreground italic">
      {handoff.note}
    </p>
  </div>
)
