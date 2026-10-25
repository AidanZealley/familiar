import { BrainIcon } from 'lucide-react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Activity } from '../activity'
import type { ThinkingProps } from './types'

export const Thinking = ({ text, active }: ThinkingProps) =>
  text ? (
    <Activity
      icon={<BrainIcon />}
      label={active ? 'Thinking…' : 'Thought'}
      active={active}
    >
      <p className="font-sans whitespace-pre-wrap text-muted-foreground">
        {text}
      </p>
    </Activity>
  ) : (
    // Nothing to show yet, only that a reply is on its way.
    <Marker role="status">
      <MarkerIcon>
        <BrainIcon />
      </MarkerIcon>
      <MarkerContent className="shimmer">Thinking…</MarkerContent>
    </Marker>
  )
