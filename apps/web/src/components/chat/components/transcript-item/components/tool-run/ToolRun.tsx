import { HandTapIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { FamiliarLink } from '@/components/familiar-link'
import { toolName } from '../../../tool-call/label'
import type { ToolRunProps } from './types'

/** A tool a person ran for a Familiar, such as from a card, and how it went. */
export const ToolRun = ({ run }: ToolRunProps) => (
  <div className="flex flex-col gap-1 text-xs">
    <Marker className={cn(run.outcome === 'failed' && 'text-destructive')}>
      <MarkerIcon>
        <HandTapIcon />
      </MarkerIcon>
      <MarkerContent>
        {run.author.name} ran <FamiliarLink id={run.familiar} />
        ’s {toolName(run.tool)}
        {run.outcome === 'failed' && ' · didn’t work'}
      </MarkerContent>
    </Marker>
    <p className="ml-5.5 truncate border-l-2 pl-2.5 font-mono text-muted-foreground">
      {run.outcome === 'failed' && run.message
        ? run.message
        : JSON.stringify(run.args)}
    </p>
  </div>
)
