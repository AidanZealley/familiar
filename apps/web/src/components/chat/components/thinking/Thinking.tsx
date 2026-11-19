import { BrainIcon } from '@phosphor-icons/react'
import { Activity } from '../activity'
import type { ThinkingProps } from './types'

export const Thinking = ({ text }: ThinkingProps) => (
  <Activity icon={<BrainIcon />} label="Thought">
    <p className="font-sans whitespace-pre-wrap text-muted-foreground">
      {text}
    </p>
  </Activity>
)
