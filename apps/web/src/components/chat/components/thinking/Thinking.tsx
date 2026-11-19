import { BrainIcon } from '@phosphor-icons/react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Activity } from '../activity'
import type { ThinkingProps } from './types'

export const Thinking = ({ text }: ThinkingProps) =>
  text ? (
    <Activity icon={<BrainIcon />} label="Thought">
      <p className="font-sans whitespace-pre-wrap text-muted-foreground">
        {text}
      </p>
    </Activity>
  ) : (
    <Marker role="status">
      <MarkerIcon>
        <BrainIcon />
      </MarkerIcon>
      <MarkerContent className="shimmer">Thinking…</MarkerContent>
    </Marker>
  )
